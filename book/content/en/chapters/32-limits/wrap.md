---
title: "32 Limits: Costs, Pitfalls, and Cleanup"
---

# 32 Limits: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 32.cost -->

This page looks at what the additions of this chapter cost. Amounts are in USD, on demand, before tax. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

**A month in which nobody calls the API costs 0.10 at list price and 0 after the free tier.** Only the one alarm costs anything, at 0.10 a month for each metric it refers to. Within CloudWatch's free tier (10 alarm metrics) that is 0, but the whole account shares that allowance.

Nothing else this chapter added is charged for. The documentation says reserved concurrency incurs no additional charge. The budget has a unit price of 0 in the Price List, and the pricing page says monitoring and notifications are free. The stage and route throttles, the request unit ceiling on the table and the tags are settings, not usage.

The API, Lambda, DynamoDB and the logs cost the same per request as in chapter 05. The amounts are in [chapter 05's cost section](/en/chapters/05-dynamodb/wrap.md). The arithmetic for traffic pinned against the limits carries over as well, from chapter 05 and [chapter 19](/en/chapters/19-observability/wrap.md), because the entrance has the same 10 requests a second. The only difference is that the route that creates notes stops at 2 a second.

Looking at cost has a cost too. `vp run limits:cost` is 0.01 a run, so once a day for 30 days is **0.30**. Built into a dashboard and called once a minute, the same arithmetic gives 432 a month. Cost Explorer's data is not refreshed anywhere near that often, so once a day is enough. How often it is refreshed was not checked for this chapter.

Deleting the stack stops the charge for the alarm.

## If you come from Workers or Vercel

<!-- section: 32.compare -->

Cloudflare and Vercel have limits too. What differs is how many there are and how they are decided. What follows was read in their official documentation on October 12, 2026.

| | Cloudflare Workers | Vercel | This chapter (AWS) |
| --- | --- | --- | --- |
| How limits are decided | By plan. Free allows 100,000 requests a day and answers with error 1027 past that. Paid has no daily limit | By plan (Hobby, Pro, Enterprise) | Quotas per service, per account, per Region |
| Requests per second | No general limit for Workers is stated | Not checked in this chapter | API Gateway 10,000 a second, Lambda concurrency 1,000 |
| Raising a limit | A limit increase request form | The account team on Enterprise, sales on Pro, a change of plan on Hobby | A request in Service Quotas. Small ones are approved automatically |
| A rate limit of your own | The Rate Limiting binding. Periods of 10 or 60 seconds, counted per Cloudflare location | Not checked in this chapter | The stage throttle, chapter 14's rate limiter, WAF from chapter 21 |
| A stop on overspending | Not checked in this chapter | Spend Management: at an amount you set, notifications, a webhook, and pausing production deployments | A budget only notifies. What stops spending is the limits you set |

What the Workers limits page lists are values per plan. With one place to look, most of the work in the first half of this chapter is not needed. For the Rate Limiting binding, the documentation says outright that the counting is not exact: it is permissive, eventually consistent, and not meant to be used as an accurate accounting system. It counts per location, so the same key gets a separate allowance at each one. That is the same kind of compromise as API Gateway's best-effort throttle.

Vercel's Spend Management does something an AWS budget does not: when the amount you set is reached, it can stop your production deployments. The documentation has cautions too. Setting an amount stops nothing by itself, and pausing has to be turned on. Usage is checked every few minutes, so spending can run a few minutes past the amount before the pause. A paused project answers 503, and each one is resumed by hand.

AWS Budgets has an item on its pricing page called action-enabled budgets. What they can do was not read for this chapter.

If the limits are few and your plan covers what you need, staying where you are is the easier life. What AWS gives you is the ability to set limits yourself, service by service, and to ask for more. In return you have to know where each limit is. This chapter's table is a place to start.

Retries, backoff, jitter and budgets are the same on any platform. `sendWithRetry` from [Design and Build](/en/chapters/32-limits/build.md) works unchanged in a Worker that calls an outside API. It uses nothing but `fetch` and `Response`.

## Where people trip

| When this happens | Look here |
| --- | --- |
| A deploy with `-c reservedConcurrency` is refused | The account's concurrency quota. You can reserve up to the quota minus 100. See the value with `vp run limits:quotas --service lambda` |
| A 429 comes back and you cannot tell which limit it is | With `retry-after`, it is the limit per caller. Without, it is probably the stage throttle. That API Gateway sends no `Retry-After`, however, has not been confirmed |
| `POST /notes` gets 429s sooner than the other routes | The throttle on that route (2 a second, burst 4) |
| A 500 comes back and the log has `ProvisionedThroughputExceededException` or `ThrottlingException` | The table's ceiling. The SDK tried three times and gave up. Review `TABLE_CAP` and the traffic |
| Adding retries made an outage worse | There is no jitter, or no budget, or several layers each retry. Decide on one layer that retries |
| The function times out | Do the SDK's waits between retries exceed the function's timeout? Setting `AWS_NEW_RETRIES_2026` doubles the base of the wait |
| Everything `limits:cost` prints is `(no tag)` | The tag key is not active. After activation it can take up to 24 hours |
| `project` is not on the `Cost allocation tags` page | It can take up to 24 hours after tagging. A member account of an organization cannot use this page |
| The budget's actual spend stays at 0 | The tag is not active, or the key in the filter is written the wrong way. Check the budget's filter in the console |
| `limits:load` stops with `refusing to send load` | By design. The only target is `http://localhost` |

## If you take this to production

- Check the quotas by working back from the traffic you expect. Put your own service's numbers (the time one request takes, the units it uses) into the arithmetic of [The first limit you reach](/en/chapters/32-limits/build.md). If a quota falls short, request an increase before you need it
- Change the numbers of the limits to your own service's. Ten a second, two a second, and 150 and 40 on the table are practice brakes
- Answer throttling by the table with a 503, not a 500. Chapter 05's application turns every exception into a 500, so a caller cannot tell whether waiting would help. Change the application to recognize a throttling exception and answer 503 with `retry-after`. This chapter does not change the application, so that is not implemented
- Decide on one layer that retries. If the browser, a BFF, the function and the SDK each try three times, 81 times the load reaches the bottom. This chapter's arrangement has two layers: the client in the browser and the SDK
- Make creation idempotent. `POST /notes` is safe to send again after a 429, but not after a timeout. If the caller sends chapter 08's idempotency key and the server uses it in a conditional write, a retry after a timeout is safe as well
- Put an alarm on quota utilization. Service Quotas has a feature that watches usage and notifies you. It is not set up in this chapter
- Agree on tags across the whole account. If the key is spelled `project` in one place and `Project` in another, the totals split the same way
- Load test a deployed system in an account separate from production. Quotas are per account, so a test can no longer use up production's share. The other account's quotas are not necessarily the same as production's, though
- Deploy through the AWS CDK CLI and CloudFormation, for the reason given in chapter 02

## Cleanup

<!-- section: 32.cleanup -->

```bash
vp run limits:infra:destroy
```

The table, the function, the API, the log group, the alarm and the budget are deleted. The notes and the logs go with them.

One thing does not go with the stack: the activation of the cost allocation tag. What you activated is a setting of the account, not a resource of the stack. If you no longer want it, deactivate it on the same page where you activated it. Any quota you requested an increase for also stays as it is, independent of the stack.

The only other thing left is the storage that cdkd's bootstrap created (chapter 02).

## Seen as a distributed system

Limits are the agreements the parts of a distributed system make so as not to break one another.

- Who owns the state: the side that refuses is the one counting what it has let through. API Gateway holds the stage's bucket, Lambda holds the concurrency, and DynamoDB holds the table's units. The caller learns it has reached a limit only by being refused
- The invariant: retries never raise what reaches the other side beyond a constant multiple of the first attempts. With a budget, retries during sustained failure stop at the budget's capacity
- The tests that try to break it: in the scene where the service refuses everything for 3 seconds, they check that without a budget the load passes 2.9 times, and that with one it stops at the first attempts plus 100
- Duplicates: a retry after a 429 creates no duplicate. A retry after a timeout or a 5xx can. This chapter's client does not resend a method that cannot be repeated after a 5xx
- How exact the counting is: API Gateway's throttle is best-effort and can let through more than the setting. Choose limits on the assumption that the system can stand a little more than they say
- Time: budgets and buckets recover with the clock. The bucket's tests check that a clock stepping back does not break it

::: details Verification notes for this chapter

**Checked locally.** The token bucket, backoff and jitter, the retry budget, the retrying client, the two simulations, the development server's two limits, the first-limit arithmetic, the load target check and summary, reading a Cost Explorer response, and the stack assertions (12 files, 91 tests). That the installed SDK makes three attempts when answered with throttling (against a fake `requestHandler`). Type checking. Synth, including the esbuild bundle. The output of `vp run limits:simulate`. `dev:limits` started and `limits:load` run with two settings (the tables in the chapter are that output, with only the port number rewritten). That `limits:load` refuses `https://example.com`. The output of `limits:cost:print` and `limits:quotas:book`. The argument names the scripts use, against the help of `service-quotas list-service-quotas` and `ce get-cost-and-usage` in AWS CLI 2.35.11.

**Not checked yet.** `limits:infra:deploy`, `limits:quotas`, `limits:cost`, `limits:infra:drift` and `limits:infra:destroy` have not been run against real AWS. The following in particular were only read from documentation and source.

- The body of the 429 an HTTP API returns, and whether it carries a `Retry-After` header. The local stand-in answers `{"message":"Too Many Requests"}` with no such header
- That cdkd 0.296.28 applies the per-route throttle (`RouteSettings` for `POST /notes`) and the `DependsOn`. The assumption that creating the stage before its route fails was not checked either
- The status an HTTP API returns to the caller when Lambda refuses the function
- The name of the exception when the real DynamoDB throttles at a table's ceiling, and how the SDK's retries go. The fake in the test returns `ProvisionedThroughputExceededException`; the documentation says that at the ceiling of an on-demand table a `ThrottlingException` can be returned. The SDK treats both as throttling
- The budget filtered by tag: that cdkd can create it, whether the key is written `project` or `user:project`, and whether a budget created before activation starts counting afterwards
- Which of this stack's charges carry the `project` tag
- What concurrency a new account really starts with
- How long a quota increase request takes
- Whether a load test sent from outside AWS to your own API needs notice or has a threshold. The two policy pages do not say
- Whether API Gateway charges for requests it refused with a 429
- How often Cost Explorer's data is refreshed
- The Amazon Builders' Library article and Cloudflare's limits page were read through a summary of each page. "Selfish", "243 times" and "1027" in the chapter are from those summaries. In the Architecture Blog article on jitter the formulas are inside images and were not read. The formula in the chapter is the one in the SDK reference guide and the installed package

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/32-limits/infra/lib/limits-stack.ts` | `limits:infra:synth` |
| Quotas | `examples/32-limits/src/quotas.ts`, `test/quotas.test.ts`, `scripts/quotas.ts` | `test:unit`, `limits:quotas:book`, `limits:quotas` |
| How the refusing side counts | `examples/32-limits/src/token-bucket.ts`, `src/throttle.ts`, `test/token-bucket.test.ts`, `test/throttle.test.ts` | `test:unit` |
| How the refused side waits | `examples/32-limits/src/retry.ts`, `src/backoff.ts`, `test/retry.test.ts`, `test/backoff.test.ts` | `test:unit` |
| How retries make an outage worse | `examples/32-limits/src/simulation.ts`, `src/random.ts`, `src/retry-budget.ts`, `test/simulation.test.ts`, `test/retry-budget.test.ts`, `scripts/simulate.ts` | `test:unit`, `limits:simulate` |
| The SDK's retries | `examples/32-limits/src/sdk-retry.ts`, `src/compose.ts`, `test/sdk-retry.test.ts` | `test:unit` |
| Brakes you set yourself | `examples/32-limits/infra/lib/limits-stack.ts`, `infra/test/limits-stack.test.ts`, `src/lambda.ts` | `test:unit`, `limits:infra:synth` |
| The first limit you reach | `examples/32-limits/src/ceilings.ts`, `test/ceilings.test.ts` | `test:unit` |
| Run it locally | `examples/32-limits/src/dev.ts`, `src/throttle.ts`, `.env.example` | `dev:limits`, `test:unit` |
| Put load on it locally | `examples/32-limits/src/load.ts`, `test/load.test.ts`, `scripts/load.ts` | `limits:load`, `test:unit` |
| Deploy and check | `examples/32-limits/infra/bin/app.ts`, `scripts/quotas.ts` | `limits:infra:diff`, `limits:infra:deploy`, `limits:quotas`, `limits:infra:drift` |
| Split cost by tag | `examples/32-limits/src/cost.ts`, `test/cost.test.ts`, `scripts/cost.ts` | `test:unit`, `limits:cost:print`, `limits:cost` |
| Cleanup | `tools/src/infra/` | `limits:infra:destroy` |

**How cdkd (0.296.28) handles the types.** With a dedicated implementation in `src/provisioning/register-providers.ts`: `AWS::ApiGatewayV2::Api`, `AWS::ApiGatewayV2::Integration`, `AWS::ApiGatewayV2::Route`, `AWS::ApiGatewayV2::Stage`, `AWS::Budgets::Budget`, `AWS::CloudWatch::Alarm`, `AWS::DynamoDB::Table`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`. No type in this stack goes through the Cloud Control API.

**Primary sources** (checked on 2026-10-12 unless noted)

- [What is Service Quotas?](https://docs.aws.amazon.com/servicequotas/latest/userguide/intro.html), [Requesting a quota increase](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html), [Lambda scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html)
- [Throttle requests to your HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html), [Quotas for configuring and running an HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html), [Amazon API Gateway quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html), [Usage plans and API keys for REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)
- [Quotas in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html), [Error handling with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html)
- [Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html) (AWS SDKs and Tools Reference Guide), [@smithy/util-retry 4.6.2](https://www.npmjs.com/package/@smithy/util-retry/v/4.6.2) (read in the installed package: `@smithy/core/dist-es/submodules/retry` and the `runtimeConfig.js` of `@aws-sdk/client-dynamodb`; 2026-10-13)
- [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) (Amazon Builders' Library), [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Amazon EC2 Testing Policy](https://aws.amazon.com/ec2/testing/), [AWS Customer Support Policy for Penetration Testing](https://aws.amazon.com/security/penetration-testing/)
- [Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html), [Activating user-defined cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html), [Using user-defined cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/custom-tags.html) (the last one on 2026-10-13)
- [GetCostAndUsage](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html), [AWS Cost Explorer pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/), [AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [AWS::Budgets::Budget BudgetData](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-budgetdata.html) (the last one on 2026-10-13)
- AWS Price List bulk API: [Cost Explorer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCostExplorer/current/index.json), [Budgets](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBudgets/current/index.json) (2026-10-13)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) (2026-10-13)
- [Cloudflare Workers: Limits](https://developers.cloudflare.com/workers/platform/limits/), [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Vercel: Limits](https://vercel.com/docs/limits), [Spend Management](https://vercel.com/docs/spend-management)

:::
