---
title: "29 Lambda Tuning: Costs, Pitfalls, and Cleanup"
---

# 29 Lambda Tuning: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 29.cost -->

This page works out what each of the settings so far costs. Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax, and for Lambda only. The calculations are in the [pricing worksheets](/en/reference/pricing.md). API Gateway, DynamoDB and logs cost what chapters 04, 05 and 19 calculated and are not included here.

**Deployed with the defaults and never called, a month costs 0.** Reserved concurrency does not change that. **One unit of provisioned concurrency costs 2.83 a month even when nobody calls.** That is for 256 MB; it is proportional to memory and to the number. The free tier does not apply.

What you use costs this.

| Case | GB-seconds | List price | After the monthly free tier |
| --- | --- | --- | --- |
| 1,000,000 invocations a month, 256 MB, 50 ms each | 12,500 | 0.37 | 0 |
| The same number at 1,024 MB, still 50 ms | 50,000 | 0.87 | 0 |
| 256 MB, with 1% of them cold starts | 13,250 | 0.38 | 0 |
| Provisioned concurrency of 1, 256 MB, no invocations | 657,000 | 2.83 | 2.83 |

The 50 milliseconds are chapter 04's assumption. The third row assumes 10,000 cold starts with 300 milliseconds of initialization each. The 300 milliseconds are not a measurement.

The third row shows how small the charge for initialization is: under this assumption it adds 0.01 a month. A smaller bundle hardly changes the bill. What it changes is how long a user who hits a cold start waits.

The second row teaches the opposite. Four times the memory with no shorter duration is four times the duration charge. Memory is a setting you change after measuring.

<<< @/examples/29-lambda-tuning/src/plan.ts{items}

To do the same arithmetic with your own function's numbers, pass them as in `vp run tune:plan --memory 512 --ms 30 --requests 5000000`.

### If someone hammers it

This API has no authentication either; anyone who knows the URL can call it. The bounds are the same as in chapter 19: the stage throttle of 10 requests a second, the table's caps of 150 read request units and 40 write request units a second, and 100 notes at most. The whole bill for a month spent at those limits is in the table under [If someone hammers it](/en/chapters/19-observability/wrap.md) in chapter 19. Only the Lambda line changes in this chapter.

Chapter 19's table assumed 60 milliseconds per invocation at 256 MB and priced Lambda at 10.37. With the same assumption and 1,024 MB of memory it is 25.92. Raising the memory raises the ceiling under a flood by the same proportion.

Duration matters more. Suppose that during the flood DynamoDB stops answering and every invocation runs to the function's 10-second timeout. Ten a second for 30 days is 25,920,000 invocations, and even at 256 MB that comes to 869.19. Concurrency reaches 100.

This is where reserved concurrency counts. With 5 reserved, the environments stop at five, and requests beyond them are refused without running the function. Five environments running without a pause for 30 days cost 43.46.

Both amounts are ceilings computed from assumptions, not checked against a bill. In practice this chapter's function gives up before 10 seconds, through the SDK's timeouts and the 9-second deadline. The arithmetic still shows that timeouts and a ceiling on concurrency are about the bill as much as about response time. Add `-c reservedConcurrency=5` before you tell anyone the URL, or when the stack is going to stay up for more than a few days. In an account that cannot reserve, a short timeout is the brake you have.

Deleting the stack stops this chapter's charges.

## Coming from Workers

<!-- section: 29.workers -->

About half of this chapter does not apply to Cloudflare Workers, because the unit that runs your code is different. Workers creates an isolate inside a runtime that is already running and runs the code there. That is a different way of starting from Lambda, which creates and initializes an execution environment per function. Side by side (the Cloudflare side as read in its documentation on 2026-10-13):

| | Cloudflare Workers | Lambda (this chapter) |
| --- | --- | --- |
| Unit of execution | An isolate, created inside a running runtime | An execution environment, created and initialized per function |
| Requests one unit handles at once | Several, concurrently in one event loop | One |
| Starting | The documentation says there are no cold starts of the virtual machine kind | Waits for initialization when no environment is free |
| Limit on start-up code | Top-level code must finish within 1 second; checked at deployment | The Init phase may take up to 10 seconds |
| Memory | 128 MB per isolate, not selectable | 128 MB to 10,240 MB; CPU follows it |
| Size of the code | 64 MiB (before compression) | 250 MB (unpacked) |
| Charge for running time | CPU time used. Time spent waiting is not charged | Memory x elapsed time. Time spent waiting is charged too |
| A setting to keep things warm | None found on the pages read | Provisioned concurrency (billed by time) |

On Workers you do not choose memory, reserve concurrency, or buy warm environments. There is less to decide, and less that you can decide. For an API whose requests are short, use little CPU, and come from all over the world, staying on Workers is the straightforward choice. Because waiting is not charged, the bill is also easier to predict for work that spends a long time waiting on an outside API.

Lambda is the choice when the work does not fit in that frame: it needs more than 128 MB of memory, or one request uses more than 5 minutes of CPU. In exchange you hold the settings this chapter went through.

Some of it is shared. The Workers documentation also says that a large bundle affects start-up time and that heavy initialization at the top level exceeds the 1-second limit. A smaller bundle and lighter top-level code help on both platforms.

Vercel's Functions use a model called Fluid compute, in which one instance handles several invocations at once. Its documentation says that it is on by default for projects created since April 23, 2025, and that cold starts are reduced by bytecode caching and by pre-warming on production deployments (as of 2026-10-13).

Lambda also has a mode in which one execution environment processes several requests concurrently (Lambda Managed Instances). Its lifecycle and billing are different, and this chapter does not cover it.

## Where it goes wrong

| When this happens | Look here |
| --- | --- |
| The bundle budget test fails | Find the package that grew in the breakdown of `vp run tune:bundle`. Check that nothing imports a client class with every operation, and that `mainFields` is still set |
| After a deploy, every invocation is an error | Initialization is failing. Look at `vp run tune:report` and at `platform.initReport` in the log. Use the bundle tests to check whether a dependency stopped loading when `module` is followed first |
| `Init Duration` is not in the REPORT | That invocation was not a cold start. With provisioned concurrency, initialization appears in `platform.initReport` instead |
| More memory did not make it faster | It is waiting for an answer from DynamoDB or another service, not for the CPU. Put the memory back |
| Only the one request right after a timeout is slow | The environment was reset and is initializing again. This is not reported on a line of its own |
| A 500 comes back and the log has `AbortError` | The handler's deadline. The stack trace says what it was waiting for. If DynamoDB was throttling, look at the caps of chapters 05 and 19 |
| There is a REPORT with `Status: timeout` and no application log | The function timeout came before the deadline. Check that waits that do not go through the SDK, such as a `fetch` of your own, are given the signal |
| A deploy with `-c reservedConcurrency=5` is refused | The account's concurrency limit is low. Check with `aws lambda get-account-settings`, and deploy without the option |
| Provisioned concurrency is on and cold starts did not go down | Check that the calls go through the alias and do not exceed the number. The excess shows in `ProvisionedConcurrencySpilloverInvocations` |
| A 429 comes back | The stage throttle (10 a second, burst 20). When Lambda does the throttling, `Throttles` goes up, but what status API Gateway returns then was not confirmed |

## Before production

- Take the numbers before changing anything. This chapter's values (256 MB, 10 seconds, the 1-second margin, the SDK's 1 and 2 seconds, the 400,000-byte budget) are all practice values. Watch the REPORTs and `Latency` at the entrance for a week or two first
- Watch cold starts. Look regularly at the share of REPORTs with an `Init Duration`, and at its p95. If the share jumps, either more requests are arriving at once or the duration has grown
- Put alarms on concurrency: before `ConcurrentExecutions` nears the limit, and when `Throttles` stops being 0 ([chapter 19](/en/chapters/19-observability.md))
- Check the account's limit before you need it. Raising it is a request through Service Quotas. Quotas as a whole are in [chapter 32](/en/chapters/32-limits.md)
- Decide a reserved concurrency for each function, so that one runaway function does not take the other functions in the Region down with it
- Add provisioned concurrency only after measuring the hours and the number you need. If you add it, review the number against `ProvisionedConcurrencySpilloverInvocations` and its utilization
- Roll out changes of settings gradually. A change of memory or of the bundle breaks things the way a change of code does ([chapter 31](/en/chapters/31-progressive-delivery.md))
- Decide how you will read a minified stack trace: ship source maps, or bundle the same commit again locally and compare. Decide before the incident
- Deploy through the AWS CDK CLI and CloudFormation, for the reasons given in chapter 02

## Cleanup

<!-- section: 29.cleanup -->

```bash
vp run tune:infra:destroy
```

The table, the function, the API and the log group are deleted. If provisioned concurrency was on, the version and the alias go too, and the hourly charge stops. The notes and the logs are deleted with them.

`examples/29-lambda-tuning/dist/`, written by `vp run tune:bundle`, stays on your machine. Git does not track it, and you can delete it.

Nothing else remains except the storage created by cdkd's bootstrap (chapter 02).

## Seen as a distributed system

To the function's code an execution environment looks like one machine, but the code decides neither how many there are nor when one disappears.

- Owner of the state: the table holds the notes. An environment holds only what can be made again when lost: clients, connections, loaded code. Keep state in an environment and it disagrees with itself the moment two exist
- Invariant: a request that reaches its deadline ends before the function timeout, with an error in the usual shape that carries a request ID. Another request's deadline does not affect it
- Tests that try to break the invariant: against a table that does not answer, they check that without a deadline the request never ends, that with one a 500 and a log line appear, and that with two requests running, one's deadline does not stop the other
- Partial failure: a write stopped by the deadline has not necessarily failed to arrive. If it arrived and only the answer was late, the user is told it failed and the table has it. The SDK's retry can also send the same write twice. Making a retry by the user harmless is the job of chapter 05's conditional writes and chapter 08's idempotency
- A shared limit: the concurrency limit is shared by every function in the Region. When one function slows down and uses up the environments, unrelated functions are throttled. Reserved concurrency is the partition that stops that
- Uneven delay: a cold start does not show in the average; it shows in a few requests. Judge by the average and you will not see it

::: details Verification notes for this chapter

**Checked locally.** Unit tests for reading REPORT lines and `platform.report` (using the lines printed in the documentation), billed duration and GB-seconds, the concurrency model, the order of the timeouts, the deadline against a table that does not answer, and the infrastructure assertions. Type checking. Synth, including the esbuild bundle. With `tune:bundle`, the bytes of five bundles, their breakdown, and the load time on a Mac. That the deployed bundle loads in plain Node.js 24, answers `/health`, and sends a `GetItem` to a stand-in for DynamoDB and returns 404. That the bundle CDK builds has the same number of bytes as the one measured. The output of `tune:plan` and `tune:report:sample`. The argument names the scripts and the text use, in the AWS CLI's help for `logs filter-log-events` and `lambda get-provisioned-concurrency-config`.

**Not checked yet.** `tune:infra:deploy`, `tune:smoke`, `tune:report`, `tune:infra:drift` and `tune:infra:destroy` have not been run against real AWS. In particular, the following points were only read from documentation or computed.

- Every time on Lambda. The chapter has no measured value for initialization time, the share of cold starts, duration at another memory setting, or the effect of a smaller bundle
- That `platform.report` in the JSON log format reaches CloudWatch Logs in the documented shape, and that `scripts/report.ts` can read the output of `aws logs filter-log-events`
- That the bundle built with `mainFields` set to `module`, `main` and minified runs on Lambda's Node.js 24 runtime
- That the handler's deadline stops the SDK call on Lambda and leaves a 500 and a log line. The status API Gateway returns when the function times out or is throttled by Lambda. What a function does, and is billed for, after API Gateway stops waiting
- Deploys with `-c reservedConcurrency` and `-c provisionedConcurrency`. When a new account refuses a reservation, how long preparing provisioned concurrency takes, and whether cdkd can create, update and delete `AWS::Lambda::Version` and `AWS::Lambda::Alias` through Cloud Control API
- Whether `Init Duration` in the REPORT includes downloading the code and starting the environment
- The amounts under "If someone hammers it". They are computed from unit prices and assumptions, not checked against a bill
- AWS Lambda Power Tuning. Only its README was read; it was not deployed

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture | `examples/29-lambda-tuning/src/lambda.ts`, `infra/lib/tuning-stack.ts` | `tune:infra:synth` |
| Reading the REPORT line | `examples/29-lambda-tuning/src/report.ts`, `test/report.test.ts`, `fixtures/report-lines.txt`, `scripts/report.ts` | `test:unit`, `tune:report:sample` |
| When tuning is not needed | `examples/29-lambda-tuning/src/cost-inputs.ts` | `tune:plan` |
| Making the bundle smaller | `examples/29-lambda-tuning/src/bundle/`, `measure/aggregated.ts`, `test/bundle.test.ts`, `scripts/bundle.ts`, `infra/lib/tuning-stack.ts` | `test:unit`, `tune:bundle` |
| What goes outside the handler | `examples/29-lambda-tuning/src/lambda.ts`, `src/compose.ts`, `test/deadline.test.ts` | `test:unit` |
| Choosing the memory | `examples/29-lambda-tuning/src/cost-inputs.ts`, `src/plan.ts`, `scripts/plan.ts`, `test/cost-inputs.test.ts`, `test/plan.test.ts` | `test:unit`, `tune:plan` |
| Concurrency | `examples/29-lambda-tuning/src/concurrency.ts`, `test/concurrency.test.ts`, `infra/lib/tuning-stack.ts`, `infra/bin/app.ts`, `infra/test/tuning-stack.test.ts` | `test:unit`, `tune:infra:synth` |
| Timeouts in order | `examples/29-lambda-tuning/src/timeouts.ts`, `src/deadline.ts`, `src/lambda.ts`, `test/timeouts.test.ts`, `test/deadline.test.ts` | `test:unit` |
| Layers and extensions | `examples/29-lambda-tuning/infra/lib/tuning-stack.ts` | |
| Measuring locally | `examples/29-lambda-tuning/scripts/bundle.ts`, `scripts/plan.ts`, `scripts/report.ts`, `src/bundle/measure.ts` | `tune:bundle`, `tune:plan`, `tune:report:sample`, `test:unit` |
| Deploying and measuring | `examples/29-lambda-tuning/infra/bin/app.ts`, `scripts/smoke.ts`, `scripts/report.ts` | `tune:infra:diff`, `tune:infra:deploy`, `tune:smoke`, `tune:report`, `tune:infra:drift` |
| Cost | `examples/29-lambda-tuning/src/cost-inputs.ts`, `src/plan.ts`, `test/cost-inputs.test.ts`, `data/pricing/` | `test:unit`, `tune:plan` |
| Cleanup | `tools/src/infra/` | `tune:infra:destroy` |

**How cdkd (0.296.28) handles it.** Types with a dedicated implementation in `src/provisioning/register-providers.ts`: `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::DynamoDB::Table`, `AWS::Logs::LogGroup`, `AWS::ApiGatewayV2::*`. The default stack stays within these. Types with none, which go through Cloud Control API: `AWS::Lambda::Version` and `AWS::Lambda::Alias`, which enter the stack only with `-c provisionedConcurrency`.

**Primary sources** (all checked on 2026-10-13)

- [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html), [Lambda scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html) (one paragraph of the concurrency page gives 500 as the amount a function can add in 10 seconds; the text follows the 1,000 of the scaling page and the quotas page)
- [Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html), [Configuring provisioned concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html), [Improving startup performance with Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)
- [Configure Lambda function memory](https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html), [Configure Lambda function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [Best practices for working with AWS Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Building Lambda functions with Node.js](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html), [Define Lambda function handler in Node.js](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html), [Deploy Node.js Lambda functions with .zip file archives](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
- [Lambda Telemetry API Event schema reference](https://docs.aws.amazon.com/lambda/latest/dg/telemetry-schema-reference.html), [Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html), [Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html), [Supported logs and discovered fields](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html) (the list of fields discovered in Lambda logs does not include `@initDuration`; the script reads the record itself and relies on no discovered field)
- [Managing Lambda dependencies with layers](https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html), [Augment Lambda functions using Lambda extensions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-extensions.html)
- [Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html), [Quotas for configuring and running an HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Reuse connections with keep-alive in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-reusing-connections.html), [@smithy/types 4.19.0](https://www.npmjs.com/package/@smithy/types/v/4.19.0) (`NodeHttpHandlerOptions` and `HttpHandlerOptions` in the type definitions installed with the SDK)
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/) (prices are filled in by script, so only how charges work and the free tier were read here), [AWS Lambda standardizes billing for INIT Phase](https://aws.amazon.com/blogs/compute/aws-lambda-standardizes-billing-for-init-phase/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json) (the offer published on 2026-10-09)
- [esbuild: Platform and Main fields](https://esbuild.github.io/api/#platform), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (the source of `aws-lambda-nodejs/lib/bundling.js`)
- [AWS Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning) (README only)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- [Cloudflare Workers: How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/), [Limits](https://developers.cloudflare.com/workers/platform/limits/), [Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Vercel: Fluid compute](https://vercel.com/docs/fluid-compute)

:::
