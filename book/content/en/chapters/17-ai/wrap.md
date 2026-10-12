---
title: "17 AI: Costs, Pitfalls, and Cleanup"
---

# 17 AI: Costs, Pitfalls, and Cleanup

With the [deploy](/en/chapters/17-ai/deploy.md) done, this page sets out how Bedrock differs from Workers AI and what the chapter costs, and then cleans up what you built.

## If you're coming from Workers AI

<!-- section: 17.workers-ai -->

The table lists where the two differ. The Cloudflare column covers only what was confirmed in the official documentation.

| | Cloudflare Workers AI | This chapter (Bedrock) |
| --- | --- | --- |
| How you call | A binding. Declare it in the configuration and it appears as `env.AI`, then call `env.AI.run(model, options)` | An AWS SDK client. Send a `ConverseCommand` or a `ConverseStreamCommand` |
| Permissions | The Worker that declared the binding can call | IAM. The execution role names the ARNs of the model and the inference profile |
| Naming a model | A name such as `@cf/meta/llama-3.1-8b-instruct` | A model ID or an inference profile ID. What you can use depends on the Region and the route |
| Where it runs | Cloudflare's network | One of the Regions the profile determines |
| Streaming | Pass `stream: true` and it returns `text/event-stream`, which can be used as the response as it is | A sequence of events arrives as an async iterable from the SDK. Your own code turns it into SSE |
| Billing unit | Neurons. 10,000 a day are free, then USD 0.011 per 1,000 Neurons. Per-token prices are listed for each model as well | Input and output token prices per model and Region |
| Local development | No simulation. It always runs remotely and is billed | No simulation. It always runs remotely and is billed |

Workers AI takes fewer steps to get started. With one line for the binding you can call a model without thinking about permissions or where the model is hosted, and streaming is finished once you pass what comes back to a `Response`.

On Bedrock you decide all of that yourself: which ARNs to allow, which Regions process the request, and in what form the stream goes out. It is more work, but statements such as "this function can call only this model" and "inference is processed inside Japan" can be written down as configuration. Which one fits depends on what you are building and on the rules you have to follow.

Only the last row of the table is the same. On both, the API can run on your machine while inference runs on the service's side and is billed.

## Cost

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which nobody calls costs 0.** Neither a function URL nor Lambda charges anything for merely existing. Bedrock's on-demand pricing bills only for the tokens you call for. Logs are deleted after 7 days.

The cost when the API is called is calculated here for 1,000 summaries a month, each with 2,000 input tokens and 150 output tokens. The token counts are assumptions, so check the real values for your notes in the `usage` field of the `summary` log line.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| Nova 2 Lite input | 2 million tokens | 0.79 | 0.79 (no free allowance confirmed; none deducted) |
| Nova 2 Lite output | 150,000 tokens | 0.50 | 0.50 (same) |
| Lambda requests | 1,000 | 0.00 | 0 |
| Lambda duration | 1,000 GB-seconds | 0.01 | 0 |
| CloudWatch Logs ingestion | 0.001 GB | 0.00 | 0 |
| Subtotal | | **1.30** | **1.29** |

The unit prices for Nova 2 Lite are USD 0.000396 per 1,000 input tokens and USD 0.003311 per 1,000 output tokens (AWS Price List, checked 2026-10-11). Output costs more than 8 times what input does, which is why it matters to set `maxTokens`.

Lambda duration assumes 4 seconds per summary on average. The function keeps running, and is billed, while it waits for inference. The charge for transferring the response out to the internet is not in this table. That does not mean it is 0. It is not included.

An upper bound can be calculated as well. Output is at most 400 tokens per summary, so even if all 1,000 summaries wrote up to the limit, the output would cost USD 1.32. The input is limited only by its character count, so the same cannot be said of it.

**When a script that holds the permission goes into a loop.** Only a caller who can sign can call this URL, and Lambda refuses strangers before the function runs. What you have to worry about is something on your own side running out of control.

The worst cost of one call can be calculated. Output stops at 400 tokens, so on Nova 2 Lite it is USD 0.0013 (400 x 0.003311 / 1,000). The function stops at 40 seconds, so Lambda is USD 0.00013. Input stops at 10,000 characters, but this book does not know what one character costs.

The number of calls has no limit by default. There is only the account's Bedrock quota, and its value was not checked. With `-c reservedConcurrency=2`, two calls run at a time. What that lets you state is the cost of Lambda duration: even if two keep running for 30 days, it is USD 17.28.

The cost of inference cannot be stated in the same way. With two at a time and 4 seconds per call (the assumption in the table above), 30 days come to 1.296 million calls. If every one writes up to the limit, output alone is USD 1,716.42. At 2,000 input tokens each, that adds another USD 1,026.43. Reserved concurrency limits how many calls run at once, and it is not a budget. Stopping the number of calls takes the per-user limit described under "Going to production".

When you change the model, the unit prices change. Calculated for the same token counts on Claude Haiku 4.5 (Tokyo, USD 1.10 per million input tokens and USD 5.50 per million output tokens), inference alone comes to USD 3.03, more than twice Nova 2 Lite. Each model counts tokens differently, though, so the same text does not give the same token count. Read this as a comparison of unit prices.

Some things could not be confirmed: whether Bedrock has a free allowance, and how many tokens are billed for a call that is aborted partway. Neither was confirmed from a primary source, so both are recorded as unknown.

Deleting the stack stops the charges from this chapter.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:ai` stops with `Invalid environment` | Check that `examples/17-ai/.env` exists. `AI_BACKEND` has no default |
| `ai:hello` fails with `AccessDeniedException` | The model is not enabled, or you lack a permission. A Marketplace model can take up to 15 minutes after the first call. Anthropic models need the use case form submitted first |
| `ai:hello` fails with `ValidationException` or `ResourceNotFoundException` | Check `BEDROCK_MODEL_ID`. You may be passing an ID that cannot be called from Tokyo, or a bare model ID for a model that requires an inference profile |
| The function URL returns 403 | The request has no signature, or the caller lacks `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` |
| The API returns 500 with `code` `misconfigured` | The execution role cannot call that model. Check that `BEDROCK_MODEL_ID` and the destinations in `infra/lib/models.ts` agree. `vp run ai:logs` shows the logs |
| The API returns 429 with `code` `throttled` | You exceeded the account's quota. Check that model's limit in Service Quotas |
| The last event is `error` with `interrupted` | The stream was cut partway. If `retryable` is `true`, you can send the same request again |
| The response arrives all at once at the end | Check that the URL's `InvokeMode` is `RESPONSE_STREAM`. If you put a proxy in between, check that the proxy is not buffering. The times `ai:smoke` prints are a clue |

## If you take this to production

- To let a browser call the API, the official documentation describes putting CloudFront in front of the function URL and having CloudFront sign requests with origin access control. The URL's authentication stays `AWS_IAM`. That alone lets anyone who knows the CloudFront URL call it, though, so the app needs to verify the access token from chapter 06. The documentation also says that for a POST, the SHA-256 of the body must be sent in the `x-amz-content-sha256` header. This chapter builds none of this
- Add a limit per user. The only limits now are the limit on one call and, if you specify it, the limit on how many run at once. If the same person calls 10,000 times, you pay for 10,000 calls. Limiting the number of calls needs authentication that tells users apart, and a place to count the calls
- Check the account's quota. Inference has a limit on token usage for each model. According to the documentation, the value actually applied to an account can be lower than the published default. Look up your own value in Service Quotas (this chapter did not check the values)
- Add a budget notification. This is Budgets, from chapter 01. A notification does not stop spending. The limits listed above are what stop it
- Decide where the data may go. A `jp.` profile processes requests inside Japan, and a `global.` profile anywhere in the world. Decide where the data may be processed before you choose a model
- Track the model's end date. Each model card gives an indication of when the model ends. Claude Haiku 4.5, for example, is listed as "EOL no sooner than 2026-10-16". The model ID is an environment variable because the day to change it will come
- Move deployment to the AWS CDK CLI and CloudFormation, as explained in chapter 02

## Cleaning up

<!-- section: 17.cleanup -->

```bash
vp run ai:infra:destroy
```

The function, the function URL, the role, and the log group are deleted, and the logs go with them.

What remains is the storage created by cdkd's bootstrap (chapter 02) and the deployment files in it. This chapter created no resources on the Bedrock side. If you called a Marketplace model even once, however, that subscription stays in the account. It costs nothing unless you call the model, but it has not been removed.

::: details Verification notes for this chapter

**Checked locally.** The unit tests for the relay, the app, the client, and the infrastructure (51 tests), type checking, and synth (including the esbuild bundle; 5 resources) were run. `dev:ai` was started with `AI_BACKEND=fixture` and the `curl` commands from the chapter were run against it. Disconnecting partway was confirmed to produce the `cancelled` log line, and `AI_FIXTURE=truncated` to end in an `error` event. Two points were confirmed from the published npm packages. The pinned hono has `streamHandle`. The pinned cdkd (0.296.28) has a dedicated implementation for all five resource types in this stack (`AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`) and handles `InvokeMode` and `AuthType` on `AWS::Lambda::Url`.

**Not checked yet.** This chapter has never called the real Bedrock, and nothing was deployed to AWS. `ai:hello`, `ai:test:live`, `dev:ai` with `AI_BACKEND=bedrock`, `ai:infra:deploy`, `ai:smoke`, `ai:logs`, `ai:infra:drift`, and `ai:infra:destroy` have not been run. The following points in particular are waiting for a check in a real environment.

- That the model IDs (such as `jp.amazon.nova-2-lite-v1:0`) can really be called from Tokyo. They were only read on the model cards
- That real `ConverseStream` events fit this chapter's schema and the shape of the fixtures. The fixtures were written by hand from the official documentation, not captured from a real inference call
- That a response from Hono's `streamHandle` and `streamSSE` arrives piece by piece through the Node.js 24 Lambda runtime and a function URL. Whether Lambda accepts the headers `streamSSE` sets, such as `Transfer-Encoding`, is also unconfirmed
- That a function URL returns 403 to an unsigned request
- That `ConverseStream` passes with the IAM policy narrowed to the inference profile (with the `bedrock:InferenceProfileArn` condition)
- How the function and the model behave on Lambda after the caller disconnects. This is a conclusion from reading the documentation and Hono's source, not an observation
- Billing for a call aborted partway, a free allowance for Bedrock, and the default quota values in the Tokyo Region
- That a deploy with `-c reservedConcurrency=N` goes through, and what a function URL returns to a call past the limit. Only two things were checked: the template carries the value, and the source of cdkd 0.296.28 passes it to the Lambda API

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/17-ai/infra/lib/ai-stack.ts` | |
| Calling a model in a few lines | `examples/17-ai/scripts/hello.ts`, `src/converse-stream.ts` | `ai:hello` |
| Choosing a model | `examples/17-ai/infra/lib/models.ts`, `infra/bin/app.ts` | `test:unit` |
| The input limit and the events you return | `examples/17-ai/src/contract.ts`, `src/prompt.ts` | `test:unit` |
| Reading the stream | `examples/17-ai/src/converse-stream.ts`, `src/summarize.ts`, `src/bedrock.ts` | `test:unit` |
| Stopping, waiting, retrying | `examples/17-ai/src/failure.ts`, `src/summarize.ts`, `test/failure.test.ts` | `test:unit` |
| Making it an API | `examples/17-ai/src/app.ts`, `src/compose.ts`, `src/env.ts` | `test:unit` |
| Running it locally | `examples/17-ai/src/dev.ts`, `src/fixture-gateway.ts`, `src/fixtures.ts`, `fixtures/converse-stream/`, `.env.example` | `dev:ai` |
| Tests | `examples/17-ai/test/`, `infra/test/ai-stack.test.ts`, `scripts/live.ts` | `test:unit`, `ai:test:live` |
| When the stream is cut | `examples/17-ai/src/client.ts`, `test/client.test.ts` | `test:unit` |
| Getting ready for AWS | `examples/17-ai/infra/lib/ai-stack.ts`, `src/lambda.ts`, `infra/test/ai-stack.test.ts`, `cdk.json` | `ai:infra:synth`, `test:unit` |
| Deploying and calling | `examples/17-ai/scripts/smoke.ts`, `scripts/sign.ts`, `scripts/logs.ts`, `tools/src/infra/` | `ai:infra:diff`, `ai:infra:deploy`, `ai:smoke`, `ai:logs`, `ai:infra:drift` |
| Cleaning up | `tools/src/infra/` | `ai:infra:destroy` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked on 2026-10-11)

- [Inference using Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html), [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html), [MessageStopEvent](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html)
- [Request access to models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- [Cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html), [Supported Regions and models for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html), [Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)
- Model cards: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html), [Claude Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)
- [Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html), [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html)
- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html), [Writing response streaming-enabled Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html), [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
- [Stream the integration response for your proxy integrations in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- [Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json), [Bedrock models sold through Marketplace](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json). The Price List has no row specific to the `jp.` profile; it has a row for global and a row with no qualifier. Following the user guide's statement that the price is that of the Region you call from, this chapter applies the unqualified row to the `jp.` profile
- Cloudflare Workers AI: [Get started](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/), [Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/), [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Supported bindings per development mode](https://developers.cloudflare.com/workers/development-testing/bindings-per-env/)
- [hono 4.13.13](https://www.npmjs.com/package/hono/v/4.13.13), [@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (for each, the type definitions and source of the installed package were read)

:::
