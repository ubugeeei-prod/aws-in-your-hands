---
title: "05 KV Store: Costs, Pitfalls, and Cleanup"
---

# 05 KV Store: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers the requirements DynamoDB doesn't suit, what this setup costs, where people get stuck, what to change before production, and how to clean up.

## When DynamoDB doesn't fit

<!-- section: 05.fit -->

This chapter's design worked because there were only two ways of reading. DynamoDB becomes hard to work with when requirements like these come up.

- Queries that are added later and weren't decided in advance. Conditions such as "notes whose body contains a certain word" or "notes updated last month, for all owners" are not in the key, so they mean reading the whole table
- Aggregations and joins across several kinds of data
- Constraints that span several items. A rule such as "at most 100 notes per user" can't be kept by a conditional write on the note alone. This chapter handled it with a count kept in a separate item, but because the place and the note are written separately, the two can get out of step. Transactions exist, but they limit the number and size of items they handle at once

There is also a limit of 400 KB per item. Large data such as images doesn't go in an item. It goes in S3 ([chapter 07](/en/chapters/07-uploads.md)).

If requirements like these are central, a SQL database handles them more naturally. [Chapter 13](/en/chapters/13-sql.md) compares Aurora DSQL, RDS for PostgreSQL, and Aurora Serverless v2. If you're used to D1, those will feel closer to it. DynamoDB isn't D1 without SQL. It's a different kind of database.

### If you want it in several Regions

DynamoDB has a feature called global tables, which keeps replicas of a table in several Regions. This book doesn't implement it, but here is what to check when you choose it.

According to the official documentation (the read consistency page), global tables have two consistency modes. In the default mode, changes are usually replicated to the other Regions within 1 second, and across Regions the table is eventually consistent. In the other mode, a write is replicated synchronously to another Region before it returns its response.

Whether this chapter's optimistic locking holds unchanged should depend on the mode. In the default mode, changes are replicated asynchronously, so the evaluation of a condition in one Region may not yet see a write made a moment ago in another Region. This is an inference from the description of replication, and it has not been confirmed directly in the official documentation. Either way, don't assume from the name "global" that conditional writes take effect across Regions. Before using global tables, check the mode, the supported Regions, and the scope of transactions in the official documentation as it stands at that time.

## Costs

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

While nobody uses it, the only charge is for the table's storage. In the Tokyo Region the first 25 GB is free, and anything beyond that is USD 0.285 per GB per month. This free amount is listed as a tier in the published price list. If the notes take up 10 MB, the charge is 0.

Once the table is used, usage is counted in read and write units.

| Item | Unit price | How it is counted |
| --- | --- | --- |
| Writes (write request unit) | USD 0.715 per 1 million | 1 for writing one item of up to 1 KB |
| Reads (read request unit) | USD 0.1425 per 1 million | For one item of up to 4 KB, 1 if strongly consistent and 0.5 if eventually consistent |

The calculation below is for 1 million requests per month. The breakdown is 70% lists, 20% reads of one note, 8% creates and updates, and 2% deletes, and each list reads 20 KB with eventual consistency. Lambda runs at 256 MB on arm64, with an assumed average duration of 60 milliseconds, longer than in chapter 04 by the time spent calling DynamoDB. That figure is not a measurement.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| API Gateway HTTP API | 1 million | 1.29 | 1.29 (a free allowance could not be confirmed, so none is subtracted) |
| Lambda requests and duration | 1 million, 15,000 GB-seconds | 0.40 | 0 |
| CloudWatch Logs | 0.477 GB | 0.37 | 0 |
| DynamoDB reads | 1.95 million units | 0.28 | 0.28 |
| DynamoDB writes | 100,000 units | 0.07 | 0.07 |
| DynamoDB storage | 1 GB | 0.00 | 0.00 |
| Subtotal | | **2.41** | **1.64** |

The part of this calculation that is easiest to move is the list reads. Of the DynamoDB read request units that the 1 million requests use, lists account for 90%. Reducing the number of notes per page brings that down. Leaving the body out of the response does not, because the repository reads each item with its body. Making the list strongly consistent would double the reads row.

An update that is rejected because of a conflict also consumes write request units. This calculation assumes there are no conflicts.

This table still counts the way it did before the limit on notes went in. With the limit, a create and a delete each add one write to the item that holds the count. With this breakdown, that adds at most 100,000 units, or USD 0.07.

Two things are left out of this table: the data transfer charge for responses, and point-in-time recovery. When enabled, point-in-time recovery adds a storage charge of USD 0.228 per GB per month. It is disabled in this chapter.

### When it gets hammered

Anyone who knows the URL can call the API as often as they like. Four things stand in the way: the stage's throttling (10 requests a second for the whole API), the table's caps (150 read units and 40 write units a second), the cap on notes (100), and the cap on response size (20 KiB for a list, 64 KiB for one note).

10 requests a second for 30 days is 25.92 million requests. With the same assumptions as the table above, the list price comes to the following. The DynamoDB reads and writes rows assume the table is used up to its caps for the whole 30 days, which is the ceiling you would reach if every read and write were of large notes.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration (388,800 GB-seconds) | 10.37 |
| CloudWatch Logs (12.36 GB) | 9.49 |
| DynamoDB reads (388.8 million units) | 55.40 |
| DynamoDB writes (103.68 million units) | 74.13 |
| DynamoDB storage (100 notes) | 0.00 |
| Total | **182.83** |

That is about USD 183 a month. Even if the throttling turned out not to be in effect, the DynamoDB part stops at the bottom three rows, USD 129.53. The API Gateway and Lambda parts would not stop.

What this table leaves out is the same as in chapter 04. Data transfer for the responses is calculated the same way: a list is at most 20 KiB, which is about USD 56 over 30 days, and if all 25.92 million responses were one 64 KiB note it would be about USD 180. A list of the largest notes reads about 77 units at once, so the table's read cap should take effect first and let only about two such lists through a second, but that hasn't been checked. The 60-millisecond duration is an assumption as well. When the table's cap is hit, the SDK retries, and the duration grows by that much.

The limit on notes comes with two caveats. Everyone is the same owner (`anonymous`) for now, so the 100 is 100 for the whole API. If somebody fills it, nobody else can create a note. Anyone can also delete notes. The volume is limited, but the API can't yet tell whose note is whose. Chapter 06 adds that.

To stop one IP address at a time you would use AWS WAF, but it can't be attached to an HTTP API, so you would put CloudFront in front. The web ACL in [chapter 21](/en/chapters/21-security.md) costs USD 8.00 a month plus USD 0.60 per million requests. This book doesn't build that setup.

Delete the stack and the table is deleted with it, and nothing remains.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:notes` stops with `Invalid environment` and shows `NOTES_STORE` | Check that `examples/05-dynamodb/.env` exists |
| It starts with `NOTES_STORE=dynamodb` and the first request is a 500 | Check that DynamoDB Local is running (`db:local:start`) and that you created the table (`db:migrate:local`), and look for `ResourceNotFoundException` in the logs |
| After deployment, a 500 with `AccessDeniedException` in the logs | The code is calling an operation that isn't in the execution role. The message shows the operation name (such as `dynamodb:Scan`) and the table's ARN |
| After deployment, a 500 with `ResourceNotFoundException` in the logs | The table that `TABLE_NAME` points to doesn't exist. Check that you aren't looking at a different Region |
| Every update is a 409 | Check that the `expectedVersion` you send is the `version` of the note you received most recently. Use the value from the response to the last update, not from the creation response |
| A note you created doesn't appear in the list right afterwards | This can happen with eventually consistent reads, as "Choose the read consistency" on the [Design and Build](/en/chapters/05-dynamodb/build.md) page explains |
| The list ends partway through | Check that you are reading until `nextCursor` is `null` |
| `GET /notes?limit=100` answers 400, or the notes in a list have no `body` | A page holds at most 20 notes, and a list carries no bodies. Fetch the rest with `nextCursor`, and a body with `GET /notes/:id` |
| The logs show errors that indicate throttling | This stack caps the table (150 read units and 40 write units a second). Reading and writing large notes in a row will hit the cap. Separately, a new on-demand table has an initial limit on the volume of requests it can accept |
| A 429 like `{"message":"Too Many Requests"}` comes back | That is the stage's throttling. The whole API went past 10 requests a second. It happens because of somebody else's requests too, not only yours |
| `POST /notes` answers 409 with `quota_exceeded` | There are 100 notes. Delete one and there is room. If deleting doesn't help, the `noteCount` in the item that holds the count (`sk` is `QUOTA`) has ended up higher than the real number |

## If you take this to production

- Add authentication and separation between owners. Right now everyone reads and writes the same notes, and anyone can delete them (chapter 06)
- Protect the table. Set `removalPolicy` to `RETAIN`, and enable deletion protection and point-in-time recovery. [Chapter 22](/en/chapters/22-recovery.md) practices restoring data deleted by mistake
- Fit the throttling and the table's caps to your API. The stage's 10 a second and the table's 150 and 40 are values for practice. When you raise them, redo the arithmetic in "When it gets hammered"
- Move the body into its own item. The list response leaves the body out, but the list still reads it from DynamoDB. To bring the list's read charges down, store the body in a separate item
- Make creation idempotent, which fixes the duplicate notes caused by retries. The caller sends a value such as an `Idempotency-Key`, and the server writes conditionally with that value as the key. This book doesn't implement it. [Chapter 08](/en/chapters/08-async.md) uses the same idea in the worker that processes S3 events
- Watch throttling and failures. Look at DynamoDB errors and the proportion of 409s ([chapter 19](/en/chapters/19-observability.md)). A high proportion of 409s is a signal to reconsider how the screen is built or how notes are divided up
- Deploy through the AWS CDK CLI and CloudFormation, as chapter 02 explained

## Clean up

<!-- section: 05.cleanup -->

```bash
vp run notes:infra:destroy
vp run db:local:stop
```

`notes:infra:destroy` deletes the table, the function, the role, the API, and the log group. This stack takes no backups, so every note in the table is deleted too and can't be restored.

`db:local:stop` removes the local DynamoDB Local container. The container is started with a setting that keeps the data in memory, so the contents go with it.

All that remains is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

::: details Verification notes for this chapter

**Checked locally.** The contract tests (in memory), the inspection of the requests sent to DynamoDB, the app and client tests, and the infrastructure assertions were run. Type checking passed, and so did synth of a bundle that includes the AWS SDK. `dev:notes` was started in memory and the `curl` commands from the text were run. Tests pin the list: it returns no body, a page stops at 20 notes, and it stays under 20 KiB with the largest titles. After the limit on notes went in, the 15 tests in `test/dynamodb-local.test.ts` (10 for the repository's rules, 5 for the limit) were run against DynamoDB Local 3.3.1. That run did not use Docker. The jar AWS distributes was started directly with Java, and the table was created with `scripts/local-db.ts migrate`.

**Not checked yet.** The tasks that run DynamoDB Local in Docker (`db:local:start`, `db:local:stop`) were not run, because a Docker daemon was not available. `db:migrate:local`, `db:seed:local`, `db:reset:local`, and `test:local:dynamodb` were not run as tasks either. `notes:infra:diff`, `notes:infra:deploy`, `notes:smoke`, `notes:infra:drift`, and `notes:infra:destroy` have not been run against real AWS either.

So the central claim of this chapter, that "a conditional write lets through exactly as many concurrent writes as it should", has never been checked on the real DynamoDB. What has been checked is that the right condition expressions are sent, and that the in-memory implementation and DynamoDB Local follow the same rules. The statements about DynamoDB's behavior are based on the official documentation.

The table's caps and the stage's throttling are in the same state. Tests pin `OnDemandThroughput` and the stage's `DefaultRouteSettings` in the template, and the source of the pinned cdkd (0.296.28) was read and passes both on to the AWS APIs. That they take effect, the error returned when the table's cap is hit and how the SDK retries it, whether a single read or write larger than the cap gets through, and whether a 429 is charged for were not checked. The amounts in "When it gets hammered" are computed from unit prices and settings, not measured under load.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Derive the keys from how you read | `examples/05-dynamodb/src/dynamodb-repository.ts`, `src/id.ts`, `src/notes.ts` | `test:unit` |
| Add a version to the contract | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| Replace the store | `examples/05-dynamodb/src/repository.ts`, `src/memory-repository.ts`, `src/dynamodb-repository.ts`, `src/compose.ts` | `test:unit` |
| Prevent overwrites with conditional writes; Put a limit on the count | `examples/05-dynamodb/src/dynamodb-repository.ts`, `src/memory-repository.ts`, `src/notes.ts`, `src/app.ts`, `src/contract.ts`, `test/repository-contract.ts`, `test/dynamodb-repository.test.ts` | `test:unit` |
| Choose the read consistency | `examples/05-dynamodb/src/dynamodb-repository.ts`, `test/dynamodb-repository.test.ts` | `test:unit` |
| Page through without dropping items | `examples/05-dynamodb/src/repository.ts`, `src/app.ts`, `src/contract.ts`, `test/app.test.ts` | `test:unit` |
| When the response never arrives | `examples/05-dynamodb/src/client.ts`, `test/app.test.ts` | `test:unit` |
| Run it on your machine | `examples/05-dynamodb/src/dev.ts`, `src/env.ts`, `test/env.test.ts`, `scripts/local-db.ts`, `test/fixtures/seed-notes.json`, `.env.example` | `dev:notes`, `db:local:start`, `db:migrate:local`, `db:seed:local`, `db:reset:local`, `db:local:stop` |
| Tests | `examples/05-dynamodb/test/`, `scripts/test-local.ts` | `test:unit`, `test:local:dynamodb` |
| Getting ready for AWS | `examples/05-dynamodb/infra/lib/notes-stack.ts`, `infra/bin/app.ts`, `infra/test/notes-stack.test.ts`, `cdk.json` | `notes:infra:synth`, `test:unit` |
| Deploy it and check | `examples/05-dynamodb/src/lambda.ts`, `scripts/smoke.ts`, `tools/src/infra/` | `notes:infra:diff`, `notes:infra:deploy`, `notes:smoke`, `notes:infra:drift` |
| Clean up | `tools/src/infra/` | `notes:infra:destroy`, `db:local:stop` |
| Costs | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

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
