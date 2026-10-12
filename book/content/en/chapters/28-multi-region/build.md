---
title: "28 Multi-Region: Design and Build"
---

# 28 Multi-Region: Design and Build

The [previous page](/en/chapters/28-multi-region.md) settled the setup and how it was chosen. This page goes through the table, the bucket, and Route 53 in turn, and checks what happens between two Regions against a local model. It ends by turning the recovery targets into numbers.

## Global tables and the two consistency modes

<!-- section: 28.table -->

A global table keeps tables with the same name and the same keys in several Regions, and delivers a write to one replica to the others. In CDK, you add the replica's Region to the table definition.

<<< @/examples/28-multi-region/infra/lib/region-stack.ts{table}

The table is laid out as in chapter 05, and the one line that changed is `replicas`. The code uses `dynamodb.TableV2` and not `dynamodb.Table` because this is the construct that creates the resource for global tables (`AWS::DynamoDB::GlobalTable`).

The consistency mode is decided when the table is created and cannot be changed afterwards. There are two.

**MREC (multi-Region eventual consistency)** is the default. A write is final in the Region that took it and returns success there. It reaches the other Regions afterwards, asynchronously. The documentation says this usually takes a second or less, and that there is no SLA on the time. A replica can be placed in any Region where DynamoDB is available.

**MRSC (multi-Region strong consistency)** returns success only after the write has reached at least one other Region. It needs exactly three Regions: either three replicas, or two replicas and a witness. A witness exists so that the two replicas can agree, and it cannot be read or written. Tokyo, Osaka, and Seoul are Regions that can be combined this way.

The difference between the two modes changes what two of chapter 05's tools mean.

- **Strongly consistent reads (`ConsistentRead`).** In MREC, the read returns the latest item if the item was last written in the same Region, and may return old contents if it was last written in another. In MRSC, every replica returns the latest
- **Conditional writes.** In MREC, the condition is evaluated against the item in the Region that received the write. In MRSC, it is evaluated against the latest item

Chapter 05 kept "of two people holding the same version, only one wins" with a conditional write. In MREC, that condition sees the copy in one Region and nothing else.

### The local model

DynamoDB Local has no global tables, so the chapter has a model that keeps two Regions in memory. A function sees only the replica in its own Region.

<<< @/examples/28-multi-region/src/global-table.ts{replica}

In MREC mode, a write goes into the replica that received it at once and reaches the other replicas after a set delay. This is the part that decides whether an arriving write is applied.

<<< @/examples/28-multi-region/src/global-table.ts{last-writer-wins}

DynamoDB keeps, inside each item, the time of its last write, and applies a write that arrives from another Region only when its time is newer. An older one is discarded. This rule is called last writer wins. The model's `stamp` stands in for that internal time. What the real service does when two writes carry the same time was not written in the documentation that was read, so the model decides by the order in which they were made.

Chapter 05's repository sits on top of this model.

<<< @/examples/28-multi-region/src/replica-repository.ts{repository}

The conditions are the same ones chapter 05's `DynamoDbNoteRepository` sends as condition expressions. The contract tests chapter 05 wrote for a repository all pass in both modes, as long as only one replica is used. Inside one Region, nothing has changed.

## Editing from two Regions at once

<!-- section: 28.lost-update -->

What changes is what happens when the edits are split between two Regions.

```figure
caption: When two people edit version 1 in different Regions, both are told it succeeded, and only the later write remains
type: sequence
actor a: User A
actor tokyo: Tokyo replica
actor osaka: Osaka replica
actor b: User B
step a -> tokyo: PUT (from version 1)
note tokyo: version is 1: now 2
step tokyo --> a: 200
step b -> osaka: PUT (from version 1)
note osaka: still 1 here: now 2
step osaka --> b: 200
step tokyo --> osaka: older: discarded
step osaka --> tokyo: newer: overwrites
note tokyo: only B's edit is left
```

Here is the same thing as a test.

<<< @/examples/28-multi-region/test/global-table.test.ts{lost-update}

Both people are told "saved", and the table keeps only one of the edits. The version is 2 in both replicas, so the number does not show that an edit disappeared. According to the documentation, this conflict is recorded in neither CloudWatch nor CloudTrail.

The lost update that chapter 05 prevented, where an earlier save is overwritten without anyone noticing, is back once Regions are involved. The conditional write is not broken. There are now two places where the condition is checked.

The rest of the tests show how to prevent it. When every write is sent to Tokyo, the second edit gets `conflict`. In MRSC mode, the second edit gets `conflict` even when the two people write to different Regions.

The documentation also says that in real MRSC, a write to an item that is being changed in another Region can fail with an error named `ReplicatedWriteConflictException`, which succeeds on a retry. The model handles one write at a time, so it does not reproduce this case. Chapter 05's repository does not know this error and turns it into a `500`. If you use MRSC, you need to add a retry.

### Not only about versions

The same breakage happens to every write of the form "read a value, then write based on it". Chapter 05 counted each user's notes in one item with `ADD`. Within one Region, `ADD` loses nothing, but what is replicated between Regions is not the operation "add 1" but the item after the addition. When two Regions add 1 at the same time, one of them is lost. A test reproduces three notes being counted as two.

The global tables documentation says that writing to any Region is suitable for MREC when the writes are idempotent assignments, that is, when the next value does not depend on the current one. "Set the last position to minute 42" is safe, and "add 100 to the balance" is not. Editing a note advances a version, so it is the second kind.

## When a Region is cut off

<!-- section: 28.outage -->

If sending writes to Tokyo alone is safe, active-passive would seem to settle the matter. What it does not settle is the moment of the switch.

Suppose Tokyo accepts a write, returns success, and is cut off from the other Regions before that write has reached Osaka.

<<< @/examples/28-multi-region/test/global-table.test.ts{isolation}

The edit Tokyo acknowledged is not gone. It is in Tokyo's replica, and it reaches Osaka when the Regions are connected again. But if the same note has been edited in Osaka in the meantime, Tokyo's edit arrives late, is older, and is discarded. From the user's side, an edit that was saved is missing.

This is why the RPO of MREC is not zero. The documentation says the same: the RPO of MREC equals the replication delay. What can be lost is the writes made in the lag just before the cut. Of those, the ones that actually disappear are writes to items that were overwritten in Osaka after the switch. A new note written only in Tokyo arrives late and stays as it is. The tests check that case too.

The documentation also describes how to move the write Region from Tokyo to another Region when nothing has failed. You stop writes to Tokyo, wait for replication to finish, and then start writing in Osaka. No metric shows with certainty that replication has finished, so the guideline given is to wait about ten times the recent maximum of `ReplicationLatency`.

### Clients that remember the old destination

The same thing happens around a switch even without a cut, because clients and resolvers remember a DNS answer for a while.

<<< @/examples/28-multi-region/test/failover.test.ts{stale-dns}

When the health check decides Tokyo is unhealthy, the function in Tokyo has not necessarily stopped. A client holding the old answer keeps writing to Tokyo, and a client that resolves the name afresh writes to Osaka. Both get a `200`, and the later write remains. How long this window lasts depends on the DNS TTL and on how long clients keep their connections.

The way to close the window is to keep Osaka read-only while it waits.

<<< @/examples/28-multi-region/src/regional-app.ts{regional}

A Region with `WRITES=refuse` answers reads and returns `503` with `retry-after` for writes. With this setting there are no conflicts, but when Tokyo stops, Osaka cannot take writes. To let it, a person deploys the Osaka stack again. The time until someone notices and acts is time the app is down, and how long the deploy itself takes was not measured. That is why the previous page decided not to use this setting by default.

The `x-aih-region` header on a response tells which Region answered. It is useful both for confirming a switch and for investigating a failure.

### When a Region of an MRSC table is alone

In MRSC, a Region that is cut off behaves the opposite way. A Region that cannot reach another Region (a replica or the witness) refuses writes and strongly consistent reads, and answers eventually consistent reads only. The other two Regions keep working as long as they can reach each other. A write that returned success is always in another Region too, so the RPO is zero.

The model's tests check that with Tokyo isolated, Tokyo's API returns `500`, Osaka keeps writing together with the witness, and Tokyo has caught up to version 2 when it returns. The name of the error the SDK throws in an isolated Region could not be confirmed from the documentation, so the model's error has a name of its own.

## Replicating the bucket

<!-- section: 28.bucket -->

Images travel to Osaka by S3 Cross-Region Replication (CRR).

<<< @/examples/28-multi-region/infra/lib/region-stack.ts{bucket}

Replication requires versioning on both buckets. The settings are those of chapter 22's bucket with `replicationRules` added. Giving a bucket a name is unusual in this book. The Tokyo stack names Osaka's bucket as the destination, but there is no way to receive a value from a stack in another Region, so the two stacks build the name by the same rule.

Replication is asynchronous, and there are rules for what is carried. These are the ones from the documentation that matter to this chapter.

- What is carried is objects written after the rule was created. Objects already there are not. Carrying them takes a separate run of S3 Batch Replication
- Delete markers are not carried by default. A setting can turn that on
- A delete that names a version ID is never carried, whatever the settings
- An object created by replication is not carried further by another rule
- A replicated object has the same version ID as the original

The model puts these rules into buckets in memory.

<<< @/examples/28-multi-region/src/bucket-replication.ts{replication}

The rule for delete markers affects what users see after a switch.

<<< @/examples/28-multi-region/test/bucket-replication.test.ts{delete-marker}

With the default, an image deleted in Tokyo is still in Osaka. As chapter 22 showed, that is insurance against a mistaken delete. On the other hand, after a switch to Osaka, users see an image they had deleted. Carrying delete markers too makes the two sides look the same, but mistaken deletes are carried along. Either way the object itself is not erased and only a delete marker is added, so chapter 22's way of restoring works in Osaka as well. This chapter's stack keeps the default and pins it with a test.

S3 states a number for how long replication takes only when S3 Replication Time Control (RTC) is on. RTC says it replicates most objects in seconds and 99.9% of them within 15 minutes. Turning it on is billed by the amount of data replicated and by its metrics, so the stack turns it on only with `-c rtc=on`. Replication of delete markers is outside those 15 minutes.

### The table and the bucket arrive at different speeds

Chapter 22 dealt with the disagreement that appears when the table and the bucket are restored to different moments. Replication produces the same disagreement.

<<< @/examples/28-multi-region/test/bucket-replication.test.ts{skew}

Chapter 07 puts the image's bytes in place first and writes the attachment record afterwards. Inside Tokyo, if the record is there, so is the image. In Osaka, the record can arrive in a second while the image has not arrived yet. If the switch happens at that moment, users in Osaka see an attachment that will not open.

Chapter 22's check finds this kind of disagreement as an attachment record without an image. After a switch, you would run the check in Osaka and decide whether to wait for Tokyo to return and replication to catch up, or to delete the record. This chapter does not build that procedure.

### Replication in the other direction

In the default setup, replication goes one way, from Tokyo to Osaka. An image written in Osaka after a switch does not come back to Tokyo. With `-c back=on`, Osaka's bucket gets a rule towards Tokyo as well. An object created by replication is not carried further, so the same object does not keep circling between the two rules.

The role for replication is written out by hand.

<<< @/examples/28-multi-region/infra/lib/region-stack.ts{replication-role}

Left to CDK, the role gets one fixed name, `CDKReplicationRole`. IAM roles share one namespace per account, so two stacks would both try to create a role with that name and collide. The list of actions is what the S3 documentation requires of a replication role.

## Route 53 health checks and where requests go

<!-- section: 28.routing -->

Route 53 does the switching. You create two records with the same name and tie a health check to each.

A health check decides in two stages. Checkers in locations around the world send requests to the endpoint at the interval you chose (30 seconds or 10), and each one decides according to the number of consecutive failures that make it consider the endpoint unhealthy (the failure threshold, 3 by default). Then Route 53 gathers the checkers' opinions, and considers the endpoint healthy while more than 18% of them say so. The documentation says the 18% figure may change.

<<< @/examples/28-multi-region/src/failover.ts{health-check}

For an HTTPS health check, a checker must be able to connect within four seconds and must receive a 2xx or 3xx within two seconds of connecting. If a response that includes a cold start is slower than that, it counts as one failure for that checker. With a failure threshold of 3, one slow response does not change its opinion.

Which record is returned depends on the routing policy.

<<< @/examples/28-multi-region/src/failover.ts{answer}

Failover routing returns the primary while it is healthy and the secondary when it is not. When both are unhealthy, Route 53 goes back to considering every record healthy, so the primary is returned. The idea is that answering with something is better than answering with nothing.

Latency routing returns, among the healthy records, the Region with the lowest latency from the user. This is an active-active setup, and users are split between those who write to Tokyo and those who write to Osaka. As the previous sections showed, with an MREC table one of two edits disappears when they are split between two Regions.

### What the health check calls

The health check's target is one path inside the function.

<<< @/examples/28-multi-region/src/regional-app.ts{health}

This path reads one note that does not exist from the replica in its own Region. If the read works it answers `200`, and if not, `503`. That confirms that the table, the network path, and the role's permissions are working in that Region.

What to check needs a careful decision. Chapter 05's `/health` always returns `200` while the function runs, so the destination would not change even with the table unavailable. In the other direction, checking too much moves traffic on unrelated, passing failures. The API Gateway documentation says the same: evaluating the target health of an alias record alone switches only when API Gateway itself is unavailable in the Region, so to switch on failures of your own API, set up your own health check.

The function is put together the way the earlier chapters do it.

<<< @/examples/28-multi-region/src/lambda.ts{handler}

This chapter adds three environment variables. The third, `HEALTH`, is for the failover drill.

<<< @/examples/28-multi-region/src/env.ts{env}

## Putting numbers on RTO and RPO

<!-- section: 28.objectives -->

Chapter 22 treated RTO (how soon service is back) and RPO (how much data may be lost) as things a drill measures. This chapter decides the targets for a Region that stops responding in advance, as numbers.

<<< @/examples/28-multi-region/src/objectives.ts{targets}

Here is what each number rests on.

**The RTO is 300 seconds.** The time an automatic switch takes can be divided into three parts.

<<< @/examples/28-multi-region/src/objectives.ts{budget}

Detection is the health check's interval multiplied by the failure threshold: 30 seconds three times, 90 seconds. Next is the time for which DNS answers stay old. You cannot set the TTL of an alias record yourself. Route 53 decides it according to the target resource. The value for a record that points to an API Gateway domain name was not found in the documentation. The budget assumes 60 seconds, the lower end of the TTL range Route 53 recommends. Last is the time a client spends on its own cache, on connections it keeps open, and on retries, also assumed to be 60 seconds. Together that is 210 seconds, which leaves 90 seconds within the 300-second target.

The only certain part of this breakdown is that the first 90 seconds can be computed from the configuration. The other two are assumptions, and nobody knows them until a switch is actually made and timed. The breakdown is a function so that a test can show whether a changed assumption goes past the target. With a record whose TTL is 300 seconds, for instance, the target is missed however fast the health check is.

**The RPO for notes is 60 seconds.** The RPO of MREC is the replication lag itself. The documentation says it is usually within a second, and that there is no SLA. Sixty seconds was chosen as a value far above the ordinary lag, past which something can be said to be wrong. To keep it, put an alarm on the `ReplicationLatency` metric and tell a person when it goes past 60 seconds. A switch that happens while it is past that loses more than the target.

**The RPO for images is 900 seconds.** S3 states a number for replication time only with RTC on, and that number is 15 minutes. The default stack does not turn RTC on, so holding this target means adding `-c rtc=on`. Even with RTC the number is about 99.9% of objects, so the rest can take longer than 15 minutes.

<<< @/examples/28-multi-region/src/objectives.ts{rpo}

The thing to remember about RPO is that the amount of data lost is decided by the replication lag at the moment of the switch. A lag that is ordinarily one second may have grown in the middle of a failure. You know whether a target is being kept only while you are watching the lag.
