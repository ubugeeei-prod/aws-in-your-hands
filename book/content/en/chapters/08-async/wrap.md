---
title: "08 Queue: Costs, Pitfalls, and Cleanup"
---

# 08 Queue: Costs, Pitfalls, and Cleanup

## If you come from Queues

Cloudflare has parts that play the same roles. Here they are side by side, as far as the official documentation was checked.

| | Cloudflare | This chapter |
| --- | --- | --- |
| Delivery guarantee | Queues is at-least-once by default. On rare occasions a message is delivered more than once | SQS standard queues are at-least-once too |
| Batches | Up to 10 messages, or 5 seconds, by default | Up to 10 messages. The wait is 0 by default |
| Partial failure | Call `ack()` or `retry()` on each message | Return the failed IDs in `batchItemFailures` |
| Retry limit | `max_retries`, 3 by default | The queue's `maxReceiveCount`. 5 in this chapter |
| DLQ | Set in the consumer's configuration. Without one, a message that reaches the limit is deleted | Set in the queue's redrive policy. Without one, a message keeps coming back until its retention period ends |
| Bucket events | R2 event notifications go to Queues | S3 event notifications go to SQS |
| Scheduled runs | Workers Cron Triggers | EventBridge Scheduler |

The biggest difference is how a consumer is written. With Queues, a Worker's `queue()` handler receives the messages and calls `ack()` or `retry()`. In this chapter, Lambda reads the queue and calls the function, and the function returns a list of the IDs that failed. A setting called the event source mapping sits between the queue and the function, and the batch size and the concurrency limit are written there.

The idempotency story is the same on both. Cloudflare's documentation, too, says to use a unique ID as a key if duplicates would be a problem.

The example message of an R2 notification has the object's key, size, ETag, and time, but nothing that corresponds to S3's sequencer was found. How to order operations on the same key with R2 has not been checked. The delivery guarantee of Cron Triggers was not stated on the page that was read either.

## What it costs

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices are in the [pricing worksheets](/en/reference/pricing.md).

Two unit prices are new. An SQS standard queue costs USD 0.40 per million requests. Sending, receiving, and deleting are each one request. The first million a month are free, shared by every queue in the account. EventBridge Scheduler is USD 0 up to 14 million invocations a month and USD 1.25 per million after that. Once an hour is 730 a month.

The example comes in two parts. Both are what is added on top of chapter 07's example (10,000 uploads a month).

First, the part driven by events. Suppose 10,000 creates and 1,000 deletes in the month.

| Item | List price |
| --- | --- |
| SQS requests (33,000) | 0.01 |
| Worker (11,000 Lambda invocations, 200 ms on average) | 0.01 |
| S3 GetObject (10,000) | 0.00 |
| DynamoDB (11,000 writes, 10,000 reads) | 0.01 |
| Logs | 0.01 |
| Subtotal | **0.04** |

Four cents. After the monthly free allowances it is 0.01. Next to chapter 07's data transfer, the cost per upload is a rounding error.

Then, the part driven by the clock: 10,000 images sit in the bucket and housekeeping runs every hour.

| Item | List price |
| --- | --- |
| Scheduler invocations (730) | 0.00 |
| Housekeeping function (730 runs, assumed 200 s each) | 0.49 |
| S3 LIST (14,600) | 0.07 |
| DynamoDB reads (29.2 million units) | 4.16 |
| Subtotal | **4.72** |

This one is 4 dollars 72 cents, and nearly all of it is DynamoDB reads. On every run, housekeeping reads the table four times for each of the 10,000 images. And it does that 730 times a month. After free allowances it is 4.23.

**The cost of work driven by events grows with the number of things that happen. The cost of reconciliation grows with the number of things stored, times the number of runs.** Ten times the images means ten times the housekeeping cost. And the 200 seconds per run is an assumption, not a measurement. With more images, the function's timeout (15 minutes) is in the way too. Running every 6 hours would cost one sixth. In exchange, a "rejected" image stays longer before it is deleted.

What about a month in which nobody uses it? With an empty bucket, housekeeping lists and stops, so it is USD 0.01 a month. One thing is not in that number, though. Lambda goes and reads the empty queue as well (long polling). Each `ReceiveMessage` counts as an SQS request. How often it reads is not given as a number in the documentation, so it could not be estimated. It is not zero. Whether it fits within the free million a month has not been checked either.

Delete the stack and the queues, the functions, and the schedule are gone, and this chapter's share of the charges stops.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| `dev:async` stops, naming `LOCAL_AUTH_SECRET` or `NOTES_STORE` | Is there an `examples/08-async/.env`? Copy `.env.example` |
| The deploy fails creating the bucket with `Unable to validate the following destination configurations` | Was the queue policy created before the bucket? Does the policy's `aws:SourceArn` match the bucket's ARN? |
| The deploy says the bucket name is already taken | Is a bucket named `aih-async-uploads-<account ID>` left over somewhere? |
| There is one message in the DLQ right after deploying | Is the S3 test event being failed? This chapter's worker accepts it and does nothing |
| An image is put, and no record appears | Use `vp run async:queue` to see whether a message reached the queue. If not, it is the S3 notification. If it stays there, it is the event source mapping or the worker |
| The worker's log says `carries no eTag or no sequencer` | The create event has no sequencer. See "Not checked yet" in the notes at the end |
| The worker's log has a 403, and messages land in the DLQ | Without `s3:ListBucket` on the worker's role, `GetObject` on a deleted object is a 403, not a 404 |
| Messages that should have succeeded are processed again and again | Is the shape of `batchItemFailures` right? An ID that is not in the batch, or an empty ID, makes everything count as failed |
| A message that should have failed is gone | Does the event source mapping have `ReportBatchItemFailures`? Without it, the list the function returns should go unused |
| Messages with nothing wrong in them pile up in the DLQ | Is the worker returning "already done" as a failure? |
| The housekeeping function times out | There are too many objects. See "What it costs" and "Before production" |

## Before production

- **Put an alarm on the DLQ.** A DLQ that nobody looks at is just a bin. Raise an alert when `ApproximateNumberOfMessagesVisible` is no longer 0. On the source queue, alarm on the age of the oldest message (for how to put an alarm together, see [chapter 19](/en/chapters/19-observability.md))
- **Do not show an image until it is inspected.** The API in this chapter does not look at the inspection result. A "rejected" image is listed until housekeeping deletes it. Read the inspection record when listing attachments and give a URL only to the ones that are `ok`
- **Stop housekeeping from growing with the number of images.** Look only at recent objects instead of all of them. Or use S3 Inventory (a feature in which S3 periodically writes a listing of the bucket to files) as the input. This chapter tried neither
- **Check the sequencer.** Look at the real shape of POST events and lifecycle events, then settle the worker's assumptions again
- **Close the way inspection records are left behind.** The tombstone and TTL from "What is still open"
- **Decide whether to encrypt the queues with a KMS key.** This chapter uses keys that SQS manages. With a key you manage, the key's policy has to let S3 use it
- **Decide how buckets are named.** The fixed name is this chapter's convenience. Accept the custom resource, put EventBridge in between, or agree on a naming rule in your organization
- **Make the create API idempotent.** The homework left from chapter 05

## Cleaning up

<!-- section: 08.cleanup -->

```bash
vp run async:empty --yes
vp run async:unpublish --yes
vp run async:infra:destroy
```

As in chapter 07, empty the two buckets first. Deleting images with `async:empty` puts one delete event on the queue per image, and the worker removes the inspection records one by one. If you are deleting the stack right away, there is no need to wait for that. The table goes with it.

`async:infra:destroy` deletes the queue, the DLQ, the two functions, the schedule, and all of chapter 07's resources (buckets, table, user pool, API, distribution). Messages still on the queues are deleted too. None of it can be brought back.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** Worker tests (the same message delivered again, the same event under another ID, two workers at once, an older create event, a delete that arrives first, a delete that arrives late, an interruption before and after the record, the repair after a form is sent twice, verdicts on things that are not images). Tests around the queue (a partly failed batch, moving to the DLQ, a function that throws, the S3 test event, a key that is not this chapter's, moving back from the DLQ). Housekeeping tests (deleting a "rejected" attachment, not using a stale verdict, taking the tag off again, a dry run, two runs, concurrent runs, an interruption). Reading image type and size (real files written by `sips` and `cwebp`). Parsing the event JSON and comparing sequencers. The shape of requests to DynamoDB and S3. Infrastructure assertions. Type checking and synth. In addition, two of the worker's conditions were broken on purpose, and four tests failed. `dev:async` was started and driven over HTTP by a script to check: sign-in, creating a note, a form upload, the worker's record (`ok`, 1×1), finishing, the record turning to `rejected` when the same form sends HTML, a housekeeping dry run, and the record disappearing on delete.

**Not checked yet.** Nothing has been run against AWS. None of `async:infra:diff`, `async:infra:deploy`, `async:smoke`, `async:queue`, `async:logs`, `async:housekeeping`, `async:publish`, `async:smoke:web`, `async:user:create`, `async:infra:drift`, `async:empty`, `async:unpublish`, or `async:infra:destroy`. So the following are unconfirmed on the real services. That the event for an object created with a form (POST Object), and the event for a delete by a lifecycle rule, carry a sequencer (the documentation says it is "only used with PUT and DELETE requests"). That the template that fixes the bucket's name to avoid the cycle deploys with cdkd. That S3 validates the queue when the notification is configured. That S3 can send to a queue encrypted with keys SQS manages (the S3 documentation explains only the case of a KMS key you manage). That `If-Match` with a quoted ETag gets a 412 for an object that was replaced. How the event source mapping and the partial batch response really behave. That Scheduler starts the function. The DynamoDB and S3 implementations have only had the shape of their requests pinned by tests; nothing was sent to the real services. How often Lambda reads an empty queue, and how long housekeeping runs, were not measured. Of the image formats, the JPEG specification (ITU-T T.81) was not re-read; the behaviour was checked only against files written by a real encoder.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Looking inside the image | `examples/08-async/src/inspect.ts`, `src/inspection.ts`, `test/inspect.test.ts`, `test/fixtures.ts` | `test:unit` |
| Nobody said "delivered exactly once" | `examples/08-async/src/events.ts`, `src/worker.ts`, `test/events.test.ts`, `test/queue.test.ts` | `test:unit` |
| Twice delivered, one result | `examples/08-async/src/worker.ts`, `src/sequencer.ts`, `src/object-reader.ts`, `src/s3-object-reader.ts`, `src/dynamodb-inspection-repository.ts`, `test/worker.test.ts`, `test/adapters.test.ts`, `test/harness.ts` | `test:unit` |
| Housekeeping by the clock | `examples/08-async/src/housekeeping.ts`, `src/housekeeping-lambda.ts`, `test/housekeeping.test.ts`, `scripts/housekeeping.ts` | `test:unit`, `async:housekeeping` |
| Running it locally | `examples/08-async/src/dev.ts`, `src/local.ts`, `src/local-queue.ts`, `src/local-bucket.ts`, `.env.example` | `dev:async`, `dev:uploads:web`, `test:unit` |
| Getting ready for AWS | `examples/08-async/infra/lib/async-stack.ts`, `infra/bin/app.ts`, `infra/test/async-stack.test.ts`, `src/worker-lambda.ts`, `src/env.ts`, `cdk.json` | `async:infra:synth`, `test:unit` |
| Deploying and checking | `examples/08-async/scripts/smoke.ts`, `scripts/user.ts`, `scripts/write-config.ts`, `tools/src/site/`, `tools/src/infra/` | `async:infra:diff`, `async:infra:deploy`, `async:smoke`, `async:user:create`, `async:publish`, `async:smoke:web`, `async:infra:drift` |
| When it backs up, when it falls over | `examples/08-async/scripts/queue.ts`, `scripts/logs.ts` | `async:queue`, `async:logs` |
| Cleaning up | `examples/08-async/scripts/empty-uploads.ts`, `scripts/user.ts`, `tools/src/site/unpublish.ts` | `async:empty`, `async:unpublish`, `async:infra:destroy`, `async:user:delete` |
| What it costs | `data/pricing/` | `test:unit` |

**Primary sources** (all checked on 2026-10-12)

- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html), [Amazon SQS standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html), [Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html), [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html), [Amazon SQS message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html), [Learn how to configure a dead-letter queue redrive in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html), [StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html), [Creating alarms for dead-letter queues using Amazon CloudWatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html), [Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html), [Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html), [Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html), [Lambda parameters for Amazon SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html), [AWSLambdaSQSQueueExecutionRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaSQSQueueExecutionRole.html)
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html), [Event notification types and destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html), [Event message structure](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html), [Granting permissions to publish event notification messages to a destination](https://docs.aws.amazon.com/AmazonS3/latest/userguide/grant-destinations-permissions-to-s3.html), [Using Amazon SQS, Amazon SNS, and Lambda](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-enable-disable-notification-intro.html)
- [AWS::S3::Bucket NotificationConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-notificationconfiguration.html)
- [How to retrieve or copy objects based on metadata with conditional reads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html), [GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Manage event ordering and duplicate events with Amazon S3 Event Notifications](https://aws.amazon.com/blogs/storage/manage-event-ordering-and-duplicate-events-with-amazon-s3-event-notifications/) (AWS Storage Blog; the post the S3 user guide refers to)
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html), [Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html), [Setting up Amazon EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html), [Confused deputy prevention](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html), [RetryPolicy](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_RetryPolicy.html), [Schedule types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html), [Invoke a Lambda function on a schedule](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html)
- [Supported data types and naming rules in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/), [Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/), AWS Price List bulk API: [SQS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json), [EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json)
- [WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container), [GIF89a Specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)
- Cloudflare: [Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Queues: Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Queues: Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/), [R2: Event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/), [Workers: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [register-providers.ts in cdkd v0.296.28](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
