---
title: "53 EFS: A File System Several Things Mount at Once"
sourceRevision: 1
---

# 53 EFS: A File System Several Things Mount at Once

EFS is a file system that several execution environments can mount at the same time, reading and writing the same files. Ten copies of a Lambda function running at once, or two Fargate tasks in different Availability Zones, all see the same directory. This chapter is about what follows from that: when everyone can write to the same file, what the application has to do so that the file's content stays whole.

The material is the notes from [chapter 23](/en/chapters/23-ec2.md). There, one process on one instance wrote the notes to one file on an EBS volume, and that code is correct as long as there is exactly one writer. This chapter puts the same notes on EFS, runs the API from [chapter 04](/en/chapters/04-http-api.md) on Lambda, and lets the number of writers grow. Tests first show what happens when the assumption breaks, and then the write path is changed to one that holds for any number of writers.

Nothing in this chapter's stack is billed by the hour. A file system is billed for what it stores, and an empty one costs about USD 0.000002 a month, which is 0.00 on an invoice. Storing the same gigabyte, however, costs more than 14 times what S3 charges. The breakdown is under "Cost" on this page.

The chapter builds on the VPC from [chapter 11](/en/chapters/11-network.md); its stack in the default layout is enough. The code is in `examples/53-efs/`.

## Choosing among S3, EBS, and EFS

<!-- section: 53.choice -->

So far the book has kept data in S3 ([chapter 07](/en/chapters/07-uploads.md)) and on EBS (chapter 23). EFS makes three. The names are alike, but the three look different to an application.

S3 is not a file system. It is an HTTP API that stores a whole object under a key and returns a whole object. There is no operation that rewrites part of a file, and none that renames a directory. In return, the documentation promises that a write to a key replaces the object as a whole and that a reader never receives partial content.

An EBS volume is a disk. You put the file system on it yourself (XFS in chapter 23). ext4 and XFS are built on the assumption that one machine's kernel owns the disk, so in practice one instance uses a volume. Multi-Attach, which connects a volume to several instances, exists only for io1 and io2, and the documentation tells you to use a clustered file system with it, not an ordinary one.

EFS is an NFS server that AWS operates. The file system itself lives on AWS's side, and clients ask it over the network to `open` and `rename`. That is why any number of machines can mount it at once, and why it has no size to decide in advance.

| | S3 | EBS | EFS |
| --- | --- | --- | --- |
| What the application sees | An HTTP API | A disk (you create the file system) | A mounted directory |
| Who can use it at once | Any number of machines | In practice one instance, same zone | Any number, from several zones of one Region |
| Partial rewrite, rename | No | Yes | Yes |
| 1 GB for a month (Tokyo, Standard) | USD 0.025 | USD 0.096 (gp3) | USD 0.36 |

One question picks among them: **does the code that uses the data need a file path?**

Code you write yourself usually does not. Small records such as notes belong in DynamoDB ([chapter 05](/en/chapters/05-dynamodb.md)) and large blobs such as attachments in S3; both state clearly what happens under concurrent writes, and both cost less. This chapter keeps notes in files to show what happens on files. It does not recommend EFS as the place for notes.

EFS fits when code that demands a path has to run in several execution environments. For example:

- Existing software reads and writes its configuration or data in a directory: a CMS, a build cache, a library that loads machine learning models
- Files that do not fit in Lambda's `/tmp` or Fargate's ephemeral storage, or that must outlive one execution environment
- Several tasks reading the same set of files

When one machine is enough and the data is used only on it, EBS is faster and cheaper.

As of 2026-10-13 there is one more option. The Lambda guide lists two file systems a function can mount: EFS and Amazon S3 Files. S3 Files presents an S3 bucket as a file system; according to its documentation it is built using EFS and synchronizes changes with the bucket in both directions. For this chapter only its overview page was read, and neither its price nor its availability in Tokyo was checked. If you want the data of record to stay in S3 while reading and writing by path, read its documentation first.

## Cost

<!-- section: 53.cost -->

Amounts are in USD at on-demand list prices for the Tokyo Region, before tax. Unit prices were read from the AWS Price List on 2026-10-13. The arithmetic is in [Pricing](/en/reference/pricing.md).

EFS bills for two things: what is stored, and what is read and written.

| Item | Unit price |
| --- | --- |
| Standard storage (Regional) | 0.36 per GB-month |
| Standard storage (One Zone) | 0.192 per GB-month |
| Infrequent Access storage | 0.0272 per GB-month (0.02 with Elastic throughput) |
| Archive storage | 0.01 per GB-month |
| Elastic throughput, reads | 0.04 per GB |
| Elastic throughput, writes | 0.07 per GB |
| Infrequent Access, data read or written | 0.012 per GB |
| Provisioned throughput | 7.20 per MiBps-month |

**With nothing mounted, only storage is billed.** Mount targets and access points have no SKU in the Price List, and the pricing page says there is no minimum fee or setup charge. Elastic throughput bills only the bytes read and written, so it is zero when nobody reads or writes. An empty file system is metered as the 6 KiB of its root directory, which comes to about USD 0.000002 a month.

Two settings make a file system cost more just by existing. This chapter's stack uses neither by default.

- Provisioned throughput. The provisioned amount is billed every month whether used or not: 72 a month for 10 MiBps, less the throughput included with the amount stored
- Automatic backups. AWS Backup bills for the stored backups, and the recovery points remain after the stack is gone ([Costs, Pitfalls, and Cleanup](/en/chapters/53-efs/wrap.md))

Here is one month of use: 100 notes stored, 1,000 writes, and 10,000 list requests.

| Item | Quantity | List price |
| --- | --- | --- |
| Standard storage | 0.000595 GB | 0.0002 |
| Elastic throughput, writes | 0.0305 GB | 0.0021 |
| Elastic throughput, reads | 30.5 GB | 1.2207 |
| Lambda requests | 11,000 | 0.0022 |
| Lambda duration | 275 GB-seconds | 0.0037 |
| HTTP API requests | 11,000 | 0.0142 |
| Subtotal | | **1.24** |

A little over 600 KiB is stored, yet 30 GB is read. There are two reasons. One is the unit of Elastic throughput metering. The guide says data operations are metered in 1 KiB increments after the first 32 KiB. This chapter reads that as: reading one note of a few hundred bytes counts as 32 KiB. The other is that this chapter's code reads all 100 files for every list. For listing small records, a database with an index suits better than a directory of files.

The table leaves out metadata operations (directory listings, file creation, rename, and so on). They were not counted; that does not mean they are free. The function's duration (0.1 s per request) is an assumption and was not measured. Lambda's monthly free allowance takes the two Lambda lines to zero, and the subtotal stays 1.24. The EFS pricing page describes a free tier of 5 GB for 12 months for new accounts; whether it applies to your account could not be confirmed, so nothing is deducted.

## The whole picture

<!-- section: 53.architecture -->

```figure
caption: Each execution environment of the function mounts the same directory of the same file system through the mount target in its own zone
node client: Client
node api: API Gateway | HTTP API
node fn1: Lambda environment | Private1, /mnt/notes
node fn2: Lambda environment | Private2, /mnt/notes
node mt1: Mount target | Private1, tcp 2049
node mt2: Mount target | Private2, tcp 2049
node ap: Access point | /notes-app, uid 1001
node fs: EFS file system | Regional, encrypted
edge client -> api: HTTPS
edge api -> fn1
edge api -> fn2
edge fn1 -> mt1: NFS over TLS
edge fn2 -> mt2: NFS over TLS
edge mt1 -> ap
edge mt2 -> ap
edge ap -> fs
group vpc: VPC AihNetwork (chapter 11) = fn1, fn2, mt1, mt2
mark fs
```

API Gateway hands each request to one of the function's execution environments. Requests that arrive together are handled in separate environments, and each environment is attached to one of chapter 11's two private subnets. Every environment mounts the access point at `/mnt/notes` when it starts. "NFS over TLS" in the figure rests on AWS's announcement that Lambda's mount is encrypted with TLS ([Design and Build](/en/chapters/53-efs/build.md) comes back to it).

The function in chapter 04 kept notes in the memory of each execution environment, so a note created in one was invisible from another. Here a note created in any environment can be read wherever the next request lands. In exchange, two environments may write to the same directory at the same moment.

The stack takes three settings, through a Valibot schema.

<<< @/examples/53-efs/src/config.ts{schema}

## When not to use EFS

You do not need EFS if any of these holds.

- Only your own code uses the data, and keys and values are enough. Use DynamoDB or S3
- One process writes, and one machine is enough. Use EBS as in chapter 23
- The files are scratch space needed only during one run. Lambda's `/tmp` or Fargate's ephemeral storage will do
- The work is latency-sensitive and opens files many times. Every EFS read and write crosses the network. The guide gives about 1 ms for reads and about 2.7 ms for writes, noted as best-case figures under optimal conditions. Nothing in the documentation read for this chapter allows a numeric comparison with S3 or a local disk

The rest of the chapter:

- [Design and Build](/en/chapters/53-efs/build.md): mount targets and access points, performance and storage classes, what NFS promises, a write path that does not break, the stack
- [Run It Locally](/en/chapters/53-efs/local.md): two processes and one directory, what the tests see
- [Costs, Pitfalls, and Cleanup](/en/chapters/53-efs/wrap.md): deploying, backups, Cloudflare and Vercel, cleanup, verification notes
