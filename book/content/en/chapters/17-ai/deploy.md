---
title: "17 AI: Deploy"
---

# 17 AI: Deploy

On this page you put the API you [ran locally](/en/chapters/17-ai/local.md) on Lambda and call it through a function URL. The page goes through the definitions of the permissions, the function, and the URL, and then deploys.

## Getting ready for AWS

<!-- section: 17.infra -->

The Lambda handler is as follows.

<<< @/examples/17-ai/src/lambda.ts{handler}

The `handle` from chapter 04 has become `streamHandle`. `streamHandle` is Hono's adapter for Lambda, and it writes the response body to Lambda's response stream. The type definitions and the source confirm that `streamHandle` is in hono 4.13.13, the version this book pins. The source also carries a deprecation notice saying that `hono/aws-lambda` goes away in v5 and moves to `@hono/aws-lambda`. Check it when you raise the version.

### Permissions

<<< @/examples/17-ai/infra/lib/ai-stack.ts{role}

The action needed to call `ConverseStream` is `bedrock:InvokeModelWithResponseStream`. The API name and the action name differ, which is confusing at first. The action `Converse` needs is `bedrock:InvokeModel`, but this function never calls `Converse`, so the role does not have it.

The resources are only the profile worked out in [The ARNs in the execution role](/en/chapters/17-ai.md) and the models at its destinations. The models carry a condition that allows only calls made through this profile. The tests confirm that this is the only action and that no resource contains `*`.

### The function

<<< @/examples/17-ai/infra/lib/ai-stack.ts{function}

`timeout` has to do with the point where Lambda behaves most differently from the local development server.

The Lambda documentation says that a streamed response is not interrupted when the invoking client's connection is broken, and that you are billed for the full function duration.

On the local development server, disconnecting produced `cancelled`. It follows that on Lambda it does not. The source of Hono's `streamHandle` has no code that connects a failed write to aborting the response body either. So on Lambda, assume that the model keeps writing to the end even after the caller is gone.

Three things stop the model: `maxTokens` (the output limit), the app's deadline (30 seconds), and the function's `timeout` (40 seconds). The function's `timeout` is longer than the deadline to leave the app time to send its `error` event and finish, and a test guards that ordering.

All three limit a single call. Nothing limits how many calls run at once, or how many arrive in a month. If a script that gets past the signature check goes into a loop, the only thing left to rely on is the account's Bedrock quota, and this book does not know its value.

For that reason, a limit on how many run at once can be added, and only when you ask for it.

<<< @/examples/17-ai/infra/lib/ai-stack.ts{reserved}

```bash
vp run ai:infra:deploy -c reservedConcurrency=2
```

`reservedConcurrency` sets Lambda's reserved concurrency. With 2, at most two summaries run at the same time, and Lambda refuses the third without running the function.

It is not on by default because adding it can be enough to make the deploy fail. Reserving concurrency sets N aside out of the account's total concurrency. A new account can have a low total, and then the reservation alone can fail the deploy. That cannot be checked here, so the limit is added only when you specify it. While you are the only caller, trying the API by hand, you can leave it off. Add it before you let anything other than yourself call the URL, such as another backend, a scheduled job, or CI.

### The URL

<<< @/examples/17-ai/infra/lib/ai-stack.ts{url}

The authentication is `AWS_IAM` and the invoke mode is `RESPONSE_STREAM`. The stack contains no `AWS::Lambda::Permission` at all, which means that it creates no resource-based policy giving anyone the right to call. A test pins this down too.

## Deploying and calling

<!-- section: 17.deploy -->

```bash
vp run ai:infra:diff
vp run ai:infra:deploy
```

When the deploy finishes, the `FunctionUrl` output shows a URL of the form `https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/`.

This URL needs a signature, so `curl` cannot call it. The following code adds the signature.

<<< @/examples/17-ai/scripts/sign.ts{sign}

```bash
vp run ai:smoke
vp run ai:logs
```

`ai:smoke` is billed. It first calls without a signature and confirms that the call is refused, then calls with a signature and receives a summary. It also prints the time each `delta` arrived, so if the first `delta` and the last have the same time, you know that something along the path is buffering the response. Streaming does not work just because the server writes a little at a time. It works only when everything in between passes the data on without holding it.

The outline written before this chapter included "verify through a CDN and a browser". That was not done, because this chapter's setup has neither a CDN nor a browser.

To change the model, deploy with `modelId` specified.

```bash
vp run ai:infra:deploy -c modelId=global.amazon.nova-2-lite-v1:0
```

Drift detection is the same as in chapter 02.

```bash
vp run ai:infra:drift
```
