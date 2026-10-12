---
title: "24 Self-hosting: Design and Build"
---

# 24 Self-hosting: Design and Build

## Peer traffic has no TLS

<!-- section: 24.network -->

The outline for this book originally said "peer traffic is protected by a private network and TLS". Once I read the documentation, the second half fell away. celld does not terminate TLS. In the official wording, it opens two listeners and terminates TLS on neither.

- The **public listener** (`--listen`) reaches the Worker you deployed. TLS and user authentication are the job of a proxy in front, or of the application
- The **internal listener** (`--internal-listen`) carries peer traffic and an operator API. Peer traffic is plaintext HTTP. An HMAC shared by the fleet signs connection setup and control requests, but it does not encrypt. And most of the operator API has no authentication: not `POST /shutdown`, which stops a node, and not `/state`, which shows its state

So on the internal listener, everyone who can connect is an administrator. The official instruction is to put it on a trusted private network or on an encrypted overlay such as WireGuard or Tailscale.

This chapter builds the first of those with a security group.

<<< @/examples/24-celld/infra/lib/celld-stack.ts{network}

One inbound rule. The internal port is reachable from members of the same security group, and from nobody else. The source is the group, not the VPC's CIDR, so another instance in the same VPC cannot connect. The public listener gets no rule at all. It listens on loopback (`127.0.0.1`) anyway, so nothing outside the node can reach it. This lab has no ingress; requests to the Worker are made from on the node.

"It is inside a VPC, so it is encrypted" is more than you can say. According to the EC2 documentation, only some instance types automatically encrypt traffic between instances, and while that list has M7g and C7g, it does not have the T4g this chapter uses. The same page says traffic between Availability Zones is encrypted at the physical layer. Whether that is enough depends on the data. If it is not, use an instance type on the list, or add the overlay celld recommends. This chapter builds neither.

## State lives in the bucket, and you still cannot throw the disks away

<!-- section: 24.state -->

"The long-term state is in the bucket" makes the nodes sound disposable, doesn't it? Instances, volumes, delete them whenever you like.

That is half right. In celld's default mode, called `fleet`, the owning node sends each write to one or two other nodes (followers) and answers as soon as they have it on disk. The upload to the bucket comes afterwards. The documentation says it outright: a follower disk can hold acknowledged writes that the bucket does not yet hold.

Which leads to this.

- Stop nodes one at a time, the proper way, and that node's disk can go (it hands off and uploads before it stops)
- Throw away every node's disk at once, and you can lose acknowledged writes
- When a node dies suddenly, the others collect what it had not uploaded from the followers' disks. If the follower is gone too, there is nothing to collect

So both the bucket and each node's data volume are set to stay.

<<< @/examples/24-celld/infra/lib/celld-stack.ts{buckets}

As in chapter 23, the volume is a resource of its own, separate from the instance. Rebuild the instance and the volume is only reattached; what is on it stays (the nodes are defined in the `nodes` region of `celld-stack.ts`). `stateOnDestroy` defaults to `retain`: destroy the stack, and the two buckets and the data volumes remain. Volumes that remain keep costing money, so "Cleaning up" shows how to delete them. For practice only, `-c stateOnDestroy=delete` makes them go with the stack.

In production there is probably no reason to choose `delete`.

Bucket versioning is left off. celld deletes objects itself and has its own mechanism for clearing out old generations (epoch GC). Nothing I read says what happens with versioning layered on top, so I did not add it.

Now the node's permissions.

<<< @/examples/24-celld/infra/lib/celld-stack.ts{role}

The documentation says that whoever holds the bucket credentials controls the fleet. Deployments, cell state, ownership records, the secret used to authenticate peers: all of it is in the bucket. So the permissions are narrowed to one prefix of one bucket. A node cannot touch the backup bucket at all.

One caveat. The documentation has no list of the S3 actions celld needs. For Azure it says "read, write, list, and delete", so I translated that into S3 actions, and added `s3:AbortMultipartUpload` after seeing that the source uses multipart uploads. If something is missing, the node's log should show AccessDenied.

## Inside a node

<!-- section: 24.node -->

Preparing the machine follows chapter 23. User data creates an account, the directories, and the unit, and mounts the data volume. It does not install celld.

The unit is celld's requirements written down.

<<< @/examples/24-celld/deploy/celld.service

Three things differ from the unit in chapter 23.

`Restart=always` and `StartLimitIntervalSec=0`. A celld node that can no longer renew its lease (its record of being alive) in the bucket stops itself. It logs a line starting with `SELF-FENCE:` and exits with code 3. A node in that state only comes back through a restart. So the documentation asks two things of the supervisor: restart without a limit on attempts, and wait at least one lease lifetime (10 seconds by default) before the next start. Chapter 23 gave up after five crashes. Here it is the opposite.

`RestartSec=15`. That is the "at least one lease lifetime".

`TimeoutStopSec=60`. On SIGTERM, celld hands the cells it serves to other nodes before it exits. The bound on that is 40 seconds by default. If systemd sends SIGKILL sooner, the handoff is cut short.

Get either number wrong in the settings, and generation stops right there.

<<< @/examples/24-celld/src/machine.ts{spec}

Here is the script that installs celld.

<<< @/examples/24-celld/deploy/celld-install.sh

Nodes in a private subnet cannot reach the internet, so the archive comes from S3 (the one you fetched and checked with `celld:fetch`, put into the bucket by `celld:artifacts`). The digest is not read from the bucket; the value pinned in the repository is passed as an argument. Someone who can rewrite the bucket still cannot rewrite the digest.

Settings go in as environment variables rather than flags. Each name is from the official documentation. The one that matters most is `CELLD_WATCH`. Without it, celld works in a temporary directory, and the writes it holds as a follower would sit somewhere a reboot wipes. Here it points at the data volume.

`CELLD_ADVERTISE` is this node's address as the other nodes see it. The script reads the instance's private IP through IMDSv2 and writes it in.

`CELLD_NODE` (the node's session ID) is deliberately not set. I could not tell from the documentation whether it is meant to be fixed, so it stays at the default (generated at each start).

And the script neither starts nor restarts the service. When a node stops is the star of the section after next.

## What does it cost?

<!-- section: 24.cost -->

Here is the breakdown (all list prices in ap-northeast-1, USD, 730 hours).

- One `t4g.small` instance: USD 15.77
- gp3 volumes, 16 GiB per node: USD 1.54 (the 8 GiB root is an assumption; the real size was not checked)
- S3 requests, about USD 3.93 per node. This one is an estimate
- The interface endpoints added to the chapter 11 stack: USD 61.32

Together: USD 82.56 for one node, USD 125.03 for three. As in chapter 23, the most expensive part is the endpoints, more than 70% of the one-node layout. Without the endpoints it is USD 21.24 for one node and USD 63.71 for three.

A word on the S3 requests. A celld node keeps talking to the bucket even when it is doing nothing. The documented intervals are a lease renewal every third of the lease lifetime (a write about every 3.3 seconds), a read of the fleet's load every 5 seconds, and a check for a new deployment every 30 seconds. Over a month that is about 790 thousand writes and 610 thousand reads. It is a lower bound calculated from the documented numbers, not a measurement. Active cells add to it, and the objects that pile up in the bucket are billed for storage separately.

<<< @/examples/24-celld/src/cost.ts{billable}

Stop all three instances and USD 65.93 keeps coming: volumes and endpoints. After destroying the stack with the defaults, the three remaining data volumes cost USD 2.30 a month.

About the instance type. The celld documentation offers a rule of thumb, "one 8 GB node holds 1,000 resident cells", and no minimum requirement. Whether a 2 GiB `t4g.small` is enough has not been checked.
