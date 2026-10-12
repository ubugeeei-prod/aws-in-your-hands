---
title: "22 Backup: Design and Build"
---

# 22 Backup: Design and Build

## Images come back from versions

<!-- section: 22.versioning -->

For the bucket, we don't use a single "take it all back to this minute" operation. We use versioning.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{bucket}

In a bucket with versioning, two things change. Writing to an existing key does not overwrite: a new version is stacked on top. And deleting without naming a version does not delete: a delete marker is placed as the newest version instead. A plain read answers 404, but the bytes are still underneath.

How you bring a key back depends on what happened to it.

- **A deleted key.** Delete the delete marker, naming its version ID. The version below is on top again
- **An overwritten key.** Copy the old version onto the same key. The copy is stacked as a new version and becomes the top

There is another way to undo an overwrite: delete the newer version. This chapter doesn't. That cannot be taken back, and if the newer one turns out to have been right, it is gone. A copy loses nothing.

Be careful how you delete a delete marker. Try it without a version ID and S3 does not remove the marker: it stacks one more. A delete that restores always names a version ID.

### Deciding which key, and how

The plan that moves a whole bucket toward "the state at a moment" is made key by key. This, too, is a function that doesn't call AWS.

<<< @/examples/22-recovery/src/object-restore.ts{plan}

A key created after the chosen moment is not deleted. It is named and left alone. Deleting data in the name of a restore is a second accident.

The side that acts is short.

<<< @/examples/22-recovery/src/object-restore.ts{apply}

The plan is made from a fresh listing every time. If a run stops halfway, running it again finds the finished steps no longer in the plan. A key restored by a copy shows the same ETag on its top version as the version you wanted, which is how "already done" is recognized. The ETags match for this bucket's encryption (keys managed by S3) and for uploads that are not multipart. In a bucket where that isn't so, this test cannot be used.

Reading the list of versions from S3 has one quirk.

<<< @/examples/22-recovery/src/s3-versioned-bucket.ts{list-versions}

`ListObjectVersions` returns versions with bytes and delete markers as two separate lists. Their order relative to each other can only be rebuilt from the times. If two entries of one key share a time, the one S3 calls the latest goes on top. Whether the real service always yields the right order this way was not checked.

### Versioning changes what other chapters assumed

Chapter 07's "going to production" list mentioned in passing that versioning changes how lifecycle rules behave. Concretely:

Chapter 07's bucket has a rule that removes unfinished uploads after a day. With versioning on, that rule does not remove the object: it places a delete marker, and the bytes live on as an old version. What really deletes them is `noncurrentVersionExpiration` in this chapter's rule, 30 days after they stopped being current. Those 30 days are how long an image can be brought back. Without that line, every byte ever uploaded is stored, and billed, forever.

Chapter 08's worker is affected too. In a bucket with versioning, an ordinary delete becomes the event `ObjectRemoved:DeleteMarkerCreated`. Chapter 08's stack subscribes to `ObjectRemoved:Delete`, so deletes would no longer reach the worker. Turning versioning on for the bucket of chapters 07 and 08 means fixing that as well. It is why this chapter's stack is a separate one, not an addition to chapter 08's.

## Two stores return to two different times

<!-- section: 22.skew -->

Now for the main subject.

```figure
caption: Restoring only the table to T1 and leaving the bucket at "now" leaves a record that points at nothing
type: sequence
actor table: table
actor bucket: bucket
note table: T0: record A written
note bucket: T0: object A written
note table: T1: the restore point
note table: T2: record A deleted
note bucket: T2: delete marker on A
step table -> table: now: restore the table to T1
note bucket: now: left as it is
note table: "A has an image"
note bucket: "A was deleted"
step table -x bucket: a record that points at nothing
```

```figure
caption: If an upload finished at T2 instead, restoring the table to T1 leaves an object nobody points at
type: sequence
actor table: table
actor bucket: bucket
note table: T1: the restore point
note bucket: T2: an upload finishes
step table -> table: now: restore the table to T1
note table: says nothing about it
note bucket: "here are the bytes"
step bucket -x table: an object nobody points at
```

The table can go back to any second you like. The bucket goes back by choosing a version again for each key. AWS has no mechanism that lines the two up at "the same instant". Lining them up is your job, and it usually ends a little off. Restoring only the table and forgetting the bucket is common, too.

What breaks when they are off? The promises that chapters 07 and 08 kept by being careful about order. Chapter 07 decided that "a record must never outlive its object" and reversed the order of creating and deleting to make it so. Take only the table back in time, and all that care about order buys nothing.

One thing does work in our favor. Notes, attachment records, and inspection records live in the same table, so those three go back to the same moment. The only disagreement is between the table and the bucket. Chapter 05's choice of a single table pays off here.

### What counts as a promise

The check reads the table and the bucket and counts whatever matches one of these.

<<< @/examples/22-recovery/src/invariants.ts{findings}

They fall into two groups. `broken` means something the app relies on is not true: an attachment with no image, an inspection verdict about other bytes. `leftover` is garbage nobody points at, which cleanup is supposed to pick up. Only `broken` is a reason to hold a cutover.

The check itself is a function of what was read, and nothing else.

<<< @/examples/22-recovery/src/invariants.ts{check}

`graceMs` is the allowance for chapter 07's "uploads waiting to be finished". On a running service, an object that just arrived having no record is normal, so young objects are not counted. When you check with writes stopped, nothing is waiting, and the allowance can be 0. On the tasks, that is `--frozen`.

There is one rule on the reading side as well.

<<< @/examples/22-recovery/src/items.ts{classify}

To the app, a restored table is data from outside. It may hold items in the shape of six months ago. So every item goes through a schema before it is believed. An item that cannot be read is not an exception: it is reported as `unreadable_item`. If one unreadable item stopped the whole check, you would learn nothing about the rest.

The key formats (`NOTE#...`, `ATTACHMENT#...`, `INSPECTION#...`) are private to the files of chapters 05, 07, and 08. This chapter writes the same formats down again and pins, in a test, that it can read the items those three repositories really write. If any chapter changes its keys, that test fails.

### What each kind of restore leaves behind

| What happened | What is found |
| --- | --- |
| The table and the bucket were restored to the same time | Nothing |
| Only the table was restored; an image was deleted after that time | `attachment_without_object`, `inspection_without_object` |
| Only the table was restored; an upload was finished after that time | `object_without_record` |
| Only the table was restored; an image was overwritten after that time | `inspection_for_other_bytes`, `attachment_size_mismatch` |
| Nothing was restored; right after the accident | Nothing |

The last row is obvious, and it matters. Cleanly deleted data is consistent. The check finds disagreement; it does not find mistakes. What notices the accident is a person, or some other monitoring, not this check.

## Repairing the disagreement

<!-- section: 22.repair -->

To repair, you have to decide which side is right. This chapter says: **the table is right, and the bucket follows.** The table can go back to any one second, so the judgment "the data as of this time is correct" can be expressed on the table's side.

<<< @/examples/22-recovery/src/repair.ts{repair}

One at a time.

**An attachment record with no image.** Look at the bucket's versions. If a version with bytes survives, remove the delete markers above it and the image is back. If none does, the record goes. The latter means data was lost. The report says `record_deleted`, and that goes into the drill record.

**An inspection record with no object.** The two paths chapter 08 listed as open gaps both end in this shape: a delete event never arrived, or was ignored because its order was unknown, and the record stayed. The check finds these with no restore involved. Before deleting, the repair looks at the object once more, because an earlier step of the same run may have brought the image back.

**An inspection verdict about other bytes.** Steps 1 to 3 of chapter 08's worker are done again, for the bytes that are there now.

### A repair has no event, so what about the sequencer?

Chapter 08's records were ordered by the sequencer that an S3 event carries. A repair has no event, and therefore no sequencer.

<<< @/examples/22-recovery/src/repair.ts{sequencer}

It uses the stale record's sequencer plus one. That beats the stale record, and nothing else: every later event for the same key carries a sequencer at least that large. A real event that arrives late either overwrites as usual, or is correctly ignored as a duplicate about the same bytes.

Deleting uses the same value. Passed to chapter 08's condition, "delete only a record older than this sequencer", it removes the record the check saw and leaves a newer one that a real event wrote in the meantime.

### Run any number of times, stopped anywhere

A repair is something a person in a hurry runs again after it failed. So the tests were written by breaking things. As in chapter 08, the clock and the order are fixed, and the place to stop is injected. Nothing waits on real time.

| What is injected | Result |
| --- | --- |
| Run as a dry run | Nothing changes. The reported steps are the ones the real run takes |
| Run the repair twice from the same findings | The second run has nothing to do anywhere. The state is the one after the first |
| Fail while removing the second delete marker | Stops with only the first image back. Checking and repairing again brings back all |
| Remove every version with bytes, then repair | The image does not come back. The record is deleted, and the report says so |
| Put a new upload and its event between the check and the repair | The new record is not deleted |
| Deliver a real event after the repair re-inspected | The real event's record stands |
| Fail the first copy of an object restore | Stops in between. Running it again reaches the original state |
| Run the object restore again after it succeeded | The plan is empty |

The code was also broken on purpose in six places (dropping the "already copied" test, deleting an inspection without looking at the object again, writing with the stale sequencer, deleting newer records too, not comparing ETags, stopping the version fence one short), and each time tests failed.

### What is left for a person

The repair keeps its hands off two things.

One is an object with no record. That belongs to chapter 07's cleanup. But there is a trap. Take the table back in time, and every upload finished since then becomes "an object with no record". Chapter 08's cleanup runs every hour and deletes recordless objects past their grace period. So: **restore the table, leave it for an hour or so, and the cleanup starts deleting the images whose records the restore lost.** The local tests reproduce this with chapter 07's cleanup code as it is. With versioning on, what it deletes can be brought back from the versions. Without, it cannot. Stop the cleanup schedule before you cut over.

The other is an image whose size does not match its record. Was it overwritten, or is the record the old one? The repair cannot decide. Restoring the bucket to the same time resolves it. If you can't, a person decides whether the attachment goes or stays.

## Version numbers that went backwards

<!-- section: 22.versions -->

Restoring the table opens a hole in chapter 05's promise as well. This one is not found by the check.

Chapter 05's optimistic lock compared version numbers. "I saw version 3. If it is still 3, save it as 4." Numbers only ever grow, so the same number means the same content. That was the premise.

A restore winds the numbers back.

1. A note is edited up to version 3. Someone's browser is still open, showing version 3
2. The table is restored to a time when it was version 1, and you cut over
3. Someone else edits the restored note twice. The version becomes 2, then 3
4. The browser that stayed open sends its save "from version 3"

Step 4 passes, because the numbers match. But this 3 is not that 3. The browser overwrites edits it never saw. A test reproduces exactly this order.

The fix is to move the restored table's numbers past whatever the old table handed out.

<<< @/examples/22-recovery/src/table-diff.ts{fence}

A note that was at version 3 in the old table is set to version 4 in the restored one. The old browser's "from 3" no longer passes. The write to DynamoDB is conditional.

<<< @/examples/22-recovery/src/dynamodb-table.ts{raise-version}

It only raises, never lowers. Running it twice, or after someone edited past the fence, breaks nothing.

To be honest, this closes only half the hole. A note that the accident **deleted** is not in the old table any more, so there is no telling how far its numbers had gone. Closing it properly means mixing "after which restore" into the version comparison. This chapter doesn't implement that.

### Counting what the cutover costs, first

The fence is fed by the difference between the old table and the restored one. The same difference tells you something more important.

<<< @/examples/22-recovery/src/table-diff.ts{diff}

`returning` is the notes that come back: the goal. `lost` is the notes created after the restore point, which vanish from view when you cut over. `rolledBack` is the edits that are undone.

**"Data lost" is the second and the third.** The numbers for the drill record come from here. Restore to five minutes before the accident, and whatever was written in those five minutes is not on the other side of the cutover. It is still in the old table, so it can be picked up and written back. This chapter has no tool for that.
