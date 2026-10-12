---
title: "26 Analytics: Firehose, S3, Glue, and Athena"
sourceRevision: 1
---

# 26 Analytics: Firehose, S3, Glue, and Athena

The logs of [chapter 19](/en/chapters/19-observability.md) are for investigating a failure that is happening now. They are kept for seven days, and the question they answer is what happened to one request.

This chapter is about questions over a longer time. How many notes were created each day last month? What share of updates run into a conflict? Which routes are slow? To answer them, the app writes one record per request, the records pile up as files in S3, and you aggregate them with SQL when you need to.

There is no server and no cluster. In a month when no record arrives and nobody runs a query, nothing is billed. In exchange, how the files are laid out and how the queries are written decide both the bill and whether the answers are right. That is what this chapter is about.

It builds on [chapter 07](/en/chapters/07-uploads.md) and [chapter 19](/en/chapters/19-observability.md). The subject is the notes API of [chapter 05](/en/chapters/05-dynamodb.md), whose code is wrapped from the outside and not changed. The code is in `examples/26-analytics/`.

## The whole picture

<!-- section: 26.overview -->

```figure
caption: After answering a request, the function hands one record to Firehose. Firehose buffers, then writes to S3
node client: Browser / curl
node api: API Gateway HTTP API
node fn: Lambda | the chapter 05 app, and the part that records
node table: DynamoDB table
node stream: Firehose stream | buffers up to 60 s or 5 MB
node lake: S3 bucket | requests_json/dt=2026-10-12/
edge client -> api: HTTPS
edge api -> fn
edge fn -> table
edge fn -> stream: PutRecord (one line of JSON)
edge stream --> lake: a gzip object
mark stream
```

```figure
caption: Athena runs the query. It reads the table definition from Glue and the data from S3
node you: vp run analytics:query
node athena: Athena | workgroup, capped at 1 GiB
node glue: Glue Data Catalog | the table definition
node lake: S3 bucket | records
node results: S3 bucket | athena-results/
edge you -> athena: SQL
edge athena -> glue: columns and the partition rule
edge athena -> lake: reads the objects of the days asked for
edge athena --> results: the result as CSV
mark athena
```

Four services appear, each with one job.

Amazon Data Firehose buffers the records it receives and writes them to S3 in batches. If the function wrote to S3 itself on every request, a million requests a month would make a million small objects. Firehose puts sixty seconds of records into one.

The S3 bucket holds the records in one folder per day. Athena treats a folder named like `dt=2026-10-12/` as a partition.

The AWS Glue Data Catalog is where the table definition lives: which bucket and folder, and which columns the files have. It holds no data.

Amazon Athena runs SQL over files in S3. It bills by the bytes it reads, USD 5.00 per TB in the Tokyo Region. A query that names its days reads only those days' folders.

### This chapter's invariant

The API's answer is the same whether or not a single record could be written. In the other direction, the records in the bucket are not the notes' source of truth. A record can be missing, and the same record can be there twice. The queries are written with that in mind.

## Why this design

<!-- section: 26.choices -->

### Why not CloudWatch Logs as it is

Logs Insights from chapter 19 can aggregate too. A second place for records is still worth having because the purpose differs. A log is for investigating failures: its shape follows the implementation, and it is kept for a short time. A record for analysis has a shape you decide and keep, for a long time. The prices differ as well: CloudWatch Logs charges 0.76 per GB ingested, and S3 charges 0.025 per GB-month stored.

The DynamoDB table is not aggregated because it holds only the present state. A note created and deleted last month is no longer in it.

### Why not dynamic partitioning

Firehose has dynamic partitioning, which chooses the folder from a value inside each record: a user's ID, say, or the kind of event. This chapter does not use it. It uses the form that costs nothing extra, where Firehose makes the date folder from the time it received the record. There are three reasons.

- Narrowing by date is enough. Every question in this chapter aggregates over a period
- It costs money: 0.032 per GB delivered, plus 0.008 per thousand objects, plus 0.112 per hour of extracting the value from the records. The [last page](/en/chapters/26-analytics/wrap.md) has an estimate
- It can only be turned on when the stream is created, and can never be turned off

There is one more reason, from this book's tooling. The Firehose provider of the pinned cdkd (0.296.28) does not pass `DynamicPartitioningConfiguration` on to Firehose. That was checked by reading its source. With this book's steps as they are, a stream that uses dynamic partitioning cannot be deployed.

Splitting by the time of arrival has a price: records land in the wrong day's folder around midnight. The [next page](/en/chapters/26-analytics/build.md) has a test that reproduces it and shows how the queries deal with it.

### Why no crawler

Athena cannot read a table without knowing which partitions it has. A new date folder can be registered every day by running a Glue crawler or an `ALTER TABLE ADD PARTITION` statement. This chapter uses neither. It uses partition projection: the rule for the folder names is written on the table, and Athena works out which folders to read from the query's conditions. Nothing has to keep running.

### How this differs from API Gateway's access log

The records here are only of requests the app answered. A request refused with 429 by the stage's throttling never reaches the function, so it leaves no record.

To count those as well, use API Gateway's access log. An HTTP API writes its access log to CloudWatch Logs, and a subscription filter on the log group can send it on to Firehose. What arrives from CloudWatch Logs is a gzip-compressed JSON envelope holding several log events, and Firehose has a feature that unpacks it. That path is not in this chapter's stack.

### When not to build this

If the metrics and logs of chapter 19 already answer what you want to know, you do not need any of this. Deciding a record's shape and keeping to it is work, and changing the shape means thinking about the files already written. See first whether chapter 19's dashboard and queries leave you stuck, and add this when a question reaches further back than the logs are kept.
