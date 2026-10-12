---
title: "14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration"
sourceRevision: 2
---

# 14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration

People who have used KV on Cloudflare arrive at AWS with one question: "Which one is the AWS KV?"

The answer is that there isn't one. DynamoDB, ElastiCache, CloudFront KeyValueStore: each of them looks up a value by key, and none of them is a drop-in for another. In this chapter you'll implement two things, a rate limit and a cache for a list, behind one interface on both DynamoDB and Valkey, and let the tests show where they differ.

One note about money up front. Left as it is, this chapter's stack **costs nothing while it sits idle**. Only with `-c store=valkey` does it create an ElastiCache Serverless cache, and that one costs USD 7.37 a month without a single call. If you try it, delete it the same day. "Cleaning up" at the end of the chapter tells you how.

You'll need [chapter 05](/en/chapters/05-dynamodb.md) (DynamoDB), [chapter 10](/en/chapters/10-edge.md) (CloudFront KeyValueStore), and [chapter 11](/en/chapters/11-network.md) (VPC). The code is in `examples/14-kv-cache/`.

## "Which one is the AWS KV?" Answered first

<!-- section: 14.three -->

```text
                 where it runs          who may write          a value lives until
DynamoDB         one Region, on disk    your code (IAM)        you delete it (TTL: days late)
Valkey           one Region, in memory  your code (IAM/ACL)    its expiry, eviction, or a failover
  (ElastiCache)
CloudFront       every edge location    an API call from       you change it
  KeyValueStore                         outside the function   (functions only read)
Lambda memory    one execution          that environment       the environment is discarded
                 environment            only
```

The fourth row isn't a KV product, but it is the cheapest cache you have, so it belongs in the picture.

Roughly:

- **DynamoDB** is storage that can own data. Once a write succeeds, it is on disk. It has conditional updates, so it can count. While unused it costs only what it stores
- **Valkey** is a server in memory. It is fast, it cleans up expired keys by itself, and counting and ranking come built in. In exchange the server costs money just by existing, and what is in it can disappear
- **CloudFront KeyValueStore** is a small configuration table for edge functions to read. Functions cannot write to it
- **Lambda memory** belongs to one execution environment. It is not shared

If Workers KV is what "KV" means to you, you are picturing something you can read from anywhere, write easily, and that reaches the world a little late. None of these four matches that. So the question to ask is not "which one is the KV" but "what is the data I want to put somewhere". The table at the end of the chapter is built for that question.

## Two exercises, swappable backends

<!-- section: 14.interface -->

You'll build one small API. `GET /items` returns a list of products, with two mechanisms attached:

- **A rate limit.** Five calls a minute per source IP address, then 429
- **A cache for the list.** The source of the list is slow (by design), so a copy is kept for 30 seconds

The two are opposites. A rate limit's count is **worthless unless it is accurate**. A cached copy **may vanish at any time**. Both are "things you put in a KV", and they ask different things of the store.

Each gets its own interface. First the counting side.

<<< @/examples/14-kv-cache/src/stores.ts{counter}

Two operations, that's all. The one that matters is the promise of `incrementBelow`: "add 1 if below `cap`" has to happen **as a single step inside the store**. You'll see why in a moment.

Then the cache side.

<<< @/examples/14-kv-cache/src/stores.ts{cache}

Passing `now` to `get` may look odd. It is there for DynamoDB, and the TTL section explains it.

Both interfaces have three implementations: memory, DynamoDB, and Valkey. That they all behave the same is checked by contract tests (`test/store-contracts.ts`): one set of tests, run against each implementation in turn. The same approach as the repository in chapter 05.

## Counting for a rate limit

<!-- section: 14.rate-limit -->

The simplest way to count is to cut time into one-minute periods and count per period. That is a fixed window.

<<< @/examples/14-kv-cache/src/rate-limit.ts{window}

The start of a window is the time minus its remainder when divided by the window length. Every Lambda execution environment with a sane clock computes the same window.

<<< @/examples/14-kv-cache/src/rate-limit.ts{limiter}

`hit` takes the time as an argument and never calls `Date.now()`. That lets a test try "the last millisecond of a window" or "the very first of the next" without waiting.

The tests in `test/rate-limit.test.ts` pin boundaries like these:

- With a limit of 3, the third request passes and the fourth does not
- A request is still refused in the last millisecond of a window and passes in the first millisecond of the next
- Of 20 simultaneous requests, exactly 5 pass

### The fixed window's weak spot, and the sliding window

The fixed window has a well-known weakness.

```figure
caption: With a limit of 5 per minute, the fixed window lets all 10 requests around a boundary through, and the sliding window refuses the second 5
type: sequence
actor fixed: fixed window
actor req: requests
actor sliding: sliding window
step req -> fixed: 5 requests at 0:59 (window 1)
step req -> sliding: 5 requests at 0:59
step req -> fixed: 5 more at 1:01 (window 2)
note fixed: all 10 pass
note fixed: each window saw only 5
step req -x sliding: 5 more at 1:01: refused
note sliding: the last 60 s already hold 5
```

Across a boundary, twice the limit passes within two seconds. There is a test that says exactly that ("lets 2 x limit through in two seconds around a boundary"). It isn't a bug; it is what a fixed window is.

If that hurts, use a sliding window. It also counts the previous period, in proportion to how much of it still falls within "the last minute". A quarter of the way into the current period, it counts 75% of the previous one. `slidingCap` is that calculation, and `RATE_ALGORITHM=sliding` turns it on.

A sliding window reads the previous period once per request, so it costs one more store operation. It is also an approximation: it assumes the requests of the previous period were spread evenly. Choose by whether "twice the limit at a boundary" does real harm. For login attempts, slide. For keeping API usage roughly in check, a fixed window is enough.
