---
title: "03 Static Hosting: Design and Build"
---

# 03 Static Hosting: Design and Build

## Run it locally

<!-- section: 03.app -->

Let's get it running first.

```bash
vp run dev:spa
```

<http://localhost:5173> opens. Write a note and save it, and it appears in the list. Change the source and the screen updates right away. No AWS credentials are needed and nothing is billed.

For now, notes are saved in the browser's localStorage. They are not visible from another browser. Saving them on a server comes in chapters 04 and 05.

The shape of a note is defined as a schema, and the type is derived from it.

<<< @/examples/03-spa/src/notes/note.ts{schema}

The storage sits behind an interface, so that it can be replaced with an API later.

<<< @/examples/03-spa/src/notes/store.ts{interface}

localStorage is outside the type system. Another tab, an older version of this app, or a user with the developer tools open may have written anything into it. So every value read from it goes through the schema, and values that do not match are discarded.

<<< @/examples/03-spa/src/notes/store.ts{read}

The router is a function of about 20 lines. It maps the URL path to one of three screens.

<<< @/examples/03-spa/src/router/route.ts{route}

One thing to keep in mind here: the only thing that knows about the path `/notes/abc` is **this code inside the browser**. All the server side has is `index.html` and the files under `assets/`. The SPA fallback, which comes later, closes that gap.

### Type checking and tests

```bash
vp run check
vp run lint:vue
vp run typecheck
vp run typecheck:vue
vp run test:unit
```

`check` formats and lints, and `typecheck` type-checks `.ts` files. Vue single-file components (`.vue`) are handled by Vize. Vize is a Vue toolchain written in Rust, and it has three jobs in this SPA: the Vite plugin that compiles `.vue` files at build time, a type check that reaches inside `<template>` (`typecheck:vue`), and a linter for `<template>` (`lint:vue`). `vp run check:all` runs all of them together.

`lint:vue` reports one warning, about the `:href` on the link to a note: a dynamic URL could hold a value that starts with `javascript:`. Here the value always starts with `/notes/`, so it is left as it is.

The tests pass the clock and the ID generator in from outside, so that the result does not change from run to run. The storage is also a stand-in built on a `Map`. Here is what they check.

- A newly saved note comes first in the list
- A note without a title is not saved
- An invalid value that was in storage is not treated as a note
- An unknown path leads to "not found", not to the list screen

## The bucket stays private

<!-- section: 03.bucket -->

Now for the AWS side. The bucket comes first.

<<< @/examples/03-spa/infra/lib/spa-stack.ts{bucket}

`BLOCK_ALL` turns on all four Block Public Access settings. With it in place, S3 refuses if someone later tries by mistake to attach a bucket policy that makes the bucket public.

`removalPolicy` is `DESTROY`, because the contents can be rebuilt from the repository at any time. For a bucket that holds things that cannot be recreated, such as images uploaded by users, use `RETAIN` (it comes up again under "Before production" in [chapter 07](/en/chapters/07-uploads.md)).

## What if someone opens /notes/abc directly?

<!-- section: 03.fallback -->

A reader opens `https://.../notes/abc` directly, or reloads on that screen. The browser then asks CloudFront for `/notes/abc`. But S3 has no object named `notes/abc`. If you do nothing, the result is an error.

So URLs that do not correspond to a file get `index.html`, and the router inside the browser takes it from there. This is SPA fallback.

A commonly described way to do this is CloudFront's custom error responses: replace 403 and 404 with `index.html` and 200. This book does not use it, because that setting replaces **every** error. A browser that asks for an old JavaScript file removed by a deploy also gets 200 and HTML. The browser tries to execute that HTML as JavaScript and fails, and the real cause (the file is missing) is hidden.

Instead, the URL is rewritten before the request reaches the origin.

<<< @/examples/03-spa/infra/functions/spa-fallback.js

This function runs on a mechanism called CloudFront Functions. It executes at the edge location, once per request. There is one rule. If the last segment of the path has no `.`, rewrite the path to `/index.html`. If it has a `.`, treat the request as a request for a file and do nothing. A file that does not exist goes through to S3 as it is and becomes a 404.

CloudFront Functions is an execution environment that is limited on purpose. According to the official documentation, there is no network access, no file system, no environment variables, and no timers; the request body cannot be read; and execution time is capped. It is not Node.js. It is meant for small rewrites of headers and URLs like this function. It is not a replacement for Cloudflare Workers, so keep the two apart in your head.

The test loads and runs the very file that gets deployed.

```bash
vp run test:unit
```

`examples/03-spa/infra/test/spa-fallback.test.ts` checks that a client-side URL becomes `index.html`, that a file URL is left unchanged, and that a missing asset does not turn into `index.html`. What runs the test, though, is Node.js. The limits of the CloudFront Functions execution environment (allowed syntax, size, execution time) are beyond what this test can check.

## Define the distribution

<!-- section: 03.distribution -->

<<< @/examples/03-spa/infra/lib/spa-stack.ts{distribution}

The star of this chapter is `origins.S3BucketOrigin.withOriginAccessControl`. Origin access control (OAC) is a mechanism in which CloudFront signs its requests to S3 and the bucket allows only requests from that distribution. From this one line, CDK creates the OAC resource and a bucket policy like this:

- The principal that is allowed is the CloudFront service (`cloudfront.amazonaws.com`)
- But only when the request comes from this distribution (the `AWS:SourceArn` condition)

If someone else's distribution names your bucket as its origin, it does not meet this condition and cannot read the bucket.

`LIST` is added to `originAccessLevels` because of which error comes back. When an object does not exist, S3 returns 404 if the requester has permission to list the bucket (`s3:ListBucket`) and 403 if it does not. This keeps S3 from telling a requester without permission that no file has that name. Allowing `LIST` makes a missing file a proper 404. You might wonder whether readers can now list the bucket. They cannot: the fallback function rewrites every non-file URL to `/index.html`, so there is no URL through which a reader can retrieve the listing itself.

`viewerProtocolPolicy` redirects readers who arrive over HTTP to HTTPS.

`cachePolicy` and `responseHeadersPolicy` are managed policies provided by AWS. The first decides caching behavior and the second decides the security-related response headers. How long each individual file is cached is decided by the `Cache-Control` header attached at publish time (coming up shortly).

The tests check the following against the template.

- The bucket is private and website hosting is off
- Only this distribution can read the bucket
- HTTPS only, with the fallback function attached
- Custom error responses are not used

The last check is there to keep someone from switching back to the "usual way" in the future.
