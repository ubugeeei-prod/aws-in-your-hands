---
title: "10 Edge: Run It Locally"
---

# 10 Edge: Run It Locally

The [previous page](/en/chapters/10-edge.md) read the edge function, `edge-router.js`, and ran it in tests under Node.js. This page runs the same function in a local server, then covers what KVS guarantees about consistency and the script that changes what KVS holds.

## Run it on your machine

<!-- section: 10.local -->

Besides the tests, you can call the function from a browser or `curl`.

```bash
vp run dev:edge
```

A server starts at <http://localhost:8790> with the function in front of the contents of `site/`. It needs neither Docker nor an AWS account.

```bash
curl -si http://localhost:8790/plans | head -n 3
curl -s http://localhost:8790/ | grep '<h1>'
curl -si 'http://localhost:8790/sale?ref=mail' | grep -i location
```

`/plans` answers with a 301 to `/pricing/`. The redirect table and the flags are in `examples/10-edge/edge-data.json`.

<<< @/examples/10-edge/edge-data.json

With the server still running, change `maintenance` to `true` and save the file, and the next request gets a 503. Set `newHome` to `true` and the content of `/` changes. The server's terminal shows how many times KVS was read for each request.

<<< @/examples/10-edge/src/local/dev.ts{dev}

This server does not reproduce four things.

- The propagation delay. Here a value changes on the first request after you save the file. The real KVS doesn't behave that way, and "What KVS promises and what it does not" on this page covers the delay
- The CloudFront cache. Every request goes through the function and the stand-in for the origin
- The runtime's constraints. The limits on syntax, size, memory, and execution time are not reproduced
- The details of S3's responses. A missing file gets a plain 404

### Running it in cdkd's emulator

cdkd can run a synthesized distribution on your machine. The function runs in an environment that cdkd provides, and a JSON file can stand in for KVS.

```bash
vp run dev:edge:cdkd
```

This server listens at <http://localhost:8791>. I ran the same `curl` commands against it and got the same responses. `import cf from "cloudfront"` and `cf.kvs()` without an ID both work unchanged. With only an S3 origin and a CloudFront Function, it didn't need Docker.

cdkd's emulator isn't CloudFront itself either. I haven't looked into how far the emulator reproduces the constraints of runtime 2.0. All that can be said is that two separate stand-ins gave the same result. The emulator does not run Lambda@Edge. It prints a warning and skips it.

## What KVS promises and what it does not

<!-- section: 10.kvs -->

As the name says, KVS stores keys and values, but it behaves quite differently from DynamoDB ([chapter 05](/en/chapters/05-dynamodb.md)). It differs in three ways, and the first is size.

<<< @/examples/10-edge/src/kvs/config.ts{limits}

A key can be 512 bytes, a value 1 KB, and a whole KVS 5 MB. One update request can change up to 50 keys (or 3 MB). A value can be a string, a byte string, or JSON. KVS is a place for a configuration table, not for application data.

The second difference is who can write. The function only reads, so a use that writes on every request, such as counting visits, isn't possible.

The third matters most. A value you have written can't be read right away.

```figure
caption: After UpdateKeys succeeds, the value reaches each edge location at a different time, and at t1 two readers get two different answers
type: sequence
actor op: Operator
actor a: edge location A
actor b: edge location B
step op -> op: t0 UpdateKeys succeeds
note a: t0 maintenance = off
note b: t0 maintenance = off
step op --> a: t1 arrives
note a: t1 maintenance = on
note b: t1 maintenance = off
step op --> b: t2 arrives
note a: t2 maintenance = on
note b: t2 maintenance = on
```

At t0, when the update API reports success, every edge location may still be reading the old value. At t1, a reader in Tokyo can get a 503 while a reader somewhere else gets the normal page. Only at t2 do all edge locations read the same value.

I couldn't find a number or a guarantee in the Developer Guide for how long t0 to t2 takes. There are only two hints. One is that, about the last-updated time that `meta()` returns, the guide says it "doesn't include the propagation time to the edge". The other is that AWS's official blog post at launch says changes "are propagated to all CloudFront edge locations in a few seconds". A blog post isn't a specification, so this book treats the delay as "apparently a few seconds in most cases, with no promised upper bound". I haven't measured it either.

For the design, this behavior means three rules.

- Don't assume a write can be read everywhere right away. When the sync script finishes, the switch may not have flipped yet
- Store only data that causes no harm in an in-between state. Nobody is hurt if a redirect is stale for a few seconds. If you need everyone locked out for certain from a given instant, a KVS switch is the wrong tool
- Don't depend on the order of writes. If you write A and then B, nothing in the documentation says that an edge location that sees B also sees A

A value does not change in the middle of a single function run. According to the documentation, updates are processed between invocations.

### Deciding the shape of the data

`edge-data.json` is converted into KVS keys and values. Before the conversion, a schema checks it.

<<< @/examples/10-edge/src/kvs/config.ts{schema}

The writing side enforces the same rule the function does, that a reader is never sent off the site. It also catches mistakes that can only be found on the writing side: the same `from` listed twice, a redirect whose target is itself redirected, and a `from` the function would never look up (one with an extension, or one that is too long). A table where a redirect leads to another redirect is one edit away from a loop.

<<< @/examples/10-edge/src/kvs/config.ts{entries}

When a flag is off, its key is not deleted. It is written as `"off"`. With the key present, the function's `get` doesn't reject and never takes the exception path.

## Changing the table safely

<!-- section: 10.sync -->

Next comes a script that makes the contents of KVS match `edge-data.json`. Deleting everything and putting it all back would be the easiest way, but every redirect would stop working between the delete and the put. The script sends only the difference instead.

<<< @/examples/10-edge/src/kvs/plan.ts{plan}

`planSync` sorts keys into those to put, those to delete, and those to leave alone. It is a pure function, so it can be tested without AWS.

What the script may delete is limited. It deletes only keys that start with `flag:` or `redirect:`. If KVS holds other keys, the script reports that it found them and doesn't touch them. If the same KVS is shared with another use, this keeps the script from deleting someone else's data just because `edge-data.json` doesn't list it.

### Using the ETag to avoid overwriting changes you haven't seen

Consider two people changing the table at the same time. While you read KVS and compute a diff, a colleague fixes one line in the console. Your diff is based on the old contents, so if you write it as is, you may overwrite the colleague's change without knowing it was there.

The KVS API has a mechanism that prevents this. A KVS has an ETag that identifies its version, and every write must carry an `If-Match` header naming the version you read. If the version has moved on, the write is refused. It is the same idea as the conditional writes in chapter 05, and it is called optimistic concurrency.

<<< @/examples/10-edge/src/kvs/sync.ts{port}

The script sees KVS as two operations, `read` and `update`. The real implementation, which calls the AWS SDK, and the stand-in used in tests implement the same type.

<<< @/examples/10-edge/src/kvs/sync.ts{sync}

On every retry, `syncStore` reads KVS again and makes a new plan. It never sends an old plan a second time. That design settles what happens for each kind of failure.

- If someone else wrote first, the write is refused and the script reads again. The new plan is made with the other person's change in view
- If the write arrived but its response didn't (a timeout or a dropped connection), the script can't tell whether the write happened. Reading again answers that. If the write did happen, the diff is empty and the same change isn't sent twice
- If the script stops partway through several requests, KVS is left half updated. A change of more than 50 keys is split into several requests, and while each request either succeeds or fails as a whole, the series of requests does not. Running the script again sends only what remains
- If the write conflicts every time, the script gives up after five rounds and reports an error. It doesn't retry forever
- If the caller lacks permission or a value is invalid, retrying would give the same result, so the script stops at once

In one sentence, what has to hold is this: "the sync never overwrites a change it hasn't read, and wherever it fails, running it again converges on `edge-data.json`." `examples/10-edge/test/sync.test.ts` causes each of the failures above, one at a time and in a fixed order, against a stand-in KVS that has an ETag, and checks that the sentence still holds.

### Where it calls AWS

<<< @/examples/10-edge/src/kvs/store.ts{adapter}

`read` fetches the ETag first and the contents second. In the other order, it could end up holding a new ETag together with old contents. A write made with that pair would pass, because the ETag matches, and it would overwrite a change the script never saw. With the ETag fetched first, any mismatch leaves the script holding the old ETag, so the write is refused.

The KVS API differs from other services in two ways.

The first is that there are two APIs. Creating and deleting the KVS itself goes through the ordinary CloudFront API. Reading and writing the keys and values inside it goes through a separate API named CloudFront KeyValueStore. Both have a `DescribeKeyValueStore` operation, and the ETags they return are different things that can't be used in place of each other.

The second is signing. The API for keys and values is a global endpoint with no Region, and it uses a signing scheme called SigV4A. The AWS SDK for JavaScript keeps its SigV4A implementation in a separate package. The example in the official documentation loads `@aws-sdk/signature-v4-crt`, which uses the CRT (a native binary), but this chapter uses `@aws-sdk/signature-v4a`, which runs in JavaScript alone. Reading the SDK's source shows that it uses whichever of the two has been loaded. The local tests confirm that the signature header takes the SigV4A form (`AWS4-ECDSA-P256-SHA256`). I haven't yet confirmed that AWS accepts this signature.

Errors are sorted as follows.

<<< @/examples/10-edge/src/kvs/store.ts{errors}

One point in this sorting is unconfirmed. The API reference lists `ConflictException` (409) but doesn't say that it is the error returned for a stale ETag. This adapter treats only `ConflictException` as a conflict. If a different error comes back in practice, the sync stops with an error instead of retrying. It still doesn't overwrite anything, so it fails on the safe side, but it would need fixing.
