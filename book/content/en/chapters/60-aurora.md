---
title: "60 Aurora: PostgreSQL with Storage and Compute Apart"
sourceRevision: 1
---

# 60 Aurora: PostgreSQL with Storage and Compute Apart

Aurora is PostgreSQL with the storage that holds the data and the instances that run SQL made into separate parts. The data lives in one volume replicated across three Availability Zones, and an instance is only a computer that reads and writes that volume. Fast failover, readers you can add in a moment, and compute that shrinks to zero while nobody uses it all follow from that split.

In exchange, the moment an instance is replaced is yours to handle. Connections drop, and the application cannot tell what became of a transaction that was running. This chapter goes through how Aurora works and then builds a way of writing that does not corrupt data when that happens. The invariant it keeps: a transaction interrupted by a failover is either committed or retried whole, never half applied and never applied twice.

[Chapter 13](/en/chapters/13-sql.md) chose Aurora DSQL as the database of the notes API and only compared Aurora in a table. This chapter continues from there and reuses chapter 13's schema, migrations, and PGlite tests. What RDS and Aurora share, such as parameter groups, maintenance, backups, RDS Proxy, and IAM authentication, belongs to [chapter 59](/en/chapters/59-rds.md) and is not repeated here. The network is the VPC of [chapter 11](/en/chapters/11-network.md). The code is in `examples/60-aurora/`.

First, the price. **This chapter's stack costs money just by existing.** It is set so that the instance pauses after five minutes without a connection, and a month spent entirely paused costs USD 0.52, for 1 GB of storage and one secret. If it never pauses, for example because one connection was left open, the 1 ACU maximum runs for 730 hours and the month costs USD **110.02**. These are list prices in the Tokyo Region, broken down on the [costs page](/en/chapters/60-aurora/wrap.md). The chapter 11 VPC is billed separately. When you are done, remove the stack with `vp run aurora:infra:destroy`.

## The whole picture

<!-- section: 60.architecture -->

```figure
caption: The data is in a cluster volume that spans three Availability Zones; instances only read and write it and hold no data
node app: Application
node cep: Cluster endpoint | DNS name of the current writer
node rep: Reader endpoint | DNS name of one of the readers
node writer: Writer | the one instance that takes writes
node reader: Reader | 0 to 15, read-only
node volume: Cluster volume | 6 copies in 3 Availability Zones
edge app -> cep: reads and writes
edge app -> rep: reads only
edge cep -> writer
edge rep -> reader
edge writer -> volume: writes synchronously
edge reader -> volume: reads the same volume
group cluster: Aurora DB cluster = cep, rep, writer, reader, volume
mark volume
```

An RDS for PostgreSQL instance has a disk of its own. Add a replica, and the primary's data flows to the replica's disk: there are as many copies of the data as there are instances.

In Aurora the data is in one virtual volume, the cluster volume. When the writer writes, Aurora replicates the data synchronously to six storage nodes in three Availability Zones. That replication has nothing to do with the number of instances: with a single instance, the six copies are still made.

An instance has one of two roles. The writer is the one instance that accepts writes, and a reader is a read-only instance that reads the same volume. You can add up to 15 readers. Adding one copies no data, so it is quick and adds nothing to the storage bill. The pages a reader holds in memory do catch up with the writer asynchronously, though. `ReplicaLag`, the measure of a reader's delay, is for Aurora PostgreSQL how far the reader's page cache is behind the writer's.

What the word cluster refers to is the volume and the endpoints of the next section. A cluster has no compute of its own. In CDK that distinction becomes two kinds of resource.

```figure
caption: This chapter's stack. The cluster and its instance are in private subnets, and SQL from a laptop goes through the Data API
node laptop: Laptop | vp run aurora:db:schema, aurora:smoke
node dataapi: RDS Data API | HTTPS, authorized by IAM
node secret: Secrets Manager | password made and rotated by Aurora
node cluster: DBCluster | Aurora PostgreSQL, 0 to 1 ACU
node writer: DBInstance | db.serverless, writer
node sg: Security group | no inbound rule
edge laptop -> dataapi: SQL and parameters
edge dataapi -> secret: reads the credentials
edge dataapi -> writer: runs the SQL
edge cluster -> writer: sets the capacity range
group vpc: Private subnets of the chapter 11 VPC = cluster, writer, sg
group stack: AihAurora = cluster, writer, sg, secret
mark cluster
```

The chapter builds the smallest configuration. There is one instance, the writer, with an Aurora Serverless v2 capacity range of 0 to 1 ACU. The cluster is in private subnets and its security group lets no connection in. From a laptop you use the RDS Data API, which takes SQL over HTTPS. The Data API and Serverless v2 are explained on the [Design and Build](/en/chapters/60-aurora/build.md) page.

Even with one instance, the data is in three Availability Zones. The running computer, however, is in only one. That difference is the subject of the next two sections.

## Endpoints

<!-- section: 60.endpoints -->

Instances get replaced, so an application connects to a DNS name that stands for a role, not to the name of an instance. That name is an endpoint.

| Endpoint | Points at | Used for |
| --- | --- | --- |
| Cluster endpoint | The current writer | Writes, and reads right after a write |
| Reader endpoint | One of the readers | Reads that may be slightly stale |
| Custom endpoint | A set of instances you choose. Up to five per cluster | Sending reports to the large readers only, for example |
| Instance endpoint | One particular instance | Diagnosis. It does not move on a failover |

The reader endpoint balances connections, not queries. Keep one connection open and all of its queries go to the same reader. In a cluster with no reader at all, the reader endpoint points at the writer, and writes go through. This chapter's stack is such a cluster.

A read from a reader may not show what you wrote a moment ago, because a reader catches up with the writer asynchronously. Sending the reads that must show a user their own write to the cluster endpoint is the same idea as with chapter 59's read replicas, and is left to that chapter.

An endpoint is a DNS name, so when what it points at changes, a client does not notice until it resolves the name again. The AWS documentation says that the IP address behind the cluster endpoint changes when a failover promotes a new writer, and that with connection pooling you should be prepared to flush cached DNS information or shorten its time-to-live. Otherwise you may try to open a read/write connection to an instance that is gone, or that is now read-only. Updating an endpoint's DNS record is said to typically take less than 30 seconds.

## Failover, and what the application must do

<!-- section: 60.failover -->

When the writer stops working, Aurora provides a new one. How depends on whether there is a reader.

- With a reader, Aurora promotes one of them to writer. Reads and writes fail with an exception meanwhile. According to the AWS documentation, service is typically restored in less than 60 seconds, and often in less than 30
- Without a reader, Aurora recreates the writer in the same Availability Zone. This is said to typically take less than 10 minutes
- In a cluster with a single instance, if that whole Availability Zone goes down, Aurora does not create an instance in another zone for you. You create it yourself

In every case, committed data is not lost: the data is in the volume in three Availability Zones, not in the instance. What is lost is what was in the instance's memory, which means the connections and any transaction that was in the middle of committing.

The way to shorten a failover is to keep one reader in another Availability Zone. Readers have a promotion priority from 0 to 15, and the lowest number is chosen first. This chapter's stack has no reader, so a failure of the writer is an outage measured in minutes. That is enough for practice and is not a production configuration.

From the application, a failover happens in this order.

```figure
caption: When the connection drops after COMMIT was sent, the application cannot tell whether the commit happened
type: sequence
actor app: Application
actor old: Old writer
actor new: New writer
step app -> old: BEGIN, UPDATE
step app -> old: COMMIT
note old: fails; no answer is sent
step old --x app: the connection drops
note new: promoted from reader
step app -> new: resolve the name and connect
step app -> new: is that change in?
```

The application has three things to do.

The first is to throw the broken connection away and connect again. A connection pool must not reuse a connection that errored. As the previous section said, a connection may also still be attached to an instance that has become read-only, so a connection whose write was refused with a read-only error is thrown away too. A new connection starts by resolving the endpoint's name.

The second is to tell errors apart. Whether the database refused a statement or no answer came back decides what to do next.

<<< @/examples/60-aurora/src/failure.ts{classify}

Everything except `other` means the same thing: this attempt did not finish, so start it again from the beginning. The SQLSTATE values were chosen from PostgreSQL's list of error codes. Which codes Aurora really sends during a failover was not observed for this chapter. When a socket closes in the middle of a query, node-postgres reports an `Error` with no SQLSTATE, so the adapter wraps it in a `ConnectionLostError`. Nothing is decided from the text of an error message.

The third is the centre of this chapter. As the last arrow of the figure shows, when the connection drops after `COMMIT` was sent, the application cannot know whether the change went in. If it did not, the work must be retried; if it did, it must not be. Chapter 13's retry handled only the case where the database answered `40001`, "this did not go in", so retrying was safe. With no answer at all, the same approach is not enough. The [Design and Build](/en/chapters/60-aurora/build.md) page solves it with an idempotency key.

With RDS Proxy in front of the cluster, the proxy keeps the application's connections and routes them to the new writer, bypassing DNS caches as well. The documentation says this can reduce failover times by up to 66%. The transaction that was running is still lost, so the third task remains. RDS Proxy itself belongs to chapter 59.

## What the separate storage makes possible

<!-- section: 60.features -->

The chapter does not build these, but here is what each feature that comes from the same split is for.

**Clones.** A clone of a cluster is a new cluster that starts by sharing its source's data pages. No data is copied when it is created; a page is held separately only once either side changes it. Storage for the shared pages is billed to the source cluster only. You can try a schema change on production data, or run a heavy report on an instance that is not production's. Up to 15 clones are copy-on-write, and the next one is a full copy. A clone cannot be created in another Region. A clone needs instances of its own, so its compute is billed separately.

**Global Database.** You write in one Region, and the storage layer replicates to up to 10 others, with a delay said to be typically under a second. Only the primary Region accepts writes. The thinking behind multi-Region designs is in [chapter 28](/en/chapters/28-multi-region.md). A cluster that is part of a global database no longer auto-pauses.

**Zero-ETL.** An integration that replicates the cluster's data to Amazon Redshift or an Amazon SageMaker AI lakehouse in near real time. A writer with one attached does not pause either.

**Backtrack.** Rewinding a cluster to an earlier time without restoring from a backup. It exists for Aurora MySQL only, not for Aurora PostgreSQL. To go back in time with Aurora PostgreSQL you restore the state at a point in time as a new cluster, as in [chapter 22](/en/chapters/22-recovery.md).

## Aurora PostgreSQL and Aurora DSQL

<!-- section: 60.choices -->

Chapter 13 chose Aurora DSQL because it is the easiest way in for someone coming from D1. The names are alike, but the two are different databases. What follows is from documentation read on 2026-10-13.

| | Aurora PostgreSQL (this chapter) | Aurora DSQL (chapter 13) |
| --- | --- | --- |
| SQL | In AWS's words a drop-in replacement for PostgreSQL. Triggers, PL/pgSQL, temporary tables, extensions (pgvector, pg_cron and others, listed per version) | A subset compatible with PostgreSQL 16. No triggers, PL/pgSQL, or temporary tables. Whether any extension is supported could not be confirmed from the pages read |
| Transactions | As in PostgreSQL. READ COMMITTED by default, waiting on row locks. Deadlocks can happen | Fixed at REPEATABLE READ. No locks; conflicts are checked at commit and the loser gets `40001` |
| Limits on one transaction | None of this kind | 3,000 rows, 10 MiB, 5 minutes |
| Compute | Instances. One writer. There is failover | No instances. AWS writes that there is no traditional failover |
| Connections | From inside a VPC. The limit follows capacity (2,000 at most with a minimum of 0 or 0.5 ACU). None held with the Data API | To a public endpoint with an IAM token. 10,000 connections per cluster, each closed after 60 minutes |
| When idle | Pauses if the minimum is 0 ACU. About 15 seconds to resume | DPUs are 0 |
| Billed in | ACU-hours, storage, I/O (on Standard) | DPUs, storage |
| Several Regions | Global Database. One Region writes | Peered clusters. Every Region reads and writes, with strong consistency |

The choice follows from what the application needs from PostgreSQL.

If it needs PostgreSQL's features as they are, choose Aurora PostgreSQL. That covers applications that use extensions, triggers, PL/pgSQL, long transactions, or large bulk updates, and existing PostgreSQL applications you want to run unchanged. It is also the plainer choice when writes pile onto the same rows: locks make them wait their turn, where DSQL would make them retry again and again.

For a new application that fits within DSQL's constraints, DSQL leaves less to operate. There is no VPC, no instance, no password, and no failover. The retry this chapter writes is needed on DSQL too, though connections drop there for different reasons and at a different rate.

The difference from RDS for PostgreSQL is, as the sections above showed, in how storage is held. With little data, an outage of minutes being acceptable, and a wish for a fixed monthly bill, one small RDS instance is cheaper and easier to reason about. Chapter 59 covers it.

If D1, or a Postgres installed from Vercel's Marketplace, is enough, there is no reason to move. Choosing Aurora brings a VPC, capacity settings, and the handling of failover that this chapter writes. The next pages show what that amounts to.
