---
title: "24 Self-hosting: celld on AWS"
sourceRevision: 1
---

# 24 Self-hosting: celld on AWS

In [chapter 23](/en/chapters/23-ec2.md) you took on one machine, operating system and all. In this last chapter you run a distributed system on machines like that one, a system AWS does not look after for you.

The subject is celld. It is open source from Deno Land: a daemon that runs a Cloudflare Workers and Durable Objects application on your own machines and keeps the long-term state in your own bucket. It is not an AWS managed service. When it stops, you start it. When it needs an upgrade, you decide the order. When it breaks, you bring it back. This chapter lets you feel what that means on a small fleet.

Money first. This chapter, too, builds things that are **billed by the hour for merely existing**. One node costs about USD 2.71 a day and USD 82.56 for a month (730 hours). Three nodes cost USD 4.11 a day and USD 125.03 a month. The default layout has zero nodes and no hourly charge; the count only goes up when you ask for it. If you try it, get to "Cleaning up" the same day.

And one more thing, said plainly. Nothing in this chapter has been run on AWS. The celld binary has never been run on my machine either. Everything said about celld comes from reading the official documentation and source of v0.6.2. What was checked locally is the infrastructure definition, the logic that decides the order of operations, and the judge of the check. The breakdown is at the end of the chapter.

You need [chapter 23](/en/chapters/23-ec2.md), the VPC from [chapter 11](/en/chapters/11-network.md), and the way of thinking about recovery from [chapter 22](/en/chapters/22-recovery.md). The code is in `examples/24-celld/`.

## What is celld?

<!-- section: 24.what -->

Let's borrow the official description.

- A **cell** is a small server with a name and a SQLite database of its own. In Cloudflare's words, a Durable Object. You make one per user, per document, per chat room
- A **node** is one celld process on one machine
- The nodes that share one bucket are a **fleet**. There is no join step. Nodes find each other through records in the bucket

The interesting part is what it leaves out: no leader election, no membership management. Each cell has a small ownership record in the bucket. A node goes for it with a conditional write, and the one node that wins serves that cell. The bucket decides who won.

celld makes two promises. Exactly one node serves a cell at a time. And a write that was answered is never lost. Both come with conditions: the bucket must implement conditional writes and ranged reads correctly, and a supervisor must restart the process. Amazon S3 is one of the stores celld lists as qualified. The release tests, though, run against Cloudflare R2; S3 is described as using "the same client and headers".

Here are the facts as of the day this chapter was researched.

- The latest release is v0.6.2 (published 2026-10-07). The official limitations and security pages call it a **beta**
- Only the latest release receives security fixes
- Eleven releases came out in about two months from the first one. What this chapter says will age quickly
- One fleet runs one application. Running code from parties that do not trust each other in one fleet is explicitly "not safe"

If you use Durable Objects on Cloudflare, you never see a node, a bucket, or a disk. Here you see all of them, and all of them are your job. I did not look into Cloudflare's own guarantees or prices for this chapter. The only comparison made is who does the operating.

## Pin the version, and check what you got

<!-- section: 24.pin -->

With software you operate yourself, the first thing to fix in place is which software it is. The official installer is a shell script that fetches the latest version unless told otherwise. Handy, and tomorrow it installs something else.

This chapter writes the version, and the SHA-256 of each published archive, into the repository.

<<< @/examples/24-celld/src/celld.ts{releases}

The digests are the ones published on the GitHub release, and they were confirmed against digests computed from the downloaded archives. v0.6.1 is there too, so that you have something older to upgrade from later.

The task that downloads keeps nothing unless the size and the digest match.

<<< @/examples/24-celld/scripts/fetch.ts{verify}

```bash
vp run celld:fetch
```

The Linux arm64 archive for the nodes lands in `examples/24-celld/.celld/download/`. With `--host` it also fetches the binary for your own machine and the official counter example (you will use those to deploy an application). The task talks to github.com and nothing else, and it runs nothing it downloads.

A matching digest only says "the same thing that is on GitHub". Whether that thing was built by celld's CI is what the officially suggested `gh attestation verify <file> --repo denoland/celld` tells you. The GitHub CLI is not in the devShell, so that part is yours.

## The big picture

<!-- section: 24.architecture -->

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

CDK stops here: the buckets, the role, the security group, and as many instances and volumes as you asked for. Installing celld, starting it, upgrading it: all of that lives outside CDK. The reason is the same as in chapter 23, where you did not want every template change to rebuild the instance. With celld there is one more: which node stops when is part of being correct. You do not want CloudFormation or cdkd to pick that order for its own reasons.

By the way, there is no integration between cdkd and celld here. I found nothing saying that one officially exists, so I did not invent one.

Settings arrive through CDK context.

<<< @/examples/24-celld/src/config.ts{schema}

`nodes` defaults to 0. Typing just `vp run celld:infra:deploy` creates nothing that is billed by the hour.

Here is the warning from chapter 11 once more. `-c` only applies to the run it is given on. Create the fleet with `-c nodes=3`, forget the `-c` on a later deploy, and cdkd goes off to delete all three nodes. The data volumes stay (next section), but they fall out of the template's care, and the next deploy with `-c nodes=3` creates new, empty volumes. Before every deploy, look at `vp run celld:infra:diff -c nodes=3`.

There is also a task that shows the plan locally. It does not touch AWS.

```bash
vp run celld:plan nodes=3
```
