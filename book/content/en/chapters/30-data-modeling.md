---
title: "30 Data Modeling: Single-Table Design, GSIs, Streams, and Transactions in DynamoDB"
sourceRevision: 1
---

# 30 Data Modeling: Single-Table Design, GSIs, Streams, and Transactions in DynamoDB

[Chapter 05](/en/chapters/05-dynamodb.md) used a DynamoDB table as a key-value store, looked up by owner and note ID. There were only two ways to read it, so one pair of keys was enough. This chapter is about designing the table when there are more: reading a note together with its attachments in one request, listing notes by most recent update, finding them by tag, and counting them.

In DynamoDB you write down how the data will be read first, and choose the keys to fit. To the notes app you add, in turn, single-table design (different kinds of items side by side in one table), a global secondary index (GSI) for a second sort order, transactions that write several items together, and DynamoDB Streams, which feeds changes to code that builds derived data. With each addition you check what it guarantees and what it costs.

Chapter 05 is the prerequisite. The code is in `examples/30-data-modeling/`. This chapter adds no HTTP layer. What it builds is the storage layer that goes under chapter 05's `NoteRepository`, and a Lambda function that reads the stream. Sign-in ([chapter 06](/en/chapters/06-auth.md)) and attachment uploads ([chapter 07](/en/chapters/07-uploads.md)) sit on top unchanged.

Nothing in the stack is billed just for existing, and nothing in it can be called from outside.

This chapter spends a good deal of effort on requirements that take a few lines of SQL. When that effort is not worth it is the subject of the last section of this page, "When a relational database fits better".

## The whole picture

<!-- section: 30.overview -->

```figure
caption: The application writes to the table only. The index and the tag counts are built afterwards, by DynamoDB and by Lambda.
node app: Notebook | src/notebook.ts
node table: DynamoDB table | pk, sk
node index: GSI gsi1 | notes only, latest update first
node stream: DynamoDB Streams | KEYS_ONLY, 24 hours
node fn: Lambda function | src/stream-lambda.ts
node dlq: SQS queue | batches that were given up on
edge app -> table: Query, TransactWriteItems
edge app -> index: Query (eventual)
edge table --> index: applied asynchronously
edge table --> stream: one record per change
edge stream -> fn: TAG# records only
edge fn -> table: writes tag counts
edge fn --x dlq: when retries run out
mark table
```

The application writes to one place, the table marked in the figure. Notes, attachments, tags, and the counter are all items in it.

The index and the tag counts are derived from the table. DynamoDB updates the index, and a Lambda function reading the stream updates the tag counts, both after the write to the table. Both run a little behind it. That distinction comes back throughout the chapter: for each way of reading, you decide whether it must be right the moment the table is written, or may catch up later.

## Write down the reads first

<!-- section: 30.access-patterns -->

One way the application reads or writes its data, stated precisely, is called an access pattern. The notes app in this chapter has six.

| Read | Where from | Consistency |
| --- | --- | --- |
| One note and all its attachments | One `Query` on the table | Strong |
| An owner's most recently updated notes | A `Query` on the GSI | Eventual only |
| The notes that carry a tag | A `Query` on the table (tag items) | Read eventually consistent |
| How many notes an owner has | `GetItem` on a counter item | Strong, and exact |
| How many notes carry a tag | `GetItem` on an item built from the stream | Behind by the stream processing |
| A note by its slug | Two `GetItem` calls | Strong |

A slug is a second name for a note, unique among one owner's notes (a string such as `kyoto-2026`). It is here to show how "no duplicates" is enforced on DynamoDB.

The writes have rules too.

- A note, its tags, its slug, and the count are all written, or none of them is
- An attachment can be written only while its note exists
- An update based on an old `version` is refused, as in chapter 05

The limits are decided up front as well: 100 notes per owner, 8 tags per note, 20 items per list page. The tag limit is also what lets a note and its tags fit in one transaction.

<<< @/examples/30-data-modeling/src/model.ts{limits}

The table comes first because in DynamoDB a read that is not in it cannot be added cheaply later. "Notes whose body contains a given word", for example, is in no key, so it means reading the whole table (full-text search is [chapter 27](/en/chapters/27-search.md)).

## When a relational database fits better

<!-- section: 30.fit -->

Written in SQL, what this chapter builds is three tables (notes, attachments, tags), a few indexes, a `UNIQUE` constraint, and `COUNT(*)`. Another sort order is one more index. No copy of a title needs rewriting, and no count needs keeping. Most of this chapter implements in application code what a relational database gives you for a declaration.

What DynamoDB gives in return is what chapter 05 listed: no connections to manage, no VPC, close to nothing to pay while idle, and reads that can be designed to touch the same amount of data however large the table grows. It suits an application whose reads are known, few, and unlikely to multiply.

If any of these describes yours, SQL is the easier choice.

- The reads are not settled yet, or new ones keep arriving
- Aggregates and joins across kinds of data are central
- There are several uniqueness or reference constraints
- You need to write, as one unit, more than fits the limit of 100 items per transaction

Within AWS that means Aurora DSQL or RDS for PostgreSQL from [chapter 13](/en/chapters/13-sql.md).

If you are on Cloudflare, D1 will often fit as it is. According to its documentation as of 2026-10-13, D1 is queried with SQLite's SQL, indexes are made with `CREATE INDEX`, and uniqueness is enforced with `CREATE UNIQUE INDEX`. Statements sent with `batch()` run as one transaction. It bills rows read and rows written, and a write to an indexed column adds at least one more row written, which is the same shape as "index writes are billed too" in this chapter. Its limits are size and concurrency: a database holds at most 10 GB and that limit cannot be raised, and one database processes queries one at a time. Cloudflare says D1 is designed for splitting data across databases, one per user or per tenant.

SQLite in Durable Objects is close too. Each object has a SQLite database of its own (up to 10 GB) and runs single-threaded. Its SQL API is synchronous, so within one piece of work no other request gets in between a read and the write that follows. The guarantee this chapter assembles from conditional writes and transactions comes with the execution model there. Put one owner's notes in one object and most of this chapter's problems do not arise. In exchange, queries across objects are yours to build.

Vercel has no database of this kind of its own. Its documentation, checked the same day, lists Blob and Global Config as Vercel's own storage, with relational and NoSQL databases provisioned from other providers through the Marketplace.

If the notes app stays the size it is in this chapter, nothing about its data design is a reason to leave D1 or Durable Objects. Learning to design for DynamoDB pays off when you are on AWS for other reasons and want a store with no connections and no servers.

Four more pages follow. [Design and Build](/en/chapters/30-data-modeling/build.md) makes the keys, the transactions, the index, and the tags. [Build, Continued](/en/chapters/30-data-modeling/more.md) covers page tokens, the stream, hot partitions, and moving keys. Then come [Run It Locally](/en/chapters/30-data-modeling/local.md), [Deploy](/en/chapters/30-data-modeling/deploy.md), and [Costs, Pitfalls, and Cleanup](/en/chapters/30-data-modeling/wrap.md).
