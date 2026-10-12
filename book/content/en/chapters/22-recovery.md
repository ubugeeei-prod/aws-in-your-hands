---
title: "22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup"
sourceRevision: 4
---

# 22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup

[Chapter 05](/en/chapters/05-dynamodb.md) put off the steps for getting back data you deleted by mistake until chapter 22. [Chapter 07](/en/chapters/07-uploads.md) left the same homework for the image bucket. This chapter does that homework.

You build a recovery drill. You delete notes and images on purpose, bring them back, and record how long it took and what you lost. The chapter provides a stack, one task for each step, and a file to keep the record in.

Most of the chapter is about what comes after the restore, not the restore itself. The table and the bucket are restored by different mechanisms to different moments, so right after a restore the two usually disagree. Finding that disagreement and repairing it takes up most of the pages.

The author has never run a restore against AWS. The steps and tasks are in runnable form, but this chapter contains no measured value, such as how long a recovery took. Measuring is your part. What was checked locally is the detection and repair of the disagreement.

You need chapters 05 and 07. The chapter also handles the inspection records of [chapter 08](/en/chapters/08-async.md), so it helps to have read it. The code is in `examples/22-recovery/`.

## The big picture

<!-- section: 22.overview -->

```figure
caption: The recovery tasks write to the table and the bucket from your laptop, cause the accident, restore each one separately, then compare them and repair
type: sequence
actor cli: vp run recovery:* | your laptop, your credentials
actor table: DynamoDB table Notes
actor bucket: S3 bucket Uploads
step cli -> table: seed, accident
step cli -> bucket: seed, accident
note cli: the way the app does (owner "drill")
step cli -> table: restore:table
note table: RestoreTableToPointInTime
note table: a new table, outside the stack
step cli -> bucket: restore:objects
note bucket: delete markers removed
note bucket: old versions copied on top
step table --> bucket: T1 and T2 must agree
step cli -> table: verify: Scan
step cli -> bucket: verify: ListObjectsV2
note cli: repair: then the fixes
```

```figure
caption: The stack creates the table, the bucket, and the function that checks them, and the two at the bottom are added only when asked for
node audit: Lambda function Audit | read-only, counts what does not line up
node table: DynamoDB table Notes | point-in-time recovery, any second of the last 35 days
node bucket: S3 bucket Uploads | versioning, old versions kept 30 days
node vault: AWS Backup vault | one snapshot a day, kept 7 days
node replica: Second bucket | S3 Replication, delete markers not replicated
edge audit -> table: Scan (TABLE_NAME: a restored table after -c table=<name>)
edge audit -> bucket: ListObjectsV2
edge table -> vault: only with -c backup=on
edge bucket -> replica: only with -c replica=on
```

The first figure shows the order the tasks run in, and the second shows what is in the stack.

The stack creates one table, one bucket, and one function. The table holds notes, attachment records, and inspection records in the same shapes as in chapters 05, 07, and 08. The bucket uses the same key format as chapter 07's image store.

There is no API and no screen. The app in this chapter is the set of tasks you run from your laptop, plus a function that reads the table and the bucket and counts where they disagree. The parts that write data import the code of chapters 05, 07, and 08 and use it unchanged.

The AWS Backup vault and the second bucket, at the bottom of the second figure, are not created unless you ask for them. Both add cost just by existing, so the stack creates them only when you name them.

## Deletion protection, replication, and backup

<!-- section: 22.not-backup -->

A setting that is said to protect data is usually one of three things, and each protects against something different.

- **Deletion protection.** Refuses the operation that deletes the table itself (`DeleteTable`). It does nothing about deleting the items in it
- **Replication.** Keeps a copy of the current state somewhere else. It helps when the place breaks
- **Backup.** Keeps past states. It helps when the data was changed by mistake

For a note deleted by accident, only the third one helps.

Replication does not help because it delivers changes faithfully, and it delivers a wrong change the same way. A DynamoDB global table sends a change made in one replica to the others asynchronously. The documentation says this typically takes less than a second. An item you deleted by mistake is gone from the other replicas a second later.

S3 replication behaves a little differently. With the current configuration format, delete markers (explained on [the next page](/en/chapters/22-recovery/build.md)) are not replicated by default, and neither is a delete that names a version. That still does not make it safe, because overwrites are replicated. If you overwrite an image with a broken one, the broken version arrives at the destination too. The old version survives there because the destination also has versioning on, but what protects the old version is versioning, not replication.

**Replication makes two copies of "now", and a backup keeps "a while ago".** The default stack of this chapter turns on two features of the backup kind, which are point-in-time recovery for the table and versioning for the bucket.

## Taking the table back in time

<!-- section: 22.pitr -->

With PITR (point-in-time recovery), DynamoDB records the changes to a table continuously, so that you can take out the state at any one past second. One line turns it on.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{table}

The restorable window reaches back at most 35 days. Its newest end is not "now". According to the documentation, it is typically about five minutes ago. `recovery:status` prints both ends (`EarliestRestorableDateTime` and `LatestRestorableDateTime`).

`deletionProtection` is off by default, because a drill stack should take its table with it when you clean up. The production setting that chapter 05 promised is what `-c protect=on` gives you. It sets `removalPolicy` to `RETAIN` and turns deletion protection on.

### A restore adds a table

The most important thing about PITR is that **a restore does not rewrite the source table. It creates a new one.**

A new table has advantages. The source table stays readable and writable during the restore, and if you don't like the result you can delete it and try again. You can look at the contents before you decide to use them.

The difficulty is that the new table is created outside the CDK stack, under a different name. The app is still reading the old table, so one more job remains between restoring the data and being able to use it. ["Cutting over" on the deploy page](/en/chapters/22-recovery/deploy.md) covers that job.

The code that builds the restore request is a function that does not call AWS.

<<< @/examples/22-recovery/src/pitr.ts{plan}

The new table's name contains the time of the request. Two attempts never collide, and later you can tell that the drill made the table. The cleanup task refuses to delete a table whose name lacks that mark.

This function refuses a time outside the restorable window and a table without PITR. AWS would answer such a request with an error anyway, but when you are in a hurry it helps to be stopped on your own machine.

### Settings that do not come along

A restored table is not a complete copy of its source. According to the documentation, the data, the indexes, and the encryption settings come along. Auto scaling, IAM policies, CloudWatch alarms, tags, streams, TTL, and the PITR setting itself do not. A different page says that deletion protection is also off by default on a restored table.

So a table restored with PITR has no PITR, and if you keep using it as it is, the next accident cannot be undone. `recovery:protect` is the task that turns PITR on for a restored table.

Two more facts are worth knowing. If you turn PITR off and on again, the restorable window starts over from that moment. And when you delete a table that has PITR enabled, DynamoDB creates one system backup and keeps it for 35 days, which is the last resort when a whole table was deleted. Both were only read in the documentation and were not tried.

### The local stand-in

DynamoDB Local has no PITR, so the tests use a table of their own that can go back in time.

<<< @/examples/22-recovery/src/memory-table.ts{memory-table}

It remembers every write together with its time, and `restoreTo` replays the writes up to a given moment into a new table. The source table is not touched. It stands in for the idea of PITR and not for DynamoDB. It reproduces neither the time a restore takes nor the five-minute lag.

The repositories of chapters 05, 07, and 08 run on top of this table, and chapter 05's contract tests for a repository pass against it unchanged. The first implementation had an `await` between a read and the write that depends on it, and the test "exactly one of two writers holding the same version wins" failed. Chapter 05's contract tests caught that mistake.
