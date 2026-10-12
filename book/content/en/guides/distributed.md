---
title: State and Invariants by Chapter
sourceRevision: 3
---

# State and Invariants by Chapter

The samples in this book are all small, but each one runs across several places. The browser, the CDN's edge locations, a function's execution environments, and a database each hold state from a different point in time, and each fails separately.

Distributed-systems topics are not confined to the distributed database chapter. They come up throughout the book, and this page collects which chapter deals with what.

## Eight questions every chapter answers

For a sample that holds state, the chapter answers these questions.

1. Who owns the state? Which copy of the data is the correct one?
2. Which path do reads and writes take?
3. What is the consistency guarantee, and over what scope does it hold? One read, one session, one Region, or everything?
4. What happens on concurrent updates?
5. What happens when the same message arrives twice?
6. If the connection drops before the response comes back, did the operation happen or not?
7. If it stops after only part of it succeeded, how do you get back?
8. What additional cost does that bring?

The chapter then states the property it wants to keep, its invariant, in one plain sentence, and adds a test that tries to break that invariant.

The book does not infer guarantees from a service's name, because words such as global, serverless, durable, and exactly-once guarantee nothing on their own.

## Each chapter's answers

The chapters that hold state are listed below in several groups. Every test file named in the tables is in this repository.

### Foundations and the notes API (chapters 02–06)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [02](/en/chapters/02-toolchain.md) | The CDK code (and the template built from it), cdkd's state, and the actual resources in AWS | The three agree | Someone changes a setting in the console. `tools/src/drift/report.test.ts` classifies drift, deletion, uncompared resources, and failed detection separately |
| [03](/en/chapters/03-spa.md) | The S3 bucket. The edge cache and the reader's browser are copies | The files referenced by the `index.html` a reader holds can always be fetched | A publish stops partway. A reader still has an old page open. `tools/src/site/plan.test.ts` checks the upload order and that old assets are kept |
| [04](/en/chapters/04-http-api.md) | Individual Lambda execution environments (there are several, and each disappears at some point) | This chapter pins "not shared" as the specification | Concurrent requests reach different execution environments. `examples/04-http-api/test/app.test.ts` checks that two instances do not share notes |
| [05](/en/chapters/05-dynamodb.md) | The DynamoDB table | Every successful save moves the version by exactly one, and an update based on an old version is refused | Two writes hold the same version. A response is lost after the write and the caller retries. `examples/05-dynamodb/test/repository-contract.ts` and `test/app.test.ts` check that only one gets through and that a retry does not move the version twice. That a retried create makes a duplicate is recorded as the specification too |
| [06](/en/chapters/06-auth.md) | "Who" is in the token; "has it been disabled" is in Cognito. API Gateway looks at the token only | A request can read and write only the notes owned by its token's `sub` | Another user names the ID, or writes an owner into the request. `examples/06-auth/api/test/app.test.ts` checks that both are refused. That a revoked token passes until it expires is explained in the prose, not by a test |

### Two stores, a queue, a cache, the edge (chapters 07–10)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [07](/en/chapters/07-uploads.md) | Attachment records are in DynamoDB, the bytes are in S3. No transaction spans the two | If an attachment record exists, its object exists and is out of reach of automatic deletion | It stops between the two writes. `examples/07-uploads/api/test/partial-failure.test.ts` checks what is left behind for each place it can stop. Sending the same form again after finishing breaks the invariant; this chapter does not close that gap, and a test records it as it is |
| [08](/en/chapters/08-async.md) | Inspection records are in DynamoDB. A queue message is only a signal that there may be work | For one object key there is at most one inspection record, and it comes from the newest create event the worker has handled | The same message arrives twice, an older event arrives later, two workers hold the same event, the worker stops before or after writing. `examples/08-async/test/worker.test.ts`. Partial batch failures and the DLQ are in `test/queue.test.ts`; housekeeping run twice or interrupted is in `test/housekeeping.test.ts` |
| [09](/en/chapters/09-ssr.md) | Lambda builds the response. The CloudFront cache is a copy, one per edge location | A response that was built after looking at someone's cookie or `Authorization` header never enters a shared cache | Alice, then Bob, read through a deliberately careless shared cache. `examples/09-ssr/test/cache-control.test.ts` checks that an origin labelling everything `public` leaks, that this chapter's labels do not, and that a public page is never staler than the stated number of seconds |
| [10](/en/chapters/10-edge.md) | `edge-data.json` is the source, and KeyValueStore is a copy of it. Each edge location is a copy of that | The sync never overwrites a change it hasn't read, and wherever it fails, running it again converges on `edge-data.json` | Someone else writes first, only the response is lost, it stops partway through several requests, it keeps conflicting. `examples/10-edge/test/sync.test.ts`. The delay in reaching the edge is covered in the prose, not by a test |

### Network, containers, and where data lives (chapters 11–14)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [11](/en/chapters/11-network.md) | No state. What it holds is a dependency: which subnet relies on which route | A private subnet in a zone that is up still reaches whatever it reached before another zone went down | With a single NAT gateway, the zone it is in goes down. `examples/11-network/test/reach.test.ts`. What the test breaks is the model of the plan, not a real Availability Zone |
| [12](/en/chapters/12-containers.md) | The data outside the tasks. Tasks are replaced, and during an update the old and new versions run at once | Every version that is running can read every record written by any version that is running | During a rolling update and a rollback, old and new read and write the same records. `examples/12-containers/test/versions.test.ts`. SIGTERM arriving in the middle of a request is in `test/shutdown.test.ts` |
| [13](/en/chapters/13-sql.md) | The Aurora DSQL cluster | A transaction either commits as a whole or is run again as a whole, and a rerun changes its outcome only through values read from the database again | Two transactions compete for the last slot and one loses at commit. `examples/13-sql/test/notes-repository.test.ts` injects the commit conflict, and `test/transaction.test.ts` looks at the retries. Interrupting and resuming a migration is in `test/migrate.test.ts` |
| [14](/en/chapters/14-kv-cache.md) | The rate limit count belongs to the shared store (DynamoDB or Valkey). The list belongs to the source data. The cache owns nothing | However many requests arrive at once, no more than the limit pass in one window. A copy is never staler than its TTL | Two requests reach a read-then-write store together, an expired item comes back, the cache fails, refills stampede. `examples/14-kv-cache/test/rate-limit.test.ts`, `test/read-through.test.ts`, and `test/dynamodb-store.test.ts` |

The conflict in chapter 13 does not happen locally, because PGlite has a single connection. What the tests establish is that this book's code behaves correctly when DSQL returns `40001` as documented. They do not prove that DSQL really behaves that way.

### Work that leaves the system, and long work (chapters 15–18)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [15](/en/chapters/15-email.md) | The DynamoDB table that holds the notification records. Whether a mail arrived comes later, in events from SES | No `notificationId` ever causes more than one email to be sent | Four places are stopped (checking the address, the claim, the send, the record after sending), each in two ways: failing before it ran, and losing the response after it ran. `examples/15-email/test/notify.test.ts`. Duplicate and reordered events are in `test/events.test.ts`. The price is that some paths deliver no mail at all |
| [16](/en/chapters/16-long-jobs.md) | S3, which holds the written parts and the manifest. The progress the workflow carries around can be rebuilt from there | Each part of an export is written once per number, and the next part starts where the written part ended. An export without a manifest does not exist | The same step runs twice, a response is lost, a stalled worker writes late, two executions of the same export overlap. `examples/16-long-jobs/test/steps.test.ts`. Giving up on retries and the path into cancellation are in `test/workflow.test.ts`; the durable function variant is in `test/durable.test.ts` |
| [17](/en/chapters/17-ai.md) | No state. What exists is the partial output that reached the caller | Output for which no `done` was received is never treated as a completed summary | The stream is cut off partway. `examples/17-ai/test/client.test.ts` truncates a complete response one byte at a time and checks that every cut gives `incomplete` |
| [18](/en/chapters/18-live.md) | Whether the channel is live belongs to IVS. The events that arrive are signals | When the picture built from events disagrees with `GetStream`, `GetStream` is the one to trust | An event arrives twice, events arrive out of order, one goes missing. `examples/18-live/test/timeline.test.ts`. That each viewer sees the video with a different delay is covered in the prose, not by a test |

### Operations, and servers you run yourself (chapters 19–24)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [19](/en/chapters/19-observability.md) | What happened belongs to the table and the logs. Metrics are aggregates, and traces are samples | Sampled or not, every request leaves one log line with a request ID | Sampling is turned off, the caller says "do not record", the exporter fails. `examples/19-observability/test/tracing.test.ts` |
| [20](/en/chapters/20-shipping.md) | The CloudFormation stack. A deploy is a sequence of dozens of API calls, and it stops partway | No deploy is started on a stack that another operation is touching, or that a person has to repair before it can move on | An update fails and rolls back, or the rollback fails too. `examples/20-shipping/test/stack-status.test.ts` lines the statuses up in order and checks that none of them answers "deployable" on the way |
| [21](/en/chapters/21-security.md) | The key belongs to Secrets Manager. The cache in each execution environment is a copy, each read at a different time | An unexpired token verifies in every execution environment, whether it was issued before the rotation or after | Two execution environments see a rotation at different times, a flood of made-up version ids arrives, Secrets Manager stops answering. `examples/21-security/test/keyring.test.ts`. The rotation procedure is in `test/rotation.test.ts`, and waiting for IAM to propagate is in `test/propagation.test.ts` |
| [22](/en/chapters/22-recovery.md) | Notes and records are in DynamoDB, the bytes are in S3. A restore takes the two back to different points in time | The invariants of chapters 07 and 08 can be checked after a restore, and repaired where they are broken | Only the table is restored, the restore point is before an upload, the restore point is before an overwrite. `examples/22-recovery/test/skew.test.ts`. Rerunning and interrupting the object restore is in `test/object-restore.test.ts` |
| [23](/en/chapters/23-ec2.md) | A file on the data volume attached to one instance | A note that was answered with 201 can be read after the process restarts and after the instance is replaced | The process stops in the middle of a write, the instance is replaced. `examples/23-ec2/test/file-notes.test.ts` and `test/data-volume.test.ts` |
| [24](/en/chapters/24-celld.md) | Three places: the bucket, the owning node's disk, and the followers' disks | A cell has one owner at a time. An acknowledged write is not lost. celld keeps these; this chapter's part is to operate it without breaking what it assumes | An update fails partway, one node is lost, a request is left without an answer. `examples/24-celld/test/rollout.test.ts` and `test/ledger.test.ts` |

The chapter 24 tests run against a simulated fleet built for the tests. celld itself has never been started, neither locally nor in AWS.

## Every test here was run locally

Every test in the tables above was run on a local machine. In AWS, no chapter's checks have been run yet, not even once. Chapter 05's conditional writes have never been sent to DynamoDB, chapter 08's worker has never been handed a real S3 event, and chapter 13's transactions have never been made to conflict on a real cluster.

Local tests have the advantage that a failure can be reproduced in a fixed order. What they check, though, is the decisions made by this book's code, not the behavior of AWS services. Actual propagation delay, how execution environments scale out, IAM propagation, the real shape of events, and what happens in a real outage can be checked only in a real environment. What is still open is listed chapter by chapter in the [Validation Record](/en/reference/validation.md).

The book does not start with a multi-Region setup from the very first API. It begins with a small ordinary example, then looks at how that example fails, and goes on to a deeper lab only where one is needed.

Experiments that cause failures in a real environment are kept apart, in a dedicated environment and in tasks that you run explicitly. The everyday `vp run check:all` does not touch AWS.
