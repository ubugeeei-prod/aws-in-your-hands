---
title: "09 SSR: Costs, Pitfalls, and Cleanup"
---

# 09 SSR: Costs, Pitfalls, and Cleanup

The chapter has now reached the end of the [deploy](/en/chapters/09-ssr/deploy.md) steps. This last page covers how the setup differs from Cloudflare Workers, what it costs, where it tends to go wrong, what to add for production, and how to clean up.

## If you're coming from Workers

<!-- section: 09.workers -->

If you have deployed Nuxt to Cloudflare Workers, the steps in this chapter probably looked like the long way round. The table lists the differences.

| | Cloudflare Workers | This chapter (CloudFront and Lambda) |
| --- | --- | --- |
| Build | Nitro's preset for Cloudflare | Nitro's `aws-lambda` preset |
| Deploy | `wrangler deploy` detects Nuxt and configures `.output/server/index.mjs` and `.output/public` | You provide a task that puts assets in S3 and a stack that creates the function and the distribution |
| Where HTML is built | In a Worker on Cloudflare's network | In Lambda in the Tokyo Region. Not at the edge |
| Routing static assets | Name a directory under `assets` in the configuration | You write the distribution's behaviors, path by path |
| Reaching other services | Bindings | The AWS SDK and an execution role |

AWS leaves more for you to decide. On Workers, the platform decides most of what this chapter wrote by hand: the cache policy, the behaviors, OAC, and the order in which assets are published.

In return, everything you decided is recorded in code. You can read the stack and its tests to find out which paths receive cookies, how many seconds a response is cached, and who may call the function directly.

One thing is the same on both. Keeping a signed-in page out of a shared cache is the job of the person who writes the app, on any platform. I did not read up on how Workers static assets are cached and billed for this chapter.

## What it costs

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month with no visitors costs almost nothing.** The only charge is storage for the assets in S3, which is USD 0.000125 for 5 MB and rounds to USD 0.00. A function URL has no extra charge, and neither Lambda nor CloudFront bills anything without requests.

The table shows 100,000 page views a month. It assumes 4 requests to CloudFront and 100 KB in total per page view, that half of the HTML and API requests hit the cache and the other 50,000 reach Lambda, and that Lambda averages 200 ms at 512 MB on arm64.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| CloudFront HTTPS requests | 400,000 | 0.48 | 0 |
| CloudFront data transfer | 9.537 GB | 1.09 | 0 |
| Lambda requests | 50,000 | 0.01 | 0 |
| Lambda duration | 5,000 GB-seconds | 0.07 | 0 |
| CloudWatch Logs ingestion and storage | 0.014 GB | 0.01 | 0 |
| S3 GET, PUT, and storage | 30,000, 200, 0.005 GB-month | 0.01 | 0.01 (no free allowance was confirmed, so none is deducted) |
| Subtotal | | **1.67** | **0.01** |

The share of requests that hit the cache moves the amounts in this table more than anything else. One half is an assumption with no evidence behind it. At a share of 0 the Lambda rows double, and if nearly everything hits the cache they approach 0. The only way to learn the real value is to deploy and measure.

The 200 ms duration is also an assumption, not a measurement. You can read your function's value from the `REPORT` line in the logs, as in chapter 04.

Data transfer from Lambda to CloudFront is not in this table (that means it is not included, not that it is 0). The charges for streaming are described under "Why buffered is the default" in [Design and Build](/en/chapters/09-ssr/build.md), and none of them apply while you stay with buffered.

### When it gets hammered

Anyone who knows the URL can call this distribution, and no sign-in is needed. This section goes through what protects the function when a bot sends a flood of requests, and what does not.

The cache protects the public pages. The cache key is the path alone, with no cookies, no headers, and no query string in it. However many requests arrive for the same page, with or without `?x=<random>` appended, the function runs only when the cached copy expires (once in 60 seconds). `/feed` waits 300 ms between lines, so its 3 lines take 0.6 seconds and make it the heaviest route in this chapter, but it is a public GET that returns 200 and is cached the same way.

The cache does not protect two kinds of request.

- `/me` and `/me/*`. Caching is disabled, so every request runs the function
- Paths that do not exist. A 404 is returned with `no-store`, so requests for `/a1`, `/a2`, and so on, with a different path each time, run the function every time (how long CloudFront itself keeps a 404 has not been checked)

By default nothing limits these two kinds. The only thing that stops them is the account-wide Lambda concurrency limit (you can see your account's value in Service Quotas; this book has not checked it). One concurrent execution that runs for a whole month is, at 512 MB, 1,296,000 GB-seconds, or USD 17.28. With a limit of 100 that is USD 1,728, and with 1,000 it is USD 17,280. These amounts are the worst case for duration alone, and request charges and logs come on top.

With `-c reservedConcurrency=5`, at most 5 invocations run at once, which also puts a limit on the charge.

| Item | Quantity (one month, all five busy the whole time) | List price |
| --- | --- | --- |
| Lambda duration | 5 x 0.5 GB x 2,592,000 s = 6,480,000 GB-seconds | 86.40 |
| Lambda requests | 64,800,000 at 200 ms each | 12.96 |
| CloudWatch Logs ingestion and storage | 18.54 GB at 0.3 KB each | 14.23 |
| Subtotal | | **113.59** |

The 200 ms and 0.3 KB are the same assumptions as in the table for 100,000 page views. The limit applies to Lambda only. CloudFront's request charge (USD 1.20 per million) has no limit, and a refused request is still charged by CloudFront.

While the function is at the limit, pages that are not in the cache fail for real readers too. Reserved concurrency protects the bill, not the availability of the site. When the flood stops, the site recovers.

Set reserved concurrency before you tell anyone the URL, and whenever the stack will stay up for more than a few days. If you try the stack and delete it right away, you can leave it off. If the deploy fails with a concurrency error, your account's total is too small, so remove the option and deploy again.

Further measures are the same as in chapter 10's "When it gets hammered". An AWS WAF rate-based rule ([chapter 21](/en/chapters/21-security.md): USD 5 a month for the web ACL, USD 1 a month per rule, USD 0.60 per million requests inspected) limits the number of requests from one IP address before they reach the function. Because the function URL cannot be called directly, the WAF cannot be bypassed either. For CloudFront's flat-rate plans (USD 0, 15, 200, and 1,000 a month), what they include has not been checked.

## Where people get stuck

This table lists what the settings and the primary sources say should happen. None of it was confirmed by causing it on real infrastructure.

| If this happens | Look here |
| --- | --- |
| `ssr:infra:synth` stops with `.output is missing` | Run `vp run build:ssr` first. The stack deploys the build output |
| After deploying, every page returns 403 | Check that the function URL's resource policy has the two permissions for the distribution. `ssr:infra:drift` shows any difference |
| The HTML appears but the page does not respond, and `/_nuxt/` files return 404 | Check that you ran `ssr:assets:publish`. Only the function is new |
| `/me` never shows you as signed in | In a deployed environment that is the correct behavior. The practice sign-in works only locally |
| The "signed-in name" you added to a public page does not appear once deployed | The public behavior delivers no cookies to Lambda. Put per-person content under `/me`, or have the browser fetch it from an API under `/me/` |
| You added a form and submitting it returns 403 | The distribution allows only GET and HEAD. The constraint on OAC and POST is under "Don't leave the function URL public" in [Design and Build](/en/chapters/09-ssr/build.md) |
| `ssr:infra:deploy -c reservedConcurrency=5` fails with an error about concurrency | The account's total concurrency is too small to set any aside. Deploy without `-c reservedConcurrency` and check the total in Service Quotas |
| The synth stops on `-c reservedConcurrency=...` | Check that the value is a whole number, 1 or more. 0 would stop the function, so it is refused |
| At busy times, only pages that are not cached fail | The function is at the reserved concurrency limit. Check the logs and metrics for throttling, then raise the number or cache for longer |
| You fixed something and the old page still shows | Wait 60 seconds, or run an invalidation. Each edge switches at its own time |
| You switched to streaming and nothing arrives bit by bit | Compare `streaming` in `.output/nitro.json` with `InvokeMode` in the template. If they match, the next suspect is CloudFront (the stretch that has not been checked yet) |

## Before production

- Add a real sign-in. Keep sessions in DynamoDB, and have the BFF exchange chapter 06's authorization code for tokens. For the POST entry point, either put API Gateway in between or have the browser attach the hash of the body
- Always set `Secure` on the session cookie. The practice code decides by the protocol so that it runs on `http://localhost`
- Decide the cache time for each page. Sixty seconds on every page is a value for learning. Pages that hardly change can be cached longer, and content that is harmful when stale, such as stock levels, should not be cached
- Attach WAF to CloudFront. Because the function URL cannot be called directly, a WAF on CloudFront cannot be bypassed. A rate-based rule limits a flood of requests to `/me` and to 404s before it reaches the function
- Choose a concurrency number and monitor it. Pick the N in `-c reservedConcurrency=N` from real traffic. A function URL returns 429 once the function reaches its concurrency limit, and a sudden rise in traffic to pages that miss the cache reaches that limit. Put an alarm on the throttling metric ([chapter 19](/en/chapters/19-observability.md))
- Cache 404s briefly. They are `no-store` today, so every request for a path that does not exist runs the function. Caching them for even a few seconds keeps repeated requests for the same path from running the function during that time. It does nothing when the path changes each time, so it does not replace WAF
- Provide an error page. A custom error response sets what CloudFront returns while Lambda is down
- Apply changes through the AWS CDK CLI and CloudFormation, for the reasons given in chapter 02

## Clean up

<!-- section: 09.cleanup -->

```bash
vp run ssr:unpublish --yes
vp run ssr:infra:destroy
```

cdkd cannot delete a bucket that has objects in it, so the first task deletes the assets and leaves the bucket empty. After that the function, the function URL, the role, the log group, the bucket, the distribution, the cache policy, and the response headers policy are deleted.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. The local `.output`, `.nuxt`, and `cdk.out` are not tracked by git, so you can delete them.

::: details Verification notes for this chapter

**Checked locally.** The unit tests and CDK assertions (`test:unit`). TypeScript type checking (`typecheck`), and Vize type checking and linting of the `.vue` files (`typecheck:ssr`, `lint:ssr`). I also confirmed that a type error introduced on purpose makes `vize check` fail. `build:ssr` and `build:ssr:stream` (Nuxt 4.6.1, nitropack 2.13.4, `@vizejs/nuxt` 0.443.0). The checks that call the built handler (`ssr:check:output` and `ssr:check:output:stream`). The buffered build wrote `/feed` in one write and the streaming build in three (about 300 ms apart), and both wrote the HTML in one. `ssr:infra:synth`. With `dev:ssr` running, I checked over HTTP the public pages, the 404, `/me`, sign-in, sign-out, the refusal of a POST from another site, and `/feed` arriving bit by bit. CDK assertions confirm that the cache policy keeps query strings out of the cache key, that the template has no concurrency setting unless `reservedConcurrency` is passed and carries that number when it is, and that 0 or a non-integer stops the synth.

**Not checked yet.** Nothing was deployed to AWS. `ssr:infra:diff`, `ssr:infra:deploy`, `ssr:assets:plan`, `ssr:assets:publish`, `ssr:smoke`, `ssr:infra:drift`, `ssr:unpublish`, and `ssr:infra:destroy` have not been run. These points in particular still need a check in a real environment.

- That Nitro's handler runs on the Node.js 24 Lambda runtime behind a function URL
- That the function URL accepts OAC-signed requests and refuses direct requests with 403
- That the cache policies work as intended (public pages cached, `/me` not), and that the `x-cache` and `age` headers can tell the two apart
- That a cache policy with `minTtl` and `defaultTtl` of 0 and `maxTtl` of 60 accepts the compression settings
- The removal of `Set-Cookie` by the response headers policy
- The status CloudFront returns for a method it does not allow (POST)
- The whole streaming path: the function URL's `RESPONSE_STREAM`, CloudFront passing a stream along piece by piece, and a streamed response not being compressed
- The response when the handler's shape and `InvokeMode` disagree
- How CloudFront's error caching behaves when a 404 carries `no-store`
- That with a `QueryStringBehavior: none` cache policy, requests with a query string hit the same cache entry, and that the query string never reaches Lambda
- Whether a deploy with `ReservedConcurrentExecutions` goes through on a new account. That cdkd 0.296.28 applies the property. Which status the function URL and CloudFront return at the limit, and that the response is not cached
- The amounts in "When it gets hammered". They are computed from unit prices and assumptions, not confirmed on a bill. The account's concurrency limit has not been checked either
- That cdkd 0.296.28 can create, update, and delete `AWS::CloudFront::CachePolicy` and `AWS::CloudFront::ResponseHeadersPolicy` through Cloud Control API

**Resource types and cdkd.** The npm tarball (0.296.28) was confirmed to register a dedicated implementation for `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, and `AWS::S3::BucketPolicy`. `AWS::CloudFront::CachePolicy` and `AWS::CloudFront::ResponseHeadersPolicy` have no dedicated implementation and go through Cloud Control API.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Shaping Nuxt for Lambda | `examples/09-ssr/nuxt.config.ts`, `scripts/lambda-harness.ts` | `build:ssr`, `ssr:check:output` |
| A small app | `examples/09-ssr/app/`, `server/api/`, `server/context.ts`, `core/notes.ts`, `core/seed.ts` | `dev:ssr`, `typecheck:ssr`, `lint:ssr` |
| From CloudFront to Lambda | `examples/09-ssr/infra/lib/ssr-stack.ts`, `infra/bin/app.ts`, `infra/test/ssr-stack.test.ts`, `cdk.json` | `ssr:infra:synth`, `test:unit` |
| The cache boundary | `examples/09-ssr/core/routes.ts`, `core/cache-control.ts`, `server/plugins/cache-control.ts`, `test/cache-control.test.ts`, `test/support/shared-cache.ts` | `test:unit`, `ssr:check:output` |
| A BFF: the token stays on the server | `examples/09-ssr/core/session.ts`, `core/profile.ts`, `core/env.ts`, `server/routes/me/`, `test/session.test.ts` | `dev:ssr`, `test:unit` |
| Streaming depends on the whole path | `examples/09-ssr/server/routes/feed.get.ts`, `scripts/lambda-harness.ts` | `build:ssr:stream`, `ssr:check:output:stream` |
| Run it locally | `examples/09-ssr/scripts/check-output.ts`, `test/`, `.env.example` | `dev:ssr`, `test:unit`, `typecheck`, `ssr:check:output` |
| Deploy and check | `examples/09-ssr/scripts/publish-assets.ts`, `scripts/asset-plan.ts`, `scripts/smoke.ts`, `scripts/smoke-spec.ts` | `ssr:infra:deploy`, `ssr:assets:publish`, `ssr:smoke`, `ssr:infra:drift` |
| How stale a page may be | `examples/09-ssr/core/cache-control.ts`, `scripts/asset-plan.ts` | `test:unit` |
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
