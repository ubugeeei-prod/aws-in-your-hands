---
title: "13 SQL: Costs, Pitfalls, and Cleanup"
---

# 13 SQL: Costs, Pitfalls, and Cleanup

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

### If it gets hammered

Anyone who knows the URL can call it, as often as they like. Two things stand in the way: the stage's throttling (10 requests a second for the whole API) and the quota on rows (100 per owner).

10 a second for 30 days is 25.92 million requests. Say every one of them is a write, and apply the assumption from above (0.18525 DPU each). Lambda, API Gateway, and logs keep chapter 04's assumptions and unit prices.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration (324,000 GB-seconds) | 9.50 |
| CloudWatch Logs (12.36 GB) | 9.49 |
| DPUs (4,801,680) | 48.02 |
| Storage (100 rows) | 0.00 |
| Total | **100.45** |

About USD 100 a month. But this table stacks assumptions on assumptions. The DPU figure is not measured, and a row with a 10,000-character body should weigh more than the one-row example. The DPUs spent on reruns after a conflict aren't in it. The 50-millisecond duration is borrowed from chapter 04, and in this chapter, which calls a database, it will be longer. Whether DSQL itself has a setting that stops DPUs hasn't been checked. The only lid this chapter puts on is the request count at the entrance.

Data transfer for the responses isn't in it either. `GET /notes` returns all 100 rows, so the calculation in chapter 04's "If it gets hammered" applies here as it stands. It's the biggest hole, and a lid on the count doesn't close it.

The quota comes with a caveat too. Right now everyone is the same owner (`anonymous`), so 100 rows means "100 for the whole API". If somebody fills it, nobody else can create a note. And anyone can delete. Telling callers apart is what the authentication in chapter 06 is for.

If you want to stop one IP address at a time, that's AWS WAF, but it can't be attached to an HTTP API, so you'd put CloudFront in front. The web ACL in [chapter 21](/en/chapters/21-security.md) costs USD 8.00 a month plus USD 0.60 per million requests. This book doesn't build that setup.

Destroying the stack stops this chapter's charges.

## Where it goes wrong

| If you see this | Look here |
| --- | --- |
| `dev:sql` stops with `Not applied yet` | Run `vp run sql:db:migrate:local` first |
| `The local database ... is open in process` | `dev:sql` is running. Stop it and try again |
| After a deploy, `/health` is 200 but `/notes` is 500 | Did you run `sql:db:migrate` and `sql:db:grant`? The log should show `relation "app.notes" does not exist` or `permission denied` |
| `Wrong user to action mapping` in the log | The token type does not match the database role. `admin` takes the admin token, everyone else the regular one |
| `IAM authentication failed` or access denied in the log | Does the execution role have `dsql:DbConnect`? Was `sql:db:grant` run with the current role ARN? (recreating the stack changes the ARN) |
| A 429 like `{"message":"Too Many Requests"}` comes back | That's the stage's throttling. The whole API went past 10 requests a second. It happens on somebody else's traffic too, not only yours |
| 503 with `busy` | Four attempts, all lost. Writes are piling up on one row. Count the `transaction retry` lines and reconsider which row they collide on |
| `40001` only right after a migration | The schema change beat connections that remembered the old schema (OC001). The rerun should pass |
| `use CREATE INDEX ASYNC instead` | The index statement lacks `ASYNC`. If the lint passes, check the runner's `dialect` |
| `transaction row limit exceeded` | One transaction went over 3,000 rows. Split it |
| Only the first call after a long gap is slow, or fails | The cluster is coming back from Idle or Inactive, or the connection of a frozen execution environment has dropped. Call again |

The last row is written from imagination. What error a dropped connection produces in an execution environment that was frozen has not been seen on the real thing.

## Before production

- **Turn on deletion protection, and keep the cluster when the stack is destroyed.** Right now it is the other way around
- **Set up a backup plan and rehearse a restore at least once.** Including the switch to the new cluster
- **Add authentication.** Every owner is `anonymous` for now, and anyone can delete ([chapter 06](/en/chapters/06-auth.md))
- **Fit the rate limit to your API.** 10 a second is a value for practice. When you raise it, redo the arithmetic in "If it gets hammered". Leaving bodies out of the list helps too
- **Watch the number of conflicts.** Put alarms on the `transaction retry` lines and on 503s (for counting log lines and alarming on them, see [chapter 19](/en/chapters/19-observability.md))
- **Run migrations through a fixed path, not from a laptop.** Narrow down who and what holds `dsql:DbConnectAdmin` (for building the CI path, see [chapter 20](/en/chapters/20-shipping.md))
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

**Not checked yet.** For the stage's throttling, a test pins it in the template, and the source of the pinned cdkd (0.296.28) passes `DefaultRouteSettings` on to API Gateway: that much was read, and no more. That it takes effect, the shape of the 429 body, and whether a 429 is charged for were not checked. The amounts in "If it gets hammered" are computed from unit prices, settings, and assumptions.

Nothing was ever connected to a real Aurora DSQL cluster. `sql:infra:deploy`, `sql:db:migrate`, `sql:db:grant`, `sql:db:seed`, `sql:smoke`, `sql:logs`, `sql:infra:drift`, `sql:infra:destroy`, and `dev:sql` with `NOTES_DB=dsql` have not been run. In particular, these are waiting: that DSQL accepts the four migrations. That the job ID can be read from the response to `CREATE INDEX ASYNC` and completion awaited through `sys.jobs`. That `AWS IAM GRANT` and the `GRANT`s let `notes_api` read and write. That the token passes through the `password` function. That a conflict shows up as `40001` in the `code` of node-postgres's error. That cdkd creates the cluster through Cloud Control API and `Ref` returns the identifier. Backup and restore. The DPUs in the cost section are assumptions, not measurements. RDS for PostgreSQL and Aurora Serverless v2 were only read about, in the documentation and the Price List, and never created.

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
