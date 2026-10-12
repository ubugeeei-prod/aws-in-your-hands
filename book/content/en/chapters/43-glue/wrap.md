---
title: "43 Glue: Costs, Pitfalls, and Cleanup"
---

# 43 Glue: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 43.cost -->

This page works out what the job costs. Amounts are in USD, for the Tokyo Region, on demand, before tax. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

**A month in which the job never runs costs 0.10 at list price.** That is the one alarm. The free allowance covers the first ten alarms of an account, and with this one among them the month costs nothing. The job, the trigger, the rule and a topic without subscriptions cost nothing for existing. The catalog holds one database and two tables, well inside the million free objects. Files left in the bucket are billed for storage.

A job's price is DPUs times time. In the Tokyo Region one DPU-hour is 0.44, billed by the second, and a run is never counted as less than a minute.

<<< @/examples/43-glue/src/cost.ts{dpu}

This job is 2 DPUs, so the least one run can cost is 2 × 60 ÷ 3600 × 0.44, which is 0.0147.

Here is a month of one run a day, 30 runs. No run has been timed, so three cases are worked out.

| Time billed for one run | DPU-hours | A month |
| --- | --- | --- |
| 1 minute (the minimum) | 1 | **0.44** |
| 3 minutes (assumed) | 3 | **1.32** |
| 10 minutes (this job's timeout) | 10 | **4.40** |

The first row is the floor: it cannot be cheaper. The third is the ceiling: runs that go on until the timeout every single day cannot cost more. The real figure is somewhere between. Without a timeout of your own, the ceiling is 7.04 for one run.

S3 requests and storage, and logs, are not in this table. How many requests Spark makes to S3 in one run was not measured.

No free allowance for a job's DPU-hours was found, in the Price List or on the pricing page.

### The same work for less

The same DPU-hour is 0.29 with the Flex execution class, and 0.308 on Glue 6.0. Flex is the class for jobs that are not urgent; the documentation says their start and completion times may vary. For a daily aggregation it is a candidate. Neither was tried with this stack.

Even so, as [the first page](/en/chapters/43-glue.md) compared, at this volume Athena's `INSERT INTO` is cheaper by two orders of magnitude. A job's price does not start from the amount of data. It starts from one minute of 2 DPUs.

### If a crawler ran every day

This stack has no crawler. If one ran once a day, it would cost **4.40** a month. A crawler's DPU-hour is 0.44 as well, but a crawl is billed for ten minutes at least. The figure assumes 2 DPUs, as in the pricing page's example. How many DPUs a crawler really uses was not confirmed.

## If you come from Cloudflare or Vercel

<!-- section: 43.compare -->

This is what could be read in the official documentation as of 13 October 2026. Neither service was run.

Cloudflare has a counterpart to the Glue Data Catalog. Basin Catalog (formerly R2 Data Catalog) is an Apache Iceberg catalog built into an R2 bucket. It has a standard Iceberg REST interface, to which you connect engines such as Spark, Snowflake, PyIceberg and DuckDB. A million catalog operations a month are included, and after that they are 9.00 per million. With compaction turned on, the data it processes costs 0.005 per GB and 2.00 per million objects.

The difference from this chapter's tables is the table format. Basin Catalog holds Iceberg tables only. Cloudflare's page lists ACID transactions among Iceberg's features. This chapter's tables are the kind where the files in a folder are the table, and the only way to replace a day was to delete its folder and then write. The Glue catalog can hold Iceberg tables too. Chapter 49 covers that.

For transformation, Basin Pipelines (formerly Cloudflare Pipelines) reshapes events with SQL as they are ingested and writes them to R2 as Iceberg tables or as Parquet and JSON files. If the files can be written in good shape to begin with, no job has to rewrite them later. An environment that rewrites files already written, in bulk, as a Glue job does, was not found at Cloudflare in the pages read. You bring your own Spark and connect it to the catalog.

Vercel's documentation index names no data catalog and no product that runs batch transformations. That is one index page, so it is not grounds for saying there is none.

In short: if your events already pass through Cloudflare, shaping them in Pipelines at ingestion and writing Iceberg tables takes fewer parts. A Glue job is needed when files already piled up in S3 have to be rewritten, when data has to be joined with other data after ingestion, or when Spark code should run as it is. In exchange, the script's language, the number of workers, the timeout, the role and the way output is replaced are all yours to decide.

## Where it goes wrong

This table is what the documentation and the code lead one to expect. None of it was provoked and seen.

| When this happens | Look here |
| --- | --- |
| A run fails with a permission error | Find the refused action and resource in the log group `/aih/glue/curate/error` and in CloudTrail. Add that action alone to the role |
| A run succeeds and a day's folder is not there | The day had no rows. `--days` are UTC days. See whether `requests_json/` has the folders of that day and of the days on each side |
| A run fails with an error that names a rule | A data quality rule failed. The day's folder is as it was. Find the offending line in the raw files with chapter 26's queries or with `gunzip -c` |
| A run fails with an error about a line it cannot read | `FAILFAST` met a line that is not JSON or a field of the wrong type. See whether anything but the application wrote into `requests_json/` |
| `glue:verify` reports missing rows | The neighbouring folders were not read, or the raw files changed after `glue:seed` |
| `glue:verify` reports doubled rows | Files of an earlier run are still in the day's folder. The replacement did not empty the folder |
| A second run does not start | One run at a time is allowed. Wait for the first to end |
| Athena returns no rows | See whether the folder has files. Days before `2026-10-01` are outside the range of the partition projection |
| Athena shows `NULL` in a column, or a type error | The table's columns and the columns in the files the job wrote disagree. Run `vp run glue:contract`, deploy again, and rebuild the day |
| It does not run every day although `-c schedule=on` was given | A deploy does not activate a trigger that already exists. Run `aws glue start-trigger` |
| A run failed and no notice came | See whether the topic has a subscription. Events are delivered on a best-effort basis |
| The script was fixed and the old one still runs | The script is put in S3 at deploy time. Run `vp run glue:infra:deploy` again |
| The stack cannot be deleted | The bucket is not empty. Run `vp run glue:empty --yes` first |

## Before production

- Take the raw files from chapter 26's stream. Point the stream at this bucket, or set the job's `--source` to chapter 26's bucket and give the role read access there
- Decide how long raw and curated files are kept. Curated files can be rebuilt only while the raw files exist. Keep the raw files for longer than you will ever want to rebuild
- Set the bucket's `removalPolicy` to `RETAIN`
- Add a subscription to the topic, and send the alarm's action to the topic as well. If the job runs on a schedule, add an alarm for no success event in 26 hours
- Decide whether an empty folder in the middle of a replacement is acceptable. If it is not, use an Iceberg table
- When a day grows, remove `coalesce(1)` and add workers. Before adding workers, record the execution time and the DPU-hours of several runs
- Decide in IAM who may start the job. Whoever has `glue:StartJobRun` can change `--target` with an argument. Arguments that must not change go into the job's `NonOverridableArguments`
- Decide how the script is changed: the specification and its tests first, then the script to match, then `glue:seed`, `glue:run` and `glue:verify` on a practice stack, and only then production
- In an account that uses Lake Formation, grant the job's role permissions on the tables and on the location
- Deploy through the AWS CDK CLI and CloudFormation, for the reasons chapter 02 gives

## Cleanup

<!-- section: 43.cleanup -->

```bash
vp run glue:empty
vp run glue:empty --yes
vp run glue:infra:destroy
```

The first only prints how many objects the bucket holds. With `--yes` it deletes every raw and every curated file. The pinned cdkd does not delete a bucket that is not empty, so run it before destroying the stack.

Destroying the stack deletes the job, the trigger, the table definitions, the bucket, the role, the log groups, the rule, the topic and the alarm. An active trigger goes with the rest, so nothing runs afterwards.

Two things are left. One is the storage cdkd's bootstrap created (chapter 02), where the script's file stays. The other is something that may or may not exist. If the job wrote anything to a log group beginning with `/aws-glue/` in spite of `--custom-logGroup-prefix`, that log group is outside the stack. After deploying and running, look whether a log group beginning with `/aws-glue/` has appeared.

## As a distributed system

- Who owns the state: the raw files are the original. The curated files are a copy computed from them, and can be rebuilt any number of times while the raw files exist. From the day a raw file expires, the curated file is the only record
- The invariant: after a run that succeeded, a day's folder holds every request answered that day exactly once
- Tests that try to break it, six of them: running the same day twice, failing after the write and running again, failing after the delete and before the write and running again, adding a late file afterwards, running with the raw files gone, and failing a rule. All of them are tests on the model of runs. No Spark ran
- Duplicates: duplicates in the input are removed by reading the day whole and keeping one row per `event_id`. Duplicate runs are absorbed by replacing the output. With a bookmark and an append, the tests showed both kinds staying
- Partial failure: when a run over several days fails part-way, the earlier days are new and the later ones old. The days are independent, so running again evens them out
- An intermediate state that can be seen: in the middle of a replacement the day's folder is empty or half written. To a reader it is a day with requests missing
- Time: a day ends at midnight UTC, and a record's `at` is the application's clock. "Yesterday" is decided by the clock on Glue's side. Running at 01:00 UTC gives the records around midnight time to arrive, and the next day's run picks up the late ones

::: details Verification notes for this chapter

**Checked locally.** The specification, the folder layout and which days can be rebuilt, the model of runs, the DQDL text and the evaluation of the rules, the columns and rules copied into the script, the pricing quantities, the comparison of rows read back from Parquet, and the stack's assertions (62 unit tests). The type check. Synth, also with `-c schedule=on`. The output of `glue:spec` and `glue:contract`. The help of `glue start-job-run`, `get-job-run`, `start-trigger` and `stop-trigger` in the AWS CLI, for the argument and field names the scripts and the text use. `glue/curate.py` passed a syntax check only, with the machine's own Python 3.12.2, outside Nix.

**Not checked yet.** `glue:infra:deploy`, `glue:seed`, `glue:run`, `glue:verify`, `glue:infra:drift`, `glue:empty` and `glue:infra:destroy` were not run against AWS. These points in particular are read from documentation and source only.

- That `glue/curate.py` runs, and that it writes what the specification says. It has never been executed, on Spark or on Glue. Reading the partition column with `dt STRING` added to the schema, what makes `FAILFAST` stop, `DataFrame.isEmpty`, the shape of what `awsgluedq`'s `process_rows` returns on Glue 5.1, an overwrite replacing only the day's folder, and what happens when `requests_json/` holds nothing
- The job's arguments. That `--days` passed with a run replaces only the default argument of the same name. That no `PythonVersion` is set on the job (the type definitions describe it as a property for Python shell jobs)
- That the role is enough. Whether the job runs without any `glue:` or `cloudwatch:` action, whether it asks for `logs:CreateLogGroup` on log groups that exist, and whether the S3 connector writes objects outside `requests_curated/`
- The real evaluation by Data Quality. This chapter's `evaluate` is a model. How `IsUnique` treats `NULL`, the outcome for zero rows, and how a numeric `=` compares
- The failure signal. The field names in the event's `detail`, that `MatchedEvents` is recorded for this rule, and how the alarm behaves
- Deploying with cdkd. Where the script's asset goes and the rewriting of the bucket name inside the template. Updating the trigger
- How long a run takes, and whether start-up time is billed. The three minutes in the price table are an assumption
- That Athena reads the Parquet Spark wrote with the definition of `requests_curated`
- That `glue:verify` can read the Parquet Spark wrote. What the tests read was written by a JavaScript library
- The statements about Cloudflare and Vercel come from reading their documentation only

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture; when to use a job, and when not to | `examples/43-glue/infra/lib/glue-stack.ts` | `glue:infra:synth` |
| The catalog is a promise, not a check | `examples/43-glue/src/names.ts`, `infra/lib/glue-stack.ts`, `infra/test/glue-stack.test.ts` | `test:unit`, `glue:infra:synth` |
| How partitions are made known | `examples/43-glue/infra/lib/glue-stack.ts`, `infra/test/glue-stack.test.ts`, `src/cost.ts` | `test:unit` |
| The job's specification | `examples/43-glue/src/curate.ts`, `src/layout.ts`, `src/sample.ts`, `test/curate.test.ts`, `test/layout.test.ts` | `test:unit`, `glue:spec` |
| The Spark script | `examples/43-glue/glue/curate.py`, `src/contract.ts`, `scripts/contract.ts`, `test/contract.test.ts` | `test:unit`, `glue:contract` |
| What a job bookmark does and does not guarantee | `examples/43-glue/src/model.ts`, `test/model.test.ts` | `test:unit` |
| The Data Quality rules | `examples/43-glue/src/quality.ts`, `test/quality.test.ts` | `test:unit`, `glue:spec` |
| The job's settings and role; knowing that a run failed | `examples/43-glue/src/job.ts`, `infra/lib/glue-stack.ts`, `infra/test/glue-stack.test.ts` | `test:unit`, `glue:infra:synth` |
| Run it locally | `examples/43-glue/scripts/spec.ts`, `scripts/contract.ts`, `src/sample.ts` | `glue:spec`, `glue:contract`, `test:unit` |
| Deploy and check | `examples/43-glue/infra/bin/app.ts`, `scripts/seed.ts`, `scripts/run.ts`, `scripts/verify.ts`, `src/compare.ts`, `src/parquet.ts` | `glue:infra:diff`, `glue:infra:deploy`, `glue:seed`, `glue:run`, `glue:verify`, `glue:infra:drift` |
| Cost | `examples/43-glue/src/cost.ts`, `test/cost.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `examples/43-glue/scripts/empty.ts`, `tools/src/infra/` | `glue:empty`, `glue:infra:destroy` |

**How cdkd (0.296.28) handles it.** Checked by reading the `dist/` of the installed version. All 13 types this stack uses have their own implementation: `AWS::Glue::Database`, `AWS::Glue::Table`, `AWS::Glue::Job`, `AWS::Glue::Trigger`, `AWS::Events::Rule`, `AWS::CloudWatch::Alarm`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::Logs::LogGroup`, `AWS::IAM::Role` and `AWS::IAM::Policy`. The Glue job implementation passes every property this stack uses (`Command`, `Role`, `GlueVersion`, `WorkerType`, `NumberOfWorkers`, `Timeout`, `MaxRetries`, `ExecutionProperty`, `DefaultArguments`) to `CreateJob`. The trigger implementation passes `StartOnCreation` at creation only.

**Primary sources** (all read on 2026-10-13; what each one supports is in [the list of sources](/en/reference/sources.md))

- Glue as a whole: [What is AWS Glue?](https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html), [AWS Glue versions](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html), [AWS Glue for Ray end of support](https://docs.aws.amazon.com/glue/latest/dg/awsglue-ray-jobs-availability-change.html), [Python shell jobs](https://docs.aws.amazon.com/glue/latest/dg/add-job-python.html), [Migrate from AWS Glue Python shell jobs](https://docs.aws.amazon.com/glue/latest/dg/pyshell-migration.html), [AWS Glue Schema registry](https://docs.aws.amazon.com/glue/latest/dg/schema-registry.html)
- Jobs: [Configuring job properties for Spark jobs](https://docs.aws.amazon.com/glue/latest/dg/add-job.html), [Using job parameters](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-glue-arguments.html), [getResolvedOptions](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-api-crawler-pyspark-extensions-get-resolved-options.html), [Logging for AWS Glue jobs](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuous-logging.html), [Create an IAM role for AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/create-an-iam-role.html), [AWSGlueServiceRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSGlueServiceRole.html)
- Job bookmarks: [Tracking processed data using job bookmarks](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html), [Using job bookmarks](https://docs.aws.amazon.com/glue/latest/dg/programming-etl-connect-bookmarks.html)
- Crawlers and partitions: [Using crawlers to populate the Data Catalog](https://docs.aws.amazon.com/glue/latest/dg/add-crawler.html), [Preventing a crawler from changing an existing schema](https://docs.aws.amazon.com/glue/latest/dg/crawler-schema-changes-prevent.html), [Updating the schema and adding new partitions using AWS Glue ETL jobs](https://docs.aws.amazon.com/glue/latest/dg/update-from-job.html), [Use partition projection with Amazon Athena](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html), [Partition your data](https://docs.aws.amazon.com/athena/latest/ug/partitions.html)
- Triggers and workflows: [AWS Glue triggers](https://docs.aws.amazon.com/glue/latest/dg/about-triggers.html), [Time-based schedules](https://docs.aws.amazon.com/glue/latest/dg/monitor-data-warehouse-schedule.html), [Overview of workflows](https://docs.aws.amazon.com/glue/latest/dg/workflows_overview.html)
- Data Quality: [AWS Glue Data Quality](https://docs.aws.amazon.com/glue/latest/dg/glue-data-quality.html), [DQDL reference](https://docs.aws.amazon.com/glue/latest/dg/dqdl.html), [ColumnValues](https://docs.aws.amazon.com/glue/latest/dg/dqdl-rule-types-ColumnValues.html), [IsComplete](https://docs.aws.amazon.com/glue/latest/dg/dqdl-rule-types-IsComplete.html), [IsUnique](https://docs.aws.amazon.com/glue/latest/dg/dqdl-rule-types-IsUnique.html), [Data Quality for ETL jobs in AWS Glue Studio notebooks](https://docs.aws.amazon.com/glue/latest/dg/data-quality-gs-studio-notebooks.html)
- Events: [Automating AWS Glue with EventBridge](https://docs.aws.amazon.com/glue/latest/dg/automating-awsglue-with-cloudwatch-events.html), [AWS Glue events](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-glue.html), [Monitoring Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring.html), [aws-glue-alpha job.ts in aws-cdk v2.273.0](https://github.com/aws/aws-cdk/blob/v2.273.0/packages/@aws-cdk/aws-glue-alpha/lib/jobs/job.ts)
- The other ways: [Considerations and limitations for CTAS queries](https://docs.aws.amazon.com/athena/latest/ug/ctas-considerations-limitations.html), [INSERT INTO](https://docs.aws.amazon.com/athena/latest/ug/insert-into.html), [Configure Amazon S3 object name format](https://docs.aws.amazon.com/firehose/latest/dev/s3-object-name.html)
- Lake Formation: [What is AWS Lake Formation?](https://docs.aws.amazon.com/lake-formation/latest/dg/what-is-lake-formation.html), [Changing the default settings for your data lake](https://docs.aws.amazon.com/lake-formation/latest/dg/change-settings.html)
- Spark 3.5.6: [JSON Files](https://spark.apache.org/docs/3.5.6/sql-data-sources-json.html), [Generic Load/Save Functions](https://spark.apache.org/docs/3.5.6/sql-data-sources-load-save-functions.html), [Parquet Files](https://spark.apache.org/docs/3.5.6/sql-data-sources-parquet.html) (the section on partition discovery)
- Pricing: [AWS Glue Pricing](https://aws.amazon.com/glue/pricing/) (only the billing rules were read here; the unit prices are from the Price List), [AWS Price List bulk API: Glue](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSGlue/current/ap-northeast-1/index.json) (the version published on 2026-10-06)
- The `dist/` of [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), and the type definitions of [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)
- Cloudflare: [Basin Catalog](https://developers.cloudflare.com/r2/data-catalog/), [Basin Catalog pricing](https://developers.cloudflare.com/r2/data-catalog/platform/pricing/), [Basin Pipelines](https://developers.cloudflare.com/pipelines/)
- Vercel: [the documentation index](https://vercel.com/docs/llms.txt)

:::
