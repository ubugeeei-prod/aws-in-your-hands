---
title: Distributed Systems Guide
sourceRevision: 1
---

# Distributed Systems Guide

The samples in this book are small, but each one runs across several places: the browser, the CDN's edge locations, a function's execution environments, a database. Each holds state from a different point in time, and each fails separately.

This page collects where that topic appears in the book. It is not confined to the chapters on distributed databases.

## What each chapter checks

For an example that holds state, the chapter answers these questions.

1. **Who owns the state?** Which copy of the data is the correct one
2. **Which path do reads and writes take?**
3. **What is the consistency guarantee, and over what scope does it hold?** One read, one session, one Region, or everything
4. **What happens on concurrent updates?**
5. **What happens when the same message arrives twice?**
6. **If the connection drops before the response comes back, did the operation happen or not?**
7. **If it stops after only part of it succeeded, how do you get back?**
8. **What additional cost does that bring?**

The chapter then states the property it wants to keep (the invariant) in one plain sentence, and adds a test that tries to break it.

The book does not infer guarantees from a service's name. Words such as global, serverless, durable, and exactly-once promise nothing on their own.

## What the finished chapters contain

| Chapter | Owner of the state | invariant | How it breaks, and the test that shows it |
| --- | --- | --- | --- |
| [02](/en/chapters/02-toolchain.md) | The CDK code (and the template built from it), cdkd's state, and the actual resources in AWS | The three agree | Someone changes a setting in the console. `tools/src/drift/report.test.ts` classifies drift, deletion, uncompared resources, and failed detection separately |
| [03](/en/chapters/03-spa.md) | The S3 bucket. The edge cache and the reader's browser are copies | The files referenced by the `index.html` a reader holds can always be fetched | A publish stops partway. A reader still has an old page open. `tools/src/site/plan.test.ts` checks the upload order and that old assets are kept |
| [04](/en/chapters/04-http-api.md) | Individual Lambda execution environments (there are several, and each disappears at some point) | This chapter pins "not shared" as the specification | Concurrent requests reach different execution environments. `examples/04-http-api/test/app.test.ts` checks that two instances do not share notes |
| [06](/en/chapters/06-auth.md) | "Who" is in the token; "has it been disabled" is in Cognito. API Gateway looks at the token only | A request can read and write only the notes owned by its token's `sub` | Another user names the ID, or writes an owner into the request. `examples/06-auth/api/test/app.test.ts` checks that both are refused. That a revoked token passes until it expires is explained in the prose, not by a test |
| [05](/en/chapters/05-dynamodb.md) | The DynamoDB table | Every successful save moves the version by exactly one, and an update based on an old version is refused | Two writes hold the same version. A response is lost after the write and the caller retries. `examples/05-dynamodb/test/repository-contract.ts` and `test/app.test.ts` check that only one gets through and that a retry does not move the version twice. That a retried create makes a duplicate is recorded as the specification too |

All of these are local tests. The chapter 05 checks have not yet been run against DynamoDB even once. Their advantage is that they reproduce a failure in a fixed order, but what they check is the decisions made by this book's code, not the behavior of AWS services. Actual propagation delay, how execution environments scale out, and IAM propagation can be checked only in a real environment.

## Chapters still to be written

| Topic | Chapter | Central question |
| --- | --- | --- |
| Writes that span two stores | [07](/en/chapters/07-uploads.md) | When only one side succeeds, what is left behind? |
| Duplicate delivery, retries, and idempotency | [08](/en/chapters/08-async.md) | If the same message arrives twice, is there still one result? |
| Cache and source data out of step | [09](/en/chapters/09-ssr.md), [14](/en/chapters/14-kv-cache.md) | Whose content, and how stale, is acceptable to return? |
| Delay in propagation to the edge | [10](/en/chapters/10-edge.md) | Right after a write, can every location read it? |
| Multiple AZs and multiple Regions | [11](/en/chapters/11-network.md), [12](/en/chapters/12-containers.md) | What scope of failure is this prepared for? |
| SQL conflicts and retries | [13](/en/chapters/13-sql.md) | When a commit fails on a conflict, what is redone? |
| Interruption and resumption | [16](/en/chapters/16-long-jobs.md) | When an operation that stopped partway is resumed, is the output free of duplicates? |
| A stream that is cut off partway | [17](/en/chapters/17-ai.md) | Keep the partial output, or discard it? |
| A deploy that fails partway | [20](/en/chapters/20-shipping.md) | From a partly updated state, how do you go forward or back? |
| Replication, backup, and restore | [22](/en/chapters/22-recovery.md) | Is having a replica the same as having restored successfully? |
| Operating stateful nodes | [24](/en/chapters/24-celld.md) | After a node is lost, who owns its objects? |

The book does not assume multiple Regions from the first API. It proceeds in this order: a small ordinary example, then how that example fails, then a deeper lab if one is needed.

Experiments that cause failures in a real environment are kept apart, in a dedicated environment and in tasks that you run explicitly. The everyday `vp run check:all` does not touch AWS.
