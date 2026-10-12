---
title: "59 RDS: Costs, Pitfalls, and Cleanup"
---

# 59 RDS: Costs, Pitfalls, and Cleanup

This last page of the chapter goes through the costs, where to look when something fails, what to change for production, and the cleanup.

## Costs

<!-- section: 59.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The unit prices were taken from the AWS Price List on 2026-10-13, and a month is 730 hours. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

The heart of an RDS bill is the time the instance runs and the storage allocated to it. Both are charged without a single query arriving.

The default stack left in place for a month comes to this.

| Item | Quantity | List price |
| --- | --- | --- |
| db.t4g.micro, Single-AZ | 730 hours | 18.25 |
| gp3 storage | 20 GB-months | 2.76 |
| The master user's secret | 1 | 0.40 |
| CloudWatch alarm | 1 | 0.10 |
| Subtotal | | **21.51** |

The alarm falls within the monthly allowance of 10 alarms, so after that the subtotal is 21.41. The secret's line contains an assumption. Whether a secret that RDS manages is charged like an ordinary one could not be confirmed. It is counted as if it were. Lambda, API Gateway, and log ingestion are 0 when there are no requests.

No RDS free tier is subtracted, because two AWS pages describe it differently. The RDS for PostgreSQL pricing page says new customers get 750 instance hours and 20 GB of storage a month for one year. The RDS free tier page speaks of credits, not hours. Which applies seems to depend on the account, so this chapter treats it as unknown. Unknown does not mean zero.

Here is the monthly list price of other configurations.

| Configuration | List price / month |
| --- | --- |
| Default (Single-AZ) | 21.51 |
| The `production` profile (Multi-AZ, same instance class) | 42.52 |
| With one read replica | 42.52 |
| With RDS Proxy (the proxy alone) | + 26.28 |
| Once in Extended Support (years 1 and 2, the surcharge alone) | + 175.20 |

Multi-AZ and the replica cost the same because each amounts to two instances and two volumes. What the same money buys differs: Multi-AZ switches over on a failure, and a replica takes reads.

Some things are not in this table. db.t4g runs in Unlimited mode, so sustained CPU use is billed separately as surplus credits. Backups beyond the size of the storage cost 0.095 per GB-month. Traffic between Availability Zones, log storage, and the VPC of chapter 11 (0 in its default configuration) are separate too.

### Stopped is not quite stopped

You can stop the instance for the time you do not use it.

```bash
aws rds stop-db-instance --db-instance-identifier aih-notes
```

While it is stopped, no instance hours are charged. Storage and backups still are. Stopped for a whole month, it would be 3.26 at list price.

But it never comes to that amount. RDS starts a stopped instance by itself after seven days, so that, as the documentation puts it, the instance does not fall behind required maintenance updates. From then on it is billed until you notice. Stopping is for when you will use the instance again within days. When you are done with it, delete it.

There are further conditions. An instance that has a read replica, and the replica itself, cannot be stopped. A stopped instance cannot be modified. And according to the documentation, starting can take from minutes to hours.

### If someone hammers it

This API has no authentication either. The throttling at the entrance (10 requests a second) and chapter 13's row limit (100 rows per owner) bound what can be called.

Unlike DSQL, RDS does not cost more when hammered. The instance and the storage are fixed. What grows is Lambda, API Gateway, and logs (computed as in [the same section of chapter 13](/en/chapters/13-sql/wrap.md)), and the surplus CPU credits of a db.t4g. In exchange, the database has no room to grow. Beyond what one instance can take, it slows down, refuses connections, and the API stops. The difference is whether the money runs out first or the performance does.

## Where to look when something fails

| When this happens | Look here |
| --- | --- |
| The deploy fails on the PostgreSQL version | That version is no longer offered to new instances. Check with `aws rds describe-db-engine-versions --engine postgres` and pass `-c postgresVersion=<version>` |
| The deploy fails on `Fn::ImportValue` | Chapter 11's stack (`AihNetwork`) is not deployed |
| `rds:db:bootstrap` gets access denied | Your credentials lack `secretsmanager:GetSecretValue` on the master user's secret, or `lambda:InvokeFunction` on the operations function |
| The operations function times out | The function does not reach the database. Check the security groups, and that both are in the same VPC |
| `password authentication failed` | The token was not accepted. Check that `rds:db:bootstrap` was run, and that `rds-db:connect` on the function's role names the resource ID of the current instance. Recreating the instance changes the ID |
| `self-signed certificate in certificate chain` | Node.js does not know the RDS certificate authority. Check the function's `NODE_EXTRA_CA_CERTS` |
| `no pg_hba.conf entry ... no encryption` | Something is connecting without TLS, and `rds.force_ssl` refuses it |
| `/health` answers 200 but `/notes` answers 500 | Check that `rds:db:migrate` was run. The log should show `relation "app.notes" does not exist` or `permission denied` |
| `too many connections` | The execution environments running at once reached the connection limit. Limit the function's concurrency, or consider RDS Proxy |
| A note just created answers 404 | The read went to the read replica. Check that the client sends `x-notes-seen` back |
| `cannot execute INSERT in a read-only transaction` | A write went to the replica. Check that `DB_HOST` and `DB_REPLICA_HOST` are not swapped |
| Only the first call after a long pause fails | Maintenance or a failover dropped the connection. The next call should open a new one |
| An instance you stopped is running | Seven days passed and it started by itself |
| A parameter was changed and has no effect | It is a static parameter. It stays `pending-reboot` until a reboot |

The error messages are written from the wording PostgreSQL and node-postgres use. That this chapter's code shows exactly these on RDS was not confirmed.

## For production

- Deploy with `-c profile=production`. That adds a standby, deletion protection, 14 days of backups, and storage autoscaling, and the instance remains when the stack is destroyed
- Choose the instance class again. The AWS documentation recommends the db.t classes for non-production use. Another can be named, as in `-c instanceClass=m8g.large`
- Walk through a restore once, all the way to the new instance with its different endpoint (chapter 22)
- Cause a failover once and measure for how many seconds the API is down. That number is what you can promise your users
- Put the end of standard support of your major version into your plans, and decide in advance between Extended Support and upgrading first
- Run migrations from a pipeline, not from a laptop. Narrow down who may invoke the operations function and who may read the master user's secret ([chapter 20](/en/chapters/20-shipping.md), chapter 21)
- Give the alarm a target, and add alarms on `DatabaseConnections`, CPU credits, and `ReplicaLag` (chapter 19)
- Add authentication. Every owner is still `anonymous` ([chapter 06](/en/chapters/06-auth.md))
- Estimate the number of connections. Keep the function's concurrency limit below `max_connections`, or put RDS Proxy in front
- Move to AWS CDK CLI and CloudFormation for deployment. Chapter 02 gives the reasons

## Cleanup

<!-- section: 59.cleanup -->

```bash
vp run rds:infra:destroy
```

In the default configuration this removes the instance, its automated backups, the master user's secret, the parameter group, the subnet group, the security groups, the functions, the API, the alarm, and the log groups. No final snapshot is taken. The notes cannot be brought back.

The following can remain.

- Snapshots you took by hand. They stay until you delete them, and backup storage is charged for them
- An instance deployed with the `production` profile, and its automated backups. They leave the stack, but the real things remain and keep being billed. To delete them, turn off deletion protection, then delete in the console or with the CLI
- Instances outside the stack that a point-in-time restore or a blue/green deployment created
- Chapter 11's VPC. It is another stack, and this chapter's cleanup does not remove it

When a function leaves a VPC, cleaning up the network interfaces Lambda created can take time. How a destroy looks in that case was not checked.

After the cleanup, look at three lists in the RDS console (instances, snapshots, automated backups) and see that they are empty.

::: details Verification notes for this chapter

**Checked locally.** 48 tests. Parsing and comparing LSNs. That the real position PGlite reports moves forward on a write and not on a read. On the model of a primary and a replica: that a read from a lagging replica misses your own write, that carrying the position finds it, that reads do not go back, that an unknown position falls to the primary, that the replica refuses writes with 25006, and that promoting a lagging replica loses a write. The API's headers and CORS. That the operations function creates the two roles, applies chapter 13's migrations as `notes_migrator`, and leaves `notes_api` able to read and write rows only (checked on PGlite with `SET ROLE`). That a second run changes nothing. The checks on configuration and environment. The stack assertions (three variants: default, `production`, and with a read replica). The type check. The synth, and loading the two resulting bundles under Node.js 24: the API function answers `GET /health`, and the operations function refuses a command it does not know. Starting `dev:rds` and following the page's `curl` steps (a create, a 404 without the header, a 200 with it, a 200 after waiting).

**Not checked yet.** Nothing was ever connected to a real RDS instance. `rds:infra:deploy`, `rds:db:bootstrap`, `rds:db:migrate`, `rds:db:status`, `rds:smoke`, `rds:infra:drift`, and `rds:infra:destroy` have not been run. In particular these await confirmation: that cdkd can create an instance with `ManageMasterUserPassword` and a parameter group through Cloud Control API; that PostgreSQL 18.3 can still be chosen; that RDS writes into the log group created beforehand; that `NODE_EXTRA_CA_CERTS` lets the Node.js 24 runtime verify the RDS certificate; that an IAM token passes through node-postgres; the shape of the secret that RDS manages; that IAM database authentication runs reliably in the memory of a db.t4g.micro; that the stack with a read replica deploys, and that the replica's `pg_last_wal_replay_lsn()` can be compared with the primary's position. A failover, a point-in-time restore, a version upgrade, a blue/green deployment, RDS Proxy, storage autoscaling, and a stop with its automatic start were all not run. The seconds and percentages in the text are the documentation's statements. Prices were only computed from unit prices and assumptions; the charge for a secret that RDS manages and the application of the free tier could not be confirmed. Whether Cloudflare runs a PostgreSQL service of its own was not checked either.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture; Instance class and storage; When not to choose RDS | `examples/59-rds/infra/lib/rds-stack.ts`, `src/config.ts` | `rds:infra:synth` |
| Defining the instance | `examples/59-rds/infra/lib/rds-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `infra/test/rds-stack.test.ts`, `test/config.test.ts` | `rds:infra:synth`, `test:unit` |
| Who signs in, and how | `examples/59-rds/src/roles.ts`, `src/ops.ts`, `src/ops-lambda.ts`, `src/rds.ts`, `src/env.ts`, `test/ops.test.ts` | `test:unit` |
| The number of connections from Lambda | `examples/59-rds/src/rds.ts`, `src/lambda.ts` | `rds:infra:synth` |
| Keeping a standby | `examples/59-rds/src/config.ts`, `infra/test/rds-stack.test.ts` | `test:unit` |
| A read replica is behind | `examples/59-rds/src/model/replication.ts`, `test/routing.test.ts`, `test/support.ts` | `test:unit` |
| Reading your own writes | `examples/59-rds/src/lsn.ts`, `src/position.ts`, `src/routing.ts`, `src/app.ts`, `test/lsn.test.ts`, `test/routing.test.ts`, `test/app.test.ts` | `test:unit` |
| Watching a lagging replica locally | `examples/59-rds/src/dev.ts`, `src/migrations.ts`, `.env.example` | `dev:rds` |
| Deploying, and making it usable | `examples/59-rds/scripts/ops.ts`, `scripts/smoke.ts` | `rds:infra:diff`, `rds:infra:deploy`, `rds:db:bootstrap`, `rds:db:migrate`, `rds:db:status`, `rds:smoke`, `rds:infra:drift` |
| Backups and restores; Moving to a newer version; Keeping watch | `examples/59-rds/infra/lib/rds-stack.ts`, `src/config.ts` | `rds:infra:synth` |
| Costs | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |
| Cleanup | `tools/src/infra/` | `rds:infra:destroy` |

**Resource types and cdkd.** In the installed cdkd 0.296.28 package, dedicated implementations are registered for `AWS::ApiGatewayV2::Api`, `Integration`, `Route`, `Stage`, `AWS::CloudWatch::Alarm`, `AWS::EC2::SecurityGroup`, `AWS::EC2::SecurityGroupIngress`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`, `AWS::RDS::DBInstance`, and `AWS::RDS::DBSubnetGroup`. No registration was found for `AWS::RDS::DBParameterGroup` or `AWS::EC2::SecurityGroupEgress`. Those two should go through Cloud Control API, and both are in its list of supported types. Whether they can really be created was not confirmed.

**Primary sources** (all checked on 2026-10-13)

- Multi-AZ and failover: [Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html), [Failing over a Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html), [Multi-AZ DB cluster deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html), [Failing over a Multi-AZ DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts-failover.html), [Limitations of Multi-AZ DB clusters](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.Limitations.html), [Best practices for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)
- Read replicas: [Working with DB instance read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html), [Creating a read replica](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Create.html), [Read replicas for RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.html), [Read replica configuration with PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.Configuration.html), [Monitoring and tuning the replication process](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.Monitor.html), [CloudWatch metrics for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html)
- Instance and storage: [DB instance class types](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Types.html), [DB instance storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html), [Storage autoscaling](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.Autoscaling.html), [Quotas and constraints for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html), [Overview of parameter groups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/parameter-groups-overview.html), [Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html), [Encrypting Amazon RDS resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html), [Stopping a DB instance temporarily](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html), [Deleting a DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html)
- Authentication and TLS: [Password management with Amazon RDS and AWS Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html), [IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html), [IAM policy for IAM database access](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html), [Creating a database account using IAM authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html), [Using SSL/TLS to encrypt a connection](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html), [Using SSL with a PostgreSQL DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)
- Lambda and RDS Proxy: [Building Lambda functions with Node.js](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html), [Using AWS Lambda with Amazon RDS](https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html), [Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html), [Amazon RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html), [Planning where to use RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-planning.html), [Avoiding pinning an RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html), [RDS Proxy endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-endpoints.html)
- Backups: [Introduction to backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html), [Backup retention period](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html), [Managing automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ManagingAutomatedBackups.html), [Restoring a DB instance to a specified time](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- Versions and maintenance: [Maintaining a DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html), [Upgrading a DB instance engine version](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Upgrading.html), [Upgrades of the RDS for PostgreSQL DB engine](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.html), [Major version upgrade process](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.MajorVersion.Process.html), [Minor version upgrades](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.Minor.html), [Release calendars for RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html), [RDS Extended Support](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support.html), [Creating a DB instance with RDS Extended Support](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support-creating-db-instance.html), [RDS Extended Support charges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support-charges.html), [Overview of Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html), [Limitations and considerations](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-considerations.html), [PostgreSQL replication methods](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-replication-type.html)
- Monitoring and logs: [CloudWatch Database Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Database-Insights.html), [Database Insights on Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DatabaseInsights.html), [RDS for PostgreSQL database log files](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.html), [Parameters for logging](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.overview.parameter-groups.html), [Turning on query logging](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.Query_Logging.html)
- Pricing: the AWS Price List bulk API for [Amazon RDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json) (published 2026-10-06), [RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/), [RDS Proxy pricing](https://aws.amazon.com/rds/proxy/pricing/), [RDS Free Tier](https://aws.amazon.com/rds/free/)
- Infrastructure: [AWS::RDS::DBInstance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html), [Cloud Control API supported resource types](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (type definitions), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the package), [@aws-sdk/rds-signer 3.1149.0](https://www.npmjs.com/package/@aws-sdk/rds-signer/v/3.1149.0) (type definitions)
- PostgreSQL: [System Administration Functions](https://www.postgresql.org/docs/18/functions-admin.html), [Hot Standby](https://www.postgresql.org/docs/18/hot-standby.html), [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html)
- Cloudflare and Vercel: [Hyperdrive](https://developers.cloudflare.com/hyperdrive/), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), [Hyperdrive to a private database](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/), [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [Vercel Postgres](https://vercel.com/docs/postgres), [Vercel Storage](https://vercel.com/docs/storage)

:::
