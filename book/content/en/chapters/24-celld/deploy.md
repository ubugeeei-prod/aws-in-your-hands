---
title: "24 Self-hosting: Deploy"
---

# 24 Self-hosting: Deploy

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
