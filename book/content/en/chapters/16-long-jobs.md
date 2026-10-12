---
title: "16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch"
sourceRevision: 2
---

# 16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch

The housekeeping function in [chapter 08](/en/chapters/08-async.md) had its timeout set to 15 minutes, which is Lambda's maximum. With enough images it will hit that limit one day, and chapter 08 only noted that the work should not grow with the number of images before moving on.

This chapter takes a job that may not fit in 15 minutes and runs it to the end. The job is an export of every note. It reads all the notes in the table and writes them to S3 as files, and if it stops halfway it resumes from where it stopped instead of starting over.

The tool is Step Functions, but the subject is the same as chapter 08's. A step can run twice, its answer can get lost, and a worker that was supposed to have stopped can write later. Making sure there is still exactly one output is your job, and a workflow service does not do it for you.

You need chapter 08 (idempotency, Scheduler) and [chapter 12](/en/chapters/12-containers.md) (containers). The code is in `examples/16-long-jobs/`. The default stack costs next to nothing while it sits idle. The amounts are on [the costs page](/en/chapters/16-long-jobs/wrap.md).

## The big picture

<!-- section: 16.architecture -->

```figure
caption: Scheduler starts the state machine "ExportWorkflow" (Standard, at most 6 hours) once a day, and the state machine moves through the steps in order
node scheduler: EventBridge Scheduler "aih-long-jobs-export" | rate(1 day), assumes "ScheduleRole"
node pages: ExportPages | Retry: 3 times, any error
node more: MorePages | Choice
node finish: Finish | Retry: 3 times, except ExportCorrupt
node exported: Exported | Succeed
node discard: Discard | Retry: 3 times, any error
node discarded: Discarded | Fail
edge scheduler -> pages: StartExecution {exportId: scheduled time}, at least once
edge pages -> more
edge more -> finish: done: true
edge more -> pages: done: false
edge finish -> exported
edge finish -> discard: ExportCorrupt
edge discard -> discarded
group workflow: Step Functions = pages, more, finish, exported, discard, discarded
```

```figure
caption: The three functions write notes read from the table into parts, write the manifest, and delete the parts when the export is discarded
node table: DynamoDB table "Notes"
node pages: Lambda "ExportPages" | timeout 300 s
node parts: exports/<id>/parts/00001.ndjson … | S3 bucket "Exports", exports/ expires after 7 days
node finish: Lambda "Finish" | timeout 60 s
node discard: Lambda "Discard" | timeout 300 s
node manifest: exports/<id>/manifest.json | S3 bucket "Exports", exports/ expires after 7 days
edge table -> pages: Scan, 100 notes a page
edge pages -> parts: PutObject, If-None-Match: *
edge parts -> finish: ListObjectsV2
edge parts -> discard: ListObjectsV2
edge discard -> parts: DeleteObject
edge finish -> manifest: PutObject, If-None-Match: *
```

```figure
caption: Only with -c durable=true, the stack also creates a durable function that holds the same three steps in one function
node pages: ExportPages
node finish: Finish
node discard: Discard
group durable: Lambda durable function "aih-long-jobs-durable-export", alias "live" = pages, finish, discard
```

The new pieces are one state machine, three functions, one bucket, and one schedule. The table has the same shape as the one in [chapter 05](/en/chapters/05-dynamodb.md), and this stack creates its own.

Scheduler starts the state machine once a day. The state machine keeps calling `ExportPages` for as long as `ExportPages` reports that there is more, and then calls `Finish`. The three functions know nothing about each other. The state machine is what remembers the order of the calls and how far the export has got.

### Why one function is not enough

A Lambda function can run for at most 900 seconds (15 minutes) per invocation, and no request raises that limit. A different way of running functions, Lambda Managed Instances, has an exception of up to 90 minutes, which this book does not cover.

While there are few notes, one function can read everything and write everything. But work that grows with the number of items passes 15 minutes one day. When it does, Lambda stops the function, the next invocation starts from the beginning, and Lambda stops that one at 15 minutes too. However often you invoke it, it never finishes.

So you split the work. One invocation goes as far as it can and returns how far it got, and the next invocation continues from there. Something then has to call the pieces in order, and that something is a workflow.

### What this chapter did not choose

Step Functions is not the only tool that can do this.

- Lambda durable functions are a new feature that lets you write the part that calls the pieces in order inside the Lambda function itself. The second half of [the deploy page](/en/chapters/16-long-jobs/deploy.md) rewrites the same export with it. It is not the main path because more of it is unconfirmed on the real service than with Step Functions
- An ECS task is not subject to Lambda's 15-minute limit, so some work needs no splitting at all. The end of the deploy page comes back to this
- A function can also call itself again through SQS, by putting a "continue from here" message into chapter 08's queue. It works, but the progress is visible nowhere

## Splitting the work

<!-- section: 16.split -->

Three values decide the split: where to read from, which number the next file gets, and whether the export is finished.

<<< @/examples/16-long-jobs/src/job.ts{progress}

Those three values, the export's ID, and the number of notes written are all that passes from step to step. The notes themselves are not included, because Step Functions can carry at most 256 KiB between states and a step that returns more fails the execution. Large data goes to S3, and only "how far it got" goes through the workflow.

### The reading side

<<< @/examples/16-long-jobs/src/note-source.ts{port}

The reading side promises one thing. Hand it a cursor that means "where the last page ended", and it returns the next page.

<<< @/examples/16-long-jobs/src/dynamodb-note-source.ts{scan}

Chapter 05's API read one owner's notes with `Query`. An export covers everyone's notes, so it uses `Scan`, which reads the table from one end. A `Scan` returns at most 1 MB at a time, and when there is more it returns a `LastEvaluatedKey`. Passing that value as the next `ExclusiveStartKey` reads the next page, so the export uses `LastEvaluatedKey` as its cursor unchanged.

`Scan` has two things to watch. The first is that both `Limit` and the 1 MB limit count items before the filter is applied, so a page with no notes in it can come back in the middle of the table. An empty page does not mean the end. The only sign of the end is that there is no `LastEvaluatedKey`.

The second is that a `Scan` does not read a copy of the table as of one instant. A note written while the export runs may or may not be in it. This chapter's export therefore does not promise "every note as of the start". What it does promise is stated in one sentence at the top of the section "A step runs twice".

### A name taken from the work

<<< @/examples/16-long-jobs/src/job.ts{start}

The export's ID is neither a random number nor the ID of the execution. It is the time that the schedule passes in to say which firing this run belongs to.

As chapter 08 showed, Scheduler delivers at least once. If the same firing arrives twice, two executions of the state machine start. If those two wrote separate files under separate IDs, there would be two exports. Because the same time gives the same ID, the two executions try to write the same export instead. The next section decides what happens when their writes collide.

<<< @/examples/16-long-jobs/src/job.ts{keys}

The location of a file is also decided by the ID and a number alone. The attempt count is not in the key, so a step that runs twice aims at the same key both times.

## A step runs twice

<!-- section: 16.idempotent-step -->

Here is what must hold, in one sentence.

**Each part of an export is written once per number, and the next part starts where the written part ended. This does not change when the same step runs again, when a stalled worker writes late, or when two executions of the same export overlap.**

Using Step Functions does not mean a step runs only once. The documentation describes Standard workflows as exactly-once, but with a condition attached: unless the definition specifies `Retry`. A workflow without `Retry`, on the other hand, fails entirely on one transient error. Any workflow you can rely on runs steps again.

Failed steps are not the only ones that run again. A step that succeeded, but whose success never reached the workflow, runs again too.

```text
one call of ExportPages for part N (cursor C)            if the worker stops right after this step
  1. Scan from C, up to 100 notes                        nothing has changed
  2. PutObject parts/N, If-None-Match: *                 part N exists; a retry gets 412 and reads its metadata
     on 412: HeadObject parts/N, take its count and next
  3. return {cursor: next, nextPart: N+1, ...}           the workflow never hears; it runs the step again from C

never, in any order of retries and late workers:
  a part written twice, or a part replaced after the workflow moved past it
```

Take the case where the worker stops between 2 and 3. Part N is in S3, but the workflow does not know that, so it calls the step again with the same input.

Suppose the second call did a `PutObject` with no condition. The key is the same, so part N is overwritten. Nothing is duplicated, and that looks like enough.

It is not enough, because the table may have changed between the first attempt and the second. If one note from the first attempt's page has been deleted, the second attempt's page reaches one note further. The overwritten part N ends one note later than the first one did, but the next part also starts from there, so everything still adds up. It stops adding up when the first worker was in fact still alive.

```figure
caption: The PutObject of the stalled worker A arrives after worker B has written part 3
type: sequence
actor wf: workflow
actor a: worker A
actor b: worker B
actor s3: S3 | parts/3
step wf -> a: t0 ExportPages (part 3)
step a -> a: scans, starts PutObject
note a: t1 stalled (no answer)
step wf -> b: t2 gives up on A, retries
step b -> b: scans (one note deleted)
step b -> s3: t3 PutObject: written
step b --> wf: t4 returns
step wf -> wf: t4 goes on from B's part
note s3: with a plain PutObject
step a -> s3: t5 late PutObject arrives
note s3: replaced by A's part
note wf: one note is in no part
note s3: with If-None-Match: *
step a -x s3: t5 late PutObject: 412
step a -> s3: reads B's metadata
step a --> wf: reports B's position
```

If A's write goes through at t5, part 3 is A's page again. The workflow, however, is writing part 4 from where B's page ended. A's page ends one note before B's does, so the note in between is in no part at all. No error is raised anywhere, and the export comes out one note short.

### The first writer wins

<<< @/examples/16-long-jobs/src/export-store.ts{port}

<<< @/examples/16-long-jobs/src/s3-export-store.ts{put-if-absent}

A `PutObject` with `If-None-Match: *` writes only when there is no object under the key, and answers 412 when there is one. S3 does the check and the write as one operation. According to the documentation, when conditional writes to the same key overlap, the first one to finish succeeds and the rest get 412. This is the same shape as chapter 05's optimistic lock and chapter 08's "write only if newer", with S3 on the other side.

A 412 is not a failure. It is an answer that says someone has already written this part. Whether the sentence above holds depends on what the step does after it gets that answer.

<<< @/examples/16-long-jobs/src/steps.ts{export-pages}

If the part was already written, the step throws away the page it read. It then reads how many notes the stored part holds and where it ended, and returns those values as its own result. Each part carries its count and its end position as metadata.

As a result, the cursor that follows part N is the same whoever wrote part N. A step that runs again, a worker that arrives late, and another overlapping execution all start part N+1 from the same place.

### Fix the order, then try to break it

The tests call the step function directly, and need no Step Functions, no clock, and no random numbers. Each test fixes one place where the work stops and one moment at which the table changes.

| What is injected | Result |
| --- | --- |
| The same step called twice with the same input | The second call writes nothing and returns the same progress |
| The answer dropped after the first part is written, one note deleted, then the step called again from the start | The first part stays as the first attempt wrote it; nothing after it is skipped or repeated |
| The write of the third part made to fail | The step throws. Called again, it passes over the two parts and writes the rest |
| The read from the table made to fail | Progress does not advance, and the written part stays |
| Worker A stopped just before its write, one note deleted, worker B doing everything, then A resumed | The output stays B's. A returns the same progress as B |
| Two runs of the same export at once, advancing a page at a time in turn | One set of parts. Both runs return the same result |

Row five is the timeline in the figure of workers A and B. The test holds A's write until it is signalled and runs B to the end in the meantime, so nothing depends on how long anything takes.

The code was also broken on purpose in two places to confirm that tests fail. Using the step's own page values after a 412 makes two tests fail, and so does letting the local store overwrite.
