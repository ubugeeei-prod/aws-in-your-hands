---
title: "14 KV Store: Caches, DynamoDB, ElastiCache/Valkey, and Edge Configuration"
sourceRevision: 1
---

# 14 KV Store: Caches, DynamoDB, ElastiCache/Valkey, and Edge Configuration

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

- **A rate limit.** Five calls a minute per caller, then 429
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

## Read, then write, and you miscount

<!-- section: 14.atomic -->

Written the obvious way, a rate limit goes: "Read the count. If it is below the limit, write the count plus one."

That breaks when two requests arrive together.

```figure
caption: With a limit of 1, two requests that read and then write at the same time both pass, and one increment is lost
type: sequence
actor a: request A
actor store: stored count
actor b: request B
note store: 0
step a -> store: t1 read count: 0
step b -> store: t2 read count: 0
step a -> store: t3 0 < 1, write 1
note store: 1
step b -> store: t4 0 < 1, write 1
note store: 1 (one increment lost)
note a: allowed
note b: allowed
```

Both read "zero so far", and both pass. The stored count is still 1. The limit was broken, and no record of it remains.

One test reproduces this in a fixed order. It builds a store that reads and then writes on purpose, and holds both writes until both reads are done.

<<< @/examples/14-kv-cache/test/rate-limit.test.ts{lost-update}

There is one fix: make the read and the write a single step inside the store. In DynamoDB it looks like this.

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{increment}

`ADD #hits :one` says "add 1 to whatever is there". Your code reads nothing; DynamoDB does the addition. The condition expression from chapter 05 then narrows it to "only while below the cap". DynamoDB evaluates the condition and applies the addition as one operation. When two requests arrive together, one is applied first and the other is judged against its result.

A unit test pins this "add without reading" shape: exactly one `UpdateItem` is sent, with no read before it. And the contract test "of 50 at once, exactly 20 pass and the count is 20" passes against DynamoDB Local.

Two things you should know.

**A refused request is billed too.** A write whose condition fails still consumes one write unit. Someone hammering past the limit generates DynamoDB charges for every attempt. The place to absorb a flood is further out, such as API Gateway throttling, not here.

**The addition is not idempotent.** Suppose the write succeeds and the response is lost. The SDK retries and adds one more: a single request counted twice. For a rate limit that only means a caller loses one call, so the sample leaves it. Don't count money or stock this way. That needs the technique from chapter 05's "When the response never arrives": give the same operation the same ID.

## TTL does not mean "delete now"

<!-- section: 14.ttl -->

A rate limit item is useless once its window has passed. A cached copy is useless once it has expired. Left alone they pile up in the table, so you use DynamoDB's TTL (time to live): write "this may be deleted after this time" on the item in Unix seconds, and DynamoDB deletes it for you, at no write cost.

Here's the catch. **Nothing is deleted at the moment it expires.** The documentation's wording is "within a few days of their expiration time". And until it is deleted, the item reads like any other.

If you are used to expiry in Valkey or Workers KV, you'll assume an expired entry simply doesn't come back. In DynamoDB it does. So the reader checks.

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{cache-get}

That is why `get` takes `now`. Whether an entry has expired is decided by the reader's clock, not by DynamoDB. TTL is for housekeeping and nothing else.

A test pins it.

<<< @/examples/14-kv-cache/test/dynamodb-store.test.ts{ttl-test}

Each item carries two expiries. `expiresAtMs` is in milliseconds, for the reader's check. `expiresAt` is in seconds, for DynamoDB's cleanup, because a TTL attribute has to be in seconds.

The same thing applies to the lock that appears later. An expired lock is still in the table, so "free to take" has to include "present but expired", not only "absent".

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{lock}

The rate limit, by the way, doesn't care how late TTL is. Its key contains the start of the window, so an old window's item is invisible to a new window whether it has been deleted or not. Design so that correctness never depends on TTL, and "a few days" stops being your problem.

To be honest, I haven't measured how long real DynamoDB takes to delete an item.

## The same thing on Valkey

<!-- section: 14.valkey -->

Valkey is a key-value server that runs in memory. The project was forked from open source Redis right before its license changed, and Redis commands work as they are. It is one of the engines ElastiCache runs, next to Redis OSS and Memcached.

Valkey has an "add one" command too (`INCR`). What it lacks is a single command for "add one only while below a cap". So that becomes a small script.

<<< @/examples/14-kv-cache/src/valkey-store.ts{scripts}

Valkey runs a script from start to finish with no other command in between. It gives the same guarantee as DynamoDB's "condition and update in one step", by a different route.

The cache is more direct.

<<< @/examples/14-kv-cache/src/valkey-store.ts{valkey-cache}

`get` doesn't use `now`. Valkey stops returning a key once it has expired (its documentation puts the error at 0 to 1 millisecond), so the reader has nothing to check. This is where the difference from DynamoDB shows most clearly.

The price is that the clock changes hands. Expiry is judged by the Valkey server's clock, and a test cannot replace that. The contract tests really do wait when they run against Valkey (`test/local-stores.test.ts`). Memory and DynamoDB accept a fake clock; Valkey doesn't. The difference is right there in the tests.

The other big difference: **what is in Valkey can disappear.** ElastiCache Serverless replicates data across Availability Zones asynchronously. Asynchronous means that a failure right after a write was acknowledged can lose that write. And at the storage maximum, keys with an expiry are evicted. When a rate limit count disappears, that caller gets a fresh allowance. Whether you can live with that decides whether counts belong in Valkey.

## What ElastiCache adds

<!-- section: 14.elasticache -->

A local Valkey is one container. On AWS there is more to decide.

### Node-based or Serverless

ElastiCache comes in two shapes.

| | Node-based | Serverless |
| --- | --- | --- |
| You decide | Node type, node count, which zones | A name (limits are optional) |
| Price | Per node-hour. One `cache.t4g.micro` (Valkey) in Tokyo is USD 14.60 a month | Data stored (GB-hours) and ECPUs. Valkey's 100 MB minimum is USD 7.37 a month |
| Network | Inside a VPC only | Inside a VPC, or a public endpoint |
| TLS | Your choice | Always on |
| Cluster mode | Your choice | Enabled only; the client has to support it |

Both **cost money without being called**. This is not "zero when unused" like DynamoDB or Lambda. If the word Serverless makes you expect pay-per-use only, this is where it goes wrong. The pricing page is plain about it: billing starts when the cache becomes available and continues until you delete it.

### The VPC is no longer required

As chapter 11 said, a node-based cluster lives inside a VPC and nowhere else. To reach it, a Lambda function has to join the VPC and loses its route to the internet. This chapter's outline originally said "Valkey brings a VPC".

Reading the current documentation again, ElastiCache Serverless has two connection types: VPC and public. A public endpoint is reached over the internet, with no VPC. It is available only on Serverless with Valkey 9.0 or later.

This chapter's stack uses the public endpoint, because it keeps the function out of a VPC. The function runs where it did in earlier chapters and calls DynamoDB the same way. The VPC variant (connection type `vpc`, subnets and security groups passed in, the function attached to chapter 11's VPC) is not in this chapter's code.

"A cache reachable from the internet" should make you wary. It comes with two conditions:

- **Every connection needs IAM authentication.** Password users are not allowed: the user group attached to the cache may contain only users that authenticate with IAM
- **TLS 1.3 is required.** An older handshake fails

So what protects it is not a network wall but IAM. That is the same thinking as "what does this role allow", which you have applied since chapter 04.

### A signature instead of a password

With IAM authentication you send a token that is valid for 15 minutes in place of a password. The token is a URL signed with SigV4.

<<< @/examples/14-kv-cache/src/elasticache-token.ts{token}

This function talks to nobody. It signs with whatever credentials it has, and ElastiCache verifies the signature when it receives it. Inside Lambda that means the execution role's credentials. The role needs `elasticache:Connect` on both the cache and the ElastiCache user.

The reference implementation in the AWS documentation is Java, and I found no official building block for Node.js (GLIDE, the official Valkey client, generates and refreshes the token itself). The code above follows the Java version. A test recomputes SigV4 by hand and checks that the signatures match. But **this token has never been presented to a real ElastiCache cache.**

### Why the client is iovalkey

I checked two Valkey clients for Node.js on npm.

- `@valkey/valkey-glide` 2.5.3: the official Valkey client, with IAM authentication built in. Its core is Rust, shipped as native packages per OS and CPU
- `iovalkey` 0.4.0: a client forked from ioredis, written in JavaScript only

This book bundles Lambda code into one file with esbuild at synth time, without Docker. A native package needs a different build on the machine that bundles (macOS, say) and the place that runs it (Linux on arm64), which doesn't sit well with that. So the sample uses iovalkey. GLIDE would probably need less authentication code. If you run in a container ([chapter 12](/en/chapters/12-containers.md)), choose again.

<<< @/examples/14-kv-cache/src/valkey-client.ts{elasticache}

Choosing iovalkey has one cost. It takes the password as a fixed string, so a reconnect after 15 minutes would send a stale token. The sample replaces the connection every 10 minutes instead.

<<< @/examples/14-kv-cache/src/valkey-client.ts{rotating}

One more piece: something to keep a silent cache from dragging the request down with it.

<<< @/examples/14-kv-cache/src/valkey-client.ts{deadline}

It waits one second at most. After that the request carries on as if there were no cache. Without it, a cache outage reaches the caller as a wait as long as the Lambda timeout (10 seconds).

## Cache only what you can afford to lose

<!-- section: 14.cache -->

On to the other exercise, the cache for the list.

A cache has one rule. **The source of truth is right, and the cache is a copy of it.** A copy may disappear at any time, and can be made again from the source. Data for which that doesn't hold has no business in a cache.

The source of truth sits behind this interface.

<<< @/examples/14-kv-cache/src/catalog.ts{source}

To be honest, this source is a prop: a fixed list returned after a deliberate 300 ms delay. In a real system it would be an aggregate query from [chapter 13](/en/chapters/13-sql.md) or another team's API. A cache pays off when the source is slow or billed per call, so this stands in for that.

The reading pattern is read-through: read the cache first; on a miss, read the source and put a copy in the cache.

<<< @/examples/14-kv-cache/src/read-through.ts{optional}

The `try` is the point. With the cache down, slow, or holding something unreadable, the request answers from the source. Slower, never wrong. "The cache is down, so the API returns 500" is what happens when a cache gets treated as an owner.

The response says when the list left the source.

<<< @/examples/14-kv-cache/src/contract.ts{list}

The `x-cache` header says `hit` or `miss`, and the `age` header says how many seconds old the copy is. Give callers a way to know how stale an answer might be from day one.

### Reproducing a stale read

Once there is a cache, there is always a period in which it disagrees with the source: a stale read. The simplest form first.

<<< @/examples/14-kv-cache/test/read-through.test.ts{stale}

The first test shows `v1` still coming back after the source changed to `v2`, until the TTL runs out. That isn't a defect; it is what you accepted when you chose a 30-second TTL.

The second shows that when the writer deletes the cached entry, the next read is fresh. "Change the source, then invalidate the cache" is the usual countermeasure.

The third is the interesting one. **Even with invalidation, an old value can stay.**

```figure
caption: When the writer updates and invalidates while the reader is still asking the source, the old value goes into the cache and every reader gets it until the TTL passes
type: sequence
actor reader: reader
actor cache: cache
actor source: source
actor writer: writer
note cache: (empty)
note source: v1
step reader -> cache: t1 miss
step reader -> source: t1 asks the source
step writer -> source: t2 updates the source
note source: v2
step writer -> cache: t3 invalidates
note cache: (empty): nothing there
step source --> reader: t4 receives "v1"
step reader -> cache: t4 stores "v1"
note cache: v1 (source is v2)
note cache: t5 "v1" until the TTL
```

While the reader is still waiting for the source, the writer updates and invalidates. Then the reader's old answer lands in the cache, and nobody comes to delete it again.

This chapter's code has nothing that fully prevents that. There are ways, such as comparing versions before writing, and they add complexity. The chapter's position is this: **invalidation shortens the stale period; the TTL is what bounds it.** So pick a TTL of which you can say "being this old, at worst, is fine". Data for which you can't say that (balances, stock, permissions) is read from the source, uncached.

## The moment it expires, everyone arrives at once

<!-- section: 14.stampede -->

The better a cache works, the more dangerous one moment becomes: the moment the copy expires.

If 100 requests are in flight right then, all 100 miss, and all 100 go to the slow source. The source the cache was protecting takes the heaviest load of all. That is a cache stampede.

A test sets up ten execution environments missing at once and checks that the source is asked ten times ("sends every caller to the source when nothing coordinates them"). First pin down what happens.

The sample has three countermeasures.

### Inside one process, share the load

If a load of the same key is already running, don't start another; wait for its result. This is called single flight.

<<< @/examples/14-kv-cache/src/read-through.ts{single-flight}

<<< @/examples/14-kv-cache/test/read-through.test.ts{single-flight-test}

It only works inside one process, though. And Lambda provisions a separate execution environment for each concurrent request, so one environment handles one request at a time. **On Lambda, single flight has almost nothing to do.** It earns its keep in a container or a long-running server ([chapter 12](/en/chapters/12-containers.md)). It is here so that the code stays the same in both places.

### Across environments, put a lock in the store

To make it work on Lambda, put up a sign where everyone can see it: "refill in progress".

<<< @/examples/14-kv-cache/src/read-through.ts{lock}

Only the request that gets the sign reads the source. The others wait a little and read the cache again.

<<< @/examples/14-kv-cache/test/read-through.test.ts{lock-test}

One thing about this lock matters a great deal. **It is not a lock that protects correctness.** It has an expiry, and if its holder freezes or dies it lets go by itself. Two requests might then refill at the same time. That is fine: both read the same source and write the same copy. What this lock reduces is load, not errors.

That is also why waiting has a limit. If the holder never returns, a request waits the agreed number of times and then reads the source itself. The tests "does not wait forever for a lock holder that died" and "goes to the source after waiting as long as it was told to" cover that.

### Spread the expiries

There is one more trick, simple and effective: add jitter to the TTL.

<<< @/examples/14-kv-cache/src/read-through.ts{jitter}

Right after a deploy, or after the cache was emptied, many keys are written in the same instant. With identical TTLs they all expire in the same instant 30 seconds later. Add 0 to 20% of jitter and the expiries spread out.

<<< @/examples/14-kv-cache/test/read-through.test.ts{jitter-test}

The random source is an argument, so the test passes fixed values and can state "exactly one of the five has expired".

This chapter's API has a single key, so jitter has nothing to do here. It starts to matter with more keys: a list per user, a list per page.

## Lambda memory is a cache too

<!-- section: 14.memory -->

Remember "Where do the notes live?" in chapter 04? Whatever you keep in Lambda's memory is separate per execution environment, and you don't choose when it goes away. The conclusion then was "it cannot own data", with a note that "it can still serve as a cache". This is the follow-up.

<<< @/examples/14-kv-cache/src/lambda.ts{handler}

With `KV_STORE=memory`, both the counts and the copies go into `Map`s inside this execution environment.

<<< @/examples/14-kv-cache/src/memory-store.ts{memory}

There is no network call, so it is the fastest option and costs nothing. As a cache it is perfectly usable. Each environment holding its own copy is fine as long as each copy came from the source: the staleness bound is still the TTL. You just get more misses.

A rate limit is another matter. The tests say it outright:

- With two execution environments, a caller limited to 3 gets through 6 times
- A copy stored in one environment is invisible to the other

The limit becomes "N times the number of environments", and you don't control that number. On top of that, Lambda terminates execution environments every few hours (even for functions invoked continuously, the documentation says), and each time the count returns to zero. **Counting belongs in a shared store.** Memory is for copies nobody minds being out of step.

A common layout puts a memory cache in front of DynamoDB or Valkey: memory first, then the shared cache, then the source. This chapter's code doesn't include it, but it is just two `CacheStore`s stacked. Remember that the staleness bound is then the sum of both TTLs.

## Edge configuration is chapter 10's KeyValueStore

<!-- section: 14.edge -->

The third "KV", CloudFront KeyValueStore, isn't implemented in this chapter. [Chapter 10](/en/chapters/10-edge.md) used it for a redirect table and a maintenance switch. Here is only how it differs from the other two.

- **Functions can only read it.** Writes come from outside, through a dedicated API. That rules out a rate limit, which counts on every request
- **It is small.** 1 KB per value, 5 MB per store
- **Updates arrive late.** How late, the Developer Guide doesn't say (chapter 10)
- **Only CloudFront Functions can read it.** It is not meant to be read from a Lambda function in Tokyo

It suits things that a person or a deploy changes now and then, that every request reads at the edge, and that may be a few seconds old: feature flags, a redirect table, a maintenance switch. It doesn't compete with DynamoDB or Valkey. The data is different.

If you want to read a feature flag in a Lambda function in Tokyo, the straightforward way is to keep it in DynamoDB and copy it into memory for a short while with this chapter's read-through.

## Running it locally

<!-- section: 14.local -->

Memory first. Copy `examples/14-kv-cache/.env.example` to `.env` in the same directory.

<<< @/examples/14-kv-cache/.env.example

```bash
vp run dev:kv
```

From another terminal, call it six times as the same caller.

```bash
curl -s -i -H 'x-client-id: alice' http://localhost:8794/items
```

The first call says `x-cache: miss` and takes about 300 ms. From the second on it says `x-cache: hit` and returns at once. `ratelimit-remaining` goes 4, 3, 2, and the sixth call gets 429 with `retry-after`. Leave out `x-client-id` and you get 400.

That `x-client-id` is only what the caller claims. Claim another name and you are counted separately, so this protects nothing. A real API takes the caller's ID from the verified token of [chapter 06](/en/chapters/06-auth.md). A rate limit in front of authentication uses something the caller cannot pick freely, such as the IP address.

In the app, the rate limit runs before the cache.

<<< @/examples/14-kv-cache/src/app.ts{limit}

Look inside the `catch`. When the counting store is down, do you let the request through or refuse it? That is a product decision, not a technical one. For a list API, let it through: a store outage shouldn't take the API down with it. For login attempts, refuse: you don't want to wave people through with the guard down. So it is a setting, `RATE_ON_ERROR`, and not something buried in a `catch`.

Which store is used is decided at startup, from the environment.

<<< @/examples/14-kv-cache/src/env.ts{env}

<<< @/examples/14-kv-cache/src/compose.ts{stores}

### With Valkey and DynamoDB Local

To run against real servers, start two containers.

```bash
vp run kv:local:start
vp run kv:local:migrate
vp run kv:test:local
```

`kv:local:start` needs a running Docker daemon. The devShell doesn't bring one, so start Docker Desktop or similar yourself. It starts `valkey/valkey:9.0.6-alpine` (port 6390) and `amazon/dynamodb-local:3.3.1` (port 8001).

`kv:test:local` runs the contract tests against those two. If either is not running, it fails instead of skipping, because a skip looks like a pass at a glance.

Change `KV_STORE` in `.env` to `valkey` or `dynamodb`, and `vp run dev:kv` uses that store too.

One thing to be upfront about. The machine this chapter was written on had no Docker daemon, so `kv:local:start` was never run. Instead, Valkey 9.1.2 and DynamoDB Local 3.3.1 were started as plain processes, not containers, and the 22 contract tests and `dev:kv` ran against them. The tests and the app are checked against real servers; only the tasks that start the containers are not.

Here is what a local run does not reproduce.

- **IAM and TLS.** The local Valkey has no password and no TLS. Token signing and the TLS 1.3 connection can only be checked against ElastiCache
- **Cluster mode.** The local Valkey is a single node. ElastiCache Serverless runs in cluster mode, and the client behaves differently
- **TTL deletion.** Nothing locally depends on an expired item being gone
- **Several execution environments.** The dev server is one process, so even the memory rate limit looks correct

Watch the last one. `KV_STORE=memory` looks perfect on your machine and loosens the limit the moment it runs on Lambda.

## Getting ready for AWS

<!-- section: 14.infra -->

By default the stack creates a DynamoDB table, a Lambda function, and an HTTP API, and nothing else.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{table}

`timeToLiveAttribute` is the TTL setting. The table only says which attribute to look at; when to delete is written on each item.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{role}

The role allows the four operations the stores call. No `Query`, no `Scan`.

Valkey is created only when you ask for it.

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

Step by step.

Always read `connectionType: "public"` and `userGroupId` together. `default.iam-user-group` is a group ElastiCache provides in every account, containing only users that authenticate with IAM. A public cache attached to a group with a password user is the accident to avoid, and a test guards against it.

`cacheUsageLimits` caps the data stored and the ECPUs. Past them, ElastiCache evicts keys and throttles requests. It trades performance for a bill that has a ceiling.

`elasticache:Connect` is granted on two ARNs only, the cache and the user. There is no `*`.

I also checked how cdkd treats these. The pinned version (0.296.28) has dedicated implementations for the table, the function, the role, the log group, and the HTTP API. It has none for `AWS::ElastiCache::ServerlessCache`, which goes through Cloud Control API. That type is also on cdkd's list of stateful resources, so a change that replaces it (changing the connection type, for one) needs `--force-stateful-recreation`. A test pins the list of resource types the stack uses.

## Deploy and check

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` calls `GET /items` repeatedly under a new caller ID and prints at which request it gets 429 and how `x-cache` changes. On DynamoDB, the sixth request should be refused whichever execution environment answers.

To try Valkey, add the context to the same tasks.

```bash
vp run kv:infra:deploy -c store=valkey
vp run kv:smoke
vp run kv:infra:destroy -c store=valkey
```

Once more: the cache is billed from the moment it exists until it is deleted. Run all three lines in one sitting.

If something doesn't connect, read the logs.

```bash
vp run kv:logs
```

You should find one of `valkey connection error`, `cache store failed`, or `rate limiter failed`. With the cache down the API keeps answering 200, so you won't notice from the responses alone. An `x-cache` that stays `miss` is the sign that the cache isn't being reached.

Drift is checked as in chapter 02.

```bash
vp run kv:infra:drift
```

To be honest, none of the commands in this section have been run against real AWS. The Valkey variant in particular has many open points: whether CloudFormation accepts this combination of settings, whether the hand-signed token is accepted, whether iovalkey can read the cluster topology through a public endpoint. The verification notes at the end list them, with the steps to pick the work up.

## Coming from Workers KV or Durable Objects

<!-- section: 14.cloudflare -->

Cloudflare doesn't have just one KV either. Here is what I could confirm.

**Workers KV** is, in its documentation's words, "an eventually-consistent edge key-value store". A change is usually visible at once where it was made and may take 60 seconds or more elsewhere. It suits read-heavy, cacheable data, and the documentation says it is not ideal where you need atomic operations and points to Durable Objects.

It is tempting to map that onto one of the three on AWS. I won't, because each overlaps in a different way.

- DynamoDB shares "the code that plays the Worker's part reads and writes it". But it lives in one Region and offers strongly consistent reads and conditional updates. It is far more of a database than KV is
- CloudFront KeyValueStore shares "read at the edge" and "arrives late". But functions cannot write to it, and it is orders of magnitude smaller (1 KB per value, against 25 MiB in KV)
- Valkey resembles neither. It is a server in memory in one Region

A job like a rate limit, counting accurately, isn't Workers KV's job on Cloudflare either. **Durable Objects** are small single-threaded instances, each uniquely identified by a name and each with its own strongly consistent storage. By handling one thing at a time they give, in another form, the guarantee this chapter got from a DynamoDB condition expression and a Valkey script. AWS has no part that corresponds directly.

Workers also have a binding made for rate limiting. Its documentation says limits are counted per Cloudflare location and that the API is "permissive, eventually consistent", and not meant as an accurate accounting system. This chapter's DynamoDB version chooses the opposite: one Region, one write per request, an exact count. The binding wins on speed and ease, this wins on strictness. Which you need depends on what you are protecting.

The pricing has a different shape as well. Workers KV includes 100,000 reads and 1,000 writes a day on the Free plan, and 10 million reads and 1 million writes a month on the Paid plan, then USD 0.50 per million reads and USD 5.00 per million writes. Nothing is charged for merely having it until you store more than 1 GB. "A KV that costs money just sitting there" is probably the strangest part when you come from Cloudflare. I did not check Durable Objects pricing for this chapter.

## Which one to choose

<!-- section: 14.choose -->

All of the above on one page.

| | DynamoDB | ElastiCache Serverless (Valkey) | CloudFront KeyValueStore | Lambda memory |
| --- | --- | --- | --- | --- |
| Good for | Data it owns. Exact counts. Expiring records you cannot lose | Very frequent reads and writes. Counts and copies you can lose. Purpose-built operations such as rankings | Small configuration read at the edge | Copies for one execution environment |
| Consistency | Strongly consistent reads on request. A conditional update is one step | One command or one script is one step. Replication across zones is asynchronous | Updates arrive late; no figure confirmed | Not shared |
| Lifetime of data | Until you delete it. TTL deletion can be days late | Until expiry (0 to 1 ms error). Can be lost to eviction and failures | Until you change it | Until the environment is discarded |
| Where | One Region. No VPC | One Region. In a VPC or behind a public endpoint | Every edge location | Inside the environment |
| Price while unused | Storage only (USD 0.00 for this chapter's setup) | From USD 7.37 a month | 0 in this chapter (chapter 10) | 0 |
| Writable from Lambda | Yes | Yes | No | By that environment only |

From this table the decisions mostly follow.

**When in doubt, DynamoDB.** It costs next to nothing idle, needs no VPC, and is protected by the same permission system as Lambda. Both the rate limit and the cache can be built on it, as you saw. It has two weak spots: one operation takes from a few to a dozen milliseconds (around 10 ms against the local DynamoDB Local, which is not a figure for the real service), and every write is billed.

**Valkey, when you can say why.** You read and write many times per request. A millisecond matters. You need operations DynamoDB lacks, such as sorted sets or pub/sub. Or you write so much that DynamoDB's per-request price goes well past USD 7.37 a month. If one of those holds, Valkey has a job. If none does, you are taking on a standing charge, data that can vanish, and one more thing to operate, for no reason.

**KeyValueStore, only for configuration that edge functions read.**

**Memory is the first cache layer you get for free.** Don't trust it with correctness.

## The money

<!-- section: 14.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The working is in [Pricing calculations](/en/reference/pricing.md).

**A month of sitting there.**

| Setup | Per month (730 hours) |
| --- | --- |
| The default stack (DynamoDB) | 0.00 |
| `-c store=valkey` (ElastiCache Serverless, Valkey) | 7.37 |
| For comparison: node-based Valkey, one `cache.t4g.micro` | 14.60 |

Serverless's 7.37 is the minimum charge. Serverless Valkey is metered as 100 MB even when it stores less. At USD 0.101 per GB-hour, 0.1 GB x 730 hours x 0.101 comes to 7.37. For Redis OSS and Memcached the minimum is 1 GB and the rate is higher, USD 0.151. That is one of the reasons for picking Valkey.

The node-based 14.60 is not something this chapter's stack creates; it is there to compare. It is a single node without a replica, so when that node fails the cache is empty.

On free tiers: according to the ElastiCache pricing page, accounts created before July 15, 2025 get 750 hours of `cache.t3.micro` for 12 months, which excludes Serverless. Newer accounts get credits instead. Neither is deducted in this table.

**A month with one million requests.** Assuming Lambda on arm64 with 256 MB and 30 ms on average, and 0.5 KB of logs per request.

| Item | DynamoDB, list price | Valkey, list price |
| --- | --- | --- |
| API Gateway HTTP API requests (1 million) | 1.29 | 1.29 |
| Lambda requests and duration | 0.30 | 0.30 |
| CloudWatch Logs | 0.36 | 0.36 |
| DynamoDB writes (1,262,800 units) | 0.90 | - |
| DynamoDB reads (543,800 units) | 0.08 | - |
| ElastiCache data stored (the 73 GB-hour minimum) | - | 7.37 |
| ElastiCache ECPUs (10 million, assumed) | - | 0.03 |
| Subtotal (list) | **2.94** | **9.36** |
| Subtotal (after monthly free allowances) | **2.27** | **8.69** |

Only the Lambda and CloudWatch Logs allowances are deducted (they are shared across the account). I could not confirm a free allowance for HTTP API, so none is deducted.

The DynamoDB writes are one million rate limit increments plus 87,600 cache refills x 3 (take the lock, write the copy, release the lock). The refill count rests on a generous assumption: a refill happens every single time the 30-second TTL runs out. A sliding window adds one strongly consistent read per request, another million read units (USD 0.14).

The Valkey ECPUs assume 10 per request, on the generous side. A simple read or write is 1 ECPU per KB, but I have not measured what a script uses. Even so it is USD 0.03; at this scale the storage minimum is almost the whole bill.

Compare the two subtotals. At a million requests a month, DynamoDB is far cheaper. DynamoDB writes reach USD 7.37 a month at roughly 10 million writes. Before assuming "cache means Valkey", it is worth doing this sum once.

Some things are not in the table (not zero, just not included): data transfer of the responses out to the internet, and data transfer to the public endpoint, which the pricing page puts at USD 0.01 per GB on the application side within the same Region.

Delete the stack and this chapter's charges stop.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| `dev:kv` stops with `Invalid environment` | Is there an `examples/14-kv-cache/.env`? Each `KV_STORE` needs different variables |
| Locally the sixth call gets 429, deployed more get through | Did you deploy with `KV_STORE=memory`? Each execution environment counts on its own |
| Expired items are still in the DynamoDB console | That is normal. TTL deletion can be days late. The reader checks the expiry |
| `x-cache` stays `miss` | Nothing is being written to the cache. Search `vp run kv:logs` for `cache store failed` |
| `WRONGPASS` in the logs | Per the official troubleshooting table: an expired token, the wrong user name, missing `elasticache:Connect`, or a cache name that is not lowercase |
| `NOAUTH` in the logs | The client sent a command before authenticating. iovalkey sends `AUTH` first as far as its source shows, but that is unconfirmed on a real cache |
| The TLS handshake fails | A public endpoint speaks TLS 1.3 only. Is the client pinned to an older version? |
| `Valkey did not answer within 1000 ms` | The cache is unreachable or slow. The API keeps answering from the source |
| A sliding window refuses one request earlier than expected | Fractions are rounded down. It approximates; it does not guarantee exactly the limit |

## Before production

- **Use a verified caller ID.** `x-client-id` is self-declared (chapter 06)
- **Put protection in front of the rate limit too.** Start with throttling on the HTTP API stage. AWS WAF cannot be attached to an HTTP API, so needing it means choosing the layout again ([chapter 04](/en/chapters/04-http-api.md)). A rate limit in the app shares capacity fairly; it does not absorb an attack
- **Reconsider the table's `removalPolicy`.** This chapter's table holds only disposable items, but in a table shared with data it owns, that is `RETAIN`
- **Choose a TTL you can put into words.** Can you say "the list is at most 36 seconds old" (30 seconds plus 20% jitter)?
- **Watch the hit rate.** `x-cache` is in the logs. For counting from logs and alarming on the result, see [chapter 19](/en/chapters/19-observability.md)
- **If you use Valkey, decide whether a public endpoint is acceptable.** It is protected by IAM, but some organizations rule out any data store reachable from the internet. Then the connection type is VPC and the function moves into chapter 11's VPC. The `elasticache:ConnectionType` condition key can forbid creating public caches at all
- **Give Valkey users one purpose each.** This chapter uses `default.iam-user`, which may do anything. In production, create users limited to the commands and keys they need
- **Deploy through the AWS CDK CLI and CloudFormation.** As chapter 02 said

## Cleaning up

<!-- section: 14.cleanup -->

```bash
vp run kv:infra:destroy
```

If you deployed the Valkey variant, pass the same context.

```bash
vp run kv:infra:destroy -c store=valkey
```

The table, the function, the role, the API, the log group, and the ElastiCache cache are deleted. No final snapshot name is set, so no snapshot is meant to remain. To be sure it is gone, check that the list of caches in the ElastiCache console is empty. If the cache is still there, so is the charge.

Stop the local containers too.

```bash
vp run kv:local:stop
```

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

## As a distributed system

This chapter has two owners of state. The shared store (DynamoDB or Valkey) owns the rate limit counts. The source of truth owns the list. The cache owns nothing.

Here is what must hold, one sentence each.

- **A window lets through at most the limit, however many requests arrive at once.** Tests that try to break it: two requests through a read-then-write store; 50 at once against a real store
- **A copy past its expiry is never returned, even while the store still holds it.** Test that tries to break it: a DynamoDB that returns the expired item
- **With the cache absent, slow, or broken, the response equals the source.** Tests that try to break it: a store whose reads and writes always fail, a store holding unreadable values, a lock holder that never returns
- **A copy is never older than the TTL.** Test that tries to break it: a slow read that straddles an update and its invalidation

Note that the fourth is not "never returns an old value". It does. There is a bound, that's all.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (rate limiter boundaries and concurrency, the store contracts, the requests sent to DynamoDB and Valkey, the read-side TTL check, stale reads, stampedes, jitter, the token signature, the app, stack assertions). Type checking. Synth (default and `-c store=valkey`, including the esbuild bundle). Loading the bundled handler in Node.js and invoking it with an API Gateway shaped event. The 22 store contract tests against Valkey 9.1.2 and DynamoDB Local 3.3.1. Starting `dev:kv` with memory, valkey, and dynamodb, and running the `curl` commands from the text.

**Not checked yet.** `kv:infra:deploy`, `kv:smoke`, `kv:logs`, `kv:infra:drift`, and `kv:infra:destroy` have not been run against real AWS. `kv:local:start` and `kv:local:stop` were not run, for lack of a Docker daemon (Valkey and DynamoDB Local ran as processes, from nixpkgs' `valkey-server` and the jar AWS distributes). Nothing about ElastiCache was checked on a real cache: that CloudFormation and Cloud Control API accept `ConnectionType: public` with `UserGroupId: default.iam-user-group`; that 1,000 is a valid ECPU maximum in `CacheUsageLimits` (the documentation gives no smallest maximum, and 1,000 is the value its own example uses for a minimum); that the hand-signed SigV4 token is accepted; that iovalkey's `Cluster` can read the topology through a public endpoint; the TLS 1.3 connection; what a script costs in ECPUs; how long the cache takes to create and delete. For DynamoDB: how long TTL really takes to delete an item, and response times on the real service. `@valkey/valkey-glide` was only read about on npm, neither installed nor run. Durable Objects pricing was not checked.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Two exercises, swappable backends | `examples/14-kv-cache/src/stores.ts`, `test/store-contracts.ts` | `test:unit` |
| Counting for a rate limit | `examples/14-kv-cache/src/rate-limit.ts`, `test/rate-limit.test.ts` | `test:unit` |
| Read, then write, and you miscount | `examples/14-kv-cache/src/dynamodb-store.ts`, `test/dynamodb-store.test.ts`, `test/rate-limit.test.ts` | `test:unit`, `kv:test:local` |
| TTL does not mean "delete now" | `examples/14-kv-cache/src/dynamodb-store.ts`, `test/dynamodb-store.test.ts` | `test:unit` |
| The same thing on Valkey | `examples/14-kv-cache/src/valkey-store.ts`, `test/valkey-store.test.ts`, `test/local-stores.test.ts` | `test:unit`, `kv:test:local` |
| What ElastiCache adds | `examples/14-kv-cache/src/elasticache-token.ts`, `src/valkey-client.ts`, `test/elasticache-token.test.ts` | `test:unit` |
| Cache only what you can afford to lose | `examples/14-kv-cache/src/read-through.ts`, `src/catalog.ts`, `src/contract.ts`, `test/read-through.test.ts` | `test:unit` |
| The moment it expires, everyone arrives at once | `examples/14-kv-cache/src/read-through.ts`, `test/read-through.test.ts` | `test:unit` |
| Lambda memory is a cache too | `examples/14-kv-cache/src/memory-store.ts`, `src/lambda.ts`, `test/memory-store.test.ts` | `test:unit` |
| Edge configuration is chapter 10's KeyValueStore | `examples/10-edge/` | - |
| Running it locally | `examples/14-kv-cache/src/app.ts`, `src/compose.ts`, `src/env.ts`, `src/dev.ts`, `scripts/local-stores.ts`, `scripts/test-local.ts`, `.env.example` | `dev:kv`, `kv:local:start`, `kv:local:migrate`, `kv:test:local`, `kv:local:stop` |
| Getting ready for AWS | `examples/14-kv-cache/infra/lib/kv-cache-stack.ts`, `infra/bin/app.ts`, `infra/test/kv-cache-stack.test.ts`, `cdk.json` | `kv:infra:synth`, `test:unit` |
| Deploy and check | `examples/14-kv-cache/scripts/smoke.ts`, `scripts/logs.ts` | `kv:infra:diff`, `kv:infra:deploy`, `kv:smoke`, `kv:logs`, `kv:infra:drift` |
| The money | `data/pricing/` | `test:unit` |
| Cleaning up | `tools/src/infra/` | `kv:infra:destroy`, `kv:local:stop` |

**Primary sources** (checked 2026-10-12 unless noted)

- DynamoDB: [Using time to live (TTL)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), [Working with expired items and TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html), [Working with items and attributes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html), [Update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html), [Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- ElastiCache: [What is Amazon ElastiCache?](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html), [Choosing between deployment options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html), [Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html), [Create a Valkey serverless cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/serverless-public-endpoints-chapter.html), [Connect to a cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connecting-public-endpoint.html), [Authenticating with IAM](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html), [Role-Based Access Control](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Clusters.RBAC.html), [In-transit encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html), [Supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html), [Scaling ElastiCache Serverless](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html), [Engine versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html), [Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/), [AWS::ElastiCache::ServerlessCache](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-serverlesscache.html)
- AWS Price List bulk API: [ElastiCache](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-1/index.json), [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json) (the DynamoDB, Lambda, API Gateway, and CloudWatch unit prices were recorded on 2026-10-11; the DynamoDB read and write prices were confirmed unchanged on 2026-10-12)
- Lambda: [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- Valkey: [README](https://github.com/valkey-io/valkey/blob/unstable/README.md), [Scripting with Lua](https://valkey.io/topics/eval-intro/), [SET](https://valkey.io/commands/set/), [EXPIRE](https://valkey.io/commands/expire/), [INCR](https://valkey.io/commands/incr/), [tags of the valkey/valkey image](https://hub.docker.com/r/valkey/valkey/tags)
- Clients: [iovalkey 0.4.0](https://www.npmjs.com/package/iovalkey/v/0.4.0), [@valkey/valkey-glide 2.5.3](https://www.npmjs.com/package/@valkey/valkey-glide/v/2.5.3)
- CloudFront KeyValueStore: the sources of chapter 10 (checked 2026-10-11; not re-read for this chapter)
- Cloudflare: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- cdkd: [`register-providers.ts` at v0.296.28](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) and the npm tarball of the same version

:::
