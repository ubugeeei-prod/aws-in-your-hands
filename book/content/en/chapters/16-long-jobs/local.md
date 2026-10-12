---
title: "16 Workflow: Run It Locally"
---

# 16 Workflow: Run It Locally

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
