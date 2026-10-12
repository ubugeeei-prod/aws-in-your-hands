---
title: "50 AgentCore: Costs, Pitfalls, and Cleanup"
---

# 50 AgentCore: Costs, Pitfalls, and Cleanup

How the bill is counted, where to look when something fails, what production adds, and cleanup. The verification notes are at the end.

## Costs

<!-- section: 50.cost -->

AgentCore's pricing page describes pay-as-you-go pricing with no upfront commitment and no minimum fee. This chapter's stack costs nothing for the Runtime while there is no session. The DynamoDB table is on-demand, and a user pool with no users costs nothing. What remains is the ZIP in S3 (holding an `app.js` of about 1.8 MB) and whatever CloudWatch Logs stores.

The Runtime's unit prices, from the AWS Price List for Tokyo (published 2026-10-06, checked 2026-10-13), are these for the default V1:

- CPU: USD 0.0895 per vCPU-hour
- Memory: USD 0.00945 per GB-hour

Billing is per second, and memory has a minimum of 128 MB. Two things are counted differently from Lambda. CPU is not billed while the agent waits for a model or a tool to answer. Memory is billed until the session ends, idle time included. Most of an agent's time is spent waiting for the model, so what decides the cost is how long a session stays alive.

Say there are 1,000 sessions a month, each using 18 seconds of CPU in all and 0.6 GB of memory on average. Both are assumptions, not measurements. With 4 minutes of conversation and then, as this chapter sets it, an end after 5 idle minutes:

- CPU: 1,000 × 18 seconds ÷ 3,600 = 5 vCPU-hours → USD 0.4475
- Memory: 1,000 × 9 minutes × 0.6 GB ÷ 60 = 90 GB-hours → USD 0.8505
- Total: USD 1.30 a month

Leave the idle timeout at its default 15 minutes, and the same conversation keeps a session alive for 19 minutes: memory comes to 190 GB-hours and USD 1.7955, and the total to USD 2.24. The conversation is the same. Only the waiting differs.

Neither figure includes the model. As chapter 36 showed, most of what a question costs is the model's tokens, and here the remembered exchanges are sent again every time, so input tokens grow as a conversation goes on. `MAX_REMEMBERED_TURNS` and `MAX_REMEMBERED_ANSWER_CHARS` set the ceiling.

Platform version V2 has its own prices: in Tokyo, USD 0.1276 per vCPU-hour and USD 0.0169 per GB-hour. According to the pricing page, V2 reclaims idle memory after 120 seconds. A higher rate with cheaper idling means that which is cheaper depends on the shape of the conversation. This chapter did not work it out.

The Tokyo price of AgentCore Memory's short-term memory is not confirmed. The pricing page says that from October 6, 2026, ingestion is USD 1.00 per GB, retrieval USD 0.20 per GB, and storage USD 0.10 per GB-month, with each event counted as at least 12 KB. The Tokyo Price List read on the same day had no per-GB price, only an item at USD 0.00 per event. So it is not in `data/pricing/`. Applying the pricing page's rates, 2,000 events for 1,000 sessions are 24 MB, and ingesting them comes to less than USD 0.03.

A Gateway, and Identity's keeping of tokens for outside services, are not used and cost nothing. The pricing page says Identity carries no additional charge when used through the Runtime.

## Failures and How to Look Into Them

<!-- section: 50.failures -->

The responses described here are the ones seen on the local server and the ones in the documentation's tables. None were checked on a deployed Runtime.

**An invocation gets a 401 with a `WWW-Authenticate` header.** It was refused in front of the Runtime. The token is missing or expired, or its issuer or client does not match the authorizer's settings. Look inside the token and compare `iss` and `client_id` with the stack's outputs. Also check that you are sending the access token, not the ID token.

**An invocation gets a 424 (`RuntimeClientError`).** The agent returned a 4xx or a 5xx. Look in the agent's log (`/aws/bedrock-agentcore/runtimes/<the Runtime's ID>-DEFAULT`) for a line at the same time. If it says `session owner mismatch`, the session ID was not made by `newSessionId`'s rule, or it is another user's. If there is no line and the agent answered 401, the token is not reaching the agent. Check that `Authorization` is in the header allowlist, and that the environment variables `JWT_ISSUER` and `JWT_CLIENT_ID` agree with the authorizer.

**An invocation gets a 409 (`RetryableConflictException`).** Another operation on the same session arrived while its microVM was being prepared or torn down. Retry after a short wait.

**A 402 or a 429.** 402 is a quota (the number of sessions running at once, for one), and 429 is throttling. The limits are listed on the [first page](/en/chapters/50-agentcore.md).

**Answers come back, but a follow-up question does not build on what came before.** Look at `remembered` in the `invocation` log line. If it is `false` and a `turn not remembered` line is nearby, the write to Memory was refused: the execution role's permissions, or throttling (5 conversational events per second for one session of one actor). If `remembered` is `true` and the agent still forgets, suspect the reading from Memory.

**The first response after a pause is slow.** The microVM ended while idle and is being created again for the next invocation. That is the configured behaviour.

**Failures on the model's side.** Throttling, no access to the model, a stream cut midway: these look as they did in chapter 36, and show up in the `code` of an `error` event.

## For Production

<!-- section: 50.production -->

- **A budget per user.** Chapter 36 had a ledger that stops a user's spending for the day. This chapter's example does not include it. The loop's limits (turns and tokens per question) apply, but nothing limits the number of questions. Anyone who is signed in can call as often as they like, so add chapter 36's ledger in the same form
- **A guardrail.** Chapter 36's guardrail is not attached in this example either. Pass its ID and version in `RequestOptions` and the same loop uses it
- **Outgoing traffic.** An agent with `networkMode` set to `PUBLIC` can reach the internet. This chapter's tools only read, but a way out is a way for a model that follows instructions written in a note to carry the note's content off. Placing the agent in a VPC and narrowing the exits is the subject of [chapter 63](/en/chapters/63-agent-sandbox.md)
- **Close the path that passes a user ID in a header.** The guide recommends an explicit deny of `bedrock-agentcore:InvokeAgentRuntimeForUser` in the callers' policies
- **A real client.** This chapter's client can sign in only through the admin API. For an app whose users sign in themselves, put chapter 06's client and issuer in the authorizer
- **Versions and endpoints.** The Runtime creates a new version on every update, and the `DEFAULT` endpoint always points at the latest. Make production's entrance an endpoint of your own pinned to a version, and switch it in stages as in [chapter 31](/en/chapters/31-progressive-delivery.md)
- **Traces.** To see spans, turn on CloudWatch Transaction Search and instrument the code with ADOT. The documentation says ADOT for Node.js works only with CommonJS output. Keeping that path open is one more reason this chapter's bundle is CommonJS
- **Keeping and deleting memory.** Events are set to expire after 30 days. Prepare the steps that delete an actor's events (`DeleteEvent`) for when a user asks for deletion. To hold the encryption key yourself, give the Memory a KMS key
- **Give clients the session ID rule too.** Browser code does the same computation as `newSessionId` with Web Crypto

## Cleanup

<!-- section: 50.cleanup -->

```bash
vp run agentcore:infra:destroy
```

Some things remain outside the stack.

- The log groups the Runtime created (those starting with `/aws/bedrock-agentcore/runtimes/`). They are not resources of the stack and are not deleted. Delete them in the console or with `aws logs delete-log-group`
- The service-linked role `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity`. It costs nothing
- The ZIP in the bucket where cdkd put the asset

The user pool and the table are set to be deleted with the stack (`RemovalPolicy.DESTROY`), as practice resources. Change that for production. Whether the events inside a Memory are gone as soon as the Memory is deleted was not checked.

What happens when a Runtime is deleted while a session is in progress was not checked either. Wait 5 minutes before deleting and, with this chapter's settings, no session should be left.

## As a Distributed System

<!-- section: 50.distributed -->

Here is who owns which state. DynamoDB owns the notes, and the agent only reads them. AgentCore Memory owns the record of a conversation, and the state in the process is a copy of it. The Cognito token is what knows who the user is, and a session ID is only a label that can be computed from it.

There are two invariants.

The first: an agent acting for a user reaches only that user's notes and conversation. The tests that try to break it are in `test/boundary.test.ts`. They try, in order, naming the owner in the body, a different user calling next in the same process, a model that follows instructions written in a note, using another user's session ID, and using it right after the microVM was replaced, and in every case check that the content of Bob's note appears neither in a request to the model nor in a response.

The second: what the process remembers equals the fold of the events the store accepted. `test/memory.test.ts` tries a store that refuses a write, the same write arriving twice, two answers finishing together, and the process being replaced.

What the types hold is that every call of the store needs an actor, and the shape of an event. That the right user is passed as the actor is not something types can hold; the tests watch it. That the Runtime really keeps microVMs apart, and that Memory really keeps each actor's events apart, are statements of the documentation, not something this chapter's tests established.

The write to Memory happens inside the same request that delivers the answer to the user. A slow write delays the final `done` event by as much. Writing later would make the response faster, and would open a moment in which the user asks the next question and the previous exchange is not there yet. This chapter chose the delay.

::: details Verification notes for this chapter

**Checked locally.** (2026-10-13)

- `vp test run examples/50-agentcore`: 8 files, 51 tests passed. The HTTP contract, reading the user, session IDs, folding memory, the mapping to Memory's events, the invocation URL, and stack assertions
- The type check (`tsc --noEmit`) passed
- `vp run agentcore:infra:synth`: a template with 7 resources and 7 outputs, and the ZIP with `app.js`. AWS was not asked anything
- `vp run agentcore:bundle:check`: `app.js` (1,750.8 KiB) was started with Node.js 24, and `/ping` answering 200 and `/invocations` without a token answering 401 were checked
- `vp run dev:agentcore` was started and the curl commands on [Run It Locally](/en/chapters/50-agentcore/local.md) were run. The output shown there is from that run

**Not checked yet.**

- The stack has never been deployed to AWS. Unverified: that cdkd 0.296.28 creates the Runtime and the Memory through Cloud Control API, that the ZIP's `app.js` starts on Node.js 22, that the execution role's permissions are enough (the X-Ray statements are left out), and how MMDSv2 is handled
- The shape of the request that reaches the agent (the `Authorization` header and the session header arriving under those names), server-sent events flowing through to the caller as they are, and the agent's 4xx becoming 424 are statements of the documentation
- That the AWS SDK finds the execution role's credentials inside the microVM with no configuration was not checked
- That AgentCore Memory accepts events of this chapter's shape (two conversational payloads and metadata), that `clientToken` removes duplicates, and that it accepts a Cognito `sub` and this chapter's session ID as actor and session IDs were not checked
- No model was called. The content of answers, the token counts and the costs are the transcripts' values
- The CPU time and memory in the cost estimate are assumptions. The Tokyo price of short-term memory is not confirmed

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The HTTP contract | `examples/50-agentcore/src/agent.ts`, `src/contract.ts`, `test/agent.test.ts` | `test:unit` |
| Who is calling | `src/identity.ts`, `test/identity.test.ts` | `test:unit` |
| Session IDs | `src/session-id.ts`, `test/boundary.test.ts` | `test:unit` |
| Memory | `src/session.ts`, `src/history.ts`, `src/memory-store.ts`, `src/memory-events.ts`, `src/agentcore-memory.ts`, `test/session.test.ts`, `test/memory.test.ts`, `test/memory-events.test.ts` | `test:unit` |
| The stack | `infra/lib/agentcore-stack.ts`, `infra/lib/bundle.ts`, `infra/test/agentcore-stack.test.ts` | `agentcore:infra:synth`, `test:unit` |
| Running locally | `src/dev.ts`, `src/local-model.ts`, `scripts/check-bundle.ts` | `dev:agentcore`, `agentcore:bundle:check` |
| Deploying | `infra/bin/app.ts`, `scripts/invoke.ts`, `src/invoke-request.ts` | `agentcore:infra:deploy`, `agentcore:invoke`, `agentcore:infra:drift`, `agentcore:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- The whole: [Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html), [Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html), [Quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html), [Release notes](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/release-notes.html), [the general availability announcement](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-is-now-generally-available/)
- Pricing: [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/), [AWS Price List (AmazonBedrockAgentCore, Tokyo)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/ap-northeast-1/index.json)
- Runtime: [Runtime overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html), [key components and platform versions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html), [HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html), [sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html), [Inbound Auth and Outbound Auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html), [the header allowlist](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-header-allowlist.html), [security best practices](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html), [execution role permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html)
- Deploying code: [direct code deployment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy.html), [Node.js](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html), [supported runtimes](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-code-deploy-supported-runtimes.html), [AgentCore CLI](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-cli-reference.html)
- API: [CreateAgentRuntime](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateAgentRuntime.html), [LifecycleConfiguration](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_LifecycleConfiguration.html), [CreateMemory](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateMemory.html), [IAM actions and condition keys](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-agentcore.html)
- Memory: [memory types](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-types.html), [terminology](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-terminology.html), [built-in strategies](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/long-term-configuring-built-in-strategies.html), [fine-grained access control through a Gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-gateway-fgac.html)
- Gateway, Identity, Observability, harness: [target types](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-supported-targets.html), [Lambda targets](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-add-target-lambda.html), [header propagation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-headers.html), [workload access token](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/get-workload-access-token.html), [service-provided data](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-service-provided.html), [where the logs are](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-view.html), [harness](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness.html), [harness tools](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-tools.html)
- Pinned packages: `aws-bedrockagentcore` in `aws-cdk-lib` 2.273.0 (type definitions and source), `@go-to-k/cdkd` 0.296.28 (the provider registration in `dist`), `@aws-sdk/client-bedrock-agentcore` 3.1149.0 (type definitions)
- Comparison: [Cloudflare Agents](https://developers.cloudflare.com/agents/), [What are agents](https://developers.cloudflare.com/agents/concepts/what-are-agents/), [Agents limits](https://developers.cloudflare.com/agents/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Sandbox SDK](https://developers.cloudflare.com/sandbox/), [AI SDK: agents](https://ai-sdk.dev/docs/agents/overview), [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox), [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing), [Vercel Workflow](https://vercel.com/docs/workflow)

:::
