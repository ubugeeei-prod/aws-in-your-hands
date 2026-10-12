---
title: "35 Lambda Managed Instances: Design and Build"
---

# 35 Lambda Managed Instances: Design and Build

This page starts with how the execution model differs and the code that breaks because of it. The stack comes in the second half. Read the [opening page](/en/chapters/35-lambda-managed-instances.md) first for the whole layout and what it costs.

## One execution environment handles several requests at once

<!-- section: 35.concurrency -->

The handler in chapter 04 carried a comment: "Runs once per execution environment, not once per request." On standard Lambda, one execution environment handles one request at a time. Ten simultaneous requests mean ten execution environments with one request each. So two requests in flight never touched the same module-scope variable.

On Lambda Managed Instances, one execution environment handles several requests at the same time. For the Node.js runtime the guide describes it like this.

- Worker threads start inside the execution environment, and the function's initialization runs **once per worker thread**. By default the number of threads follows the number of vCPUs
- One worker thread handles several requests concurrently when the handler is `async`. While one request waits at an `await`, another moves forward on the same thread
- The most requests sent to one execution environment at once is, for Node.js, 64 per vCPU by default

This chapter's handler is almost the one from chapter 04.

<<< @/examples/35-lambda-managed-instances/src/lambda.ts{handler}

One `app` is made per worker thread and reused for every request that reaches that thread. The app from chapter 04 put per-request values into a `context` object and passed it along as an argument, so it is fine as it stands. The trouble is code that keeps per-request values in module scope.

The local server in chapter 04 has handled several requests in one process from the start. For a Node.js server, concurrency is the ordinary case. Standard Lambda was the one environment where it did not happen.

## A request ID kept in module scope

<!-- section: 35.leak -->

The invariant of this chapter is: what the handling of a request reads belongs to that request. Here is code that breaks it, written on purpose.

Suppose you want the log to say which request stored or deleted a note. The repository does the storing, and the entry point of the app is what knows the request ID. Passing it down through arguments is tedious, so you keep "the request being handled" in one variable and read it where you need it.

<<< @/examples/35-lambda-managed-instances/src/scope.ts{module-scope}

The repository is wrapped so that every change writes one log line.

<<< @/examples/35-lambda-managed-instances/src/audit.ts{audit}

The app uses `createApp` from chapter 04 unchanged. It settles the request ID at the entry point and calls the app inside it.

<<< @/examples/35-lambda-managed-instances/src/app.ts{app}

On standard Lambda this code is correct. As long as requests come one at a time, the variable always points at the request being handled.

When two requests overlap, this happens.

```figure
caption: While request A waits for its write, B arrives, the variable points at B, and A's log line carries B's ID
type: sequence
actor a: Request A
actor env: Execution environment | one thread
actor b: Request B
step a -> env: POST /notes
note env: current = req-A
step env -> env: await put(note)
step b -> env: GET /health
note env: current = req-B
step env --> b: 200, x-request-id: req-B
step env -> env: log "note stored" + current
step env --> a: 201, x-request-id: req-A
```

The test replays exactly this order. It uses a repository whose first write can be held, makes A wait in the middle of its write, handles B to the end, and then lets A go on.

<<< @/examples/35-lambda-managed-instances/test/scope.test.ts{interleave}

<<< @/examples/35-lambda-managed-instances/test/scope.test.ts{leak}

Both A and B get a response with the right request ID on it. To the callers nothing looks broken. What is broken is the log: the note A created is on record as B's work.

Only a request ID leaks in this example. Put the user's identity from [chapter 06](/en/chapters/06-auth.md) in a variable of the same shape, and A's note is stored as B's property. The same goes for a database transaction, a per-request cache, or a language or time zone setting. Requests do not overlap while load is low, so the bug does not show in a test environment and appears only in production once load rises.

## Where per-request values belong

<!-- section: 35.fix -->

There are two ways to fix it.

One is to pass the value as an argument, as the app from chapter 04 does. Arguments are separate for every call, so they cannot mix. For code you are writing new, this is the surest.

The other is `AsyncLocalStorage`. It is part of Node.js, and anything that starts inside `run` reads the same value however many `await`s it crosses. The Lambda guide says the same: for values that change, avoid global state or use `AsyncLocalStorage`. It suits code deep down that has no path left for an argument.

<<< @/examples/35-lambda-managed-instances/src/scope.ts{async-scope}

The two implementations have the same type, so not a line of the app changes. The test with the same order now passes.

<<< @/examples/35-lambda-managed-instances/test/scope.test.ts{fixed}

The same two cases are also checked over real sockets, not function calls. One `nodeServer` from chapter 04 is started and two connections are open at the same time.

<<< @/examples/35-lambda-managed-instances/test/server.test.ts

What this checks is behaviour inside one Node.js process. How Lambda's runtime hands requests to worker threads is not part of this test.

## A separate module for each worker thread

<!-- section: 35.threads -->

Concurrency has a second axis. Each worker thread loads the modules for itself. A variable in module scope exists once per thread.

The notes API from chapter 04 kept its notes in a `Map` in memory. In chapter 04 that meant one `Map` per execution environment. On Lambda Managed Instances it means one `Map` per worker thread.

<<< @/examples/35-lambda-managed-instances/src/app.ts{compose}

The test starts two threads with Node.js `worker_threads` and has each load the app.

<<< @/examples/35-lambda-managed-instances/test/threads.test.ts

A note created through the first thread cannot be seen from the second. This is a check with threads the test starts itself, not Lambda's runtime. Still, what follows from the guide's "initialization occurs once per worker thread" is the same result.

The conclusion is that state in memory cannot be used across requests. That was already true in chapter 04, and on Lambda Managed Instances it does not hold even with a single execution environment. To really store notes you need a place outside the process, such as DynamoDB in [chapter 05](/en/chapters/05-dynamodb.md). This chapter's stack keeps the in-memory repository from chapter 04. A note you created not being found by the next request is the design behaving as designed.

Things that may differ from thread to thread without harm, a cache for example, can stay in module scope. AWS SDK clients are safe to use concurrently according to the guide. A single shared database connection is not, because queries collide on it, and the guide tells you to use a connection pool.

## Timeouts, /tmp, and logs

<!-- section: 35.runtime -->

Concurrency aside, the execution environment behaves differently from standard Lambda in other ways. What this section says comes from the guide and was not checked on AWS.

**A timeout does not stop your code.** The configured timeout applies to each request. Past it, Lambda returns a timeout error to the caller and does not cut the code off, because other requests are still running in the same execution environment. The timed-out request keeps running in the background and keeps one worker busy. If it times out just after writing to DynamoDB and the caller retries, the same write happens twice. The idempotency from [chapter 08](/en/chapters/08-async.md) is needed here too. For long work, read the time left with `context.getRemainingTimeInMillis()` and stop yourself.

**`/tmp` is shared.** Every request in an execution environment sees the same `/tmp`. Keep file names apart, for instance by putting the request ID in them.

**Logs are always JSON.** Functions on Lambda Managed Instances always use the structured JSON log format, and a line written through `console` carries the request ID. Lines from several requests coming out interleaved is normal. The logger from chapter 04 has written one JSON object per line from the start, so nothing changes.

**Some things cannot be used.** On Node.js 22, callback-style handlers do not work. The X-Ray trace ID is read from `context.xRayTraceId`, not from the `_X_AMZN_TRACE_ID` environment variable. `process.on()` cannot be used in worker threads, so the function's code cannot receive SIGTERM.

**The execution environment is not frozen.** Standard Lambda stopped an execution environment between requests. An execution environment on Lambda Managed Instances keeps running without pause.

## Scaling, and what happens instead of a cold start

<!-- section: 35.scaling -->

When a request arrived and no execution environment was free, standard Lambda created a new one on the spot. That is a cold start. The request waits, but it is not refused.

Lambda Managed Instances does not add execution environments when a request arrives. It looks at CPU utilization and at how close execution environments are to their concurrency limit, and adds more afterwards, asynchronously. There is no cold start. In exchange, when the additions do not come in time, requests are throttled and answered with 429. The guide says that the default settings keep headroom for load doubling within five minutes, and that throttling may occur beyond that. The launch post says a 50% increase is absorbed without scaling and new instances start within tens of seconds. Both are AWS's statements, and this chapter measured neither.

There are settings on the function and on the capacity provider.

- The function's minimum and maximum execution environments (`MinExecutionEnvironments`, `MaxExecutionEnvironments`). The default minimum is 3 and there is no default maximum. This stack uses 3 and 6
- The most requests one execution environment takes at once (`PerExecutionEnvironmentMaxConcurrency`). This stack does not set it
- The capacity provider's vCPU ceiling (`MaxVCpuCount`). The default is 400, and this stack uses 12
- The CPU utilization that scaling aims for. Lambda decides by default, and you can decide it yourself

Setting both the minimum and the maximum execution environments to 0 switches a function off without deleting it. A function switched off does not come back when requests arrive. It stays off until you set values other than 0 again.

Seen from the caller, the delay of a cold start is replaced by a 429 from throttling. In this stack, behind API Gateway, what reaches the user is an error response. How to design retries is the subject of [chapter 32](/en/chapters/32-limits.md).

## The capacity provider and the network

<!-- section: 35.capacity-provider -->

From here on it is the stack. The instances go into the private subnets of the chapter 11 VPC.

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{network}

The security group has no inbound rule. Requests reach the instances from Lambda's router, and the guide's own walkthrough uses a security group to which no inbound rule was added. Outbound, only HTTPS is allowed.

The instances need to reach outside the VPC in order to send logs. The guide says connectivity must be configured so that functions can use resources outside the VPC and so that telemetry reaches CloudWatch Logs and X-Ray. The private subnets of chapter 11 have no route to the internet by default. So you add an interface endpoint for CloudWatch Logs to the chapter 11 stack.

<<< @/examples/35-lambda-managed-instances/src/network.ts{network}

Whether the path exists can be checked locally against chapter 11's route model. That checks a model, not what is deployed. The documentation did not settle whether the instances have to reach anything besides logs. Whether a function starts up in private subnets with only that one endpoint is unknown until you deploy.

Next, the operator role.

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{operator-role}

Lambda assumes this role to launch instances, tag them, and create network interfaces. What it carries is the AWS managed policy `AWSLambdaManagedEC2ResourceOperator`, which the guide names as the minimum. It contains actions such as `ec2:RunInstances` and `ec2:CreateTags`, with conditions that limit them to instances Lambda manages. Terminating instances is done not by this role but by a service-linked role that is created automatically with your first capacity provider.

One more permission does not appear in the stack. To attach a function to a capacity provider, the IAM identity that deploys needs `lambda:PassCapacityProvider`. Functions on the same capacity provider are treated as trusting one another, and this permission is how you limit who may put which function there.

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{capacity-provider}

The instance type is narrowed to one, so that the bill can be worked out beforehand. The guide recommends letting Lambda choose, because a narrow list can leave it unable to launch when that type has no capacity. In production, remove this line or widen the list.

## Putting the function on the capacity provider

<!-- section: 35.function -->

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{function}

The function is defined almost as in chapter 04. Three things differ.

Memory is 2048 MB. That is the smallest setting on Lambda Managed Instances and comes with 1 vCPU. Chapter 04 ran the same code in 256 MB.

The function has no `VpcConfig`. Placing things in the VPC is the capacity provider's job, and the function only points at the capacity provider.

The `addFunction` call at the end writes `CapacityProviderConfig` and `FunctionScalingConfig` onto the function. A function on Lambda Managed Instances does not run until a version is published. There is a special version called `$LATEST.PUBLISHED`, and for a function created through CloudFormation it is published automatically. Invoking the function by its unqualified ARN calls `$LATEST.PUBLISHED`, not `$LATEST`.

The API Gateway side is the same as in chapter 04.

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{api}

## Whether cdkd can create these resources

<!-- section: 35.cdkd -->

The pinned `aws-cdk-lib` 2.273.0 has an L2 construct, `lambda.CapacityProvider`, and this stack uses it. There was no need to drop to L1.

For cdkd 0.296.28, the contents of the installed package were read.

- `AWS::Lambda::CapacityProvider` has no provider of its own and goes through Cloud Control API
- `AWS::Lambda::Function` has its own provider, but that provider lists `CapacityProviderConfig` and `FunctionScalingConfig` as "not yet implemented". cdkd switches a resource with properties its own provider cannot write to Cloud Control API automatically. So this chapter's function is created by a different route from the functions in other chapters
- The other types (API Gateway, IAM, the security group, the log groups, `AWS::Lambda::Permission`) have providers of their own

The stack test pins the list of resource types in use.

<<< @/examples/35-lambda-managed-instances/infra/test/managed-instances-stack.test.ts{resource-types}

What was confirmed is that cdkd has a route for each of these types. Whether a capacity provider and a function really come into being through Cloud Control API, and whether `$LATEST.PUBLISHED` is published, is unverified because nothing was deployed.
