---
title: "10 Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge"
sourceRevision: 1
---

# 10 Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge

Back in [chapter 03](/en/chapters/03-spa.md), you attached a dozen-line function to CloudFront. The one that rewrites a path to `index.html` when it has no `.` in it. In this chapter, that "small code running at the edge" gets a bit more to do.

You'll build three things: a redirect table that sends old URLs to new ones, a feature flag that switches the home page to a new version, and a switch that puts the whole site into maintenance mode. You want to flip all of these without redeploying, so the data lives in CloudFront KeyValueStore and the function reads it.

Then comes the real question: where should a given piece of work run? CloudFront Functions can't do more things than you might expect. You'll run one Lambda@Edge function as the option for when they fall short, and at the end we'll put all of it next to Cloudflare Workers.

The prerequisite is chapter 03. The code is in `examples/10-edge/`.

## The big picture

<!-- section: 10.architecture -->

```figure
caption: A reader's request passes through the CloudFront Function before the cache, and the function reads KeyValueStore to decide whether to answer on the spot or pass the request on
node reader: Reader
node fn: CloudFront Function "edge-router" | viewer-request, runtime 2.0
node cache: CloudFront cache
node kvs: KeyValueStore
node digest: Lambda@Edge "body-digest" | origin-request, optional, only on /digest
node resp: response
node s3: S3 bucket | private, ap-northeast-1
edge reader -> fn: HTTPS
edge fn --> reader: 503 or 301/302 here; nothing below runs
edge fn -> cache: otherwise: rewrites the URI, passes it on
edge fn -> kvs: reads only
edge cache -> digest: miss
edge cache --> resp: hit
edge digest -> s3
group edge: CloudFront edge location = fn, cache, kvs
mark fn
```

```figure
caption: The path that changes the values lies outside the function, and a written value takes time to reach the edge locations
node op: Operator | edge-data.json
node api: KeyValueStore API | global endpoint, SigV4A, If-Match: ETag
node kvs: CloudFront KeyValueStore | flag:maintenance, redirect:<path>, flag:new-home
edge op -> api: vp run edge:kvs:sync
edge api --> kvs: propagation to edge locations: not immediate
mark kvs
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
