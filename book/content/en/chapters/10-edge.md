---
title: "10 Understand the Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge"
sourceRevision: 1
---

# 10 Understand the Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge

Back in [chapter 03](/en/chapters/03-spa.md), you attached a dozen-line function to CloudFront. The one that rewrites a path to `index.html` when it has no `.` in it. In this chapter, that "small code running at the edge" gets a bit more to do.

You'll build three things: a redirect table that sends old URLs to new ones, a feature flag that switches the home page to a new version, and a switch that puts the whole site into maintenance mode. You want to flip all of these without redeploying, so the data lives in CloudFront KeyValueStore and the function reads it.

Then comes the real question: where should a given piece of work run? CloudFront Functions can't do more things than you might expect. You'll run one Lambda@Edge function as the option for when they fall short, and at the end we'll put all of it next to Cloudflare Workers.

The prerequisite is chapter 03. The code is in `examples/10-edge/`.

## The big picture

<!-- section: 10.architecture -->

```text
Reader
  |  HTTPS
  v
CloudFront edge location
  |  viewer-request: CloudFront Function "edge-router" (runtime 2.0)
  |     reads KeyValueStore: flag:maintenance, redirect:<path>, flag:new-home
  |     -> 503 (maintenance) or 301/302 (redirect): answered here, nothing below runs
  |     -> otherwise: rewrites the URI and passes the request on
  v
CloudFront cache --(hit)--> response
  |  miss
  |  origin-request: Lambda@Edge "body-digest" (optional, only on /digest)
  v
S3 bucket (private, ap-northeast-1)

Operator
  |  edge-data.json -> vp run edge:kvs:sync
  v
KeyValueStore API (global endpoint, SigV4A, If-Match: ETag)
  |  propagation to edge locations: not immediate
  v
CloudFront KeyValueStore (read-only from the function)
```

The top half is the path a reader's request takes. When CloudFront receives a request, it calls the function before it looks in the cache. That moment is called the viewer request. The function reads KeyValueStore (KVS from here on) and decides whether to answer on the spot or rewrite the URL and let the request continue.

The bottom half is the path you take to change the table and the switches. The function can only read KVS. It can't write. Writes come from outside, through a dedicated API. And what you write takes time to reach edge locations around the world. Two separate paths, one for reading and one for writing, with a delay between them: that's the backbone of this chapter.

### Why not put the table in the function?

With three redirects, you could just write them into the function's code. There are two reasons not to.

A function's code can be 10 KB at most, and that limit can't be raised. A growing table stops fitting. The other reason: every one-line fix to the table would mean redeploying the function. With the table in KVS, code and data update independently.

On the other hand, if the table is small and rarely changes, putting it in the code is simpler. KVS reads also cost money (we'll do the math later). The function in chapter 03 and this book's own site function (`book/infra/functions/url-rewrite.js`) don't use KVS because they have no data to switch.

## What CloudFront Functions can't do

<!-- section: 10.limits -->

Before writing code, let's look at the constraints. Start without knowing them and you'll usually end up turning back halfway. Here's what the official documentation says.

- **No network.** No `fetch`, no XHR, no sockets. You can't call an external API or query a database
- **No file system, no `process`, no environment variables.** To pass in settings, write them into the code or put them in KVS
- **No timers.** There's no `setTimeout` or `setImmediate`. A function can't wait or defer; it runs straight through to the end
- **The clock doesn't move.** For the whole run, `Date` returns the time the function started. You can't measure elapsed time
- **No request body.** You see the method, URI, query string, headers, and cookies, and that's it
- **No `eval` and no `Function` constructor**
- **Code up to 10 KB, memory up to 2 MB**
- **Viewer request and viewer response only.** You can't place one just before or just after the origin
- **One KVS per function**

Execution time is limited too, but the documentation gives no number in milliseconds. The comparison table says "submillisecond", and actual consumption is reported as compute utilization, a value from 0 to 100: the percentage of the allowed time that was used.

The language is JavaScript, but this isn't Node.js. Runtime 2.0 is described as "compliant with ES 5.1" with "some features of ES versions 6 through 12", and the supported features are listed. `const`, `let`, `async`/`await`, arrow functions, and template literals are on the list. Optional chaining (`?.`), spread, destructuring, `class`, and `for...of` are not. The code in this chapter sticks to what's listed. Whether the unlisted ones really fail, honestly, I haven't been able to try.

`console.log` is a little unusual as well: one argument only. You can't write `console.log("a", b)`.

## Reading the function

<!-- section: 10.router -->

On to the code. The file is `examples/10-edge/infra/functions/edge-router.js`. First, how it reads KVS.

<<< @/examples/10-edge/infra/functions/edge-router.js{kvs}

It imports a module called `cloudfront` and gets the KVS attached to the function with `cf.kvs()`. There are three ways to read: `get`, `exists`, and `meta`. This function uses only `get`.

`get` rejects when the key doesn't exist. So it's wrapped in `try`/`catch` and returns `null` instead. There's a design choice hiding here. This function doesn't tell a missing key apart from a read that failed. Both count as "no rule", and the site keeps serving. Losing redirects is better than losing the whole site when KVS can't be read. The flip side: while KVS can't be read, the maintenance switch doesn't work either.

Reads are awaited one after another. It's tempting to batch them with `Promise.all`, but the documentation advises against it. It uses more memory and, for now, isn't any faster.

Next, the handler.

<<< @/examples/10-edge/infra/functions/edge-router.js{handler}

Three steps, top to bottom.

If the site is under maintenance, it returns 503 right here. Neither the cache nor the origin is involved.

Otherwise it looks the path up in the redirect table. But not for paths whose last segment has a `.` in it (files, such as `/assets/app.css`). Files are never redirected, so this saves one read on every asset.

If neither applies, it rewrites the URL. `/` becomes `/index.html` or `/home-v2.html` depending on the flag, and a path like `/pricing/` becomes `/pricing/index.html`. The rewrite happens before the cache lookup, so the two home pages are cached as two different URLs. You don't have to clear the cache the moment you flip the flag.

### Doubt the redirect value once more, in the function

<<< @/examples/10-edge/infra/functions/edge-router.js{redirect}

The values in KVS are checked by the update script you'll write shortly, before they're written. The function checks them again anyway, because KVS can also be edited from the console. As long as there's a way in that bypasses the script, the last reader has to defend itself.

What it defends is "never send the reader off the site". If someone stores `https://...` or `//example.org` as a value, a URL on your domain becomes a doorway to someone else's site (a problem known as an open redirect). Only paths that start with `/`, don't start with `//`, and contain no backslash are accepted.

The five-minute `cache-control` has a reason too. Browsers remember a 301 with no lifetime for good. If you get the table wrong, fixing it doesn't fix it for readers who already followed it.

### The maintenance response

<<< @/examples/10-edge/infra/functions/edge-router.js{maintenance}

A function can return a response instead of the request. `no-store` keeps this 503 from being cached anywhere. By the way, a response of 400 or above returned by a function is not replaced by the distribution's custom error pages.

## Running the same file under Node.js

<!-- section: 10.tests -->

As in chapter 03, the tests load the very file that gets deployed. Make a copy, and sooner or later you fix the copy and forget the real one. This time there's one obstacle, though: `import cf from "cloudfront"`. That module exists only at the edge.

<<< @/examples/10-edge/src/local/load-function.ts{load}

All it does is remove the one import line and hand over a stand-in named `cf` instead. Not a single other character changes. If the import line isn't what the loader expects, it throws instead of quietly carrying on.

A fresh `node:vm` context has no `fetch`, no `setTimeout`, no `process`, and no `require`. If the function uses any of them by accident, the test fails with a `ReferenceError`. That's a little like the real runtime's restrictions.

Here's the stand-in for KVS.

<<< @/examples/10-edge/src/local/load-function.ts{stand-in}

Like the real thing, it rejects for a missing key. It also records which keys were read. Every read is billed, so "an asset request reads the store exactly once" is worth pinning down in a test.

```bash
vp run test:unit
```

`examples/10-edge/infra/test/edge-router.test.ts` checks things like these.

- Rewrites and redirects follow the table. The query string is carried over
- A redirect to another site written straight into KVS is not followed
- During maintenance, every path gets a 503 and nothing reaches the origin
- Serving continues with an empty KVS, and when every read fails
- The number of reads is one for a file, two for a page, three for the home page
- The file fits in 10 KB
- No syntax from outside the documented list (`?.`, spread, destructuring, and so on) has slipped in

That last one is a plain text search, not a parser. Think of it as catching what hands trained on Node.js type out of habit.

And this is also where the tests end. What runs here is Node.js. Whether runtime 2.0 really accepts this syntax, whether it fits in 2 MB of memory, whether it finishes within the time limit: these tests can't tell you. CloudFront has a test feature that runs a function against an event before it goes live and returns the result along with its compute utilization. Checking against the real runtime is that feature's job.

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

```text
time  operator                    edge location A      edge location B
t0    UpdateKeys succeeds         maintenance = off    maintenance = off
t1                                maintenance = on     maintenance = off   <- two readers, two answers
t2                                maintenance = on     maintenance = on
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

## Getting ready for AWS

<!-- section: 10.infra -->

The CDK stack is the one from chapter 03 plus a KVS.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{store}

The KVS is created empty. CDK can also import keys and values from a file at creation time (an import source), but I didn't use it. Importing is only possible when the KVS is first created. Fixing `edge-data.json` later wouldn't be reflected, and making it reflect would mean recreating the KVS. So ownership is split: the container belongs to the stack, and the contents belong to `edge-data.json` and the sync.

A brand-new KVS is empty, and that's fine. The function is written to let requests through untouched when a key is missing.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{router}

Passing `keyValueStore` makes CDK associate the function with the KVS. The runtime is set to 2.0 explicitly.

The tests (`infra/test/edge-stack.test.ts`) check that the bucket is private and readable only by this distribution. That the function is on runtime 2.0 with exactly one KVS attached. That the KVS is created empty and goes away with the stack. And the list of resource types in use.

### How cdkd handles these resources

I read the source of the pinned cdkd version (0.296.28).

| Resource type | How cdkd handles it |
| --- | --- |
| `AWS::S3::Bucket`, `AWS::S3::BucketPolicy` | Dedicated implementation |
| `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl` | Dedicated implementation |
| `AWS::CloudFront::Function` | Through Cloud Control API |
| `AWS::CloudFront::KeyValueStore` | Through Cloud Control API. Treated as stateful |

"Treated as stateful" means cdkd has KVS on its list of types whose removal loses data. If you make a change that requires replacing the KVS (renaming it, for example), cdkd stops and asks you to run again with `--force-stateful-recreation`. The contents can be put back any time with a sync, so for this chapter's KVS it's fine to pass it. But a KVS that was just recreated is empty. The function works with an empty one, but redirects and flags won't take effect until you sync again.

All of this comes from reading the source. Whether cdkd can actually create these in real AWS is not confirmed yet.

## Deploy it and flip the switches

<!-- section: 10.deploy -->

```bash
vp run edge:infra:diff
vp run edge:infra:deploy
vp run edge:publish
```

That gets the three HTML files in `site/` into the bucket. At this point the KVS is empty, so `/` returns `index.html` and `/plans` is a 404.

Next, load the table. Look at the diff first, then write.

```bash
vp run edge:kvs:plan
vp run edge:kvs:sync
```

`edge:kvs:plan` only reads the KVS and changes nothing. `edge:kvs:sync` prints the plan it sent and the new ETag.

```bash
curl -sI https://dxxxxxxxxxxxx.cloudfront.net/plans | head -n 3
```

A 301 with `location: /pricing/` means the table has arrived. If you try right after the sync and get a 404, wait a little and try again. You may simply be between t0 and t2 from earlier.

Try the maintenance switch too. Set `maintenance` to `true` in `edge-data.json`, sync, and look at the status code a few times.

```bash
vp run edge:kvs:sync
curl -s -o /dev/null -w '%{http_code}\n' https://dxxxxxxxxxxxx.cloudfront.net/
```

There may be a stretch where 200 and 503 are mixed. That's eventual consistency. When you're done, set it back to `false` and sync once more.

The drift check is the same as in earlier chapters.

```bash
vp run edge:infra:drift
```

The contents of the KVS (its keys and values) aren't in the template, so the drift check doesn't cover them. For the contents, use `edge:kvs:plan`. If someone changed them by a route other than the sync (the console, say), it shows up there as a diff.

Honestly, I haven't been able to run the steps in this section against real AWS yet.

## When you need the body: Lambda@Edge

<!-- section: 10.lambda-edge -->

The cases where CloudFront Functions fall short are clear-cut. You want to call an external API or a database. You want to look at the request body. The work doesn't finish in milliseconds. You want to run just before or just after the origin. You want to use an npm library.

One option at that point is Lambda@Edge. CloudFront takes an ordinary Lambda function ([chapter 04](/en/chapters/04-http-api.md)), replicates it around the world, and invokes it partway through a request. It can reach the network, and it can read the body. In exchange, it comes with a lot of rules that feel cramped for a Lambda function.

- **The function is created in `us-east-1`.** Tokyo won't do
- **You name a numbered version.** Neither `$LATEST` nor an alias works. Each time the code changes, you publish a new version and update the distribution
- **No environment variables.** Reserved ones aside. Settings get baked into the code or fetched from somewhere at run time
- **No VPC.** No layers, X-Ray, dead letter queues, provisioned concurrency, or container images either
- **No arm64.** x86_64 only
- **The execution role must be assumable by both `lambda.amazonaws.com` and `edgelambda.amazonaws.com`**
- **A timeout of up to 30 seconds**
- **Size of a response the function generates**: 40 KB on viewer-side events, 1 MB on origin-side events
- **Truncation when reading the body**: 40 KB on viewer request, 1 MB on origin request. A longer body is handed over as its first part only

There's one more rule, about combinations. Each event of a cache behavior can have one function. And on viewer-side events (viewer request and viewer response), you can't mix CloudFront Functions and Lambda@Edge. A CloudFront Function on viewer request together with Lambda@Edge on origin request is allowed. That's this chapter's setup.

### A minimal example: return a digest of the body

Let's do one small thing CloudFront Functions can never do: a function that returns the size and SHA-256 of a POSTed body.

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{digest}

It runs on origin request and answers by itself, without asking the origin. `truncated` is in the response because, for a body over 1 MB, the function only sees the first part. A digest of the first part must not pass itself off as a digest of the whole.

This one exists just to see it work. The closest real use is probably verifying a webhook signature: compute an HMAC over the whole body and turn the request away before it reaches the origin if it doesn't match. But that needs a secret key. Environment variables aren't available, so you'd fetch it over the network from something like Secrets Manager, and now you're talking about latency, cost, and permissions. The price of "doing it at the edge" usually shows up in this form.

The event is a value from outside the type system. A schema checks just the part that's used.

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{event}

### The one stack in this book outside Tokyo

<<< @/examples/10-edge/infra/bin/app.ts{stacks}

A Lambda@Edge function can only be created in `us-east-1`, so this stack alone has a different Region. It's separate from the stack with the distribution, and the link between them is the version ARN, passed by hand. CDK also has a construct that links across Regions automatically (`EdgeFunction`). But it adds a custom resource and another stack behind the scenes, and I couldn't fully trace how cdkd handles those. Here I chose the form where everything that gets created is visible.

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{role}

The logging permission has a `*` for the Region. This book has stuck to "no `*`" so far, but here it can't be avoided. A Lambda@Edge function writes its logs to a Region near where it ran. The log group is named `/aws/lambda/us-east-1.<function name>` in every Region, and which Region it runs in depends on where your readers are. The log group name itself is fixed.

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{function}

`awsSdkConnectionReuse: false` is easy to miss. Left alone, CDK's `NodejsFunction` adds one environment variable. Lambda@Edge refuses functions that have environment variables, so it's turned off. The tests check that the template has no environment variables, VPC settings, or layers.

On the distribution side, the behavior is added only when a version ARN is given.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{digest}

The ARN's shape is checked the moment it's handed to the stack.

<<< @/examples/10-edge/infra/lib/edge-stack.ts{props}

`$LATEST`, an alias, or an ARN in another Region is an error at synth time. You find out far sooner than being turned down by CloudFront halfway through a deploy.

### Deploying it

```bash
AIH_AWS_REGION=us-east-1 vp run infra:bootstrap
vp run edge:body:infra:deploy
vp run edge:infra:deploy -c bodyDigestVersionArn=arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:1
curl -s -X POST --data 'hello edge' https://dxxxxxxxxxxxx.cloudfront.net/digest
```

The second line prints `BodyDigestVersionArn`, which you pass on the third.

This is the least verified part of the chapter. As far as the cdkd source goes, when a stack names a Region, cdkd uses that Region. The built function code probably needs a place in `us-east-1` too, which is what the first line sets up. But none of it has been run. cdkd handles `AWS::Lambda::Version` through Cloud Control API (`AWS::Lambda::Function`, `AWS::IAM::Role`, and `AWS::IAM::Policy` have dedicated implementations). I also haven't confirmed separately that Node.js 24 works on Lambda@Edge; the documentation only says it "supports the latest versions of Node.js".

## Where to put what

<!-- section: 10.placement -->

Here's everything so far in one table.

| | Static delivery | CloudFront Functions | Lambda@Edge | Regional Lambda |
| --- | --- | --- | --- | --- |
| Where it runs | The edge cache | Edge locations | A Region near the reader (replicas) | One Region (Tokyo in this book) |
| When it runs | - | Viewer request, viewer response | All four events | When called (chapter 04) |
| Network | - | None | Yes | Yes |
| Body | - | Can't read | Can read (truncated) | Can read |
| State | The cache only | Reads KVS, nothing more | Holds none; fetches from outside | DynamoDB and the like (chapter 05) |
| Execution time | - | Under 1 ms | Up to 30 seconds | Up to Lambda's limit (30 seconds behind an HTTP API) |
| Code size | - | 10 KB | 50 MB (compressed) | Up to Lambda's limit |
| How settings get in | - | Code or KVS | Code, or fetched at run time | Environment variables and more |
| List price per million | Request charges only | USD 0.10 | USD 0.60 plus duration | USD 0.20 plus duration |

When in doubt, go from the left.

**If it can be served statically, serve it.** A cached response runs not one line of code. It's the fastest, the cheapest, and has the fewest parts to break.

**If the request and its headers decide everything, use CloudFront Functions.** URL rewrites, redirects, adding headers, checking signed tokens. The unit price is low enough to run on every request without a second thought.

**If it calls another service, think of a regional Lambda first.** If your data is in Tokyo, putting the code in Tokyo is the straightforward choice. Running code close to the reader means less when it then makes a round trip to a database in Tokyo.

**Lambda@Edge is for when you really need code just before or just after the cache.** Choosing between origins, transforming an origin response before it's cached, inspecting a body and refusing it before it reaches the origin. Work that can only happen in the middle of CloudFront's flow. Version management, `us-east-1`, no environment variables, logs scattered across Regions: operationally it's the heaviest of the four, so I'd keep it as the last option.

## If you're coming from Workers

<!-- section: 10.workers -->

If you've been using Cloudflare Workers, you probably read this chapter thinking "one Worker could do all of that". You're right. Here it is, side by side.

| | Cloudflare Workers | CloudFront Functions | Lambda@Edge |
| --- | --- | --- | --- |
| Network (`fetch`) | Yes. Subrequests per invocation: 50 on Free, 10,000 by default on Paid | No | Yes |
| CPU time | 10 ms on Free; 30 seconds by default on Paid (up to 5 minutes). Time spent waiting on `fetch` or KV doesn't count | Under 1 ms | Up to 30 seconds of duration |
| Memory | 128 MB per isolate | 2 MB | 128 MB on viewer events; up to Lambda's limit on origin events |
| Code size | 64 MiB (uncompressed) | 10 KB | 50 MB (compressed) |
| Writing to KV | A Worker can write | A function can't write | KVS isn't available |
| KV value size | 25 MiB | 1 KB (5 MB in total) | - |
| KV consistency | Eventually consistent. Documented as possibly taking 60 seconds or more in other locations | Delayed. No number found in the Developer Guide | - |

CloudFront Functions are not the counterpart of Workers. The name and the "JavaScript running at the edge" look are similar, but what they can do differs by orders of magnitude. Workers are a place to write applications; CloudFront Functions are a place to write CDN configuration as code. Think of them that way and they won't blur together.

Getting close to Workers on AWS means combining parts. Small decisions at the entrance go to CloudFront Functions, the application to a Lambda function in Tokyo, the data to DynamoDB. That's the setup this book has been building. It's true that there are more parts, and AWS has nothing like the ease of adding bindings to a single Worker.

What you get instead are boundaries between the parts. A CloudFront Function can't reach the network, so no matter how you write it, an outage somewhere else can't drag it down. Running it on every request costs USD 0.10 per million. For work that fits within those limits, I think it's a well-made tool.

One comparison between the two KVs. Workers KV documents a rough figure for the delay: "up to 60 seconds or more". For CloudFront KVS, I couldn't find a number in the Developer Guide. What they share: neither says a write is readable everywhere right after it's made.

On pricing, the Workers Standard plan includes 10 million requests and 30 million CPU milliseconds a month, then charges USD 0.30 per million requests and USD 0.02 per million CPU milliseconds. I haven't checked the monthly fee itself for this chapter.

## The money part

<!-- section: 10.cost -->

Amounts are in USD, for Japan edge locations, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

Nothing in this chapter's setup charges you just for existing. The distribution and the functions cost 0 unless they're called. S3 storage is a few KB for three HTML files. As for KVS, the Price List has just two items for it, "reads from functions" and "API operations", and I found no item for storage.

In use, it looks like this. The assumptions: 1,000,000 requests a month, of which 10% are the home page, 20% other pages, and 70% files, with 20 syncs a month.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| CloudFront HTTPS requests | 1,000,000 | 1.20 | 0 |
| Transfer from CloudFront to readers | 19.07 GB | 2.17 | 0 |
| CloudFront Functions executions | 1,000,000 | 0 | 0 |
| KVS reads | 1,400,000 | 0 | 0 |
| KVS API operations | 80 | 0.08 | 0.08 (no free allowance confirmed; none deducted) |
| Lambda@Edge requests | 10,000 | 0.01 | 0.01 |
| Lambda@Edge duration | 62.5 GB-seconds | 0.00 | 0.00 |
| S3 GET requests | 333,333 | 0.12 | 0.12 |
| Subtotal | | **3.59** | **0.21** |

For function executions and KVS reads, the first tier in the Price List (up to 2,000,000 a month) is already USD 0, so the list-price column is 0 as well. Beyond it, executions are USD 0.10 per million and reads are USD 0.03 per million.

The number of reads depends on how the function is written. This chapter's function reads once for a file and twice for a page. If it read three times on every request, that would be 3,000,000 reads, past the free tier. This is where the one line "files don't look up the redirect table" pays off.

KVS API operations are USD 1 per 1,000. That's a far higher unit price than reads from inside a function. One sync is three calls (check the version, list, update), so about USD 0.003, but as the keys grow, it adds one list call per page of 50. If you plan on something like running `edge:kvs:plan` often from CI, count them.

Lambda@Edge is USD 0.60 per million requests and USD 0.00005001 per GB-second. According to the pricing page, it has no free tier. Compared with USD 0.0000133334 per GB-second for Lambda in Tokyo (arm64), the duration price is about 3.75 times higher. One thing not in this table: the cost of the logs Lambda@Edge writes to CloudWatch Logs in each Region.

The free allowances apply to pay-as-you-go and are shared across the account.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| You synced, but the old value comes back | Wait first. Propagation to the edge takes time. If `edge:kvs:plan` shows an empty diff, the value is in the KVS |
| The sync stops with an authentication error | The KVS API signs with SigV4A. Temporary credentials need a version 2 session token, and the ones issued by the global STS endpoint (`sts.amazonaws.com`) don't work. Check that you're set up to use a Regional STS endpoint |
| The sync stops with "store is PROVISIONING" | The KVS was just created. Wait until it's `READY` |
| After a deploy, no redirect works | Is the KVS empty? A KVS that was just recreated is. Run `edge:kvs:sync` again |
| Local tests pass, but creating the function fails with a syntax error | Are you using syntax that's not on the documented list? Some things Node.js accepts, runtime 2.0 doesn't |
| `/digest` returns 502 | The Lambda@Edge response didn't pass CloudFront's validation. The logs aren't in `us-east-1`; they're in `/aws/lambda/us-east-1.aih-edge-body-digest` in the Region where it ran |
| You can't delete the Lambda@Edge function | Replicas remain. After removing it from the distribution, they take a few hours to go away |
| You turned on maintenance, but some pages still show | Either propagation is still under way or the browser is holding an earlier response. The 503 carries `no-store`, so it's not CloudFront's cache |

## If you take this to production

- **Limit who can write to the KVS.** Review and merge `edge-data.json`, and let only CI run the sync. Keep direct edits in the console for emergencies. This chapter's script shows a direct edit as a diff on the next `edge:kvs:plan`
- **Don't make the maintenance switch your only defense.** Propagation is delayed, and it doesn't work while KVS can't be read. A lockout that protects data has to happen at the origin as well
- **Watch the function's metrics.** Errors and compute utilization (planned for chapter 19). If utilization is close to the limit, revisit the number of reads and the size of the JSON
- **Estimate the size of the table.** 5 MB, 1 KB per value. If you plan on tens of thousands of redirects, do the math first
- **Set a retention period on the Lambda@Edge log groups.** They're created automatically in each Region where the function runs. They're outside the stack, so you set it yourself
- **Deploy through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Cleaning up

<!-- section: 10.cleanup -->

```bash
vp run edge:unpublish --yes
vp run edge:infra:destroy
```

The bucket, the distribution, the function, and the KVS go away. So do the contents of the KVS (as long as you have `edge-data.json`, you can put them back any time).

If you tried Lambda@Edge, order matters. First detach it from the distribution with `edge:infra:destroy` above (or with `edge:infra:deploy` without `-c bodyDigestVersionArn`). Then wait a few hours. Until CloudFront has finished deleting the replicas around the world, the function can't be deleted.

```bash
vp run edge:body:infra:destroy
```

Three things remain after that.

- **The Lambda@Edge log groups.** `/aws/lambda/us-east-1.aih-edge-body-digest` in each Region where it ran. They were created automatically, outside the stack, so deleting the stack leaves them. They keep costing storage, so delete them in the CloudWatch console, switching Regions as you go
- **The service-linked roles.** `AWSServiceRoleForLambdaReplicator` and `AWSServiceRoleForCloudFrontLogger`. They're created automatically the first time you use Lambda@Edge. They cost nothing
- **cdkd's storage.** If you bootstrapped in `us-east-1`, it remains there too (chapter 02)

::: details Verification notes for this chapter

**Checked locally.** Unit tests for the function (the deployed file run under `node:vm`), KVS planning and sync, the SDK adapter, the Lambda@Edge handler, and both stacks. Type checking. Synth (including the esbuild bundle, with and without `-c bodyDigestVersionArn`). Starting `dev:edge`, running the `curl` commands from the text, and flipping the flags in `edge-data.json`. Starting `dev:edge:cdkd` (cdkd's emulator, no Docker) and getting the same responses to the same `curl` commands. That the SDK client signs in the SigV4A form (without going out to the network).

**Not checked yet.** Nothing has been run in AWS. In particular, these are waiting to be confirmed in a real environment. That `edge-router.js` runs on runtime 2.0 (syntax, 10 KB, 2 MB, compute utilization, `cf.kvs()` without an ID, `get()` rejecting for a missing key). How long a KVS update takes to reach the edge. Which error the KVS API returns for a stale `If-Match`. That AWS accepts the signature from `@aws-sdk/signature-v4a`. That cdkd can actually handle `AWS::CloudFront::KeyValueStore`, `AWS::CloudFront::Function`, and the `AWS::Lambda::Version` in the `us-east-1` stack, and whether a bootstrap in `us-east-1` is needed. That Node.js 24 works on Lambda@Edge. How long Lambda@Edge replicas take to be deleted, and where the log groups are created. The symptoms in the "Where people get stuck" table were put together from the documentation, not reproduced. Whether syntax outside runtime 2.0's list is actually rejected hasn't been tried either.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/10-edge/infra/lib/edge-stack.ts`, `infra/bin/app.ts` | - |
| Reading the function | `examples/10-edge/infra/functions/edge-router.js`, `edge-data.json` | `test:unit` |
| Running the same file under Node.js | `examples/10-edge/src/local/load-function.ts`, `infra/test/edge-router.test.ts` | `test:unit`, `typecheck` |
| Run it on your machine | `examples/10-edge/src/local/dev.ts`, `site/`, `scripts/kvs-file.ts` | `dev:edge`, `dev:edge:cdkd` |
| What does KVS actually promise? | `examples/10-edge/src/kvs/config.ts`, `test/kvs.test.ts` | `test:unit` |
| Changing the table safely | `examples/10-edge/src/kvs/plan.ts`, `src/kvs/sync.ts`, `src/kvs/store.ts`, `scripts/kvs-sync.ts`, `test/sync.test.ts`, `test/store.test.ts` | `edge:kvs:plan`, `edge:kvs:sync`, `test:unit` |
| Getting ready for AWS | `examples/10-edge/infra/lib/edge-stack.ts`, `infra/test/edge-stack.test.ts`, `cdk.json` | `edge:infra:synth`, `test:unit` |
| Deploy it and flip the switches | `tools/src/infra/`, `tools/src/site/publish.ts`, `examples/10-edge/scripts/kvs-sync.ts` | `edge:infra:diff`, `edge:infra:deploy`, `edge:publish`, `edge:kvs:plan`, `edge:kvs:sync`, `edge:infra:drift` |
| When you need the body: Lambda@Edge | `examples/10-edge/src/lambda-edge/body-digest.ts`, `infra/lib/body-digest-stack.ts`, `infra/test/body-digest-stack.test.ts`, `test/body-digest.test.ts` | `edge:body:infra:synth`, `edge:body:infra:deploy`, `edge:body:infra:destroy`, `test:unit` |
| The money part | `data/pricing/`, `tools/src/pricing/calc.ts` | `test:unit` |
| Cleaning up | `tools/src/site/unpublish.ts`, `tools/src/infra/` | `edge:unpublish`, `edge:infra:destroy`, `edge:body:infra:destroy` |

**Primary sources** (all checked 2026-10-11)

- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [JavaScript runtime 2.0 features for CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html)
- [CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html), [Test functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/test-function.html)
- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html), [Helper methods for key value stores](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html), [Work with key value data](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html), [Create a key value store](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create.html), [File format for key-value pairs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create-s3-kvp.html)
- CloudFront KeyValueStore API: [UpdateKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html), [ListKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_ListKeys.html)
- [CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
- [Differences between CloudFront Functions and Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html), [Restrictions on all edge functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html), [Edge function logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-logs.html)
- [Restrictions on Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html), [Set up IAM permissions and roles for Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-permissions.html), [Delete Lambda@Edge functions and replicas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html)
- [AWS News Blog: Introducing Amazon CloudFront KeyValueStore](https://aws.amazon.com/blogs/aws/introducing-amazon-cloudfront-keyvaluestore-a-low-latency-datastore-for-cloudfront-functions/) (a launch post, not a specification)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/), AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json)
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [KV Limits](https://developers.cloudflare.com/kv/platform/limits/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [`src/provisioning/register-providers.ts` (v0.296.28)](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/src/provisioning/register-providers.ts)
- [@aws-sdk/signature-v4a 3.1138.0](https://registry.npmjs.org/@aws-sdk/signature-v4a) (the installed package's source was also read)

:::
