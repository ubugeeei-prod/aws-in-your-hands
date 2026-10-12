---
title: "10 Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge"
sourceRevision: 4
---

# 10 Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge

In [chapter 03](/en/chapters/03-spa.md) you attached a dozen-line function to CloudFront. It rewrote a path to `index.html` when the path had no `.` in it. This chapter gives that small piece of code at the edge more work to do.

You'll build a redirect table that sends old URLs to new ones, a feature flag that switches the home page to a new version, and a switch that puts the whole site into maintenance mode. All three should change without a redeploy, so the data lives in CloudFront KeyValueStore and the function reads it.

After that, the chapter looks at where a given piece of work should run. CloudFront Functions can't do a surprising number of things, so you'll also run one Lambda@Edge function as the option for when they fall short, and the chapter ends by comparing all of it with Cloudflare Workers.

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
node resp: Response
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

The first figure shows the path a reader's request takes. When CloudFront receives a request, it calls the function before it looks in the cache. That point in the request is called the viewer request. The function reads KeyValueStore (KVS from here on) and decides whether to answer on the spot or to rewrite the URL and pass the request on.

The second figure shows the path for changing the table and the switches. The function can read KVS but can't write to it. Values are written from outside the function through a dedicated API, and a written value takes time to reach edge locations around the world. The whole chapter rests on this: reading and writing take separate paths, and there is a delay between them.

### Why the table is not in the function

With three redirects, you could write them straight into the function's code. The chapter doesn't, for two reasons. First, a function's code can be 10 KB at most, and that limit can't be raised, so a growing table eventually stops fitting. Second, every one-line fix to the table would mean redeploying the function. With the table in KVS, code and data can be updated separately.

If the table is small and rarely changes, though, writing it into the code is simpler. KVS reads also cost money, and the [costs page](/en/chapters/10-edge/wrap.md) works out how much. The function in chapter 03 and this book's own site function (`book/infra/functions/url-rewrite.js`) don't use KVS because they have no data to switch.

## What CloudFront Functions can't do

<!-- section: 10.limits -->

Check the constraints before you write any code. If you start without knowing them, you tend to find out halfway and redo the design. The official documentation lists these.

- A function has no network access. There is no `fetch`, no XHR, and no socket, so it can't call an external API or query a database
- There is no file system, no `process`, and no environment variables. To pass settings in, write them into the code or put them in KVS
- There are no timers. Without `setTimeout` or `setImmediate`, a function can't wait or defer work, and it runs straight through to the end
- The clock doesn't move. For the whole run, `Date` returns the time the function started, so you can't measure elapsed time
- A function can't read the request body. It sees the method, the URI, the query string, the headers, and the cookies
- `eval` and the `Function` constructor are not available
- Code can be up to 10 KB and memory up to 2 MB
- A function runs only on viewer request and viewer response. You can't place one just before or just after the origin
- One function can have one KVS attached

Execution time is limited too, but the documentation gives no number in milliseconds. The comparison table says "submillisecond", and actual consumption is reported as compute utilization. Compute utilization is a value from 0 to 100 that says what percentage of the allowed time was used.

The language is JavaScript, but the runtime isn't Node.js. JavaScript runtime 2.0 is described as "compliant with ES 5.1" with "some features of ES versions 6 through 12", and the supported features are listed. `const`, `let`, `async`/`await`, arrow functions, and template literals are on the list. Optional chaining (`?.`), spread syntax, destructuring, `class`, and `for...of` are not. The code in this chapter uses only what is listed. I haven't been able to test whether the unlisted features really fail.

`console.log` differs as well. It takes one argument only, so you can't write `console.log("a", b)`.

## Reading the function

<!-- section: 10.router -->

The function is in `examples/10-edge/infra/functions/edge-router.js`. Start with the part that reads KVS.

<<< @/examples/10-edge/infra/functions/edge-router.js{kvs}

The file imports the `cloudfront` module and gets the KVS attached to the function with `cf.kvs()`. There are three ways to read, `get`, `exists`, and `meta`, and this function uses only `get`.

`get` rejects when the key doesn't exist, so `read` wraps it in `try`/`catch` and returns `null` on failure. That wrapping contains a design choice. `read` doesn't tell a missing key apart from a read that failed. It treats both as "no rule", and the site keeps serving. The reasoning is that losing redirects is better than losing the whole site when KVS can't be read. The cost is that the maintenance switch doesn't work either while KVS can't be read.

The reads are awaited one after another. Batching them with `Promise.all` is tempting, but the documentation advises against it, because it uses more memory and for now isn't any faster.

The handler comes next.

<<< @/examples/10-edge/infra/functions/edge-router.js{handler}

The three lines about `/digest` at the top are for the Lambda@Edge function added later, and the [deploy page](/en/chapters/10-edge/deploy.md) explains them. Apart from those lines, the handler works in three steps from top to bottom.

In the first step, if the site is under maintenance, the handler returns a 503 and stops. Neither the cache nor the origin is involved.

In the second step, it looks the path up in the redirect table. It skips the lookup for paths whose last segment contains a `.`, which are files such as `/assets/app.css`, and for paths longer than 256 characters. Files are never redirected, so skipping saves one read on every request for a file.

If neither step applies, the third step rewrites the URL. `/` becomes `/index.html` or `/home-v2.html` depending on the flag, and a path like `/pricing/` becomes `/pricing/index.html`. The rewrite happens before the cache lookup, so the two home pages are cached under two different URLs. You therefore don't need to clear the cache when you flip the flag.

### Checking the redirect value again in the function

<<< @/examples/10-edge/infra/functions/edge-router.js{redirect}

The values in KVS are checked before they are written, by the update script on the [next page](/en/chapters/10-edge/local.md). The function checks them again because KVS can also be edited from the console. As long as a value can get in without passing through the script, the code that reads it last has to check it.

What the function guards is that a reader is never sent off the site. If someone stores `https://...` or `//example.org` as a value, a URL on your domain becomes an entrance to someone else's site. This problem is known as an open redirect. The function therefore accepts only paths that start with `/`, don't start with `//`, and contain no backslash.

`cache-control` is set to five minutes because browsers remember a 301 with no lifetime indefinitely. Without it, a mistake in the table would stay in readers' browsers even after you fixed the table.

### The maintenance response

<<< @/examples/10-edge/infra/functions/edge-router.js{maintenance}

A function can return a response of its own instead of the request. This 503 carries `no-store` so that nothing caches it. Note that a response of 400 or above returned by a function is not replaced by the distribution's custom error pages.

## Running the same file under Node.js

<!-- section: 10.tests -->

As in chapter 03, the tests load the very file that gets deployed. With a copy, you would sooner or later fix the copy and forget the original. This time `import cf from "cloudfront"` gets in the way, because the `cloudfront` module exists only at the edge.

<<< @/examples/10-edge/src/local/load-function.ts{load}

The loader removes the one import line and passes in a stand-in named `cf` instead. It changes nothing else. If the import line isn't what the loader expects, it throws an error rather than carrying on.

A fresh `node:vm` context has no `fetch`, no `setTimeout`, no `process`, and no `require`. If the function uses any of them by accident, the test fails with a `ReferenceError`. This reproduces a part of the real runtime's restrictions.

The stand-in for KVS looks like this.

<<< @/examples/10-edge/src/local/load-function.ts{stand-in}

Like the real store, the stand-in rejects for a missing key. It also records which keys were read. Every read is billed, so the tests pin down that a request for a file reads the store only once.

```bash
vp run test:unit
```

`examples/10-edge/infra/test/edge-router.test.ts` checks the following.

- Rewrites and redirects follow the table, and the query string is carried over
- A redirect to another site written directly into KVS is not followed
- During maintenance, every path gets a 503 and nothing reaches the origin
- Serving continues when KVS is empty and when every read fails
- A file takes one read, a page two, and the home page three
- The file fits in 10 KB
- No syntax from outside the documented list (`?.`, spread syntax, destructuring, and so on) has slipped in

The last check is a plain text search, not a parser. It catches what someone used to Node.js types out of habit, and no more than that.

That is as far as these tests go. They run under Node.js, so they can't tell you whether runtime 2.0 really accepts this syntax, whether the function fits in 2 MB of memory, or whether it finishes within the time limit. CloudFront has a test feature that runs a function against an event before it is published and returns the result along with its compute utilization. Use that feature to check against the real runtime.
