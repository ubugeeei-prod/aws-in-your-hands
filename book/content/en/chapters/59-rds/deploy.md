---
title: "59 RDS: Deploy"
---

# 59 RDS: Deploy

Everything so far happened on your machine. This page gives the steps to deploy the stack and make the database usable, and then covers what happens while it keeps running: backups, version upgrades, and monitoring. None of the steps on this page has been run against real AWS yet.

## Deploying, and making it usable

<!-- section: 59.deploy -->

From here on AWS is changed and hourly charges begin. Deploy chapter 11's VPC in its default configuration first (`vp run net:infra:deploy`).

```bash
vp run rds:infra:diff
vp run rds:infra:deploy
```

This creates the instance, the parameter group, the subnet group, the security groups, two functions, the API, and the alarm. At this point the database holds the master user and an empty `notes` database, and nothing else.

```bash
vp run rds:db:bootstrap
vp run rds:db:migrate
vp run rds:db:status
```

`rds:db:bootstrap` reads the master user's secret with your credentials and invokes the operations function, which creates `notes_migrator` and `notes_api`. You need `secretsmanager:GetSecretValue` and `lambda:InvokeFunction`. `rds:db:migrate` applies chapter 13's four migrations and hands `notes_api` its privileges. Running either a second time does no harm. `rds:db:status` prints the connected role, the PostgreSQL version, and whether the connection uses TLS.

```bash
vp run rds:smoke
```

This creates a note through the API, reads it back, and deletes it. This chapter has no task for reading logs. Use the log group names in the stack's outputs and look in CloudWatch Logs. The drift check is `vp run rds:infra:drift`.

To add a read replica, pass one more context value. There are then two instances, and the bill is roughly twice as high.

```bash
vp run rds:infra:deploy -c readReplica=true
```

### Where a deploy is likely to stop

Since nothing was verified on a real account, here is where it may stop.

The stack pins PostgreSQL to `18.3`, the newest version the pinned CDK (aws-cdk-lib 2.273.0) knows. RDS stops offering old minor versions to new instances, so this one may no longer be available. If so, look up what is offered and name it.

```bash
aws rds describe-db-engine-versions --engine postgres --query 'DBEngineVersions[].EngineVersion'
vp run rds:infra:deploy -c postgresVersion=<version>
```

The pinned cdkd (0.296.28) has dedicated implementations for `AWS::RDS::DBInstance`, `AWS::RDS::DBSubnetGroup`, security groups, and alarms. It has none for `AWS::RDS::DBParameterGroup`, which goes through Cloud Control API. That this type is in the Cloud Control API list of supported types was checked. Whether creating and deleting it really works was not.

Automatic minor version upgrades are on, so after a while the real version will be newer than the template's `18.3`. How cdkd's drift check reports that difference was not checked either.

## Backups and restores

<!-- section: 59.backup -->

Chapter 22 protected data in DynamoDB and S3 with AWS Backup. RDS has automated backups of its own.

An automated backup has two parts: a snapshot of the whole volume, taken once a day in the backup window, and the transaction logs, sent to S3 every five minutes. Together they let you return to the state at any moment within the retention period. That is point-in-time recovery. The most recent moment you can return to is shown as `LatestRestorableTime`. Because the logs are sent every five minutes, it is a little before the present.

On a Single-AZ instance, storage I/O can pause briefly when a backup starts (in the documentation's words, typically under a few seconds). With Multi-AZ the backup is taken from the standby, and the primary does not pause.

What chapter 13 said about DSQL holds for RDS as well. A restore does not rewind the original instance. It always creates **a new instance**.

So three jobs remain after a restore. The new instance has a different endpoint, so the application must be pointed at it. Unless you name one, it gets the default parameter group, so yours must be attached again. The security group must be named too. And the new instance is outside this chapter's stack. This chapter provides no way of bringing it back into the stack. Chapter 22 concluded that a mechanism whose restore was never walked through cannot be said to restore anything. The same is true of RDS.

Apart from automated backups there are manual snapshots. The difference is how long they live. Automated backups disappear when the retention period has passed, and when the instance is deleted they go with it unless you ask to retain them. A manual snapshot stays until you delete it, and survives the instance. The `production` profile keeps the instance and its automated backups when the stack is destroyed.

Backup storage is free up to the total database storage you have in the Region: 20 GB for a 20 GB instance. What goes beyond that, through a longer retention or accumulated manual snapshots, is USD 0.095 per GB-month.

## Moving to a newer version

<!-- section: 59.upgrade -->

An RDS instance changes even when left alone. The maintenance window decides when, and there are three things that change.

**Operating system updates.** A mandatory update is applied in the maintenance window once its date has passed, and the instance is down meanwhile. According to the documentation that is typically about 10 minutes. With Multi-AZ the standby is updated first, then promoted to primary, and then the old primary is updated. Only the failover is downtime.

**Minor versions.** An update that keeps compatibility, such as 18.3 to 18.6. With automatic upgrades on, the version RDS has designated for automatic upgrade is installed in the maintenance window. The instance is down for this as well, and Multi-AZ does not shorten it: for an engine update, the primary and the standby are upgraded at the same time.

**Major versions.** An update with no promise of compatibility, such as 18 to 19. It never happens automatically. You start it, the instance is down while it runs, and afterwards there is no way back to the old version. RDS uses `pg_upgrade` and, when automated backups are on, takes two snapshots along the way. Extensions are not upgraded with it, so you run `ALTER EXTENSION ... UPDATE` yourself. Statistics are not carried over, so you run `ANALYZE`. A parameter group belongs to one version family, so a group for the new version has to be prepared beforehand, separate from this chapter's group for `postgres18`.

The maintenance window only decides when work **starts**. In a 30-minute window, work that takes longer continues past its end.

### Blue/green deployments

A blue/green deployment shortens the downtime of a major version upgrade. RDS creates a copy (green) of the current environment (blue) and keeps it in sync by replication. You upgrade and check the green side, then switch. According to the documentation the switchover is usually under a minute of downtime, and green takes over the endpoint names, so the application's configuration does not change.

This chapter's stack cannot use it as it stands, for two reasons: it does not work on an instance whose master password RDS manages, and blue/green deployments are not supported by CloudFormation. To use one you would work in the console or the CLI, outside the stack, and after the switchover the real resources would disagree with the template. How to reconcile that was not explored in this chapter.

### The end of standard support, and Extended Support

Each major version has a date on which RDS ends standard support. In the release calendar as read on 2026-10-13, the dates were these.

| Major version | RDS end of standard support |
| --- | --- |
| 14 | 2027-02-28 |
| 15 | 2028-02-29 |
| 16 | 2029-02-28 |
| 17 | 2030-02-28 |
| 18 | 2031-02-28 |

Version 13 already ended, on 2026-02-28.

What happens to an instance after that date depends on a setting made at creation. Through the CLI, the API, and CloudFormation, an instance created without saying otherwise is enrolled in RDS Extended Support. Extended Support lets you stay on the old version for up to three more years, for an extra charge per vCPU per hour.

That rate is of a different order from the instance's price. The price list's rates for PostgreSQL 13 are USD 0.12 per vCPU-hour in years 1 and 2, and USD 0.24 in year 3. For a db.t4g.micro with its 2 vCPUs that is USD 175.20 a month, and USD 350.40 in year 3. The instance itself is USD 18.25. With Multi-AZ, the standby's vCPUs are charged too.

This chapter's stack is set not to enrol (`open-source-rds-extended-support-disabled`). An instance with this setting is upgraded by RDS to the next version when standard support ends. The bill does not grow, but a major version upgrade happens at a time you did not choose. To avoid both, upgrade yourself before the date. Put the calendar's dates into your team's plans.

## Keeping watch

<!-- section: 59.observe -->

The first thing to watch on an RDS instance is how much disk is left.

<<< @/examples/59-rds/infra/lib/rds-stack.ts{alarm}

When the storage is full, the instance enters a state called `storage_full`, and automated backups are no longer taken either. The alarm fires when less than 4 GiB has been free for 15 minutes. It has no target, so when it fires nobody hears. How to deliver it is in [chapter 19](/en/chapters/19-observability.md).

Storage can also grow by itself. With a ceiling set (`maxAllocatedStorage`), RDS adds storage when free space has been at or below 10% of the allocation for five minutes. It adds the largest of three amounts: 10 GiB, 10% of the current size, and seven hours' worth at the recent rate of decline. It can do so at most four times in 24 hours. The `production` profile sets the ceiling to 100 GiB. The practice profile leaves it off because storage that has grown cannot shrink, and the bill stays up.

Other metrics worth watching are the number of connections (`DatabaseConnections`), for a db.t class the remaining CPU credits (`CPUCreditBalance`) and the surplus (`CPUSurplusCreditBalance`), and, with a replica, `ReplicaLag`. `ReplicaLag` is in seconds: the difference between the time of the last transaction the replica replayed and now. While the primary has no writes, it can appear to grow up to five minutes with nothing behind.

Slow statements are found in the log. With the parameter group's `log_min_duration_statement`, statements that took 500 milliseconds or longer are written to the log group `/aws/rds/instance/aih-notes/postgresql`. The log holds the statement itself. If values are built into the SQL text, the values are in the log too.

The tool that shows which statements use the database's time has changed its name. The former Performance Insights reached its end of life on 2026-07-31 and was succeeded by CloudWatch Database Insights. It has two modes, Standard and Advanced; according to the documentation Standard is on by default, and up to seven days of history are free. The CloudFormation properties keep the old names (`EnablePerformanceInsights`). This chapter's stack sets none of them. How a deployed instance ends up configured was not checked.
