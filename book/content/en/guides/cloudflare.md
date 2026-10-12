---
title: Coming from Cloudflare
sourceRevision: 3
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

Besides the three paths, more chapters explain their subject next to a Cloudflare product. This table collects them so that you can look one up from what you already know.

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

## Where the Cloudflare statements come from

Every statement about Cloudflare on this page is one that a chapter makes, and no new claims are added here. The pages they are based on are listed, with the date checked, in "Verification notes for this chapter" in each chapter. The three paths start from the following pages, all checked on 2026-10-11.

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

This book does not include comparison code for the Cloudflare side, and there is no `wrangler` configuration in the repository. Every comparison is prose and tables written from reading the documentation.
