---
title: "28 Multi-Region: Run It Locally"
---

# 28 Multi-Region: Run It Locally

## Run it locally

<!-- section: 28.local -->

The scenes of the [previous page](/en/chapters/28-multi-region/build.md) can be watched in order on your own machine, without an AWS account.

```bash
vp run mr:demo
```

This task puts chapter 05's API once in each of two Regions kept in memory, and runs them.

<<< @/examples/28-multi-region/src/local.ts{world}

Edits are sent as the same `PUT` requests the real API receives.

<<< @/examples/28-multi-region/scripts/demo.ts{edit}

This is the output.

```text
1. Eventual mode (MREC). Two people edit version 1, one in each Region.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 200 from ap-northeast-3
  ap-northeast-1 holds: "bread", version 2
  ap-northeast-3 holds: "bread", version 2
  Both were told 200. One edit is gone, and no response said so.

2. Eventual mode, every write sent to Tokyo.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 409 from ap-northeast-1
  Chapter 05's check works again, because one copy sees both writes.

3. Eventual mode. Tokyo acknowledges an edit and is cut off before it replicates.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 200 from ap-northeast-3
  writes waiting for the two Regions to reconnect: 2
  ap-northeast-1 holds: "bread", version 2
  ap-northeast-3 holds: "bread", version 2
  Tokyo's edit arrived an hour late and lost to the newer one.

4. Strong mode (MRSC), three Regions. The same two edits.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 409 from ap-northeast-3
  PUT "butter" (expects version 1) -> 500 from ap-northeast-1
  The second edit gets its 409. Alone, Tokyo fails the request instead of guessing.

5. The bucket. An image is deleted in Tokyo; another is uploaded 2 s before an outage.
  in Osaka: deleted image present, new image missing
  waiting in Tokyo: 1 object

6. The targets, and what they are made of.
  RTO 300 s: detect 90 s + DNS 60 s + client 60 s = 210 s (within)
  RPO notes 60 s, images 900 s. Assumed, not measured.
```

Compare scenes 1 and 2. The two edits are the same, and the only difference is which Region the second one was sent to. Sent to Osaka, it gets a `200` and one edit disappears. Sent to Tokyo, it gets a `409`. In scene 4 it gets a `409` even when sent to Osaka, because the consistency mode leaves one place where the condition is checked.

The `500` at the end of scene 4 is isolated Tokyo failing the request where it could have answered with a guess. In MRSC, a Region that cannot work does not hide it. In scene 3, under MREC, both Tokyo and Osaka keep returning `200` while cut off. Keeping on working during a failure and not disagreeing afterwards cannot both be had.

The tests run with the same task as in the other chapters.

```bash
vp run test:unit
```

Here is what the model and the tests do not reproduce. The real time replication takes, and how much it varies. How DynamoDB treats two writes with the same time. The error MRSC returns for a write to an item that another Region is changing. A Region that is only half broken, for example DynamoDB working while API Gateway is not. The real number and placement of Route 53's checkers, DNS TTLs, and client caches. A failed S3 replication (`FAILED`). And IAM. All of these can be checked only against the real services.
