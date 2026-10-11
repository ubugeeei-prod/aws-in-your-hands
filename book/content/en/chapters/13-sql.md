---
title: "13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/13-sql` does not exist yet.

## Outcome

You run the whole SQL loop: schema, migrations, typed CRUD, seed/reset, tests, deployed migrations, and backup/restore.

## Prerequisites

- [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Reading paths: `sql`, `cloudflare-d1`

## Planned architecture

Lambda → Aurora DSQL (IAM auth; verify the VPC-free path in current docs). For comparison, RDS PostgreSQL and Aurora Serverless v2 sit inside the chapter 11 VPC.

Services: Aurora DSQL, RDS for PostgreSQL, Aurora Serverless v2

## Topics

- Choosing among three options by SQL compatibility, auth, connections, transactions, and idle cost
- DSQL is not full PostgreSQL: verify supported SQL/DDL and migration tools at the pinned version
- OCC conflicts at commit and retries
- Local PostgreSQL is a substitute that reproduces neither DSQL auth nor contention
- Aurora auto-pause conditions and the storage charges that remain
- Comparing guarantee scope with D1 read replicas and Sessions

## The distributed-systems angle

Invariant: a transaction either commits as a whole or is retried as a whole, and retries stay within idempotent scope.

## Source required for completion

- vp tasks for migrate, seed, and reset (local and cloud separated, cache: false)
- Typed query layer with contract tests
- Deterministic tests that inject serialization failures and verify retries
- If D1 comparison code is shown, its complete source including wrangler configuration

## Primary sources to start from

- [What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html) (not re-read while writing)
- [Aurora DSQL PostgreSQL compatibility](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html) (not re-read while writing)
- [Aurora DSQL DDL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html) (not re-read while writing)
- [Aurora DSQL Node.js connectors](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html) (not re-read while writing)
- [Aurora DSQL concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html) (not re-read while writing)
- [Aurora DSQL pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/) (not re-read while writing)
- [Aurora Serverless v2 auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) (not re-read while writing)
- [What is Amazon RDS?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html) (not re-read while writing)
- [Cloudflare D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/) (checked 2026-10-11)
- [Cloudflare D1: Migrations](https://developers.cloudflare.com/d1/reference/migrations/) (not re-read while writing)
- [Cloudflare D1: Read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) (not re-read while writing)
