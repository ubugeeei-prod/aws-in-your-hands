---
title: "66 Distributed SQL: Self-Hosting a Distributed Database on EC2"
sourceRevision: 2
---

# 66 Distributed SQL: Self-Hosting a Distributed Database on EC2

[Chapter 13](/en/chapters/13-sql.md) rented a distributed database, Aurora DSQL. This chapter runs a database of the same kind on three EC2 instances of your own, to see what the rent was paying for.

The database is YugabyteDB. PostgreSQL clients connect to it as they are, so chapter 13's migrations, its repository, and the loop that retries commit conflicts are used without changing a line. What changes is who looks after the database. Restarting a node that stopped, deciding the order of an upgrade, handing out certificates, and taking backups all become your work.

This chapter, too, creates **things that are billed by the hour for existing**. Three nodes cost about USD 6.40 a day and USD 194.66 a month (730 hours) without a single query. The default configuration has no nodes, and you get them only with `-c nodes=3`. Go on to the [cleanup](/en/chapters/66-distributed-sql/wrap.md) the same day you try it.

Nothing in this chapter was run on AWS. Instead, the YugabyteDB binary was downloaded to a Mac and a three-node cluster ran for real on `127.0.0.1`. Chapter 13's code ran against it unchanged, one node was stopped, then two, and what happened is recorded. What was seen locally and what was only read in documentation is itemized in the [verification notes](/en/chapters/66-distributed-sql/wrap.md).

You need [chapter 13](/en/chapters/13-sql.md), the VPC of [chapter 11](/en/chapters/11-network.md), EC2 and volumes from [chapter 23](/en/chapters/23-ec2.md), the fleet operations of [chapter 24](/en/chapters/24-celld.md), and the thinking about recovery from [chapter 22](/en/chapters/22-recovery.md). The code is in `examples/66-distributed-sql/`.

## Which database

<!-- section: 66.choice -->

There are three candidates: CockroachDB, TiDB, and YugabyteDB. On 2026-10-13 the text of each license and the official documentation were read and compared.

YugabyteDB was chosen for two reasons. The first is the license. According to `LICENSE.md` in its repository, the database itself is under the Apache License 2.0, and running it yourself in production takes no key and no application. A commercial license is needed for the management tool, YugabyteDB Anywhere, which this chapter does not use. The second is PostgreSQL compatibility. YugabyteDB's SQL layer (YSQL) uses PostgreSQL 15 code, and the local cluster introduced itself as `PostgreSQL 15.12-YB-2025.2.7.0-b0`. Chapter 13's `pg` and its SQL work as they are.

CockroachDB also speaks the PostgreSQL wire protocol (version 3.0). Its current license (the CockroachDB Software License), however, limits what may run without a license key to non-production development environments and to a database on a single node. A cluster without a key is limited to five concurrent open transactions after seven days. There is a free key (Enterprise Free) for businesses with less than 10 million dollars in annual revenue, on condition that telemetry is sent. If you meet the revenue condition and accept applying for a key and sending telemetry, CockroachDB is on equal footing. In that case, count in your estimate that its documentation strongly recommends no fewer than 4 vCPUs per node.

TiDB is under the Apache License 2.0, but the protocol it speaks is MySQL's. Chapter 13's code cannot be used. Its smallest production layout also has more parts: two TiDB servers, three PD, and three TiKV. If the application was written for MySQL, TiDB is the first candidate.

The version is pinned to the latest of the long-term support series (v2025.2) at the time of reading: 2025.2.7.0, released on 2026-10-05.

<<< @/examples/66-distributed-sql/src/yugabyte.ts{release}

The SHA-256 values are those in the `.sha` files the vendor publishes next to each archive. The archive for the Mac was downloaded, and its computed digest matched. The archive for the EC2 nodes (el8-aarch64, about 480 MB) was not downloaded. Its value is only copied from what is published.

## The whole picture

<!-- section: 66.picture -->

```figure
caption: One node in each of three zones. Any node takes SQL, and the leader of each tablet copies writes to the other two
node app: Application | client security group
node a: Node a | zone 1
node b: Node b | zone 2
node c: Node c | zone 3
node s3: S3 bucket | artifacts/, backups/
node ssm: Session Manager
edge app -> a: SQL over TLS, 5433
edge a -> b: Raft, 7100 and 9100
edge a -> c: Raft, 7100 and 9100
edge a --> s3: backups
edge ssm -> a: no inbound port
group vpc: VPC, private subnets = a, b, c
mark a
```

The figure draws its arrows to node a only, but the three are equals. Every node accepts SQL connections, reaches S3, and can be entered through Session Manager. The leader is not fixed either. A table is divided into pieces called tablets, each tablet has three copies, and one of the three is its leader. It is normal for the leader of one tablet to be on node a and the leader of another on node b.

The nodes are in chapter 11's private subnets, with no public IP and no port reachable from outside. An application reaches the SQL port (5433) only if it is in the client security group. Traffic between nodes (7100 and 9100) is accepted only from members of the node security group. Both kinds of traffic use TLS, with certificates signed by a certificate authority that exists for this cluster alone.

There is no load balancer. Any node takes the same SQL, so the client keeps three addresses and, in a few lines of its own, moves to the next when one does not connect. A Network Load Balancer in front is another way to build it, at the price of one more part billed by the hour.

## The invariants

<!-- section: 66.overview -->

This chapter checks two invariants.

- A write that was acknowledged survives the loss of one node, and is never visible and then gone
- A transaction conflict reaches the client as a retryable error (SQLSTATE `40001`), and chapter 13's retry loop handles it

The first is kept by YugabyteDB, not by this chapter's code. What this chapter's CDK and scripts are responsible for is not breaking its premises: three copies in three zones, never two nodes stopped at once, never three disks thrown away at once, and clocks kept in step.

Both were checked for real on the local cluster. With node b killed by SIGKILL, the two remaining nodes returned all 40 acknowledged notes and went on accepting writes. With two nodes down, the one left did not acknowledge a write in 20 seconds, and with the two back, all 40 acknowledged notes were still there. Twelve creates sent at once through three nodes against a quota of 3 stopped at 3 created, with between 4 and 29 retries after `40001` depending on the run. The detailed record is on the [Run It Locally](/en/chapters/66-distributed-sql/local.md) page.

## When not to run it yourself

<!-- section: 66.when-not -->

Almost always, you should not.

By price alone, a small load does not justify it. Computed for 10 writes and 90 reads a second over a month, Aurora DSQL comes to USD 68.65 and this chapter's three nodes to USD 196.77 (both rest on assumptions, itemized on the [costs page](/en/chapters/66-distributed-sql/wrap.md)). And that figure leaves out the time of the person who gets up when a node stops at night. With Aurora DSQL, upgrades, node replacement, backups, and clock synchronization were inside the price.

All the more so if you are on Cloudflare or Vercel. Cloudflare's D1 is a serverless database that Cloudflare operates, priced by queries and storage. Vercel has you provision a database through its Marketplace from providers such as Neon and Supabase (both checked in their documentation on 2026-10-13). If renting is not causing you trouble, keep renting.

What does make a case for running it yourself is something like the following.

- You want to decide the version and the timing of upgrades: to stay on one version, or to use a particular extension
- Where the data sits must be decided by zone or by machine (regulation, contracts)
- A team that already operates this database exists
- The load is large and steady. If you can use the machines fully, there is a point past which this is cheaper than paying per use. Where that point lies is something only measurement under your real load can tell

If none of these applies, read this chapter to look inside what you were renting. The next page goes through how YugabyteDB works, in the words chapter 13 used.
