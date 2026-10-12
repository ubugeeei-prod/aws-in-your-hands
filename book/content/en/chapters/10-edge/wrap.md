---
title: "10 Edge: Costs, Pitfalls, and Cleanup"
---

# 10 Edge: Costs, Pitfalls, and Cleanup

By the end of the [previous page](/en/chapters/10-edge/deploy.md), CloudFront Functions, KVS, and Lambda@Edge had all been put to work. This page sorts out where to run a piece of work and how this differs from Workers, then covers costs, common problems, and cleanup.

## Where to put what

<!-- section: 10.placement -->

The table compares the four places this chapter has looked at.

| | Static delivery | CloudFront Functions | Lambda@Edge | Regional Lambda |
| --- | --- | --- | --- | --- |
| Where it runs | The edge cache | Edge locations | A Region near the reader (replicas) | One Region (Tokyo in this book) |
| When it runs | - | Viewer request, viewer response | All four events | When called (chapter 04) |
| Network | - | None | Yes | Yes |
| Body | - | Can't read | Can read (truncated) | Can read |
| State | The cache only | Reads KVS, nothing more | Holds none; fetches from outside | DynamoDB and the like (chapter 05) |
| Execution time | - | Under 1 ms | Up to 30 seconds | Up to Lambda's limit (30 seconds behind an HTTP API) |
| Code size | - | 10 KB | 50 MB (compressed) | Up to Lambda's limit |
| How settings get in | - | Code or KVS | Code, or fetched at run time | Environment variables and more |
| List price per million | Request charges only | USD 0.10 | USD 0.60 plus duration | USD 0.20 plus duration |

When you are unsure, consider the columns from left to right.

Serve statically whatever can be served statically. A cached response runs no code at all, so it is the fastest and cheapest option and has the fewest parts that can break.

Put work that depends only on the request and its headers in CloudFront Functions. URL rewrites, redirects, added headers, and checks on signed tokens belong here. The unit price is low enough to run on every request.

For work that calls another service, consider a regional Lambda function first. If your data is in Tokyo, it makes sense to put the code in Tokyo too. Running code close to the reader gains little when the code then makes a round trip to a database in Tokyo.

Use Lambda@Edge when you really need code just before or just after the cache. It is for work that can only happen in the middle of CloudFront's flow, such as choosing between origins, transforming an origin response before it is cached, or inspecting a body and refusing the request before it reaches the origin. With version management, `us-east-1`, no environment variables, and logs spread across Regions, it takes the most operational effort of the four, so I think it is best kept as the last choice.

## If you're coming from Workers

<!-- section: 10.workers -->

If you have used Cloudflare Workers, you probably felt that one Worker could do everything in this chapter. It can. The table lays out the differences.

| | Cloudflare Workers | CloudFront Functions | Lambda@Edge |
| --- | --- | --- | --- |
| Network (`fetch`) | Yes. Subrequests per invocation: 50 on Free, 10,000 by default on Paid | No | Yes |
| CPU time | 10 ms on Free; 30 seconds by default on Paid (up to 5 minutes). Time spent waiting on `fetch` or KV doesn't count | Under 1 ms | Up to 30 seconds of duration |
| Memory | 128 MB per isolate | 2 MB | 128 MB on viewer events; up to Lambda's limit on origin events |
| Code size | 64 MiB (uncompressed) | 10 KB | 50 MB (compressed) |
| Writing to KV | A Worker can write | A function can't write | KVS isn't available |
| KV value size | 25 MiB | 1 KB (5 MB in total) | - |
| KV consistency | Eventually consistent. Documented as possibly taking 60 seconds or more in other locations | Delayed. No number found in the Developer Guide | - |

CloudFront Functions are not the counterpart of Workers. The names are similar and both run JavaScript at the edge, but what they can do differs by orders of magnitude. If you think of Workers as a place to write applications and CloudFront Functions as a place to write CDN configuration as code, you won't confuse the two.

To get close to Workers on AWS, you combine parts. Small decisions at the entrance go to CloudFront Functions, the application goes to a Lambda function in Tokyo, and the data goes to DynamoDB, which is the setup this book has been building. There are more parts, and AWS has nothing as easy as adding bindings to a single Worker.

What AWS has instead is a boundary around each part. A CloudFront Function has no network access, so however you write it, an outage elsewhere can't take it down. It costs USD 0.10 per million invocations even when it runs on every request. For work that fits within those constraints, I think it is a well-made tool.

The two KV stores differ in how they document the delay. Workers KV gives a rough figure in its documentation, "up to 60 seconds or more". For CloudFront KVS, I couldn't find a number in the Developer Guide. Neither one says that a write can be read everywhere right after it is made.

On pricing, the Workers Standard plan includes 10 million requests and 30 million CPU milliseconds a month, and beyond that it charges USD 0.30 per million requests and USD 0.02 per million CPU milliseconds. I haven't checked the monthly fee itself for this chapter.

## The money part

<!-- section: 10.cost -->

Amounts are in USD, for edge locations in Japan, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

Nothing in this chapter's setup costs money just for existing. The distribution and the function cost 0 unless they are called. S3 storage is a few KB for three HTML files. For KVS, the Price List has only two items, "reads from functions" and "API operations", and I found no item for storage.

The table shows what it costs in use. It assumes 1,000,000 requests a month, of which 10% are for the home page, 20% for other pages, and 70% for files, and 20 syncs a month.

| Item | Quantity | List price | After the monthly free tier |
| --- | --- | --- | --- |
| CloudFront HTTPS requests | 1,000,000 | 1.20 | 0 |
| Transfer from CloudFront to readers | 19.07 GB | 2.17 | 0 |
| CloudFront Functions invocations | 1,000,000 | 0 | 0 |
| KVS reads | 1,400,000 | 0 | 0 |
| KVS API operations | 80 | 0.08 | 0.08 (no free tier could be confirmed, so none is deducted) |
| Lambda@Edge requests | 10,000 | 0.01 | 0.01 |
| Lambda@Edge duration | 62.5 GB-seconds | 0.00 | 0.00 |
| S3 GET requests | 333,333 | 0.12 | 0.12 |
| Subtotal | | **3.59** | **0.21** |

Function invocations and KVS reads show 0 in the list price column because the first tier in the Price List (up to 2,000,000 a month) is USD 0 to begin with. Beyond 2,000,000, invocations cost USD 0.10 per million and reads cost USD 0.03 per million.

The number of reads depends on how the function is written. This chapter's function reads once for a file and twice for a page. If it read three times on every request, that would be 3,000,000 reads, which is past the free tier. The one line that skips the redirect lookup for files makes that difference in cost.

KVS API operations cost USD 1 per 1,000, a unit price orders of magnitude higher than reads inside a function. One sync makes three calls (check the version, list, update), so it costs about USD 0.003, but as the number of keys grows, the list takes more calls, one per page of 50 keys. If you plan something like running `edge:kvs:plan` often from CI, count the calls.

Lambda@Edge costs USD 0.60 per million requests plus USD 0.00005001 per GB-second. According to the pricing page, it has no free tier. Compared with USD 0.0000133334 per GB-second for Lambda in Tokyo (arm64), the unit price for duration is about 3.75 times higher. The table leaves out the charge for the logs (CloudWatch Logs) that Lambda@Edge writes in each Region.

The free tier applies to pay-as-you-go pricing and is shared across the whole account.

### When it gets hammered

Anyone who knows the URL can call this distribution. It is worth checking what stops a bot that sends a large number of requests, and what doesn't.

The cache protects the static pages and files. The default behavior accepts only GET and HEAD and uses the `CachingOptimized` cache policy. That policy puts neither the query string nor cookies in the cache key (CDK's type definitions say so). A request with `?x=<random>` appended therefore gets the same cached response and never reaches S3. Requests reach S3 when the bot keeps changing to paths that don't exist. In that case each request adds one S3 GET (USD 0.37 per million).

The cache only stops requests from reaching the origin, though. Requests answered from the cache are still charged for the following.

- CloudFront requests: USD 1.20 per million
- CloudFront Functions invocations: USD 0.10 per million (the function runs on every request)
- KVS reads: USD 0.03 per million. One read for a file, two for a page, three for the home page
- Transfer to readers: USD 0.114 per GB

And **nothing limits the number of requests itself.** The API Gateway in chapter 04 let you set a per-second limit at no charge. A pay-as-you-go CloudFront distribution has no equivalent setting. For example, 1,000 requests a second kept up for a day comes to 86.4 million requests, which costs USD 103.68 for requests, USD 8.64 for the function, and USD 2.59 for KVS reads (one read each). With 20 KB per response, transfer is 1,648 GB, or USD 187.87. The total is USD 302.78 (list price, with no monthly free tier deducted). That amount is for 1,000 requests a second, and a faster flood costs proportionally more.

With `/digest` added, Lambda@Edge comes into it as well. The function in front refuses anything but POST with a 405, so those requests cost only the request charge and the function invocation, as above, which is USD 1.30 per million. Each POST runs Lambda@Edge and costs USD 2.27 per million. That breaks down into 1.20 for CloudFront requests, 0.10 for the function, 0.06 for two KVS reads, 0.60 for Lambda@Edge requests, and 0.31 for duration (assuming 128 MB and 50 ms). Lambda@Edge doesn't allow reserved concurrency, so you can't limit the count on the function's side either. The charge for the logs written in each Region is not included in that amount.

You can add three things against this.

- An AWS WAF rate-based rule. You attach a web ACL to the distribution and limit how often one IP address can call it. [Chapter 21](/en/chapters/21-security.md) builds one. It costs USD 5 a month for the web ACL, USD 1 a month per rule, and USD 0.60 per million requests inspected. Because it has a monthly charge just for existing, this chapter doesn't add it. Chapter 21 also explains that it limits "near" the number you set, not exactly at it
- A CloudFront flat-rate plan. The pricing page lists plans at USD 0 (Free), 15 (Pro), 200 (Business), and 1,000 (Premium) a month. I haven't checked what each plan includes or whether this chapter's setup (KVS, Lambda@Edge) can be used on one
- A billing alert. This is the budget alert set up in chapter 01. It doesn't stop the requests, but it lets you know. It arrives 8 to 12 hours later, though

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| You synced, but the old value comes back | Wait first. Propagation to the edge locations takes time. If `edge:kvs:plan` shows an empty diff, the value is in the KVS |
| The sync stops with an authentication error | The KVS API signs with SigV4A. Temporary credentials need a version 2 session token, and the ones issued by the global STS endpoint (`sts.amazonaws.com`) don't work. Check that you are set up to use a Regional STS endpoint |
| The sync stops with "store is PROVISIONING" | The KVS was just created. Wait until it is `READY` |
| After a deploy, no redirect works | Check whether the KVS is empty. A KVS that was just recreated is. Run `edge:kvs:sync` again |
| Local tests pass, but creating the function fails with a syntax error | Check for syntax that is not on the documented list. Runtime 2.0 rejects some things that Node.js accepts |
| `/digest` returns 405 | `edge-router.js` refuses anything but POST before Lambda@Edge runs. Check that you are sending the request with `curl -X POST` |
| `/digest` returns 502 | The Lambda@Edge response didn't pass CloudFront's validation. The logs are not in `us-east-1`. They are in `/aws/lambda/us-east-1.aih-edge-body-digest` in the Region where the function ran |
| You can't delete the Lambda@Edge function | Replicas remain. After you remove the function from the distribution, the replicas take a few hours to go away |
| You turned on maintenance, but some pages still show | Either propagation is still under way or the browser is holding an earlier response. The 503 carries `no-store`, so CloudFront's cache is not the cause |

## If you take this to production

- Limit the rate at the entrance. As "When it gets hammered" says, nothing limits the number of requests to this distribution. Before it takes production traffic, attach an AWS WAF rate-based rule ([chapter 21](/en/chapters/21-security.md)). This matters most for a path like `/digest`, where every request runs code
- Limit who can write to the KVS. Review and merge `edge-data.json`, and let only CI run the sync. Keep direct edits in the console for emergencies. A direct edit shows up as a diff in the next `edge:kvs:plan`
- Don't make the maintenance switch your only defense. Propagation is delayed, and the switch doesn't work while KVS can't be read. A lockout that protects data has to be enforced at the origin as well
- Watch the function's metrics, which are errors and compute utilization ([chapter 19](/en/chapters/19-observability.md) shows how to put an alarm together). If utilization is close to the limit, review the number of reads and the size of the JSON
- Estimate the size of the table. The limits are 5 MB in total and 1 KB per value. If you plan to store tens of thousands of redirects, do the calculation first
- Set a retention period on the Lambda@Edge log groups. They are created automatically in each Region where the function ran, and they are outside the stack, so you have to set it yourself
- Deploy through the AWS CDK CLI and CloudFormation, for the reasons given in chapter 02

## Cleaning up

<!-- section: 10.cleanup -->

```bash
vp run edge:unpublish --yes
vp run edge:infra:destroy
```

These remove the bucket, the distribution, the function, and the KVS. The contents of the KVS go with it, but you can put them back at any time as long as you have `edge-data.json`.

If you tried Lambda@Edge, the order of deletion is fixed. First detach the function from the distribution with the `edge:infra:destroy` above (or with `edge:infra:deploy` without `-c bodyDigestVersionArn`). Then wait a few hours. The function can't be deleted until CloudFront has finished deleting the replicas around the world.

```bash
vp run edge:body:infra:destroy
```

Even after all of this, three things remain.

- The Lambda@Edge log groups. They are named `/aws/lambda/us-east-1.aih-edge-body-digest`, one in each Region where the function ran. They were created automatically outside the stack, so they stay when the stack is deleted. They keep incurring storage charges, so delete them in the CloudWatch console, switching Regions as you go
- The service-linked roles. They are `AWSServiceRoleForLambdaReplicator` and `AWSServiceRoleForCloudFrontLogger`, created automatically the first time you use Lambda@Edge. They cost nothing
- cdkd's storage. If you bootstrapped in `us-east-1`, it remains there as well (chapter 02)

::: details Verification notes for this chapter

**Checked locally.** Unit tests cover the function (the deployed file run under `node:vm`), KVS planning and sync, the SDK adapter, the Lambda@Edge handler, and both stacks. Type checking and synth (including the esbuild bundle, with and without `-c bodyDigestVersionArn`) pass. I started `dev:edge`, ran the `curl` commands from the text, and flipped the flags in `edge-data.json`. I also started `dev:edge:cdkd` (cdkd's emulator, no Docker) and got the same responses to the same `curl` commands. The SDK client signs in the SigV4A form (checked without going out to the network). The same `node:vm` tests confirm that the function refuses anything but a POST to `/digest` with a 405, without reading KVS.

**Not checked yet.** Nothing has been run in AWS. In particular, the following still have to be confirmed in a real environment. That `edge-router.js` runs on runtime 2.0 (syntax, 10 KB, 2 MB, compute utilization, `cf.kvs()` without an ID, `get()` rejecting for a missing key). How long a KVS update takes to reach the edge locations. Which error the KVS API returns for a stale `If-Match`. That AWS accepts the signature from `@aws-sdk/signature-v4a`. That cdkd can actually handle `AWS::CloudFront::KeyValueStore`, `AWS::CloudFront::Function`, and the `AWS::Lambda::Version` in the `us-east-1` stack, and whether a bootstrap in `us-east-1` is needed. That Node.js 24 works on Lambda@Edge. How long Lambda@Edge replicas take to be deleted, and where the log groups are created. The symptoms in the "Where people get stuck" table were put together from the documentation, not reproduced. Whether syntax outside runtime 2.0's list is actually rejected hasn't been tried either. The same goes for the 405 on `/digest`: that CloudFront Functions accepts a response carrying an `allow` header, and that Lambda@Edge really doesn't run for a request that isn't a POST, haven't been confirmed by deploying. The amounts in "When it gets hammered" are computed from unit prices, not read off a bill.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/10-edge/infra/lib/edge-stack.ts`, `infra/bin/app.ts` | - |
| Reading the function | `examples/10-edge/infra/functions/edge-router.js`, `edge-data.json` | `test:unit` |
| Running the same file under Node.js | `examples/10-edge/src/local/load-function.ts`, `infra/test/edge-router.test.ts` | `test:unit`, `typecheck` |
| Run it on your machine | `examples/10-edge/src/local/dev.ts`, `site/`, `scripts/kvs-file.ts` | `dev:edge`, `dev:edge:cdkd` |
| What KVS promises and what it does not | `examples/10-edge/src/kvs/config.ts`, `test/kvs.test.ts` | `test:unit` |
| Changing the table safely | `examples/10-edge/src/kvs/plan.ts`, `src/kvs/sync.ts`, `src/kvs/store.ts`, `scripts/kvs-sync.ts`, `test/sync.test.ts`, `test/store.test.ts` | `edge:kvs:plan`, `edge:kvs:sync`, `test:unit` |
| Getting ready for AWS | `examples/10-edge/infra/lib/edge-stack.ts`, `infra/test/edge-stack.test.ts`, `cdk.json` | `edge:infra:synth`, `test:unit` |
| Deploying and switching | `tools/src/infra/`, `tools/src/site/publish.ts`, `examples/10-edge/scripts/kvs-sync.ts` | `edge:infra:diff`, `edge:infra:deploy`, `edge:publish`, `edge:kvs:plan`, `edge:kvs:sync`, `edge:infra:drift` |
| Reading the body with Lambda@Edge | `examples/10-edge/src/lambda-edge/body-digest.ts`, `infra/lib/body-digest-stack.ts`, `infra/test/body-digest-stack.test.ts`, `test/body-digest.test.ts` | `edge:body:infra:synth`, `edge:body:infra:deploy`, `edge:body:infra:destroy`, `test:unit` |
| The money part | `data/pricing/`, `tools/src/pricing/calc.ts` | `test:unit` |
| Cleaning up | `tools/src/site/unpublish.ts`, `tools/src/infra/` | `edge:unpublish`, `edge:infra:destroy`, `edge:body:infra:destroy` |

**Primary sources** (all checked 2026-10-11)

- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [JavaScript runtime 2.0 features for CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html)
- [CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html), [Test functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/test-function.html)
- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html), [Helper methods for key value stores](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html), [Work with key value data](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html), [Create a key value store](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create.html), [File format for key-value pairs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create-s3-kvp.html)
- CloudFront KeyValueStore API: [UpdateKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html), [ListKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_ListKeys.html)
- [CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
- [Differences between CloudFront Functions and Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html), [Restrictions on all edge functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html), [Edge function logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-logs.html)
- [Restrictions on Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html), [Set up IAM permissions and roles for Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-permissions.html), [Delete Lambda@Edge functions and replicas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html)
- [AWS News Blog: Introducing Amazon CloudFront KeyValueStore](https://aws.amazon.com/blogs/aws/introducing-amazon-cloudfront-keyvaluestore-a-low-latency-datastore-for-cloudfront-functions/) (a launch post, not a specification)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/), AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json)
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [KV Limits](https://developers.cloudflare.com/kv/platform/limits/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [`src/provisioning/register-providers.ts` (v0.296.28)](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/src/provisioning/register-providers.ts)
- [@aws-sdk/signature-v4a 3.1138.0](https://registry.npmjs.org/@aws-sdk/signature-v4a) (the installed package's source was also read)

:::
