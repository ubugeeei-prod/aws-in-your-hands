---
title: "09 SSR: Costs, Pitfalls, and Cleanup"
---

# 09 SSR: Costs, Pitfalls, and Cleanup

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

### When it gets hammered

Anyone who knows the URL can call this distribution. No sign-in needed. If a bot starts hitting it hard, what stops it?

What protects the public pages is the cache. The cache key is the path and nothing else: no cookies, no headers, no query string. So however often the same page is hit, with or without `?x=<random>`, the function runs only when the cached copy expires (once in 60 seconds). `/feed` waits 300 ms per line, so its three lines take 0.6 seconds, which makes it the heaviest route in the chapter. It's still a public GET that answers 200, so it's cached the same way.

Two kinds of request get no help from the cache.

- **`/me` and `/me/*`.** Caching is off, so every request runs the function
- **Paths that don't exist.** A 404 goes back with `no-store`, so a flood of `/a1`, `/a2`, and so on runs the function every time (how long CloudFront itself holds on to a 404 hasn't been checked)

By default, nothing caps these two. The only stop is the account-wide Lambda concurrency limit (you can see your account's value in Service Quotas; this book hasn't checked it). One execution environment busy for a whole month is, at 512 MB, 1,296,000 GB-seconds: USD 17.28. With a limit of 100, USD 1,728. With 1,000, USD 17,280. That's the worst case for duration alone, with request charges and logs on top.

`-c reservedConcurrency=5` puts a ceiling here.

| Item | Quantity (one month, all five busy the whole time) | List price |
| --- | --- | --- |
| Lambda duration | 5 x 0.5 GB x 2,592,000 s = 6,480,000 GB-seconds | 86.40 |
| Lambda requests | 64,800,000 at 200 ms each | 12.96 |
| CloudWatch Logs ingestion and storage | 18.54 GB at 0.3 KB each | 14.23 |
| Subtotal | | **113.59** |

The 200 ms and 0.3 KB are the same assumptions as in the table above. The ceiling is on Lambda's side only. CloudFront's request charge (USD 1.20 per million) has no cap, and a refused request is still a CloudFront request.

While the ceiling is being hit, pages that aren't in the cache fail for real readers too. It protects the bill, not the site. When the flood stops, things go back to normal.

Turn it on before you tell anyone the URL, and whenever the stack will stay up for more than a few days. If you're trying it and deleting it right away, you can do without. If the deploy fails with a concurrency error, your account's allowance isn't big enough. Take the option off and deploy again.

What you can add beyond that is the same as in chapter 10's "When it gets hammered". An AWS WAF rate-based rule ([chapter 21](/en/chapters/21-security.md): USD 5 a month for the web ACL, USD 1 a month per rule, USD 0.60 per million requests inspected) limits how often one IP address may call, before anything reaches the function. And since the function URL can't be called directly, it can't be bypassed. CloudFront's flat-rate plans (USD 0, 15, 200, and 1,000 a month) exist, but what they include hasn't been checked.

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
| `ssr:infra:deploy -c reservedConcurrency=5` fails with an error about concurrency | The account's concurrency allowance is too small to set any aside. Deploy without `-c reservedConcurrency` and look at the allowance in Service Quotas |
| The synth stops on `-c reservedConcurrency=...` | Is it a whole number, 1 or more? 0 would stop the function, so it's refused |
| At busy times, only pages that aren't cached fail | You're at the reserved concurrency ceiling. Check the logs and metrics for throttles, then raise the number or cache for longer |
| You fixed something and the old page still shows | Wait 60 seconds, or invalidate. Each edge switches at its own time |
| You switched to streaming and nothing arrives bit by bit | Compare `streaming` in `.output/nitro.json` with `InvokeMode` in the template. If they match, the next suspect is CloudFront (the stretch that hasn't been checked yet) |

## Before production

- **Add a real sign-in.** Put sessions in DynamoDB, and have the BFF exchange chapter 06's authorization code for tokens. For the POST entry point, either put API Gateway in between or have the browser attach the hash of the body; pick one
- **Always set `Secure` on the session cookie.** The practice code switches on the protocol so that it runs on `http://localhost`
- **Decide the cache time per page.** Sixty seconds everywhere is a learning value. Pages that hardly change can go longer; something like stock levels, where stale is a problem, shouldn't be cached
- **Attach WAF to CloudFront.** Because the function URL can't be called directly, a WAF on CloudFront can't be bypassed. A rate-based rule cuts down a flood of `/me` and 404s before it reaches the function
- **Choose a concurrency number, and watch it.** Pick the N in `-c reservedConcurrency=N` from real traffic. A function URL returns 429 once the function reaches its concurrency limit. A sudden rise in traffic to pages that miss the cache lands here. Put an alarm on the throttle metric ([chapter 19](/en/chapters/19-observability.md))
- **Cache 404s briefly.** They're `no-store` today, so a path that doesn't exist runs the function every time. Even a few seconds of caching stops repeated hits on the same path. It does nothing against a different path each time, so it's no substitute for WAF
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

**Checked locally.** The unit tests and CDK assertions (`test:unit`). TypeScript type checking (`typecheck`), and Vize type checking and linting of the `.vue` files (`typecheck:ssr`, `lint:ssr`). A type error introduced on purpose made `vize check` fail. `build:ssr` and `build:ssr:stream` (Nuxt 4.6.1, nitropack 2.13.4, `@vizejs/nuxt` 0.443.0). The checks that call the built handler (`ssr:check:output` and `ssr:check:output:stream`): buffered wrote `/feed` in one write, streaming in three (about 300 ms apart), and both wrote the HTML in one. `ssr:infra:synth`. With `dev:ssr` running, checked over HTTP: public pages, the 404, `/me`, sign-in, sign-out, the refusal of a POST from elsewhere, and `/feed` arriving bit by bit. CDK assertions confirm that the cache policy keeps query strings out of the cache key, that the template has no concurrency setting unless `reservedConcurrency` is passed and carries that number when it is, and that 0 or a non-integer stops the synth.

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
- That with a `QueryStringBehavior: none` cache policy, requests with a query string hit the same cache entry, and that the query string never reaches Lambda
- Whether a deploy with `ReservedConcurrentExecutions` goes through on a brand-new account. That cdkd 0.296.28 applies the property. Which status the function URL and CloudFront return at the ceiling, and that the response isn't cached
- The amounts in "When it gets hammered". They're computed from unit prices and assumptions, not read off a bill. The account's concurrency limit hasn't been checked either
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
