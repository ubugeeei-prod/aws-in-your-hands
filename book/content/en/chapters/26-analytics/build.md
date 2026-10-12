---
title: "26 Analytics: Design and Build"
---

# 26 Analytics: Design and Build

The [previous page](/en/chapters/26-analytics.md) showed the whole shape: records go through Firehose into S3, and Athena reads them. This page builds it in order: the record, sending it from the app, the folders, the table definition, and the queries.

## The shape of a record

<!-- section: 26.record -->

The first decision is what goes into one record. A record that has reached the bucket stays for 90 days and cannot be rewritten, so it deserves more care than a log line.

<<< @/examples/26-analytics/src/record.ts{schema}

Every field name is lower case with underscores, so that the table's column names and the JSON keys are spelled the same. Some JSON SerDes can lower-case keys to match them to columns, but with identical names nothing depends on that.

`route` is a pattern such as `/notes/:id`, not the path. A path holds a note's ID, so recording it would make the number of distinct values grow without end. A path that is not registered could hold anything, so all of those become `other`. The note's title and body, the query string and the headers are never recorded. The schema is a `strictObject`, so adding a field that is not listed here fails a test.

`action` says what the request did to a note. It is `null` for reads and for failures. The status code decides.

<<< @/examples/26-analytics/src/describe.ts{action}

`at` is a time, but its column type in Athena is a string. For the Hive JSON SerDe to read a string as a timestamp, the format has to be written in a SerDe property. A string does the job. `toISOString()` always writes the same number of digits, down to milliseconds, so the order of the text is the order in time. The schema refuses a timestamp without milliseconds and one with an offset.

`event_id` is a UUID for each record. It is there so that a record that got in twice can be counted once. The next section shows how a record gets in twice.

The same fields are also written down as Athena sees them.

<<< @/examples/26-analytics/src/record.ts{columns}

A test checks that the schema's fields and this list have the same names in the same order. The Glue table is built from this list, so adding a field to the schema and forgetting the table is caught by the test.

This function makes a record from a request and its answer.

<<< @/examples/26-analytics/src/describe.ts{describe}

The ID of a newly created note is only in the answer's body, so the function reads a `clone()` of the answer. The body of the answer that goes back to the caller is left unread.

## From the app to Firehose

<!-- section: 26.producer -->

The chapter 05 app is a function from a `Request` to a `Response`. The recording part is one more function of the same shape around it.

<<< @/examples/26-analytics/src/app.ts{app}

Two decisions are in this function.

One is to wait for the send to Firehose. Lambda may stop the execution environment once the handler has returned its result. If it stops in the middle of a send, nobody knows whether the record arrived. So the function waits for the send to finish, and puts a bound on the wait.

<<< @/examples/26-analytics/src/sink.ts{firehose}

The 500 milliseconds were not chosen from a measurement. How much the wait slows a response has to be measured on a deployment, and this chapter has not done so.

The other is that a failed send does not change the answer. The exception is caught and leaves one line in the log. A missing record is a gap in a chart; a failed request is a user's problem. The tests check, for a sink that fails and for one that throws, that neither the answer nor the notes change.

What goes to Firehose is one line of JSON.

<<< @/examples/26-analytics/src/record.ts{line}

The newline at the end is not optional. Firehose joins the records it has buffered into one object with nothing between them, and Athena's JSON SerDe reads one record per line. Adding the newline is the sender's job.

### When the same record gets in twice

The API reference for `PutRecord` says that re-invoking the Put operations can result in duplicates. A duplicate happens when Firehose has taken the record and the answer does not reach the caller. The SDK treats that as a failure and sends again, and Firehose now has the same line twice.

One test reproduces this with the real SDK. Only the network is replaced: the first attempt is received and then the connection breaks, and the second succeeds. The same line arrives twice. Both copies carry the same `event_id`, so a query can count them as one with `count(DISTINCT event_id)`.

For delivery from Firehose to S3 the documentation says something different. Firehose delivers at least once and duplicates are possible, it says, except for S3 destinations among others. What this chapter prepares for is the duplicate made by the sender's retry.

All the function may do with the stream is add records to it.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{producer}

The function can neither read the bucket nor run a query. If the function were taken over, the records already stored could not be read through it.

This is the function's code. The client is made once, outside the handler, and reused for as long as the execution environment lives.

<<< @/examples/26-analytics/src/lambda.ts{handler}

## Into S3, split by date

<!-- section: 26.delivery -->

The key Firehose gives an object comes from a prefix.

<<< @/examples/26-analytics/src/partition.ts{layout}

`!{timestamp:yyyy-MM-dd}` is an expression that Firehose replaces with a date when it writes. It makes folders such as `requests_json/dt=2026-10-12/`. Once a prefix holds an expression, `ErrorOutputPrefix`, the place for records that failed, has to be given as well.

This is the stream's definition.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{stream}

`bufferingHints` says how much to collect before writing. An object is made after 60 seconds or 5 MB, whichever comes first. A shorter interval makes records show up in queries sooner and makes more objects. The number of objects comes back as the price of writing to S3 and as the number of requests Athena makes when it reads.

### Around midnight

The documentation says which time the expression uses: the approximate arrival timestamp of the oldest record contained in the object being written. The time zone is UTC by default. Two things follow.

First, the folder's date is a UTC date. A record from before 9 a.m. in Japan goes into the previous day's folder.

Second, the folder's date is not always the date in the record's `at`. If a record that arrived at 23:59:50 and one that arrived at 00:00:05 end up in the same object, that object is filed under the earlier day. The second record sits in the folder of the day before it happened.

On the laptop a model that copies just this behaviour is used to check it.

<<< @/examples/26-analytics/src/lake.ts{delivery}

The model reproduces which records share an object and which day's folder the object goes into. It does not reproduce splitting by size, retries, or the 24 hours Firehose keeps data it cannot deliver. It evaluates only the two expressions this chapter uses.

The role Firehose uses to write to the bucket is narrowed to the folders it writes.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{delivery-role}

The list of actions is the one the Firehose documentation gives for an S3 destination. The documentation's example covers the whole bucket; here the actions on objects are limited to the folder for records and the folder for failed records. The role cannot write to the folder for query results. Whether Firehose works with the role narrowed like this has not been checked against AWS.

## The table definition and partition projection

<!-- section: 26.catalog -->

The table Athena reads is defined in the Glue Data Catalog.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{catalog}

An `EXTERNAL_TABLE` is a table that owns no data. Deleting the table deletes no file in the bucket. The other way round, deleting the files leaves the table empty.

`dt` is not in the list of columns, only in `partitionKeys`. The files have no `dt` field: its value comes from the folder's name.

Each format has a fixed combination of classes for reading it.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{storage}

For JSON the Hive SerDe was chosen. Athena's documentation for the other one, the OpenX JSON SerDe, warns that the number of results and their values can differ from run to run, and names the Hive JSON SerDe as the workaround.

The rule for the partitions is written in the table's properties.

<<< @/examples/26-analytics/src/partition.ts{layout}

`NOW` in `projection.dt.range` is the moment the query runs. According to the documentation, values of the date type are generated in UTC. Firehose's prefix is in UTC too, so both go by the same clock. The computed date goes in place of `${dt}` in `storage.location.template`.

The prefix given to Firehose and the template given to Athena have to name the same folder. Change only one, and there is no error: queries return zero rows. A test checks, for JSON and for Parquet, that the evaluated prefix equals the template with a date filled in.

Partition projection has properties worth knowing. A day with no data is still computed as a partition. A missing folder for that day is not an error, and the result is zero rows. A query for a date outside the range also returns zero rows without an error. This chapter's range starts at `2026-10-01`, so a query for an earlier date returns nothing even if data is there. And only Athena uses the rule: another service reading the same table sees only the partitions that were registered.

## Queries

<!-- section: 26.queries -->

As in chapter 19, a query is held as a structure and not written directly as text.

<<< @/examples/26-analytics/src/queries.ts{model}

`from` and `to` are required. A query without a range of days cannot be written in this structure, because such a query would read every folder from `2026-10-01` to today.

The partitions to read are the days asked for and one more on each side.

<<< @/examples/26-analytics/src/queries.ts{partitions}

As the last section showed, a record can be in the folder of the day before it happened. If a send is late, it can be in the next day's. So the folders are read generously, and `at` decides exactly which day a record belongs to.

<<< @/examples/26-analytics/src/queries.ts{render}

Values are placed into the text of a query, so the same care is needed as for chapter 19's queries. A date must be a day that exists, a text value may contain only characters that cannot close the quotes, and a column name must be one the table has.

There are four queries.

<<< @/examples/26-analytics/src/queries.ts{queries}

The SQL text can be seen without AWS.

```bash
vp run analytics:query:print --name actions --from 2026-10-12 --to 2026-10-13
```

```text
SELECT substr(at, 1, 10) AS day, action, count(DISTINCT event_id) AS events
FROM "aih_analytics"."requests"
WHERE dt BETWEEN '2026-10-11' AND '2026-10-14'
  AND at >= '2026-10-12T00:00:00.000Z'
  AND at < '2026-10-14T00:00:00.000Z'
  AND action IS NOT NULL
GROUP BY substr(at, 1, 10), action
ORDER BY day, action
```

Only `statusPerDay` counts with `count(*)`. It removes no duplicates, so a record that is there twice counts as two. In return it does not have to read the `event_id` column. The next section measures what that difference does to the bill.

`approx_percentile`, behind `p95_ms`, returns an approximation. The local evaluation computes the exact value, so with many records the two will not agree.

### Evaluating locally

There is no way here to run Athena's SQL on the laptop. The functions of Athena engine version 3 are based on Trino, and an engine that is easy to run locally treats functions and types differently. A query that passes on a different engine is not evidence that it passes on Athena.

In its place, the same structure is evaluated by a function of this chapter's own.

<<< @/examples/26-analytics/src/queries.ts{run}

This function runs no SQL. What it can check is that the query's structure fits the shape of the records, which folders are chosen, and how duplicates are counted. That Athena accepts the rendered SQL and returns the same results has not been checked.

The tests reproduce the problem around midnight. Requests at 23:59:50 and 00:00:05 are put into one object, which is filed under the earlier day. A naive read of only that day's folder does not find the second record. This chapter's queries, reading a day on each side, find it, and do not count the first record among the next day's.

## JSON and Parquet

<!-- section: 26.columnar -->

The files so far are lines of JSON compressed with gzip. To read one column from such a file, Athena has to read and decompress all of it.

Parquet is a columnar format: inside the file, the data is grouped by column. A query that uses three columns can read just those three. Firehose can convert records it receives as JSON and write them as Parquet. Passing `-c format=parquet` at deploy time gives a stream that converts and a table for Parquet.

<<< @/examples/26-analytics/infra/bin/app.ts{context}

To convert, Firehose reads the list of columns from the Glue table, the same table Athena reads. A record that cannot be converted is put under `errors/format-conversion-failed/`.

Changing the format changes the folder to `requests_parquet/`, because files of two formats under one table cannot be read together. The JSON files from before stay in `requests_json/`, out of the new table's sight.

How much less is read was measured on the laptop. The same 5,000 sample records are written both as gzip JSON and as Parquet, and the bytes per column are read from the Parquet file's footer.

<<< @/examples/26-analytics/src/columnar.ts{measure}

```bash
vp run analytics:sizes
```

| Query | Columns read | gzip JSON | Parquet |
| --- | --- | --- | --- |
| `actions` | `event_id`, `at`, `action` | 293,422 | 209,801 |
| `routes` | `event_id`, `at`, `method`, `route`, `duration_ms` | 293,422 | 219,198 |
| `errors` | `event_id`, `at`, `route`, `status` | 293,422 | 210,979 |
| `status` | `at`, `status` | 293,422 | 31,922 |

The numbers are bytes. For JSON it is the whole file whatever the query; for Parquet it is the sum of the columns read.

Two things in this result go against the expectation that Parquet makes everything smaller.

The first is the size of the whole file. The Parquet file is 422,796 bytes, larger than the 293,422 bytes of gzip JSON. Most of the bytes of this record are its two UUIDs, `event_id` and `request_id`. Random text does not shrink when it is gathered into a column.

The second is the price of removing duplicates. A query that reads `event_id` reads about half the file even in Parquet. `status`, which does not read it, gets by with 11% of the gzip JSON. A columnar format pays off for queries that can leave the large columns unread.

These numbers are for a Parquet file written by a JavaScript library on the laptop. Firehose writes with its own implementation, and its sizes will differ. The bytes Athena really reports as scanned were not checked either. What should carry over is only which columns are the large ones.

At around a million requests a month, the difference does not show on the bill. Athena charges for at least 10 MB per query, so both formats pay the minimum. Converting to Parquet is worth considering once a single query reads far more than 10 MB.

## Against reading too much and keeping too long

<!-- section: 26.guard -->

Athena bills by what it reads, so one query with a forgotten condition is a charge. With a cap on the workgroup, Athena cancels a query that goes past it.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{bounds}

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{workgroup}

The cap is 1 GiB. At 5.00 per TB, one query stops at about 0.005. The lowest cap that can be set is 10 MB.

Three things about this cap. A cancelled query is still charged for what it had read. The cap is per query and does not stop a month's total: what can be set on the total is a notification, and the documentation says queries are not cancelled automatically when that threshold is reached. And the cap applies only to queries run in this workgroup. The same person using another workgroup has no cap. In production, limit which workgroups can be used with IAM.

`enforceWorkGroupConfiguration` keeps a client from overriding settings such as the result location.

On the bucket's side, what is left lying around must not grow for ever.

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{bucket}

<<< @/examples/26-analytics/infra/lib/analytics-stack.ts{retention}

Athena writes a result file to the bucket for every query and never deletes one. The results folder expires after 7 days, the records after 90, and records that failed conversion after 14. All are practice values.

How long to keep the records is decided as for chapter 07's lifecycle rules. Here, though, expiry fits together with partition projection. Folders older than 90 days become empty, and Athena returns zero rows for them without an error.
