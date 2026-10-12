---
title: "54 Kinesis: Deploy"
---

# 54 Kinesis: Deploy

None of the steps on this page were run. The tasks and scripts exist, and they pass the type check and the template is generated. What the output looks like is described from the scripts' code.

From the moment you deploy, the stream is billed by the hour. When you are done, delete it with the steps on the [costs page](/en/chapters/54-kinesis/wrap.md).

## Deploy and check

<!-- section: 54.deploy -->

```bash
vp run kinesis:infra:synth
vp run kinesis:infra:diff
vp run kinesis:infra:deploy -c alarmEmail=you@example.com
```

`synth` only generates the template locally and does not touch AWS. `diff` and `deploy` use your credentials and `AIH_AWS_ACCOUNT_ID` from `.env`. With `alarmEmail`, SNS sends a confirmation email. Until you open the link in it, no notice arrives.

```bash
vp run kinesis:put
vp run kinesis:history
```

`kinesis:put` writes versions 1 to 5 of the note `demo` to the stream with your credentials. One revision of a note goes into each request, so there are five requests.

`kinesis:history` reads the item the function made in the history table. A mapping can take several minutes to start reading, so at first there may be nothing. Once the records have reached the function, a line containing `version 5, from 5 revisions, missing 0` is printed.

```bash
vp run kinesis:put
vp run kinesis:history
```

Running the same command again puts the same versions 1 to 5 into the stream once more. The stream now holds 10 records, and the history should still read `version 5, from 5 revisions`. The function's log shows `applied: 0` and the count of `stale` records.

```bash
vp run kinesis:put -- --from 6 --count 3
vp run kinesis:history
vp run kinesis:infra:drift
```

Writing the next versions moves the history to version 8. The last command, `drift`, compares what is deployed with cdkd's state (chapter 20).

## Reading again, and batches given up on

<!-- section: 54.operate -->

### A second reader

```bash
vp run kinesis:replay
vp run kinesis:replay -- --since 2026-10-13T09:00:00Z
```

`kinesis:replay` reads the records still in the stream from the start and builds the histories in memory on your machine, with the code the function runs. It writes nothing to AWS. The position the function's mapping remembers does not move either. This is what it means for a reader to hold its position.

The output is the number of records read, how many were already applied, how many were poison, and the history of each note. After the steps above it reads 13 records, 5 of them already applied, and `demo` is at version 8 from 8 revisions. That should match the history the function made (`kinesis:history`).

With `--since` it reads only the records after that time. Because it starts in the middle, a note's versions do not begin at 1 and `missing` is not 0. To rebuild histories by rereading, read from the start.

Rereading is possible only within the retention period (24 hours).

### Putting in a poison record

```bash
vp run kinesis:put -- --poison
vp run kinesis:put -- --note after --count 2
vp run kinesis:history -- --note after
vp run kinesis:failures
```

`--poison` writes one record that is not JSON. Then another note is written, to see what happens to records lined up behind the poison record.

If the service behaves as the model does, the function fails on the poison record four times, and Lambda gives up on that one record and moves on. The history of `after` reaches version 2 from 2 revisions. How long it takes to give up was not measured.

`kinesis:failures` reads the messages in the failure queue, reads the range each one names back from the stream, and shows what the records were. A range of one record whose content is `the record's data is not JSON` is the behaviour of the model.

While the queue holds a message, the `RecordsGivenUp` alarm keeps ringing. Delete the messages once you have looked at them.

```bash
vp run kinesis:failures -- --delete
```

### Watching the delay

A consumer's delay is in `IteratorAge`, in the CloudWatch namespace `AWS/Lambda`. It is in milliseconds, per function name. The `ConsumerBehind` alarm watches the maximum of this value over five minutes.

While the function is not invoked, the metric has no data. Whether the stream is empty or the mapping has stopped cannot be told from it alone. To tell, look at `GetRecords.IteratorAgeMilliseconds` on the stream's side and at the mapping's state (`aws lambda get-event-source-mapping`).
