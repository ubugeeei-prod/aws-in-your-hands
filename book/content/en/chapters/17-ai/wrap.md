---
title: "17 AI: Costs, Pitfalls, and Cleanup"
---

# 17 AI: Costs, Pitfalls, and Cleanup

## If you come from Workers AI

<!-- section: 17.workers-ai -->

Here are the differences. The Cloudflare side is limited to what I confirmed in the official documentation.

| | Cloudflare Workers AI | This chapter (Bedrock) |
| --- | --- | --- |
| How you call | A binding. Declare it and it appears as `env.AI`; call `env.AI.run(model, options)` | An AWS SDK client. Send a `ConverseCommand` or a `ConverseStreamCommand` |
| Permissions | The Worker that declared the binding can call | IAM. The execution role names the ARNs of the model and the inference profile |
| Naming a model | A name such as `@cf/meta/llama-3.1-8b-instruct` | A model ID or an inference profile ID. What is usable depends on the Region and the route |
| Where it runs | Cloudflare's network | One of the Regions the profile allows |
| Streaming | Pass `stream: true` and it returns `text/event-stream`, usable as the response as it is | A sequence of events arrives as an async iterable from the SDK. Turning it into SSE is up to you |
| Billing unit | Neurons. 10,000 a day free, then USD 0.011 per 1,000 Neurons. Per-token prices are listed per model as well | Input and output token prices per model and Region |
| Local development | No simulation. Always remote, always billed | No simulation. Always remote, always billed |

Workers AI gets you started sooner. One line of binding and you can call, without thinking about permissions or where the model lives. Streaming is done once you hand what comes back to a `Response`.

On Bedrock you decide all of that yourself: which ARNs to allow, which Regions process the request, in what form the stream leaves. It is more work, but "this function can call this model and no other" and "inference is processed inside Japan" become things you write down as configuration. Which is better depends on what you are building and on the rules you have to keep.

The last row is the same. On both, the API may run on your machine while the inference runs over there and is billed.

## What it costs

Amounts are in USD, Tokyo Region, on-demand, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which nobody calls costs 0.** Neither a function URL nor Lambda charges for existing. Bedrock's on-demand pricing bills only the tokens you call for. Logs expire after 7 days.

When it is called, it looks like this. The assumptions are 1,000 summaries a month, each with 2,000 input tokens and 150 output tokens. The token counts are assumptions; the real values for your notes are in the `usage` of the `summary` log line.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| Nova 2 Lite input | 2 million tokens | 0.79 | 0.79 (no free allowance confirmed; none deducted) |
| Nova 2 Lite output | 150,000 tokens | 0.50 | 0.50 (same) |
| Lambda requests | 1,000 | 0.00 | 0 |
| Lambda duration | 1,000 GB-seconds | 0.01 | 0 |
| CloudWatch Logs ingestion | 0.001 GB | 0.00 | 0 |
| Subtotal | | **1.30** | **1.29** |

The unit prices for Nova 2 Lite are USD 0.000396 per 1,000 input tokens and USD 0.003311 per 1,000 output tokens (AWS Price List, checked 2026-10-11). Output costs more than 8 times what input does. This is the point of setting `maxTokens`.

Lambda duration assumes 4 seconds per summary on average. The function is running, and billed, while it waits for the model. The charge for transferring the response out to the internet is not in this table (it is not 0; it is not included).

About the ceiling. Output is at most 400 tokens per summary, so even if all 1,000 wrote up to the limit, the output part is USD 1.32. The input, as said above, is limited only by characters, so no such flat statement can be made for it.

Change the model and the unit prices change. The same token counts on Claude Haiku 4.5 (Tokyo, USD 1.10 per million input tokens and USD 5.50 per million output tokens) come to USD 3.03 for inference alone, more than twice Nova 2 Lite. Tokenizers differ by model, though, so the same text does not give the same token count. Read it as a comparison of unit prices.

Some things I could not confirm: whether Bedrock has a free allowance, and how many tokens are billed for a call that is aborted midway. Neither was confirmed from a primary source, so both stay unknown.

Deleting the stack stops the charges from this chapter.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| `dev:ai` stops with `Invalid environment` | Is there an `examples/17-ai/.env`? `AI_BACKEND` has no default |
| `ai:hello` fails with `AccessDeniedException` | The model is not enabled, or your permissions are short. A Marketplace model can take up to 15 minutes after the first call. Anthropic models need the use case form first |
| `ai:hello` fails with `ValidationException` or `ResourceNotFoundException` | Check `BEDROCK_MODEL_ID`. Is it an ID that cannot be called from Tokyo, or a bare model ID for a model that requires an inference profile? |
| The function URL answers 403 | There is no signature, or the caller lacks `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` |
| The API answers 500 with `code` `misconfigured` | The execution role cannot call that model. Do `BEDROCK_MODEL_ID` and the destinations in `infra/lib/models.ts` agree? `vp run ai:logs` |
| The API answers 429 with `code` `throttled` | You exceeded the account's quota. Check that model's limit in Service Quotas |
| The last event is `error` with `interrupted` | The stream was cut midway. If `retryable` is `true`, you can send the same request again |
| The response arrives all at once at the end | Is the URL's `InvokeMode` `RESPONSE_STREAM`? If you put a proxy in between, is it buffering? Look at the times in `ai:smoke` |

## Going to production

- **Let a browser call it.** The official documentation describes putting CloudFront in front of the function URL and having CloudFront sign requests with origin access control. The URL stays `AWS_IAM`. On its own, though, that lets anyone who knows the CloudFront URL call, so the app has to verify the access token from chapter 06. The documentation also says that for POST the SHA-256 of the body must be sent in the `x-amz-content-sha256` header. This chapter builds none of that
- **Add a limit per user.** The only limit so far is per call. The same person calling 10,000 times is billed 10,000 times. A limit on the count needs authentication that tells users apart, and a place to keep the count
- **Check the account's quota.** Inference has a limit on token usage for each model. According to the documentation, the values actually applied to an account can be lower than the published defaults. Look up your own in Service Quotas (this chapter did not check the values)
- **Add a budget notification.** That is Budgets, from chapter 01. A notification does not stop spending. The limits above do
- **Decide where the data may go.** A `jp.` profile stays in Japan; `global.` is worldwide. Decide where the data may be processed before you choose a model
- **Track the model's end date.** Each model card gives an end-of-life indication. Claude Haiku 4.5, for instance, is "EOL no sooner than 2026-10-16". The model ID is an environment variable because the day to change it will come
- **Move deployment to the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Cleanup

<!-- section: 17.cleanup -->

```bash
vp run ai:infra:destroy
```

The function, the function URL, the role, and the log group are deleted, along with the logs.

What remains is the storage created by cdkd's bootstrap (chapter 02) and the deployment files in it. On the Bedrock side, this chapter created no resources. If you called a Marketplace model even once, however, that subscription stays in the account. It costs nothing unless you call the model, but it has not "gone away", so keep it in mind.

::: details Verification notes for this chapter

**Checked locally.** Unit tests for the relay, the app, the client, and the infrastructure (51 tests). Type checking. Synth (including the esbuild bundle; 5 resources). Started `dev:ai` with `AI_BACKEND=fixture` and ran the `curl` commands from the chapter. I also confirmed that disconnecting midway produces the `cancelled` log line, and that `AI_FIXTURE=truncated` ends in an `error` event. From the published npm packages I confirmed that the pinned hono has `streamHandle`, and that the pinned cdkd (0.296.28) has a dedicated implementation for all five resource types in this stack (`AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`) and handles `InvokeMode` and `AuthType` on `AWS::Lambda::Url`.

**Not checked yet.** This chapter has never called real Bedrock, and nothing was deployed to AWS. `ai:hello`, `ai:test:live`, `dev:ai` with `AI_BACKEND=bedrock`, `ai:infra:deploy`, `ai:smoke`, `ai:logs`, `ai:infra:drift`, and `ai:infra:destroy` have not been run. These points in particular wait for a check in a real environment.

- That the model IDs (such as `jp.amazon.nova-2-lite-v1:0`) can really be called from Tokyo. I only read them on the model cards
- That real `ConverseStream` events fit this chapter's schema and the shape of the fixtures. The fixtures were written by hand from the official documentation, not captured from a real inference call
- That a response from Hono's `streamHandle` and `streamSSE` arrives piece by piece through the Node.js 24 Lambda runtime and a function URL. Whether Lambda accepts the headers `streamSSE` sets, such as `Transfer-Encoding`, is also unconfirmed
- That a function URL answers 403 to an unsigned request
- That `ConverseStream` passes with the IAM policy narrowed to the inference profile (with the `bedrock:InferenceProfileArn` condition)
- How the function and the model behave on Lambda after the caller disconnects. This is a conclusion from reading the documentation and Hono's source, not an observation
- Billing for a call aborted midway, a free allowance for Bedrock, and the default quota values in the Tokyo Region

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/17-ai/infra/lib/ai-stack.ts` | |
| Start with a few lines | `examples/17-ai/scripts/hello.ts`, `src/converse-stream.ts` | `ai:hello` |
| Choosing a model | `examples/17-ai/infra/lib/models.ts`, `infra/bin/app.ts` | `test:unit` |
| The input limit and the events you return | `examples/17-ai/src/contract.ts`, `src/prompt.ts` | `test:unit` |
| Reading the stream | `examples/17-ai/src/converse-stream.ts`, `src/summarize.ts`, `src/bedrock.ts` | `test:unit` |
| Stop, wait, try again | `examples/17-ai/src/failure.ts`, `src/summarize.ts`, `test/failure.test.ts` | `test:unit` |
| Making it an API | `examples/17-ai/src/app.ts`, `src/compose.ts`, `src/env.ts` | `test:unit` |
| Running it locally | `examples/17-ai/src/dev.ts`, `src/fixture-gateway.ts`, `src/fixtures.ts`, `fixtures/converse-stream/`, `.env.example` | `dev:ai` |
| Tests | `examples/17-ai/test/`, `infra/test/ai-stack.test.ts`, `scripts/live.ts` | `test:unit`, `ai:test:live` |
| When the stream is cut | `examples/17-ai/src/client.ts`, `test/client.test.ts` | `test:unit` |
| Getting ready for AWS | `examples/17-ai/infra/lib/ai-stack.ts`, `src/lambda.ts`, `infra/test/ai-stack.test.ts`, `cdk.json` | `ai:infra:synth`, `test:unit` |
| Deploy and call | `examples/17-ai/scripts/smoke.ts`, `scripts/sign.ts`, `scripts/logs.ts`, `tools/src/infra/` | `ai:infra:diff`, `ai:infra:deploy`, `ai:smoke`, `ai:logs`, `ai:infra:drift` |
| Cleanup | `tools/src/infra/` | `ai:infra:destroy` |
| What it costs | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

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
- [hono 4.13.13](https://www.npmjs.com/package/hono/v/4.13.13), [@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (for each, I read the type definitions and source of the installed package)

:::
