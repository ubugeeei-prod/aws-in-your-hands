---
title: "17 AI: Deploy"
---

# 17 AI: Deploy

## Getting ready for AWS

<!-- section: 17.infra -->

The Lambda handler.

<<< @/examples/17-ai/src/lambda.ts{handler}

The `handle` from chapter 04 has become `streamHandle`. It is Hono's adapter for Lambda, and it writes the response body out to Lambda's response stream. I confirmed in the type definitions and the source that it is in hono 4.13.13, the version this book pins. The source also carries a deprecation mark: `hono/aws-lambda` goes away in v5, in favor of `@hono/aws-lambda`. Remember that when you raise the version.

### Permissions

<<< @/examples/17-ai/infra/lib/ai-stack.ts{role}

The action needed to call `ConverseStream` is `bedrock:InvokeModelWithResponseStream`. The API name and the action name differ, which is confusing at first. `Converse` is `bedrock:InvokeModel`. This function never calls `Converse`, so it does not get that one.

The resources are just the profile from earlier and the models at its destinations. The model statement carries a condition that narrows it to "only when called through this profile". The tests check that this is the only action and that no resource contains `*`.

### The function

<<< @/examples/17-ai/infra/lib/ai-stack.ts{function}

A word on `timeout`. This is where Lambda differs most from your machine.

The Lambda documentation says this: a streamed response is not interrupted when the invoking client's connection is broken, and you are billed for the full function duration.

On the local development server, disconnecting produced `cancelled`. On Lambda it does not. Reading the source of Hono's `streamHandle`, I found nothing that connects a failed write to cancelling the response body either. So on Lambda, assume the model keeps writing to the end even after the caller is gone.

Three things do stop it: `maxTokens` (the output limit), the app's deadline (30 seconds), and the function's `timeout` (40 seconds). The function's `timeout` is longer than the deadline to leave the app time to send its `error` event and finish. A test guards that ordering.

All three are brakes on a single call. Nothing stops how many run at once, or how many calls a month brings. If a script that can sign gets stuck in a loop, the only thing left is the account's Bedrock quota, and this book does not know its value.

So a cap on how many run at once is there for the asking.

<<< @/examples/17-ai/infra/lib/ai-stack.ts{reserved}

```bash
vp run ai:infra:deploy -c reservedConcurrency=2
```

This is Lambda's reserved concurrency. With 2, at most two summaries run at the same time. Lambda refuses the third without running the function.

There is a reason it is not on by default. Reserving sets N aside out of the account's total concurrency. A new account can have a total so low that the reservation alone fails the deploy. That cannot be checked here, so it happens only when you ask. While you are the only caller, trying it by hand, leave it off. Turn it on before anything other than you calls the URL: another backend, a schedule, CI.

### The URL

<<< @/examples/17-ai/infra/lib/ai-stack.ts{url}

`AWS_IAM` and `RESPONSE_STREAM`. The stack contains no `AWS::Lambda::Permission` at all, which means no resource-based policy hands anyone the right to call. A test pins that down too.

## Deploy and call

<!-- section: 17.deploy -->

```bash
vp run ai:infra:diff
vp run ai:infra:deploy
```

When it finishes, `FunctionUrl` shows a URL of the form `https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/`.

You cannot call this URL with plain `curl`, because it needs a signature.

<<< @/examples/17-ai/scripts/sign.ts{sign}

```bash
vp run ai:smoke
vp run ai:logs
```

`ai:smoke` is billed. It first calls without a signature and checks that it is refused. Then it calls with one and receives a summary. It also prints when each `delta` arrived. If the first `delta` and the last arrive at the same moment, something along the path is buffering the response. Streaming does not happen just because the server writes a little at a time. It happens only when everyone in between passes it along without holding it.

The outline's "verify through a CDN and a browser" was not done: this chapter's setup has neither.

To change the model:

```bash
vp run ai:infra:deploy -c modelId=global.amazon.nova-2-lite-v1:0
```

Drift detection is the same as in chapter 02.

```bash
vp run ai:infra:drift
```
