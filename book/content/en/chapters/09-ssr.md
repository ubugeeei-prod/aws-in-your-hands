---
title: "09 SSR: A BFF, and Nuxt on Regional Lambda"
sourceRevision: 1
---

# 09 SSR: A BFF, and Nuxt on Regional Lambda

In chapter 03 you put finished HTML and JavaScript in S3 and served them. In chapter 04 you put a function on Lambda that runs for each request. This chapter joins the two. A Nuxt app runs on Lambda and builds the HTML for every request. That's server-side rendering (SSR).

Getting it to run isn't the hard part. The cache is. CloudFront stores one response and hands the same thing to the next person who asks. For a public page, that's what makes it fast. For the page of someone who is signed in, it means a stranger receives it. Half of this chapter is about building things so that this accident doesn't happen.

You need [chapter 03](/en/chapters/03-spa.md) and [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/09-ssr/`. Nothing here is billed by the hour.

## The big picture

<!-- section: 09.architecture -->

```figure
caption: CloudFront splits requests three ways by path: S3 answers /_nuxt/*, and Lambda answers everything else.
node browser: Browser
node cf: CloudFront distribution | edge locations
node nuxt: /_nuxt/*
node me: /me, /me/* | never cached, cookies forwarded
node other: everything else | cached if the response allows, cookies dropped
node s3: S3 bucket | private, OAC
node furl: Lambda function URL | OAC
node nitro: Nitro handler | Nuxt renders pages, server routes answer /api/* and /me/*
node logs: CloudWatch Logs | kept 7 days
edge browser -> cf: HTTPS
edge cf -> nuxt
edge cf -> me
edge cf -> other
edge nuxt -> s3: hashed JS and CSS
edge me -> furl
edge other -> furl
edge furl -> nitro
edge nitro -> logs
group fn: Lambda function (ap-northeast-1, Node.js 24, arm64, 512 MB, timeout 10 s) = furl, nitro
mark nitro
```

There is one way in: a CloudFront distribution. It looks at the path and sends the request to one of three places.

`/_nuxt/*` is the JavaScript and CSS that Nuxt writes at build time. The file names carry a hash of the content, so, as in chapter 03, they sit in S3 and are cached for a long time. Lambda doesn't start for them.

Everything else reaches Lambda, where Nuxt builds the HTML and returns it. Within that, everything from `/me` down is treated differently: it's the place where the content might depend on who is looking. Nothing there is cached, ever.

The app is small. A list of public notes (`/`), a page for each (`/notes/:id`), and your own page (`/me`).

### This is not edge rendering

The HTML is built by a Lambda function in the Tokyo region. Not at a CloudFront edge location.

CloudFront stands in front, so a response that is in the cache comes back from near the reader. One that isn't travels to Tokyo, runs Lambda, and travels back. A reader in London who opens a page that isn't cached waits for the round trip to Tokyo.

You can't say "it's behind a CDN, so it runs at the edge." This book calls it regional SSR. What code can run at the edge, and under which limits, is covered in [chapter 10](/en/chapters/10-edge.md).

### When you don't need SSR

SSR is not always better than a SPA. It adds a Lambda function, a cache to design, and more places to fail.

- An app that shows nothing until you sign in. With no HTML for a search engine to read, the SPA from chapters 03 and 06 is enough
- A site whose content is fixed at build time. Build all the HTML first, put it in S3, and you need no Lambda. This book's own site works that way

SSR pays off for pages that are public, whose content is decided at request time, and where the first paint or the HTML a search engine sees matters.

## Shaping Nuxt for Lambda

<!-- section: 09.nitro -->

The server side of Nuxt is handled by a separate package, Nitro. Nitro has presets that change the shape of the build output to suit where it will run, and one of them is for AWS Lambda.

The versions are pinned. Nuxt is 4.6.1. The Nitro that this Nuxt uses is `nitropack` 2.13.4. npm also has a 3.x beta published under the name `nitro`, but Nuxt 4.6.1 depends on the 2.x line, so that is the one to read. What follows was checked against the source of the pinned `nitropack` (`dist/presets/aws-lambda/`) and against an actual build, not against documentation.

<<< @/examples/09-ssr/nuxt.config.ts{config}

The preset is named `aws-lambda`. It has a single option, `awsLambda.streaming`. `nuxt dev` doesn't use the preset; it takes effect only for `nuxt build`.

The `import type {} from "@nuxt/nitro-server"` at the top is one line for the type checker. Without it, the types of Nuxt 4.6.1 treat the contents of `nitro` as belonging to "some version of Nitro, unknown which," and writing `preset` alone is a type error. With it, the object is checked against the types of the pinned `nitropack`, so a misspelt option name gets caught.

A build produces this.

```text
examples/09-ssr/.output/
  nitro.json            preset, Nitro version, awsLambda.streaming
  server/
    index.mjs           exports `handler`
    chunks/             the bundled application
    node_modules/       only the packages the server imports
    package.json
  public/
    _nuxt/              content-hashed JS and CSS
    _nuxt/builds/       latest.json: which build is current
```

`server/` is the directory that goes to Lambda as it is. Nitro gathers the `node_modules` it needs in there too, so CDK doesn't have to bundle anything the way it did in chapter 04. `public/_nuxt/` is what goes to S3.

The `handler` that `index.mjs` exports comes in two shapes.

- `streaming: false` (the default). `handler(event, context)` returns an object with `statusCode`, `headers`, `cookies`, and `body`. It builds the whole response, then returns it
- `streaming: true`. The handler is wrapped in `awslambda.streamifyResponse`, which the Lambda Node.js runtime provides, and writes the response to a stream

Which shape was built is recorded in `nitro.json`. The CDK stack you'll see later reads that file to decide the setting on the Lambda side.

<<< @/examples/09-ssr/scripts/lambda-harness.ts{nitro-json}

Build output is a value from outside the type system, so it goes through a schema here as well.

### Vize works as it is

Compiling, type checking, and linting `.vue` files is Vize's job, as in chapters 03 and 06. Add `@vizejs/nuxt` 0.443.0 to `modules` and both `nuxt dev` and `nuxt build` compile `.vue` files with Vize. Both ran locally.

Type checking and linting run outside Nuxt, with `vize check` and `vize lint` (`typecheck:ssr` and `lint:ssr`). For that reason the `.vue` files don't lean on Nuxt's auto-imports; they import `useFetch` and the rest explicitly from `nuxt/app`. How far Vize can follow types when auto-imports are used wasn't checked.

One detail. `@vizejs/nuxt` 0.443.0 depends on an old `@nuxt/kit` (3.11.2), and the install prints one peer dependency warning. It had no effect on the build or the dev server.

## Keep the app small

<!-- section: 09.app -->

The shape of a note becomes a schema, the same way as in chapter 04.

<<< @/examples/09-ssr/core/notes.ts{note}

Here is the list page.

<<< @/examples/09-ssr/app/pages/index.vue

While the server is building the HTML, `useFetch("/api/notes")` calls the route directly inside the same process. No HTTP is involved. When the same code runs in the browser (you clicked a link and the view changed), it is a real HTTP request. Either way, the value that comes back goes through the schema before it is used.

All `/api/notes` does is return the notes that ship with the code.

<<< @/examples/09-ssr/server/context.ts{context}

Not reading the notes from DynamoDB is deliberate. This chapter was meant to need only chapters 03 and 04, and, as chapter 04 showed, data written into Lambda's memory can't be the owner of anything. Read-only data that ships with the code gives the same answer from every execution environment. To read from the table of chapter 05 instead, the one line to replace is `notes`.

`core/` holds TypeScript that knows about neither Nuxt nor AWS. The decisions are written there, and that's what the tests exercise. `server/` and `app/` are a thin layer that connects it to Nuxt.

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

This is what does the work. With no cookie, Lambda has no way of knowing who is looking. What it doesn't know, it can't write into the HTML. If someone later adds code that shows "Hello, Alice" on a public page, it works only on their machine; through CloudFront, no name appears. The accident falls on the side of "nothing is shown," not "it leaks."

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

## Run it locally

<!-- section: 09.local -->

Copy `examples/09-ssr/.env.example` to `.env` in the same directory.

<<< @/examples/09-ssr/.env.example

```bash
vp run dev:ssr
```

Nuxt's dev server comes up at <http://localhost:3000>. From another terminal, have a look at the headers.

```bash
curl -s -o /dev/null -D - http://localhost:3000/
curl -s -o /dev/null -D - http://localhost:3000/me
curl -s -o /dev/null -D - -H 'cookie: theme=dark' http://localhost:3000/
```

The first shows `cache-control: public, max-age=0, s-maxage=60`. The second and third show `private, no-store`. The third is a public page, but it carries a cookie, so it isn't shared.

Open `/me` in a browser and you get a form asking for a name. Sign in and `/me` shows the name; look at the cookie in the developer tools and it is `HttpOnly` with `Path` set to `/me`.

`/feed` arrives bit by bit.

```bash
curl -sN http://localhost:3000/feed
```

### Tests

```bash
vp run test:unit
vp run typecheck
vp run typecheck:ssr
vp run lint:ssr
```

`test:unit` covers the decision function, the leak replayed through the shared cache, session expiry, the publish plan, and the CDK stack. `typecheck` checks `core/`, `server/`, `infra/`, and `scripts/` with TypeScript; `typecheck:ssr` and `lint:ssr` check the `.vue` files in `app/` with Vize. This chapter's `tsconfig.json` is the only one that resolves modules as `Bundler`: under `NodeNext`, which the other examples use, `defineNitroPlugin` could not be resolved from the type definitions of `nitropack/runtime`.

There's one more check, particular to this chapter.

```bash
vp run ssr:check:output
```

It runs `nuxt build`, then calls the resulting `.output/server/index.mjs` with an event shaped like a function URL's. No AWS, no network.

<<< @/examples/09-ssr/scripts/check-output.ts{replay}

It signs in as Alice, opens `/me` with her cookie, then opens the same path with no cookie, with that sloppy shared cache in between. Using the headers the real Nuxt app returns, it confirms that Alice's page doesn't reach the next person. This is also the check that found the wrong header on the 404.

Let's be clear about what isn't reproduced locally.

- CloudFront. The cache policies, the routing between behaviors, the OAC signature, and the removal of `Set-Cookie` are only looked at as settings, through assertions on the template. That CloudFront behaves accordingly can't be seen without deploying
- The function URL and the Lambda runtime. `ssr:check:output` imitates the shape of the event, but it isn't Lambda
- More than one execution environment. The local dev server is one process, which is why sign-in happens to work

## Deploy and check

<!-- section: 09.deploy -->

From here on, I haven't yet got this through a real AWS account. The steps and the tasks are in place.

The first time, the order is this.

```bash
vp run build:ssr
vp run ssr:infra:diff
vp run ssr:infra:deploy
vp run ssr:assets:plan
vp run ssr:assets:publish
```

`ssr:infra:deploy` deploys the build that is in `.output` right now. The stack comes first because the bucket for the assets doesn't exist yet. For those few tens of seconds, the JavaScript the HTML points at isn't in S3.

From the second time on, reverse the order.

```bash
vp run build:ssr
vp run ssr:assets:publish
vp run ssr:infra:deploy
```

Put the new assets in place first, then swap the function. By the time the new HTML starts going out, the files it points at are already in S3.

<<< @/examples/09-ssr/scripts/asset-plan.ts{plan}

Hashed files are only added, never overwritten. Files from older builds aren't deleted right away; they stay for 7 days. Why they stay is the next section.

Once they're up, check.

```bash
vp run ssr:smoke
```

<<< @/examples/09-ssr/scripts/smoke-spec.ts{spec}

It looks at five things.

1. Open `/` several times: the response header is `public, max-age=0, s-maxage=60`, and at least one of the later responses comes from CloudFront's cache
2. Open `/me` and `/me/api/viewer` over and over, alternating a made-up session cookie with no cookie: always `private, no-store`, and never once from the cache
3. A `/_nuxt/` file that the HTML points at comes back marked `immutable`
4. Opening the function URL directly returns 403
5. CloudFront turns POST away

Number 2 is the check that looks at this chapter's invariant in a real environment. Whether a response came from the cache is judged from its `x-cache` and `age` headers. I haven't yet seen with my own eyes how CloudFront actually returns those two.

Checking for drift is the same as in chapter 02.

```bash
vp run ssr:infra:drift
```

## Who sees stale content, and for how long

<!-- section: 09.stale -->

A cache is also a mechanism for returning old content. In exchange for speed, whom do you allow to see something stale, and how stale? Decide it up front.

This chapter's answer:

- Public pages (`/`, `/notes/:id`, `/api/notes`): everyone may receive something up to 60 seconds old
- Under `/me`: nothing stale. Lambda answers every time

The number 60 lives in one place (`SHARED_SECONDS`), and both the app's header and CloudFront's `maxTtl` are built from it.

```figure
caption: Each edge location has its own cache, so the moment a new note becomes visible differs from reader to reader.
type: sequence
actor tokyo: reader in Tokyo
actor lambda: Lambda
actor london: reader in London
note lambda: t0 note "A" is published (deploy)
step tokyo -> lambda: t0+5 opens /
step lambda --> tokyo: renders; cached
step london -> lambda: t0+20 opens /
step lambda --> london: renders; cached at another edge
note lambda: t0+30 note "B" is published (deploy)
note tokyo: t0+40 reload: still without B
note london: t0+40 reload: still without B
step tokyo -> lambda: t0+65 reloads
step lambda --> tokyo: renders; has B
step london -> lambda: t0+80 reloads
step lambda --> london: renders; has B
```

Each edge location has its own cache. At the same instant, a reader in Tokyo may see the new list while a reader in London sees the old one. You can't say everyone switches over together. What you can say stops at "no reader sees anything more than 60 seconds old."

If old HTML lives for 60 seconds, the JavaScript that old HTML points at is needed for at least 60 seconds too. Someone who leaves a tab open will come for the old files much later than that. That's why `ssr:assets:publish` keeps the files of older builds for 7 days. When HTML and assets are served from different places, you have to think about their two lifetimes together.

When you can't wait, the invalidation from chapter 03 is available. But it means "ask the origin again from the next request on," not a guarantee that it takes effect at every edge at the same moment.

Errors have a cache too. CloudFront stores a 404 or a 5xx from the origin for 10 seconds by default. The app puts `no-store` on everything that isn't a 200, but what happens to the 10 seconds in that case, I couldn't settle from the documentation. No cookie reaches the public side, so even if it is stored, it's an error page that belongs to nobody.

## If you're coming from Workers

<!-- section: 09.workers -->

If you've shipped Nuxt to Cloudflare Workers, this chapter must have looked like the long way round. Here are the differences.

| | Cloudflare Workers | This chapter (CloudFront and Lambda) |
| --- | --- | --- |
| Build | Nitro's preset for Cloudflare | Nitro's `aws-lambda` preset |
| Deploy | `wrangler deploy` detects Nuxt and configures `.output/server/index.mjs` and `.output/public` | You provide a task that puts assets in S3 and a stack that creates the function and the distribution |
| Where HTML is built | In a Worker on Cloudflare's network | In Lambda in the Tokyo region. Not at the edge |
| Routing static assets | Name a directory under `assets` in the configuration | You write the distribution's behaviors, path by path |
| Reaching other services | Bindings | The AWS SDK and an execution role |

AWS leaves more for you to decide. The cache policy, the behaviors, OAC, and the order of publishing in this chapter are mostly decided by the platform on Workers.

In return, everything you decided is there in code. Which paths receive cookies, how many seconds something is cached, who may call the function directly: read the stack and its tests and you know.

One thing is the same. "Don't put a signed-in page into a shared cache" is the job of the person writing the app, on any platform. How Workers static assets are cached and billed is something I didn't read up on for this chapter.

## What it costs

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month with no visitors costs next to nothing.** The only charge is storage for the assets in S3: USD 0.000125 for 5 MB, which rounds to USD 0.00. A function URL has no extra charge, and neither Lambda nor CloudFront bills anything without requests.

At 100,000 page views a month it looks like this. The assumptions: 4 requests to CloudFront and 100 KB in total per page view; half of the HTML and API requests hit the cache and the other 50,000 reach Lambda; Lambda averages 200 ms at 512 MB on arm64.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| CloudFront HTTPS requests | 400,000 | 0.48 | 0 |
| CloudFront data transfer | 9.537 GB | 1.09 | 0 |
| Lambda requests | 50,000 | 0.01 | 0 |
| Lambda duration | 5,000 GB-seconds | 0.07 | 0 |
| CloudWatch Logs ingestion and storage | 0.014 GB | 0.01 | 0 |
| S3 GET, PUT, and storage | 30,000, 200, 0.005 GB-month | 0.01 | 0.01 (no free allowance was confirmed, so none is deducted) |
| Subtotal | | **1.67** | **0.01** |

What moves this table most is the share of requests that hit the cache. One half is an assumption, not a figure with evidence behind it. At zero, the Lambda rows double; if nearly everything hits, they approach 0. The only way to learn the real value is to deploy and measure.

The 200 ms duration is an assumption as well, not a measurement. Your function's value is in the `REPORT` line of the logs, as in chapter 04.

Data transfer from Lambda to CloudFront isn't in this table (that doesn't mean 0; it's not included). What streaming costs is described under "Streaming is about the whole path," and none of it applies while you stay buffered.

## Where people get stuck

What's listed here is what the settings and the primary sources say "should happen." None of it was confirmed by running into it on real infrastructure.

| If this happens | Look here |
| --- | --- |
| `ssr:infra:synth` stops with `.output is missing` | Run `vp run build:ssr` first. The stack deploys the build output |
| After deploying, every page is a 403 | Does the function URL's resource policy have the two permissions for the distribution? Check for a difference with `ssr:infra:drift` |
| The HTML appears but the page is dead. `/_nuxt/` files are 404 | Did you run `ssr:assets:publish`? Only the function is new |
| `/me` never shows you as signed in | In a deployed environment, that's correct. The practice sign-in is local only |
| The "signed-in name" you added to a public page doesn't appear once deployed | The public behavior delivers no cookies to Lambda. Show per-person content under `/me`, or fetch it from the browser from an API under `/me/` |
| You added a form and submitting it gives 403 | The distribution lets only GET and HEAD through. The constraint on OAC and POST is under "Don't leave the function URL public" |
| You fixed something and the old page still shows | Wait 60 seconds, or invalidate. Each edge switches at its own time |
| You switched to streaming and nothing arrives bit by bit | Compare `streaming` in `.output/nitro.json` with `InvokeMode` in the template. If they match, the next suspect is CloudFront (the stretch that hasn't been checked yet) |

## Before production

- **Add a real sign-in.** Put sessions in DynamoDB, and have the BFF exchange chapter 06's authorization code for tokens. For the POST entry point, either put API Gateway in between or have the browser attach the hash of the body; pick one
- **Always set `Secure` on the session cookie.** The practice code switches on the protocol so that it runs on `http://localhost`
- **Decide the cache time per page.** Sixty seconds everywhere is a learning value. Pages that hardly change can go longer; something like stock levels, where stale is a problem, shouldn't be cached
- **Attach WAF to CloudFront.** Because the function URL can't be called directly, a WAF on CloudFront can't be bypassed
- **Watch concurrency.** A function URL returns 429 once the function reaches its concurrency limit. A sudden rise in traffic to pages that miss the cache lands here
- **Provide an error page.** A custom error response decides what CloudFront returns while Lambda is down
- **Route changes through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Clean up

<!-- section: 09.cleanup -->

```bash
vp run ssr:unpublish --yes
vp run ssr:infra:destroy
```

cdkd can't delete a bucket that has objects in it, so the assets are emptied first. Then the function, the function URL, the role, the log group, the bucket, the distribution, the cache policy, and the response headers policy are deleted.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. The local `.output`, `.nuxt`, and `cdk.out` aren't tracked by git, so delete them freely.

::: details Verification notes for this chapter

**Checked locally.** The unit tests and CDK assertions (`test:unit`). TypeScript type checking (`typecheck`), and Vize type checking and linting of the `.vue` files (`typecheck:ssr`, `lint:ssr`). A type error introduced on purpose made `vize check` fail. `build:ssr` and `build:ssr:stream` (Nuxt 4.6.1, nitropack 2.13.4, `@vizejs/nuxt` 0.443.0). The checks that call the built handler (`ssr:check:output` and `ssr:check:output:stream`): buffered wrote `/feed` in one write, streaming in three (about 300 ms apart), and both wrote the HTML in one. `ssr:infra:synth`. With `dev:ssr` running, checked over HTTP: public pages, the 404, `/me`, sign-in, sign-out, the refusal of a POST from elsewhere, and `/feed` arriving bit by bit.

**Not checked yet.** Nothing was deployed to AWS. `ssr:infra:diff`, `ssr:infra:deploy`, `ssr:assets:plan`, `ssr:assets:publish`, `ssr:smoke`, `ssr:infra:drift`, `ssr:unpublish`, and `ssr:infra:destroy` have not been run. In particular, these are waiting for a check in a real environment.

- That Nitro's handler runs on the Node.js 24 Lambda runtime behind a function URL
- That the function URL accepts OAC-signed requests and turns direct requests away with 403
- That the cache policies work as intended (public pages cached, `/me` not), and that the `x-cache` and `age` headers can tell the two apart
- That a cache policy with `minTtl` and `defaultTtl` of 0 and `maxTtl` of 60 accepts the compression settings
- The removal of `Set-Cookie` by the response headers policy
- The status CloudFront returns for a method it doesn't allow (POST)
- The whole streaming path: the function URL's `RESPONSE_STREAM`, CloudFront passing a stream along piece by piece, and a streamed response not being compressed
- The response when the handler's shape and `InvokeMode` disagree
- How CloudFront's error caching behaves when a 404 carries `no-store`
- That cdkd 0.296.28 can create, update, and delete `AWS::CloudFront::CachePolicy` and `AWS::CloudFront::ResponseHeadersPolicy` through Cloud Control API

**Resource types and cdkd.** Confirmed in the npm tarball (0.296.28) to have a dedicated implementation registered: `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`. Without one, and so handled through Cloud Control API: `AWS::CloudFront::CachePolicy`, `AWS::CloudFront::ResponseHeadersPolicy`.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Shaping Nuxt for Lambda | `examples/09-ssr/nuxt.config.ts`, `scripts/lambda-harness.ts` | `build:ssr`, `ssr:check:output` |
| Keep the app small | `examples/09-ssr/app/`, `server/api/`, `server/context.ts`, `core/notes.ts`, `core/seed.ts` | `dev:ssr`, `typecheck:ssr`, `lint:ssr` |
| From CloudFront to Lambda | `examples/09-ssr/infra/lib/ssr-stack.ts`, `infra/bin/app.ts`, `infra/test/ssr-stack.test.ts`, `cdk.json` | `ssr:infra:synth`, `test:unit` |
| Where the cache boundary is | `examples/09-ssr/core/routes.ts`, `core/cache-control.ts`, `server/plugins/cache-control.ts`, `test/cache-control.test.ts`, `test/support/shared-cache.ts` | `test:unit`, `ssr:check:output` |
| A BFF: the token stays on the server | `examples/09-ssr/core/session.ts`, `core/profile.ts`, `core/env.ts`, `server/routes/me/`, `test/session.test.ts` | `dev:ssr`, `test:unit` |
| Streaming is about the whole path | `examples/09-ssr/server/routes/feed.get.ts`, `scripts/lambda-harness.ts` | `build:ssr:stream`, `ssr:check:output:stream` |
| Run it locally | `examples/09-ssr/scripts/check-output.ts`, `test/`, `.env.example` | `dev:ssr`, `test:unit`, `typecheck`, `ssr:check:output` |
| Deploy and check | `examples/09-ssr/scripts/publish-assets.ts`, `scripts/asset-plan.ts`, `scripts/smoke.ts`, `scripts/smoke-spec.ts` | `ssr:infra:deploy`, `ssr:assets:publish`, `ssr:smoke`, `ssr:infra:drift` |
| Who sees stale content, and for how long | `examples/09-ssr/core/cache-control.ts`, `scripts/asset-plan.ts` | `test:unit` |
| Clean up | `tools/src/site/unpublish.ts`, `tools/src/infra/` | `ssr:unpublish`, `ssr:infra:destroy` |
| What it costs | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html), [Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html), [Invoking a response streaming enabled function using Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html)
- [Select a method to invoke your Lambda function using an HTTP request](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html)
- [Manage how long content stays in the cache (expiration)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html), [Understand cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html)
- [Cache content based on cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Cookies.html), [Understand response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html)
- [Serve compressed files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html), [How CloudFront processes HTTP 4xx and 5xx status codes from your origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html), [Origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/), AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- [nuxt 4.6.1](https://www.npmjs.com/package/nuxt/v/4.6.1), [nitropack 2.13.4](https://www.npmjs.com/package/nitropack/v/2.13.4), [@vizejs/nuxt 0.443.0](https://www.npmjs.com/package/@vizejs/nuxt/v/0.443.0), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Cloudflare Workers: Nuxt](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/)

:::
