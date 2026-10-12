---
title: "59 RDS: Running PostgreSQL"
sourceRevision: 1
---

# 59 RDS: Running PostgreSQL

RDS for PostgreSQL is PostgreSQL itself, run by AWS. AWS patches the operating system, takes the backups, and switches to a standby. How large the instance is and how many there are, when the version goes up, who connects with which password, and where reads go all stay exactly as you decided them. This chapter takes those decisions one at a time.

[Chapter 13](/en/chapters/13-sql.md) chose Aurora DSQL and compared RDS only as one column of a table. This chapter starts where that one stopped. It keeps chapter 13's application and migrations as they are and moves the data to an RDS instance. Very little application code is added. What is added is the configuration around the instance, and a rule for reading from a read replica.

This chapter's stack **costs money for as long as it exists**. The default configuration (one db.t4g.micro with 20 GB of storage) left running for a month is USD 21.51 at list price. Stopping the instance does not stop the storage charge, and a stopped instance starts by itself after seven days. When you have finished trying it, remove it the same day with `vp run rds:infra:destroy`. The breakdown is in [Costs, Pitfalls, and Cleanup](/en/chapters/59-rds/wrap.md).

You need chapter 13 and the VPC of [chapter 11](/en/chapters/11-network.md); chapter 11's stack deployed in its default configuration is enough. Secrets and IAM were covered in [chapter 21](/en/chapters/21-security.md), and how to think about backups and restores in [chapter 22](/en/chapters/22-recovery.md). Aurora is the subject of [chapter 60](/en/chapters/60-aurora.md) and moving to another database that of [chapter 39](/en/chapters/39-database-migration.md), so neither is covered here. The code is in `examples/59-rds/`.

## The whole picture

<!-- section: 59.architecture -->

```figure
caption: A request passes through API Gateway and a Lambda function, and reaches the RDS instance inside the private subnets of the VPC
node client: Client | curl, later the SPA
node api: API Gateway HTTP API | ap-northeast-1
node fn: Lambda function | Node.js 24, arm64
node db: RDS for PostgreSQL | db.t4g.micro, Single-AZ
edge client -> api: HTTPS
edge api -> fn: GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> db: TLS, port 5432, user notes_api
group vpc: Private subnets of the chapter 11 VPC = fn, db
mark db
```

```figure
caption: Nothing outside the VPC reaches the database, so migrations are handed to an operations function inside it. The master user's password is used once, at the start
node laptop: Your machine | vp run rds:db:*
node sm: Secrets Manager | the master user's secret
node ops: Ops function | in the VPC, reached by Invoke only
node db: RDS for PostgreSQL
edge laptop -> sm: read for bootstrap only
edge laptop -> ops: lambda:InvokeFunction
edge ops -> db: notes_admin (once), notes_migrator
group vpc: Private subnets = ops, db
```

Three things differ from chapter 13's setup.

First, the database is inside a VPC. An RDS instance lives in subnets. This chapter puts it in the private subnets, which have no route to the internet, and gives it no public address. The Lambda function that connects to it goes into the same subnets. As chapter 11 showed, those subnets cannot reach the AWS APIs either. The function cannot call Secrets Manager, and that constraint decides how it authenticates.

Second, a password exists. Aurora DSQL had no stored password, but PostgreSQL has a master user, and that user has one. This chapter has RDS create the password and keep it in Secrets Manager, and does not let the application use it. As in chapter 13, the application signs in with a token signed by its IAM credentials.

Third, there is one instance and it runs all the time. It is billed when nobody is connected, and when it stops, the API stops. Whether to have a standby, and whether to have a copy for reads, are yours to decide, each in exchange for money.

## Instance class and storage

<!-- section: 59.sizing -->

The first decisions on RDS are the instance class and the storage. Both can be changed later, and every change comes with a pause or a restriction.

The instance class is a combination of CPU and memory. There are the general-purpose db.m classes, db.r and db.x with more memory, and the burstable db.t classes. The only db.c class is db.c6gd, and it exists for Multi-AZ DB clusters, which come up later. This chapter uses the cheapest one, db.t4g.micro (2 vCPUs, 1 GiB of memory).

A db.t class normally gets a fixed share of its CPU, saves what it does not use as credits, and spends them when it needs more. db.t4g runs in Unlimited mode, so it does not stop when the credits run out. Instead, use beyond what it can earn in 24 hours is charged extra. The AWS documentation recommends the db.t classes for development, test, and other non-production servers.

Memory also bounds how many connections can be open at once, because PostgreSQL keeps one process per connection. And for IAM database authentication, which this chapter uses, the documentation says that the instance needs "between 300 and 1000 MiB extra memory". Whether a db.t4g.micro, with 1 GiB in all, has enough was not checked.

Storage is gp3. For PostgreSQL the minimum is 20 GiB, and below 400 GiB it includes 3,000 IOPS and 125 MiB/s. From 400 GiB the data is spread over four volumes and the baseline rises to 12,000 IOPS and 500 MiB/s. For I/O-heavy production work there is io2 Block Express. The old magnetic storage is deprecated and cannot be chosen for a new instance.

There is one thing to remember about storage: it grows and does not shrink. Storage that has been allocated cannot be reduced. The way the documentation names for making it smaller is a blue/green deployment, which creates another instance with less storage and moves to it.

The settings that differ between practice and production are in one place.

<<< @/examples/59-rds/src/config.ts{profiles}

The default is `practice`. What each line of `production` protects is explained, one by one, in the rest of the chapter.

## When not to choose RDS

<!-- section: 59.choices -->

RDS fits when you need PostgreSQL itself. If you need extensions, triggers, PL/pgSQL, long transactions, or your existing ORM and tools to work unchanged, and the load is roughly steady, it is the plain choice. The same holds when you want to set the parameters yourself or pick the moment a version changes.

In the following cases something else is easier.

If the database sits unused most of the time, chapter 13's Aurora DSQL suits better. A month of merely existing costs USD 21.51 on RDS and only the storage on DSQL, and DSQL needs no VPC.

If you want a faster switch to a standby, several read copies on the same storage, or capacity that grows and shrinks by itself, that is Aurora, and chapter 60 covers it.

If your application runs on Cloudflare Workers or Vercel and is going to stay there, there is little reason to put only the database into a VPC on AWS. Vercel has stopped offering its own Postgres (Vercel Postgres); today you install a Postgres from the Marketplace, from providers such as Neon and Supabase. Cloudflare has Hyperdrive. Hyperdrive holds no data of its own: it pools connections and caches query results in front of a PostgreSQL or MySQL database that already exists, and databases on AWS are among those it supports. A database in a private network is reached through Cloudflare Tunnel. So this chapter's RDS instance could be used from Workers, but that setup was not tried. All of this is what the two companies' documentation said on 2026-10-13. Whether Cloudflare runs a PostgreSQL service of its own was not checked.

The book's position is the same as in chapter 13. RDS is not always better than the alternatives. What you get is all of PostgreSQL and the freedom to configure it. What you pay is a charge that never stops, and the operational decisions the following pages go through.
