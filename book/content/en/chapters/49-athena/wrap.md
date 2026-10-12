---
title: "49 Athena: Costs, Pitfalls, and Cleanup"
---

# 49 Athena: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 49.cost -->

This page works out what the queries of this chapter cost. Amounts are in USD, for the Tokyo Region, on demand, before tax. The calculation itself is in [Pricing calculations](/en/reference/pricing.md).

**Deployed, with not one query run in the month, it costs 0.** The workgroup, the saved queries and the role have no price, and the bucket is empty. Neither the Price List nor the pricing page shows a monthly free allowance for Athena.

What a query costs depends only on what it reads. To make the differences visible, assume a table larger than chapter 26's: a year of a million records a day, and the same question (answers per status on one day) asked 1,000 times a month.

| How the query is written, and the table | Read per query | 1,000 a month |
| --- | --- | --- |
| Names its day, gzip JSON | 56 MB | 0.27 |
| Does not name a day, no limit | 20,428 MB | 97.41 |
| Does not name a day, cancelled at the 1 GiB limit | 1,024 MB | 4.88 |
| Names its day, two Parquet columns | the 10 MB minimum | 0.05 |

The only difference between the first row and the second is whether `WHERE` has `dt` in it. Adding a `LIMIT` does not change the second row, because an aggregate reads every row before it has an answer.

The third row is the same mistake made in this chapter's workgroup. The cost falls to a twentieth, and not one query returns an answer. The limit makes a mistake cheaper. It does not correct it. How far past the limit a cancelled query reads was not checked, so the table takes it as exactly 1 GiB.

The fourth row is the same records as a Parquet table. The two columns `at` and `status` take about 6.4 MB for a day. That is under 10 MB, so every query is billed the minimum. The size was measured on chapter 26's sample written by a library on a laptop, and the size of the Parquet that Athena writes was not checked.

Three things are not in the table: the S3 requests Athena makes when it reads data, the storage of results, and requests to the Glue Data Catalog. How many S3 requests one query makes was not checked, as in chapter 26.

### What the writing statements cost

`INSERT INTO`, CTAS, `UNLOAD`, `MERGE INTO` and `OPTIMIZE` are billed by what they read too. What they write is not part of Athena's price, but the files they write cost S3 storage and requests. A derived table means holding the same records in two places.

In an Iceberg table, the files of rows you think you deleted stay in the bucket until `VACUUM` runs. Storage is billed for the files in the bucket, not for the rows the table shows.

### Capacity reservations

The smallest reservation, 4 DPUs, held for a month comes to **1,255.60**. It costs the same without a single query. This chapter's stack creates no reservation. A reservation created to try it and then forgotten keeps being billed by the hour.

## Coming from Cloudflare or Vercel

<!-- section: 49.compare -->

Chapter 26 compared how both platforms collect and aggregate records. This section looks only at what this chapter added, as far as the official documentation showed on 2026-10-13.

On Cloudflare the nearest thing to this chapter is Basin SQL. It was called R2 SQL before, the documentation says it is generally available, and it runs SQL over Iceberg tables in Basin Catalog. Its SQL reference lists `SELECT` with joins and set operations, `SHOW`, `DESCRIBE` and `EXPLAIN`. It does not list `INSERT`, `UPDATE`, `DELETE`, `MERGE` or `CREATE TABLE AS`. Writing to a table is the job of something else, such as Basin Pipelines. The reference says nothing about query parameters either. A query without a `LIMIT` returns 500 rows at most by default.

In short, Basin SQL is an entry point for reading, and it does not show its user a workgroup, an engine version, a result location or table maintenance, all of which you decided for yourself in this chapter. Athena handles writes, row-level changes and log tables with the same engine, and in return you decide all of those and clean up after all of them. If all you do is read Iceberg tables and aggregate, leaving them on Cloudflare's side means far fewer decisions.

Vercel does not appear to have a way to run SQL over files of your own. Query aggregates the request and function events Vercel collected, with conditions chosen in a form or through an AI assistant, and exports results as CSV or JSON. It needs Observability Plus, and its documentation describes no SQL interface. If you want to store what your app emits in a shape of your own and ask questions of it, the storage sits outside Vercel, and this chapter's design is one such place.

## Where it goes wrong

| When this happens | Look here |
| --- | --- |
| A query is cancelled | It passed the workgroup's limit (1 GiB). Check that `WHERE` has a condition on `dt`. A cancelled query is still billed for what it read |
| A result is empty | See chapter 26's table. Folder dates are in UTC, and days before `2026-10-01` are outside the range |
| A query with parameters is refused at the start | Check that the number of `?` equals the number of values. Print the statement and its parameters with `athena:sql` and count |
| A query given a text parameter fails | Check that the value is in single quotes. A value that did not go through `text()` has none |
| CTAS fails with an error about `external_location` | The workgroup enforces its result location. For a table whose location you choose, create it with DDL first and use `INSERT INTO` |
| A table made with CTAS is empty a week later | Its files were under `results/tables/` and the lifecycle rule deleted them. The definition is still there. Remove it with `DROP TABLE` |
| Counts doubled after `INSERT INTO` | It ran twice for the same day. Delete that day's folder and run it once, or move to an Iceberg table and `MERGE INTO` |
| `UNLOAD` writes nothing | The destination already holds files. Pass another name with `--export` |
| `VACUUM` succeeded and the bucket did not shrink | Whoever ran it has no `s3:DeleteObject`. The query succeeds without it |
| `OPTIMIZE` fails with a `FilterNode` error | Its `WHERE` names a column that is not a partition column. Only `dt` may appear |
| A query fails with `AccessDenied` | Read the action and the ARN in the message. For a Glue action, the database and the catalog need the permission as well as the table |
| You stopped waiting and the charge continues | A query runs until it is stopped. Call `StopQueryExecution` with the query's ID |
| The stack cannot be deleted | The bucket is not empty. Run `vp run athena:empty --yes` first |

## For production

- Decide with IAM who may run queries, and in which workgroup. The limit does nothing for someone who can use another workgroup. Check also whether they can use the default workgroup, `primary`
- Put a notification on the workgroup's total bytes scanned. The per-query limit does not stop a large number of queries. If the app runs queries, count the runs yourself as well
- Do not run a query directly from a user's action. Queries run asynchronously, and the number that can run at once has a quota. Aggregate ahead of time, put the result somewhere such as DynamoDB, and let the screen read that
- Let exactly the people who can read the data read the results bucket. Decide how long results are kept by the same standard as the source data
- Decide who runs the statements that build the derived tables, and when. This chapter runs them by hand. To run them on a schedule, put them on [chapter 16](/en/chapters/16-long-jobs.md)'s machinery and put the day into `attempt`, so that a retry for the same day points at the same query
- Schedule `OPTIMIZE` and `VACUUM` for an Iceberg table. To hand that maintenance over, consider S3 Tables
- When you change the engine version, create a second workgroup on the new version and run your usual queries there first. A pinned workgroup is still moved once its version is no longer offered
- Set the bucket's `removalPolicy` to `RETAIN`
- Deploy with the AWS CDK CLI and CloudFormation, for the reasons given in chapter 02

## Cleanup

<!-- section: 49.cleanup -->

If you created derived tables, remove their definitions first. They are in chapter 26's database, so they stay when this chapter's stack is deleted. Replace `<name>` with `requests_compact`, `requests_iceberg` and `scratch_errors`, and drop only the ones you created.

```bash
aws athena start-query-execution --work-group aih-athena --query-string 'DROP TABLE IF EXISTS aih_analytics.<name>'
```

Then empty the bucket and delete the stack.

```bash
vp run athena:empty
vp run athena:empty --yes
vp run athena:infra:destroy
```

The first command only prints how many objects the bucket holds. With `--yes` it deletes all of them: query results, exported files, and the files of the derived tables. The pinned cdkd does not delete a bucket that is not empty, so run it before deleting the stack.

Deleting the stack removes the workgroup, the saved queries, the role and the bucket. The workgroup has `recursiveDeleteOption`, so it should be deletable even with query history in it. That was not checked on real AWS.

Chapter 26's stack and its records are not touched by this cleanup. Clean them up with chapter 26's steps.

## Seen as a distributed system

Athena looks like a query engine with no state, but two things double when it is handled wrongly.

- Who owns the state: table definitions are in the Glue Data Catalog, data is files in S3, and the state of a query is Athena's. For an Iceberg table, metadata holds which files belong to the table
- Invariants: the text of the SQL handed to Athena does not change with a user's value. The client never leaves a query running that it stopped waiting for. The same start starts one query however often it is sent
- Tests that try to break them: a value with a quote in it, a lost response to a start, a query that never finishes, and a call to stop that fails
- Duplicates (queries): a retried start runs the same query twice. A `ClientRequestToken` of your own choosing prevents it
- Duplicates (data): a repeated `INSERT INTO` stores the same rows twice. A Hive-style table has nothing to prevent that, so use an Iceberg table and `MERGE INTO` on `event_id`
- Partial failure: a failed `INSERT INTO`, CTAS or `UNLOAD` can leave files it had begun. In an Iceberg table a failed write is not visible in the table
- Staleness: a reused result can be as old as the age you allowed. Athena does not check whether the source data changed
- Concurrent writes: what happens when two `MERGE INTO` statements write to the same table at once is not covered in this chapter and was not checked. The documentation says Athena supports AWS Glue optimistic locking only

::: details Verification notes for this chapter

**Checked locally.** Unit tests for statement building, the quoting of parameters, the checks on values that go into DDL and `MERGE`, the client (against the chapter's own stand-in), the scan and cost arithmetic, filling in the log table definitions, and the stack (70 tests). The type check. Synth, also with `-c lakeBucketName=<name>`. Printing the ten statements with `athena:sql` and the four table definitions with `athena:logs:ddl`. Chapter 26's `analytics:sizes` was run again to confirm the byte counts used in the cost arithmetic.

**Not checked yet.** `athena:infra:deploy`, `athena:run`, `athena:infra:drift`, `athena:empty` and `athena:infra:destroy` were not run against real AWS. In particular, the following are read from documentation only.

- All of this chapter's SQL. Not one statement was executed in Athena. The syntax follows the documented forms and nothing more. That a `dt` condition given as parameters prunes partitions, and that removing duplicates by putting every column in `GROUP BY` is accepted, were not checked either
- How Athena interprets an execution parameter's value: that a value in quotes, with its quotes doubled, is always treated as one string
- That a workgroup which enforces its result location accepts an Iceberg `CREATE TABLE` with a `location`, an `UNLOAD`, and a `CREATE EXTERNAL TABLE` with a `LOCATION`. The documentation says only that a CTAS with `external_location` fails there
- That the analyst role's permissions are enough to run every statement in this chapter
- That the first row of `GetQueryResults` holds the column names. The API reference does not say so
- Whether a query with only a `LIMIT` stops reading early, and how much a query reads past the limit before it is cancelled
- How much of the table `MERGE INTO` reads, and what happens to two writes that run at once
- That cdkd creates, updates and deletes the workgroup and the saved queries through Cloud Control API
- The four log table definitions. They are the documentation's statements as stored, and none was created in Athena. None of this book's stacks delivers these logs to S3
- Of the prices: the number of S3 requests one Athena query makes, result storage, the prices of S3 Tables, and how queries that run on a capacity reservation are billed
- The statements about Cloudflare and Vercel come from reading summaries of their official documentation. Neither service was run

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, why this design | `examples/49-athena/infra/lib/athena-stack.ts` | `athena:infra:synth` |
| What decides how much is read, cost | `examples/49-athena/src/cost.ts`, `test/cost.test.ts` | `test:unit` |
| The workgroup and where results go, permissions | `examples/49-athena/infra/lib/athena-stack.ts`, `infra/test/athena-stack.test.ts` | `test:unit`, `athena:infra:synth` |
| Keeping values out of the statement | `examples/49-athena/src/statement.ts`, `src/queries.ts`, `test/statement.test.ts`, `test/queries.test.ts` | `test:unit`, `athena:sql` |
| Start, wait, fetch | `examples/49-athena/src/client.ts`, `src/athena-sdk.ts`, `test/client.test.ts`, `test/fake-athena.ts` | `test:unit` |
| Making Athena write, an Iceberg table | `examples/49-athena/src/queries.ts`, `test/queries.test.ts` | `test:unit`, `athena:sql` |
| Tables for logs | `examples/49-athena/src/logs.ts`, `sql/`, `test/logs.test.ts`, `scripts/log-table.ts` | `test:unit`, `athena:logs:ddl` |
| What can be checked on a laptop | `examples/49-athena/scripts/query.ts`, `test/` | `test:unit`, `athena:sql`, `athena:infra:synth` |
| Deploy and check | `examples/49-athena/infra/bin/app.ts`, `scripts/query.ts` | `athena:infra:diff`, `athena:infra:deploy`, `athena:run`, `athena:infra:drift` |
| Cleanup | `examples/49-athena/scripts/empty-output.ts` | `athena:empty`, `athena:infra:destroy` |

**How cdkd (0.296.28) handles the types.** Checked by reading `dist/` of the installed version. With a provider of their own: `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::IAM::Role`, `AWS::IAM::Policy`. Without one, and so through Cloud Control API: `AWS::Athena::WorkGroup`, `AWS::Athena::NamedQuery`. Neither is on cdkd's list of types that Cloud Control API cannot handle (the only Athena type there is `AWS::Athena::Session`). On deletion, an ordering that removes saved queries before their workgroup is built in.

**Primary sources** (read on 2026-10-13; what each supports is in the [list of sources](/en/reference/sources.md))

- Price: [Amazon Athena Pricing](https://aws.amazon.com/athena/pricing/) (how billing works), [AWS Price List: Athena](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonAthena/current/ap-northeast-1/index.json) (unit prices)
- Workgroups and the engine: [Configure per-query and per-workgroup data usage controls](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html), [Athena engine versioning](https://docs.aws.amazon.com/athena/latest/ug/engine-versions-reference.html), [Athena engine version 3](https://docs.aws.amazon.com/athena/latest/ug/engine-versions-reference-0003.html), [Change Athena engine versions](https://docs.aws.amazon.com/athena/latest/ug/engine-versions-changing.html), [Managed query results](https://docs.aws.amazon.com/athena/latest/ug/managed-results.html), [Manage query processing capacity](https://docs.aws.amazon.com/athena/latest/ug/capacity-management.html), [Service Quotas](https://docs.aws.amazon.com/athena/latest/ug/service-limits.html)
- Data scanned: [Partition your data](https://docs.aws.amazon.com/athena/latest/ug/partitions.html), [Optimize data](https://docs.aws.amazon.com/athena/latest/ug/performance-tuning-data-optimization-techniques.html), [Optimize queries](https://docs.aws.amazon.com/athena/latest/ug/performance-tuning-query-optimization-techniques.html)
- Parameters: [Use parameterized queries](https://docs.aws.amazon.com/athena/latest/ug/querying-with-prepared-statements.html), [Configure access to prepared statements](https://docs.aws.amazon.com/athena/latest/ug/security-iam-athena-prepared-statements.html), [SELECT](https://docs.aws.amazon.com/athena/latest/ug/select.html) (how a quote is written), [Escape reserved keywords in queries](https://docs.aws.amazon.com/athena/latest/ug/reserved-words.html)
- API: [StartQueryExecution](https://docs.aws.amazon.com/athena/latest/APIReference/API_StartQueryExecution.html), [QueryExecutionStatus](https://docs.aws.amazon.com/athena/latest/APIReference/API_QueryExecutionStatus.html), [GetQueryResults](https://docs.aws.amazon.com/athena/latest/APIReference/API_GetQueryResults.html), [Reuse query results in Athena](https://docs.aws.amazon.com/athena/latest/ug/reusing-query-results.html), [Identify query output files](https://docs.aws.amazon.com/athena/latest/ug/querying-finding-output-files.html)
- Statements that write: [Considerations and limitations for CTAS queries](https://docs.aws.amazon.com/athena/latest/ug/ctas-considerations-limitations.html), [CREATE TABLE AS](https://docs.aws.amazon.com/athena/latest/ug/create-table-as.html), [INSERT INTO](https://docs.aws.amazon.com/athena/latest/ug/insert-into.html), [UNLOAD](https://docs.aws.amazon.com/athena/latest/ug/unload.html)
- Iceberg: [Query Apache Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html), [Create Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-creating-tables.html), [Update Iceberg table data](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-updating-iceberg-table-data.html), [MERGE INTO](https://docs.aws.amazon.com/athena/latest/ug/merge-into-statement.html), [Perform time travel and version travel queries](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-time-travel-and-version-travel-queries.html), [Optimize Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-data-optimization.html), [Evolve Iceberg table schema](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-evolving-table-schema.html), [Register S3 table bucket catalogs and query Tables from Athena](https://docs.aws.amazon.com/athena/latest/ug/gdc-register-s3-table-bucket-cat.html)
- Tables for logs: [CloudTrail](https://docs.aws.amazon.com/athena/latest/ug/create-cloudtrail-table-partition-projection.html), [ALB](https://docs.aws.amazon.com/athena/latest/ug/create-alb-access-logs-table.html), [CloudFront](https://docs.aws.amazon.com/athena/latest/ug/create-cloudfront-table-standard-logs.html), [S3 server access logs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-s3-access-logs-to-identify-requests.html)
- Permissions: [Example workgroup policies](https://docs.aws.amazon.com/athena/latest/ug/example-policies-workgroup.html), [Configure access to databases and tables in the AWS Glue Data Catalog](https://docs.aws.amazon.com/athena/latest/ug/fine-grained-access-to-glue-resources.html), [Control access to Amazon S3 from Athena](https://docs.aws.amazon.com/athena/latest/ug/s3-permissions.html)
- Others: [Use Amazon Athena Federated Query](https://docs.aws.amazon.com/athena/latest/ug/federated-queries.html), [AWS::Athena::WorkGroup EngineVersion](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-athena-workgroup-engineversion.html)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), the type definitions of [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) and of [@aws-sdk/client-athena 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-athena/v/3.1149.0)
- Cloudflare: [Basin SQL](https://developers.cloudflare.com/r2-sql/), [SQL reference](https://developers.cloudflare.com/r2-sql/sql-reference/)
- Vercel: [Query](https://vercel.com/docs/query)

:::
