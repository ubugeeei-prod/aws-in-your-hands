---
title: "13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2"
sourceRevision: 2
---

# 13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2

You write `CREATE TABLE` for D1, run `wrangler d1 migrations apply`, and send SQL from a Worker. This chapter is about what that loop looks like on AWS.

We take the notes API from [chapter 04](/en/chapters/04-http-api.md) and store it with SQL this time: a schema, migrations, typed queries, a local setup, and a connection from Lambda. The database is Aurora DSQL. RDS for PostgreSQL and Aurora Serverless v2 sit next to it for comparison.

One thing first. Aurora DSQL is PostgreSQL-compatible, but it is not PostgreSQL. And it is not "D1, distributed" either. We'll start from what feels familiar and stop where it differs.

The only prerequisite is chapter 04. You don't need to have read [chapter 05](/en/chapters/05-dynamodb.md) (DynamoDB). The code is in `examples/13-sql/`.

## The big picture

<!-- section: 13.architecture -->

```figure
caption: A request passes through API Gateway and the Lambda function, and reaches the Aurora DSQL cluster over a PostgreSQL connection
node client: Client | curl, later the SPA
node api: API Gateway HTTP API | ap-northeast-1
node fn: Lambda function | Node.js 24, arm64, not in a VPC
node db: Aurora DSQL cluster | single-Region, ap-northeast-1
edge client -> api: HTTPS
edge api -> fn: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> db: PostgreSQL wire protocol over TLS, port 5432
mark db
```

```figure
caption: The Lambda function opens the connection to the cluster itself, as the database role notes_api, with an IAM-signed token made in the function as the password
node role: execution role | dsql:DbConnect on this one cluster, its own log group
node app: Hono app
node svc: NoteService
node repo: SqlNoteRepository
node tx: transaction runner | retries on SQLSTATE 40001
node db: database postgres | app: owners, notes / public: aih_migrations
edge app -> svc
edge svc -> repo
edge repo -> tx
edge tx -> db: user notes_api, password is a token
group fn: Lambda function = role, app, svc, repo, tx
group cl: Aurora DSQL cluster: the only database = db
```

```figure
caption: From your laptop, you either run the same app on PGlite or connect to the cluster as admin to run the migrations
node dev: vp run dev:sql | runs the same app
node mig: vp run sql:db:migrate
node pglite: PGlite | PostgreSQL inside the Node process
node db: Aurora DSQL cluster
edge dev -> pglite
edge mig -> db: admin, your own IAM credentials
group laptop: Your laptop = dev, mig
```

Compared with chapter 04, there is one more box: a database under the Lambda function. The notes no longer belong to the function's memory. They belong to the cluster, and every execution environment sees the same ones.

Three things in this picture feel different from D1.

**There is no binding.** In a Worker the database shows up as `env.DB`. Here the function opens a TCP connection itself. Where to connect comes from an environment variable, whether it may connect is decided by IAM, and what it may do once connected is decided by privileges inside the database. Three places.

**There is no password.** Aurora DSQL has no password to store. For each connection you create a time-limited token, signed with IAM credentials, and put it where the password goes.

**There is no VPC.** The cluster endpoint is a public DNS name, protected by TLS and the token. So the function reaches it without being placed in a VPC. RDS and Aurora differ here, as you'll see in a moment.

## Which one?

<!-- section: 13.choices -->

There are three main roads to PostgreSQL-flavored SQL on AWS.

| | Aurora DSQL | RDS for PostgreSQL | Aurora Serverless v2 (PostgreSQL) |
| --- | --- | --- | --- |
| SQL | A subset compatible with PostgreSQL 16. Some things are missing (next section) | PostgreSQL itself | PostgreSQL-compatible |
| Decisions up front | Almost none. You create a cluster | Instance size, storage, VPC and subnets, where the password lives | Capacity range (ACUs), VPC and subnets, where the password lives |
| Authentication | IAM tokens only | A password. IAM tokens are an option | A password. IAM tokens are an option |
| Connecting | TLS to a public endpoint. No VPC needed | From inside the VPC. The Lambda function goes in the VPC too | From inside the VPC. Or over HTTP with Data API, without one |
| Transactions | Fixed at REPEATABLE READ. No waiting on locks; conflicts are checked at commit | READ COMMITTED by default. Waits on locks | Same as RDS |
| Limits per transaction | 3,000 rows, 10 MiB, 5 minutes | No limits of this kind | Same as RDS |
| When unused | No DPUs. Storage only | Billed for as long as the instance runs | Pauses with a 0 ACU minimum. Storage remains |

Aurora DSQL is the lead in this chapter because it is the closest door for someone coming from D1. Almost nothing is billed for merely existing, and there is no network to design. It plugs into the Lambda function from chapter 04 as is.

There are clear cases where DSQL does not fit, though.

- **You need PostgreSQL's features as they are.** Triggers, PL/pgSQL, extensions, temporary tables. You want an existing PostgreSQL application or ORM to run unchanged. Then RDS, which is PostgreSQL itself, is the straightforward choice (how far Aurora matches it was not checked for this chapter)
- **One transaction writes a lot of rows.** A bulk update over 3,000 rows, or work that takes more than 5 minutes. If it cannot be split, it does not go on DSQL
- **Writes pile up on the same row.** Many transactions updating one counter or one stock row at once. DSQL fails them instead of making them wait, so you end up retrying constantly

Choosing RDS or Aurora brings a VPC with it. A DB instance lives inside a VPC, so the Lambda function goes into the VPC as well, with subnets and security groups. [Chapter 11](/en/chapters/11-network.md) covered that, so nothing of it is built here.

"Pauses" for Aurora Serverless v2 comes with conditions. With a minimum capacity of 0 ACUs, the instance pauses after a period with no user connections (5 minutes by default, one day at most), and the instance charge drops to zero. But a single open connection keeps it running. An attached RDS Proxy keeps it running, because the proxy holds connections open. Logical replication and zero-ETL integrations keep it running. The first connection after a pause waits about 15 seconds for the resume, and 30 seconds or longer if the pause lasted more than 24 hours. And storage is still charged while it is paused.

Aurora also has Data API, an HTTP endpoint that takes SQL. With it the Lambda function stays out of the VPC, but the database credentials then live in Secrets Manager. Which Regions and engine versions offer it was not checked for this chapter.

## Aurora DSQL is not PostgreSQL

<!-- section: 13.compat -->

This is where old articles lead you astray. DSQL keeps gaining features, and any "unsupported" list ages fast. Foreign keys arrived in August 2026, sequences and identity columns in February 2026. What follows is what the official documentation said on the day this chapter was written (2026-10-11). It may have moved again by the day you read it.

First, what simply works. Joins, CTEs, and window functions in `SELECT`. `INSERT ... ON CONFLICT`. `CHECK`, `UNIQUE`, and foreign keys. Views, functions written in SQL, JSON and JSONB.

Next, what has a different shape.

- **An index is `CREATE INDEX ASYNC`.** Index builds are always asynchronous, and the statement is rejected without `ASYNC`. It returns a job ID at once and the index is built in the background
- **One DDL statement per transaction.** And DDL and DML cannot share a transaction. You cannot create a table and insert into it in the same transaction
- **A primary key cannot be changed after the table is created.** Or added
- **`ALTER TABLE ... ADD COLUMN` takes a name and a type.** The supported syntax lists no way to attach a constraint or a default to that form. `SET NOT NULL` and changing a column's type are not in the list either
- **A sequence needs an explicit `CACHE`.** Either 1, or 65536 and up. The documentation recommends UUIDs as the default for IDs
- **The isolation level is fixed at REPEATABLE READ.** It cannot be changed

And what is absent. Temporary tables, triggers, PL/pgSQL, `TRUNCATE` (use `DELETE FROM`). A cluster has one database, named `postgres`.

Finding out after a deploy that something passed on your local PostgreSQL and fails on DSQL is no fun. So there is a small check that reads the migration files as text.

<<< @/examples/13-sql/src/migrate.ts{lint}

It does not cover everything, only what this chapter's migrations could plausibly step on. Still, an index without `ASYNC` now fails in `vp run test:unit`.

### What about ORMs and migration tools?

This chapter uses plain SQL files, a small migration runner, and node-postgres (`pg`). No heavyweight ORM.

Two reasons. One: the default behavior of a general migration tool may not fit the constraints above (one DDL statement at a time, `ASYNC` indexes). Two: in this chapter everything sent to the database should be visible.

The grounds for node-postgres working with DSQL are in the official documentation. AWS publishes authentication connectors for node-postgres and for Postgres.js, and lists a sample that connects from Lambda with node-postgres. This chapter connects the same way that sample does. As for ORMs, the list has an adapter for Drizzle and samples for Prisma, Sequelize, and TypeORM. None of them was run for this chapter.
