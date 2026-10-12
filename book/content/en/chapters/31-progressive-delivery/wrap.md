---
title: "31 Progressive Delivery: Costs, Pitfalls, and Cleanup"
---

# 31 Progressive Delivery: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers how this differs from Cloudflare Workers and Vercel, the cost, where you are likely to get stuck, what to add for production, and cleanup, and ends with what was and was not verified.

## Coming from Workers or Vercel

<!-- section: 31.compare -->

Both Cloudflare Workers and Vercel can split traffic by percentage. Both sets of documentation were read on 2026-10-13.

| | Cloudflare Workers | Vercel | This chapter |
| --- | --- | --- | --- |
| Splitting by percentage | Gradual deployments. `wrangler versions deploy` splits traffic between two versions | Rolling Releases. You set the percentage of each stage, the last being 100% | The weight of a Lambda alias, moved by your own script or by CodeDeploy |
| Unit of the split | Per request by default. Version affinity can pin a user | Per device. The assignment is kept in a cookie | Per request. There is no way to pin |
| Going back | The documentation describes going back to an earlier version by hand | Abort by hand, or Instant Rollback | Goes back by itself when an alarm fires |
| Page and API out of step | Version affinity | Skew Protection pins API calls to the deployment that served the page | No mechanism. Both versions must be able to answer both pages |
| Flags | Flagship, evaluated through a Worker binding or the OpenFeature SDKs | Vercel Flags, or a provider from the Marketplace | AppConfig, with an extension running beside the function |

Workers and Vercel take far fewer steps. On Workers, one command puts percentages on two versions. On Vercel, once the stages are set in the project settings, promoting to production is gradual from then on. What this chapter wrote as a script, alarms, and the placing of an alias is inside the platform on both.

Vercel's Skew Protection has no counterpart in this chapter. It prevents a browser that still has an old page open from calling a new version of the API, by pinning requests to the deployment that served the page. With chapter 03's SPA and this chapter's API, you solve that problem yourself. The only way is to change the API in a form that still answers calls from the old page.

There are conditions on who can use what. According to Vercel's documentation, Rolling Releases and Skew Protection are available on the Pro and Enterprise plans, and Pro can use Rolling Releases for one project. For Cloudflare's Flagship, the pages read stated neither a release stage (beta or not) nor a price.

What this chapter's way gives you is the stopping condition as your own decision. You choose which metric, at what threshold, watched for how many minutes, and the same alarms stop both the code shift and the flag deployment. For Workers and Vercel, the pages read did not describe going back automatically on an error rate. Whether to advance or go back is decided by a person looking at the metrics on a screen, or by something you build to call their API.

If you already run on Workers or Vercel and only want gradual shifts, this is no reason to move. This chapter is useful when the application is already on AWS and you want the same thing on Lambda or ECS.

## Cost

<!-- section: 31.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The calculations are in the [pricing worksheets](/en/reference/pricing.md). API Gateway, Lambda, and logs cost what they do in chapter 04, so this section covers only what this chapter adds.

Deployed and left for a month without a single call, what costs money is the two alarms. A standard-resolution alarm is 0.10 a month, so the list price is **0.20 a month**. CloudWatch has a free allowance of ten alarms, so in an account with no other alarms this is 0. The alias, the versions, and the AppConfig application and configuration profile cost nothing for existing.

Once it is called, AppConfig's charges are added. There are two kinds (AWS Price List, read on 2026-10-13).

- 0.0000002 per configuration request. That is one check of AppConfig by the extension, every 45 seconds
- 0.0008 each time a configuration is received

The second is the one that matters. One receipt at 0.0008 costs the same as 4,000 Lambda requests. The AppConfig documentation notes that costs go up with many cold starts and with frequently receiving new configuration. That reads as the extension receiving the configuration once for each new execution environment, but it has not been checked against a bill.

Assuming one execution environment that runs for the whole month and 1,000 configurations received, cold starts and flag deployments together, the list price is **1.01 a month**: 0.20 for the alarms, 0.01 for 58,400 requests, and 0.80 for 1,000 receipts. With the alarm allowance taken off it is 0.81. No free allowance for AppConfig could be confirmed, so none is taken off.

This number is close to proportional to the number of cold starts. For a function whose concurrency swings widely, receipts grow by orders of magnitude. Count the cold starts in a month from [chapter 19](/en/chapters/19-observability.md)'s logs before you estimate.

The ceiling under a flood of requests is the same as in chapter 04. This chapter's API is also stopped by the stage's throttling at 10 requests a second (burst 20). The ceiling for API Gateway, Lambda, and logs is the calculation on [chapter 04's cost page](/en/chapters/04-http-api/wrap.md), unchanged. AppConfig requests are at most one per 45 seconds per execution environment, so they do not grow in proportion to requests. Receipts depend on how many execution environments are created, and this chapter puts no bound on that.

What CodeDeploy would cost could not be confirmed. An ECS canary or blue/green deployment runs up to double the tasks during the shift and the bake time, and Fargate charges for them at chapter 12's rates.

## Where you are likely to get stuck

The table below is not a list of problems met while running this. It collects the places where the documentation and the code suggest you could get stuck.

| If this happens | Look here |
| --- | --- |
| You deployed and the behaviour did not change | By design. The new code is in `$LATEST`. Shift to it with `vp run rollout:start --apply` |
| `rollout:start` declines with `already in ALARM` | An alarm is firing. If the cause was the previous shift, wait a minute or two after the 500s have stopped |
| `rollout:start` declines with `another shift is in progress` | The alias gives weight to a different version. Check with `vp run rollout:status`, and remove it with `rollout:rollback --apply` if it is not wanted |
| The outcome is `abandoned` | Someone else changed the alias during the shift. The script overwrote nothing. Look at the current state with `rollout:status`, and let a person decide |
| It went back with `no alarm reading` | The alarms could not be read, or stayed in `INSUFFICIENT_DATA`, for longer than `--max-blind` seconds. Check that whoever runs the script has `cloudwatch:DescribeAlarms`, and that the alarms have not been deleted |
| The shift completed and the new version is broken | There may have been too few requests for the alarms to have anything to go on. Look at the last two lines of `rollout:plan`, and lengthen the step or run `rollout:probe` during the shift |
| The `flags:` line of `rollout:probe` stays at `defaults` | No flags were ever handed out, or the function cannot read the configuration. Look at `vp run flags:status`, the `flags` lines in the function's log group, and the extension's own log lines |
| A flag change is slow to show | The handing-out time (five minutes) plus the extension's check interval (45 seconds) |
| 4xx went up and the shift did not stop | The alarms watch only `5xx` and function errors. A new version that wrongly rejects valid requests with 400 is not caught by these two |
| `rollout:infra:destroy` fails on the configuration profile | Stored versions may still be there. Run `vp run flags:clear --apply` first |

## For production

- Run the shift somewhere that does not disappear partway: a CI job instead of a terminal, or CloudFormation with CodeDeploy. Give the job a time limit longer than the plan's total
- Make the alarms rates, not counts. "One 500 a minute" fires all the time on a busy API. Use an error rate combined with a minimum number of requests, and add latency
- Compare the versions with each other. Lambda's metrics have a dimension, `ExecutedVersion`, for which version ran under an alias. This chapter's alarms watch the alias as a whole, so the failures of a new version at 10% are diluted by the 90% of healthy requests
- Choose the percentage and the time from the number of requests. Nothing justifies "10% for five minutes" by itself. Work out how many requests the new version receives in that time
- Separate who may move the alias. `lambda:UpdateAlias` and the permission to deploy AppConfig are permissions to change production behaviour. Think about them apart from chapter 20's deploy roles
- Give each flag an owner and an end date. A release flag is removed from both code and configuration once it is at 100%. This chapter's tests fail when it is removed from only one
- Do not make a flag out of a switch that must hold. What cannot be given a safe side to fall to when unreadable does not suit a flag
- Ship a deploy that changes the shape of data first, and separately. Do not let a canary write a shape the version you would return to cannot read
- Remove the practice headers. `x-app-version` and `x-flags-origin` show the inside to the outside

The whole list of what to review before production is in [chapter 33](/en/chapters/33-production-readiness.md).

## Cleanup

<!-- section: 31.cleanup -->

```bash
vp run flags:clear
vp run flags:clear --apply
vp run rollout:infra:destroy
```

`flags:clear` deletes every version stored in the configuration profile. `flags:deploy` made those versions, and they are not in cdkd's state. Whether a configuration profile with versions left in it can be deleted could not be told from the AppConfig API reference. Deleting them first works either way.

The versions `rollout:start` published are not in cdkd's state either. According to the Lambda API reference, deleting a function deletes all its versions and aliases. The function, the alias, the alarms, the AppConfig resources, the roles, and the log group go with the stack. Nothing should be left afterwards, and nothing should go on costing money. That has not been checked by running it.

Chapter 04's `AihHttpApi` and the stacks of chapters 12 and 20 are not changed by this chapter.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (the shift plan, decisions from alarm states, running a shift and replaying failures, checks on the flag definitions, the percentage rollout, the fallback when the source cannot be reached, the order of the calls to AppConfig, the application layer, two versions reading the same records, stack assertions, and the CodeDeploy and ECS canary templates). The type check. Synthesis with cdkd 0.296.28 (`rollout:infra:synth`). The output of `rollout:plan` and `flags:check`. On the local server: an edit to the flag file showing from the next request, a broken file leaving the previous values in use, and the tally of `rollout:probe`. All on macOS (Apple silicon).

**Not checked yet.** Nothing that touches AWS has been run: `rollout:infra:diff`, `rollout:infra:deploy`, `rollout:start`, `rollout:status`, `rollout:rollback`, `rollout:probe` (against the deployed API), `flags:deploy`, `flags:status`, `flags:stop`, `flags:clear`, `rollout:infra:drift`, `rollout:infra:destroy`. In particular, these wait for a real environment.

- That cdkd can create the alias, the version, and the four AppConfig types through the Cloud Control API, and that updating the stack leaves the alias alone
- How `UpdateAlias` really behaves: the name of the error when `RevisionId` does not match, and that an empty map removes the weights. The shape of the SDK responses is written from the API reference and the type definitions
- How a weighted alias really splits requests, and the value that ends up in `x-app-version`
- How long an alarm takes to reach `ALARM` during a shift, and how long the `INSUFFICIENT_DATA` right after creation lasts
- The extension's behaviour: its answer for a configuration that was never handed out, its answer when AppConfig cannot be reached right after a cold start, and whether a 500-millisecond deadline is enough
- That AppConfig's automatic rollback works with `cloudwatch:DescribeAlarms` limited to the alarms' ARNs
- What counts as one "configuration received" in AppConfig's pricing. The 1,000 assumed in the cost section depends on this reading
- Whether a configuration profile with stored versions can be deleted
- The ECS canary and the CodeDeploy setup. They were only synthesized and read in tests and are not in the deployed app. Whether the ECS circuit breaker acts under strategies other than the rolling update, and whether chapter 12's service can change strategy without being recreated, are unconfirmed too
- The price of CodeDeploy deployments to Lambda and ECS. Only the absence of a matching item in the Price List was confirmed
- Whether the Lambda extension supports pinning by `Entity-Id`. It is not used

**Not used.** CodeDeploy is not in the deployed stack, because the pinned cdkd does not handle `UpdatePolicy`. AppConfig's `Entity-Id` and multi-variant flags are not used, and the percentage arithmetic is in the application. No ECS service is created, because it is billed by the hour.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Why it is built this way | `examples/31-progressive-delivery/infra/lib/progressive-stack.ts`, `infra/test/progressive-stack.test.ts` | `test:unit` |
| Versions and the alias | `examples/31-progressive-delivery/infra/lib/progressive-stack.ts`, `infra/test/progressive-stack.test.ts` | `rollout:infra:synth`, `test:unit` |
| The plan of a shift | `examples/31-progressive-delivery/src/shift/plan.ts`, `test/plan.test.ts`, `scripts/rollout.ts` | `rollout:plan`, `test:unit` |
| Deciding from the alarms | `examples/31-progressive-delivery/src/shift/decide.ts`, `test/decide.test.ts` | `test:unit` |
| Running the shift | `examples/31-progressive-delivery/src/shift/run.ts`, `src/shift/aws.ts`, `test/run.test.ts`, `test/fakes.ts`, `scripts/rollout.ts` | `rollout:start`, `rollout:status`, `rollout:rollback`, `test:unit` |
| Leaving it to CodeDeploy | `examples/31-progressive-delivery/infra/lib/codedeploy-sketch.ts`, `infra/test/sketches.test.ts` | `test:unit` |
| Defining the flags | `examples/31-progressive-delivery/flags/flags.json`, `src/flags/document.ts`, `test/flags-document.test.ts` | `flags:check`, `test:unit` |
| Reading the flags | `examples/31-progressive-delivery/src/flags/evaluate.ts`, `test/flags-evaluate.test.ts` | `test:unit` |
| When AppConfig cannot be reached | `examples/31-progressive-delivery/src/flags/reader.ts`, `test/flags-reader.test.ts`, `test/app.test.ts` | `test:unit` |
| Building the flags into the application | `examples/31-progressive-delivery/src/app.ts`, `src/compose.ts`, `src/env.ts`, `src/lambda.ts`, `test/app.test.ts` | `dev:rollout`, `test:unit` |
| How flags are deployed | `examples/31-progressive-delivery/infra/lib/progressive-stack.ts`, `src/flags/appconfig.ts`, `scripts/flags.ts`, `test/flags-appconfig.test.ts` | `flags:deploy`, `flags:status`, `flags:stop` |
| Data both versions can read | `examples/31-progressive-delivery/test/versions.test.ts`, `examples/12-containers/src/compat.ts` | `test:unit` |
| Shifting an ECS service in steps | `examples/31-progressive-delivery/infra/lib/ecs-canary-sketch.ts`, `infra/test/sketches.test.ts` | `test:unit` |
| Running it locally | `examples/31-progressive-delivery/src/dev.ts`, `.env.example`, `src/probe.ts`, `scripts/probe.ts` | `dev:rollout`, `rollout:probe` |
| Deploying | `examples/31-progressive-delivery/infra/bin/app.ts` | `rollout:infra:diff`, `rollout:infra:deploy` |
| Cleanup | `examples/31-progressive-delivery/scripts/flags.ts` | `flags:clear`, `rollout:infra:destroy` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (read on 2026-10-12: Lambda aliases and metrics, the CodeDeploy configurations, and the AppConfig extension, flag format, and deployment strategies. Everything else on 2026-10-13)

- Lambda: [weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html), [types of metrics](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html), [viewing metrics](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-view.html), [environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), and in the API reference [UpdateAlias](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateAlias.html), [PublishVersion](https://docs.aws.amazon.com/lambda/latest/api/API_PublishVersion.html), [DeleteFunction](https://docs.aws.amazon.com/lambda/latest/api/API_DeleteFunction.html)
- CodeDeploy and CloudFormation: [deployment configurations](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html), [the UpdatePolicy attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatepolicy.html)
- API Gateway: [metrics for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html)
- AppConfig: [the Lambda extension](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions.html), [how the extension works](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions-how-it-works.html), [configuring the extension](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions-config.html), [extension versions](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions-versions.html), [the feature flag format](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-type-reference-feature-flags.html), [deployment strategies](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy.html), [predefined strategies](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy-predefined.html), [using the agent](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-agent-how-to-use.html), [permissions for automatic rollback](https://docs.aws.amazon.com/appconfig/latest/userguide/setting-up-appconfig.html), [validators](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile-validators.html), [DeleteConfigurationProfile](https://docs.aws.amazon.com/appconfig/2019-10-09/APIReference/API_DeleteConfigurationProfile.html)
- ECS: [blue/green](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html), [canary](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/canary-deployment.html), [the circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html), [failure detection by alarms](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-alarm-failure.html), and in the API reference [DeploymentConfiguration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DeploymentConfiguration.html), [CanaryConfiguration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CanaryConfiguration.html)
- Prices: the AWS Price List bulk API for [Systems Manager (AppConfig)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSystemsManager/current/ap-northeast-1/index.json) and [CodeDeploy](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCodeDeploy/current/ap-northeast-1/index.json). The alarm price and its allowance are the ones chapter 19 registered
- Source for permissions: the AWS service reference ([AppConfig](https://servicereference.us-east-1.amazonaws.com/v1/appconfig/appconfig.json), CloudWatch, Lambda)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the installed package, read for the registered providers and for the absence of `UpdatePolicy` and `CodeDeploy`)
- Type definitions: [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (ECS deployment strategies, CodeDeploy, AppConfig), [@aws-sdk/client-appconfig 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-appconfig/v/3.1149.0) (the description of `StopDeployment` and `AllowRevert`)
- Cloudflare: [Gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/), [Flagship](https://developers.cloudflare.com/flagship/), [Flagship concepts](https://developers.cloudflare.com/flagship/concepts/)
- Vercel: [Rolling Releases](https://vercel.com/docs/rolling-releases), [Skew Protection](https://vercel.com/docs/skew-protection), [Flags](https://vercel.com/docs/flags)

:::
