---
title: 03 Publish a SPA: A Private S3 Origin and CloudFront
sourceRevision: 1
---

# 03 Publish a SPA: A Private S3 Origin and CloudFront

## What you will have at the end

- A notes app (a SPA) built with Vue, Vite, and Vize that you can run and test on your machine
- That SPA stored in an S3 bucket that cannot be read directly from the internet, and published over HTTPS through CloudFront
- Client-side URLs such as `/notes/abc` that work when opened directly, while files that do not exist return 404
- A way to confirm, by requesting the URLs, that what you published reached readers

This chapter builds on [chapter 02](/en/chapters/02-toolchain.md). The example is in `examples/03-spa/`. It does not use a custom domain. The site is published at the `https://dxxxxxxxxxxxx.cloudfront.net` URL that CloudFront issues.

## Architecture

<!-- section: 03.architecture -->

```text
Browser
  |  HTTPS
  v
CloudFront distribution (edge locations)
  |  viewer-request: CloudFront Function "spa-fallback"
  |    /notes/abc        -> /index.html
  |    /assets/app-1a.js -> unchanged
  |  cache
  |  SigV4-signed request (origin access control)
  v
S3 bucket (ap-northeast-1, Block Public Access on)
  index.html
  assets/index-<hash>.js
  assets/index-<hash>.css
```

Here is what runs where.

- **The app's code runs in the browser.** The only code of yours that runs in AWS is a CloudFront Function of a dozen or so lines.
- **S3 is storage.** It is not used as a web server.
- **CloudFront is a CDN.** Its sites around the world (edge locations) cache responses and serve them from a place close to the reader. HTTPS also terminates here.

One CloudFront configuration is called a distribution, and the place CloudFront fetches the original files from is called an origin. In this chapter the origin is an S3 bucket.

### Why this architecture

S3 has a feature called static website hosting: make the bucket public and it becomes a site. This book does not use it, for two reasons. The URL that feature gives you is HTTP only, so HTTPS needs CloudFront anyway. And a setting that makes a bucket public is a source of accidents. In this chapter the bucket stays private and only CloudFront reads it.

Other choices fit some cases better.

- If what you mainly want is to publish by pushing to Git, or to have preview environments, Cloudflare Pages or Vercel will probably take fewer steps. With this chapter's architecture you run that machinery yourself, and in return you can later connect an API and authentication inside the same account.
- If you need server rendering, that is chapter 09 (planned). This chapter's architecture returns static files only.

## Run it locally

<!-- section: 03.app -->

```bash
vp run dev:spa
```

<http://localhost:5173> opens. Write a note and save it, and it appears in the list. Change the source and the screen updates right away. No AWS credentials are needed and nothing is billed.

At this point in the book, notes are saved in the browser's localStorage. They are not visible from another browser. Saving them on a server comes in chapters 04 and 05.

The shape of a note is defined as a schema, and the type is derived from it.

<<< @/examples/03-spa/src/notes/note.ts{schema}

The storage sits behind an interface, so that it can be replaced with an API later.

<<< @/examples/03-spa/src/notes/store.ts{interface}

localStorage is outside the type system. Another tab, an older version of this app, or a user with the developer tools open may have written anything into it. Every value read from it goes through the schema, and values that do not match are discarded.

<<< @/examples/03-spa/src/notes/store.ts{read}

The router is a function of about 30 lines. It maps the URL path to one of three screens.

<<< @/examples/03-spa/src/router/route.ts{route}

The point to notice is that **the only thing that knows about the path `/notes/abc` is this code inside the browser**. All the server side has is `index.html` and the files under `assets/`. The SPA fallback, which comes later, closes that gap.

### Type checking and tests

```bash
vp run check
vp run lint:vue
vp run typecheck
vp run typecheck:vue
vp run test:unit
```

`check` formats and lints, and `typecheck` type-checks `.ts` files. Vue single-file components (`.vue`) are handled by Vize. Vize is a Vue toolchain written in Rust, and it has three jobs in this SPA: the Vite plugin that compiles `.vue` files at build time, a type check that reaches inside `<template>` (`typecheck:vue`), and a linter for `<template>` (`lint:vue`). `vp run check:all` runs all of them.

`lint:vue` reports one warning, about the `:href` on the link to a note: a dynamic URL could hold a value that starts with `javascript:`. Here the value always starts with `/notes/`, so it is left as it is.

The tests pass the clock and the ID generator in from outside, so that the result does not change from run to run. The storage is also a stand-in built on a `Map`. They check the following.

- A newly saved note comes first in the list
- A note without a title is not saved
- An invalid value that was in storage is not treated as a note
- An unknown path leads to "not found", not to the list screen

## Keep the bucket private

<!-- section: 03.bucket -->

<<< @/examples/03-spa/infra/lib/spa-stack.ts{bucket}

`BLOCK_ALL` turns on all four Block Public Access settings. With it in place, S3 refuses if someone later tries by mistake to attach a bucket policy that makes the bucket public.

`removalPolicy` is `DESTROY`, because the contents can be rebuilt from the repository at any time. For a bucket that holds things that cannot be recreated, such as images uploaded by users, use `RETAIN` (chapter 07, planned).

## Return index.html for client-side URLs

<!-- section: 03.fallback -->

When a reader opens `https://.../notes/abc` directly, or reloads on that screen, the browser asks CloudFront for `/notes/abc`. S3 has no object named `notes/abc`. If you do nothing, the result is an error.

So URLs that do not correspond to a file get `index.html`, and the router inside the browser takes it from there. This is called SPA fallback.

A commonly described way to do this is CloudFront's custom error responses: replace 403 and 404 with `index.html` and 200. This book does not use it, because that setting replaces **every** error. A browser that asks for an old JavaScript file removed by a deploy also gets 200 and HTML. The browser tries to execute that HTML as JavaScript and fails, and the real cause (the file is missing) is hidden.

Instead, the URL is rewritten before the request reaches the origin.

<<< @/examples/03-spa/infra/functions/spa-fallback.js

This function runs on a mechanism called CloudFront Functions. It executes at the edge location, once per request. There is one rule. If the last segment of the path has no `.`, rewrite the path to `/index.html`. If it has a `.`, treat the request as a request for a file and do nothing. A file that does not exist goes through to S3 as it is and becomes a 404.

CloudFront Functions is an execution environment that is deliberately limited in what it can do. According to the official documentation, there is no network access, no file system, no environment variables, and no timers; the request body cannot be read; and execution time is capped. It is not Node.js. It is meant for small rewrites of headers and URLs like this function. It is not a replacement for Cloudflare Workers.

The test loads and runs the very file that gets deployed.

```bash
vp run test:unit
```

`examples/03-spa/infra/test/spa-fallback.test.ts` checks that a client-side URL becomes `index.html`, that a file URL is left unchanged, and that a missing asset does not turn into `index.html`. What runs the test, however, is Node.js. The limits of the CloudFront Functions execution environment (allowed syntax, size, execution time) cannot be checked by this test.

## Define the distribution

<!-- section: 03.distribution -->

<<< @/examples/03-spa/infra/lib/spa-stack.ts{distribution}

`S3BucketOrigin.withOriginAccessControl` is the center of this chapter. Origin access control (OAC) is a mechanism in which CloudFront signs its requests to S3 and the bucket allows only requests from that distribution. From this one line, CDK creates the OAC resource and a bucket policy like this:

- The principal that is allowed is the CloudFront service (`cloudfront.amazonaws.com`)
- But only when the request comes from this distribution (the `AWS:SourceArn` condition)

If someone else's distribution names your bucket as its origin, it does not meet this condition and cannot read the bucket.

`LIST` is added to `originAccessLevels` because of which error comes back. When an object does not exist, S3 returns 404 if the requester has permission to list the bucket (`s3:ListBucket`) and 403 if it does not. This keeps S3 from telling a requester without permission that no file has that name. Allowing `LIST` makes a missing file a proper 404. Because the fallback function rewrites every non-file URL to `/index.html`, there is no URL through which a reader can retrieve the listing itself.

`viewerProtocolPolicy` redirects readers who arrive over HTTP to HTTPS.

`cachePolicy` and `responseHeadersPolicy` are managed policies provided by AWS. The first decides caching behavior and the second decides the security-related response headers. How long each individual file is cached is decided by the `Cache-Control` header attached at publish time (described below).

The tests check the following against the template.

- The bucket is private and website hosting is off
- Only this distribution can read the bucket
- HTTPS only, with the fallback function attached
- Custom error responses are **not** used

The last check keeps someone from switching back to the "usual way" in the future.

## Deploy

<!-- section: 03.deploy -->

This section assumes that `.env` is set up and `vp run infra:bootstrap` was done in chapter 02.

```bash
vp run spa:infra:diff
vp run spa:infra:deploy
```

After the API responds to creating a distribution, propagation to edge locations around the world continues. This book's deploy task passes `--full-wait` to cdkd and waits until propagation finishes. How long that takes has not been measured.

When it finishes, `DistributionDomainName` shows a domain name of the form `dxxxxxxxxxxxx.cloudfront.net`. At this point the bucket is empty. Opening the URL shows nothing.

### Creating infrastructure and publishing content are separate jobs

This is where the experience differs from Cloudflare Pages or Vercel.

| Job | Task | What it changes | How often |
| --- | --- | --- | --- |
| Create or change infrastructure | `spa:infra:deploy` | The bucket, the distribution, the function | Rarely |
| Publish content | `spa:publish` | Objects in the bucket | On every change |

Running `spa:infra:deploy` does not publish a new version of the app. In the other direction, `spa:publish` does not touch the settings of the bucket or the distribution. Keeping them apart lets you update content alone and quickly, and leaves cdkd as the only thing that manages the infrastructure.

## Publish

<!-- section: 03.publish -->

```bash
vp run spa:publish:plan
vp run spa:publish
```

`spa:publish:plan` only shows what would be uploaded and what would be deleted; it changes nothing. `spa:publish` carries it out. Both run `vp run build:spa` first.

Publishing is split into a part that decides what to do and a part that does it. The first is a pure function and can be tested without AWS.

### Cache policy

<<< @/tools/src/site/plan.ts{cache}

Vite puts a hash of the contents into the names of the files under `assets/`. When the contents change the name changes, so the contents at a given URL never change. That is why these files are cached for one year with no revalidation.

The name `index.html` does not change. If it were cached for a long time, readers would keep receiving the old `index.html` after you publish a new version. So the instruction is "you may cache this, but always check with the origin before using it". CloudFront performs this check as a conditional request to S3, and if nothing has changed the body is not transferred.

As a result of this policy, **an ordinary publish needs no cache invalidation**. An invalidation is an operation that makes edge caches discard objects before they expire. `vp run spa:invalidate` is provided for recovery when something was published with the wrong headers, but it is not used day to day.

### Order

Publishing happens in this order.

1. Upload the hashed assets
2. Upload `index.html` and the like
3. Delete pages that are no longer part of the build
4. Delete assets that are not in the current build and were uploaded 30 or more days ago
5. Put `aih-revision.json`, which records which revision was published

The order matters. With 1 and 2 reversed, there would be a moment when the new `index.html` points to JavaScript that does not exist yet.

Old assets are not deleted right away for the same reason. A reader who opened the page shortly before the publish holds the old `index.html`. When that reader later switches screens, the old assets are requested.

If it fails partway, running it again continues from where it stopped, because files whose contents are the same are not uploaded again. If it stopped in the middle of step 1, the bucket only gains files that nothing refers to, and the published site does not change.

This is a small distributed system. The bucket, the edge caches in each location, and the readers' browsers each hold contents from a different point in time. There is no moment at which everyone switches to the new version at once. The invariant being kept is: "the files that the `index.html` in a reader's hands points to can always be fetched".

## Confirm that it arrived

<!-- section: 03.smoke -->

```bash
vp run spa:smoke
```

A command that exits successfully is not proof that anything reached readers. This task fetches the published URLs and checks them.

- `/` returns HTML with a `Cache-Control` that requires revalidation
- `/notes/aih-smoke-deep-link` returns the app's `index.html`
- `/assets/aih-smoke-missing.js` is a 404 (not HTML with 200)
- A hashed asset has a one-year `Cache-Control`
- Opening the site over HTTP redirects to HTTPS
- The revision in `aih-revision.json` matches your local commit

The last check is the confirmation that the publish has reached CloudFront. It retries every 15 seconds until the revisions match and gives up after 10 minutes.

## Check for drift

```bash
vp run spa:infra:drift
```

This is the same gate as in chapter 02. This stack contains an `AWS::CloudFront::Function`. The pinned version of cdkd handles this resource type through the Cloud Control API, not through a dedicated implementation. What the read-back returns has not been checked against real AWS. If `unsupported` or `incomplete` appears, the gate fails (exit code 11). That means "could not be checked", not "there is drift".

## Cost

Think about cost in three states. Amounts are in USD, for S3 in the Tokyo Region and CloudFront at edge locations in Japan, pay-as-you-go, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

**When it is not being used.** A distribution has no charge for existing. The only charge is S3 storage. The build output is under 1 MB, so even at list price it is less than USD 0.01 per month.

**When it is being used.** Cost is proportional to the following.

| Item | Unit price (list) | Monthly free allowance |
| --- | --- | --- |
| Data transferred from CloudFront to readers | USD 0.114 per GB (first 10 TB) | 1 TB |
| HTTPS requests to CloudFront | USD 0.012 per 10,000 | 10 million |
| CloudFront Functions invocations | USD 0.10 per 1 million | 2 million |
| GET requests to S3 (on a cache miss) | USD 0.0037 per 10,000 | Could not be confirmed. Not treated as 0 |

The CloudFront free allowances apply to pay-as-you-go pricing and are shared across the whole account. Transfer from S3 to CloudFront is not charged.

[Pricing Worksheets](/en/reference/pricing.md) has a worked example for the book's own site, which has the same architecture, assuming 20,000 page views a month. It comes to around USD 0.50 per month at list price, and around USD 0.03 after subtracting the CloudFront free allowance. This is an example built on assumptions, not an estimate for your app.

**When you publish.** PUT requests to S3 cost USD 0.0047 per 1,000. Invalidations are free up to 1,000 paths per month and USD 0.005 per path after that.

**What this calculation leaves out.** Access logs, AWS WAF, and a custom domain (Route 53) are not used, so they are 0. Adding them adds charges.

Besides pay-as-you-go, CloudFront also has flat-rate monthly plans (Free, Pro, Business, and Premium as of the date checked). The available features differ by plan, and how to select a plan from CDK has not been checked either, so this book's examples stay on pay-as-you-go.

## When it does not work

| Symptom | What to check |
| --- | --- |
| Opening the URL shows `AccessDenied` XML | Is the bucket empty (did you run `spa:publish`)? Has the distribution finished propagating? |
| You published a new version but the old screen appears | Does the revision in `spa:smoke` match? If it does, the cause is the browser's cache. Does `index.html` have `max-age=0`? |
| Opening `/notes/abc` directly gives an error | Is the fallback function attached to the distribution (does `spa:infra:diff` show no difference)? |
| The screen is blank and the console shows a JavaScript syntax error | Is HTML coming back for an asset request? Look at the "missing asset" check in `spa:smoke` |
| `spa:publish` cannot get the bucket name | Did `spa:infra:deploy` succeed? Are you looking at a different account or Region? |

## If you take this to production

- **Add a custom domain and a certificate.** This uses Route 53 and ACM. The certificate has to be created in `us-east-1`. This book does not cover it yet.
- **Keep access logs.** They record who requested what and when. Storing them costs money (chapter 19, planned).
- **Consider AWS WAF.** It costs money, so it can wait until you have something to protect (chapter 21, planned).
- **Set a Content-Security-Policy.** The managed policy `SECURITY_HEADERS` does not include one. Define your own response headers policy that fits your app.
- **Deploy through the AWS CDK CLI and CloudFormation.** As described in chapter 02.
- **Publish from CI.** Run it with short-lived credentials, not from a person's machine (chapter 20, planned).

## Clean up

<!-- section: 03.cleanup -->

```bash
vp run spa:unpublish --yes
vp run spa:infra:destroy
```

Empty the bucket first, because the pinned version of cdkd fails when it tries to delete a bucket that is not empty. Run without `--yes`, the task only shows how many objects it would delete and deletes nothing.

Deleting a distribution takes time, because it has to stop serving at every edge before it can be deleted.

What remains after deletion:

- The three storage locations created by the cdkd bootstrap (chapter 02), and the deployment files placed in them
- Nothing else. This chapter's stack creates no logs

## How the book's site differs

<!-- section: 03.book-site -->

This book's site is also served from the same "private S3 and CloudFront". It handles URLs differently, though.

| | This chapter's SPA | The book's site |
| --- | --- | --- |
| Number of HTML files | One (`index.html`) | One per page |
| URLs that match no file | Return `index.html` | Return the 404 page as a 404 |
| What the function does | Rewrites client-side URLs to `/index.html` | Rewrites `/ja/chapters/03-spa/` to `/ja/chapters/03-spa/index.html` |

If the book's site used SPA fallback, every broken link would be shown as the top page, and nobody would notice that it was broken. The same parts need different settings depending on what they serve. The implementation of the book's site is in [Reproduce This Site](/en/reference/book-site.md).

## Verification status of this chapter

- Starting the SPA, type checking, unit tests, the build, CDK synth and assertions, and the tests for the publish plan and for the smoke check definitions are **verified locally**.
- `spa:infra:deploy`, `spa:publish`, `spa:smoke`, `spa:infra:drift`, `spa:unpublish`, and `spa:infra:destroy` have not been run against a real AWS account. They are **unverified**.
- The following in particular need to be checked in a real environment: that cdkd can create and read back an `AWS::CloudFront::Function`, and that the code that reads the stack outputs from the output of `cdkd state show` matches the shape of the real output.

## Source map for this chapter

| Section | Files | Tasks |
| --- | --- | --- |
| Run it locally | `examples/03-spa/src/`, `examples/03-spa/index.html`, `examples/03-spa/vite.config.ts` | `dev:spa`, `lint:vue`, `typecheck:vue`, `test:unit`, `build:spa`, `preview:spa` |
| Keep the bucket private, Define the distribution | `examples/03-spa/infra/lib/spa-stack.ts`, `examples/03-spa/infra/bin/app.ts`, `examples/03-spa/infra/test/spa-stack.test.ts`, `examples/03-spa/cdk.json` | `spa:infra:synth`, `test:unit` |
| Return index.html for client-side URLs | `examples/03-spa/infra/functions/spa-fallback.js`, `examples/03-spa/infra/test/spa-fallback.test.ts` | `test:unit` |
| Deploy | `tools/src/infra/` | `spa:infra:diff`, `spa:infra:deploy`, `spa:infra:drift` |
| Publish | `tools/src/site/plan.ts`, `tools/src/site/plan.test.ts`, `tools/src/site/publish.ts`, `tools/src/site/bucket.ts`, `tools/src/site/revision.ts`, `tools/src/site/invalidate.ts`, `tools/src/infra/outputs.ts` | `spa:publish:plan`, `spa:publish`, `spa:invalidate` |
| Confirm that it arrived | `tools/src/site/smoke-spec.ts`, `tools/src/site/smoke-spec.test.ts`, `tools/src/site/smoke.ts` | `spa:smoke` |
| Clean up | `tools/src/site/unpublish.ts` | `spa:unpublish`, `spa:infra:destroy` |
| Cost | `data/pricing/`, `tools/src/pricing/` | `test:unit` |

## Primary sources

- [Restrict access to an Amazon S3 origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) (checked 2026-10-11)
- [Amazon S3 API: GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) (checked 2026-10-11)
- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html) (checked 2026-10-11)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/), [Amazon CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) (checked 2026-10-11)
- AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json), [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json) (checked 2026-10-11)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (checked 2026-10-11)
