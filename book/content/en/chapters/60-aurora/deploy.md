---
title: "60 Aurora: Deploy"
---

# 60 Aurora: Deploy

The code written on the [Design and Build](/en/chapters/60-aurora/build.md) page ran on a local PGlite and on a stand-in service. This page gives the steps for deploying the stack and reaching it through the Data API, and for causing a failover yourself to check the invariant. Neither was run while this book was written. What is here are the tasks that were prepared and the results the documentation leads you to expect.

## Deploying and checking

<!-- section: 60.deploy -->

You need two things.

- The chapter 11 VPC, deployed (`vp run net:infra:deploy`). The default configuration is enough: no NAT gateway and no interface endpoint is needed
- A practice account, and the cdkd setup from [chapter 02](/en/chapters/02-toolchain.md)

Before deploying, look at what will be created.

```bash
vp run aurora:infra:diff
vp run aurora:infra:deploy
```

The pinned cdkd (0.296.28) has an implementation of its own for `AWS::RDS::DBCluster`. That implementation does not send `EnableHttpEndpoint`, though. cdkd switches a resource that has a property its own implementation does not handle over to the Cloud Control API, so this stack's cluster should be created through the Cloud Control API. That was established by reading the package, not seen in a deployment.

Once deployed, the stack has five outputs.

| Output | Used for |
| --- | --- |
| `ClusterArn` | The Data API's `resourceArn` |
| `SecretArn` | The Data API's `secretArn`. The secret Aurora manages |
| `ClusterEndpoint` | The host name for connecting from inside the VPC |
| `ReaderEndpoint` | The same. Points at the writer while there is no reader |
| `ClusterSecurityGroupId` | Where a client inside the VPC adds a rule of its own |

Next, put the schema in.

```bash
vp run aurora:db:schema
```

It runs chapter 13's four migrations and this chapter's one, in order, through the Data API. Chapter 13's runner recorded applied migrations in a table. This task keeps no record and runs every statement every time. Each is a single statement with `IF NOT EXISTS`, so the result is the same however often it runs. In exchange, the check that finds a file edited after it was applied is absent here.

With no connection, the instance should pause after about five minutes. Run this task against a paused cluster and the first call has to wait for the resume. The script tries a call that got no outcome up to eight times, with pauses between. DDL does no harm when run twice, so here it is simply sent again.

```bash
vp run aurora:smoke
```

The smoke test creates one note, calls the append twice with the same key, and deletes what it made. The expected output has this form. Since it was not run, these are not real output but the lines the script should print.

```text
first:  {"status":"appended","version":2,"length":2}
second: {"status":"appended","version":2,"length":2}
ok   the same key applied once and answered the same twice
```

The second call appends nothing and returns the recorded result.

To see the pause, leave everything alone for about ten minutes and then look at the `ServerlessDatabaseCapacity` metric in CloudWatch. While the instance is paused, the value is 0. The instance's status stays `available` while it is paused, so the status does not tell you. A connection left open anywhere keeps it from pausing.

To change a setting, pass it as context.

```bash
vp run aurora:infra:deploy -c minCapacity=0.5 -c maxCapacity=4
vp run aurora:infra:deploy -c storage=aurora-iopt1
```

The first line gives up auto-pause and keeps at least 0.5 ACU waiting at all times. There is no more wait for a resume, and the month costs at least USD 54.75. The second switches the storage price configuration to I/O-Optimized. A switch from Standard to I/O-Optimized is allowed once every 30 days.

As in other chapters, this command looks for differences between the template and what exists.

```bash
vp run aurora:infra:drift
```

Aurora raises the engine's minor version during maintenance at times. After that, the version in the template and the real one should look different. How the drift check reports this was not checked.

## Causing a failover

<!-- section: 60.failover-drill -->

Practising a failover takes two instances. This chapter's stack has one, so by default there is nothing to fail over to. Here are the steps only.

1. Add one more `CfnDBInstance` to the stack and deploy. The second instance becomes a reader. While awake, two instances' worth of ACUs are billed
2. Run `vp run aurora:smoke` repeatedly, and from another terminal ask for a failover

```bash
aws rds failover-db-cluster --db-cluster-identifier <the cluster's ID>
```

3. Check that the smoke test prints a line such as `attempt 1: connection, retrying` and still ends with `ok`

There are three things to look at: which exceptions appeared, how many seconds it took to come back, and that the append with one key went in exactly once. The third is this chapter's invariant. The local tests tried ten places to drop the connection, but you cannot choose which of them a real failover hits. It is worth repeating a few times.

To connect with node-postgres from inside the VPC, do the same with the adapter in `src/pg.ts`, and record each error's `code`. The classification in the [failover section](/en/chapters/60-aurora.md) was made from PostgreSQL's list of error codes, and this drill is the first time it meets the codes Aurora really sends.

A failure of a whole Availability Zone cannot be reproduced this way. As with the drill in [chapter 22](/en/chapters/22-recovery.md), check the procedure against the failures you can cause, and record the ones you cannot as not exercised.
