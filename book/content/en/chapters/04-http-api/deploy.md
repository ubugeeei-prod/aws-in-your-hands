---
title: "04 HTTP API: Deploy"
---

# 04 HTTP API: Deploy

## Getting ready for AWS

<!-- section: 04.infra -->

From here on it's CDK. Let's go through it in order.

### Where the logs go

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

There's a reason for going to the trouble of creating this yourself. If you don't, Lambda creates one for you the first time the function runs, but that log group has no retention limit and stays behind when you delete the stack. The storage keeps costing money, and you lose track of which stack it belonged to.

### What the function is allowed to do

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

The execution role is the set of permissions the function uses when it runs inside AWS. It's **separate from your own permissions**, so "the `aws` command works on my machine but gets denied inside Lambda" is a perfectly normal thing to run into.

If you say nothing, CDK attaches a managed policy called `AWSLambdaBasicExecutionRole`. Here's the catch: that policy can write to any log group in the account. So here you create the role yourself and allow it to write to the log group from a moment ago, and nothing more. The tests also check that only two actions are allowed and that the resource isn't `*`.

When chapter 05 adds DynamoDB, the table's permissions get added to this role. "What can this function do?" is answered by reading these few lines. That's the state we want to keep.

### The function

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

At synth time, `NodejsFunction` bundles the TypeScript into a single JavaScript file with esbuild. No Docker involved.

`timeout` is set to 10 seconds. An HTTP API waits at most 30 seconds for Lambda's response, and that limit can't be raised. Run longer than that and you're only paying for work nobody is waiting for anymore.

`architecture` is arm64. In the Tokyo Region, its unit price for duration is lower than x86 (USD 0.0000133334 versus USD 0.0000166667 per GB-second).

### The API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

The routes are listed one by one. You could also write "pass every path to Lambda", but then the function starts, and costs money, even for requests to paths that don't exist. With the routes listed, API Gateway answers everything else with a 404.

The price is that the routes are now written in two places: the Hono app and this stack. It would be a problem if they drifted apart, so a test keeps watch that "the stack's routes are exactly these five".

CORS is the setting that lets a browser call the API from a different origin. Only one origin is allowed. The default is the SPA's development server.

## Deploy it and call it

<!-- section: 04.deploy -->

```bash
vp run api:infra:diff
vp run api:infra:deploy
```

When it finishes, `ApiUrl` shows a URL of the form `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`.

```bash
curl -s https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/health
vp run api:smoke
```

If you want the chapter 03 SPA to be able to call it, deploy again and pass the SPA's URL.

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

Hooking the SPA's screens up to this API comes a little later. Put in-memory notes on the screen and, as you saw a moment ago, all you'd get is a different result on every reload. Chapter 05 gives the notes somewhere to be saved, and chapter 06, where we can tell whose notes are whose, makes the connection.

## Look at the logs

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

This task picks up the log group's name from the stack outputs and runs `aws logs tail`.

The app writes one line of JSON per request. With Lambda's default log format, a timestamp and Lambda's request ID are put in front of it, so one entry in CloudWatch Logs is "a prefix plus JSON" ([chapter 19](/en/chapters/19-observability.md) comes back to this).

<<< @/examples/04-http-api/src/log.ts{logger}

When you want to chase a single request, note the response's `x-request-id` header (or, for an error, the `requestId` in the body) and search the logs for that value. You'll find `status`, `durationMs`, and, for an error, the stack trace in `error`. A test confirms that the same ID shows up in all three places: the response header, the error body, and the log.

Lambda itself also writes `START`, `END`, and `REPORT` lines for every invocation. `REPORT` has the duration, the billed duration, and the maximum memory used. On a cold start, `Init Duration` is there too. Metrics and alarms are covered in [chapter 19](/en/chapters/19-observability.md).

The drift check is the same as in chapter 02.

```bash
vp run api:infra:drift
```
