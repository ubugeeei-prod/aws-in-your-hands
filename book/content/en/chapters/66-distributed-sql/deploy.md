---
title: "66 Distributed SQL: Deploy"
---

# 66 Distributed SQL: Deploy

The [previous page](/en/chapters/66-distributed-sql/local.md) ran the cluster locally. This page is the procedure for putting the same thing on three EC2 instances, and for operating it afterwards. **Nothing on this page was ever run.** The tasks and scripts exist and the commands they build are pinned by tests, but that they work on AWS was not confirmed. If you run them, go on to the [cleanup](/en/chapters/66-distributed-sql/wrap.md) the same day.

## Bring up three nodes

<!-- section: 66.deploy -->

First deploy chapter 11's network with three zones. If it is already deployed with two, this is a change that adds subnets. Add three interface endpoints as well, so that Session Manager and Run Command reach the private subnets.

```bash
vp run net:infra:deploy -c availabilityZones=ap-northeast-1a,ap-northeast-1c,ap-northeast-1d -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run distsql:infra:diff -c nodes=3
vp run distsql:infra:deploy -c nodes=3
vp run distsql:status
```

`distsql:status` shows, for each of the three, whether cloud-init finished, whether the data volume is mounted, whether YugabyteDB is installed, whether the two services run, and where the clock points and how far off it is. At this point no database is installed.

Next, download the archive for the nodes, put it in the bucket, and install it on the three.

```bash
vp run distsql:fetch --nodes
vp run distsql:artifact
vp run distsql:install
```

`distsql:install` hands each node's install script the bucket name and the version and SHA-256 pinned in the repository. The node fetches the archive and unpacks it only when the digest matches.

Then hand out certificates, write the flag files, and start.

```bash
vp run distsql:certs
vp run distsql:configure
vp run distsql:start
vp run distsql:health
```

`distsql:certs` creates a certificate authority in `.yugabyte/ca-aws/` on your machine (or uses the one there), takes a signing request from each node, signs it, and returns the certificate. `distsql:configure` looks up the three private addresses and gives them to each node. `distsql:start` starts `yb-master` on the three nodes first, then `yb-tserver` on the three. A `yb-tserver` registers with the `yb-master`s as it starts, hence the order.

<<< @/examples/66-distributed-sql/src/remote.ts{commands}

`distsql:health` reads `/api/v1/health-check` of `yb-master` from the node itself and checks that there is no dead node and no tablet short of a copy. The shape of that answer is what the local cluster showed.

<<< @/examples/66-distributed-sql/src/remote.ts{health}

Once it is running, do two things first. Both are done interactively in a shell on a node, so that no password travels as an argument of Run Command. `vp run distsql:session a` opens the shell (it needs the Session Manager plugin, which the devShell does not include).

The first is to state replica placement by zone. Replace `<a>`, `<b>`, and `<c>` with the three private addresses.

```bash
sudo -u yugabyte /var/lib/yugabyte/current/bin/yb-admin \
  --master_addresses <a>:7100,<b>:7100,<c>:7100 --certs_dir_name /etc/yugabyte/certs \
  modify_placement_info aws.ap-northeast-1.ap-northeast-1a,aws.ap-northeast-1.ap-northeast-1c,aws.ap-northeast-1.ap-northeast-1d 3
```

While three nodes sit in three zones, each gets one copy without this. The setting is there so that, when nodes are added, two copies are not placed in one zone. The form of the command was confirmed from the usage text of the pinned `yb-admin` and by running it on the local cluster.

The second is to change the administrator's password. A cluster on which authentication was just turned on has the default user and password given in the documentation (both `yugabyte`).

```bash
sudo -u yugabyte /var/lib/yugabyte/current/bin/ysqlsh \
  "host=<a> port=5433 dbname=yugabyte user=yugabyte sslmode=verify-ca sslrootcert=/etc/yugabyte/certs/ca.crt"
```

```sql
ALTER ROLE yugabyte WITH PASSWORD '<new password>';
CREATE ROLE notes_api LOGIN PASSWORD '<another password>';
```

Give the application a role of its own, not the administrator. Keep the password in Secrets Manager, as in [chapter 21](/en/chapters/21-security.md). With Aurora DSQL an IAM token took the place of a password. With a database you run, storing and rotating passwords is your work too.

This chapter does not build the part that connects an application. To connect one, put the Lambda function or ECS task in the client security group (the stack output `ClientSecurityGroupId`), and give `openYugabyte` the three addresses, the certificate of the authority (`ca.crt`), and the role's password. Migrations use chapter 13's runner with the `postgres` dialect. On the local cluster this combination worked.

## Keep it running

<!-- section: 66.operate -->

From here on is work that Aurora DSQL's price included. All of it is the procedure of YugabyteDB's documentation rewritten for this chapter's layout, and none of it was run, locally or on AWS.

### One rule for every task

Only one node may be stopped at a time. Before stopping one, always check that `vp run distsql:health` answers "fully replicated". Stopping another node while a tablet is short of a copy takes that tablet's majority away.

```bash
vp run distsql:health
vp run distsql:stop b
vp run distsql:start b
vp run distsql:health
```

`distsql:stop` does nothing unless one node is named.

### Upgrading

The documented procedure is a rolling upgrade. The new version is installed in a directory apart from the current one, `yb-master` is restarted one node at a time, then `yb-tserver` one node at a time. Leave at least 60 seconds between nodes. When everything runs the new version, finalize with `yb-admin promote_auto_flags` and `yb-admin upgrade_ysql`. Until then you can go back to the old version; after, you cannot. The documentation recommends watching for no more than two days before finalizing.

In this chapter's layout, change the version and the digest in `src/yugabyte.ts` and run `distsql:fetch --nodes`, `distsql:artifact`, and `distsql:install`: the new version lands in a directory of its own on each node and `current` points at it. The install script restarts no service, so the restarts that follow, one node at a time, are yours to carry out under the rule above. The version travels as an argument of the script, so changing it changes no user data, and a deploy of the stack replaces no instance.

An upgrade across PostgreSQL versions (from v2024.2, based on PostgreSQL 11, to a version based on 15) is a separate task with extra steps. This chapter starts at v2025.2, so it does not arise for now.

### Bringing back a node that stopped

If only the instance stopped and the volume is intact, starting it again is enough. systemd starts the two processes, the node returns at the same address, and it receives from the leaders what was written while it was away (this assumes the private address does not change when an instance is stopped and started, which this chapter did not check). Starting a node again after SIGKILL on the local cluster was this case.

If the instance or the volume is lost, it is another task: adding a new node and removing the old one. YugabyteDB tells nodes apart by address, so a new instance is a different node even under the same name. The documented steps are these.

- `yb-tserver`: start a new `yb-tserver` in the same zone. Mark the old one for removal with `yb-admin change_blacklist ADD <old>:9100`, wait until `get_load_move_completion` reaches 100, then clear the mark with `change_blacklist REMOVE`
- `yb-master`: start a new `yb-master` with `--master_addresses` empty. If the old one is already dead, run `change_master_config REMOVE_SERVER <old> 7100` and then `ADD_SERVER <new> 7100`, in that order. Afterwards rewrite `--master_addresses` and `--tserver_master_addrs` on every node to the new three

This chapter's scripts do not automate this. `yb-configure` can write flag files only for three nodes that were there from the start. A new node also needs a certificate for its new address. Having gone through all of this once on your own cluster is the least drill to do before production.

In a cluster of only three, there are two copies for as long as one node is lost. Lose another in that time and it stops answering. This is the reason to have more than three in production.

### Backups

The thinking of chapter 22 holds here as well. Only what you have restored is a backup.

The simplest way is to write the data out as SQL. In a shell on a node:

```bash
sudo -u yugabyte /var/lib/yugabyte/current/postgres/bin/ysql_dump \
  "host=<a> port=5433 dbname=yugabyte user=yugabyte sslmode=verify-ca sslrootcert=/etc/yugabyte/certs/ca.crt" \
  | gzip | aws s3 cp - "s3://<bucket>/backups/$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

The dump, and feeding it into another database, worked on the local cluster. Sending it to S3 was not run. This way takes longer as data grows, and what can be restored is the moment of the dump and nothing else.

YugabyteDB also has distributed snapshots. `yb-admin create_database_snapshot` makes a cut at the same moment across all nodes. But a snapshot is hard links on the cluster's own volumes, and is no help when a disk or a file system fails. Getting one off the cluster means taking the schema with `ysql_dump`, the metadata with `export_snapshot`, and copying the snapshot directories of every tablet by hand. The documentation leaves the automation of this to YugabyteDB Anywhere. `yugabyted` has a backup to S3 too, on condition that the nodes were started by `yugabyted` and that YB Controller is installed, so it does not fit this chapter's layout.

EBS snapshots of three running nodes, taken separately, are not of the same moment. Whether they make a backup that can be restored is not stated in the documentation that was read. This chapter does not rely on them.

### What to watch

`yb-master` (7000), `yb-tserver` (9000), and YSQL (13000) each serve metrics at `/prometheus-metrics`. On the local nodes these included `hybrid_clock_skew`, the clock skew, and `is_raft_leader`, whether a node leads each tablet. The least to watch is the following.

- Tablets short of a copy, and dead nodes (`distsql:health`)
- Clock offset, and what chrony refers to (`distsql:status`)
- Free space on the data volume. YugabyteDB's documentation recommends about 20% headroom
- Whether the two services keep restarting (`distsql:logs`)
- When the certificates expire

This chapter does not build the part that sends these to CloudWatch. To put them on the alarms of [chapter 19](/en/chapters/19-observability.md), add something on the nodes that reads the metrics and sends them.
