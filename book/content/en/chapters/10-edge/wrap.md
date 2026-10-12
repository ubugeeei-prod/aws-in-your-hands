---
title: "10 Edge: Costs, Pitfalls, and Cleanup"
---

# 10 Edge: Costs, Pitfalls, and Cleanup

## Where to put what

<!-- section: 10.placement -->

Here's everything so far in one table.

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

When in doubt, go from the left.

**If it can be served statically, serve it.** A cached response runs not one line of code. It's the fastest, the cheapest, and has the fewest parts to break.

**If the request and its headers decide everything, use CloudFront Functions.** URL rewrites, redirects, adding headers, checking signed tokens. The unit price is low enough to run on every request without a second thought.

**If it calls another service, think of a regional Lambda first.** If your data is in Tokyo, putting the code in Tokyo is the straightforward choice. Running code close to the reader means less when it then makes a round trip to a database in Tokyo.

**Lambda@Edge is for when you really need code just before or just after the cache.** Choosing between origins, transforming an origin response before it's cached, inspecting a body and refusing it before it reaches the origin. Work that can only happen in the middle of CloudFront's flow. Version management, `us-east-1`, no environment variables, logs scattered across Regions: operationally it's the heaviest of the four, so I'd keep it as the last option.

## If you're coming from Workers

<!-- section: 10.workers -->

If you've been using Cloudflare Workers, you probably read this chapter thinking "one Worker could do all of that". You're right. Here it is, side by side.

| | Cloudflare Workers | CloudFront Functions | Lambda@Edge |
| --- | --- | --- | --- |
| Network (`fetch`) | Yes. Subrequests per invocation: 50 on Free, 10,000 by default on Paid | No | Yes |
| CPU time | 10 ms on Free; 30 seconds by default on Paid (up to 5 minutes). Time spent waiting on `fetch` or KV doesn't count | Under 1 ms | Up to 30 seconds of duration |
| Memory | 128 MB per isolate | 2 MB | 128 MB on viewer events; up to Lambda's limit on origin events |
| Code size | 64 MiB (uncompressed) | 10 KB | 50 MB (compressed) |
| Writing to KV | A Worker can write | A function can't write | KVS isn't available |
| KV value size | 25 MiB | 1 KB (5 MB in total) | - |
| KV consistency | Eventually consistent. Documented as possibly taking 60 seconds or more in other locations | Delayed. No number found in the Developer Guide | - |

CloudFront Functions are not the counterpart of Workers. The name and the "JavaScript running at the edge" look are similar, but what they can do differs by orders of magnitude. Workers are a place to write applications; CloudFront Functions are a place to write CDN configuration as code. Think of them that way and they won't blur together.

Getting close to Workers on AWS means combining parts. Small decisions at the entrance go to CloudFront Functions, the application to a Lambda function in Tokyo, the data to DynamoDB. That's the setup this book has been building. It's true that there are more parts, and AWS has nothing like the ease of adding bindings to a single Worker.

What you get instead are boundaries between the parts. A CloudFront Function can't reach the network, so no matter how you write it, an outage somewhere else can't drag it down. Running it on every request costs USD 0.10 per million. For work that fits within those limits, I think it's a well-made tool.

One comparison between the two KVs. Workers KV documents a rough figure for the delay: "up to 60 seconds or more". For CloudFront KVS, I couldn't find a number in the Developer Guide. What they share: neither says a write is readable everywhere right after it's made.

On pricing, the Workers Standard plan includes 10 million requests and 30 million CPU milliseconds a month, then charges USD 0.30 per million requests and USD 0.02 per million CPU milliseconds. I haven't checked the monthly fee itself for this chapter.

## The money part

<!-- section: 10.cost -->

Amounts are in USD, for Japan edge locations, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

Nothing in this chapter's setup charges you just for existing. The distribution and the functions cost 0 unless they're called. S3 storage is a few KB for three HTML files. As for KVS, the Price List has just two items for it, "reads from functions" and "API operations", and I found no item for storage.

In use, it looks like this. The assumptions: 1,000,000 requests a month, of which 10% are the home page, 20% other pages, and 70% files, with 20 syncs a month.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| CloudFront HTTPS requests | 1,000,000 | 1.20 | 0 |
| Transfer from CloudFront to readers | 19.07 GB | 2.17 | 0 |
| CloudFront Functions executions | 1,000,000 | 0 | 0 |
| KVS reads | 1,400,000 | 0 | 0 |
| KVS API operations | 80 | 0.08 | 0.08 (no free allowance confirmed; none deducted) |
| Lambda@Edge requests | 10,000 | 0.01 | 0.01 |
| Lambda@Edge duration | 62.5 GB-seconds | 0.00 | 0.00 |
| S3 GET requests | 333,333 | 0.12 | 0.12 |
| Subtotal | | **3.59** | **0.21** |

For function executions and KVS reads, the first tier in the Price List (up to 2,000,000 a month) is already USD 0, so the list-price column is 0 as well. Beyond it, executions are USD 0.10 per million and reads are USD 0.03 per million.

The number of reads depends on how the function is written. This chapter's function reads once for a file and twice for a page. If it read three times on every request, that would be 3,000,000 reads, past the free tier. This is where the one line "files don't look up the redirect table" pays off.

KVS API operations are USD 1 per 1,000. That's a far higher unit price than reads from inside a function. One sync is three calls (check the version, list, update), so about USD 0.003, but as the keys grow, it adds one list call per page of 50. If you plan on something like running `edge:kvs:plan` often from CI, count them.

Lambda@Edge is USD 0.60 per million requests and USD 0.00005001 per GB-second. According to the pricing page, it has no free tier. Compared with USD 0.0000133334 per GB-second for Lambda in Tokyo (arm64), the duration price is about 3.75 times higher. One thing not in this table: the cost of the logs Lambda@Edge writes to CloudWatch Logs in each Region.

The free allowances apply to pay-as-you-go and are shared across the account.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| You synced, but the old value comes back | Wait first. Propagation to the edge takes time. If `edge:kvs:plan` shows an empty diff, the value is in the KVS |
| The sync stops with an authentication error | The KVS API signs with SigV4A. Temporary credentials need a version 2 session token, and the ones issued by the global STS endpoint (`sts.amazonaws.com`) don't work. Check that you're set up to use a Regional STS endpoint |
| The sync stops with "store is PROVISIONING" | The KVS was just created. Wait until it's `READY` |
| After a deploy, no redirect works | Is the KVS empty? A KVS that was just recreated is. Run `edge:kvs:sync` again |
| Local tests pass, but creating the function fails with a syntax error | Are you using syntax that's not on the documented list? Some things Node.js accepts, runtime 2.0 doesn't |
| `/digest` returns 502 | The Lambda@Edge response didn't pass CloudFront's validation. The logs aren't in `us-east-1`; they're in `/aws/lambda/us-east-1.aih-edge-body-digest` in the Region where it ran |
| You can't delete the Lambda@Edge function | Replicas remain. After removing it from the distribution, they take a few hours to go away |
| You turned on maintenance, but some pages still show | Either propagation is still under way or the browser is holding an earlier response. The 503 carries `no-store`, so it's not CloudFront's cache |

## If you take this to production

- **Limit who can write to the KVS.** Review and merge `edge-data.json`, and let only CI run the sync. Keep direct edits in the console for emergencies. This chapter's script shows a direct edit as a diff on the next `edge:kvs:plan`
- **Don't make the maintenance switch your only defense.** Propagation is delayed, and it doesn't work while KVS can't be read. A lockout that protects data has to happen at the origin as well
- **Watch the function's metrics.** Errors and compute utilization (for how to put an alarm together, see [chapter 19](/en/chapters/19-observability.md)). If utilization is close to the limit, revisit the number of reads and the size of the JSON
- **Estimate the size of the table.** 5 MB, 1 KB per value. If you plan on tens of thousands of redirects, do the math first
- **Set a retention period on the Lambda@Edge log groups.** They're created automatically in each Region where the function runs. They're outside the stack, so you set it yourself
- **Deploy through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Cleaning up

<!-- section: 10.cleanup -->

```bash
vp run edge:unpublish --yes
vp run edge:infra:destroy
```

The bucket, the distribution, the function, and the KVS go away. So do the contents of the KVS (as long as you have `edge-data.json`, you can put them back any time).

If you tried Lambda@Edge, order matters. First detach it from the distribution with `edge:infra:destroy` above (or with `edge:infra:deploy` without `-c bodyDigestVersionArn`). Then wait a few hours. Until CloudFront has finished deleting the replicas around the world, the function can't be deleted.

```bash
vp run edge:body:infra:destroy
```

Three things remain after that.

- **The Lambda@Edge log groups.** `/aws/lambda/us-east-1.aih-edge-body-digest` in each Region where it ran. They were created automatically, outside the stack, so deleting the stack leaves them. They keep costing storage, so delete them in the CloudWatch console, switching Regions as you go
- **The service-linked roles.** `AWSServiceRoleForLambdaReplicator` and `AWSServiceRoleForCloudFrontLogger`. They're created automatically the first time you use Lambda@Edge. They cost nothing
- **cdkd's storage.** If you bootstrapped in `us-east-1`, it remains there too (chapter 02)

::: details Verification notes for this chapter

**Checked locally.** Unit tests for the function (the deployed file run under `node:vm`), KVS planning and sync, the SDK adapter, the Lambda@Edge handler, and both stacks. Type checking. Synth (including the esbuild bundle, with and without `-c bodyDigestVersionArn`). Starting `dev:edge`, running the `curl` commands from the text, and flipping the flags in `edge-data.json`. Starting `dev:edge:cdkd` (cdkd's emulator, no Docker) and getting the same responses to the same `curl` commands. That the SDK client signs in the SigV4A form (without going out to the network).

**Not checked yet.** Nothing has been run in AWS. In particular, these are waiting to be confirmed in a real environment. That `edge-router.js` runs on runtime 2.0 (syntax, 10 KB, 2 MB, compute utilization, `cf.kvs()` without an ID, `get()` rejecting for a missing key). How long a KVS update takes to reach the edge. Which error the KVS API returns for a stale `If-Match`. That AWS accepts the signature from `@aws-sdk/signature-v4a`. That cdkd can actually handle `AWS::CloudFront::KeyValueStore`, `AWS::CloudFront::Function`, and the `AWS::Lambda::Version` in the `us-east-1` stack, and whether a bootstrap in `us-east-1` is needed. That Node.js 24 works on Lambda@Edge. How long Lambda@Edge replicas take to be deleted, and where the log groups are created. The symptoms in the "Where people get stuck" table were put together from the documentation, not reproduced. Whether syntax outside runtime 2.0's list is actually rejected hasn't been tried either.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/10-edge/infra/lib/edge-stack.ts`, `infra/bin/app.ts` | - |
| Reading the function | `examples/10-edge/infra/functions/edge-router.js`, `edge-data.json` | `test:unit` |
| Running the same file under Node.js | `examples/10-edge/src/local/load-function.ts`, `infra/test/edge-router.test.ts` | `test:unit`, `typecheck` |
| Run it on your machine | `examples/10-edge/src/local/dev.ts`, `site/`, `scripts/kvs-file.ts` | `dev:edge`, `dev:edge:cdkd` |
| What does KVS actually promise? | `examples/10-edge/src/kvs/config.ts`, `test/kvs.test.ts` | `test:unit` |
| Changing the table safely | `examples/10-edge/src/kvs/plan.ts`, `src/kvs/sync.ts`, `src/kvs/store.ts`, `scripts/kvs-sync.ts`, `test/sync.test.ts`, `test/store.test.ts` | `edge:kvs:plan`, `edge:kvs:sync`, `test:unit` |
| Getting ready for AWS | `examples/10-edge/infra/lib/edge-stack.ts`, `infra/test/edge-stack.test.ts`, `cdk.json` | `edge:infra:synth`, `test:unit` |
| Deploy it and flip the switches | `tools/src/infra/`, `tools/src/site/publish.ts`, `examples/10-edge/scripts/kvs-sync.ts` | `edge:infra:diff`, `edge:infra:deploy`, `edge:publish`, `edge:kvs:plan`, `edge:kvs:sync`, `edge:infra:drift` |
| When you need the body: Lambda@Edge | `examples/10-edge/src/lambda-edge/body-digest.ts`, `infra/lib/body-digest-stack.ts`, `infra/test/body-digest-stack.test.ts`, `test/body-digest.test.ts` | `edge:body:infra:synth`, `edge:body:infra:deploy`, `edge:body:infra:destroy`, `test:unit` |
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
