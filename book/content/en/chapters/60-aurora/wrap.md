---
title: "60 Aurora: Costs, Pitfalls, and Cleanup"
---

# 60 Aurora: Costs, Pitfalls, and Cleanup

The chapter ends with the price, how this looks from Cloudflare and Vercel, where people trip, what to change for production, and cleanup, in that order.

## Price

<!-- section: 60.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. Unit prices are from the AWS Price List published on 2026-10-06, and the arithmetic is in [Pricing](/en/reference/pricing.md). Whether any free tier or credit applies to Aurora was not checked, so none is subtracted.

An Aurora bill has a part for the instances and a part for the cluster. The instance part is ACU-hours, and is zero while an instance is paused. The cluster part is storage, I/O, and backups, and continues while the instance is paused, or with no instance at all.

For this chapter's default configuration (0 to 1 ACU, Aurora Standard), here are three estimates of a month.

| Case | Assumptions | List price / month |
| --- | --- | --- |
| Paused throughout | Never resumed. 1 GB of data, one secret | 0.52 |
| Used for practice | Awake for 10 hours in total, at 1 ACU throughout. 1 million I/O requests, 10,000 Data API calls | 2.26 |
| Never paused | 1 ACU for all 730 hours | **110.02** |

The first row is 0.12 for storage and 0.40 for the secret. Keeping the password costs more than keeping the database. The second row adds 1.50 for ACUs, 0.24 for I/O, and 0.0042 for the Data API. The counts of I/O requests and Data API calls are assumed, not measured.

The third row is the ceiling when you forget to stop it. With the maximum set to 1 ACU, the instance charge cannot exceed 109.50. Raise the maximum and the ceiling rises in proportion. Where between the first and third rows a real bill lands depends on how long the instance was paused, and the time Aurora resumed it for maintenance counts too.

No row includes the chapter 11 VPC or backups. Backup storage beyond the free allocation is 0.023 per GB-month. The size of that allocation was not checked.

### Against provisioned

One ACU of Serverless v2 is 0.15 an hour. A provisioned instance of the same Aurora PostgreSQL, db.t4g.medium for example, is 0.113 an hour, or 82.49 for 730 hours. With a steady load and no time paused, renting a fixed size is cheaper. Serverless v2 fits a load with tall peaks and deep valleys, or long stretches paused. Note that the Data API is not available on T instance classes.

### Standard and I/O-Optimized

There are two storage price configurations. Aurora Standard charges per I/O request. Aurora I/O-Optimized does not, and charges more per ACU and per GB instead.

| | Standard | I/O-Optimized |
| --- | --- | --- |
| ACU-hour | 0.15 | 0.20 |
| Storage (GB-month) | 0.12 | 0.27 |
| I/O (1 million requests) | 0.24 | 0 |

Which is cheaper depends on the number of I/O requests.

<<< @/examples/60-aurora/src/cost.ts{break-even}

For a cluster averaging 1 ACU over 730 hours with 100 GB of data, the two cost the same at about 214.58 million I/O requests a month. Below that Standard is cheaper, above it I/O-Optimized. At 300 million a month, for example, Standard is 193.50 and I/O-Optimized is 173.00.

AWS's rule of thumb is I/O-Optimized when I/O is 25% or more of the whole Aurora bill. At the point where the two are equal in the example above, I/O was about 30% of it. Use the rule as a way in, and before switching, recompute from the `Aurora:StorageIOUsage` line of your bill and your ACU and storage quantities. A switch from Standard to I/O-Optimized is allowed once every 30 days; switching back is possible at any time.

This chapter's cluster has next to no I/O, so it stays on Standard.

## Seen from Cloudflare and Vercel

<!-- section: 60.platforms -->

What follows is from each company's documentation as read on 2026-10-13.

D1 has no instances, no failover, and no capacity setting. What you handle is one name, the database. The differences from D1 are collected in [chapter 13](/en/chapters/13-sql/wrap.md), and what this chapter added, namely endpoints, capacity, and the way connections drop, are things that on D1 are not the user's job.

Cloudflare has Hyperdrive, which connects Workers to an existing Postgres. Databases hosted on AWS are included, and Cloudflare holds the connection pool and a query cache on its side. It is a way to use Aurora without leaving Workers. How to reach a cluster in private subnets with it was not checked for this chapter. The Data API is HTTPS, so Workers should be able to call it, but it needs AWS's request signing, and that was not tried either.

Vercel ended its own Vercel Postgres and moved to integrations from its Marketplace; existing databases were moved to Neon in December 2024. The Marketplace also has an AWS integration that lists Aurora PostgreSQL, Aurora DSQL, and DynamoDB. How that integration creates a cluster and how it bills was not read.

If one of these is enough, stay. The reasons to choose Aurora are needing PostgreSQL's features as they are, wanting the data inside your own VPC, and wanting what comes from separate storage, such as readers and clones. The price is keeping this chapter's invariant yourself. One thing remains on every platform, though: what to do about a write whose answer never came back. As long as a database sits behind HTTP, a client will meet the case where the request arrived and the answer did not. An idempotency key works there as it does with Aurora.

## Where people trip

These are causes read from the documentation and the code, not ones produced and confirmed on a real cluster.

| When this happens | Look here |
| --- | --- |
| ACU charges with nothing in use | A connection left open, an RDS Proxy, logical replication. Whether `ServerlessDatabaseCapacity` reaches 0 |
| Only the first call is slow, or `DatabaseResumingException` | A paused instance resuming: about 15 seconds, 30 or more after a long pause. Retry |
| `HttpEndpoint isn't enabled for cluster` | The cluster's `EnableHttpEndpoint`. Whether cdkd created the cluster through the Cloud Control API |
| `Transaction <ID> isn't found` | Three minutes passed since the previous call, or an error in an earlier call ended the transaction |
| A write fails with a read-only error | A connection still attached to a demoted instance. Throw it away and reconnect |
| The same append went in twice | `maxAttempts` on the SDK client. Whether the client makes a new key each time it resends |
| The deploy fails on the engine version | Find the versions you can create with `aws rds describe-db-engine-versions --engine aurora-postgresql`, and pass one with `-c engineVersion=` |

## For production

- Put one reader in another Availability Zone with promotion priority 0 or 1. The reader's minimum capacity is then kept in step with the writer's, and a failover takes seconds where it took minutes. Compute is billed for two instances
- Set the minimum capacity so that the data in frequent use fits in memory. Zero is only for systems where the first connection may wait 15 seconds
- Turn on deletion protection, decide the backup retention period, and take a final snapshot when the stack is deleted. Backups and restores are in chapter 59 and [chapter 22](/en/chapters/22-recovery.md)
- Create a database user for the application, and a secret for it. Allow the role that calls the Data API the five `rds-data` actions on this cluster's ARN only, and `secretsmanager:GetSecretValue` on that secret only
- Record a digest of the request's content with the key. When the same key arrives with different content, refuse it without returning the stored result. This chapter's code does not have that check
- Run the deletion of old keys on a schedule. Keep them longer than the period in which a client may resend
- Raise an alarm when `ServerlessDatabaseCapacity` sits at the maximum, or `ACUUtilization` stays high ([chapter 19](/en/chapters/19-observability.md))
- With many connections, consider RDS Proxy. With a proxy attached, though, auto-pause does not happen

## Cleanup

<!-- section: 60.cleanup -->

```bash
vp run aurora:infra:destroy
```

The instance, the cluster, the subnet group, and the security group are deleted. The secret Aurora managed is, according to the documentation, deleted with the cluster. No final snapshot is taken, so the data cannot be brought back.

Two things are worth checking afterwards: in the RDS console, that no manual snapshot and no retained automated backup remains; in Secrets Manager, that no secret created by Aurora remains. Either would go on being billed. What really remains after the stack is deleted was not checked for this chapter.

The chapter 11 VPC is separate from this stack. If no other chapter uses it, delete it with `vp run net:infra:destroy`. This chapter's stack imports the VPC's outputs, so the order is this chapter's stack first and the VPC after.

::: details Verification notes for this chapter

**Checked locally.** 54 unit tests (`vp test run examples/60-aurora`). The connection dropped before and after each of the append's five statements, ten points in all, with the append applied once and the same answer returned in every case. A retry without a key applying twice. The body not run for a recorded key, keys kept apart per owner, an answer that changed nothing being recorded, a request the database refuses being neither retried nor recorded, and the purge of old keys. SQLSTATE classification. The Data API adapter's conversions and its sorting of exceptions, `maxAttempts` being 1 on the SDK client, and the append applied once when the answer to `CommitTransaction` is lost against a stand-in service built on PGlite. The break-even arithmetic for Standard and I/O-Optimized. Stack assertions. The type check (`tsc --noEmit`). `vp run aurora:infra:synth`. The local PostgreSQL is PGlite (PostgreSQL 18.3, according to chapter 13), a different version from Aurora PostgreSQL 17.

**Not checked yet.** The stack was never deployed. `aurora:infra:deploy`, `aurora:db:schema`, `aurora:smoke`, `aurora:infra:drift`, and `aurora:infra:destroy` were not run. In particular these wait for confirmation: that a new cluster can be created in Tokyo with engine version 17.9; that cdkd creates the cluster through the Cloud Control API, that `EnableHttpEndpoint` and `SecondsUntilAutoPause` take effect, and that the `MasterUserSecret.SecretArn` output resolves; that the Data API reaches a cluster whose security group has no inbound rule; that the secret Aurora manages can be given to the Data API; that SQL with `$1` rewritten to `:p1`, and the `CAST`s, are accepted by the Data API; that rows of `UPDATE ... RETURNING` come back in `records` with column labels; whether a call to a paused instance fails with `DatabaseResumingException` or waits and succeeds; that the instance pauses after 300 seconds, and how long a resume takes. No failover was ever caused. The errors node-postgres and the Data API really report during one, the SQLSTATE a demoted instance sends, and the time until an endpoint's name moves are all unconfirmed. `src/pg.ts` was type-checked only and never run. Two requests with the same key running at once on separate connections were covered by a scripted test only, not run on a real PostgreSQL. The steps to resume are in the [validation record](/en/reference/validation.md).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Failover, and what the application must do | `src/failure.ts`, `test/failure.test.ts` | `test:unit` |
| The invariant, and applying exactly once | `src/once.ts`, `src/append.ts`, `migrations/0005_create_requests.sql`, `src/migrations.ts` | `test:unit` |
| Tests that drop the connection | `test/support.ts`, `test/once.test.ts` | `test:unit` |
| Serverless v2 capacity | `src/config.ts`, `src/pg.ts` | `test:unit` |
| The Data API | `src/data-api.ts`, `test/data-api.test.ts` | `test:unit` |
| The stack | `infra/lib/aurora-stack.ts`, `infra/bin/app.ts`, `infra/test/aurora-stack.test.ts` | `aurora:infra:synth` |
| Deploying and checking | `scripts/cloud.ts` | `aurora:infra:diff`, `aurora:infra:deploy`, `aurora:db:schema`, `aurora:smoke`, `aurora:infra:drift` |
| Price | `src/cost.ts`, `test/cost.test.ts` | `test:unit` |
| Cleanup | `infra/lib/aurora-stack.ts` | `aurora:infra:destroy` |

**Resource types and cdkd.** The contents of the pinned version's (0.296.28) npm package were read (`dist/rds-provider-*.js` and `dist/deploy-engine-*.js`). `AWS::RDS::DBSubnetGroup`, `AWS::RDS::DBCluster`, `AWS::RDS::DBInstance`, and `AWS::EC2::SecurityGroup` have implementations of their own. The list of properties the `DBCluster` implementation handles has neither `EnableHttpEndpoint` nor `StorageType`, though, and of `ServerlessV2ScalingConfiguration` it sends only `MinCapacity` and `MaxCapacity`. The package also contains the branch that switches a resource with a property its own implementation does not handle over to the Cloud Control API. What was read is the bundled JavaScript, not `register-providers.ts` on GitHub.

**Primary sources** (all checked on 2026-10-13)

- How it works: [Amazon Aurora storage](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html), [Endpoint connections](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html), [Cluster endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Cluster.html), [Reader endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Reader.html), [Custom endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Custom.html), [High availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html), [Fast failover with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.BestPractices.FastFailover.html), [Replication with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Replication.html), [Quotas and constraints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_Limits.html)
- Serverless v2: [How Aurora serverless works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html), [Scaling to Zero ACUs](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html), [Performance and scaling](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html), [Supported Regions and engines](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html), [Storage configurations: Regions and engines](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.storage-type.html)
- The Data API: [Using the RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html), [Limitations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html), [Supported Regions and engines](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.Data_API.html), [Operations reference](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-operations.html), [Timeout behavior](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-timeouts.html), [Session management](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.session-management.html), [Authorizing access](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.access.html), [Troubleshooting](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.troubleshooting.html), [Results in JSON format](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-json.html), the type definitions of [@aws-sdk/client-rds-data 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-rds-data/v/3.1149.0)
- Other features: [Cloning](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Clone.html), [Backtrack](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Managing.Backtrack.html), [Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html), [Zero-ETL integrations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/zero-etl.html), [Password management with Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html)
- PostgreSQL compatibility and versions: [Working with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.AuroraPostgreSQL.html), [Extension versions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html), [Aurora PostgreSQL updates](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Updates.html), [PostgreSQL 17: Error Codes](https://www.postgresql.org/docs/17/errcodes-appendix.html), the source of [pg 8.23.1](https://www.npmjs.com/package/pg/v/8.23.1)
- Aurora DSQL: [What is Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html), [Migrating from PostgreSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html), [Quotas and limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html), [Concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html)
- Prices and infrastructure: the AWS Price List bulk API for [Amazon RDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json) and [Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json), the type definitions of [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0), the package contents of [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare and Vercel: [Hyperdrive](https://developers.cloudflare.com/hyperdrive/), [Postgres on Vercel](https://vercel.com/docs/postgres), [Vercel Marketplace: AWS](https://vercel.com/marketplace/aws)

:::
