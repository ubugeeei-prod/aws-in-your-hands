---
title: "04 Add an HTTP API: Lambda and API Gateway HTTP API"
sourceRevision: 3
---

# 04 Add an HTTP API: Lambda and API Gateway HTTP API

The SPA is live. Next up: an API.

In this chapter you'll write a small HTTP API that creates, reads, and deletes notes. You'll run it on your machine first, then put the same code on Lambda. No Docker needed. And as long as you're only trying it locally, no AWS account either.

Two things before we start. This chapter's API keeps notes in memory and doesn't save them (saving is [chapter 05](/en/chapters/05-dynamodb.md)). There's no authentication either, so anyone who knows the URL can call it (authentication is [chapter 06](/en/chapters/06-auth.md)). Please don't put in anything you'd mind losing, or anything you'd mind other people seeing.

The only prerequisite is [chapter 02](/en/chapters/02-toolchain.md). The code is in `examples/04-http-api/`.

## The big picture

<!-- section: 04.architecture -->

```text
Client (curl, typed client, later the SPA)
  |  HTTPS
  v
API Gateway HTTP API (ap-northeast-1)
  |  routes: GET /health, GET|POST /notes, GET|DELETE /notes/{id}
  |  anything else: 404 from API Gateway, Lambda is not invoked
  v
Lambda function (Node.js 24, arm64, 256 MB, timeout 10 s)
  |  execution role: may write to its own log group, nothing else
  |  Hono app -> NoteService -> InMemoryNoteRepository (per execution environment)
  v
CloudWatch Logs (one JSON line per request, kept 7 days)
```

There are three players.

The front door is **API Gateway**. It accepts HTTPS and passes along only the requests that match a route you defined. Your code runs in **Lambda**. It starts up only when a request comes in, and goes back to waiting when it's done. There's no server that stays up. And the logs Lambda writes pile up in **CloudWatch Logs**.

Lambda runs inside the Tokyo Region. It isn't at the edge, the way CloudFront is.

### Which one is "HTTP API"?

API Gateway comes in several kinds, and the one we use here is the "HTTP API". The name is confusing, but think of it as a different product from the "REST API".

| | HTTP API | REST API |
| --- | --- | --- |
| Request price (Tokyo, first tier) | USD 1.29 per 1 million | USD 4.25 per 1 million |
| JWT authorizer | Yes | No (it has Cognito authorizers and Lambda authorizers) |
| AWS WAF, API keys, request validation, caching, X-Ray | No | Yes |
| Response streaming | No | Yes |

To borrow the official documentation's framing, an HTTP API is the one with fewer features at a lower price. All the notes API needs is routes and the JWT authorizer we'll use in chapter 06, so this one is enough.

On the other hand, if you want WAF right in front of the API, or you want to stream responses, it's time to choose again. The trick is not to blur the kinds together in your head, as in "API Gateway can't stream".

### When Lambda isn't the right fit

What's nice about Lambda is that it costs 0 while nobody is using it, and that you can add one API without designing a network. There are cases where it doesn't fit, though.

- One unit of work takes more than 30 seconds. An HTTP API waits at most 30 seconds for Lambda's response (chapters 08 and 16, planned)
- You need connections that stay open, or you want to run a container you already have as it is (chapter 12, planned)
- You want to run right next to the reader (chapter 10, planned)

## Start with the contract

<!-- section: 04.contract -->

Before writing any code, let's turn the shapes of the API's input and output into schemas.

<<< @/examples/04-http-api/src/contract.ts{note}

Both the server and the client use this definition. The server validates incoming requests with it, and the client validates the responses it gets back with it. The TypeScript types come from here too, through `z.infer`. Since there's only one definition, "I fixed the server and forgot the client" can't happen.

Let's settle the shape of errors as well.

<<< @/examples/04-http-api/src/contract.ts{error}

The caller can branch on `code` without having to interpret the wording of a message. `requestId` is your lead when you go looking through the logs later.

## Write the app

<!-- section: 04.app -->

For HTTP handling we'll use Hono. It's a small framework built on the web-standard `Request` and `Response`, so the same app runs as is on Node.js and on Lambda. Plenty of you have probably used it on Workers.

<<< @/examples/04-http-api/src/app.ts{app}

Three things to notice.

**Everything it needs comes in as an argument.** The clock, the ID generator, where logs go, where notes are stored. Inside `createApp`, nothing touches `Date.now()` or `process.env` directly. A test can pass fixed values, and production can pass the real thing.

**Requests get checked at run time.** TypeScript types are gone by the time the code runs. You can't say "the type is `CreateNote`, so it's fine". `validator` runs the JSON that arrived through the schema, and if it doesn't match, returns a 400 that says which fields are the problem.

**Unexpected exceptions don't leak their cause.** `onError` writes to the log and gives the caller only the `requestId`. Putting a stack trace in the response would tell people how the inside is built.

Where notes are stored is an interface.

<<< @/examples/04-http-api/src/notes.ts{repository}

Right now what's behind it is a plain `Map`. Chapter 05 swaps in DynamoDB, but this interface stays as it is.

And the real clock, real random numbers, and real environment variables are touched in this one place only.

<<< @/examples/04-http-api/src/compose.ts{compose}

## Check the configuration at startup

<!-- section: 04.env -->

Environment variables are values that come from outside the type system, too. The type of `process.env` is "everything is `string` or `undefined`". Looking at the type won't tell you whether a required variable is actually set.

<<< @/examples/04-http-api/src/env.ts{env}

The check happens once, at startup. If something is missing, the first invocation fails with a message that names the variable. That's a lot easier to find than "it reads `undefined` and breaks only under certain conditions", isn't it?

By the way, what lives here is configuration, not secrets. Lambda environment variables can be read by anyone who can see the function's configuration in the console. Secrets such as API keys don't go directly into environment variables; you fetch them at run time from Secrets Manager or something like it. This chapter's example has no secrets, so that code isn't here yet (chapter 21, planned).

## Run it on your machine

<!-- section: 04.local -->

Let's run it. Copy `examples/04-http-api/.env.example` to a file named `.env` in the same place.

<<< @/examples/04-http-api/.env.example

```bash
vp run dev:api
```

The API comes up at <http://localhost:8787>. Try hitting it from another terminal.

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":""}'
```

The last one fails on purpose. You should get back a 400 whose `code` is `invalid_request` and whose `issues` include `title`. In the server's terminal, one line of JSON goes by for each request. Save a source file and it restarts on its own.

Here's all there is to this development server.

<<< @/examples/04-http-api/src/dev.ts{dev}

It's the same app that runs on Lambda, sitting on an ordinary Node.js HTTP server. That's why it's light, and why nothing gets billed. The flip side: it isn't Lambda itself, so some things aren't reproduced.

- **API Gateway's routes**: in production, for a path you didn't define, API Gateway returns 404 before the request reaches Lambda
- **Lambda's limits**: work that runs past 10 seconds is cut off. Memory has a ceiling too
- **IAM**: AWS operations you haven't allowed are denied
- **API Gateway's CORS**: in production, API Gateway answers preflight requests before they ever reach Lambda
- **Execution environments coming and going**: what's in memory isn't guaranteed to still be there at the next invocation

That last one is the star of the second half of this chapter.

### When you want to get one step closer to production

cdkd has a feature that runs API Gateway and Lambda in local containers.

```bash
vp run dev:api:cdkd
```

This one needs a Docker daemon to be running. Entering the devShell doesn't bring Docker along, so start Docker Desktop or something like it separately.

One thing to watch out for. Going by cdkd's source and documentation, this feature hands the container that runs the handler **your own credentials** by default. If the handler calls the AWS SDK, the call reaches real AWS, and gets billed, even though the handler is running locally. On top of that, it runs with your permissions rather than the execution role's, so "it worked here" doesn't mean "the permissions will be enough after deployment". This chapter's handler doesn't call AWS, so it doesn't matter here, but keep it in the back of your mind from chapter 05 on.

To be honest, this task hasn't actually been run yet.

## Tests

<!-- section: 04.tests -->

```bash
vp run test:unit
```

The tests live in three places. Each one is looking at something different.

| Where | File | What it looks at | What it doesn't look at |
| --- | --- | --- | --- |
| App | `test/app.test.ts` | Input validation, the error shape, the request ID, CORS | How things behave through Lambda and API Gateway |
| Client | `test/client.test.ts` | The contract between client and server. Handling of responses that break the contract | A real network |
| Infrastructure | `infra/test/http-api-stack.test.ts` | Permissions, log retention, timeout, routes | That AWS behaves as the template says |

The app tests don't open a port. They hand a `Request` straight to the Hono app, and that's it.

The client tests have no hand-written mock. They pass the real app to the client as its transport, as is. If you change the server implementation and the contract breaks, this test fails.

Here's that client.

<<< @/examples/04-http-api/src/client.ts{client}

Thanks to `hc<App>`, the server's routes and response types reach the client at compile time. Mistype a path and it's a type error. Feels good, doesn't it?

But what this type describes is **the code in this repository**. The server that actually answers isn't necessarily the same version. It might be an old deployment, or a proxy along the way might return an error page. So the client runs the response it received through the schema before returning it. "200 but the wrong shape" and "502 that came back as HTML" are both in the tests.

There's one more test, and it's a slightly odd one. It creates two instances of the app and checks that a note written to one can't be seen from the other. It isn't hunting for a bug. It pins down, as a specification, what the next section is about.

## Where do the notes live?

<!-- section: 04.state -->

Lambda runs your function inside an isolated box called an execution environment. The box is created and initialized at the time of the first invocation. That's a cold start. For a while after that, the same box gets reused.

<<< @/examples/04-http-api/src/lambda.ts{handler}

`composeApp` sits at the outermost level of the file. That part runs once per box, not once per request. The `Map` that holds the notes is created then too, one of it.

So what happens?

```text
time  request            execution environment A      execution environment B
t1    POST /notes  -->   created; Map = {n1}
t2    GET /notes   -->   reused;  returns [n1]
t3    GET /notes   --->  (busy with another request)  created; Map = {}; returns []
t4    (idle for a while) discarded; n1 is gone
```

Look at t3. When the next request arrives while A is in the middle of handling another one, Lambda creates a second box, B. B's `Map` is empty. You called the same URL as at t2, and the answer is different.

At t4, A has gone unused for a while and gets cleaned up, and `n1` no longer exists anywhere.

In other words, what you keep in Lambda's memory can work as a cache, but **it can't be the owner of the data**. There may be more than one box, and you don't get to choose when one disappears. Once chapter 05 adds DynamoDB, the owner becomes the table, and you get the same answer no matter which box does the reading.

You can actually observe this on the deployed API.

```bash
vp run api:smoke
```

This task creates one note and reads it straight back. If the read lands on a different box it gets a 404, but the task doesn't treat that as a failure; it prints that a different execution environment answered. With the way this chapter is built, that's the correct thing to expect.

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

Each log line is one JSON object.

<<< @/examples/04-http-api/src/log.ts{logger}

When you want to chase a single request, note the response's `x-request-id` header (or, for an error, the `requestId` in the body) and search the logs for that value. You'll find `status`, `durationMs`, and, for an error, the stack trace in `error`. A test confirms that the same ID shows up in all three places: the response header, the error body, and the log.

Lambda itself also writes `START`, `END`, and `REPORT` lines for every invocation. `REPORT` has the duration, the billed duration, and the maximum memory used. On a cold start, `Init Duration` is there too. Metrics and alarms are planned for chapter 19.

The drift check is the same as in chapter 02.

```bash
vp run api:infra:drift
```

## If you're coming from Workers

<!-- section: 04.workers -->

If you've written an API on Cloudflare Workers, the flow so far probably looks familiar. Here are only the parts that differ.

| | Cloudflare Workers | This chapter (Lambda and API Gateway) |
| --- | --- | --- |
| Running locally | `wrangler dev` or the Vite plugin. Miniflare runs it on the same runtime as production (workerd) | `vp run dev:api` is a Node.js HTTP server. It isn't the Lambda runtime. To get closer, use `dev:api:cdkd` (needs Docker) |
| Connecting to other services | Bindings. Write one in the configuration and it shows up on `env`. Locally it connects to a local simulation by default | You call them with the AWS SDK. The target comes from environment variables, the permissions from the execution role. No local simulation comes with it |
| Permissions | You can touch what you declared bindings for | IAM. Only the actions written in the role go through. Your local permissions and the permissions after deployment are separate |
| Where it runs | On Cloudflare's network | In one Region (Tokyo in this book) |
| Front door | The Worker itself receives HTTP | API Gateway receives the request and passes it to Lambda. They're separate resources, with separate charges |
| Deployment | `wrangler deploy` | Synth it into a template, and cdkd (or CloudFormation) applies it |

AWS has more parts, and that's true. You define the front door, the function, the role, and the log group yourself, each one separately. In return, you get to choose the settings part by part. Which is better depends on what you're building, and this book isn't going to tell you to give up Workers.

CloudFront Functions (chapter 03) has a similar name, but it isn't a relative of Workers. It's a small environment for rewriting URLs and headers, and it can't touch the network or the file system.

## Let's talk money

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which nobody calls it costs 0.** Neither the HTTP API nor Lambda charges you for merely being there. Logs disappear after 7 days.

Once it gets called, it looks like this. The assumptions are 1 million requests per month, 50 milliseconds on average, 256 MB, arm64, and 0.5 KB of logs per request (the app's one line plus the `START`, `END`, and `REPORT` lines Lambda writes).

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| API Gateway HTTP API requests | 1 million | 1.29 | 1.29 (a free allowance couldn't be confirmed, so none is subtracted) |
| Lambda requests | 1 million | 0.20 | 0 |
| Lambda duration | 12,500 GB-seconds | 0.17 | 0 |
| CloudWatch Logs ingestion | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs storage | 0.111 GB-months | 0.00 | 0 |
| Subtotal | | **2.02** | **1.29** |

The free allowances are 1 million requests and 400,000 GB-seconds per month for Lambda, and 5 GB for CloudWatch Logs. They're shared across the whole account. The Lambda pricing page doesn't say whether this allowance has an expiry.

The data transfer charge for sending responses out to the internet isn't in this table (that doesn't mean it's 0; it's not counted). The 50-millisecond duration is an assumption too, and the `REPORT` lines in the logs will tell you the real value for your function.

Delete the stack and the charges for this chapter stop.

## Where people get stuck

| If you see this | Look here |
| --- | --- |
| `dev:api` stops with `Invalid environment` | Is `examples/04-http-api/.env` there? Check the variable name shown in the message |
| After deployment, every response is a 500 with no `x-request-id` header | The function is failing during initialization. Use `vp run api:logs` to look for `Invalid environment` or an import error |
| `{"message":"Not Found"}` comes back | That's API Gateway answering. You're calling a path that isn't in the stack. It isn't this book's error shape (`error.code`), which is how you can tell |
| Only some responses are errors with no `x-request-id` header | The function timed out or went down partway. Check the duration in the `REPORT` line of the logs |
| Calling from a browser gives a CORS error | Does the `allowedOrigin` from deploy time exactly match the caller's origin (down to scheme and port)? |
| A note you created doesn't show up in `GET /notes` | A different box answered. It's what "Where do the notes live?" describes, and it's how this chapter is specified |
| A new account gets concurrency errors | New accounts have a fairly low limit on Lambda concurrent executions. Check it in Service Quotas |

One tip. When an error comes back, first check whether the `x-request-id` header is there. If it is, the request made it to your app. If it isn't, the problem is before that (API Gateway, or the function starting up). That alone halves the places you have to look.

## If you take this to production

- **Add authentication and authorization.** Right now anyone can call it (chapter 06)
- **Save the data.** Right now it disappears (chapter 05)
- **Limit the request rate.** The stage of an HTTP API has throttling settings. A public API with no limit has no limit on its bill either
- **Set up alarms.** Keep watch on the error rate and the duration (chapter 19, planned)
- **Decide how long to keep logs.** 7 days is a value for learning
- **Make the deployment path the AWS CDK CLI and CloudFormation.** As we talked about in chapter 02
- **Check the concurrency limit.** The default is 1,000 per Region, shared by every function in the account. New accounts start from a lower value

## Clean up

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

The function, the role, the API, and the log group are deleted. The logs go with them.

All that's left is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

::: details Verification notes for this chapter

**Checked locally.** The unit tests for the app, the client, and the infrastructure. Type checking. Synth (including the esbuild bundle). Starting `dev:api` and running the `curl` commands from the text.

**Not checked yet.** `dev:api:cdkd`, `api:infra:deploy`, `api:smoke`, `api:logs`, `api:infra:drift`, and `api:infra:destroy` have not been run against real AWS. In particular, these are still waiting to be confirmed in a real environment: that the bundle runs on the Node.js 24 Lambda runtime, the status codes and bodies of the errors API Gateway returns (such as the `Not Found` in "Where people get stuck"), the response the caller gets when the function times out, and what `api:smoke` prints when there is more than one box.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Start with the contract | `examples/04-http-api/src/contract.ts` | `test:unit` |
| Write the app | `examples/04-http-api/src/app.ts`, `src/notes.ts`, `src/compose.ts`, `src/log.ts` | `test:unit` |
| Check the configuration at startup | `examples/04-http-api/src/env.ts`, `test/env.test.ts`, `.env.example` | `test:unit` |
| Run it on your machine | `examples/04-http-api/src/dev.ts` | `dev:api`, `dev:api:cdkd` |
| Tests | `examples/04-http-api/test/app.test.ts`, `test/client.test.ts`, `src/client.ts` | `test:unit` |
| Where do the notes live? | `examples/04-http-api/src/lambda.ts`, `src/notes.ts`, `scripts/smoke.ts` | `api:smoke` |
| Getting ready for AWS | `examples/04-http-api/infra/lib/http-api-stack.ts`, `infra/bin/app.ts`, `infra/test/http-api-stack.test.ts`, `cdk.json` | `api:infra:synth`, `test:unit` |
| Deploy it and call it | `tools/src/infra/`, `examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`, `api:infra:deploy`, `api:smoke` |
| Look at the logs | `examples/04-http-api/src/log.ts`, `scripts/logs.ts` | `api:logs`, `api:infra:drift` |
| Clean up | `tools/src/infra/` | `api:infra:destroy` |
| Let's talk money | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json), [API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json), [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
