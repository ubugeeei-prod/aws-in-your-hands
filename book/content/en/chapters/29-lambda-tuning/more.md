---
title: "29 Lambda Tuning: Build, Continued"
---

# 29 Lambda Tuning: Build, Continued

The [previous page](/en/chapters/29-lambda-tuning/build.md) covered what you can change inside one execution environment. This page covers concurrency, which decides how many environments are needed, and timeouts that fit the caller, and ends with layers and extensions.

## Concurrency

<!-- section: 29.concurrency -->

In Lambda, concurrency is the number of requests being processed at one moment. One environment processes one request at a time, so concurrency is also the number of environments needed at once. It is a different quantity from requests per second, and the documentation gives this formula to estimate it.

<<< @/examples/29-lambda-tuning/src/concurrency.ts{formula}

At 100 requests a second taking 0.5 seconds each, the concurrency is 50. At the same 100 a second taking 1 second each, it is 100. Environments multiply when processing gets slower, without one more request arriving.

This stack's API accepts 10 requests a second at most, because of the stage throttle. At 50 milliseconds each, the average concurrency is 0.5. But if DynamoDB stops answering and every request waits for the 9-second deadline, the same 10 a second become 90. Environments multiplying when something downstream slows is a common shape of a Lambda incident.

To check this relation locally there is a small model.

<<< @/examples/29-lambda-tuning/src/concurrency.ts{simulate}

The model follows only the rules written in the documentation. It uses a free environment if there is one, creates a new one if there is not, and refuses the request if the limit is reached. An environment is busy during its initialization too, so if the next request arrives while the first is waiting for 300 milliseconds of initialization, a second cold start happens. The tests pin three things: that the same arrivals need more environments when the handler is slower, that requests beyond the reserved concurrency are refused, and that requests beyond the provisioned concurrency become cold starts.

Two things the model does not reproduce: when unused environments are removed, and the limit on how fast environments can be added.

### The account's limit

Concurrency has a limit per account and Region. The default is 1,000, shared by all the functions in that Region. The documentation says that new accounts start lower and are raised automatically based on usage; it does not say how low. Check your own account's value with the following command, or in Service Quotas.

```bash
aws lambda get-account-settings
```

There are two more limits. One is on requests per second: ten times the concurrency. A function whose requests take less than 100 milliseconds hits this before it hits concurrency. The other is on how fast a function can scale: 1,000 environments per 10 seconds for each function (both as read on 2026-10-13).

Whichever limit is hit, Lambda throttles the request and refuses it with a 429. A refused invocation is counted in neither `Invocations` nor `Errors`; it shows in the `Throttles` metric. What status API Gateway then returns to the user was not confirmed in this chapter.

### Reserved concurrency

Reserved concurrency sets concurrency aside for a function. The number becomes that function's ceiling and, at the same time, a floor that no other function can use. It costs nothing.

It has two uses. One is as a brake, to protect what is downstream and to protect the bill. In the example above, with 5 reserved, the environments stop at five even when DynamoDB stalls. The other is as a guarantee, so that an important function can run even when other functions have used up the account's pool. With 0, the function processes nothing at all; the documentation names this as the switch for stopping a runaway function.

You can reserve up to the account limit minus 100, because Lambda always keeps 100 for functions without a reservation. In an account whose limit is 100 or less, therefore, nothing can be reserved.

<<< @/examples/29-lambda-tuning/infra/bin/app.ts{context}

This is why the stack does not reserve by default and does so only when given `-c reservedConcurrency=5`. Chapters 17 and 21 treat it the same way.

### Provisioned concurrency

Reserved concurrency only sets a number aside; it prepares no environments. Provisioned concurrency keeps environments initialized in advance. Up to the number you set, requests do not wait for initialization.

<<< @/examples/29-lambda-tuning/infra/lib/tuning-stack.ts{provisioned}

Provisioned concurrency cannot be set on `$LATEST`; it goes on a version or an alias. If the caller does not point at that alias, the prepared environments are never used. So when the option is given, the API's integration is switched to the alias. Versions and aliases themselves were covered in chapter 20.

Four things to know.

- Requests beyond the number are not refused; they go to ordinary on-demand environments, and cold starts happen there. `ProvisionedConcurrencySpilloverInvocations` counts them
- Used together with reserved concurrency, the provisioned number must not exceed the reserved one
- Provisioned concurrency does not guarantee the end of cold starts. The documentation says one can still occur when Lambda resets an environment
- The initialization code runs when the environments are prepared and when Lambda recycles them, and is billed even if not a single request arrives

And it is billed by time. **Provisioned concurrency costs money just by being there.** One environment at 256 MB is 2.83 a month. Two at 1,024 MB are 22.64. The Lambda free tier does not apply to a function with provisioned concurrency enabled.

The price of what you use changes too: time spent running in a provisioned environment is charged at a lower rate than on-demand. Put the two together and you can compute how much use it takes to break even.

<<< @/examples/29-lambda-tuning/src/cost-inputs.ts{provisioned}

For arm64 in the Tokyo Region, on-demand is 0.0000133334 per GB-second, keeping provisioned concurrency is 0.0000043068, and running on it is 0.0000100492. Keeping plus running is 0.0000143560, more than on-demand. Even used without a pause for a whole month, it comes to about 8% more than on-demand. The share of the month at which it breaks even is 131%, and there is no such month. The result for x86 is the same.

In the Tokyo Region, then, the unit prices give no reason to choose provisioned concurrency to save money. What it buys is response time and nothing else. The documentation names Application Auto Scaling as a way to enable it only for the hours that need it; this chapter does not cover that.

## Timeouts in order

<!-- section: 29.timeouts -->

A request passes through several places in turn, and each has a limit on how long it waits. If an outer one gives up first, the inner ones go on with work nobody will receive.

```figure
caption: Arrange them so that the outer ones wait longer. If an inner one gives up first, the outer ones receive an answer in the proper shape
node client: Client
node api: API Gateway HTTP API | 30 seconds at most, fixed
node fn: Lambda function | timeout 10 seconds
node handler: The handler's deadline | 9 seconds
node sdk: One SDK attempt | 1 second to connect + 2 to answer
node table: DynamoDB
edge client -> api
edge api -> fn
edge fn -> handler
edge handler -> sdk
edge sdk -> table
```

<<< @/examples/29-lambda-tuning/src/timeouts.ts{values}

The outermost value cannot be moved. An HTTP API waits for its integration for 30 seconds at most, a quota that cannot be raised. A function's timeout can be set up to 900 seconds, but at 30 or more API Gateway gives up first and returns an error to the user. Whatever the function does after that, nobody receives. How long an abandoned function keeps running and being billed was not confirmed in this chapter. Either way a function belongs below 30 seconds, and it has been at 10 since chapter 04.

What happens on the inside needs a little more explanation. When a function reaches its timeout, Lambda stops the whole environment. The application cannot write an answer, and chapter 19's request line does not appear. Only the lines Lambda itself writes remain, and the REPORT line carries `Status: timeout`. The stopped environment is reset, and the next invocation starts again from initialization.

To avoid that, the application has to give up before the function timeout does it. But as the [previous page](/en/chapters/29-lambda-tuning/build.md) showed, the SDK's timeouts are off by default. Facing a table that does not answer, chapter 05's application waits 10 seconds and is stopped by Lambda.

Two things were done about it. One is the SDK's timeouts: 1 second to connect, 2 seconds to answer, two attempts at most. The other is a deadline for the handler as a whole.

<<< @/examples/29-lambda-tuning/src/deadline.ts{deadline}

Lambda tells you the time remaining through `context.getRemainingTimeInMillis()`. The handler creates an `AbortSignal` for that time less 1 second and calls the application inside it. The second it holds back is for writing the error response and the log line.

The signal is no use unless it reaches the SDK calls. To leave chapter 05's repository untouched, the client is wrapped instead.

<<< @/examples/29-lambda-tuning/src/deadline.ts{client}

`AsyncLocalStorage` is there so that each request has its own signal. An ordinary Lambda function processes one request at a time, so a single variable would do there, but the local server processes several at once. A test confirms that one request's deadline does not stop another.

When the deadline comes, the SDK call ends with an exception. Chapter 05's application catches it, returns a 500 in its usual shape, and writes the stack trace to the log. The user receives an answer with a request ID, and the log says what was stopped. A 503 would be closer in meaning, but chapter 05's contract has no such distinction, and the contract was left as it is.

A function checks that the order has not been broken.

<<< @/examples/29-lambda-tuning/src/timeouts.ts{http}

It checks four things: that the function ends before its caller stops waiting, that time is kept back to write an answer, that the SDK's timeouts are not left off, and that one SDK attempt fits within the deadline. The stack's test passes the function timeout from the template through this check. The waits between retries are not in the calculation; stopping the whole is the deadline's job. The design of retries themselves is in [chapter 32](/en/chapters/32-limits.md).

### A function that reads a queue

When the caller is a queue, what you compare changes. For a function that reads SQS, like chapter 08's worker, the function timeout goes next to the queue's visibility timeout.

<<< @/examples/29-lambda-tuning/src/timeouts.ts{queue}

The documentation recommends a visibility timeout of at least six times the function timeout, plus the batch window if you use one. That leaves time for Lambda to retry when the function is throttled. A combination where the function timeout is the longer one is refused when the event source mapping is created. Chapter 08 gives a 30-second function a visibility timeout of 180 seconds, which follows the rule.

## Layers and extensions

<!-- section: 29.layers -->

A layer is an extra .zip attached to a function. Its contents are extracted into `/opt` in the execution environment. The uses the documentation lists are sharing dependencies between functions, keeping deployment packages small, and pinning the version of the SDK that comes with the runtime. A function can have five at most, and the layers count toward the 250 MB unpacked limit.

This chapter's function uses no layer. All its dependencies are bundled into one file, and there is nothing to share them with. For a bundled Node.js function a layer only adds files to load. A layer is needed when you attach something you cannot bundle yourself; the OpenTelemetry layer that chapter 19 attached as an option was an example.

An extension is a separate program that runs in the same execution environment as the function. Monitoring and security tools distribute them as layers. For tuning, there are three things to know.

- An extension shares CPU, memory and storage with the function
- Lambda does not call the handler until every extension has finished initializing. An extension that is slow to initialize makes cold starts slower by that much
- The time an extension runs is billed too. The time extensions use after the handler has returned shows in the `PostRuntimeExtensionsDuration` metric

When you add a layer or an extension, compare the REPORTs from before and after. The documentation, too, recommends running the version with it and the version without it side by side to learn its effect.

The next page, [Run It Locally](/en/chapters/29-lambda-tuning/local.md), runs the code so far on your machine and shows what can and cannot be measured there.
