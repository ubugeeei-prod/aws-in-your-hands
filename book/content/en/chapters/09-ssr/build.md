---
title: "09 SSR: Design and Build"
---

# 09 SSR: Design and Build

## From CloudFront to Lambda

<!-- section: 09.connect -->

In chapter 04, an API Gateway HTTP API stood in front of Lambda. This time CloudFront is in front. How should CloudFront reach Lambda? There are two candidates.

| | Lambda function URL | API Gateway HTTP API |
| --- | --- | --- |
| Extra charge | None (Lambda's own charges only) | Per request (chapter 04) |
| Refusing calls that don't come from CloudFront | Origin access control can make a signature mandatory | No built-in mechanism; you improvise with a custom header or similar |
| Response streaming | Yes | No (as in chapter 04's table; REST APIs have it) |
| JWT authorizer, throttling, per-route settings | No | Yes |
| POST from a browser | Doesn't pass as-is when combined with origin access control (see below) | Passes |

A function URL is a dedicated HTTPS endpoint attached to one Lambda function. This chapter picks it. The reasons: serving public pages needs none of API Gateway's features, and "Lambda refuses any request that didn't come through CloudFront" can be written in IAM.

The other way round, if you want POST from browsers, JWT validation at the door, or per-route rate limits, that's when you choose API Gateway instead.

### The function

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{function}

The difference from chapter 04 is `code`. Instead of `NodejsFunction`, it hands over the `.output/server` that Nitro made, as it is. The execution role is the same as in chapter 04: it may write to its own log group and nothing more.

`timeout` is 10 seconds. CloudFront waits 30 seconds for an origin's response by default. Running longer than that means nobody is left to receive the answer.

The last few lines are a ceiling on how many copies run at once (reserved concurrency). It's off by default. Pass something like `-c reservedConcurrency=5` at deploy time and it's on.

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{reserved}

In chapter 04 we put a requests-per-second limit on API Gateway. A function URL behind CloudFront has no free setting like that. Every request that misses the cache runs the function, however many arrive. This number is what can cap that. Whatever goes past it is refused without the function running.

It's not the default because the deploy might fail. Reserved concurrency sets N aside out of the account's whole concurrency allowance. A brand-new account can have a small allowance, and then the reservation itself is refused. What happens in your account is something this book can't check. When to turn it on comes up under "What it costs", with numbers.

### Don't leave the function URL public

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{url}

A function URL has an `AuthType`. Set it to `NONE` and anyone who knows the URL can call the function. They'd bypass CloudFront, which makes the cache settings, and any WAF you add later, meaningless.

Here it is `AWS_IAM`. Lambda turns away an unsigned request with a 403 before the function runs. And CloudFront's origin access control (OAC) signs the requests it sends to the origin. It's the Lambda version of what chapter 03 used for S3.

CDK's `origins.FunctionUrlOrigin.withOriginAccessControl` adds two permissions to the function's resource policy: `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`. Both name `cloudfront.amazonaws.com` as the principal and this distribution's ARN as the condition. A function URL created from October 2025 on needs both. The tests check that these two are the only permissions, and that none has `*` as its `Principal`.

One constraint here matters later. With OAC, the sender of a POST or PUT request has to put the SHA-256 of the body in an `x-amz-content-sha256` header. An ordinary HTML form sends no such header. So this stack lets only GET and HEAD through, and CloudFront turns POST away before it gets anywhere.

### Follow the shape of the build

<<< @/examples/09-ssr/infra/bin/app.ts{app}

The function URL's `InvokeMode` is the setting that pairs with the handler's shape. `BUFFERED` receives the whole response and then returns it; `RESPONSE_STREAM` receives it as a stream. Rather than have a person keep two places in step, the stack reads `nitro.json`. The shape that was built becomes the setting.

What happens when the two disagree isn't described in the AWS documentation, and it hasn't been tried on real infrastructure. That's the reason for building it so they can't disagree.

## Where the cache boundary is

<!-- section: 09.cache -->

Now the main subject. First, the accident to avoid, concretely.

1. Alice signs in and opens `/me`. Lambda builds "Alice's page" and returns it
2. CloudFront stores that response as the answer for `/me`
3. Bob opens `/me`. CloudFront doesn't ask Lambda; it returns the stored page, which is Alice's

Unless you configure it otherwise, CloudFront doesn't look at cookies. Two requests that differ only in their cookies are the same request to it. That's why step 3 happens.

Here is what must hold, in one sentence.

**A response that was built after looking at someone's cookie or `Authorization` header never enters a shared cache.**

Guard that in one place only, and it leaks the moment that place is wrong. So there are three layers.

### Layer 1: split by path

<<< @/examples/09-ssr/core/routes.ts{routes}

Everything that varies per person goes under `/me`. That's the whole rule. Both the app and the CDK stack import this definition, so that "the app thinks `/account` is personal too, but CloudFront was never told" can't happen.

### Layer 2: no cookies reach the public side

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{public-policy}

This is the cache policy for everything except `/me`. `cookieBehavior` and `headerBehavior` are `none`. In CloudFront, a value that isn't in the cache key isn't sent to the origin either. So the Lambda function that builds a public page never receives a cookie in the first place.

`queryStringBehavior` is `none` too. None of this chapter's pages reads a query string. Put it in the cache key and `/?x=1` and `/?x=2` are separate cache entries. Anyone could miss the cache every time just by appending a random number, and each miss runs the 512 MB function. Left out, the same path is the same cache entry whatever is appended. When you add a page that does read a query string, list only the names it reads, as in `cloudfront.CacheQueryStringBehavior.allowList("page")`.

Back to cookies. This is what does the work. With no cookie, Lambda has no way of knowing who is looking. What it doesn't know, it can't write into the HTML. If someone later adds code that shows "Hello, Alice" on a public page, it works only on their machine; through CloudFront, no name appears. The accident falls on the side of "nothing is shown," not "it leaks."

The three TTL numbers each mean something too.

- `minTtl` is 0. At 1 or more, CloudFront caches for that many seconds even when the origin returns `Cache-Control: private, no-store`. The documentation carries this as a warning
- `defaultTtl` is 0 as well. A response with no `Cache-Control` isn't cached
- `maxTtl` is 60 seconds. If the app asks for a long time by mistake, this is the ceiling

One more thing: `Set-Cookie`. CloudFront can cache the `Set-Cookie` an origin returned along with the response, and hand the same cookie to everyone who hits the cache. If that happened with a session cookie, everybody would be signed in as the same person. That's why the response headers policy on the public side removes `Set-Cookie`.

And the `/me` side.

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{personal}

`CACHING_DISABLED` is the managed policy that turns caching off. Whatever headers the app sends, nothing under `/me` is stored. This is the only place where cookies are delivered to Lambda.

The distribution lines up these two kinds of behavior.

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{distribution}

### Layer 3: the app says so itself

The CloudFront settings aren't trusted alone. For every response, the app also says "this may be shared" or "this may not," in a header. That header is the only thing a local dev server understands, or any other cache that may someday sit before or after CloudFront.

<<< @/examples/09-ssr/core/cache-control.ts{values}

The value for a shareable response is `public, max-age=0, s-maxage=60`. It means: the browser asks CloudFront again every time (`max-age=0`), and CloudFront may answer by itself for up to 60 seconds (`s-maxage=60`).

<<< @/examples/09-ssr/core/cache-control.ts{decide}

Only a response that reaches the last line may be shared. It's a GET or HEAD, outside `/me`, with neither a cookie nor `Authorization` on the request, setting no cookie, with status 200. Miss any one of those and it's `private, no-store`.

The cookie's name isn't inspected. Any cookie at all stops sharing. Write "only for the session cookie" and a hole opens the day someone renames the cookie.

A Nitro plugin puts this on every response.

<<< @/examples/09-ssr/server/plugins/cache-control.ts{plugin}

The point is that there are two hooks. The moment a request arrives, `private, no-store` goes on. After the handler has finished, the responses that meet the conditions are rewritten to `public`. If an exception stops the second hook from running, what remains is the "don't share" value.

### What actually went wrong

There's a slightly odd condition called `isInternalPath`. A test taught me that one.

Open a note that doesn't exist and Nuxt returns a 404 error page. To build it, Nuxt calls a path named `/__nuxt_error` once more inside the server, and copies the headers of that inner response onto the real, outer one. The inner request is "a GET with no cookie, and the status is 200." The first version of the code judged that to be a public page and put `public, s-maxage=60` on the 404.

The check that calls the built handler for real (`ssr:check:output`, coming up) found it. You can pull the decision out into a pure function and test it, and still not know when, or how many times, the framework calls that function until you run it. This was a case of that.

### Reproducing the leak, in a fixed order

`test/support/shared-cache.ts` is a deliberately sloppy shared cache. Its key is the path alone, it passes every cookie to the origin, and it stores whatever `Cache-Control` permits, `Set-Cookie` included. Think of it as the worst-configured CDN.

The tests send requests through this cache in the order "Alice, then Bob."

- With an origin that puts `public` on everything, Alice's page reaches Bob. This test confirms that the leak happens. If the mechanism couldn't detect a leak, passing it would mean nothing
- With an origin that uses this chapter's decision, Alice's page doesn't reach Bob, on `/me` or on `/`. The same holds with the order reversed
- The only thing left in the cache is a response built without a cookie

The same sequence is also run against the real, built handler. That comes after the BFF section.

## A BFF: the token stays on the server

<!-- section: 09.bff -->

The SPA in chapter 06 kept the access token in the browser's memory. The table under ["Where does the token live?"](/en/chapters/06-auth.md) listed a third option: "A server-side session and a cookie (chapter 09)." This is the continuation.

If the server builds the HTML, the server is what calls the API. Then the server may as well hold the token. The browser gets a session ID that means nothing by itself. A server that exists for one front end and holds the token on the browser's behalf is called a backend for frontend (BFF).

```figure
caption: The browser holds only a session ID, and the BFF holds the access token and calls the API.
type: sequence
actor browser: Browser
actor bff: BFF | the Nuxt server
actor api: API behind it
step browser -> bff: Cookie: session id
step bff -> bff: session id -> access token
step bff -> api: Authorization: Bearer <token>
step api --> bff: profile
step bff --> browser: HTML or JSON, no token
mark bff
```

To be upfront: the BFF in this chapter works only on your machine. The reasons come together below. Code first.

### The cookie

<<< @/examples/09-ssr/core/session.ts{cookie}

A cookie marked `HttpOnly` can't be read from JavaScript. Even if a malicious script gets into the page, it can't carry the session ID away. As chapter 06 said, this doesn't replace defending against XSS itself. A script that got in can still act as the user from that page. What it can no longer do is take the credential and use it somewhere else.

`path` is `/me`. The browser attaches this cookie only to requests under `/me`. The same boundary as cache layer 1 is drawn in the browser too.

### The session and the token

<<< @/examples/09-ssr/core/session.ts{store}

Inside the session is `accessToken`. That it never leaves the server is the BFF's promise.

Here is the sign-in route.

<<< @/examples/09-ssr/server/routes/me/sign-in.post.ts{sign-in}

It's for practice, so typing a name makes you that person. A real BFF would send chapter 06's authorization code to the token endpoint here and receive tokens. After that it's the same: the token goes into the session, and only the session ID goes back to the browser.

`isSameOrigin` is the check that turns away a POST from a form placed on someone else's site. Once you authenticate by cookie, this kind of request (CSRF) becomes something to care about. It's homework that chapter 06's `Authorization` header approach didn't have.

And the shape of what goes back to the browser.

<<< @/examples/09-ssr/core/profile.ts{viewer}

The type has no place to put a token.

<<< @/examples/09-ssr/server/routes/me/api/viewer.get.ts{viewer}

It looks up the session from the cookie, calls the API behind it with the session's token, and returns only the profile that comes back. In this chapter the API behind it is a practice implementation in the same process.

### Why it works only locally

There are two reasons, and you've met both in this chapter.

First, sessions sit in Lambda's memory. As chapter 04 showed, there may be more than one execution environment, and you don't choose when one disappears. If the request after sign-in lands in another one, you're no longer signed in. To make this real, sessions go somewhere every environment can read, such as chapter 05's DynamoDB.

Second, sign-in is a POST. The combination of a function URL and OAC doesn't let a POST from a browser form through as it is.

So the deployed stack turns the practice sign-in off (`AIH_SSR_SIGN_IN=off`). And if it's left on by accident, the server stops at startup on Lambda.

<<< @/examples/09-ssr/core/env.ts{env}

What can be checked in a deployed environment goes as far as "`/me` isn't cached, with or without a cookie." That someone holding a cookie really gets their own page is checked only locally and against the built handler.

## Streaming is about the whole path

<!-- section: 09.streaming -->

Response streaming means sending a response piece by piece as it is produced, before all of it exists. The first byte arrives sooner, and Lambda's 6 MB limit on response size (for buffered responses) widens to 200 MB.

But if any single hop on the way "waits until everything has arrived," the reader gets it all at once. So let's go hop by hop.

| Hop | Streams? | How it was checked |
| --- | --- | --- |
| Nuxt's HTML | No. It's written in one go | Called the built handler and counted the writes (one) |
| Nitro's handler | With `streaming: true`, it writes a route that returns a `ReadableStream` bit by bit | Same. `/feed` wrote 3 lines in 3 writes, about 300 ms apart |
| Lambda | The managed Node.js runtimes support it | AWS documentation. Not checked on real infrastructure |
| Function URL | Supported with `InvokeMode: RESPONSE_STREAM`. Not for functions inside a VPC | AWS documentation. Not checked on real infrastructure |
| CloudFront | Not confirmed | I haven't been able to check it |
| The receiving end | Node.js `fetch` could read each piece as it arrived | Checked against the local dev server. Not checked in a browser |

The top row matters first. The pinned Nuxt turns a page into a single string before handing it over. Even with the streaming handler, the HTML was written in one go. For Nuxt pages, streaming doesn't make the first byte arrive any sooner.

To watch something arrive bit by bit, there's a route called `/feed`.

<<< @/examples/09-ssr/server/routes/feed.get.ts{feed}

The local check swaps the `awslambda` global that the Lambda runtime provides for a fake that only records, and then calls the handler.

<<< @/examples/09-ssr/scripts/lambda-harness.ts{fake-runtime}

What this confirms goes as far as "when, and what, Nitro's handler tries to write." Whether Lambda, the function URL, and CloudFront really pass the pieces along one by one can only be seen by deploying and watching `curl -N`. To be honest, I haven't seen that yet.

### Why this chapter defaults to buffered

Streaming has a price as well.

CloudFront compresses a response itself only when the origin's response has a `Content-Length`. Nitro's streaming handler adds `Transfer-Encoding: chunked` to the response. A response of unknown length is one CloudFront doesn't compress; that's how the documentation reads (not checked on real infrastructure). HTML that goes out uncompressed means more bytes transferred.

The bill changes a little too. A streamed response costs USD 0.008 per GB for whatever exceeds the first 6 MB of each request. And if the reader disconnects in the middle of a stream, the function doesn't stop. You're billed for the time it ran to the end.

Nuxt pages are written in one go, so streaming gains them nothing. That's why buffered is the default. You'll want streaming when a response exceeds 6 MB, or when you add a route where arriving bit by bit is the point, such as AI output. Then do this.

```bash
vp run ssr:check:output:stream
vp run ssr:infra:deploy
```

The first rebuilds in the streaming shape and checks it; the second deploys that `.output` along with the `InvokeMode` that matches it. To go back to buffered, run `vp run build:ssr`.
