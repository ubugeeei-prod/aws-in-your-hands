---
title: "14 Cache: Build, Continued"
---

# 14 Cache: Build, Continued

## Cache only what you can afford to lose

<!-- section: 14.cache -->

By the end of [the previous page](/en/chapters/14-kv-cache/build.md), the rate limit counts were stored in DynamoDB and Valkey. On this page you build the other exercise, the cache for the list.

The rule of a cache is that **the source of truth is correct and the cache is a copy of it**. A copy may disappear at any time, and when it does you can make it again from the source. Data for which that relationship does not hold must not go into a cache.

The source of truth has this interface.

<<< @/examples/14-kv-cache/src/catalog.ts{source}

This source is a stand-in that returns a fixed list after a deliberate delay of 300 ms. In a real system it would be an aggregate query in SQL from [chapter 13](/en/chapters/13-sql.md), or another team's API. A cache helps when the source is slow or is billed per call, so the sample has a substitute for that.

The reading pattern is read-through. You read the cache first, and on a miss you read the source and put a copy in the cache.

<<< @/examples/14-kv-cache/src/read-through.ts{optional}

The point to notice is that reads and writes to the cache are wrapped in `try`. If the cache is down, slow, or holding a value that cannot be read, the request answers from the source. The answer is slower, but it is never wrong. An API returns 500 because of a cache failure when the cache has been treated as the owner of the data.

The response says when the list left the source.

<<< @/examples/14-kv-cache/src/contract.ts{list}

The `x-cache` header says `hit` or `miss`, and the `age` header says how many seconds old the copy is. The caller gets a way to know how stale a value may be from the start.

### Reproducing a stale read

Once you have a cache, there is always a period in which it disagrees with the source. This is called a stale read. Three tests reproduce it, starting with the simplest form.

<<< @/examples/14-kv-cache/test/read-through.test.ts{stale}

The first test checks that `v1` still comes back after the source changes to `v2`, until the TTL runs out. That is not a defect. It is the behavior you accepted when you set the TTL to 30 seconds.

The second checks that when the writer deletes the cached entry, the next read returns the new value. Deleting the cached entry after changing the source is a common countermeasure.

The third shows that an old value can remain even after the cached entry was deleted.

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

While the reader is still asking the source, the writer finishes its update and its delete. After that, the old answer the reader was holding goes into the cache. The delete has already happened, so nobody comes to remove this old value.

This chapter's code has no way to rule that out completely. Techniques exist, such as comparing versions before writing, but they add complexity. This chapter takes the view that deleting from the cache shortens the stale period, and that the TTL is what sets the upper bound on staleness. Choose a TTL, then, for which you can say that being this old at worst is acceptable. Data for which you cannot say that (balances, stock, permissions) is read from the source without a cache.

## Reads that pile up when the copy expires

<!-- section: 14.stampede -->

The better a cache works for an API, the more dangerous the moment its copy expires.

If 100 requests arrive at that moment, all 100 miss, and all 100 go to the slow source. The source the cache was protecting takes the heaviest load. This is called a cache stampede.

A test sets up 10 execution environments that miss at the same time and checks that the source is called 10 times ("sends every caller to the source when nothing coordinates them"). It pins what happens before any countermeasure is added.

The sample has three countermeasures.

### Sharing a load inside one process

If a load for the same key is already in progress, the request does not start a new one and waits for that result. This technique is called single flight.

<<< @/examples/14-kv-cache/src/read-through.ts{single-flight}

<<< @/examples/14-kv-cache/test/read-through.test.ts{single-flight-test}

Single flight works only inside one process. Lambda provides a separate execution environment for each request that arrives at the same time, and one execution environment handles one request at a time. As a result, **single flight has almost nothing to do on Lambda.** It is a countermeasure for a container or a long-running server ([chapter 12](/en/chapters/12-containers.md)), and it is in the sample so that the code stays the same in both places.

### A lock across execution environments

To get the same effect on Lambda, the sample puts a lock in the store, which every execution environment can see, as a mark that a refill is in progress.

<<< @/examples/14-kv-cache/src/read-through.ts{lock}

Only the one request that gets the lock reads the source. The other requests wait a little and then read the cache again.

<<< @/examples/14-kv-cache/test/read-through.test.ts{lock-test}

This lock **does not protect correctness.** It has an expiry, and if its holder freezes or dies, it releases by itself. Two requests may then refill at the same time, but that causes no problem, because both read the same source and write the same copy. What the lock reduces is load, not errors.

For the same reason, the number of waits has a limit. If the lock holder never returns, a request waits the set number of times and then reads the source itself. The tests "does not wait forever for a lock holder that died" and "goes to the source after waiting as long as it was told to" check this behavior.

### Spreading the expiries

One more method is simple and works well, which is to add jitter to the TTL.

<<< @/examples/14-kv-cache/src/read-through.ts{jitter}

Right after a deploy, or right after the cache has been emptied, many keys are written at the same moment. If every TTL is the same, they all expire together 30 seconds later. Adding 0 to 20% of jitter spreads out the moments at which they expire.

<<< @/examples/14-kv-cache/test/read-through.test.ts{jitter-test}

The random number source is passed in as an argument, so the test passes fixed values and can assert that exactly one of five entries has expired.

This chapter's API has only one key, so jitter has no effect here. It starts to matter when there are more keys, such as a list per user or a list per page.

## Lambda memory as a cache

<!-- section: 14.memory -->

In chapter 04 you saw that notes kept in Lambda memory are separate in each execution environment, and that you cannot choose when they disappear. The conclusion there was that memory cannot own data, with a remark that it can still serve as a cache. This section looks at that use.

<<< @/examples/14-kv-cache/src/lambda.ts{handler}

With `KV_STORE=memory`, both the counts and the copies go into a `Map` inside this execution environment.

<<< @/examples/14-kv-cache/src/memory-store.ts{memory}

There is no network call, so memory is the fastest option and costs nothing. As a cache it is good enough. Each execution environment has its own copy, but as long as each copy was made from the source, the upper bound on staleness is still the TTL, and the only difference from a shared cache is more misses.

A rate limit is a different matter. The tests state it directly.

- With two execution environments, a caller with a limit of 3 passes 6 times in total
- A copy stored in one execution environment cannot be seen from the other

The limit becomes N times the number of execution environments, and you do not control how many there are. Lambda also terminates execution environments every few hours (according to the documentation, this applies to functions that are invoked continuously too). Each time, the count returns to 0. Put counting in a shared store, and keep in memory only copies that nobody minds being out of step.

A common setup adds a memory cache as one more layer in front of DynamoDB or Valkey. You read memory first, then the shared cache on a miss, then the source if that misses too. This chapter's code does not include it, but you can build it by stacking two `CacheStore`s. Note that the upper bound on staleness then becomes the sum of the two TTLs.

## Edge configuration and CloudFront KeyValueStore

<!-- section: 14.edge -->

This chapter does not implement the third "KV", CloudFront KeyValueStore. [Chapter 10](/en/chapters/10-edge.md) used it for a redirect table and a maintenance switch. This section only sets out how it differs from DynamoDB and Valkey.

- Functions can only read it. Writes are made from outside the function, through a dedicated API. It therefore cannot be used for a rate limit, which counts on every request
- It is for small data. A value can be up to 1 KB, and a whole store up to 5 MB
- Updates arrive late. I have not found a figure for the delay in the Developer Guide (chapter 10)
- Only CloudFront Functions can read it. It is not meant to be read from a Lambda function in Tokyo

It suits data that a person or a deploy rewrites occasionally, that every request reads at the edge, and that can be a few seconds old without harm. Feature flags, a redirect table, and a maintenance switch are examples. Because the data is different, it does not compete with DynamoDB or Valkey.

If you want to read a feature flag in a Lambda function in Tokyo, the straightforward way is to store it in DynamoDB and copy it into memory for a short time with this chapter's read-through.
