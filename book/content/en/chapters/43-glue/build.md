---
title: "43 Glue: Design and Build"
---

# 43 Glue: Design and Build

[The previous page](/en/chapters/43-glue.md) showed the whole shape: a job that rewrites raw files as one Parquet folder a day. This page builds it in this order: the catalog's tables, how partitions are made known, the job's specification, the Spark script, job bookmarks, Data Quality, the job's settings and role, and the failure signal.

## The catalog is a promise, not a check

<!-- section: 43.catalog -->

The names of the database and the tables appear in SQL, so they are fixed.

<<< @/examples/43-glue/src/names.ts{names}

There are two tables, made by one function. They differ in the folder and in how its files are read, and in nothing else.

<<< @/examples/43-glue/infra/lib/glue-stack.ts{catalog}

A table definition holds a location, the names and types of the columns, how the files are read, and the partition key. How the files are read is written as Hive class names.

<<< @/examples/43-glue/infra/lib/glue-stack.ts{storage}

Only what you wrote goes into the definition. If `requests_curated` says `status` is an `int`, the catalog does not look at whether `status` is an integer in the files of that folder. If the job writes it as text, the definition and the files stay at odds, and the first to notice is whoever runs a query.

So the list of columns lives in one place. `COLUMNS` in chapter 26's `record.ts` decides the columns of both tables, the schema Spark reads the JSON with, and the columns the job writes. That the Valibot schema the application builds a record with has the same fields in the same order as `COLUMNS` is checked by chapter 26's tests. This chapter's tests check that both tables' columns equal `COLUMNS`.

`tableType` is `EXTERNAL_TABLE`. Dropping the table deletes no file.

## How partitions are made known

<!-- section: 43.partitions -->

A location in the table definition is not enough for a query engine to treat a folder like `dt=2026-10-10/` as a date. There are three ways to tell it which partitions exist.

The first is to register each partition in the catalog. Athena's `ALTER TABLE ADD PARTITION` and `MSCK REPAIR TABLE` do that. A Glue job can register the partitions it writes too, with `enableUpdateCatalog` on its sink. A registered partition is visible to every engine that reads the catalog.

The second is to let a crawler find them. A crawler walks the folders and registers the partitions it finds.

The third is partition projection, which chapter 26 used. The table's properties state the rule for folder names, and Athena works out which folders to read from the query's conditions. Nothing is registered.

Both tables of this stack use partition projection. `projectionParameters` in the `catalog` region above is that setting, and it is chapter 26's function, unchanged.

Partition projection has a limit worth knowing. It works only when the table is read through Athena. Athena's documentation says that when the same table is read through Redshift Spectrum or EMR, the partitions registered in the catalog are used. The tables of this stack have no registered partition at all. That is why the job does not go through the catalog and reads the S3 paths directly. If another engine has to read these tables through the catalog, switch to the first way and have the job register its own partitions.

### Why a daily crawler is not the default here

A common setup runs a crawler every day to register the new day's folder. This chapter does not, for two reasons.

One is the price. A crawl is billed for ten minutes at least. With 2 DPUs, as in the pricing page's example, one crawl is USD 0.147 and a daily crawl is USD 4.40 a month. How many DPUs a crawler really uses was not confirmed. And what the crawler finds for that money is that tomorrow's folder is called `dt=` followed by tomorrow's date. You knew that already.

The other is the schema. By default a crawler rewrites the schema in the catalog to match the data it read. If a bug in the application wrote `status` as text one day, the next crawl may change the table's definition. The promise moves to follow the files, and nobody is told. There is a setting that leaves the schema alone (`UpdateBehavior` set to `LOG`). A crawler set that way has one task left, which is registering partitions.

A crawler earns its place when you first meet files you did not write and whose shape you do not know. Run it once, let it produce a first definition, then copy that definition into code and keep it there.

## The job's specification

<!-- section: 43.spec -->

Before the Spark script, a TypeScript function decides what the job must write. This function is what runs on your machine and what the tests test.

<<< @/examples/43-glue/src/curate.ts{curate}

It decides two things. A record belongs to the day in `at`, whichever folder it was in. Records with the same `event_id` are one record. As chapter 26 showed, the second copy from a resend has the same content as the first, so which one is kept makes no difference.

The order of the rows means nothing. The script does not decide an order either, so two results are compared by matching `event_id`.

Which folders are read, and which is written, are functions too.

<<< @/examples/43-glue/src/layout.ts{layout}

A day's records are not all in that day's folder. Firehose files an object by the arrival time of its oldest record. A buffer opened just before midnight holds requests of the next day, and a record that arrives late goes into the next day's folder. So the job reads a day on each side. A test shows that reading only the day's own folder comes up short.

The folder that is written depends on the day and on nothing else. Run a day as often as you like: it is the same folder.

This function decides which days a run builds.

<<< @/examples/43-glue/src/layout.ts{plan}

With nothing named, it is yesterday and the day before, in UTC. At 01:00 UTC nearly all of yesterday's records have arrived, but some may still be on their way. The next day's run builds that day once more, and the late records get in then. Building a day twice changes nothing, so a day can be built more often than it needs.

A day that is too old is refused. Raw files are deleted after 90 days and curated files are kept for 365. Rebuilding a day after some of its raw files are gone would replace a complete folder with a partial one. This check is made by `glue:run`, which starts a run from your machine. The script that runs in AWS takes the days as they come.

The tests use this sample.

<<< @/examples/43-glue/src/sample.ts{sample}

It is two days, 800 requests. One record in fifty is sent twice, and the buffer closes every five hours, so the last object of the first day holds requests of the second. One more record was answered at 23:59:59 on the first day, arrived twenty minutes late, and sits in the second day's folder. The filing into folders is done by chapter 26's stand-in for Firehose.

## The Spark script

<!-- section: 43.script -->

This is the whole script.

<<< @/examples/43-glue/glue/curate.py

Read it from the top.

The lines from `# contract:begin` to `# contract:end` are copied from TypeScript. They hold the column list and the data quality rules.

<<< @/examples/43-glue/src/contract.ts{contract}

`vp run glue:contract` rewrites that block, and a test checks that the block in the script is up to date. Change the columns or the rules in TypeScript and forget the script, and the test fails. The rules are copied into the script instead of being passed as an argument because their text contains double quotes and newlines. Whether that can be passed safely as a job argument could not be confirmed, so it sits in the script.

`getResolvedOptions` reads the job's arguments. The stack sets `source`, `target` and `days` as the job's default arguments. A test checks that the stack sets every argument the script asks for.

The script reads the whole folder of raw files. Spark makes a column `dt` from folder names such as `dt=2026-10-10/`. The schema is not inferred: it is the columns copied from TypeScript, with `dt` added. `mode` is `FAILFAST` so that a line that cannot be read does not quietly become a row of `null`s. Spark's default, `PERMISSIVE`, sets the fields of a broken line to `null` and moves on.

The steps for each day are in the order of the specification: keep the folders of the day and its neighbours, keep the rows whose `at` starts with that day, drop duplicate `event_id`s. A day without a single row is skipped and nothing is written, so that a day whose raw files have expired is not replaced by an empty folder.

The write is `mode("overwrite")` and its target is the day's folder. `coalesce(1)` makes one day one file. When a day outgrows one file, that call comes out.

Here is where the specification and the script can part ways. The specification's function receives only records that passed chapter 26's schema. The script reads bytes that are in S3. A line that is not JSON, or one with a field of the wrong type, should make `FAILFAST` fail the run. A line with no `at` becomes `null`, matches no day, and drops out without a word. What keeps such lines out is the strict schema the application applies in chapter 26 before it sends.

One more thing: the script lists all of `requests_json/` on every run. That is 90 days of objects, about 130,000 with chapter 26's 60-second buffer. When the listing takes long enough to matter, change the script to read named folders by path.

## What a job bookmark does and does not guarantee

<!-- section: 43.bookmark -->

Glue has job bookmarks, which remember how far a job has read. With a bookmark enabled, a job reads only the objects that appeared since its last run. That is more efficient than this chapter's job, which reads three days every time. Here is why it was left out, from what the documentation states.

The documentation says this. A bookmark's state is saved when the script calls `job.commit()`. For S3 input, the bookmark picks what to read by the objects' last modified time. Only the input is tracked. When a bookmark is rewound or reset, Glue does not clean up the output files, because the bookmark does not know where the output is.

Two things follow. If a run fails after it wrote its output and before `job.commit()`, the bookmark has not moved. The next run reads the same input again and writes it again. If the output is appended, the rows are doubled. And since a job with a bookmark reads only new files, replacing the output deletes the rows earlier runs wrote.

A model of job runs checks both. A design is a choice of whether a bookmark is used and whether the output is replaced or appended.

<<< @/examples/43-glue/src/model.ts{design}

<<< @/examples/43-glue/src/model.ts{model}

The model is this chapter's reading of the documentation. It is not Spark and it is not Glue. A bookmark is represented as the set of object keys already committed; the real one selects by time. A replacement is "delete, then write": Spark's documentation says that save modes use no locking and are not atomic, and that an overwrite deletes the old data before writing the new.

The tests put the same sample through three designs.

A bookmark with an append gives the right result as long as every run succeeds and no record is repeated across files. Make a run fail after its write and before `job.commit()`, and after the next run every row of the day is there twice. Resetting the bookmark and running again does the same. When the second copy of a resent record arrives later in another file, the first copy has already been written, and both stay.

A bookmark with a replacement goes wrong the other way. The run that reads one file that arrived late replaces the day's folder with that one row. The 400 rows before it are gone.

This chapter's design uses no bookmark: it reads the named days whole and replaces each day's folder. If a run fails after writing, running it again gives the same rows. A file that arrived late gets in on the next run. The output is decided by the input alone, so nothing has to remember how the previous run ended.

It has one weakness. A replacement deletes and then writes. If the run fails in between, the day's folder is empty until a later run succeeds. Someone who queries in the meantime sees a day without a single request. That is why the invariant says "after a run that succeeded". To close that gap you need a table format that switches over after the write is complete. Iceberg, in [chapter 49](/en/chapters/49-athena.md), is one.

The stack sets `--job-bookmark-option` to `job-bookmark-disable` in the job's arguments. Disabled is the default anyway, but if someone enabled it later, together with the replacement it would delete rows, so the intent is written down.

A bookmark fits when the input is too large to read again each time and the output can keep duplicates out by itself: write to a target that overwrites by key, or leave duplicates in and remove them when reading.

## The Data Quality rules

<!-- section: 43.quality -->

Before the job writes a day's rows, it checks them against rules. The rules are TypeScript data.

<<< @/examples/43-glue/src/quality.ts{rules}

What AWS Glue Data Quality reads is text in a language called DQDL. The text is made from the rules.

<<< @/examples/43-glue/src/quality.ts{render}

This is the text that comes out. It is the `RULESET` in the script.

```text
Rules = [
    IsComplete "event_id",
    IsUnique "event_id",
    IsComplete "at",
    ColumnValues "v" = 1,
    ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"],
    ColumnValues "status" between 99 and 600,
    ColumnValues "duration_ms" >= 0
]
```

The range for `status`, `between 99 and 600`, is not a slip. According to the DQDL reference, `between` leaves out both ends. To let 100 through 599 pass, you write 99 and 600. A test at the four boundary values checks that this rule accepts exactly the status codes chapter 26's schema accepts.

So that the rules can be tried locally, there is also a function that evaluates them over rows.

<<< @/examples/43-glue/src/quality.ts{evaluate}

That function is this chapter's model, written from the reference. It is not AWS Glue Data Quality. That a `NULL` row fails `ColumnValues` is implemented as the reference states it. How `IsUnique` counts `NULL` is not stated there, so the model's behaviour is a guess. The ruleset pairs it with `IsComplete`, so a `NULL` fails there in any case.

Data Quality has two ways in: evaluating a table in the catalog, and evaluating inside a job. This chapter uses the second, because the rows to check are the ones about to replace a folder. In the script, one `Failed` rule raises an exception and the day's folder is not touched. The files the previous run wrote stay as they are.

A check inside a job has no price of its own. The time it takes is added to the job's run time.

The rules see only the rows that are left. They cannot tell you about a row that dropped out before the filter by day. DQDL has rules that compare the row count with earlier days, and this chapter does not use them.

## The job's settings and role

<!-- section: 43.job -->

<<< @/examples/43-glue/src/job.ts{job-settings}

<<< @/examples/43-glue/infra/lib/glue-stack.ts{job}

A worker's size is counted in DPUs. One DPU is 4 vCPUs and 16 GB of memory. With `G.1X` a worker is 1 DPU, and a Spark job needs two workers or more. This job is the minimum, 2 DPUs.

The Glue version is 5.1. It is the version a job gets when none is named: Spark 3.5.6 and Python 3.11. Version 6.0 exists as well, with a lower price per DPU-hour. The script has run on neither, so the default was chosen. In 6.0, Spark is 4.1.1 and the S3 connector changes.

Always write `timeout` yourself. Without it, a job on Glue 5.0 or later may run for 480 minutes. At 2 DPUs, 480 minutes is 16 DPU-hours, USD 7.04. This job is cut off at 10 minutes.

`maxRetries` is 0: a person looks at a failed run. `maxConcurrentRuns` is 1: two runs of the same day at once would delete each other's files. A run started while the limit is reached gets an error.

The script goes to S3 as a CDK asset. The role is this.

<<< @/examples/43-glue/infra/lib/glue-stack.ts{role}

A job created in the console gets the managed policy `AWSGlueServiceRole`. That policy contains `glue:*`. This stack does not use it and writes out only what is needed: listing the bucket, reading the raw files, reading, writing and deleting the curated files, reading the one script, and writing to two log groups. The raw files can be read and cannot be changed. The script sits in the bucket every asset shares, so the role names the one object, not the bucket.

Whether this role is enough has not been checked. It has no action that starts with `glue:`. With bookmarks off and data quality results not published, none should be needed, but the documentation did not say so. If one is missing, the job fails with a permission error and the log says what was refused. Add that action and nothing else.

On Glue 5.0 and later, logs go to `/aws-glue/jobs/error` and `/aws-glue/jobs/output` by default. This stack replaces them with two log groups of its own through `--custom-logGroup-prefix`, kept for 7 days and deleted with the stack.

A word on Lake Formation. It adds permissions on the catalog's databases and tables, down to columns and rows. By default it is not in effect: the catalog's resources grant everything to a group called `IAMAllowedPrincipals`, and access is decided by IAM policies alone. That is why this chapter's role could be written in IAM only. In an account that has switched to Lake Formation permissions, the same job needs separate grants on the tables and on the location. This chapter does not cover that.

### The trigger

<<< @/examples/43-glue/infra/lib/glue-stack.ts{schedule}

<<< @/examples/43-glue/infra/lib/glue-stack.ts{trigger}

A schedule is a cron expression in UTC. It has six fields, and the shortest interval is 5 minutes.

A trigger with `startOnCreation` set to `false` is created and starts nothing. To activate it, make the first deploy with `-c schedule=on`, or run `aws glue start-trigger` afterwards. The pinned cdkd does not send `StartOnCreation` when it updates a trigger. A trigger that already exists is not activated by deploying again with `-c schedule=on`.

To run several jobs in sequence, use conditional triggers or a workflow. With one job, this chapter needs neither. Once there are waits and branches, Step Functions in [chapter 47](/en/chapters/47-step-functions.md) is easier to write and to follow.

## Knowing that a run failed

<!-- section: 43.failure -->

Every time a job run ends, Glue sends EventBridge an event called `Glue Job State Change`. The state is one of `SUCCEEDED`, `FAILED`, `TIMEOUT` and `STOPPED`.

<<< @/examples/43-glue/infra/lib/glue-stack.ts{failure}

The rule matches this job in the three states that are not success. In each of them, the day's folder was not written. A matching event goes to an SNS topic. The event says which run ended and in which state. The topic has no subscription. To get an email, add a subscription after deploying.

The alarm watches the number of events that matched the rule. EventBridge records that number for each rule as the metric `MatchedEvents`. The period is one day, so that a failure in the night is still red when someone looks at the list of alarms the next morning. A day without a failure has no data, and missing data is treated as healthy.

There are two things this cannot notice. Glue's events are delivered on a best-effort basis and may not arrive. And on a day when the trigger did not fire and the job never started, there is no failure event either. If the job runs on a schedule, add an alarm for "no `SUCCEEDED` in the last 26 hours".

The names of the fields in the event's `detail` (`jobName`, `state`) were taken from the source of the AWS CDK's Glue construct. The AWS documentation page that described them now redirects elsewhere.
