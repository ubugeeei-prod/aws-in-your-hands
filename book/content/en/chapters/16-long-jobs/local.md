---
title: "16 Workflow: Run It Locally"
---

# 16 Workflow: Run It Locally

This page runs the workflow definition from [the previous page](/en/chapters/16-long-jobs/build.md) on your machine before it goes to AWS.

## Running it locally

<!-- section: 16.local -->

```bash
vp run export:local
vp run export:local --notes 450 --lose 2 --break 4
```

The first line exports 250 notes held in memory, using the same definition that gets deployed. The second breaks two things on purpose. `--lose 2` drops the answer of the second call of `ExportPages`, so the work is done but to the workflow it looks like a timeout. `--break 4` refuses the write of the fourth part four times in a row, so the retries run out and the execution fails. The run is then resumed from the failed state, and it ends by checking that the manifest's line count matches the number of distinct notes.

You need neither Docker nor AWS credentials.

### Walking the definition as it is

<<< @/examples/16-long-jobs/src/local-workflow.ts{run}

<<< @/examples/16-long-jobs/src/local-workflow.ts{task}

A function of about a hundred lines stands in for Step Functions. It handles only the parts of ASL that this chapter uses, which are `Task` with `Retry` and `Catch`, a `Choice` on one boolean, `Succeed`, and `Fail`.

The runner exists so that the wiring of the definition can be tested. A wrong order of retriers that lets `ExportCorrupt` be retried three times, or a `Catch` that points at the wrong state, is the kind of mistake that no amount of careful testing of the step functions will find.

<<< @/examples/16-long-jobs/src/local.ts{local}

What the runner calls is what the Lambda handlers do, minus Lambda. It passes the input through a schema and calls the step function.

On this runner, the tests check that:

- a step whose answer was lost is retried, and no part is written twice
- when the retries run out the execution fails, the parts remain, and it can be resumed from the failed state
- starting over from the beginning after a failure produces the same export
- with a part missing, `Finish` is tried once, `Discard` runs, and the execution ends as `ExportDiscarded`
- `Discard` too is retried when it fails

The runner is not an emulation of Step Functions. Here is what it does not reproduce.

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

The tests of the durable-function version run in this task too. They use the runner that comes with the SDK.
