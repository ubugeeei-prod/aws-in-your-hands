---
title: "61 SQS: Design and Build"
---

# 61 SQS: Design and Build

The [first page](/en/chapters/61-sqs.md) separated what a FIFO queue protects from the work left to the worker. This page reads, in code and tests, the shape of a command, the write that takes effect once, the handling of the visibility timeout, how Lambda behaves when it reads the queue, and the details on the sending side. It ends with the model of the queue the tests run against, and how to run everything locally.

## A command, and its names

<!-- section: 61.command -->

What travels through the queue is an edit command for a note. It comes from outside the types, so it is checked against the same schema before it is sent and after it is received.

<<< @/examples/61-sqs/src/command.ts{command}

IDs stop at 40 characters because an SQS deduplication ID stops at 128. The owner, the note, and the command, joined with `/`, fit in 122.

`sendable` follows SQS's rule about which characters a body may contain. SQS fixes a range of Unicode characters for the body and refuses a message with anything else, with `InvalidMessageContents`. Control characters and unpaired surrogates are no trouble, because `JSON.stringify` writes them as escapes. Only U+FFFE and U+FFFF pass through into the body as they are, and SQS refuses them. Refusing them in the schema is easier to handle than being refused after sending, so the check is here.

<<< @/examples/61-sqs/src/command.ts{identity}

There are two names. `groupIdOf` decides which line a command waits in. `commandKeyOf` says which piece of work it is.

Chapter 08 said that an SQS message ID names a delivery, not the work. The same holds for a FIFO queue. A command resent after five minutes has a new message ID, and so does one moved back from the dead-letter queue. Only the name the command carries itself can say that it is the same work. This chapter uses that name in two places: the queue gets it as the deduplication ID, and the worker uses it as the key of the marker for an applied command.

<<< @/examples/61-sqs/src/producer.ts{entry}

A message attribute is a name and a value attached beside the body, up to ten per message. Here the kind of command goes into an attribute called `change`. A person looking at the queue, or a filter, can read the kind without parsing the body.

Two things about attributes are worth remembering. The name, the type, and the value of each count toward the size of the message. And a queue's encryption protects the body only: attributes are not encrypted. Do not put a value in an attribute that people must not see.

## Taking effect once

<!-- section: 61.ledger -->

This chapter calls the place the worker writes to a ledger. A ledger promises one thing: a command with the same name is applied once, however often it is handed over.

<<< @/examples/61-sqs/src/ledger.ts{port}

There are three results. `applied` means the command was applied now. `already_applied` means it had been applied before. `refused` means the command is well formed and has no prospect of being applied. In this chapter that is a note that has reached its limit of lines.

The worker treats neither `already_applied` nor `refused` as a failure. Delivering the message again would not change the result. Returned as a failure, the message would go back to the queue, and in a FIFO queue every later command for that note would wait behind it.

<<< @/examples/61-sqs/src/ledger.ts{change}

The change itself is a function from a state and a command to the next state. The DynamoDB implementation writes the same thing in one transaction.

<<< @/examples/61-sqs/src/dynamodb-ledger.ts{apply}

The transaction holds two writes, the marker and the update of the note. The marker carries the condition that it does not exist yet, and a second delivery of the same command is refused there. It is built like the marker of the counter in [chapter 25](/en/chapters/25-events.md), and the two writes share a transaction for the same reason: the marker alone would lose a command, and the update alone would let it take effect twice.

The note is not read and then written. `list_append` adds to the list where it is. A write that rewrites what it read, as chapter 05's optimistic lock does, makes one of two workers start over when both update the same note at once. Adding only does not have that conflict.

When a transaction is refused, DynamoDB says which write was refused in `CancellationReasons`, in the order the writes were sent. If the first (the marker) was refused, the result is `already_applied`. If the second (the note) was, it is `refused`. Being refused for any other reason, and every other failure, is passed on as an exception. The message returns to the queue and is delivered again.

The marker carries a time 30 days ahead as its TTL attribute. A marker is needed only for as long as the same command can come back. A command can spend up to 4 days in the queue and up to 14 in the dead-letter queue, and a redrive starts the 4 days again: 22 days in all. Thirty is longer than that. Nothing here stops a sender from resending a command after more than 30 days.

This implementation was not run against DynamoDB. What the tests pin is the shape of the request and how a refusal is read.

### Tests that break it

The tests reproduce, one at a time, the ways a command can take effect twice. For comparison there is a ledger without markers, which applies whatever arrives (`src/naive.ts`).

| What is injected | A ledger without markers | This chapter's ledger |
| --- | --- | --- |
| The same command is sent again 4 minutes later | One line. The queue drops the second send | One line |
| The same command is sent again 5 minutes later | Two lines | One line. The second is `already_applied` |
| Worker A stops just before it writes, and worker B handles the message after the visibility timeout | Two lines | One line. A's write is refused, and A's delete has no effect |
| The same race, and A wakes after B has applied the next command too | | The later command's result stands |
| A command is applied but never deleted, is received five times, and is moved back from the dead-letter queue | | One line |

The first row is the case the queue covers alone. The rows below it lie outside what the queue promises. The third row is the situation in the figure on the first page. A hook in the test makes worker A's write wait for a signal, the clock is moved forward by the visibility timeout, and worker B runs to the end in the meantime.

Removing the one line in the ledger that records the marker makes four tests fail, the ones for the second row and below.

## The visibility timeout is a lease

<!-- section: 61.lease -->

The visibility timeout is easier to reason about as the period for which the queue lends a message to one consumer. When the period is over, the queue takes the message back without asking, and lends it to the next consumer that comes to receive. The earlier borrower is told nothing.

So whatever the length of the period, it cannot stop a late borrower from coming to write. The write has to stop it, and the ledger of the previous section does. What the length decides is how unlikely double processing is, and how long a failed message waits.

### Fitting Lambda's timeout

<<< @/examples/61-sqs/src/lease.ts{lambda}

Lambda's documentation asks for two things. If the function's timeout exceeds the queue's visibility timeout, Lambda does not create the event source mapping. And it recommends a visibility timeout of at least six times the function's timeout, plus the batch window if one is used. The margin of six is time for Lambda to retry when the function is throttled.

This chapter sets the function's timeout to 10 seconds and the visibility timeout to 60. The stack's test reads both values from the synthesized template and passes them to this function. Changing either one alone fails the test.

Too short, and a message goes to another worker before the first has finished. Too long does more harm in a FIFO queue than in a standard one. A failed message does not return to the queue until its visibility timeout runs out. In a standard queue other messages go on meanwhile. In a FIFO queue every later message of the same group waits until it returns. The time until a message has failed its fifth receive and moves to the dead-letter queue is five visibility timeouts, which is 5 minutes with this chapter's settings. That sets the longest time one note can stand still.

### Extending it, giving it back

`ChangeMessageVisibility` changes the period of a message that was received. The new period counts from the moment of the call. With 0 the message becomes visible at once, which is how a consumer gives back a message it knows it cannot handle, without waiting for the period to end.

The limit for extensions is 12 hours after the message was first received, and an extension does not start the 12 hours again. Asking for more seconds than are left is an error: SQS does not accept a shorter period instead. The changed period holds for that one receive only. The next time the message is received, the queue's setting applies again.

<<< @/examples/61-sqs/src/lease.ts{heartbeat}

A consumer that cannot tell how long its work will take can start with a short period and keep extending it while it runs. The SQS guide calls this a heartbeat. If the worker dies, the extensions stop too, and the message comes back after a short period. The function above decides how many seconds to ask for next from what is left of the 12 hours. A test with the model of the queue shows a borrower that extends every hour having the message taken back at 12 hours.

This chapter's Lambda worker does not extend anything, because the function's timeout bounds the processing time. Extensions are for long-running consumers that poll the queue themselves, such as chapter 12's container. For work that 12 hours do not cover, the guide recommends Step Functions.

The guide has one note about receiving as well. The visibility timeout should be longer than the time the SDK waits for the answer to `ReceiveMessage`. If it is shorter, the message becomes visible again before the answer arrives. A FIFO queue also takes a `ReceiveRequestAttemptId`, with which a receive whose answer was lost can be repeated with the same result. This chapter does not use it.

## Lambda reads the queue

<!-- section: 61.consumer -->

The basics of the event source mapping are as in chapter 08. This is what changes for a FIFO queue, from Lambda's documentation.

- A batch holds at most 10 messages, and there is no batch window
- One batch can hold messages of several groups. Order within a group is kept
- Two execution environments never process messages of the same group at the same time
- The number running at once is at most the number of groups with messages, or the maximum concurrency, whichever is lower
- When the function returns an error, no further message of the same group is received until the retries of that message are over

The third point is about work that finishes inside the visibility timeout. Past it, as the previous section showed, the same message goes to another execution environment.

<<< @/examples/61-sqs/src/worker.ts{batch}

Chapter 08's worker collected the IDs of failed messages and carried on to the end of the batch. Doing that with a FIFO queue breaks the order. Suppose a note's first message fails and its second succeeds. The second is deleted, the first alone comes back, and it is applied later.

A test sends a command that sets the title to `Draft` and then one that sets it to `Final`, and makes the first write fail once. With a handler that carries on (`createCarryOnHandler` in `src/naive.ts`), the note ends with the title `Draft`. Each command took effect exactly once, so a check for duplicates finds nothing.

Lambda's documentation says that a function using partial batch responses with a FIFO queue should stop at the first failure and return the failed message and every message it has not processed. This chapter's worker does that. Messages that succeeded before the stop are not returned, and so they are deleted.

### The worker sets aside what it cannot read

<<< @/examples/61-sqs/src/worker.ts{record}

A message whose body is not JSON, or does not match the schema, will not be readable however often it arrives. Chapter 08 returned such a message as a failure and let SQS move it to the dead-letter queue once it had been received five times.

Doing the same with a FIFO queue causes two problems. One is that, for the five minutes until it moves, the note's good commands wait behind it. The other is that the messages handed over in the same batch are dragged along. The worker returns everything after a failed message as failed, and each returned message has its receive count go up by one. While the unreadable message arrives five times, the messages behind it are counted as having arrived five times too, and they move to the dead-letter queue with it.

The second problem is derived from two rules in the documentation: the receive count is kept per message, and a message whose count exceeds `maxReceiveCount` is moved. In the test of the queue model, two good messages enter the dead-letter queue together with one unreadable message. This was not confirmed with SQS and Lambda themselves.

So the worker sends an unreadable message to the dead-letter queue itself. Once it is sent, the worker treats the message as handled, Lambda deletes it from the source queue, and the commands behind it go ahead.

<<< @/examples/61-sqs/src/sqs-sender.ts{park}

The deduplication ID is the ID of the original message. The documentation says that SQS, when it moves a message itself, also replaces the deduplication ID with the original message ID. If the worker dies right after sending and the same message is delivered again, the dead-letter queue still holds one copy, as long as that happens within five minutes. If the send to the dead-letter queue fails, the worker returns an ordinary failure and the message stays in the source queue.

What is left to reach the dead-letter queue by `maxReceiveCount` is a failure that waiting might cure, such as a table that does not answer, five times in a row. In that case the messages behind are most likely failing for the same reason, and it is fine for them to move too. A test shows three commands entering the dead-letter queue with their order kept, and being applied in order when moved back.

### Set-aside commands and order

Setting a message aside in the dead-letter queue lets the note's later commands go ahead. That is where the order breaks. The SQS documentation, too, says not to give a FIFO queue a dead-letter queue if the exact order of operations must not be broken.

This chapter has one because a command that adds a line and a command that changes the title each mean something alone. With one missing, the later ones still apply correctly. For commands that build on the result of the one before, such as applying a diff, the decision goes the other way: no dead-letter queue, a group that stays stopped at the unreadable message, and the alarm on the age of the oldest message to call a person.

### Moving messages back from the dead-letter queue

Moving the dead-letter queue's messages back to the source queue is called a redrive. Three things from the documentation matter for a FIFO queue.

A message that is moved back counts as a new message, with a new message ID and a new time of entering the queue. Messages are moved back oldest first, but they go in behind what the queue holds now. If the sender has sent commands for the same note in the meantime, the command that was moved back is applied after them. The original order does not come back.

A command that is moved back may turn out to have been applied already, when it was applied and the delete never arrived. As long as the ledger's marker is there, it does not take effect twice.

In a FIFO queue, the retention period starts again when a message moves to the dead-letter queue. In chapter 08's standard queue it kept counting from the time the message first entered a queue. The dead-letter queue of a FIFO queue holds a message for 14 days from the move.

## Details on the sending side

<!-- section: 61.sending -->

### Batches

`SendMessageBatch` sends up to 10 messages in one request. The price depends on the number of requests, so ten messages in a batch cost about a tenth to send. The total a batch can hold is 1 MiB, the same as the limit for one message.

In a FIFO queue, the messages of one batch enter the queue in the order they are listed. What needs care is that a batch can fail in part. The answer can be HTTP 200 while some of the entries were not accepted. If two commands for one note are in the same batch and only the first is refused, the second enters the queue first.

<<< @/examples/61-sqs/src/producer.ts{plan}

So a batch takes at most one command of a group. A note's second command always goes into a later batch.

<<< @/examples/61-sqs/src/sqs-sender.ts{send}

The sending function sends the batches in turn and, when a command is refused, returns that note's remaining commands unsent. Passing the returned list in again resumes the work. If it contains a command that was in fact accepted, the deduplication ID drops it, as long as that is within five minutes.

On the receiving side Lambda does the batching. A consumer that reads the queue itself receives up to 10 messages with `ReceiveMessage` and deletes them together with `DeleteMessageBatch`.

### Long polling

`ReceiveMessage` can wait in two ways. Short polling looks at some of the servers and answers at once, even with no message. Long polling looks at all servers and waits up to 20 seconds for a message.

An empty answer is billed as a request too, so the waiting time shows directly in the cost. One consumer reading an empty queue for a month makes 131,400 requests with 20-second long polling, and 2,628,000 with a short poll every second.

The waiting time is given with each receive as `WaitTimeSeconds`, or as the queue's default in `ReceiveMessageWaitTimeSeconds`. This chapter's queue has a default of 20 seconds, so a consumer that names no waiting time long-polls as well. Lambda does its own long polling. The [costs page](/en/chapters/61-sqs/wrap.md) says what is known about how often.

### The size limit, and moving the payload to S3

The limit for one message, on the quotas page and in the API reference as read on 2026-10-13, is 1,048,576 bytes (1 MiB). That is the body and all message attributes together. The page that explains large messages still shows the figure 256 KB.

Size affects the price too. The pricing page counts every 64 KB as one request, so sending one message of 1 MiB is 16 requests. The whole batch handed to Lambda cannot exceed 6 MB either, the limit for a synchronous invocation.

To carry more than the limit, the payload goes to S3 and the message says only where it is. AWS provides an Extended Client Library that does this automatically for Java and for Python. The documentation lists none for JavaScript. What it does is small, so here it is written out.

<<< @/examples/61-sqs/src/large-message.ts{pack}

The object comes first and the message second. The other way round would leave a message that points at nothing. The receiver returns a failure when the object is missing or its hash does not match, and so the message stays in the queue. Deleting the objects is left to a lifecycle rule. Make its period longer than the time a message can spend in the queue and the dead-letter queue.

This code is not wired into the worker, since this chapter's commands do not reach 1 KB. The tests cover a body exactly at the limit, counting three-byte characters, an object that has gone, and one that was swapped.

### Delaying

Two settings keep a message invisible for a while after it is sent. A delay queue is a setting for the whole queue, and a message timer is given per message. Both stop at 15 minutes.

A FIFO queue has the queue-wide setting only. Unlike in a standard queue, changing it affects messages already in the queue. For anything to be sent more than 15 minutes ahead, the guide recommends EventBridge Scheduler, the service chapter 08 used to start its housekeeping.

This chapter's stack sets no delay.

## Run it locally

<!-- section: 61.local -->

This chapter has no development server. Instead a script connects the model of the queue to the same worker code that is deployed.

```bash
vp run sqs:demo
```

The following output is from a run on this machine on 2026-10-13.

```text
a ledger that remembers the commands it applied
  the same command sent again at once: deduplicated
  and again five minutes later:        queued
  second worker deleted 1; first worker's delete came too late: 1
  title: Shopping
  lines: milk, eggs, bread
  dead-letter queue: ["not JSON"]

a ledger that trusts the queue to deliver once
  the same command sent again at once: deduplicated
  and again five minutes later:        queued
  second worker deleted 1; first worker's delete came too late: 1
  title: Shopping
  lines: milk, milk, eggs, eggs, bread
  dead-letter queue: ["not JSON"]
```

The same sequence runs once with each of two ledgers. A command that adds `milk` is sent twice in a row, and the queue drops the second. Sent again five minutes later, it is queued. Next, a command that adds `eggs` is handled both by a worker that has outlived its visibility timeout and by one that came after it. Last, one unreadable message goes in before a command that adds `bread`. The ledger that remembers markers ends with three lines, and the one that does not, with five. With either, the unreadable message moves to the dead-letter queue at once and `bread` is not kept waiting.

Neither Docker nor AWS credentials are needed.

### The model of the queue

The tests and the script run against a model of the queue, written in `src/fifo-queue.ts`. It is not SQS. It implements only the rules the worker relies on, as the documentation states them.

- A send needs a message group ID and a deduplication ID
- The same deduplication ID within five minutes of being accepted is accepted and not queued, even after the first message was deleted
- Messages of a group are returned in the order they were accepted
- While even one message of a group is still out, a later receive returns nothing from that group
- One receive can return several messages of one group, and several groups
- A received message is hidden for the visibility timeout and, unless deleted, returns to its place
- Every receive gives a new receipt handle, and an old one deletes nothing
- The period of a received message can be changed, up to 12 hours after the receive
- A message received `maxReceiveCount` times moves to the dead-letter queue at the next receive, with its message ID as its deduplication ID
- A redrive sends the dead-letter queue's messages as new messages, oldest first

Some things are not implemented: long polling, delay, retention, throughput limits, content-based deduplication, deduplication per group (high throughput mode), `ReceiveRequestAttemptId`, and permissions. Whether a resend with the same ID inside the five minutes extends the five minutes could not be read from the documentation, so the model counts from the time the ID was first accepted.

<<< @/examples/61-sqs/src/fifo-queue.ts{queue}

<<< @/examples/61-sqs/src/poller.ts{deliver}

`deliverOnce` copies one round of what the event source mapping does. It receives, invokes the handler, and deletes the messages that were not returned as failed. `late` counts the deletes for which the receipt handle was already out of date.

### Tests

```bash
vp test run examples/61-sqs
```

There are 75 tests: the rules of the queue model, the invariant of the ledger and the worker, the arithmetic of the visibility timeout, the building of batches, large messages, the cost arithmetic, the shape of requests to DynamoDB and SQS, and the stack's assertions.

To see that the tests keep watch, the code was broken in four places, one at a time. Letting the worker carry on after a failure fails 3 tests. A ledger that does not record markers fails 4. A model that returns messages from a group that is still out fails 2. Allowing two commands of one note into the same batch fails 3.
