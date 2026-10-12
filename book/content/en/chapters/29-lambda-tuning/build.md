---
title: "29 Lambda Tuning: Design and Build"
---

# 29 Lambda Tuning: Design and Build

The [previous page](/en/chapters/29-lambda-tuning.md) showed where the Init phase ends and the Invoke phase begins, and how to read the REPORT line. This page covers the bundle, the code outside the handler, and memory, cheapest first.

## Making the bundle smaller

<!-- section: 29.bundle -->

A new execution environment first fetches the function's code and unpacks it, then loads it. The documentation names three causes of slow initialization: the size of the package, the amount of initialization code, and the libraries' own setup. A smaller bundle reduces the first two.

What is large can be measured. `vp run tune:bundle` bundles the same function five ways and prints the bytes and the share of each package.

<<< @/examples/29-lambda-tuning/src/bundle/variants.ts{variants}

Bundled with the settings of chapters 05 and 19, the function is 1,350.2 KiB, and less than 50 KiB of that is our own code, Valibot included. Almost all the rest is the AWS SDK. The room to shrink is in the SDK.

### Following module instead of main

What helped most was esbuild's `mainFields`. A package's `package.json` has several fields that point at its entry file. `main` is for Node.js and usually leads to CommonJS. `module` is for bundlers and leads to ES modules.

When esbuild bundles for Node.js, it looks at `main` first. Its documentation says that with this default, tree shaking will likely not happen for packages that provide both `module` and `main`. Tree shaking is the step that drops code nothing uses, and it works only on ES modules. The AWS SDK is exactly such a package, so by default its CommonJS build goes in whole.

<<< @/examples/29-lambda-tuning/src/bundle/variants.ts{shared}

`NodejsFunction` passes `mainFields` to esbuild only when you set it. That was checked in the source of the pinned aws-cdk-lib. So the stack sets it.

<<< @/examples/29-lambda-tuning/infra/lib/tuning-stack.ts{bundling}

Putting `module` first alone takes the bundle from 1,350.2 KiB to 921.6 KiB. What went away is code in the SDK's packages that this application never uses. `@aws-sdk/client-dynamodb` alone went from 189.9 KiB to 56.6 KiB.

esbuild defaults to `main` because some packages put browser code in `module`. Its documentation says to change the order only when you know that is safe. The tests therefore load the finished bundle in plain Node.js and have it send one `GetItem` to a stand-in for DynamoDB, to see the SDK actually work. When you add a dependency, check that this test still passes.

### Minifying

Minifying helped next: 921.6 KiB became 350.6 KiB. Compressed with gzip, 170.0 KiB became 107.4 KiB. A deployment package is a zip archive, so the compressed number is the one closer to what is downloaded.

There is a price. Minifying renames functions and variables to short letters, so the stack traces in your logs become harder to read. Shipping a source map and having Node.js read it brings the names back, at the cost of a larger package. This chapter ships none. Chapter 19's logs carry the request ID and the path, so start from those; when you really need a line number, bundle the same commit without minifying and compare.

### How the client is written

An SDK client can be written in two ways. Chapter 05 creates a `DynamoDBClient` and passes one command per operation (`GetCommand` and so on) to `send`. The other way uses a class that has every operation as a method, such as `DynamoDB` or `DynamoDBDocument`.

With the second, the class holds all the operations, so the bundler cannot drop the ones you do not use. To compare, there is one entry point written that way. It is not deployed.

<<< @/examples/29-lambda-tuning/measure/aggregated.ts

Bundled with the same settings it is 396.2 KiB, 45.6 KiB more. The share of `@aws-sdk/client-dynamodb` goes from 30.0 KiB to 63.6 KiB. For DynamoDB alone that is the size of it; the more operations a service has, the wider the gap.

### Leaving the SDK out

Unless you set `externalModules`, `NodejsFunction` leaves `@aws-sdk/*` out of the bundle, so that the function uses the SDK that Lambda's Node.js runtime already contains. The bundle then shrinks to 21.9 KiB.

Chapter 05 did not choose this; it put the SDK in the bundle with `externalModules: []`. This chapter does the same, for two reasons.

One is the version. According to the documentation, the SDK in the runtime is a specific minor version that depends on the runtime version and the Region, and it is not the latest. Lambda updates it periodically. With the SDK in the bundle, what runs is the version in `pnpm-lock.yaml`. The documentation, too, recommends packaging all your dependencies when you want full control over them.

The other is how the code is loaded. The documentation recommends bundling over shipping dependencies as `node_modules`, because it means fewer file reads. How long loading the runtime's SDK takes on Lambda was not measured in this chapter. In the local measurement the bundle without the SDK loaded slowest, but that number is for reading from `node_modules`, which is laid out differently from the Lambda runtime. The results are on [Run It Locally](/en/chapters/29-lambda-tuning/local.md).

### A test that fails when it grows

One added dependency can double a bundle. Finding that out when cold starts get slower is too late, so there is a ceiling, and a test.

<<< @/examples/29-lambda-tuning/src/bundle/budget.ts{budget}

<<< @/examples/29-lambda-tuning/src/bundle/budget.ts{check}

The bundle is now 358,983 bytes, 109,933 compressed, which leaves about a tenth of headroom. The test looks at the file CDK builds during synth, the one that would be uploaded. Another test confirms that it does not differ by one byte from the bundle `tune:bundle` measures as the deployed one.

When the ceiling is exceeded, the thing to do is not to raise the number but to look at what grew, in the breakdown of `vp run tune:bundle`. Raise the number once you are satisfied with the reason.

Lambda's own limits are 50 MB for a ZIP uploaded directly through the API and 250 MB unpacked. This function is far from them, so the ceiling is not Lambda's constraint; it is a brake we chose ourselves.

## What goes outside the handler

<!-- section: 29.init -->

Code outside the handler runs once per execution environment, and what it creates stays until the next invocation. The documentation recommends creating SDK clients and database connections there.

<<< @/examples/29-lambda-tuning/src/compose.ts{compose}

With the client outside, invocations from the second on are faster. The SDK reuses TCP connections, so connecting to DynamoDB and setting up TLS happen only on an environment's first invocation. The SDK's documentation says that for short operations such as DynamoDB's, setting up the connection can take longer than the operation itself. Creating the client inside the handler would throw that connection away every time.

Some things must not go outside: values that belong to a request, such as a user's data, the contents of an event, or credentials. An environment serves the next user's request too, so a value left in an outer variable is visible to the next invocation. Only what is common to every request goes outside.

Code outside the handler has a cost as well. It runs on every cold start, and that time is billed. With provisioned concurrency it runs when the environments are prepared and is billed even if no request ever comes. The documentation therefore recommends deferring the loading of things only some paths use until they are needed.

This application has nothing to defer: every path uses the same validation and the same table. If you combine into one function routes of which only some use another SDK client, as chapter 07's attachments or chapter 17's summaries do, consider loading that client with `await import()`, or splitting the function.

### ES modules and the first await

The bundle has been in ES module format since chapter 04. The documentation recommends ES modules, and the reason is that you can write `await` at the top level of a file. Asynchronous initialization, such as fetching configuration from outside, can then finish within the Init phase. If it leaves Init unfinished, the rest runs in the middle of the first invocation.

This chapter's function has no asynchronous initialization. Checking the environment variables is synchronous, and the SDK connects to DynamoDB at the first `send`. The first invocation's `Duration` therefore includes the connection time. Calling the table once during initialization would move it into Init, but for an on-demand function that only moves the same time; the user waits just as long.

SnapStart resumes from a snapshot of an initialized environment. It supports Java, Python and .NET; the Node.js runtimes are not supported (as of 2026-10-13).

### The SDK client's settings

The client is given three values the SDK does not decide by default.

<<< @/examples/29-lambda-tuning/src/compose.ts{client}

The connection timeout and the request timeout default to 0, which means off. A call that gets no answer waits until the function timeout. `throwOnRequestTimeout` is needed too: without it, passing the request timeout only logs a warning and the call goes on. All three were checked in the type definitions installed with the SDK. How the values were chosen is in the timeout section of the [next page](/en/chapters/29-lambda-tuning/more.md).

## Choosing the memory

<!-- section: 29.memory -->

Memory can be set from 128 MB to 10,240 MB in steps of 1 MB. The setting means more than its name: Lambda allocates CPU in proportion to memory. 1,769 MB corresponds to one vCPU, so a 256 MB function has, by that proportion, about a seventh of one.

The price is proportional to memory too. The duration charge is the unit price times GB-seconds, which is memory in GB multiplied by billed time in seconds.

<<< @/examples/29-lambda-tuning/src/cost-inputs.ts{billed}

Doubling the memory doubles the price per millisecond. It doubles the CPU as well, so if the duration halves, the cost stays the same and only the answer gets faster. If it falls below half, the function gets cheaper; if it does not fall that far, it gets more expensive.

<<< @/examples/29-lambda-tuning/src/cost-inputs.ts{memory}

Given the current setting and duration, `vp run tune:plan` prints the cost at other settings and the duration at which each would cost the same. This is the memory part.

```text
Memory, for 1000000 invocations a month (list price, USD, ap-northeast-1, arm64)
  now: 256 MB and 50 ms billed per invocation
      MB   if still that long   costs the same at
     128                 0.28            100.0 ms
     256                 0.37             50.0 ms
     512                 0.53             25.0 ms
    1024                 0.87             12.5 ms
    1769                 1.35              7.2 ms
    3008                 2.16              4.3 ms
  Whether the duration falls with more memory is measured in AWS, not computed here.
```

The second column is the monthly cost if the duration stayed at 50 milliseconds. The third is the duration at which the cost equals today's: at 512 MB, for example, you gain if the duration drops below 25 milliseconds. The request charge (0.20 per million) does not depend on memory, which is why the second column does not double from row to row.

Whether the duration falls depends on what the function spends its time on. Time spent on the CPU, parsing JSON or doing cryptography, shrinks when there is more CPU. Time spent waiting for DynamoDB to answer does not. Most of the notes API's time should be of the second kind, so more memory may only raise the bill. It says "should" because it was not measured.

Initialization is different. Loading and evaluating the bundle is CPU work, so more memory can be expected to shorten `Init Duration`. The documentation also says that functions which load libraries can get faster with more memory. This was not measured in this chapter either.

There are two ways to measure. One is to redeploy this chapter's stack with another value, such as `-c memorySize=512`, send the same requests, and compare the REPORTs. The steps are on the [Deploy page](/en/chapters/29-lambda-tuning/deploy.md). The other is AWS Lambda Power Tuning, which the documentation points to. A Step Functions state machine invokes your function for real at several memory settings and reports the cost and speed of each. It really calls the function in your account, so it costs money, and a function that writes has side effects. This chapter did not use it.

One more number matters when choosing memory. If `Max Memory Used` in the REPORT is close to `Memory Size`, the function is about to run short. When memory runs out, the invocation fails.

The architecture has been arm64 since chapter 04. In the Tokyo Region the duration price is 0.0000133334 per GB-second on arm64 and 0.0000166667 on x86, so arm64 is 20% cheaper.

The next page, [Build, Continued](/en/chapters/29-lambda-tuning/more.md), covers concurrency and timeouts.
