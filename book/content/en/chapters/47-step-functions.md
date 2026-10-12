---
title: "47 Step Functions: State Machines, Retry and Catch, Map, Callbacks, and Sagas"
sourceRevision: 1
---

# 47 Step Functions: State Machines, Retry and Catch, Map, Callbacks, and Sagas

A workflow remembers how far it has got, and nothing more. It does not undo what it has done, so you write the undoing into the definition yourself. This chapter is built around how to write it, and goes through Step Functions itself from one end to the other on the way.

[Chapter 16](/en/chapters/16-long-jobs.md) used Step Functions for one job that resumes where it stopped. It got as far as `Task`, `Choice`, `Retry`, `Catch`, and redrive, and every step was a Lambda function of your own. This chapter starts there. It calls service APIs directly with no Lambda function in between, waits for an answer from outside, changes several services without leaving the change half done when a step fails, and chooses between Standard and Express.

There are two examples. The first imports a note. It writes the note to DynamoDB, puts the attachment in S3, waits for a scan, publishes the note, and sends a notice. If a step fails, it undoes what was done, last step first. The second is a lookup. It takes several note IDs and answers in one request whether each can be read.

You need [chapter 08](/en/chapters/08-async.md) (idempotency, queues) and chapter 16. The code is in `examples/47-step-functions/`. The stack costs nothing while it only exists. What it costs in use is on [the costs page](/en/chapters/47-step-functions/wrap.md).

None of this chapter's steps was run against AWS. What ran on a laptop is an interpreter written for this chapter that walks the same definition, and its tests. The interpreter is not Step Functions. It is a model of the states this chapter uses. [The local page](/en/chapters/47-step-functions/local.md) says where the model ends and how to compare it with the real service.

## The whole picture

<!-- section: 47.overview -->

```figure
caption: The import runs the steps that can be undone, waits for the scan, runs Publish, which cannot be undone, and then Notify, which is only ever retried
node create: CreateNote | DynamoDB PutItem, phase = pending
node attach: AttachFile | S3 CopyObject
node scan: WaitForScan | SQS SendMessage, waits for the token
node verdict: Verdict | Choice
node publish: Publish | DynamoDB UpdateItem, phase = ready
node notify: Notify | SNS Publish
node imported: Imported | Succeed
edge create -> attach
edge attach -> scan
edge scan -> verdict
edge verdict -> publish: verdict = clean
edge publish -> notify
edge notify -> imported
mark publish
```

```figure
caption: The undoing starts with the step that failed, and goes backwards from there
node create: CreateNote
node attach: AttachFile
node scan: WaitForScan
node verdict: Verdict
node removeAttachment: RemoveAttachment | S3 DeleteObject
node removeNote: RemoveNote | DynamoDB DeleteItem
node rolledBack: RolledBack | Fail
node taken: NoteIdTaken | Fail
edge create -x removeNote: Catch
edge create -x taken: ID already in use
edge attach -x removeAttachment: Catch
edge scan -x removeAttachment: Catch
edge verdict -> removeAttachment: anything but clean
edge removeAttachment -> removeNote
edge removeNote -> rolledBack
```

```figure
caption: The lookup calls GetItem once per note ID and returns the results as one answer
node caller: Caller | StartSyncExecution
node map: EachNote | Map, MaxConcurrency 5
node get: GetNote | DynamoDB GetItem
edge caller -> map: {owner, noteIds}
edge map -> get: per note ID
edge get --> map: {noteId, found, title}
group express: Step Functions (Express) = map, get
```

There are two state machines. The import is a Standard workflow with 11 states, 7 of them `Task` states. The lookup is an Express workflow with one `Task` inside a `Map`. Neither has a Lambda function. Every `Task` calls an API of DynamoDB, S3, SQS, or SNS straight from Step Functions.

The stack also holds a table shaped like [chapter 05](/en/chapters/05-dynamodb.md)'s, a bucket for the files, a queue for scan requests, a topic for the notices, and a log group for the Express workflow.

The import's states fall into four groups by what they are for. `CreateNote` and `AttachFile` can be undone afterwards. `WaitForScan` asks someone outside to scan the file and stops until the answer comes. `Publish` makes the note visible to readers, and once it has run it is not undone. `Notify` only sends a notice, and the import still succeeds when it fails. The saga section of [the build page](/en/chapters/47-step-functions/build.md) explains why they come in this order.

### When not to use Step Functions

If the change fits in one DynamoDB table, you do not need a workflow. A transaction ([chapter 30](/en/chapters/30-data-modeling.md)) guarantees all or nothing in one request. You write the undoing yourself only when the change crosses things that cannot share a transaction, such as DynamoDB and S3.

If one kind of work is simply processed in turn, the queue of chapter 08 and [chapter 61](/en/chapters/61-sqs.md) is enough. If several consumers should react to the same fact, the event bus of [chapter 25](/en/chapters/25-events.md) fits better. A workflow earns its place when the steps have an order and branches, and something has to remember where the work stands.

If you want the order written as ordinary code, there are the Lambda durable functions of chapter 16. A Step Functions definition is JSON, branches and loops included, so it suits involved computation badly. In return, the definition is its own diagram, every step's input and output are kept in the history, and permissions can be narrowed step by step.

Cloudflare has Workflows, written as code with each step wrapped in `step.do()`. It has retries, sleep, and `step.waitForEvent()` to wait for an outside event, and a `step.do()` can be given a rollback handler. According to the documentation, when the workflow fails the registered handlers run in the reverse of the order in which the steps started (as of 2026-10-13). Vercel has Workflows too, in which you write code that retries failed steps, waits for outside events, and resumes across deployments (as of the same day). Neither was run for this chapter. If your app lives on Workers or Vercel and what it calls is there as well, writing the workflow there takes fewer parts. Step Functions fits when what you call is an AWS service and you want to call its API directly, with no function.

## Standard and Express

<!-- section: 47.types -->

When you create a state machine you pick its type, Standard or Express, and it cannot be changed later. The definition language is the same. What the two guarantee is entirely different.

| | Standard | Express |
| --- | --- | --- |
| Longest execution | One year | Five minutes |
| Execution guarantee | Exactly-once (unless you write `Retry`) | Asynchronous: at-least-once. Synchronous: at-most-once |
| State between steps | Saved at every state transition | Not saved |
| Execution history | Kept by Step Functions, readable through the API for 90 days after the end | Not kept by Step Functions. Needs logging to CloudWatch Logs |
| Ways to call a service | All three | Only the one that waits for the response |
| Distributed Map, redrive | Available | Not available |
| Starting again under the same name | While it runs, the answer points at the same execution | Another execution runs beside the first |
| Billing | Number of state transitions | Number of executions, duration, memory |

The guarantee row is one where the name should not be read for more than it says. Exactly-once in Standard means that Step Functions does not run the same state twice on its own account. Once you write `Retry`, a step that failed runs again, and so does a step that succeeded and whose answer never arrived. As chapter 16 showed, making a step idempotent is still your job.

An asynchronous Express execution can run twice as a whole. No state is saved along the way, so a second run starts from the beginning. What belongs on Express, then, is work whose result does not change when it runs twice. This chapter's lookup only reads, so it changes nothing however often it runs.

Three rows of the table say why the import cannot be Express. The call that waits for the scan's answer is not available, the wait does not fit in five minutes, and a failed execution cannot be resumed with a redrive.

### The price of the same work both ways

Take the lookup, and price one execution that checks 10 notes under each type. Prices are for the Tokyo Region in USD before tax, from the AWS Price List published on 2026-09-11.

Express charges 0.000001 per request and 0.00001667 per GB-second of duration. Duration is rounded up to 100 ms and memory is billed in 64 MB chunks. With one execution taking 300 ms at 64 MB, the sum is as follows. The 300 ms is an assumption, not a measurement.

```text
Express, one execution
  request     1 x 0.000001                           = 0.0000010
  duration    0.3 s x 0.0625 GB x 0.00001667         = 0.0000003
  total                                              = 0.0000013

Standard, one execution
  transitions 13 x 0.000025                          = 0.0003250
```

Standard charges 0.000025 per state transition, and one execution is counted here as 13. That is one for the `Map`, ten for the ten `GetNote` states, and one each for start and end. Counting start and end follows the pricing page's example. The pricing page does not say how the iterations of a `Map` are counted, so 13 is an estimate.

For the same work, Standard comes to roughly 250 times Express. At 100,000 executions a month, Express is 0.20 including the DynamoDB reads, and Standard is 32.57. Put short, frequent work on Standard and the number of states becomes the bill.

Work with long waits, such as the import, goes the other way. Standard does not charge for time, so waiting 30 minutes for a scan leaves the number of state transitions before and after the wait unchanged.
