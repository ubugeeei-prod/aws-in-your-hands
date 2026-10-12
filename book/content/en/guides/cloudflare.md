---
title: Coming from Cloudflare
sourceRevision: 4
---

# Coming from Cloudflare

This guide is for people who have built things with Cloudflare D1, Workers, and Workers AI. It is not a migration manual. It lays out a route for finding out what a familiar job looks like on AWS, by building the same small feature.

Two caveats come first.

One is that a table mapping service names is only a starting point. Saying that the counterpart of D1 is Aurora DSQL does not make the SQL dialect, the way it runs locally, or the consistency guarantees the same.

The other is how far things have been checked. For every path here, the text and the samples are written, but the checking stops at the local machine, and nothing has been deployed to AWS yet, not even once. What was checked for each chapter is in "Verification notes for this chapter" at the end of that chapter.

## Three paths

| What you know | What you build on AWS | Chapter |
| --- | --- | --- |
| Writing HTTP handlers in Workers | Lambda and API Gateway HTTP API | [04](/en/chapters/04-http-api.md), [05](/en/chapters/05-dynamodb.md), [06](/en/chapters/06-auth.md) |
| Writing edge logic in Workers | CloudFront Functions and KeyValueStore, plus Lambda@Edge for when those fall short | [10](/en/chapters/10-edge.md) |
| Writing SQL with D1 | Aurora DSQL. Recovery is worked through with DynamoDB and S3 | [13](/en/chapters/13-sql.md), [22](/en/chapters/22-recovery.md) |
| Calling models with Workers AI | Amazon Bedrock and a Lambda function URL | [17](/en/chapters/17-ai.md) |

Every path requires [chapter 01](/en/chapters/01-account.md) and [chapter 02](/en/chapters/02-toolchain.md).

Every path also moves through the same five stages: try it locally, test it, set up the release procedure, observe it, and clean up.

## If you're coming from Workers

The reading order is 00 → 01 → 02 → 03 → 04 → 10. Chapter 10 continues from chapter 03, so 03 goes in between.

Chapter 04 goes through a small HTTP handler, a typed client, environment variable validation, local watch mode, tests, deployment, and checking the logs. The chapter ends with a table of differences from Workers, so only four main points are given here.

The first is the local runtime. With Workers, `wrangler dev` or the Vite plugin runs your code through Miniflare on the same runtime as production (workerd). `vp run dev:api` in chapter 04 is a Node.js HTTP server, not the Lambda runtime itself.

The second is that there are no bindings. In Workers, you declare a binding in the configuration and use it from `env`, and locally it connects to a local simulation by default. On AWS, you call the service through the SDK, pass the target in an environment variable, and write the permissions into an IAM role. No local simulation comes as standard.

The third is that there are two sets of permissions. Locally the code runs with your own permissions, and after deployment it runs with the permissions of the function's execution role. So an operation that succeeded locally can be denied after deployment.

The fourth is where the code runs. Lambda runs in one Region. Logic that runs close to your readers is covered in chapter 10.

In chapter 10 you write one CloudFront Function. A redirect table, a feature flag that switches the home page, and a maintenance switch all live in CloudFront KeyValueStore, and the function reads them, so that you can flip them without deploying again.

Chapter 10 has several things that work differently from Workers. The function can only read KeyValueStore and cannot write to it. Writes come from outside, through a dedicated API. The chapter writes a script that sends only the difference from `edge-data.json` and uses the ETag so that it never overwrites a change it has not read. A value you write also takes time to reach the edge. We could not find a figure for how long in the Developer Guide.

For work that CloudFront Functions cannot do, the chapter also runs one Lambda@Edge function, a small one that returns the size and SHA-256 of a POSTed body. Lambda@Edge can only be created in `us-east-1`, so it became a stack of its own, apart from the distribution and outside Tokyo.

Locally, you run the very file that gets deployed, under Node.js (`vp run dev:edge`). cdkd's emulator was confirmed to give the same responses (`vp run dev:edge:cdkd`). Both are stand-ins, though, and the function has never run on the real CloudFront Functions runtime.

The chapter ends with a table that puts Workers, CloudFront Functions, and Lambda@Edge side by side. Its conclusion is that CloudFront Functions is not a counterpart to Workers. It is an environment for rewriting URLs and headers, with no access to the network or the file system.

Running workerd itself, the Workers runtime, in AWS is the subject of [chapter 64](/en/chapters/64-isolates.md). Besides chapters 04 and 10, chapter 64 builds on chapters 11, 12, 23, 24, and 35.

## If you're coming from D1

The reading order is 00 → 01 → 02 → 04 → 13. To follow recovery as well, go on to chapter 22 after that. Chapter 22 works on the notes and images from chapters 05 through 08, so it is easier to follow if you read those first.

Chapter 13 stores the data of the notes API from chapter 04 in Aurora DSQL, using SQL. It connects the schema and migrations, typed queries, seed and reset, running locally, and connecting from Lambda.

These are the differences worth knowing first.

- D1 is SQLite. DynamoDB, on the other hand, is not a SQL database. If you want to write SQL, go to chapter 13, not to DynamoDB in chapter 05
- Only Aurora DSQL is implemented. For RDS for PostgreSQL and Aurora Serverless v2, the chapter lays the differences out in a table and explains when you would pick them, and neither was run. Both live inside a VPC, so choosing one requires chapter 11
- The local substitute is PGlite, an npm package that runs PostgreSQL inside the Node.js process and needs no Docker. Using it is close to the way `wrangler dev` sets up a local D1, but local D1 is the same D1 as production, and PGlite is only a substitute. It does not reproduce conflicts, authentication with an IAM token, or DSQL's limits (3,000 rows per transaction, one DDL statement at a time, indexes through `CREATE INDEX ASYNC`). The version differs too
- The tests deliberately cause the conflicts that do not happen locally. A transaction that loses at commit gets `40001`, and the whole transaction is run again. Writing that retry yourself is the biggest difference from D1's `batch()`
- Migrations are numbered `.sql` files run by a small runner written in the chapter. Each file holds one statement and is shaped so that it can be run again after a stop partway. No ORM and no general-purpose migration tool was run in this chapter
- Backup and restore are explanation only in chapter 13. It says that Aurora DSQL backups go through AWS Backup and that a restore always creates a new cluster, but it creates no resources for this, and the procedure has not been tried

The code has never been connected to a real cluster. Whether DSQL accepts this chapter's SQL is among the things still unchecked.

Chapter 22 is the recovery chapter. Its subject is not Aurora DSQL, though, but DynamoDB point-in-time recovery (PITR) and S3 versioning. It causes an accident, restores the table and the bucket to different points in time, checks for the mismatch, and repairs it, all of which runs in memory locally.

The chapter sets this next to D1's Time Travel. Time Travel restores by overwriting the database in place. DynamoDB PITR always creates a new table. That leaves you the work of switching over, and in exchange you can put the new table next to the original and count the differences before you decide whether to switch.

## If you're coming from Workers AI

The reading order is 00 → 01 → 02 → 04 → 17.

Chapter 17 starts by calling a model once with a few lines of code. It then builds an API that summarizes the body of a note and returns the summary a little at a time, as it is produced.

- On both services, inference does not run on your machine. Cloudflare's documentation says that Workers AI has no local simulation and that models always run remotely. Bedrock is the same: even when the API server runs on your machine, model calls reach AWS and are billed
- For that reason the tests and the default dev server (`vp run dev:ai`) replay a fixed sequence of events (a fixture) and never call a model. Two separate tasks, `ai:hello` and `ai:test:live`, call a real model, and the usual `check:all` does not call them. Neither has been run yet
- The entry point for streaming is a Lambda function URL. API Gateway HTTP API in chapter 04 waits for Lambda's whole response before returning it, so it cannot return a little at a time. The only authentication a function URL has of its own is IAM signing, so the caller sends signed requests
- Workers AI returns `text/event-stream` when you pass `stream: true`, and you can use that as the response as it is. Bedrock's `ConverseStream` returns a sequence of events as an async iterable in the SDK. Assembling server-sent events from it is code you write
- A stream can be cut off partway. Chapter 17 decides that output which never received `done` is not treated as a finished summary, and checks that with a test that truncates the response one byte at a time

Whether the stream arrives a little at a time from the deployed function through the function URL has not been checked yet. What was checked locally is the relay when a fixture is replayed, and the handling when the stream is cut.

## Comparisons in other chapters

Besides the three paths, more chapters explain their subject next to a Cloudflare product. First, the chapters up to 24. This table collects them so that you can look one up from what you already know.

| What you know | What this book sets next to it | Chapter |
| --- | --- | --- |
| R2 presigned URLs | S3 presigned POST | [07](/en/chapters/07-uploads.md) |
| Queues, R2 event notifications, Cron Triggers | SQS and a DLQ, S3 event notifications, EventBridge Scheduler | [08](/en/chapters/08-async.md) |
| Putting Nuxt on Workers | Nuxt on CloudFront and a regional Lambda | [09](/en/chapters/09-ssr.md) |
| Cloudflare Containers | ECS on Fargate and an ALB | [12](/en/chapters/12-containers.md) |
| Workers KV, Durable Objects, the rate limiting binding | DynamoDB, ElastiCache (Valkey), CloudFront KeyValueStore | [14](/en/chapters/14-kv-cache.md) |
| Email Service | SES | [15](/en/chapters/15-email.md) |
| Workflows | Step Functions, Lambda durable functions | [16](/en/chapters/16-long-jobs.md) |
| Stream Live | IVS | [18](/en/chapters/18-live.md) |
| Workers Logs and traces | CloudWatch and X-Ray | [19](/en/chapters/19-observability.md) |
| `wrangler deploy` and versions | CloudFormation, Lambda versions and aliases, OIDC | [20](/en/chapters/20-shipping.md) |
| Secret bindings, the WAF | Secrets Manager, AWS WAF | [21](/en/chapters/21-security.md) |
| D1 Time Travel | DynamoDB PITR, S3 versioning | [22](/en/chapters/22-recovery.md) |

Three names are easy to mix up.

Lambda durable functions and Durable Objects have similar names and are different things. Chapter 16 explains that the closer match for Lambda durable functions on the Cloudflare side is Workflows. Durable Objects appear in chapter 14, as a place to keep rate limit state. AWS has no component that corresponds to Durable Objects directly.

This guide does not map Workers KV onto any one of the three key-value stores on AWS. Chapter 14 goes through how each of them overlaps with it in a different way.

celld, the subject of chapter 24, is open-source software that runs Workers and Durable Objects applications on your own machines. It is not an AWS service, and the only thing the chapter compares is who operates it.

Every comparison in these chapters was written from reading Cloudflare's official documentation, not from using the product and checking. What could not be confirmed is written down as such in each chapter. Chapter 06 has a paragraph that mentions Cloudflare Access, which describes common setups without primary sources checked. Chapters 11 and 23 have no comparison, because we have not looked into whether Cloudflare has something that corresponds to a VPC or a virtual machine.

## Comparisons from chapter 25 on

From chapter 25 on, each chapter stands on its own, and most of them have a section on how the nearest Cloudflare and Vercel products differ. This section picks out the Cloudflare side and arranges it so that you can find a chapter from a product you know. The right-hand column is the difference, among those the chapter gives, that is most useful to know before you read. Each link goes to the page that holds the comparison.

In every chapter, what is said about Cloudflare comes from reading the official documentation. The pages were checked on 2026-10-12 or 2026-10-13, and each chapter says which. Where a chapter says it could not confirm something, this page says so too.

### Queues, events, and workflows

| What you know | Chapter | The difference the chapter gives |
| --- | --- | --- |
| Queues, handing one event to several receivers | [25](/en/chapters/25-events/wrap.md) | The documentation says a queue can have only one active consumer. To reach three receivers, the Worker that publishes sends to three queues. Within the pages the chapter read, it found nothing that corresponds to rules that route on content, or to archive and replay |
| Event subscriptions in Queues | [25](/en/chapters/25-events/wrap.md) | The name is close, but it is a different thing: a way to receive, on a queue, events that Cloudflare's own products raise. It corresponds to the events AWS services put on the default event bus |
| Delivery and ordering in Queues | [61](/en/chapters/61-sqs.md) | Queues delivers at least once and does not guarantee that messages arrive in the order they were published. Within what the chapter read, it found no kind of queue that keeps order. A delay can be up to 24 hours, which is more than the 15 minutes SQS allows |
| Queues, and streams in Basin Pipelines | [54](/en/chapters/54-kinesis.md) | The chapter says it found no part that corresponds directly to a Kinesis stream. A stream in Basin Pipelines plays a role close to Firehose in chapter 26, and the pages the chapter read had no API for application code to read again from a position of its choosing |
| Workflows | [47](/en/chapters/47-step-functions.md) | A Workflow is code with its steps wrapped in `step.do()`, and the documentation says rollback handlers run in the reverse of the order the steps started. Step Functions fits when what you call is an AWS service and you want to call its API directly, without a function |

### Databases and storage

| What you know | Chapter | The difference the chapter gives |
| --- | --- | --- |
| D1, and SQLite in Durable Objects | [30](/en/chapters/30-data-modeling.md) | In D1, `CREATE UNIQUE INDEX` keeps a value unique, and `batch()` runs as one transaction. DynamoDB has no `UNIQUE` constraint, so chapter 30 builds uniqueness from conditional writes and transactions. With SQLite in Durable Objects, the execution model gives you from the start the guarantee the chapter builds that way |
| Where D1, KV, Durable Objects, and R2 keep data | [28](/en/chapters/28-multi-region/wrap.md) | Only the code has no location; the data has one. D1 has the shape "writes in one place, reads everywhere". What D1 does when the primary's location becomes unavailable was not in the pages the chapter read, and the chapter did not check |
| Getting data out of D1 | [39](/en/chapters/39-database-migration.md) | DMS cannot be used to bring D1 data to AWS. What D1 offers is `wrangler d1 export`, and what it writes is SQLite's SQL. The chapter did not try converting that for PostgreSQL |
| Hyperdrive | [59](/en/chapters/59-rds.md), [60](/en/chapters/60-aurora/wrap.md) | Hyperdrive has no database of its own. It pools connections in front of a PostgreSQL or MySQL database you already have. Databases in AWS are included, so it is a way to use RDS or Aurora without leaving Workers. Neither chapter tried that setup |
| Renting D1 | [66](/en/chapters/66-distributed-sql.md) | Chapter 66 self-hosts a distributed database on EC2. The chapter says that if you rent one and have no trouble with it, keeping it is the right answer |
| Moving data between R2 and S3 | [38](/en/chapters/38-data-movement/wrap.md) | From S3 to R2, Cloudflare has Super Slurper and Sippy. From R2 to S3, DataSync works, with R2 registered as an object storage location |
| Bucket locks in R2 | [58](/en/chapters/58-ledger.md) | A rule can be removed from the dashboard or with Wrangler. The chapter found no mode in the documentation that even the bucket's owner cannot remove. The chapter says the behavior is close to governance mode in S3 Object Lock, and that it does not make a place for evidence that you yourself cannot delete |
| `node:fs` and `/tmp` in Workers | [53](/en/chapters/53-efs/wrap.md) | `node:fs` in Workers is a virtual file system in memory, and what is in `/tmp` does not persist and is separate for each request. The pages the chapter read had nothing like an NFS that several functions mount at once |
| Bindings | [48](/en/chapters/48-sdk.md) | With a binding, the order in which credentials are looked up, the signing, and the endpoint never come up as things to think about. Chapter 48 handles all of them through the SDK. The chapter did not check how much of retries and timeouts the platform takes on |

### Analytics and search

| What you know | Chapter | The difference the chapter gives |
| --- | --- | --- |
| Workers Analytics Engine | [26](/en/chapters/26-analytics/wrap.md) | Heavy writes are sampled, retention is three months, and a query reads one table only. Chapter 26's setup keeps every record that arrives and can join it with other tables. In exchange, you decide how the files are laid out and how duplicates are handled |
| Basin Pipelines, Basin SQL, Logpush | [26](/en/chapters/26-analytics/wrap.md), [49](/en/chapters/49-athena/wrap.md) | Basin Pipelines and Basin SQL used to be called Cloudflare Pipelines and R2 SQL. Basin SQL is an entry point for reading, and its SQL reference does not list `INSERT`, `UPDATE`, `DELETE`, `MERGE`, or `CREATE TABLE AS`. Athena handles writes and row-level changes with the same engine |
| Basin Catalog | [43](/en/chapters/43-glue/wrap.md) | Formerly R2 Data Catalog, it handles Iceberg tables only. Within the pages the chapter read, it found no runtime like a Glue job that rewrites files already written |
| Vectorize | [27](/en/chapters/27-search/wrap.md) | To filter on metadata, you have to create the metadata index before inserting the vectors. In S3 Vectors, metadata can be used for filtering without doing anything |
| AI Search | [27](/en/chapters/27-search/wrap.md) | Hybrid search is on by default, so the product has the rank fusion that chapter 27 writes itself. The chapter says AI Search takes far fewer steps from handing over documents to being able to search them. The chapter did not check what can be chosen as a source to ingest from |

### AI and calls

| What you know | Chapter | The difference the chapter gives |
| --- | --- | --- |
| Function calling, JSON Mode, prompt caching, and the Batch API in Workers AI | [36](/en/chapters/36-bedrock/wrap.md) | `runWithTools` writes the tool-calling loop for you. Decisions such as whether to retry a response that was cut off are made by the library. Chapter 36 puts those decisions in its own code and pins them with tests |
| AI Gateway | [36](/en/chapters/36-bedrock/wrap.md) | AI Gateway is a proxy that sits between the app and the model providers. Bedrock has no single product that corresponds to it. Caching in AI Gateway returns the same response for the same request, which is a different thing from prompt caching in chapter 36 |
| Agents, the Sandbox SDK | [50](/en/chapters/50-agentcore.md) | Agents maps each agent to a Durable Object. The unit of isolation is the Durable Object, not a microVM per session as in AgentCore |
| Sandbox | [63](/en/chapters/63-agent-sandbox.md) | The documentation says a Sandbox container is a microVM with its own kernel and network, and that the Worker decides whether it can reach the internet. On pricing and limits, the chapter read only the overview page |
| Image, video, and audio models in Workers AI | [56](/en/chapters/56-nova/wrap.md) | The chapter says that if all you want is to generate images, there is no reason to choose Nova today. Nova has no generation model, and the Workers AI catalog does. The chapter found no category for generating video in the catalog. The catalog was read in summary, and the chapter did not check it line by line |
| Text-to-speech in Workers AI | [57](/en/chapters/57-polly/wrap.md) | The models listed are Deepgram's `aura-1`, `aura-2-en`, and `aura-2-es`, and MyShell's `melotts`. The chapter did not confirm whether `melotts` can read Japanese |
| Realtime | [51](/en/chapters/51-chime-sdk.md) | With RealtimeKit, the backend creates the meeting and hands each participant's auth token to the client. That is the same division of roles as in chapter 51. The chapter does not quote RealtimeKit's prices |

### Where code runs

| What you know | Chapter | The difference the chapter gives |
| --- | --- | --- |
| Startup, memory, and billing in Workers | [29](/en/chapters/29-lambda-tuning/wrap.md) | Memory in Workers is 128 MB per isolate and cannot be chosen, and what is billed is the time the CPU was used. In Lambda you choose the memory, and time spent waiting is billed too. The chapter says about half of chapter 29 does not apply to Workers |
| One instance handling several requests | [35](/en/chapters/35-lambda-managed-instances.md) | The advice in Workers not to use global state is about the same kind of bug chapter 35 deals with. Where Lambda Managed Instances differs is that it costs money even when no requests come, and that the instances are in a VPC in your own account |
| Containers | [41](/en/chapters/41-fargate/wrap.md), [34](/en/chapters/34-eks/wrap.md) | By default a container sleeps after 10 minutes without use, and billing stops. The FAQ says there is no built-in autoscaling for stateless apps for now. Within what chapter 34 read, it found no service at Cloudflare that offers the Kubernetes API |
| Where Containers keeps images | [52](/en/chapters/52-ecr.md) | Images go into a registry that Cloudflare manages, and `wrangler deploy` does the build and the push. The chapter did not look into whether the registry has settings that correspond to lifecycle rules or scanning |
| workerd | [64](/en/chapters/64-isolates.md) | Chapter 64 runs workerd in your own AWS account. The locations around the world, the storage behind bindings, the per-request limits, and the layered security defenses are not in the workerd binary. In the example of 15 million requests a month, Workers comes to USD 8.00 and the chapter's setup to USD 39.02 |
| The isolate as a boundary | [67](/en/chapters/67-firecracker.md) | Chapter 67 sets the microVM that runs under Lambda and Fargate next to the isolate. The chapter says the difference is not which is better but what each promised to run |

### Deployment, operations, and protection

| What you know | Chapter | The difference the chapter gives |
| --- | --- | --- |
| Gradual deployments, version affinity, Flagship | [31](/en/chapters/31-progressive-delivery/wrap.md) | In Workers, one command puts percentages on two versions. The pages the chapter read said nothing about rolling back automatically on an error rate. Chapter 31's setup rolls back automatically when the alarm goes off |
| Workers limits, the Rate Limiting binding | [32](/en/chapters/32-limits/wrap.md) | Limits in Workers are values per plan, so there is one place to look. Limits in AWS are quotas per service, per account, and per Region. The Rate Limiting binding counts per location, and the documentation states that the count is not exact |
| Retention in Workers Logs | [33](/en/chapters/33-production-readiness.md) | Workers Logs keeps logs for 7 days at most, and the platform decides that. In AWS, a log group with no retention written stays forever. The chapter did not confirm whether Cloudflare publishes a pre-launch checklist |
| `wrangler login` and API tokens | [37](/en/chapters/37-cloudshell/wrap.md) | As far as the chapter checked, Cloudflare has no shell that opens inside the console and already holds the account's credentials. `wrangler` runs on your machine or in CI |
| Workers Builds | [62](/en/chapters/62-ci-runners/wrap.md) | The pages the chapter read had no way to supply your own build machines. The only page it read is the one on Workers Builds limits and pricing |
| Incident Alerts, Maintenance Notification | [44](/en/chapters/44-health/wrap.md) | In Cloudflare, subscribing to announced incidents is done entirely in the dashboard. In AWS, what arrives with no setup is only the email about events that concern your own resources. To receive announced incidents, you create a rule or a notification configuration yourself |
| DDoS mitigation | [46](/en/chapters/46-shield/wrap.md) | In Cloudflare, mitigation from layer 3 to layer 7 is included in every plan, Free among them. In AWS, Shield Standard takes layers 3 and 4, and for layer 7 you put the web ACL, the cache, and the brakes in place yourself |
| Account-level WAF | [42](/en/chapters/42-firewall-manager/wrap.md) | It creates rulesets on the account and applies them to several zones, and it needs the Enterprise plan. The chapter did not check whether the rules can apply across several accounts in an Organization |
| Not choosing a Region | [40](/en/chapters/40-disaster-recovery/wrap.md) | Workers has no server with a disk to replicate, and no Region that the developer picks and switches. The chapter says there is no experience there that corresponds to DRS in chapter 40 |

Some chapters from 25 on have no comparison. Chapter 45 wrote none, because Cloudflare has nothing that corresponds to a template and the chapter did not confirm what to compare against in a primary source. Chapter 55 does not mention Cloudflare either. Chapter 68 read a single page about Workers, and did not check whether Workers has anything that corresponds to an enclave.

## Where the Cloudflare statements come from

Every statement about Cloudflare on this page is one that a chapter makes, and no new claims are added here. The pages they are based on are listed, with the date checked, in "Verification notes for this chapter" in each chapter. The three paths start from the following pages, all checked on 2026-10-11.

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

This book does not include comparison code for the Cloudflare side, and there is no `wrangler` configuration in the repository. Every comparison is prose and tables written from reading the documentation.
