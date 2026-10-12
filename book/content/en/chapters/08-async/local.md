---
title: "08 Queue: Run It Locally"
---

# 08 Queue: Run It Locally

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
