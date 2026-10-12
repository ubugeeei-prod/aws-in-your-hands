---
title: "08 Queue: Run It Locally"
---

# 08 Queue: Run It Locally

## Running it locally

<!-- section: 08.local -->

This page runs the worker and the housekeeping from the [previous page](/en/chapters/08-async.md) on your own machine, without AWS. Small stand-ins take the place of the queue and the bucket, and the same worker function runs on top of them.

First copy `examples/08-async/.env.example` to `.env` in the same directory.

<<< @/examples/08-async/.env.example

You need two terminals. The screen is chapter 07's.

```bash
vp run dev:async
vp run dev:uploads:web
```

Open <http://localhost:5173>, sign in, and attach an image to a note. One line of worker log appears in the API's terminal, and it should contain `"status":"recorded"` and `"verdict":"ok"`. These commands show the queue and the records.

```bash
curl -s http://localhost:8787/local/queue
curl -s -X POST http://localhost:8787/local/queue/redrive
curl -s -X POST http://localhost:8787/local/housekeeping
```

If you set `LOCAL_QUEUE_DUPLICATE` to `true` in `.env`, every event arrives as two messages. The log shows one `recorded` line and one `duplicate` line, and there is still one record.

You need neither Docker nor AWS credentials.

### In place of the queue

<<< @/examples/08-async/src/local-queue.ts{queue}

A small class stands in for SQS. It keeps only the three rules a worker has to withstand: a received message is hidden and not removed, it comes back unless it is deleted in time, and it is set aside once it has been received more than a set number of times.

<<< @/examples/08-async/src/local-queue.ts{deliver}

`deliverOnce` stands in for the event source mapping. It receives a batch, calls the worker, and deletes only the messages whose IDs the worker did not return as failed.

### In place of the bucket

<<< @/examples/08-async/src/local-bucket.ts{local-bucket}

This class extends chapter 07's in-memory implementation and adds two things. It builds JSON in the shape of an S3 event when an object is put or deleted, and it answers a read that names an ETag.

<<< @/examples/08-async/src/local.ts{local}

<<< @/examples/08-async/src/dev.ts{dev}

The worker is the same function that runs in Lambda. Only the parts placed around it differ.

These two stand-ins are not emulations of SQS or S3. They do not reproduce the following.

- SQS delivery itself. Duplicates and reordering are things the tests cause on purpose; they do not happen by themselves
- The delay of S3 notifications, and the real form of a `sequencer`
- How an event source mapping behaves: concurrency, how batches are formed, retries after throttling
- IAM: the queue policy, the functions' roles, Scheduler's role
- EventBridge Scheduler. Locally, housekeeping runs only when you call it with `curl`
- Lifecycle rules. Locally a pending object stays forever

### Tests

```bash
vp run test:unit
```

The tests assemble the same parts as the development server, with the clock and the IDs fixed. Tests that do not need the queue hand messages straight to the worker function.
