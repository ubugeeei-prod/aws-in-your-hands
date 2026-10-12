---
title: "25 Events: EventBridge, SNS, Pipes, Archive and Replay"
sourceRevision: 1
---

# 25 Events: EventBridge, SNS, Pipes, Archive and Replay

[Chapter 08](/en/chapters/08-async.md) moved one kind of work, inspecting an image, through one queue to one worker. The sender (S3) knew exactly one receiver.

This chapter is about the case where several parties want to hear of the same thing. A note is created, edited, or deleted, or an attachment fails its inspection. Each time, one process wants to record the latest state of each note, another wants to count notes per user, and a third wants to tell someone about the failed inspection.

The API could call the three in turn. Then every new party means a change to the API, and you have to decide what the API does while one of them is down. Here the thing that happened is sent to one place as an event, and whoever wants it takes it from there. Neither the API nor chapter 08's worker changes by a single line.

What grows instead is the number of parts: one event bus, three rules, three functions, three queues, one topic, one table, and a pipe and an archive on top. The chapter sets out, to the end, what you take on to get what.

Chapter 08 is the prerequisite. The code is in `examples/25-events/`. Nothing here is billed by the hour, but the pipe's polling of the stream is expected to cost something even in a month when nothing happens. The amount and its assumptions are on the [costs page](/en/chapters/25-events/wrap.md).

## The whole picture

<!-- section: 25.architecture -->

```figure
caption: A write to the table shows up in the stream, and the pipe turns it into an event and puts it on the bus
node writers: API and Worker | as in chapters 05 to 08
node table: DynamoDB table "Notes" | stream: NEW_AND_OLD_IMAGES
node pipe: EventBridge Pipe "Changes" | filter: NOTE#, INSPECTION#
node shape: Lambda function "Shape" | enrichment
node bus: event bus "aih-events"
node archive: archive | kept 7 days
edge writers -> table: writes
edge table --> pipe: stream records
edge pipe -> shape: synchronous call
edge pipe -> bus: PutEvents
edge bus --> archive: source = aih.notes
mark pipe
```

```figure
caption: Three rules on the bus deliver the same events to their own consumers
node bus: event bus "aih-events"
node timeline: Lambda function "Timeline"
node cq: SQS queue "CounterEvents"
node counter: Lambda function "Counter"
node topic: SNS topic "Rejections"
node inbox: SQS queue "RejectionInbox"
node proj: DynamoDB table "Projections"
edge bus -> timeline: rule: note changes
edge bus -> cq: rule: created, deleted
edge bus -> topic: rule: rejected, reshaped
edge cq -> counter: up to 10 at a time
edge topic -> inbox: raw message delivery
edge timeline -> proj: conditional PutItem
edge counter -> proj: TransactWriteItems
mark bus
```

The first figure is how an event comes to be. With the stream turned on for the notes table that the book has used since chapter 05, every write to an item puts the item as it was and as it is into the stream. EventBridge Pipes reads the stream, lets through only notes and inspection records, has a function (Shape) turn each into an event, and puts the event on the bus.

The second figure is how an event is handed out. The bus has three rules, and each says in an event pattern which events it wants. The bus checks every arriving event against every rule and hands it to the target of each rule that matches. Whoever puts the event on the bus does not know how many rules there are.

The figure leaves one thing out: an event that could not be delivered is set aside, from every rule, in a single queue named `EventDeadLetters`.

The consumers receive in three different ways on purpose. Timeline is a function a rule invokes directly. Counter sits behind a queue, as in chapter 08. The notice of a failed inspection goes to an SNS topic, and who receives it from there is the topic's business. The [design and build page](/en/chapters/25-events/build.md) compares what each choice does to failure handling.

### Why the writers do not change

The API could send an event to the bus from the same function, right after it writes the note. This chapter does not do that, because it would make two writes.

The write to the table and the send to the bus are separate requests. If the first succeeds and the function stops before the second, there is a note and no event. In the other order, there is an event and no note. Either way, nothing would ever tell you.

The stream is made from the write to the table itself. According to DynamoDB's documentation, a stream record appears exactly once for each change, and the changes to one item appear in the order they happened. A write that succeeded with no record of it does not occur.

Something is given up in exchange. An event is built from what was stored, so it cannot carry what the table does not hold, such as why the change was made. The stream keeps a record for 24 hours, and if the pipe is stopped for longer than that, the changes in between never become events. And an event arrives some time after the write. How long was not measured in this chapter.

### Added to chapter 08's stack

The stack (`AihEvents`) inherits chapter 08's `AsyncStack` and writes only what is added. The three names chapter 08 fixed (the bucket, the schedule, the sign-in domain) are replaced, so it can be deployed alongside `AihAsync`. The two then have separate buckets, tables, and users.

## Queue, topic, or bus

<!-- section: 25.choices -->

With this chapter there are four kinds of part that carry messages. Their places first.

A queue (SQS) hands one kind of work to one kind of worker. A message waits until a receiver takes it, and once taken it goes to no other receiver. That is chapter 08.

A topic (SNS) delivers one message to every subscription. A subscriber can be a queue or a function, and also an email address, a phone number, or an HTTP endpoint. A subscription with a filter policy receives some of the messages; one without receives them all.

An event bus (EventBridge) decides where a message goes by what is in it. Neither the sender nor the receiver decides: the rules on the bus do. Each rule sets its own retry policy, its own place for what could not be delivered, and its own reshaping of the event before it is handed over. The bus can also keep the events it received and send them again later.

Pipes carries from one source to one target. It does not hand anything out. Its job ends when what was in a stream or a queue is on the bus.

| | SNS topic (standard) | EventBridge bus (Classic) |
| --- | --- | --- |
| Who decides where a message goes | The subscriber, per topic | Rules the bus owner writes, per event content |
| Narrowing down | A filter policy per subscription | An event pattern per rule |
| How many receivers | 12,500,000 subscriptions per topic | 5 targets per rule, 300 rules per bus |
| Reaching a person | Email, SMS, mobile push | Not possible. Put SNS in between |
| Keeping and sending again | FIFO topics only | Archive and replay |
| Duplicates | A message occasionally arrives twice | The same rule occasionally runs twice |

The numbers are as read in the official documentation on 2026-10-13. Quotas change, so look at [EventBridge's quotas](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-quota.html) and [SNS's quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html) before you rely on them.

This chapter uses both. Which event goes to which consumer is decided by rules on the bus, and for the notice of a failed inspection alone, an SNS topic stands behind the rule. Those who want that notice come and go, and some of them, such as an email address, are receivers EventBridge cannot deliver to directly.

### Why not the new Custom Event Bus

As of 2026-10-13, EventBridge's documentation describes two kinds of bus. The one that hands events out with rules and targets is "Custom Event Bus - Classic". The new one, where each consumer creates its own subscriber, is the "Custom Event Bus", and the guide says to start new applications with it. The new bus keeps events for 1 to 365 days, delivers in order within an event group, and removes duplicates at publish time within a window of five minutes.

This chapter uses Classic, and the reason is on the tooling side. The new bus's resources are of another type, `AWS::EventsV2`, and cdkd 0.296.28, the version this book pins, has no provider for it. cdkd creates types it has no provider for through Cloud Control API, and the list of types Cloud Control API supports, read the same day, had no `AWS::EventsV2` either. Whether a pipe can target the new bus could not be read from the documentation.

Most of this chapter holds for either bus. According to the migration guide, a rule with one of its targets becomes a subscriber, an event pattern becomes a filter unchanged apart from wildcards, and archive and replay become the bus's retention and a subscriber's starting position. The deduplication window is five minutes, so sending retained events again still delivers the same event to a consumer a second time. This chapter takes it that consumers must still be idempotent there, but nothing was run on the new bus.

### When not to build this

With one receiver, chapter 08's queue is enough. A bus and its rules pay for themselves when a second and a third receiver arrive.

If the receivers live in the same code base and may fail together at the same moment, a function call will do. Making it an event is worth it because the receivers run at another speed, fail at another time, and are fixed by another person.

It does not suit work whose correctness depends on order. A Classic bus does not deliver in order. The consumers in this chapter are written to reach the same result whatever the order, and work that cannot be written that way should read the stream in order with a consumer of its own, or use a FIFO queue.

Cloudflare and Vercel have parts that come close. What they have and where they differ is on the [costs page](/en/chapters/25-events/wrap.md).
