---
title: "13 SQL: Costs, Pitfalls, and Cleanup"
---

# 13 SQL: Costs, Pitfalls, and Cleanup

This last page of the chapter puts the differences from D1 into one table, and then goes through the costs, where to look when something fails, what to change for production, and the cleanup.

## If you're coming from D1

<!-- section: 13.d1 -->

| | Cloudflare D1 | This chapter (Aurora DSQL) |
| --- | --- | --- |
| SQL | SQLite | A subset compatible with PostgreSQL 16 |
| Local | `wrangler dev` provides a local D1, the same D1 as production | PGlite as a stand-in. Not DSQL |
| Migrations | Wrangler runs numbered `.sql` files in order. A failed migration is rolled back | This chapter's runner runs numbered `.sql` files in order. One statement per file, written so that it can be run again after an interruption |
| Connecting | A binding (`env.DB`) | A TCP connection. An IAM token is the password |
| Transactions | The statements listed in one `batch()` form a transaction | From `BEGIN` to `COMMIT`. You can read a value and decide the next statement |
| Simultaneous writes | Writes all go to the one primary | Conflicts are checked at commit. The loser gets `40001` and reruns |
| Where reads are served | Read replicas around the world, asynchronous | Three AZs in one Region, synchronous |
| Backup | Time Travel, to any minute of the last 30 days | AWS Backup, for the whole cluster. A restore is a new cluster |
| Billing units | Rows read, rows written, storage | DPUs, storage |

The largest difference is consistency.

D1's read replicas receive copies from the primary asynchronously, so a replica can be arbitrarily out of date. The Sessions API compensates for that. Within one session it guarantees that reads never go backwards and that you can read what you wrote (sequential consistency). The guarantee covers the session, and what another session sees is not guaranteed unless you pass a bookmark along. Without the Sessions API, every query goes to the primary.

A single-Region Aurora DSQL cluster writes synchronously to three AZs. Whatever was committed is visible to every transaction that follows, so you never have to think about sessions or bookmarks. In exchange, a cluster in Tokyo is in Tokyo. This setup has nothing like D1's read replicas, which place copies near distant readers.

This is why the start of the chapter said that DSQL is not a distributed D1. D1 is a database that you write to in one place and can read from far away, and DSQL is a database in which you see the same data wherever you write within one Region. Multi-Region clusters exist too, but only within a set of Regions in the same area (for Tokyo, Osaka and Seoul among others), and this chapter does not cover them.

Transactions are written differently as well. D1's `batch()` takes all of its statements up front, so you cannot look at a result partway through and branch. On DSQL you can read, decide, and write between `BEGIN` and `COMMIT`. The quota handling on the [Design and Build](/en/chapters/13-sql/build.md) page is an example. The price of that freedom is that you write the retry yourself.

D1 is easier in many places, such as bindings, a local mode that runs the same thing as production, and Time Travel. This book does not recommend leaving D1. Read this chapter as an option for when SQLite is not enough and you need PostgreSQL's SQL, or when you want the database right next to other AWS services.

## Cost

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The calculations are in [Pricing Worksheets](/en/reference/pricing.md).

Aurora DSQL bills only two things, DPUs and storage. A DPU is one unit that covers the compute, reads, and writes spent running SQL, and it costs 10.00 per million. Storage costs 0.40 per GB-month. Each month the first 100,000 DPUs and the first GB are free. The pricing page does not say whether this allowance has an end date.

**In a month with no queries, you pay only for storage.** With 1 GB stored, that is 0.40 at list price and 0 within the free allowance.

The next table compares the three services for a month in which the database only sits there.

| Setup | Assumptions | List price / month |
| --- | --- | --- |
| Aurora DSQL | No queries, 1 GB | 0.40 (0 after the allowance) |
| RDS for PostgreSQL | db.t4g.micro, Single-AZ, 20 GB of gp3 (the minimum), 730 hours | **21.01** |
| Aurora Serverless v2 (no auto-pause) | Staying at the 0.5 ACU minimum for 730 hours, 1 GB | **54.87** |
| Aurora Serverless v2 (paused all month) | 0 ACU minimum, never resumed, 1 GB | 0.12 |

For RDS, the instance is 18.25 and storage is 2.76. For Aurora, capacity is 54.75 and storage is 0.12. The RDS free tier was not checked for this chapter, so nothing is deducted. That means unknown, not zero.

The last row is the most favorable case. Aurora sometimes resumes the instance for maintenance, and that time is billed. RDS and Aurora also add VPC-related charges (chapter 11).

When DSQL is in use, and you assume 1 million requests a month with 900,000 reads and 100,000 writes, the cost is as follows.

| Item | Quantity | List price | After the monthly allowance |
| --- | --- | --- | --- |
| DPUs | 24,600 | 0.25 | 0 |
| Storage | 1 GB-month | 0.40 | 0 |
| Subtotal | | **0.65** | **0** |

24,600 DPUs is not a measured value. It borrows the worked examples in the official documentation (0.00675 DPU for a read by primary key, 0.06175 DPU for a one-row `INSERT`) and simply sets one read at 0.00675 and one write at three times that `INSERT`. You can find the real figure for your queries with `EXPLAIN ANALYZE VERBOSE` or the DPU metrics in CloudWatch.

This table covers the database only. Lambda, API Gateway, and logs are charged as they were in chapter 04. Taking backups adds AWS Backup charges, and more reruns add their DPUs.

### When it gets hammered

Anyone who knows the URL can call this API, any number of times. Three things limit how much it can be called: the stage throttling (10 requests a second for the whole API), the limit on rows (100 per owner), and the limits on response size (20 KiB for a list, 64 KiB for one note).

10 requests a second for 30 days is 25.92 million requests. Assume that every one of them is a write, and apply the assumption above (0.18525 DPU each). Lambda, API Gateway, and logs keep chapter 04's assumptions and unit prices.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration (324,000 GB-seconds) | 9.50 |
| CloudWatch Logs (12.36 GB) | 9.49 |
| DPUs (4,801,680) | 48.02 |
| Storage (100 rows) | 0.00 |
| Total | **100.45** |

The total is about USD 100 a month, but this table stacks assumptions on assumptions. The DPU figure is not measured, and a row with a 10,000-character body should weigh more than the one row in the worked example. The DPUs spent on reruns after conflicts are not included. The 50-millisecond duration is borrowed from chapter 04, and in this chapter, which calls a database, it will be longer. Whether DSQL itself has a setting that stops DPUs has not been checked. The only limit this chapter applies is on the number of requests at the entrance.

Data transfer for the responses is not in this table either. It is calculated the same way as in [the same section of chapter 04](/en/chapters/04-http-api/wrap.md). `GET /notes` returns only summaries of the newest 20 rows, and a test pins it to no more than 20 KiB, so 10 requests a second for 30 days comes to about 494 GB, or about USD 56. Even if all 25.92 million responses were a single 64 KiB note, it would stay at about 1,582 GB, or about USD 180. Whether that unit price applies as it is to API Gateway responses has not been checked.

The limit on rows has a caveat as well. At present everyone is the same owner (`anonymous`), so 100 rows means 100 rows for the whole API, and once someone fills them, nobody else can create a note. Anyone can also delete notes. Separating owners is the job of the authentication in chapter 06.

To stop requests per IP address you would use AWS WAF, but it cannot be attached to an HTTP API, so that setup puts CloudFront in front. The web ACL in [chapter 21](/en/chapters/21-security.md) costs USD 8.00 a month plus USD 0.60 per million requests. This book does not build that setup.

Destroying the stack stops the charges for this chapter.

## Where people get stuck

| If you see this | Look here |
| --- | --- |
| `dev:sql` stops with `Not applied yet` | Run `vp run sql:db:migrate:local` first |
| `The local database ... is open in process` | `dev:sql` is running. Stop it and run the task again |
| After a deploy, `/health` is 200 but `/notes` is 500 | Check that you ran `sql:db:migrate` and `sql:db:grant`. The log should show `relation "app.notes" does not exist` or `permission denied` |
| `Wrong user to action mapping` in the log | The token type does not match the database role. Use the admin token for `admin` and the regular token for any other role |
| `IAM authentication failed` or access denied in the log | Check that the execution role has `dsql:DbConnect` and that `sql:db:grant` was run with the current role ARN (recreating the stack changes the ARN) |
| A 429 such as `{"message":"Too Many Requests"}` comes back | This is the stage throttling. The whole API went over 10 requests a second. It can happen because of someone else's calls, even when you are not calling |
| 503 with `busy` | All four attempts lost. Writes are concentrating on one row. Count the `transaction retry` lines and reconsider which row they collide on |
| `40001` appears only right after a migration | The schema change made connections that remembered the old schema lose (OC001). The rerun should pass |
| `use CREATE INDEX ASYNC instead` | The index statement has no `ASYNC`. If the lint passes, check the runner's `dialect` |
| `transaction row limit exceeded` | One transaction went over 3,000 rows. Split it |
| Only the first call after a long gap is slow, or fails | The cluster is returning from Idle or Inactive, or the connection of a frozen execution environment has dropped. Call again from the caller's side |

The last row is a guess. What error a dropped connection produces in an execution environment that has returned from a freeze has not been observed on a real system.

## If you take this to production

- Turn on deletion protection, and keep the cluster when the stack is destroyed. At present it is the other way around
- Set up a backup plan, and rehearse a restore at least once, including the switch to the new cluster
- Add authentication. At present every owner is `anonymous`, and anyone can delete ([chapter 06](/en/chapters/06-auth.md))
- Fit the rate limit to your own API. 10 requests a second is a value for practice. When you raise it, redo the calculation in "When it gets hammered", including data transfer
- Watch the number of conflicts. Put alarms on the `transaction retry` lines and on the number of 503s (for counting log lines and alarming on them, see [chapter 19](/en/chapters/19-observability.md))
- Run migrations through a fixed path, not from your own machine. Narrow down who holds `dsql:DbConnectAdmin` and where (for building the CI path, see [chapter 20](/en/chapters/20-shipping.md))
- Make creates safe to resend from the caller's side. At present the server chooses the ID, so resending a `POST` whose response never arrived creates a second note. Change the API to accept a key chosen by the caller
- Decide what to retry when a connection drops. This chapter retries only `40001`. After a connection error you cannot tell whether the commit happened. Only work that gives the same result however many times it runs may be retried
- Deploy through the AWS CDK CLI and CloudFormation. Chapter 02 gives the reason

## Cleaning up

<!-- section: 13.cleanup -->

```bash
vp run sql:infra:destroy
```

This deletes the cluster, the function, the role, the API, and the log group. The notes and the database role are deleted with the cluster. No backup was taken, so they cannot be recovered.

The local database is gone once you delete `examples/13-sql/.pglite/`.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (transaction retries, the repository on PGlite, injected `COMMIT` conflicts, migration lint and resuming after an interruption, the grant statements, the API, the infrastructure). These tests also pin the list: it returns no body, it stops at 20 notes, and it stays within 20 KiB with the largest titles. Type checking. Synth, and loading the resulting bundle in Node.js 24 to see `GET /health` and the 404 for a non-UUID ID. `sql:db:reset:local`, `sql:db:migrate:local`, `sql:db:seed:local`, and that a second run changes nothing. Starting `dev:sql` and running the `curl` commands in the text (create, update, the 409 for an old `version`) plus a delete. That a reset is refused while `dev:sql` runs, and that a stale lock is taken over once the server is stopped.

**Not checked yet.** For the stage throttling, a test pins that it is in the template, and the source of the pinned cdkd (0.296.28) was read to confirm that it passes `DefaultRouteSettings` on to API Gateway. Nothing more was done. That it takes effect, the shape of the 429 body, and whether a 429 is charged for were not checked. The amounts in "When it gets hammered" are only computed from unit prices, settings, and assumptions.

Nothing was ever connected to a real Aurora DSQL cluster. `sql:infra:deploy`, `sql:db:migrate`, `sql:db:grant`, `sql:db:seed`, `sql:smoke`, `sql:logs`, `sql:infra:drift`, `sql:infra:destroy`, and `dev:sql` with `NOTES_DB=dsql` have not been run. In particular, these are waiting to be confirmed: that DSQL accepts the four migrations. That the job ID can be read from the response to `CREATE INDEX ASYNC` and completion awaited through `sys.jobs`. That `AWS IAM GRANT` and the `GRANT`s let `notes_api` read and write. That the token from the `password` function is accepted. That a conflict shows up as `40001` in the `code` of node-postgres's error. That cdkd creates the cluster through Cloud Control API and `Ref` returns the identifier. Backup and restore. The DPUs in the cost section are assumptions, not measurements. RDS for PostgreSQL and Aurora Serverless v2 were only read about, in the documentation and the Price List, and never created.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture, The three options | `examples/13-sql/infra/lib/sql-stack.ts` | `sql:infra:synth` |
| How Aurora DSQL differs from PostgreSQL | `examples/13-sql/src/migrate.ts`, `test/migrate.test.ts` | `test:unit` |
| Schema and migrations | `examples/13-sql/migrations/`, `src/migrate.ts`, `test/migrate.test.ts` | `test:unit`, `sql:db:migrate:local` |
| Rows into types | `examples/13-sql/src/contract.ts`, `src/db.ts`, `src/notes-repository.ts`, `src/notes.ts`, `src/app.ts` | `test:unit` |
| A transaction is retried as a whole | `examples/13-sql/src/transaction.ts`, `src/notes-repository.ts`, `test/transaction.test.ts` | `test:unit` |
| Causing a conflict on purpose | `examples/13-sql/test/support.ts`, `test/notes-repository.test.ts`, `test/app.test.ts` | `test:unit` |
| Running it locally | `examples/13-sql/src/pglite.ts`, `src/dev.ts`, `src/compose.ts`, `scripts/local-db.ts`, `scripts/db-tasks.ts`, `test/fixtures/seed-notes.json`, `.env.example` | `dev:sql`, `sql:db:migrate:local`, `sql:db:seed:local`, `sql:db:reset:local` |
| Connecting from Lambda | `examples/13-sql/src/dsql.ts`, `src/lambda.ts`, `src/env.ts`, `src/grant.ts`, `infra/lib/sql-stack.ts`, `infra/bin/app.ts`, `infra/test/sql-stack.test.ts`, `cdk.json` | `sql:infra:synth`, `test:unit` |
| Deploy, then run the migrations | `examples/13-sql/scripts/cloud-db.ts`, `scripts/db-tasks.ts`, `scripts/smoke.ts`, `scripts/logs.ts`, `test/grant.test.ts` | `sql:infra:diff`, `sql:infra:deploy`, `sql:db:migrate`, `sql:db:grant`, `sql:db:seed`, `sql:smoke`, `sql:logs`, `sql:infra:drift` |
| Cleaning up | `tools/src/infra/`, `examples/13-sql/scripts/local-db.ts` | `sql:infra:destroy`, `sql:db:reset:local` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

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
