---
title: "08 Queue: SQS, DLQs, Idempotency, and Scheduler"
sourceRevision: 1
---

# 08 Queue: SQS, DLQs, Idempotency, and Scheduler

Notes can carry images now. But [chapter 07](/en/chapters/07-uploads.md) left three pieces of homework. Nobody looks inside an uploaded file. Cleaning up orphaned objects is still a task you run by hand. And if the same form is sent again after an upload is finished, the attached image disappears a day later.

This chapter adds two things that run outside any user's request, and they take care of all three. One is a worker that runs on every upload and checks what the image really is. The other is housekeeping that runs once an hour.

The centre of the chapter is not how to use the tools. It is what comes after. A message that went through a queue can arrive twice. Messages can arrive out of order. The worker can stop halfway. Building things so that there is still exactly one result: most of this chapter is about that.

You need chapter 07. The code is in `examples/08-async/`. The upload API and the screen are imported from chapter 07 as they are, so what gets written here is only what is added.

## The big picture

<!-- section: 08.architecture -->

```figure
caption: S3 events go into a queue, and the event source mapping hands them to the Worker in batches.
node browser: Browser
node s3: S3 bucket "Uploads"
node notif: event notification | ObjectCreated:*, ObjectRemoved:Delete, LifecycleExpiration:Delete
node q: SQS queue "UploadEvents" | standard, visibility timeout 180 s, kept 4 days
node esm: Lambda event source mapping | batches of up to 10, at most 2 at once
node dlq: SQS queue "DeadLetters" | kept 14 days
node worker: Lambda function "Worker" | timeout 30 s
edge browser -> s3: POST form, DELETE .../attachments/{attachmentId} (chapter 07)
edge s3 -> notif: keys under u/
edge notif -> q: at least once, in no guaranteed order, usually within seconds
edge q -> esm
edge q --> dlq: received 5 times, never deleted
edge esm -> worker
mark q
```

```figure
caption: The four steps the Worker takes against S3 and the table for one event.
type: sequence
actor worker: Worker | Lambda function
actor s3: S3 bucket "Uploads"
actor table: DynamoDB table | the notes table
step worker -> s3: 1. GetObject, If-Match <event's eTag>
step worker -> worker: 2. first bytes: type, width, height
step worker -> table: 3. PutItem INSPECTION#..., only if newer
step worker -> s3: 4. DeleteObjectTagging (if ATTACHMENT#...)
```

```figure
caption: Every hour the Scheduler invokes Housekeeping, which compares the bucket with the table, deletes objects that nothing points at or that failed the inspection, and takes the pending tag off attached images.
node sched: EventBridge Scheduler | "aih-async-housekeeping": rate(1 hour)
node hk: Lambda function "Housekeeping" | timeout 15 min
node s3: S3 bucket
node table: DynamoDB table
edge sched -> hk: assumes "ScheduleRole", invokes asynchronously
edge hk -> s3: list, delete, untag
edge hk -> table: read
```

What is new: two queues, two functions, and one schedule. The bucket and the table are chapter 07's.

The top half of the picture is driven by events. Each time an image is put or deleted, S3 puts a message on the queue and Lambda hands it to the worker. The bottom half is driven by the clock. Whether or not an event came, it compares the bucket with the table once an hour. Why have both comes up later.

### Why not do it inside the finishing request?

Reading and checking the image inside chapter 07's "finish" (`PUT /notes/{id}/attachments/{attachmentId}`) would be the obvious way. We are not doing that.

A user is waiting on the finishing request. Reading the image from S3 there means no response until up to 5 MB has been read. If it fails halfway, you have to tell the user to try again. And an upload that is never finished is never checked by anyone.

Moved outside the request, the user does not wait. If it fails, it can be retried without the user knowing. In exchange you take on new problems: "there is no telling when it finishes" and "the same work may run twice". The rest of this chapter is how to take them on.

### An inspection, not a thumbnail

The outline of this chapter planned to make thumbnails here. That changed, and here is why.

Shrinking an image takes a library that decodes and encodes images. The commonly used ones contain native code that differs by operating system and CPU. The Lambda functions in this book run on arm64, and their code is bundled into one file by esbuild at synth time. Native code does not bundle as it is. You would build inside Docker or prepare a separate Lambda layer, and a lot of talk far from this chapter's subject would come with it.

So the worker's job was made lighter. It reads the start of the file, checks whether it really is an image and how many pixels wide and high it is, and records that. It decodes nothing. That is exactly the homework chapter 07 left when it said "S3 does not look inside".

Queues, retries, and idempotency are the same whether the worker makes thumbnails or inspects.

### Added to chapter 07's stack

The stack (`AihAsync`) extends chapter 07's `UploadsStack` and writes only what is added. It is a different stack from chapter 07's (`AihUploads`), so if you deploy both, the buckets, tables, and users are separate.

## Looking inside the image

<!-- section: 08.inspect -->

First, the substance of the worker's job. AWS does not appear here. It is a function that takes bytes and returns a verdict.

<<< @/examples/08-async/src/inspect.ts{sniff}

An image file is made so that its type can be told from its first few bytes. A PNG starts with eight fixed bytes. A GIF starts with `GIF87a` or `GIF89a`, a JPEG with `FF D8`, a WebP with `RIFF` and `WEBP`. The width and height are written near the front too. They can be read without decoding the whole thing.

Only JPEG takes a little more work. Several blocks, such as camera data (EXIF), can come before the place where the size is written (the frame header), so the code skips block after block until it finds it.

<<< @/examples/08-async/src/inspect.ts{judge}

The verdict is "rejected" for one of three reasons.

- It is none of the four image formats (HTML that calls itself `image/png`, for example)
- It is an image, but not of the type it claims
- It is an image, but it has too many pixels

The last one is easy to miss. A 5 MB file can still declare itself 60,000 pixels wide and 60,000 high. Whatever decodes this image later (a browser, a thumbnailer you add some day) will try to allocate memory for the declared size. The limit here is 40 million pixels.

The tests do not feed it bytes typed in by hand. They use 3×2 pixel files written by real encoders (macOS `sips`, and `cwebp`). The JPEG file has EXIF before its frame header.

The result becomes a record like this.

<<< @/examples/08-async/src/inspection.ts{record}

`sequencer` and `eTag` say which event, and which bytes, were looked at. They are the main characters of the second half.

## Nobody said "delivered exactly once"

<!-- section: 08.delivery -->

Between an image landing in the bucket and the worker running, a message passes through three services. Here is what the documentation of each promises.

- **S3 event notifications** are designed to be delivered at least once. They are not guaranteed to arrive in the order the events happened. On rare occasions the same event arrives twice. They usually arrive within seconds, and can take a minute or longer
- **SQS standard queues** deliver at least once. More than one copy of a message may be delivered, and messages may arrive out of order
- **Lambda event source mappings** process each event at least once. Duplicate processing can occur

All three say "at least once". "Exactly once" is written nowhere. The SQS documentation says plainly to make applications idempotent (not harmed by processing the same message twice). The Lambda documentation "strongly recommends" the same.

SQS does have another kind of queue, the FIFO queue, which has a mechanism for removing duplicates. But S3 event notifications cannot be sent to a FIFO queue. And even if the queue removes duplicates, a worker that stops halfway is handed the same message again.

### Received is not removed

Receiving a message from SQS does not take it off the queue. It only hides it.

```figure
caption: A received message is only hidden, and if it is not deleted it becomes visible again and goes to another worker.
type: sequence
actor a: worker A
actor q: queue "UploadEvents"
actor b: worker B
note q: t0 message M is visible
step q -> a: t1 M is received: hidden for 180 s
note a: starts on M
note a: t2 still running, or gone
note q: t1+180 M is visible again
step q -> b: t3 received again (receive count 2)
note b: starts on M
note q: ...
note q: received 5 times and never deleted:
note q: next receive moves M to "DeadLetters"
```

The time it stays hidden is the visibility timeout. If "done" (a delete) does not arrive within it, the message becomes visible again and is handed to whoever comes next. A worker that dies does not lose the message.

Turn that around: if worker A is still running at t3, two workers are handling the same message at once. The queue is only doing what it promised. The SQS documentation does not even guarantee, for standard queues, that a hidden message is handed to nobody else.

The visibility timeout in this chapter is 180 seconds, and the worker's timeout is 30. The Lambda documentation says to set the queue's visibility timeout to at least six times the function's timeout, and that is what this does.

### Reading a message

The body of a message from the queue is JSON written by S3. It comes from outside the types, so it goes through a schema.

<<< @/examples/08-async/src/events.ts{schema}

<<< @/examples/08-async/src/events.ts{parse}

Three things need care. All three are in the documentation, and all three are easy to forget.

**A test event arrives.** When a notification is configured, S3 sends one message called `s3:TestEvent`. Its shape differs from a normal event: it has no `Records`. Fail it as "a message that cannot be read" and there is one message in the dead-letter queue right after you deploy.

**The key is encoded.** The object key in an event is URL encoded. A space is `+`. The keys in this chapter are only letters, digits, hyphens, and `/`, so no harm would come of it, but the code decodes before using the key.

**There may be no sequencer.** The sequencer is the value that tells the order of events (the next section uses it). The documentation says it is "only used with PUT and DELETE requests". If a create event comes without one, the worker fails that message. An event whose order is unknown is not handled on a guess.

To be honest, this has not been checked against the real thing. Uploads in this chapter are form POSTs. Whether the event for an object created by POST carries a sequencer could not be read from the documentation. The steps to check are in the notes at the end.

### When one of ten fails

Lambda reads up to ten messages from the queue and calls the worker once. With nothing configured, if the worker throws, all ten go back to the queue. The nine that succeeded are processed again too.

A partial batch response avoids that. With `ReportBatchItemFailures` on the event source mapping, the worker can answer "only the messages with these IDs failed".

<<< @/examples/08-async/src/worker.ts{batch}

Each message is wrapped in a `try`, and only the IDs of the ones that failed are collected and returned. Lambda deletes from the queue the messages that are not named there.

The answer has rules. An empty list means everything succeeded. A function that throws means everything failed. And if a returned ID is not in the batch, or is an empty string, everything is treated as failed as well. "I thought I was reporting failures, but the shape was wrong and everything was being retried" does happen. The tests pin the shape the worker returns.

### A message that never succeeds

A message whose body is not even JSON cannot be handled however many times it is delivered. Left alone, it comes back at every visibility timeout and keeps invoking the worker.

So the queue gets a rule (a redrive policy): a message received five times and never deleted is set aside in another queue. That other queue is the dead-letter queue (DLQ). Five is the minimum the Lambda documentation recommends.

The worker does not quietly throw away a message it cannot read. It reports it as failed on purpose and lets it travel to the DLQ. Thrown away, nobody would notice that something is wrong. A DLQ is a place for a person to look.

The DLQ keeps messages for 14 days, and the source queue for 4. In a standard queue, a message's expiry is counted from when it first entered a queue. Moving to the DLQ does not restart the count. If the DLQ kept messages only as long as the source queue, a message that moved there would vanish before anyone looked.

## Twice delivered, one result

<!-- section: 08.idempotency -->

This is the main subject. First, what is protected, in one sentence.

**For one object key there is at most one inspection record, and it comes from the newest create event the worker has handled. The same event arriving again, an older event arriving later, and two workers holding the same event at once all leave that unchanged.**

"We use SQS, so it is processed once" cannot be said. The last section showed why. Leaving only one run's worth of result is the worker's job.

### What tells "the same work" apart?

To recognize a second delivery, you need a value that lets you say "I have seen this work before". That is the idempotency key.

The first thing that comes to mind is the SQS message ID. It will not do. A message ID names a delivery, not a piece of work.

- If S3 sends the same event twice, they enter SQS as separate messages. Two IDs
- A message moved from the DLQ back to the source queue is treated as a new message and gets a new ID

In both cases the work inside is the same. The key has to be taken from the work itself.

The key in this chapter is the pair of object key and sequencer. The sequencer is a hexadecimal string S3 puts on create and delete events; between two events for the same key, the greater one happened later. According to an AWS blog post, notifications that arrive as duplicates carry the same sequencer.

<<< @/examples/08-async/src/sequencer.ts{sequencer}

Sequencers are not always the same length. The documentation says to pad the shorter one with zeros on the left before comparing. This function brings every value to one length, in upper case. Once they are aligned, a plain string comparison is the order comparison. That is the only comparison a DynamoDB condition expression can do.

### Reading "the bytes of this event"

Between the worker receiving an event and reading the object, the object may have been replaced. Other bytes are under the same key. Read those and record them as "the result of this event", and the record no longer matches the content.

<<< @/examples/08-async/src/object-reader.ts{port}

<<< @/examples/08-async/src/s3-object-reader.ts{read}

An event carries the ETag of the object that was put. With that ETag in `If-Match` on `GetObject`, S3 returns the content only if the object there now is the same one. Otherwise it answers 412. The worker reads "those bytes, the ones this event is talking about", not "whatever is under this key now".

On a 412 the worker does nothing. The replacement has a create event of its own, and that one will do the work. The same goes for a 404 (no longer there).

`Range` is the limit on how much is read. Never more than the upload limit (5 MB). Even if a large object were put under this key without going through the form, it would not use up the function's memory.

### The steps, and their order

<<< @/examples/08-async/src/worker.ts{handle-event}

Handling one create event takes four steps. They are in an order that is safe to stop at anywhere.

```text
one create event (key K, sequencer S, ETag E)         if the worker stops right after this step
  1. GetObject K, If-Match E                           nothing has changed
  2. judge the bytes (no request to anything)          nothing has changed
  3. PutItem INSPECTION#K, only if absent or older     the record is written; a retry finds it and writes nothing
  4. DeleteObjectTagging K, if ATTACHMENT#K exists     everything is done
  (Lambda deletes the message)                         the message comes back; steps 1 to 4 run again and change nothing

never, in any order of deliveries:
  two records for K, or a record from an older event replacing one from a newer event
```

Steps 1 and 2 only read. Run them any number of times and nothing changes. The first write is step 3, and it carries a condition.

<<< @/examples/08-async/src/dynamodb-inspection-repository.ts{put-if-newer}

"Write only if there is no record for this key yet, or the one there has a smaller sequencer." As with the optimistic locking of [chapter 05](/en/chapters/05-dynamodb.md), DynamoDB runs the check and the write as one step. Two workers holding the same event at once cannot both pass the check. An older event that arrives later cannot overwrite a newer record.

When the condition refuses the write, the worker does not return a failure. "Already done" is a success. Returning a failure here would send the message back to the queue, to be refused five times and land in the DLQ, with nothing broken.

The record lives in the same table as chapter 07's, in the same owner's partition.

<<< @/examples/08-async/src/dynamodb-inspection-repository.ts{keys}

### "There is a record" is no reason to skip

Step 4 is there to close chapter 07's gap.

A reminder. A presigned form can be used any number of times until it expires (5 minutes). Send the same form again after finishing, and S3 replaces the object and puts the `upload-state=pending` tag back on. There is an attachment record, yet the lifecycle rule deletes the object a day later.

But a replacement is a "create". S3 sends an event. After recording the inspection, the worker looks for an attachment record under that key. If there is one, it takes the tag off. Seconds later, things are as they were.

Now, the position of step 4 hides a trap. Suppose the worker stops right after 3 and before 4. The message comes back. The second worker learns at step 3 that "there is a record already".

If it returns there, the tag stays on forever. The first run never reached 4, and the second skipped it.

So the worker goes on to 4 whichever way 3 turned out. Step 4 is an operation with the same result however often it runs (taking a tag off), so repeating it does no harm. "There is a mark saying processed" and "all of the processing is finished" are different things. If anything follows the mark, the mark must not be a reason to skip what follows.

There are other ways. Write the mark after everything else is done. Or put the mark and the remaining writes into one transaction. The latter works when every write goes to the same DynamoDB table. Step 4 here is an operation on S3, so it does not apply.

### Fix the order, then try to break it

Each test fixes one order of arriving messages and one place where the worker stops, and then looks at the record. The messages are handed straight to the worker function, so no queue, no clock, and no random numbers are involved.

| What is injected | Result |
| --- | --- |
| The same message, handed over twice | The second run writes nothing. The record is identical down to its timestamp |
| The same event as two messages with different IDs | One record |
| While worker A is stopped just before writing, the same message goes to worker B | B writes. A resumes, writes nothing, and reports no failure |
| After a replacement: the newer event, then the older one | The older one gets a 412 and does nothing. The record is the newer one |
| After a replacement with identical bytes: the newer event, then the older one | The older one can read, and the condition refuses its write |
| The delete event before the create event | No record is left |
| After a delete and a re-create: the re-create event, then the delete event | The late delete does not erase the new record |
| The record write is made to fail | No record. A redelivery makes one |
| After the record is written, removing the tag is made to fail | Record present, tag still on. A redelivery takes the tag off |

The third row is the double execution that follows an expired visibility timeout. A test fixture makes worker A's write "wait until told", and B runs to the end in the meantime.

Delete events are handled too, so that records do not pile up. When the object is gone, the inspection record goes too. The sequencer matters here as well. Look at the seventh row. Carrying out a late delete event naively would erase the record of an object that was put after it. The condition "delete only a record older than this delete" prevents that.

The code was also broken on purpose in two places (running step 4 only when the write succeeded, and letting an equal sequencer overwrite), and four of the tests in the table above failed.

### What is still open

Here is what has not been closed.

There are two ways an inspection record can be left without its object. One: worker A is just before step 3 of a create event when worker B finishes the delete event for the same key. When B looks there is no record yet, so it deletes nothing. Then A writes. The other is a delete by the lifecycle rule. Whether that notification (`LifecycleExpiration:Delete`) carries a sequencer has not been checked. If it does not, the worker does nothing. Between erasing a record on a delete whose order is unknown and leaving a stale record, it chooses the stale record.

Neither is visible to users. Nobody reads an inspection record that has no attachment record. The only cost is a small row left in the table. To close it, a delete would write a "gone" mark (a tombstone) carrying the sequencer, under the same condition, instead of deleting the record, and DynamoDB's TTL would clear it away. This chapter does not implement that.

And then there is the problem chapter 05 recorded: a retried create makes two notes. It has the same shape. If the caller sends a value that says "this is the same request" (a header such as `Idempotency-Key`) and the server writes conditionally with that as the key, it is fixed. The thinking is the same as in this section, but this chapter does not fix it.

## Housekeeping by the clock

<!-- section: 08.housekeeping -->

A worker driven by events is fast. But it does not run if no event comes. A notification can be a minute late, and a message can sit in the DLQ without anyone noticing.

So there is one more process, one that does not wait for events. It compares what the bucket and the table hold right now and fixes any difference. This is called reconciliation. Events are a signal to fix things early; "it does get fixed" is reconciliation's job.

<<< @/examples/08-async/src/housekeeping.ts{housekeeping}

The housekeeping function does three things.

The first is chapter 07's sweep itself. It deletes objects that neither an attachment record nor a note points at. Chapter 07's function is called unchanged.

The second is deleting attachments whose inspection came out "rejected". The order is that of a delete in chapter 07: the record first, the object second. Not deleting at the moment the worker reaches its verdict is deliberate. A finishing request may still be on its way for an object that was just uploaded. Chapter 07 avoided that collision with a boundary in time: "do not touch an object younger than one hour". Everything that deletes sits on the far side of that boundary.

This is also where the verdict is checked against "the object as it is now". If the verdict was reached before the object's last-modified time, it is about the bytes from before a replacement. It is not used.

The third is taking the pending tag off attached images once more. It does what the worker's step 4 does, without relying on an event. The lifecycle rule deletes a pending object one day after its creation at the earliest. Housekeeping that runs hourly passes over the same object more than twenty times before then.

Step 4 alone leaves a very narrow gap: the form is sent again between the finishing request taking the tag off and writing the attachment record, and the worker handles that notification before the record is written. The third job covers that gap too.

### Run it again, or twice at once

Housekeeping takes no time and no input. What to delete is read from the bucket and the table every time. So running it twice in a row, running two at once, and stopping it halfway all end in the same state. The tests check those three. For the halfway case (the record deleted, then a stop before the object is deleted), chapter 07's sweep picks the object up on the next run as "an object without a record".

<<< @/examples/08-async/src/housekeeping-lambda.ts{handler}

What starts this once an hour is EventBridge Scheduler. According to its documentation, Scheduler guarantees "at least once" delivery to a target. Here too, a second delivery can happen. That is one more reason housekeeping is built not to mind overlapping.

Scheduler invokes a Lambda function asynchronously. In an asynchronous invocation, when the function fails, Lambda retries it up to two more times on its own (this comes up again in [chapter 15](/en/chapters/15-email.md)). For housekeeping that is set to zero. A failed run does not need retrying, because the next run starts an hour later.

You can also see from your laptop what would be deleted. It works like chapter 07's `uploads:sweep`.

```bash
vp run async:housekeeping
vp run async:housekeeping --delete
```

This runs with your credentials. The deployed function runs with its own role.

One thing to say up front. Every run of this housekeeping looks at every object in the bucket. Its time and its cost grow with the number of images stored. The numbers are under "What it costs".
