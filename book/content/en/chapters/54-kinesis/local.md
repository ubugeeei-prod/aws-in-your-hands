---
title: "54 Kinesis: Run It Locally"
---

# 54 Kinesis: Run It Locally

This page runs the writer and the reader from the [design page](/en/chapters/54-kinesis/build.md) without AWS. Two in-memory models stand in for Kinesis and Lambda: a model of a stream and a model of an event source mapping. Both implement only rules the official documentation states, and neither is the real thing.

## The local models

<!-- section: 54.local -->

### The model of a stream

<<< @/examples/54-kinesis/src/local-stream.ts{types}

The stream model implements these rules:

- A shard owns a range of hash keys, and the MD5 of the partition key decides which shard a record goes to
- Records stay in a shard in the order they arrived, with a sequence number that increases within the shard
- Reading removes nothing. A record older than the retention period (24 hours) can no longer be read
- A reading position is given as `TRIM_HORIZON`, `LATEST`, `AT_TIMESTAMP`, `AT_SEQUENCE_NUMBER`, or `AFTER_SEQUENCE_NUMBER`
- A shard accepts writes of up to 1,000 records or 1 MiB a second
- PutRecords accepts or refuses each record by itself, and goes on after a refusal
- Splitting a shard closes the parent, leaves its records in it, and sends new records to the children

<<< @/examples/54-kinesis/src/local-stream.ts{put}

Some things the model decided for itself: that the write limit is counted within each whole second of the clock, and how sequence numbers grow. Neither is in the documentation.

Some things it does not implement: merges, the limits on GetRecords calls and read throughput, the expiry of an iterator (5 minutes), the limit on a record's size, and encryption.

<<< @/examples/54-kinesis/src/local-stream.ts{read}

Reading takes a position and a count, and returns records and the next position. The stream does not remember that anything was read. A closed shard read to its end returns no next position.

### The model of an event source mapping

<<< @/examples/54-kinesis/src/local-poller.ts{settings}

The mapping model follows the behaviour the Lambda documentation describes:

- It reads one batch per shard at a time and invokes the function
- When the function fails, it hands over the same batch again. Until it succeeds, the rest of that shard is not read
- With `reportBatchItemFailures` on, everything before the lowest sequence number returned counts as done. With it off, the failures returned are not looked at and the batch counts as a success
- With `bisectBatchOnFunctionError` on, a failed batch is cut in two. Cutting does not count as a retry
- When the retries run out or the records are too old, it gives up on the batch and leaves a record in the shape of the documentation's example

<<< @/examples/54-kinesis/src/local-poller.ts{poll}

Two things could not be read from the documentation, and the model decided them. One is that after a partial batch response has finished the first part of a batch, the retries of the rest are counted from zero. The other is that after a split the parent shard is read to its end before the children. Whether the service does the same was not checked. The code carries the same caveat at those places.

The clock is passed in. Tests move time themselves, so "six hours later" and "1,200 records in one second" are reproduced without waiting.

<<< @/examples/54-kinesis/src/local.ts{local}

`createLocal` returns a stream, a clock, and a function that makes consumers. The handler a consumer uses is the code the stack deploys. Only two things are replaced: where the history is stored (memory) and what invokes the function (the model).

### The demo

```bash
vp run kinesis:demo
```

It plays the failures of this chapter as four scenes. This is the output of a run on 2026-10-13.

```text
1. Five revisions of a note, and a function that fails after doing its work
   compares versions before it writes                version 5, from 5 revisions
   applies whatever arrives                          version 5, from 10 revisions

2. a@1 a@2 <poison> b@1 b@2 in one shard
   Lambda's defaults, after 500 tries                nothing applied for b: the shard is stuck
   the stack's settings                              version 2, from 2 revisions for b; given up on: 1 batch of 1 record

3. Two revisions in one PutRecords request, and the first is refused once
   refused entries sent again                        version 2, from 1 revisions
   one revision of a note per request                version 2, from 2 revisions

4. A second consumer, added an hour later, reads from the oldest record
   the first consumer                                version 3, from 3 revisions
   the second consumer                               version 3, from 3 revisions
```

When `version` and `revisions` are equal, the note's revisions were applied once each, in order. The second line of the first scene has 10 revisions for version 5, and the first line of the third scene has 1 for version 2. In both, the invariant is broken.

## Tests that break the invariant

<!-- section: 54.failures -->

```bash
vp test run examples/54-kinesis
```

The invariant is: for each note, every revision is applied once and in order. The tests make the events that break it happen in a fixed order, and check a design that holds next to one that does not.

### A failed batch delivered again

<<< @/examples/54-kinesis/test/poller.test.ts{duplicates}

The function has applied five records, and its response never reaches Lambda. A timeout is such a case. To Lambda it is a failure, so the same five records come again.

The consumer that compares versions lets none of the second five pass: they are all stale. The history stays at version 5 from 5 revisions. The consumer that applies whatever arrives has built the same note from 10.

The first result in the first test is `split` because, with the stack's settings, a failed batch is cut in two. The halves, of three and two records, are each delivered again.

### A poison record

The same sequence (two records of a, a poison record, two of b) is read by four mappings with different settings.

With Lambda's defaults the shard stops. The test lets an hour of clock time pass while polling, and checks that nothing behind the poison record is applied, that another shard goes on, and that the iterator age passes the alarm's threshold.

A mapping with only a number of retries tries four times and then gives up on the whole batch. The two records of b, in the same batch as the poison record, are dropped with it.

A mapping without `reportBatchItemFailures`, whose function returns failures, moves on as if nothing had happened. b is not applied and no failure record is left. Of the four, this is the hardest to notice.

<<< @/examples/54-kinesis/test/poller.test.ts{poison}

With the stack's settings, the poison record is the only one given up on. a and b each get both revisions, and the failure record points at a range of one record: its first and last sequence numbers are the same.

### A way of writing that changes the order

<<< @/examples/54-kinesis/test/producer.test.ts{reorder}

The stream model is told to refuse the first entry of the next PutRecords call. Sending the refused entry again puts version 2 and then version 1 into the stream. The reader does not go backwards, so version 1 is dropped and the history reads "version 2, 1 revision". Sending one revision of a note per request keeps the order through the same refusal.

### A hot key

<<< @/examples/54-kinesis/test/stream.test.ts{hot-key}

On a stream of two shards, one note gets 1,200 records in one second. The 200 past the first 1,000 are refused. Meanwhile the other shard has received nothing. Being refused while the stream as a whole is at half its capacity is what a hot key is.

### A shard split

<<< @/examples/54-kinesis/test/poller.test.ts{split}

Versions 1 to 3 are written, the shard is split, and versions 4 and 5 are written. Read the parent to its end and then the child, and all five are applied in order. Read the child first, and the history goes to version 5 and then drops the parent's three records as stale. It never goes backwards, but three revisions are missing.

### What you cannot learn locally

What the tests check is that the handler, the writer, and the history's condition keep the invariant on a stream and a mapping that behave as documented. That the real Kinesis and Lambda behave as documented was not checked. Latency, throughput, how the iterator age metric is published, and the shape of the record that actually reaches SQS cannot be learned locally either.
