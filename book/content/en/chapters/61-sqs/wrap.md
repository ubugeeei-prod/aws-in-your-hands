---
title: "61 SQS: Costs, Pitfalls, and Cleanup"
---

# 61 SQS: Costs, Pitfalls, and Cleanup

For the setup built from the [first page](/en/chapters/61-sqs.md) through the [deploy page](/en/chapters/61-sqs/deploy.md), this page covers what it costs, where it tends to go wrong, what to add for production, and how to clean up.

## Price

<!-- section: 61.cost -->

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices are in the [pricing calculations](/en/reference/pricing.md). The unit prices were read from the AWS Price List on 2026-10-13.

SQS is priced by the number of requests. A FIFO queue is USD 0.50 per million requests and a standard queue USD 0.40. A send, a receive, a delete, and a change of the visibility timeout are one request each. The first million requests a month are free, and that allowance is one for the whole account, standard and FIFO queues together. The Price List has unit prices for requests only: none for a queue that exists, and none for the messages waiting in it.

Two rules decide how requests are counted.

<<< @/examples/61-sqs/src/cost.ts{cost}

The first is size. Every 64 KB counts as one request, so sending one message of 1 MiB is 16 requests. A batch of ten is more than one request too, once its total goes over 64 KB.

The second is the empty receive. A `ReceiveMessage` is a request even when there is no message. One consumer reading an empty queue with 20-second long polling makes 131,400 of them a month.

### A month with nothing sent

| Item | List price |
| --- | --- |
| Alarms (two) | 0.20 |
| SQS requests (657,000 empty receives, assumed) | 0.33 |
| Subtotal | **0.53** |

If this fits in the monthly free allowances (10 alarms, 1 million SQS requests), it is 0.

The number of empty receives is an assumption. The official documentation gives no figure for how often Lambda reads an empty queue. What it states is that Lambda scales back to five concurrent invokes when traffic is low, and that the further reduction to two is not available when maximum concurrency is set. The count here therefore takes five long polls of 20 seconds to be running at all times. The real number is in the queue's `NumberOfEmptyReceives` metric. After deploying, look at one day of it and compare it with this assumption.

### 100,000 commands a month

| Item | List price |
| --- | --- |
| Alarms (two) | 0.20 |
| SQS requests (957,000) | 0.48 |
| Worker (100,000 Lambda runs, assumed 100 ms each) | 0.05 |
| DynamoDB writes (400,000 units) | 0.29 |
| Logs | 0.02 |
| Subtotal | **1.04** |

After the free allowances it is 0.29, and what remains is the DynamoDB writes. Each command writes two items in a transaction, the marker and the note, which is 4 units. The price of taking effect once shows here, not in SQS.

The SQS requests are the 657,000 empty receives plus three requests per command (send, receive, delete). That is the figure with no batching at all, so it is an estimate near the upper end. A sender that batches by ten brings the sends down from 100,000 to 10,000. The worker's run time was not measured.

### With a KMS key

| Item | List price |
| --- | --- |
| A key you manage (one) | 1.00 |
| KMS requests (26,280) | 0.08 |
| Subtotal | **1.08** |

This chapter's stack uses the key SQS manages and does not pay this. It is the estimate for one command queue after switching to a KMS key of your own. After the free allowance for KMS requests (20,000 a month) it is 1.02.

The count comes from the formula in the SQS guide. SQS reuses a data key it got from KMS for a set time. That time, the data key reuse period, is 5 minutes by default and can be set from 60 seconds to 24 hours. A month divided by 5 minutes is 8,760, multiplied by 2 for each principal that sends and 1 for each that receives. With one of each that is 26,280. A longer reuse period means fewer calls, and the guide says a shorter one is more secure. It also says the real number of calls can be higher than the formula gives.

### If someone hammers it

This chapter's queue has no entrance reachable from the internet. Only a principal that IAM allows `sqs:SendMessage` can send.

The processing side has two ceilings. At most two workers run at once, and the table takes at most 100 write units a second. However many commands arrive, the cost of the worker and of DynamoDB cannot grow faster than those two allow. What piles up waits in the queue and is gone after 4 days.

Nothing in this setup limits the number of sends. If a principal with permission to send sends a great many, the charge for SQS requests grows with the number sent.

## Where it tends to go wrong

| If this happens | Look here |
| --- | --- |
| A send fails for lack of a message group ID | A FIFO queue requires one. Check that nothing sends without going through `toEntry` |
| A send fails for lack of a deduplication ID | This queue has content-based deduplication off. Set `MessageDeduplicationId` |
| A send fails with `InvalidMessageContents` | The body contains a character SQS does not accept. See "A command, and its names" on the [design and build page](/en/chapters/61-sqs/build.md) |
| A message was sent and is not in the queue | The same deduplication ID was used within five minutes. A rising `NumberOfDeduplicatedSentMessages` confirms it |
| The deployment says a queue name is already in use | Check that `aih-sqs-commands.fifo` and `aih-sqs-dead-letters.fifo` are not left over in the same Region. The [deploy page](/en/chapters/61-sqs/deploy.md) says why the names are fixed |
| The event source mapping cannot be created | Check that the function's timeout does not exceed the queue's visibility timeout |
| One note's commands do not move | The first message of that group keeps failing. Look for `message failed` in the worker's log. After 5 minutes it moves to the dead-letter queue |
| The same line was added twice | Check for a path that writes without the ledger, and for a resend after the marker's 30 days |
| The title went back to an older one | Check that the worker does not carry on after a failure. The `batchItemFailures` it returns should hold everything after the failed message |
| Good commands arrived in the dead-letter queue in a bunch | Either a failure that waiting cures happened five times in a row, or an unreadable message is being returned as a failure. In the first case fix the cause, then move them back with `vp run sqs:status --redrive` |
| A command moved back by a redrive goes straight to the dead-letter queue again | It is an unreadable message. Until the worker is fixed, moving it back gives the same result |
| An alarm rings and reaches nobody | The stack was deployed without `alarmTopicArn`. See the [deploy page](/en/chapters/61-sqs/deploy.md) |
| After deploying, SQS is billed although the queue is empty | Those are Lambda's empty receives. See "A month with nothing sent" on this page |

## For production

- **Make the alarms reach a person.** By default an alarm only changes state. Connect it to chapter 19's topic
- **Decide how the dead-letter queue is looked at.** Who looks, when, what is moved back, and what is thrown away. An unreadable message is not cured by moving it back
- **Decide for each command whether its order may be broken.** This chapter chose to set one aside and let the rest go ahead. If you add commands that build on the one before, remove the dead-letter queue and let the group stop
- **Set a deadline for the sender's retries.** A marker is gone after 30 days. If a sender resends the same command later than that, lengthen the period or stop the sender
- **Write to chapter 05's notes table.** This chapter's `Edits` is for practice. Decide how it lives with chapter 05's optimistic lock by version
- **Measure the empty receives.** Read `NumberOfEmptyReceives` and replace the estimate for an idle month with a measurement
- **Reconsider what a group is.** With a group per note, a note with many edits moves one command at a time. A group per user means fewer lines, and one user's notes then wait for each other
- **Consider high throughput mode when throughput runs short.** This chapter did not try it. The documentation's pages give different limits, so check Service Quotas
- **Choose the encryption key.** If there is a requirement, use SSE-KMS and add to the key's policy what senders, receivers, and services need

## Cleanup

<!-- section: 61.cleanup -->

```bash
vp run sqs:infra:destroy
```

The two queues, the function, the role, the table, the log group, and the alarms are deleted. So are the messages left in the queues and the notes and markers in the table. This cannot be undone. This chapter has no bucket that has to be emptied first.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. A topic passed as `alarmTopicArn` does not belong to this stack and is not deleted.

::: details Verification notes for this chapter

**Checked locally.** 75 tests. The rules of the queue model (a message group ID and a deduplication ID are required, the five minutes of deduplication and the ID being remembered after a delete, order within a group, nothing returned from a group that is still out, old receipt handles, extending the visibility timeout, zero, and the 12-hour limit, the move to the dead-letter queue, messages of the same batch being dragged along, redrive). The invariant of the worker and the ledger (a resend within and after five minutes, the race with a worker past its visibility timeout, a late worker not undoing a later command, stopping at a failure inside a batch, setting aside an unreadable message, leaving it when it cannot be set aside, answering a command that can never apply once, a redrive after a long outage, moving back a command that was already applied). The check of the visibility timeout and the heartbeat arithmetic. Commands as messages, the characters SQS refuses, the building of batches (10 entries, 1 MiB, one per group), and a batch that fails in part. Packing and unpacking a large message. How requests are counted (64 KB, empty receives, the KMS formula). The shape of requests to DynamoDB and SQS. The stack's assertions (the FIFO settings, encryption, queue policies, the role's permissions, the event source mapping, the alarms, the list of resource types). The type check. `sqs:infra:synth` producing the template of the default configuration without asking AWS anything. The output of `sqs:demo`. Breaking the code on purpose in four places, with 3, 4, 2, and 3 tests failing.

**Not checked yet.** Nothing was run against AWS: none of `sqs:infra:diff`, `sqs:infra:deploy`, `sqs:send`, `sqs:status`, `sqs:infra:drift`, or `sqs:infra:destroy`. So the following were not confirmed on the real services. That cdkd creates the two FIFO queues with their fixed names. That a FIFO queue's deduplication and group order behave as the model does. That maximum concurrency and partial batch responses work as expected on an event source mapping for a FIFO queue. That the receive counts of messages handed over in the same batch go up together with the unreadable message's (this is derived from the documented rules, and how many messages Lambda's poller receives at a time is not documented). That the worker can send to the FIFO dead-letter queue directly, and that such a message can be moved back by a redrive that names its destination. The transaction of the DynamoDB ledger (that the expressions are accepted, and the order of the cancellation reasons). DynamoDB Local needs Docker, which the Nix shell does not include, so it was not run against the emulator either. That TTL removes the markers. That the alarms ring. A send from another account. How often Lambda reads an empty queue and how long the worker runs were not measured. The price tables are arithmetic from unit prices and assumptions. High throughput mode, provisioned mode, fair queues, SSE-KMS, SNS FIFO topics, and delay queues were read about in the documentation and not used. Whether a resend with the same deduplication ID inside the five minutes extends the five minutes could not be read from the documentation.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, Standard queues and FIFO queues | `examples/61-sqs/infra/lib/sqs-stack.ts`, `src/fifo-queue.ts`, `test/fifo-queue.test.ts` | `test:unit` |
| A command, and its names | `examples/61-sqs/src/command.ts`, `src/producer.ts`, `test/producer.test.ts` | `test:unit` |
| Taking effect once | `examples/61-sqs/src/ledger.ts`, `src/dynamodb-ledger.ts`, `src/naive.ts`, `test/worker.test.ts`, `test/adapters.test.ts`, `test/harness.ts` | `test:unit` |
| The visibility timeout is a lease | `examples/61-sqs/src/lease.ts`, `test/lease.test.ts`, `test/fifo-queue.test.ts` | `test:unit` |
| Lambda reads the queue | `examples/61-sqs/src/worker.ts`, `src/poller.ts`, `src/sqs-sender.ts`, `test/worker.test.ts` | `test:unit` |
| Details on the sending side | `examples/61-sqs/src/producer.ts`, `src/sqs-sender.ts`, `src/large-message.ts`, `test/producer.test.ts`, `test/large-message.test.ts` | `test:unit` |
| Run it locally | `examples/61-sqs/scripts/demo.ts`, `src/fifo-queue.ts`, `src/poller.ts` | `sqs:demo`, `test:unit` |
| Reading the stack, Who may use the queues | `examples/61-sqs/infra/lib/sqs-stack.ts`, `infra/bin/app.ts`, `infra/test/sqs-stack.test.ts`, `src/worker-lambda.ts`, `src/env.ts`, `src/settings.ts`, `cdk.json` | `sqs:infra:synth`, `test:unit` |
| Deploy and check | `examples/61-sqs/scripts/send.ts`, `scripts/status.ts` | `sqs:infra:diff`, `sqs:infra:deploy`, `sqs:send`, `sqs:status`, `sqs:infra:drift` |
| Price | `examples/61-sqs/src/cost.ts`, `test/cost.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `examples/61-sqs/infra/lib/sqs-stack.ts` | `sqs:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- [Amazon SQS queue types](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html), [Amazon SQS FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html), [FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html), [Exactly-once processing](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html), [Using the message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagededuplicationid-property.html), [When to provide a message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/providing-message-deduplication-id.html), [Using the message group ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html), [FIFO queue and message identifiers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queue-message-identifiers.html), [Moving from a standard queue to a FIFO queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-moving.html), [FIFO queue and Lambda concurrency behavior](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/fifo-queue-lambda-behavior.html)
- [High throughput for FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html), [Enabling high throughput for FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/enable-high-throughput-fifo.html), [Amazon SQS message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html), [Amazon SQS FIFO queue quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-fifo.html), [Amazon SQS fair queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html)
- [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html), [Processing messages in a timely manner](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-processing-messages-timely-manner.html), [Configuring visibility timeouts](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/working-with-visibility-timeouts.html), [Amazon SQS short and long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html), [Amazon SQS batch actions](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-batch-api-actions.html), [Managing large Amazon SQS messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-managing-large-messages.html), [Amazon SQS delay queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html), [Amazon SQS message timers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-timers.html), [Message metadata for Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-metadata.html)
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html), [Learn how to configure a dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html), [Creating alarms for dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html), [Available CloudWatch metrics for Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Encryption at rest in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html), [Amazon SQS Key management](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-key-management.html), [Basic examples of Amazon SQS policies](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-examples-of-sqs-policies.html), [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html), [Cross-account policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html)
- API reference: [SendMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html), [SendMessageBatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html), [ReceiveMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html), [ChangeMessageVisibility](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ChangeMessageVisibility.html), [DeleteMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html), [CreateQueue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html), [StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html), [Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html), [Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html), [Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html), [Lambda parameters for Amazon SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html)
- [Subscribing an Amazon SQS queue to an Amazon SNS topic](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html), [Amazon SNS message delivery for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-delivery.html)
- [Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html), [TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html), [Using time to live (TTL) in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/), AWS Price List bulk API: [SQS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json), [KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json)
- Cloudflare: [Queues: How Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/), [Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Queues: Limits](https://developers.cloudflare.com/queues/platform/limits/), [Queues: Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/). Vercel: [Vercel Queues](https://vercel.com/docs/queues)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (read from the `dist` of the installed package: a dedicated provider is registered for each of the nine resource types used, and how it names an SQS queue)

:::
