---
title: "39 Database Migration: Design and Build"
---

# 39 Database Migration: Design and Build

The [previous page](/en/chapters/39-database-migration.md) covered what DMS moves and why this chapter's example is a migration from RDS for PostgreSQL to Aurora PostgreSQL. This page builds, in order, the preparation of the source, the table mappings, the task settings, the stack, and the cutover procedure.

## Preparing the source

<!-- section: 39.source-setup -->

Suppose the database to be left looks like this. Chapter 13's notes tables are in `public`, and two tables were added later.

<<< @/examples/39-database-migration/sql/source/0001_as_found.sql

Read against the DMS documentation, this schema has problems. To avoid learning about them from a running task, there is a function that reads the catalog and checks.

<<< @/examples/39-database-migration/src/preflight.ts{findings}

<<< @/examples/39-database-migration/src/preflight.ts{preflight}

It checks the following limits, all of them from the documentation.

On a table without a primary key, CDC ignores `UPDATE` and `DELETE`. The old row PostgreSQL keeps in the WAL by default is its primary key columns only, so without a primary key DMS has no way to know which row to change. The documentation also says that a task combining full load and CDC can duplicate rows in such a table and that data validation cannot run on it. `audit_log` is this case.

A table whose primary key is a LOB type cannot be replicated. The explanation given is that DMS first inserts a row with its LOB column null and updates it later, so the first `INSERT` fails on a null primary key. And in the type table for a PostgreSQL source, `text` maps to NCLOB, which is a LOB. Chapter 13's `owner text PRIMARY KEY` is this case. Putting those two statements together into "a `text` primary key cannot be migrated" is this chapter's reading, and it was not confirmed by running DMS.

A `text` column that is not a key is treated as a LOB too, and anything over the size limit is truncated. A column numbered by a sequence brings its numbers but not the sequence. These two are not reasons to stop: the task settings and the cutover procedure deal with them.

The two that are reasons to stop are fixed on the source.

<<< @/examples/39-database-migration/sql/source/0002_prepare.sql

`ALTER TABLE` locks the table. Before running it on a production database, find out how long it takes on a copy of the same size. For a table that cannot be given a primary key, the documentation offers `REPLICA IDENTITY FULL` as a workaround, and also says to use it with care because it generates more WAL.

### Logical replication and the slot

CDC reads changes through PostgreSQL's logical replication. On RDS for PostgreSQL you set `rds.logical_replication` to 1 in the parameter group. It is a static parameter, so the instance has to be rebooted for it to take effect. It increases the amount of WAL, and the documentation says to turn it on only when you use it.

When the task starts, DMS creates a replication slot on the source. A slot is how the database remembers how far a reader has read, and it keeps WAL until the reader has consumed it. That is what keeps changes from being missed, and the other side of it is that a slot whose reader is gone keeps accumulating WAL. The PostgreSQL documentation warns that slots can fill the space allocated for `pg_wal`. The default of `max_slot_wal_keep_size`, which would cap it, is -1, meaning unlimited.

According to the DMS documentation, a slot stays while the task is not running, and a slot DMS created is dropped when the task is deleted. A replication stopped and forgotten therefore fills the source's disk, on top of what it may cost in DCUs. RDS publishes the metrics `OldestReplicationSlotLag` and `TransactionLogsDiskUsage`, so put alarms on the source instance for the length of the migration. Slots are visible in `pg_replication_slots`, and one whose `active` is false has no reader. Drop a leftover one with `pg_drop_replication_slot`.

This chapter's source endpoint turns on `HeartbeatEnable`. On a source with few writes, a slot's `restart_lsn` does not advance and old WAL stays. The setting has DMS make a small write at intervals to move it forward.

Long transactions need care as well. The documentation says `restart_lsn` does not advance until the transaction ends, so during the migration avoid transactions that stay open for hours.

### The DMS user

The user DMS connects as is created for the migration. Using the RDS master user is not recommended.

<<< @/examples/39-database-migration/sql/users/source.sql

For an AWS-managed PostgreSQL source, the documentation says the user needs both `rds_superuser` and `rds_replication`. Those are strong permissions, so drop the role when the migration is over. The target user is given exactly the minimum grants from the documentation (`sql/users/target.sql`).

## Table mappings

<!-- section: 39.mappings -->

Which tables are moved is written in the table mappings JSON. DMS accepts many kinds of rule, and this chapter uses two: selection, which picks tables, and a transformation that renames a schema. Only what is used became a Valibot schema.

<<< @/examples/39-database-migration/src/table-mappings.ts{schema}

The schema is not a copy of the DMS specification. It is the frame of how this chapter writes its rules. A rule with a misspelled key, or of a kind the chapter does not mean to use, fails before any deploy. Bracket patterns such as `[ab]` may not work with every endpoint type according to the documentation, so they are refused outright.

<<< @/examples/39-database-migration/src/table-mappings.ts{rules}

The first rule selects every table in `public`, and the second leaves out the migration bookkeeping table. The target's schema is created by running the migrations on the target, so the target keeps its own record of how far they ran. The source's record must not overwrite it. The third rule changes the destination schema to chapter 13's `app`.

Writing rules does not tell you how the real tables are sorted by them. The same rules are a small function, applied to the local schemas.

<<< @/examples/39-database-migration/src/table-mappings.ts{resolve}

This function is not the DMS implementation. It is this chapter's reading of the documented rules. The wildcards it supports are `%` (zero or more characters) and `_` (one character), and its rule that a table is selected when an include matches and no exclude does follows the documentation's example of including every table of a schema and excluding those matching a pattern.

The tests apply the function to the source and target schemas created in PGlite and check these things. Every source table is either selected or deliberately left out, and none is matched by no rule. Every selected table has a target table with the same columns in the same order. And, because `_` is a one-character wildcard, the rule that leaves out `aih_migrations` also leaves out a table named `aihXmigrations`. When you exclude a table whose name contains `_`, check that the rule is not taking a table you did not mean.

## Task settings

<!-- section: 39.settings -->

The task settings are JSON too. There are many, and these are the only ones this chapter changes from the defaults.

<<< @/examples/39-database-migration/src/task-settings.ts{settings}

`TargetTablePrepMode` says what happens to the target tables when the full load begins. `DROP_AND_CREATE` drops and recreates them, `TRUNCATE_BEFORE_LOAD` empties them, and `DO_NOTHING` leaves them alone. This chapter has already created its tables with indexes and constraints, so it uses `DO_NOTHING`. The price is that when a failed task is restarted from the beginning, the rows from the previous run are still there. That produces primary key violations, so empty the target tables yourself before restarting.

The LOB settings are there for the `text` columns. Limited LOB mode moves LOBs in bulk up to a size limit and truncates what is longer. The limit in the example settings is 32 KB, but a note body can be 10,000 characters, and a character is up to 4 bytes in UTF-8, so a body can reach 40 KB. The limit is set to 64 KB, and the source endpoint has `FailTasksOnLobTruncation`, which fails the task where it would have truncated. A body that was silently shortened is hard to find afterward.

Error handling is left at its defaults. By default an `INSERT` of a row that is already there and an `UPDATE` that finds no row are written to the log and the task goes on, and a `DELETE` that finds no row is ignored. An error at table level is `SUSPEND_TABLE`: that one table stops and the task continues. A running task can therefore have a stopped table in it. Always look at the state of each table before the cutover.

With data validation on (`EnableValidation`), DMS compares source and target rows one by one, starting with each table as its full load finishes, and goes on comparing later changes. What it compares is the contents of rows, not indexes, constraints, or sequences. A table without a primary key or unique index cannot be validated, and a `varchar` primary key must declare a length under 1024. The documentation also says that results may be wrong if something other than DMS modifies the target during validation, that rows which are modified continuously cannot be validated, and that validation stops after more than 10,000 failures. Validation sends additional queries to both the source and the target, so allow for that load.

A premigration assessment has DMS itself check for problems with types and primary keys before the task runs. With Serverless you run it by passing assessment settings to the API that starts the replication. The `preflight` function above is only a small copy written from reading the documentation. In production, run the DMS assessment and treat its result as the authority.

There are two ways to restart a failed replication, and choosing the wrong one changes the outcome. `resume-processing` continues applying changes from where it stopped. `reload-target` loads the tables again from the beginning. A table that stopped in the middle of its full load cannot be resumed from the middle. A transformation rule that changes the target schema does not take effect on a resume and needs a restart from the beginning, the documentation says. For Serverless it adds that a replication, once started, is resumed with `resume-processing`, and that one left unstarted for 48 hours has its capacity released and can no longer be resumed.

## The stack

<!-- section: 39.stack -->

The stack imports the chapter 11 VPC and puts the DMS pieces inside it. It creates no database and takes the host names and security group IDs through `-c`.

The replication runs in the VPC's private subnets and connects from there to the two databases and to Secrets Manager.

<<< @/examples/39-database-migration/infra/lib/migration-stack.ts{network}

Outbound traffic is limited to three kinds: port 5432 on each of the two databases, and port 443 inside the VPC. Port 443 is for reaching the Secrets Manager interface endpoint. The documentation says DMS Serverless has to reach Secrets Manager through a VPC endpoint, so deploy the chapter 11 stack with `-c interfaceEndpoints=secretsmanager` beforehand. That endpoint is billed by the hour. Whether a replication needs to reach any other destination was not checked.

On the databases' side, a rule is added to each security group allowing port 5432 from the replication. The rules belong to this stack and go away with it.

DMS assumes that IAM roles with fixed names exist in the account.

<<< @/examples/39-database-migration/infra/lib/migration-stack.ts{account-roles}

`dms-vpc-role` and `dms-cloudwatch-logs-role` are roles DMS looks up by name. Under any other name it does not find them. Because the names are fixed, an account can have only one of each, and deploying this stack in an account that already has them fails on the name. In that case pass `-c accountRoles=existing`. Serverless also uses a service-linked role, `AWSServiceRoleForDMSServerless`, which DMS creates when a replication is started.

The credentials for the connections go into secrets the stack creates.

<<< @/examples/39-database-migration/infra/lib/migration-stack.ts{secrets}

The secret DMS reads is JSON with `username`, `password`, `host`, and `port`. The documentation says the master user secret that RDS manages cannot be used, because it contains no host and port. As in [chapter 21](/en/chapters/21-security.md), the password is generated at deploy time. DMS does not accept certain punctuation in an endpoint password, so the generator is told to use none.

The trust policy of the role that reads the secrets names the Regional service principal, `dms.ap-northeast-1.amazonaws.com`. Its permission is `GetSecretValue` on these two secrets and nothing more.

<<< @/examples/39-database-migration/infra/lib/migration-stack.ts{endpoints}

The source endpoint sets `CaptureDdls` to false. By default DMS creates an audit table and an event trigger on the source to pick up DDL. This chapter decides that the schema does not change during the migration, so it does not let DMS create them. A decision has to be kept. An `ALTER TABLE` run on the source in the middle of the migration does not reach the target.

`AfterConnectScript` on the target endpoint is there for the foreign keys. The full load moves one table at a time in no guaranteed order, so a note can arrive before its owner. With `session_replication_role` set to `replica`, foreign keys and user triggers do not fire in that session. It is the method the documentation recommends, but whether the target user has the permission to run this `SET` was not checked.

<<< @/examples/39-database-migration/infra/lib/migration-stack.ts{replication}

`AWS::DMS::ReplicationConfig` is the configuration of a replication. The table mappings and task settings are the very objects tested above. The capacity is 1 DCU at minimum and 2 DCU at maximum. The maximum is also the number that decides the most you are willing to pay per hour. Multi-AZ is off. The documentation recommends Multi-AZ for CDC, so consider turning it on for a migration that runs for days. It costs twice as much.

Last comes the path that reports a failure.

<<< @/examples/39-database-migration/infra/lib/migration-stack.ts{failure}

DMS sends its state changes to EventBridge. The events whose `category` is `Failure` go to an SNS topic. Subscribing your own email address or the like to the topic is a manual step after the deploy.

There is no log group in this stack. DMS Serverless writes its logs to a log group named `dms-serverless-replication-<the configuration's resource ID>`, but it is DMS that creates it, and it does so when the replication first runs. It is outside the stack, so it stays when the stack is deleted. How its retention is set was not checked. Look at it after the first run and set a retention yourself if needed.

## The cutover

<!-- section: 39.cutover -->

A cutover goes in this order.

1. Confirm that the full load has finished, that the collected changes have been applied, and that CDC has caught up
2. Confirm that no index or constraint is missing on the target
3. Stop the application's writes and make the source read-only
4. Wait for the remaining changes to reach the target
5. Compare counts and contents, and look at the state of data validation
6. Stop the replication
7. Advance the target's sequences
8. Point the application at the target and resume writes
9. Keep the source, read-only, for a period decided in advance

There is also the approach of writing to both without stopping (dual write), and this chapter does not take it. Writes to two databases are not one transaction, so you take on a different problem: how to repair a write that succeeded on one side only.

### Reading the lag

CDC lag is read from two metrics. `CDCLatencySource` is the gap between the time of the last change read from the source and now: the lag in reading. `CDCLatencyTarget` is the gap between the time of the oldest change waiting to be committed on the target and now: the lag in writing. When only the target side is high, either the target lacks indexes or the target or the replication is short of resources.

`CDCLatencySource` is also 0 when the source has no new changes. The value 0 alone does not tell "caught up" from "not reading", so look at the per-table statistics as well and see that the applied counts are increasing.

Whether writes may be stopped, and whether the connection may be switched, are pure functions that take the numbers collected.

<<< @/examples/39-database-migration/src/cutover.ts{freeze}

For users, the outage begins the moment writes are stopped. The lag at that moment is a lower bound on its length. Stop while the lag is ten minutes and you wait at least ten minutes. The function takes the limit in seconds as an argument. What the number should be is not measured. It is decided. If you decide "the outage may last five minutes", for example, you might leave four minutes for checking and switching and stop writes only when the lag is 60 seconds or less.

When a metric has no datapoint, the function treats the lag as unknown, not as none, and does not allow the stop.

<<< @/examples/39-database-migration/src/cutover.ts{switch}

The decision to switch requires that every item was checked. A table DMS could not validate (no primary key, or validation off) passes only when there is a result from your own comparison. A table nobody checked is not counted as fine.

### Comparing counts and contents

Apart from DMS's data validation, compare for yourself too.

<<< @/examples/39-database-migration/src/verify.ts{compare}

For each table, every row is turned into JSON and hashed, and the sorted hashes are hashed again. A comparison of counts alone misses a row whose body was truncated. This one finds it.

What this comparison does not see is in the tests as well. It does not see indexes and constraints: rows match on a target that has dropped them. That is why there is a separate function (`missingSecondaryObjects`) that matches them by name. It does not see the state of sequences: the collision in the next section happens after every table matched. And because it reads the source and the target separately, while writes continue it reports a change that simply has not arrived yet as a mismatch. That is the reason to compare after writes have stopped. It reads each table whole, so on a large production database let DMS's data validation do the main work and use this comparison for small tables and for tables that cannot be validated.

### Advancing the sequences

The `id` of `note_revisions` is numbered by the database. The rows arrive with their numbers, but the target's sequence has never been used. The first `INSERT` after the switch tries to take number 1 and collides with a row that was copied.

<<< @/examples/39-database-migration/src/sequences.ts{plan}

The target's sequence is set to the larger of two values: the highest value in the target's column, and the last value the source's sequence handed out. The column's highest value alone is not enough, because a row that was given a number may have been deleted since. Numbering from the highest value onward would hand out again a number the source already gave away. If that number survives in a URL or a log, it would now point at something else.

<<< @/examples/39-database-migration/src/sequences.ts{apply}

That chapter 13's note `id` is a UUID made by the application is partly so as not to have this kind of adjustment.

### The way back

When a problem is found after the switch, whether you can go back to the source depends on what you do with the data written to the target since.

In this chapter's procedure nothing is written to the source after the switch. The source stays a correct copy as of the switch. Going back means discarding what was written to the target and pointing the application at the source again. The longer since the switch, the more data that discards.

So decide beforehand the deadline for going back. For example: "for one hour after the switch, watch the error rate and for sequence collisions and decide whether to go back. After the hour, do not go back. Fix forward." That hour is a number you decide, too. After the deadline the source is not a place to return to. It is a backup in the sense of [chapter 22](/en/chapters/22-recovery.md). Decide how long to keep it, take a final snapshot, and delete it.

To go back without discarding what was written to the target, you would have to prepare a replication in the opposite direction in advance. This chapter does not build that.

## As a distributed system

<!-- section: 39.distributed -->

During a migration there are two databases, and each believes it is current. Which one is the truth is decided by the procedure, not by the databases.

<<< @/examples/39-database-migration/src/cutover.ts{phases}

During `replicating` the source is the truth. The target is a lagging copy, and nobody writes to it. During `frozen` and `verified` neither can be written to. In that interval the lagging copy becomes an exact copy. From `switched` on, the target is the truth. There is no phase in which two databases accept writes.

The invariant to keep is that, across the switch, no write that was acknowledged is lost and none is applied twice.

It breaks in a few specific orders of events. The tests produce those orders on this chapter's model.

A late write to the source. After the switch, one instance that still holds the old connection is left and writes to the source. If the source accepts the write, the application answers success and the row is carried nowhere. The test also checks that with the source read-only the same write fails with SQLSTATE 25006. A write that failed was not acknowledged, so the invariant holds. Changing the application's configuration is not enough: the source itself has to refuse.

Resuming the replication after the switch. If someone resumes the replication from an old position after the application has updated a row on the target, the source's old update is applied again and overwrites the new write on the target. The test reproduces that overwrite. Stopping the replication before switching the connection, and never resuming it afterward (better still, deleting the configuration), is what prevents it.

Double application on resume. When a replication stops after applying changes but before recording how far it got, a resume applies the same changes again. On a table with a primary key, the same `INSERT` is rejected as a duplicate and the same `UPDATE` writes the same values, so the result does not change. On a table without a primary key, there are now two rows. The tests show both.

What the application has to tolerate follows from this. During `frozen`, writes fail. The application chooses between telling the user and retrying. If it retries, it has to be built so that the same write arriving twice does not change the result, as [chapter 08](/en/chapters/08-async.md) discussed. At the moment the connection is switched, open connections are cut. No transaction can span the switch, so anything that holds long transactions is stopped before the cutover.

Next is [Run It Locally](/en/chapters/39-database-migration/local.md).
