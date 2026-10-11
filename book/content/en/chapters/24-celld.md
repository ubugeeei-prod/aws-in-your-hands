---
title: "24 Advanced Lab: Self-Hosting celld on AWS"
sourceRevision: 1
---

# 24 Advanced Lab: Self-Hosting celld on AWS

In [chapter 23](/en/chapters/23-ec2.md) you took on one machine, operating system and all. In this last chapter you run a distributed system on machines like that one, a system AWS does not look after for you.

The subject is celld. It is open source from Deno Land: a daemon that runs a Cloudflare Workers and Durable Objects application on your own machines and keeps the long-term state in your own bucket. It is not an AWS managed service. When it stops, you start it. When it needs an upgrade, you decide the order. When it breaks, you bring it back. This chapter lets you feel what that means on a small fleet.

Money first. This chapter, too, builds things that are **billed by the hour for merely existing**. One node costs about USD 2.71 a day and USD 82.56 for a month (730 hours). Three nodes cost USD 4.11 a day and USD 125.03 a month. The default layout has zero nodes and no hourly charge; the count only goes up when you ask for it. If you try it, get to "Cleaning up" the same day.

And one more thing, said plainly. Nothing in this chapter has been run on AWS. The celld binary has never been run on my machine either. Everything said about celld comes from reading the official documentation and source of v0.6.2. What was checked locally is the infrastructure definition, the logic that decides the order of operations, and the judge of the check. The breakdown is at the end of the chapter.

You need [chapter 23](/en/chapters/23-ec2.md), the VPC from [chapter 11](/en/chapters/11-network.md), and the way of thinking about recovery from [chapter 22](/en/chapters/22-recovery.md). The code is in `examples/24-celld/`.

## What is celld?

<!-- section: 24.what -->

Let's borrow the official description.

- A **cell** is a small server with a name and a SQLite database of its own. In Cloudflare's words, a Durable Object. You make one per user, per document, per chat room
- A **node** is one celld process on one machine
- The nodes that share one bucket are a **fleet**. There is no join step. Nodes find each other through records in the bucket

The interesting part is what it leaves out: no leader election, no membership management. Each cell has a small ownership record in the bucket. A node goes for it with a conditional write, and the one node that wins serves that cell. The bucket decides who won.

celld makes two promises. Exactly one node serves a cell at a time. And a write that was answered is never lost. Both come with conditions: the bucket must implement conditional writes and ranged reads correctly, and a supervisor must restart the process. Amazon S3 is one of the stores celld lists as qualified. The release tests, though, run against Cloudflare R2; S3 is described as using "the same client and headers".

Here are the facts as of the day this chapter was researched.

- The latest release is v0.6.2 (published 2026-10-07). The official limitations and security pages call it a **beta**
- Only the latest release receives security fixes
- Eleven releases came out in about two months from the first one. What this chapter says will age quickly
- One fleet runs one application. Running code from parties that do not trust each other in one fleet is explicitly "not safe"

If you use Durable Objects on Cloudflare, you never see a node, a bucket, or a disk. Here you see all of them, and all of them are your job. I did not look into Cloudflare's own guarantees or prices for this chapter. The only comparison made is who does the operating.

## Pin the version, and check what you got

<!-- section: 24.pin -->

With software you operate yourself, the first thing to fix in place is which software it is. The official installer is a shell script that fetches the latest version unless told otherwise. Handy, and tomorrow it installs something else.

This chapter writes the version, and the SHA-256 of each published archive, into the repository.

<<< @/examples/24-celld/src/celld.ts{releases}

The digests are the ones published on the GitHub release, and they were confirmed against digests computed from the downloaded archives. v0.6.1 is there too, so that you have something older to upgrade from later.

The task that downloads keeps nothing unless the size and the digest match.

<<< @/examples/24-celld/scripts/fetch.ts{verify}

```bash
vp run celld:fetch
```

The Linux arm64 archive for the nodes lands in `examples/24-celld/.celld/download/`. With `--host` it also fetches the binary for your own machine and the official counter example (you will use those to deploy an application). The task talks to github.com and nothing else, and it runs nothing it downloads.

A matching digest only says "the same thing that is on GitHub". Whether that thing was built by celld's CI is what the officially suggested `gh attestation verify <file> --repo denoland/celld` tells you. The GitHub CLI is not in the devShell, so that part is yours.

## The big picture

<!-- section: 24.architecture -->

```text
your machine                          AWS (ap-northeast-1)
  vp run celld:*  -- Run Command -->  VPC from chapter 11, private subnets, no inbound from outside
  celld deploy    -- S3 API ------+
                                  |    node a (AZ 1)      node b (AZ 2)      node c (AZ 1)
                                  |    celld :8081  <-->  celld :8081  <-->  celld :8081   peers: plain HTTP
                                  |    Worker 127.0.0.1:8080 on each node (loopback only)
                                  |    data volume        data volume        data volume    retained
                                  |         |                  |                  |
                                  +--> fleet bucket  s3://<bucket>/fleet/      (S3 gateway endpoint)  retained
                                       backup bucket s3://<bucket>/backups/    (nodes have no access)  retained
```

CDK stops here: the buckets, the role, the security group, and as many instances and volumes as you asked for. Installing celld, starting it, upgrading it: all of that lives outside CDK. The reason is the same as in chapter 23, where you did not want every template change to rebuild the instance. With celld there is one more: which node stops when is part of being correct. You do not want CloudFormation or cdkd to pick that order for its own reasons.

By the way, there is no integration between cdkd and celld here. I found nothing saying that one officially exists, so I did not invent one.

Settings arrive through CDK context.

<<< @/examples/24-celld/src/config.ts{schema}

`nodes` defaults to 0. Typing just `vp run celld:infra:deploy` creates nothing that is billed by the hour.

Here is the warning from chapter 11 once more. `-c` only applies to the run it is given on. Create the fleet with `-c nodes=3`, forget the `-c` on a later deploy, and cdkd goes off to delete all three nodes. The data volumes stay (next section), but they fall out of the template's care, and the next deploy with `-c nodes=3` creates new, empty volumes. Before every deploy, look at `vp run celld:infra:diff -c nodes=3`.

There is also a task that shows the plan locally. It does not touch AWS.

```bash
vp run celld:plan nodes=3
```

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

## What you can check locally, and what you cannot

<!-- section: 24.local -->

```bash
vp run test:unit
vp run celld:plan nodes=3
vp run celld:render
vp run celld:infra:synth -c nodes=3
vp run celld:fetch
```

The tests check the following.

- What the stack creates: no hourly resource by default, one inbound rule from the group itself, IMDSv2 required, buckets and volumes set to stay, no `*` in the role
- The unit and the install script: celld's two requirements (restart delay and stop grace) cannot be broken, and an archive with the wrong digest is refused (the real script, run by bash)
- The order of an upgrade. The section after next
- The judging of the check that loses a node. The section after that

What cannot be checked is celld itself. celld has a command, `celld dev`, that runs one node without a cloud bucket. If you write an application, that looks like the place to start. But this chapter was written without running the binary, so I cannot tell you what it is like.

## One node first

<!-- section: 24.one-node -->

From here on, the steps have not been run. The order matters, so here it is with the reasons.

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run celld:fetch --host
vp run celld:infra:deploy -c nodes=1
vp run celld:status
vp run celld:artifacts
vp run celld:install
vp run celld:app-deploy
vp run celld:start
vp run celld:smoke
vp run celld:diagnose
```

Line 1 is the same as in chapter 23: the endpoints that let an instance in a private subnet reach Systems Manager. `celld:status` on line 4 confirms that user data finished and the data volume is mounted.

`celld:artifacts` puts the archive in the bucket, and `celld:install` runs the script above on each node. At this point celld is still not running.

`celld:app-deploy` is the one step in this chapter that runs the celld binary on your machine. It writes the official counter example into the fleet bucket with `celld deploy`. That needs your credentials to be able to write to the fleet bucket. Remember the sentence from earlier: that is the fleet administrator's permission.

`celld:start` starts the node. Every time it starts, celld tests for itself whether the bucket really enforces conditional writes. That test cannot be turned off.

The expected result: `celld:smoke` prints `{"ok":true}`, then `{"n":1,...}`, then `{"n":2,...}`. The counter is a Durable Object that adds 1 on every request and answers with the result. `celld:diagnose` prints the outcome of the bucket test and the list of live nodes.

<<< @/examples/24-celld/src/remote.ts{commands}

Two things the documentation says about a fleet of one. Every write waits for a round trip to the bucket, so writes are slow (it gives about 90 ms for a store in the same region as a guide). And while that one node is down, nobody takes its cells over. "One machine is a single point of failure" from chapter 23 applies as is.

## Make it a fleet, and replace nodes one at a time

<!-- section: 24.rollout -->

Adding nodes is a matter of changing a number and deploying.

```bash
vp run celld:infra:diff -c nodes=3
vp run celld:infra:deploy -c nodes=3
vp run celld:install
vp run celld:start
vp run celld:diagnose
```

There is no join command. Nodes started against the same bucket find each other through the leases in it. From two nodes on, a write can be answered once a follower has it on disk. With three, there are two followers.

Now the real subject. How do you replace the nodes of a running fleet?

The official procedure is short. Stop a node with SIGTERM. Wait for its replacement to report healthy. Move to the next. It also says what to wait for: do not stop the next one until `celld diagnose` says `restoring=0` for every node.

The stopping side looks like this. `systemctl stop` sends SIGTERM, so celld turns its health to 503, finishes the requests it accepted, hands its cells to a peer, and exits.

```bash
vp run celld:drain a
```

Repeat that for each node with a check in between, and you have a rolling update. Done by hand, skipping one check is enough to have two nodes down at once. So the order is a function.

<<< @/examples/24-celld/src/rollout.ts{rolling}

This function knows neither AWS nor celld directly. All it knows is `FleetOps`, six operations.

<<< @/examples/24-celld/src/rollout.ts{ops}

The real `FleetOps` sends Run Commands. The one in the tests is a stand-in that writes to an array. `wait` only writes to it too, so the tests never advance a clock. It is the approach of chapter 08: put the failure in an exact place.

- Fail the drain, the install, or the start of the second node. It stops there and never touches the third
- A restarted node never finishes `restoring`. It gives up after the set number of checks. The next node keeps running
- A restarted node comes up on the old binary. It stops without waiting
- One node is down from the start. Nothing is touched

In every case the tests check that at most one node is down at a time.

Whether it is safe to move on is decided here.

<<< @/examples/24-celld/src/health.ts{settled}

Output it cannot read counts as "not yet". celld's operator-facing interfaces are alpha and may change with any release, the documentation says. If the shape of the output changes, this function keeps saying "do not proceed". That is the right answer.

### Some version pairs must not roll

There is one more thing that matters. A rolling update creates a period in which the old and the new version run together. Whether that is allowed depends on the pair.

<<< @/examples/24-celld/src/celld.ts{upgrade-notes}

This is the official upgrade notes, copied. v0.5.1 to v0.6.0, for example, is "stop all": a v0.6.0 node refuses to start against a v0.5.1 follower. For v0.3.0 to v0.4.0, the notes say a mixed fleet can make committed values unavailable.

`celld:rollout` looks up the running versions and the target in this table. A pair that is not in it (skipping a release, a downgrade, a release newer than this chapter) is "unknown", and it stops. It never guesses "rolling". Read the official notes, add the pair to the table, and run it again.

For a "stop all" pair, the procedure changes.

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:rollout v0.6.2 --stopped
```

Stop every node, wait for the leases to expire, take a backup, install the new binary on every node, and only then start them. If even one old node is running, a `--stopped` rollout does nothing.

To practise, build the fleet on v0.6.1 (`vp run celld:fetch v0.6.1 --host`, `vp run celld:artifacts v0.6.1`, `vp run celld:install v0.6.1`), then `vp run celld:artifacts` and `vp run celld:rollout v0.6.2`. Keep the local binary you deploy the application with on the same version as the fleet. The documentation says so too: keep operator tooling and celld releases together.

## Lose a node

<!-- section: 24.loss -->

Draining was the polite way to stop. Now for the rude one.

Let's restate celld's promises as something a client can see. The counter adds 1 on every request and answers with the new value. So for a client that sends requests to one cell, one after another, this should hold.

> A value that was answered never gets smaller later. And the value never moves further than the number of requests sent.

If the first half breaks, an acknowledged write is gone. If the second half breaks, one request was applied twice, or there is another writer.

The tricky part is a request that got no answer: a timeout, a 503, a broken body. The client cannot know whether it was applied. So it is counted as "could be either".

<<< @/examples/24-celld/src/ledger.ts{invariant}

The check goes like this.

```text
time ->
witness node:  probe: one request per cell, round after round .......... DONE
victim node:                      stop-instances --skip-os-shutdown
every survivor:                                                          sweep: read each cell back
judge:         acked values never go back; no step without a request; an ack after the fault for every cell
```

On a node that stays (the witness), a script plays the client. After it has written for a while, another node (the victim) is stopped with `aws ec2 stop-instances --skip-os-shutdown`. Skipping the OS shutdown means celld gets no SIGTERM and cannot hand anything off. Of what a script can cause, it is the closest to losing a machine. The instance and the volume are not deleted, so you can bring it back.

<<< @/examples/24-celld/scripts/fleet.ts{loss-check}

When the probe is done, every cell is read once more through each of the remaining nodes. That is the check for "one owner only". If two nodes each believed they owned a cell, the values would disagree once you change the way in. celld's own tests do the same thing: they fetch each cell through different nodes.

The client script looks like this.

<<< @/examples/24-celld/src/probe.ts{script}

```bash
vp run celld:loss-check b
vp run celld:revive b
```

This part deserves particular honesty. **This check has never been pointed at a real celld fleet.** What the tests put before the judge is `test/toy-fleet.ts`, a toy fleet written for this chapter. It does not reproduce celld's protocol. It comes with deliberately broken variants, and the tests confirm that the judge catches them.

- A fleet that answers before the write is durable. Lose a node and a value goes back. Caught
- A fleet whose old owner keeps answering without noticing it was replaced. Reading through another way in shows the disagreement. Caught (and not caught if you read through one node only; that is a test as well)
- A fleet that applies a request twice. Caught
- A fleet with nothing wrong. One lost answer is not a violation

One more thing. There is no check here that reads celld's ownership records themselves. Their format is not a published interface; it exists only inside the source. What is checked is the outcome a client can see.

And even when this check says "held", it is talking about the requests sent this time and the one fault caused this time. It is not a proof that celld is correct. "Inconclusive" is also a possible result: if a cell never answered again after the fault, nobody knows whether its writes are still there.

## Backup and restore

<!-- section: 24.backup -->

celld has no backup command. The documentation contains exactly one procedure, inside the explanation of upgrading from v0.4.1. Stop every node, wait for the leases to expire, then back up both the bucket and the node data. To go back, restore that backup in full. Writes made after the backup are lost.

"The node data too" is the important part. The reason is the one from the earlier section: an acknowledged write that the bucket does not have yet may be on a disk.

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:start
```

`celld:backup` does nothing if even one node is running. Once it has confirmed they are stopped, it takes a snapshot of each node's data volume, copies the fleet prefix to the backup bucket, and writes a manifest saying which snapshot belongs to which node.

There is no backup of a running fleet here. I could not find a guarantee anywhere in the documentation that a copy of a live fleet's bucket is something you can restore from. In [chapter 22](/en/chapters/22-recovery.md), PITR takes a DynamoDB table back to an earlier state, and versioning does the same for a bucket's objects one at a time. As that chapter showed, stores restored separately disagree with each other. celld's state spans the bucket and several disks, so taking only the bucket back does not give you a consistent whole.

A restore deletes things. So it defaults to a dry run.

<<< @/examples/24-celld/src/backup.ts{restore}

```bash
vp run celld:stop-all
vp run celld:restore 20261012T010203Z
vp run celld:restore 20261012T010203Z --yes
```

The first one only shows what would be overwritten and what would be deleted. With `--yes`, the fleet prefix is made identical to the backup. It then prints the deploy command that recreates each node's volume from its snapshot. Bucket and disks always go back together. If the nodes in the backup and the nodes of the current fleet do not match, the restore does not begin.

Recreating a volume is, as you saw in chapter 23, something cdkd treats as replacing a stateful resource, and it asks for `--force-stateful-recreation`. The old volumes stay because of `retain`, so you delete them yourself afterwards.

This sequence has not been run end to end. In particular, whether celld starts cleanly on a bucket copied by `aws s3 sync` and disks restored from snapshots is the first thing to verify. A backup you have not restored from is not a backup yet.

## When it does not work

<!-- section: 24.failures -->

The order to look in is roughly this.

```bash
vp run celld:status
vp run celld:logs a
vp run celld:diagnose
```

- **`celld:status` returns nothing.** The node cannot reach Systems Manager. Check the same things as in "No SSH port" in chapter 23. Did you redeploy the network stack without `-c` after adding the endpoints?
- **The service stays `inactive`.** The unit quietly skips its start when the binary or the environment file is missing. See whether `celld:install` was forgotten
- **It starts and exits at once.** Read the log. AccessDenied on the bucket points at the role. An error about not being able to write a file may be the unit's `ProtectSystem=strict` closing off somewhere celld writes (this combination has not been run). celld also stops at startup on an invalid environment variable
- **`SELF-FENCE:` in the log.** The node could not renew its lease and stopped itself. systemd starts it again after 15 seconds. If it keeps happening, suspect the path to the bucket (the S3 gateway endpoint, the role)
- **`celld:diagnose` shows too few peers.** That node's lease has expired, or its internal port cannot be reached. Look at the security group rule and the address in `CELLD_ADVERTISE`
- **`celld:rollout` stopped at settle.** Nothing was rolled back. Read the log of the node it stopped at, and decide whether to get it running or to put the previous version back with `celld:install <version> <node>`. The remaining nodes are still running the old version
- **Health stays 503.** celld does not report a new node healthy until the fleet has settled. After 120 seconds it logs `ready_gate_expired` once, and stays closed all the same

## If this were production

<!-- section: 24.production -->

First, whether to. This is software its authors call a beta, with security fixes for the latest release only. Ask whether you have the people and the time to operate it before anything else. Here is what this lab lacks.

- **A way in.** celld does not terminate TLS and has no managed ingress. Put a proxy such as the ALB from chapter 12 in front, make the public listener listen on the private IP, and open that port to the proxy only. A new node receives requests only once it is in the load balancer's rotation
- **Encryption of peer traffic.** As described above
- **Capacity.** celld does not scale itself. The documentation gives the signals for adding a node (`capacity_waiting`, `pressured`) and the conditions for removing one. Lose a node while the fleet is at its limit, and its cells have nowhere to go
- **Monitoring.** The number of `SELF-FENCE:` lines, health, `restoring`, free disk space. The tools from chapter 19 can pick them up; this chapter does not wire them
- **The size of the bucket.** By default the bucket grows every time a cell wakes up. The cleanup setting (`CELLD_LTX_RETENTION_SECS`) is off by default
- **The reach of credentials.** Permission to deploy the application is the fleet administrator's permission. If CI holds it, use OIDC from chapter 20 and narrow it to this bucket's prefix
- **Keeping up with versions.** With every release, reread the upgrade notes, limitations, security, and guarantees. Nothing here lets you upgrade without reading
- **AMI and OS patches.** As in chapter 23. If you rebuild nodes, do it one at a time, after a drain

Everything AWS takes on for you with DynamoDB or SQS, you take on here. There will still be cases where celld fits: you want to keep writing Durable Objects as they are, or you want the state in your own bucket. I hope what you went through in this chapter helps you decide.

## Cleaning up

<!-- section: 24.cleanup -->

There is an order.

```bash
vp run celld:stop-all
vp run celld:infra:destroy
vp run net:infra:destroy
```

With the default `stateOnDestroy=retain`, the instances go, and the two buckets and the data volumes stay. That is by design. But once practice is over, delete them.

```bash
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=tag:Name,Values='AihCelld/*'
aws ec2 delete-volume --region ap-northeast-1 --volume-id <volume-id>
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self --filters Name=tag-key,Values=aih:backup
aws s3 rm s3://<bucket>/ --recursive --dryrun
```

The remaining volumes can be found by their Name tag. Snapshots taken by `celld:backup` carry the `aih:backup` tag. A bucket is emptied first and then removed with `aws s3 rb`. While the stack still exists, `vp run celld:bucket-empty` and `vp run celld:bucket-empty backups` do the same (without `--yes` they only list).

If you created the stack with `-c stateOnDestroy=delete` from the start, empty the buckets before the destroy. The pinned cdkd does not delete a bucket that is not empty.

```bash
vp run celld:bucket-empty --yes
vp run celld:bucket-empty backups --yes
vp run celld:infra:destroy
```

What should count at destroy time is the setting the stack was deployed with. Whether cdkd synthesizes the template again at that point, though, has not been checked. If volumes or buckets are left after the destroy, delete them with the steps above.

Forget `net:infra:destroy`, and the endpoints keep costing USD 61.32 a month. To keep the VPC, run `vp run net:infra:deploy` without `-c`, and only the endpoints go.

What stays on your machine is the archives and the binary in `examples/24-celld/.celld/`. They are not in git.

## As a distributed system

<!-- section: 24.distributed -->

To finish, let's sort out who guaranteed what in this chapter.

The state has three homes. The bucket (long-term state, and the record of who owns what). The owning node's disk. The followers' disks (acknowledged writes the bucket does not have yet). The thought is not "there is S3, so it is safe" but "which write is where, right now".

The invariants are celld's. A cell has one owner at a time. An acknowledged write is not lost. What keeps them is celld's protocol, and that protocol leans on the bucket's conditional writes and on how the supervisor behaves. The CDK code and the scripts of this chapter have one job: not to break those assumptions. Wait longer than a lease lifetime before a restart. Wait longer than 40 seconds on a stop. Never stop two nodes at once. Never discard every disk at once. Never mix versions that must not be mixed.

And what this chapter does not claim. It does not say that no write is lost under any failure. celld writes down its own limits. A follower that keeps returning errors can keep recovery from making progress. A final batch that is deleted whole can go undetected. Mixed versions can stall recovery. A fleet at its limit cannot take in the cells of a node it lost. What survives the loss of several nodes and disks at once depends on which write had got how far.

What this chapter's tests check lies well before all of that. That the function deciding the procedure runs it in the order decided, and stops when something fails. That the judge of the check can tell a broken toy fleet from a sound one. Checking whether celld keeps its promises is left as your work: running `celld:loss-check` on real nodes.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (failures injected at each step of the function that orders an upgrade, the ledger judged against a toy fleet, the probe script run by bash and curl, the install script refusing bad arguments and a mismatched digest when run by bash, generation of the unit and user data, reading `celld diagnose --json` output, backup and restore plans, pricing inputs, stack assertions). Type checking. `celld:infra:synth` (default, `-c nodes=1`, `-c nodes=3`, `-c nodes=2 -c stateOnDestroy=delete`, `-c nodes=2 -c dataSnapshots=a:snap-0123456789abcdef0`). `celld:plan`, `celld:render`. `celld:fetch` (downloaded the Linux arm64 archives of v0.6.2 and v0.6.1; size and SHA-256 matched the pinned values. `--host` was not used, and nothing was unpacked or run). Separately, all six archives of v0.6.2 and v0.6.1 for the three platforms were downloaded and matched the digests the GitHub API returns. That the devShell's AWS CLI (2.35.11) accepts `aws ec2 stop-instances --skip-os-shutdown` was confirmed from its help output.

**Not checked yet.** Nothing was run against AWS: not `celld:infra:diff`, `celld:infra:deploy`, `celld:infra:drift`, or `celld:infra:destroy`, and none of the tasks that touch a node, from `celld:status` to `celld:bucket-empty`. The celld binary was never run either (`celld dev`, `celld deploy`, starting a node, `celld diagnose`). So the following was only read. That celld obtains credentials from the instance role (IMDSv2 required, hop limit 1). That the S3 gateway endpoint alone reaches the fleet bucket. That this chapter's list of IAM actions is enough. That celld runs under systemd's `ProtectSystem=strict`. That a `t4g.small` is enough. The real output of `celld diagnose --json` (the samples in the tests are assembled from the format strings in `fleet.rs` at v0.6.2; they are not copies of real output). How the handoff on SIGTERM and the health gate really behave. That the remaining nodes take over cells after `--skip-os-shutdown`. That a fleet restored from a backup starts. That cdkd can carry out the restore deploy that replaces volumes. The way `-c` and `--yes` are passed to `vp run` tasks follows the form used up to chapter 23.

What primary sources could not settle. The list of S3 actions celld needs (it is a translation of the Azure wording). celld together with bucket versioning. Whether `CELLD_NODE` may be fixed across restarts. Whether a copy of a live fleet's bucket can be restored from. celld's minimum memory requirement. The systemd version on Amazon Linux 2023 (the v252 man pages were read; no instance was checked). Cloudflare's own guarantees and prices for Durable Objects were not looked into.

What changed from the requested design. "Peer traffic over a private network and TLS" became "a private network only", because celld has no TLS. The check after losing a node does not read ownership records directly; it judges the counter history a client can see (the record format is not a published interface).

The S3 unit prices were not reread for this chapter. It uses the prices that chapters 07, 11, and 23 recorded from the AWS Price List (checked 2026-10-11 and 2026-10-12) as they are.

Resource types as cdkd handles them. I read the `dist` of the pinned npm package (0.296.28). `AWS::EC2::Instance`, `AWS::EC2::SecurityGroup`, and `AWS::EC2::SecurityGroupIngress` are registered with the EC2 provider; `AWS::IAM::InstanceProfile`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::S3::Bucket`, and `AWS::S3::BucketPolicy` each with a provider of their own. `AWS::EC2::Volume` and `AWS::EC2::VolumeAttachment` are not registered and go through Cloud Control API (the same finding as chapter 23). `AWS::EC2::SecurityGroupEgress` is not registered either, so the outbound rules are written inside the security group instead of as separate resources. cdkd's documentation describes cdkd as for development and test use and recommends the AWS CDK CLI for production (this rests on a source recorded by earlier chapters; it was not reread for this one).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Pin the version, and check what you got | `examples/24-celld/src/celld.ts`, `scripts/fetch.ts` | `celld:fetch`, `test:unit` |
| The big picture | `examples/24-celld/infra/lib/celld-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `src/report.ts`, `scripts/plan.ts` | `celld:plan`, `celld:infra:synth` |
| Peer traffic has no TLS | `examples/24-celld/infra/lib/celld-stack.ts`, `infra/test/celld-stack.test.ts` | `celld:infra:synth`, `test:unit` |
| State lives in the bucket, and you still cannot throw the disks away | `examples/24-celld/infra/lib/celld-stack.ts`, `infra/test/celld-stack.test.ts` | `celld:infra:synth`, `test:unit` |
| Inside a node | `examples/24-celld/src/machine.ts`, `deploy/`, `scripts/render.ts`, `test/machine.test.ts` | `celld:render`, `test:unit` |
| What does it cost? | `examples/24-celld/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `celld:plan`, `test:unit` |
| What you can check locally, and what you cannot | `examples/24-celld/test/`, `infra/test/` | `test:unit`, `celld:plan`, `celld:render`, `celld:infra:synth`, `celld:fetch` |
| One node first | `examples/24-celld/scripts/fleet.ts`, `src/remote.ts`, `test/remote.test.ts` | `celld:infra:deploy`, `celld:artifacts`, `celld:install`, `celld:app-deploy`, `celld:start`, `celld:status`, `celld:smoke`, `celld:diagnose` |
| Make it a fleet, and replace nodes one at a time | `examples/24-celld/src/rollout.ts`, `src/health.ts`, `test/rollout.test.ts`, `test/health.test.ts` | `celld:drain`, `celld:rollout`, `celld:stop-all`, `test:unit` |
| Lose a node | `examples/24-celld/src/probe.ts`, `src/ledger.ts`, `test/toy-fleet.ts`, `test/ledger.test.ts`, `test/probe.test.ts` | `celld:loss-check`, `celld:kill`, `celld:revive`, `test:unit` |
| Backup and restore | `examples/24-celld/src/backup.ts`, `test/remote.test.ts` | `celld:backup`, `celld:restore`, `test:unit` |
| When it does not work | `examples/24-celld/scripts/fleet.ts` | `celld:status`, `celld:logs`, `celld:diagnose` |
| Cleaning up | `examples/24-celld/scripts/fleet.ts` | `celld:infra:destroy`, `celld:bucket-empty` |
| As a distributed system | `examples/24-celld/src/ledger.ts`, `test/ledger.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-12)

- celld v0.6.2 (the tag's commit is `90b43017241f`): [README](https://github.com/denoland/celld/blob/v0.6.2/README.md), [documentation](https://github.com/denoland/celld/blob/v0.6.2/docs/README.md) (Shut down and roll out a node, Upgrade notes, Environment variables), [What celld guarantees](https://github.com/denoland/celld/blob/v0.6.2/docs/guarantees.md), [Security](https://github.com/denoland/celld/blob/main/docs/security.md), [Limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md), [Testing](https://github.com/denoland/celld/blob/v0.6.2/docs/testing.md), [source](https://github.com/denoland/celld/tree/v0.6.2/crates/celld) (`main/cli.rs`, `fleet.rs`, `main.rs`, `bucket.rs`, `protocol.rs`), [counter example](https://github.com/denoland/celld/tree/v0.6.2/examples/counter), [releases](https://api.github.com/repos/denoland/celld/releases), [installer](https://celld.dev/install.sh) (read, not run). The default branch of the [repository](https://github.com/denoland/celld) was at the same commit as the v0.6.2 tag when checked. [celld.dev/docs](https://celld.dev/docs/) and [celld.dev/docs/guarantees](https://celld.dev/docs/guarantees/) were read through a summary; the chapter's claims rest on the repository files
- EC2: [StopInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_StopInstances.html), [Data protection](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html), [Instance metadata categories](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html), [Access instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)
- S3: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [Multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html). AWS CLI: [s3 sync](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html)
- Sources of the systemd v252 man pages: [systemd.service](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml), [systemd.unit](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml), [systemd.kill](https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml)
- cdkd: the `dist` of [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), read from the installed package
- The sources recorded by chapters 23 and 11 (Systems Manager, EBS snapshots, CloudFormation `DeletionPolicy`, AWS Price List) are in those chapters' verification notes. They were not reread for this chapter

:::
