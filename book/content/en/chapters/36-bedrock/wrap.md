---
title: "36 Bedrock: Costs, Pitfalls, and Cleanup"
---

# 36 Bedrock: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It gathers what plays the same parts on Cloudflare and Vercel, the costs, where people trip, what to add for production, and the cleanup.

## Coming from Cloudflare and Vercel

<!-- section: 36.compare -->

Much of what this chapter built exists on Cloudflare and Vercel under other names. Both columns are what the official documentation said on 2026-10-13.

| This chapter | Cloudflare | Vercel |
| --- | --- | --- |
| Tools and the loop | Function calling in Workers AI. `runWithTools` from `@cloudflare/ai-utils` also runs the functions | `tools` in the AI SDK. With `stopWhen: isStepCount(5)` the SDK runs the loop and stops it by count |
| Receiving JSON | JSON Mode in Workers AI. A JSON Schema goes in `response_format`. Supported models are listed | `Output.object({ schema })` in the AI SDK. The schema can be Zod, Valibot, or JSON Schema, and the SDK validates |
| Guardrails | Guardrails in AI Gateway, judged by Llama Guard on Workers AI | No feature with this role was confirmed in AI Gateway |
| Reusing a prompt's start | Prompt caching in Workers AI, on by default for supported models | The AI SDK's Bedrock provider can pass cache points |
| Limiting and recording usage | Rate limiting, analytics, and logging in AI Gateway | Budgets in AI Gateway (new requests are refused once one is exceeded) and request logs |
| Work that can wait | The Asynchronous Batch API in Workers AI | Not confirmed |
| A place to run agents | Cloudflare Agents | Not confirmed |

Most of these are the same idea, so only the differences follow.

**Who writes the loop.** The AI SDK and `runWithTools` write the loop for you, and the limit on rounds is one argument. What took this chapter a hundred lines takes a few. In exchange, the library decides things such as whether an answer cut midway is tried again and how many refused tool requests are allowed. This chapter put those decisions in its own code and pinned them with tests. Which is better depends on how much those decisions matter to you.

The AI SDK is a TypeScript library that runs on Node.js. It has a provider for Bedrock and can pass a guardrail's configuration. Using the AI SDK inside Lambda is a combination that works too. This chapter did not do so because it wanted to show Converse's events and requests directly, not because there is a reason to avoid the AI SDK.

**A gateway as a place to put things.** Cloudflare's AI Gateway and Vercel's AI Gateway are proxies placed between the application and the model providers. Recording, limits, and switching providers can move out of the application's code. Bedrock has no single product in that role. This chapter wrote the budget into DynamoDB, the record into its own log, and the retries into its own loop.

Cloudflare's AI Gateway can treat Amazon Bedrock as one of its providers. Hand it AWS credentials, and the gateway adds the SigV4 signature. You can keep the model on Bedrock and leave only recording and limits to the gateway. That puts credentials outside AWS, which is a decision to make.

**The word cache.** Caching in AI Gateway returns the same response for the same request and does not call the model. Prompt caching in this chapter calls the model every time and reuses only the processing of the input's start. The names are close. The things are different.

**Guardrails and streams.** According to its documentation, Cloudflare's Guardrails does not stop a streamed response partway. On the gateway endpoints it buffers the whole response, checks it, and returns it in one piece. Japanese is not on its list of supported languages. Bedrock's guardrail can check a stream piece by piece and supports Japanese in the Standard tier. In exchange, Standard may send text outside Tokyo.

**When to simply stay.** If your application runs on Workers or Vercel, nothing constrains where the model runs, and you have no reason to care about the loop's details, then staying with the AI SDK or Workers AI means less code and fewer things to manage. Reasons to choose Bedrock are conditions such as wanting inference kept inside a Region you chose, wanting IAM to narrow who may call a model, or having your other data on AWS.

## Costs

<!-- section: 36.cost -->

Amounts are in USD, for the Tokyo Region, pay as you go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which nobody calls costs 0.** Neither the function URL, nor Lambda, nor the on-demand DynamoDB tables, nor the guardrail is charged for existing. A guardrail is billed only for the text it checks. Logs expire after 7 days.

The cost when it is called is calculated for 1,000 questions a month. The assumption is 3 model calls per question, 4,000 input tokens over the 3 calls, and 200 output tokens in total. There is more input than in chapter 17's summary (2,000 input tokens) because every round sends the conversation again.

| Item | Quantity | List price |
| --- | --- | --- |
| Nova 2 Lite input | 4 million tokens | 1.58 |
| Nova 2 Lite output | 200,000 tokens | 0.66 |
| Guardrail (sensitive information filters) | 6,000 text units | 0.60 |
| Lambda requests and duration | 1,000 requests, 2,000 GB-seconds | 0.03 |
| DynamoDB reads and writes | 2,000 writes, 3,000 reads | 0.00 |
| CloudWatch Logs ingestion | 0.001 GB | 0.00 |
| Subtotal | | **2.88** |

After the monthly free allowances, the Lambda share becomes 0 and the subtotal is USD 2.85. No free allowance could be confirmed for Bedrock or for guardrails, so none is subtracted.

The guardrail comes to about as much as the output tokens. A text unit is counted in characters, and even a short question is 1 unit. The figure of 6 units per question assumes that each of the 3 calls has 1 unit of input and 1 unit of output checked. How many times the same question is counted in a call with several rounds could not be confirmed in the documentation. The rates are USD 0.10 per 1,000 units for sensitive information filters and USD 0.15 for content filters. Sensitive information filters made of regular expressions only, and word filters, are free.

The limit per user follows from the configuration. The default budget is USD 0.50 per person per day, so one person using the full budget every day comes to USD 15.00 in 30 days. That is a limit on the estimated amount for inference and does not include Lambda or the guardrail. The number of users has no limit, so it is not a limit on the total either. Combine it with chapter 17's reserved concurrency and chapter 01's budget notification.

Whether prompt caching and batch inference pay was calculated on the [build page](/en/chapters/36-bedrock/more.md).

Some things could not be confirmed: whether Bedrock and guardrails have a free allowance, how much of a call that failed partway is billed, and what the model charges for a call a guardrail blocked. In the documentation's example the token counts for a blocked input were 0, but nothing was confirmed for an answer blocked on output.

Deleting the stack stops this chapter's charges.

## Where people trip

| If this happens | Look here |
| --- | --- |
| `dev:bedrock` stops with `Invalid environment` | Check that `examples/36-bedrock/.env` exists. If it says `BEDROCK_MODEL_ID: is not in src/models.ts`, add a row for that ID to `src/models.ts` first |
| A 401 comes back | Locally, the token may have expired. Restart the server and a new token is printed. On AWS, check that the function URL's authentication is `AWS_IAM` |
| A 429 with `code` `budget_exceeded` | The reservation would go past that person's budget for the day. It comes back the next day (UTC). If `DAILY_BUDGET_MICRO_USD` is smaller than one reservation (66,220 by default for Nova 2 Lite), not even one request passes |
| A 429 with `code` `throttled` | The account's quota. Look up the value for that model in Service Quotas. Also check that `maxTokens` is not too large |
| `done` has `stopReason` `turn_limit` | The model went on asking for tools. Look at `toolCalls` and `toolErrors` in the log. Many `toolErrors` mean the tool's description or input schema is not getting through to the model |
| The last event is `error` with `bad_output` | Too many tool requests were refused, or `stopReason` was `malformed_tool_use`. For the JSON extraction, the corrected answer did not validate either |
| `blocked` arrives | The guardrail blocked it. To learn which filter, set `trace` to `enabled`. This chapter sets it to `disabled` |
| `ValidationException` | A field the model does not support may have been sent. Structured outputs, `toolChoice`, and naming a cache lifetime differ by model. With a model that does not support guardrails the message is `Guardrail is not supported with the chosen model` |
| On AWS, a 500 with `code` `misconfigured` | The execution role cannot use the model or the guardrail. With the Standard setting, check that IAM lists every destination of the guardrail profile |
| Hostile input in Japanese passes straight through | Classic content filters do not support Japanese |

## For production

- Fit the entry point to how your users sign in. This chapter's user is someone who can sign with AWS credentials. Users in a browser need an `authenticate` that verifies chapter 06's access token, and the entry point described in chapter 17
- Put the models' end dates in a calendar. The dates in `src/models.ts` were copied from the model cards by hand. Decide who receives the notice that a model has become Legacy, and practise the steps of a change (add to the table, run the evaluation, change the environment variable) at least once
- Add evaluation cases. Four is a number for showing the mechanism. Add the failures you see in real questions
- Choose the guardrail's configuration for your own use. This chapter's default only blocks keys. Which filters to attach depends on what you handle and on the Regions your text may go to. Once attached, try it with input it should block and with input it must not block
- Do not trust the answer on the side that displays it. Show it as text and do not let it be interpreted as HTML
- Compare the budget's unit prices with the Price List. When the prices in `src/models.ts` go stale, the budget drifts without a sound
- Turn throttling into an alarm. Make a metric filter that counts log lines whose `outcome` is `throttled`, in the way chapter 19 shows
- Decide whether to turn on the record of model calls (model invocation logging). Turned on, it stores the bodies of notes
- Deploy through the AWS CDK CLI and CloudFormation, as chapter 02 explained

## Cleanup

<!-- section: 36.cleanup -->

```bash
vp run bedrock:infra:destroy
```

The function, the function URL, the role, the log group, the two tables, and the guardrail with its version are deleted. The fixture notes written to the notes table and the usage records go with them.

What remains is the storage created by cdkd's bootstrap (chapter 02) and the deployment files in it. If you called a model sold through Marketplace, its subscription stays in the account, as in chapter 17. If you turned on model invocation logging yourself, that setting and the logs at its destination remain. This chapter's stack neither creates nor deletes them.

::: details Verification notes for this chapter

**Checked locally.** The unit tests (110), the type check, and synth (with the esbuild bundle, 9 resources) were run. `dev:bedrock` was started with `AI_BACKEND=scripted`, and the `curl` commands on the local page were run: the 401, the SSE events, the JSON answer, and the two log lines were seen. With `AI_TRANSCRIPT=runaway-tools` the stream ended with `turn_limit`. `bedrock:eval` passed its 4 cases, and `bedrock:batch:plan` passed with 100 records and stopped with 40. The cost subtotals are the values calculated by `tools/src/pricing/calc.ts`. In the distributed files of the pinned cdkd (0.296.28), 6 of this stack's 8 types have their own implementation, and `AWS::Bedrock::Guardrail` and `AWS::Bedrock::GuardrailVersion` do not. The types of the pinned `@aws-sdk/client-bedrock-runtime` (3.1149.0) declare `outputConfig`, `strict`, `cachePoint`, and `streamProcessingMode`.

**Not checked yet.** This chapter has never called the real Bedrock, and nothing was deployed to AWS. `bedrock:eval:live`, `dev:bedrock` with `AI_BACKEND=bedrock`, `bedrock:infra:deploy`, `bedrock:smoke`, `bedrock:logs`, `bedrock:infra:drift`, and `bedrock:infra:destroy` have not been run. The following in particular wait for a check on AWS.

- That the real `ConverseStream` returns tool requests in the shape of this chapter's schema and fixtures. The fixtures were written by hand from the official documentation, not recorded from real inference
- Everything about a real model's behaviour: when it calls a tool, whether it asks again after a refusal, whether it follows instructions written in a note, whether the input of a named tool fits the schema. That includes whether the 4 evaluation cases pass
- That the API accepts a tool request whose input could not be read as JSON when it is repeated with an empty `input`
- That naming a tool in `toolChoice` works on Nova 2 Lite, and that `outputConfig.textFormat` works on Claude Haiku 4.5 through the `jp.` profile
- That `ConverseStream` with a guardrail passes with a role whose `bedrock:ApplyGuardrail` is narrowed to its own guardrail. That a guardrail with sensitive information filters only can be created. How much of the earlier text arrives when an answer is blocked partway through its output
- How a guardrail's text units are counted in a call with several rounds. What the model charges for a call a guardrail blocked
- That a request with cache checkpoints passes on Nova 2 Lite, that the cache is actually hit, and how writes priced at USD 0 in the Price List are counted on a bill
- What `requestContext.authorizer.iam.userId` in the function URL event holds when the request was signed with an assumed role. The documentation's example is an IAM user
- That cdkd can create, update, and delete a guardrail and its version through the Cloud Control API, and that the version's `Version` attribute reaches the function's environment variable
- That the conditional update in DynamoDB holds the budget under simultaneous requests. Only the shape of the command was examined
- The quota values applied to your own account in the Tokyo Region
- Creating a batch inference job, and the real shape of its output. On whether structured outputs work in a batch, two pages of the documentation disagree
- Amazon Bedrock AgentCore was not run. Only the structure described in its documentation was presented

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture | `examples/36-bedrock/src/app.ts`, `infra/lib/bedrock-stack.ts` | |
| What differs from model to model | `examples/36-bedrock/src/models.ts`, `src/env.ts`, `infra/bin/app.ts` | `test:unit` |
| Defining the tools | `examples/36-bedrock/src/tools.ts`, `test/tools.test.ts` | `test:unit` |
| Reading a tool request from the stream | `examples/36-bedrock/src/converse.ts`, `src/turn.ts`, `src/gateway.ts`, `src/bedrock.ts` | `test:unit` |
| The loop as a state machine | `examples/36-bedrock/src/loop.ts`, `src/prompt.ts`, `test/loop.test.ts` | `test:unit` |
| Instructions written in a note | `examples/36-bedrock/src/prompt.ts`, `fixtures/transcripts/injected.json`, `test/loop.test.ts` | `test:unit` |
| Receiving JSON | `examples/36-bedrock/src/structured.ts`, `src/contract.ts`, `test/structured.test.ts` | `test:unit` |
| Guardrails | `examples/36-bedrock/src/prompt.ts`, `src/client.ts`, `infra/lib/guardrail.ts`, `infra/lib/bedrock-stack.ts` | `test:unit` |
| Prompt caching | `examples/36-bedrock/src/prompt.ts`, `src/usage.ts`, `test/prompt.test.ts` | `test:unit` |
| Usage, budgets, and quotas | `examples/36-bedrock/src/usage.ts`, `src/budget.ts`, `src/dynamodb-ledger.ts`, `src/log-shape.ts`, `src/app.ts` | `test:unit` |
| Batch for work that can wait | `examples/36-bedrock/src/batch.ts`, `scripts/batch-plan.ts` | `bedrock:batch:plan`, `test:unit` |
| Running it locally | `examples/36-bedrock/src/dev.ts`, `src/scripted-model.ts`, `src/transcripts.ts`, `fixtures/`, `.env.example` | `dev:bedrock` |
| What the tests hold | `examples/36-bedrock/test/`, `infra/test/bedrock-stack.test.ts` | `test:unit` |
| Evaluation as a regression test | `examples/36-bedrock/src/eval.ts`, `scripts/eval.ts`, `fixtures/eval/cases.json` | `bedrock:eval`, `bedrock:eval:live` |
| Preparing for AWS | `examples/36-bedrock/infra/`, `src/lambda.ts`, `src/function-url.ts`, `src/identity.ts` | `bedrock:infra:synth`, `test:unit` |
| Deploying and checking | `examples/36-bedrock/scripts/smoke.ts`, `scripts/sign.ts`, `scripts/logs.ts` | `bedrock:infra:diff`, `bedrock:infra:deploy`, `bedrock:smoke`, `bedrock:logs`, `bedrock:infra:drift` |
| Cleanup | `tools/src/infra/` | `bedrock:infra:destroy` |
| Costs | `data/pricing/`, `examples/36-bedrock/src/usage.ts` | `test:unit` |

**Primary sources** (all checked on 2026-10-13)

- Tools: [Use a tool to complete an Amazon Bedrock model response](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html), [Client-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-client-side.html), [Server-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-server-side.html), [Inference using Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html), [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html), [MessageStopEvent](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html), [ToolSpecification](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolSpecification.html) and the types around it
- Structured output: [Get validated JSON results from models](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html), [OutputConfig](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_OutputConfig.html)
- Guardrails: [Detect and filter harmful content by using Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html), [Include a guardrail with the Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-converse-api.html), [Configure streaming response behavior to filter content](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-streaming.html), [GuardrailStreamConfiguration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GuardrailStreamConfiguration.html), [Set up permissions to use Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions.html), [Supported Regions and models](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-supported.html), [Safeguard tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-tiers.html), [Languages supported](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-supported-languages.html), [Supported Regions for cross-Region guardrail inference](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-cross-region-support.html), [sensitive information filters](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-sensitive-filters.html), [Detect prompt attacks](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html), [Prompt injection security](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-injection.html)
- Prompt caching and usage: [Prompt caching for faster model inference](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html), [TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html)
- Models and paths: [Inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html), [Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html), [Cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html), model cards: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html), [Claude Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html), [Model lifecycle](https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html)
- Quotas: [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html), [Amazon Bedrock endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html), [How tokens are counted in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html), [Service tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html), [Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html), [CountTokens](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html)
- Batch and capacity: [Process multiple prompts with batch inference](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html), [Format and upload your batch inference data](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-data.html), [Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-throughput.html)
- Agents: [Automate tasks in your application using AI agents](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html), [What is Amazon Bedrock AgentCore?](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- Records and the entry point: [Monitor model invocation using CloudWatch Logs and Amazon S3](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html), [Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- Infrastructure: [AWS::Bedrock::Guardrail](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrock-guardrail.html), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0) (for both, the installed package was read)
- Pricing: [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), the AWS Price List bulk API for [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json) and for [models sold through Marketplace](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json)
- Cloudflare: [Function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/), [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/), [Asynchronous Batch API](https://developers.cloudflare.com/workers-ai/features/batch-api/), [Prompt caching](https://developers.cloudflare.com/workers-ai/features/prompt-caching/), [AI Gateway](https://developers.cloudflare.com/ai-gateway/), [Guardrails usage considerations](https://developers.cloudflare.com/ai-gateway/features/guardrails/usage-considerations/), [Agents](https://developers.cloudflare.com/agents/)
- Vercel: [AI Gateway](https://vercel.com/docs/ai-gateway), [AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing), and from the AI SDK [Tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [Generating structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [Amazon Bedrock provider](https://ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock)

:::
