---
title: "66 Distributed SQL: Costs, Pitfalls, and Cleanup"
---

# 66 Distributed SQL: Costs, Pitfalls, and Cleanup

This page covers what the three-node cluster costs and how that compares with renting, how to investigate when it does not work, what to add for production, and how to clean up. The verification notes for the chapter are at the end.

## Costs

<!-- section: 66.cost -->

All amounts are list prices in ap-northeast-1, in USD, for a month of 730 hours. Three nodes left running without a single query break down as follows.

- Three `t4g.medium` instances: USD 94.61
- gp3 volumes, 84 GiB for the three nodes: USD 8.06 (the 8 GiB root volume is assumed and its real size was not checked; data is 20 GiB per node)
- The interface endpoints added to chapter 11's stack, three of them in three zones: USD 91.98
- The archive kept in the bucket: USD 0.01

The total is USD 194.66, and nearly half of it is the endpoints that let Session Manager reach the private subnets. Without the endpoints it is USD 102.67. The default configuration (no nodes) costs the USD 0.01 of the archive in the bucket.

<<< @/examples/66-distributed-sql/src/cost.ts{fixed}

`t4g.medium` is a choice for practice. With `m7g.large`, the smallest of the M family that YugabyteDB's documentation recommends on AWS, the amount without endpoints is USD 238.89. What the documentation names for YSQL in production is 16 or more cores and 64 GB or more, and at that size the figure changes by an order of magnitude.

### Transfer between zones

There is one more charge that a managed database kept out of sight: transfer between zones, for replication. Transfer between zones of one Region is USD 0.01 per GB, and according to AWS's documentation it is metered at both the sending and the receiving end. A tablet leader sends each write to two followers in other zones, so each byte written is counted four times.

<<< @/examples/66-distributed-sql/src/cost.ts{transfer}

Assuming 10 writes a second, each carrying 2,000 bytes, 210.24 GB is metered in a month, for USD 2.10. At this load it is within the noise, but it grows with the writes: at 1,000 a second it is USD 210.24, more than the instances.

This figure is a lower bound and not a measurement. The 2,000 bytes per write are an assumption. Heartbeats, transaction status records, reads passed to a leader in another zone, and traffic between clients and nodes are not included. The real value can only be read from `NetworkOut` in CloudWatch and `DataTransfer-Regional-Bytes` on the bill of a cluster that ran.

### Compared with renting

Take the same load: 10 writes and 90 reads a second, with 10 GB of data.

| | A month | Premise |
| --- | --- | --- |
| This chapter's three nodes | USD 196.77 | Whether `t4g.medium` carries this load was not measured |
| Aurora DSQL | USD 68.65 | DPUs per statement are chapter 13's assumptions (0.00675 for a read, 0.18525 for a write). Not measured |
| Aurora Serverless v2 | from USD 55.95 | The floor if it stays at 0.5 ACU. I/O charges are not included |

<<< @/examples/66-distributed-sql/src/cost.ts{managed}

All three figures stand on assumptions. Something can be said even so. Running it yourself starts at USD 194.66 with no load at all, and hardly changes as load grows until you add machines. Aurora DSQL costs only storage with no load and grows with the load. At four times the load of this table the DSQL estimate is USD 262.60, above this chapter's three nodes (USD 203.07 with transfer). Whether three `t4g.medium` carry that load is a separate question, and it was not measured. And no row includes the time of the people who operate it.

After the stack is destroyed, the three data volumes remain by default and cost USD 5.76 a month.

## Pitfalls

<!-- section: 66.pitfalls -->

What this section says happens on AWS is expected from the documentation and from the local cluster. None of it was seen on a real machine. To investigate, run the tasks in this order.

```bash
vp run distsql:status
vp run distsql:logs a
vp run distsql:health
```

- **`distsql:status` returns nothing.** The nodes do not reach Systems Manager. Check that chapter 11's network was deployed with the three endpoints and with three zones
- **A service stays `inactive`.** A unit quietly skips starting when the binaries or the flag file are missing. See whether `distsql:install` and `distsql:configure` were run
- **`yb-tserver` exits right after starting.** Read the log. If certificates are not found, see whether `distsql:certs` was run and whether the certificate file names match the node's address. Locally it exited when `initdb` failed in an environment without shared memory
- **A node stops out of nowhere.** A process stops itself when clock skew exceeds `max_clock_skew_usec`. Look at the chrony lines of `distsql:status`. systemd starts it again after 5 seconds, over and over until the clock is right
- **`yb-admin` times out without finding the leader.** A cluster with TLS needs `--certs_dir_name`. Locally it waited 60 seconds and failed without it
- **`SHOW transaction_isolation` answers `read committed`.** In a cluster you started yourself, what is in effect is Snapshot. Check with `SHOW yb_effective_transaction_isolation_level`
- **Retries run out (`RetriesExhaustedError`).** Too many writes are meeting on one row. Chapter 13's limit is four attempts. Locally they never ran out, but in one run twelve simultaneous creates needed 29 restarts
- **One statement fails right after a majority returns.** Locally, the `CREATE DATABASE` right after two nodes were started again failed with `current transaction is expired or aborted`. After a short wait it went through
- **`distsql:health` answers "NOT fully replicated".** A tablet is short of a copy. Do not stop another node in this state. Bring back the node that is down first

## For production

<!-- section: 66.production -->

The first decision is whether to run it yourself at all. If none of the circumstances on the [first page](/en/chapters/66-distributed-sql.md) applies, rent. If you have decided to run it, this is what the chapter's layout lacks.

- **Machines.** Use the M family the documentation recommends, with gp3 data volumes of 250 GB or more. Mounting data drives with `noatime` is recommended, and chapter 23's script, which this chapter reuses, mounts with `defaults`
- **Number of nodes.** Three leave no margin while one is lost. Have a fourth and more for new copies to go to. The documentation's example has six, two per zone
- **A drill for replacing a node.** Turn the steps under "Bringing back a node that stopped" on the [deploy page](/en/chapters/66-distributed-sql/deploy.md) into a script and go through them for real
- **Backups.** Test all the way to a restore, regularly. When `ysql_dump` no longer suffices, you will either build what moves snapshots off the cluster or consider the commercial license of YugabyteDB Anywhere. Turn on versioning for the bucket
- **Certificates and the authority.** Keep the authority's private key somewhere that is not an operator's machine. Drill replacing certificates before they expire
- **Passwords.** Change the default administrator password, give the application a role of its own, and keep and rotate its password in Secrets Manager
- **Connections.** This chapter's client opens and closes a connection for each unit of work. In production, pool connections, and in place of a fixed list of nodes consider the dedicated driver or a load balancer in front
- **Monitoring.** Turn "What to watch" on the [deploy page](/en/chapters/66-distributed-sql/deploy.md) into alarms
- **Keeping up with versions.** Read the release notes and keep applying patches within the long-term support series. When to move to the next series is yours to decide as well
- **OS patches.** As in chapter 23. Restart nodes one at a time, with `distsql:health` in between
- **More than one Region.** This chapter is three zones of one Region. A layout that keeps running when a Region is lost needs, on top of the thinking in [chapter 28](/en/chapters/28-multi-region.md), an estimate of replication latency and transfer cost across Regions. This chapter does not cover it

## Cleanup

<!-- section: 66.cleanup -->

Stop and delete the local cluster with this task.

```bash
vp run distsql:local:destroy
```

The downloaded archive, the binaries, and the local certificate authority stay in `examples/66-distributed-sql/.yugabyte/`. Delete the directory if you do not need them.

What was created in AWS is removed in this order.

```bash
vp run distsql:infra:destroy
vp run net:infra:destroy
```

With the default `stateOnDestroy=retain` the instances go, and the bucket and the three data volumes stay. The setting is there so that the content of a database is not deleted by oversight. When practice is over, delete them yourself.

```bash
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=tag:Name,Values='AihDistSql/*'
aws ec2 delete-volume --region ap-northeast-1 --volume-id <volume-id>
aws s3 rm s3://<bucket>/ --recursive --dryrun
```

The remaining volumes can be found by their Name tag. For the bucket, drop `--dryrun` to empty it, then remove it with `aws s3 rb`. If you created the stack with `-c stateOnDestroy=delete` from the start, empty the bucket before the destroy. According to chapter 24's verification notes, the pinned cdkd does not delete a bucket that is not empty.

If you forget `net:infra:destroy`, the endpoints go on costing USD 91.98 a month. To keep the VPC, run `vp run net:infra:deploy` without any `-c`: that is a change which removes the endpoints and returns to the default two zones. It should fail while anything still uses the subnets of the third zone, so destroy this chapter's stack first.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (7 files, 73 tests: flag file generation and validation, failover between nodes, every loss of one node and the loss of two against the model of the majority, the write that asynchronous replication loses, YugabyteDB's errors injected into chapter 13's retry loop on PGlite, the files a node gets matching `deploy/`, the install script refusing malformed arguments when run with bash, certificate arguments, pricing, and the stack assertions). The type check. `distsql:infra:synth` (default settings, and `-c nodes=3`) and `distsql:render`.

YugabyteDB 2025.2.7.0-b107 ran for real on macOS 26.6 (Apple silicon). `distsql:fetch` downloaded the archive (130,180,590 bytes) from `software.yugabyte.com`, and its SHA-256 matched the value in the `.sha` file the vendor publishes next to it. `distsql:local:start` started three pairs of `yb-master` and `yb-tserver` on `127.0.0.1`, and `distsql:local:verify` ran twice without TLS and five times with it. The script was corrected along the way, so the seven runs are not identical (the backup block is there from the second run, and its retry from the sixth). This is what was seen. Chapter 13's four migrations and its repository ran unchanged. Twelve simultaneous creates against a quota of 3 created 3 every time, with 4 to 29 retries after `40001` and no transaction giving up after four attempts. After SIGKILL of node b, a and c returned all 40 acknowledged notes, the next 20 creates finished in 0.9 to 4.3 seconds, and no error reached the caller. With b and c down, the one node left acknowledged no write (a timeout while connecting, or no answer for 20 seconds). With them back, all 40 acknowledged notes were there every time, and the one unacknowledged write was there in three runs of seven. The output of `ysql_dump` fed into another database held the acknowledged notes (five times). In one run with TLS, the `CREATE DATABASE` right after the two nodes returned failed with `current transaction is expired or aborted`, and that run of the verification ended in failure. The two runs after the retry was added passed. On the cluster with TLS, a client without TLS was refused, and `yb-admin` answered `list_all_masters` and `modify_placement_info` with `--certs_dir_name` and gave up after 60 seconds without finding the leader when it was left out. The administrative web interfaces answered plain HTTP even with TLS on. After the verification, `distsql:local:destroy` stopped every process, and it was checked that none remained.

The names and defaults of the `yb-tserver` and `yb-master` flags (`enable_wait_queues`, `yb_enable_read_committed_isolation`, `max_clock_skew_usec`, `follower_unavailable_considered_failed_sec`, `raft_heartbeat_interval_ms`, `replication_factor`, and others) were read from `--helpfull` of the pinned binary.

**Not checked yet.** Nothing was run against AWS: `distsql:infra:diff`, `distsql:infra:deploy`, `distsql:infra:destroy`, and every task that touches the nodes, from `distsql:status` to `distsql:session`. The archive for the nodes (el8-aarch64) was not downloaded and the Linux binary was never run. So the following was only read, or is a guess. That YugabyteDB runs on Amazon Linux 2023 (arm64) on a `t4g.medium`. That `post_install.sh` succeeds. That the user data, the five scripts, and the two units work on a real machine (their shell syntax was checked with `bash -n`). What chrony refers to by default on Amazon Linux 2023. That the role's permissions suffice. That the interface endpoints and the S3 gateway endpoint reach everything the installation needs. That a node returns at the same address after its instance is stopped and started.

Not run locally either: the rolling upgrade, the replacement of a dead node (`change_master_config`, `change_blacklist`), distributed snapshots, and `yugabyted`. No deadlock (`40P01`) was produced. Clock skew, a network partition, and a disk failure cannot be reproduced on one machine. The transfer between zones and the load a `t4g.medium` carries were not measured.

Not confirmed from a primary source. The documentation's "Start YB-TServers" page could not be read: the fetching tool returned another page's content. The `yb-tserver` flags and `modify_placement_info` rest on what the binary prints and on the fact that they worked locally. No procedure for replacing certificates on a manually deployed cluster was found. Whether EBS snapshots of running nodes serve as a backup was not stated either. The shape of the answer of `yb-master`'s `/api/v1/health-check` is what was seen locally and was not confirmed in the documentation. CockroachDB and TiDB were only read about, license and documentation, and were not run. What is said about Aurora DSQL comes from chapter 13's records and was not read again for this chapter.

Changed from what was asked. The task that downloads the binary is defined with `fresh`, as asked (chapter 24's `celld:fetch` is `live`). The tasks that make certificates use the `openssl` on PATH. The Nix devShell does not provide one, and Homebrew's OpenSSL 3.6.1 was used in this work. For backups the stack provides the bucket prefix and the permissions and the page gives the procedure, and there is no task.

Resource types and cdkd. This stack uses the same ten resource types as chapter 24's stack and properties within the same range. How the pinned version (0.296.28) handles each (`AWS::EC2::Volume` and `AWS::EC2::VolumeAttachment` go through the Cloud Control API) is in chapter 24's verification notes and was not read again here.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Which database | `examples/66-distributed-sql/src/yugabyte.ts` | `distsql:fetch` |
| The whole picture | `examples/66-distributed-sql/infra/lib/distsql-stack.ts` | `distsql:infra:synth` |
| How a write reaches three places | `examples/66-distributed-sql/src/yugabyte.ts`, `test/repository.test.ts` | `vp test run examples/66-distributed-sql` |
| One definition for the whole cluster | `examples/66-distributed-sql/src/topology.ts`, `test/topology.test.ts` | `distsql:render` |
| Chapter 13's code, connected as it is | `examples/66-distributed-sql/src/yugabyte-db.ts`, `src/failover.ts`, `test/failover.test.ts` | `distsql:local:verify` |
| A model of the majority | `examples/66-distributed-sql/src/model/quorum.ts`, `test/quorum.test.ts` | `vp test run examples/66-distributed-sql` |
| Certificates, without moving a key | `examples/66-distributed-sql/src/certs.ts`, `scripts/certs.ts`, `scripts/nodes.ts` | `distsql:local:certs`, `distsql:certs` |
| The stack | `examples/66-distributed-sql/infra/lib/distsql-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `infra/test/distsql-stack.test.ts` | `distsql:infra:synth` |
| What is on a node | `examples/66-distributed-sql/src/machine.ts`, `deploy/`, `scripts/render.ts`, `test/machine.test.ts` | `distsql:render` |
| Fetch the binary | `examples/66-distributed-sql/scripts/fetch.ts` | `distsql:fetch` |
| Start three nodes | `examples/66-distributed-sql/scripts/cluster.ts`, `scripts/local-nodes.ts` | `distsql:local:start`, `distsql:local:status`, `distsql:local:kill`, `distsql:local:stop`, `distsql:local:destroy` |
| Kill nodes and look | `examples/66-distributed-sql/scripts/verify.ts` | `distsql:local:verify` |
| Bring up three nodes | `examples/66-distributed-sql/scripts/nodes.ts`, `src/remote.ts` | `distsql:infra:deploy`, `distsql:artifact`, `distsql:install`, `distsql:certs`, `distsql:configure`, `distsql:start`, `distsql:status`, `distsql:health`, `distsql:session` |
| Keep it running | `examples/66-distributed-sql/scripts/nodes.ts`, `src/remote.ts` | `distsql:stop`, `distsql:health`, `distsql:logs` |
| Costs | `examples/66-distributed-sql/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `vp test run examples/66-distributed-sql` |
| Cleanup | `examples/66-distributed-sql/infra/lib/distsql-stack.ts` | `distsql:infra:destroy`, `distsql:local:destroy` |

**Primary sources** (all checked on 2026-10-13)

- Licenses: [LICENSE.md of yugabyte-db](https://raw.githubusercontent.com/yugabyte/yugabyte-db/master/LICENSE.md), [LICENSE of cockroach](https://raw.githubusercontent.com/cockroachdb/cockroach/master/LICENSE), [CockroachDB Licensing FAQs](https://docs.cockroachlabs.com/docs/stable/licensing-faqs), [LICENSE of tidb](https://raw.githubusercontent.com/pingcap/tidb/master/LICENSE)
- CockroachDB and TiDB: [Production Checklist](https://docs.cockroachlabs.com/docs/stable/recommended-production-settings), [PostgreSQL Compatibility](https://docs.cockroachlabs.com/docs/stable/postgresql-compatibility), [TiDB Overview](https://docs.pingcap.com/tidb/stable/overview/), [TiDB hardware recommendations](https://docs.pingcap.com/tidb/stable/hardware-and-software-requirements/)
- YugabyteDB, distribution: [Releases](https://docs.yugabyte.com/stable/releases/), [v2025.2 release notes](https://docs.yugabyte.com/stable/releases/ybdb-releases/v2025.2/), [Quick start (macOS)](https://docs.yugabyte.com/stable/quick-start/macos/), the `.sha` of each archive under `software.yugabyte.com/releases/2025.2.7.0/`, and `--version` and `--helpfull` of the downloaded archive
- YugabyteDB, how it works: [Replication](https://docs.yugabyte.com/stable/architecture/docdb-replication/replication/), [Sharding](https://docs.yugabyte.com/stable/architecture/docdb-sharding/sharding/), [YB-Master](https://docs.yugabyte.com/stable/architecture/yb-master/), [Transactions overview](https://docs.yugabyte.com/stable/architecture/transactions/transactions-overview/), [Isolation levels](https://docs.yugabyte.com/stable/architecture/transactions/isolation-levels/), [Concurrency control](https://docs.yugabyte.com/stable/architecture/transactions/concurrency-control/), [Transaction retries](https://docs.yugabyte.com/stable/develop/learn/transactions/transactions-retries-ysql/), [node-postgres smart driver](https://docs.yugabyte.com/stable/drivers-orms/nodejs/yugabyte-node-driver/)
- YugabyteDB, deployment and operations: [Start YB-Masters](https://docs.yugabyte.com/stable/deploy/manual-deployment/start-masters/), [System configuration](https://docs.yugabyte.com/stable/deploy/manual-deployment/system-config/), [Deployment checklist](https://docs.yugabyte.com/stable/deploy/checklist/), [Operating system support](https://docs.yugabyte.com/stable/reference/configuration/operating-systems/), [Create server certificates](https://docs.yugabyte.com/stable/secure/tls-encryption/server-certificates/), [Server-to-server encryption](https://docs.yugabyte.com/stable/secure/tls-encryption/server-to-server/), [yugabyted](https://docs.yugabyte.com/stable/reference/configuration/yugabyted/), [yb-admin](https://docs.yugabyte.com/stable/admin/yb-admin/), [Upgrade](https://docs.yugabyte.com/stable/manage/upgrade-deployment/), [Change cluster configuration](https://docs.yugabyte.com/stable/manage/change-cluster-config/), [Replace a failed YB-Master](https://docs.yugabyte.com/stable/troubleshoot/cluster/replace_master/), [Replace a failed YB-TServer](https://docs.yugabyte.com/stable/troubleshoot/cluster/replace_tserver/), [Backup and restore](https://docs.yugabyte.com/stable/manage/backup-restore/), [Distributed snapshots](https://docs.yugabyte.com/stable/manage/backup-restore/snapshot-ysql/), [Metrics](https://docs.yugabyte.com/stable/launch-and-manage/monitor-and-alert/metrics/)
- AWS: [AWS Price List (AWSDataTransfer, ap-northeast-1)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json), [Understanding data transfer charges](https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html), [Precision clock and time synchronization](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html), [T4g instances](https://aws.amazon.com/ec2/instance-types/t4/). The unit prices for EC2, EBS, endpoints, S3, Aurora DSQL, and Aurora are the ones earlier chapters recorded from the AWS Price List (checked between 2026-10-11 and 2026-10-13) and were not read again for this chapter
- Cloudflare and Vercel: [Cloudflare D1](https://developers.cloudflare.com/d1/), [Vercel Storage overview](https://vercel.com/docs/storage)

:::
