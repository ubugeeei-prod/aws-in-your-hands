---
title: "59 RDS: Design and Build"
---

# 59 RDS: Design and Build

The [previous page](/en/chapters/59-rds.md) showed the setup and the first decisions. This page defines the instance, decides who signs in and how, and looks at the number of connections coming from Lambda.

## Defining the instance

<!-- section: 59.instance -->

### Network

<<< @/examples/59-rds/infra/lib/rds-stack.ts{network}

The VPC is the one from chapter 11, read from that stack's outputs. There are two security groups, and each names the other. The functions' group can send only to port 5432 of the database's group, and the database's group accepts only port 5432 from the functions' group. No rule contains a range of IP addresses.

A DB subnet group is the list of subnets an instance may be placed in. RDS asks for subnets in at least two Availability Zones. That holds for a Single-AZ instance too: the second zone is where the standby goes if the instance is later changed to Multi-AZ.

### Parameter group and logs

<<< @/examples/59-rds/infra/lib/rds-stack.ts{parameters}

PostgreSQL's settings (the values that would go into `postgresql.conf`) live in a parameter group on RDS. If you name none, the instance gets the default group, and the default group cannot be edited. If a day will come when you change even one setting, attach a group of your own from the start, because attaching one later needs a reboot.

Parameters come in two kinds. A dynamic parameter takes effect as soon as you change it. A static one does nothing until you reboot the instance yourself. An instance with a changed static parameter shows `pending-reboot`, but the next maintenance window does not reboot it for you. It simply stays in the state where you believe the change is live and it is not.

Two settings are made here. `log_min_duration_statement` writes any statement that took 500 milliseconds or longer to the log, with its text. `rds.force_ssl` refuses connections that do not use TLS, and is already on by default on RDS from PostgreSQL 15. It is written down anyway, so that it shows up as a difference if someone removes it.

There is a reason the log group is created here, ahead of the instance. When the PostgreSQL log is sent to CloudWatch Logs, RDS writes to a log group named `/aws/rds/instance/<instance name>/postgresql`. If it does not exist, RDS creates it, and a log group that RDS created has no retention period and stays behind when the stack is destroyed. Created first under the same name, it drops old entries after a week and leaves with the stack. The instance has the fixed name `aih-notes` so that this name is known in advance.

### The instance

<<< @/examples/59-rds/infra/lib/rds-stack.ts{instance}

From the top:

With `publiclyAccessible: false` the instance has no public address. Its endpoint name resolves to a private address, so nothing outside the VPC reaches it.

`storageEncrypted` can be chosen only at creation. An unencrypted instance cannot be encrypted afterwards; you would copy a snapshot with encryption and build a new instance from it.

`backupRetention` is the number of days automated backups are kept, from 0 to 35. At 0 automated backups stop, and with them point-in-time recovery and read replicas. A change between 0 and any other value stops the instance by itself. That is why even the practice profile uses 1.

The backup and maintenance times are written in UTC. If you give no maintenance time, RDS picks 30 minutes somewhere in 13:00–21:00 UTC for the Tokyo Region (22:00 to 06:00 in Japan). This chapter puts backups at 02:00 Japan time and maintenance on Monday at 03:00. The two windows may not overlap.

`engineLifecycleSupport` is a setting that shows up on a bill later. "Moving to a newer version" on the [Deploy](/en/chapters/59-rds/deploy.md) page explains it.

The last entry, `credentials`, is how the master user's password is handled. With `manageMasterUserPassword`, RDS creates the password, keeps it in Secrets Manager, and by default replaces it every seven days. The password appears neither in the template nor in the stack's state. There is a restriction, though: an instance that uses this feature cannot have a read replica, and cannot use a blue/green deployment. So the configuration with a read replica (`-c readReplica=true`) switches to an ordinary secret whose password CloudFormation generates once. Nobody rotates that one.

With the `production` profile the instance gets a standby and deletion protection, and the instance and its automated backups remain when the stack is destroyed.

## Who signs in, and how

<!-- section: 59.auth -->

The database has three users (roles, in PostgreSQL's words).

| Role | Signs in with | May | Used |
| --- | --- | --- | --- |
| `notes_admin` | the password in Secrets Manager | create roles, hand out privileges | once, at the start |
| `notes_migrator` | an IAM token | create and alter the schema and its tables | for every migration |
| `notes_api` | an IAM token | read and write rows in the `app` schema | for every request |

Chapter 13's Aurora DSQL had two, `admin` and `notes_api`. A third is added here so that the master user's password is not needed in everyday work.

### IAM database authentication

<<< @/examples/59-rds/src/rds.ts{token}

IAM database authentication on RDS is much like the DSQL token of chapter 13. A string signed with IAM credentials goes into the password field. The token expires after 15 minutes, but it is checked only when a connection is made, and an established connection keeps working.

Signing is a local computation and sends nothing to AWS. In this chapter's setup that property decides the matter. The function's subnets cannot reach the AWS APIs, so fetching a password from Secrets Manager would need an interface endpoint (chapter 11: USD 0.014 an hour per Availability Zone). A token needs nothing added.

Who may become which database user is decided by an IAM policy.

<<< @/examples/59-rds/infra/lib/rds-stack.ts{roles}

The resource of `rds-db:connect` is not an instance. It is "this database user on this instance". The API function's role may become `notes_api` only, and the operations function's role `notes_migrator` only. The part that identifies the instance is not its endpoint name but the resource ID that RDS assigns, beginning with `db-`, which CloudFormation exposes as the `DbiResourceId` attribute.

The six `ec2:` actions in the same policy are what Lambda requires in order to place a function in a VPC. The Lambda guide says they must be allowed on all resources, so this is the one place in this chapter's policies where `*` appears.

On the database side, the user is granted a role named `rds_iam`.

<<< @/examples/59-rds/src/roles.ts{bootstrap}

A user with `rds_iam` can no longer sign in with a password, because IAM authentication takes precedence. `notes_migrator` receives only the right to create things in the database and in the `public` schema. It can create neither roles nor databases.

After a migration, `notes_api` is given the rows.

<<< @/examples/59-rds/src/roles.ts{grants}

The third line could not be written on chapter 13's DSQL. `ALTER DEFAULT PRIVILEGES` attaches privileges, in advance, to the tables that the role running it will create from now on. When a later migration adds a table, the grants do not have to be run again.

Two things are worth knowing about IAM database authentication. Every sign-in uses CPU and memory on the instance, and neither CloudTrail nor CloudWatch records who signed in and when. It does not suit an application that opens and closes connections at a high rate.

### Running migrations from outside the VPC

The database is reachable only from inside the VPC, so migrations cannot be run straight from your machine as in chapter 13. This chapter puts one operations function inside the VPC, and your machine invokes that function.

<<< @/examples/59-rds/src/ops.ts{command}

It accepts three commands and nothing else. No route from API Gateway leads to it. Only someone who holds `lambda:InvokeFunction` on this function can call it.

<<< @/examples/59-rds/src/ops.ts{run}

`migrate` calls chapter 13's migration runner as it is. The migration files are not bundled into the function; they arrive in the invocation payload. The runner's lint runs too, so chapter 13's files stay in a form that both DSQL and RDS accept. On the way to RDS the word `ASYNC` is removed, as it is for chapter 13's local PostgreSQL.

Only `bootstrap` needs the master user's password. The operations function cannot reach Secrets Manager either, so the caller reads the password and passes it in the invocation payload. This is the script on your machine:

<<< @/examples/59-rds/scripts/ops.ts

The password travels from Secrets Manager through the local process into one invocation, and is stored nowhere. The function does not log its event. Once `bootstrap` has created `notes_migrator`, migrations need no password.

This design is a shortcut for practice. That the password passes through the memory of your machine, and that anyone who may invoke the function can change the schema, would be hard to accept in production. There, one way is to make the migration a step of [chapter 20](/en/chapters/20-shipping.md)'s pipeline and invoke the function from it.

That the privileges are divided as intended is checked on a local PostgreSQL (PGlite).

<<< @/examples/59-rds/test/ops.test.ts{least-privilege}

PGlite has no role named `rds_iam`, so the test creates an empty role of that name first. Signing in with an IAM token is not reproduced locally. `SET ROLE` checks only what a role may do once it is signed in.

### TLS and the certificate authority

<<< @/examples/59-rds/src/rds.ts{pool}

`rejectUnauthorized: true` checks the server's certificate chain and that the host name matches. One thing differs from chapter 13 here. An RDS server certificate is issued by a certificate authority that belongs to Amazon RDS, and that authority's certificate is not in the list Node.js ships with.

The Lambda Node.js runtime keeps a file with Amazon's CA certificates at `/var/runtime/ca-cert.pem`. Runtimes from Node.js 20 on do not load it automatically. So the stack puts that path into the function's `NODE_EXTRA_CA_CERTS` environment variable. That this file contains the RDS authorities, and that verification passes on the Node.js 24 runtime, was not confirmed on a real function.

There are three certificate authorities to choose from (`rds-ca-rsa2048-g1`, `rds-ca-rsa4096-g1`, `rds-ca-ecc384-g1`), and the first is the default. As long as one of these three is in use, RDS replaces the server certificate by itself before it expires.

Always name the database by its endpoint name. An IP address in the configuration not only fails certificate verification; after the failover described on the next page it would still point at the old instance. The environment check accepts nothing but the name.

<<< @/examples/59-rds/src/env.ts{env}

## The number of connections from Lambda

<!-- section: 59.connections -->

As in chapter 13, the pool's `max` is 1. A Lambda execution environment handles one request at a time, so the number of connections is about the number of execution environments running at once.

<<< @/examples/59-rds/src/lambda.ts{handler}

On DSQL that number hardly mattered: a cluster allowed 10,000 connections. RDS is different. PostgreSQL starts one process per connection and spends memory on each. The default limit (`max_connections`) is derived from the instance's memory by the formula `LEAST({DBInstanceClassMemory/9531392}, 5000)`. For a db.t4g.micro with 1 GiB, putting the whole gibibyte into the formula gives only 112. How many bytes `DBInstanceClassMemory` really is was not checked, so read the actual value with `SHOW max_connections` once you are connected.

Lambda adds execution environments as requests increase. At 200 environments there are 200 connections. A database at its limit refuses new connections with `too many connections`. And when the requests subside, a connection can stay open for as long as its execution environment is kept.

This chapter's stack narrows the flow at the entrance, with the stage throttling of API Gateway (10 requests a second). That alone does not fix the number of connections, but it keeps it from growing without bound. For a firmer limit, give the function reserved concurrency ([chapter 29](/en/chapters/29-lambda-tuning.md)).

### RDS Proxy

AWS's answer to the connection problem is RDS Proxy: a connection pool between the application and the database. The application connects to the proxy's endpoint, and the proxy keeps a small number of connections to the database and reuses them.

The unit of reuse is the transaction. When one client's transaction ends, its database connection is lent to another client. With hundreds of execution environments connected to the proxy, the database sees only as many connections as there are transactions running at that moment. What cannot be served waits, and what exceeds the configured limit is refused.

The proxy has a second job. During a Multi-AZ failover it keeps accepting connections at the same address and redirects them to the new primary. A client that remembers a DNS answer is not affected. The documentation says this reduces failover times for Multi-AZ instances by up to 66%.

Reuse can stop working, though. When a client does something that leaves state on the connection, the proxy fixes that client to one connection. This is called pinning. For PostgreSQL the documentation lists these causes:

- changing a session setting with `SET`
- handling prepared statements with `PREPARE`, `EXECUTE`, or `DEALLOCATE`
- creating temporary tables, sequences, or views
- declaring a cursor
- waiting for notifications with `LISTEN`
- taking a session-level advisory lock such as `pg_advisory_lock` (the transaction-level `pg_advisory_xact_lock` does not pin)
- manipulating sequences with `nextval` or `setval`
- sending a statement larger than 16 KB

When every connection is pinned, the proxy is a mere relay and only its price remains. Chapter 13's transaction runner sends `BEGIN ISOLATION LEVEL REPEATABLE READ`. That statement is not a `SET` and applies to its own transaction only, so it is not on the list above. Whether the protocol node-postgres uses for queries with values (the extended query protocol) causes pinning cannot be read from this list, and was not checked.

The price follows the vCPUs of the instance behind the proxy: USD 0.018 per vCPU-hour, with a minimum of 2 vCPUs. In front of a db.t4g.micro that is USD 26.28 a month, more than the instance itself (USD 18.25).

This chapter's stack has no proxy. An API limited to 10 requests a second never runs short of connections, and the bill would more than double. Add a proxy when `too many connections` really appears, when the execution environments running at once approach the connection limit, or when you want a shorter Multi-AZ failover. The Lambda guide says direct connections are for simple scenarios and recommends a proxy for production.

Two conditions for using one. The proxy must be in the same VPC as the database and cannot be public. And for instances in a replication setup, a proxy can be attached only to the instance that takes writes, not to a read replica.
