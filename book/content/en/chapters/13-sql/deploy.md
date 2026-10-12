---
title: "13 SQL: Deploy"
---

# 13 SQL: Deploy

## Connecting from Lambda

<!-- section: 13.connect -->

### The connection

<<< @/examples/13-sql/src/dsql.ts{dsql}

Passing a function as `password` is the DSQL part. node-postgres calls it each time it opens a new connection, and the function signs a token on the spot.

Signing a token is a local computation. It does not ask AWS anything. That makes it fast, but it also means a token can be produced from wrong credentials. You find out when you try to connect.

A token expires after 15 minutes by default. But the expiry is looked at only when connecting, and an open connection keeps working after its token has expired. Connections have a limit of their own: DSQL closes them at 60 minutes. Hence `maxLifetimeSeconds`, which retires a connection at 50.

`max: 1` is because a Lambda execution environment handles one request at a time. The number of connections is roughly the number of execution environments running at once. A cluster allows 10,000 connections by default and 100 new ones per second.

TLS uses `rejectUnauthorized: true`: the certificate chain and the host name are checked against the certificate authorities Node.js ships with.

<<< @/examples/13-sql/src/lambda.ts{handler}

As in chapter 04, the outermost level of the file runs once per execution environment. One pool is made there. Later invocations reuse the connection that is already open.

The configuration is checked at startup.

<<< @/examples/13-sql/src/env.ts{env}

### The cluster and its permissions

<<< @/examples/13-sql/infra/lib/sql-stack.ts{cluster}

Almost disappointingly little. No instance size, no subnet, no password. The pinned CDK (aws-cdk-lib 2.273.0) has no higher-level construct for DSQL yet, so this uses `CfnCluster`, which mirrors CloudFormation's `AWS::DSQL::Cluster` directly.

Since it is for practice, deletion protection is off and the cluster goes away with the stack. In production you want the opposite.

<<< @/examples/13-sql/infra/lib/sql-stack.ts{role}

Permissions come in two layers.

The first is IAM. `dsql:DbConnect` means "may connect to this cluster as a database role other than admin". The similarly named `dsql:DbConnectAdmin` allows connecting as `admin`. The function does not get it. As `admin` it could drop tables.

The second is inside the database. After connecting, what the function may do to which table is decided by `GRANT`s to its database role.

<<< @/examples/13-sql/src/grant.ts{grant}

`AWS IAM GRANT` is DSQL's own statement. It registers "this IAM role may log in as this database role". The `GRANT`s hand over reading and writing rows, nothing else. The function cannot change the schema. Migrations are run by you, as `admin`, from your laptop.

These two statements accept no `$1`, so the names have to go into the text. That is right after saying values never do, and it is the exception. So their form is checked strictly before they are put in, and there is a test for it.

<<< @/examples/13-sql/infra/lib/sql-stack.ts{function}

The bundle format is CommonJS because node-postgres is CommonJS and loads Node.js's own modules with `require()`. The bundle from synth was loaded in a local Node.js 24, and the routes that do not touch the database answered. That is as far as it was checked.

## Deploy, then run the migrations

<!-- section: 13.deploy -->

From here on, AWS is changed. To be honest, the steps in this section have not once been run against real AWS.

```bash
vp run sql:infra:diff
vp run sql:infra:deploy
```

That creates the cluster, the function, and the API. It does not work yet. The cluster is empty, and the function's role cannot get into the database. On D1, too, creating a database gives you no tables.

```bash
vp run sql:db:migrate
vp run sql:db:grant
```

`sql:db:migrate` runs the same migrations as locally, this time with `ASYNC` left in. It takes the job ID that the index statement returns and waits for completion by watching `sys.jobs`. `sql:db:grant` runs the `GRANT`s from above and ties the function's role to `notes_api`.

Both connect as `admin`. Your own credentials need `dsql:DbConnectAdmin`.

Migrations come first. `GRANT ... ON ALL TABLES` covers the tables that exist at that moment. After a later migration adds a table, run `sql:db:grant` again.

```bash
vp run sql:smoke
```

It checks create, read back, update, an update from an old `version` (expecting 409), and delete, in that order. Unlike the smoke test of chapter 04, the read back must always succeed.

For seed data there is `vp run sql:db:seed`. Logs are `vp run sql:logs`, where the `transaction retry` lines tell you how often a conflict caused a rerun. The drift check is `vp run sql:infra:drift`.

One thing to keep in mind. The pinned cdkd (0.296.28) has no dedicated provider for `AWS::DSQL::Cluster`. It goes through Cloud Control API. Whether creating it, reading the identifier that the endpoint is built from, the drift read-back, and deleting it actually work is unconfirmed.

### Why there is no reset for the cloud

There is `sql:db:reset:local`, and there is no `sql:db:reset`. On purpose.

A reset in the cloud means dropping every table. Make that a single command, and one day it gets typed at production. To wipe a practice cluster, destroy the stack and create it again.

### Changing the schema of a database in use

As on D1, a migration and a code deploy never happen at the same instant. There is always a stretch where old code runs on the new schema.

On DSQL the constraints stack on top of that. `ADD COLUMN` adds a column with no constraint and no default. So it becomes stages: add the column, ship the new code, backfill the old rows (3,000 rows per transaction at most). This chapter does not implement that far.

## Backup and restore

<!-- section: 13.backup -->

D1 has Time Travel: with nothing configured, you can go back to any minute of the last 30 days. If you are used to that, there is more work here.

Aurora DSQL backups go through a separate service, AWS Backup. What you get is a backup of the whole cluster, taken once on demand or automatically on a schedule with a retention period. A restore always creates a **new cluster**. It does not rewind the original.

So after a restore, pointing the application at the new endpoint is still to do. In this chapter's stack the endpoint is built from the cluster identifier, so that is what you would replace. Whether database roles and `AWS IAM GRANT` carry over to the new cluster was not checked.

The backup page of the DSQL documentation did not describe restoring to a given minute. It is safest to assume that how much time you can lose is set by how often backups are taken.

One more. An unused cluster moves to Idle and then Inactive, where compute goes to zero. A backup can be taken only from an Active cluster. A nightly schedule failing on a cluster nobody is using is something that can happen.

RDS and Aurora have automated backups. Aurora's are continuous, and you can restore to any point within the retention period (1 to 35 days). There too, a restore produces a new instance or cluster.

This chapter creates no backup resources, since the data is for practice. The procedure was not tried either.
