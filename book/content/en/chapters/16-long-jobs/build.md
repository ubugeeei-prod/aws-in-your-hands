---
title: "16 Workflow: Design and Build"
---

# 16 Workflow: Design and Build

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
