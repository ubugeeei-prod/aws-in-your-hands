---
title: "54 Kinesis: Design and Build"
---

# 54 Kinesis: Design and Build

The [first page](/en/chapters/54-kinesis.md) showed the setup: revisions written to a stream, and a function that reads them in order and builds histories. This page reads the code in order: the shape of a record, shards and ordering, the writer, the reader, the settings of the event source mapping, and the stack.

## The shape of a record

<!-- section: 54.record -->

<<< @/examples/54-kinesis/src/revision.ts{revision}

A revision is one change to one note. `version` is the version the note has had since chapter 05, which goes up by one with every successful write. A note's ID and a version name the same revision whoever sends it and however often. That pair is what tells duplicates apart.

Kinesis gives each record a number of its own, the sequence number, but it cannot tell duplicates apart. If the writer sends one revision twice, the stream holds two records with two sequence numbers. The Kinesis documentation, too, tells applications that need strictness to put a key of their own inside the record.

The partition key is the note's ID. A note's revisions line up in one shard, and their order is kept.

Neither the body nor the title is in the record. A record stays in the stream for 24 hours, and everyone who can read the stream can read it. It carries only whose note reached which version.

<<< @/examples/54-kinesis/src/revision.ts{codec}

To Kinesis the content of a record is bytes. That it is JSON, and that it has the shape of a revision, is for the reader to check.

A record that fails the check will fail it every time it is read. Such a record is called a poison record, and it has an error class of its own. The retry settings that come later cannot tell a passing failure from a poison record, so the log has to.

The third check is that the partition key is the revision's note. A revision of note n1 written under another key may arrive in a different order from n1's other revisions. A record whose order cannot be trusted is not accepted.

## Shards and ordering

<!-- section: 54.shards -->

A hash decides which shard a partition key goes to. According to the documentation, Kinesis reads the MD5 of the partition key as a 128-bit integer and puts the record in the shard whose range holds that value. Each shard owns a contiguous range of the values from 0 to 2^128 − 1.

<<< @/examples/54-kinesis/src/local-stream.ts{hash}

The local model does the same arithmetic. The model is explained on the [page about running it locally](/en/chapters/54-kinesis/local.md).

About order, the documentation promises this:

- Records with the same partition key go to the same shard
- Records received through GetRecords are in the order of their sequence numbers
- Sequence numbers increase within a shard. They cannot be compared with another shard's

There are things it does not promise. Records in different shards have no order between them. Whether version 2 of note a or version 1 of note b is read first is not decided. This chapter's history is per note, so that is enough.

A sequence number is a decimal string. In the documentation's examples it has 56 digits. That does not fit in a JavaScript number, so compare them as `BigInt`. They are not consecutive either.

### Choosing the partition key

The partition key decides two things: the unit within which order is kept, and the unit across which load is spread.

With the note's ID, order is kept per note, and many notes spread evenly over the shards. With the user's ID, order is kept per user, and the records of one busy user gather in one shard. With a fixed string, order is kept overall, and only one shard is ever used however many there are.

When writes concentrate on one key and pass the shard's limit, that key's records are refused with `ProvisionedThroughputExceededException`. It makes no difference that other shards are idle. This is called a hot key. Adding shards does not solve it, because one key goes to one shard.

### Splitting and merging shards

The number of shards can be changed later. The operation is called resharding: a split divides one shard into two, and a merge joins two into one.

The original shard of a split (the parent) is closed and accepts no new records. The records already in it stay there until retention runs out. New records go to the child shards.

There is a trap for ordering here. When versions 1 to 3 of a note are in the parent and versions 4 and 5, written after the split, are in a child, reading the child first delivers version 4 before version 1. The Kinesis guide asks a reader to read the parent to its end before the children. You know the parent is finished when GetRecords returns no next position.

Whether a Lambda event source mapping reads in that order could not be confirmed from the Lambda documentation that was read. This chapter's consumer is built so that the history does not go backwards even if it does not.

## The writer

<!-- section: 54.producer -->

There are two APIs for writing. PutRecord sends one record, and PutRecords sends up to 500 at once, 10 MiB in total.

PutRecords does not succeed or fail as a whole. It accepts or refuses each record by itself, and when it refuses one it still processes the records after it. The response lists one result per record, in the order of the request.

So two revisions of one note in one request can change places.

<<< @/examples/54-kinesis/src/producer.ts{put-naively}

This function does what the documentation's example does. It sends once and then sends the refused ones again. If versions 1 and 2 are sent together and only version 1 is refused, the stream receives version 2 and then version 1. The order of records that are in the stream cannot be changed afterwards. The API reference also says that PutRecords does not guarantee order.

<<< @/examples/54-kinesis/src/producer.ts{plan}

This chapter's writer never puts two records with the same partition key into one request. It divides the revisions into rounds, and the next revision of the same note always goes to a later round. Revisions of different notes can share a round freely.

<<< @/examples/54-kinesis/src/producer.ts{put-in-order}

The rounds are sent one at a time. Refused records are sent again within their round, and the next round does not start until all of them are in. If they are not in after a set number of attempts, the writer stops there and returns the records it has not sent to the caller. Going on would let a later version overtake an earlier one.

The price is the number of requests. Five revisions of one note written in a row take five requests. Many notes with one revision each take one request per 500.

What the API reference recommends for order is calling PutRecord one record at a time and passing the previous record's sequence number as `SequenceNumberForOrdering`. This chapter does not, because with many notes that is one request per record. One condition, never two records of a note in the same request, keeps the same order with PutRecords.

### Resending and duplicates

The connection can drop after a request is sent and before the response comes back. The writer cannot know whether the records went in. If it sends again and they had gone in, the same revision is there twice.

This cannot be prevented. Instead of preventing it, the reader makes the revision take effect once. That is why the note's ID and the version are in the revision.

### Two writers

What `putInOrder` keeps is the order one writer sends in. When two processes send revisions of the same note separately, this function cannot decide which reaches the stream first. If the order comes from a DynamoDB table, DynamoDB Streams fits better, as the first page said.

<<< @/examples/54-kinesis/src/kinesis-writer.ts{writer}

This is all the code that calls the SDK. The stream is named by its ARN. An element of the response with a sequence number is read as a success, and one without as an error code.

## The reader

<!-- section: 54.consumer -->

<<< @/examples/54-kinesis/src/history.ts{history}

The history is one item per note. `version` is the highest version applied so far, and `revisions` is the number of revisions applied. If every revision was applied once and in order, the two are equal. A difference means some revision never arrived, or arrived late and was dropped.

<<< @/examples/54-kinesis/src/dynamodb-history.ts{apply}

Applying is one conditional UpdateItem. The condition is: there is no item for this note yet, or the stored version is lower than this revision's. If it passes, the version moves forward and `revisions` grows by 1.

This one condition does two jobs. A revision that arrives again has the stored version, so it does not pass. An older revision that arrives late does not pass either. Comparing and writing are one request, so two deliveries at the same moment cannot both pass. It is the same tool as the optimistic locking of chapter 05.

A condition that did not pass is returned as an answer, not as an error.

A skipped version passes. If version 3 comes after version 1, the history moves to version 3 and `revisions` becomes 2. The consumer does not wait for the missing version because it may never come. As you will see below, the event source mapping gives up on a batch it cannot process and moves on. If version 2 was in a batch it gave up on, a consumer that waits for version 2 stops for that note for ever. This chapter chose to go on and leave the gap as a number.

<<< @/examples/54-kinesis/src/consumer.ts{event}

The event the function receives also comes from outside. Valibot checks only the fields that are used. `data` is a base64 string, and `approximateArrivalTimestamp` is a time in seconds.

<<< @/examples/54-kinesis/src/consumer.ts{handler}

The handler applies the records in the order they arrive. When it meets a record it cannot apply, it stops there and returns that record's sequence number. This way of answering is called a partial batch response. It means: everything before this is done, give me this and what follows again.

It does not skip the failed record and carry on, because of order. If the failure was version 2 of note a and version 3 follows, carrying on would apply version 3 first.

<<< @/examples/54-kinesis/src/consumer-lambda.ts{lambda}

## Settings of the event source mapping

<!-- section: 54.mapping -->

When the function is invoked, with how many records, and what happens when it fails are all settings of the event source mapping. Many of the defaults are dangerous, so here they are one by one. Defaults and maximums are as read in the Lambda documentation on 2026-10-13.

<<< @/examples/54-kinesis/src/settings.ts{settings}

The stack deploys these values as they are, and the local model runs the tests with the same ones.

`batchSize` is the most records in one invocation. The default is 100 and the maximum 10,000. `maximumBatchingWindowSeconds` is how long to wait for a batch to fill. With the default of 0 the function is invoked as soon as records arrive. The documentation says Lambda polls each shard once a second, and when records have piled up it keeps invoking until it has caught up.

`parallelizationFactor` is how many batches of one shard are processed at the same time. The default is 1, and it can go up to 10. The documentation says order per partition key is kept when it is raised. Order across the shard is not. This chapter leaves it at 1.

### When the function fails

When the function returns an error, Lambda hands it the same batch again. Until it succeeds, the rest of that shard is not read.

`maximumRetryAttempts` defaults to −1: retry until the record leaves the stream. One poison record then stops the shard for the retention period. The documentation says that with the default settings a bad record can block its shard for up to one week. This chapter sets 3. With the first try that makes four, and then the mapping gives up.

`maximumRecordAgeSeconds` gives up on records that are too old. With the default of −1 no record is given up on for its age. This chapter sets 6 hours. That is shorter than the 24 hours of retention, so a record that was given up on can still be read back from the stream for another 18 hours.

With `bisectBatchOnFunctionError` on, a failed batch is cut in two and each half is tried. Cutting again and again drives the bad record into a batch of its own. The documentation says cutting does not count as a retry.

`reportBatchItemFailures` makes Lambda read the partial batch response the function returns. This setting has a trap. **Without it, Lambda treats the batch as a success even when the function returned a failure.** This chapter's handler returns failures instead of throwing, so if the setting is missing, the failed record and everything after it are skipped in silence. A test of the stack checks that the setting is there.

### Where a batch given up on goes

When the retries run out or the records are too old, Lambda drops the batch and moves on. With a destination in `onFailure`, a record of what was dropped is kept. The destination can be SQS, SNS, S3, and others.

<<< @/examples/54-kinesis/src/failure-record.ts{failure-record}

The record that reaches SQS does not hold the data. It holds the stream's ARN, the shard, the first and last sequence numbers, the count, and the arrival times. To see the data you read that range back from the stream. That works only while the stream still holds the records, so a failure record has to be looked at before retention runs out. With S3 as the destination, the invocation's event is stored as well. This chapter uses SQS to keep the number of parts down.

### Where reading starts

When you create the mapping you choose where it starts. `TRIM_HORIZON` is the oldest record still there, `LATEST` is whatever is written from now on, and `AT_TIMESTAMP` is a time you give.

This chapter uses `TRIM_HORIZON`. According to the Lambda documentation a mapping can take several minutes to start reading, and with `LATEST` it can miss what was written in the meantime.

### Iterator age

Lambda publishes, as the metric `IteratorAge`, how long ago the last record of the event it handed to the function arrived in the stream. It is small when the consumer has caught up, and when the consumer is stuck it grows as fast as time passes. When it reaches the retention period, records disappear unread.

The stack has an alarm that rings when this value passes 30 minutes.

## More readers

<!-- section: 54.readers -->

To have another function read the same stream, create another event source mapping. Each mapping remembers its own position, so they do not affect each other.

They do share read throughput. According to the documentation, ordinary readers (shared throughput) divide 2 MB a second per shard among them, and GetRecords can be called five times a second per shard. The delay from write to reader is given as about 200 ms on average with one reader and about 1,000 ms with five.

Enhanced fan-out registers a reader with the stream and gives it 2 MB a second of its own on every shard. Kinesis pushes the records over HTTP/2, and the documentation gives the delay as about 70 ms whatever the number of readers. The price is USD 0.0195 an hour for each pair of a reader and a shard, the same as having one more shard, plus USD 0.0169 per GB read. Up to 20 can be registered per stream in provisioned and On-demand Standard modes.

With one or two readers and no problem with a few hundred milliseconds of delay, you do not need enhanced fan-out. This chapter's stack does not use it.

A reader without Lambda has to store how far it has read (its checkpoint) itself. The Kinesis Client Library (KCL) is a Java library that takes that on, along with assigning shards to several workers and following resharding. Other languages use it through a Java daemon called the MultiLangDaemon. This book does not cover it.

<<< @/examples/54-kinesis/src/shard-order.ts{shard-order}

This chapter's second reader (`kinesis:replay`) calls GetRecords directly. It keeps no checkpoint and reads from the start every time. It orders the shards parents first and reads each to its end, so a note's order survives a reshard.

## The stack

<!-- section: 54.stack -->

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{stream}

The stream is provisioned, with one shard. It is encrypted with the AWS managed key Kinesis keeps for each account (`aws/kinesis`). The documentation says this key has no monthly fee and that readers and writers need no KMS permission in IAM for it. The KMS requests Kinesis makes on your behalf are billed, though.

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{history}

The history table is data that can be rebuilt from the stream. It keeps the setting that deletes it with the stack, and its on-demand billing has a limit per second.

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{failures}

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{consumer}

The function's role is given four things: writing to its own log group, reading this stream, UpdateItem on the history table, and SendMessage to the failure queue. Reading the stream is the six actions the Lambda documentation lists, allowed on this stream's ARN only. It has no permission to write to the stream.

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{mapping}

What `onFailure` receives is an object that only returns the queue's ARN. CDK has a part called `SqsDlq`, but adding a permission to the role is built into it. This book writes permissions out in one place, so it is not used.

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{topic}

Where alarms are sent is built as in [chapter 44](/en/chapters/44-health.md). Pass chapter 19's topic with `-c alarmTopicArn=<ARN>` and it is used. Without it the stack creates a topic, and adds a subscription when `-c alarmEmail=<address>` is given. Any policy on a topic replaces the default one, so the right of this account's alarms to publish is written out, as in chapter 19.

<<< @/examples/54-kinesis/infra/lib/kinesis-stack.ts{alarms}

There are three alarms, each watching a different party.

`ConsumerBehind` watches the reader. It rings when the maximum of `IteratorAge` passes 30 minutes. While the function is not invoked there is no data, and that is treated as normal.

`RecordsGivenUp` watches batches that were given up on. It rings when the failure queue holds even one message. It keeps ringing until the queue is emptied, so the [deploy page](/en/chapters/54-kinesis/deploy.md) has the step that deletes the messages after you have looked.

`WritesRefused` watches the writer. It rings when the number of writes the stream refused (`WriteProvisionedThroughputExceeded`) is above 0 in three five-minute periods in a row. A moment over the limit is absorbed by the writer's retries, so it tells you only when it has lasted 15 minutes.

The stack uses twelve resource types, and cdkd 0.296.28, the version this book pins, has a provider of its own for each. None goes through Cloud Control API.
