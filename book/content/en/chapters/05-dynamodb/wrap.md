---
title: "05 KV Store: Costs, Pitfalls, and Cleanup"
---

# 05 KV Store: Costs, Pitfalls, and Cleanup

## When DynamoDB doesn't fit

<!-- section: 05.fit -->

This chapter's design worked because there were only two ways of reading. DynamoDB becomes a struggle when requirements like these come up.

- Queries that are added later and aren't decided in advance. Conditions such as "notes whose body contains a certain word" or "notes updated last month, for all owners" are not in the key, so they mean reading the whole table
- Aggregations and joins across several kinds of data
- Constraints that span several items. A rule such as "at most 100 notes per user" can't be kept by a conditional write on one item. There is a transaction feature, but it has limits on the number and size of items it can handle at once

There is also a limit of 400 KB per item. Large data such as images doesn't go in an item; it goes in S3 ([chapter 07](/en/chapters/07-uploads.md)).

If requirements like these are central, a SQL database is the more straightforward choice. [Chapter 13](/en/chapters/13-sql.md) compares Aurora DSQL, RDS for PostgreSQL, and Aurora Serverless v2. If you're used to D1, that should be the closer experience. DynamoDB isn't "D1 without SQL". It's a different kind of tool.

### If you want it in several Regions

DynamoDB has a feature called global tables, which keeps replicas of a table in several Regions. This book doesn't implement it, but here is what to check when you choose it.

According to the official documentation (the read consistency page), global tables have two consistency modes. In the default mode, changes are usually replicated to the other Regions within 1 second, and across Regions the table is eventually consistent. In the other mode, a write is replicated synchronously to another Region before it returns its response.

Whether this chapter's optimistic locking holds unchanged should depend on the mode. In the default mode, changes are replicated asynchronously, so the evaluation of a condition in one Region may not yet see a write that was made a moment ago in another Region. This is an inference from the description of replication; it has not been confirmed directly in the official documentation. Either way, don't assume from the name "global" that conditional writes take effect across Regions. Before using it, check the mode, the supported Regions, and the scope of transactions in the official documentation as it stands at that time.

## Let's talk money

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

While nobody uses it, the only charge is the table's storage. In the Tokyo Region the first 25 GB is free, and anything beyond that is USD 0.285 per GB per month. This free amount is listed as a tier in the published price list. If the notes take up 10 MB, the charge is 0.

Once it is used, usage is counted in units of reads and writes.

| Item | Unit price | How it is counted |
| --- | --- | --- |
| Writes (write request unit) | USD 0.715 per 1 million | 1 for writing one item of up to 1 KB |
| Reads (read request unit) | USD 0.1425 per 1 million | For one item of up to 4 KB, 1 if strongly consistent and 0.5 if eventually consistent |

Let's work it out for 1 million requests per month. The breakdown is 70% lists, 20% reads of one note, 8% creates and updates, and 2% deletes, and each list reads 20 KB with eventual consistency. Lambda runs at 256 MB on arm64, with an assumed average duration of 60 ms, longer than in chapter 04 by the time spent calling DynamoDB. That figure is not a measurement.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| API Gateway HTTP API | 1 million | 1.29 | 1.29 (a free allowance could not be confirmed, so none is subtracted) |
| Lambda requests and duration | 1 million, 15,000 GB-seconds | 0.40 | 0 |
| CloudWatch Logs | 0.477 GB | 0.37 | 0 |
| DynamoDB reads | 1.95 million units | 0.28 | 0.28 |
| DynamoDB writes | 100,000 units | 0.07 | 0.07 |
| DynamoDB storage | 1 GB | 0.00 | 0.00 |
| Subtotal | | **2.41** | **1.64** |

The part of this calculation that is easiest to move is the list reads. Out of the 1 million requests overall, lists use 90% of the DynamoDB read request units. Reducing the number of notes per page, or leaving the body out of the list, brings it down. Going the other way, making the list strongly consistent doubles this row.

An update that is rejected because of a conflict also consumes write request units. This calculation assumes no conflicts.

Two things are left out of this table: the data transfer charge for responses, and point-in-time recovery (when enabled, it adds a storage charge of USD 0.228 per GB per month; it is disabled in this chapter).

Delete the stack and the table is deleted with it. Nothing remains.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:notes` stops with `Invalid environment` and shows `NOTES_STORE` | Does `examples/05-dynamodb/.env` exist? |
| It starts with `NOTES_STORE=dynamodb` and the first request is a 500 | Is DynamoDB Local running (`db:local:start`)? Did you create the table (`db:migrate:local`)? Look for `ResourceNotFoundException` in the logs |
| After deployment, a 500 with `AccessDeniedException` in the logs | The code is calling an operation that isn't in the execution role. The message shows the operation name (such as `dynamodb:Scan`) and the table's ARN |
| After deployment, a 500 with `ResourceNotFoundException` in the logs | The table that `TABLE_NAME` points to doesn't exist. Are you looking at a different Region? |
| Every update is a 409 | Is the `expectedVersion` you send the `version` of the note you received most recently? Use the value from the response to the last update, not from the creation response |
| A note you created doesn't appear in the list right afterwards | This can happen with eventually consistent reads, as "Choose the read consistency" explains |
| The list ends partway through | Are you reading until `nextCursor` is `null`? |
| The logs show errors that indicate throttling | A new on-demand table has an initial limit on the traffic it can accept. Are you sending a large amount of traffic all at once? |

## If you take this to production

- **Add authentication and separation between owners.** Right now everyone reads and writes the same notes (chapter 06)
- **Protect the table.** Set `removalPolicy` to `RETAIN`, and enable deletion protection and point-in-time recovery. The procedure for restoring data deleted by accident is practiced in [chapter 22](/en/chapters/22-recovery.md)
- **Set a limit on traffic.** An on-demand table lets you set maximum reads and writes per second. A public API with no limit has no limit on its cost either
- **Make creation idempotent.** This fixes the duplicates caused by retries. The caller sends a value such as an `Idempotency-Key`, and the server writes conditionally with that as the key. This book doesn't implement it. [Chapter 08](/en/chapters/08-async.md) uses the same idea in the worker that processes S3 events
- **Watch throttling and failures.** Look at DynamoDB errors and the proportion of 409s ([chapter 19](/en/chapters/19-observability.md)). A high proportion of 409s is a signal to reconsider how the screen is built or how notes are divided up
- **Deploy through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Clean up

<!-- section: 05.cleanup -->

```bash
vp run notes:infra:destroy
vp run db:local:stop
```

`notes:infra:destroy` deletes the table, the function, the role, the API, and the log group. All the notes in the table are deleted too, and they can't be restored. This stack takes no backups, so that's the one thing to be careful about.

`db:local:stop` removes the local DynamoDB Local container. It is started with a setting that keeps the data in memory, so the contents go with it.

All that remains is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

::: details Verification notes for this chapter

**Checked locally.** The contract tests (in memory), the inspection of the requests sent to DynamoDB, the app and client tests, and the infrastructure assertions. Type checking. Synth (a bundle that includes the AWS SDK). Starting `dev:notes` in memory and running the `curl` commands from the text.

**Not checked yet.** The tasks that use DynamoDB Local (`db:local:start`, `db:migrate:local`, `db:seed:local`, `db:reset:local`, `db:local:stop`, `test:local:dynamodb`) were not run, because a Docker daemon was not available at the time of writing. `notes:infra:diff`, `notes:infra:deploy`, `notes:smoke`, `notes:infra:drift`, and `notes:infra:destroy` have not been run against real AWS either.

So the central claim of this chapter, that "a conditional write lets exactly one of several concurrent updates through", has never been checked on DynamoDB. What has been checked is that the right condition expressions are sent and that the in-memory implementation follows the same rules. The statements about DynamoDB's behavior are based on the official documentation.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Derive the keys from how you read | `examples/05-dynamodb/src/dynamodb-repository.ts`, `src/id.ts`, `src/notes.ts` | `test:unit` |
| Add a version to the contract | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| Swap the storage | `examples/05-dynamodb/src/repository.ts`, `src/memory-repository.ts`, `src/dynamodb-repository.ts`, `src/compose.ts` | `test:unit` |
| Prevent overwrites: conditional writes | `examples/05-dynamodb/src/dynamodb-repository.ts`, `src/app.ts`, `test/repository-contract.ts`, `test/dynamodb-repository.test.ts` | `test:unit` |
| Choose the read consistency | `examples/05-dynamodb/src/dynamodb-repository.ts`, `test/dynamodb-repository.test.ts` | `test:unit` |
| Page through without dropping items | `examples/05-dynamodb/src/repository.ts`, `src/app.ts`, `src/contract.ts`, `test/app.test.ts` | `test:unit` |
| When the response never arrives | `examples/05-dynamodb/src/client.ts`, `test/app.test.ts` | `test:unit` |
| Run it on your machine | `examples/05-dynamodb/src/dev.ts`, `src/env.ts`, `test/env.test.ts`, `scripts/local-db.ts`, `test/fixtures/seed-notes.json`, `.env.example` | `dev:notes`, `db:local:start`, `db:migrate:local`, `db:seed:local`, `db:reset:local`, `db:local:stop` |
| Tests | `examples/05-dynamodb/test/`, `scripts/test-local.ts` | `test:unit`, `test:local:dynamodb` |
| Getting ready for AWS | `examples/05-dynamodb/infra/lib/notes-stack.ts`, `infra/bin/app.ts`, `infra/test/notes-stack.test.ts`, `cdk.json` | `notes:infra:synth`, `test:unit` |
| Deploy it and check | `examples/05-dynamodb/src/lambda.ts`, `scripts/smoke.ts`, `tools/src/infra/` | `notes:infra:diff`, `notes:infra:deploy`, `notes:smoke`, `notes:infra:drift` |
| Clean up | `tools/src/infra/` | `notes:infra:destroy`, `db:local:stop` |
| Let's talk money | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [DynamoDB condition expression CLI example](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Paginating table query results in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)
- [DynamoDB on-demand capacity mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)
- [Constraints in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)
- [Cloudflare D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
