---
title: "03 Static Hosting: Costs, Pitfalls, and Cleanup"
---

# 03 Static Hosting: Costs, Pitfalls, and Cleanup

## What it costs

Think about cost in three states. Amounts are in USD, for S3 in the Tokyo Region and CloudFront at edge locations in Japan, pay-as-you-go, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

First, when it is not being used. A distribution has no charge for existing. The only charge is S3 storage. The build output is under 1 MB, so even at list price it is less than USD 0.01 per month.

When it is being used, cost is proportional to the following.

| Item | Unit price (list) | Monthly free allowance |
| --- | --- | --- |
| Data transferred from CloudFront to readers | USD 0.114 per GB (first 10 TB) | 1 TB |
| HTTPS requests to CloudFront | USD 0.012 per 10,000 | 10 million |
| CloudFront Functions invocations | USD 0.10 per 1 million | 2 million |
| GET requests to S3 (on a cache miss) | USD 0.0037 per 10,000 | Could not be confirmed. Not treated as 0 |

The CloudFront free allowances apply to pay-as-you-go pricing and are shared across the whole account. Transfer from S3 to CloudFront is not charged.

[Pricing Worksheets](/en/reference/pricing.md) has a worked example for the book's own site, which has the same architecture, assuming 20,000 page views a month. It comes to around USD 0.50 per month at list price, and around USD 0.03 after subtracting the CloudFront free allowance. This is an example built on assumptions, not an estimate for your app.

Publishing costs a little too. PUT requests to S3 cost USD 0.0047 per 1,000. Invalidations are free up to 1,000 paths per month and USD 0.005 per path after that.

Some things are left out of this calculation. Access logs, AWS WAF, and a custom domain (Route 53) are not used, so they are 0. Adding them adds charges.

By the way, besides pay-as-you-go, CloudFront also has flat-rate monthly plans (Free, Pro, Business, and Premium as of the date checked). The available features differ by plan, and how to select a plan from CDK has not been checked either, so this book's examples stay on pay-as-you-go.

## Where you might get stuck

| If this happens | Look here |
| --- | --- |
| Opening the URL shows `AccessDenied` XML | Is the bucket empty (did you run `spa:publish`)? Has the distribution finished propagating? |
| You published a new version but the old screen appears | Does the revision in `spa:smoke` match? If it does, the cause is the browser's cache. Also check that `index.html` has `max-age=0` |
| Opening `/notes/abc` directly gives an error | Is the fallback function attached to the distribution (does `spa:infra:diff` show no difference)? |
| The screen is blank and the console shows a JavaScript syntax error | Is HTML coming back for an asset request? Look at the "missing asset" check in `spa:smoke` |
| `spa:publish` cannot get the bucket name | Did `spa:infra:deploy` succeed? Are you looking at a different account or Region? |

## If you take this to production

- **Add a custom domain and a certificate.** This uses Route 53 and ACM. The certificate has to be created in `us-east-1`. This book does not cover it yet
- **Keep access logs.** They record who requested what and when. Storing them costs money (for how to think about log cost and retention, see [chapter 19](/en/chapters/19-observability.md))
- **Consider AWS WAF.** It costs money, so it can wait until you have something to protect ([chapter 21](/en/chapters/21-security.md))
- **Set a Content-Security-Policy.** The managed policy `SECURITY_HEADERS` does not include one. Define your own response headers policy that fits your app
- **Deploy through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02
- **Publish from CI.** Run it with short-lived credentials, not from a person's machine (for getting into AWS from CI without stored keys, see [chapter 20](/en/chapters/20-shipping.md))

## Clean up

<!-- section: 03.cleanup -->

```bash
vp run spa:unpublish --yes
vp run spa:infra:destroy
```

Empty the bucket first, because the pinned version of cdkd fails when it tries to delete a bucket that is not empty. Run without `--yes`, the task only shows how many objects it would delete and deletes nothing.

Deleting a distribution takes time, because it has to stop serving at every edge before it can be deleted.

What remains afterwards is the three storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them. Nothing else. This chapter's stack creates no logs.

## How the book's site differs

<!-- section: 03.book-site -->

As it happens, this book's site is also served from the same "private S3 and CloudFront". It handles URLs differently, though.

| | This chapter's SPA | The book's site |
| --- | --- | --- |
| Number of HTML files | One (`index.html`) | One per page |
| URLs that match no file | Return `index.html` | Return the 404 page as a 404 |
| What the function does | Rewrites client-side URLs to `/index.html` | Rewrites `/ja/chapters/03-spa/` to `/ja/chapters/03-spa/index.html` |

If the book's site used SPA fallback, every broken link would be shown as the top page, and nobody would notice that it was broken. The same parts need different settings depending on what they serve. The implementation of the book's site is in [Reproduce This Site](/en/reference/book-site.md).

::: details Verification notes for this chapter

**Checked locally.** Starting the SPA, type checking, unit tests, the build, CDK synth and assertions, and the tests for the publish plan and for the smoke check definitions.

**Not checked yet.** `spa:infra:deploy`, `spa:publish`, `spa:smoke`, `spa:infra:drift`, `spa:unpublish`, and `spa:infra:destroy` have not been run against a real AWS account. In particular, two things are waiting for a check in a real environment: that cdkd can create and read back an `AWS::CloudFront::Function`, and that the code that reads the stack outputs from the output of `cdkd state show` matches the shape of the real output.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Run it locally | `examples/03-spa/src/`, `examples/03-spa/index.html`, `examples/03-spa/vite.config.ts` | `dev:spa`, `lint:vue`, `typecheck:vue`, `test:unit`, `build:spa`, `preview:spa` |
| The bucket stays private, Define the distribution | `examples/03-spa/infra/lib/spa-stack.ts`, `examples/03-spa/infra/bin/app.ts`, `examples/03-spa/infra/test/spa-stack.test.ts`, `examples/03-spa/cdk.json` | `spa:infra:synth`, `test:unit` |
| What if someone opens /notes/abc directly? | `examples/03-spa/infra/functions/spa-fallback.js`, `examples/03-spa/infra/test/spa-fallback.test.ts` | `test:unit` |
| Deploy | `tools/src/infra/` | `spa:infra:diff`, `spa:infra:deploy`, `spa:infra:drift` |
| Publish | `tools/src/site/plan.ts`, `tools/src/site/plan.test.ts`, `tools/src/site/publish.ts`, `tools/src/site/bucket.ts`, `tools/src/site/revision.ts`, `tools/src/site/invalidate.ts`, `tools/src/infra/outputs.ts` | `spa:publish:plan`, `spa:publish`, `spa:invalidate` |
| Confirm that it arrived | `tools/src/site/smoke-spec.ts`, `tools/src/site/smoke-spec.test.ts`, `tools/src/site/smoke.ts` | `spa:smoke` |
| Clean up | `tools/src/site/unpublish.ts` | `spa:unpublish`, `spa:infra:destroy` |
| What it costs | `data/pricing/`, `tools/src/pricing/` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [Restrict access to an Amazon S3 origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Amazon S3 API: GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/), [Amazon CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/)
- AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json), [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
