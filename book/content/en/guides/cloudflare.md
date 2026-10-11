---
title: Coming from Cloudflare
sourceRevision: 1
---

# Coming from Cloudflare

This guide is for people who have built things with Cloudflare D1, Workers, and Workers AI. It is not a migration manual. It is a route for finding out what a familiar job looks like on AWS by building the same small feature.

Two things to say up front.

- **A table that maps service names is only a starting point.** Writing "the counterpart of D1 is Aurora DSQL" does not make the SQL dialect, the way it runs locally, or the consistency guarantees the same.
- **Of the three paths, only the first half of the Workers path is written.** The rest is planned, and the table below gives the status of each.

## Three paths

| What you know | What you build on AWS | Chapter | Status |
| --- | --- | --- | --- |
| Writing HTTP handlers in Workers | Lambda and API Gateway HTTP API | [04](/en/chapters/04-http-api.md) | Text and samples exist. Verified locally, unverified in AWS |
| Writing edge logic in Workers | CloudFront Functions, Lambda@Edge | [10](/en/chapters/10-edge.md) | planned |
| Writing SQL with D1 | Aurora DSQL, RDS PostgreSQL, Aurora Serverless v2 | [13](/en/chapters/13-sql.md) | planned |
| Calling models with Workers AI | Amazon Bedrock | [17](/en/chapters/17-ai.md) | planned |

Every path requires [chapter 01](/en/chapters/01-account.md) and [chapter 02](/en/chapters/02-toolchain.md).

Each path moves through the same five stages: try it locally, test it, set up the release procedure, observe it, and clean up.

## The Workers path

The reading order is 00 → 01 → 02 → 04 → 10.

Chapter 04 goes through a small HTTP handler, a typed client, environment variable validation, local watch mode, tests, deployment, and checking the logs. The chapter ends with a table of differences from Workers. The main points are these.

**The local runtime is different.** With Workers, `wrangler dev` or the Vite plugin runs your code through Miniflare on the same runtime as production (workerd). `vp run dev:api` in chapter 04 is a Node.js HTTP server, not the Lambda runtime itself.

**There are no bindings.** In Workers, you declare a binding in the configuration and use it from `env`, and locally it connects to a local simulation by default. On AWS, you call the service through the SDK, pass the target in an environment variable, and write the permissions into an IAM role. No local simulation comes as standard.

**There are two sets of permissions.** When you run locally, the code runs with your own permissions. After deployment, it runs with the permissions of the function's execution role. An operation that succeeded locally can be denied after deployment.

**The code runs in a different place.** Lambda runs in one Region. Logic you want to run close to your readers is the subject of chapter 10, but CloudFront Functions is not a counterpart to Workers. It is an environment for rewriting URLs and headers, with no access to the network or the file system.

## The D1 path (planned)

The planned reading order is 00 → 01 → 02 → 04 → 13 → 22. If you also want to try RDS or Aurora Serverless v2, you need chapter 11 before chapter 13.

Chapter 13 is planned to connect schema and migrations, typed CRUD, seed and reset, local tests, migrations against a real environment, and backup and restore.

These are the differences already known before writing.

- **D1 is SQLite. DynamoDB is not a SQL database.** If you want to write SQL, go to chapter 13 and not to DynamoDB in chapter 05.
- **D1 local development runs in an environment contained on your machine.** According to Cloudflare's documentation, `wrangler dev` uses a local-only D1 by default, the data persists across runs, and it is separate from production data. AWS's SQL services do not come with a "local version" of the same shape. Chapter 13 uses a local PostgreSQL as a substitute, but it is a substitute and does not reproduce Aurora DSQL's authentication, conflicts, or distributed transactions.
- **There is more than one candidate.** You choose among Aurora DSQL, RDS for PostgreSQL, and Aurora Serverless v2 by SQL compatibility, authentication, connection method, transactions, and cost while idle. Aurora DSQL is not fully identical to PostgreSQL, so whether it supports the SQL and the migration tool to be used will be checked at the time of writing.

## The Workers AI path (planned)

The planned reading order is 00 → 01 → 02 → 04 → 17.

Chapter 17 is planned to start from a call of a few lines and build an API that returns a streamed summary of a note.

- **On both platforms, inference does not run on your machine.** Cloudflare's documentation says that Workers AI has no local simulation and that models always run remotely. Bedrock is the same: even when the API server runs on your machine, model calls reach AWS and are billed.
- **Tests use fixtures.** Checks that call a real model are split into a separate `vp run` task and are not called from the usual `check:all`.
- **Streaming is checked across the whole path.** Even if the model API supports streaming, the response does not reach the reader as a stream unless every entry point along the way supports it too. For example, API Gateway HTTP API in chapter 04 does not support response streaming.

## Verification status for this guide

The statements about Cloudflare are based on the following pages. All were checked on 2026-10-11.

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

This book does not include comparison code for the Cloudflare side. In a chapter that does include it, the complete source, including the `wrangler` configuration, will be placed in the same repository.
