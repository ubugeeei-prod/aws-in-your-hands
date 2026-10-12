---
title: "39 Database Migration: Deploy"
---

# 39 Database Migration: Deploy

So far the procedure was checked on local PGlite and this chapter's model. This page prepares the same procedure for AWS. To say it first: not one step on this page was run. The commands had their arguments checked against the service definition bundled with the pinned AWS CLI 2.35.11 and against the API reference.

## How far cdkd can deploy

<!-- section: 39.deploy -->

The stack synthesizes.

```bash
vp run dbmig:infra:synth
```

It writes a CloudFormation template to `examples/39-database-migration/cdk.out/` and asks AWS nothing.

`vp run dbmig:infra:deploy`, the next step, should not get to the end with the pinned cdkd 0.296.28. For a resource type it has no dedicated implementation for, cdkd creates the resource through the Cloud Control API. Reading the installed package, there is no dedicated implementation for any type that begins with `AWS::DMS::`. In the list of types the Cloud Control API supports (which says it was last updated 2025-12-23), the only DMS type this chapter uses is `AWS::DMS::ReplicationConfig`. `AWS::DMS::Endpoint` and `AWS::DMS::ReplicationSubnetGroup` are not in it.

| Type | Route in cdkd 0.296.28 |
| --- | --- |
| `AWS::DMS::ReplicationConfig` | No dedicated implementation. Through the Cloud Control API (listed) |
| `AWS::DMS::Endpoint` | No dedicated implementation. Not in the Cloud Control API list |
| `AWS::DMS::ReplicationSubnetGroup` | No dedicated implementation. Not in the Cloud Control API list |
| Everything else (EC2, IAM, Secrets Manager, SNS, EventBridge) | Dedicated implementation |

For the two that are not listed, the code reads as though cdkd fails with "not supported by Cloud Control API and no SDK provider is registered" at the moment it asks the Cloud Control API to create them. That was not confirmed by running it. The list may also be out of date. In your own account, `aws cloudformation describe-type --type RESOURCE --type-name AWS::DMS::Endpoint` answers the question in the `ProvisioningType` of its response.

If it turns out cdkd cannot create them, this one stack has to be deployed with another tool. The template in `cdk.out` is an ordinary CloudFormation template, so the AWS CDK CLI can deploy it. This book's development environment does not include the CDK CLI, and that procedure was not tried. If you use it, do not manage one stack alternately with cdkd and CloudFormation, as [chapter 02](/en/chapters/02-toolchain/build.md) says. Create and delete this stack with the CDK CLI, and do not use the `dbmig:infra:diff`, `deploy`, `drift`, and `destroy` tasks.

The stack's test pins the list of resource types in use. Add a DMS type and the test fails, which sends you back to this table.

## What to have ready first

Outside this stack you need the following.

- The chapter 11 VPC, deployed with a Secrets Manager interface endpoint (`vp run net:infra:deploy -c interfaceEndpoints=secretsmanager`). It is billed by the hour
- The source RDS for PostgreSQL and the target Aurora PostgreSQL, both assumed to be in the private subnets of that VPC. This chapter does not create them
- `rds.logical_replication` set to 1 in the source's parameter group, and the instance rebooted
- `sql/target/0001_schema.sql` applied to the target
- The changes of `sql/source/0002_prepare.sql` made on the source

`vp run dbmig:preflight`, `dbmig:verify`, and `dbmig:sequences` connect directly to the two databases. The databases are in private subnets, so your own machine cannot reach them. Run the tasks on a machine inside the VPC (the instance of [chapter 23](/en/chapters/23-ec2.md), for example), with the connection strings in `.env` as `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL`.

## Creating the stack

The values to pass are the host names and security group IDs of the two databases.

```bash
vp run dbmig:infra:deploy \
  -c sourceHost=<the source's endpoint> -c sourceSecurityGroupId=<sg-...> \
  -c targetHost=<the target's cluster endpoint> -c targetSecurityGroupId=<sg-...>
```

Deployed with nothing passed, the host names are ones that cannot exist, such as `source.database.invalid`. They are there so that synthesis works, and as they are the deploy fails at the first security group rule.

At this point only the configuration, the secrets, and the rules exist. No replication is running and no DCU is billed.

Next, create the DMS users with the passwords from the secrets. Read the secrets named by the stack outputs `SourceSecretArn` and `TargetSecretArn`, run `sql/users/source.sql` and `sql/users/target.sql` with psql, and set each password with `\password`. That way the password is never written in a SQL statement.

```bash
vp run dbmig:preflight
```

It reads the source's catalog and exits non-zero if a table is matched by no rule or a finding is a reason to stop.

## Starting the replication

```bash
aws dms start-replication \
  --replication-config-arn <ReplicationConfigArn> \
  --start-replication-type start-replication
```

Billing starts here. DMS connects to the source, collects metadata, computes and provisions capacity, and begins the full load. On the first run the only type you can give is `start-replication`.

Progress is read with these two.

```bash
aws dms describe-replications \
  --filters Name=replication-config-arn,Values=<ReplicationConfigArn>

aws dms describe-replication-table-statistics \
  --replication-config-arn <ReplicationConfigArn>
```

The second returns statistics per table: rows moved by the full load, the numbers of `INSERT`, `UPDATE`, and `DELETE` applied, and the validation state (`ValidationState`). This is also where to see whether a table stopped on an error.

Lag is read from `CDCLatencySource` and `CDCLatencyTarget` in CloudWatch. Over the same time, watch `OldestReplicationSlotLag` and `TransactionLogsDiskUsage` of the source instance.

To receive failure notifications, add a subscription to the topic in the output `FailureTopicArn`.

## Cutting over

As commands, the order from [Design and Build](/en/chapters/39-database-migration/build.md) looks like this.

Before stopping writes, confirm that the lag is under the limit you decided, that validation reports no mismatch, and that no index or constraint is missing on the target. `vp run dbmig:verify` reports the third. While writes continue, it is normal for the comparison of counts and contents to report mismatches.

Stop writes. Put the application into a state where it does not write, and make the source refuse as well: take the write privileges away from the role the application uses.

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM <the application's role>;
```

After revoking, try a real write as the application's role and see that it is refused. The local model used a read-only transaction for the same purpose. Revoking privileges was chosen here so that the DMS user is not affected: the endpoint's heartbeat writes to the source.

Confirm in `pg_stat_activity` that no transaction is left open. Rows whose `state` is `idle in transaction`, and rows with an old `xact_start`, are transactions that have not ended.

Wait for the remaining changes to arrive: until both latencies are 0 and the counts in the per-table statistics stop increasing.

```bash
vp run dbmig:verify
```

When every table says `match` and no object is missing, stop the replication.

```bash
aws dms stop-replication --replication-config-arn <ReplicationConfigArn>
```

The stop comes before the connection is switched. After it, advance the sequences.

```bash
vp run dbmig:sequences
vp run dbmig:sequences --apply
```

The first only prints the plan, and the second moves the target's sequences.

Finally, point the application at the target and resume writes. If the connection target is in a secret or an environment variable, change that value and deploy again. Make sure no instance holding the old value is left. If one is, the source refuses its writes.

Keep the source as it is for the period you decided. Do not resume the replication.

Next is [Costs, Pitfalls, and Cleanup](/en/chapters/39-database-migration/wrap.md).
