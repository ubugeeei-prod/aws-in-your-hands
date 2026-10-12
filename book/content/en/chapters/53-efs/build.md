---
title: "53 EFS: Design and Build"
---

# 53 EFS: Design and Build

The [previous page](/en/chapters/53-efs.md) compared S3, EBS, and EFS and went through the cost. This page creates the ways into a file system, establishes what NFS promises, implements a way of writing notes that survives any number of writers, and mounts the result in a function.

## Mount targets and access points

<!-- section: 53.mount -->

A newly created EFS file system cannot be reached from anywhere. You create entrances inside a VPC, and there are two levels of them.

A **mount target** is the network entrance. It holds one IP address in a subnet and listens for NFS there. You can create one per Availability Zone, and a client connects to the mount target in its own zone. A client can connect to a mount target in another zone, but cross-zone data transfer is then billed, so the rule is one in every zone you use. A file system can have mount targets in only one VPC.

Security groups attach to the mount target. This chapter's stack creates two security groups that name each other: the function can send only to port 2049 of the mount targets, and the mount targets accept only port 2049 from the function.

<<< @/examples/53-efs/infra/lib/efs-stack.ts{network}

The file system, and a mount target for each subnet:

<<< @/examples/53-efs/infra/lib/efs-stack.ts{file-system}

`encrypted` is encryption at rest, and it cannot be changed later. The console turns it on by default; through the API or CloudFormation you have to ask for it.

`fileSystemPolicy` is the setting in this stack that is easiest to overlook. A file system without any policy runs under a default policy, and according to the documentation that policy lets any client that reaches a mount target mount, read, and write without authentication. The security group is then the only protection. Attaching any policy ends the default, after which permission has to come from IAM. The policy in this stack allows nothing and only refuses connections that do not use TLS. The permission is written later, on the function's role.

An **access point** is an entrance for one application. A client that mounts through it sees one fixed directory of the file system as the root, and every operation it performs is treated as coming from one fixed POSIX user. The user ID the client claims is ignored.

<<< @/examples/53-efs/infra/lib/efs-stack.ts{access-point}

The values are kept in one place.

<<< @/examples/53-efs/src/config.ts{mount}

Without `creationInfo`, EFS does not create the directory, and mounting fails when the directory is missing, so all three values are given. A user ID of 0 (root) additionally needs the `ClientRootAccess` permission. This chapter does not use root.

When several applications share one file system, give each its own access point, with its own directory and user. By default a file system can have up to 10,000 access points.

What the mounting side needs depends on the kind of execution environment.

| | Lambda | Fargate | EC2 |
| --- | --- | --- | --- |
| Where it is declared | The function's configuration: the access point's ARN and a path starting with `/mnt/` | `efsVolumeConfiguration` in the task definition | The operating system's `mount` command, with the EFS mount helper (amazon-efs-utils) |
| Access point | Required | Optional; with one, `transitEncryption` must be `ENABLED` | Optional: `-o tls,iam,accesspoint=fsap-…` |
| IAM principal | The execution role | The task role, when `authorizationConfig.iam` is `ENABLED` | The instance profile's role; needs the mount helper |
| Encryption in transit | Not yours to set | `DISABLED` by default | Only with `tls` |
| Other conditions | Attach the function to the VPC | Platform version 1.4.0 or later | An NFS client installed |

The Fargate and EC2 columns were written from the documentation. Only Lambda is built in this chapter. To attach a volume to a Fargate task, add it to the task definition from [chapter 41](/en/chapters/41-fargate.md); to mount on EC2, add the mount command to chapter 23's user data.

About "encryption in transit" for Lambda: no statement was found in the current documentation pages. The sentence that traffic between Lambda and EFS is encrypted with TLS 1.2 comes from the official AWS blog post that announced the feature (June 2020). This stack's policy refuses connections without TLS, so if that statement no longer describes what Lambda does, the mount will fail. This has not been deployed.

## Performance, throughput, and storage classes

<!-- section: 53.modes -->

Four more things are decided when a file system is created. Here are this chapter's choices and the reasons, from the documentation as of 2026-10-13.

**The type of file system.** Regional keeps the data redundantly in several zones. One Zone keeps it in one zone at about half the storage price (0.192 per GB-month), but the data may be lost if that zone is lost, and only one mount target can be created. In Tokyo, One Zone file systems can be created in two zones, `apne1-az1` and `apne1-az4`. This chapter uses Regional. For data you can rebuild, a build cache for instance, One Zone is a candidate.

**The performance mode.** General Purpose or Max I/O, fixed at creation. The documentation recommends General Purpose for every file system. Max I/O is a previous generation with slower individual operations, and it cannot be combined with Elastic throughput or with One Zone.

**The throughput mode.** There are three.

- Elastic provisions nothing and bills the bytes read and written. It is the default the documentation recommends
- Provisioned reserves throughput in MiBps and bills it every month, used or not. It suits a load whose average is close to its peak and whose needs are known
- Bursting ties throughput to the amount stored in Standard. The baseline is 50 KiBps per GiB, and every file system gets at least 1 MiBps. With little stored, that minimum is what remains once the credits run out

This chapter uses Elastic. With a few hundred KiB stored, Bursting would have the minimum baseline of 1 MiBps, and Provisioned bills for the hours nobody uses it. The caution with Elastic is that it has no ceiling: the bill grows with every byte read and written. The documentation also recommends watching the `MeteredIOBytes` metric.

**Storage classes and lifecycle.** Files are written to Standard. With a lifecycle policy, files not accessed for a set number of days move to Infrequent Access (IA) or Archive. IA stores at one eighteenth of the Standard price, but every read is charged a data access fee, and the first byte takes tens of milliseconds to come back where Standard takes about one. Archive has a minimum storage duration of 90 days.

This chapter's stack sets no lifecycle policy, because of the size of the files. IA and Archive bill each file as at least 128 KiB. A note fits in 4 KiB, so the unit prices give this:

```text
kept in Standard   (2 KiB + 4 KiB) x 0.36           = 2.16
moved to IA        2 KiB x 0.36 + 128 KiB x 0.02    = 3.28
```

The numbers are relative, KiB multiplied by the per-GB price as it stands, not amounts of money.

Moving a small file to IA makes it cost more. By the same arithmetic, storage in IA becomes the cheaper of the two for files with more than 4 KiB of data (reading them is charged separately). For files of several megabytes kept for a long time, a lifecycle policy is worth having. The documentation gives the lifecycle defaults as 30 days to IA and 90 days to Archive. When you create a file system for many small files in the console, consider whether to remove that setting. That a file system created through CloudFormation without `LifecyclePolicies` gets no policy was not checked against a real account.

## What NFS promises

<!-- section: 53.semantics -->

A directory mounted from EFS is read and written through the same API as a directory on a local disk. The differences are that another machine has the same files open, and that every operation crosses a network. From the documentation and the Linux manual pages, here is what you can rely on and what you cannot.

You can rely on three things.

The first is **close-to-open consistency**. The EFS guide says it provides the close-to-open consistency semantics that applications expect from NFS. Once one client has closed a file, another client that opens it sees what was written. The manual page of the Linux NFS client describes this as checking with the server when a file is opened and sending changes when it is closed.

The second is **when a write becomes durable**. A write to a Regional file system is stored across several zones when the application calls `fsync`, or when it closes the file. Before that, it may exist only in the client's memory.

The third is that **rename is one operation**. A `rename` within one file system replaces an existing file of the same name in a single operation. No other process ever finds the name missing.

You cannot rely on four things.

- **The content of a file that is still open.** Close-to-open promises something only for an open that follows a close. When one client reads a file another client is in the middle of writing, how much it sees is undefined. A client caches file attributes for seconds to tens of seconds (by default on Linux, 3 to 60 seconds for files and 30 to 60 for directories). The documentation read for this chapter does not say which mount options Lambda uses
- **Locks.** Every lock on EFS is advisory. Reads and writes by a process that did not take the lock go ahead. Locks work only when every program takes them by the same convention. A single file can carry at most 512 locks across all clients
- **Append.** The `open(2)` manual page says that a file may be corrupted when several processes append to it at once on NFS. NFS has no "write at the end" operation, and the client has to simulate one. Two functions appending lines to one log file can end up with lines overlapping or cut short
- **The outcome of a failed rename.** The `rename(2)` manual page says that on NFS a rename that reports failure may in fact have happened. The reply may simply not have arrived

The EFS guide also has one sentence saying that applications that perform synchronous data access and non-appending writes have read-after-write consistency. Which combination of mount options and calls that refers to could not be worked out. The design in this chapter relies on close-to-open and on rename, and on nothing more.

## A write path that holds for any number of writers

<!-- section: 53.write-path -->

The invariant of this chapter is: **a reader never sees a half-written note file.** The ways it breaks come first. The tests run on a real local file system, and the two writers are two file handles in one process.

Rewriting a file in place does this:

<<< @/examples/53-efs/test/two-writers.test.ts{torn}

`writeFile` empties the file and then writes the content; large content is written in several pieces. A reader in between sees an empty file or a JSON document that stops partway. This is not peculiar to NFS: it happens on a local disk as well. On NFS the writer and the reader are on different machines with a network between them, so the window is longer.

Chapter 23 solved this with rename. It writes the new content to `notes.json.next`, calls `fsync`, and renames the file to `notes.json`.

<<< @/examples/23-ec2/src/file-notes.ts{storage}

With one writer this is correct. Run the same code in two processes, and it breaks in two places.

<<< @/examples/53-efs/test/two-writers.test.ts{chapter-23}

The first test follows from the design of chapter 23's repository. A process holds all the notes in memory and replaces the whole file with its memory on every write. With two processes, the one that writes later replaces the file without knowing about the note the other wrote. A note that was acknowledged as saved disappears. The file itself is never damaged. Rename does what it promises; what broke is the assumption of a single writer, which the comment in chapter 23's code states.

The second test is about the name of the temporary file. Both writers write to the same `notes.json.next`, so the file one of them renames holds what the other wrote.

The repair comes down to three rules.

1. One note, one file. With everything in one file, every write conflicts with every other. With a file per note, only writes to the same note do
2. A different temporary file name for every write, so that writers never step on each other's temporary files
3. No state in memory. Every read goes to the file system, the only fact all the writers share

The operations are chapter 23's four, plus three.

<<< @/examples/53-efs/src/note-files.ts{ops}

Two directories are used. `notes/` holds only finished files; files being written are in `incoming/`. Both are under the same access point, which means on the same file system: `rename` is a single operation only within one file system. Writing to Lambda's `/tmp` and moving the file over is not an option.

<<< @/examples/53-efs/src/note-files.ts{layout}

`note` checks the ID because the ID comes from the URL. Chapter 04's router decodes the path, so the ID in `GET /notes/..%2Fsecret` is `../secret`. A string that is harmless as a key of a `Map` in memory points outside the directory once it is put into a path.

The repository:

<<< @/examples/53-efs/src/note-files.ts{repository}

Inside `put`, the one change a reader can see is the `rename`. Before it the old file is visible, after it the new one. `writeDurably` is chapter 23's implementation unchanged: it writes, calls `fsync`, then closes. On EFS that is the point where the content is stored across zones. Because storing is finished before the rename, the content is complete at the moment it gets its name.

The tests read from a second repository each time the writer is about to take a step. They also cover two writers replacing the same note at once, and eight writers running truly in parallel.

<<< @/examples/53-efs/test/two-writers.test.ts{whole}

The operations on the real file system are chapter 23's `nodeFiles` with three additions.

<<< @/examples/53-efs/src/node-dir.ts{node-dir}

What this design does not protect should be just as clear.

- **Concurrent updates of the same note.** When two writers replace the same note, the one that renames later stays and the other is gone as a whole. Nothing is mixed, but one change is lost. Chapter 04's API has no operation that updates a note, and every write gets a new UUID as its ID, so it does not happen in this chapter. An operation that reads and then rewrites needs a lock, or a database with conditional writes (chapter 05)
- **The limit on the number of notes.** `put` counts the files and then writes. Two writers that count at the same moment just under the limit both get in. The limit is a brake on the bill, not a guarantee of an exact count
- **Temporary files left behind.** If a writer's process is killed in the middle of a write, a file stays in `incoming/`. Readers never look there, so it does no harm, but nothing removes it
- **The outcome of a failed write.** When `put` throws, the note is not necessarily unsaved. The rename may have completed and only the reply been lost. The caller receives a 500 and can try again with the same content

For append there are three tests.

<<< @/examples/53-efs/test/two-writers.test.ts{append}

The first confirms that on the local file system all 100 lines appended by two writers survive, because locally the kernel moves to the end and writes as one operation. The second is a model, not NFS. It reproduces on a local file what happens when a client finds the end of the file and writes at that position as two separate steps. It does not claim that a real NFS client works this way; it shows what kind of damage the manual page's warning is about. The third is the repair: with one file per writer, appends do not compete at all.

## Mounting it in the function

<!-- section: 53.function -->

The function's role is allowed three things.

<<< @/examples/53-efs/infra/lib/efs-stack.ts{role}

`ClientMount` is a read-only mount, and `ClientWrite` is writing. The condition on `elasticfilesystem:AccessPointArn` narrows both to connections through this access point. This role cannot mount the root of the file system directly.

Only the last statement has `*` as its resource. For a function attached to a VPC, Lambda creates network interfaces. It uses the function's role to do so, and the documentation says to allow these six on all resources.

<<< @/examples/53-efs/infra/lib/efs-stack.ts{vpc-actions}

Attaching the AWS managed policy `AWSLambdaVPCAccessExecutionRole` would do the same, but that policy also carries log permissions, which would widen the ones chapter 04 narrowed. So the six are written out.

The function is attached to chapter 11's private subnets.

<<< @/examples/53-efs/infra/lib/efs-stack.ts{function}

CDK's `lambda.Function` has a `filesystem` property that takes an access point and adds the permissions to the role as well. It is not used here because one of the statements it adds has `Resource: "*"`. The stack writes the CloudFormation property directly and adds the dependency on the mount targets itself. Lambda checks the mount targets when it creates the function, so the order matters.

A function attached to a VPC can connect only to what the VPC can reach. Chapter 11's private subnets have no route to the internet, so all this function can reach is the mount targets. Logs do not travel through the function's network: the Lambda service sends them to CloudWatch Logs. No NAT gateway and no VPC endpoint is added.

The function's code hands the directory repository to chapter 04's application, and that is all.

<<< @/examples/53-efs/src/compose.ts{compose}

<<< @/examples/53-efs/src/lambda.ts{handler}

`NOTES_DIR` is read from the environment.

<<< @/examples/53-efs/src/compose.ts{env}

The entrance is the same HTTP API as in chapter 04. Anyone can POST, and everything written is billed as storage, so the same throttling applies.

<<< @/examples/53-efs/infra/lib/efs-stack.ts{api}

Settings are passed as context at deploy time.

<<< @/examples/53-efs/infra/bin/app.ts{context}

The stack's tests check that the policy allows nothing, that the security groups pass only port 2049, that the role has these three statements and no others, that the template contains no resource type billed by time, and that the resource types and properties in use are within what the pinned cdkd handles.

The [next page](/en/chapters/53-efs/local.md) runs all this locally.
