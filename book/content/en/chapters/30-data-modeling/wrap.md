---
title: "30 Data Modeling: Costs, Pitfalls, and Cleanup"
---

# 30 Data Modeling: Costs, Pitfalls, and Cleanup

This is the last page of the chapter: what this design costs, where it tends to go wrong, what to change before production, and how to clean up.

## Cost

<!-- section: 30.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The inputs and unit prices are in [Pricing calculations](/en/reference/pricing.md).

The default stack has nothing billed by the hour. In a month when nobody uses it, the only charge is storage for the table and the index, and the first 25 GB are USD 0 in the price list. For 10 MB that is **USD 0.00**. A stream costs nothing for being enabled. According to the pricing page, reads of the stream made by Lambda through an event source mapping are not charged either (functions on Lambda Managed Instances are the exception). Reading it any other way is charged per read request.

In use, the cost is read and write units. The unit prices are chapter 05's: USD 0.715 per million write units and USD 0.1425 per million read units. What changed in this chapter is how many units one operation uses.

| Operation | Table | Index | Total |
| --- | --- | --- | --- |
| Create a note (three tags) | 10, a transaction of 5 items | 1 | 11 |
| Edit the body | 1 | 2 | 3 |
| Change the title (three tags) | 8, a transaction of 4 items | 2 | 10 |
| Add an attachment | 4, a transaction of 2 items | 0 | 4 |
| Apply one tag change to the count (stream function) | 4, a transaction of 2 items | 0 | 4 |

These hold while every item is 1 KB or less. A note with a long body adds to the table column for each further kilobyte. The 4 for an attachment counts the `ConditionCheck` as two writes; whether it is billed that way was not confirmed.

Take one million operations a month: 60% recent list, 10% tag list, 20% note with attachments, 5% edits (one in five also changes the title), 3% creates, 1% attachments added, 1% deletes. Three tags a note, a list page of 8 KB or less, and the stream function at 256 MB for 50 ms. These are assumptions, not measurements.

| Item | Quantity | List price | After the monthly free tier |
| --- | --- | --- | --- |
| DynamoDB reads | 960,000 units | 0.14 | 0.14 |
| DynamoDB writes | 1,190,000 units | 0.85 | 0.85 |
| DynamoDB storage | 1 GB | 0.00 | 0.00 |
| Lambda requests | 150,000 | 0.03 | 0 |
| Lambda duration | 1,875 GB-seconds | 0.03 | 0 |
| CloudWatch Logs | 0.03 GB | 0.02 | 0 |
| Subtotal | | **1.07** | **0.99** |

API Gateway and the Lambda function behind an API are not in this calculation. In chapter 05's calculation at the same scale, the DynamoDB part was USD 0.28 for reads and USD 0.07 for writes, USD 0.35 together. Here it is USD 0.99.

Reads halved, because lists now read index entries that hold no body.

Writes grew about twelvefold. Of the 1,190,000 units, the stream function uses 480,000, creates 330,000, edits 220,000, deletes 120,000, and attachments 40,000. Index writes account for 140,000 of them. **The largest share, four tenths of the total, is the writes that keep one piece of derived data, the tag counts, idempotent.** Counting a tag's items when the number is needed, with no stored count, would remove those 480,000 units and the Lambda lines.

Every amount here is around a dollar and does not matter at this scale. The ratios are what to look at. In a DynamoDB design, the price of one more read is paid on every write.

Some things are left out. Transaction conflicts and retries are assumed to be zero; a cancelled transaction uses the same units as a successful one, and a write refused by its condition uses write units too. Data transfer for responses is not included, nor point-in-time recovery (USD 0.228 per GB a month, off in this chapter).

Turning on Contributor Insights with `-c insights=on` costs **USD 1.00** a month. In the price list a rule for DynamoDB is USD 0.50 a month, and in the mode that counts throttled keys only, a table with a sort key gets two rules. Events are USD 0.034 per million, and in this mode only throttled requests count. Enabling it on the index too adds two more rules. The price list entry for this rule has `Rule-Hour` in its unit field and "$0.50 per rule per month" in its description; the calculation here follows the description.

Deleting the stack deletes the table, the queue, and the log group with it, and nothing billable remains.

## Where it goes wrong

| When this happens | Look here |
| --- | --- |
| A note you created is not in the recent list, or one you deleted still is | The index is eventually consistent. Read again after a moment. If an old note never appears, check whether it has `gsi1pk` and `gsi1sk`; if not, it was not backfilled |
| A tag count is wrong | Look in the stream function's log for `failedAt`, and for messages in the dead-letter queue. Batches that ran out of retries are not in the count |
| `BusyError` | Creates or deletes for one owner overlapped, and the transaction collided three times running, because all of them write that owner's counter. If simultaneous writes are normal for you, reconsider keeping an exact count |
| A transaction is refused at validation, whatever the conditions | It names the same key twice, or has more than 100 items. Fold a check and an update of one item into one action |
| An expression is refused because of a reserved word | An attribute name is written directly in the expression. Use `ExpressionAttributeNames`. `count`, `size`, and `name` are reserved |
| After deploying, only the `Query` on the index fails with `AccessDeniedException` | Permission on the table's ARN does not cover the index. Add `table/<name>/index/gsi1` as a resource |
| Writes to the table are throttled and the error names the index's ARN | The index's write limit, or a partition of the index, was reached. See "Hot partitions" in [Build, Continued](/en/chapters/30-data-modeling/more.md) |
| Reading the next page gives `InvalidPageTokenError` | A page token works only for the list that issued it. Check that a recent-list token is not being passed to a tag list, or to another tag |
| The function processes the same record again and again | Lambda delivers at least once. If only `duplicates` in the log is going up, the markers are doing their job |
| `modeling:test:local` stops with "Nothing answers" | DynamoDB Local is not running. Run `vp run db:local:start`, then create the table with `vp run modeling:db:migrate:local` |

## For production

- Protect the table. Set `removalPolicy` to `RETAIN` and turn on deletion protection and point-in-time recovery ([chapter 22](/en/chapters/22-recovery.md)). With single-table design, backup and restore are per table: you cannot bring back one kind of item alone
- Fit the limits to your volume. The per-second limits on the table and the index are practice values. Remember that the index's write limit stops writes to the table
- Put an alarm on the dead-letter queue. A single message means a count is off ([chapter 19](/en/chapters/19-observability.md)). Watch the stream function's `IteratorAge` too; it shows the function falling behind
- Have a way to rebuild derived data: a script that counts the tag items again and writes the counts, and the steps for running it. This chapter does not include one
- Give attachments a firm limit. If the transaction that adds an attachment also increments a counter on the note, chapter 07's limit that can be exceeded becomes one that cannot. In exchange, adding an attachment writes the note item, and operations on the same note collide
- Sweep, on a schedule, the attachments left behind after a note is deleted. They are what remains when a delete stops half way. Their objects in S3 need deleting too (chapters 07 and 08)
- Add a wait with jitter to transaction retries. `jitteredBackoff` in `src/compose.ts` is an example. Retrying is the subject of [chapter 32](/en/chapters/32-limits.md)
- Before changing the key design, rewrite the table of reads. Then rehearse the migration in [Build, Continued](/en/chapters/30-data-modeling/more.md) once, end to end, on another table holding as much data as production
- Deploy through the AWS CDK CLI and CloudFormation, as chapter 02 explained

## Cleanup

<!-- section: 30.cleanup -->

```bash
vp run modeling:infra:destroy
vp run db:local:stop
```

`modeling:infra:destroy` deletes the table, the index, the stream, the function, the roles and policies, the queue, and the log group. What was in the table cannot be brought back. Messages left in the dead-letter queue go too.

`db:local:stop` removes the local DynamoDB Local container, and chapter 05's table with it.

What remains is the storage cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** The tests in `examples/30-data-modeling` (119 passed, and the one for DynamoDB Local skipped), the type check, and `modeling:infra:synth` (9 resources, including the bundle with the AWS SDK) were run. The synthesized bundle was loaded in plain Node.js. `modeling:demo` was run, and the output in the chapter is from that run. The 16 table rules and the 19 notebook rules were run against DynamoDB Local 3.3.1, started directly from the jar AWS distributes with Java 21 and not through Docker (port 8030, `-inMemory -sharedDb -disableTelemetry`). `modeling:db:reset:local`, `modeling:db:migrate:local`, and `modeling:test:local` were run as tasks, with the environment variable `DYNAMODB_ENDPOINT` pointing at that port.

**Not checked yet.** Nothing was ever deployed to AWS. `modeling:infra:diff`, `modeling:infra:deploy`, `modeling:smoke`, `modeling:infra:drift`, `modeling:infra:destroy`, `modeling:backfill`, `modeling:verify`, and `modeling:remove-legacy` were not run. `db:local:start`, which starts DynamoDB Local through Docker, was not run for this chapter either.

So the following were not checked on the real thing. The cancellation reasons when transactions really collide, and that retrying works: DynamoDB Local reports no conflicts, so that path ran only on the in-memory model. How far the GSI actually lags. How often the stream function sees the same record again. That the event source mapping's filter keeps the function's own writes from reaching it. That a batch out of retries reaches the dead-letter queue, and that a record that keeps failing holds back those behind it. That TTL removes the markers. Whether a `ConditionCheck` is billed as a write or as a read. Whether real DynamoDB refuses an `ExclusiveStartKey` that points into another partition (DynamoDB Local did). The errors at the table's and the index's limits. Whether an event source mapping can be created without `dynamodb:ListStreams`. The sections on hot partitions and Contributor Insights rest on the documentation alone.

The key migration ran only on the in-memory model. How long and how much the backfill of a GSI added to an existing table takes, how `modeling:backfill` behaves while the application is live, and how chapter 05's list fails when it reads an attachment under the new key were not checked.

Multi-attribute keys for GSIs were only confirmed to be in the documentation; they were not tried with the pinned cdkd or with DynamoDB Local. The cost tables are computed from unit prices and assumptions, not measured.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Write down the reads first | `examples/30-data-modeling/src/model.ts`, `src/notebook.ts` | `test:unit` |
| Lay the keys out in one table | `examples/30-data-modeling/src/keys.ts`, `src/model.ts`, `test/keys.test.ts` | `test:unit` |
| Read a note and its attachments in one request | `examples/30-data-modeling/src/notebook.ts`, `src/table.ts`, `src/dynamodb-table.ts`, `test/notebook-contract.ts`, `test/table-contract.ts` | `test:unit`, `modeling:test:local` |
| Transactions and uniqueness | `examples/30-data-modeling/src/plan.ts`, `src/notebook.ts`, `src/dynamodb-table.ts`, `test/plan.test.ts`, `test/notebook.test.ts`, `test/dynamodb-table.test.ts` | `test:unit`, `modeling:test:local` |
| An index for a second sort order | `examples/30-data-modeling/src/plan.ts`, `src/notebook.ts`, `src/memory-table.ts`, `infra/lib/modeling-stack.ts`, `test/memory-table.test.ts`, `test/notebook.test.ts` | `test:unit`, `modeling:test:local` |
| Tags: an index you keep yourself | `examples/30-data-modeling/src/plan.ts`, `src/notebook.ts`, `test/plan.test.ts`, `test/notebook-contract.ts` | `test:unit` |
| A page token you can hand to a client | `examples/30-data-modeling/src/page-token.ts`, `src/notebook.ts`, `test/page-token.test.ts`, `test/notebook-contract.ts` | `test:unit` |
| Derived data from Streams | `examples/30-data-modeling/src/projector.ts`, `src/stream-lambda.ts`, `infra/lib/modeling-stack.ts`, `test/projector.test.ts`, `test/stream-lambda.test.ts` | `test:unit` |
| Hot partitions | `examples/30-data-modeling/infra/lib/modeling-stack.ts`, `src/keys.ts` | none |
| Move keys without stopping | `examples/30-data-modeling/src/layout.ts`, `src/migration.ts`, `scripts/modeling.ts`, `test/migration.test.ts`, `test/keys.test.ts` | `test:unit`, `modeling:backfill`, `modeling:verify`, `modeling:remove-legacy` |
| Run it locally | `examples/30-data-modeling/scripts/demo.ts`, `src/memory-table.ts`, `scripts/local-db.ts`, `.env.example` | `modeling:demo`, `modeling:db:migrate:local`, `modeling:db:reset:local` |
| Tests | `examples/30-data-modeling/test/`, `infra/test/modeling-stack.test.ts`, `scripts/test-local.ts` | `test:unit`, `modeling:test:local` |
| Getting ready for AWS | `examples/30-data-modeling/infra/lib/modeling-stack.ts`, `infra/bin/app.ts`, `infra/test/modeling-stack.test.ts`, `cdk.json` | `modeling:infra:synth`, `test:unit` |
| Deploy and check | `examples/30-data-modeling/scripts/modeling.ts` | `modeling:infra:diff`, `modeling:infra:deploy`, `modeling:smoke`, `modeling:infra:drift` |
| Cost | `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `modeling:infra:destroy` |

**Primary sources** (all checked 2026-10-13)

- DynamoDB design: [Data modeling foundations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/data-modeling-foundations.html), [Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html), [Sparse indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html), [Managing Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.OnlineOps.html), [Local secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html)
- Transactions and conditions: [DynamoDB Transactions: How it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html), [Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html), [Constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html), [Quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html), [Working with items](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html), [Reserved words](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html), [Query (API reference)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)
- Streams and Lambda: [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), [Using AWS Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html), [Event source mapping parameters](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html), [Partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html), [Retain discarded records](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html), [Event filtering](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb-filtering.html), [TTL: how it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html)
- Partitions and throttling: [Partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html), [Burst and adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html), [Key range throughput exceeded](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/throttling-key-range-limit-exceeded-mitigation.html), [GSI write throttling and back pressure](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/gsi-throttling.html), [Contributor Insights for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/contributorinsights_HowItWorks.html)
- Local runs and permissions: [DynamoDB local usage notes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html), [IAM service reference (DynamoDB)](https://servicereference.us-east-1.amazonaws.com/v1/dynamodb/dynamodb.json), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (read from the installed package)
- Prices: AWS Price List bulk API for [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json) and [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json), [DynamoDB pricing (on-demand)](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- Cloudflare and Vercel: [D1: Limits](https://developers.cloudflare.com/d1/platform/limits/), [D1: Use indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/), [D1: Pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1: D1Database](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Durable Objects: SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Durable Objects: Limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [Vercel Storage](https://vercel.com/docs/storage)

:::
