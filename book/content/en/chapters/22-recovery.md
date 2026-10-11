---
title: "22 Recover Data and Service: PITR, Snapshots, S3 Versioning, and AWS Backup"
sourceRevision: 1
---

# 22 Recover Data and Service: PITR, Snapshots, S3 Versioning, and AWS Backup

[Chapter 05](/en/chapters/05-dynamodb.md) said "getting back data you deleted by mistake is chapter 22" and moved on. [Chapter 07](/en/chapters/07-uploads.md) left the same homework for the image bucket. This is where we do it.

What we build is a recovery drill. You delete notes and images on purpose, bring them back, and write down how long it took and what you lost. For that there is a stack, one task per step, and a form to fill in.

The heart of the chapter is not the restore itself but what comes after. The table and the bucket are restored by different mechanisms, to different moments. Right after a restore, the two usually disagree. Finding that, and fixing it, is most of what follows.

One thing up front, honestly. On the author's side, no restore has ever been run against AWS. The steps and tasks are there in runnable form, but you won't find a single measured number, such as a recovery time, anywhere in this chapter. Measuring is your part. What was checked locally is the other half: detecting and repairing the disagreement.

You need chapters 05 and 07. The inspection records of [chapter 08](/en/chapters/08-async.md) show up too, so having read it helps. The code is in `examples/22-recovery/`.

## The big picture

<!-- section: 22.overview -->

```text
vp run recovery:*   (your laptop, your credentials)
  |  seed, accident      write and delete the way the app does (owner "drill")
  |  restore:table       RestoreTableToPointInTime --> a NEW table, outside the stack
  |  restore:objects     delete markers removed, old versions copied on top
  |  verify, repair      Scan + ListObjectsV2, then the fixes
  v
DynamoDB table "Notes"                          S3 bucket "Uploads"
  point-in-time recovery: on                      versioning: on
  NOTE#...  ATTACHMENT#...  INSPECTION#...        u/<owner>/<note>/<attachment>
  any second of the last 35 days                  old versions kept 30 days
        |                                               |
        +---- as of T1 ----  must agree  ---- as of T2 --+

Lambda function "Audit" (read-only)
  Scan + ListObjectsV2, counts what does not line up
  TABLE_NAME = the stack's table, or a restored one after `-c table=<name>`

only with -c backup=on    AWS Backup vault + one snapshot a day, kept 7 days
only with -c replica=on   second bucket + S3 Replication (delete markers not replicated)
```

The stack creates one table, one bucket, and one function. The table holds what chapters 05, 07, and 08 put there, in the same shapes: notes, attachment records, and inspection records, all in one table. The bucket uses the keys of chapter 07's image store.

There is no API and no screen. The "app" of this chapter is the tasks you run from your laptop, plus a function that reads the table and the bucket and counts where they disagree. Wherever data is written, the code of chapters 05, 07, and 08 is imported and used as it is.

The last two lines are not created unless you ask. Both add cost just by existing, so they appear only when named.

## Three kinds of protection, easily confused

<!-- section: 22.not-backup -->

When someone says "a setting that protects data", they usually mean one of three things. Each protects against something different.

- **Deletion protection.** Refuses the operation that deletes the table itself (`DeleteTable`). It does nothing about deleting the items in it
- **Replication.** Keeps a copy of the current state somewhere else. It helps when the place breaks
- **Backup.** Keeps past states. It helps when the data was changed by mistake

For a note deleted by accident, only the third one helps.

A little more on why replication doesn't. Replication delivers changes faithfully, the wrong ones included. A DynamoDB global table sends a change made in one replica to the others asynchronously; the documentation says typically within a second. An item you deleted by mistake is gone over there a second later.

S3 replication is a slightly different story. With the current configuration format, delete markers (explained in a moment) are not replicated by default, and neither is a delete that names a version. So is it safe? Overwrites are replicated. Overwrite an image with a broken one, and that broken version arrives on the other side. The old version survives there because the destination has versioning on, but that is versioning protecting you, not replication.

**Replication makes two of "now". Backup keeps "a while ago".** The default stack of this chapter turns on two of the latter kind: point-in-time recovery for the table, and versioning for the bucket.

## Taking the table back in time

<!-- section: 22.pitr -->

PITR (point-in-time recovery) has DynamoDB record changes to a table continuously, so that the state at any one past second can be taken out again. Turning it on is one line.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{table}

The window reaches back at most 35 days. Its newest end is not "now": according to the documentation it is typically about five minutes ago. `recovery:status` prints both ends (`EarliestRestorableDateTime` and `LatestRestorableDateTime`).

`deletionProtection` is off by default, because an exercise stack should take its table with it when you clean up. The production setting chapter 05 promised is what `-c protect=on` gives you: `removalPolicy` becomes `RETAIN`, and deletion protection is on.

### A restore adds a table

This is the most important thing about PITR. **A restore does not rewrite the source table. It creates a new one.**

That is good news. The source table stays readable and writable throughout. If you don't like the result, delete it and try again. You can look inside before deciding to use it.

The bad news is that the new table is born outside the CDK stack, under a different name. The app is still looking at the old one. Between "restored" and "usable" there is one more job, and the section on cutting over is about that.

Building the restore request is a function that doesn't call AWS.

<<< @/examples/22-recovery/src/pitr.ts{plan}

The new table's name carries the time of the request. Two attempts never collide, and later you can tell "the drill made this one". The cleanup task refuses to delete a table whose name lacks that mark.

A time outside the window, or a table without PITR, is refused here. AWS would answer with an error anyway, but when you are in a hurry, being stopped on your own machine is kinder.

### Settings that do not come along

A restored table is not a complete copy of its source. According to the documentation, the data, the indexes, and the encryption settings come along. Auto scaling, IAM policies, CloudWatch alarms, tags, streams, TTL, and the PITR setting itself do not. Deletion protection, a different page says, is off by default on tables restored from backups.

So a table restored with PITR has no PITR. Keep using it as it is, and the next accident cannot be undone. `recovery:protect` is the task that turns PITR on for a restored table.

Two more things worth knowing. Turning PITR off and on again restarts the restorable window from that moment. And when you delete a table that has PITR enabled, DynamoDB creates one system backup and keeps it for 35 days: the last resort for a table deleted whole. Both were only read in the documentation, not tried.

### The stand-in on a laptop

DynamoDB Local has no PITR, so the tests got their own "table that can go back in time".

<<< @/examples/22-recovery/src/memory-table.ts{memory-table}

It remembers every write with its time, and `restoreTo` replays them up to a moment into a new table. The source is not touched. It stands in for the idea of PITR, not for DynamoDB: neither the time a restore takes nor the five-minute lag is reproduced.

The repositories of chapters 05, 07, and 08 sit on top of this table, and chapter 05's contract tests for a repository run against it unchanged. As it happens, the first version had an `await` between a read and the write that depends on it, and "exactly one of two writers holding the same version wins" failed. Chapter 05's contract earned its keep here.

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

```text
time ------------------------------------------------------------------->
          T0                 T1                 T2               now
          |                  |                  |                 |
table     record A written   (restore point)    record A deleted
bucket    object A written                      delete marker on A

restore the table to T1, leave the bucket at "now":
  table says   "A has an image"
  bucket says  "A was deleted"          --> a record that points at nothing

restore the table to T1, where an upload finished at T2 instead:
  table says   nothing about it
  bucket says  "here are the bytes"     --> an object nobody points at
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

## Running it locally

<!-- section: 22.local -->

You can watch the whole flow without an AWS account.

```bash
vp run recovery:demo
```

It goes from accident to repair on an in-memory table and bucket. The output looks like this.

```text
09:04:00  two notes, one inspected image each. This is the point to return to.
09:09:00  since then: one edit, one note deleted by mistake, one image overwritten, one new note.

restored the table to 09:04:00. The bucket is still at 09:09:00.
cutting over gives back 1 note, loses 1, undoes edits to 1.

check: the restored table against the bucket as it is: 4 findings
  broken   attachment_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   attachment_size_mismatch  u/alice/0mv50wpxc0003/0mv50y0800004
  leftover inspection_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   inspection_for_other_bytes  u/alice/0mv50wpxc0003/0mv50y0800004

restored the bucket to 09:04:00: remove_delete_marker, copy_version

check again: 0 findings

repair: 0 actions, 0 findings left for a person
raised the version of 1 rolled-back note past the number the live table had reached.

not restored, and not found by any check: "diary, written after the point". It exists only in the old table.
```

With only the table restored, four findings. Restore the bucket to the same time, and there are none. The repair had nothing to do.

That is the order to prefer. **First bring both as close to the same time as you can. Use the repair only for what is still left.** Repair first, and it rewrites the inspection record to match the overwritten bytes; then you restore the bucket, and they disagree all over again.

Look at the last line, too. The diary written after the restore point shows up in no check. Lost data is something the difference tells you, not the check.

The tests run as always.

```bash
vp run test:unit
```

Here is what these two do not reproduce. How long a restore takes. The lag of `LatestRestorableDateTime`. The granularity of S3's timestamps. The events S3 sends when a delete marker is removed or a version is copied. IAM. All of these can only be checked against the real thing.

## Getting ready for AWS

<!-- section: 22.infra -->

Whatever costs money, or outlives the stack, is created only when asked for by name.

<<< @/examples/22-recovery/infra/bin/app.ts{context}

It is the approach of chapter 14's `-c store=valkey`. With nothing added you get the table, the bucket, the function, its logs, a role, and its policy. A test pins the list of resource types in the default layout. No vault, no plan, and no second bucket is in it.

The function only reads.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{role}

`Scan` on the table, and listing the bucket. Not one permission to write. Repairs are run by a person, with their own credentials, from a laptop. The function is not built to fix whatever it finds: right after a restore, a person is still deciding what is correct.

`Scan` appears in this book for the first time. Chapter 05 deliberately left it out of the role, because reading a whole table is expensive and slow. But a check that wants to say "every item was looked at" has no other way.

<<< @/examples/22-recovery/src/dynamodb-table.ts{scan}

The function itself is short.

<<< @/examples/22-recovery/src/audit-lambda.ts{handler}

Which table it reads is decided by the environment variable `TABLE_NAME` and nothing else. That becomes the handle for the cutover later.

### Created only when asked

`-c backup=on` adds an AWS Backup vault and a plan for one snapshot a day.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{backup}

Why another backup when there is PITR? PITR is a feature attached to the table, and it reaches back 35 days at most. An AWS Backup snapshot can live somewhere else (a vault), under different permissions, for longer. The documentation, too, says the two do not replace each other, and that using both is billed as both. The drill in this chapter does not use it. This only shows where it goes.

The role the plan uses gets a managed policy that AWS provides (`AWSBackupServiceRolePolicyForBackup`). CDK does that. It is the kind of "broad permission" this book has avoided all along, but here AWS's own was chosen over writing and maintaining the list of permissions the backup service needs. The test checks that exactly one such policy is attached, the one for backing up, with the one for restoring not mixed in.

`-c replica=on` adds a second bucket and replication into it.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{replica}

Delete marker replication stays off, pinned by a test. By the way, CDK gives the replication role a fixed name, `CDKReplicationRole`; it turned up in the synthesized template. A role of that name already in the account should make the deploy collide.

### The types cdkd handles

The pinned version of cdkd (0.296.28) has a dedicated implementation for the seven types of the default layout (`AWS::DynamoDB::Table`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Logs::LogGroup`). It has none for `AWS::Backup::BackupVault`, `BackupPlan`, or `BackupSelection`; those go through Cloud Control API. All of this was read in the installed package, and nothing was created for real.

## Running the drill

<!-- section: 22.drill -->

From here on, nothing has been run. The steps and tasks are prepared, and that is all.

Decide what to measure first.

- **RTO (recovery time objective)** is the target for how long it may take from an accident until the service is usable again. The drill measures what you actually got. The end is not when the restore API returns. It is when the deployed function reads the restored data and answers that nothing is broken
- **RPO (recovery point objective)** is the target for how far back you may lose data. The drill measures the length from the restore point to the accident, and the number of things written in between and lost

The record is kept in a file.

<<< @/examples/22-recovery/src/drill.ts{record}

Every field starts empty. A field that stays empty means "that step was not done", and the summary does not fill it with a number.

<<< @/examples/22-recovery/src/drill.ts{summary}

A time, once written, cannot be rewritten. A record is evidence.

### Preparation, and the accident

```bash
vp run recovery:infra:deploy
vp run recovery:drill new first
vp run recovery:seed --apply
vp run recovery:status
```

`recovery:seed` writes three notes with one image each, under the owner `drill`. Without `--apply` it only shows what it would write. Every task in this chapter that changes AWS works that way.

<<< @/examples/22-recovery/scripts/context.ts{flags}

Wait until `latest restorable` in `recovery:status` has passed the time the seed printed. Nothing earlier than that can be restored to. Then cause the accident.

```bash
vp run recovery:drill mark first lastGoodWriteAt
vp run recovery:accident --apply
vp run recovery:verify
```

<<< @/examples/22-recovery/scripts/recovery.ts{accident}

The accident is caused by the app's own delete. Chapter 07's "deleting a note deletes its attachments" runs as it is. The image of one more note is overwritten with bytes that are not an image. Only things owned by `drill` are deleted or damaged.

The task prints the time before and after the accident. Record the earlier one with `recovery:drill mark first accidentAt --at <time>`.

The `recovery:verify` right afterwards should find the overwritten image. It will not find the deleted note, which is cleanly gone.

### Restoring

```bash
vp run recovery:drill mark first restoreRequestedAt
vp run recovery:restore:table --at <a time before the accident> --apply
vp run recovery:status
```

<<< @/examples/22-recovery/scripts/recovery.ts{restore-table}

Keep looking at `recovery:status` until the new table is `ACTIVE`, then record `tableActiveAt`. That is how long the table restore took. The documentation says it varies with the amount of data and the number of indexes, and that no fixed completion time is guaranteed. Which is why you measure.

<<< @/examples/22-recovery/scripts/recovery.ts{status}

Then the bucket. Read the plan without `--apply` first, then apply it.

```bash
vp run recovery:restore:objects --at <the same time>
vp run recovery:restore:objects --at <the same time> --apply
vp run recovery:diff --table <restored table>
vp run recovery:verify --table <restored table> --frozen
vp run recovery:repair --table <restored table> --frozen
```

<<< @/examples/22-recovery/scripts/recovery.ts{diff}

Record the numbers `recovery:diff` prints, as in `recovery:drill set first notesLost <number>`. Once `recovery:verify` says zero `broken`, you can go on. If not, read the plan of `recovery:repair`, run it with `--apply`, and check again.

To finish: the version fence, and PITR back on.

```bash
vp run recovery:diff --table <restored table> --fence --apply
vp run recovery:protect --table <restored table> --apply
```

## Cutting over

<!-- section: 22.cutover -->

The restored table holds the right contents. But nobody is reading it. The function's `TABLE_NAME` still names the old table.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{cutover}

The function's environment variable, its IAM permission, and the stack's output all hang off the same one variable. Pass the table's name as context, and all three move together. Change only the environment variable in the console, and the permission still names the old table, so the function stops with `AccessDenied`. A test pins that the three move as one.

```bash
vp run recovery:infra:diff -c table=<restored table>
vp run recovery:infra:deploy -c table=<restored table>
vp run recovery:audit
vp run recovery:drill mark first serviceConfirmedAt
```

The diff should show the function's environment variable, one policy statement, and the output value, and nothing else. No table is created or deleted. `recovery:audit` calls the deployed function and prints the name of the table it reads and the number of disagreements. If `broken` is 0 here, the service is back. Stop the RTO clock.

One thing is easy to forget. Leave out `-c table=` on the next deploy, and the function goes back to the old table: the one from after the accident. Put the cutover in the source, not in someone's shell history. Add `table` to the `context` in `cdk.json`, and commit it.

### To the stack, the restored table does not exist

This is where infrastructure as code comes in.

Take stock. The table the stack owns is the old one. It still holds the data from after the accident, and its PITR and deletion protection settings are as the source says. The restored table is outside the stack. It appears neither in cdkd's state nor in the template.

```bash
vp run recovery:infra:drift
```

A drift check compares the values recorded in the state with the real resources. So **about the restored table it says nothing**: there is nothing in the state to compare it with. The difference [chapter 20](/en/chapters/20-shipping.md) drew between "no difference was found" and "everything was compared and matched" shows up here as it is. Zero drift, and the table now carrying the service is outside the check. The PITR you turned on by hand, the deletion protection you forgot: nobody is watching either.

There are two ways out.

One is to leave it like this. Fix `-c table` in `cdk.json`, and manage the restored table's settings by other means. It is quick, and the table's settings stay out of the source.

The other is to bring the restored table into the stack. cdkd has `orphan`, which removes a resource from the state, and `import`, which puts an existing resource into it. Remove the old table with `cdkd orphan AihRecovery/Notes`, and put the restored one under the same logical ID with `cdkd import AihRecovery --resource <logical ID>=<restored table>`. After that `-c table` should no longer be needed, and the drift check should see the restored table. "Should", because for these two commands only the help output was read. Both have `--dry-run`, so if you try, read that first. Once adopted, any setting the source declares (PITR on, say) that the real table lacks will now show as drift.

A stack managed by CloudFormation also has a way of bringing existing resources into a stack. cdkd's help says its `import` follows the CDK CLI's `cdk import`. That side was not checked.

### Choosing not to replace the table

If the cutover is too much trouble, there is a way that adds no table. Read just the deleted items from the restored table, and write them back into the original. The name does not change, and the stack is not touched. Data written after the accident is not lost either.

In exchange, you build the write-back tool yourself, and its writes must be conditional so that they don't collide with the app still writing to the original table. If a handful of items disappeared and you know exactly which, this is the smaller job. If the whole table is suspect, cut over. This chapter built only the cutover. The `returning` list of `recovery:diff` does give you the candidates to write back.

## If you come from D1's Time Travel

<!-- section: 22.cloudflare -->

If you have been using Cloudflare D1, you will have thought "that is a lot of steps" by now. It is.

D1's Time Travel is on from the start and costs nothing extra. It restores to a minute within the last 30 days (7 on the Workers Free plan). And when you restore, the database is overwritten in place. No new database appears. The binding and the name stay as they are. There is no cutover to do.

DynamoDB's PITR is something you turn on, and pay for by the size of the table. Its granularity is a second, and it reaches back 35 days at most. And it always produces a new table.

Which is better depends on what you fear. A restore that overwrites in place is fast and simple. In exchange, the moment you restore, the current data is out of sight. D1 hands back a bookmark for returning to the state before the restore, so it can be undone. What you cannot do is put the restored result and the state before it side by side. The documentation says there is no feature for cloning a database yet. A restore that creates a new table is slow and cumbersome. In exchange, you can set it next to the original, count the differences, and then decide whether to cut over. That is what `recovery:diff` does in this chapter.

For R2, what was checked is that the compatibility table of its S3 API marks the versioning operations (`GetBucketVersioning`, `PutBucketVersioning`) as not implemented. Whether R2 has other means of restoring was not looked into.

And if you combine D1 and R2, the main subject of this chapter applies as it stands. Take the database back ten minutes, and the bucket does not follow.

## What it costs

<!-- section: 22.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The details are in [Pricing Worksheets](/en/reference/pricing.md).

The drill in this chapter is three notes and three images of 33 bytes each. At the unit prices below, it does not reach one cent. Whether small amounts carry a minimum charge was not checked.

Let's look at a size that means something: a 1 GB table and 10 GB of images.

**What staying restorable adds.** Storage for the table and the images themselves is left out. This is only what you pay for being able to go back.

| Item | Per month |
| --- | --- |
| PITR (1 GB table) | 0.23 |
| Old versions (1 GB a month overwritten or deleted, kept 30 days) | 0.03 |
| Subtotal | **0.25** |

PITR is USD 0.228 per GB-month. It is set by the size of the table, and the documentation says that shrinking the window from 35 days to 1 changes nothing. Old versions are billed at the price of ordinary objects, each one whole. An image overwritten three times is four images.

**One drill.**

| Item | List price |
| --- | --- |
| Restore (1 GB) | 0.17 |
| The check's `Scan` (1 GB, four times) | 0.15 |
| Storage for the restored table if left for a month (1 GB) | 0.00 |
| Subtotal | **0.32** |

A restore is USD 0.171 per GB restored. The check reads the whole table with strong consistency, about 260,000 read request units for 1 GB; four of them come to USD 0.15. Make the table 100 times larger, and one check is about USD 3.7. As with chapter 08's cleanup, **the cost of reconciling grows with how much is stored.**

Storage shows 0.00 because the first 25 GB of DynamoDB storage is a USD 0 tier. If the account's total is past that, it is USD 0.285 per GB. More important: the restored table is outside the stack, so it **stays when the stack is deleted**. If you turned PITR back on, that continues as well.

**What is added only when asked.**

| Layout | Per month |
| --- | --- |
| `-c backup=on` (1 GB table, once a day, kept 7 days) | 0.80 |
| `-c replica=on` (a copy of 10 GB of images and 1 GB of old versions, 10,000 objects replicated a month) | 0.32 |

AWS Backup is USD 0.114 per GB-month. The 0.80 assumes that each of the seven snapshots is billed at the size of the whole table; whether they are taken incrementally was not checked. Replication is the second set of storage plus the replication requests. According to the pricing page, replication within one Region has no data transfer item. A replication request was computed at the price of an ordinary PUT.

No free allowance is deducted in any of these tables. Whether restores and AWS Backup have one was not looked into.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| `recovery:restore:table` says "outside what can be restored" | The time you gave is later than `latest restorable`. Check with `recovery:status` and wait a few minutes |
| `recovery:restore:table` says "not enabled" | PITR is off on the table. Was the table deployed by this chapter's stack? |
| The restored table never becomes `ACTIVE` | The time depends on the amount of data and the number of indexes, and none is guaranteed. The source table stays usable meanwhile |
| The plan of `recovery:restore:objects` is empty | Is the `--at` time before the accident? Did you pass it in UTC? |
| An object you deleted grows a marker every time you delete it | You are deleting a delete marker without its version ID. That only stacks another |
| `recovery:verify` finds nothing right after the accident | That is correct. Cleanly deleted data does not disagree |
| `recovery:verify` reports many `object_without_record` after the restore | Uploads from after the restore point. Without `--frozen` they appear once an hour has passed |
| `recovery:audit` names the old table after the cutover | Did you deploy with `-c table=`? Is it in `cdk.json`? |
| The function fails with `AccessDenied` | Did you change only the environment variable? The permission moves with it through the context |
| `recovery:infra:destroy` cannot delete the bucket | Versions are left. `recovery:empty --apply` comes first |
| The stack is gone and DynamoDB is still on the bill | A restored table is left. `recovery:status` lists them |

## Going to production

- **Protect the table and the bucket.** That is `-c protect=on`: `RETAIN` and deletion protection. It protects the table itself, and only that. The contents are protected by PITR and versioning
- **Set targets first, and check them with a drill.** RTO and RPO, once chosen, are only numbers. Measuring is what tells you whether you meet them. As the table grows, so does the restore time. Do it regularly
- **Have a way to know when the accident happened.** PITR restores to whatever time you give it. Only you know that time. Record API calls so you can trace who deleted what, and when (the tool is CloudTrail. The event history read in [chapter 21](/en/chapters/21-security.md) records management events, so check beforehand what will be in it)
- **Have a way to stop writes during the cutover.** Cut over on a running service, and the check's grace period and the count of lost data both keep moving. This chapter builds no way to stop
- **Put "stop the cleanup" into the recovery procedure.** Chapter 08's schedule deletes images whose records were lost
- **Return the restored table to the source.** Adopt it, or rebuild. Don't keep running the service on "a table outside the stack"
- **Mix the number of restores into the version comparison.** That closes the rewound numbers, deleted notes included
- **Keep backups in another account or another Region as well.** PITR and versioning both live in the same account and the same Region. They do nothing against losing the account. AWS Backup's cross-Region and cross-account copies are not covered in this chapter
- **Don't keep the check for recoveries only.** Small disagreements appear in normal operation too, like chapter 08's open gaps. Run the function on a schedule and get told when `broken` stops being 0. The cost grows with the size of the table

## Cleaning up

<!-- section: 22.cleanup -->

```bash
vp run recovery:status
vp run recovery:drop-table --table <restored table> --apply
vp run recovery:empty --apply
vp run recovery:infra:destroy
```

The order means something.

First, delete the restored tables. They are outside the stack, so `destroy` will not do it. `recovery:status` lists the tables whose names carry the mark. If you are still cut over, deploy without `-c table=` first, to return the function to the original table. `recovery:drop-table` refuses to delete the table the function is reading.

<<< @/examples/22-recovery/scripts/recovery.ts{drop-table}

Next, empty the bucket. A bucket with versioning is not empty until every version and every delete marker is gone. After this runs, nothing in the bucket can be brought back.

Last, the stack. The table, the bucket, the function, and the logs are deleted. The PITR history goes with the table. According to the documentation, a table that had PITR on leaves a system backup for 35 days, at no additional cost.

Cleaning up a stack deployed with `-c protect=on`, `-c backup=on`, or `-c replica=on` was not checked. A table and a bucket under `protect` are meant to survive the stack, so you delete them by hand. That cdkd does not delete a table with deletion protection unless `--remove-protection` is given was read in its source. What happens when snapshots are still in the vault is not known.

The drill records are in `reports/drills/`, which git ignores. Move the ones you want to keep somewhere else, together with your copy of `examples/22-recovery/drill/TEMPLATE.md`.

## As a distributed system

There are two owners of state. Notes and records belong to DynamoDB, bytes to S3. No transaction spans the two. Chapters 07 and 08 used the order of writes, and conditional writes, so that "stopping halfway never leaves a broken state".

A restore walks straight past that care. From two histories written in a careful order, it cuts out two different moments. **A promise kept by ordering does not survive an operation that rewinds time.** To keep it again, the promise itself has to exist in a form that can be checked. In this chapter that is `check`.

The repair is designed like chapter 08's worker. Every step verifies for itself the condition it depends on. So run twice, or stopped halfway, it settles in the same place. What differs is that no event says what the right order is, and that gap was filled with "a sequencer that beats the stale record and nothing else".

And what is not closed. The check reads the table and the bucket separately. On a running service, writes land between the two reads. The grace period avoids most of it, but an attachment deleted a moment ago can briefly look like "a record with no image". The repair looks again before it acts, so it breaks nothing. It does appear in the report. Checking with writes stopped is the surest way.

::: details Verification notes for this chapter

**Checked locally.** Detection with the table and the bucket restored to different times (the same time, the table only, before an upload, after an overwrite). Repair (bringing an image back, deleting the record when no version is left, re-inspection, ordering against a real event that arrives late, a dry run, running twice from the same findings, an interruption). Detecting and deleting the shape of chapter 08's open gaps, and not deleting a newer record written after the check. That chapter 07's cleanup code deletes recordless images after a restore, and that they can be brought back from versions. The object restore plan (a deleted key, several delete markers, an overwrite, a key created later, a key already deleted, the order of the listing), its re-run, and an interruption. That rewound version numbers let a stale save through, that the fence stops it, and re-running the fence. The difference between tables. Building the PITR request, and refusing a time outside the window, a table without PITR, and an already restored table. That the drill record template is empty, the summary, and refusing to rewrite a time. Classifying the items that the repositories of three chapters write. Chapter 05's repository contract. The requests sent to DynamoDB and S3. Stack assertions (the list of default types, PITR, versioning and lifecycle, public access settings, permissions, that the cutover moves the environment variable, the permission, and the output together, and the `protect`, `backup`, and `replica` layouts). Type checking and synth. Running `recovery:demo` and `recovery:drill`. And the code was broken on purpose in six places to see the tests fail.

**Not checked yet.** Nothing was run against AWS: none of `recovery:infra:diff`, `deploy`, `drift`, `destroy`, `recovery:status`, `seed`, `accident`, `restore:table`, `restore:objects`, `diff`, `verify`, `repair`, `protect`, `audit`, `drop-table`, or `empty`. So there are no measured RPO or RTO values. Also unchecked on the real service: how long a PITR restore takes, and the lag of `LatestRestorableDateTime`. Which settings a restored table inherits and which it does not. The ETag, `LastModified`, and S3 events after a delete marker is removed and after a version is copied. That a copied version has the same ETag as its source. The order of versions that share a time in `ListObjectVersions`. The response to deleting a version ID that does not exist. The diff of a deploy with `-c table=`, and the output of the drift check. `cdkd orphan` and `cdkd import` (only the help was read). CloudFormation's resource import (its documentation could not even be read). Creating and deleting `-c protect=on`, `-c backup=on`, and `-c replica=on`. Whether AWS Backup snapshots are incremental. Minimum charges on small amounts. The DynamoDB and S3 implementations have their request shapes pinned by tests and were never sent to the real services. The sequencer of the inspection records that `recovery:seed` writes is made up, and its image is only the first 33 bytes of a PNG, not something you can view.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Taking the table back in time | `examples/22-recovery/infra/lib/recovery-stack.ts`, `src/pitr.ts`, `src/memory-table.ts`, `test/pitr-drill.test.ts` | `test:unit`, `recovery:status`, `recovery:restore:table` |
| Images come back from versions | `examples/22-recovery/src/versioned-bucket.ts`, `src/object-restore.ts`, `src/s3-versioned-bucket.ts`, `test/object-restore.test.ts` | `test:unit`, `recovery:restore:objects` |
| Two stores return to two different times | `examples/22-recovery/src/invariants.ts`, `src/items.ts`, `src/audit.ts`, `test/skew.test.ts`, `test/adapters.test.ts` | `test:unit`, `recovery:demo`, `recovery:verify` |
| Repairing the disagreement | `examples/22-recovery/src/repair.ts`, `test/skew.test.ts`, `test/world.ts` | `test:unit`, `recovery:repair` |
| Version numbers that went backwards | `examples/22-recovery/src/table-diff.ts`, `src/dynamodb-table.ts`, `test/table-diff.test.ts` | `test:unit`, `recovery:diff` |
| Running it locally | `examples/22-recovery/scripts/demo.ts`, `src/local.ts` | `recovery:demo`, `test:unit` |
| Getting ready for AWS | `examples/22-recovery/infra/lib/recovery-stack.ts`, `infra/bin/app.ts`, `infra/test/recovery-stack.test.ts`, `src/audit-lambda.ts`, `cdk.json` | `recovery:infra:synth`, `test:unit` |
| Running the drill | `examples/22-recovery/scripts/recovery.ts`, `scripts/context.ts`, `scripts/drill.ts`, `src/drill.ts`, `drill/TEMPLATE.md`, `drill/record.template.json` | `recovery:drill`, `recovery:seed`, `recovery:accident`, `recovery:restore:table`, `recovery:restore:objects`, `recovery:diff`, `recovery:verify`, `recovery:repair`, `recovery:protect` |
| Cutting over | `examples/22-recovery/infra/lib/recovery-stack.ts`, `infra/bin/app.ts` | `recovery:infra:diff`, `recovery:infra:deploy`, `recovery:audit`, `recovery:infra:drift` |
| Cleaning up | `examples/22-recovery/scripts/recovery.ts` | `recovery:drop-table`, `recovery:empty`, `recovery:infra:destroy` |
| What it costs | `data/pricing/` | `test:unit` |

**Primary sources** (all checked 2026-10-12)

- [Point-in-time backups for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html), [Enable point-in-time recovery in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery_Howitworks.html), [Restoring a DynamoDB table to a point in time](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.Tutorial.html), [RestoreTableToPointInTime](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_RestoreTableToPointInTime.html)
- [Basic operations on DynamoDB tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html) (deletion protection), [How DynamoDB global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)
- [Retaining multiple versions of objects with S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [Working with delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html), [Managing delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManagingDelMarkers.html), [Restoring previous versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RestoringPreviousVersions.html), [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)
- [Lifecycle configuration elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html), [Emptying a general purpose bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/empty-bucket.html), [Event notification types and destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
- [What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html), [Replicating delete markers between buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-marker-replication.html)
- [Advanced DynamoDB backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/advanced-ddb-backup.html), [Restore a Amazon DynamoDB table](https://docs.aws.amazon.com/aws-backup/latest/devguide/restoring-dynamodb.html)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json), [AWS Backup](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBackup/current/ap-northeast-1/index.json). [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) (the replication items, read as excerpts)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (`cdkd import --help`, `cdkd orphan --help`, and the bundled dist of the installed package)
- [Cloudflare D1: Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/), [Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

:::
