---
title: "22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup"
sourceRevision: 1
---

# 22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup

[Chapter 05](/en/chapters/05-dynamodb.md) said "getting back data you deleted by mistake is chapter 22" and moved on. [Chapter 07](/en/chapters/07-uploads.md) left the same homework for the image bucket. This is where we do it.

What we build is a recovery drill. You delete notes and images on purpose, bring them back, and write down how long it took and what you lost. For that there is a stack, one task per step, and a form to fill in.

The heart of the chapter is not the restore itself but what comes after. The table and the bucket are restored by different mechanisms, to different moments. Right after a restore, the two usually disagree. Finding that, and fixing it, is most of what follows.

One thing up front, honestly. On the author's side, no restore has ever been run against AWS. The steps and tasks are there in runnable form, but you won't find a single measured number, such as a recovery time, anywhere in this chapter. Measuring is your part. What was checked locally is the other half: detecting and repairing the disagreement.

You need chapters 05 and 07. The inspection records of [chapter 08](/en/chapters/08-async.md) show up too, so having read it helps. The code is in `examples/22-recovery/`.

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
