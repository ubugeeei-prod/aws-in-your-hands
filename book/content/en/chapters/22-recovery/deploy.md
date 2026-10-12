---
title: "22 Backup: Deploy"
---

# 22 Backup: Deploy

On this page you deploy the stack to AWS, go through the drill step by step, and finally cut the function over to the restored table.

## Getting ready for AWS

<!-- section: 22.infra -->

Anything that costs money or outlives the stack is created only when you name it in the context.

<<< @/examples/22-recovery/infra/bin/app.ts{context}

This is the same approach as chapter 14's `-c store=valkey`. With nothing added, the stack creates only the table, the bucket, the function, its logs, a role, and the role's policy. A test pins the list of resource types in the default layout, and no vault, backup plan, or second bucket is in that list.

The function only reads.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{role}

The function is allowed `Scan` on the table and a listing of the bucket, and it has no permission to write. A person runs the repair from a laptop with their own credentials. The function is not built to repair whatever it finds, because right after a restore a person is still deciding what is correct.

This chapter is the first in the book to use `Scan`. Chapter 05 deliberately left `Scan` out of the role, because reading a whole table is expensive and slow. But a check that claims to have looked at every item has no other way to do it.

<<< @/examples/22-recovery/src/dynamodb-table.ts{scan}

The function itself is short.

<<< @/examples/22-recovery/src/audit-lambda.ts{handler}

Which table the function reads is decided by the environment variable `TABLE_NAME` and nothing else. The cutover later changes this variable.

### Created only when asked

`-c backup=on` adds an AWS Backup vault and a backup plan that takes one snapshot a day.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{backup}

A second backup is worth adding to PITR because it can be kept somewhere else and for longer. PITR is a feature attached to the table, and it reaches back 35 days at most. An AWS Backup snapshot is kept in a vault, which is a separate place from the table, under different permissions, and for longer. The documentation also says that the two do not replace each other and that using both is billed as both. The drill in this chapter does not use AWS Backup, and the stack only shows how to set it up.

The role that the backup plan uses gets a managed policy provided by AWS (`AWSBackupServiceRolePolicyForBackup`). CDK attaches it. A managed policy is the kind of broad permission this book has avoided all along. Even so, the AWS policy was chosen here over writing and maintaining the list of permissions that AWS Backup needs. The test checks that exactly one managed policy is attached, the one for backing up, and that the one for restoring is not mixed in.

`-c replica=on` adds a second bucket and replication into it.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{replica}

Delete marker replication stays off, and a test pins that. CDK gives the replication role a fixed name, `CDKReplicationRole`, which turned up in the synthesized template. If a role of that name already exists in the account, the deploy should collide with it.

### The types cdkd handles

The pinned version of cdkd (0.296.28) has a dedicated implementation for the seven types of the default layout (`AWS::DynamoDB::Table`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Logs::LogGroup`). It has none for `AWS::Backup::BackupVault`, `BackupPlan`, or `BackupSelection`, which go through Cloud Control API. All of this was read in the installed package, and nothing was created on AWS.

## Running the drill

<!-- section: 22.drill -->

The steps from this section on have not been run. Only the steps and the tasks have been prepared.

Decide what to measure before you start.

- **RTO (recovery time objective)** is the target for how long it may take from an accident until the service is usable again. The drill measures the time you actually took. The measurement does not end when the restore API returns. It ends when the deployed function reads the restored data and answers that nothing is broken
- **RPO (recovery point objective)** is the target for how far back you may lose data. The drill measures the length of time from the restore point to the accident, and the number of things written in that time and lost

The record is kept in a file.

<<< @/examples/22-recovery/src/drill.ts{record}

Every field starts empty. A field that stays empty means that the step was not done, and the summary does not fill it with a number.

<<< @/examples/22-recovery/src/drill.ts{summary}

A record is evidence, so a time cannot be rewritten once it is written.

### Preparation and the accident

```bash
vp run recovery:infra:deploy
vp run recovery:drill new first
vp run recovery:seed --apply
vp run recovery:status
```

`recovery:seed` writes three notes with one image each, under the owner `drill`. Without `--apply` it only shows what it would write. Every task in this chapter that changes AWS works that way.

<<< @/examples/22-recovery/scripts/context.ts{flags}

Wait until `latest restorable` in `recovery:status` has passed the time the seed printed, because until then you cannot restore to the state after the seed. Then cause the accident.

```bash
vp run recovery:drill mark first lastGoodWriteAt
vp run recovery:accident --apply
vp run recovery:verify
```

<<< @/examples/22-recovery/scripts/recovery.ts{accident}

The accident is caused by the app's own delete. Chapter 07's "deleting a note deletes its attachments" runs unchanged. The image of one more note is overwritten with bytes that are not an image. The task deletes and damages only things owned by `drill`.

The task prints the time before and the time after the accident. Record the earlier one with `recovery:drill mark first accidentAt --at <time>`.

The `recovery:verify` that follows should find the overwritten image. It will not find the deleted note, because the note is cleanly gone.

### Restoring

```bash
vp run recovery:drill mark first restoreRequestedAt
vp run recovery:restore:table --at <a time before the accident> --apply
vp run recovery:status
```

<<< @/examples/22-recovery/scripts/recovery.ts{restore-table}

Run `recovery:status` repeatedly until the new table is `ACTIVE`, then record `tableActiveAt`. That is how long the table restore took. The documentation says that the time varies with the amount of data and the number of indexes, and that no fixed completion time is guaranteed. That is why you measure it yourself.

<<< @/examples/22-recovery/scripts/recovery.ts{status}

Next, restore the bucket. Read the plan without `--apply` first, then apply it.

```bash
vp run recovery:restore:objects --at <the same time>
vp run recovery:restore:objects --at <the same time> --apply
vp run recovery:diff --table <restored table>
vp run recovery:verify --table <restored table> --frozen
vp run recovery:repair --table <restored table> --frozen
```

<<< @/examples/22-recovery/scripts/recovery.ts{diff}

Record the numbers that `recovery:diff` prints, as in `recovery:drill set first notesLost <number>`. If `recovery:verify` reports zero `broken`, you can go on. If not, read the plan of `recovery:repair`, run it with `--apply`, and check again.

To finish, set the version fence and turn PITR back on.

```bash
vp run recovery:diff --table <restored table> --fence --apply
vp run recovery:protect --table <restored table> --apply
```

## Cutting over

<!-- section: 22.cutover -->

The restored table holds the right contents, but nothing reads it yet, because the function's `TABLE_NAME` still names the old table.

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{cutover}

The function's environment variable, its IAM permission, and the stack's output are all built from the same one variable. When you pass the table's name in the context, all three change together. If you change only the environment variable in the console, the permission still names the old table, and the function stops with `AccessDenied`. A test pins that the three change together.

```bash
vp run recovery:infra:diff -c table=<restored table>
vp run recovery:infra:deploy -c table=<restored table>
vp run recovery:audit
vp run recovery:drill mark first serviceConfirmedAt
```

The diff should show only the function's environment variable, one policy statement, and the output value. No table is created or deleted. `recovery:audit` calls the deployed function and prints the name of the table it reads and the number of disagreements. If `broken` is 0 in that output, the service is back, and this is where you stop measuring the RTO.

One thing is easy to forget. If you leave out `-c table=` on the next deploy, the function goes back to the old table, which holds the data from after the accident. Put the cutover in the source and not in someone's shell history. Add `table` to the `context` in `cdk.json`, and commit it.

### To the stack, the restored table does not exist

Look at the state after the cutover from the side of infrastructure as code. The table the stack owns is the old one. It still holds the data from after the accident, and its PITR and deletion protection settings are as the source says. The restored table is outside the stack, and it appears neither in cdkd's state nor in the template.

```bash
vp run recovery:infra:drift
```

A drift check compares the values recorded in the state with the real resources. So **it reports nothing about the restored table**, because the state has nothing to compare it with. The difference that [chapter 20](/en/chapters/20-shipping.md) drew between "no difference was found" and "everything was compared and matched" appears here unchanged. Even with zero drift, the table that now carries the service is outside the check. Nobody is watching the PITR you turned on by hand or the deletion protection you forgot.

There are two ways out of this state.

One is to leave it as it is. Fix `-c table` in `cdk.json`, and manage the restored table's settings by other means. This is quick, but the table's settings stay out of the source.

The other is to bring the restored table into the stack. cdkd has `orphan`, which removes a resource from the state, and `import`, which puts an existing resource into it. Remove the old table with `cdkd orphan AihRecovery/Notes`, and put the restored one under the same logical ID with `cdkd import AihRecovery --resource <logical ID>=<restored table>`. After that, `-c table` should no longer be needed, and the drift check should see the restored table. The word is "should" because for these two commands only the help output was read. Both have `--dry-run`, so if you try them, read its output first. Once the table is imported, any setting the source declares, such as PITR being on, that the real table lacks will show as drift.

A stack managed by CloudFormation also has a way to bring existing resources into a stack. cdkd's help says its `import` follows the CDK CLI's `cdk import`. The CloudFormation mechanism was not checked.

### Choosing not to replace the table

If the cutover is too much trouble, there is a way that adds no table. You read only the deleted items from the restored table and write them back into the original table. The table's name does not change, and the stack is not touched. Data written after the accident is not lost either.

In exchange, you build the write-back tool yourself. Its writes also have to be conditional, so that they do not collide with the app that is still writing to the original table. If only a few items disappeared and you know exactly which ones, writing them back is the smaller job. If the whole table is suspect, cut over. This chapter built only the cutover, but the `returning` list of `recovery:diff` can serve as the list of candidates to write back.
