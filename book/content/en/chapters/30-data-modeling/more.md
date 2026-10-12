---
title: "30 Data Modeling: Build, Continued"
---

# 30 Data Modeling: Build, Continued

The [Design and Build](/en/chapters/30-data-modeling/build.md) page made the keys, the transactions, the index, and the tag lists. This page covers the page token that safely hands a client the rest of a list, derived data built from the stream, hot partitions, and how to move the keys of a table that is in use.

## A page token you can hand to a client

<!-- section: 30.page-token -->

Chapter 05's cursor was the ID of the last note returned, in base64url. The table's key was determined by the note ID alone, so that was enough.

A `Query` on an index is different. The `ExclusiveStartKey` for the next page needs four attributes: the table's keys (`pk` and `sk`) and the index's (`gsi1pk` and `gsi1sk`). Handing the client DynamoDB's `LastEvaluatedKey` as base64 would work, with two problems. The key design leaks, and if what comes back is passed straight into `ExclusiveStartKey`, a client can rewrite `pk` and point into another owner's partition.

DynamoDB Local refused a start key that points at a partition other than the one being queried, and a test in this chapter checks that. Whether real DynamoDB refuses it the same way could not be read from the description of `ExclusiveStartKey` in the API reference, and was not confirmed. Separation between owners cannot rest on behaviour that was not confirmed.

So the token holds only which list it belongs to and the position of the last note seen.

<<< @/examples/30-data-modeling/src/page-token.ts{token}

There is no owner in the token. The `pk` of the start key is rebuilt on every request from the authenticated caller (the `after` in `listRecent` on the previous page). A token obtained from another owner still reads only inside your own partition. A test uses one owner's token as another owner and checks that what comes back is only that other owner's own notes.

The schema is a `strictObject`, so a token with an extra field is refused. The token also says which list it is for, so a token from the recent list cannot be used on a tag's list, or on another tag.

The token is not signed, because everything in it is a value the client may as well choose. A false position only starts the caller's own list somewhere else. If a token carried something the client must not choose, such as a filter or another user's ID, it would need an HMAC so that tampering is detected, and with it a way to store and rotate the signing key ([chapter 21](/en/chapters/21-security.md)).

## Derived data from Streams

<!-- section: 30.streams -->

Suppose you want the number of notes for each tag. Counting the tag's items with a `Query` is exact, and reads every one of them each time. The other way is to keep the count in an item of its own and move it whenever a tag is added or removed.

That adjustment could go into the transaction that writes the note. This chapter deliberately leaves it out and builds the count from DynamoDB Streams: the count does not need to be right at the moment the note is saved, and the note's transaction should not grow. More to the point, building derived data outside the table is the same mechanism a search index (chapter 27) or a notification ([chapter 25](/en/chapters/25-events.md)) uses.

DynamoDB Streams keeps a table's item changes, in order, for 24 hours. The documentation gives two guarantees: each change appears in the stream exactly once, and changes to the same item appear in the order they happened. Some things are not guaranteed. The order between different items is not fixed. The records of several items written in one transaction do not arrive together, and can be interleaved with those of other transactions.

Lambda reads the stream through an event source mapping and passes records to a function in batches. The guarantee changes at that point. In the stream a record exists exactly once, but Lambda hands it to the function **at least once**. If the function times out, or fails part of the way through a batch, the same record arrives again.

An increment applied twice counts twice. As with the worker in chapter 08, the function has to be built so that a duplicate delivery changes nothing.

```figure
caption: When the same record arrives twice, the marker item is already there, so the count goes up only once.
type: sequence
actor stream: Streams
actor fn: Lambda function
actor table: Table
step stream -> fn: event-7 INSERT TAG#food
step fn -> table: Put APPLIED#event-7 and ADD count 1
note table: count = 1
step fn --x stream: answer lost, timeout
step stream -> fn: event-7 again
step fn -> table: the same transaction
step table --x fn: APPLIED#event-7 exists
note table: count = 1
```

First, the function picks out of a record what matters for the count.

<<< @/examples/30-data-modeling/src/projector.ts{change}

Only a tag item appearing or disappearing moves a count. A tag item rewritten because the title changed (`MODIFY`) leaves the number of tags as it was.

<<< @/examples/30-data-modeling/src/projector.ts{apply}

What makes it idempotent is a transaction. A marker item keyed by the record's ID is written on the condition that it does not exist yet, and the count is adjusted in the same transaction. The two are written together or not at all, so there is never a marker without its adjustment or an adjustment without its marker. When the same record arrives again, the marker's condition fails and the count stays.

A test delivers the same batch twice, and once more in reverse order, and checks that the counts do not move. Next to it, another test does the same without the marker and shows the count doubling.

Markers would pile up, so TTL removes them. A record stays in the stream for 24 hours, and that is as long as Lambda can retry it. The markers expire after 48. According to the documentation, expired items are typically deleted within a few days, and that deletion uses no write capacity.

### Not reading your own writes

The counts and the markers are written to the same table. Those writes flow into the stream too, and the function is invoked again. `tagDelta` ignores everything but tag items, so nothing loops forever, but being invoked for each of your own writes is waste.

A filter on the event source mapping passes only the records of tag items to the function.

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{mapping}

A DynamoDB event source can filter only on what is under `dynamodb` in the record. Here the condition is that the sort key starts with `TAG#`. That the filter really keeps the function's own writes away from it was not checked on AWS. The local tests check the other half: that without the filter nothing keeps going round.

The stream's view type is `KEYS_ONLY`. The function needs to know which item changed, not what is in it. Records are smaller, and no note body passes through the function or its logs. The view type cannot be changed afterwards; changing it means making a new stream.

### Records that fail

<<< @/examples/30-data-modeling/src/stream-lambda.ts{handler}

The function returns the sequence number of the first record it could not apply. Lambda takes the batch up again from that record, and treats the earlier ones as done. The documentation says that even so, a record that succeeded can still be delivered again. Being idempotent remains necessary.

<<< @/examples/30-data-modeling/src/projector.ts{project}

The setting that matters is the number of retries. By default Lambda retries a failed batch until its records expire. Lambda reads a shard's records in order and does not move its position until a batch succeeds, so one record that keeps failing would hold back the records behind it in that shard for up to 24 hours. That follows from two statements in the documentation and was not checked on AWS. This stack limits retries to five and sends a description of each batch it gave up on to an SQS queue. What arrives in the queue is the shard and a range of sequence numbers. The records themselves are not in it, so looking into them means reading the stream within 24 hours.

For every record given up on, a count is off. Derived data should be something you can rebuild from the original. Here, counting the tag items again and writing the result would fix it. That rebuild script is not part of this chapter.

`startingPosition` is `TRIM_HORIZON`. With `LATEST`, the documentation says, changes made while the mapping is being created or updated can be missed.

### What derived data costs

This count is not cheap. Each time a tag is added, the function writes a transaction of two items: four write request units. That is more than writing the tag item itself (two, being inside a transaction).

If all you want is a tag count in a corner of the screen, counting the tag's items with `Select: COUNT` on a `Query` is usually cheaper. Keeping a count pays when one tag has many notes and the count is read often. This chapter builds it from the stream to show the mechanism. The amounts are worked out on the [Costs, Pitfalls, and Cleanup](/en/chapters/30-data-modeling/wrap.md) page.

## Hot partitions

<!-- section: 30.hot-partitions -->

DynamoDB stores a table in partitions. According to the documentation (checked 2026-10-13), one partition can take up to 3,000 read units and 1,000 write units a second. An on-demand table has the same limit. When traffic concentrates on one partition, that partition is throttled even though the table as a whole has room. That is a hot partition.

A partition key should be something traffic spreads widely across. This chapter's partition key is the owner. With many users who each read and write a little, it spreads well. If one owner came to write more than 1,000 units a second, that owner alone would be throttled. A notes app is unlikely to get there, but a design in which the "owner" is an organization with thousands of people under it would.

DynamoDB has a mechanism (adaptive capacity) that moves heavily used items onto partitions of their own. Items under one partition key can be split by sort key range as well. Traffic to a single item cannot be split at all. In this design that item is the per-owner counter. Every create and delete writes it, so it is the first thing to saturate and the first place transactions collide. That is the price of an exact count.

An index has partitions of its own, laid out by the index's partition key. A table that spreads well can still have a hot index if the index's partition key takes few values. The documentation's example is a status (`active`, `pending`, `closed`) used as an index partition key. As the previous page said, when the index is congested, writes to the table are refused. This chapter's index uses the same owner as its partition key, so it spreads the way the table does.

If you really need a key that concentrates on one value, append a number to it and spread it over several partitions (`PENDING#0` to `PENDING#9`), then read all of them and merge. This chapter does not use that.

### Finding one

A throttled request's error says why. For a partition limit the reason is `KeyRangeThroughputExceeded`, and it tells table from index and read from write. If it passes quickly, DynamoDB may have resolved it by splitting the partition.

To see which key is responsible, turn on CloudWatch Contributor Insights for DynamoDB. It reports the most accessed and the most throttled keys of a table or an index.

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{table}

In this stack it is enabled only when you synthesize with `-c insights=on`. The mode is `THROTTLED_KEYS`, which counts throttled keys only. The other mode counts every read and write as an event: it shows skew in access, and costs in proportion to traffic. Either mode has a monthly charge per rule. Turning it on when there is something to investigate is enough.

This section rests on the documentation. No partition was actually saturated to check it.

## Move keys without stopping

<!-- section: 30.migration -->

The design so far differs from the table of chapters 05 to 08 in two places. The attachment key changed from `ATTACHMENT#<note>#<attachment>` to `NOTE#<note>#ATTACHMENT#<attachment>`, and notes gained `gsi1pk` and `gsi1sk`. Consider how to move a table that already holds data, under a running application, to the new shape without stopping it.

DynamoDB has no operation that changes a key. You write an item under the new key and delete the one under the old. In between, old code and new code run at the same time, and items of the old and the new shape are mixed. The steps are arranged so that **at every moment, all the code that is running handles every item in the table correctly**. It is the same idea as in [chapter 12](/en/chapters/12-containers.md), where a database change had to be one that two versions of the code could live with.

The move of the attachment keys is split into four phases.

<<< @/examples/30-data-modeling/src/layout.ts{phases}

| Phase | Writes to | Reads from | Before moving on |
| --- | --- | --- | --- |
| `legacy` | Old key | Old key | The starting point |
| `dual-write` | Both (one transaction) | Old key | Once no old code is running, run the backfill |
| `dual-read-new` | Both | New key | Enter this phase only after the check finds nothing |
| `new` | New key | New key | Delete the old items once no code reads the old keys |

Neighbouring phases can read what each other writes. That lets you deploy one phase at a time and go back one phase if something is wrong. Skipping a phase breaks it. A test checks that attachments are readable for every neighbouring pair, and that an attachment written in `legacy` cannot be read in `new`.

### The backfill

After `dual-write` begins, new attachments are written under both keys. Attachments from before exist only under the old key. Writing the new shape onto data that is already stored is a backfill.

<<< @/examples/30-data-modeling/src/migration.ts{plan}

A backfill runs beside the live application's writes. Between reading an item and writing it, the application may change that item. So every write carries a condition.

The write that adds index attributes to a note requires `version` to be what it was when read. If the application saved the note in the meantime, the condition fails. That is fine: a save by the new code writes the index attributes itself.

The write that copies an attachment checks, besides the destination being empty, that **the old item is still there**, in the same transaction. Without that check, if the application deleted the attachment after the backfill read it, the deleted attachment would come back under its new key. A test reproduces that interleaving step by step.

<<< @/examples/30-data-modeling/src/migration.ts{backfill}

The backfill gives the same result however often it runs, and can resume part of the way through. After each page it returns where to read next. The script prints that position as it goes, so a run that stops can be resumed from what was printed. A test stops and resumes after every page and ends in the same state as a single run.

Before reads are switched to the new keys, check.

<<< @/examples/30-data-modeling/src/migration.ts{verify}

When the check finds nothing, move to `dual-read-new`. Last, after moving to the phase that writes only the new key, delete the old items.

<<< @/examples/30-data-modeling/src/migration.ts{contract}

The delete also checks, in the same transaction, that the copy exists.

The backfill and the check read the whole table with `Scan`. That is billed for what it reads and shares the same limits as every other read. The application's role has no `Scan` permission; the migration scripts run with the credentials of the person running them.

### The order for adding the index

When a GSI is added to an existing table, DynamoDB copies the items already there into the index. The documentation calls that copying a backfill as well. But only items that have the index's key attributes are copied. Chapter 05's notes have no `gsi1pk`, so adding the index alone puts none of them in it. Adding the attributes is the job of the backfill above. A note saved by the new code gets them when it is saved.

One more point about order. The new attachment key starts with `NOTE#`, so it falls inside the range of chapter 05's list `Query` (`begins_with(sk, "NOTE#")`). Write attachments under the new key while chapter 05's code is still running, and its list should fail trying to read an attachment item as a note. A test checks that the new key falls in that range. How chapter 05's code actually fails was not checked by running it. The whole order therefore is:

1. Add the index, and deploy code that writes the index attributes on notes
2. Backfill the notes and check
3. Switch to code that reads the list from the index, and retire everything that uses chapter 05's list `Query`
4. Only now put attachments into `dual-write`, and continue as in the table above

What looks like one change becomes five deploys and two backfills. Changing a key design takes that much work. Writing down the reads first is also how you avoid it.

The steps in this section were exercised on the in-memory model only. They have never been run on a real table.
