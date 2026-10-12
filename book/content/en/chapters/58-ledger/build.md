---
title: "58 Ledger: Design and Build"
---

# 58 Ledger: Design and Build

The [previous page](/en/chapters/58-ledger.md) settled the approach: chain the entries by hash, and keep the last hash where it cannot be deleted. This page implements it in order: the shape of an entry, appending, the writer's permissions, digests, and verification.

## Entries and hashes

<!-- section: 58.journal -->

An entry has the ledger's name, a sequence number, a time, an event, the hash of the previous entry, and its own hash. The event is stored as a string, and the ledger never interprets it.

<<< @/examples/58-ledger/src/entry.ts{entry}

The hash is computed from the five values other than the hash itself.

<<< @/examples/58-ledger/src/entry.ts{seal}

The text that goes into the hash has to come out the same whoever builds it, and whenever. Turn an object into JSON and the text depends on the order of its keys. An array of values in a fixed order has exactly one JSON text. JSON also takes care of the boundaries between values, so nobody can move the end of one value into the start of the next and arrive at the same text.

The ledger's name and the sequence number are part of the hash. Without them, an entry could be moved to another ledger or another position and its hash would still match.

Once chosen, this form cannot change. Change it and every hash already written stops matching. `test/entry.test.ts` pins the hash of one fixed entry. I computed the same value separately with `shasum -a 256`.

In the table, the ledger is the partition and the sequence number is the sort key.

<<< @/examples/58-ledger/src/entry.ts{keys}

The number is padded with zeros to twelve digits so that the sort keys, compared as strings, are in the order of the numbers.

A row read from the table is treated as outside data, because someone may have rewritten it. A row of the wrong shape, or one whose key says one number and whose content says another, is not read as an entry.

<<< @/examples/58-ledger/src/entry.ts{row}

The place the entries are kept needs only three operations.

<<< @/examples/58-ledger/src/journal.ts{journal}

`insert` writes only when the number is free, and changes nothing when it is taken. The interface has no update and no delete. The reading side returns rows without interpreting them, because deciding whether a row is a readable entry is verification's job.

The first implementation sits on chapter 30's table interface. It runs on the in-memory model and on DynamoDB alike.

<<< @/examples/58-ledger/src/journal.ts{table-journal}

The tail is read as one item in descending order of the sort key. It is read with strong consistency, because missing the entry that was just written means trying to use its number again.

## Guard the number with a conditional write

<!-- section: 58.append -->

Appending reads the tail, builds the entry with the next number, and writes it if that number is free.

<<< @/examples/58-ledger/src/ledger.ts{append}

When two writers read the same tail at the same moment, both build an entry with the same number. The one that writes first gets through. The other receives `exists` and reads the tail again. As with the version condition in chapter 05, DynamoDB evaluates the condition inside itself, together with the write. No number is used twice, and none is skipped.

```figure
caption: Of two writers that read the same tail, the one that writes second is refused, reads the tail again, and writes with the next number.
type: sequence
actor a: Writer A
actor t: DynamoDB table
actor b: Writer B
step a -> t: read the tail: number 1
step b -> t: read the tail: number 1
step b -> t: INSERT number 2: ok
step a -x t: INSERT number 2: already there
step a -> t: read the tail: number 2
step a -> t: INSERT number 3: ok
```

There is one more thing to check after a refusal: the write may have arrived, with only its answer lost. The SDK retries on its own, so its second attempt runs into the entry its first attempt wrote, and is refused. So the code reads the hash of the entry at that number, and if it equals the one it was trying to write, it returns success. The hash covers the time and the previous hash, so it cannot equal another writer's entry.

That check protects one call of `append` only. If the caller calls `append` again, the same event is there twice, and the ledger correctly records that it was written twice. To avoid duplicates, put something in the event that identifies it, such as the note's ID and version. It is the idempotency of chapter 08 again.

`test/ledger.test.ts` reproduces both orders deterministically: one test slips another append in between reading the tail and writing, and one throws away the answer after the write.

Appends to one ledger go in single file. With more concurrent writers there are more refusals and retries, and five losses in a row end in `BusyError`. One ledger is one partition, so it also meets DynamoDB's limit for a partition (chapter 30). If you write a lot, split into several ledgers, one per owner for example. Digests are then taken per ledger.

When the tail row cannot be read as an entry, nothing is appended. Chaining new entries behind a damaged row would bury the damage deeper in the history.

## Give the writer no permission to overwrite

<!-- section: 58.writer -->

A conditional `PutItem` guards the number. As an IAM permission, though, it is not enough. A role with `dynamodb:PutItem` can also call `PutItem` with no condition, and that silently replaces an existing item. Among DynamoDB's condition keys in the IAM service reference, none looks at a request's condition expression. A policy that says "only conditional `PutItem`" cannot be written.

DynamoDB has another way to write. PartiQL's `INSERT` fails with `DuplicateItemException` when an item with the same key exists. It cannot replace. And PartiQL statements are separate IAM actions by kind: `INSERT` is `dynamodb:PartiQLInsert`, `UPDATE` is `dynamodb:PartiQLUpdate`, and `DELETE` is `dynamodb:PartiQLDelete`.

So the implementation that runs on AWS uses PartiQL for the write, and only for the write.

<<< @/examples/58-ledger/src/dynamodb-journal.ts{insert}

Every value travels as a parameter. Only the table's name is part of the statement, and `src/env.ts` fixes the characters a name may contain.

<<< @/examples/58-ledger/src/dynamodb-journal.ts{journal}

Reads go through `Query` in chapter 30's `DynamoDbTable`, unchanged. The policy handed to the writer has just these two actions.

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{writer}

A role with this policy can add entries and can neither replace nor delete one. A bug in the app, or the app's credentials leaking, does not let that role change a past entry.

This part is put together from what the official documentation says. On DynamoDB Local I confirmed that a second `INSERT` of the same key is refused. DynamoDB Local checks no permissions, so whether this policy lets an append through and stops an overwrite has to be confirmed on AWS, and has not been yet. DynamoDB Local 3.3.1 answered that failure with the name `DuplicateItem`. That differs from the name in the API reference, so the code accepts both.

## Put digests in a bucket with Object Lock

<!-- section: 58.digest -->

A digest is four things: the ledger's name, the last sequence number, its hash, and the time it was taken. The number is part of the object's key.

<<< @/examples/58-ledger/src/digest.ts{digest}

It goes into an S3 bucket with versioning and Object Lock enabled. Here is what Object Lock protects and what it does not, following the user guide.

- A lock protects one version of an object. Until its retention period is over, that version cannot be deleted
- A new `PutObject` to the same key is not stopped. It puts a new version on top, and the locked version stays underneath
- A delete without a version ID is not stopped either. It puts a delete marker on top, and the content stays
- Only a delete with a version ID removes data. While the version is locked, that request is refused with 403

So reading the newest version with a plain `GetObject` makes the lock pointless. If someone puts other content on top, that is what you read. Verification has to read every version.

There are two retention modes. In governance mode, someone with the `s3:BypassGovernanceRetention` permission can delete a locked version with a request carrying a header for it. In compliance mode nobody can, the root user included, and neither can the mode be changed nor the period shortened. The only way to delete before the date is to close the AWS account. Object Lock can be enabled on a new bucket or an existing one, but once it is enabled it cannot be disabled, and versioning cannot be suspended.

The place digests are kept needs three operations.

<<< @/examples/58-ledger/src/digest.ts{store}

The write to S3 is a `PutObject` with `If-None-Match: *`. When the key has a current object, it is refused with 412.

<<< @/examples/58-ledger/src/s3-digests.ts{put}

The request names no retention period. The bucket's default applies. That leaves the function's code no room to choose a shorter one.

The conditional write is a way not to write the same digest twice. It is not the protection. According to the user guide, in a bucket with versioning the condition looks at the current version only, and with a delete marker on top the write goes through. The protection is the listing.

<<< @/examples/58-ledger/src/s3-digests.ts{list}

`ListObjectVersions` returns every version and every delete marker. Verification examines every one of them.

Taking a digest reads only what came after the previous digest.

<<< @/examples/58-ledger/src/digest.ts{take-digest}

It starts reading at the entry the previous digest names and checks the chain from there to the tail. It also checks that the hash of that first entry matches the locked digest. If either fails, no new digest is written: locking the tail of a ledger that no longer matches would give the damage a stamp of approval.

This looks only at what follows the previous digest. If a single older entry has been rewritten, it does not notice.

<<< @/examples/58-ledger/test/digest.test.ts{incremental}

The verification that reads everything runs separately. Reading everything every hour would cost more the longer the ledger grows, so the two jobs are split.

The function calls this and writes the result to its log, nothing more.

<<< @/examples/58-ledger/src/digest-lambda.ts{handler}

On a refusal it throws, so the invocation fails. An alarm on the function's `Errors` metric then tells a person that the ledger stopped matching (chapter 19). The alarm is not part of this chapter's stack.

The tests replace S3 with an in-memory model that follows the rules above.

<<< @/examples/58-ledger/src/memory-digests.ts{put}

<<< @/examples/58-ledger/src/memory-digests.ts{delete}

The model was written from the user guide, not fitted to observed S3 behavior. It has no legal holds, no event holds, no lifecycle, and no IAM.

## Verification

<!-- section: 58.verify -->

Verification reports eight kinds of finding.

<<< @/examples/58-ledger/src/verify.ts{findings}

The first four come from the entries in the table alone.

<<< @/examples/58-ledger/src/verify.ts{chain}

For each entry it checks that the number follows on, that the hash recomputed from the content equals the stored hash, and that the previous hash equals the hash of the entry before. It does not stop at the first problem. It reads to the end and returns everything it found.

The other four come from comparing with the digests.

<<< @/examples/58-ledger/src/verify.ts{digests}

It looks at each version of each digest. A delete marker is reported as the trace of someone trying to hide a digest. A digest whose number is past the tail means the end was cut off. A digest whose hash differs from the entry at that number means the history was rewritten.

The full audit reads the ledger from the beginning, reads every digest, and calls those two.

<<< @/examples/58-ledger/src/audit.ts{audit}

`uncovered` is the number of entries after the newest digest. Even when verification finds nothing, that part cannot be called protected.

The tests that try to break the invariant are in `test/verify.test.ts`. They reproduce, one at a time, a change of content, a change with the hash fixed up, a removal from the middle, a swap, a removal of the first entry, a cut-off end, and a row replaced by something that is not an entry. The central one is this.

<<< @/examples/58-ledger/test/verify.test.ts{rewrite}

It rewrites the second entry and recomputes every hash from there to the end. Nothing in the table contradicts anything else. Only the locked digest finds it.

The cases that cannot be found are tests too.

<<< @/examples/58-ledger/test/verify.test.ts{window}

Whatever follows the newest digest passes verification whether it is cut off or rewritten consistently. Once the next digest is locked, that range is protected as well.

The limit of governance mode is checked the same way.

<<< @/examples/58-ledger/test/verify.test.ts{governance}

If someone who can lift the lock deletes the digest and writes it again, the rewrite is no longer found. With governance mode, whoever holds `s3:BypassGovernanceRetention` is exactly the set of people you trust.

## What goes into an entry

<!-- section: 58.events -->

The ledger does not interpret the event, but the app fixes its shape. The notes app records these events.

<<< @/examples/58-ledger/src/events.ts{event}

The note's body is left out, and only a hash of it goes in. An entry cannot be deleted. If a user asks for their data to be erased and the body sits somewhere it cannot be deleted, you cannot comply. With the hash you can still check whether the body at some moment was the same as a copy you hold. The schema refuses fields it does not know, so if someone later tries to add the body, a test fails.

The ledger, the digests, and verification are all in place. [Run It Locally](/en/chapters/58-ledger/local.md) causes a rewrite for real and shows what verification returns.
