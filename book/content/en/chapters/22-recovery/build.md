---
title: "22 Backup: Design and Build"
---

# 22 Backup: Design and Build

[The previous page](/en/chapters/22-recovery.md) took the table back to a past time with PITR. This page brings the images in the bucket back, then finds and repairs the disagreement between the restored table and the bucket.

## Images come back from versions

<!-- section: 22.versioning -->

The bucket is not restored by one operation that takes all of it back to a given time. It is restored with versioning.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{bucket}

Two things change in a bucket with versioning. A write to an existing key does not overwrite it, and a new version is stacked on top. A delete that names no version does not delete the object, and S3 places a delete marker as the newest version instead. A plain read returns 404, but the bytes are still there under the delete marker.

How you bring a key back depends on what happened to it.

- **A deleted key.** Delete the delete marker, naming its version ID. The version below it is on top again
- **An overwritten key.** Copy the old version onto the same key. The copy is stacked as a new version and becomes the top

You can also undo an overwrite by deleting the newer version. This chapter does not use that method, because deleting a version cannot be undone, and if the newer version turns out to have been the right one, it is gone. A copy loses nothing.

Take care when you delete a delete marker. If you try it without a version ID, S3 does not remove the marker and stacks one more on top. A delete that restores always names a version ID.

### Deciding which key to restore, and how

The plan that moves the whole bucket toward its state at a given time is made key by key. The function that makes the plan does not call AWS either.

<<< @/examples/22-recovery/src/object-restore.ts{plan}

A key created after the chosen time is not deleted. The plan names it and leaves it alone, because deleting data as part of a restore would be a second accident.

The code that carries out the plan is short.

<<< @/examples/22-recovery/src/object-restore.ts{apply}

The plan is made from a fresh read of the bucket every time, so if a run stops halfway and you run it again, the finished steps no longer appear in the plan. A key restored by a copy has the same ETag on its top version as the version you wanted, and that is how the plan recognizes it as done. The ETags match when the bucket is encrypted with keys managed by S3, as this one is, and the upload was not multipart. In a bucket where those conditions do not hold, this test cannot be used.

Reading the list of versions from S3 needs care in one place.

<<< @/examples/22-recovery/src/s3-versioned-bucket.ts{list-versions}

`ListObjectVersions` returns versions with bytes and delete markers as two separate lists, so their order relative to each other can only be rebuilt from their times. If two entries for one key have the same time, the one S3 marks as the latest goes on top. Whether the real service yields the right order this way was not checked.

### Versioning changes what other chapters assumed

Chapter 07's "If you take this to production" mentioned in one line that versioning changes how lifecycle rules behave. This is what changes.

Chapter 07's bucket has a rule that removes unfinished uploads after a day. With versioning on, that rule does not remove the object. It places a delete marker, and the bytes stay as an old version. What actually deletes those bytes is `noncurrentVersionExpiration` in this chapter's rule, 30 days after they stopped being current. Those 30 days are how long an image can be brought back. Without `noncurrentVersionExpiration`, every byte ever uploaded is stored and billed forever.

Chapter 08's worker is affected too. In a bucket with versioning, an ordinary delete becomes the event `ObjectRemoved:DeleteMarkerCreated`. Chapter 08's stack subscribes to `ObjectRemoved:Delete`, so deletes would no longer reach the worker. If you turn versioning on for the bucket of chapters 07 and 08, you have to change that subscription as well. That is why this chapter's stack is a separate stack and not an addition to chapter 08's.

## Two stores return to two different times

<!-- section: 22.skew -->

When only the table goes back in time, it stops agreeing with the bucket. The two figures show the case where an image was deleted later and the case where an upload finished later.

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

The table can go back to any second you choose, while the bucket goes back by choosing a version again for each key. AWS has no mechanism that lines the two up at the same instant, so lining them up is your job, and the result is usually a little off. It is also common to restore only the table and forget the bucket.

What breaks when they are off is the promises that chapters 07 and 08 kept by writing in a careful order. Chapter 07 decided that "a record must never outlive its object" and reversed the order of deleting relative to creating to make it so. When only the table goes back in time, that ordering does not help.

One thing does help. Notes, attachment records, and inspection records are in the same table, so those three go back to the same time, and the only disagreement is between the table and the bucket. Chapter 05's choice of a single table pays off in a restore.

### What the check treats as a promise

The check reads the table and the bucket and counts whatever matches one of these.

<<< @/examples/22-recovery/src/invariants.ts{findings}

The findings fall into two groups. `broken` means that something the app relies on is not true, such as an attachment with no image or an inspection result about other bytes. `leftover` is garbage that nothing points at, which cleanup is supposed to remove. Only `broken` is a reason to hold a cutover.

The check itself is a function that looks only at what was read.

<<< @/examples/22-recovery/src/invariants.ts{check}

`graceMs` is the grace period for chapter 07's "uploads waiting to be finished". On a running service it is normal for an object that just arrived to have no record, so new objects are not counted. When you check with writes stopped, no upload is waiting, and the grace period can be 0. On the tasks, you pass `--frozen`.

The reading side has one rule as well.

<<< @/examples/22-recovery/src/items.ts{classify}

To the app, a restored table is data from outside, and it may hold items in the shape they had six months ago. So every item goes through a schema before it is trusted. An item that cannot be read does not throw. It is reported as `unreadable_item`, because if one unreadable item stopped the whole check, you would learn nothing about the rest.

The key formats (`NOTE#...`, `ATTACHMENT#...`, `INSPECTION#...`) are private to the files of chapters 05, 07, and 08. This chapter writes the same formats down again, and a test pins that it can read the items those three repositories actually write. If any of the chapters changes its key format, that test fails.

### What each kind of restore leaves behind

| What happened | What is found |
| --- | --- |
| The table and the bucket were restored to the same time | Nothing |
| Only the table was restored; an image was deleted after that time | `attachment_without_object`, `inspection_without_object` |
| Only the table was restored; an upload was finished after that time | `object_without_record` |
| Only the table was restored; an image was overwritten after that time | `inspection_for_other_bytes`, `attachment_size_mismatch` |
| Nothing was restored; right after the accident | Nothing |

The last row looks obvious, and it matters. Cleanly deleted data is consistent, so the check reports nothing. The check finds disagreement and does not find mistakes. A person, or some other monitoring, has to notice the accident.

## Repairing the disagreement

<!-- section: 22.repair -->

To repair, you have to decide which side is right. In this chapter **the table is right, and the bucket is made to match it.** The table can go back to any one second, so the decision about which time holds the correct data can be expressed on the table's side.

<<< @/examples/22-recovery/src/repair.ts{repair}

The repair depends on the kind of finding.

For an attachment record with no image, the repair looks at the bucket's versions. If a version with bytes survives, it removes the delete markers above that version and the image is back. If none survives, it deletes the record. Deleting the record means that data was lost. The report says `record_deleted`, and you write that in the drill record.

An inspection record with no object has the same shape as the result of the two paths that chapter 08 listed as open gaps. A delete event never arrived, or it was ignored because its order was unknown, and only the record stayed. The check finds these records even when no restore took place. Before it deletes one, the repair looks at the object once more, because an earlier step of the same run may have brought the image back.

For an inspection result about other bytes, the repair runs steps 1 to 3 of chapter 08's worker again on the bytes that are there now.

### The sequencer a repair uses without an event

Chapter 08's records were ordered by the sequencer that an S3 event carries. A repair has no event, so it has no sequencer.

<<< @/examples/22-recovery/src/repair.ts{sequencer}

The repair uses the stale record's sequencer plus one. That value beats the stale record and nothing else, because every later event for the same key carries a sequencer at least that large. A real event that arrives late either overwrites as usual or is correctly ignored as a duplicate about the same bytes.

Deleting uses the same value. Passed to chapter 08's condition, "delete only a record older than this sequencer", it removes the record the check saw and leaves a newer record that a real event wrote in the meantime.

### Run any number of times, stopped anywhere

A repair is something a person in a hurry runs again after it failed. So the tests were written by breaking the repair partway through. As in chapter 08, the clock and the order are fixed and the place to stop is injected. Nothing depends on waiting.

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

The repair leaves two things alone.

One is an object with no record. Removing those is the job of chapter 07's cleanup, but after a restore the cleanup does harm. When the table goes back in time, every upload finished after that time becomes an object with no record. Chapter 08's cleanup runs every hour and deletes recordless objects past their grace period. So **if you restore the table and leave it for an hour or so, the cleanup starts deleting the images whose records the restore lost.** The local tests reproduce this with chapter 07's cleanup code unchanged. With versioning on, a deleted image can be brought back from its versions. Without versioning, it cannot. Stop the cleanup schedule before you cut over.

The other is an image whose size does not match its record. The repair cannot tell whether the image was overwritten or the record is the old one. Restoring the bucket to the same time resolves it. If you cannot do that, a person decides whether to delete the attachment or leave it.

## Version numbers that went backwards

<!-- section: 22.versions -->

Restoring the table also opens a hole in chapter 05's promise. The check does not find this one.

Chapter 05's optimistic lock compared the version numbers of a note. The comparison was "I saw version 3, and if it is still 3, save it as 4." It assumed that numbers only grow, so the same number means the same content.

A restore winds the numbers back.

1. A note is edited up to version 3. Someone's browser is still open, showing version 3
2. The table is restored to a time when it was version 1, and you cut over
3. Someone else edits the restored note twice. The version becomes 2, then 3
4. The browser that stayed open sends its save "from version 3"

The save in step 4 passes, because the numbers match. But version 3 after the restore is not the content the browser was showing as version 3. The browser overwrites edits it never saw. A test reproduces exactly this order.

The fix is to move the restored table's numbers past the numbers the old table handed out.

<<< @/examples/22-recovery/src/table-diff.ts{fence}

A note that was at version 3 in the old table is set to version 4 in the restored one. The old browser's "from 3" no longer passes. The write to DynamoDB is conditional.

<<< @/examples/22-recovery/src/dynamodb-table.ts{raise-version}

It only raises the number and never lowers it. Running it twice, or after someone edited past the fence, breaks nothing.

This closes only half the hole. A note that the accident **deleted** is no longer in the old table, so there is no way to know how far its numbers had gone. Closing the hole properly means mixing "after which restore" into the version comparison. This chapter does not implement that.

### Counting what the cutover loses before you cut over

The fence is built from the difference between the old table and the restored one. The same difference also tells you what the cutover loses.

<<< @/examples/22-recovery/src/table-diff.ts{diff}

`returning` is the notes that come back, which is the purpose of the restore. `lost` is the notes created after the restore point, which disappear from view when you cut over. `rolledBack` is the edits that are undone.

**The data you lose is `lost` and `rolledBack`.** The numbers for the drill record come from these two. If you restore to five minutes before the accident, whatever was written in those five minutes is not there after the cutover. It is still in the old table, so it can be picked up and written back, but this chapter has no tool for that.
