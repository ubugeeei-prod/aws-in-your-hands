---
title: "05 KV Store: Design and Build"
---

# 05 KV Store: Design and Build

The [previous page](/en/chapters/05-dynamodb.md) settled the table's keys and a contract with a `version`. This page replaces the store with DynamoDB and then implements, in order, concurrent updates, the limit on the number of notes, paging, and the handling of a response that never arrives.

## Replace the store

<!-- section: 05.repository -->

Chapter 04 made `NoteRepository` an interface, so most of the app doesn't know where notes are stored. This chapter revises the interface so that it also expresses the outcomes that can occur.

<<< @/examples/05-dynamodb/src/repository.ts{interface}

Someone else having saved first is not an exceptional accident. It happens in normal operation, so it is part of the return type and not a thrown exception. If the caller forgets to handle the `conflict` case, type checking fails.

There are two implementations.

`InMemoryNoteRepository` is for local development and tests. It needs neither Docker nor AWS, but it reproduces nothing about DynamoDB's behavior, and the notes are gone when the process restarts.

`DynamoDbNoteRepository` is the implementation used after deployment. Locally you can also point it at DynamoDB Local.

One set of contract tests runs against both implementations to confirm that they follow the same rules. The [Run It Locally](/en/chapters/05-dynamodb/local.md) page covers those tests.

The connection to DynamoDB is assembled here.

<<< @/examples/05-dynamodb/src/compose.ts{repository}

On Cloudflare Workers, D1 and KV appear on `env` as bindings. On AWS, you connect three separate things yourself. The table's name is passed as configuration, the SDK client is created in code, and the permission to use the table belongs to the execution role on AWS and to your own credentials locally.

## Prevent overwrites with conditional writes

<!-- section: 05.conditional -->

Suppose you open the same note in two tabs, edit it in both, and save from both.

```figure
caption: When two tabs save from the same version, the first save goes through and the second gets a 409.
type: sequence
actor a: tab A
actor store: stored note
actor b: tab B
note store: v1 "draft"
step a -> store: t1 GET
step store --> a: version 1
step b -> store: t1 GET
step store --> b: version 1
step a -> store: t2 PUT expectedVersion=1
step store --> a: 200
note store: v2 "from A"
step b -> store: t3 PUT expectedVersion=1
step store --x b: 409
note store: v2 "from A"
note b: t4 shows A's text next to its own
```

If tab B's save went through at t3, tab A's change would disappear without anyone knowing. Optimistic locking prevents this. You don't take a lock in advance. At the moment of writing, you check whether the stored note is still the version you were looking at.

If app code reads the note, compares the `version`, and writes when it matches, those are two requests, and another write can get in between them. The comparison and the write have to run inside the database as one operation. In DynamoDB, a condition expression does that.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{update}

The optimistic locking is the single line `ConditionExpression: "version = :expected"`. DynamoDB evaluates the condition and performs the update as one operation, so two writes that carry the same `version` can't both go through. When the condition doesn't hold, DynamoDB returns `ConditionalCheckFailedException`.

The read that follows is a separate operation from the update. It finds out whether the condition failed because the note doesn't exist or because the `version` has moved on, and it gets the current content to hand to the caller. The note can change once more between the original update and this read. So `current` is the content from close to the time the 409 was returned, and it isn't necessarily still correct.

Creation uses the same mechanism.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{create}

`PutItem` silently replaces an item that has the same key. With `attribute_not_exists(pk)`, it fails when the key is already in use. The few lines at the top that reserve a place are explained in "Put a limit on the count" below.

The app returns `conflict` as an HTTP 409.

<<< @/examples/05-dynamodb/src/app.ts{update}

The invariant kept here, in one sentence, is this.

**Each time a save succeeds, the version increases by exactly 1, and an update based on an old version is rejected.**

### Put a limit on the count

Anyone can `POST` to this API, so if nothing is done the table grows by whatever it is handed. One owner therefore gets at most 100 notes.

Counting the notes and writing when there are fewer than 100 has the same problem as the update did. Another create can get in between the counting and the writing, so when two creates arrive together, both count 99 and both write.

The count is kept in an item of its own instead.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{quota}

Each owner gets one item whose `sk` is `QUOTA`, and that item holds the count. A create first reserves a place with a conditional write to that item, which adds 1 if the count is under 100. Evaluating the condition and adding are one operation, so two callers can't both take the last place. With a place reserved, the note is written. Without one, the repository returns `quota_exceeded` and the app turns it into a 409.

Reserving the place and writing the note are two separate requests. If the function stops between them, the place stays reserved with no note, and the count remains 1 higher than the real number. The opposite error doesn't happen. So this limit guarantees that there are never more than 100 notes, and it doesn't promise that exactly 100 will fit. If the count is off, fewer notes fit, never more. Deletes follow the same order: the note is deleted first, and then the place is given back.

DynamoDB also has transactions, which write two items in one go. This chapter doesn't use them.

`composeApp` decides the limit. A repository built without a limit doesn't count notes.

## Choose the read consistency

<!-- section: 05.consistency -->

DynamoDB has two kinds of reads.

| | Eventually consistent | Strongly consistent |
| --- | --- | --- |
| Is the write just before it visible? | Sometimes not. It is visible if you wait a little and read again | Every successful write is reflected |
| Price | Half of strongly consistent | 1 read request unit for one item of up to 4 KB |
| Default | This one | Specify `ConsistentRead: true` |

According to the official documentation, a write is durable by the time it returns a successful response. When an eventually consistent read doesn't see the write just before it, the write hasn't been lost. It hasn't yet reached the place the read went to.

This chapter chooses the consistency per operation.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{get}

Reading one note is strongly consistent. If you reread a note right after saving it and get the content from before the save, the save looks as if it failed.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{list}

The list stays eventually consistent, because it costs half as much and a list that is stale for a moment does no harm. In exchange, a note created a moment ago can be missing from the next list. When chapter 06 builds the screen, it can hide that gap from the user by adding the note from the creation response to the list it displays.

Choosing per operation works because conditional writes don't depend on read consistency. If you send an update after looking at a stale list, DynamoDB still evaluates the `version` condition against the latest value. A stale read can cause more 409s, but it can't cause an overwrite.

Strongly consistent reads are available only on the table itself and on local secondary indexes, not on global secondary indexes. This chapter doesn't use an index.

## Page through without dropping items

<!-- section: 05.pagination -->

A single `Query` returns at most 1 MB of results. Anything beyond that isn't returned, and it isn't an error either. This API also caps the number of items per page with `Limit`. Whichever of the two stops a query early, DynamoDB gives the same signal. If you ignore that signal and return the list as though you had everything, then one day, after the notes have grown, older notes stop being shown, with no error.

When there may be more, DynamoDB adds `LastEvaluatedKey` to the response. Pass that value as `ExclusiveStartKey` to the next `Query` and the query continues from where the last one stopped. This API hands the value to the caller as a cursor.

<<< @/examples/05-dynamodb/src/contract.ts{list}

<<< @/examples/05-dynamodb/src/app.ts{list}

A page holds at most 20 notes, and a larger `limit` is refused with a 400. A list carries only the five fields of `noteSummarySchema` and leaves the body out. As in chapter 04, this keeps a single response under 20 KiB. When you need the body, you fetch it with `GET /notes/:id`. `version` is in the summary so that a client can tell whether a note has changed since it fetched the list.

The body is dropped in `app.ts`, where the response is assembled. The repository still reads each item with its body, so the list reads as much from DynamoDB as it did when it returned bodies.

The cursor goes out to the caller and comes back with the next request. A cursor that comes back is an untrusted value like any other input. The API doesn't pass it to DynamoDB as it is. It decodes the cursor and checks its shape.

<<< @/examples/05-dynamodb/src/repository.ts{cursor}

As the official documentation also warns, the presence of `LastEvaluatedKey` doesn't mean there are more items. It is also present when the results end exactly at a page boundary. In that case the next page is empty and its cursor is `null`. So the caller stops when `nextCursor` is `null`. It must not treat a page with fewer items than `limit` as the end of the list.

## When the response never arrives

<!-- section: 05.lost-response -->

A write over a network has a third outcome besides success and failure: you don't know which it was.

```figure
caption: Retrying a save whose response was lost returns a 409 caused by the client's own first write.
type: sequence
actor client: client
actor server: server
step client -> server: t1 PUT expectedVersion=1
step server -> server: applies the update
note server: v2 "final"
step server --x client: t2 200 OK (response is lost; timeout)
step client -> client: t3 saved or not is unknown. retry
step client -> server: t3 PUT expectedVersion=1
step server -> server: version is 2, not 1
note server: v2 "final"
step server --> client: t4 409 conflict, current = v2 "final"
```

At t2, the caller doesn't know whether the save went through. If it doesn't retry, the change is lost in the case where it wasn't saved, so it retries. At t4 a 409 comes back. The cause is not someone else's write but **its own first write**.

Optimistic locking does two things here. First, the retry was not applied twice. The `version` is still 2 and has not become 3. Second, the 409 carries `current`, so the caller can work out what happened.

<<< @/examples/05-dynamodb/src/client.ts{outcome}

If the stored note is exactly one `version` ahead and has the content that was sent, the write you wanted has been done. The typed client returns this case as a success.

<<< @/examples/05-dynamodb/src/client.ts{update}

This judgment has a limit. It can't tell this case apart from one where someone else saved exactly the same content at the same `version`. Even then, the stored content is what you wanted, so treating it as a success does no harm. In the opposite case, where your write went through and someone else saved again before your retry, the client returns a conflict. Your save did happen once, but what is stored now is someone else's content, so showing that content is the safe outcome.

Creation doesn't have this protection. `POST /notes` has nothing with which to tell a retry from the creation of a new note, so losing a response and retrying produces two notes with the same content. A test records this behavior as the specification. Fixing it requires the caller to send a value that shows the two requests are the same one. This book doesn't take the fix that far (the idea is the same one [chapter 08](/en/chapters/08-async.md) uses to make its worker idempotent).
