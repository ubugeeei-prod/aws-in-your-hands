---
title: "53 EFS: Costs, Pitfalls, and Cleanup"
---

# 53 EFS: Costs, Pitfalls, and Cleanup

By the end of the [previous page](/en/chapters/53-efs/local.md) the repository and the stack existed, and two local processes shared one directory. This page covers the deploy steps, backups and replication, how Cloudflare and Vercel differ, the pitfalls, and the cleanup. The cost is on the [first page](/en/chapters/53-efs.md).

## Deploying and checking

<!-- section: 53.deploy -->

The steps in this section have not been run against AWS.

Chapter 11's stack comes first. Its default layout is enough: no NAT gateway and no interface endpoints.

```bash
vp run net:infra:deploy
vp run efs:infra:diff
vp run efs:infra:deploy
```

The deploy should take several minutes. It waits for the mount targets, and then Lambda prepares its network interfaces in the VPC. According to the documentation the function is in the Pending state meanwhile and cannot be invoked.

Check with the `ApiUrl` output.

```bash
curl -s -X POST "$API_URL/notes" -H 'content-type: application/json' -d '{"title":"first note on EFS"}'
curl -s "$API_URL/notes"
```

With chapter 04's function the second line could return an empty list, because a POST and a GET that land in different execution environments see different memory. Here the same list should come back wherever a request lands. To check, send many requests at once so that there are several environments, then read the list repeatedly. Whether a note written by another environment appears in the list with a delay is something only this will show.

The settings can be read with these commands.

```bash
aws efs describe-file-system-policy --file-system-id "$FILE_SYSTEM_ID"
aws efs describe-mount-targets --file-system-id "$FILE_SYSTEM_ID"
```

The drift check is the same as in other chapters.

```bash
vp run efs:infra:drift
```

The pinned cdkd does not accept an update that changes a property of an access point. Its source gives the reason that EFS has no API for rewriting an access point, and it asks for `--replace` or for the resource to be recreated. Expect to destroy and recreate the stack when you change the path or the user ID in `src/config.ts`. The file system's encryption and performance mode cannot be changed after creation either.

## Backups and replication

<!-- section: 53.protect -->

A Regional file system keeps its data in several zones. That protects against the failure of a disk or a zone. A file deleted by mistake, or rewritten by a bug, is deleted and rewritten in every zone alike. As [chapter 22](/en/chapters/22-recovery.md) showed, redundancy is not a backup.

EFS backups are taken by AWS Backup. Enabling the file system's `BackupPolicy` puts it into the default backup plan that EFS provides, which takes a backup once a day and keeps it for 35 days. Backups are incremental, and a restore can go to a new file system or to an existing one. A file system created in the console has this on by default; a Regional file system created through the API or CloudFormation has it off.

This chapter's stack leaves backups off by default. To turn them on:

```bash
vp run efs:infra:deploy -c backup=true
```

The reason for leaving them off is cleanup. Recovery points go into the default backup vault, remain after the stack is destroyed, and keep being billed for storage. That vault's access policy also denies deleting recovery points, so the policy has to be changed before they can be removed. AWS Backup's prices were not looked up for this chapter.

The documentation also says that a backup can come out inconsistent when files change while it is being taken. With this chapter's way of writing, a note is one file and appears only through a rename, so a half-written note in a backup seems unlikely, but that was not checked.

Replication keeps copying changes to a file system in another Region (or in the same one). The documentation says it is designed for an RPO and an RTO of minutes. This chapter does not use it. The pinned cdkd says in its own source that it does not handle the file system's `ReplicationConfiguration`. Building across Regions is the subject of [chapter 28](/en/chapters/28-multi-region.md).

## If you come from Cloudflare or Vercel

<!-- section: 53.platforms -->

What follows is from the official documentation as of 2026-10-13.

Cloudflare Workers has an implementation of `node:fs`. According to its documentation it is a virtual file system in memory: `/bundle` is read-only, and `/tmp` is writable, but its contents do not persist and are separate for each request. It exists so that libraries that use temporary files within a request can run, not as a disk Workers share.

Vercel Functions, according to the documentation, have a read-only file system with a writable `/tmp` of up to 500 MB. That, too, is not described as a place shared between instances of a function.

The same Vercel page points functions to data stores. On Cloudflare, the ways to keep data across executions are the ones other chapters of this book have mentioned: R2, KV, D1, and so on. Nothing like an NFS mount shared by several functions appeared in the pages read. Only the two pages above were read; this is not a survey of everything either company offers.

On AWS, too, that is the right place for data most of the time. The application in this book was built from chapter 04 to chapter 24 without a shared file system. EFS is needed when software that demands a path has to run in several execution environments, and that is a kind of software that is hard to put on Workers or Vercel Functions in the first place. If you have none, staying with R2 or S3 costs less and leaves less to think about.

## Pitfalls

| Symptom | Where to look |
| --- | --- |
| Creating the function fails during deploy | Check that a mount target exists in the same zone as each of the function's subnets, and that the security groups of the function and the mount targets pass port 2049 |
| The function fails to mount | Check that the access point's root directory was created; without `creationInfo` it is not. Then check that the role has `ClientMount` and that the access point ARN in the condition matches. This stack's policy refuses connections without TLS, so to narrow the cause, remove that Deny for a moment and try again |
| Writes fail (permission denied) | Compare the access point's user ID with the owner and mode of the directory. If the root directory already existed, the values in `creationInfo` do not overwrite it |
| A file written by another execution environment is not visible at once | Possibly the NFS client's cache. Not measured in this chapter |
| Reads on the bill are large compared with what is stored | Check whether small files are read over and over. Elastic throughput bills even a small read at its minimum unit. Look at `MeteredIOBytes` |
| The bill went up after small files moved to IA | IA bills each file as at least 128 KiB |
| Lines in a log file are missing or mixed | Several writers append to one file. Give each writer its own file |
| EFS charges continue after the stack is destroyed | A file system kept with `dataOnDestroy=retain`, or AWS Backup recovery points, remain |
| The first invocation after a long idle period fails | According to the documentation, when a function attached to a VPC is unused for 14 days, Lambda reclaims the network interfaces and the function becomes Inactive. The next invocation fails, and the function is Pending until they are ready again |

## For production

- Keep the file system. With `-c dataOnDestroy=retain` the file system and the notes survive the stack. Turn backups on as well, and perform a restore once (chapter 22)
- Put an alarm on reads and writes. Elastic throughput has no ceiling. Alarm on `MeteredIOBytes`, and include it in the budget ([chapter 32](/en/chapters/32-limits.md))
- Take the network interface actions away from the function's code. The six permissions for the VPC can be used by the function's code too. The Lambda guide shows how to add a Deny conditioned on `lambda:SourceFunctionArn`. This chapter's stack does not include it
- Remove leftover temporary files. Add a job that deletes old files from `incoming/` at intervals
- Give each application its own access point, with its own directory and user ID, and pin the access point in the role's condition
- Do not list by reading every file. If the number of notes grows, keep the fields a list needs somewhere else (DynamoDB, for one), or stop keeping notes in files at all
- If you add an operation that updates a note, consider a database with conditional writes before building a lock on top of files

## Cleanup

<!-- section: 53.cleanup -->

```bash
vp run efs:infra:destroy
```

This deletes the file system, the mount targets, the access point, the function, the API, the role, the security groups, and the log group. The notes in the file system go with it and cannot be brought back. Everything is set to be deleted with the stack, because it is for practice.

The network interfaces Lambda created in the VPC do not go away at once. The documentation says that when a function's VPC configuration is removed, deleting them takes up to 20 minutes. If the same holds when the function is deleted, the security groups cannot be deleted during that time, and the destroy may wait or fail. That was not checked, so if it fails, wait a while and run it again. Deleting the network interfaces uses the function's role, so do not delete the role by hand first.

What remains:

- The file system, if you deployed with `-c dataOnDestroy=retain`. Storage keeps being billed. Delete it in the console or with `aws efs delete-file-system`
- AWS Backup recovery points, if you deployed with `-c backup=true`. They stay, and are billed, until their retention period ends
- Chapter 11's stack. This chapter's stack reads chapter 11's outputs, so this one goes first. After that, delete chapter 11's by its own steps if you no longer need it
- The storage that cdkd's bootstrap created (chapter 02)

## Seen as a distributed system

- Who owns the state: only the file system holds the notes. The function's memory holds nothing. In chapter 23 both the process's memory and the file held state, and they agreed because there was one process
- The invariant: a reader never sees a half-written note file
- Tests that try to break it: interruption at each step of a write, writing in place, two writers of the same note, a shared temporary file name, eight writers and one reader in parallel
- What upholds it: a separate temporary file per write, `rename` after `fsync`, and one file per note. No locks
- What is not guaranteed: that both changes survive when the same note is updated concurrently; that another environment's write is visible at once; that the limit on the number of notes is exact; that a write reported as failed was not saved
- The scope of consistency: the content of one file is all or nothing. There is no way to make a change that spans several files all or nothing. A list is the result of reading, one at a time, a set of files that grows and shrinks while it is being read
- Partial failure: when the reply is lost after the rename completed, the caller is told the write failed and the note is saved. The API answers 500, and a retry creates a second note under another ID. Avoiding the duplicate takes the idempotency key from [chapter 08](/en/chapters/08-async.md)

::: details Verification notes for this chapter

**Checked locally.** 53 tests (interruptions on a shared file system in memory; on the real local file system, writing in place, rename, notes lost by chapter 23's repository, and append; two copies of chapter 04's API on top; IDs that climb out of the directory refused; stack assertions). Type check. `efs:infra:synth` produced the templates for the default layout and for `-c dataOnDestroy=retain -c backup=true` without asking AWS anything. `dev:efs` was started on two ports, and a note posted to one appeared in the other's list. `vp check --fix` on this chapter's files reported nothing, awscdk-lint included. The tests on a real file system ran only on APFS on macOS.

**Not checked yet.** Nothing was run against AWS. In particular, the following was only read in documentation.

- Deploying the stack: creation through cdkd's EFS provider, the function finding the mount targets when it is created, and the access point's root directory being created on first mount
- That a file system policy made only of a Deny is accepted, and that Lambda can mount under it. The statement that Lambda mounts over TLS was found only in an official blog post from 2020
- Behaviour on NFS: how late another environment's write becomes visible, which mount options Lambda uses, and how appends actually break. The second append test is a model, not a copy of an NFS client's implementation
- Elastic throughput metering. "1 KiB increments after the first 32 KiB" was read as: an operation of up to 32 KiB counts as 32 KiB. Metadata operations were not counted
- That a file system created through CloudFormation without `LifecyclePolicies` gets no lifecycle policy
- Which conditions the guide's sentence about read-after-write consistency for synchronous, non-appending writes refers to
- That on destroy the security groups can be deleted once the network interfaces are gone
- Amazon S3 Files: its price, its availability in Tokyo, and the delay of synchronization. Only the overview page was read
- AWS Backup's prices
- The function's duration and the volume of logs. They are assumptions in the cost, not measurements

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture | `examples/53-efs/infra/lib/efs-stack.ts`, `src/config.ts` | `efs:infra:synth` |
| Mount targets and access points | `examples/53-efs/infra/lib/efs-stack.ts`, `src/config.ts`, `infra/test/efs-stack.test.ts` | `test:unit` |
| Performance, throughput, and storage classes | `examples/53-efs/infra/lib/efs-stack.ts`, `infra/test/efs-stack.test.ts` | `test:unit` |
| What NFS promises | `examples/53-efs/test/two-writers.test.ts` | `test:unit` |
| A write path that holds for any number of writers | `examples/53-efs/src/note-files.ts`, `src/node-dir.ts`, `test/note-files.test.ts`, `test/two-writers.test.ts` | `test:unit` |
| Mounting it in the function | `examples/53-efs/src/compose.ts`, `src/lambda.ts`, `infra/lib/efs-stack.ts`, `infra/bin/app.ts` | `test:unit`, `efs:infra:synth` |
| Two processes and one directory | `examples/53-efs/src/dev.ts` | `dev:efs`, `test:unit` |
| Deploying and checking | `examples/53-efs/infra/bin/app.ts` | `efs:infra:diff`, `efs:infra:deploy`, `efs:infra:drift` |
| Backups and replication | `examples/53-efs/src/config.ts` | `efs:infra:deploy` |
| Cost | `data/pricing/` | |
| Cleanup | `tools/src/infra/` | `efs:infra:destroy` |

**How cdkd (0.296.28) handles the resources.** Checked in `dist/` of the installed npm package. `AWS::EFS::FileSystem`, `AWS::EFS::MountTarget`, and `AWS::EFS::AccessPoint` are registered to cdkd's own EFS provider. The file system properties this stack uses (`Encrypted`, `PerformanceMode`, `ThroughputMode`, `BackupPolicy`, `FileSystemPolicy`, `FileSystemTags`) are all in the provider's list of handled properties. `FileSystemConfigs` and `VpcConfig` of `AWS::Lambda::Function` are passed through by the Lambda provider. The remaining types (`AWS::EC2::SecurityGroup` with its Ingress and Egress, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`, `AWS::ApiGatewayV2::*`) are already used by the stacks of chapters 04, 11, and 12.

**Primary sources** (all checked on 2026-10-13)

- EFS user guide: [How Amazon EFS works](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html), [Features of Amazon EFS](https://docs.aws.amazon.com/efs/latest/ug/features.html), [Performance specifications](https://docs.aws.amazon.com/efs/latest/ug/performance.html), [Quotas](https://docs.aws.amazon.com/efs/latest/ug/limits.html), [Managing storage lifecycle](https://docs.aws.amazon.com/efs/latest/ug/lifecycle-management-efs.html), [How Amazon EFS reports file system and object sizes](https://docs.aws.amazon.com/efs/latest/ug/metered-sizes.html)
- Access and encryption: [Working with access points](https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html), [Enforcing a user identity](https://docs.aws.amazon.com/efs/latest/ug/enforce-identity-access-points.html), [Enforcing a root directory](https://docs.aws.amazon.com/efs/latest/ug/enforce-root-directory-access-point.html), [Using IAM to control access to file systems](https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html), [Encrypting data in transit](https://docs.aws.amazon.com/efs/latest/ug/encryption-in-transit.html), [Encrypting data at rest](https://docs.aws.amazon.com/efs/latest/ug/encryption-at-rest.html), [Backing up EFS file systems](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)
- Prices: [Amazon EFS Pricing](https://aws.amazon.com/efs/pricing/), [AWS Price List bulk API: AmazonEFS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEFS/current/ap-northeast-1/index.json) (the offer was published on 2026-09-11; the unit prices for Lambda, API Gateway, S3, and EBS are the ones checked in chapters 04, 07, and 23)
- Lambda: [Configuring file system access for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-filesystem.html), [Configuring Amazon EFS file system access](https://docs.aws.amazon.com/lambda/latest/dg/configuration-filesystem-efs.html), [Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html), [AWSLambdaVPCAccessExecutionRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaVPCAccessExecutionRole.html), [New – A Shared File System for Your Lambda Functions](https://aws.amazon.com/blogs/aws/new-a-shared-file-system-for-your-lambda-functions/) (official blog, 2020-06-16)
- ECS and Fargate: [Use Amazon EFS volumes with Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-volumes.html), [Specify an Amazon EFS file system in a task definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specify-efs-config.html)
- S3 and EBS: [Working with Amazon S3 Files](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-files.html), [What is Amazon S3? (data consistency model)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html), [EBS Multi-Attach](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html)
- Linux manual pages: [open(2)](https://man7.org/linux/man-pages/man2/open.2.html), [rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html), [nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
- [@go-to-k/cdkd 0.296.28 (npm package)](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare: [node:fs (Workers)](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- Vercel: [Runtimes](https://vercel.com/docs/functions/runtimes)

:::
