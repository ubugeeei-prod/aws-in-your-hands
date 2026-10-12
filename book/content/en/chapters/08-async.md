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

## Running it locally

<!-- section: 08.local -->

Copy `examples/08-async/.env.example` to `.env` in the same place.

<<< @/examples/08-async/.env.example

Use two terminals. The screen is chapter 07's.

```bash
vp run dev:async
vp run dev:uploads:web
```

Open <http://localhost:5173>, sign in, and attach an image to a note. One line of worker log appears in the API's terminal. It should contain `"status":"recorded"` and `"verdict":"ok"`. The queue and the records can be seen here.

```bash
curl -s http://localhost:8787/local/queue
curl -s -X POST http://localhost:8787/local/queue/redrive
curl -s -X POST http://localhost:8787/local/housekeeping
```

Set `LOCAL_QUEUE_DUPLICATE` to `true` in `.env` and every event arrives as two messages. The log shows one `recorded` line and one `duplicate` line, and there is still one record.

No Docker and no AWS credentials are needed.

### In place of the queue

<<< @/examples/08-async/src/local-queue.ts{queue}

What stands in for SQS is a small class. It keeps only the three rules a worker has to survive. A received message is hidden, not removed. It comes back unless it is deleted in time. Past a set number of receives, it is set aside.

<<< @/examples/08-async/src/local-queue.ts{deliver}

This one stands in for the event source mapping. It receives a batch, calls the worker, and deletes only the messages that were not named as failed.

### In place of the bucket

<<< @/examples/08-async/src/local-bucket.ts{local-bucket}

It extends chapter 07's in-memory implementation and adds two things. When an object is put or deleted, it builds JSON in the shape of an S3 event. And it answers a read that names an ETag.

<<< @/examples/08-async/src/local.ts{local}

<<< @/examples/08-async/src/dev.ts{dev}

The worker is the same function that runs in Lambda. Only what stands around it differs.

This is not an emulation of SQS or S3. Here is what it does not reproduce.

- SQS delivery itself. Duplicates and reordering are things the tests cause on purpose; they do not happen by themselves
- The delay of S3 notifications, and the real form of a sequencer
- How an event source mapping behaves: concurrency, how batches are formed, retries after throttling
- IAM: the queue policy, the functions' roles, Scheduler's role
- EventBridge Scheduler. Locally, housekeeping runs only when you call it with `curl`
- Lifecycle rules. Locally a pending object stays forever

### Tests

```bash
vp run test:unit
```

The tests assemble the same parts as the development server, with the clock and the IDs fixed. Tests that do not need the queue hand messages straight to the worker function.

## Getting ready for AWS

<!-- section: 08.infra -->

### The queues, and the way in

<<< @/examples/08-async/infra/lib/async-stack.ts{queues}

<<< @/examples/08-async/infra/lib/async-stack.ts{queue-policy}

A queue policy is the document of permissions attached to a queue. Only S3 may put messages on this queue, and only on behalf of this bucket, from within this account. The two conditions, `aws:SourceArn` and `aws:SourceAccount`, are the same as in the documentation's example. Without them, anyone could put messages on this queue from their own bucket by going through the S3 service.

The DLQ has no `Allow` at all. Which queues may use this DLQ is decided by a separate setting, the redrive allow policy. Its default is "allow every queue", and this chapter leaves the default.

### Why the bucket's name is fixed

<<< @/examples/08-async/infra/lib/async-stack.ts{bucket-name}

<<< @/examples/08-async/infra/lib/async-stack.ts{notification}

This part is a little tangled.

When S3 receives a notification configuration, it checks that it really can send to the destination queue. So the queue policy has to exist before the bucket. But the queue policy contains the bucket's ARN. With an automatically generated bucket name, the ARN is not known until the bucket exists. The bucket waits for the policy, and the policy waits for the bucket. The CloudFormation documentation warns about this cycle by name.

CDK's `bucket.addEventNotification` solves it with a custom resource: after both the bucket and the policy exist, a separate Lambda function writes the notification configuration. This chapter does not use it. It adds one more function, that function needs permission to rewrite the bucket's configuration, and the notification configuration disappears from the template.

Instead, the bucket's name is fixed. With a known name, the ARN can be written without referring to the bucket. No cycle.

Something was given up too. No two AWS accounts in the world can have a bucket of the same name. The account ID is part of this one, so a clash is unlikely, but not impossible. And a bucket with a fixed name is harder to change in ways that require re-creating it (moving it to another Region, for example).

Another option is to send S3's notifications to EventBridge and have an EventBridge rule put them on the queue. The bucket only says "send to EventBridge", so there is no cycle. The shape of the events changes, and so does the service in between. This chapter has not tried it.

What is notified is creates and deletes of keys starting with `u/`, and nothing else.

### The worker, and how it is called

<<< @/examples/08-async/infra/lib/async-stack.ts{worker}

The worker's role is separate from the API function's role. Three operations for reading the queue, reading objects under `u/` and removing their tags, and three operations on the table. It has no permission to delete an object. Deleting is housekeeping's job.

It is Lambda, not your code, that goes and reads the queue. The role it uses for that is this function's role. The managed policy AWS provides (`AWSLambdaSQSQueueExecutionRole`) allows the same three operations, but on "every queue". Here they are allowed on one queue.

<<< @/examples/08-async/src/worker-lambda.ts{handler}

<<< @/examples/08-async/src/env.ts{env}

<<< @/examples/08-async/infra/lib/async-stack.ts{mapping}

An event source mapping is the setting "Lambda reads this queue and hands it to this function". Three things are decided here.

`batchSize` is 10: the most messages handed over in one invocation.

`maxConcurrency` is 2: the limit on how many workers run at once for this queue. It is the smallest value allowed. With nothing set, Lambda keeps adding workers as long as messages are waiting. According to the documentation it starts with five, and adds up to 300 a minute, up to 1,250. More workers means just as many more requests to whatever the worker writes to (DynamoDB) and reads from (S3).

`reportBatchItemFailures` turns on the partial batch response from earlier. The documentation explains that a function can return a partial success only once this is specified. Forget it, and the list the worker returns should go unused.

There is another way to hold down a function's concurrency: reserved concurrency, set on the function. The documentation stresses that the two are separate settings. If reserved concurrency is the smaller one, Lambda cannot hand the messages it received to the function and is throttled. Such a message goes back to the queue unprocessed, with its receive count one higher.

### Housekeeping and the schedule

<<< @/examples/08-async/infra/lib/async-stack.ts{housekeeping}

Housekeeping's role is a third role. Listing and deleting objects, removing tags, and reading and deleting in the table. It cannot touch the queues.

The timeout is 15 minutes, Lambda's maximum. This function looks at the bucket's objects one after another, so it takes longer as their number grows.

<<< @/examples/08-async/infra/lib/async-stack.ts{schedule}

EventBridge Scheduler is a service that calls one AWS API for you at a set time or interval. The permission it uses for the call is the schedule's execution role. It is a different thing from a function's execution role: a role for "Scheduler calling the function on your behalf".

All this role can do is invoke the housekeeping function. And the only thing that can use this role is a schedule in this account's default schedule group. The documentation specifies that the ARN in the condition must be a schedule group, not an individual schedule.

`retryPolicy` is the retry for when Scheduler fails at the call itself. Up to three times, within fifteen minutes. If that fails, that run is given up. The next one comes an hour later.

### What the tests look at

The tests check the following on the template. Synth runs once, at the top of the file.

- The queue policy has exactly one `Allow`: the principal is S3, the action is `sqs:SendMessage`, and the conditions are the bucket's ARN and the account
- The queue policy does not refer to the bucket resource, and the bucket is created after the queue policy
- The notification configuration is written directly in the template, and there is no resource whose type starts with `Custom::`
- The visibility timeout is six times the worker's timeout, and the DLQ keeps messages longer than the source queue
- The event source mapping has a batch of 10, a concurrency of 2, and `ReportBatchItemFailures`
- The actions of the worker's and housekeeping's roles are exactly the ones described above, with no `*`
- Only Scheduler can use the schedule's role, and all it can do is invoke the housekeeping function

The stack uses 24 resource types: chapter 07's 19 and five more. For the five added (`AWS::SQS::Queue`, `AWS::SQS::QueuePolicy`, `AWS::Lambda::EventSourceMapping`, `AWS::Lambda::EventInvokeConfig`, `AWS::Scheduler::Schedule`), the source at the `v0.296.28` tag confirmed that the pinned cdkd has a dedicated implementation of each. The same source confirmed that the `AWS::S3::Bucket` implementation handles `BucketName` and `NotificationConfiguration`.

## Deploying and checking

<!-- section: 08.deploy -->

From here on, nothing has been run. The steps and the tasks are prepared, and that is all.

```bash
vp run async:infra:diff
vp run async:infra:deploy
vp run async:smoke
```

`async:smoke` puts a small PNG straight into the bucket with your credentials and waits for the worker's record to appear in the table. It then replaces the same key with something that is not an image, and checks that the record turns to "rejected" and that the sequencer grew. Last, it deletes the object and waits for the record to go. It is one lap around S3, SQS, Lambda, and DynamoDB. Each wait is at most 90 seconds.

To use it from a browser too, the steps are chapter 07's.

```bash
vp run async:user:create you@example.com
vp run async:publish
vp run async:smoke:web
```

Put the access token you get by signing in into the environment variable `AIH_ACCESS_TOKEN` and run `async:smoke`, and it checks a form upload as well. After finishing, it sends the same form again and waits for the pending tag to come off. The most important of this chapter's "not yet" items (whether a POST event carries a sequencer) is settled here.

The schedule starts its first run as soon as it is created. The documentation says a rate schedule with no start date behaves that way.

Checking for drift is the same as before.

```bash
vp run async:infra:drift
```

## When it backs up, when it falls over

<!-- section: 08.operate -->

### The queue grows

What happens when uploads suddenly increase and the worker cannot keep up?

Nothing fails. Messages just pile up on the queue. At most two workers run at once, so requests to DynamoDB and S3 do not suddenly increase either. The delay shows up as "inspection results take longer to appear". This is backpressure. A queue takes on the difference in flow as the length of a waiting line.

It can only take it on up to the retention period, though. This chapter's queue keeps a message for 4 days. A message still unprocessed after 4 days is gone. It does not go to the DLQ either. The number to watch is not the length of the queue but the age of its oldest message (`ApproximateAgeOfOldestMessage` in CloudWatch). How to put an alarm together is in [chapter 19](/en/chapters/19-observability.md).

### Looking at the DLQ

```bash
vp run async:queue
vp run async:logs
```

`async:queue` shows roughly how many messages are waiting on the two queues, and the contents of up to the first ten in the DLQ. It moves nothing. It receives with a visibility timeout of 0, so the messages stay visible after you look (only their receive count goes up).

If there is a message in the DLQ, first find the `message failed` line for that key in the worker's log. The reason is written there.

- The reason was temporary (a passing error from DynamoDB or S3, permissions still propagating right after a deploy) and is over
- The reason is a mistake in code or configuration, and it is not fixed yet
- The message itself cannot be read

Only the first kind should be moved back. The second, after it is fixed. The third would only do the same thing again.

```bash
vp run async:queue --redrive
```

This moves the DLQ's messages back to the source queue (a redrive). According to the documentation, a moved message is treated as a new message: it gets a new ID, and its retention period starts over. Messages cannot be selected or rewritten during a redrive. All of them go back.

If a moved message turns out to be an event that was already handled, nothing happens. That is what all of the above was for.

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
