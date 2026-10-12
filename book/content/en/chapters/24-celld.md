---
title: "24 Self-hosting: celld on AWS"
sourceRevision: 2
---

# 24 Self-hosting: celld on AWS

In [chapter 23](/en/chapters/23-ec2.md) you took charge of one machine, operating system included. In this last chapter you use machines like that one to run a distributed system that AWS does not look after for you.

The subject is celld, an open source daemon published by Deno Land. It runs a Cloudflare Workers and Durable Objects application on your own machines and keeps the long-lived state in your own bucket. Because it is not an AWS managed service, you start it again when it stops, you decide the order of an upgrade, and you bring it back when it breaks. This chapter has you do that work on a small fleet.

This chapter also builds things that are **billed by the hour for merely existing**. One node costs about USD 2.71 a day and USD 82.56 for a month (730 hours). Three nodes cost USD 4.11 a day and USD 125.03 a month. The default configuration has zero nodes and no hourly charge, and the count goes up only when you ask for it. If you try it, get as far as [Cleaning up](/en/chapters/24-celld/wrap.md) the same day.

Nothing in this chapter has been run on AWS. The celld binary has never been run locally either. Everything the chapter says about celld comes from reading the official documentation and source of v0.6.2. What was checked locally is the infrastructure definition, the logic that decides the order of operations, and the verdict of the check. The breakdown is in the [verification notes at the end of the chapter](/en/chapters/24-celld/wrap.md).

You need [chapter 23](/en/chapters/23-ec2.md), the VPC from [chapter 11](/en/chapters/11-network.md), and the approach to recovery from [chapter 22](/en/chapters/22-recovery.md). The code is in `examples/24-celld/`.

## What celld is

<!-- section: 24.what -->

The official documentation defines three terms.

- A **cell** is a small server with a name and a SQLite database of its own. Cloudflare calls it a Durable Object. You create one per user, per document, or per chat room
- A **node** is one celld process running on one machine
- A **fleet** is the set of nodes that share a bucket. There is no joining procedure, because nodes find each other through records in the bucket

celld has no leader election and no membership service. Each cell has a small ownership record in the bucket instead. Nodes try to claim that record with a conditional write, and the one node that wins serves the cell. The bucket decides which node won.

celld promises two things. A cell is served by one node at a time, and a write that has been acknowledged is not lost. Both promises depend on a bucket that implements conditional writes and ranged reads correctly, and on a supervisor that restarts the process. Amazon S3 is one of the stores celld lists as usable. The pre-release tests, however, run against Cloudflare R2, and S3 is described as using "the same client and headers".

These were the facts when the chapter was written.

- The latest release is v0.6.2 (published 2026-10-07). The official limitations and security pages call it a **beta**
- Only the latest release receives security fixes
- There have been 11 releases in the roughly two months since the first one. What this chapter says will go out of date quickly
- A fleet runs one application. Putting code from parties that do not trust each other on the same fleet is stated to be "not safe"

When you use Durable Objects on Cloudflare, you never see a node, a bucket, or a disk. With celld you see all of them and operate all of them. This chapter did not look into Cloudflare's guarantees or prices. The only thing it compares is who does the operating.

## Pin the version, and check what you got

<!-- section: 24.pin -->

When you operate software yourself, start by pinning the version you run. The official installer is a shell script that fetches the latest release unless told otherwise. That is convenient, but the same steps install a different version depending on the day you run them.

This chapter writes the versions and the SHA-256 of each download into the repository.

<<< @/examples/24-celld/src/celld.ts{releases}

The digests are the values listed on the GitHub releases. I downloaded the archives, recomputed the digests, and confirmed that they match. v0.6.1 is included so that you can practice upgrading from an older version.

The task that downloads an archive leaves nothing behind unless both the size and the digest match.

<<< @/examples/24-celld/scripts/fetch.ts{verify}

```bash
vp run celld:fetch
```

Running the task puts the Linux arm64 archive for the nodes into `examples/24-celld/.celld/download/`. With `--host` it also fetches the binary for your own machine and the official counter example, which you need later to deploy the application. The task talks only to github.com and does not run anything it downloads.

A matching digest tells you only that the file is the same one GitHub is serving. To check that it was built by celld's CI, use the command the project documents, `gh attestation verify <file> --repo denoland/celld`. The GitHub CLI is not in the devShell, so you have to install it and run that check yourself.

## The big picture

<!-- section: 24.architecture -->

The architecture is drawn as two figures. The first shows where the nodes sit and how they talk, and the second shows who can reach which bucket.

```figure
caption: The nodes sit in private subnets with no inbound from outside, celld talks plain HTTP to its peers on :8081, and the Worker listens only on 127.0.0.1:8080 of each node
node cli: vp run celld:* | your machine
node a: node a (AZ 1) | celld :8081, Worker :8080
node b: node b (AZ 2) | celld :8081, Worker :8080
node c: node c (AZ 1) | celld :8081, Worker :8080
node va: data volume | retained
node vb: data volume | retained
node vc: data volume | retained
edge cli -> a: Run Command
edge cli -> b
edge cli -> c
edge b -> a: HTTP
edge c -> b: HTTP
edge a -> va
edge b -> vb
edge c -> vc
group vpc: VPC (chapter 11), private subnets, ap-northeast-1 = a, b, c, va, vb, vc
```

```figure
caption: The nodes can read and write only the fleet bucket, and have no access to the backup bucket
node nodes: node a, b, c | through the S3 gateway endpoint
node backup: backup bucket | s3://<bucket>/backups/, retained
node fleet: fleet bucket | s3://<bucket>/fleet/, retained
node deploy: celld deploy | S3 API from your machine
edge nodes -x backup: no access
edge nodes -> fleet
edge deploy -> fleet
```

CDK creates the buckets, the role, the security group, and as many instances and volumes as you ask for, all of which appear in the two figures. It stops there. Installing, starting, and upgrading celld happen outside CDK. As in chapter 23, this keeps a template change from rebuilding the instances. With celld there is a second reason. Which node stops when is part of correctness, so the order must not be left to whatever suits CloudFormation or cdkd.

Nothing here connects cdkd to celld. I found no statement that an official integration exists, and I did not make one up.

Settings are passed through CDK context.

<<< @/examples/24-celld/src/config.ts{schema}

`nodes` defaults to 0, so running `vp run celld:infra:deploy` on its own creates nothing that is billed by the hour.

The warning from chapter 11 applies here too. `-c` affects only the run it is given to. If you create the fleet with `-c nodes=3` and later deploy without `-c`, cdkd sets out to delete all three nodes. The data volumes stay (the [Design and Build](/en/chapters/24-celld/build.md) page explains why), but the template no longer manages them, and the next deploy with `-c nodes=3` creates new, empty volumes. Always read the output of `vp run celld:infra:diff -c nodes=3` before you deploy.

There is also a task that shows the deploy plan locally. It does not touch AWS.

```bash
vp run celld:plan nodes=3
```
