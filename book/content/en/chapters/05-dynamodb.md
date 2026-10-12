---
title: "05 KV Store: DynamoDB"
sourceRevision: 4
---

# 05 KV Store: DynamoDB

The chapter 04 API kept its notes in memory, so the answer changed with the execution environment that replied, and after a while the notes were gone. This chapter saves the notes in a DynamoDB table, so a read from any execution environment returns the same answer.

Saving data brings problems you can't avoid. When two people edit the same note at the same time, the later save must not silently overwrite the earlier one. A save that is retried because its response never arrived must not be applied twice. The list has to page through every note without dropping any as the number grows. And the function gets permission for five operations on this one table and nothing else.

This chapter builds on [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/05-dynamodb/`. It carries the chapter 04 API over and extends it, and the directory runs on its own.

There is still no authentication. Anyone who knows the URL can read, write, and delete notes ([chapter 06](/en/chapters/06-auth.md) adds authentication). Volume is limited: the API accepts at most 10 requests a second, holds at most 100 notes, and returns at most 20 summaries in a page of the list. Don't put in data you would mind other people seeing or deleting.

If you want to work with your data in SQL, you can skip this chapter and go on to [chapter 13](/en/chapters/13-sql.md). "When DynamoDB doesn't fit", on the [Costs, Pitfalls, and Cleanup](/en/chapters/05-dynamodb/wrap.md) page, gives some guidance for deciding.

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

The difference from chapter 04 is the DynamoDB table, highlighted in the figure. The table now owns the notes, where each execution environment owned its own before. However many execution environments there are, and whenever one is discarded, the notes are not lost.

### Why DynamoDB

DynamoDB is a database in which you read and write items by key. This chapter chooses it for three reasons.

- You have no connections to manage. You call an HTTPS API, so a growing number of Lambda execution environments doesn't make you think about connection limits or pools
- You have no network to design. The table doesn't have to sit inside a VPC, so you add one table to the chapter 04 architecture
- While nobody uses it, you pay only for what is stored. An on-demand table has a request charge of 0 when there are no requests

In exchange, you have to **decide first how you will read**. You can't filter freely by a condition you think of later, the way you can in SQL. The [Costs, Pitfalls, and Cleanup](/en/chapters/05-dynamodb/wrap.md) page covers the cases where that constraint doesn't fit.

## Derive the keys from how you read

<!-- section: 05.model -->

You design a DynamoDB table from how you read and write, not from what data you have. This API reads and writes in two ways.

1. List one owner's notes, newest first
2. Given an owner and a note ID, read, update, or delete that one note

A DynamoDB item is identified by the pair of its partition key and its sort key. Items with the same partition key are stored together and ordered by sort key within that group. The two access patterns map onto this property.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{keys}

With the owner as the partition key, a single `Query` reads all of one owner's notes. With the note ID as the sort key, an exact match on the key reads one note.

That leaves "newest first". The creation time goes at the front of the ID, so that sort key order is creation order.

<<< @/examples/05-dynamodb/src/id.ts{id}

With IDs in this form, listing means reading in reverse sort key order, and no index is needed for sorting. The random part of the ID decides the order of two notes created in the same millisecond.

There is no authentication yet, so the owner is a fixed value shared by everyone. Chapter 06 replaces it with the signed-in user, and the shape of the key stays the same.

<<< @/examples/05-dynamodb/src/notes.ts{service}

## Add a version to the contract

<!-- section: 05.contract -->

<<< @/examples/05-dynamodb/src/contract.ts{note}

A note now has a `version`. It is 1 at creation and increases by exactly 1 each time a save succeeds. To update a note, the caller sends the `version` it was looking at as `expectedVersion`.

`expectedVersion` is required. If it could be omitted, an update that doesn't say which version it was based on would go through, and overwrites could no longer be prevented.

The error codes gain `conflict`. This error returns the note as it is stored now, as `current`.

<<< @/examples/05-dynamodb/src/contract.ts{error}
