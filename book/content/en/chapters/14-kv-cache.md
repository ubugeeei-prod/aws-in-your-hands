---
title: "14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration"
sourceRevision: 4
---

# 14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration

If you have used Workers KV on Cloudflare, the first thing you look for on AWS is its KV. AWS has no single product in that role. DynamoDB, ElastiCache, and CloudFront KeyValueStore all look up a value by key, and none of them can stand in for another.

In this chapter you implement a rate limit and a cache for a list behind the same interfaces on both DynamoDB and Valkey, and use tests to see where the two differ.

One note about cost before you start. Without any option, this chapter's stack costs nothing while it sits idle. Only `-c store=valkey` creates an ElastiCache Serverless cache, and that cache costs USD 7.37 a month even if nobody calls it. If you try it, delete it the same day by following [Cleaning up](/en/chapters/14-kv-cache/wrap.md).

You need [chapter 05](/en/chapters/05-dynamodb.md) (DynamoDB), [chapter 10](/en/chapters/10-edge.md) (CloudFront KeyValueStore), and [chapter 11](/en/chapters/11-network.md) (VPC). The code is in `examples/14-kv-cache/`.

## What stands in for KV on AWS

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

Lambda memory, in the fourth row, is not a KV product, but it is the cheapest cache you have, so it is listed with the others. In broad terms the four behave like this.

- DynamoDB is storage that can own data. A value whose write succeeded is on disk, and conditional updates make it usable for counting. While you are not using it, you pay only for what it stores
- Valkey is a server that runs in memory. It is fast, it removes expired values by itself, and it comes with operations for counting and ranking. In exchange, the server costs money just by existing, and its contents can disappear
- CloudFront KeyValueStore is a small configuration table for edge functions to read, and functions cannot write to it
- Lambda memory belongs to one execution environment and is not shared with any other

If Workers KV is what "KV" means to you, you are thinking of something you can read from anywhere, write to easily, and that reaches the whole world a little late. None of these four matches that description. So you choose by asking what data you want to store, not which product is the KV. The table for that choice is under "Which one to choose" on [the last page](/en/chapters/14-kv-cache/wrap.md).

## Two exercises, swappable stores

<!-- section: 14.interface -->

You build one small API, in which `GET /items` returns a list of products. The API gets two additions.

- A rate limit. Each source IP address gets 5 calls a minute, and further calls get a 429
- A cache for the list. The source of the list is slow by design, so the API keeps a copy for 30 seconds

The two have opposite needs. A rate limit's count is worthless unless it is accurate, and a cached copy can vanish without harm. Both are things you would put in a KV, but they ask different things of the store.

Each one therefore has its own interface. The counting side comes first.

<<< @/examples/14-kv-cache/src/stores.ts{counter}

There are only two operations. The one that matters is the promise `incrementBelow` makes, which is that the store adds 1 if the count is below `cap` as a single step inside the store. The next page explains why it has to be a single step, under ["Read, then write, and you miscount"](/en/chapters/14-kv-cache/build.md).

The cache side comes next.

<<< @/examples/14-kv-cache/src/stores.ts{cache}

`get` takes `now` because of DynamoDB. DynamoDB does not delete an expired item right away, so the reader checks the expiry. The TTL section on the next page has the details.

Each interface has three implementations, for memory, DynamoDB, and Valkey. Contract tests in `test/store-contracts.ts` check that all three behave the same. As with the repository in chapter 05, one set of tests runs against each implementation in turn.

## Counting for a rate limit

<!-- section: 14.rate-limit -->

The simplest way to count is to cut time into one-minute periods and count within each period. This is called a fixed window.

<<< @/examples/14-kv-cache/src/rate-limit.ts{window}

You get the start of a window by dividing the time by the window length and subtracting the remainder from the time. Every Lambda execution environment with a sane clock arrives at the same window.

<<< @/examples/14-kv-cache/src/rate-limit.ts{limiter}

`hit` takes the time as an argument and never calls `Date.now()`. A test can therefore try the last millisecond of a window, or the first millisecond of the next, without waiting.

The tests in `test/rate-limit.test.ts` pin boundaries such as these.

- With a limit of 3, the third request passes and the fourth does not
- A request is still refused in the last millisecond of a window and passes in the first millisecond of the next
- Of 20 requests that arrive at once, exactly 5 pass

### The fixed window's weak spot, and the sliding window

A fixed window has a well-known weakness, which is that twice the limit can pass around a window boundary.

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

When 5 requests arrive at the very end of one window and 5 more at the start of the next, 10 requests pass within two seconds. A test states exactly that ("lets 2 x limit through in two seconds around a boundary"). This is not a bug. It is a property every fixed window has.

If that property is a problem, use a sliding window. A sliding window adds to the current window's count the share of the previous window that still falls within the last minute. When the current window is 25% over, it counts 75% of the previous one. `slidingCap` does that calculation, and `RATE_ALGORITHM=sliding` switches to it.

A sliding window reads the previous window once per request, so it costs one more store operation. It is also an approximation, because it assumes that the requests in the previous window arrived evenly. Choose between the two by whether twice the limit passing at a boundary does real harm. A sliding window suits counting login attempts, and a fixed window is enough if you only want to keep API usage roughly in check.
