---
title: "14 Cache: Build, Continued"
---

# 14 Cache: Build, Continued

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
