---
title: "54 Kinesis: Costs, Pitfalls, and Cleanup"
---

# 54 Kinesis: Costs, Pitfalls, and Cleanup

This chapter's stack holds a resource that is billed by the hour. The price comes first, then the places people trip, then cleanup.

## Price

<!-- section: 54.cost -->

The unit prices are the Tokyo Region's, read from the AWS Price List bulk API on 2026-10-13. Every amount is an estimate and was not checked on a bill. The inputs and results of the arithmetic are in the [pricing reference](/en/reference/pricing.md).

### While unused

**Deployed with nothing written, a month comes to USD 14.85 at list price and USD 14.49 after the free allowances.**

| Item | Quantity | List | After allowance |
| --- | ---: | ---: | ---: |
| The stream's shard (provisioned) | 1 × 730 hours | 14.23 | 14.23 |
| CloudWatch alarms | 3 | 0.30 | 0 |
| KMS requests | 105,120 | 0.32 | 0.26 |

The shard is charged for the time it exists. Whether you write or not, and whether the function runs or not, it is the same. The pricing page says Kinesis Data Streams is not part of the AWS Free Tier.

The KMS requests are the Kinesis guide's estimate taken as it is: for an encrypted stream read from the tip with one credential, Kinesis calls KMS about 12 times every 5 minutes. Whether that many are billed for the AWS managed key, and at the same rate while the function is not running, was not checked.

The function, the history table, and the failure queue cost nothing while no record flows. Lambda's reads of the shard are not billed by themselves on a provisioned stream.

With the stream of the same stack in On-demand Standard mode, an unused month comes to USD 38.22. The hourly charge for one stream (USD 37.96) is 2.7 times that of one shard.

### While in use

One million revisions written in a month. Each is taken as 0.2 KB, and the function as receiving 10 at a time on average: 100,000 invocations of 200 ms.

| Item | Quantity | List | After allowance |
| --- | ---: | ---: | ---: |
| The stream's shard | 730 hours | 14.23 | 14.23 |
| PUT payload units | 1,000,000 | 0.02 | 0.02 |
| Lambda requests | 100,000 | 0.02 | 0 |
| Lambda duration | 5,000 GB-seconds | 0.07 | 0 |
| DynamoDB writes | 1,000,000 units | 0.71 | 0.71 |
| Log ingestion | 0.02 GB | 0.02 | 0 |
| Alarms | 3 | 0.30 | 0 |
| KMS requests | 105,120 | 0.32 | 0.26 |

The list subtotal is USD 15.69, and USD 15.23 after the free allowances. The difference from an unused month is under a dollar. At this size nearly all of the bill is for the stream being there.

The same usage with an On-demand Standard stream is USD 39.04. On-demand counts each record written as rounded up to 1 KB, so a 0.2 KB record is billed as five times its size. Even so that is USD 0.10 for a million records, and the hourly charge is what makes the difference.

One shard accepts up to 1,000 records a second, so the most it can take in a month is about 2.6 billion. Since the provisioned price follows the number of shards, the amount hardly changes while the traffic fits in one shard.

### Settings that raise the bill

- Each added shard is USD 14.23 a month
- Retention beyond 24 hours adds USD 0.026 an hour per shard, up to 7 days
- A registered enhanced fan-out consumer is USD 0.0195 an hour per pair of consumer and shard, plus USD 0.0169 per GB read
- Enabling On-demand Advantage sets the account's minimum at USD 4,003.59 a month

### After deleting

`vp run kinesis:infra:destroy` deletes the stream, the function, the table, the queue, the log group, the alarms, and the topic. Nothing is charged afterwards.

## Pitfalls

<!-- section: 54.pitfalls -->

**Nothing happens.** A mapping created with `LATEST` does not read records written while it was being created. This chapter uses `TRIM_HORIZON`. Even so, a new mapping can take several minutes to start reading.

**The function returns a failure and nothing is retried.** `ReportBatchItemFailures` is missing from the mapping's `FunctionResponseTypes`. Without it Lambda does not look at the return value and treats the batch as a success.

**A shard has stopped.** If `IteratorAge` keeps growing, the same batch is failing over and over. Search the function's log for `poison record` or `record not applied`. A mapping with no limit on retries stays stuck until the record leaves the stream.

**There is a failure record, and its records cannot be read.** The records it points at leave the stream 24 hours after they were written. The queue keeps the failure record for 14 days, but the data can be read back only during the first day.

**Writes are refused.** `ProvisionedThroughputExceededException` is returned when a shard's limit (1,000 records or 1 MB a second) is passed. It happens with capacity to spare in the stream as a whole when writes concentrate on one partition key.

**A sequence number was handled as a number.** An integer of 56 digits does not fit in a number. Converted with `Number`, neighbouring sequence numbers become the same value. Compare them as `BigInt`.

**Order broke after the number of shards changed.** After a split or a merge, the parent shard has to be read to its end before the children. Whether a Lambda mapping does so could not be confirmed in this chapter. If a history's `missing` stops being 0, suspect this.

## For production

<!-- section: 54.production -->

- **Keep the resources.** The stream and the history table are set to `RemovalPolicy.DESTROY` for practice. Deleting the stream deletes the records nobody has read yet
- **Choose retention from how long you can be down.** With 24 hours, a function that stops over a weekend has nothing left on Monday. Add the time it takes to notice to the time it takes to fix the consumer. What you add becomes a charge
- **Estimate the number of shards.** The documentation's formula is the larger of the write bandwidth divided by 1,024 KiB/s and the read bandwidth (writes × number of readers) divided by 2,048 KiB/s, rounded up. If you cannot predict the traffic, use on-demand
- **Make the alarms reach a person.** Without `alarmEmail` or `alarmTopicArn`, an alarm is published to a topic that nobody reads
- **Decide what happens to a batch given up on.** Who looks, within how many hours, and what they do. Whether to read it back, fix it and write it again, or to drop it, depends on the data. With S3 as the destination the data survives the retention period
- **Give the writer its own permission.** In this chapter a script wrote with your credentials. An application that writes needs `kinesis:PutRecords` on its role, for this stream's ARN only
- **Decide whether to manage the key yourself.** To decide who can decrypt in a key policy, use a key of your own as in chapter 21. The documentation says the writer then needs `kms:GenerateDataKey` and the reader `kms:Decrypt`. The key's monthly fee is added too
- **Release the reader first when the record's shape changes.** Records of the old shape stay in the stream for the retention period, and come out again every time someone rereads. It takes the same thinking as the event versions of chapter 25

## Cleanup

<!-- section: 54.cleanup -->

```bash
vp run kinesis:infra:destroy
```

This deletes everything the stack created, including the records left in the stream and the history table. Left in place it is billed every hour, so delete it the day you finish trying it.

The email subscription is a resource of the stack and goes with it. All that remains is the storage cdkd's bootstrap created (chapter 02).

## As a distributed system

<!-- section: 54.distributed -->

- Who owns the state: the stream holds the record of what happened, and loses it after 24 hours. The history table is a copy derived from the stream. It outlives the stream, so after 24 hours the table is the only record. It can be rebuilt only while the stream still holds the records
- The invariant: for each note, every revision is applied once and in order. In its weaker form: a history's version never goes down, and no revision is counted twice
- Who keeps what: "once" and "never down" are kept by the reader's conditional update. Nothing the stream or the writer does can break them. "In order" and "every" hold when three things are true together: the writer writes each note in order, the shard keeps the order, and the mapping does not give up on a batch. When one fails, it shows as a difference between `version` and `revisions`
- Tests that try to break the invariant: a batch redelivered after its response was lost, a write resent after its response was lost, a partial failure of PutRecords, a poison record, and a child shard read before its parent. Each is reproduced in a fixed order
- What is not guaranteed: that the function's side effects happen once. The update of the history takes effect once, but if the function sent an email there could be two. Order between different notes is not guaranteed either
- The price of order: a reader that keeps order stops at one failure. Giving up so as not to stop leaves a gap. This chapter chose to try four times, give up, record where, and count the gap. Where to settle is for the data to decide

::: details Verification notes for this chapter

**Checked locally.** 76 unit tests (partition keys mapped to shards, order within a shard, two readers, reading again from a chosen position, retention, the per-shard write limit and a hot key, a split, PutRecords' partial failures and order, duplicates from resending, the handler applying records and reporting a poison record, redelivery not being counted twice, a poison record under each setting, the setting under which a partial batch response is skipped, the order of parent and child shards, a reader added later, the shape of requests to DynamoDB and Kinesis, parsing the documented failure record, and stack assertions). That the tests fail when six conditions are broken on purpose. The type check. The output of `kinesis:demo`. That `kinesis:infra:synth` generates the template without calling AWS, function bundle included. That `vp check --fix` on the chapter's own files gives no warning, awscdk-lint included.

**Not checked yet.** Nothing was run on AWS. How the stream and the event source mapping behave was checked only against models built from the documentation. In particular, these were not seen on the service:

- That with partial batch responses and bisecting both on, only the one failing record is given up on. How retries are counted for the halves of a split batch
- That the failure record reaches SQS in the shape of the documentation's example
- Whether a Lambda mapping reads a parent shard to its end before its children after a split or a merge. No statement was found in the Lambda documentation that was read
- That `IteratorAge` keeps growing while the mapping is stuck, and that the alarm rings
- The number of KMS requests in an unused month, and their billing
- That the alarms can publish when chapter 19's topic is passed with `-c alarmTopicArn`
- Deploying and deleting with cdkd. The four scripts in `scripts/` only passed the type check
- Latency and throughput. Neither was measured
- The assumptions behind the prices. The function's duration, the average batch size, and the volume of logs were not measured

The documentation also disagrees with itself in places. The limit on a record's size is 1 MB on the terminology page, and 1 MiB by default and up to 10 MiB by a setting on the quotas page and in the API reference. A shard's write limit is given as 10 MiB a second only in the PutRecord row of the quotas page. This chapter uses 1 MB, as the terminology page and the pricing page do. One page gives the maximum retention as 7 days, and this chapter follows the retention page's 365.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The shape of a record | `examples/54-kinesis/src/revision.ts` | `test:unit` |
| Shards and ordering | `examples/54-kinesis/src/local-stream.ts`, `test/stream.test.ts` | `test:unit` |
| The writer | `examples/54-kinesis/src/producer.ts`, `src/kinesis-writer.ts`, `test/producer.test.ts` | `test:unit` |
| The reader | `examples/54-kinesis/src/history.ts`, `src/dynamodb-history.ts`, `src/consumer.ts`, `src/consumer-lambda.ts`, `test/consumer.test.ts` | `test:unit` |
| Settings of the event source mapping | `examples/54-kinesis/src/settings.ts`, `src/failure-record.ts`, `test/poller.test.ts` | `test:unit` |
| More readers | `examples/54-kinesis/src/shard-order.ts`, `scripts/replay.ts` | `test:unit`, `kinesis:replay` |
| The stack | `examples/54-kinesis/infra/lib/kinesis-stack.ts`, `infra/bin/app.ts`, `infra/test/kinesis-stack.test.ts` | `test:unit`, `kinesis:infra:synth` |
| The local models | `examples/54-kinesis/src/local-stream.ts`, `src/local-poller.ts`, `src/local.ts`, `scripts/demo.ts` | `kinesis:demo` |
| Deploy and check | `examples/54-kinesis/scripts/put.ts`, `scripts/history.ts` | `kinesis:infra:diff`, `kinesis:infra:deploy`, `kinesis:put`, `kinesis:history`, `kinesis:infra:drift` |
| Reading again, and batches given up on | `examples/54-kinesis/scripts/replay.ts`, `scripts/failures.ts` | `kinesis:replay`, `kinesis:failures` |
| Price | `data/pricing/` | |
| Cleanup | `tools/src/infra/` | `kinesis:infra:destroy` |

**How cdkd (0.296.28) handles the types.** With a provider of their own in `src/provisioning/register-providers.ts`: `AWS::Kinesis::Stream`, `AWS::Lambda::EventSourceMapping`, `AWS::Lambda::Function`, `AWS::DynamoDB::Table`, `AWS::SQS::Queue`, `AWS::SQS::QueuePolicy`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::CloudWatch::Alarm`, `AWS::Logs::LogGroup`, `AWS::IAM::Role`, `AWS::IAM::Policy`. No type in this stack goes through Cloud Control API.

**Primary sources** (all checked on 2026-10-13)

- Kinesis Data Streams Developer Guide: [Terminology and concepts](https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html), [Quotas and limits](https://docs.aws.amazon.com/streams/latest/dev/service-sizes-and-limits.html), [Choose the right mode to stream in](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html), [Change the data retention period](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html), [Develop producers using the API](https://docs.aws.amazon.com/streams/latest/dev/developing-producers-with-sdk.html), [Large records](https://docs.aws.amazon.com/streams/latest/dev/large-records.html), [Enhanced fan-out consumers](https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html), [Complete the resharding action](https://docs.aws.amazon.com/streams/latest/dev/kinesis-using-sdk-java-after-resharding.html), [Use Kinesis Client Library](https://docs.aws.amazon.com/streams/latest/dev/kcl.html), [Handle duplicate records](https://docs.aws.amazon.com/streams/latest/dev/kinesis-record-processor-duplicates.html), [Costs, Regions, and performance considerations](https://docs.aws.amazon.com/streams/latest/dev/costs-performance.html), [Permissions to use user-generated KMS keys](https://docs.aws.amazon.com/streams/latest/dev/permissions-user-key-KMS.html), [Monitoring with CloudWatch](https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html)
- Kinesis API Reference: [PutRecords](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html), [PutRecord](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecord.html), [GetShardIterator](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetShardIterator.html), [GetRecords](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetRecords.html)
- Lambda Developer Guide: [Using Lambda to process records from Kinesis Data Streams](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html), [Process Kinesis Data Streams records with Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-create.html), [Parameters for Kinesis event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html), [Partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-batchfailurereporting.html), [Retain discarded batch records](https://docs.aws.amazon.com/lambda/latest/dg/kinesis-on-failure-destination.html), [Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html), [Event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html)
- CloudFormation: [AWS::Kinesis::Stream](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kinesis-stream.html)
- Pricing: [Amazon Kinesis Data Streams pricing](https://aws.amazon.com/kinesis/data-streams/pricing/), [AWS Price List bulk API: AmazonKinesis](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonKinesis/current/ap-northeast-1/index.json) (the unit prices of Lambda, DynamoDB, logs, alarms, and KMS are the ones confirmed in chapters 04, 05, 19, and 21)
- Other choices: [Change data capture with Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/streamsmain.html), [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html), [What Is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html), [What is the EventBridge Custom Event Bus?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-what-is.html), [Amazon MSK Developer Guide](https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html), [What is Amazon Managed Service for Apache Flink?](https://docs.aws.amazon.com/managed-flink/latest/java/what-is.html), [Firehose: source settings for Kinesis Data Streams](https://docs.aws.amazon.com/firehose/latest/dev/writing-with-kinesis-streams.html)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- Cloudflare: [Basin Pipelines](https://developers.cloudflare.com/pipelines/), [Basin Pipelines: Streams](https://developers.cloudflare.com/pipelines/streams/), [How Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/), [Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

:::
