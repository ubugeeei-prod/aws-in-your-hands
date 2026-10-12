---
title: "43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality"
sourceRevision: 1
---

# 43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality

A table in the Glue Data Catalog is a promise about files in S3. It says which folder holds files of which columns in which format. The catalog does not check that the files keep the promise. Keeping it is the job of whoever writes the files.

In [chapter 26](/en/chapters/26-analytics.md) Athena read the files exactly as Firehose wrote them. A record could be there twice, and a folder's date was the day the record arrived, which is not always the day the request was answered. Every query absorbed both in its SQL. This chapter builds the side that rewrites the files. A Glue job reads the raw JSON, removes the duplicates, and writes Parquet into one folder for each day requests were answered.

You pay for the time the job runs. A month in which the stack only sits there costs USD 0.10 at list price, for its one alarm, and nothing if the account has ten alarms or fewer. One run of the job costs at least USD 0.0147. The arithmetic is on [the last page](/en/chapters/43-glue/wrap.md).

A Spark job's script is written in Python. It is the one file in this book's code that is not TypeScript. There is no Spark on this machine and none in the Nix shell, so the script has never been executed. What the job must write is defined as a TypeScript function and tested. The script is written to that definition; whether it behaves that way is something the chapter prepares a check for and has not yet run.

This chapter builds on chapters [05](/en/chapters/05-dynamodb.md), [07](/en/chapters/07-uploads.md), [16](/en/chapters/16-long-jobs.md) and [26](/en/chapters/26-analytics.md). The code is in `examples/43-glue/`.

## The whole picture

<!-- section: 43.overview -->

```figure
caption: The job reads the raw files and rewrites them as one Parquet folder a day. The catalog's two tables are definitions: where each folder is, and its columns
node raw: S3 requests_json/ | dt=day of arrival, gzip JSON
node job: Glue job | Spark, 2 DPUs
node curated: S3 requests_curated/ | dt=day answered, Parquet
node catalog: Glue Data Catalog | requests_raw, requests_curated
edge raw -> job: the day's folder and its neighbours
edge job -> curated: replaces the day's folder
edge catalog --> raw: location and columns
edge catalog --> curated: location and columns
mark job
```

```figure
caption: You start the job, or the trigger does. A run that ends without writing reaches the topic through an EventBridge rule
node you: vp run glue:run
node trigger: Glue trigger | 01:00 UTC, off by default
node job: Glue job
node rule: EventBridge rule | FAILED, TIMEOUT, STOPPED
node topic: SNS topic
node alarm: CloudWatch alarm
edge you -> job: StartJobRun
edge trigger --> job
edge job --> rule: Glue Job State Change
edge rule -> topic
edge rule --> alarm: MatchedEvents
mark job
```

The bucket has two folders. `requests_json/` is laid out the way chapter 26's Firehose stream writes: gzip-compressed JSON, filed under the day it arrived. `requests_curated/` is where the job writes: Parquet, filed under the day the request was answered. There is no Firehose stream in this stack. You supply the raw files by uploading a sample.

The catalog has one table for each folder. There is a single list of columns, the one in chapter 26's `record.ts`, and both tables and the schema Spark reads with are made from it.

For each day it is given, the job reads three folders, the day's own and the one on each side, keeps the requests answered that day, and makes records with the same `event_id` one. It checks the rows against the data quality rules and then replaces the day's folder whole.

The trigger is created with a schedule of 01:00 UTC every day and is not activated. Until you activate it, the job runs only when someone starts it.

### The invariant of this chapter

After a run that succeeded, a day's folder holds every request answered that day exactly once. That holds if the previous run died half-way and however many times the same day is run: no row is dropped and none is doubled. [The next page](/en/chapters/43-glue/build.md) writes the tests that try to break it.

## What the name Glue covers

<!-- section: 43.names -->

Glue is not the name of one feature. As of 13 October 2026 the documentation uses it for all of the following.

The Data Catalog is where table definitions live. Athena, Redshift Spectrum, EMR and Glue jobs read the same definitions. The database and table of chapter 26 were here. The first million objects and the first million requests a month are free.

A crawler reads data in S3 or elsewhere, infers its format and columns, and writes tables and partitions to the catalog. It is billed for the time it runs, ten minutes at least for each crawl.

A job is a script that Glue runs. There are four kinds. A Spark job has the command name `glueetl` and needs at least 2 DPUs. A Spark Streaming job is `gluestreaming`. A Python shell job is `pythonshell`: a Python script without Spark, on 0.0625 DPU or 1 DPU. AWS publishes a page on moving away from Python shell jobs, which names Spark jobs, Lambda and ECS as where to go. The fourth kind, Ray jobs, has been closed to new customers since 30 April 2026. This chapter builds a Spark job.

A trigger starts jobs and crawlers on a schedule, on a condition, or by hand. A workflow is several jobs, crawlers and triggers drawn as one graph.

Data Quality evaluates rules written in a language called DQDL, against a table in the catalog or against data inside a job.

The Schema Registry keeps versioned schemas for records that flow through streams such as Kafka and Kinesis Data Streams. It is a different thing from the definition of a table over files, and this chapter does not use it.

DataBrew and interactive sessions are offered under the Glue name too. This chapter leaves them out.

## When to use a job, and when not to

<!-- section: 43.choices -->

A Glue job is not the only way to turn raw JSON into Parquet.

Firehose's format conversion was tried in chapter 26, as `-c format=parquet`. It writes records as Parquet in the order they arrive. It cannot remove a duplicate, and it cannot refile a record under the day it was answered.

Athena's `CREATE TABLE AS SELECT` and `INSERT INTO` can do any transformation SQL can express. The price follows the bytes scanned, and by chapter 26's arithmetic one query came to about USD 0.00005: roughly a three-hundredth of the least a Glue job can cost. There are two limits. One query can write at most 100 partitions. And `INSERT INTO` only adds files, it never replaces them, so running the same day again doubles its rows. Athena itself is the subject of [chapter 49](/en/chapters/49-athena.md).

Lambda is the least effort when a day fits in memory and finishes within 15 minutes. You bring a library that writes Parquet, and you write the code that replaces a folder. Work that does not finish in 15 minutes becomes an ECS task, as in [chapter 16](/en/chapters/16-long-jobs.md).

A Glue Spark job has the highest floor of these. Every run costs at least one minute of 2 DPUs. This chapter's sample is 400 requests a day. Even in chapter 26's estimate for a million requests a month, a day was about 2 MB of gzip. By volume alone, Lambda or Athena is enough.

A Spark job fits when the data does not fit in one machine's memory, when the transformation already exists as Spark code, or when you want a data quality check in the middle of it. With more workers, the same script handles more data.

This chapter builds a job because Glue is its subject. What surrounds the job is the same whichever way you choose, though: decide what must be written as a function first, let the input alone decide where the output goes, and replace instead of appending. None of that changes in Lambda or in Athena.
