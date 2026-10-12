---
title: "14 Cache: Design and Build"
---

# 14 Cache: Design and Build

[The previous page](/en/chapters/14-kv-cache.md) settled the interfaces for the counting side and the cache side. On this page you implement both on DynamoDB and on Valkey.

## Read, then write, and you miscount

<!-- section: 14.atomic -->

Written the obvious way, a rate limit reads the current count and, if it is below the limit, writes the count plus one. That code breaks when two requests arrive at the same time.

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

Both requests read a count of 0, so both pass. The stored count is still 1 afterwards. The limit was broken, and no record of the breach remains.

One test reproduces this in a fixed order. It builds a store that reads and then writes on purpose, and holds back the writes until both requests have finished reading.

<<< @/examples/14-kv-cache/test/rate-limit.test.ts{lost-update}

The fix is to make the read and the write a single step inside the store. On DynamoDB you write it like this.

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{increment}

`ADD #hits :one` is an instruction to add 1 to the current value. The app reads nothing, and DynamoDB does the addition. The condition expression you used in chapter 05 restricts the addition to counts below the cap. DynamoDB evaluates the condition and applies the addition as one operation. When two requests arrive together, one is applied first and the other is evaluated against its result.

A unit test pins the fact that the store adds without reading. The store sends a single `UpdateItem` command, with no read before it. A contract test also runs against DynamoDB Local and passes, checking that of 50 requests arriving at once exactly 20 pass and the count ends at 20.

There are two things to know about this approach.

The first is that a refused request is billed too. A write whose condition fails still consumes one write unit. A caller who keeps calling past the limit generates a DynamoDB charge for every call. A flood of requests has to be stopped further out, not by the rate limit in the app. This chapter's stack throttles the HTTP API stage and also caps the writes the table accepts per second. The settings are on the [Deploy](/en/chapters/14-kv-cache/deploy.md) page, and the amounts are under "Cost" on [the last page](/en/chapters/14-kv-cache/wrap.md).

The second is that the addition is not idempotent. If a write to DynamoDB succeeds and its response never arrives, the SDK retries and adds one more, so a single request is counted twice. For a rate limit that only costs the caller one call, so the sample leaves it as it is. Do not count money or stock this way, where a miscount is not acceptable. That kind of data needs the technique from "When the response never arrives" in chapter 05, which gives the same operation the same ID.

## TTL deletes late

<!-- section: 14.ttl -->

A rate limit item is no longer needed once its window has passed, and a cached copy is no longer needed once it has expired. Left alone, they pile up in the table, so the sample uses DynamoDB's TTL (time to live). You write the time after which an item may be deleted on the item itself, in Unix seconds, and DynamoDB deletes it for you without charging for a write.

An item is not deleted at the moment it expires, however. The official documentation says items are deleted "within a few days of their expiration time". Until then, the item can be read like any other.

If you are used to expiry in Valkey or Workers KV, you expect an expired value not to come back, but DynamoDB returns it. The reader therefore checks the expiry.

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{cache-get}

This is why `get` takes `now`. The reader's clock decides whether an entry has expired, not DynamoDB. TTL is left with the cleanup and nothing else.

A test pins the reader's check.

<<< @/examples/14-kv-cache/test/dynamodb-store.test.ts{ttl-test}

Each item carries two expiries. `expiresAtMs` is in milliseconds and is used for the reader's check. `expiresAt` is in seconds and is used by DynamoDB for cleanup. A TTL attribute has to be in seconds, which is why there are two.

The lock used on [the next page](/en/chapters/14-kv-cache/more.md) is in the same position. An expired lock stays in the table, so the condition for taking the lock covers a lock that exists but has expired as well as a lock that does not exist.

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{lock}

The rate limit is not affected by late TTL deletion. Its key contains the start of the window, so an item left over from an old window is invisible to a new one. If correctness never depends on TTL, the "few days" stop mattering.

I have not measured how long real DynamoDB takes to delete an item.

## The same thing on Valkey

<!-- section: 14.valkey -->

Valkey is a key-value server that runs in memory. The project was forked from the open source version of Redis just before Redis changed its license, and Redis commands work on it unchanged. It is one of the engines ElastiCache can run, along with Redis OSS and Memcached.

Valkey has a command that adds 1 (`INCR`), but no single command that adds 1 only while the count is below a cap. The sample does that with a small script.

<<< @/examples/14-kv-cache/src/valkey-store.ts{scripts}

Valkey runs a script from start to finish with no other command in between. That gives the same guarantee as DynamoDB's condition and update in one step, reached another way.

The cache is simpler.

<<< @/examples/14-kv-cache/src/valkey-store.ts{valkey-cache}

`get` does not use `now`. Valkey stops returning a key once it has expired (its documentation puts the expiry error at 0 to 1 millisecond), so the reader has nothing to check. This is where the difference from DynamoDB shows most clearly.

In exchange, the clock that judges expiry is the Valkey server's, and a test cannot replace it. The memory and DynamoDB stores accept a fake clock and Valkey does not, so the contract tests really wait when they run against Valkey (`test/local-stores.test.ts`).

The other large difference is that the contents of Valkey can disappear. ElastiCache Serverless replicates data to several Availability Zones asynchronously. Because replication is asynchronous, a failure right after a write was acknowledged can lose that write. And when the cache reaches its storage limit, keys that have an expiry are evicted. When a rate limit count disappears, that caller can call up to the limit again. Whether you can accept that decides whether counts belong in Valkey.

## What ElastiCache adds

<!-- section: 14.elasticache -->

A local Valkey runs as soon as you start one container. On AWS there is more to decide.

### Node-based or Serverless

ElastiCache can be set up in two ways.

| | Node-based | Serverless |
| --- | --- | --- |
| You decide | Node type, node count, which zones | A name (limits are optional) |
| Price | Per node-hour. One `cache.t4g.micro` (Valkey) in Tokyo is USD 14.60 a month | Data stored (GB-hours) and ECPUs. Valkey's 100 MB minimum is USD 7.37 a month |
| Network | Inside a VPC only | Inside a VPC, or a public endpoint |
| TLS | Your choice | Always on |
| Cluster mode | Your choice | Enabled only; the client has to support it |

Both cost money even when nobody calls them. Neither drops to zero when unused, as DynamoDB and Lambda do. If the name Serverless leads you to expect to pay only for what you use, this is where the expectation fails. The pricing page says that billing starts when the cache becomes available and continues until you delete it.

### A public endpoint, without a VPC

As chapter 11 said, a node-based cluster can only be placed inside a VPC. To connect from Lambda you put the function in the VPC, and the function loses its route to the internet. The outline of this chapter originally said that Valkey brings a VPC with it.

The current documentation, read again, lists two connection types for ElastiCache Serverless, VPC and public. A public endpoint can be reached over the internet without a VPC. It is available only on Serverless with Valkey 9.0 or later.

This chapter's stack uses the public endpoint because it keeps the Lambda function out of a VPC. The function runs in the same place as in earlier chapters and calls DynamoDB the same way. The VPC setup (connection type `vpc`, subnets and security groups passed in, and the function attached to chapter 11's VPC) is not in this chapter's code.

A cache that can be reached from the internet deserves caution. A public endpoint comes with two conditions.

- Every connection needs IAM authentication. Users that authenticate with a password cannot be used, and every user in the user group attached to the cache must authenticate with IAM
- TLS 1.3 is required. The handshake fails with any older version of TLS

What protects the cache, then, is IAM and not a network wall. The approach you have followed since chapter 04, deciding what a role is allowed to do, applies here unchanged.

### A signature instead of a password

With IAM authentication you send a token that is valid for 15 minutes in place of a password. The token is a URL signed with SigV4.

<<< @/examples/14-kv-cache/src/elasticache-token.ts{token}

This function makes no network call. It only signs with the credentials at hand, and ElastiCache verifies the signature when it receives the token. Inside Lambda, the function signs with the execution role's credentials. The role must be allowed `elasticache:Connect` on both the cache and the ElastiCache user.

The reference implementation in the AWS documentation is Java code, and I found no official component for Node.js (GLIDE, the official Valkey client, generates and refreshes the token itself). The code above follows that Java implementation. A test computes SigV4 separately by hand and checks that the signatures match. However, **this token has never been presented to a real ElastiCache cache.**

### Why the client is iovalkey

I checked two Valkey clients for Node.js on npm.

- `@valkey/valkey-glide` 2.5.3 is the official Valkey client. It has IAM authentication built in. Its core is written in Rust, and it uses a native package for each OS and CPU
- `iovalkey` 0.4.0 is a client forked from ioredis and is written in JavaScript only

This book bundles Lambda code into one file with esbuild at synth time and does not use Docker. A native package needs one build for the machine that bundles (macOS, for example) and another for the place the code runs (Linux on arm64), which does not fit that approach well. The sample therefore uses iovalkey, which is JavaScript only. GLIDE should need less authentication code. If you run in a container ([chapter 12](/en/chapters/12-containers.md)), you are free to choose again.

<<< @/examples/14-kv-cache/src/valkey-client.ts{elasticache}

Choosing iovalkey has one cost. iovalkey takes the password as a fixed string, so a reconnect after 15 minutes would send a stale token. The sample therefore replaces the connection every 10 minutes.

<<< @/examples/14-kv-cache/src/valkey-client.ts{rotating}

The sample has one more mechanism, which keeps a cache that does not answer from taking the request down with it.

<<< @/examples/14-kv-cache/src/valkey-client.ts{deadline}

The request waits at most 1 second and then continues as if there were no cache. Without this limit, a cache failure would reach the caller as a wait that lasts until the Lambda timeout (10 seconds).
