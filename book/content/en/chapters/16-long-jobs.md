---
title: "16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch"
sourceRevision: 1
---

# 16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch

The housekeeping function in [chapter 08](/en/chapters/08-async.md) had its timeout set to 15 minutes. That is Lambda's maximum. With enough images, it will hit it one day. That chapter wrote "don't let it grow with the number of images" and moved on.

This chapter takes a job that may not fit in 15 minutes and runs it to the end. The job is an export of every note: read all the notes in the table and write them to S3 as files. If it stops halfway, it should pick up where it stopped, not start over.

The tool is Step Functions. But the centre of the chapter is where chapter 08's was. A step can run twice. Its answer can get lost. A worker that was supposed to have stopped can write later. Building things so that there is still one output: a workflow service does not take that off your hands.

You need chapter 08 (idempotency, Scheduler) and [chapter 12](/en/chapters/12-containers.md) (containers). The code is in `examples/16-long-jobs/`. The default stack costs next to nothing while it sits there. The numbers are under "What it costs".

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

What is new: one state machine, three functions, one bucket, one schedule. The table has the same shape as [chapter 05](/en/chapters/05-dynamodb.md)'s, and this stack creates one of its own.

Once a day, Scheduler starts the state machine. The state machine keeps calling `ExportPages` for as long as it is told there is more, and then calls `Finish`. The functions know nothing about each other. What remembers the order, and how far things have got, is the state machine.

### Why not one function?

A Lambda function can run for at most 900 seconds (15 minutes) per invocation. No request raises that limit (a different way of running functions, Lambda Managed Instances, has an exception of up to 90 minutes, which this book does not cover).

While there are few notes, one function can read everything and write everything. But work that grows with the number of items passes 15 minutes one day. The moment it does, the function is stopped, and the next run starts from the beginning. That one stops at 15 minutes too. It never finishes.

So you split the work. "One invocation goes as far as it can and returns how far it got." The next invocation continues from there. Something has to call the pieces in order. That something is a workflow.

### What this chapter did not choose

Other tools can do the same job.

- **Lambda durable functions.** A new feature that lets you write "the thing that calls the pieces in order" inside the Lambda function itself. The second half of this chapter rewrites the same export with it. It is not the main path because more of it is unconfirmed on the real service than with Step Functions
- **An ECS task.** Fifteen minutes is Lambda's limit, and it does not apply to a container. Some work then needs no splitting. The end of the chapter comes back to this
- **Calling yourself again through SQS.** Putting a "continue from here" message into chapter 08's queue yourself. It works, but the progress is visible nowhere

## Splitting the work

<!-- section: 16.split -->

Three values decide the split: where to read from, which number the next file gets, and whether it is over.

<<< @/examples/16-long-jobs/src/job.ts{progress}

This is everything that passes from step to step. The notes themselves are not in it. Step Functions can carry at most 256 KiB between states, and a step that returns more fails the execution. Large data goes to S3, and only "how far it got" goes through the workflow.

### The reading side

<<< @/examples/16-long-jobs/src/note-source.ts{port}

The reading side promises one thing: hand it a cursor that means "after last time", and it returns the next page.

<<< @/examples/16-long-jobs/src/dynamodb-note-source.ts{scan}

Chapter 05's API read one owner's notes with `Query`. An export is about everyone's notes, so it uses `Scan`, which reads the table from one end. A `Scan` returns at most 1 MB at a time, and when there is more it returns a `LastEvaluatedKey`. You pass that as the next `ExclusiveStartKey`. That is the cursor, as it is.

Two things to watch. Both `Limit` and the 1 MB limit count items before the filter is applied. So a page with no notes in it can come back in the middle. An empty page is not the end. The only sign of the end is that there is no `LastEvaluatedKey`.

The other one: a `Scan` does not read a copy of the table as of one instant. A note written while the export runs may be in it or not. This chapter's export does not promise "every note as of the start". What it does promise is the one sentence in the next section.

### A name taken from the work

<<< @/examples/16-long-jobs/src/job.ts{start}

The export's ID is not a random number, and not the ID of the execution. It is the time the schedule passes in as "the run this firing was for".

Remember chapter 08: Scheduler delivers at least once. If the same firing arrives twice, two state machine executions start. If those two wrote separate files under separate IDs, there would be two exports. With the same ID made from the same time, the two executions try to write the same export. What happens next is the next section's job.

<<< @/examples/16-long-jobs/src/job.ts{keys}

Where a file goes is decided by the ID and a number alone. The attempt count is not in the key. A step that runs twice aims at the same key both times.

## A step runs twice

<!-- section: 16.idempotent-step -->

Here is what must hold, in one sentence first.

**Each part of an export is written once per number, and the next part starts where the written part ended. This does not change when the same step runs again, when a stalled worker writes late, or when two executions of the same export overlap.**

You cannot say "it is Step Functions, so a step runs once". The documentation describes Standard workflows as exactly-once. But there is a condition attached: unless the definition specifies `Retry`. And a workflow without `Retry` fails entirely on one transient error. A workflow that is of any use runs steps again.

And the step that runs again is not always one that failed. It can be one that succeeded and whose success was never heard.

```text
one call of ExportPages for part N (cursor C)            if the worker stops right after this step
  1. Scan from C, up to 100 notes                        nothing has changed
  2. PutObject parts/N, If-None-Match: *                 part N exists; a retry gets 412 and reads its metadata
     on 412: HeadObject parts/N, take its count and next
  3. return {cursor: next, nextPart: N+1, ...}           the workflow never hears; it runs the step again from C

never, in any order of retries and late workers:
  a part written twice, or a part replaced after the workflow moved past it
```

Think about stopping between 2 and 3. Part N is in S3. But the workflow does not know. It calls the step again with the same input.

What if the step simply did a `PutObject`? The key is the same, so it overwrites. Nothing is duplicated. At first sight that looks like enough.

It is not, because the table may have changed between the first attempt and the second. If one note from the first attempt's page has been deleted, the second attempt's page reaches one note further. The overwritten part N ends one note later than before. So far it still adds up. The trouble comes when the first worker was in fact alive.

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

If A's write goes through at t5, part 3 is A's page again. But the workflow is writing part 4 from where B's page ended. A's page ends one note earlier, so the note in between is in no part at all. The export is quietly one note short.

### The first writer wins

<<< @/examples/16-long-jobs/src/export-store.ts{port}

<<< @/examples/16-long-jobs/src/s3-export-store.ts{put-if-absent}

A `PutObject` with `If-None-Match: *` writes only when there is no object under the key. If there is one, the answer is 412. S3 does the check and the write as one operation. According to the documentation, when conditional writes to the same key overlap, the first one to finish succeeds and the rest get 412. It is the same shape as chapter 05's optimistic lock and chapter 08's "write only if newer", with S3 on the other side this time.

A 412 is not a failure. It is an answer: someone has already written this. What matters is what comes next.

<<< @/examples/16-long-jobs/src/steps.ts{export-pages}

If the part was written first by someone else, the step throws away the page it read. It then reads how many notes the stored part holds and where it ended, and returns that as its own result. Each part carries those two values as metadata.

That way, whoever wrote part N, there is one cursor that follows part N. A step that runs again, a worker that arrives late, and another overlapping execution all start part N+1 from the same place.

### Fix the order, then try to break it

The tests call the step function directly. They need no Step Functions, no clock, and no random numbers. Where things stop, and the moment the table changes, are fixed one at a time.

| What is injected | Result |
| --- | --- |
| The same step called twice with the same input | The second call writes nothing and returns the same progress |
| The answer dropped after the first part is written, one note deleted, then the step called again from the start | The first part stays as the first attempt wrote it; nothing after it is skipped or repeated |
| The write of the third part made to fail | The step throws. Called again, it passes over the two parts and writes the rest |
| The read from the table made to fail | Progress does not advance, and the written part stays |
| Worker A stopped just before its write, one note deleted, worker B doing everything, then A resumed | The output stays B's. A returns the same progress as B |
| Two runs of the same export at once, advancing a page at a time in turn | One set of parts. Both runs return the same result |

Row five is the timeline above. A test device makes A's write "wait until told", and B runs to the end in the meantime. Nothing depends on waiting for time to pass.

The code was also broken on purpose in two places to confirm that tests fail. Using the step's own page values after a 412 makes two fail. Letting the local store overwrite makes two fail as well.
