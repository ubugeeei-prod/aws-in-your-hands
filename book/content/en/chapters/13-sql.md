---
title: "13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2"
sourceRevision: 1
---

# 13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2

You write `CREATE TABLE` for D1, run `wrangler d1 migrations apply`, and send SQL from a Worker. This chapter is about what that loop looks like on AWS.

We take the notes API from [chapter 04](/en/chapters/04-http-api.md) and store it with SQL this time: a schema, migrations, typed queries, a local setup, and a connection from Lambda. The database is Aurora DSQL. RDS for PostgreSQL and Aurora Serverless v2 sit next to it for comparison.

One thing first. Aurora DSQL is PostgreSQL-compatible, but it is not PostgreSQL. And it is not "D1, distributed" either. We'll start from what feels familiar and stop where it differs.

The only prerequisite is chapter 04. You don't need to have read [chapter 05](/en/chapters/05-dynamodb.md) (DynamoDB). The code is in `examples/13-sql/`.

## The big picture

<!-- section: 13.architecture -->

```text
Client (curl, later the SPA)
  |  HTTPS
  v
API Gateway HTTP API (ap-northeast-1)
  |  routes: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
  v
Lambda function (Node.js 24, arm64, not in a VPC)
  |  execution role: dsql:DbConnect on this one cluster, and its own log group
  |  Hono app -> NoteService -> SqlNoteRepository -> transaction runner (retries on SQLSTATE 40001)
  |
  |  PostgreSQL wire protocol over TLS, port 5432
  |  user: notes_api (a database role)   password: an IAM-signed token, made in the function
  v
Aurora DSQL cluster (single-Region, ap-northeast-1)
     database: postgres (the only one)
     schema app: owners, notes          schema public: aih_migrations

Your laptop
  vp run dev:sql                -> the same app on PGlite (PostgreSQL inside the Node process)
  vp run sql:db:migrate         -> connects to the cluster as admin, with your own IAM credentials
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

Choosing RDS or Aurora brings a VPC with it. A DB instance lives inside a VPC, so the Lambda function goes into the VPC as well, with subnets and security groups. That is planned for [chapter 11](/en/chapters/11-network.md), and nothing of it is built here.

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

## Schema and migrations

<!-- section: 13.migrations -->

There are two tables.

<<< @/examples/13-sql/migrations/0002_create_owners.sql

<<< @/examples/13-sql/migrations/0003_create_notes.sql

A note's ID is a random UUID made by the application. On D1 you might reach for an `INTEGER PRIMARY KEY` counter, but the DSQL documentation advises against monotonically increasing primary keys on tables with many writes: every new row would land in the same place.

`note_count` in `owners` becomes the star later. For now, it is the column that counts toward "an owner may hold at most 100 notes". Thanks to that cap, a list always fits in one page. As in chapter 04, there is no pagination.

Here is the index.

<<< @/examples/13-sql/migrations/0004_index_notes_by_owner.sql

### One statement per file

A D1 migration file can hold as many statements as you like. Here, a file holds exactly one.

DSQL allows one DDL statement per transaction, so a file with several can never be made "all of it or none of it". With one statement to begin with, a file maps onto a transaction directly.

This is the runner.

<<< @/examples/13-sql/src/migrate.ts{migrate}

It does what D1 does: run the files in name order and write down how far it got, in a table (`public.aih_migrations`). The difference is at the comment in the middle.

The schema change and the record of it cannot share a transaction, because DDL and DML do not mix. So if the process dies after the change and before the record, you are left with "applied, but not recorded".

The next run sends the same statement again. That is why every statement is written so that running it twice is harmless (`IF NOT EXISTS`), and the lint above enforces it. The invariant for migrations: **if there is a record, the statement has been applied; a statement without a record gives the same result when run again.**

This, too, is checked by breaking it on purpose.

<<< @/examples/13-sql/test/migrate.test.ts{interrupted}

One more thing. If you edit a file that was already applied, the runner notices the changed checksum and stops. To fix something, add a file with a new number.

The local PostgreSQL does not know the word `ASYNC`. That one word is removed by the runner just before sending.

<<< @/examples/13-sql/src/migrate.ts{dialect}

The files are written in DSQL's SQL and the local side adapts. Not the other way around.

## Rows into types

<!-- section: 13.queries -->

The API contract is nearly the one from chapter 04, plus updates (`PUT`) and a `version`.

<<< @/examples/13-sql/src/contract.ts{note}

Between the application and the database there is one thin interface.

<<< @/examples/13-sql/src/db.ts{db}

`query` takes SQL text and numbered values such as `$1`. This chapter's application never puts a value into the SQL text. That way the door to SQL injection is not built in the first place.

Now, the `rows` that `query` returns are typed `unknown[]`. node-postgres will let you attach any type you like, but that is only a declaration of what you expect. Rename a column in a migration and the type stays as it was, while the runtime value changes.

A database row is a value from outside the type system, just like an HTTP request. So it gets the same treatment.

<<< @/examples/13-sql/src/db.ts{rows}

<<< @/examples/13-sql/src/notes-repository.ts{row}

The row schema doubles as the conversion from snake_case columns to the API's `Note`. Both node-postgres and PGlite return `timestamptz` as a `Date`, which becomes an ISO 8601 string.

Here is the update.

<<< @/examples/13-sql/src/notes-repository.ts{update}

`WHERE ... AND version = $6` is the point. If the `version` is still the one you loaded, the row is updated and the version moves by one. If not, no row is updated, and the current row is read and returned with a 409. The check and the write are one statement, so no other write fits in between.

The same SQL works on D1. That part of SQL is a pleasure.

## A transaction is retried as a whole

<!-- section: 13.transactions -->

From here on is where this chapter differs most from D1.

Creating a note first checks that the owner has not reached 100 notes. Written naively: count them, and `INSERT` if there is room. What happens when two of those run at once? Let's follow it with a cap of 2 and one note already there.

```text
quota = 2, the owner already has 1 note

time  transaction A (POST /notes)            transaction B (POST /notes)
t1    BEGIN  (sees note_count = 1)
t2                                           BEGIN  (sees note_count = 1)
t3    UPDATE owners SET note_count = 2
t4    INSERT INTO notes ...                  UPDATE owners SET note_count = 2
t5    COMMIT -> ok                           INSERT INTO notes ...
t6                                           COMMIT -> SQLSTATE 40001 (OC000); nothing of B is applied
t7                                           BEGIN again  (sees note_count = 2)
t8                                           UPDATE ... WHERE note_count < 2 -> 0 rows
t9                                           COMMIT; the API answers quota_exceeded
```

An Aurora DSQL transaction keeps reading the data as it was when the transaction began (snapshot isolation). B sees `note_count = 1` as of t2, so its `UPDATE` at t4 goes through without complaint. B does not know that A has already written.

On an ordinary PostgreSQL, B would wait at t4 for A's lock to be released. DSQL does not make it wait. It lets both proceed without locks and checks at commit whether another transaction committed the same row first. This is optimistic concurrency control (OCC). B loses at t6 and gets SQLSTATE `40001` (serialization failure). Nothing B wrote remains.

The loser has one thing to do: **run the transaction again from the start.**

<<< @/examples/13-sql/src/transaction.ts{run}

Sending just the `COMMIT` again will not do. Look at t7. The second time, B reads `note_count = 2` and decides there is no room. A different answer from the first time. Had it remembered its earlier decision and replayed only the `INSERT`, there would be a third note.

The invariant for this chapter: **a transaction either commits as a whole or is run again as a whole, and a rerun changes its outcome only through values read from the database again.**

To keep the second half true, the create is written like this.

<<< @/examples/13-sql/src/notes-repository.ts{create}

There are three rules.

**Inside the transaction, touch nothing but the database.** Sending an email or calling another API in there would happen twice, three times, once per rerun.

**Decide the ID and the time outside, and pass them in.** An ID made inside the transaction would be a different note on every rerun.

<<< @/examples/13-sql/src/notes.ts{service}

**If the same ID is already there, do nothing.** That is the `selectNote` at the top. It is needed because the answer to a commit can fail to arrive. When a connection drops, the commit may have succeeded or not. If calling again with the same ID still leaves one note, either case is fine.

### Why update one row instead of counting

With `SELECT count(*) FROM app.notes` followed by `INSERT`, A and B both read "one note" and each inserts a different row. They did not write the same row, so DSQL sees no conflict. Both commit, and there are three notes. This is called write skew.

Always updating `note_count` in `owners` is there to make the two transactions collide on one row, on purpose. Then the database stops one of them.

The price: creates and deletes by the same owner go through one at a time. For one person's notes that is plenty. Design it so that everyone updates the same single row, and you get nothing but reruns. Deciding which row transactions collide on is the center of designing for DSQL.

### How far to retry

<<< @/examples/13-sql/src/transaction.ts{policy}

Only `40001` is retried. At most 4 attempts, with waits that grow and are spread out at random, so that transactions that lost together do not come back together and collide again.

After losing four times, the API gives up with a 503.

<<< @/examples/13-sql/src/app.ts{errors}

Every attempt was rolled back, so nothing was written. The caller can simply send it again.

Reads go through the same runner. Right after a schema change, a connection that still remembers the old schema can receive `40001` (OC001). The cost is an extra `BEGIN` and `COMMIT` round trip per read.

By the way, the `version` check and this retry are separate matters. `version` catches "someone changed it between opening the screen and saving": seconds to minutes. OCC catches "two commits at the same instant": milliseconds. You need both.

## Causing a conflict on purpose

<!-- section: 13.conflicts -->

Awkwardly, this conflict never happens locally. PGlite has a single connection, and transactions run one after another.

So what does not happen gets made to happen.

<<< @/examples/13-sql/test/support.ts{inject}

When `COMMIT` arrives, it rolls back instead of committing, commits the "winner's" writes first, and then throws `40001`. That is what happens when you lose on DSQL, in the same order. The SQL itself runs on a real PostgreSQL (PGlite).

With that, the timeline above becomes a test as it stands.

<<< @/examples/13-sql/test/notes-repository.test.ts{conflicts}

The second test is the heart of the chapter. The loser of the last slot reruns and ends as `quota_exceeded`, and the count in `owners` and the number of rows in `notes` both equal the cap exactly.

To be honest, this does not prove that DSQL behaves this way. It checks that this code does the right thing when DSQL returns `40001` as documented. Causing a conflict on a real cluster is still to be done.

## Running it locally

<!-- section: 13.local -->

Copy `examples/13-sql/.env.example` to `.env` in the same directory.

<<< @/examples/13-sql/.env.example

```bash
vp run sql:db:migrate:local
vp run sql:db:seed:local
vp run dev:sql
```

The API comes up at <http://localhost:8787>.

```bash
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"edited","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","expectedVersion":1}'
```

Replace `<id>` with the `id` in the create response. The last call is an update from an old `version`. It answers 409 with `code` `conflict` and the note as it is now.

To start over:

```bash
vp run sql:db:reset:local
```

It deletes the database directory and runs the migrations and the seed again.

### What the local database really is

No Docker. It is PGlite, an npm package that runs PostgreSQL, compiled to WebAssembly, inside the Node.js process. The data lives in `examples/13-sql/.pglite/`.

<<< @/examples/13-sql/src/pglite.ts{pglite}

It is probably the closest thing to `wrangler dev` handing you a local D1. But where D1's local mode runs the same D1 as production, this is a **stand-in**. It is not Aurora DSQL. Here is what it does not reproduce.

- **Conflicts.** One connection, so `40001` never occurs. See the previous section
- **Authentication.** No tokens, no IAM, no database roles. Being refused for lack of permission does not happen locally
- **DSQL's limits.** 3,000 rows, 5 minutes, one DDL statement, mandatory `ASYNC`. PGlite cares about none of them. The lint watches some in its place
- **Version.** When run here, PGlite 0.5.8 reported PostgreSQL 18.3. DSQL is compatible with PostgreSQL 16. SQL that exists only in the newer version passes locally and nowhere else
- **The network.** No connection setup, no drops, no latency

One more finding from trying it. PGlite does not stop two processes from opening the same directory. Left alone that corrupts it, so a lock file does the refusing. Run `sql:db:reset:local` while `dev:sql` is up and it tells you to stop the dev server first, and exits.

And `dev:sql` does not run migrations for you. If some are not applied, it names them and stops. Same manners as `wrangler dev`.

<<< @/examples/13-sql/src/dev.ts{dev}

Set `NOTES_DB` to `dsql` in `.env` and the same dev server connects to a deployed cluster with your own credentials. That is billed, and it has not actually been tried yet.

## Connecting from Lambda

<!-- section: 13.connect -->

### The connection

<<< @/examples/13-sql/src/dsql.ts{dsql}

Passing a function as `password` is the DSQL part. node-postgres calls it each time it opens a new connection, and the function signs a token on the spot.

Signing a token is a local computation. It does not ask AWS anything. That makes it fast, but it also means a token can be produced from wrong credentials. You find out when you try to connect.

A token expires after 15 minutes by default. But the expiry is looked at only when connecting, and an open connection keeps working after its token has expired. Connections have a limit of their own: DSQL closes them at 60 minutes. Hence `maxLifetimeSeconds`, which retires a connection at 50.

`max: 1` is because a Lambda execution environment handles one request at a time. The number of connections is roughly the number of execution environments running at once. A cluster allows 10,000 connections by default and 100 new ones per second.

TLS uses `rejectUnauthorized: true`: the certificate chain and the host name are checked against the certificate authorities Node.js ships with.

<<< @/examples/13-sql/src/lambda.ts{handler}

As in chapter 04, the outermost level of the file runs once per execution environment. One pool is made there. Later invocations reuse the connection that is already open.

The configuration is checked at startup.

<<< @/examples/13-sql/src/env.ts{env}

### The cluster and its permissions

<<< @/examples/13-sql/infra/lib/sql-stack.ts{cluster}

Almost disappointingly little. No instance size, no subnet, no password. The pinned CDK (aws-cdk-lib 2.273.0) has no higher-level construct for DSQL yet, so this uses `CfnCluster`, which mirrors CloudFormation's `AWS::DSQL::Cluster` directly.

Since it is for practice, deletion protection is off and the cluster goes away with the stack. In production you want the opposite.

<<< @/examples/13-sql/infra/lib/sql-stack.ts{role}

Permissions come in two layers.

The first is IAM. `dsql:DbConnect` means "may connect to this cluster as a database role other than admin". The similarly named `dsql:DbConnectAdmin` allows connecting as `admin`. The function does not get it. As `admin` it could drop tables.

The second is inside the database. After connecting, what the function may do to which table is decided by `GRANT`s to its database role.

<<< @/examples/13-sql/src/grant.ts{grant}

`AWS IAM GRANT` is DSQL's own statement. It registers "this IAM role may log in as this database role". The `GRANT`s hand over reading and writing rows, nothing else. The function cannot change the schema. Migrations are run by you, as `admin`, from your laptop.

These two statements accept no `$1`, so the names have to go into the text. That is right after saying values never do, and it is the exception. So their form is checked strictly before they are put in, and there is a test for it.

<<< @/examples/13-sql/infra/lib/sql-stack.ts{function}

The bundle format is CommonJS because node-postgres is CommonJS and loads Node.js's own modules with `require()`. The bundle from synth was loaded in a local Node.js 24, and the routes that do not touch the database answered. That is as far as it was checked.

## Deploy, then run the migrations

<!-- section: 13.deploy -->

From here on, AWS is changed. To be honest, the steps in this section have not once been run against real AWS.

```bash
vp run sql:infra:diff
vp run sql:infra:deploy
```

That creates the cluster, the function, and the API. It does not work yet. The cluster is empty, and the function's role cannot get into the database. On D1, too, creating a database gives you no tables.

```bash
vp run sql:db:migrate
vp run sql:db:grant
```

`sql:db:migrate` runs the same migrations as locally, this time with `ASYNC` left in. It takes the job ID that the index statement returns and waits for completion by watching `sys.jobs`. `sql:db:grant` runs the `GRANT`s from above and ties the function's role to `notes_api`.

Both connect as `admin`. Your own credentials need `dsql:DbConnectAdmin`.

Migrations come first. `GRANT ... ON ALL TABLES` covers the tables that exist at that moment. After a later migration adds a table, run `sql:db:grant` again.

```bash
vp run sql:smoke
```

It checks create, read back, update, an update from an old `version` (expecting 409), and delete, in that order. Unlike the smoke test of chapter 04, the read back must always succeed.

For seed data there is `vp run sql:db:seed`. Logs are `vp run sql:logs`, where the `transaction retry` lines tell you how often a conflict caused a rerun. The drift check is `vp run sql:infra:drift`.

One thing to keep in mind. The pinned cdkd (0.296.28) has no dedicated provider for `AWS::DSQL::Cluster`. It goes through Cloud Control API. Whether creating it, reading the identifier that the endpoint is built from, the drift read-back, and deleting it actually work is unconfirmed.

### Why there is no reset for the cloud

There is `sql:db:reset:local`, and there is no `sql:db:reset`. On purpose.

A reset in the cloud means dropping every table. Make that a single command, and one day it gets typed at production. To wipe a practice cluster, destroy the stack and create it again.

### Changing the schema of a database in use

As on D1, a migration and a code deploy never happen at the same instant. There is always a stretch where old code runs on the new schema.

On DSQL the constraints stack on top of that. `ADD COLUMN` adds a column with no constraint and no default. So it becomes stages: add the column, ship the new code, backfill the old rows (3,000 rows per transaction at most). This chapter does not implement that far.

## Backup and restore

<!-- section: 13.backup -->

D1 has Time Travel: with nothing configured, you can go back to any minute of the last 30 days. If you are used to that, there is more work here.

Aurora DSQL backups go through a separate service, AWS Backup. What you get is a backup of the whole cluster, taken once on demand or automatically on a schedule with a retention period. A restore always creates a **new cluster**. It does not rewind the original.

So after a restore, pointing the application at the new endpoint is still to do. In this chapter's stack the endpoint is built from the cluster identifier, so that is what you would replace. Whether database roles and `AWS IAM GRANT` carry over to the new cluster was not checked.

The backup page of the DSQL documentation did not describe restoring to a given minute. It is safest to assume that how much time you can lose is set by how often backups are taken.

One more. An unused cluster moves to Idle and then Inactive, where compute goes to zero. A backup can be taken only from an Active cluster. A nightly schedule failing on a cluster nobody is using is something that can happen.

RDS and Aurora have automated backups. Aurora's are continuous, and you can restore to any point within the retention period (1 to 35 days). There too, a restore produces a new instance or cluster.

This chapter creates no backup resources, since the data is for practice. The procedure was not tried either.

## For people coming from D1

<!-- section: 13.d1 -->

| | Cloudflare D1 | This chapter (Aurora DSQL) |
| --- | --- | --- |
| SQL | SQLite | A subset compatible with PostgreSQL 16 |
| Local | `wrangler dev` provides a local D1, the same D1 as production | PGlite as a stand-in. Not DSQL |
| Migrations | Wrangler runs numbered `.sql` files in order. A failed migration is rolled back | This chapter's runner runs numbered `.sql` files in order. One statement per file, written so that it can be run again after an interruption |
| Connecting | A binding (`env.DB`) | A TCP connection. An IAM token is the password |
| Transactions | The statements listed in one `batch()` form a transaction | From `BEGIN` to `COMMIT`. You can read a value and decide the next statement |
| Simultaneous writes | Writes all go to the one primary | Conflicts are checked at commit; the loser gets `40001` and reruns |
| Where reads are served | Read replicas around the world, asynchronous | Three AZs in one Region, synchronous |
| Backup | Time Travel: any minute of the last 30 days | AWS Backup: the whole cluster; a restore is a new cluster |
| Billing units | Rows read, rows written, storage | DPUs, storage |

The biggest difference is consistency.

D1's read replicas receive copies from the primary asynchronously. So a replica can be arbitrarily out of date. The Sessions API makes up for that: within one session it guarantees that reads never go backwards and that you can read what you wrote (sequential consistency). The scope of the guarantee is the session. What another session sees is a separate matter unless a bookmark is passed along. And without the Sessions API, every query goes to the primary.

A single-Region Aurora DSQL cluster writes synchronously to three AZs. What was committed is visible to every transaction that follows. There are no sessions or bookmarks to think about. In exchange, a cluster in Tokyo is in Tokyo. There is nothing in this setup like D1's read replicas, which put copies near faraway readers.

That is why DSQL is not "D1, distributed". D1 is a database you write in one place and can read far away. DSQL is a database where, inside one Region, you see the same thing wherever you write. They aim at different places. Multi-Region clusters exist, but only within a set of nearby Regions (for Tokyo, Osaka and Seoul among others). This chapter does not cover them.

Transactions are written differently too. D1's `batch()` takes all its statements up front. You cannot look at a result halfway and branch. DSQL lets you read, decide, and write between `BEGIN` and `COMMIT`. The quota logic above does exactly that. In return for that freedom, you write the retry yourself.

There are plenty of places where D1 is easier: bindings, the real thing locally, Time Travel. This book does not tell you to leave D1. Read this as an option for when SQLite is not enough, when you need PostgreSQL's SQL, or when the database should sit right next to other AWS services.

## What it costs

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The calculations are in [Pricing Worksheets](/en/reference/pricing.md).

Aurora DSQL bills two things. DPUs (one unit covering the compute, reads, and writes spent running SQL) at 10.00 per million, and storage at 0.40 per GB-month. Each month the first 100,000 DPUs and the first GB are free. The pricing page does not say whether that allowance ever ends.

**In a month with no queries, you pay for storage only.** With 1 GB stored that is 0.40 at list price, and 0 inside the allowance.

Here are three ways of merely existing for a month.

| Setup | Assumptions | List price / month |
| --- | --- | --- |
| Aurora DSQL | No queries, 1 GB | 0.40 (0 after the allowance) |
| RDS for PostgreSQL | db.t4g.micro, Single-AZ, 20 GB of gp3 (the minimum), 730 hours | **21.01** |
| Aurora Serverless v2 (no auto-pause) | Staying at the 0.5 ACU minimum for 730 hours, 1 GB | **54.87** |
| Aurora Serverless v2 (paused all month) | 0 ACU minimum, never resumed, 1 GB | 0.12 |

For RDS that is 18.25 for the instance and 2.76 for storage. For Aurora, 54.75 for capacity and 0.12 for storage. The RDS free tier was not checked for this chapter, so nothing is deducted. That means unknown, not zero.

The last row is the most favorable case. Aurora resumes the instance for maintenance at times, and that time is billed. RDS and Aurora also carry VPC-related charges on top (chapter 11).

In use, DSQL looks like this, assuming 1 million requests a month: 900,000 reads and 100,000 writes.

| Item | Quantity | List price | After the monthly allowance |
| --- | --- | --- | --- |
| DPUs | 24,600 | 0.25 | 0 |
| Storage | 1 GB-month | 0.40 | 0 |
| Subtotal | | **0.65** | **0** |

A strong caveat here. 24,600 DPUs is not a measurement. It borrows the documentation's worked examples (0.00675 DPU for a read by primary key, 0.06175 DPU for a one-row `INSERT`) and sets a read at 0.00675 and a write at three times that `INSERT`. The real figure for your queries comes from `EXPLAIN ANALYZE VERBOSE` or from the DPU metrics in CloudWatch.

This table is the database alone. Lambda, API Gateway, and logs cost what they did in chapter 04. Backups add AWS Backup charges, and more reruns add their DPUs.

Destroying the stack stops this chapter's charges.

## Where it goes wrong

| If you see this | Look here |
| --- | --- |
| `dev:sql` stops with `Not applied yet` | Run `vp run sql:db:migrate:local` first |
| `The local database ... is open in process` | `dev:sql` is running. Stop it and try again |
| After a deploy, `/health` is 200 but `/notes` is 500 | Did you run `sql:db:migrate` and `sql:db:grant`? The log should show `relation "app.notes" does not exist` or `permission denied` |
| `Wrong user to action mapping` in the log | The token type does not match the database role. `admin` takes the admin token, everyone else the regular one |
| `IAM authentication failed` or access denied in the log | Does the execution role have `dsql:DbConnect`? Was `sql:db:grant` run with the current role ARN? (recreating the stack changes the ARN) |
| 503 with `busy` | Four attempts, all lost. Writes are piling up on one row. Count the `transaction retry` lines and reconsider which row they collide on |
| `40001` only right after a migration | The schema change beat connections that remembered the old schema (OC001). The rerun should pass |
| `use CREATE INDEX ASYNC instead` | The index statement lacks `ASYNC`. If the lint passes, check the runner's `dialect` |
| `transaction row limit exceeded` | One transaction went over 3,000 rows. Split it |
| Only the first call after a long gap is slow, or fails | The cluster is coming back from Idle or Inactive, or the connection of a frozen execution environment has dropped. Call again |

The last row is written from imagination. What error a dropped connection produces in an execution environment that was frozen has not been seen on the real thing.

## Before production

- **Turn on deletion protection, and keep the cluster when the stack is destroyed.** Right now it is the other way around
- **Set up a backup plan and rehearse a restore at least once.** Including the switch to the new cluster
- **Add authentication.** Every owner is `anonymous` for now ([chapter 06](/en/chapters/06-auth.md))
- **Watch the number of conflicts.** Put alarms on the `transaction retry` lines and on 503s (planned for chapter 19)
- **Run migrations through a fixed path, not from a laptop.** Narrow down who and what holds `dsql:DbConnectAdmin` (planned for chapter 20)
- **Make creates safe to resend from the caller's side.** The server picks the ID today, so resending a `POST` whose response never arrived creates a second note. Change it to accept a key chosen by the caller
- **Decide what to retry when a connection drops.** This chapter retries only `40001`. After a connection error you do not know whether the commit happened. Only work that gives the same result however often it runs may be retried
- **Deploy through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Cleaning up

<!-- section: 13.cleanup -->

```bash
vp run sql:infra:destroy
```

The cluster, the function, the role, the API, and the log group are deleted. The notes and the database role go with the cluster. No backup was taken, so there is no way back.

The local database is gone once you delete `examples/13-sql/.pglite/`.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (transaction retries, the repository on PGlite, injected `COMMIT` conflicts, migration lint and resuming after an interruption, the grant statements, the API, the infrastructure). Type checking. Synth, and loading the resulting bundle in Node.js 24 to see `GET /health` and the 404 for a non-UUID ID. `sql:db:reset:local`, `sql:db:migrate:local`, `sql:db:seed:local`, and that a second run changes nothing. Starting `dev:sql` and running the `curl` commands in the text (create, update, the 409 for an old `version`) plus a delete. That a reset is refused while `dev:sql` runs, and that a stale lock is taken over once the server is stopped.

**Not checked yet.** Nothing was ever connected to a real Aurora DSQL cluster. `sql:infra:deploy`, `sql:db:migrate`, `sql:db:grant`, `sql:db:seed`, `sql:smoke`, `sql:logs`, `sql:infra:drift`, `sql:infra:destroy`, and `dev:sql` with `NOTES_DB=dsql` have not been run. In particular, these are waiting: that DSQL accepts the four migrations. That the job ID can be read from the response to `CREATE INDEX ASYNC` and completion awaited through `sys.jobs`. That `AWS IAM GRANT` and the `GRANT`s let `notes_api` read and write. That the token passes through the `password` function. That a conflict shows up as `40001` in the `code` of node-postgres's error. That cdkd creates the cluster through Cloud Control API and `Ref` returns the identifier. Backup and restore. The DPUs in the cost section are assumptions, not measurements. RDS for PostgreSQL and Aurora Serverless v2 were only read about, in the documentation and the Price List, and never created.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture, Which one? | `examples/13-sql/infra/lib/sql-stack.ts` | `sql:infra:synth` |
| Aurora DSQL is not PostgreSQL | `examples/13-sql/src/migrate.ts`, `test/migrate.test.ts` | `test:unit` |
| Schema and migrations | `examples/13-sql/migrations/`, `src/migrate.ts`, `test/migrate.test.ts` | `test:unit`, `sql:db:migrate:local` |
| Rows into types | `examples/13-sql/src/contract.ts`, `src/db.ts`, `src/notes-repository.ts`, `src/notes.ts`, `src/app.ts` | `test:unit` |
| A transaction is retried as a whole | `examples/13-sql/src/transaction.ts`, `src/notes-repository.ts`, `test/transaction.test.ts` | `test:unit` |
| Causing a conflict on purpose | `examples/13-sql/test/support.ts`, `test/notes-repository.test.ts`, `test/app.test.ts` | `test:unit` |
| Running it locally | `examples/13-sql/src/pglite.ts`, `src/dev.ts`, `src/compose.ts`, `scripts/local-db.ts`, `scripts/db-tasks.ts`, `test/fixtures/seed-notes.json`, `.env.example` | `dev:sql`, `sql:db:migrate:local`, `sql:db:seed:local`, `sql:db:reset:local` |
| Connecting from Lambda | `examples/13-sql/src/dsql.ts`, `src/lambda.ts`, `src/env.ts`, `src/grant.ts`, `infra/lib/sql-stack.ts`, `infra/bin/app.ts`, `infra/test/sql-stack.test.ts`, `cdk.json` | `sql:infra:synth`, `test:unit` |
| Deploy, then run the migrations | `examples/13-sql/scripts/cloud-db.ts`, `scripts/db-tasks.ts`, `scripts/smoke.ts`, `scripts/logs.ts`, `test/grant.test.ts` | `sql:infra:diff`, `sql:infra:deploy`, `sql:db:migrate`, `sql:db:grant`, `sql:db:seed`, `sql:smoke`, `sql:logs`, `sql:infra:drift` |
| Cleaning up | `tools/src/infra/`, `examples/13-sql/scripts/local-db.ts` | `sql:infra:destroy`, `sql:db:reset:local` |
| What it costs | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Resource types and cdkd.** According to `src/provisioning/register-providers.ts` at the pinned version (0.296.28), `AWS::ApiGatewayV2::Api`, `Integration`, `Route`, `Stage`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, and `AWS::Logs::LogGroup` have dedicated providers. `AWS::DSQL::Cluster` does not. It goes through Cloud Control API. `cc-protection-properties.ts` at the same tag registers `DeletionProtectionEnabled` as its deletion protection property.

**Primary sources** (all checked on 2026-10-11)

- Aurora DSQL User Guide: [What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html), [Migrating from PostgreSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html), [Supported SQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html), [CREATE TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html), [ALTER TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html), [CREATE INDEX](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-index-syntax-support.html), [Asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html), [DDL and distributed transactions](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html), [Concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html), [Foreign key constraints](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html), [Primary keys](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-primary-keys.html), [Sequences and identity columns](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-working-with.html), [Quotas and limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html), [Considerations](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/considerations.html), [Release notes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/release-notes.html)
- Authentication and connecting: [Authentication and authorization](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/authentication-authorization.html), [Generating an authentication token](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_authentication-token.html), [Database roles and IAM authentication](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html), [Connectors for Node.js](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html), [Connector for node-postgres](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html), [Cluster connectivity tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/aws-sdks.html), [AWS PrivateLink](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/privatelink-managing-clusters.html), [SSL/TLS certificates](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/configure-root-certificates.html), [Troubleshooting](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/troubleshooting.html), [aws-samples: Using AWS Lambda with Amazon Aurora DSQL](https://github.com/aws-samples/aurora-dsql-samples/blob/main/lambda/README.md)
- Operations and pricing: [Cluster lifecycle](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/cluster-lifecycle.html), [Backup and restore](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html), [How billing works](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html), [Aurora DSQL pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/), AWS Price List bulk API: [Aurora DSQL](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AuroraDSQL/current/ap-northeast-1/index.json), [RDS and Aurora](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json)
- Infrastructure: [AWS::DSQL::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html), the type definitions of [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0), [register-providers.ts in cdkd v0.296.28](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- RDS and Aurora: [Aurora Serverless auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html), [How Aurora serverless works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html), [RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html), [Aurora backups](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html), [DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html), [RDS storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html), [IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html), [RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html), [Point-in-time restore](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- PostgreSQL and npm: [PostgreSQL 16: Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [pg 8.23.1](https://www.npmjs.com/package/pg/v/8.23.1), [@aws-sdk/dsql-signer 3.1149.0](https://www.npmjs.com/package/@aws-sdk/dsql-signer/v/3.1149.0), [@electric-sql/pglite 0.5.8](https://www.npmjs.com/package/@electric-sql/pglite/v/0.5.8) (PGlite's documentation was not read; only what was observed by running it is stated)
- Cloudflare D1: [Local development](https://developers.cloudflare.com/d1/best-practices/local-development/), [Migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/), [Pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Wrangler d1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

:::
