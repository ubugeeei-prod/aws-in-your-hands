---
title: "39 Database Migration: DMS, Full Load, CDC, and Cutover"
sourceRevision: 1
---

# 39 Database Migration: DMS, Full Load, CDC, and Cutover

[Chapter 13](/en/chapters/13-sql.md) connected a new application to a new database. This chapter moves the contents of a database that is already in use to another one, without stopping the application for long.

The tool is AWS Database Migration Service (DMS). DMS copies the rows that exist, then follows the changes made while it was copying and applies them. When to stop writes, what to check, and when to point the application at the new database are outside DMS, and they are the main subject of this chapter.

Three things matter to a reader of chapter 13 before going further.

First, DMS cannot migrate to or from Aurora DSQL, the database chapter 13 is built on. Aurora DSQL is in neither the list of DMS sources nor the list of targets (checked 2026-10-13). What the Aurora DSQL documentation offers for a move from PostgreSQL is exporting each table to CSV or Parquet and loading it with the Aurora DSQL Loader, and it describes no path that keeps following changes. So the example here uses the other two options chapter 13 names: a migration from RDS for PostgreSQL to Aurora PostgreSQL.

Second, the cost. Left in place, this chapter's stack costs USD 0.80 a month, which is its two secrets. **Once the replication is started it costs USD 0.1144126570 an hour at 1 DCU, and a replication nobody stopped costs USD 83.52 in a month** (Tokyo, Single-AZ; the breakdown with the endpoint added is under [Costs](/en/chapters/39-database-migration/wrap.md)). The source and target databases are not part of this stack, and both are billed by the hour. When the cutover is done, go on to the [cleanup](/en/chapters/39-database-migration/wrap.md) the same day.

Third, cdkd 0.296.28 cannot deploy this chapter's stack completely. The reason and what to do about it are on the [Deploy](/en/chapters/39-database-migration/deploy.md) page. Nothing was run against AWS, and DMS was never run.

The prerequisites are the SQL and migrations of [chapter 13](/en/chapters/13-sql.md), the VPC of [chapter 11](/en/chapters/11-network.md), and the thinking about recovery in [chapter 22](/en/chapters/22-recovery.md). The code is in `examples/39-database-migration/`. Moving files and objects is the subject of [chapter 38](/en/chapters/38-data-movement.md) and is not covered here.

## The big picture

<!-- section: 39.overview -->

```figure
caption: The replication runs inside the VPC, reads from the old database, and writes to the new one. It takes the credentials for both connections from Secrets Manager
node app: Application | the notes API
node src: RDS for PostgreSQL | source, schema public
node rep: DMS Serverless replication | full-load-and-cdc
node tgt: Aurora PostgreSQL | target, schema app
node sm: Secrets Manager | two secrets
edge app -> src: writes
edge src -> rep: rows and WAL changes
edge rep -> tgt: INSERT, UPDATE, DELETE
edge rep -> sm: GetSecretValue
group vpc: chapter 11 VPC, private subnets = src, rep, tgt
mark rep
```

```figure
caption: A cutover moves through four phases in order: replicating, frozen, verified, switched. In every phase at most one database may accept writes
type: sequence
actor app: App
actor src: Source
actor dms: DMS
actor tgt: Target
step app -> src: writes
step src -> dms: full load, CDC
step dms -> tgt: apply
note src: replicating
step app -x src: writes stop
note src: frozen
step dms -> tgt: what is left
note tgt: verified
step app -> tgt: switch
note tgt: switched
```

Of the first figure, this chapter's stack creates the replication configuration in the middle, the two secrets, and the security group rules between the replication and the two databases. The two databases are taken as already existing.

The second figure is where this chapter spends most of its time. During replicating the source is the truth, during frozen and verified neither database can be written to, and from switched on the target is the truth. DMS does its work in the first two phases, and the rest is procedure on the side of people and the application.

## What DMS moves and what it does not

<!-- section: 39.what-dms-is -->

DMS moves the rows of tables and the changes made to those rows afterward. The official documentation says that what DMS creates on the target is "tables, primary keys, and in some cases unique indexes", and that it creates no objects that are not needed to migrate the data.

For a move from PostgreSQL to PostgreSQL, the DMS and PostgreSQL documentation say the following are not carried over.

- Indexes other than the primary key, and foreign keys. The DMS troubleshooting page tells you to create them on the target by hand
- The current value of a sequence. A number stored in a row travels with the row, but which number comes next does not
- Materialized views. A view can be copied as a table by a full-load-only task, but DMS Serverless does not support views
- The partitioning or inheritance definition of a table. On the target it is created as an ordinary table
- Large objects (the kind of LOB referenced by OID)

Triggers, functions, `CHECK` constraints, and column defaults are not in the list of what DMS creates. No statement that DMS carries users, roles, or privileges was found either. How DMS actually treats any of these was not checked.

So this chapter creates the whole target schema itself, first, and lets DMS neither create nor drop a table. Because it does not rely on what DMS would create, the "not checked" above does not affect the result. The schema is kept in a SQL file, as in chapter 13.

<<< @/examples/39-database-migration/sql/target/0001_schema.sql

DMS Schema Conversion has a similar name and a different purpose. It converts schemas and code when the engine changes, as from Oracle to PostgreSQL. Between two PostgreSQL databases there is nothing to convert, so `pg_dump --schema-only`, or running the application's migrations on the target, is the plain way. DMS also has a feature called homogeneous data migrations, which moves between databases of the same engine with the database's own tools and is documented as carrying secondary objects too. This chapter does not use it.

## The pieces

<!-- section: 39.pieces -->

A DMS migration is made of four pieces.

An endpoint is the configuration of a connection to a database. You create one for the source and one for the target. In this chapter the host name, user name, and password are not written in the endpoint: it reads them from a Secrets Manager secret, as in [chapter 21](/en/chapters/21-security.md).

A task defines which tables are moved and how. There are three migration types. Full load only copies the rows that exist. CDC only follows changes. The type that does a full load and then CDC collects the changes made during the copy, applies them table by table as each copy finishes, and goes on following changes. A migration that can afford only a short stop uses this third type.

Table mappings are JSON inside the task that say which tables are selected and how their names change.

The last piece is the compute that actually runs the task, and there are two ways to get it.

| | Replication instance | DMS Serverless |
| --- | --- | --- |
| What you create | An instance, and tasks on it | A replication configuration (which holds what a task would) |
| When nothing is running | Billed for as long as the instance exists. A dms.t3.micro is USD 0.028 an hour, USD 20.44 a month | No DCU charge if it was not started |
| When it runs | The same instance price | The DCUs in use. USD 0.1144126570 an hour at 1 DCU |
| Capacity | You choose it, and you change it | You set a minimum and a maximum DCU, and it moves between them |
| CloudFormation resources | `AWS::DMS::ReplicationInstance`, `AWS::DMS::ReplicationTask` | `AWS::DMS::ReplicationConfig` |

The amounts are AWS Price List unit prices for the Tokyo Region, Single-AZ (checked 2026-10-13). Per hour of running, 1 DCU of Serverless costs about four times a dms.t3.micro and nearly the same as a dms.t3.medium (USD 0.112). This chapter still chooses Serverless, because a migration ends. During the days of preparation an instance costs money just by existing, and a Serverless configuration does not. The other reason is cdkd: the pinned version refuses `AWS::DMS::ReplicationInstance` from the start as a type it cannot create.

"No charge for a configuration that was not started" is read from the pricing page, which says you pay per hour for the capacity you use, and from the user guide, which says DMS bills for each DCU the replication is currently using. It was not confirmed on a bill.

## Supported pairs, and when DMS is the wrong tool

<!-- section: 39.pairs -->

For the databases this book uses, the DMS lists of sources and targets say the following (checked 2026-10-13).

| | Source | Target |
| --- | --- | --- |
| RDS for PostgreSQL | 10.x to 18.x | 10.x to 18.x |
| Aurora PostgreSQL | Yes | Yes |
| Aurora Serverless v2 | Full load and CDC | Yes |
| Aurora DSQL | Not listed | Not listed |

PostgreSQL 17 and 18 need DMS 3.5.4 or later. The engine version of DMS Serverless is 3.5.4, and you do not choose it.

DMS can migrate the pair RDS for PostgreSQL to Aurora PostgreSQL. It is not necessarily the best tool for that pair. The DMS documentation itself says that for moving a whole database from PostgreSQL to PostgreSQL, native tools such as `pg_dump` can be more effective. If any of the following fits, consider it before DMS.

- The database is small and you can take a maintenance window. `pg_dump` makes a consistent export even from a database in use and does not block other readers or writers. Indexes, constraints, and sequence values come along. You stop writes, dump, restore, and switch the connection
- You are moving all of an RDS for PostgreSQL instance to Aurora PostgreSQL. The Aurora documentation lists migrating from a snapshot, and attaching an Aurora read replica to the RDS instance and making it standalone once the lag is zero. On that page DMS is named only for sources that are not PostgreSQL-compatible
- You want a newer version of the same engine, or different parameters. RDS for PostgreSQL and Aurora PostgreSQL have blue/green deployments, which keep a copy of production in sync and switch over in what is usually under a minute. The RDS documentation says sequence values are brought in line at switchover. Changing the engine is not a use the documentation describes
- You are between two PostgreSQL servers and want to decide the scope in detail yourself. PostgreSQL's own logical replication can be used directly. Like DMS, it carries neither the schema nor the sequences

DMS is needed when none of these can be used: moving only some of the tables, renaming a schema on the way, moving from a PostgreSQL outside AWS or in another account, or changing the engine. The example in this chapter moves tables that were in `public` into chapter 13's `app` schema and leaves the migration bookkeeping table behind. That is not a whole-database move, so a snapshot or a read replica would not do.

## Coming from Cloudflare D1 or from Vercel

<!-- section: 39.other-side -->

DMS cannot be used to bring D1 data to AWS. D1 is reached in three ways, through the Workers binding, the REST API, and Wrangler, and the documentation has no way to connect from outside over a database wire protocol. SQLite is not in the list of DMS sources either (both checked 2026-10-13).

What D1 provides is `wrangler d1 export`, which writes a database to a `.sql` file. You can ask for the schema only, the data only, or chosen tables. The documentation warns that other requests wait while an export runs, and that a database with virtual tables cannot be exported. What comes out is SQLite's SQL, so it will not necessarily load into PostgreSQL as it is. The types and the syntax need adjusting. That conversion was not tried in this chapter.

Vercel has no Postgres of its own today. Vercel Postgres is no longer available, and existing databases were moved to Neon in December 2024. A new project installs a Postgres such as Neon or Supabase from the Marketplace (checked 2026-10-13).

Neon is PostgreSQL, so `pg_dump` can export it. Neon's documentation says to use a connection string that does not go through the pooler. For a small database, stopping writes, running `pg_dump`, and restoring on the AWS side is the dependable way.

Whether Neon can be a DMS source could not be confirmed. The managed PostgreSQL services outside AWS in the DMS list are Azure and Google Cloud only, and Neon's documentation covers DMS only with Neon as the target. Neon can be the sending side of logical replication, but it says that a role created with SQL cannot be given the `REPLICATION` privilege and that an unused slot is removed after about 40 hours. DMS asks for superuser permissions on a self-managed PostgreSQL, so neither side's documentation promises that the two work together.

If D1 or Neon is enough for you, there is no reason to move. A migration is paid for in time stopped and in effort spent checking. The next pages show what that effort consists of.

Continue to [Design and Build](/en/chapters/39-database-migration/build.md).
