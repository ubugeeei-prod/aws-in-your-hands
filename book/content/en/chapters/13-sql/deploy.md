---
title: "13 SQL: Deploy"
---

# 13 SQL: Deploy

So far the application has run on PGlite on your own machine. This page connects the same application, as a Lambda function, to an Aurora DSQL cluster, and goes on to the deploy and backup procedures.

## Connecting from Lambda

<!-- section: 13.connect -->

### The connection

<<< @/examples/13-sql/src/dsql.ts{dsql}

The part specific to DSQL is that `password` is a function. node-postgres calls it each time it opens a new connection, and the function signs a token on the spot and returns it.

Signing a token is a local computation that does not contact AWS. That makes it fast, but it also means that a token can be produced from wrong credentials, and the failure shows up only when the function tries to connect to the cluster.

A token expires after 15 minutes by default. The expiry is checked only at connection time, though, and an open connection keeps working after its token has expired. Connections have a separate limit: DSQL closes a connection after 60 minutes. For that reason `maxLifetimeSeconds` is set so that the pool discards a connection once it is 50 minutes old.

`max` is 1 because a Lambda execution environment handles only one request at a time. The number of connections is roughly the number of execution environments running at the same time. By default a cluster allows 10,000 connections and up to 100 new connections per second.

TLS is set to `rejectUnauthorized: true`, so the certificate chain and the host name are checked against the certificate authorities that Node.js ships with.

<<< @/examples/13-sql/src/lambda.ts{handler}

As in chapter 04, the outermost level of the file runs once per execution environment, so the single pool is created there. Later invocations reuse the connection that is already open.

The configuration is checked at startup.

<<< @/examples/13-sql/src/env.ts{env}

### The cluster and its permissions

<<< @/examples/13-sql/infra/lib/sql-stack.ts{cluster}

The cluster definition has no instance size, no subnet, and no password. The pinned version of the CDK (aws-cdk-lib 2.273.0) has no higher-level construct for DSQL yet, so the stack uses `CfnCluster`, which represents CloudFormation's `AWS::DSQL::Cluster` directly.

Because this is for practice, deletion protection is off and the cluster is deleted with the stack. In production you do the opposite.

<<< @/examples/13-sql/infra/lib/sql-stack.ts{role}

Permissions come in two layers.

The first layer is IAM. `dsql:DbConnect` allows connecting to this cluster as a database role other than admin. The similarly named `dsql:DbConnectAdmin` allows connecting as `admin`, and the function does not get it, because `admin` can drop tables.

The second layer is inside the database. After the function connects, `GRANT`s to its database role decide what it may do to which table.

<<< @/examples/13-sql/src/grant.ts{grant}

`AWS IAM GRANT` is a statement specific to DSQL. It registers that this IAM role may log in as this database role. The `GRANT`s give only the right to read and write rows, so the function cannot change the schema. You run the migrations yourself, as `admin`, from your own machine.

These statements do not accept `$1`, so the database role name and the IAM role ARN have to be put into the SQL text. The [Design and Build](/en/chapters/13-sql/build.md) page said that the application never puts values into SQL, and this is the one exception. For that reason the code checks the form of both names strictly before inserting them, and a test covers it.

<<< @/examples/13-sql/infra/lib/sql-stack.ts{function}

The bundle format is CommonJS because node-postgres is CommonJS and loads Node.js's built-in modules with `require()`. The bundle that synth produced was loaded in a local Node.js 24, and it was checked as far as the routes that do not touch the database responding.

### A limit on how much it accepts

<<< @/examples/13-sql/infra/lib/sql-stack.ts{throttle}

This is the same stage throttling as in chapter 04. The whole API accepts up to 10 requests a second, API Gateway rejects the rest with a 429, and neither the function nor the database is called for them. This API has no authentication either, so without a limit the DPUs for every call would go straight onto the bill. The number of rows is held by the quota implemented on the [Design and Build](/en/chapters/13-sql/build.md) page, at 100 rows per owner.

## Deploy, then run the migrations

<!-- section: 13.deploy -->

From here on you change AWS. The steps in this section have not yet been run against real AWS even once.

```bash
vp run sql:infra:diff
vp run sql:infra:deploy
```

This creates the cluster, the function, and the API, but they do not work yet. The cluster is empty, and the function's role cannot get into the database. On D1, too, creating a database gives you no tables.

```bash
vp run sql:db:migrate
vp run sql:db:grant
```

`sql:db:migrate` runs the same migrations as locally, this time with `ASYNC` left in. It takes the job ID that the index statement returns and waits for the job to complete by watching `sys.jobs`. `sql:db:grant` runs the grant statements above and ties the function's role to `notes_api`.

Both tasks connect as `admin`, so your own credentials need `dsql:DbConnectAdmin`.

Run the migrations first, because `GRANT ... ON ALL TABLES` applies only to the tables that exist at that moment. If you later run a migration that adds a table, run `sql:db:grant` again as well.

```bash
vp run sql:smoke
```

It checks create, read back, update, an update with an old `version` (expecting a 409), and delete, in that order. Unlike the smoke test in chapter 04, the read back should always succeed.

To load seed data, use `vp run sql:db:seed`. `vp run sql:logs` shows the logs, where the `transaction retry` lines tell you how many times a conflict caused a rerun. The drift check is `vp run sql:infra:drift`.

The pinned version of cdkd (0.296.28) has no dedicated implementation for `AWS::DSQL::Cluster` and handles it through Cloud Control API. Whether creating the cluster, reading the identifier that the endpoint is built from, reading it back for drift, and deleting it actually work is unconfirmed.

### Why there is no reset for the cloud

`sql:db:reset:local` exists, and `sql:db:reset` deliberately does not.

A reset in the cloud means dropping every table. If one command could do that, someday someone would run it against production. To empty a practice cluster, destroy the stack and create it again.

### Changing the schema of a running database

As on D1, a migration and a code deploy do not happen at the same moment, so there is always a period in which old code runs against the new schema.

On DSQL, the constraint on `ADD COLUMN` comes on top of that. You can add only a column with no constraint and no default, so the change becomes a sequence of stages: add the column, ship the new code, and fill in the old rows (at most 3,000 rows per transaction). This chapter does not implement that.

## Backup and restore

<!-- section: 13.backup -->

D1 has Time Travel, which lets you go back to any minute of the last 30 days with nothing configured. On Aurora DSQL the same thing takes more work.

Aurora DSQL backups go through a separate service, AWS Backup. A backup covers the whole cluster, and you either take one on demand or have them taken automatically on a schedule with a retention period. A restore does not rewind the original cluster. It always creates a **new cluster**.

After a restore, you therefore still have to point the application at the new endpoint. This chapter's stack builds the endpoint from the cluster identifier, so that identifier is what you would replace. Whether database roles and `AWS IAM GRANT` carry over to the new cluster was not checked.

The backup page of the DSQL documentation did not describe a way to restore to a specified time. It is safest to assume that the amount of time you can lose is set by the interval between backups.

An unused cluster moves to the Idle state and then to Inactive, where its compute drops to zero. A backup can be taken only from an Active cluster, so a nightly schedule can fail to back up a cluster that nobody is using.

RDS and Aurora have automated backups. Aurora takes them continuously, and you can restore to any point within the retention period (1 to 35 days). On RDS and Aurora, too, a restore produces a new instance or cluster.

Because the data is for practice, this chapter creates no backup resources. The procedure was not tried either.
