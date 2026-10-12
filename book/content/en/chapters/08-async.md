---
title: "08 Queue: SQS, DLQs, Idempotency, and Scheduler"
sourceRevision: 4
---

# 08 Queue: SQS, DLQs, Idempotency, and Scheduler

[Chapter 07](/en/chapters/07-uploads.md) let notes carry images and left three things undone. Nobody looks inside an uploaded file, cleaning up orphaned objects is still a task you run by hand, and if the same form is sent again after an upload is finished, the attached image disappears a day later.

This chapter adds two pieces of work that run outside any user's request, and between them they settle all three. One is a worker that runs on every upload and checks what the image really is. The other is housekeeping that runs once an hour.

Most of the chapter is about how to build work that goes through a queue, not about how to use the tools. A message that has been through a queue can arrive twice, messages can arrive out of order, and the worker can stop halfway. The worker is built so that there is one result whichever of those happens.

You need chapter 07. The code is in `examples/08-async/`. The upload API and the screen are imported from chapter 07 unchanged, so this chapter writes only what is added.

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
caption: Every hour the Scheduler invokes Housekeeping, which compares the bucket with the table, deletes objects that nothing points at or that failed the inspection, and takes the pending tag off the attached images that remain and are less than two days old.
node sched: EventBridge Scheduler | "aih-async-housekeeping": rate(1 hour)
node hk: Lambda function "Housekeeping" | timeout 15 min
node s3: S3 bucket
node table: DynamoDB table
edge sched -> hk: assumes "ScheduleRole", invokes asynchronously
edge hk -> s3: list, delete, untag
edge hk -> table: read
```

The new parts are two queues, two functions, and one schedule. The bucket and the table are chapter 07's.

The first two figures show the part that events drive. Each time an image is put or deleted, S3 puts a message on the queue, Lambda hands it to the worker, and the worker runs its four steps. The third figure shows the part that the clock drives: once an hour it compares the bucket with the table, whether or not any event came. The section "Housekeeping by the clock" explains why the chapter has both.

### Why the inspection is not in the finishing request

Reading and checking the image inside chapter 07's "finish" (`PUT /notes/{id}/attachments/{attachmentId}`) looks like the simplest design, but this chapter does not do it.

A user is waiting for the response to the finishing request. If the request read the image from S3, it could not respond until up to 5 MB had been read, and a failure halfway would mean asking the user to try again. An upload whose finishing request never comes would also stay unchecked.

With the inspection outside the request, the user does not wait, and a failure can be retried without the user knowing. In exchange you accept that there is no telling when the work finishes and that the same work may run twice. The rest of this chapter explains how to deal with those two.

### Why an inspection and not a thumbnail

The outline of this chapter planned to make thumbnails here. This is why it inspects instead.

Shrinking an image takes a library that decodes and encodes images, and the commonly used ones contain native code that differs by operating system and CPU. The Lambda functions in this book run on arm64, and esbuild bundles their code into one file at synth time, so native code does not bundle as it is. You would have to build inside Docker or prepare a separate Lambda layer, which adds a lot that is far from this chapter's subject.

So the worker has a lighter job. It reads the start of the file, checks whether the file really is an image and how many pixels wide and high it is, and records that. It decodes nothing. This settles what chapter 07 left open when it said that S3 does not look inside a file.

Queues, retries, and idempotency work the same way whether the worker makes thumbnails or inspects.

### Added to chapter 07's stack

The stack (`AihAsync`) extends chapter 07's `UploadsStack` and writes only what is added. It is a separate stack from chapter 07's (`AihUploads`), so if you deploy both, each has its own bucket, table, and users.

## Looking inside the image

<!-- section: 08.inspect -->

Start with what the worker's job consists of. No AWS appears in this section's code: it is a function that takes bytes and returns a verdict.

<<< @/examples/08-async/src/inspect.ts{sniff}

An image file is made so that its first few bytes give away its type. A PNG starts with eight fixed bytes, a GIF with `GIF87a` or `GIF89a`, a JPEG with `FF D8`, and a WebP with `RIFF` and `WEBP`. The width and height are written near the front as well, so you can read them without decoding the whole file.

JPEG alone takes a little more work. Several blocks, such as camera data (EXIF), can come before the place where the size is written (the frame header), so the code skips one block after another until it finds the header.

<<< @/examples/08-async/src/inspect.ts{judge}

The verdict is "rejected" for one of three reasons.

- The file is none of the four image formats (HTML that calls itself `image/png`, for example)
- It is an image, but not of the type it claims
- It is an image, but it has too many pixels

The third is easy to miss. A 5 MB file can still declare itself 60,000 pixels wide and 60,000 high, and whatever decodes the image later (a browser, or a thumbnailer you add some day) will try to allocate memory for the declared size. The limit here is 40 million pixels.

The tests do not feed the function bytes typed in by hand. They use 3×2 pixel files written by real encoders (macOS `sips`, and `cwebp`). The JPEG file has EXIF before its frame header.

The verdict is recorded in this shape.

<<< @/examples/08-async/src/inspection.ts{record}

`sequencer` and `eTag` say which event, and which bytes, the worker looked at. The idempotency section uses these two values to tell order and duplicates apart.

A record is read back long after it was written. [Chapter 22](/en/chapters/22-recovery.md) reads these out of a restored table. So the checks on numbers and times are a little stricter here. `v.integer()` takes `1e300` as an integer, so `size` uses `v.safeInteger()`. Times are checked with `utcTimestamp`, written in [chapter 04](/en/chapters/04-http-api.md).

## Delivery is guaranteed "at least once"

<!-- section: 08.delivery -->

Between an image landing in the bucket and the worker running, a message passes through three services. This is what the documentation of each one promises.

- S3 event notifications are designed to be delivered at least once. They are not guaranteed to arrive in the order the events happened. On rare occasions the same event arrives twice. They usually arrive within seconds, and can take a minute or longer
- SQS standard queues deliver at least once. More than one copy of a message may be delivered, and messages may arrive out of order
- Lambda event source mappings process each event at least once. Duplicate processing can occur

All three say "at least once", and none says "exactly once". The SQS documentation asks you to make applications idempotent, meaning that processing the same message twice does no harm. The Lambda documentation "strongly recommends" the same.

SQS has another kind of queue, the FIFO queue, with a mechanism for removing duplicates. S3 event notifications cannot be sent to a FIFO queue, though. And even when a queue removes duplicates, a worker that stops halfway is handed the same message again.

### Receiving a message does not remove it

A message you receive from SQS stays on the queue. It is only hidden for a set time.

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

The time a message stays hidden is called the visibility timeout. If no delete request arrives within it, the message becomes visible again and goes to the next worker that receives. That is why a worker that dies does not lose the message.

The same mechanism means that if worker A is still running at t3, two workers are handling the same message at once. The queue is only doing what it promised. For standard queues, the SQS documentation does not even guarantee that a hidden message is handed to nobody else.

The visibility timeout in this chapter is 180 seconds, and the worker's timeout is 30. The Lambda documentation recommends a visibility timeout of at least six times the function's timeout, and the chapter follows it.

### Reading a message

The body of a message from the queue is JSON that S3 wrote. It comes from outside the types, so the worker checks it against a schema.

<<< @/examples/08-async/src/events.ts{schema}

<<< @/examples/08-async/src/events.ts{parse}

Three things need care when reading a message. All three are in the documentation, and all three are easy to forget.

The first is that a test event arrives. When a notification is configured, S3 sends one message called `s3:TestEvent`. It has a different shape from a normal event and no `Records`. If the worker failed it as an unreadable message, one message would land in the dead-letter queue right after every deploy, so the worker logs that it received the test event and treats it as a success.

The second is that the key is encoded. The object key in an event is URL encoded, with a space written as `+`. The keys in this chapter contain only letters, digits, hyphens, and `/`, so no harm would come of it, but the code decodes the key before using it.

The third is that `sequencer` may be missing. `sequencer` is the value that tells the order of events, and the idempotency section uses it. The documentation says it is "only used with PUT and DELETE requests". If a create event comes without a `sequencer`, the worker fails that message, so that it never handles an event of unknown order on a guess.

This third point has not been checked against real AWS. Uploads in this chapter are form POSTs, and the documentation does not say whether the event for an object created by POST carries a `sequencer`. The steps for checking it are on the [deploy page](/en/chapters/08-async/deploy.md), and the list of what is unchecked is in the [verification notes](/en/chapters/08-async/wrap.md).

### When part of a batch fails

Lambda reads up to ten messages from the queue and calls the worker once. With nothing configured, a worker that throws sends all ten back to the queue, and the nine that succeeded are processed again.

A partial batch response avoids that. With `ReportBatchItemFailures` on the event source mapping, the worker can return the IDs of only the messages that failed.

<<< @/examples/08-async/src/worker.ts{batch}

The worker wraps each message in a `try` and returns only the IDs of those that failed. Lambda deletes from the queue every message whose ID is not in the returned list.

The response has rules. An empty list means that everything succeeded, and a function that throws means that everything failed. A returned ID that is not in the batch, or that is an empty string, also makes Lambda treat the whole batch as failed. A handler that means to report failures and gets the shape wrong ends up retrying everything, so the tests pin the shape the worker returns.

### A message that can never be processed

A message whose body is not even JSON cannot be processed however many times it is delivered. Left alone, it comes back each time the visibility timeout runs out and keeps invoking the worker.

So the queue gets a rule, called a redrive policy, that sets aside in another queue any message received five times and never deleted. That other queue is the dead-letter queue (DLQ). Five is the minimum the Lambda documentation recommends.

The worker does not quietly throw away a message it cannot read. It reports the message as failed and lets it travel to the DLQ, because if it were thrown away nobody would notice that something is wrong. A DLQ is a place for a person to look.

The DLQ keeps messages for 14 days and the source queue for 4. In a standard queue, a message's expiry is counted from the time it first entered a queue, and moving to the DLQ does not restart the count. If the DLQ kept messages only as long as the source queue, a message that moved there would vanish before anyone looked at it.

## Twice delivered, one result

<!-- section: 08.idempotency -->

This section is the main subject of the chapter. Here is what it protects, in one sentence.

**For one object key there is at most one inspection record, and it comes from the newest create event the worker has handled. The same event arriving again, an older event arriving later, and two workers holding the same event at once all leave that unchanged.**

As the previous section showed, using SQS does not mean that a message is processed once. Leaving only one run's worth of result is the worker's job.

### A key that identifies the same work

To recognize a second delivery, you need a value that says you have seen this work before. That value is called the idempotency key.

The SQS message ID is the first candidate that comes to mind, and it cannot be the key. A message ID names a delivery, not a piece of work.

- If S3 sends the same event twice, the two enter SQS as separate messages with two IDs
- A message moved from the DLQ back to the source queue is treated as a new message and gets a new ID

In both cases the work inside is the same. The key has to come from the work itself.

This chapter uses the pair of object key and `sequencer` as the key. `sequencer` is a hexadecimal string that S3 puts on create and delete events, and between two events for the same key, the one with the greater value happened later. According to an AWS blog post, notifications that arrive as duplicates carry the same `sequencer`.

<<< @/examples/08-async/src/sequencer.ts{sequencer}

`sequencer` values are not always the same length. The documentation says to pad the shorter one with zeros on the left before comparing. This function brings every value to one length, in upper case, so that a plain string comparison gives the order. The values need this form because a string comparison is the only kind a DynamoDB condition expression can do on them.

### Reading the bytes an event refers to

Between the moment the worker receives an event and the moment it reads the object, the object may have been replaced, leaving different bytes under the same key. If the worker read those and recorded them as the result of this event, the record would not match the content.

<<< @/examples/08-async/src/object-reader.ts{port}

<<< @/examples/08-async/src/s3-object-reader.ts{read}

An event carries the ETag of the object that was put. When `GetObject` sends that ETag in `If-Match`, S3 returns the content only if the object there now has the same ETag, and answers 412 otherwise. The worker therefore reads the bytes this event refers to, not whatever is under the key now.

On a 412 the worker does nothing. The replacement has a create event of its own, and the worker does the work when it receives that one. A 404 (the object is gone) is handled the same way.

`Range` limits how much is read: never more than the upload limit of 5 MB. If a large object were put under this key without going through the form, it still could not use up the function's memory.

### The steps, and their order

<<< @/examples/08-async/src/worker.ts{handle-event}

Handling one create event takes four steps, in an order that is safe to stop at anywhere.

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

Steps 1 and 2 only read, so running them any number of times changes nothing. The first write is step 3, and it carries a condition.

<<< @/examples/08-async/src/dynamodb-inspection-repository.ts{put-if-newer}

The condition is that the write happens only if there is no record for this key yet, or the record there has a smaller `sequencer` than this event's. As with the optimistic locking of [chapter 05](/en/chapters/05-dynamodb.md), DynamoDB runs the check and the write as one step. Two workers holding the same event at once cannot both pass the check, and an older event that arrives later cannot overwrite a newer record.

When the condition refuses the write, the worker does not return a failure. Work that is already done counts as a success. Returning a failure here would send the message back to the queue, to be refused five times and land in the DLQ, although nothing is broken.

The record lives in the same table as chapter 07's records, in the same owner's partition.

<<< @/examples/08-async/src/dynamodb-inspection-repository.ts{keys}

### An existing record does not skip step 4

Step 4 is there to close a gap that chapter 07 left.

The gap is this. A presigned form can be used any number of times until it expires after 5 minutes. If the same form is sent again after the upload is finished, S3 replaces the object and puts the `upload-state=pending` tag back on. The attachment record exists, and yet the lifecycle rule deletes the object a day later.

A replacement is a kind of create, though, so S3 sends an event. After recording the inspection, the worker looks for an attachment record under that key and, if there is one, takes the tag off. Seconds later the object is back in its earlier state.

What needs care is where step 4 sits. Suppose the worker stops right after step 3 and before step 4. The message comes back, and the second run learns at step 3 that a record already exists. If it returned there, the tag would stay on for good, because the first run never reached step 4 and the second skipped it.

So the worker goes on to step 4 whichever way step 3 turned out. Taking a tag off gives the same result however often it runs, so repeating it does no harm. A mark that says "processed" and processing that is completely finished are different things. If anything follows the mark, the mark must not be a reason to skip what follows.

There are two other ways to do this. One is to write the mark after everything else is done. The other is to put the mark and the remaining writes into one transaction. A transaction works when every write goes to the same DynamoDB table, and step 4 here is an operation on S3, so it does not apply.

### Tests that fix an order and try to break it

Each test fixes one order of arriving messages and one place where the worker stops, and then examines the record. The tests hand messages straight to the worker function, so they need no queue, no clock, and no random numbers.

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

The third row of the table is the double execution that follows an expired visibility timeout. A test fixture makes worker A's write wait for a signal, and worker B runs to the end in the meantime.

The worker handles delete events too, so that no inspection record outlives its object. `sequencer` matters here as well. As the seventh row shows, carrying out a late delete event as it stands would erase the record of an object that was put after it. The delete carries the condition "delete only a record older than this delete", which prevents that.

The code was also broken on purpose in two places, and four of the tests in the table failed. One change ran step 4 only when the record was written, and the other let an equal `sequencer` overwrite.

### What is still open

These are the gaps that have not been closed.

There are two ways an inspection record can be left without its object. In the first, worker A is just before step 3 of a create event when worker B finishes the delete event for the same key. When B looks there is no record yet, so nothing is deleted, and then A writes its record. The second is a delete by the lifecycle rule. Whether that notification (`LifecycleExpiration:Delete`) carries a `sequencer` has not been checked. If it does not, the worker does nothing. Between erasing a record on a delete whose order is unknown and leaving a stale record, the worker leaves the stale record.

Neither case is visible to users. Nobody reads an inspection record that has no attachment record, so the only cost is a small row left in the table. To close the gap, a delete would write a "gone" mark (a tombstone) carrying the `sequencer`, under the same condition, instead of deleting the record, and DynamoDB's TTL would clear the mark away. This chapter does not implement that.

The problem chapter 05 recorded, that a retried create makes two notes, has the same shape. It is fixed if the caller sends a value that marks the request as the same one (a header such as `Idempotency-Key`) and the server writes conditionally with that value as the key. The reasoning is the same as in this section, but this chapter does not fix it.

## Housekeeping by the clock

<!-- section: 08.housekeeping -->

A worker driven by events is fast, but it does not run when no event comes. A notification can be a minute late, and a message can sit in the DLQ without anyone noticing.

So the chapter has one more process, one that does not wait for events. It compares what the bucket and the table hold right now and fixes any difference, an approach called reconciliation. Events are a signal to fix things early, and reconciliation is what makes sure they do get fixed.

<<< @/examples/08-async/src/housekeeping.ts{housekeeping}

The housekeeping function has three jobs.

The first is chapter 07's `sweep` itself, which deletes objects that neither an attachment record nor a note points at. Chapter 07's function is called unchanged.

The second is deleting attachments that the inspection rejected. The order is the one chapter 07 uses for a delete: the record first, then the object. The worker deliberately does not delete at the moment it reaches its verdict, because a finishing request may still be on its way for an object that was just uploaded. Chapter 07 avoided that collision with a boundary in time, leaving alone any object younger than one hour. Everything that deletes acts only on objects older than that boundary.

Before deleting, housekeeping also checks that the verdict is about the object as it is now. A verdict reached before the object's last-modified time is about the bytes from before a replacement, and housekeeping does not use it.

The third is taking the pending tag off attached images once more. This does what the worker's step 4 does without relying on an event. It applies to objects at least an hour old and less than two days old, and it skips the ones the second job has just deleted. An object older than two days that still exists either never got the pending tag back or is past saving. The lifecycle rule deletes a pending object one day after its creation at the earliest, and housekeeping that runs hourly passes over the same object more than twenty times before then.

Step 4 alone leaves a very narrow gap: the form is sent again between the finishing request taking the tag off and writing the attachment record, and the worker handles that notification before the record is written. The third job covers that gap too.

### Overlapping runs end in the same state

Housekeeping is given no time and no input when it starts, and reads what to delete from the bucket and the table on every run. So running it twice in a row, running two at once, and stopping it halfway all end in the same state. The tests check those three cases. If a run stops after deleting the record and before deleting the object, chapter 07's sweep picks the object up on the next run as an object without a record.

<<< @/examples/08-async/src/housekeeping-lambda.ts{handler}

EventBridge Scheduler starts this function once an hour. According to its documentation, Scheduler guarantees "at least once" delivery to a target, so the invocation that starts housekeeping can arrive twice as well. That is one more reason housekeeping is built to tolerate overlapping runs.

Scheduler invokes a Lambda function asynchronously. In an asynchronous invocation, when the function fails, Lambda retries it up to two more times on its own (this comes up again in [chapter 15](/en/chapters/15-email.md)). Housekeeping sets that to zero, because a failed run does not need retrying when the next run starts an hour later.

You can also see from your own machine what would be deleted. The task works like chapter 07's `uploads:sweep`.

```bash
vp run async:housekeeping
vp run async:housekeeping --delete
```

This task runs with your credentials, and the deployed function runs with its own role.

One note on cost before moving on. Every run of this housekeeping looks at every object in the bucket, so its time and its cost grow with the number of images stored. The numbers are under "Cost" on the [costs page](/en/chapters/08-async/wrap.md).
