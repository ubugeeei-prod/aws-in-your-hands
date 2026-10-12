---
title: "24 Self-hosting: Deploy"
---

# 24 Self-hosting: Deploy

## One node first

<!-- section: 24.one-node -->

None of the steps on this page have been run. Their order matters, so each one comes with its reason.

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

The first line is the same as in chapter 23. It adds the endpoints that let instances in a private subnet reach Systems Manager. The fourth line, `celld:status`, confirms that user data has finished and the data volume is mounted.

`celld:artifacts` puts the archive in the bucket, and `celld:install` runs the install script from the [Design and Build](/en/chapters/24-celld/build.md) page on every node. celld is still not running at this point.

`celld:app-deploy` is the one step in this chapter that runs the celld binary on your own machine. It writes the official counter example into the fleet bucket with `celld deploy`. Your credentials need write access to the fleet bucket for this. As the official documentation put it, whoever holds the bucket credentials controls the fleet, so this permission is the fleet administrator's permission.

`celld:start` starts the nodes. On every start celld tests for itself whether the bucket really honors conditional writes. The test cannot be turned off.

If everything works, `celld:smoke` prints `{"ok":true}`, then `{"n":1,...}` and `{"n":2,...}`. The counter is a Durable Object that adds 1 on each request and returns the result. `celld:diagnose` prints the result of the bucket test and the list of live nodes.

<<< @/examples/24-celld/src/remote.ts{commands}

The official documentation says two things about a fleet of one. First, every write waits for a round trip to the bucket and is slow. The figure it gives is about 90 ms with a store in the same region. Second, while that one node is down, nothing can take over its cells. What chapter 23 said about [a single point of failure](/en/chapters/23-ec2/wrap.md) applies unchanged.

## Make it a fleet, and replace nodes one at a time

<!-- section: 24.rollout -->

To add nodes, change the `nodes` number and deploy.

```bash
vp run celld:infra:diff -c nodes=3
vp run celld:infra:deploy -c nodes=3
vp run celld:install
vp run celld:start
vp run celld:diagnose
```

There is no command for joining a fleet. Nodes started against the same bucket find each other through the leases in it. Once there are two nodes, a write can be acknowledged as soon as it is on a follower's disk. With three nodes there are two followers.

The rest of this section is about replacing the nodes of a running fleet.

The official procedure is short. Stop a node with SIGTERM, wait until its replacement is healthy, and move to the next node. It also says how long to wait, which is until `celld diagnose` reports `restoring=0` for every node. Do not stop the next node before then.

To stop a node, `systemctl stop` sends SIGTERM. celld then answers health checks with 503, finishes the requests it has already accepted, hands its cells to its peers, and exits.

```bash
vp run celld:drain a
```

A rolling update repeats that stop for one node at a time, with a check in between. By hand, skipping a single check is enough to leave two nodes down at once. The order is therefore written as a function.

<<< @/examples/24-celld/src/rollout.ts{rolling}

The function knows nothing about AWS or celld directly. It uses only the six operations of `FleetOps`.

<<< @/examples/24-celld/src/rollout.ts{ops}

The real `FleetOps` sends Run Command. The one in the tests is a stand-in that records each call in an array. `wait` is recorded too, so the tests do not wait for real time to pass. As in chapter 08, failures are injected at chosen points.

- The drain, the install, or the start of the second node fails. The function stops there and does not touch the third node
- A restarted node never finishes `restoring`. The function gives up after the configured number of attempts and stops, and the next node keeps running
- A restarted node comes up on the old binary. The function stops without waiting
- One node is down from the beginning. The function touches nothing

Every case also asserts that at most one node is down at a time.

This function decides whether it is safe to move to the next node.

<<< @/examples/24-celld/src/health.ts{settled}

Output it cannot read counts as "not yet". The official documentation says celld's operator interface is alpha and may change with any release. If the shape of the output changes, this function keeps answering "do not proceed". Stopping is safer than going on without knowing, so that is the intended behavior.

### Version pairs that cannot be rolled

During a rolling update the old and the new version run side by side. Whether that is allowed depends on the pair of versions.

<<< @/examples/24-celld/src/celld.ts{upgrade-notes}

This table is copied from the official upgrade notes. The upgrade from v0.5.1 to v0.6.0, for example, requires stopping every node first. A v0.6.0 node refuses to start while a v0.5.1 follower is present. For v0.3.0 to v0.4.0, the notes say that mixing the two can make committed values unreadable.

`celld:rollout` looks up the running version and the target version in this table. A pair that is not in the table (skipping a version, a downgrade, or a version newer than this chapter) is treated as unknown, and the task stops. It never guesses that a rolling update is safe. When that happens, read the official notes, add the pair to the table, and run the task again.

For a pair that requires stopping every node, the procedure changes.

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:rollout v0.6.2 --stopped
```

This stops every node, waits for the leases to expire, takes a backup, installs the new binary on every node, and then starts them. If even one old node is still running, a rollout with `--stopped` does nothing.

To practice, build the fleet on v0.6.1 (`vp run celld:fetch v0.6.1 --host`, `vp run celld:artifacts v0.6.1`, `vp run celld:install v0.6.1`), then run `vp run celld:artifacts` and `vp run celld:rollout v0.6.2` to bring it up to v0.6.2. Keep the local binary that deploys the application on the same version as the fleet. The official documentation also says to keep operator tools and the celld release in step.

## Losing a node

<!-- section: 24.loss -->

A drain stops a node after letting it clean up. This section stops one without giving it the chance.

To check the result, celld's promises have to be restated in terms a client can observe. The counter adds 1 on each request and returns the new value. A client that sends requests to one cell, one after another, should therefore see the following.

> A value that was acknowledged never gets smaller later. And the counter never advances by more than the number of requests sent.

If the first half fails, an acknowledged write has disappeared. If the second half fails, either one request ran twice or there is another writer.

The hard cases are requests that got no answer, such as a timeout, a 503, or a garbled body. The client cannot tell whether such a request ran, so the ledger counts it as possibly either.

<<< @/examples/24-celld/src/ledger.ts{invariant}

The next figure shows the check in order of time.

```figure
caption: The victim is stopped while the witness keeps writing, and after the probe is done every survivor reads the cells back for the judge
type: sequence
actor witness: witness node
actor victim: victim node
actor survivors: every survivor
actor judge: judge
step witness -> witness: probe: 1 request per cell
note witness: round after round
note victim: stop-instances
note victim: --skip-os-shutdown
note witness: probe DONE
step survivors -> survivors: sweep: reread every cell
note judge: no acked value goes back
note judge: no step without a request
note judge: after the fault, an ack
note judge: for every cell
```

A script playing the client runs on a node that stays up, the witness. After it has written for a while, another node, the victim, is stopped with `aws ec2 stop-instances --skip-os-shutdown`. Because the OS shutdown is skipped, celld receives no SIGTERM and cannot hand off its cells. Of the stops a script can cause, this is the closest to losing the machine. Neither the instance nor the volume is deleted, so you can start the node again afterwards.

<<< @/examples/24-celld/scripts/fleet.ts{loss-check}

When the probe is done, every cell is read once more through each of the surviving nodes. This reread, labeled sweep in the figure, is the check that a cell has one owner. If two nodes each believed they owned a cell, the values would disagree depending on which node you asked. celld's own tests also read a cell through different nodes.

This is the script that plays the client.

<<< @/examples/24-celld/src/probe.ts{script}

```bash
vp run celld:loss-check b
vp run celld:revive b
```

**This check has never been run against a real celld.** What the tests put in front of the judge is `test/toy-fleet.ts`, a toy fleet written for this chapter. It does not reproduce celld's protocol. It comes in deliberately broken variants, and the tests confirm that the judge catches them.

- A fleet that acknowledges before the write is durable. When a node is lost the value goes back, and the judge catches it
- A fleet whose old owner keeps answering without noticing it was replaced. Reading through a different node shows the disagreement, and the judge catches it. Reading through one node only does not catch it, and that is a test too
- A fleet that runs a request twice. The judge catches it
- A fleet with nothing wrong. One lost response is not a violation

There is no check that reads celld's ownership records themselves. Their format is not a published interface and exists only inside the source. The check looks only at results a client can see.

When the check says the invariant held, that is a result for the requests sent this time and the one fault caused this time. It does not prove that celld is correct. The check can also answer "undecided". If some cell never answered after the fault, there is no way to know whether its writes survived.

## Backup and restore

<!-- section: 24.backup -->

celld has no backup command. The official documentation contains one procedure, in the notes on upgrading from v0.4.1. Stop every node, wait for the leases to expire, and back up both the bucket and the nodes' data. To restore, put that whole backup back. Writes made after the backup are lost.

The nodes' data is included for the reason given on the [Design and Build](/en/chapters/24-celld/build.md) page. A disk may hold acknowledged writes that the bucket does not have yet.

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:start
```

`celld:backup` does nothing if even one node is running. Once it has confirmed that all of them are stopped, it snapshots each node's data volume, copies the fleet prefix to the backup bucket, and writes a manifest recording which snapshot belongs to which node.

There is no backup of a running fleet. I found nothing in the official documentation that guarantees a copy of a live fleet's bucket can be restored. In [chapter 22](/en/chapters/22-recovery.md), PITR took a DynamoDB table back to an earlier state, and versioning did the same for the objects in a bucket, one at a time. As that chapter showed, stores restored separately disagree with each other. celld's state spans a bucket and several disks, so restoring the bucket alone does not give you a consistent state.

A restore deletes what is there now, so it defaults to a dry run.

<<< @/examples/24-celld/src/backup.ts{restore}

```bash
vp run celld:stop-all
vp run celld:restore 20261012T010203Z
vp run celld:restore 20261012T010203Z --yes
```

Without `--yes`, `celld:restore` only shows what would be overwritten and what would be deleted. With `--yes` it makes the fleet prefix identical to the backup, and then prints the deploy command that rebuilds each node's volume from its snapshot. Always restore both the bucket and the disks. If the nodes in the backup do not match the nodes in the current fleet, the restore does not start.

As chapter 23 showed, cdkd treats rebuilding a volume as the replacement of a stateful resource and requires `--force-stateful-recreation`. The old volumes stay because of the `retain` setting, and you delete them yourself afterwards.

This sequence has not been run from start to finish. In particular, whether celld starts cleanly on a bucket copied with `aws s3 sync` and disks restored from snapshots is the first thing that needs checking. A backup you have not restored from is not a backup yet.
