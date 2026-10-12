---
title: "24 Self-hosting: Design and Build"
---

# 24 Self-hosting: Design and Build

The [previous page](/en/chapters/24-celld.md) showed where a celld fleet sits on AWS. This page goes through the reasons for that layout and the code behind it, covering the network, where the state lives, what is on a node, and the cost.

## Peer traffic has no TLS

<!-- section: 24.network -->

The original outline of this book said "peer traffic is protected by a private network and TLS". The TLS part turned out to be impossible. celld has two listeners, and according to the official documentation neither of them terminates TLS.

- The **public listener** (`--listen`) reaches the Worker you deployed. TLS and user authentication are left to a proxy in front or to the application
- The **internal listener** (`--internal-listen`) carries traffic between peers and serves the operator API. Peer traffic is plain HTTP. An HMAC shared by the fleet signs connection setup and control requests, but nothing is encrypted. Most of the operator API also has no authentication, so `POST /shutdown`, which stops a node, and `/state`, which shows its state, can be called by anyone who can connect

Everyone who can reach the internal listener is therefore treated as an administrator. The official instruction is to put it on a trusted private network, or on an encrypted overlay such as WireGuard or Tailscale.

This chapter builds the private network, using a security group.

<<< @/examples/24-celld/infra/lib/celld-stack.ts{network}

There is one inbound rule, and it admits members of the same security group to the internal port. Because the rule names the group and not the VPC CIDR, other instances in the same VPC cannot connect. The public listener has no rule at all. It listens on loopback (`127.0.0.1`), so nothing outside the node could reach it anyway. This setup has no ingress, and you send requests to the Worker from the node itself.

You cannot assume that traffic is encrypted because it stays inside a VPC. According to the EC2 documentation, only some instance types encrypt traffic between instances automatically. M7g and C7g are on that list, and T4g, which this chapter uses, is not. The documentation also says that traffic crossing AZs is encrypted at the physical layer. Whether that is enough depends on the data you send. If it is not, use an instance type from the list or add the overlay celld recommends. This chapter builds neither.

## State lives in the bucket, and you still cannot throw the disks away

<!-- section: 24.state -->

If the long-lived state is in the bucket, the nodes look disposable, and it seems you could delete an instance or a volume at any time.

That is true only under certain conditions. In `fleet` mode, which is celld's default, the node that owns a cell sends each write to one or two other nodes, called followers, and acknowledges it as soon as the followers have written it to disk. The upload to the bucket comes afterwards. The official documentation says outright that a follower's disk can hold acknowledged writes the bucket does not have yet.

That decides when a disk can be discarded and when it cannot.

- If you stop nodes one at a time by the proper procedure, you can discard the disk of the node you stopped, because it hands off its cells and finishes its uploads before it exits
- If you discard the disks of every node at once, you can lose acknowledged writes
- When a node dies suddenly, the remaining nodes collect what it had not uploaded from the followers' disks. If those followers are gone too, there is nothing to collect

For this reason both the buckets and the per-node data volumes are set to be retained.

<<< @/examples/24-celld/infra/lib/celld-stack.ts{buckets}

As in chapter 23, a volume is a separate resource from its instance. When an instance is rebuilt, the volume is reattached and keeps its contents. (The nodes are defined in the `nodes` region of `celld-stack.ts`.) `stateOnDestroy` defaults to `retain`, so the two buckets and the data volumes outlive a destroy of the stack. Leftover volumes keep costing money, and [Cleaning up](/en/chapters/24-celld/wrap.md) explains how to delete them. For practice runs, `-c stateOnDestroy=delete` makes them go away with the stack.

There is probably no reason to use `delete` in production.

Bucket versioning is not enabled. celld deletes objects itself and has its own mechanism for clearing out old generations (epoch GC). Nothing I read says what happens when versioning is added on top of that, so I left it off.

Next come the permissions a node gets.

<<< @/examples/24-celld/infra/lib/celld-stack.ts{role}

The official documentation says that whoever holds the bucket credentials controls the fleet. The deployed application, the cell state, the ownership records, and the secret used to authenticate peers are all in the bucket. The node's permissions are therefore limited to one prefix of one bucket, and a node cannot touch the backup bucket at all.

The official documentation does not list the S3 actions celld needs. For Azure it says "read, write, list, delete", so I mapped that to S3 actions and added `s3:AbortMultipartUpload` after seeing that the source uses multipart uploads. If something is missing, an AccessDenied error should appear in the node's log.

## Inside a node

<!-- section: 24.node -->

The machine is prepared the same way as in chapter 23. User data creates the account, the directories, and the systemd unit, and mounts the data volume. It does not install celld.

The unit writes down exactly what celld asks of its supervisor.

<<< @/examples/24-celld/deploy/celld.service

It differs from the unit in chapter 23 in three places.

The first is `Restart=always` with `StartLimitIntervalSec=0`. A celld node that can no longer renew its lease in the bucket, which is its record of being alive, stops itself. It logs a line beginning with `SELF-FENCE:` and exits with code 3, and only a restart brings it back. The official documentation therefore asks the supervisor to restart without a limit on the number of attempts, and to wait at least one lease lifetime (10 seconds by default) before each start. Chapter 23 gave up after five crashes. This unit does the opposite and restarts every time.

The second, `RestartSec=15`, is that wait of at least one lease lifetime.

The third is `TimeoutStopSec=60`. When celld receives SIGTERM, it hands the cells it owns to other nodes before it exits, and by default it allows up to 40 seconds for that. If systemd sends SIGKILL sooner, the handoff is cut short.

If you set `RestartSec` or `TimeoutStopSec` to a value that does not meet celld's requirement, generating the unit fails.

<<< @/examples/24-celld/src/machine.ts{spec}

This is the script that installs celld.

<<< @/examples/24-celld/deploy/celld-install.sh

Nodes in a private subnet cannot reach the internet, so the archive comes from S3. You download and verify it with `celld:fetch`, and `celld:artifacts` puts it in the bucket. The digest is not read from the bucket. It is the value pinned in the repository, passed as an argument, so someone who can rewrite the contents of the bucket still cannot rewrite the digest the archive is checked against.

celld is configured through environment variables, not flags. All the names come from the official documentation. The one that matters most is `CELLD_WATCH`. Without it celld works in a temporary directory, and the writes it holds as a follower end up somewhere a restart erases. Here it points at the data volume.

`CELLD_ADVERTISE` is the node's address as the other nodes see it. The script reads the instance's private IP through IMDSv2 and writes it in.

`CELLD_NODE`, the node's session ID, is not set. The documentation did not make clear whether it may be fixed, so it is left at the default, which generates a new one on every start.

The script neither starts nor restarts the service. When a node stops and starts is decided step by step on the [Deploy](/en/chapters/24-celld/deploy.md) page.

## Cost

<!-- section: 24.cost -->

The breakdown follows. Every amount is the list price in ap-northeast-1, in USD, for a 730-hour month.

- One `t4g.small` instance is USD 15.77
- The gp3 volumes are 16 GiB per node, USD 1.54 (the 8 GiB root volume is an assumption, and the real size has not been checked)
- S3 requests are about USD 3.93 per node, which is an estimate
- The interface endpoints added to the chapter 11 stack are USD 61.32

That adds up to USD 82.56 for one node and USD 125.03 for three. As in chapter 23, the endpoints cost the most, and with one node they are more than 70 percent of the total. Without the endpoints it is USD 21.24 for one node and USD 63.71 for three.

The S3 request figure is an estimate because a celld node keeps talking to the bucket even when it has nothing to do. The documented intervals are a lease renewal every third of a lifetime (a write about every 3.3 seconds), a read of the fleet's load every 5 seconds, and a check for deployments every 30 seconds. Over a month that comes to about 790,000 writes and about 610,000 reads. These counts are a lower bound calculated from the documented numbers, not a measurement. Active cells add to them, and storage for the objects that pile up in the bucket is charged separately.

<<< @/examples/24-celld/src/cost.ts{billable}

With all three instances stopped, the volumes and the endpoints still cost USD 65.93. After the stack is destroyed with the defaults, the three remaining data volumes cost USD 2.30 a month.

As for the instance type, the celld documentation gives only a rule of thumb, that one 8 GB node can hold 1,000 cells in memory, and no minimum requirement. Whether a 2 GiB `t4g.small` is enough has not been checked.
