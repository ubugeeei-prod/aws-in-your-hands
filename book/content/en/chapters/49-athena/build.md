---
title: "49 Athena: Design and Build"
---

# 49 Athena: Design and Build

The [previous page](/en/chapters/49-athena.md) showed a query going through the workgroup, reading chapter 26's bucket and writing to this chapter's. This page goes through what decides how much is read, the workgroup, how queries are built, the asynchronous API, the statements that make Athena write, Iceberg, tables for logs, and permissions, in that order.

## What decides how much is read

<!-- section: 49.scan -->

The "data scanned" that the price is based on is the bytes of the files Athena read from S3. A compressed file counts at its compressed size. Each query is rounded up to a megabyte and counted as 10 MB even when it read less. DDL and failed queries are not billed, and a cancelled query is billed for what it had read. That much is from the pricing page and the Price List.

Only two things decide how much a query reads: which folders it reads, and which part of each file.

<<< @/examples/49-athena/src/cost.ts{scan}

The first is partitions. Chapter 26's table is split into one folder per day, and a query with `dt` in its condition reads only the folders of the matching days. Without `dt`, it reads every day the table has. Chapter 26's partition projection saves you from registering the list of folders in the catalog. What narrows the read is still the condition in `WHERE`.

The second is the file format. With a row format such as JSON or CSV, a query that uses one column still reads the whole file. Text compressed with gzip can only be read from the beginning, so, according to the documentation, it cannot in general be processed in parallel either. With a columnar format such as Parquet or ORC, a query reads only the columns it uses. As chapter 26 measured, how much that saves depends on which columns are large. A great many small files cancel the advantage of a columnar format, so writing files in large batches matters just as much.

`LIMIT` is neither of the two. `ORDER BY duration_ms DESC LIMIT 10` returns ten rows, but choosing the ten slowest requires reading every row. An aggregate is the same. Whether a `SELECT *` with nothing but a `LIMIT` stops reading early is something the documentation does not say and this chapter did not check. Returning fewer rows does not mean reading fewer bytes, so do not count `LIMIT` as a brake on cost.

<<< @/examples/49-athena/src/cost.ts{cost}

The [last page](/en/chapters/49-athena/wrap.md) works this out for a table with a year of a million records a day. A query that names its day and one that does not differ by a factor of 365 in what they read.

## The workgroup and where results go

<!-- section: 49.workgroup -->

One forgotten condition becomes a charge, so the brake belongs in the workgroup and not in the care of whoever writes the query.

<<< @/examples/49-athena/infra/lib/athena-stack.ts{bounds}

<<< @/examples/49-athena/infra/lib/athena-stack.ts{workgroup}

`bytesScannedCutoffPerQuery` is the most one query may read. Athena cancels a query that passes it. It can be set from 10 MB to 7 EB, and a workgroup has only one. A cancelled query is still billed for what it read, so the limit does not make a mistake free. It sets the price of one mistake: about 0.005 at 1 GiB.

The limit applies to each query and does not count queries. What you can set on a workgroup's total is a notification through a CloudWatch alarm, and the documentation says queries are not cancelled automatically when a threshold is reached. Calling a Lambda function or disabling the workgroup when the notification arrives is yours to build.

With `enforceWorkGroupConfiguration` set to `true`, a client cannot override the result location or the encryption. `expectedBucketOwner` makes Athena check that the bucket it writes results to belongs to this account. Bucket names are unique worldwide, so if the stack is deleted and someone else creates a bucket of the same name, a stale setting could send results there.

The bucket the results go to:

<<< @/examples/49-athena/infra/lib/athena-stack.ts{layout}

<<< @/examples/49-athena/infra/lib/athena-stack.ts{bucket}

For every query, Athena writes a CSV of the result and a metadata file to the result location, and it never deletes them. `results/` expires after 7 days. A cancelled or failed query can leave an unfinished multipart upload behind, so there is also a rule that clears those after a day, as the documentation recommends.

`tables/` has no lifecycle rule. It holds table files. An Iceberg table keeps track of which files belong to it in its metadata, so a lifecycle rule that deletes files breaks the table.

Statements you use often can be saved in the workgroup under a name.

<<< @/examples/49-athena/infra/lib/athena-stack.ts{named-queries}

Only the SQL text is saved, and deploying the stack runs nothing. A statement with `?` in it is saved with the `?`. Whoever runs it supplies the values then.

## Keeping values out of the statement

<!-- section: 49.parameters -->

Chapter 26's queries checked the days and the route and then placed them into the SQL string. While the kinds of value are fixed, that is enough. Once a user's input becomes a condition, switch to a way that keeps values out of the statement.

First, what goes wrong. The following function is here only to be broken by a test.

<<< @/examples/49-athena/src/queries.ts{unsafe}

Give it the route `/notes' OR '1'='1`, and the quote inside the value closes the string, so the rest is read as SQL. The condition becomes `route = '/notes' OR '1'='1'`, and the route no longer narrows anything. Athena bills by bytes read, so this is a problem of someone else's data being visible and, once a condition is removed, a problem of cost as well.

Athena has a way to keep values outside the statement. You write `?` where a value goes, and pass the values separately as `ExecutionParameters`. They are called execution parameters. The documentation says the feature helps prevent SQL injection.

This chapter holds a statement in this form:

<<< @/examples/49-athena/src/statement.ts{statement}

<<< @/examples/49-athena/src/statement.ts{sql}

`sql` is a tagged template. A `${…}` may hold a parameter or a piece of SQL this repository wrote, and nothing else. A plain string has the wrong type, so it does not compile, and it throws if forced through. Mixing a user's value into the text can no longer be written by accident.

Values are made with these functions.

<<< @/examples/49-athena/src/statement.ts{values}

Execution parameters have a quirk. According to the documentation, a value meant as a string must be passed enclosed in single quotes, and a value may also be an expression such as `CAST('2014-07-05' AS DATE)`. The value you pass is read as part of the SQL, in other words. So `text` encloses the value in quotes and doubles every quote inside it, which is how Athena's SQL writes a quote as a character. That a quoted value is treated as one string whatever it contains was not checked against Athena.

A column or table name cannot be a parameter. A name that goes into the statement must be one on a list.

<<< @/examples/49-athena/src/statement.ts{fragments}

With these, the count per route looks like this.

<<< @/examples/49-athena/src/queries.ts{range}

<<< @/examples/49-athena/src/queries.ts{select}

Days are handled as in chapter 26: the folders are read one day wider on each side, and the moments are narrowed exactly with `at`. What differs is that the days, the moments and the route are all parameters.

```bash
vp run athena:sql --name route --from 2026-10-12 --to 2026-10-13 --route /notes
```

```text
SELECT status, count(DISTINCT event_id) AS requests
FROM aih_analytics.requests
WHERE dt BETWEEN ? AND ?
  AND at >= ?
  AND at < ?
  AND route = ?
GROUP BY status
ORDER BY status

parameters: ["'2026-10-11'","'2026-10-14'","'2026-10-12T00:00:00.000Z'","'2026-10-14T00:00:00.000Z'","'/notes'"]
```

The tests hand the same hostile value to both functions. In the string-built one an `OR` appears in the SQL. In the one with parameters, not one character of the SQL text changes, whatever the value. That is the first invariant.

Values still need checking when they are parameters. There are only four routes, so the script compares the route with the list before it builds the query. A parameter prevents the statement from being rewritten. It does not prevent a meaningless value, or one that points at someone else's data.

### Statements that take no parameters

Execution parameters work only in `SELECT`, `INSERT INTO`, CTAS and `UNLOAD`. They do not work in the DDL that creates a table, or in `MERGE INTO` and `OPTIMIZE`, which come later. A value for such a statement can only be built into the string, so it must be one this code made or one whose shape was checked.

<<< @/examples/49-athena/src/statement.ts{inline}

The other way, `PREPARE` and `EXECUTE`, registers a statement in a workgroup and runs it by name. A workgroup holds at most 1,000 of them, and registering and running each need their own IAM permission. This chapter uses only execution parameters, which need no registration.

## Start, wait, fetch

<!-- section: 49.client -->

Running a query is three calls. This chapter's client uses those three and a fourth that stops a query, and no others.

<<< @/examples/49-athena/src/client.ts{api}

Fitting the real SDK to that shape takes a few lines.

<<< @/examples/49-athena/src/athena-sdk.ts{adapter}

The tests use a stand-in of the same shape. It was written from the API reference and models four things only: a start with a token it has seen returns the same ID, the state moves forward in order, results come in pages, and stopping makes a query `CANCELLED`.

The client's result is one of four.

<<< @/examples/49-athena/src/client.ts{outcome}

<<< @/examples/49-athena/src/client.ts{run}

There are five states: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED` and `CANCELLED`. The API reference says the state can go from `RUNNING` back to `QUEUED` on a transient error, so the client keeps waiting when the state moves backwards. The interval between polls starts at 250 milliseconds, doubles, and stops growing at 2 seconds. Those numbers were chosen, not measured.

### When the client stops waiting

The wait has a bound. Past it, the client calls `StopQueryExecution` and then returns. Returning without that call would leave the query reading with nobody watching, billed until it reaches the workgroup's limit. When the call to stop fails, the client returns `stopped: false` to tell its caller that the query is still running. The tests move the clock themselves and check that the client waits exactly up to the bound and that the call to stop is made.

### The same start sent twice

`StartQueryExecution` can succeed without its response reaching the client. To the client that is a failure, so it sends the request again. With nothing else done, the same query runs twice and is billed twice.

`ClientRequestToken` exists to prevent that. According to the API reference, when a request with the same token arrives again, Athena returns the same response and creates no new query.

<<< @/examples/49-athena/src/client.ts{token}

The token is made from the statement, its parameters, and an `attempt` the caller chooses. Calling again with the same `attempt` continues the same query, and a new `attempt` starts a new one. According to the API reference, an SDK generates a token when you leave it out. The caller cannot see that token, though. To point at the same query after the process has died and started over, or when the caller retries by itself, you need a token you chose.

In the test, the first start is "carried out, but its response never arrived". Calling again with the same `attempt` sends the start twice and creates one query. That is the second invariant.

### Reading the result

<<< @/examples/49-athena/src/client.ts{rows}

A result comes at most 1,000 rows at a time, and `NextToken` fetches the rest. Every value arrives as a string. The SDK's type lets a cell have no value, and such a cell is treated as `null`. The first row of a `SELECT` result holds the column names, which the API reference does not say. So the client drops the first row only when it equals the column names exactly.

Reading a large result page by page through the API is the wrong tool. The whole result is in the result location as a CSV. For a result of many rows, read that file, or write it as Parquet with `UNLOAD`, which comes later.

### Reusing a result

A query that runs again and again can reuse its previous result. Pass `reuseMinutes`, and if the same query ran in the same workgroup within that time, Athena returns the previous result without running anything. The age it accepts is 60 minutes by default and 7 days at most.

A reused result does not include records that arrived in the meantime, because Athena does not check whether the source data changed. A query whose result is not determined, such as one with `LIMIT` and no `ORDER BY`, is not reused.

## Making Athena write

<!-- section: 49.writes -->

Athena does not only read. It can write a query's result to S3 as a table or as files. Rewriting records that accumulated as JSON into Parquet is the typical use. Three statements write.

### CTAS

CTAS (`CREATE TABLE AS SELECT`) writes a query's result as files and creates the table that points at them in the same step. Without a format, it writes Parquet.

This chapter's workgroup needs care here. According to the documentation, in a workgroup that enforces its result location, a CTAS with `external_location` fails with an error. Without it, the table's files go under the result location, in `tables/<query ID>/`. In this chapter's bucket that is under `results/`, a place that is emptied after 7 days.

That rules CTAS out for a table you keep. For a temporary table that serves one day's investigation, files that delete themselves are a convenient property.

<<< @/examples/49-athena/src/queries.ts{scratch}

After 7 days the files are gone, but the table's definition stays in the Glue Data Catalog. Remove it with `DROP TABLE` when you are done.

### A table first, then INSERT INTO

A table you keep is created first with DDL that names its location, and filled with `INSERT INTO`.

<<< @/examples/49-athena/src/queries.ts{names}

<<< @/examples/49-athena/src/queries.ts{compact}

The DDL's columns come from chapter 26's list of columns. The column names are in backticks because DDL treats reserved words differently from `SELECT`. In the `SELECT` of an `INSERT INTO`, the partition column goes last.

Every column is in the `GROUP BY` to remove duplicates. As chapter 26 showed, a retried send can store the same record twice, and around midnight the two copies can land in the folders of two different days. The two differ in nothing but `dt`, so the query groups by every column and takes the smaller `dt`.

`INSERT INTO` has a property you have to know. Each run only writes new files and changes no existing file. Run it twice for the same day, and every row of that day is there twice. If it fails partway, files it had begun can stay and be read by the next query. The documentation points to the manifest file Athena writes to the result location as the way to find such files, and recommends Iceberg when you need atomic writes. One `INSERT INTO` or CTAS can write at most 100 partitions.

### UNLOAD

`UNLOAD` only writes a query's result as files and creates no table. A `SELECT` can be received only as CSV, so `UNLOAD` is for handing data to another system as Parquet or JSON.

<<< @/examples/49-athena/src/queries.ts{unload}

The destination must be empty. If files are already there, `UNLOAD` writes nothing. So each run writes to a folder with a name of its own. The name may hold only lower-case letters, digits and hyphens: the location is built into the statement, and a value that points outside the folder must not get through. The files are written in parallel, with no order between them.

## An Iceberg table

<!-- section: 49.iceberg -->

In the tables so far, the files in a folder were the table. With that scheme you cannot correct one row, and you cannot take back a write that stopped halfway.

Apache Iceberg is a format that records in metadata which files belong to a table. Athena's documentation describes writes to an Iceberg table as transactional, meaning that a write that fails partway does not stay in the table half done. Each write makes a new version called a snapshot, and naming an old snapshot reads the table as it was. On Iceberg tables Athena can run `INSERT INTO`, `UPDATE`, `DELETE` and `MERGE INTO` as well as reads. Only Iceberg tables registered in the Glue Data Catalog are supported.

<<< @/examples/49-athena/src/queries.ts{iceberg}

The statement that creates the table has no `EXTERNAL`, which would be an error. The partition column is declared as an ordinary column and then named, without a type, in `PARTITIONED BY`. The partition comes from the column's value and not from a folder name, so whoever writes a query need not know the folder structure.

### A write that adds nothing the second time

`mergeDays` does with `MERGE INTO` what `INSERT INTO` did for the Parquet table. It matches the source records with the table on `event_id` and inserts only those the table does not have yet. Run it twice, and the second run matches every row and adds none. Duplicates that landed in two folders around midnight share an `event_id` too, so they are inserted once.

`MERGE INTO` takes no execution parameters, so the days are built into the statement. Before that, chapter 26's `daySchema` checks that each has the shape of a day that exists.

The matching has a price. To find matching rows, `MERGE INTO` reads the table's side as well. How much of the table this statement reads was not checked.

### Reading the past

`eventsPerDayYesterday` reads the table as it was a day ago. A time after `FOR TIMESTAMP AS OF` selects the snapshot of that moment. After a wrong `MERGE` or `DELETE`, it is the way to look at the state just before.

### Adding a column

In Iceberg, adding, dropping and renaming a column are changes to metadata only. No existing file is rewritten. With chapter 26's scheme, adding a column meant working out compatibility with the old files yourself.

### OPTIMIZE and VACUUM

Row-level changes come with upkeep. Athena's `UPDATE` and `DELETE` do not rewrite the original file. They add delete files that record "this row of this file is gone". Every write also adds small files. Both make reads do more work.

`OPTIMIZE` gathers small files and delete files and rewrites them as larger files. Only partition columns may appear in its `WHERE`. It is billed for the bytes it reads while rewriting.

`VACUUM` expires old snapshots and deletes files no snapshot refers to any more. Snapshots are kept for 5 days by default. An expired snapshot cannot be returned to. Until `VACUUM` runs, the files of deleted rows and the files from before a rewrite stay in the bucket and are billed as storage.

For `VACUUM` to delete files, whoever runs it needs `s3:DeleteObject`. According to the documentation, without the permission the query succeeds and the files are not deleted. That combination hides its own failure, so the stack's role has the permission, on `tables/` only.

## Tables for logs

<!-- section: 49.logs -->

Logs that AWS services write to S3 can be read with Athena too, once a table is defined. For CloudTrail, Application Load Balancers, CloudFront and S3 server access logs, the documentation prints the `CREATE TABLE` statement.

One thing first: none of this book's stacks delivers these logs to S3. What [chapter 21](/en/chapters/21-security.md) read was CloudTrail's event history, and it created no trail. Neither the ALB of [chapter 12](/en/chapters/12-containers.md) nor the CloudFront distribution of [chapter 03](/en/chapters/03-spa.md) has access logs turned on. To read them with Athena you first turn delivery on, and from then on the logs cost storage. What this chapter provides is the table definitions for after that.

The definitions are the documentation's statements, stored as they are in `examples/49-athena/sql/`. The column lists and regular expressions are long, and AWS updates them when a log's format changes, so this chapter does not rewrite them.

<<< @/examples/49-athena/src/logs.ts{kinds}

The documented statements have places where you put your own bucket name and the like. DDL takes no parameters, so the values put there are checked character by character.

<<< @/examples/49-athena/src/logs.ts{input}

<<< @/examples/49-athena/src/logs.ts{ddl}

```bash
vp run athena:logs:ddl --kind cloudtrail --bucket my-trail-bucket --prefix AWSLogs/111122223333/CloudTrail/ap-northeast-1
```

It prints a `CREATE EXTERNAL TABLE` statement and runs nothing. The definitions for CloudTrail and S3 access logs use partition projection, so, as in chapter 26, there are no daily folders to register. The definitions for ALB and CloudFront have no partitions, so a query reads all of the logs. If there are many, switch to the definitions with partition projection that the documentation also has. Those are not stored in this chapter.

None of the four was created in Athena to check it.

## Permissions

<!-- section: 49.permissions -->

The permissions someone needs to run a query are in four places. The stack's role narrows each as follows.

<<< @/examples/49-athena/infra/lib/athena-stack.ts{role}

On the workgroup, the role may run a query, read its state, stop it, fetch its result and read the saved queries, on this workgroup's ARN only. Nothing that changes the workgroup's settings is included, so the role cannot lift its own limit. It has no permission on any other workgroup either, so it cannot move to one without a limit. The documentation's example carries a note that allowing one workgroup does not deny access to the others. For someone who holds broader permissions through another policy, this narrowing does nothing.

On the catalog, the role may read the database `aih_analytics`, and create and change only the three tables this chapter derives. Glue permissions go no finer than a table, and an action on a table also needs permission on its database and on the catalog. Chapter 26's source table can be read, and can be neither changed nor dropped.

On the data bucket, the role may read the folders of records only when chapter 26's bucket name was given as context. Athena reads S3 with the permissions of whoever ran the query, so without this permission a query fails even though the table's definition is visible.

The results bucket has a trap. According to the API reference, anyone with `s3:GetObject` on the result location can read results straight from S3 without any Athena permission. A query result holds part of the source data, so the people who can read the results bucket should be exactly the people who can read the data.

The role can be assumed by anyone in this account whose own policy allows `sts:AssumeRole` on it. In production, name the people who may.

Whether this role can run every statement in this chapter was not checked. Its list of Glue actions is the documentation's example plus what `INSERT INTO` and Iceberg writes are thought to need.
