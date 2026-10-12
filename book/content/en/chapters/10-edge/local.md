---
title: "10 Edge: Run It Locally"
---

# 10 Edge: Run It Locally

## Run it on your machine

<!-- section: 10.local -->

Beyond the tests, let's poke at it with a browser and `curl`.

```bash
vp run dev:edge
```

A server comes up at <http://localhost:8790> with the function wired in front of the contents of `site/`. No Docker, no AWS account.

```bash
curl -si http://localhost:8790/plans | head -n 3
curl -s http://localhost:8790/ | grep '<h1>'
curl -si 'http://localhost:8790/sale?ref=mail' | grep -i location
```

`/plans` answers 301 to `/pricing/`. The data is `examples/10-edge/edge-data.json`.

<<< @/examples/10-edge/edge-data.json

With the server still running, change `maintenance` to `true` and save. The next request gets a 503. Set `newHome` to `true` and the content of `/` swaps. The server's terminal shows how many times KVS was read for each request.

<<< @/examples/10-edge/src/local/dev.ts{dev}

Here's what this server does not reproduce.

- **The propagation delay.** Here, the value changes on the request right after you save the file. The real KVS doesn't behave that way. The next section covers it
- **The CloudFront cache.** Every request goes through the function and the "origin"
- **The runtime's constraints.** Syntax, size, memory, execution time
- **The details of S3's responses.** A missing file just gets a plain 404

### cdkd's emulator works too

cdkd can run a synthesized distribution on your machine. The function runs in an environment cdkd provides, and a JSON file stands in for KVS.

```bash
vp run dev:edge:cdkd
```

This one is at <http://localhost:8791>. I ran the same `curl` commands against it and got the same responses. `import cf from "cloudfront"` and `cf.kvs()` without an ID both work as written. With only an S3 origin and a CloudFront Function, it didn't need Docker.

Still, this isn't CloudFront itself either. I haven't looked into how much of runtime 2.0's constraints cdkd's emulator reproduces. Treat it as "two different stand-ins gave the same result", and nothing more. Lambda@Edge isn't run by this emulator; it prints a warning and skips it.

## What does KVS actually promise?

<!-- section: 10.kvs -->

As the name says, KVS holds keys and values. But its character is quite different from DynamoDB ([chapter 05](/en/chapters/05-dynamodb.md)).

First, size.

<<< @/examples/10-edge/src/kvs/config.ts{limits}

A key can be 512 bytes, a value 1 KB, and a whole KVS 5 MB. One update request can touch up to 50 keys (or 3 MB). Values are strings, byte strings, or JSON. It's a place for a configuration table, not a place for application data.

Next, who can write. The function only reads. "Write on every request" uses, such as counting visits, simply aren't possible.

And the most important point: a value you just wrote can't be read right away.

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

At t0, when the update API reports success, every edge may still be reading the old value. At t1, a reader in Tokyo can get a 503 while a reader somewhere else gets the normal page. Only at t2 do they agree.

How long is it from t0 to t2? I couldn't find a number or a guarantee in the Developer Guide. There are just two hints. One: about the last-updated time that `meta()` returns, the guide says it "doesn't include the propagation time to the edge". Two: AWS's official blog post at launch says changes "are propagated to all CloudFront edge locations in a few seconds". A blog post isn't a specification, so this book treats it as "usually a few seconds, apparently, with no promised upper bound". I haven't measured it either.

Turned into design rules, that means:

- **Don't assume a write is readable everywhere right away.** "The sync finished" does not mean "the switch has flipped"
- **Store only data that's fine in an in-between state.** Nobody is hurt if a redirect is stale for a few seconds. But if you need "from this instant, everyone is locked out for certain", a KVS switch is the wrong tool
- **Don't depend on order.** Nowhere does the documentation say that an edge that sees B, written after A, must also see A

One more thing: a value never changes in the middle of a single function run. According to the documentation, updates are processed between invocations.

### Decide the shape of the data

`edge-data.json` gets converted into KVS keys and values. Before that, a schema checks it.

<<< @/examples/10-edge/src/kvs/config.ts{schema}

The writing side enforces the same "never send the reader off the site" that the function did. On top of that, it catches mistakes that can only be found here. The same `from` twice. A redirect whose target is itself redirected (one edit away from a loop). A `from` the function would never look up (one with an extension, or too long).

<<< @/examples/10-edge/src/kvs/config.ts{entries}

A flag that's off keeps its key, with the value `"off"`. That way the function's `get` doesn't have to go down the exception path.

## Changing the table safely

<!-- section: 10.sync -->

Now a script that makes the KVS contents match `edge-data.json`. "Delete everything and put it all back" is the easiest, but then every redirect stops working between the delete and the put. Send only the difference.

<<< @/examples/10-edge/src/kvs/plan.ts{plan}

What to put, what to delete, what to leave. It's a pure function, so it's testable without AWS.

It draws one line. This script deletes only keys that start with `flag:` or `redirect:`. If the KVS holds other keys, the script reports them and leaves them alone. If the same KVS is shared with another use, nobody's data gets deleted just because it's "not in the desired set".

### An ETag keeps you from trampling changes you haven't seen

What if two people change the table at the same time? While you're reading the KVS and computing a diff, a colleague fixes a line in the console. Your diff is based on the old contents, so writing it as is could overwrite the colleague's change without you ever knowing.

The KVS API has a mechanism against this. A KVS has an ETag that stands for its version, and every write must carry an `If-Match` saying "this is the version I read". If the version has moved on, the write is refused. It's the same idea as the conditional writes in chapter 05, known as optimistic updating.

<<< @/examples/10-edge/src/kvs/sync.ts{port}

From the script's point of view, KVS is just these two operations. The real one (which calls the AWS SDK) and the test double implement the same shape.

<<< @/examples/10-edge/src/kvs/sync.ts{sync}

The point is that every retry reads again and plans again. It never resends an old plan.

That settles what happens for each kind of failure.

- **Someone wrote first.** The write is refused, so the script reads again. The new plan is made having seen their change
- **The write arrived but the response didn't.** A timeout or a dropped connection. From here, you can't tell whether it was written. Reading again tells you. If it was, the diff is empty and nothing is sent twice
- **It stopped partway through several requests.** A change of more than 50 keys is split into several requests. One request either fully succeeds or fully fails, but the sequence of requests as a whole does not. If it stops in the middle, the KVS is left half new. Run it again and only the rest is sent
- **It conflicts no matter how often it tries.** It gives up after five rounds and reports an error. It doesn't spin forever
- **No permission, or an invalid value.** Retrying wouldn't change the outcome, so it stops immediately

Put what we want to protect in one sentence: "the sync never overwrites a change it hasn't read, and wherever it fails, running it again converges on `edge-data.json`." `examples/10-edge/test/sync.test.ts` takes a stand-in KVS with an ETag, triggers each of the failures above in a fixed order, and checks that the sentence still holds.

### Where it calls AWS

<<< @/examples/10-edge/src/kvs/store.ts{adapter}

Watch the order of the reads: ETag first, contents second. The other way round, you can end up with a "new ETag" paired with "old contents". A write based on that pair goes through, because the ETag matches, and it overwrites a change nobody saw. Take the ETag first, and any mismatch always falls on the "old ETag" side, where the write is refused.

Two odd things about the KVS API show up here.

One: there are two APIs. Creating and deleting the store itself is the ordinary CloudFront API. Reading and writing the keys and values inside is a separate API called CloudFront KeyValueStore. Both have a `DescribeKeyValueStore`, the ETags they return are different things, and you can't swap one for the other.

Two: signing. The key-value API is a global endpoint with no Region, and it uses a signing scheme called SigV4A. The AWS SDK for JavaScript ships the signer for it as a separate package. The example in the official documentation loads `@aws-sdk/signature-v4-crt`, which uses the CRT (a native binary); this chapter uses `@aws-sdk/signature-v4a`, which is plain JavaScript. Reading the SDK source, whichever one is loaded gets used. The local tests go as far as checking that the signature header has the SigV4A form (`AWS4-ECDSA-P256-SHA256`). That AWS accepts that signature is not yet confirmed.

Errors are sorted like this.

<<< @/examples/10-edge/src/kvs/store.ts{errors}

Honestly, there's something unconfirmed here. The API reference lists `ConflictException` (409), but it doesn't say "this is what you get for a stale ETag". This adapter treats only `ConflictException` as a conflict. If the real answer is some other error, the sync stops with that error instead of retrying. It won't overwrite anything, so it fails on the safe side, but it's something to fix.
