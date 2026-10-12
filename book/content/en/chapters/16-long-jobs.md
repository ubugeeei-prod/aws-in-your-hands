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

## The last file makes it visible

<!-- section: 16.manifest -->

Until all the parts are there, the bucket holds a half-written export. It would be a problem if someone read that.

<<< @/examples/16-long-jobs/src/steps.ts{finish}

So there is one agreement with whoever reads an export. **An export without a manifest does not exist.** The manifest is a small file listing the keys of the parts. A reader reads the manifest first, and then only the parts it names. It must not list the prefix and read what it finds.

Before it writes the manifest, `Finish` lists the parts to check that all of them are there. It cannot write the name of something that is missing. The manifest has no timestamp in it. If two executions finish the same export, the bytes they try to write are the same. The first one wins, and the other gets a 412 and returns the same result.

### Undo only when you cannot go on

What if a part is missing? This is where the chapter's compensation comes in.

With a database transaction, a failure halfway means a rollback makes everything not have happened. A workflow has nothing like that. What step 1 wrote to S3 stays there when step 3 fails. If you want it undone, you write the step that undoes it. That is compensation.

<<< @/examples/16-long-jobs/src/steps.ts{discard}

A compensation is in a harder position than an ordinary step. It is called when something is already broken, and it can stop halfway itself. So there are three rules.

- **It can be called any number of times.** Deleting what is already gone is not an error. If it stops halfway, calling it again deletes the rest
- **It does not touch what is finished.** An export that has a manifest is not deleted. That is insurance against the verdict "it failed" being out of date
- **What cannot be undone cannot be undone.** An S3 object can be deleted. An email that was sent cannot. Put operations that cannot be undone as late in the workflow as you can

And the occasions for calling a compensation are fewer than you might think. When `ExportPages` fails, this workflow does not delete the parts. The parts that were written are where the next resume starts. They are deleted only when `Finish` says a part is missing, because no retry brings a missing part back.

**If you can go forward, resume. Undo only when you cannot.** For long work, decide this first. A workflow that undoes everything on every failure has thrown away "resume where it stopped" by itself.

What about parts that are neither resumed nor undone, just left? The bucket's lifecycle rule deletes them after 7 days. Finished exports go after the same 7 days. An export is treated as a temporary place for someone to pick things up from.

One gap is left open, and here it is. In `Finish`, "check by listing" and "write the manifest" are two operations. If another execution's `Discard` deletes a part between them, there is a manifest that names a deleted part. It takes two overlapping executions of the same export of which only one decides a part is missing, but it can happen. This chapter does not close it.

## Leave the order to the workflow

<!-- section: 16.workflow -->

The steps are ready, so let's connect them. A Step Functions workflow is called a state machine and is written in a JSON language, Amazon States Language (ASL).

<<< @/examples/16-long-jobs/src/workflow.ts{definition}

This chapter writes the definition as a TypeScript object. CDK has constructs for it, and they are not used here, because the same object should go to both the local runner (coming up) and CDK.

There are six states. A `Task` calls a function, a `Choice` is a fork, and `Succeed` and `Fail` are the ends.

The `Resource` of each `Task` is the function's ARN, written directly. Written this way, the state's input becomes the function's event as it is, and the function's return value becomes the state's output as it is. The progress `ExportPages` returns goes through `MorePages` and becomes the input of the next `ExportPages`. That is all it takes for the loop to turn.

### Retry and Catch

`Retry` means "this state again, with the same input". `ExportPages` is retried up to three times on any error, starting 5 seconds apart and doubling. `States.ALL` is a name that matches almost every error: an exception in the function, a transient Lambda fault, a timeout.

Only `Finish` has two retriers. `ExportCorrupt` gets zero attempts, that is, no retry. Everything else gets three. `ExportCorrupt` is the `name` of the exception the function throws. An error thrown by a Lambda function reaches Step Functions under its `name`.

`Catch` means "when the retries are used up, go to this state instead of failing". With `ResultPath`, the original input is kept and the error is added beside it. `Discard` reads the export's ID from there.

The only `Catch` is on `Finish`, for `ExportCorrupt`. Every other failure is caught by nothing, and the execution itself fails. That is on purpose.

### A failed execution continues

A failed Standard workflow execution can be redriven for 14 days: the failed state runs again, with the input it had. States that succeeded are not run again.

Say `ExportPages` fails four times in a row and the execution stops. After fixing the cause (wrong permissions, say), a redrive calls `ExportPages` again with the progress it had when it stopped. If parts 1 to 30 were written, it goes on from 31. To be exact, any parts the stopped call wrote on its way are passed over through 412s as well.

Had there been a `Catch` leading to a `Fail` state here, a redrive would not help. According to the documentation, a redrive re-enters a `Fail` state and fails again. An execution of this workflow that got to `Discarded` cannot be resumed. It was undone, so that is right.

### Standard and Express

A state machine is one of two types, and the type cannot be changed after creation.

| | Standard | Express |
| --- | --- | --- |
| Longest run | One year | Five minutes |
| State | Persisted between states | Not persisted |
| Execution guarantee | Exactly-once (apart from `Retry`) | At-least-once when asynchronous |
| Billing | Number of state transitions | Number of executions, duration, memory |
| Redrive of a failed execution | Yes | Not confirmed |

This chapter uses Standard: nothing guarantees it ends in five minutes, and it should resume from the middle.

### Always write the timeout

A `Task`'s `TimeoutSeconds` is 99,999,999 seconds when left out. That is more than three years. A task whose answer never comes would leave the execution stopped right there. The official best practices say the same: give tasks a timeout.

In this chapter, each `Task`'s timeout is 30 seconds longer than its function's timeout. Lambda stops the function first and returns an error. Step Functions receives it and retries. In that order, the state "Step Functions has given up, but the function is still running" does not normally come about.

"Normally", because it cannot be ruled out. The documentation says a task that timed out is treated as failed. It does not say the running function is stopped. Besides, an answer can be lost on the network, and two executions of the same export can overlap. The `If-None-Match` of the earlier section is there for that. Timeout settings make late workers rarer. The condition on the write is what makes them harmless.

## How big a checkpoint

<!-- section: 16.checkpoint -->

Saving "how far it got" is called a checkpoint. This workflow makes one every time `ExportPages` returns. So how often should it return?

<<< @/examples/16-long-jobs/src/steps.ts{budget}

After every page it writes, the step function asks outside: is there room for one more? Who holds the answer decides the granularity.

<<< @/examples/16-long-jobs/src/export-pages-lambda.ts{handler}

On Lambda, the answer is "are there still more than 60 seconds until the function's timeout?" `getRemainingTimeInMillis()` is a function on the context Lambda passes to the handler; it returns the time left before the function is stopped. The function's timeout is 300 seconds, so one invocation writes about four minutes' worth of pages and returns.

<<< @/examples/16-long-jobs/src/env.ts{env}

Consider the two extremes.

**Return after every page.** A failure costs one page of rework. In exchange, the workflow is passed through once per page. A Standard workflow is billed per state transition, so more pages mean a larger bill. There is a limit too: one execution of a Standard workflow fails when its history reaches 25,000 events, and every turn of the loop adds a few.

**Everything in one go.** The fewest state transitions. But for work that does not finish in 15 minutes, it is not on offer.

This chapter sits in between: go as far as time allows, and return with room to spare. While there are few notes it finishes in one call, and as they grow it splits into two calls, then three, by itself.

This is where the design of the earlier sections pays off. A part is written to S3 after every page, and a written part can be passed over. So **a coarse workflow checkpoint does not mean more rework.** If the function dies four minutes in, the retry walks past the written parts, checking each with a 412, and writes on from there. The `Scan` is read again; nothing is written again.

So there are two layers of checkpoint. The progress the workflow remembers is a hint about where to call from, and the parts in S3 are the fact of what is done. When the hint is stale, the fact still leads to the right result. A test checks that returning after every page and writing everything in one call produce output that does not differ by a byte.

Work whose loop is long enough to approach the history limit needs something else. The documentation names two options: a Distributed Map, or starting a new execution partway and handing over the rest. This chapter tries neither.

## Running it locally

<!-- section: 16.local -->

```bash
vp run export:local
vp run export:local --notes 450 --lose 2 --break 4
```

The first line exports 250 notes held in memory, using the same definition that gets deployed. The second breaks two things on purpose. `--lose 2` drops the answer of the second call of `ExportPages`: the work is done, and to the workflow it looks like a timeout. `--break 4` refuses the write of the fourth part four times in a row, so the retries run out and the execution fails. Then the run is resumed from the failed state, and it ends by checking that the manifest's line count and the number of distinct notes match.

No Docker and no AWS credentials are needed.

### Walking the definition as it is

<<< @/examples/16-long-jobs/src/local-workflow.ts{run}

<<< @/examples/16-long-jobs/src/local-workflow.ts{task}

What stands in for Step Functions is a function of about a hundred lines. Of ASL it knows only what this chapter uses: `Task` with `Retry` and `Catch`, a `Choice` on one boolean, `Succeed`, `Fail`. Nothing more.

It exists so that the wiring of the definition can be tested. Getting the order of the retriers wrong so that `ExportCorrupt` is retried three times, or pointing a `Catch` at the wrong state: no amount of careful testing of the step functions finds mistakes like those.

<<< @/examples/16-long-jobs/src/local.ts{local}

What gets called is what the Lambda handlers do, minus Lambda: pass the input through a schema and call the step function.

On this runner, the tests check that:

- a step whose answer was lost is retried, and no part is written twice
- when the retries run out the execution fails, the parts remain, and it can be resumed from the failed state
- starting over from the beginning after a failure produces the same export
- with a part missing, `Finish` is tried once, `Discard` runs, and the execution ends as `ExportDiscarded`
- `Discard` too is retried when it fails

This is not an emulation of Step Functions. Here is what it does not reproduce.

- Waiting. Retry intervals, `TimeoutSeconds`, and the timeout of the whole execution are all ignored. A timeout is represented by a test throwing "an error named timeout"
- Persisted state. The runner is a loop in one process, and everything is gone if it dies
- The rest of ASL: JSONPath, `Parameters`, `Map`, `Parallel`, `Wait`, JSONata. Writing them in the definition does nothing here
- The 256 KiB limit on input and output, and the 25,000-event limit on history
- The real shape of input and output when a function ARN is written in `Resource`
- IAM, Scheduler, S3, DynamoDB

### Tests

```bash
vp run test:unit
```

The tests of the durable-function variant run here too. They use the runner that comes with the SDK.

## Getting ready for AWS

<!-- section: 16.infra -->

### The bucket

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{bucket}

Everyone's notes go into this bucket. All four public access settings are closed, and connections over HTTP are refused. Only what IAM allows can read it. This chapter does not build the part that hands an export to a user. For that, the presigned URLs of [chapter 07](/en/chapters/07-uploads.md) would do.

### Three functions, three roles

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{steps}

The three could be one function that branches on its input. They are separate so that the permissions are separate.

- `ExportPages` can `Scan` the table and write parts. It cannot delete
- `Finish` can list and write the manifest. It cannot read the table
- `Discard` can list and delete. It cannot write, and cannot read the table either

Only one function can read notes, and only one can delete objects. That `s3:PutObject` alone covers the `If-None-Match` check is stated in the S3 documentation. The `s3:GetObject` on `ExportPages` is for the `HeadObject` that reads the metadata after a 412.

### The state machine

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{state-machine}

A state machine has an execution role too: the role Step Functions uses to call functions on your behalf. All it can do is invoke the three functions. The conditions that narrow who may assume it (a state machine in this account and Region) have the same form as the example in the documentation.

The definition is passed as one string made with `toJsonString`. The function ARNs are not known until deployment, so in the template it becomes an `Fn::Join`.

CloudFormation also has a property, `DefinitionSubstitutions`, that replaces `${Name}` inside a definition. This chapter does not use it. Reading the source of the pinned cdkd (0.296.28) shows that this substitution is applied only to a definition fetched from S3. It has no effect on a definition written in the template. A test fixes that the property is absent from the template.

### The schedule

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{schedule}

Chapter 08's schedule called a Lambda function. This one targets a state machine: Scheduler calls Step Functions' `StartExecution`. The role needs `states:StartExecution`, on this one state machine.

The `<aws.scheduler.scheduled-time>` in `input` is a marker that Scheduler replaces with the time that firing was due, in a form like `2026-10-12T03:00:00Z`. That is where the export's ID comes from.

Starting an execution with a name would let Step Functions refuse a duplicate start: `StartExecution` with the same name and the same input returns the running execution. This chapter does not use that, because this kind of target has no place to give Scheduler a name for the execution. Another kind (a universal target) looks as if it could carry one, but the `:` in the time is not allowed in an execution name. That was not tried, so it stops here. That a duplicate start does no harm is handled on the steps' side.

### What the tests look at

- The stack uses exactly nine resource types, and none begins with `Custom::`
- There is no durable function by default: three functions, none with `DurableConfig`, no version, no alias
- All four public access settings of the bucket are closed, and everything under `exports/` expires after 7 days
- The actions of the three functions' roles are exactly the ones listed above
- Object operations are limited to `exports/`, the listing carries a prefix condition, and there is no bare `*` anywhere
- The state machine's role can invoke the three functions and nothing else
- The deployed definition has the same states as the one run locally, and its `Task` states point at the three functions
- Every `Task`'s timeout is longer than the timeout of the function it points at
- The schedule's input, interval, and role

The pinned cdkd has a dedicated provider for all nine types (`AWS::DynamoDB::Table`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::Scheduler::Schedule`, `AWS::StepFunctions::StateMachine`). That was checked in the installed package.

## Deploying and checking

<!-- section: 16.deploy -->

From here on, nothing was run. The steps and the tasks are prepared, and that is all.

```bash
vp run export:infra:diff
vp run export:infra:deploy
vp run export:seed --notes 250
vp run export:start --id check-1 --wait
vp run export:status
```

`export:seed` writes notes to the table through chapter 05's repository. `export:start` starts one export without waiting for the schedule; with `--wait` it looks at the status every 5 seconds until the end. `export:status` lists recent executions and the exports in the bucket: whether there is a manifest, how many parts, how many history events.

Running `export:start` again with the same ID should be refused with `ExecutionAlreadyExists`, because this task does start the execution with a name.

To resume a failed execution, pass the ARN that `export:status` prints.

```bash
vp run export:status --redrive <execution ARN>
vp run export:logs --function pages
```

The schedule fires for the first time as soon as it is created. As in chapter 08, the documentation says a rate schedule without a start date behaves that way. Right after a deploy there is one export you did not ask for.

The drift check is the same as before.

```bash
vp run export:infra:drift
```

## The same thing as a durable function

<!-- section: 16.durable -->

The workflow so far was JSON. The loop was a `Choice`, the variables were state input and output, and try and catch were `Retry` and `Catch`. Many readers will have thought: if only this were ordinary code.

Lambda durable functions are the feature for that. Within what the documentation confirms, let's rewrite the same export.

<<< @/examples/16-long-jobs/src/durable-export.ts{durable}

The `while` is the loop, and the `try` and `catch` are the compensation. The step functions (`exportPages`, `finishExport`, `discardExport`) are the ones the Step Functions version uses, without a character changed.

### From the top, again

The first thing that catches the eye is this: how can a `while` inside a function that is stopped after 15 minutes resume where it left off?

```figure
caption: The second invocation runs from the first line again, and a step that has a checkpoint is not run but returns its stored result
type: sequence
actor lambda: Lambda | checkpoint
actor handler: handler
actor s3: S3
note lambda: invocation 1
step lambda -> handler: the handler starts
step handler -> handler: pages-from-1 runs
step handler -> lambda: its result is checkpointed
step handler -> handler: pages-from-21 runs
step handler -x lambda: the sandbox dies before the checkpoint
note lambda: invocation 2
step lambda -> handler: starts again from its first line
step lambda --> handler: pages-from-1 does not run: stored result
step handler -> handler: pages-from-21 runs again
step handler -x s3: parts already in S3, nothing written twice
step handler -> handler: pages-from-41 … finish run
step handler -> lambda: each result is checkpointed
```

The answer is that it does not. The function runs again from its first line. But work wrapped in `context.step` is not run if its result has been saved; the saved result is returned. This is replay: the code runs from the top, and only the finished steps are fast-forwarded.

Two rules follow.

**Outside the steps, the code must do the same thing every time.** On every replay, all the code outside the steps runs again. Reading the clock or drawing a random number there sends the second run down a different path from the first. In this code, what is outside the steps is the validation of the input, the `while` condition, and the building of the step names. All of them follow from saved results.

**Inside the steps, the code must still be idempotent.** The documentation describes a step's default as at-least-once: a step that is interrupted before it completes runs again on replay. That is `pages-from-21` in the diagram. This chapter's steps, as built in the first half, leave the same parts however often they run. Making it a durable function does not make that work unnecessary.

The SDK also has a setting that makes a step "at most once". The documentation is careful about it, though: it is "at most once per retry". Unless retries are turned off, it is not once for the step as a whole. A good example of why not to read a guarantee off a name.

### How it differs from Step Functions

| | Step Functions (Standard) | Lambda durable functions |
| --- | --- | --- |
| Where the workflow is written | ASL (JSON) | The function's code |
| Who holds the progress | Step Functions | Lambda |
| Limit on one step | Depends on what is called; 15 minutes for Lambda | 15 minutes per invocation |
| Limit on the whole | One year, 25,000 history events | One year, 3,000 durable operations, 100 MB stored |
| Separating permissions | A function and a role per step, if you like | One function, one role |
| Calling things other than Lambda | Many services directly from the definition | Through the SDK, from code |
| Billing | State transitions | Durable operations, data written, data retained |

For this chapter's job, the difference that mattered most was row five. In the Step Functions version, the function that can read notes and the function that can delete objects were separate. In the durable-function version, one role holds both.

AWS's own guidance goes like this: durable functions when the logic is mostly inside Lambda and you want to write it as code; Step Functions when it spans many services or the flow should be shown as a diagram. It also recommends using both together.

### If you deploy it

<<< @/examples/16-long-jobs/infra/bin/app.ts{context}

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{durable}

The durable-function variant is not in the default stack. Only with `-c durable=true` does one more function appear.

```bash
vp run export:infra:deploy -c durable=true
vp run export:durable:start --id check-1
```

Three things differ from an ordinary function.

`durableConfig` turns durable execution on. `executionTimeout` limits the whole execution and `timeout` limits one invocation; they are separate settings. Adding it to a function that already exists means the function is created anew. CDK tells you so at synth.

The execution role needs two permissions for reading and writing checkpoints. The way to write their resource has a quirk. Lambda checks both against the ARN of the execution, and an execution's ARN continues on from a function ARN with a version in it. So the bare function ARN does not match. Add `:*`.

When invoking, add a version or an alias. The bare function name is refused. An execution is pinned to the version that started it. An execution started on `$LATEST` is replayed with new code if the code is replaced on the way. If the steps' names or order have changed, they no longer match the saved results.

The pinned cdkd has no dedicated provider for `Lambda::Version` and `Lambda::Alias`, so they go through Cloud Control API, as in [chapter 20](/en/chapters/20-shipping.md).

To be honest, less of this is confirmed than of the Step Functions version. Locally, the code ran on the runner that comes with the SDK (`LocalDurableTestRunner`), as far as seeing that a step redone after a failure adds no parts. That it is available in the Tokyo Region is only inferred from the Price List carrying Tokyo prices. No list of supported Regions was found in the documentation.

### Not the same thing as Durable Objects

If you come from Cloudflare, the names will confuse you. Lambda durable functions and Cloudflare's Durable Objects have similar names and are different things.

A Durable Object is an object of which exactly one exists per ID. Each has storage of its own and runs on a single thread. It is a building block for handling the state of one ID, "this room" or "this user", in one place and in order. [Chapter 14](/en/chapters/14-kv-cache.md) met it as a place to keep a rate limit.

Lambda durable functions are a mechanism that saves how far one piece of work has got. They do not hold state per ID over time. When an execution ends, what is left is its history, and that goes too once the retention period is over.

What is close on Cloudflare's side is Workflows. You wrap steps in `step.do`, their results are saved, and failures are retried. The cautions in the documentation are much alike as well: a step may be retried several times, so make it idempotent; a workflow can hibernate and lose in-memory state, so build state from what steps return; random numbers and the clock belong inside steps.

There are differences. One step of a Workflow has no limit on elapsed time (it does on CPU time). On Lambda, even a durable function gets 15 minutes per invocation. The limit on the number of steps is 10,000 by default on Workflows' paid plan and 3,000 for durable functions. Workflows' delivery guarantee, and what happens on an attempt to create an instance with an ID that already exists, could not be confirmed from the pages read.

## Steps that do not fit in Lambda

<!-- section: 16.containers -->

So far the work could be split into pieces shorter than 15 minutes. Some work cannot: transcoding one video, compressing one large file. Stop it halfway and it starts over. Some work needs more than 10 GB of memory, or a tool that does not fit in Lambda.

Steps like that run in a container. This chapter only describes them. No code was written.

**An ECS task.** Chapter 12's service kept "always N" tasks running. A task can also be run once, to disappear when it is done. From Step Functions, the `Resource` of a `Task` becomes `arn:aws:states:::ecs:runTask.sync`. With `.sync`, Step Functions waits for the task to end before moving to the next state. Lambda's 15 minutes do not apply here. On Fargate, you are billed for vCPU and memory for the seconds it ran.

Three things change. A task returns no value: it writes its progress to S3 or DynamoDB itself, and the next state reads it. Input is passed as the container's environment variables or arguments. And an image is needed. Chapter 12's rules (immutable tags, no `fromAsset`, nothing billed by the hour without an image tag) apply as they are.

The idempotency story does not change. Tasks are retried too, and can keep running after Step Functions has given up. The documentation says that when a `.sync` task is aborted, it may not be possible to stop it, and charges can continue.

**AWS Batch.** A service that puts container jobs on a queue and runs them in order, provisioning as much compute as they need. Underneath is ECS (or EKS), and Fargate can be used. For one long step, an ECS task is enough. Batch pays off when there are thousands of jobs and you want priorities, or to run them cheaply on Spot instances. From Step Functions it is called with `arn:aws:states:::batch:submitJob.sync`.

One line each on how to choose:

| The work | The tool |
| --- | --- |
| Splits into pieces under 15 minutes, with steps that can be Lambda functions | Step Functions and Lambda (this chapter), or durable functions |
| Does not split, but can run one at a time | An ECS task from Step Functions |
| Jobs that do not split, in large numbers, needing a queue and managed compute | AWS Batch |
| Always done within five minutes, in very large numbers | An Express workflow |

## What it costs

<!-- section: 16.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The inputs and unit prices are in [the pricing reference](/en/reference/pricing.md).

The new unit price is the state transition of a Standard workflow: USD 0.000025 each, 2.5 cents per thousand. The first 4,000 a month are free, and according to the pricing page that allowance does not expire. Retries and redrives count as state transitions.

Take a month with 10,000 notes of 1 KB in the table, exported once a day.

| Setup | List price | After free allowances |
| --- | --- | --- |
| No notes at all (just deployed) | 0.00 | 0.00 |
| This chapter's default (every page in one invocation) | 0.03 | 0.02 |
| Returning to the workflow after every page | 0.18 | 0.07 |
| The durable-function variant | 0.03 | 0.02 |
| For comparison: a one-hour step, daily, as a Fargate task | 0.52 | 0.52 |

They are all small numbers. An export of this size runs for next to nothing. What to look at is the gap between rows two and three.

The same work and the same output, and the list price differs six times over. The only difference is the number of state transitions. The default setup makes 6 per execution, 180 a month. Returning after every page makes 204 per execution, 6,120 a month, which is over the 4,000 of the free allowance. The size of a checkpoint is a pricing setting too. With a hundred times the notes, row three's state transitions grow a hundredfold, and before that the 25,000-event history limit is reached.

The number of state transitions is an estimate that follows the way the pricing page's example counts. That example counts four for a workflow of two states: the start and the end count as one each. It was not checked against a real bill.

### The price of waiting

Long work comes with waiting: for a person's approval, for an outside service to finish, until tomorrow. What is billed while waiting differs from tool to tool.

- **A Standard workflow.** Only state transitions are billed. Whether a `Wait` state waits a day or a month, the number of transitions before and after is the same
- **An Express workflow.** Duration and memory are billed, so waiting costs that much. And five minutes is the limit anyway
- **Waiting inside a Lambda function.** While a `setTimeout` waits, the function is running. The seconds waited are billed as they are
- **A wait in a durable function.** The function is suspended, and no duration is billed while it waits. What is billed is retention, by the amount of checkpoint data kept
- **Waiting inside a Fargate task.** While the task runs, vCPU and memory are billed even if it does nothing

Put work that waits in a tool that holds no compute while it waits. That is the principle.

The unit prices of durable functions in Tokyo are USD 0.0000106 per operation, 0.33 per GB written, and 0.20 per GB-month retained. No free allowance was found on the pricing page. Row four of the table counts 7 operations per execution.

Deleting the stack removes the state machine, the functions, and the schedule, and this chapter's charges stop.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| The deploy fails creating the state machine, saying it cannot assume the role | Do the conditions in the role's trust policy (`aws:SourceArn`) match the form of the state machine's ARN? See also "Not checked yet" at the end of the chapter |
| An execution fails at `ExportPages` with `States.Runtime` or `States.DataLimitExceeded` | `States.ALL` does not retry these two. Is the function returning more than 256 KiB? |
| The `ExportPages` log has a 403, and the step fails after three retries | Does the role have `s3:PutObject` and `s3:GetObject`? The `HeadObject` after a 412 is authorized by `s3:GetObject` |
| An execution succeeds, but the number of notes does not match the table | A note written or deleted during the export may be in it or not. A `Scan` is not a copy as of one instant |
| An execution ends as `ExportDiscarded` | A part disappeared before the manifest was written: someone cleaned the bucket by hand, it took longer than 7 days, or another execution of the same export got as far as `Discard` |
| `export:start` says `ExecutionAlreadyExists` | That ID has been started already. Change `--id`. A name cannot be reused for 90 days after the execution closes |
| A redrive fails again right away | Was the cause fixed? An execution that reached `Discarded` only re-enters the `Fail` state on a redrive |
| An execution stays `RUNNING` forever | Do the `Task` states have `TimeoutSeconds`? This chapter's definition also cuts the whole thing off at six hours |
| The durable function fails for lack of checkpoint permissions | Is the role's resource `function:<name>:*`? A function ARN without `:*` does not match an execution's ARN |
| Invoking the durable function says a qualifier is required | Is it invoked with an alias or a version? `export:durable:start` uses the alias's ARN |

## Before production

- **Make failures noticeable.** This chapter's workflow tells nobody when it fails. Step Functions sends an event to EventBridge when an execution's status changes. Connect that to a notification, or put an alarm on the number of failed executions ([chapter 19](/en/chapters/19-observability.md))
- **Build the way out for an export.** An API that reads the manifest and the parts and hands them to a user. To split by owner, write parts under a prefix per owner, or filter when handing over. This chapter's export mixes everyone's notes in one file
- **Decide on consistency.** If "every note as of the start" is needed, a `Scan` is not enough. DynamoDB has a feature that writes a table out to S3 (export to S3), which can take the state as of a point in time for a table with point-in-time recovery enabled. It was not tried in this chapter
- **Close the gap between `Finish` and `Discard`.** Start executions with a name so that two of the same export do not overlap. Or change `Discard` from "delete" to "write a marker that it was discarded"
- **Keep the state machine's logs.** This chapter leaves the execution history to Step Functions, where it is gone after 90 days. There is a setting that sends it to CloudWatch Logs (`LoggingConfiguration`), which this chapter does not turn on
- **Watch the history limit.** How does the event count that `export:status` shows compare with 25,000? If it gets close, go further per invocation, or split the execution
- **Keep the bucket and the table from being deleted.** Both are `RemovalPolicy.DESTROY`. A table with real notes in it should be `RETAIN`
- **If you use durable functions, decide how versions are handled.** Do not change the names or the order of steps while executions are running. If you must, ship it as a new version and wait for the old executions to end

## Cleaning up

<!-- section: 16.cleanup -->

```bash
vp run export:empty --yes
vp run export:infra:destroy
```

Empty the bucket first: the pinned cdkd does not delete a bucket that has objects in it. Without `--yes`, `export:empty` only counts.

`export:infra:destroy` removes the state machine, the three functions, the schedule, the bucket, and the table. An execution that is still running goes with the state machine. If you deployed with `-c durable=true`, pass the same option when destroying.

What remains is the storage that cdkd's bootstrap created ([chapter 02](/en/chapters/02-toolchain.md)) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** Step tests (the same step a second time, the table changing after a lost answer, a failed write in the middle of a call, a failed read, a stalled worker writing late, two runs of the same export overlapping, the same output whatever the checkpoint size, an empty table). Manifest and compensation tests (a missing part, `Finish` before the last page, `Finish` twice, a `Discard` that stopped halfway run again, never deleting a finished export). Input validation (the ID from the time, an ID that would leave the prefix, damaged progress). Tests that run the workflow definition on the local runner (a lost answer, retries running out and a resume, a restart from the beginning, `ExportCorrupt` going to `Discard` without a retry, a retried `Discard`, every target in the definition existing). The requests sent to S3 and DynamoDB, and the handling of 412, 409, 404, and 403. Tests that run the durable-function variant on the SDK's `LocalDurableTestRunner` (where the steps fall, a failed step redone). Infrastructure assertions (the default and `-c durable=true`). Type checks, and synth of both layouts. Two conditions were also broken on purpose, and each made two tests fail. `export:local` was run three ways: the default, `--notes 450 --lose 2 --break 4`, and `--notes 1000 --pages-per-call 20`.

**Not checked yet.** Nothing has been run against AWS. None of `export:infra:diff`, `export:infra:deploy`, `export:seed`, `export:start`, `export:status`, `export:logs`, `export:infra:drift`, `export:empty`, `export:infra:destroy`, or `export:durable:start`. So the following are unconfirmed on the real service. That cdkd creates the state machine from a `DefinitionString` assembled with `Fn::Join`. That the conditions in the trust policy of the state machine's role are accepted. That Scheduler calls `StartExecution` with `<aws.scheduler.scheduled-time>` replaced in the input, and whether the execution then gets a name. The shape of input and output of a `Task` whose `Resource` is a function ARN. That the `name` of a Lambda exception matches the `ExportCorrupt` catcher. That S3 answers 412 to `If-None-Match: *` and the pinned SDK throws it as an exception with status 412. That `HeadObject` returns metadata keys in lower case. Whether the function keeps running after a `Task` times out. The real numbers of state transitions and history events. How a redrive behaves. The read units of the `Scan` and the functions' run times (the 200 ms and 20 s in the cost example are assumptions). For the durable function: that it is available in the Tokyo Region, that cdkd creates a function with `DurableConfig` and the version and alias, that the role's permissions are enough, that the bundled SDK runs on Lambda, that `DurableExecutionName` prevents a duplicate start, what happens when one invocation hits the function timeout, and the real number of durable operations. ECS tasks and AWS Batch are described only; there is no code. Express workflows were only read about. Cloudflare Workflows too was only read about, not run.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`, `src/workflow.ts` | - |
| Splitting the work | `examples/16-long-jobs/src/job.ts`, `src/note-source.ts`, `src/dynamodb-note-source.ts`, `test/adapters.test.ts` | `test:unit` |
| A step runs twice | `examples/16-long-jobs/src/steps.ts`, `src/export-store.ts`, `src/s3-export-store.ts`, `test/steps.test.ts`, `test/harness.ts`, `test/adapters.test.ts` | `test:unit` |
| The last file makes it visible | `examples/16-long-jobs/src/steps.ts`, `src/job.ts`, `test/steps.test.ts` | `test:unit` |
| Leave the order to the workflow | `examples/16-long-jobs/src/workflow.ts`, `test/workflow.test.ts` | `test:unit` |
| How big a checkpoint | `examples/16-long-jobs/src/steps.ts`, `src/export-pages-lambda.ts`, `src/env.ts`, `test/steps.test.ts` | `test:unit` |
| Running it locally | `examples/16-long-jobs/src/local-workflow.ts`, `src/local.ts`, `scripts/run-local.ts`, `test/workflow.test.ts` | `export:local`, `test:unit` |
| Getting ready for AWS | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`, `infra/bin/app.ts`, `infra/test/long-jobs-stack.test.ts`, `src/finish-lambda.ts`, `src/discard-lambda.ts`, `cdk.json` | `export:infra:synth`, `test:unit` |
| Deploying and checking | `examples/16-long-jobs/scripts/seed.ts`, `scripts/start.ts`, `scripts/status.ts`, `scripts/logs.ts` | `export:infra:diff`, `export:infra:deploy`, `export:seed`, `export:start`, `export:status`, `export:logs`, `export:infra:drift` |
| The same thing as a durable function | `examples/16-long-jobs/src/durable-export.ts`, `src/durable-lambda.ts`, `test/durable.test.ts`, `scripts/durable-start.ts`, `infra/lib/long-jobs-stack.ts` | `test:unit`, `export:durable:start` |
| Steps that do not fit in Lambda | (no code) | - |
| What it costs | `data/pricing/` | `test:unit` |
| Cleaning up | `examples/16-long-jobs/scripts/empty.ts` | `export:empty`, `export:infra:destroy` |

**Primary sources** (all checked on 2026-10-12)

- Step Functions: [Choosing workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html), [Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html), [Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html), [Invoke an AWS Lambda function](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html), [Handling error conditions (tutorial)](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-handling-error-conditions.html), [ResultPath](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html), [Redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html), [Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html), [Best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html), [Creating an IAM role for your state machine](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html), [Run Amazon ECS or Fargate tasks](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html), [Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html), [Event delivery with EventBridge](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html), [StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html), [AWS::StepFunctions::StateMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html)
- Lambda durable functions: [Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html), [Basic concepts](https://docs.aws.amazon.com/lambda/latest/dg/durable-basic-concepts.html), [Idempotency](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html), [Invoking](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html), [Security and permissions](https://docs.aws.amazon.com/lambda/latest/dg/durable-security.html), [Infrastructure as Code](https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html), [Supported runtimes](https://docs.aws.amazon.com/lambda/latest/dg/durable-supported-runtimes.html), [Durable execution SDK (metering)](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html), [Durable functions or Step Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-step-functions.html), [Best practices](https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html)
- AWS Durable Execution SDK Developer Guide: [Key concepts](https://docs.aws.amazon.com/durable-execution/getting-started/key-concepts/), [Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/). [@aws/durable-execution-sdk-js 2.6.0](https://www.npmjs.com/package/@aws/durable-execution-sdk-js/v/2.6.0) (README and type definitions)
- Lambda: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [The Node.js context object](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html)
- EventBridge Scheduler: [Adding context attributes](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html), [Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html), [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
- S3 and DynamoDB: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html), [Scanning tables in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html), [DynamoDB data export to Amazon S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html)
- AWS Batch: [What is AWS Batch?](https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html), [Fargate compute environments](https://docs.aws.amazon.com/batch/latest/userguide/fargate.html)
- Pricing: [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/), [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/), AWS Price List bulk API: [Step Functions](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json), [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- Cloudflare: [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [Workflows](https://developers.cloudflare.com/workflows/), [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), [Workflows: Limits](https://developers.cloudflare.com/workflows/reference/limits/), [Workflows: Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [register-providers.ts of cdkd v0.296.28](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) (checked in the dist of the installed package), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
