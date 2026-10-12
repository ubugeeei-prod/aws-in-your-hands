---
title: "30 Data Modeling: Design and Build"
---

# 30 Data Modeling: Design and Build

The [previous page](/en/chapters/30-data-modeling.md) wrote down six reads. On this page you choose keys to fit them, read a note and its attachments in one request, write several items in a transaction, add an index for a second sort order, and build the tag lists.

## Lay the keys out in one table

<!-- section: 30.keys -->

Chapter 05's table held two kinds of item: notes, and the item that counted them. This chapter's table holds seven. One owner's partition, in sort key order, looks like this.

```text
pk         sk                             attributes
OWNER#u1   APPLIED#<event id>             expiresAt
OWNER#u1   NOTE#mgo1a2b3c                 title, body, version, tags, slug, gsi1pk, gsi1sk
OWNER#u1   NOTE#mgo1a2b3c#ATTACHMENT#a1   contentType, size, createdAt
OWNER#u1   NOTE#mgo1a2b3c#ATTACHMENT#a2   contentType, size, createdAt
OWNER#u1   QUOTA                          noteCount
OWNER#u1   SLUG#kyoto-2026                noteId
OWNER#u1   TAG#food#NOTE#mgo1a2b3c        noteId, title, createdAt
OWNER#u1   TAGCOUNT#food                  count
```

Keeping different kinds of data in one table and telling them apart by the shape of their keys is called single-table design. The items that share a partition key (an item collection) are stored in sort key order, so one `Query` can read a range of them. Placing what is read together side by side is nearly the whole of the design.

A table per kind is also a valid design. The official documentation presents both, and lists as drawbacks of single-table design that backups are taken for the whole table only, that one encryption key covers every item, and that every change flows to the stream even if you only want to process some kinds. This chapter uses one table for two reasons: to read a note and its attachments in one request, and to write a note, its tags, and the count in one transaction. A transaction can span tables, so the second reason alone would not require it.

The functions that build keys live in one file. No other file assembles a key string itself.

<<< @/examples/30-data-modeling/src/keys.ts{keys}

The separator is `#`. If a value that becomes part of a key contained `#`, its key could not be told from a key of another kind, so the schema narrows the characters allowed in a note ID, a tag, and a slug.

<<< @/examples/30-data-modeling/src/model.ts{model}

Chapter 05's `noteSchema` did not restrict the characters of an ID. This chapter's schema lets through exactly what chapter 05's ID generator produces (the time in base 36, then random hexadecimal digits).

## Read a note and its attachments in one request

<!-- section: 30.collection -->

Chapter 07 stored an attachment under the sort key `ATTACHMENT#<note ID>#<attachment ID>`. A note is `NOTE#<note ID>`, so the two are far apart, and showing a note with its attachments takes a `GetItem` and a `Query`.

Here an attachment's sort key continues its note's. The attachments follow directly after the note, so reading one range that starts at the note's key returns both.

<<< @/examples/30-data-modeling/src/keys.ts{ranges}

The range is given with `BETWEEN`, not `begins_with`, because `begins_with(sk, "NOTE#n1")` would also pick up a note whose ID is `n1x`. With `NOTE#n1#~` as the end of the range, only `NOTE#n1` itself and whatever starts with `NOTE#n1#` fall inside: `#` sorts below every character an ID can hold (digits and lowercase letters), and `~` above them all. A test checks that IDs sorting just before and just after, and an ID that merely starts the same way, stay outside.

<<< @/examples/30-data-modeling/src/notebook.ts{collection}

The read is strongly consistent. It reads the table, not an index, so strong consistency is available. Open a note right after adding an attachment and the attachment is there.

If the first item is not the note, the note is treated as missing. As explained below, a delete that stops half way can leave attachments without a note for a while.

The first half of the function reads attachments from their old keys. It is used only while the keys are being moved ("Move keys without stopping" in [Build, Continued](/en/chapters/30-data-modeling/more.md)).

Putting attachments next to their note has a price. Chapter 05 listed notes with `begins_with(sk, "NOTE#")`, and with this layout that range now contains attachment items too. A list of notes alone can no longer be read from this ordering of the table. This chapter solves that by reading the list from an index. A table has one sort order, and fitting it to one read can unfit it for another.

## Transactions and uniqueness

<!-- section: 30.transactions -->

Creating one note writes the note, the counter, the slug, and an item per tag. Chapter 05 wrote the counter and the note as separate requests, so a stop between them left the count wrong. This chapter writes everything at once with `TransactWriteItems`.

A DynamoDB transaction is one request that makes up to 100 item writes and conditions all succeed or all fail. Unlike a SQL transaction, it cannot read something in the middle and decide what to do next. You decide everything that will be written, attach the conditions, and send it.

So the part that plans the writes is a pure function that calls nothing in AWS.

<<< @/examples/30-data-modeling/src/plan.ts{create}

Each planned write carries the reason (`refusal`) to give the caller if its condition does not hold.

`not_exists` on the note is chapter 05's ban on overwriting.

The counter's condition is "not there yet, or below the limit". Because it is in the same transaction as the note, there is no state in which the note was written and the counter was not, or the other way round. The drift that chapter 05 left is gone, and the count is exact.

The slug line is how uniqueness is enforced. DynamoDB has no `UNIQUE` constraint. You create an item whose key is the value that must be unique, on the condition that no item has that key yet. Only one item can exist under a key, so the second write that tries to take the same slug fails. It is in the same transaction as the note, so when the slug cannot be taken, neither the note nor its tags nor the count is written.

The application uses the table through a small set of types. These describe a condition and a write.

<<< @/examples/30-data-modeling/src/table.ts{writes}

The types are there so the same code runs against both DynamoDB and an in-memory model for tests. The DynamoDB side turns them into expression strings.

<<< @/examples/30-data-modeling/src/dynamodb-table.ts{condition}

Attribute names never appear in the expression itself. They go through placeholders such as `#c`, because `count`, `size`, and `name`, among others, are reserved words in DynamoDB and fail if written directly.

<<< @/examples/30-data-modeling/src/dynamodb-table.ts{transact}

When a transaction is cancelled, DynamoDB returns `TransactionCanceledException`, carrying one reason per item in the order they were sent. That order tells you which condition failed.

Besides `ConditionalCheckFailed` there is `TransactionConflict`: another transaction was writing the same item at that moment. In this design every create and delete for an owner writes that owner's counter, so two at once collide. According to the documentation, the AWS SDKs do not retry a cancelled transaction. The application does.

<<< @/examples/30-data-modeling/src/notebook.ts{commit}

A single write is sent as an ordinary conditional write, not as a transaction. A transaction uses two write request units for each item in it, one to prepare and one to commit, and uses them even when it is cancelled.

These are the rules about transactions that shape a design, from the documentation (checked 2026-10-13).

- At most 100 items and 4 MB in total. Tags are limited to eight so that a note and its tags always fit
- One transaction cannot name the same item twice. "Check this item, then update the same item" is written as an update with a condition
- They cannot be used on an index. Only items of a table can be targets
- Seen from a `Query` or a `Scan`, the isolation level is read-committed. A read never sees a transaction half done, but one `Query` can return some items from before a transaction and some from after
- They hold within one Region. To another Region of a global table the changes arrive one by one after the commit ([chapter 28](/en/chapters/28-multi-region.md))

Updates and deletes have the same shape.

<<< @/examples/30-data-modeling/src/notebook.ts{update}

An update reads the note first, because deciding which tag items to delete and which to add takes knowing the current tags. That read is not what refuses a stale update. If another update lands between the read and the write, the `version` condition on the write fails and the whole transaction is cancelled.

### Deleting a note

<<< @/examples/30-data-modeling/src/plan.ts{remove}

The delete transaction removes the note, its place in the counter, its tags, and its slug. The attachments are not in it, because in this chapter their number has no firm bound: chapter 07's limit can be exceeded by simultaneous uploads.

Order protects them instead.

<<< @/examples/30-data-modeling/src/plan.ts{attach}

The transaction that adds an attachment requires the note to exist. A `ConditionCheck` changes nothing and only tests a condition. Once the note is gone the condition fails, so no attachment can be added.

<<< @/examples/30-data-modeling/src/notebook.ts{remove}

After the transaction that deletes the note has committed, whatever attachments remain are swept out.

<<< @/examples/30-data-modeling/src/notebook.ts{sweep}

This ordering guarantees one thing and not another. **No attachment is ever created where there is no note.** That always holds. But if the work stops between deleting the note and sweeping its attachments, attachments without a note remain. Nobody can read them, and calling the delete for the same note again removes them. A test stops the sweep half way and checks both that state and that a second call cleans it up.

## An index for a second sort order

<!-- section: 30.index -->

A list by most recent update cannot be read from the table's sort key. The sort key is the note ID, which is creation order. Nor can the sort key change with each update: a key is an item's identity, and changing it means deleting the item and creating another.

A global secondary index (GSI) lets a table be read by another key. It is a copy of the table's items with a partition key and a sort key of its own. You write to the table, and DynamoDB updates the copy.

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{index}

The index's key attributes have the neutral names `gsi1pk` and `gsi1sk`. As with the table's `pk` and `sk`, what goes into them is the application's decision.

<<< @/examples/30-data-modeling/src/plan.ts{items}

Only note items are given these two attributes. A GSI holds only the items that have both of its key attributes. Attachment and tag items have no `gsi1pk`, so they never appear in the index. An index that holds part of a table is called a sparse index, and it solves the problem of a notes-only list that the table could no longer give.

The sort key carries the time of the last update.

<<< @/examples/30-data-modeling/src/keys.ts{recent}

Sort keys are compared as strings, so a timestamp has to be spelled in a way whose string order is its time order. Chapter 04's timestamp schema does not fix the number of fraction digits, so they are set to three here. The note ID at the end tells apart two notes updated in the same millisecond.

<<< @/examples/30-data-modeling/src/notebook.ts{list-recent}

### What an index costs

An index is not a convenience you simply switch on. It costs three things.

The first is that reads are eventually consistent, with no alternative. According to the documentation a GSI is updated asynchronously, normally within a fraction of a second and sometimes later, and strongly consistent reads are not offered. So a note just created can be missing from the list, and a note just deleted can still be in it. The model used in this chapter's tests can hold the index back, so the tests reproduce both. A screen built on this list has to handle "the note in the list was gone when it was opened".

The second is more writes. One write to the table causes between zero and two writes to the index. The rules from the documentation are copied into the test model as they stand.

<<< @/examples/30-data-modeling/src/memory-table.ts{index-writes}

One write when an item enters the index, two when an index key changes (the old entry is deleted and a new one put), one when only a projected attribute changes, and none when neither does.

This chapter's index has the update time in its sort key, and the update time changes with every edit. **Fixing one character of a body costs one write to the table and two to the index.** The price of "most recently updated first" is two write request units per edit. A list in creation order would not need them, because its index key would never change. Every read you add is paid for on every write.

The third is that a congested index stops writes to the table. When an index cannot take its writes, DynamoDB throttles writes to the base table. The cause is the index and what gets refused is the write to the table. This stack puts a per-second limit on the index as well, and setting it too low produces exactly that.

### What to copy

The set of attributes copied into an index is its projection: the keys only, a chosen list, or everything. An attribute that is not projected cannot be read from the index.

This index projects the six attributes a list shows. It does not project the body.

<<< @/examples/30-data-modeling/src/model.ts{views}

Chapter 05's list read whole items, body included, and dropped the body from the response. Reads are billed by the size of the items read, so a page of the largest notes came to about 77 units. An index entry has no body, and a page is a few kilobytes. Writes went up, and the most frequent read got cheaper. The [Costs, Pitfalls, and Cleanup](/en/chapters/30-data-modeling/wrap.md) page compares the amounts.

Besides GSIs there are local secondary indexes (LSIs): the same partition key as the table with a different sort key. They can be read with strong consistency, but they can only be defined when the table is created, and having one limits the data under each partition key value to 10 GB. They cannot be added later, so this chapter does not use one.

A table can have 20 GSIs by default. The documentation as of 2026-10-13 also describes GSI keys made of several attributes (multi-attribute keys), which would remove the need to assemble strings such as `UPDATED#<time>#<ID>` by hand. It was not tried with the pinned cdkd or with DynamoDB Local, so this chapter does not use it.

## Tags: an index you keep yourself

<!-- section: 30.tags -->

A GSI looks like the way to find notes by tag, and it is not. An index key has to be a string, number, or binary attribute; a list or a set such as a note's `tags` cannot be one. There has to be one item for each pair of note and tag.

So the tag lists are made of items the application writes itself. Tagging a note `food` writes, besides the note, an item `TAG#food#NOTE#<note ID>`. The list for a tag is the range that starts with `TAG#food#NOTE#`. Note IDs sort in creation order, so reading the range backwards gives the newest note first.

<<< @/examples/30-data-modeling/src/notebook.ts{list-by-tag}

Tag items are in the table, so they are written in the same transaction as the note. Unlike the GSI, they are never behind. That is the difference between an index DynamoDB maintains and one the application maintains. Maintaining it yourself means writing the code that does.

<<< @/examples/30-data-modeling/src/plan.ts{update}

Each tag item carries a copy of the note's title and creation time, so that showing titles in a tag's list does not mean reading every note. Keeping the same value in more than one item is called denormalization.

A copy has to be rewritten when the original changes. Changing a title rewrites every tag item of that note. For a note with three tags, a new title is a transaction of four items including the note, and uses eight write request units. An edit that changes neither title nor tags nor slug writes only the note and is not a transaction at all. The tests pin the number of writes in both cases.

The design without the copy is also possible: tag items hold only the note ID, and each list reads the notes it names. Writes get cheaper and reads get dearer. Which is better depends on how often titles change compared with how often tag lists are opened.
