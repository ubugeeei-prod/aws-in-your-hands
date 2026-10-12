---
title: "49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs"
sourceRevision: 1
---

# 49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs

Athena bills for the bytes a query reads from S3: USD 5.00 per TB in the Tokyo Region, and nothing for what sits idle. Everything in this chapter follows from that one line. How files are laid out so that less is read, a workgroup that stops a query that reads too much, queries built so that a user's value cannot rewrite the statement, and what to watch when Athena is the one writing.

[Chapter 26](/en/chapters/26-analytics.md) collected request records in S3 through Firehose, defined them as an Athena table, and prepared three aggregate queries. This chapter picks up there. It uses chapter 26's table as it is and goes deeper into Athena itself. Glue crawlers and ETL jobs belong to [chapter 43](/en/chapters/43-glue.md) and are left to it.

It builds on [chapter 07](/en/chapters/07-uploads.md), [chapter 19](/en/chapters/19-observability.md) and [chapter 26](/en/chapters/26-analytics.md). The code is in `examples/49-athena/`, and it uses chapter 26's code as a workspace dependency.

Nothing in this chapter's stack is billed by the hour. Deployed and unused, it costs 0. You pay when a query runs, and for as long as files stay in the bucket. The arithmetic is on the [last page](/en/chapters/49-athena/wrap.md).

## The whole picture

<!-- section: 49.overview -->

```figure
caption: A query goes through the workgroup. It reads chapter 26's bucket and writes only to this chapter's
node you: vp run athena:run | the analyst role
node wg: Athena workgroup | 1 GiB limit, engine version 3
node glue: Glue Data Catalog | aih_analytics
node lake: Chapter 26's bucket | requests_json/
node out: This chapter's bucket | results/, tables/, exports/
edge you -> wg: SQL and execution parameters
edge wg -> glue: table definitions
edge wg -> lake: reads the matching days only
edge wg --> out: results, derived tables
mark wg
```

Athena has no server and no cluster. The only thing you can see of it is the workgroup. A workgroup decides where query results are written, how much one query may read, and which engine version runs it. This chapter's stack creates one workgroup with a limit of 1 GiB.

Whoever runs a query needs permission in four places: the workgroup, the Glue Data Catalog that holds the table definitions, the bucket with the data, and the bucket the results go to. Athena reads and writes S3 with the permissions of the person who ran the query. The stack includes a role with each of the four narrowed to what is needed.

What Athena writes can be thrown away at different times, depending on what it is. Query results are deleted after 7 days and exported files after 30, and table files are never deleted. The three live in folders of one bucket.

### A query runs asynchronously

```figure
caption: A query is three calls: start it, wait for it, fetch its result
type: sequence
actor client: runQuery
actor athena: Athena
step client -> athena: StartQueryExecution (with a token)
step athena --> client: QueryExecutionId
step client -> athena: GetQueryExecution
step athena --> client: QUEUED / RUNNING
step client -> athena: GetQueryExecution
step athena --> client: SUCCEEDED
step client -> athena: GetQueryResults
step athena --> client: rows and NextToken
```

Athena's API has no call that takes SQL and returns its result. Starting a query returns only an ID. You ask for its state while you wait, and fetch the result once it has finished. If you stop waiting, the query does not stop. It keeps reading, and it keeps being billed.

### This chapter's invariants

Two things must hold. First, the text of the SQL handed to Athena does not change with a value that came from a user. Second, the client never leaves a query running that it stopped waiting for, and the same start sent twice starts one query. The [next page](/en/chapters/49-athena/build.md) has tests that try to break both.

## Why this design

<!-- section: 49.choices -->

### Pinning the engine version

Athena SQL runs on Athena engine version 3 today. According to the documentation, that version continuously integrates the work of the Trino and Presto projects, and it refers to the Trino documentation for the list of functions. Which Trino release it corresponds to is not stated. DDL such as `CREATE EXTERNAL TABLE` is a different dialect, Hive's. Even reserved words are escaped differently: backticks in DDL, double quotes in `SELECT`.

A workgroup upgrades automatically by default. When a new version appears, Athena switches the workgroup to it unless it finds an incompatibility. This chapter's workgroup names its version, so that the SQL keeps running on the version it was written for and you choose when to move. A pinned workgroup is still moved by Athena once its version is no longer offered.

### Query results in a bucket of your own

A workgroup can also keep results in storage that Athena manages (managed query results). You need no bucket, results are deleted after 24 hours, and storing them costs nothing. This chapter uses its own bucket anyway, because managed query results do not support result reuse. For a dashboard that repeats the same query, reuse makes Athena return the previous result without running the query. You also need your own bucket to keep a result for longer than 24 hours.

### No capacity reservation

Instead of paying for bytes read, you can pay by the hour for processing capacity held for you. A capacity reservation holds capacity measured in DPUs. The minimum is 4 DPUs, at 0.43 per DPU-hour in the Tokyo Region. Four DPUs held for a month come to 1,255.60, with or without a single query. It is something to consider at a scale where you want to decide how many queries run at once, and this book is not at that scale.

### No S3 Tables

S3 has table buckets (S3 Tables) as a place for Iceberg tables. S3 compacts their files and expires their old snapshots automatically, and Athena sees them as a catalog in the Glue Data Catalog. The documentation says that Athena's `OPTIMIZE` and `VACUUM` cannot be used on S3 Tables, and that maintenance is managed on the S3 side.

This chapter puts its Iceberg table in an ordinary bucket, so that you run `OPTIMIZE` and `VACUUM` yourself and see what they do. For an Iceberg table you keep in production for years, S3 Tables, which take that maintenance over, are a strong candidate. Their prices were not checked for this chapter.

### Data outside S3

Athena can also query data that is not in S3. Federated Query reads relational databases and other data sources through connectors. Some connectors run as a Lambda function in your account, and others are registered as Glue connections. It becomes a candidate when you want to compare the notes' current state with the records, but what the connector reads is billed too, and so is the Lambda function. This chapter does not use it.

### When you do not need this chapter

If you run chapter 26's queries a few times a month, chapter 26's workgroup is enough. You need this chapter when a user's input becomes a condition of a query, when the app runs queries, when the records have grown until reading JSON starts to matter, or when rows have to be corrected or deleted.
