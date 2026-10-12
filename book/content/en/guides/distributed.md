---
title: State and Invariants by Chapter
sourceRevision: 4
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

### Work that leaves the system, and long work (chapters 15–18 and 51)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [15](/en/chapters/15-email.md) | The DynamoDB table that holds the notification records. Whether a mail arrived comes later, in events from SES | No `notificationId` ever causes more than one email to be sent | Four places are stopped (checking the address, the claim, the send, the record after sending), each in two ways: failing before it ran, and losing the response after it ran. `examples/15-email/test/notify.test.ts`. Duplicate and reordered events are in `test/events.test.ts`. The price is that some paths deliver no mail at all |
| [16](/en/chapters/16-long-jobs.md) | S3, which holds the written parts and the manifest. The progress the workflow carries around can be rebuilt from there | Each part of an export is written once per number, and the next part starts where the written part ended. An export without a manifest does not exist | The same step runs twice, a response is lost, a stalled worker writes late, two executions of the same export overlap. `examples/16-long-jobs/test/steps.test.ts`. Giving up on retries and the path into cancellation are in `test/workflow.test.ts`; the durable function variant is in `test/durable.test.ts` |
| [17](/en/chapters/17-ai.md) | No state. What exists is the partial output that reached the caller | Output for which no `done` was received is never treated as a completed summary | The stream is cut off partway. `examples/17-ai/test/client.test.ts` truncates a complete response one byte at a time and checks that every cut gives `incomplete` |
| [18](/en/chapters/18-live.md) | Whether the channel is live belongs to IVS. The events that arrive are signals | When the picture built from events disagrees with `GetStream`, `GetStream` is the one to trust | An event arrives twice, events arrive out of order, one goes missing. `examples/18-live/test/timeline.test.ts`. That each viewer sees the video with a different delay is covered in the prose, not by a test |
| [51](/en/chapters/51-chime-sdk.md) | Who sits in which seat belongs to the table, and which join tokens are valid to Chime. Nothing can change both in one transaction | A join token is made only for a signed-in user who is a member of the room, and is handed only to that user. Once they leave, the token stops working | Two people become the first participant at the same time, one person joins from two tabs at once, the meeting ends between `GetMeeting` and `CreateAttendee`. `examples/51-chime-sdk/api/test/seats.test.ts`. The Chime side is a model that copies what the API reference says |

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

### Connect Services (chapters 25, 61, 54, 47)

From chapter 25 on, each chapter stands on its own, so the tables follow the sidebar's groups by subject.

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [25](/en/chapters/25-events.md) | The source tables, which hold chapter 05's notes and chapter 08's inspection records. The timeline and the count are copies built from the events that arrive | However many times the same change arrives, and in whatever order, the timeline and the count are what they would be had each change arrived once | The same delivery arrives twice, the same change is put on the bus twice, changes arrive in reverse, a delete arrives before its create. `examples/25-events/test/bus.test.ts`. A counter that remembers nothing is run alongside and counts 2 |
| [61](/en/chapters/61-sqs.md) | The ledger, which remembers a marker for each command it applied. The queue's part is the order within a group and a resend within five minutes | For each note, commands take effect in the order the queue accepted them, and each command takes effect once, however many times it is delivered | A resend after five minutes, a race with a worker that outlived its visibility timeout, a failure in the middle of a batch. `examples/61-sqs/test/worker.test.ts`. A ledger without markers is run alongside and applies a command twice. The visibility timeout arithmetic is in `test/lease.test.ts` |
| [54](/en/chapters/54-kinesis.md) | The stream, which forgets after 24 hours. The history table is a copy derived from the stream | For each note, every revision is applied once and in order | A batch redelivered after a lost response, a write resent after a lost response, a partial failure of PutRecords, a poison record, reading a child shard before its parent. `examples/54-kinesis/test/poller.test.ts` and `test/producer.test.ts`. That the function's side effects happen once is not guaranteed |
| [47](/en/chapters/47-step-functions.md) | The notes table and the attachments bucket. How far an execution has got belongs to Step Functions | An import that has ended left the published note together with its attachment, or left neither. The only exception is an execution in which the step that cannot be undone, or a compensation itself, failed: it ends as failed, and a redrive continues it from there | One failure is put into each step in turn, a compensation fails, the same import is started twice. `examples/47-step-functions/test/saga.test.ts`. The tests run against a local interpreter and a stand-in table, so the condition expressions themselves are not checked |

### Deeper into Data (chapters 30, 59, 60, 39, 58, 53, 38)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [30](/en/chapters/30-data-modeling.md) | One DynamoDB table. The GSIs are copies that catch up later | A slug is unique within an owner. An attachment is never newly created where there is no note | Two creates compete for the same slug, a delete stops partway through its sweep. `examples/30-data-modeling/test/notebook-contract.ts` runs against both the in-memory model (`test/notebook.test.ts`) and DynamoDB Local (`test/dynamodb-local.test.ts`). The same stream batch arriving twice and in reverse is in `test/projector.test.ts` |
| [59](/en/chapters/59-rds.md) | The primary. A read replica is a copy that lags | Whoever wrote something sees that write in every read they make afterwards | A read from a lagging replica straight after a write. A lagging replica is promoted. `examples/59-rds/test/routing.test.ts`. The tests run against a model, not a real replica |
| [60](/en/chapters/60-aurora.md) | The Aurora cluster. When instances change places, the application no longer knows how a transaction in flight ended | A transaction interrupted by a failover is either committed or redone as a whole. It is never half applied, and never applied twice | The append transaction is cut at ten different points, the response to a commit is lost. `examples/60-aurora/test/once.test.ts`, and `test/data-api.test.ts` for the Data API. The database is PGlite, with a wrapper that reproduces what a dropped connection looks like |
| [39](/en/chapters/39-database-migration.md) | The source until the switch, the target after it. The procedure decides which one is right, not the databases | Across the switch, no write that was answered is lost, and none is applied twice | A write reaches the source through an old connection after the switch, replication is resumed after the switch, a resume applies the same change again. `examples/39-database-migration/test/replicate.test.ts`, with the order of the phases in `test/cutover.test.ts`. What the tests break is this chapter's model |
| [58](/en/chapters/58-ledger.md) | The entries are in a DynamoDB table. The digest, which is the evidence, is in an S3 bucket under Object Lock | Any change to, reordering of, or removal of an entry older than a locked digest is found by verification | A changed entry, a changed entry with its hash repaired, a removal from the middle, a swap, a removal from the start, a cut-off tail. `examples/58-ledger/test/verify.test.ts`. The journal's rules (`test/journal-contract.ts`) were also run against DynamoDB Local |
| [53](/en/chapters/53-efs.md) | The file system alone. The function keeps nothing in memory | A reader never sees a half-written note file | A write interrupted at each stage, an overwrite in place, two writers on the same note, a shared temporary file name. `examples/53-efs/test/two-writers.test.ts` and `test/note-files.test.ts`. They ran on a local file system, not on EFS |
| [38](/en/chapters/38-data-movement.md) | The source bucket. The archive is a copy derived from it, and it lags | Every object in the archive is byte for byte what the source held at some moment, and once one execution succeeds while the source is quiet, nothing is left to copy | The source changes during an execution, an execution stops partway, something is written straight into the archive. `examples/38-data-movement/test/execution.test.ts`. An object written straight into the archive breaks the first half until the next execution overwrites it |

### Analyze (chapters 26, 49, 43, 27)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [26](/en/chapters/26-analytics.md) | The DynamoDB table holds the notes. The records in the bucket are a copy that can have gaps and duplicates | Whether or not a record can be written, the API's response and the state of the notes are the same | The sink fails, throws, or does not answer. `examples/26-analytics/test/app.test.ts`. A retry after a lost response writing the same record twice is in `test/sink.test.ts` |
| [49](/en/chapters/49-athena.md) | The table definitions belong to the Glue Data Catalog, the data to the files in S3, and the state of a query to Athena | The text of the SQL handed to Athena does not change with a user's value. The client does not leave a query running after it stops waiting. The same start, sent any number of times, starts one query | A value with a quotation mark in it, a lost response to the start, a query that never ends, a stop call that fails. `examples/49-athena/test/statement.test.ts` and `test/client.test.ts`. The tests run against a stand-in for Athena |
| [43](/en/chapters/43-glue.md) | The raw files. The curated files are a copy computed from them | After a run succeeds, the day's folder holds each request answered that day once | The same day is run twice, a run fails after writing and is run again, a run fails after deleting and before writing and is run again, a late file is added afterwards. `examples/43-glue/test/model.test.ts`. These run on a model of a job run; Spark is not involved |
| [27](/en/chapters/27-search.md) | The table. The index is a copy that lags, has gaps, and has extras | A search never returns another owner's note | The index ignores the owner filter, the index holds an entry that passes another person's note off as yours, the index returns 200 rounds of randomly combined hits. `examples/27-search/test/search.test.ts` |

### Deeper into AI (chapters 36, 56, 50, 57)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [36](/en/chapters/36-bedrock.md) | The notes are in the table. The code that builds the tools decides whose notes are read, and the model's output does not | The model never reaches a note that does not belong to the caller | The model obeys an instruction written in a note. A tool that takes `owner` from its input is also shown, and it does leak. `examples/36-bedrock/test/loop.test.ts`. The model is a scripted one |
| [56](/en/chapters/56-nova.md) | The S3 bucket that holds the descriptions. A conditional write decides which run gets to write | One description is stored per attachment, and only under its owner's prefix | Two requests arrive together, a run that outlives its lease and the run that took over both write, a stalled run is taken over. `examples/56-nova/test/describe.test.ts` |
| [50](/en/chapters/50-agentcore.md) | The notes belong to DynamoDB, the conversation record to AgentCore Memory, and who the user is to the Cognito token | An agent acting for a user reaches only that user's notes and conversations. What the process remembers equals the fold of the events the store accepted | The body claims to be the owner, another user calls next in the same process, another user's session ID is used. `examples/50-agentcore/test/boundary.test.ts`. A store that refuses a write, and the same write arriving twice, are in `test/memory.test.ts`. That Runtime really separates microVMs is not something the tests establish |
| [57](/en/chapters/57-polly.md) | The S3 bucket that holds the audio. The function remembers nothing | One synthesis per distinct input (engine, voice, format, SSML) | Two and ten simultaneous requests, a failed synthesis, a run that stops with its marker in place, two runs taking over a stale marker at once. `examples/57-polly/test/speak.test.ts`. A function that stops between finishing the synthesis and writing the audio causes one more synthesis |

### Deeper into Compute (chapters 29, 35, 41, 52, 34)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [29](/en/chapters/29-lambda-tuning.md) | The notes are in the table. An execution environment holds only what can be rebuilt after it is lost | A request that reaches its deadline ends before the function timeout, with an error in the usual shape that carries a request ID. Another request's deadline does not affect it | The table does not answer, two requests run at the same time. `examples/29-lambda-tuning/test/deadline.test.ts` |
| [35](/en/chapters/35-lambda-managed-instances.md) | A request's state belongs to that request. The notes are in a `Map` per worker thread, which cannot serve as the owner of stored data | A value read while handling a request belongs to that request | Two requests in flight are interleaved in a fixed order, and the request ID in module scope changes hands. `examples/35-lambda-managed-instances/test/scope.test.ts`, and `test/server.test.ts` over real sockets |
| [41](/en/chapters/41-fargate.md) | The number of tasks belongs to ECS, target registration and draining to the ALB, and requests in flight and a job's progress to the task's process | A request within the expected time is not cut off by a scale-in or by a Spot interruption. A job, however often it is stopped, handles every item exactly once if it continues from its resume number | The seconds are shortened, a Spot interruption is injected, a job is sent SIGTERM. `examples/41-fargate/test/scaling.test.ts`, `test/spot.test.ts`, and `test/job.test.ts`. That the tasks the service never goes below are not placed on Spot is in `test/strategy.test.ts` |
| [52](/en/chapters/52-ecr.md) | "Which image is this tag" belongs to the repository, and "what to run" to the task definition | The image a task definition names is the image that runs | The tag moves between two pulls, the tag moves and then there is a rollback, the image it names is deleted and the same tag is put on another. `examples/52-ecr/test/invariant.test.ts`. The tests run on a model of a repository |
| [34](/en/chapters/34-eks.md) | What counts as state is the number of Pods that are answering. Rollouts, and disruptions that go through the eviction API, lower it | With this chapter's settings, and with intended disruptions only, the number of Pods answering never drops below one | The rollout settings are changed, evictions are requested one after another. `examples/34-eks/test/rollout.test.ts`. A node failure is outside this arithmetic |

### Protect and Prepare (chapters 42, 46, 44, 28, 40)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [42](/en/chapters/42-firewall-manager.md) | A web ACL association belongs to the account that has the resource. The compliance report is a copy that changes once the change has arrived | A resource in scope is never reported compliant while the policy's rules are not in effect on it. That does not hold until a change has arrived, so the chapter restates it in a form that does | The owner swaps the web ACL, a distribution is created after the policy, 2,000 moves from a fixed random seed. `examples/42-firewall-manager/test/reconcile.test.ts`. The tests run on a model of the associations |
| [46](/en/chapters/46-shield.md) | The count per source belongs to AWS WAF, the cache to each CloudFront location, and concurrency to Lambda. Your own code can read none of them | A request that reaches the origin from the internet has always come through CloudFront | A function URL without authentication, a permission without `SourceArn`, a security group that allows every source. `examples/46-shield/test/origins.test.ts`. What is checked is the template |
| [44](/en/chapters/44-health.md) | The state of an event belongs to AWS Health. The ledger holds "the last state announced" | One notice per meaningful change of state of an event, and never zero notices for an open issue | Duplicates, reordering, a failed publish, an interruption between the publish and the record, two deliveries arriving together. `examples/44-health/test/notify.test.ts` and `test/ledger.test.ts`. "Exactly one notice" is not guaranteed |
| [28](/en/chapters/28-multi-region.md) | The replicas in Tokyo and Osaka. Each accepts writes believing it is right | Chapter 05's "an update goes through only while the version it read is still the latest" can be checked inside one replica only. To extend it past a Region, either have a single writer or reach agreement on every write | Edits from two Regions at once both get a success and one is lost. A client holding an old DNS answer overwrites. `examples/28-multi-region/test/global-table.test.ts` and `test/failover.test.ts`. The table and the bucket arriving at different speeds is in `test/bucket-replication.test.ts`. The window around a switchover is reproducible in the tests but not closed |
| [40](/en/chapters/40-disaster-recovery.md) | The original server before the disaster, the recovery instance after the failover | After a failback, no write that either site accepted has been lost silently | The original server comes back after the failover and takes writes from a client that remembers the old address. `examples/40-disaster-recovery/test/sites.test.ts`. The tests run on a model of the two sites |

### Tune It (chapters 31, 32, 55)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [31](/en/chapters/31-progressive-delivery.md) | The weights on the Lambda alias. Four combinations run at once: old and new code, each with the flag on and off | During a shift the alias points only at the original version and the new one, and once the alarm is seen in `ALARM`, every request goes back to the original version and the shift ends. If it could not be put back, the run says so | The alarm goes off during the canary, a rollback write fails once, the response to a write is lost, someone else changes the alias partway. `examples/31-progressive-delivery/test/run.test.ts`. The old version reading records the new version wrote, after turning back, is in `test/versions.test.ts` |
| [32](/en/chapters/32-limits.md) | Whoever refuses is the one counting what it let through. The caller learns that it hit a limit only by being refused | Retries never raise what reaches the other side beyond a constant multiple of the first attempts | The service refuses everything for three seconds. Without a budget the traffic passes 2.9 times, and with one it stops at the first attempts plus 100. `examples/32-limits/test/simulation.test.ts` and `test/retry-budget.test.ts` |
| [55](/en/chapters/55-grafana.md) | What to watch is decided in `src/signals.ts`. The CloudWatch and Grafana dashboards are copies of it, and the numbers belong to CloudWatch | The two dashboards read the same metrics, with the same statistic and the same period | Chapter 19's side changes. A body with a changed statistic, an added line, or another table mixed in is about to be pushed. `examples/55-grafana/test/signals.test.ts`. Pushing again is in `test/provision.test.ts` |

### Developer Tools (chapters 48, 37, 45, 62, 63)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [48](/en/chapters/48-sdk.md) | The value written belongs to the service. The retry budget, the connections, and the credentials are inside the client, which means inside one process | One `send` may be carried out by the service more than once | The first response is lost, and a single `send` of an `ADD` leaves the number at 2. `examples/48-sdk/test/lost-response.test.ts`. What is added to is a variable in the script, not DynamoDB |
| [37](/en/chapters/37-cloudshell.md) | The bucket being emptied, with its versions and delete markers | No request carries more than 1,000 keys, and every version and delete marker in the listing becomes a target for deletion exactly once | A listing longer than 1,000, a bucket with one delete marker left. `examples/37-cloudshell/test/empty.test.ts` |
| [45](/en/chapters/45-infrastructure-composer.md) | The CDK code. A template saved from the diagram tool becomes a second source of truth | One stack has one source of truth | A template with a resource or a connection drawn onto it stays on disk. `examples/45-infrastructure-composer/test/diff.test.ts` compares the two templates as graphs |
| [62](/en/chapters/62-ci-runners.md) | Jobs and runner registrations belong to GitHub, which job a task was started for to the DynamoDB table, and whether a task is running to ECS | What one job wrote is not visible to the next. At most one task is started for one job | A redelivery, simultaneous deliveries, a failed start, a receiver that stopped partway. `examples/62-ci-runners/test/receive.test.ts`. The first condition is kept by how JIT runners work and by the boundary between Fargate tasks, and this chapter's tests cannot check it |
| [63](/en/chapters/63-agent-sandbox.md) | The list of tasks belongs to ECS, branches and pull requests to GitHub, and token counts to CloudWatch | Whatever the agent does from inside, it does not reach production data or the deploy role | `sts:AssumeRole` or `s3:Get*` is added to the task role. `examples/63-agent-sandbox/infra/test/agent-sandbox-stack.test.ts`, with the evaluator in `test/policy.test.ts`. Duplicate requests are in `test/launcher.test.ts`. What was checked is the task role's policy; resource-side policies were not looked at |

### Go to Production (chapter 33)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [33](/en/chapters/33-production-readiness.md) | Three things: the template the code synthesizes, the record the deploy tool keeps, and what exists in AWS. This chapter's check reads only the first | A stack that is required to pass passes only when its template was read, there are no findings, and every waiver was used | The template of a stack required to pass is missing, the cause was fixed and only the waiver remains, something that is not a template is handed in. `examples/33-production-readiness/test/check.test.ts` |

### Run Your Own Servers (chapters 64, 66, 67, 68)

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [64](/en/chapters/64-isolates.md) | The notes are in the memory of the workerd process. They are gone when the task is replaced | Separate workers in the same process share no state. One isolate handles several requests at once, and module scope is shared by all of them | Two workers with the same code are loaded into one process, two requests in flight are overlapped. `examples/64-isolates/test/workerd.test.ts`. These tests start the real workerd |
| [66](/en/chapters/66-distributed-sql.md) | The YugabyteDB cluster. Three nodes each hold a copy | An acknowledged write survives the loss of one node and, once seen, does not disappear. A transaction conflict reaches the client as `40001`. YugabyteDB keeps the first; this chapter's part is to operate it without breaking what it assumes | One node is lost, two nodes are lost, a conflict arrives on a statement instead of at commit. `examples/66-distributed-sql/test/quorum.test.ts` is a model of the majority, and `test/repository.test.ts` is the retry loop on PGlite |
| [67](/en/chapters/67-firecracker.md) | The Firecracker process. The client knows its state only from the responses | A microVM whose configuration was refused partway does not start. The instruction to start takes effect once | The drive configuration is refused, the response to `InstanceStart` is dropped and the request sent again, the request goes to a socket nobody answers. `examples/67-firecracker/test/client.test.ts` |
| [68](/en/chapters/68-nitro.md) | The plaintext data key is held by the enclave. The parent instance records every byte it handles | The parent instance never holds the plaintext data key | The parent calls Decrypt itself, replays the enclave's attestation document, starts an enclave from a changed image or in debug mode. `examples/68-nitro/test/enclave.test.ts`. The tests run on a model of the parent, the enclave, and KMS |

## Every test here was run locally

Every test in the tables above was run on a local machine. In AWS, no chapter's checks have been run yet, not even once. Chapter 05's conditional writes have never been sent to DynamoDB, chapter 08's worker has never been handed a real S3 event, and chapter 13's transactions have never been made to conflict on a real cluster. The same goes for chapter 25 onwards: none of those chapters has been deployed.

Most of what the tests ran against is an in-memory model or a stand-in. From chapter 25 on, four chapters ran real software locally.

- Chapter 30 ran 16 table rules and 19 notebook rules against DynamoDB Local 3.3.1. DynamoDB Local does not report transaction conflicts, so the path that conflicts and retries has run only on the in-memory model
- Chapter 58 ran 11 tests against DynamoDB Local 3.3.1: the journal's rules, and one that goes from an append to an audit. The Object Lock bucket was not run locally
- Chapter 64 started workerd 1.20261012.1 on macOS (arm64) and ran its tests against that binary. The container image has never been built, and the Linux workerd has not been executed
- Chapter 66 started a three-node cluster of YugabyteDB 2025.2.7.0-b107 on macOS (Apple silicon) and took down one node, then two. The Linux binaries have never been run

DynamoDB Local, a local workerd, and a cluster on one machine are not services or instances in AWS. What those four chapters established is how that software behaved locally, and no more.

Local tests have the advantage that a failure can be reproduced in a fixed order. What they check, though, is the decisions made by this book's code, not the behavior of AWS services. Actual propagation delay, how execution environments scale out, IAM propagation, the real shape of events, and what happens in a real outage can be checked only in a real environment. What is still open is listed chapter by chapter in the [Validation Record](/en/reference/validation.md).

The book does not start with a multi-Region setup from the very first API. It begins with a small ordinary example, then looks at how that example fails, and goes on to a deeper lab only where one is needed.

Experiments that cause failures in a real environment are kept apart, in a dedicated environment and in tasks that you run explicitly. The everyday `vp run check:all` does not touch AWS.
