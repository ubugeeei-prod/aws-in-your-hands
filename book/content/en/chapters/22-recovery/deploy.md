---
title: "22 Backup: Deploy"
---

# 22 Backup: Deploy

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
