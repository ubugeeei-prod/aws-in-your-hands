---
title: "03 Static Hosting: Costs, Pitfalls, and Cleanup"
---

# 03 Static Hosting: Costs, Pitfalls, and Cleanup

To close the chapter, this page covers cost, where you might get stuck, what to change for production, and cleanup. It ends with how the book's own site, which is served by the same architecture, differs.

## What it costs

Think about cost in three states. Amounts are in USD before tax, for S3 in the Tokyo Region and CloudFront at edge locations in Japan on pay-as-you-go pricing. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

While idle, a distribution has no charge for merely existing. The only charge is for what is stored in S3. The build output is under 1 MB, so even at list price that is less than USD 0.01 per month.

While in use, charges grow in proportion to the following.

| Item | Unit price (list) | Monthly free allowance |
| --- | --- | --- |
| Data transfer from CloudFront to readers | USD 0.114 per GB (first 10 TB) | 1 TB |
| HTTPS requests to CloudFront | USD 0.012 per 10,000 | 10 million |
| CloudFront Functions invocations | USD 0.10 per million | 2 million |
| GET requests to S3 (on a cache miss) | USD 0.0037 per 10,000 | Could not be confirmed. Not treated as 0 |

The CloudFront free allowance applies to pay-as-you-go pricing and is shared across the whole account. Transfer from S3 to CloudFront is not charged.

[Pricing Worksheets](/en/reference/pricing.md) has a worked example for the book's own site, which has the same architecture, assuming 20,000 page views a month. It comes to around USD 0.50 per month at list price, and around USD 0.03 after the CloudFront free allowance. That amount is an example built on assumptions, not an estimate for your app.

Publishing costs a little too. PUT requests to S3 are USD 0.0047 per 1,000. Invalidations are free up to 1,000 paths a month and USD 0.005 per path beyond that.

Some things are not in this calculation. Access logs, AWS WAF, and a custom domain (Route 53) are 0 because they are not used. Adding them adds charges.

Besides pay-as-you-go, CloudFront also has flat-rate monthly plans. On the date checked there were four: Free, Pro, Business, and Premium. The features differ by plan, and how to select a plan from CDK has not been checked, so this book's sample stays on pay-as-you-go.

## Where you might get stuck

| Symptom | What to check |
| --- | --- |
| Opening the site shows an `AccessDenied` XML document | Whether the bucket is empty (whether you ran `spa:publish`), and whether the distribution has finished propagating |
| You published a new version but the old screen appears | Whether the revision in `spa:smoke` matches. If it does, the cause is the browser's cache. Also check that `index.html` has `max-age=0` |
| Opening `/notes/abc` directly gives an error | Whether the fallback function is attached to the distribution (whether `spa:infra:diff` shows no difference) |
| The screen is blank and the console shows a JavaScript syntax error | Whether HTML is coming back for an asset request. Look at the "missing asset" check in `spa:smoke` |
| `spa:publish` can't get the bucket name | Whether `spa:infra:deploy` succeeded, and whether you are looking at a different account or Region |

## If you take this to production

- Add a custom domain and a certificate. That uses Route 53 and ACM, and the certificate must be created in `us-east-1`. This book does not cover it yet
- Keep access logs. They record who requested what and when. Storing them costs money (for how to think about log cost and retention, see [chapter 19](/en/chapters/19-observability.md))
- Consider AWS WAF. It costs money, so it can wait until you have something to protect ([chapter 21](/en/chapters/21-security.md))
- Set a Content-Security-Policy. The managed `SECURITY_HEADERS` policy does not include one, so you define a response headers policy that fits your app
- Make the AWS CDK CLI and CloudFormation the deployment path, for the reasons given in chapter 02
- Publish from CI. Run it with short-lived credentials, not from a person's machine (for getting into AWS from CI without stored keys, see [chapter 20](/en/chapters/20-shipping.md))

## Clean up

<!-- section: 03.cleanup -->

```bash
vp run spa:unpublish --yes
vp run spa:infra:destroy
```

The pinned version of cdkd fails to delete a bucket that is not empty, so you empty the bucket first. Without `--yes`, the task only shows how many objects it would delete and deletes nothing.

Deleting a distribution takes time, because delivery has to be stopped at every edge before the deletion.

What remains afterward is cdkd's three storage locations, created by bootstrap in chapter 02, and the deployment files in them. This chapter's stack creates no logs, so nothing else remains.

## How the book's site differs

<!-- section: 03.book-site -->

This book's site is served by the same architecture, a private S3 bucket and CloudFront. It handles URLs differently, though.

| | This chapter's SPA | The book's site |
| --- | --- | --- |
| Number of HTML files | One (`index.html`) | One per page |
| A URL that matches no file | Returns `index.html` | Returns the 404 page as a 404 |
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
| When /notes/abc is opened directly | `examples/03-spa/infra/functions/spa-fallback.js`, `examples/03-spa/infra/test/spa-fallback.test.ts` | `test:unit` |
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
