---
title: "03 Static Hosting: Design and Build"
---

# 03 Static Hosting: Design and Build

This page first runs the SPA on your machine, then goes through the AWS side in order: the bucket, the function that rewrites URLs, and the distribution.

## Running it locally

<!-- section: 03.app -->

```bash
vp run dev:spa
```

<http://localhost:5173> opens. A note you write and save appears in the list, and the screen updates as soon as you change the source. You need no AWS credentials, and nothing is billed.

At this point notes are saved in the browser's localStorage, so another browser can't see them. Chapters 04 and 05 move them to a server.

The shape of a note is defined by a schema, and the type is derived from the schema.

<<< @/examples/03-spa/src/notes/note.ts{schema}

The place notes are saved is hidden behind an interface so that it can be swapped for an API later.

<<< @/examples/03-spa/src/notes/store.ts{interface}

The types do not protect what is in localStorage. Another tab, an older version of this app, or a user with the developer tools open may have written anything there. So every value read from it is checked against the schema, and values that don't match are discarded.

<<< @/examples/03-spa/src/notes/store.ts{read}

The router is a function of about 20 lines that maps the URL path to one of three screens.

<<< @/examples/03-spa/src/router/route.ts{route}

The point to remember is that **only this code in the browser** knows about the path `/notes/abc`. All the server side has is `index.html` and the files under `assets/`. SPA fallback, explained later on this page, bridges that gap.

### Type checking and tests

```bash
vp run check
vp run lint:vue
vp run typecheck
vp run typecheck:vue
vp run test:unit
```

`check` is format and lint, and `typecheck` type-checks the `.ts` files. Vue single-file components (`.vue`) are handled by Vize, a Vue toolchain written in Rust. It has three roles in this SPA: a Vite plugin that compiles `.vue` at build time, a type check that looks inside `<template>` (`typecheck:vue`), and a lint for `<template>` (`lint:vue`). `vp run check:all` runs all of them together.

`lint:vue` reports one warning about the `:href` of the link to a note. It points out that a dynamic URL could hold a value starting with `javascript:`. In this app the value always starts with `/notes/`, so the code is left as it is.

The tests pass in the clock and the ID generator from outside, so that results do not change from run to run. Storage is also a stand-in built on a `Map`. The tests check the following.

- A newly saved note comes first in the list
- A note without a title is not saved
- An invalid value found in storage is not treated as a note
- An unknown path leads to the "not found" screen, not the list screen

## The bucket stays private

<!-- section: 03.bucket -->

From here on, the page covers the definitions on the AWS side, starting with the bucket.

<<< @/examples/03-spa/infra/lib/spa-stack.ts{bucket}

`BLOCK_ALL` turns on all four Block Public Access settings. With them on, S3 refuses if someone later tries to attach a public bucket policy by mistake.

`removalPolicy` is `DESTROY` because the contents can be rebuilt from the repository at any time. A bucket that holds things that cannot be recreated, such as images uploaded by users, should use `RETAIN`. [Chapter 07](/en/chapters/07-uploads/wrap.md) comes back to `RETAIN` as a change for production.

## When /notes/abc is opened directly

<!-- section: 03.fallback -->

When a reader opens `https://.../notes/abc` directly, or reloads on that screen, the browser asks CloudFront for `/notes/abc`. S3 has no object named `notes/abc`, so without some handling the request ends in an error.

The answer is to return `index.html` for any URL that does not correspond to a file and leave the rest to the router in the browser. This is called SPA fallback.

The method you often see described uses CloudFront's custom error responses to replace 403 and 404 with `index.html` and a 200. This book does not use it, because that setting replaces **every** error. A browser that asks for an old JavaScript file removed by a deploy also gets a 200 and HTML. The browser tries to run that HTML as JavaScript and fails, and the real cause, a missing file, is hidden.

This book rewrites the URL before the request reaches the origin.

<<< @/examples/03-spa/infra/functions/spa-fallback.js

The function runs on CloudFront Functions, at an edge location, once per request. It has one rule. If the last segment of the path has no `.`, it rewrites the path to `/index.html`. If there is a `.`, it treats the request as one for a file and does nothing. A request for a file that does not exist goes through to S3 and comes back as 404.

CloudFront Functions is an execution environment that is limited on purpose. According to the official documentation, it has no network, file system, environment variables, or timers, it can't read the request body, and execution time is capped. It is not Node.js either. It exists for small rewrites of headers and URLs like this one, and it is not a substitute for Cloudflare Workers.

The test loads and runs the very file that gets deployed.

```bash
vp run test:unit
```

`examples/03-spa/infra/test/spa-fallback.test.ts` checks that a client-side URL becomes `index.html`, that a file URL is unchanged, and that a request for a missing asset is not rewritten to `index.html`. The test runs on Node.js, though. It cannot check the limits of the CloudFront Functions environment, such as the supported syntax, the size, and the execution time.

## Define the distribution

<!-- section: 03.distribution -->

<<< @/examples/03-spa/infra/lib/spa-stack.ts{distribution}

The center of this definition is `origins.S3BucketOrigin.withOriginAccessControl`. With origin access control (OAC), CloudFront signs its requests to S3, and the bucket allows only requests from that distribution. From this one line, CDK creates the OAC resource and a bucket policy that says the following.

- The principal allowed is the CloudFront service (`cloudfront.amazonaws.com`)
- But only when the request comes from this distribution (the `AWS:SourceArn` condition)

If someone else's distribution names your bucket as its origin, it does not meet this condition and can't read the bucket.

`LIST` is added to `originAccessLevels` so that a missing file returns 404. When an object does not exist, S3 returns 404 if the requester has permission to list the bucket (`s3:ListBucket`) and 403 if it does not. That keeps S3 from telling a requester without permission that no file has that name. Allowing `LIST` makes missing files return 404. Granting the list permission does not expose the listing, because the fallback function rewrites every URL that is not a file to `/index.html`, so no URL lets a reader fetch the listing itself.

`viewerProtocolPolicy` redirects readers who arrive over HTTP to HTTPS.

`cachePolicy` and `responseHeadersPolicy` are set to managed policies that AWS provides. `cachePolicy` decides how the cache behaves, and `responseHeadersPolicy` decides the security-related response headers. How long each file is cached is decided by the `Cache-Control` header attached at publish time, which is explained under "Cache policy" on the [Deploy page](/en/chapters/03-spa/deploy.md).

The tests check the following against the template.

- The bucket is private, and website hosting is disabled
- Only this distribution can read the bucket
- It is HTTPS only, and the fallback function is attached
- Error response replacement is not used

The last check keeps someone from going back to the commonly described method later.
