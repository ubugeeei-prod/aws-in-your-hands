---
title: "61 SQS: Deploy"
---

# 61 SQS: Deploy

This page reads the stack that puts the worker from the [design and build page](/en/chapters/61-sqs/build.md) on AWS, sorts out who may use the queues, and then lists the steps to deploy and check. Nothing was run against AWS while this chapter was written. The steps are prepared, and their results are not confirmed.

## Reading the stack

<!-- section: 61.stack -->

The stack uses nine resource types. cdkd 0.296.28, the version this book pins, has a dedicated provider for each.

### Two queues

<<< @/examples/61-sqs/infra/lib/sqs-stack.ts{queues}

The dead-letter queue of a FIFO queue has to be a FIFO queue, so both have `fifo: true`.

The names are written out because of the tool. A FIFO queue's name must end in `.fifo`. cdkd 0.296.28, the version this book pins, gives a queue without a name one derived from its logical ID, and does not add `.fifo` when it does. This was read in the source of the installed package. A FIFO queue deployed without a name should be refused on creation. With fixed names, one account can hold this stack only once per Region.

`contentBasedDeduplication` is written out as `false`, which is also the default. It records the agreement that the sender always gives a deduplication ID.

The numbers follow chapter 08's reasoning. The visibility timeout is six times the worker's timeout, `maxReceiveCount` is 5, the lower bound Lambda's documentation recommends, and retention is 4 days for the source queue and 14 for the dead-letter queue. `receiveMessageWaitTime` makes a receive that names no waiting time a long poll.

Encryption uses the key SQS manages (SSE-SQS). `enforceSSL` adds a statement to the queue policy that refuses requests made without TLS.

### The table

<<< @/examples/61-sqs/infra/lib/sqs-stack.ts{table}

The table holds two kinds of item, notes and markers. Only markers carry `expiresAt`, the attribute named in `timeToLiveAttribute`, so markers are all that DynamoDB deletes. According to the DynamoDB documentation, an expired item is typically deleted within a few days. It does not disappear at the moment it expires, and a marker that stays longer does no harm.

`maxReadRequestUnits` and `maxWriteRequestUnits` are the limits on reads and writes a second that the book has used since [chapter 05](/en/chapters/05-dynamodb/deploy.md). Applying one command is 4 write units, so the limit is 25 commands a second. DynamoDB refuses what goes beyond, and the message returns to the queue.

### The worker and its role

<<< @/examples/61-sqs/infra/lib/sqs-stack.ts{worker}

The role allows four things: writing to its own log group, receiving and deleting from the command queue, sending to the dead-letter queue, and `PutItem` and `UpdateItem` on the table.

A transaction needs the permissions of the writes inside it. No action called `TransactWriteItems` has to be allowed. For the dead-letter queue only sending is allowed, since the worker never reads it.

### The event source mapping

<<< @/examples/61-sqs/infra/lib/sqs-stack.ts{mapping}

`maxConcurrency` is the most workers that run at once for this queue. It can be set from 2 to 1,000, and this chapter uses the lower bound of 2. A FIFO queue has a second ceiling, the number of groups that hold messages. If the commands waiting are all for one note, one worker runs.

Lambda also has a setting called provisioned mode, which reserves pollers for one event source mapping. It costs extra and cannot be combined with maximum concurrency. This chapter does not use it.

### Alarms

<<< @/examples/61-sqs/infra/lib/sqs-stack.ts{alarms}

The first rings when the dead-letter queue holds even one message. It is the metric the SQS guide recommends. Messages the worker set aside itself and messages SQS moved both show here.

The second is the age of the oldest message in the command queue. This metric means slightly different things for the two kinds of queue. In a standard queue, a message that was received three times or more without being deleted is moved to the back of the line and drops out of the metric. A FIFO queue does not change the order, so with a message that keeps failing the age keeps growing. The threshold is 2 minutes, and the alarm rings when two one-minute values in a row are over it. A message that failed once comes back after the 60 seconds of its visibility timeout and is handled, so it does not ring the alarm. A message that keeps failing moves to the dead-letter queue after 5 minutes, so if one note has stopped, this alarm rings first. A worker that is not running, or one that cannot keep up, shows in this metric too.

By default the alarms notify nobody. Given the ARN of the topic that [chapter 19](/en/chapters/19-observability.md)'s stack prints, both notify that topic.

```bash
vp run sqs:infra:deploy -c alarmTopicArn=<chapter 19's AlarmTopicArn>
```

## Who may use the queues

<!-- section: 61.access -->

Permission to use an SQS queue is decided in two places: the IAM policy of whoever uses it, and the queue policy attached to the queue. According to the IAM documentation, within one account what the two policies allow is added together, and an explicit deny in either one wins. This chapter's worker receives with nothing but its own role's policy.

The default queue policy holds only the statement that refuses requests without TLS. It has no statement that allows anything. `sqs:send` works with your credentials because your IAM policy allows it.

### Sending from another account

<<< @/examples/61-sqs/infra/lib/sqs-stack.ts{queue-policy}

Letting another account send takes an allowing statement in the queue policy. This chapter's stack gives an account `sqs:SendMessage` only when `senderAccountId` is passed. It allows neither receiving nor deleting, and adds nothing to the dead-letter queue.

```bash
vp run sqs:infra:deploy -c senderAccountId=<the sending account's ID>
```

The queue policy goes as far as the other account. Which role inside that account may send is decided by IAM policies on that side. Both have to allow it before a send goes through. With only one account at hand, this path was checked as far as assertions on the template.

### Receiving from SNS

Passing messages from an SNS topic to a queue needs the queue policy as well. A statement gives the topic `sqs:SendMessage`, and then the queue is subscribed to the topic. The stack of [chapter 25](/en/chapters/25-events.md) builds this with a standard topic and a standard queue.

A FIFO topic can deliver to FIFO queues and to standard queues. Order and deduplication are kept when a FIFO topic delivers to a FIFO queue. Delivered to a standard queue, order is best effort and delivery is at least once. This chapter's stack has no topic.

### Encryption and KMS

A queue can be encrypted in two ways: SSE-SQS with a key SQS manages, and SSE-KMS with a KMS key. Either one encrypts the body. The queue's name, a message's ID and attributes, and the metrics are not encrypted.

SSE-SQS asks no extra permission of whoever uses the queue. With SSE-KMS a sender needs `kms:GenerateDataKey` and `kms:Decrypt`, and a receiver needs `kms:Decrypt`. For a Lambda worker that means adding `kms:Decrypt` to the execution role. For an AWS service such as S3 or SNS that is to send, the guide says to create a key you manage yourself and allow the service in that key's policy. The AWS managed key for SQS (`alias/aws/sqs`) is not enough.

A KMS key brings the key's monthly price and a charge for each call SQS makes to KMS. The estimate is on the [costs page](/en/chapters/61-sqs/wrap.md). This chapter chose SSE-SQS because the body of a command does not have to be hidden from other people in the account. SSE-KMS is for a requirement to restrict who can use the key separately from who can use the queue.

### Which queues may use a queue as their dead-letter queue

With nothing configured, any queue in the same account and Region can name a queue as its dead-letter queue. A redrive allow policy restricts which source queues can. It names up to 10 source queues, or refuses all. This chapter's stack does not set one.

## Deploy and check

<!-- section: 61.deploy -->

From here on, AWS is changed. Chapter 02's bootstrap has to be done.

```bash
vp run sqs:infra:diff
vp run sqs:infra:deploy
```

When the deployment is finished, send commands.

```bash
vp run sqs:send
vp run sqs:status
```

`sqs:send` makes four sends for a note called `smoke/demo`: a command that sets the title to `Shopping`, one that adds `milk`, the same `milk` command once more, and last one that adds `eggs`. The third has the same deduplication ID as the second, so it should not be queued.

`sqs:status` prints the approximate counts of both queues, what is in the dead-letter queue, and the state of the note. The expected result is the title `Shopping`, two lines, `milk` and `eggs`, and three commands applied. Two lines of `milk` would mean that deduplication did not work as expected.

The handling of an unreadable message can be checked too.

```bash
vp run sqs:send --poison
vp run sqs:status
```

With `--poison`, one message whose body is not a command is sent between `milk` and `eggs`. The expected result is that the note's lines grow without waiting, that the dead-letter queue holds one message, and that this message carries the attribute that says the worker set it aside. Within a few minutes the dead-letter queue's alarm should ring as well. The worker's log is in the log group named by the stack output `WorkerLogGroupName`.

To move the dead-letter queue's messages back to the source queue, add `--redrive`.

```bash
vp run sqs:status --redrive
```

The task names the command queue as the destination. Without a destination, SQS moves each message back to the queue it came from. A message the worker sent itself should have no record of a queue it came from, hence the named destination. This behaviour was not confirmed. An unreadable message, moved back, is set aside by the worker again. Moving back makes sense after the worker has been fixed, or for messages that were moved because of a failure that waiting cures.

Last, check for drift.

```bash
vp run sqs:infra:drift
```
