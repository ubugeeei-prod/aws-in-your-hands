---
title: "05 KV Store: DynamoDB"
sourceRevision: 3
---

# 05 KV Store: DynamoDB

The chapter 04 API kept its notes in memory. A different execution environment gave a different answer, and after a while the notes were gone. In this chapter, let's save them properly.

The notes go into a DynamoDB table, so a read from any execution environment returns the same answer. Along the way you'll deal with the things you can't avoid once you save data. Two people editing the same note at the same time, without the later save silently overwriting the earlier one. A save that is retried because its response never arrived, and is not applied twice. A list that pages through without dropping notes as their number grows. And the function gets permission for five operations on this one table, nothing more.

This chapter builds on [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/05-dynamodb/`. It carries over the chapter 04 API and extends it, and it runs on its own.

There's still no authentication. Anyone who knows the URL can read and write, and delete too (authentication is [chapter 06](/en/chapters/06-auth.md)). There is a lid on volume: at most 10 requests a second, and at most 100 notes. Please don't put in data you'd mind other people seeing, or deleting.

If your data is something you want to query with SQL, you can skip this chapter and go on to [chapter 13](/en/chapters/13-sql.md). The section "When DynamoDB doesn't fit", later on, gives some guidance for deciding.

## The big picture

<!-- section: 05.architecture -->

```figure
caption: A request passes through API Gateway and Lambda, and the notes are stored in a DynamoDB table.
node client: Client
node api: API Gateway HTTP API
node fn: Lambda function (AWS SDK for JavaScript v3) | any number of execution environments; they hold no notes
node table: DynamoDB table (ap-northeast-1, on-demand) | pk = OWNER#<owner>, sk = NOTE#<note id>, version, title, body, ...
edge client -> api: HTTPS
edge api -> fn: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> table: execution role: GetItem, PutItem, UpdateItem, DeleteItem, Query
mark table
```

What changed from chapter 04 is the bottom layer. The owner of the state used to be each individual execution environment; now it's the table. However many execution environments there are, and whenever one disappears, it no longer hurts.

### Why DynamoDB?

DynamoDB is a database in which you read and write items by specifying a key. There are three reasons for choosing it in this chapter.

- There are no connections to manage. You call an HTTPS API and that's it. When the number of Lambda execution environments grows, you don't have to think about connection limits or pools
- It needs no network design. It doesn't have to sit inside a VPC, so you add one table to the chapter 04 architecture and you're done
- While it isn't being used, the only charge is for what is stored. For an on-demand table, the request charge is 0 when there are no requests

In exchange, you have to **decide first how you will read**. You can't filter freely by a condition you think of later, the way you can in SQL. The second half of the chapter covers the cases where this doesn't fit.

## Derive the keys from how you read

<!-- section: 05.model -->

DynamoDB table design starts from "how do you read and write?", not from "what data is there?". This API reads and writes in two ways.

1. List one owner's notes, newest first
2. Given an owner and a note ID, read, update, or delete that one note

A DynamoDB item is uniquely identified by the pair of its partition key and its sort key. Items with the same partition key are stored together and, within that group, ordered by sort key. Let's map the two access patterns onto this property.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{keys}

With the owner as the partition key, "all of one owner's notes" can be read with a single Query. With the note ID as the sort key, "one note" can be read by an exact match on the key.

That leaves "newest first". The creation time goes at the front of the ID, so that sort key order is creation order.

<<< @/examples/05-dynamodb/src/id.ts{id}

Now listing is only a matter of reading in reverse sort key order, and you need no index for sorting. The order of two notes created in the same millisecond is decided by the random part.

There's no authentication yet, so the owner is a fixed value shared by everyone. Chapter 06 replaces it with the signed-in user, but the shape of the key doesn't change.

<<< @/examples/05-dynamodb/src/notes.ts{service}

## Add a version to the contract

<!-- section: 05.contract -->

<<< @/examples/05-dynamodb/src/contract.ts{note}

A note now has a `version`. It is 1 at creation and increases by exactly 1 each time a save succeeds. When updating, the caller sends "the version I was looking at" as `expectedVersion`.

`expectedVersion` is required. If it could be omitted, an update that doesn't say what it was based on would go through, and you couldn't prevent overwrites.

The error codes gain `conflict`, which returns the note as it is stored now as `current`.

<<< @/examples/05-dynamodb/src/contract.ts{error}
