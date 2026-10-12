---
title: "54 Kinesis: Data Streams, Shards, Ordering, and Replay"
sourceRevision: 1
---

# 54 Kinesis: Data Streams, Shards, Ordering, and Replay

A stream in Kinesis Data Streams is a log, not a queue. A record that was written stays there when it is read, for as long as you decided to keep it. Each reader holds its own position, so any number of them can read the same record, and a reader that moves its position back reads again. Order is kept within a sequence called a shard.

The queue in [chapter 08](/en/chapters/08-async.md) handed out one piece of work at a time and deleted it when it was done. In this chapter you write the changes to notes (revisions) to a stream, and a Lambda function reads them in order and builds a history for each note. One thing has to hold: for each note, every revision takes effect once, in order. The stream promises no more than "delivered at least once", so the code that writes and the code that reads make up the rest.

The price comes first. **This chapter's stack costs about USD 14.49 a month just by existing.** Nearly all of it is the stream: USD 0.0195 an hour for each shard, whether or not a single record is written. Kinesis Data Streams has no free tier. When you are done, delete it with `vp run kinesis:infra:destroy`. The breakdown and the assumptions are on the [costs page](/en/chapters/54-kinesis/wrap.md).

You need chapters 08 and [05](/en/chapters/05-dynamodb.md). The code is in `examples/54-kinesis/`. Nothing in this chapter was run on AWS. How the stream and Lambda behave was checked against local models built from the official documentation.

## The whole picture

<!-- section: 54.architecture -->

```figure
caption: A revision lands in the shard its note's ID selects, and the function reads each shard in order
node producer: Producer | PutRecords
node stream: Kinesis data stream "Revisions" | one shard, kept 24 hours
node mapping: event source mapping | 100 at a time, in order
node consumer: Lambda function "Consumer"
node history: DynamoDB table "History"
node failures: SQS queue "Failures"
edge producer -> stream: partition key = noteId
edge stream --> mapping: GetRecords
edge mapping -> consumer: synchronous invocation
edge consumer -> history: applied if the version is newer
edge mapping --> failures: where a batch given up on is
mark stream
```

The writer (the producer) puts each revision into the stream as one record. A record carries a string called its partition key. Here it is the note's ID. Records with the same partition key always go to the same shard, and within a shard they stay in the order they were written.

The reader is a Lambda function. Between the function and the stream sits an event source mapping, which reads records from a shard in batches, invokes the function, and remembers how far it has read. It is the same part that connected a queue to a function in chapter 08, but on a stream it behaves differently. When the function fails, the rest of that shard is not read. That is what keeping order takes.

The function applies each revision to a DynamoDB table (History). Applying is one conditional update, and only a revision newer than the stored version passes. A record that arrives a second time changes nothing.

The event source mapping gives up on a record it cannot process after a set number of tries. Where in the stream the batch it gave up on is, it writes to an SQS queue (Failures).

```figure
caption: A record stays after it is read. Each reader holds a position, and one that comes later can read from the start
type: sequence
actor p: Producer
actor s: shard
actor a: Consumer A
actor b: Consumer B
step p -> s: n1@1, n1@2, n1@3
step s --> a: n1@1, n1@2, n1@3
note a: position: after n1@3
step s --> b: n1@1, n1@2, n1@3
note b: started reading later
step p -> s: n1@4
step s --> a: n1@4
step s --> b: n1@4
```

The second figure is the difference from a queue. Consumer B, which came later, reads the records Consumer A already read. The shard does not know that A read them. The position belongs to the reader.

The stack holds one consumer. The second one is a script on your machine (`kinesis:replay`). It reads the deployed stream from the start and builds the histories in memory with the same code the function runs.

## How a stream differs from a queue

<!-- section: 54.log -->

| | SQS standard queue (chapter 08) | Kinesis stream |
| --- | --- | --- |
| After reading | Deleted once processed | Stays. Gone when retention runs out |
| Readers | One message goes to one reader | Each reader has a position, and all read everything |
| Order | May change | The order written, within a shard |
| One failure | That message returns, the others go on | The records behind it wait |
| Reading again | Not possible | Move the position back |
| Capacity | Not specified | A limit per shard |

Everything in the right column follows from one design: an ordered log that each reader reads from a position of its own.

Keeping order means a failed record cannot be skipped. Because it cannot be skipped, one record that cannot be processed stops its shard. A failure that would send one message to a dead-letter queue becomes, on a stream, a delay for everything. Half of this chapter's tests and settings exist for this one point.

Because reading removes nothing, time is the only thing that does. Retention is 24 hours by default and can be raised to 365 days. A consumer that stays down longer than the retention period loses records it never read. That is why there is an alarm on iterator age, the metric that says how far behind a consumer is.

Capacity is the number of shards. According to the documentation, one shard accepts writes of up to 1,000 records or 1 MB a second, and reads of up to 2 MB a second. Records with one partition key gather in one shard, so when writes concentrate on one note, that note's limit remains one shard's, however many shards there are.

## Capacity modes and price

<!-- section: 54.modes -->

A stream has one of three capacity modes. The prices are for the Tokyo Region, read from the AWS Price List on 2026-10-13.

In provisioned mode you choose the number of shards. A shard costs USD 0.0195 an hour, which is USD 14.23 for a month (730 hours). Writes cost USD 0.0215 per million units of 25 KB. Reading with GetRecords within the 24 hours of retention costs nothing.

In On-demand Standard mode Kinesis adds and removes shards itself. You do not estimate capacity, and in exchange each stream costs USD 0.052 an hour, USD 37.96 a month. On top of that, writes cost USD 0.104 per GB and reads USD 0.052 per GB. The amount written is counted with each record rounded up to 1 KB.

On-demand Advantage is a setting of the account. The hourly charge per stream goes away and the unit prices drop, but an account that enables it pays for at least 25 MiB/s of writes and 25 MiB/s of reads across its on-demand streams. At Tokyo's prices that is USD 4,003.59 a month. If you use less, the difference is billed. It is not a setting for a reader of this book to try.

No mode costs nothing while idle. This chapter uses the cheapest: provisioned with one shard. Even with a million revisions written in a month, the stream's bill is almost all hourly charge, and the whole stack comes to USD 15.23. The same usage with an On-demand Standard stream comes to USD 39.04.

On-demand fits when you cannot predict the traffic, or when it swings widely. The documentation says a new stream starts at 4 MB a second of writes and takes up to twice the peak of the previous 30 days at once. It does not look after writes that concentrate on one partition key, though. A key that exceeds one shard's limit keeps being refused in on-demand mode as well.

Retention longer than 24 hours is charged separately. In provisioned mode, extending it up to 7 days adds USD 0.026 an hour per shard. This chapter leaves it at 24 hours.

## Other choices

<!-- section: 54.choices -->

To hand out work one piece at a time, use SQS from [chapter 08](/en/chapters/08-async.md). When you need neither order nor rereading, and one failure should not hold back the rest, a queue is simpler and costs nothing while unused. SQS itself is the subject of [chapter 61](/en/chapters/61-sqs.md).

To route by content, use EventBridge from [chapter 25](/en/chapters/25-events.md). The Classic bus chapter 25 used matches events against rules and delivers them to targets. It is not a log whose readers hold positions. The documentation says the newer Custom Event Bus retains events and lets each subscriber have a starting position. This chapter does not compare the two.

To receive the changes of a DynamoDB table in order, use DynamoDB Streams (chapter 25 and [chapter 30](/en/chapters/30-data-modeling.md)). The changes to each item appear in the order they happened, without duplicates. Retention is 24 hours, and at most two consumers can read a shard at once.

That choice bears on this chapter's own subject. A note's version is decided by chapter 05's table, so if all you want is the versions in order, DynamoDB Streams is the surer way. When the API writes to the table and then to Kinesis, two requests can put version 2 and version 3 into the stream in reverse. What Kinesis keeps is the order of arrival at the stream. This chapter uses Kinesis to explain Kinesis, and for the cases that need one of these: events that do not pass through a table, more than 24 hours of retention, or three or more readers.

To collect data in S3 and analyze it, use Firehose from [chapter 26](/en/chapters/26-analytics.md). Firehose can also take a Kinesis stream as its input.

To keep using Kafka clients and tools, there is Amazon MSK. It is a managed service that runs Apache Kafka, as a cluster with brokers in each Availability Zone or as MSK Serverless. This book does not cover it.

To aggregate over windows of time or join several streams, there is Amazon Managed Service for Apache Flink. It runs Apache Flink applications written in Java, Scala, Python, or SQL. This book does not cover it.

### If you come from Cloudflare

As of 2026-10-13, nothing at Cloudflare appears to correspond directly to a Kinesis stream. Two things come close.

Cloudflare Queues is close to chapter 08's SQS. Its documentation says it delivers at least once and does not guarantee order.

Basin Pipelines (formerly Cloudflare Pipelines) has a part called a stream. It takes in events over HTTP or a Worker binding, transforms them with SQL, and delivers them to R2 as Iceberg tables or Parquet files. Several pipelines can read one stream. Its role is close to chapter 26's Firehose, and no API for application code to read again from a position of its choosing was found on the pages that were read.

If Workers and Queues are enough for you, stay with them. Kinesis is for when you need order per key, several readers, and rereading together. In exchange, the number of shards, the choice of partition key, and what to do when a shard is stuck become yours to decide.
