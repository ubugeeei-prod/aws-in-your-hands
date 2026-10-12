---
title: "66 Distributed SQL: Design and Build"
---

# 66 Distributed SQL: Design and Build

The [previous page](/en/chapters/66-distributed-sql.md) showed where the three nodes sit. This page first looks at how YugabyteDB protects a write, and then follows the implementation: the cluster definition, the client, certificates, the stack, and what is on a node.

## How a write reaches three places

<!-- section: 66.architecture -->

With Aurora DSQL in chapter 13, where the data was and how many copies existed could not be seen. With YugabyteDB it is a setting in front of you. What follows was read in the architecture section of the documentation and in the flag descriptions the pinned binary prints.

Two processes run on a node. `yb-tserver` holds data and accepts PostgreSQL-compatible connections. `yb-master` holds the catalog: the table definitions, and the map of which tablet is on which node. `yb-master` is not in the path of reads and writes. It decides where tablets go, evens out where leaders are, and orders new copies when a node dies.

A table is divided into tablets. A row belongs to one tablet by its primary key, and with hash sharding the tablets share the range 0x0000 to 0xFFFF. Each tablet has as many copies as the replication factor, which is 3 in this chapter. The three copies form a Raft group, with one leader and two followers. The catalog of `yb-master` has the same number of copies and elects one leader by Raft as well. That is why `yb-master` runs on all three nodes.

```figure
type: sequence
caption: The leader answers after a majority, itself included, has recorded the write. With node c stopped, two nodes are a majority
actor client: Client
actor a: Node a | tablet leader
actor b: Node b | follower
actor c: Node c | follower
step client -> a: COMMIT
step a -> a: append to the log
step a -> b: replicate
step a -x c: replicate
step b --> a: persisted
note a: 2 of 3 hold it
step a --> client: acknowledged
```

According to the documentation, a write is applied after its Raft log entry has been replicated to a majority of the copies and persisted there: two of three. A write whose answer you received is on at least two disks, so whichever one node is lost, one of the two that remain has it. A new leader is elected by a majority of votes, so a copy without that write cannot become leader. That is what the first invariant consists of.

By default only the leader of a tablet serves reads and writes. If the node that took the SQL does not hold the leader of the tablet, the request is passed internally to the node that does. This is why any node gives the same answer.

A tablet that has lost its majority stops answering. It does not answer wrongly; it does not answer. With two of three nodes lost, every tablet and the catalog are in that state.

What happens while one node stays down is also in the flags. A leader sends heartbeats every 500 ms (`raft_heartbeat_interval_ms`). When they have not reached a follower for 900 seconds (`follower_unavailable_considered_failed_sec`), that copy is removed from the group and `yb-master` has a new copy made on another node. A cluster of three, though, has no other node. Until a fourth is added, there are two copies.

### Transactions and isolation levels

YugabyteDB offers three isolation levels: Snapshot, Serializable, and Read Committed. Snapshot is SQL's `REPEATABLE READ`. Chapter 13's runner asks for it by name with `BEGIN ISOLATION LEVEL REPEATABLE READ`, so it runs at the same level as it did on Aurora DSQL.

The default, when nothing is asked for, hides a trap. As in PostgreSQL the default is `READ COMMITTED`, but according to the documentation, in a cluster whose `yb-tserver` you started yourself, `yb_enable_read_committed_isolation` stays `false` and `READ COMMITTED` is treated as the stricter Snapshot. On the local cluster, `SHOW transaction_isolation` answered `read committed` and `SHOW yb_effective_transaction_isolation_level` answered `repeatable read`. Do not infer the guarantee from the name; check the level that is in effect.

Conflicts arrive a little differently from Aurora DSQL. In chapter 13 a conflict arrived at `COMMIT`, as `40001`. On the local YugabyteDB, when the transaction that had updated the same row first committed, the `UPDATE` statement of the one that was waiting failed with `40001`.

<<< @/examples/66-distributed-sql/test/repository.test.ts{fixtures}

Chapter 13's loop does not look at which statement failed. If the SQLSTATE is `40001` it sends `ROLLBACK` and starts again from `BEGIN`. So the difference in arrival does not matter. A test injects this error into the `UPDATE` statement and checks that the loop starts over and ends with one note and a count of one.

A deadlock (`40P01`) is another matter. YugabyteDB's documentation recommends retrying it the same way as `40001`, but chapter 13's loop retries `40001` only. Every operation of this chapter's repository touches the `app.owners` row and then the `app.notes` row, in that order, so it is built not to deadlock, and none was produced on the local cluster. If you add a transaction that touches rows in the opposite order, add `40P01` to the retry condition. A test pins that the loop as it stands hands `40P01` to the caller without retrying.

### Clocks

YugabyteDB orders transactions by time. It uses a hybrid logical clock, which combines physical time with a logical counter and which nodes advance by exchanging values on every message. Even so, the skew between physical clocks needs a bound. According to the documentation, a `yb-tserver` or `yb-master` that detects skew above `max_clock_skew_usec` (500 ms by default) stops itself.

With a rented database there was no need to think about clocks. When you run one, time synchronization is part of availability. YugabyteDB recommends chrony, and on a cloud the provider's link-local time service. On AWS that is the Amazon Time Sync Service. Whether Amazon Linux 2023's default configuration points at it was not checked in this chapter. `vp run distsql:status` prints each node's `chronyc tracking`, so check the reference and the offset before you start anything.

<<< @/examples/66-distributed-sql/src/yugabyte.ts{documented}

## One definition for the whole cluster

<!-- section: 66.topology -->

`yb-master` and `yb-tserver` learn their role from the flags they start with. Two processes on three nodes make six files. Written by hand, they invite the accident of an address corrected in all places but one. So the cluster is defined as one type, and the six files are generated from it.

<<< @/examples/66-distributed-sql/src/topology.ts{schema}

Beyond the shape, the schema checks three things. There are three nodes. No two listeners share an address and a port. Anywhere other than `127.0.0.1`, a certificate directory is given. The third keeps a cluster without TLS from being put on a network by oversight.

<<< @/examples/66-distributed-sql/src/topology.ts{flags}

`--placement_zone` gets a different zone on each node. YugabyteDB uses it to put the copies of one tablet in different zones. With three nodes in three zones, losing a zone is the same as losing one node. Chapter 11's network has two zones by default, and this chapter deploys it again with three: with three nodes in two zones, losing the zone that holds two of them leaves no majority.

Every listener is bound to the node's own address. `0.0.0.0` is not used.

The same functions serve the local cluster and the cluster on EC2. Only addresses and ports differ.

<<< @/examples/66-distributed-sql/src/topology.ts{local}

The documentation's examples give a local three-node cluster the addresses `127.0.0.1`, `127.0.0.2`, and `127.0.0.3`. The loopback interface of macOS has only `127.0.0.1`, and adding more takes `sudo`, so this chapter keeps one address and separates the nodes by port.

<<< @/examples/66-distributed-sql/src/topology.ts{ec2}

On EC2, addresses do not exist until the instances do. So the place of each address holds the name of a shell variable, and a script on the node fills in the real value when it writes the file. The address schema lets through two forms only: an IPv4 address, and a `${NAME}` of capital letters and underscores. A value with a space or a quote is dropped before it reaches a flag file.

## Chapter 13's code, connected as it is

<!-- section: 66.client -->

All chapter 13's repository knows is the `Db` interface. It has an implementation for Aurora DSQL and one for PGlite, and this chapter adds one for YugabyteDB.

<<< @/examples/66-distributed-sql/src/yugabyte-db.ts{open}

The difference from Aurora DSQL is that the destination is not one endpoint but three nodes. Every node takes the same SQL, so when one is down the client connects to the next.

<<< @/examples/66-distributed-sql/src/failover.ts{failover}

Only the opening of a connection is tried again elsewhere. A connection that was never opened did nothing, so opening one on another node does no harm. An error after connecting is not retried here. If the connection breaks after `COMMIT` was sent, the client cannot tell whether the commit happened. YugabyteDB's documentation, too, says not to retry a `COMMIT` blindly.

It is chapter 13's repository that takes on this not knowing. `create` first reads whether a note with the same ID exists, and if so does nothing and returns `created`. A create whose answer never arrived can be sent again, with the same ID, to another node. The [local verification](/en/chapters/66-distributed-sql/local.md) uses this property: right after a node is killed, it resends each write with the same ID until an acknowledgement comes back.

YugabyteDB also distributes a driver of its own built on node-postgres (`@yugabytedb/pg`). It fetches the list of nodes itself and spreads connections with zones in mind. This chapter does not use it, so that what happens when the destination changes stays visible as code.

## A model of the majority

<!-- section: 66.quorum-model -->

Killing nodes of a real cluster needs three of them running, and gives no choice of the moment. To try every case of "the write had reached these followers, and then this node was lost", there is a small model of a log with three copies.

<<< @/examples/66-distributed-sql/src/model/quorum.ts{model}

This is **this chapter's model**, not YugabyteDB and not an implementation of Raft. It has no network and no time, and an election happens when a test calls for one. It holds two rules only. A write is acknowledged once a majority holds it. The new leader is, among the copies that are up, one whose last entry is from the latest term, and the one with the longest log among those.

The tests check that the invariant follows from these two rules. They go through every combination of which followers a write had reached (4 cases), which node is lost (3 cases), and where the next write reaches (4 cases), and see that an acknowledged write is always visible from the new leader. With two nodes lost the model does not answer, and with one back it returns holding the acknowledged writes.

The same model is also run with one rule changed: the leader acknowledges as soon as it has written to its own log, which is asynchronous replication. Then a write is visible, is acknowledged, and disappears when the leader is lost. This is what you have to watch for with read replica lag ([chapter 59](/en/chapters/59-rds.md)) and with replication while moving a database ([chapter 39](/en/chapters/39-database-migration.md)). The latency paid for waiting on a majority is the price of removing "visible and then gone".

About a write that was not acknowledged, the model promises nothing. It may stay or go. On the local cluster as well, the one write sent while two nodes were down was there after they came back in some runs and not in others.

## Certificates, without moving a key

<!-- section: 66.tls -->

Traffic between nodes and connections from clients both use TLS. Three flags do it: `use_node_to_node_encryption`, `use_client_to_server_encryption`, and `allow_insecure_connections=false`, which refuses a peer that does not speak TLS.

YugabyteDB decides how the files are laid out. The `--certs_dir` directory holds the certificate of the certificate authority, and a certificate and a key whose names contain the node's address.

<<< @/examples/66-distributed-sql/src/certs.ts{names}

The certificate authority is made with `openssl` for this cluster only. The documented procedure uses `openssl ca`, and makes each node's key on your machine and carries it to the node. This chapter changes it in two ways.

<<< @/examples/66-distributed-sql/src/certs.ts{openssl}

First, a node's private key is made on that node and never leaves it. All the node gives out is a signing request (a CSR). The certificate authority on the operator's machine signs it and sends back a certificate. What Run Command carries is the CSR and the certificate, and neither is secret. The arguments and output of Run Command are recorded, so a private key must not pass through it.

<<< @/examples/66-distributed-sql/scripts/nodes.ts{certs}

Second, a node's certificate is valid for 397 days. The documentation's example uses 3,650. A certificate valid for ten years means keeping it without ever having tried the procedure for replacing it.

No procedure for replacing certificates was found in the documentation for manual deployments. Placing certificates signed again by the same authority and restarting one node at a time should do it, but that is a guess and was not checked. Replacing the authority itself takes more steps. The authority's private key stays on the operator's machine (`.yugabyte/ca-aws/`, not in git), so for production, decide where it is to live.

One more thing was noticed locally. With TLS on, the administrative web interfaces of `yb-master` and `yb-tserver` (7000, 9000, 13000) still answered plain HTTP. They have no login either. This chapter's security groups have no rule at all for these three ports. To look at them, go in through Session Manager port forwarding.

## The stack

<!-- section: 66.stack -->

The stack takes its settings from CDK context.

<<< @/examples/66-distributed-sql/src/config.ts{schema}

The number of nodes is 0 or 3 and nothing else. Two cannot lose one, and four cannot lose more than three can, so the choice is not offered. The default instance type is `t4g.medium` (2 vCPUs, 4 GiB). It meets the minimum the documentation names (2 cores, 2 GB), but what the documentation recommends on AWS is the M family, and it says to avoid T2. It says nothing of T4g, which is burstable in the same way. This is a choice for practice, not for production.

<<< @/examples/66-distributed-sql/infra/lib/distsql-stack.ts{network}

There are two security groups. The node group accepts the replication ports (7100, 9100) from its own members only, and the SQL port (5433) from the client group only. The source is a group and not the VPC's CIDR, so another instance that merely sits in the same VPC cannot connect.

<<< @/examples/66-distributed-sql/infra/lib/distsql-stack.ts{nodes}

The nodes go into the network's private subnets, one per zone, in order. Data is on an encrypted EBS volume separate from the instance. By default the volumes stay when the stack is destroyed (`stateOnDestroy=retain`): the three volumes are the database.

<<< @/examples/66-distributed-sql/infra/lib/distsql-stack.ts{role}

The node role can do three things in S3: read the archive under `artifacts/`, write and read under `backups/`, and list under `backups/`. It has no permission to delete. Someone who takes over a node cannot remove the backups already taken. `s3:PutObject` does allow overwriting the same key, though, so in production turn on bucket versioning ([chapter 22](/en/chapters/22-recovery.md)).

The resource types and properties this stack uses are kept within those of chapter 24's stack. How the pinned cdkd (0.296.28) handles each is recorded in chapter 24's verification notes, and a test here pins that the stack stays inside that range. That is also why `BlockDeviceMappings`, which would resize the root volume, is not used.

## What is on a node

<!-- section: 66.node-files -->

The user data that runs on an instance's first boot installs no database. It creates a user, kernel settings, the systemd units, and the scripts used later, and mounts the data volume. That is all.

<<< @/examples/66-distributed-sql/src/machine.ts{user-data}

Installing the database is a separate step so that no bucket name and no address is embedded in user data. The user data of the three nodes does not differ by a byte.

<<< @/examples/66-distributed-sql/src/machine.ts{unit}

A unit does not start unless the data volume is mounted. Started without it, the database would begin empty on the root volume, and to the other two it would look like a node that lost its data. When a process dies, systemd starts it again. The documentation says to restart it from cron, which comes to the same thing. The limits on open files and processes are the documentation's values in systemd's spelling.

<<< @/examples/66-distributed-sql/src/machine.ts{install}

The install script takes from outside the name of the bucket, the release, and its SHA-256, and checks each by its shape. The release and the digest come from the repository by way of the caller, so the content of the bucket is not trusted. The archive is checked before it is unpacked. The private subnets have no route to the internet, so the operator puts the archive in the bucket and the nodes fetch it through the S3 gateway endpoint.

<<< @/examples/66-distributed-sql/src/machine.ts{configure}

The configure script takes the three addresses and fills in the variables of the flag files that the functions of the earlier section produced. It reads its own zone from instance metadata.

The generated files are in `examples/66-distributed-sql/deploy/` as they are. `vp run distsql:render` fails when a file there differs from what is generated.
