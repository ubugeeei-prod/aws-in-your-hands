---
title: "16 Workflow: Design and Build"
---

# 16 Workflow: Design and Build

[The previous page](/en/chapters/16-long-jobs.md) built an `ExportPages` that leaves the same parts however often it runs. This page adds the step that finishes an export and the step that discards one, and connects all three with a state machine.

## The last file makes it visible

<!-- section: 16.manifest -->

Until all the parts are there, the bucket holds a half-written export. Anyone who read it at that point would take incomplete data for the finished thing.

<<< @/examples/16-long-jobs/src/steps.ts{finish}

So there is one agreement with whoever reads an export. **An export without a manifest does not exist.** The manifest is a small file that lists the keys of the parts. A reader reads the manifest first, and then only the parts it names. A reader must not list the prefix and read whatever it finds.

Before it writes the manifest, `Finish` lists the parts to check that all of them are there, because it must not write the name of a part that is missing. The manifest also has no timestamp in it, so if two executions finish the same export, the bytes they try to write are identical. The first one wins, and the other gets a 412 and returns the same result.

### Undo only when you cannot go on

What the workflow does when a part is missing is this chapter's compensation.

When a database transaction fails halfway, a rollback makes it as if nothing had happened. A workflow has no such mechanism. What step 1 wrote to S3 stays there when step 3 fails. If you want it undone, you write the step that undoes it yourself, and that step is called a compensation.

<<< @/examples/16-long-jobs/src/steps.ts{discard}

A compensation is in a harder position than an ordinary step, because it is called when something is already broken and it can stop halfway itself. This one follows three rules.

- It can be called any number of times. Deleting what is already gone is not an error, and if it stops halfway, calling it again deletes the rest
- It does not touch what is finished. An export that has a manifest is not deleted, in case the verdict that it failed was out of date
- Operations that cannot be undone go as late in the workflow as possible. An S3 object can be deleted, but an email that was sent cannot

The workflow also calls the compensation as rarely as it can. When `ExportPages` fails, this workflow does not delete the parts, because the parts already written are where the next resume starts. It deletes them only when `Finish` finds that a part is missing, since no retry brings a missing part back.

**If you can go forward, resume. Undo only when you cannot.** For long work, draw this line first. A workflow that undoes everything on every failure has given up the ability to resume.

Parts that are neither resumed nor undone are deleted after 7 days by the bucket's lifecycle rule. Finished exports are deleted after the same 7 days. An export is treated as a temporary place for someone to pick up from.

One gap is left open. In `Finish`, checking the list and writing the manifest are two separate operations. If another execution's `Discard` deletes a part between them, the result is a manifest that names a deleted part. This needs two overlapping executions of the same export, of which only one decides that a part is missing, but it can happen. This chapter does not close the gap.

## Leave the order to the workflow

<!-- section: 16.workflow -->

With the steps ready, the next job is to connect them. A Step Functions workflow is called a state machine, and it is written in Amazon States Language (ASL), which is JSON.

<<< @/examples/16-long-jobs/src/workflow.ts{definition}

This chapter writes the definition as a TypeScript object. CDK has constructs for state machines, but they are not used here, because the same object has to go to both [the local runner](/en/chapters/16-long-jobs/local.md) and CDK.

There are six states. A `Task` calls a function, a `Choice` picks the next state, and `Succeed` and `Fail` are the ends.

The `Resource` of each `Task` is the function's ARN, written directly. Written this way, the state's input becomes the function's event unchanged, and the function's return value becomes the state's output unchanged. The progress that `ExportPages` returns goes through `MorePages` and becomes the input of the next `ExportPages`. That hand-over is all the loop needs.

### Retry and Catch

`Retry` runs the same state again with the same input. `ExportPages` is retried up to three times on any error, starting 5 seconds apart and doubling. `States.ALL` is a name that matches almost every error, including an exception in the function, a transient Lambda fault, and a timeout.

Only `Finish` has two retriers. `ExportCorrupt` gets zero attempts, which means no retry, and everything else gets up to three. `ExportCorrupt` is the `name` of the exception the function throws, and an error thrown by a Lambda function reaches Step Functions under its `name`.

`Catch` sends the execution to a state you name when the retries are used up, instead of failing it. With `ResultPath`, the original input is kept and the error is added beside it. `Discard` reads the export's ID from the input that was kept.

The only `Catch` is on `Finish`, for `ExportCorrupt`. Every other failure is caught by nothing, and the execution itself fails. That is deliberate, and redrive is the reason.

### A failed execution continues

A failed execution of a Standard workflow can be redriven for 14 days. A redrive runs the failed state again with the input it had, and does not run the states that succeeded.

Say `ExportPages` fails four times in a row and the execution stops. After you fix the cause, such as wrong permissions, a redrive calls `ExportPages` again with the progress it had when it stopped. If parts 1 to 30 were written, it goes on from 31. To be exact, any parts the stopped call had already written are passed over through 412s as well.

Had the failure of `ExportPages` been caught and sent to a `Fail` state, a redrive would not help. According to the documentation, a redrive re-enters the `Fail` state and fails again. In this workflow too, an execution that got to `Discarded` cannot be resumed. The export has been discarded by then, so that is the right behaviour.

### Standard and Express

A state machine is one of two types, and the type cannot be changed after creation.

| | Standard | Express |
| --- | --- | --- |
| Longest run | One year | Five minutes |
| State | Persisted between states | Not persisted |
| Execution guarantee | Exactly-once (apart from `Retry`) | At-least-once when asynchronous |
| Billing | Number of state transitions | Number of executions, duration, memory |
| Redrive of a failed execution | Yes | Not confirmed |

This chapter uses Standard, because nothing guarantees that the export ends in five minutes and it has to resume from the middle.

### Always write the timeout

A `Task`'s `TimeoutSeconds` is 99,999,999 seconds when left out, which is more than three years. A task whose answer never comes would leave the execution stuck at that state. The official best practices also recommend giving tasks a timeout.

In this chapter, each `Task`'s timeout is 30 seconds longer than its function's timeout. Lambda stops the function first and returns an error, and Step Functions receives that error and retries. With that order, you do not normally end up with Step Functions having given up while the function is still running.

"Normally" is there because it cannot be ruled out. The documentation says a task that timed out is treated as failed, but it does not say the running function is stopped. An answer can also be lost on the network, and two executions of the same export can overlap. The `If-None-Match` on [the previous page](/en/chapters/16-long-jobs.md) is there for those cases. The timeout settings only make late workers rarer. The condition on the write is what keeps a late worker from damaging the output.

## How big a checkpoint

<!-- section: 16.checkpoint -->

Saving "how far it got" is called a checkpoint. This workflow makes one every time `ExportPages` returns, so how often `ExportPages` returns is the granularity of the checkpoints.

<<< @/examples/16-long-jobs/src/steps.ts{budget}

After every page it writes, the step function asks its caller whether it may go on to one more page. Who answers that question decides the granularity.

<<< @/examples/16-long-jobs/src/export-pages-lambda.ts{handler}

On Lambda, the answer is yes while more than 60 seconds remain before the function's timeout. `getRemainingTimeInMillis()` is a function on the `context` that Lambda passes to the handler, and it returns the time left before the function is stopped. The function's timeout is 300 seconds, so one invocation writes about four minutes' worth of pages and returns.

<<< @/examples/16-long-jobs/src/env.ts{env}

Compare the two extremes.

If the step returns after every page, a failure costs one page of rework. In exchange, the workflow is passed through once per page. A Standard workflow is billed per state transition, so more pages mean a larger bill. There is a limit as well. One execution of a Standard workflow fails when its history reaches 25,000 events, and every turn of the loop adds a few events.

If the step writes everything in one invocation, the number of state transitions is the smallest possible. But for work that does not finish in 15 minutes, that option does not exist.

This chapter sits in between. The step goes as far as time allows and returns with room to spare. While there are few notes it finishes in one call, and as they grow the work splits into two calls, then three.

The design on the previous page is what makes a coarse granularity affordable. A part is written to S3 after every page, and a written part can be passed over. So **a coarse workflow checkpoint does not mean more rework.** If the function dies four minutes in, the retry walks past the written parts, confirming each with a 412, and writes on from there. The `Scan` runs again, but nothing is written again.

There are, in other words, two layers of checkpoint. The progress the workflow remembers is a hint about where to call from, and the parts in S3 are the fact of what is done. When the hint is stale, the step follows the fact and still arrives at the right result. A test checks that returning after every page and writing everything in one call produce output that does not differ by a byte.

Work whose loop is long enough to approach the history limit needs something else. The documentation names two options, a Distributed Map or starting a new execution partway and handing over the rest. This chapter tries neither.
