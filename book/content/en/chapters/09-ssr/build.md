---
title: "09 SSR: Design and Build"
---

# 09 SSR: Design and Build

On [the previous page](/en/chapters/09-ssr.md) you built Nuxt into a shape that Lambda can run. This page puts that build behind CloudFront and then goes through the cache boundary, the BFF, and streaming, in that order.

## From CloudFront to Lambda

<!-- section: 09.connect -->

In chapter 04 an API Gateway HTTP API stood in front of Lambda. This time CloudFront does, and there are two ways to connect CloudFront to Lambda.

| | Lambda function URL | API Gateway HTTP API |
| --- | --- | --- |
| Extra charge | None (Lambda's own charges only) | Per request (chapter 04) |
| Refusing calls that don't come from CloudFront | Origin access control can make a signature mandatory | No built-in mechanism; you improvise with a custom header or similar |
| Response streaming | Yes | No (as in chapter 04's table; REST APIs have it) |
| JWT authorizer, throttling, per-route settings | No | Yes |
| POST from a browser | Does not pass as it is when combined with origin access control (see "Don't leave the function URL public" on this page) | Passes |

A function URL is a dedicated HTTPS endpoint attached to one Lambda function. This chapter uses a function URL, because serving public pages needs none of API Gateway's features and because the rule "Lambda refuses any request that did not come through CloudFront" can be written in IAM.

If you need to accept POST from browsers, validate JWTs at the entrance, or limit the rate per route, choose API Gateway instead.

### The function

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{function}

The difference from chapter 04 is `code`. The stack does not use `NodejsFunction` and passes the `.output/server` directory that Nitro produced, unchanged. The execution role is the same as in chapter 04 and can only write to the function's own log group.

`timeout` is 10 seconds. CloudFront waits 30 seconds for an origin's response by default, so a function that runs longer than that has nobody left to answer.

The last few lines set a limit on how many invocations run at once (reserved concurrency). The limit is off by default and is set when you pass something like `-c reservedConcurrency=5` at deploy time.

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{reserved}

In chapter 04 you put a limit on requests per second in API Gateway. A function URL behind CloudFront has no free setting that does the same, so every request that misses the cache runs the function, however many arrive. Reserved concurrency puts a limit on that number, and requests beyond the limit are refused without running the function.

It is not the default because it can make the deploy fail. Reserved concurrency sets N aside from the account's total concurrency. A new account can have a small total, and then the reservation itself is refused. You can reserve up to the account's concurrency quota minus 100, because 100 must stay unreserved for functions that have no reservation ([chapter 32](/en/chapters/32-limits.md)). When to turn it on is covered, with the amounts, under "When it gets hammered" on [the costs page](/en/chapters/09-ssr/wrap.md).

### Don't leave the function URL public

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{url}

A function URL has an `AuthType` setting. With `NONE`, anyone who knows the URL can call the function. Because they can go around CloudFront, the cache settings and any WAF you add later stop having an effect.

The stack therefore sets `AuthType` to `AWS_IAM`. Lambda refuses an unsigned request with a 403 before the function runs, and CloudFront's origin access control (OAC) signs the requests it sends to the origin. This is the Lambda counterpart of what chapter 03 used for S3.

CDK's `origins.FunctionUrlOrigin.withOriginAccessControl` adds two permissions to the function's resource policy, `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`. Both name `cloudfront.amazonaws.com` as the principal and this distribution's ARN as the condition. A function URL created in October 2025 or later needs both. The tests check that these two are the only permissions and that none of them has `*` as its `Principal`.

OAC comes with one constraint that affects a later section. For a POST or PUT request, the sender has to put the SHA-256 of the body in an `x-amz-content-sha256` header. An ordinary HTML form does not send that header, so this stack allows only GET and HEAD, and CloudFront refuses POST.

### Follow the shape of the build

<<< @/examples/09-ssr/infra/bin/app.ts{app}

The function URL's `InvokeMode` has to match the shape of the handler. `BUFFERED` receives the whole response and then returns it, and `RESPONSE_STREAM` receives it as a stream. So that nobody has to keep the two in step by hand, the stack reads `nitro.json`, and the shape that was built becomes the `InvokeMode`.

The AWS documentation does not say what happens when the handler's shape and `InvokeMode` disagree, and I have not tried it on real infrastructure. Since the outcome is unknown, the stack is built so that they cannot disagree.

## The cache boundary

<!-- section: 09.cache -->

This is the most important section of the chapter. The accident to prevent happens in this order.

1. Alice signs in and opens `/me`. Lambda builds Alice's page and returns it
2. CloudFront stores that response as the answer for `/me`
3. Bob opens `/me`. CloudFront does not ask Lambda and returns the stored page, which is Alice's

Unless you configure it to, CloudFront does not look at cookies. It treats two requests that differ only in their cookies as the same request, and that is why step 3 happens.

The rule to uphold fits in one sentence.

**A response built after looking at someone's cookie or `Authorization` header never enters a shared cache.**

If only one place upholds the rule, a mistake in that place is a leak. The chapter therefore upholds it in three layers.

### Layer 1: split by path

<<< @/examples/09-ssr/core/routes.ts{routes}

Everything that varies from person to person goes under `/me`, and that is the only rule. Both the app and the CDK stack import this definition, so the app cannot treat `/account` as personal while the CloudFront configuration leaves it out.

### Layer 2: no cookies reach the public side

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{public-policy}

This is the cache policy for everything outside `/me`. `cookieBehavior` and `headerBehavior` are `none`. CloudFront does not send the origin a value that is not in the cache key, so the Lambda function that builds a public page never receives a cookie.

`queryStringBehavior` is `none` as well. None of this chapter's pages reads a query string. With the query string in the cache key, `/?x=1` and `/?x=2` would be separate cache entries, and anyone could miss the cache on every request by appending a random number, running the 512 MB function each time. With the query string left out, the same path hits the same cache entry whatever is appended. When you add a page that reads a query string, put only the names it reads in the key, as in `cloudfront.CacheQueryStringBehavior.allowList("page")`.

Withholding cookies has a second effect. Without a cookie, Lambda has no way to know who is looking, and it cannot write a name it does not know into the HTML. If someone later adds code that shows "Hello, Alice" on a public page, the name appears only on their own machine and not through CloudFront. A mistake results in something not being shown, not in something leaking to another person.

Each of the three TTL values has a reason.

- `minTtl` is 0. At 1 or more, CloudFront caches for that many seconds even when the origin returns `Cache-Control: private, no-store`. The documentation describes this behavior in a warning
- `defaultTtl` is also 0, so a response with no `Cache-Control` is not cached
- `maxTtl` is 60 seconds, so 60 seconds is the limit even if the app asks for longer by mistake

`Set-Cookie` needs care too. CloudFront can cache the `Set-Cookie` header an origin returned along with the response and hand the same cookie to everyone who hits the cache. If that happened with a session cookie, everyone would be signed in as the same person. That is why the response headers policy on the public side removes `Set-Cookie`.

The `/me` side looks like this.

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{personal}

`CACHING_DISABLED` is the managed policy that turns caching off. Whatever headers the app returns, no response under `/me` is stored. This behavior is the only one that delivers cookies to Lambda.

The distribution lists these two kinds of behavior.

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{distribution}

### Layer 3: the app says so itself

The app does not rely on the CloudFront settings alone. It also states in a header, for every response, whether the response may be shared. That header is the only signal that the local dev server understands, and the only one that would reach another cache placed before or after CloudFront in the future.

<<< @/examples/09-ssr/core/cache-control.ts{values}

The value for a shareable response is `public, max-age=0, s-maxage=60`. `max-age=0` tells the browser to ask CloudFront again every time, and `s-maxage=60` lets CloudFront answer by itself for up to 60 seconds.

<<< @/examples/09-ssr/core/cache-control.ts{decide}

Only a response that reaches the last line of the function may be shared. It has to be a GET or HEAD, outside `/me`, with no cookie and no `Authorization` on the request, setting no cookie, and with status 200. If any one condition fails, the value is `private, no-store`.

The function does not look at the cookie's name, and any cookie at all prevents sharing. A condition such as "only for the session cookie" would open a hole on the day someone renames the cookie.

A Nitro plugin applies this decision to every response.

<<< @/examples/09-ssr/server/plugins/cache-control.ts{plugin}

There are two hooks for a reason. The first sets `private, no-store` as soon as a request arrives. The second runs after the handler has finished and rewrites the header to `public` only for responses that meet the conditions. If an exception keeps the second hook from running, the value that remains is the one that forbids sharing.

### What actually went wrong

The `isInternalPath` condition in the decision is hard to explain from the code alone. I learned it was needed only when a test failed.

When you open a note that does not exist, Nuxt returns a 404 error page. To build that page, Nuxt calls the path `/__nuxt_error` once more inside the server and copies the headers of that inner response onto the real, outer response. The inner request is a GET with no cookie, and its status is 200. The first version of the code judged it to be a public page and put `public, s-maxage=60` on the 404 response.

The mistake was found by the check that calls the built handler for real (`ssr:check:output`, under [Run It Locally](/en/chapters/09-ssr/local.md)). Even when a decision is extracted into a pure function and tested, you do not know when or how many times the framework calls that function until you run it.

### Reproducing the leak, in a fixed order

`test/support/shared-cache.ts` is a shared cache that is sloppy on purpose. Its key is the path alone, it passes every cookie to the origin, and it stores any response that `Cache-Control` permits, `Set-Cookie` included. It stands for a CDN with the worst possible configuration.

The tests send requests through this cache as Alice and then as Bob.

- With an origin that puts `public` on every response, Alice's page reaches Bob. This test confirms that the leak really happens, because if the setup could not detect a leak, the other tests passing would mean nothing
- With an origin that uses this chapter's decision, Alice's page does not reach Bob, on `/me` or on `/`. The same holds with the order reversed
- The only responses left in the cache are ones built without a cookie

The same sequence is also run against the real, built handler. You run that check under [Run It Locally](/en/chapters/09-ssr/local.md).

## A BFF: the token stays on the server

<!-- section: 09.bff -->

The SPA in chapter 06 kept the access token in the browser's memory. The table in [chapter 06](/en/chapters/06-auth.md) that compared places to keep a token listed a third option, a server-side session with a cookie, and left it to chapter 09. This section picks it up.

If the server builds the HTML, the server is also what calls the API. The server can then hold the token too, and the browser gets only a session ID that means nothing by itself. A server that exists for one front end and holds the token on the browser's behalf is called a backend for frontend (BFF).

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

The BFF in this chapter works only on your machine. The reasons are collected under "Why it works only locally," after the code.

### The cookie

<<< @/examples/09-ssr/core/session.ts{cookie}

JavaScript cannot read a cookie marked `HttpOnly`, so a malicious script that gets into the page cannot take the session ID away. As chapter 06 said, this does not replace defending against XSS itself, because a script that got in can still act as the user from that page. What it prevents is taking the session ID and using it somewhere else.

`path` is `/me`, so the browser attaches this cookie only to requests under `/me`. That draws the same boundary as cache layer 1 on the browser's side as well.

### The session and the token

<<< @/examples/09-ssr/core/session.ts{store}

The session contains `accessToken`. The BFF's promise is that this value never leaves the server.

This is the sign-in route.

<<< @/examples/09-ssr/server/routes/me/sign-in.post.ts{sign-in}

It is for practice, so typing a name makes you that person. A real BFF would send chapter 06's authorization code to the token endpoint at this point and receive tokens. The rest is the same: the token goes into the session, and only the session ID goes back to the browser.

`isSameOrigin` is the check that refuses a POST from a form on another site. Once you authenticate by cookie, you have to defend against this kind of request (CSRF). Chapter 06's approach with the `Authorization` header did not need that defense.

This is the type of the value that goes back to the browser.

<<< @/examples/09-ssr/core/profile.ts{viewer}

The type has no field for a token.

<<< @/examples/09-ssr/server/routes/me/api/viewer.get.ts{viewer}

The route looks up the session from the cookie, calls the API behind it with the session's token, and returns only the profile that comes back. In this chapter the API behind it is a practice implementation in the same process.

### Why it works only locally

There are two reasons, and both have already come up in this chapter.

The first is that sessions are kept in Lambda's memory. As chapter 04 showed, there can be more than one execution environment, and you do not choose when one disappears. If the request after sign-in reaches a different execution environment, you are treated as not signed in. To make this real, keep sessions somewhere every execution environment can read, such as chapter 05's DynamoDB.

The second is that sign-in is a POST. A function URL combined with OAC does not pass a POST from a browser form as it is.

The deployed stack therefore turns the practice sign-in off (`AIH_SSR_SIGN_IN=off`). If it is left on by mistake and put on Lambda, the server stops with an error at startup.

<<< @/examples/09-ssr/core/env.ts{env}

In a deployed environment you can check only that `/me` is not cached, with or without a cookie. That someone holding a cookie really gets their own page is checked only locally and against the built handler.

## Streaming depends on the whole path

<!-- section: 09.streaming -->

Response streaming sends a response piece by piece as it is produced, before all of it exists. The first byte arrives sooner, and Lambda's limit on response size goes from 6 MB for a buffered response to 200 MB.

If any one hop on the way waits until everything has arrived, though, the reader gets the response all at once. The table checks each hop in turn.

| Hop | Streams? | How it was checked |
| --- | --- | --- |
| Nuxt's HTML | No. It's written in one go | Called the built handler and counted the writes (one) |
| Nitro's handler | With `streaming: true`, it writes a route that returns a `ReadableStream` bit by bit | Same. `/feed` wrote 3 lines in 3 writes, about 300 ms apart |
| Lambda | The managed Node.js runtimes support it | AWS documentation. Not checked on real infrastructure |
| Function URL | Supported with `InvokeMode: RESPONSE_STREAM`. Not for functions inside a VPC | AWS documentation. Not checked on real infrastructure |
| CloudFront | Not confirmed | I haven't been able to check it |
| The receiving end | Node.js `fetch` could read each piece as it arrived | Checked against the local dev server. Not checked in a browser |

Look at the top row first. The pinned version of Nuxt turns a page into a single string before handing it over. Even with the handler built in the streaming shape, the HTML was written in one go. For Nuxt pages, streaming does not make the first byte arrive any sooner.

The example includes a route, `/feed`, that lets you watch a response arrive bit by bit.

<<< @/examples/09-ssr/server/routes/feed.get.ts{feed}

The local check replaces the `awslambda` global that the Lambda runtime provides with a fake that only records writes, and then calls the handler.

<<< @/examples/09-ssr/scripts/lambda-harness.ts{fake-runtime}

This check confirms only when Nitro's handler tries to write and what it writes. Whether Lambda, the function URL, and CloudFront then pass the pieces along one by one can only be seen by deploying and watching `curl -N`, and I have not seen that yet.

### Why buffered is the default

Streaming also has costs.

CloudFront compresses a response itself only when the origin's response has a `Content-Length`. Nitro's streaming handler adds `Transfer-Encoding: chunked` to the response. The documentation reads as saying that CloudFront does not compress such a response, since its length is unknown (not checked on real infrastructure). HTML that is served uncompressed means more bytes transferred.

The charges change a little as well. A streamed response costs USD 0.008 per GB for whatever exceeds the first 6 MB of each request. And if the reader disconnects partway through a stream, the function does not stop, and you are billed for the time it ran to the end.

Nuxt pages are written in one go, so streaming gains them nothing, and that is why buffered is the default. You need streaming when a response exceeds 6 MB, or when you add a route where arriving bit by bit is the point, such as AI output. In that case, run these two tasks.

```bash
vp run ssr:check:output:stream
vp run ssr:infra:deploy
```

The first task rebuilds in the streaming shape and checks the result. The second deploys that `.output` together with the `InvokeMode` that matches it. To go back to buffered, run `vp run build:ssr`.
