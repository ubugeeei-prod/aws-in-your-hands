---
title: "14 Cache: Design and Build"
---

# 14 Cache: Design and Build

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

**A refused request is billed too.** A write whose condition fails still consumes one write unit. Someone hammering past the limit generates DynamoDB charges for every attempt. The place to absorb a flood is further out, not here. This chapter's stack throttles the HTTP API stage and also caps the writes the table accepts per second. The numbers are in "Getting ready for AWS" and "The money".

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
