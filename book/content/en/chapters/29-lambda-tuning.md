---
title: "29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles"
sourceRevision: 1
---

# 29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles

Since chapter 04, the notes API has run in a Lambda function. It has 256 MB of memory, a 10-second timeout, and a bundle built with esbuild's defaults: the values chosen on the first day, never revisited.

This chapter looks at what happens inside Lambda before your handler is called, and changes the things that can be changed there, one at a time. There are five: the size of the bundle, the code outside the handler, memory, concurrency, and timeouts. Layers and extensions are covered only as far as a decision needs.

One thing up front: no time in this chapter was measured on Lambda. What was checked locally is the size of the bundle in bytes, the time a Mac takes to load that bundle, the arithmetic, and the tests. Time on a laptop is not time on Lambda. The steps for measuring in AWS are prepared, but they have not been run.

You need [chapter 04](/en/chapters/04-http-api.md) and [chapter 19](/en/chapters/19-observability.md). The code is in `examples/29-lambda-tuning/`.

## The whole picture

<!-- section: 29.overview -->

Lambda runs a function inside an execution environment. When a request arrives and no environment is free, Lambda creates a new one and initializes it before calling the handler. An invocation that waits for that initialization is a cold start.

```figure
caption: The first request waits for an environment to be prepared and initialized; the second runs only the handler in the same environment
type: sequence
actor caller: API Gateway
actor lambda: Lambda
actor env: Execution environment
step caller -> lambda: first request
step lambda -> env: create, place the code
step env -> env: Init: code outside the handler
step env -> env: Invoke: the handler
step env --> caller: response
note env: frozen, waiting for the next
step caller -> lambda: second request
step lambda -> env: reuse the environment
step env -> env: Invoke: the handler
step env --> caller: response
```

In the Init phase Lambda does three things: it starts the extensions, starts the runtime, and runs the function's static code. Static code means the part of the file that is outside the handler. The Init phase is limited to 10 seconds; if it does not finish, it is retried at the first invocation, within the function's timeout.

In this chapter's function the boundary is in these two places.

<<< @/examples/29-lambda-tuning/src/lambda.ts{init}

<<< @/examples/29-lambda-tuning/src/lambda.ts{handler}

`composeTunedApp` assembles the application from chapter 05; checking the environment variables and creating the DynamoDB client both happen inside it. It runs once per execution environment. The handler runs on every invocation. `withDeadline` puts a deadline a little before the function timeout, and [Build, Continued](/en/chapters/29-lambda-tuning/more.md) explains it.

When an invocation ends, Lambda freezes the environment and keeps it for a while. If another request comes, the environment is thawed and reused, so the clients and connections created outside the handler are still there. How long it is kept is not fixed. The documentation says that Lambda terminates environments every few hours, even for functions that are invoked continuously.

One environment handles one request at a time. If another request arrives while it is busy, Lambda creates another environment. Cold starts therefore happen not only after a quiet spell but also when more requests arrive at once.

On how often cold starts happen and how long they take, the documentation says that they typically occur in under 1% of invocations and last from under 100 milliseconds to over a second. Those are AWS's numbers, not something this chapter confirmed with its own function.

The settings you can change, and where each one acts, are these.

```figure
caption: The five settings this chapter changes, and where each one acts
direction: right
node bundle: Bundle | size, choice of dependencies
node outside: Code outside the handler | clients, checking the configuration
node memory: Memory | CPU and unit price
node timeout: Timeout | shorter than the caller's
node conc: Concurrency | reserved, provisioned
node init: Init phase
node invoke: Invoke phase
node envs: Number of environments
edge bundle -> init
edge outside -> init
edge memory -> init
edge memory -> invoke
edge timeout -> invoke
edge conc -> envs
```

The stack has the same table and API as chapters 05 and 19, and takes memory and concurrency as `-c` options. Deployed with the defaults, it costs nothing while it sits there. Only provisioned concurrency is billed by the hour, and the text marks that place.

## Reading the REPORT line

<!-- section: 29.report -->

Lambda writes one record to the log each time an invocation ends. It is there without any setup, so tuning can start by reading it. In the default log format, plain text, it is a line like the following. This one is quoted from the documentation.

```text
REPORT RequestId: b70435cc-261c-4438-b9b6-efe4c8f04b21 Duration: 3004.92 ms Billed Duration: 3117 ms Memory Size: 128 MB Max Memory Used: 33 MB Init Duration: 111.23 ms
```

`Duration` is the time spent in the handler; initialization is not in it. `Init Duration` is the time initialization took, and it appears only when this invocation initialized the environment, that is, on a cold start. Whether the field is present is how you count cold starts.

`Billed Duration` is the time you are charged for. In the example it is 3117: 3004.92 plus 111.23, rounded up to a millisecond. Initialization is billed too. For functions that use a managed runtime and are packaged as a ZIP file, initialization on on-demand invocations used to be free; since August 1, 2025 it is billed for every kind of function.

`Memory Size` is the memory you configured and `Max Memory Used` is the most that was actually used. If the two are close, the function is short of memory; if they are far apart, you may be able to configure less.

Chapter 19's stack set the log format to JSON for its metric filter, and this chapter's stack does the same. In the JSON format the same record is an object of type `platform.report`, and its fields have names.

<<< @/examples/29-lambda-tuning/src/report.ts{shape}

`scripts/report.ts` reads both formats. A REPORT line that lacks a required field is an error, not something to skip: if the format changes, you should hear about it instead of getting statistics computed from what was left.

Locally you can summarize the lines copied from the documentation.

```bash
vp run tune:report:sample
```

```text
invocations       5
cold starts       4 (80.0%)
initialization    p50 111.2 ms, p95 1236.0 ms, max 1236.0 ms (6)
handler, cold     p50 693.9 ms, p95 3016.8 ms, max 3016.8 ms (4)
handler, warm     p50 933.6 ms, p95 933.6 ms, max 933.6 ms (1)
memory            84 MB used at most, of 128 MB
billed            8060 ms, 1.008 GB-seconds
not successful    2
```

This output summarizes a collection of examples from the documentation. Most of them are timeouts and crashes, so the numbers themselves mean nothing. What matters is the list of rows: run `vp run tune:report` against a deployed function and you get your own function's numbers in the same shape.

### How this differs from chapter 19's logs

Chapter 19's logs carry a `durationMs` for each request. The application measures it itself, from routing to building the response. The REPORT's `Duration` is the time of the whole handler, so on top of the application's `durationMs` it includes turning the event into a `Request` and turning the response into the result object. Neither includes initialization.

The closest thing to what the user waited is API Gateway's `Latency`, the metric chapter 19 put an alarm on. To study cold starts, use them separately: `Init Duration` in the REPORT tells you how often and how long, and the p95 and p99 of `Latency` at the entrance tell you what it did to users.

One thing about `Init Duration` could not be read from the documentation. It lists the three tasks of the Init phase given above, but does not say whether downloading the code and starting the environment, which come before them, are part of `Init Duration`.

After a failure there is one more initialization that is hard to see. When an invocation ends in a timeout or a crash, Lambda resets the environment and initializes it again at the next invocation. That initialization is not reported on a line of its own; it is part of the next invocation's time. When the request right after a timeout is slow, suspect this.

## When tuning is not needed

<!-- section: 29.when-not -->

The best outcome of this chapter is that you do none of it. If any of the following applies, stop before going on.

If you have no complaint about the p95 and p99 of `Latency` at the entrance, there is no reason to reduce cold starts. If they are under 1% as AWS describes, they hardly show in the p95 or the p99; only the maximum shows them.

If cost is the goal, look at the amount first. With chapter 04's assumptions of 1,000,000 invocations a month at 256 MB and 50 milliseconds each, Lambda costs **0.37** at list price and 0 after the free tier. At that scale, halving the memory saves about 0.08 a month. Tuning for cost starts to matter when a function is invoked tens of millions of times a month, or when each invocation is long.

The order matters too. This chapter goes from what costs nothing to what costs money. Making the bundle smaller and reviewing the code outside the handler are free. Memory is changed after measuring in AWS. Provisioned concurrency is billed by the hour, so it comes last.

If the requirement comes first, such as answers that always stay within tens of milliseconds or connections that stay open, comparing an always-running setup like the containers of [chapter 12](/en/chapters/12-containers.md) may be quicker than tuning a function. The comparison with a platform whose unit of execution is different, such as Cloudflare Workers, is on the [last page](/en/chapters/29-lambda-tuning/wrap.md).

The next page, [Design and Build](/en/chapters/29-lambda-tuning/build.md), covers the bundle, the code outside the handler, and memory, in that order.
