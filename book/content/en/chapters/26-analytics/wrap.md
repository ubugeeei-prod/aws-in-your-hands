---
title: "26 Analytics: Costs, Pitfalls, and Cleanup"
---

# 26 Analytics: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 26.cost -->

This page works out what the record path and the queries cost. Amounts are in USD, for the Tokyo Region, on demand, before tax. The arithmetic is in [Pricing calculations](/en/reference/pricing.md). The API, Lambda and DynamoDB themselves were priced in chapters 04 and 05, so only the records and the queries are counted here.

**A month in which nobody calls the API and nobody runs a query costs 0.** Neither a Firehose stream nor an Athena workgroup has a charge for merely existing. The Glue Data Catalog is free up to a million objects, and this stack puts two there: the database and the table. If records are still in the bucket, their storage is all that is billed.

A million requests a month, with 100 queries in the month, come to this.

| Item | Quantity | gzip JSON | Parquet |
| --- | --- | --- | --- |
| Firehose ingestion | 4.77 GB | 0.172 | 0.172 |
| Conversion to Parquet | 4.77 GB | | 0.105 |
| Writes to S3 | 43,800 objects / 8,760 objects | 0.206 | 0.041 |
| S3 storage (90 days) | 0.164 GB-month / 0.236 GB-month | 0.004 | 0.006 |
| Data Athena scanned | 100 queries, each at the 10 MB minimum | 0.005 | 0.005 |
| Athena's reads from S3 | 432,000 requests / 86,400 requests | 0.160 | 0.032 |
| Total | | **0.55** | **0.36** |

Three things can be read off this table.

The first is the volume Firehose ingests. A record is 242 bytes, and a million of them are only 0.23 GB. They become 4.77 GB because Firehose bills Direct PUT records rounded up to 5 KB each. A 242-byte record counts as 5 KB.

<<< @/examples/26-analytics/src/cost-inputs.ts{firehose}

Sending small records one at a time is the expensive way. Putting several lines into one record would lower the ingestion charge. This chapter sends one record per request and does not batch.

The second is that the number of objects makes up more than half the cost. One object every 60 seconds is 43,800 a month. Each is one request to S3 when written, and one more each time Athena reads it. The Parquet column looks cheaper mostly because its buffer is 300 seconds, a fifth as many objects, and not because of the format. The interval can be lengthened for JSON too. Records then take longer to show up in queries.

How many requests Athena makes to S3 per object was not confirmed. The table assumes one.

The third is that Athena's charge is pinned at the minimum.

<<< @/examples/26-analytics/src/cost-inputs.ts{athena}

A day's records are about 2 MB as gzip, so three days do not reach 10 MB. At this size, Parquet does not change what Athena charges.

As free allowances, the Price List shows a million objects and a million requests a month for the Glue Data Catalog. For Firehose and Athena, neither the Price List nor the pricing pages showed a monthly allowance.

### With dynamic partitioning

Adding dynamic partitioning, which this chapter did not use, to the same million records would add **0.36**: 0.007 for the 0.225 GB delivered and 0.350 for the 43,800 objects. The time spent extracting values from the records could not be estimated and is not included (0.112 per hour).

Here too the number of objects sets the amount. Dynamic partitioning writes a separate object for each partition. Split by a key with many values, such as a user's ID, and the objects multiply by the number of values. The number of partitions held at once is also limited, to 500 per stream (as read on October 13, 2026).

### Under a flood

This API has no authentication, so it has the same brakes as chapter 19. The stage throttles at 10 requests a second, so at most 25.92 million requests reach the function in 30 days, and each makes one record.

Thirty days at that limit cost **4.76** at list price for the records: 4.45 for 123.6 GB of Firehose ingestion, 0.20 for writes to S3, and 0.11 for storage. The API, Lambda and DynamoDB are as in the flood table of chapter 19.

On the query side, the workgroup's cap stops each query at about 0.005. Nothing limits how many queries run, so anything that repeats queries automatically has to count them itself.

Deleting the stack stops the charges for ingestion and queries. Storage is billed until the bucket is emptied.

## Coming from Cloudflare or Vercel

<!-- section: 26.compare -->

Both platforms have ways to collect records and aggregate them. What follows is what their official documentation said as of October 12, 2026.

On Cloudflare the experience closest to this chapter is Workers Analytics Engine. A Worker writes data points with `writeDataPoint()` and aggregates them through a SQL API. The write need not be awaited, and there is no bucket, no table definition and no folder layout to design. The differences:

| | Workers Analytics Engine | This chapter (Firehose, S3, Athena) |
| --- | --- | --- |
| Writing | `writeDataPoint()`, not awaited | `PutRecord`, awaited; dropped on failure |
| Shape of one record | Up to 20 blobs, 20 doubles and 1 index | JSON of your own design, with columns defined on a table |
| Retention | Three months | Whatever your lifecycle rule says |
| Queries | A SQL API over a single table; no `JOIN` or `UNION` | Athena's SQL; can join other tables |
| Exactness | Sampled when writes come fast; counts use `sum(_sample_interval)` | Every delivered record is kept; removing duplicates is up to you |
| Price | Workers Paid includes 10 million data points and 1 million queries a month; the pricing page says usage is not currently billed | Charged for ingestion, storage and bytes scanned |

Cloudflare also has the same arrangement as this chapter, files that pile up and are read with SQL. Basin Pipelines receives events over HTTP or a Worker binding and writes them to R2 as Iceberg tables or as Parquet or JSON files. Basin SQL runs SQL over those tables. According to the documentation, both are generally available and were formerly called Cloudflare Pipelines and R2 SQL. Basin SQL is billed by data scanned: 10 GB a month is included, then 2.50 per TB, with a 10 MB minimum per query. The billing unit is much like Athena's. A setting by which the user caps what one query may scan was not found in the pages read.

Logpush sends logs that Cloudflare holds to R2, S3 and other destinations, and has no storage or search of its own. In this chapter's terms it sits where Firehose does.

On Vercel, both where the data lives and the kind of question differ. Web Analytics collects page views and, on Pro and above, custom events. Pro pays 0.03 per 1,000 events and can look back 12 months. Aggregation happens in the dashboard and through an API that returns aggregated values; there is no SQL. Query, part of Observability Plus, aggregates requests and function invocations by conditions chosen in a form. No SQL interface was found in its documentation either. When raw events are needed, Drains send them to an HTTP endpoint outside.

In short, if all you want is to count your app's events, Workers Analytics Engine or Vercel's Web Analytics gets you there with far less work. This chapter's design is for keeping every record in a shape of your own, for keeping them longer than three or twelve months, and for joining them with other data. In return, the file layout, duplicates, the edge of the day and the cap on reading are all yours to decide.

## Pitfalls

| If this happens | Look here |
| --- | --- |
| A query returns no rows | Look for objects under `requests_json/dt=<date>/` in the bucket. Until the buffer interval (60 seconds, 300 for Parquet) has passed there are none. Dates are in UTC |
| There are objects, and still no rows | Check that the table's `storage.location.template` and the real keys name the same folder. Dates before `2026-10-01` are outside the range |
| A record from late last night is missing from yesterday's totals | Check that the query does not narrow by the folder's date alone. A record can be in the folder of the day before or after. This chapter's queries read a day on each side |
| Counts are higher than they should be | Check that the query does not count with `count(*)`. A resend puts the same record in twice. Count with `count(DISTINCT event_id)` |
| The log shows `analytics record dropped` | The send to Firehose failed or took longer than 500 milliseconds. Read `error`. Suspect permissions, then the stream's name, then throttling |
| A query is cancelled | It went past the workgroup's cap (1 GiB). Narrow the range of days. A cancelled query is still charged for what it read |
| `HIVE_CURSOR_ERROR` appears | Some line cannot be read as JSON. Check that no line has a newline in the middle and that every record ends with one |
| There are objects under `errors/format-conversion-failed/` | These are records that could not be converted to Parquet. Check that the record's fields fit the types of the table's columns |
| After switching to Parquet, earlier records are gone from queries | That is expected. The table points at `requests_parquet/`. The JSON records are still in `requests_json/` |
| The stack cannot be deleted | The bucket is not empty. Run `vp run analytics:empty --yes` first |

## For production

- Decide how long to keep the records. The 90 days are a practice value. A record holds a note's ID, so decide how long that ID may stay after its user has deleted the note
- Set the bucket's `removalPolicy` to `RETAIN`, so that the records outlive the stack
- Decide with IAM who may use Athena. Limit them to this one workgroup, and limit who can read the bucket directly. The workgroup's cap can be sidestepped by using another workgroup
- Put a notification on the data scanned by the workgroup as a whole. A per-query cap does nothing about many queries
- Make sure a failed delivery gets noticed. The error log group and `errors/` tell nobody anything unless someone looks. Put an alarm on Firehose's metrics the way chapter 19 does. Which metric to use was not checked in this chapter
- Count the missing records. A metric filter from chapter 19 on the `analytics record dropped` line shows how many are lost
- Decide how a record's shape changes. To add a column, add it to the table first and change the app second. Raise `v`, and let the queries handle the new column being `NULL` on old rows
- To aggregate by Japan time, shift the query's range by nine hours. Leave the folders' dates in UTC
- To count the requests that never reach the function, send API Gateway's access log through another stream
- Deploy with the AWS CDK CLI and CloudFormation, for the reasons given in chapter 02

## Cleanup

<!-- section: 26.cleanup -->

```bash
vp run analytics:empty
vp run analytics:empty --yes
vp run analytics:infra:destroy
```

The first only prints how many objects are in the bucket. With `--yes` it deletes them all: the records, the records that failed conversion, and the query results. The pinned cdkd does not delete a bucket that is not empty, so run this before deleting the stack.

Deleting the stack removes the stream, the table definition, the workgroup, the bucket, the notes table, the function, the API and the log groups. The workgroup has `recursiveDeleteOption`, so it should be deletable even with query history in it. That was not checked against AWS.

All that remains is the storage that cdkd's bootstrap created (chapter 02).

## As a distributed system

The record path runs with a reliability of its own, apart from the app.

- Who owns the state: the notes' source of truth is the DynamoDB table. The records in the bucket are a copy of what happened, and can be missing or duplicated
- Invariant: whether or not a record can be written, the API's answer and the state of the notes are the same
- Tests that try to break it: with a sink that fails, one that throws and one that never answers, the answer stays the same and the wait has a bound
- Duplicates: the sender's retry puts the same record in twice. A test loses an answer in the real SDK to reproduce it, and checks that `event_id` makes it count once
- Loss: a record whose send failed is dropped. Nothing resends it. A question that needs an exact count is asked of the table
- Order and time: the folder's date comes from the time of arrival, and `at` from the app's clock. The two can differ, so folders are read generously and `at` narrows
- Delay: a record shows up in queries after the buffer interval. The last minute is not visible yet

::: details Verification notes for this chapter

**Checked locally.** Unit tests for the app, the record's shape, the send to Firehose (the real SDK with the network replaced), the folders' dates, rendering and local evaluation of queries, per-column sizes in Parquet, the pricing inputs and the infrastructure (62 tests). The type check. Synth (including the esbuild bundle, also with `-c format=parquet`). Started `dev:analytics`, ran the `curl` commands from the chapter, and looked at the object under `dist/lake` and the output of `analytics:query:local`. The output of `analytics:query:print` and `analytics:sizes`. The names of the arguments and fields the script uses, in the AWS CLI's help for `athena start-query-execution`, `get-query-execution` and `get-query-results`.

**Not checked yet.** `analytics:infra:deploy`, `analytics:smoke`, `analytics:query`, `analytics:infra:drift`, `analytics:empty` and `analytics:infra:destroy` have not been run against AWS. In particular, the following are only read from documentation.

- That Athena accepts the rendered SQL: `substr`, `count(DISTINCT …)`, `approx_percentile`, and folders being pruned by `BETWEEN` on the string column `dt`. The local evaluation is not a SQL engine. The workgroup names no engine version and uses the default
- That the Hive JSON SerDe reads this record's `null`, integers and strings into columns
- Everything about Firehose's format conversion: the lower bound on the buffer size (64 MB is given, but the pages read state no lower bound), how the OpenX deserializer behaves, the size of the Parquet that Firehose writes, and the bytes Athena reports
- That Firehose can deliver with a role narrowed to the records folder and `errors/`
- That cdkd can create, update and delete the workgroup and the log stream through Cloud Control API. Whether those two types are on Cloud Control API's list of supported types was not checked this time either. That cdkd's Firehose provider succeeds in creating this stream, and that switching formats is applied as an update
- How much waiting for `PutRecord` slows a response. The 500-millisecond bound is not based on a measurement
- How many requests one Athena query makes to S3. The cost table assumes one per object
- In the prices: whether Firehose's "5 KB" is 5,000 or 5,120 bytes (5,120 is used), how Athena counts "10 MB" and a TB, storage for query results, the number of Glue requests, and the volume of Firehose's error log
- The statements about Cloudflare and Vercel come from summaries of their official documentation. Neither service was run

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, Why this design | `examples/26-analytics/infra/lib/analytics-stack.ts`, `infra/test/analytics-stack.test.ts` | `test:unit` |
| The shape of a record | `examples/26-analytics/src/record.ts`, `src/describe.ts`, `test/record.test.ts`, `test/app.test.ts` | `test:unit` |
| From the app to Firehose | `examples/26-analytics/src/app.ts`, `src/sink.ts`, `src/lambda.ts`, `src/compose.ts`, `test/app.test.ts`, `test/sink.test.ts` | `test:unit` |
| Into S3, split by date | `examples/26-analytics/src/partition.ts`, `src/lake.ts`, `test/partition.test.ts`, `infra/lib/analytics-stack.ts` | `test:unit`, `analytics:infra:synth` |
| The table definition and partition projection | `examples/26-analytics/src/partition.ts`, `src/names.ts`, `infra/lib/analytics-stack.ts`, `infra/test/analytics-stack.test.ts` | `test:unit`, `analytics:infra:synth` |
| Queries | `examples/26-analytics/src/queries.ts`, `test/queries.test.ts`, `scripts/query.ts` | `test:unit`, `analytics:query:print` |
| JSON and Parquet | `examples/26-analytics/src/columnar.ts`, `src/sample.ts`, `test/columnar.test.ts`, `scripts/sizes.ts` | `test:unit`, `analytics:sizes` |
| Against reading too much and keeping too long | `examples/26-analytics/infra/lib/analytics-stack.ts`, `infra/test/analytics-stack.test.ts` | `test:unit`, `analytics:infra:synth` |
| Run it locally | `examples/26-analytics/src/dev.ts`, `src/lake.ts`, `src/local-files.ts`, `scripts/query.ts`, `.env.example` | `dev:analytics`, `analytics:query:local`, `test:unit` |
| Deploy and check | `examples/26-analytics/infra/bin/app.ts`, `scripts/smoke.ts`, `scripts/query.ts` | `analytics:infra:diff`, `analytics:infra:deploy`, `analytics:smoke`, `analytics:query`, `analytics:infra:drift` |
| Cost | `examples/26-analytics/src/cost-inputs.ts`, `test/cost-inputs.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `examples/26-analytics/scripts/empty-lake.ts`, `tools/src/infra/` | `analytics:empty`, `analytics:infra:destroy` |

**How cdkd (0.296.28) handles the types.** Checked by reading `dist/` of the installed version. With a provider of their own: `AWS::KinesisFirehose::DeliveryStream`, `AWS::Glue::Database`, `AWS::Glue::Table`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::Logs::LogGroup`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::DynamoDB::Table`, `AWS::ApiGatewayV2::*`. Without one, through Cloud Control API: `AWS::Athena::WorkGroup`, `AWS::Logs::LogStream`. For an S3 destination, the Firehose provider passes on `Prefix`, `ErrorOutputPrefix`, `CompressionFormat`, `BufferingHints`, `EncryptionConfiguration`, `CloudWatchLoggingOptions`, `ProcessingConfiguration`, `S3BackupMode`, `S3BackupConfiguration` and `DataFormatConversionConfiguration`. It does not pass on `DynamicPartitioningConfiguration`, `CustomTimeZone` or `FileExtension`.

**Primary sources** (read on 2026-10-12 and 2026-10-13; the date for each is in the [list of sources](/en/reference/sources.md))

- Firehose: [Understand custom prefixes for Amazon S3 objects](https://docs.aws.amazon.com/firehose/latest/dev/s3-prefixes.html), [Configure Amazon S3 object name format](https://docs.aws.amazon.com/firehose/latest/dev/s3-object-name.html), [Understand data delivery](https://docs.aws.amazon.com/firehose/latest/dev/basic-deliver.html), [Handle data delivery failures](https://docs.aws.amazon.com/firehose/latest/dev/retry.html), [Configure backup settings](https://docs.aws.amazon.com/firehose/latest/dev/create-configure-backup.html) (the buffering ranges), [Convert input data format](https://docs.aws.amazon.com/firehose/latest/dev/record-format-conversion.html), [Controlling access](https://docs.aws.amazon.com/firehose/latest/dev/controlling-access.html)
- Firehose dynamic partitioning: [Partition streaming data](https://docs.aws.amazon.com/firehose/latest/dev/dynamic-partitioning.html), [Enable dynamic partitioning](https://docs.aws.amazon.com/firehose/latest/dev/dynamic-partitioning-enable.html), [Buffer data for dynamic partitioning](https://docs.aws.amazon.com/firehose/latest/dev/buffering.html)
- Firehose API: [PutRecord](https://docs.aws.amazon.com/firehose/latest/APIReference/API_PutRecord.html), [BufferingHints](https://docs.aws.amazon.com/firehose/latest/APIReference/API_BufferingHints.html), [Processor](https://docs.aws.amazon.com/firehose/latest/APIReference/API_Processor.html)
- The path from CloudWatch Logs: [Send CloudWatch Logs to Firehose](https://docs.aws.amazon.com/firehose/latest/dev/writing-with-cloudwatch-logs.html), [Log group-level subscription filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html), [Configure logging for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)
- Athena partition projection: [Use partition projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html), [Supported types](https://docs.aws.amazon.com/athena/latest/ug/partition-projection-supported-types.html), [Set up partition projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection-setting-up.html), [Amazon Data Firehose example](https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html)
- How Athena reads files: [Hive JSON SerDe](https://docs.aws.amazon.com/athena/latest/ug/hive-json-serde.html), [OpenX JSON SerDe](https://docs.aws.amazon.com/athena/latest/ug/openx-json-serde.html), [Parquet SerDe](https://docs.aws.amazon.com/athena/latest/ug/parquet-serde.html), [Use columnar storage formats](https://docs.aws.amazon.com/athena/latest/ug/columnar-storage.html), [Create a table for AWS WAF S3 logs using partition projection](https://docs.aws.amazon.com/athena/latest/ug/create-waf-table-partition-projection.html) (the input and output format of a JSON table)
- Athena queries: [Configure per-query and per-workgroup data usage controls](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html), [Athena engine version 3 functions](https://docs.aws.amazon.com/athena/latest/ug/functions-env3.html), [Trino: Aggregate functions](https://trino.io/docs/current/functions/aggregate.html)
- Pricing: [Amazon Data Firehose Pricing](https://aws.amazon.com/firehose/pricing/), [Amazon Athena Pricing](https://aws.amazon.com/athena/pricing/) (only how charging works was read from these; the unit prices are the Price List's)
- AWS Price List bulk API: [Firehose](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonKinesisFirehose/current/ap-northeast-1/index.json), [Athena](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonAthena/current/ap-northeast-1/index.json), [Glue](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSGlue/current/ap-northeast-1/index.json), [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html) (not re-read this time), the type definitions of [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)
- [hyparquet-writer 0.16.11](https://www.npmjs.com/package/hyparquet-writer/v/0.16.11) (used only to write Parquet on the laptop and measure it)
- Cloudflare: [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/), [Basin SQL](https://developers.cloudflare.com/r2-sql/), [Basin Pipelines](https://developers.cloudflare.com/pipelines/), [Logpush](https://developers.cloudflare.com/logs/logpush/)
- Vercel: [Pricing for Web Analytics](https://vercel.com/docs/analytics/limits-and-pricing), [Query](https://vercel.com/docs/query), [Drains](https://vercel.com/docs/drains)

:::
