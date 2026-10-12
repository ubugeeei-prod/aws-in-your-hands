---
title: "61 SQS: FIFO, Visibility Timeout, Batches, and Redrive"
sourceRevision: 1
---

# 61 SQS: FIFO, Visibility Timeout, Batches, and Redrive

[Chapter 08](/en/chapters/08-async.md) used one standard queue. A standard queue does not keep order and can deliver the same message twice, so the worker dealt with both.

SQS has a second kind of queue, the FIFO queue. Its name, and the phrase "exactly-once processing" in its documentation, suggest a queue whose messages are processed in order and once. What the queue takes on is narrower than that. A FIFO queue keeps order within a message group and drops duplicate sends for five minutes, and it does so only while the consumer finishes inside its visibility timeout. Outside those limits, making each message take effect in order and once is the worker's job in this chapter too.

The subject is edit commands for a note. Two kinds, adding a line and changing the title, travel through the queue to a worker. If the order changes, the title goes back to an older one. If a command takes effect twice, the same line appears twice. Both order and duplicates show in the result, so tests can find where the queue protects you and where it stops.

Besides FIFO, the chapter covers the settings chapter 08 left at their defaults: how to size and extend the visibility timeout, long polling, batches, the message size limit, delays, how Lambda reads a queue, dead-letter queues and redrive, queue policies and encryption, and the price.

Chapter 08 is the prerequisite. The code is in `examples/61-sqs/`. Nothing here is billed by the hour. In a month when nothing is sent, two alarms and the polling of the empty queue come to an estimated USD 0.53 at list price, and to 0 if they fit in the monthly free allowances. The assumptions are on the [costs page](/en/chapters/61-sqs/wrap.md).

## The whole picture

<!-- section: 61.overview -->

```figure
caption: Commands enter a FIFO queue, and the event source mapping hands them to the Worker with each note's order kept
node producer: sender | sqs:send, or your own app
node q: SQS queue "Commands" | FIFO, visibility timeout 60 s, kept 4 days
node esm: Lambda event source mapping | up to 10 per batch, at most 2 batches at once
node worker: Lambda function "Worker" | timeout 10 s
node table: DynamoDB table "Edits" | notes, and markers of applied commands
node dlq: SQS queue "DeadLetters" | FIFO, kept 14 days
edge producer -> q: SendMessageBatch
edge q -> esm
edge esm -> worker
edge worker -> table: TransactWriteItems
edge q --> dlq: received 5 times, never deleted
edge worker --> dlq: unreadable messages
mark q
```

The sender turns each command into one message and sends it to the FIFO queue. A message carries a message group ID that says which note it is for, and a deduplication ID that says which command it is. Lambda's event source mapping reads the queue and invokes the worker. The worker applies the command to the note in the table and, in the same transaction, writes a marker that says the command was applied.

Two arrows lead to the dead-letter queue. One is chapter 08's: SQS moves a message that was received five times and never deleted. The other is new in this chapter: the worker moves a message it cannot read. The [design and build page](/en/chapters/61-sqs/build.md) explains why.

Not drawn are two alarms. One rings when the dead-letter queue holds a message, the other when the oldest message in the queue has been waiting two minutes or more.

### Why the stack stands alone

The stack (`AihSqs`) does not extend the stacks of chapters 05 to 08. It has two queues, one function, one table, and two alarms, and neither CloudFront nor Cognito. That leaves only the SQS settings to read.

In exchange, the worker writes to this chapter's own table, `Edits`, and not to chapter 05's notes table. Writing to chapter 05's table would mean deciding how the version that its optimistic lock uses and this chapter's commands live together. This chapter does not build that.

## Standard queues and FIFO queues

<!-- section: 61.fifo -->

The differences between the two kinds, from the official documentation and the Price List as read on 2026-10-13.

| | Standard queue | FIFO queue |
| --- | --- | --- |
| Order | Best effort, in the order sent. No guarantee | Within a message group, the order sent |
| Duplicates | At least once. A message can arrive twice | Duplicate sends are dropped for five minutes |
| Throughput | Nearly unlimited | 300 calls a second per API action. 3,000 messages a second with batches |
| Delay | Per queue and per message | Per queue only |
| Lambda's batch | Up to 10,000. A batch window is available | Up to 10. No batch window |
| Dead-letter queue | A standard queue | A FIFO queue |
| Price of a million requests (Tokyo) | USD 0.40 | USD 0.50 |

A FIFO queue's name ends in `.fifo`. A standard queue cannot be turned into a FIFO queue later, so the choice is made when the queue is created.

A setting called high throughput mode raises the throughput limit. The message quotas page gives 9,000 calls a second for the Tokyo Region. Another page, the comparison of queue types, says "up to 30,000 transactions per second with relaxed ordering within message groups", and the two pages do not agree. This chapter's stack does not use high throughput mode and confirmed neither number. Quotas change, so read the [message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html) before you rely on one.

### Message groups

A message sent to a FIFO queue must carry a message group ID. Without one, the send fails.

Order is kept only among messages with the same message group ID. Between groups, nothing says which is processed first. And while even one message of a group is still out, that is, received and neither deleted nor past its visibility timeout, the next message of that group is handed to no consumer. Other groups go on in the meantime.

A message group is the unit of order and, at the same time, the unit of parallel work. This chapter makes each note a group (`owner/noteId`). Commands for one note are processed one at a time in order, and commands for different notes proceed side by side. There is no limit on the number of groups. Give every message the same ID and the whole queue becomes one line, processed one message at a time.

A consumer cannot ask for the messages of a particular group.

### Deduplication

A FIFO queue remembers the deduplication IDs of the messages it was sent. If a message with the same ID arrives within five minutes of the first being accepted, SQS accepts the send as a success and queues nothing. That holds for the five minutes even after the first message has been received and deleted.

The ID is chosen in one of two ways. The sender sets `MessageDeduplicationId`, or the queue has content-based deduplication turned on and SQS uses the SHA-256 of the body. The second looks at the body only, not at the message attributes.

This chapter uses the first, with the command's own name as the ID. Content-based deduplication is off, so a send without an ID fails. Deriving the ID from the body would merge two different commands that happen to have the same content, and would treat a retry whose body changed slightly as a new message. Both are decisions the sender should make on purpose.

### What "exactly-once processing" covers

The documentation calls this feature of FIFO queues "exactly-once processing" and explains it in two statements. No duplicate enters the queue. And a message is delivered once and stays unavailable until a consumer processes and deletes it.

The API reference itself names two gaps in that promise.

The first is in the description of `ReceiveMessage`. If the visibility timeout runs out while the consumer is still working, the message becomes visible again, and another worker can receive it and process it a second time.

```figure
caption: Worker A has outlived its visibility timeout, and the same message goes to worker B. A FIFO queue does this too
type: sequence
actor a: Worker A
actor q: queue "Commands"
actor b: Worker B
step q -> a: t0 M1 received: hidden 60 s
note a: M1 takes long
note q: t0+60 M1 is visible again
step q -> b: M1 again (receive count 2)
step b -> q: applies M1, deletes it
step q -> b: M2 of the same group
note a: applies M1, late
step a -x q: old receipt handle: no delete
```

The second is in the description of `SendMessage`. If the answer to a send is lost and the sender tries again with the same ID after the five minutes, SQS cannot tell that it is a duplicate. The queue then holds two messages for one command.

In both cases the queue does what it promised. What this chapter wants to hold is this, in one sentence.

**For each note, commands take effect in the order the queue accepted them, and each command takes effect once, however many times it is delivered.**

Of that, the queue takes care of the order within a group and of a resend within five minutes. Double processing past the visibility timeout, a resend after five minutes, and the order when a batch fails halfway are the worker's. The [design and build page](/en/chapters/61-sqs/build.md) has a test that breaks each, and the code that holds.

## When not to build this

<!-- section: 61.choices -->

If order does not affect the result, chapter 08's standard queue is enough. It is cheaper, has no throughput limit, and some senders, such as the S3 event notifications of chapter 08, cannot send to a FIFO queue.

Even where order seems to matter, making the worker idempotent is often all it takes. Chapter 08's worker wrote on a condition over the event's `sequencer`, so that an older event arriving late could not overwrite a newer record. Work for which "keep the newer one" is the right answer does not need the queue to keep order. A FIFO queue is needed when, as with a command that adds a line, dropping the older one is not an answer and every one must be applied in turn.

Within one group a FIFO queue moves one message at a time. Work whose messages pile into a few groups does not get faster with more consumers.

If several consumers want to read the same message, or to read old messages again later, a log fits better than a queue: Kinesis Data Streams in [chapter 54](/en/chapters/54-kinesis.md). To hand one event to several parties, see the event bus and the topic in [chapter 25](/en/chapters/25-events.md). To keep track of work with several steps, see Step Functions in [chapter 47](/en/chapters/47-step-functions.md).

If several users share one queue and all you want is that one user's flood of messages does not keep the others waiting, there is a feature called fair queues. Send to a standard queue with a message group ID, and SQS hands out the other users' messages first. It keeps no order. This chapter does not use it.

For Cloudflare and Vercel, this is what their official documentation said on 2026-10-13. Cloudflare Queues delivers at least once and states that it does not guarantee delivery in the order of publishing. No kind of queue that keeps order was found in the pages read. A message is at most 128 KB, and a delay can be up to 24 hours. An SQS delay stops at 15 minutes, so Queues gives more room there. Vercel Queues is in beta and delivers at least once. A publish can carry an idempotency key, which drops repeated publishes with the same key for the message's retention period. Its overview page states no ordering guarantee. For work that needs no order, either queue will do, and there is no reason here to move.
