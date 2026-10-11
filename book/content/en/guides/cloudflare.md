---
title: Coming from Cloudflare
sourceRevision: 3
---

# Coming from Cloudflare

This guide is for people who have built things with Cloudflare D1, Workers, and Workers AI. It is not a migration manual. It is a route for finding out what a familiar job looks like on AWS, by building the same small feature.

Two things to say before we start.

A table that maps service names is only a starting point. Writing "the counterpart of D1 is Aurora DSQL" does not make the SQL dialect, the way it runs locally, or the consistency guarantees the same.

And for every path here, the text and the samples are written, but the checking stops at the local machine. Nothing has been deployed to AWS yet, not even once. What was checked for each chapter is in "Verification notes for this chapter" at the end of that chapter.

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

In chapter 04 you go through a small HTTP handler, a typed client, environment variable validation, local watch mode, tests, deployment, and checking the logs. The chapter ends with a table of differences from Workers. Here are the four that matter most.

First, the local runtime is different. With Workers, `wrangler dev` or the Vite plugin runs your code through Miniflare on the same runtime as production (workerd). `vp run dev:api` in chapter 04 is a Node.js HTTP server, not the Lambda runtime itself.

Next, there are no bindings. In Workers, you declare a binding in the configuration and use it from `env`, and locally it connects to a local simulation by default. On AWS, you call the service through the SDK, pass the target in an environment variable, and write the permissions into an IAM role. No local simulation comes as standard.

There are also two sets of permissions. When you run locally, the code runs with your own permissions. After deployment, it runs with the permissions of the function's execution role. An operation that succeeded locally can be denied after deployment.

Last, where the code runs. Lambda runs in one Region. Logic that runs close to your readers is the subject of chapter 10.

In chapter 10 you write one CloudFront Function. A redirect table, a feature flag that switches the home page, and a maintenance switch: all three live in CloudFront KeyValueStore, and the function reads them. The point is to flip them without deploying again.

Several things here feel different from Workers. The function can only read KeyValueStore. It cannot write. Writes come from outside, through a dedicated API. The chapter writes a script that sends only the difference from `edge-data.json`, and uses the ETag so that it never overwrites a change it has not seen. And a value you write takes time to reach the edge. How long, the Developer Guide does not say, as far as we could find.

For the jobs CloudFront Functions cannot do, the chapter also runs one Lambda@Edge function. It is a small one that returns the size and SHA-256 of a POSTed body. It can only be created in `us-east-1`, so it became a stack of its own, apart from the distribution and outside Tokyo.

Locally, you run the very file that gets deployed, under Node.js (`vp run dev:edge`). cdkd's emulator gave the same responses too (`vp run dev:edge:cdkd`). Both are stand-ins. The function has never run on the real CloudFront Functions runtime yet.

The chapter ends with a table that puts Workers, CloudFront Functions, and Lambda@Edge side by side. Here's the conclusion up front: CloudFront Functions is not a counterpart to Workers. It is an environment for rewriting URLs and headers, with no access to the network or the file system.

## If you're coming from D1

The reading order is 00 → 01 → 02 → 04 → 13. To follow recovery as well, go on to chapter 22 after that. Chapter 22 works on the notes and images from chapters 05 through 08, so it is easier if you read those first.

Chapter 13 stores the notes API from chapter 04 in SQL. The database is Aurora DSQL. It connects schema and migrations, typed queries, seed and reset, running locally, and connecting from Lambda.

Here are the differences worth knowing first.

- D1 is SQLite. And DynamoDB is not a SQL database. If you want to write SQL, go to chapter 13, not to DynamoDB in chapter 05
- Only Aurora DSQL is implemented. For RDS for PostgreSQL and Aurora Serverless v2, the chapter lays the differences out in a table and explains when you would pick them, and stops there. Neither was run. Both live inside a VPC, so choosing one brings in chapter 11
- The local substitute is PGlite, an npm package that runs PostgreSQL inside the Node.js process. No Docker needed. It is close to the way `wrangler dev` sets up a local D1, but local D1 is the same D1 as production, and this is only a substitute. It does not reproduce conflicts, authentication with an IAM token, or DSQL's limits (3,000 rows per transaction, one DDL statement at a time, indexes through `CREATE INDEX ASYNC`). The version differs too
- The conflicts that never happen locally are caused on purpose in the tests. A transaction that loses at commit gets `40001`, and the whole thing is redone. Writing that retry yourself is where it feels most different from D1's `batch()`
- Migrations are numbered `.sql` files run by a small runner written in the chapter. One statement per file, shaped so that they can be run again after stopping partway. No ORM and no general-purpose migration tool was run in this chapter
- Backup and restore are explanation only in chapter 13. It says that Aurora DSQL backups go through AWS Backup and that a restore always creates a new cluster, but it creates no resources for this, and the procedure has not been tried

The code has never been connected to a real cluster. Whether DSQL accepts this chapter's SQL is among the things still unchecked.

Chapter 22 is the recovery chapter. Its subject is not Aurora DSQL, though. It is DynamoDB point-in-time recovery and S3 versioning. It causes an accident, restores the table and the bucket to different points in time, checks for the mismatch, and repairs it. Locally, the whole thing runs in memory.

The chapter sets this next to D1's Time Travel. Time Travel restores by overwriting the database in place. DynamoDB PITR always creates a new table. So the job of switching over is left to you, and in exchange you can put the new table next to the original and count the differences before you decide.

## If you're coming from Workers AI

The reading order is 00 → 01 → 02 → 04 → 17.

Chapter 17 starts by calling a model once in a few lines. Then it builds an API that summarizes the body of a note and returns the summary a little at a time, as it is produced.

- On both platforms, inference does not run on your machine. Cloudflare's documentation says that Workers AI has no local simulation and that models always run remotely. Bedrock is the same. Even when the API server runs on your machine, model calls reach AWS and are billed
- So the tests and the default dev server (`vp run dev:ai`) replay a fixed sequence of events (a fixture) and never call a model. Calling a real model is the job of two separate tasks, `ai:hello` and `ai:test:live`, which the usual `check:all` does not call. Neither has been run yet
- The entry point for streaming is a Lambda function URL. API Gateway HTTP API in chapter 04 waits for Lambda's whole response before returning it, so it cannot return a little at a time. The only authentication a function URL has of its own is IAM signing, so the caller sends signed requests
- With Workers AI, passing `stream: true` gives you `text/event-stream`, which you can return as the response as it is. Bedrock's `ConverseStream` returns a sequence of events as an async iterable in the SDK. Turning that into server-sent events is your job
- A stream gets cut off partway. Chapter 17 decides that output which never received `done` is not treated as a finished summary, and checks it with a test that truncates the response one byte at a time

Whether the stream arrives a little at a time from the deployed function through the function URL has not been seen yet. What was checked locally is the relay when a fixture is replayed, and what happens when the stream is cut.

## Other chapters have comparisons too

Besides the three paths, more chapters set their subject next to a Cloudflare product. Here they are together, so that you can look one up from what you already know.

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

Three names that are easy to mix up.

Lambda durable functions and Durable Objects have similar names and are different things. Chapter 16 explains that the closer match on the Cloudflare side is Workflows. Durable Objects appear in chapter 14, as a place to keep a rate limit. AWS has no component that corresponds to them directly.

This guide does not map Workers KV onto any one of the three key-value stores on AWS. Chapter 14 goes through how each of them overlaps with it in a different way.

celld, the subject of chapter 24, is open-source software that runs Workers and Durable Objects applications on your own machines. It is not an AWS service, and the only thing the chapter compares is who operates it.

Every comparison in these chapters comes from reading Cloudflare's official documentation, not from using the product and checking. What could not be confirmed is written down as such in each chapter. Chapter 06 has a paragraph that mentions Cloudflare Access, but that one is about common setups, without primary sources checked. Chapters 11 and 23 have no comparison, because nobody looked into whether Cloudflare has an experience that corresponds to a VPC or a virtual machine.

## Where the Cloudflare statements come from

Every statement about Cloudflare on this page is one that a chapter makes. No new claims are added here. The pages they are based on are listed, with the date checked, in "Verification notes for this chapter" in each chapter. The three paths start from the following pages. All were checked on 2026-10-11.

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

This book does not include comparison code for the Cloudflare side. There is no `wrangler` configuration in the repository either. Every comparison is prose and tables written from reading the documentation.
