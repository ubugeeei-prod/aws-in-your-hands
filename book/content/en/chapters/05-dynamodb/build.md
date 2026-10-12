---
title: "05 KV Store: Design and Build"
---

# 05 KV Store: Design and Build

## Swap the storage

<!-- section: 05.repository -->

Because chapter 04 made `NoteRepository` an interface, most of the app doesn't know where notes are stored. In this chapter you revise that interface so that it also expresses the outcomes that can occur.

<<< @/examples/05-dynamodb/src/repository.ts{interface}

"Someone saved first" isn't an exceptional accident. It's an outcome that happens in normal operation. So it isn't thrown as an exception; it's part of the return type. If the caller forgets to handle the `conflict` case, type checking fails.

There are two implementations.

`InMemoryNoteRepository` is for local development and tests. It needs neither Docker nor AWS. In exchange, it reproduces nothing about DynamoDB, and the data is gone when the process restarts.

`DynamoDbNoteRepository` is the real thing, used after deployment. Locally you can also point it at DynamoDB Local.

That the two follow the same rules is checked by running one set of contract tests against both. More on that in the tests section.

Here's where the connection to DynamoDB is assembled.

<<< @/examples/05-dynamodb/src/compose.ts{repository}

On Cloudflare Workers, D1 and KV appear on `env` as bindings. On AWS, you connect three separate things yourself: the table's name (configuration), the SDK client (code), and the permission to use the table (the execution role on AWS, your own credentials locally).

## Prevent overwrites: conditional writes

<!-- section: 05.conditional -->

You open the same note in two tabs, edit it in both, and save from both. What happens?

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

If B's save were let through at t3, A's change would disappear without anyone knowing. What prevents this is optimistic locking. Rather than taking a lock in advance, you check at the moment of writing whether the stored version is still the one you were looking at.

Here's the catch. If app code does "read, compare the version, and write if it's the same" as two separate steps, another write can get in between them. The comparison and the write have to happen inside the database as one operation. In DynamoDB, a condition expression is what does that.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{update}

The single line `ConditionExpression: "version = :expected"` is all there is to the optimistic locking. DynamoDB evaluates the condition and performs the update as one operation, so two writes that carry the same version cannot both go through. When the condition doesn't hold, DynamoDB returns `ConditionalCheckFailedException`.

The read that follows is a separate operation. It's there to find out why the condition failed (the note doesn't exist, or the version has moved on) and to hand the current content to the caller. The note can change once more between this read and the original update. So `current` is "the content close to the time the 409 was returned"; it is not necessarily "the content that is still correct now".

Creation uses the same mechanism.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{create}

`PutItem` silently replaces an item that has the same key. With `attribute_not_exists(pk)`, it fails when the key is already in use. The few lines at the top that "take a place" are for the end of this section.

The app returns `conflict` as an HTTP 409.

<<< @/examples/05-dynamodb/src/app.ts{update}

Written as one sentence, the invariant being kept is this.

**Each time a save succeeds, the version increases by exactly 1, and an update based on an old version is rejected.**

### Put a limit on the count

Anyone can `POST` to this API. Left alone, the table grows by whatever it's handed. So one owner gets at most 100 notes.

"Count how many there are, and write if it's under 100" is the same trap as before. Another create can slip in between the counting and the writing. If two arrive together, both count 99 and both write.

So the count lives in an item of its own.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{quota}

Each owner gets one item whose `sk` is `QUOTA`, and the count goes in there. A create first writes to that item, conditionally: "add 1 if it's under 100". Evaluating the condition and adding are one operation, so two callers can't both take the last place. With a place taken, the note is written. Without one, the repository returns `quota_exceeded` and the app turns it into a 409.

Here's the catch: taking the place and writing the note are two separate requests. If the function stops between them, the place stays taken and there is no note. The count is then 1 higher than the truth. The opposite doesn't happen. So what this limit keeps is "never more than 100"; it doesn't promise that exactly 100 will fit. If it's off, it's off only toward fewer. Deletes go in the same order: delete the note, then give the place back.

DynamoDB also has a transaction feature that writes two items in one go. This chapter doesn't use it.

The limit is chosen in `composeApp`. A repository built without one doesn't count notes at all.

## Choose the read consistency

<!-- section: 05.consistency -->

DynamoDB has two kinds of reads.

| | Eventually consistent | Strongly consistent |
| --- | --- | --- |
| Is the write just before it visible? | Sometimes not. It is visible if you wait a little and read again | Every successful write is reflected |
| Price | Half of strongly consistent | 1 read request unit for one item of up to 4 KB |
| Default | This one | Specify `ConsistentRead: true` |

According to the official documentation, a write is durable at the point where it returns a successful response. When an eventually consistent read doesn't see it, that isn't because it was lost. It hasn't yet reached the place the read went to.

This chapter chooses per operation.

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{get}

Reading one note is strongly consistent. If you reread the same note right after saving it and get the content from before the save, you'd think "wait, did the save fail?"

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{list}

The list stays eventually consistent. It costs half as much, and a list that is stale for a moment does no harm. In exchange, a note that was created a moment ago can be missing from the next list. When you build the screen (chapter 06), you can keep this gap from the user by adding the note received in the creation response to the list you display.

This choice holds because conditional writes don't depend on read consistency. Even if you send an update after looking at a stale list, the `version` condition is evaluated inside DynamoDB against the latest value. A stale read can cause more 409s, but it cannot cause an overwrite.

By the way, strongly consistent reads are available only on the table itself and on local secondary indexes, not on global secondary indexes. This chapter doesn't use an index.

## Page through without dropping items

<!-- section: 05.pagination -->

A single `Query` returns at most 1 MB of results. Anything beyond that is not returned. And it isn't an error either. On top of that, this API also caps the number of items per page with `Limit`. Whichever of the two stops a query early, the signal DynamoDB gives is the same. If you return the list on the assumption that you got everything, then one day, after the notes have grown, older notes silently stop being shown. Not a fun bug.

When there may be more, DynamoDB adds `LastEvaluatedKey` to the response. Pass it as `ExclusiveStartKey` to the next `Query` and you continue from where the last one stopped. This API hands it to the caller as a cursor.

<<< @/examples/05-dynamodb/src/contract.ts{list}

<<< @/examples/05-dynamodb/src/app.ts{list}

The cursor goes out to the caller and comes back. By the time it comes back, it's an untrusted value like any other input. It isn't passed to DynamoDB as it is; it's decoded and its shape is checked.

<<< @/examples/05-dynamodb/src/repository.ts{cursor}

The official documentation warns about this too: the presence of `LastEvaluatedKey` does not mean "there are more items". It is also present when the results end exactly at a page boundary. In that case the next page is empty and the cursor is `null`. So the caller's condition for stopping is "until `nextCursor` is `null`". Getting fewer items than `limit` must not be taken as the signal that the list has ended.

## When the response never arrives

<!-- section: 05.lost-response -->

A write over a network has a third outcome besides success and failure: "unknown".

```figure
caption: Retrying a save whose response was lost returns a 409 caused by the client's own first write.
type: sequence
actor client: client
actor server: server
step client -> server: t1 PUT expectedVersion=1
step server -> server: applies the update
note server: v2 "final"
step server --x client: t2 200 OK (response is lost; timeout)
step client -> client: t3 was it saved? unknown. retry
step client -> server: t3 PUT expectedVersion=1
step server -> server: version is 2, not 1
note server: v2 "final"
step server --> client: t4 409 conflict, current = v2 "final"
```

At t2, the caller doesn't know whether the save went through. If it doesn't retry, the change is lost in the case where it wasn't saved. So it retries, and at t4 a 409 comes back. The cause is not someone else's write but **its own first write**.

Optimistic locking does two things here. One is that the retry was not applied twice. The version is still 2; it has not become 3. The other is that the 409 carries `current`, so the caller can work out what happened.

<<< @/examples/05-dynamodb/src/client.ts{outcome}

If the stored note is exactly one version ahead and has the content that was sent, the write you wanted has been done. The typed client returns this case as a success.

<<< @/examples/05-dynamodb/src/client.ts{update}

This decision has a limit. It can't tell this case apart from one where someone else saved exactly the same content at the same version. Even then, the stored content is what you wanted, so treating it as a success does no harm. In the opposite case, where your write went through and someone else saved again before your retry, the client returns a conflict. Your save did happen once, but what is stored now is someone else's content, so showing that is the safe outcome.

Creation, by the way, doesn't have this protection. `POST /notes` has nothing with which to tell a retry from the creation of a new note, so losing a response and retrying produces two notes with the same content. A test records this behavior as the specification. Fixing it requires the caller to send a value that shows "this is the same request". This book doesn't take the fix that far (the idea is the same one [chapter 08](/en/chapters/08-async.md) uses to make its worker idempotent).
