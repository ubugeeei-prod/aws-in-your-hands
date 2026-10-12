---
title: "39 Database Migration: Costs, Pitfalls, and Cleanup"
---

# 39 Database Migration: Costs, Pitfalls, and Cleanup

The chapter ends with the costs, the places where things go wrong, what to change for production, and the cleanup. The cleanup includes, besides AWS resources, what is left inside the source database.

## Costs

<!-- section: 39.cost -->

Amounts are in USD, Tokyo Region, on-demand, before tax, with unit prices taken from the AWS Price List on 2026-10-13. The arithmetic is in [Pricing calculations](/en/reference/pricing.md). The cost of the two databases is in none of these numbers.

With the stack in place and the replication never started, the cost is USD 0.80 a month. That is the two secrets (USD 0.40 each), and nothing else is billed by the hour.

Once started, the replication costs USD 0.1144126570 an hour at 1 DCU (Single-AZ). Run for a week (168 hours) and then cut over, it comes to USD 19.22 for DCUs, USD 4.70 for the Secrets Manager interface endpoint (in two subnets for 168 hours), and USD 0.80 for the secrets: USD 24.73 in total. The figure assumes it never scales up, and at the maximum of 2 DCU throughout, the DCU part doubles.

Forget to stop the replication after the cutover and the same layout costs USD 104.76 in a month (USD 83.52 for DCUs, USD 20.44 for the endpoint, USD 0.80 for the secrets).

For comparison, here is a layout this chapter does not create. The smallest replication instance (dms.t3.micro, Single-AZ) is USD 0.028 an hour, which is USD 20.44 a month even with no task running. Per hour of running it is cheaper than 1 DCU of Serverless, so for a replication that size can carry and that runs for months, an instance costs less.

No free allowance is applied. According to the pricing page, an account that joined the Free Tier before July 15, 2025 has 750 hours a month of dms.t3.micro for one year, and a later account gets credits instead. Which one the reader's account is cannot be known here, so nothing is deducted. No free allowance for Serverless DCUs was found on the pricing page.

The pricing page says data transfer into DMS is free, and so is transfer between DMS and an RDS database in the same Availability Zone. Ordinary transfer rates apply across zones or Regions. They are not in this chapter's numbers, and neither are logs.

Whether DCUs are billed between stopping a replication and the release of its capacity could not be confirmed. The description of the stop API says that stopping does not deprovision, and the user guide says that the capacity of a replication not started for 48 hours is released. To be sure the billing has ended, delete the configuration.

## Pitfalls

<!-- section: 39.pitfalls -->

The task is running and one table has stopped. The default for a table-level error is to stop that table and continue the task. Watching only the state of the replication does not show it. Look at the per-table statistics.

A `text` primary key. This is what this chapter's check treats as a reason to stop. It is read from the type table and the troubleshooting page, and whether it really fails was not confirmed. Look at the result of the premigration assessment.

A body is truncated. A `text` longer than the limit of limited LOB mode is truncated. This chapter's settings fail the task where it would truncate. When that happens, raise the limit and restart from the beginning. Whether the limit's unit matches bytes in the source's encoding was not checked, so there is a margin.

The first `INSERT` on the target hits a unique constraint. The sequences were not advanced. It happens with counts and contents all matching, which is why it is an item in the cutover decision.

A restart produces primary key violations. With `DO_NOTHING`, the rows of the previous run are still there. Empty the target tables before restarting from the beginning.

Validation never finishes. Rows that keep being written cannot be validated, and validation stops after more than 10,000 failures. A table without a primary key stays at `No primary key`.

The source's disk keeps shrinking. A slot without a reader is accumulating WAL. Look at `pg_replication_slots`.

The endpoint's connection test fails. Check, in this order, whether the database's security group allows port 5432 from the replication's group, whether the VPC has the Secrets Manager endpoint, and whether the secret's `host` is right. That order comes from thinking about the layout, not from having seen real failures.

The source's schema was changed during the migration. With this chapter's settings, DDL is not carried. Even with DDL capture on, the documentation says changes to column defaults and `NOT NULL` are not covered. Not changing the schema during the migration is the safe course.

## For production

<!-- section: 39.production -->

Rehearse first. Use a copy made from a production snapshot as the source, and measure how long the full load takes, how CDC lags, and how long validation needs. This chapter has not one measured time in it. An estimate of the outage is built from the rehearsal's numbers.

Run the premigration assessment and keep its result.

For CDC that runs for days, consider Multi-AZ. The source's slot keeps accumulating WAL while the replication is down, so the availability of the replication matters to the source's disk.

Put disk and slot alarms on the source. They are made the same way as the alarms in [chapter 19](/en/chapters/19-observability.md).

Write the cutover runbook, and decide the items of the decision and who makes it. Write the deadline for going back and the period for keeping the source as numbers too.

The DMS users have strong permissions. Drop them once the cutover is done, and delete the secrets with the stack. Password rotation is not set up, for a migration that ends in days.

The documentation recommends adding an `aws:SourceAccount` condition to the trust policy of `dms-vpc-role`. This chapter's stack does not add it.

## Cleanup

<!-- section: 39.cleanup -->

There is an order.

Stop the replication. The configuration of a running replication cannot be deleted.

```bash
aws dms stop-replication --replication-config-arn <ReplicationConfigArn>
```

Delete the stack. If cdkd was able to deploy it, use the task below. If you deployed with the CDK CLI, delete with the CDK CLI.

```bash
vp run dbmig:infra:destroy
```

The configuration, the endpoints, the subnet group, the secrets, the security group rules, and the topic are deleted. So are `dms-vpc-role` and `dms-cloudwatch-logs-role`, if this stack created them. If other DMS resources in the same account use them, take them out of the stack first with `-c accountRoles=existing`.

Four things stay after the stack is gone.

The replication slot on the source. The documentation says a slot DMS created is dropped when the task is deleted, but whether the same happens when a Serverless configuration is deleted was not checked. Run `SELECT slot_name, active FROM pg_replication_slots` on the source and, if one is left, drop it with `pg_drop_replication_slot`. Left in place, it fills the source's disk.

The DMS roles on the source and the target (`dms_source`, `dms_target`) and the `dms_heartbeat` schema on the source. They are inside the databases, so you remove them yourself. The target may also still have the `awsdms_control` schema, which DMS creates to record validation failures.

The DMS log group (its name begins with `dms-serverless-replication-`). DMS created it when the replication ran, and it is outside the stack.

The service-linked role `AWSServiceRoleForDMSServerless`. It can be deleted after every Serverless replication is gone.

Remove the Secrets Manager interface endpoint added to the chapter 11 stack as well, if nothing else uses it. It is billed by the hour for as long as it exists.

And then there is the source database itself. When the period you decided to keep it has passed, take a final snapshot and delete it. The most expensive thing in this chapter is an old database left in place.

::: details Verification notes for this chapter

**Checked locally.** On this chapter's model (two PGlite instances, changes recorded by triggers, a table-by-table copy and an apply step), the tests cover the following. A row changed and a row deleted during the copy match once the changes are applied. A change present in both the copy and the log is absorbed. A resume from a checkpoint that did not advance ends in the same result. On a table without a primary key the same resume adds rows, and `UPDATE` and `DELETE` are not carried. A child table can be copied first while the foreign keys are quiet. The collision before the sequences are advanced, the numbering after, and that the number of a deleted row is not handed out again. What the count-and-digest comparison finds (a truncated body) and does not find (indexes and constraints, writes in flight). After the switch, a late write to the source and an overwrite by a resumed replication. Beyond these: the table-mapping schema and its application to the source and target schemas, the preflight check, the cutover decisions, the LOB limit in the task settings, and the stack assertions (resource types, least privilege, the secrets, the security groups, the roles with fixed names, the failure notification). `vp run dbmig:demo` and `vp run dbmig:infra:synth` were run, and the type check passes.

**Not checked yet.** Nothing was run against AWS. DMS was never run. So the following are unconfirmed. How far cdkd 0.296.28 gets in deploying this stack. Whether a `text` primary key really fails in a PostgreSQL to PostgreSQL migration. Whether a 10,000-character body escapes truncation at a LOB limit of 64 KB. Whether the target user can run the `SET` in `AfterConnectScript`. Whether the schema named in `HeartbeatSchema` has to be created beforehand. Whether a Serverless replication works behind a security group that limits outbound traffic to three kinds. The billing of a configuration that was not started and of a replication after it was stopped. Whether deleting the configuration drops the slot on the source. The retention of the DMS log group. Every duration: the full load, the lag, the outage. `dbmig:preflight`, `dbmig:verify`, and `dbmig:sequences` were not run against a real PostgreSQL (the same functions ran on PGlite). Whether Neon can be a source and whether a D1 export loads into PostgreSQL were not tried either.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Preparing the source | `examples/39-database-migration/sql/source/`, `sql/users/`, `src/catalog.ts`, `src/preflight.ts`, `test/preflight.test.ts` | `test:unit`, `dbmig:preflight` |
| Table mappings | `examples/39-database-migration/src/table-mappings.ts`, `test/table-mappings.test.ts` | `test:unit` |
| Task settings | `examples/39-database-migration/src/task-settings.ts`, `test/cutover.test.ts` | `test:unit` |
| The stack | `examples/39-database-migration/infra/lib/migration-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `infra/test/migration-stack.test.ts` | `dbmig:infra:synth`, `test:unit` |
| The cutover | `examples/39-database-migration/src/cutover.ts`, `src/sequences.ts`, `src/verify.ts`, `test/cutover.test.ts`, `test/sequences.test.ts`, `test/verify.test.ts` | `test:unit`, `dbmig:verify`, `dbmig:sequences` |
| As a distributed system | `examples/39-database-migration/src/cutover.ts`, `test/replicate.test.ts` | `test:unit` |
| This chapter's model | `examples/39-database-migration/src/model/capture.ts`, `src/model/replicate.ts`, `test/replicate.test.ts`, `test/support.ts`, `scripts/demo.ts` | `test:unit`, `dbmig:demo` |
| Deploy | `examples/39-database-migration/infra/lib/migration-stack.ts`, `scripts/db.ts` | `dbmig:infra:diff`, `dbmig:infra:deploy`, `dbmig:preflight`, `dbmig:verify`, `dbmig:sequences` |
| Cleanup | `examples/39-database-migration/infra/lib/migration-stack.ts` | `dbmig:infra:destroy` |
| Costs | `data/pricing/` | `test:unit` |

**Primary sources** (all checked 2026-10-13)

- AWS DMS user guide: [What is AWS DMS?](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html), [High-level view](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.HighLevelView.html), [Components](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Components.html), [Sources](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Sources.html), [Targets](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Targets.html), [PostgreSQL as a source](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.PostgreSQL.html), [PostgreSQL as a target](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Target.PostgreSQL.html)
- DMS Serverless: [Working with AWS DMS Serverless](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.html), [Components](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Components.html), [Limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Limitations.html), [Service-linked role](https://docs.aws.amazon.com/dms/latest/userguide/slr-services-sl.html)
- Table mappings: [Selection rules](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Selections.html), [Transformation rules](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Transformations.html), [Wildcards](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Wildcards.html)
- Task settings: [Task settings](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.html), [Full-load](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.FullLoad.html), [Error handling](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.ErrorHandling.html), [Data validation settings](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.DataValidation.html), [LOB support](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.LOBSupport.html), [Data validation](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Validating.html), [Premigration assessments](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.AssessmentReport.html), [Troubleshooting](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Troubleshooting.html), [Homogeneous data migrations](https://docs.aws.amazon.com/dms/latest/userguide/data-migrations.html)
- Permissions and notifications: [Using secrets](https://docs.aws.amazon.com/dms/latest/userguide/security_iam_secretsmanager.html), [Secrets Manager VPC endpoint](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Advanced.Endpoints.secretsmanager.html), [IAM](https://docs.aws.amazon.com/dms/latest/userguide/security-iam.html), [EventBridge events](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_EventBridge.html), [Quotas](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Limits.html) (default quotas: 100 Serverless replications, 1,000 endpoints, 60 subnet groups)
- API and CloudFormation: [StartReplication](https://docs.aws.amazon.com/dms/latest/APIReference/API_StartReplication.html), [StartReplicationTask](https://docs.aws.amazon.com/dms/latest/APIReference/API_StartReplicationTask.html), [CreateEndpoint](https://docs.aws.amazon.com/dms/latest/APIReference/API_CreateEndpoint.html), [AWS::DMS::ReplicationConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dms-replicationconfig.html), [AWS::DMS::Endpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dms-endpoint.html), [AWS::DMS::ReplicationSubnetGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dms-replicationsubnetgroup.html), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- Pricing: [AWS DMS pricing](https://aws.amazon.com/dms/pricing/), and [AWSDatabaseMigrationSvc](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDatabaseMigrationSvc/current/ap-northeast-1/index.json) from the AWS Price List bulk API (published 2026-09-11)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the dist of the installed package). The DMS service definition bundled with AWS CLI 2.35.11 (command arguments)
- PostgreSQL 18: [Logical replication restrictions](https://www.postgresql.org/docs/current/logical-replication-restrictions.html), [Publication](https://www.postgresql.org/docs/current/logical-replication-publication.html), [Replication slots](https://www.postgresql.org/docs/current/warm-standby.html), [Replication settings](https://www.postgresql.org/docs/current/runtime-config-replication.html), [pg_replication_slots](https://www.postgresql.org/docs/current/view-pg-replication-slots.html), [System administration functions](https://www.postgresql.org/docs/current/functions-admin.html), [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [Sequence functions](https://www.postgresql.org/docs/current/functions-sequence.html), [REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html), [pg_stat_activity](https://www.postgresql.org/docs/current/monitoring-stats.html)
- RDS and Aurora: [Logical replication for RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html), [CloudWatch metrics for RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html), [RDS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html), [their limitations](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-considerations.html), [Migrating data to Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Migrating.html), [Loading data into Aurora DSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/loading-data.html)
- Cloudflare, Vercel, and Neon: [D1: Import and export data](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1: Query a database](https://developers.cloudflare.com/d1/best-practices/query-d1/), [Postgres on Vercel](https://vercel.com/docs/postgres), [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage), [Neon: Logical replication](https://neon.com/docs/guides/logical-replication-neon), [Neon: pg_dump](https://neon.com/docs/import/migrate-from-postgres), [Neon: AWS DMS](https://neon.com/docs/import/migrate-aws-dms)

:::
