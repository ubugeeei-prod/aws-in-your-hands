---
title: "69 Web Functions: Costs, Pitfalls, and Cleanup"
---

# 69 Web Functions: Costs, Pitfalls, and Cleanup

For the setup built from the [first page](/en/chapters/69-web-functions.md) to the [deploy page](/en/chapters/69-web-functions/deploy.md), this page covers the cost, where people trip, what production adds, how the features of the same shape at Cloudflare and Vercel differ, and how to clean up.

## Costs

<!-- section: 69.costs -->

Amounts are in USD at list price in the Tokyo Region, before tax. A month is 730 hours (2,628,000 seconds). The inputs and unit prices are in [Pricing calculations](/en/reference/pricing.md). The unit prices are from the AWS Price List published on 2026-10-12.

Four things are billed.

- **Requests.** 0.30 per million. An Event Function is 0.20, so on this line alone a Web Function costs more
- **CPU time.** 0.0000322421 per vCPU-second, for the time your code actually spent on a CPU. Time spent waiting for a database is not counted
- **Memory.** 0.0000042688 per GB-second, for the memory an execution environment uses. It goes on while the environment exists, with or without a request in it
- **Data transfer.** At AWS's ordinary data transfer rates

On top of these come writing and storing logs (CloudWatch Logs) and storing the package in S3. Logs go into two log groups. Writing is charged once, and storage in both places. The metrics Lambda publishes are free.

**A month in which this stack is deployed and never called costs 0.00.** The endpoint scales the environments down to none, so requests, CPU time, and memory are all zero. What remains is storage for an 8.3 KiB package, which comes to 0.0000002. Unlike the Lambda Managed Instances of [chapter 35](/en/chapters/35-lambda-managed-instances.md) or the Fargate tasks of [chapter 12](/en/chapters/12-containers.md), nothing is charged for merely being there.

For a month with use, take the same traffic as chapter 04: a million requests a month at 50 ms each.

| | Requests | Compute | Memory | Logs | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chapter 04: Event Function (256 MB) and HTTP API | 1.49 | 0.17 | | 0.37 | 2.02 |
| Web Function: 12 ms of CPU time | 0.30 | 0.39 | 1.68 | 0.37 | 2.74 |
| Web Function: 50 ms of CPU time | 0.30 | 1.61 | 1.68 | 0.37 | 3.96 |

Requests on the chapter 04 line are 1.29 for the HTTP API plus 0.20 for Lambda. Totals add the unrounded values, so they can differ from the sum of the figures in a row by 0.01.

The two Web Function lines rest on these assumptions. None is a measured value.

- One execution environment runs for the whole month. AWS's own pricing examples make the same assumption. How long an environment stays after requests stop is not in the documentation
- The environment uses 0.15 GB of memory. The lightest example on the pricing page uses 0.14 GB
- CPU time is 12 ms of the 50 ms on the first line (the ratio of an example on the pricing page) and all 50 ms on the second

What the table shows is that for an API with little traffic, a Web Function can cost more. Requests get 1.19 cheaper, and memory for an environment that stays costs more than that. If an environment existed for a tenth of the month, memory would be 0.17, and the line with 12 ms of CPU time would total 1.23, less than chapter 04. Which is closer cannot be known until the stack is deployed and the metric for the number of environments is read.

After the free tier, chapter 04 is 1.29 and the Web Function lines are 2.37 and 3.59. Event Functions have a monthly allowance of a million requests and 400,000 GB-seconds. Whether Web Functions have one could not be confirmed. The examples on the pricing page say only that they exclude the free tier, without stating one. This chapter calculates as if there were none.

Taking compute alone, the line is clear. An Event Function is billed on its memory setting times its duration. A Web Function is billed on the time the CPU was in use. One vCPU-second costs about 2.4 times one GB-second, so Web Function compute is cheaper when the share of the duration spent on the CPU is below these values.

- About 10%, against an Event Function with 256 MB
- About 41%, against an Event Function with 1 GB
- About 83%, against an Event Function with 2 GB

The longer a request waits for a database or another API, the better a Web Function fits. A light function that gets by on 256 MB, like chapter 04's, stays cheaper in compute as an Event Function unless nine tenths of its time is waiting. Bear in mind that an Event Function with 256 MB gets a fraction of one vCPU, and a Web Function environment has two. The same work does not take the same time, so this comparison is a guide.

Look at the ceiling too. This stack's brakes are a `rateLimit` of 100 and `maxEnvironments` of 2. If 100 requests a second arrived for a whole month and both environments used their 2 vCPUs and 2 GB fully, requests would be 78.84, CPU time 338.93, and memory 44.87, for a total of 462.64. Logs and data transfer are not included. The brakes make the ceiling of the bill smaller. They do not make it zero. A budget alert ([chapter 01](/en/chapters/01-account.md)) is still needed.

## Pitfalls

<!-- section: 69.pitfalls -->

**Active does not mean running.** The states of a revision and an endpoint say that Lambda prepared the resource. Whether the server starts is unknown until the first request. Always send a request after a deploy.

**A new revision inherits nothing.** Forget the environment variables when creating a revision through the API or the CLI, and you get a revision without them. This chapter's stack writes every setting each time, so it does not happen here, but the same care applies when you change something in the console or with `aws lambda-web`.

**Deleting a version of the S3 object breaks a revision.** Delete the version a revision points at and the revision becomes Failed for good. Lambda does not move requests away from a Failed revision either. What the endpoint routes to it gets a 409. Before adding a lifecycle rule that removes old versions from the bucket, think of the revision you would roll back to.

**Revisions beyond about 50 are deleted, oldest first.** This applies to revisions no endpoint uses. In this chapter's stack CloudFormation deletes an unused revision first, so you will hardly meet this cleanup.

**A refused request gets a 429 at once, without waiting.** That is so both past the `rateLimit` and when every environment is full. The caller retries with growing intervals, and only operations whose result is the same when handled twice ([chapter 08](/en/chapters/08-async.md)). A 503 without `lambda-web-error-type` is retried the same way.

**`maxEnvironments` can be exceeded for a while.** The documentation says that during weight changes and Lambda's internal replacement of environments, Lambda may run more environments than the cap, putting availability first.

**Notes are separate in each execution environment.** As in chapter 04, there are as many in-memory `Map`s as environments. While two revisions share the traffic there are at least two. Replacing the `Map` with the table of [chapter 05](/en/chapters/05-dynamodb.md) removes the problem, and adds a permission to the execution role.

**Left alone, the log groups are created with no expiry.** If a revision names no log group, Lambda creates two log groups with default names at the first request, and sets no retention on either. That is why this stack creates the two beforehand.

**Only the last value of `X-Forwarded-For` can be trusted.** The values before it, and `X-Forwarded-Host`, arrive as the caller wrote them. With CloudFront in front, the last value is a CloudFront address.

**Changing weights outside CloudFormation is drift.** Move the endpoint's weights in the console or with the CLI, and the next deploy puts them back to the template's. In this chapter the weights move only through a deploy.

**A large upload is refused after its body has been read.** As [Design and Build](/en/chapters/69-web-functions/build.md) explained, a body with a declared length is read and discarded before the 413. The behaviour for a chunked body that passes the limit partway was not confirmed.

## Before production

<!-- section: 69.production -->

This stack is a practice API that only callers able to sign can use. Here is what production adds, in order.

To call it from a browser, change the shape of the way in. An `IamAuth` endpoint is not something a browser user calls directly. Put CloudFront in front and let origin access control make CloudFront sign, and users call CloudFront unsigned while the endpoint goes on refusing unsigned requests. The custom domain, AWS WAF, and the cache attach to CloudFront as well. Do not forward the user's `Host` header to the origin. Lambda picks the endpoint by `Host`, and the answer would be a 404. Users are authenticated by the app, which verifies a token in the `Authorization` header as in [chapter 06](/en/chapters/06-auth.md). Lambda passes an `Authorization` header that is not an AWS signature on to the server as it is.

An `ApplicationManaged` endpoint stays callable by anyone at its own domain name, with or without CloudFront in front. An organization that uses Web Functions can write a policy with the condition key `lambda:Request/WebFunctionAuthType` so that `ApplicationManaged` endpoints cannot be created.

Decide when to go back before you move to a new revision. Decide which metric, past which value, for how many minutes, and make sure the `release` field of the logs lets you count 5xx responses per revision. Put alarms on `HTTPResponseStatusClass5XX` in `AWS/Lambda/Web` in the home Region and on the throttling metrics in `AWS/Lambda/Web/Usage`. Both kinds have no data point for a period in which the value is zero, so the alarm treats missing data as nothing wrong ([chapter 19](/en/chapters/19-observability.md)).

Set `maxEnvironments` and `rateLimit` from measurements. The values in this chapter are the lowest an endpoint accepts. With a database behind the server, keep the number of environments times the pool size within the database's connection limit. With work that uses the CPU, lower `maxConcurrencyPerEnvironment`.

To reach resources inside a VPC, create an egress network connector. A revision that uses a connector can be served only from an endpoint in a single Region.

`MultiRegion` endpoints, which run in several Regions, are not covered in this chapter. Lambda replicates the code and configuration to each Region and sends a request to a Region with low latency, but it does not switch on seeing a Region fail. The question of which Region holds the data stays as it was in [chapter 28](/en/chapters/28-multi-region.md).

The deployment tool goes back to cdkd once cdkd supports Web Functions. cdkd's own documentation calls cdkd a tool for development and testing and recommends the AWS CDK CLI for production, so in production this chapter's path serves as it is.

## Cloudflare Workers and Vercel

<!-- section: 69.elsewhere -->

Code that takes HTTP directly, several requests at once in one unit of execution, billed on the time the CPU was used: Cloudflare Workers and Vercel's Fluid compute had this shape first. Here they are side by side, as far as their documentation was checked on 2026-10-13.

| | Lambda Web Functions | Cloudflare Workers | Vercel (Fluid compute) |
| --- | --- | --- | --- |
| Shape of the code | A Node.js server listening on a port | A `fetch` handler. A `node:http` server can be mounted too | An exported function, or a server listening on a port |
| One unit of execution | 2 vCPUs, 2 GB | An isolate, 128 MB | Depends on plan and settings |
| Time per request | Up to 900 seconds | Up to 5 minutes of CPU time. No limit on duration | 300 seconds by default, up to 800 on Pro |
| Price of requests | 0.30 per million | 0.30 per million | 0.60 per million (Pro) |
| Price of CPU (per hour) | 0.116 | 0.072 | 0.202 (Tokyo) |
| Price of memory (per GB-hour) | 0.0154, as used | None | 0.0167, as provisioned (Tokyo) |
| Monthly minimum | None | 5 (Workers Paid) | Depends on plan |

The CPU and memory rows are each provider's unit price converted to an hour. Workers Paid includes 10 million requests and 30 million milliseconds of CPU time a month, and Vercel's Hobby plan includes 4 hours of CPU time, 360 GB-hours of memory, and a million invocations. Workers charge nothing for duration or for data transfer.

On unit prices alone Workers are the cheapest, and they have no charge for memory. Workers can use `http.createServer` from compatibility date 2025-09-01 on, and a function from a `Request` to a `Response` like the chapter 04 app already has the shape of a Workers `fetch` handler. An API that fits in 128 MB and is written only with libraries that run on the Workers runtime can stay on Workers. What gives a reason to move to a Web Function is needing Node.js itself, 2 GB of memory, requests of up to 15 minutes, and being close to IAM and to resources inside a VPC.

Vercel's Fluid compute resembles a Web Function most. An Express app goes there with its `app.listen`, one instance handles several requests, and the bill is on CPU time, memory, and requests. If you leave everything from the framework's build to previews to Vercel, the price list gives no reason to move to AWS for the same shape. A reason to move is wanting to run in the same account, under the same IAM, and in the same VPC as your other AWS resources.

All three share this chapter's invariant. Cloudflare's documentation, too, says that one instance may handle several requests at the same time and tells you not to mutate global state. A per-request value in a module variable breaks wherever you take it.

## Cleanup

<!-- section: 69.cleanup -->

With no requests there is next to no charge, but the endpoint stays where the internet reaches it. Remove it when you are done.

```bash
vp run webfn:empty
vp run webfn:empty --yes
vp run webfn:cfn:destroy
```

The first line only counts the object versions in the code bucket. The second deletes all of them. A bucket with versioning enabled is not empty until every version and delete marker is gone, and CloudFormation cannot delete a bucket that is not empty. Revisions stop working the moment their versions are deleted, so do this only just before deleting the stack.

The third line removes the endpoint, the revisions, the Web Function, the log groups, the role, and the bucket. An endpoint's domain name is never used again once deleted. Deploy again and you get a different domain name.

Two things remain. The `CDKToolkit` stack that chapter 20's bootstrap created stays after this chapter's stack is gone. It is shared with chapter 20's stacks, so this chapter's tasks leave it alone. On your machine, `examples/69-web-functions/reports/webfn-outputs.json` and `dist/function.zip` remain. Neither is tracked by Git.

::: details Verification notes for this chapter

**Checked locally.** The unit tests (9 files, 68 tests). Two overlapping requests against a server listening on a real socket do not see each other's per-request state, and do with the version that keeps it in a module variable. Reading `AWS_LAMBDA_HTTP_ENDPOINT`, adopting the request ID Lambda assigned, the preflight, and answering 413 to an upload whose declared length is over the limit only after the whole body has arrived (removing the discard makes this test fail, which was checked too). Stopping after SIGTERM, both waiting for an open request and cutting it when time runs out. Writing a zip and reading it back, and a server that starts from an empty directory holding only the extracted archive and exits with code 0 within a second of SIGTERM. Release flags and weights, validation of the endpoint limits, the arguments handed to the CDK CLI, `x-amz-content-sha256` in the SigV4 signature, and the stack assertions. The type check. `webfn:demo`, `webfn:package`, and `webfn:cfn:synth` (with no release, with `-c stable=v1`, and with a canary).

**Not checked yet.** Nothing was run against AWS: none of `ship:cfn:bootstrap`, `webfn:cfn:deploy`, `webfn:upload`, `webfn:cfn:diff`, `webfn:smoke`, `webfn:empty`, `webfn:cfn:destroy`. So all of the following wait for a real deployment. That CloudFormation creates the three Web Function resource types from this template (the validation bundled with AWS CDK CLI 2.1145.0 warns that it does not know them). That the bundled `index.js` loads as an ES module on `nodejs24.x` and listens within 10 seconds. That the `IamAuth` endpoint refuses an unsigned request with a 403 and accepts this chapter's signature. That an object passed to `console` arrives as JSON. That SIGTERM is delivered. That adding a canary, promoting, and rolling back go through CloudFormation as this chapter describes, and in particular that on promotion the endpoint's weights are updated before the old revision is deleted. That deletion runs to the end when the bucket is emptied before the stack is deleted.

**Not confirmed from primary sources.** How long an execution environment stays after requests stop. Whether Web Functions have a free tier. The limit on the size of a request or response body. Whether CloudFormation waits for an endpoint update to complete (`updateStatus`). Whether Web Functions work with CodeDeploy. What isolates one execution environment from another. Of the encryption page only the overview was read, not the key policy procedures. Of the logging page, the sections on CloudWatch Logs features and on the system log schema were not read.

**How cdkd (0.296.28) handles the types.** `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::IAM::Role`, `AWS::IAM::Policy`, and `AWS::Logs::LogGroup` have a provider of their own in `src/provisioning/register-providers.ts`. `AWS::Lambda::WebFunction`, `AWS::Lambda::WebFunctionRevision`, and `AWS::Lambda::WebFunctionEndpoint` are not registered, and were not in the Cloud Control API's list of supported resources on 2026-10-13. The list was only read. The Cloud Control API was not called to check.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What a Web Function is | `examples/69-web-functions/src/index.ts` | `dev:webfn` |
| Starting the server, and stopping it | `examples/69-web-functions/src/listen.ts`, `src/serve.ts`, `src/index.ts`, `test/listen.test.ts`, `test/shutdown.test.ts` | `dev:webfn`, `webfn:demo`, `test:unit` |
| Several requests in one execution environment | `examples/69-web-functions/src/app.ts`, `test/server.test.ts`, `test/harness.ts`, `examples/35-lambda-managed-instances/src/scope.ts`, `src/audit.ts` | `webfn:demo`, `test:unit` |
| The rules of HTTP | `examples/69-web-functions/src/app.ts`, `src/log.ts`, `test/app.test.ts`, `test/server.test.ts` | `test:unit` |
| The stack | `examples/69-web-functions/infra/lib/web-functions-stack.ts`, `infra/bin/app.ts`, `infra/test/web-functions-stack.test.ts`, `src/names.ts`, `src/release.ts` | `webfn:cfn:synth`, `test:unit` |
| Run it locally | `examples/69-web-functions/scripts/demo.ts`, `scripts/build.ts`, `scripts/package.ts`, `src/zip.ts`, `test/package.test.ts`, `.env.example` | `dev:webfn`, `webfn:demo`, `webfn:package`, `webfn:cfn:synth` |
| Why CloudFormation and not cdkd | `examples/69-web-functions/scripts/cdk.ts`, `src/cdk-args.ts`, `test/cdk-args.test.ts`, `examples/20-shipping/src/cdk-args.ts` | `webfn:cfn:synth`, `webfn:cfn:diff`, `webfn:cfn:deploy` |
| The first deploy | `examples/69-web-functions/scripts/upload.ts`, `scripts/smoke.ts`, `src/sign.ts`, `test/sign.test.ts` | `webfn:upload`, `webfn:cfn:deploy`, `webfn:smoke` |
| Moving to a new revision | `examples/69-web-functions/src/release.ts`, `test/release.test.ts`, `infra/test/web-functions-stack.test.ts` | `webfn:cfn:diff`, `webfn:cfn:deploy`, `webfn:smoke` |
| Costs | `data/pricing/` | `test:unit` |
| Cleanup | `examples/69-web-functions/scripts/empty.ts` | `webfn:empty`, `webfn:cfn:destroy` |

**Primary sources** (all checked on 2026-10-13)

- Announcement: [AWS Lambda announces Lambda Web Functions](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/) (2026-10-12), [AWS News Blog](https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/)
- Lambda Developer Guide: [Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html), [Core concepts](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-how-it-works.html), [Creating](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-create.html), [Revisions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.html), [Deployment patterns](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-deployment.html), [Endpoints](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoints.html), [Code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html), [HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html), [Networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html), [Scaling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html), [Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html), [Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html), [Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html), [Request timeout](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-timeout.html), [Architecture](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-architecture.html), [Permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html), [Endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html), [Encryption](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-encryption.html), [Monitoring](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring.html), [Metrics](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring-metrics.html), [Logs](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html), [Samples](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-samples.html), [Best practices](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html), [Testing](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html), [Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-troubleshooting.html), [Quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- CloudFormation: [AWS::Lambda::WebFunction](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.html), [AWS::Lambda::WebFunctionRevision](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionrevision.html), [AWS::Lambda::WebFunctionEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionendpoint.html), [resources the Cloud Control API supports](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- Pricing: [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/), AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json) (the version published 2026-10-12). The unit prices for the HTTP API, Event Functions, CloudWatch Logs, and S3 are the ones read for chapter 04 and were not read again for this chapter
- Pinned packages and source: [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (`aws-lambda/lib/lambda.generated.d.ts`), [register-providers.ts of cdkd v0.296.28](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/src/provisioning/register-providers.ts), [@aws-sdk/client-lambda-web](https://www.npmjs.com/package/@aws-sdk/client-lambda-web) (3.1149.0 as installed, 3.1150.0 from the file list of its tarball), [the README of cdkd v0.296.28](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/README.md), the `--help` of AWS CDK CLI 2.1145.0
- Cloudflare: [node:http](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/), [Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Limits](https://developers.cloudflare.com/workers/platform/limits/), [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- Vercel: [Fluid compute](https://vercel.com/docs/fluid-compute), [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing), [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

:::
