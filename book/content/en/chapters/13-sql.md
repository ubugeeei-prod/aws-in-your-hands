---
title: "13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2"
sourceRevision: 4
---

# 13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2

On D1 you write `CREATE TABLE`, apply it with `wrangler d1 migrations apply`, and send SQL from a Worker. This chapter follows the same path on AWS.

The subject is the notes API from [chapter 04](/en/chapters/04-http-api.md), and this time the notes go into a SQL database. You write a schema, run migrations, write typed queries, run everything locally, and finally connect from Lambda. The database is Aurora DSQL. RDS for PostgreSQL and Aurora Serverless v2 appear only in a table that shows where they differ.

Aurora DSQL is compatible with PostgreSQL, but it is not PostgreSQL, and it is not a distributed D1 either. The chapter starts from what resembles D1 and explains each difference where it comes up.

The only prerequisite is chapter 04. You can read this chapter without having read [chapter 05](/en/chapters/05-dynamodb.md) (DynamoDB). The code is in `examples/13-sql/`.

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
caption: The Lambda function opens the connection to the cluster itself. Its database role is notes_api, and the password is an IAM-signed token made inside the function
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
caption: On your own machine, you either run the same app on PGlite or connect to the cluster as admin to run the migrations
node dev: vp run dev:sql | runs the same app
node mig: vp run sql:db:migrate
node pglite: PGlite | PostgreSQL inside the Node process
node db: Aurora DSQL cluster
edge dev -> pglite
edge mig -> db: admin, your own IAM credentials
group laptop: Your machine = dev, mig
```

The only thing added to chapter 04's setup is the database behind the Lambda function. The notes now live in the cluster and not in the function's memory, so every execution environment returns the same notes.

If you are used to D1, three things about this setup work differently.

The first is that there is no binding. In a Worker the database appears as `env.DB`. Here the Lambda function opens a TCP connection itself, which is the rightmost arrow in the first figure. The address comes from an environment variable, IAM decides whether the function may connect, and privileges inside the database decide what it may do once connected, so the configuration is spread over three places.

The second is that there is no password. Aurora DSQL has no stored password. For each connection the function creates a time-limited token, signed with its IAM credentials, and puts it in the password field. That connection is the arrow from the transaction runner to the database in the second figure.

The third is that there is no VPC. The cluster endpoint is a public DNS name protected by TLS and the token, so the Lambda function reaches it without being placed in a VPC. RDS and Aurora differ here, and the table in the next section compares them.

## The three options

<!-- section: 13.choices -->

AWS offers three main ways to use PostgreSQL-style SQL.

| | Aurora DSQL | RDS for PostgreSQL | Aurora Serverless v2 (PostgreSQL) |
| --- | --- | --- | --- |
| SQL | A subset compatible with PostgreSQL 16. Some things are missing (next section) | PostgreSQL itself | PostgreSQL-compatible |
| Decisions up front | Almost none. You create a cluster | Instance size, storage, VPC and subnets, where the password lives | Capacity range (ACUs), VPC and subnets, where the password lives |
| Authentication | IAM tokens only | A password. IAM tokens are an option | A password. IAM tokens are an option |
| Connecting | TLS to a public endpoint. No VPC needed | From inside the VPC. The Lambda function goes in the VPC too | From inside the VPC. Or over HTTP with Data API, without one |
| Transactions | Fixed at REPEATABLE READ. No waiting on locks; conflicts are checked at commit | READ COMMITTED by default. Waits on locks | Same as RDS |
| Limits per transaction | 3,000 rows, 10 MiB, 5 minutes | No limits of this kind | Same as RDS |
| When unused | No DPUs. Storage only | Billed for as long as the instance runs | Pauses with a 0 ACU minimum. Storage remains |

This chapter is built around Aurora DSQL because it is the easiest of the three to start with if you come from D1. Almost nothing is billed while it sits unused, and there is no network to design, so it connects to the Lambda function from chapter 04 as it is.

There are also clear cases where DSQL does not fit.

- You need PostgreSQL's features as they are. If you use triggers, PL/pgSQL, extensions, or temporary tables, or want an existing PostgreSQL application or ORM to run unchanged, RDS is the straightforward choice because it is PostgreSQL itself (how far Aurora matches it was not checked for this chapter)
- One transaction writes a large number of rows. A bulk update of more than 3,000 rows, or work that takes more than 5 minutes, does not fit on DSQL unless you can split it
- Writes concentrate on the same row. When many transactions update one counter or one stock row at once, DSQL fails them instead of making them wait, and you end up retrying constantly

Choosing RDS or Aurora brings a VPC with it. A database instance lives inside a VPC, so the Lambda function has to go into the VPC as well, with subnets and security groups. [Chapter 11](/en/chapters/11-network.md) covered VPCs, so this chapter builds none.

Aurora Serverless v2 pauses only under certain conditions. With a minimum capacity of 0 ACUs, the instance pauses after a period with no user connections (5 minutes by default, one day at most), and the instance charge drops to zero. A single open connection keeps it running, though. So does an attached RDS Proxy, because the proxy holds connections open, and so do logical replication and zero-ETL integrations. The first connection after a pause waits about 15 seconds for the resume, and can wait 30 seconds or longer if the pause lasted more than 24 hours. Storage is still charged while the instance is paused.

Aurora also has Data API, which accepts SQL over HTTP. With Data API the Lambda function stays out of the VPC, but the database credentials then live in Secrets Manager. Which Regions and engine versions offer Data API was not checked for this chapter.

## How Aurora DSQL differs from PostgreSQL

<!-- section: 13.compat -->

DSQL keeps gaining features, so any article that lists what it lacks goes out of date quickly. Foreign keys arrived in August 2026, for example, and sequences and identity columns in February 2026. What follows is what the official documentation said on the day this chapter was written (2026-10-11), and it may have changed by the time you read it.

These work as they do in PostgreSQL: joins, CTEs, and window functions in `SELECT`, `INSERT ... ON CONFLICT`, `CHECK`, `UNIQUE`, foreign keys, views, functions written in SQL, and JSON and JSONB.

These are available in a different form.

- You create an index with `CREATE INDEX ASYNC`. Index builds are always asynchronous, and the statement is rejected without `ASYNC`. It returns a job ID at once, and the index is built in the background
- A transaction can hold only one DDL statement. DDL and DML cannot share a transaction either, so you cannot create a table and insert rows into it in the same transaction
- You cannot change a primary key after the table is created, and you cannot add one
- `ALTER TABLE ... ADD COLUMN` takes only a column name and a type. The list of supported syntax has no way to attach a constraint or a default to that form. `SET NOT NULL` and changing a column's type are not in the list either
- A sequence requires an explicit `CACHE`, which must be 1, or 65536 or more. The official documentation recommends UUIDs as the default for IDs
- The isolation level is fixed at REPEATABLE READ and cannot be changed

Temporary tables, triggers, PL/pgSQL, and `TRUNCATE` do not exist. Use `DELETE FROM` in place of `TRUNCATE`. A cluster has one database, and its name is `postgres`.

You do not want to learn after a deploy that SQL your local PostgreSQL accepted is rejected by DSQL, so the example has a small check that reads the migration files as text.

<<< @/examples/13-sql/src/migrate.ts{lint}

The check covers only the constraints this chapter's migrations are likely to hit, not all of DSQL's. Even so, an index without `ASYNC` fails in `vp run test:unit`.

### ORMs and migration tools

This chapter uses plain SQL files, a small migration runner, and node-postgres (`pg`), with no heavyweight ORM.

One reason is that the default behavior of a general migration tool may not fit the constraints above, where DDL goes one statement at a time and indexes need `ASYNC`. The other is that this chapter should show everything that is sent to the database.

The evidence that node-postgres works with DSQL is in the official documentation. AWS publishes authentication connectors for node-postgres and for Postgres.js, and lists a sample that connects from Lambda with node-postgres. This chapter connects the same way that sample does. For ORMs, the list has an adapter for Drizzle and samples for Prisma, Sequelize, and TypeORM. None of them was run for this chapter.
