---
title: "04 HTTP API: Deploy"
---

# 04 HTTP API: Deploy

This page puts the app you [ran locally](/en/chapters/04-http-api/local.md) on AWS. You define the infrastructure with CDK, deploy it, call it, and read its logs.

## Getting ready for AWS

<!-- section: 04.infra -->

The infrastructure is defined with CDK. The sections below go through the stack from the top.

### Where the logs go

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

There is a reason to create the log group yourself. If you don't, Lambda creates one the first time the function runs, and a log group created that way has no retention limit and stays behind when you delete the stack. Its storage keeps costing money, and you lose track of which stack it belonged to.

### What the function is allowed to do

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

The execution role is the set of permissions the function uses when it runs inside AWS. It is **separate from your own permissions**, so it is quite normal for an operation that works with the `aws` command on your machine to be denied inside Lambda.

If you specify nothing, CDK attaches a managed policy called `AWSLambdaBasicExecutionRole`, which can write to any log group in the account. Here you create the role yourself and allow it only to write to the log group created above. The tests check that exactly two actions are allowed and that the resource isn't `*`.

When chapter 05 adds DynamoDB, the table's permissions are added to this role. That keeps the answer to what this function can do readable in these few lines.

### The function

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

At synth time, `NodejsFunction` bundles the TypeScript into a single JavaScript file with esbuild. Docker isn't used.

`timeout` is 10 seconds. An HTTP API waits at most 30 seconds for Lambda's response, and that limit can't be raised. Running longer only means paying for work nobody is waiting for.

`architecture` is arm64. In the Tokyo Region its unit price for duration is lower than x86's (USD 0.0000133334 against USD 0.0000166667 per GB-second).

### The API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

The routes are listed one by one. You could pass every path to Lambda instead, but then a request for a path that doesn't exist would still start the function and cost money. With the routes listed, API Gateway answers every other path with a 404.

The cost is that the routes are written in two places, `createApp` in the app and this stack. To keep the two from drifting apart, a test checks that the stack has exactly these five routes.

CORS is the setting that lets a browser call the API from a different origin. API Gateway answers the preflight, so the same methods and headers the app gives `cors` are written here as well. One origin is allowed, and by default it is the SPA's development server.

### Limit what it accepts

Anyone can call this API, and you pay for every call. If you do nothing, whatever a bot sends goes straight onto your bill.

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{throttle}

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{stage}

This sets throttling on the stage. The stage accepts up to 10 requests a second, with bursts up to 20. API Gateway turns away the rest with a 429 and doesn't invoke the function. The `HttpApi` construct has no option for this setting, so the code takes the stage the construct created and writes the setting on it directly.

The 10 is one value for the whole API, not one per caller. If somebody else is using up the 10 a second, your requests get a 429 as well. Throttling protects your bill, not the experience of using the API. Because 10 is a practice value, choose your own before real users arrive.

## Deploying and calling

<!-- section: 04.deploy -->

```bash
vp run api:infra:diff
vp run api:infra:deploy
```

When the deployment finishes, `ApiUrl` shows a URL of the form `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`.

```bash
curl -s https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/health
vp run api:smoke
```

To let the chapter 03 SPA call the API, deploy again and pass the SPA's URL.

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

Connecting the SPA's screens to this API comes later. As [Where the notes live](/en/chapters/04-http-api/local.md) showed, in-memory notes on a screen would only change on every reload. Chapter 05 gives the notes a place to be saved, and chapter 06, which can tell whose notes are whose, connects the SPA.

## Look at the logs

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

`api:logs` takes the log group's name from the stack outputs and runs `aws logs tail`.

The app writes one line of JSON per request. Lambda's default log format puts a timestamp and Lambda's request ID in front of it, so one entry in CloudWatch Logs is that prefix followed by the JSON ([chapter 19](/en/chapters/19-observability.md) comes back to this).

<<< @/examples/04-http-api/src/log.ts{logger}

To follow a single request, note the response's `x-request-id` header (for an error, the `requestId` in the body) and search the logs for that value. The log entry has `status` and `durationMs`, and for an error it has the stack trace in `error`. A test confirms that the same ID appears in three places: the response header, the error body, and the log.

Lambda itself writes `START`, `END`, and `REPORT` lines for every invocation. `REPORT` has the duration, the billed duration, and the maximum memory used, and on a cold start it also has `Init Duration`. Metrics and alarms are covered in [chapter 19](/en/chapters/19-observability.md).

The drift check is the same as in chapter 02.

```bash
vp run api:infra:drift
```
