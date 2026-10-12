---
title: "22 Backup: Costs, Pitfalls, and Cleanup"
---

# 22 Backup: Costs, Pitfalls, and Cleanup

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
