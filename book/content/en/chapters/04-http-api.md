---
title: 04 Add an HTTP API: Lambda and API Gateway HTTP API
sourceRevision: 1
---

# 04 Add an HTTP API: Lambda and API Gateway HTTP API

## What you will have at the end

- An HTTP API that creates, reads, and deletes notes, running on your machine without Docker and without AWS
- The same code deployed to Lambda and callable over HTTPS through API Gateway
- One definition of the request and response shapes, shared by the server, the client, and the tests
- The ability to find a single request in the logs
- An explanation of why data kept in Lambda's memory disappears

This chapter builds on [chapter 02](/en/chapters/02-toolchain.md). You can follow it without having read [chapter 03](/en/chapters/03-spa.md). The example is in `examples/04-http-api/`.

This chapter's API only keeps notes in memory; it does not persist them. Storage is chapter 05 (planned). There is no authentication either. Anyone who knows the URL can call it. Authentication is chapter 06 (planned). **Do not put data into this chapter's API that you cannot afford to lose or that others must not see.**

## Architecture

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

Here is what runs where.

- **Your code runs in Lambda.** It runs inside the Tokyo Region, not at the edge.
- **API Gateway is the front door.** It accepts HTTPS and passes requests that match a route to Lambda.
- **Lambda runs only when a request arrives.** There is no server that stays up.

### Why this architecture

API Gateway comes in several kinds. This chapter uses an HTTP API. Its features and prices differ from those of REST APIs and WebSocket APIs.

| | HTTP API | REST API |
| --- | --- | --- |
| Request price (Tokyo, first tier) | USD 1.29 per 1 million | USD 4.25 per 1 million |
| JWT authorizer | Yes | No (it has Cognito authorizers and Lambda authorizers) |
| AWS WAF, API keys, request validation, caching, X-Ray | No | Yes |
| Response streaming | No | Yes |

The official documentation positions HTTP APIs as the option with fewer features at a lower price. All the notes API needs is routes and the JWT authorizer used in chapter 06, so an HTTP API is enough. If a requirement comes up to put AWS WAF directly in front of the API, or to stream responses, choose again between a REST API and some other front door. What matters is not to talk about API Gateway without saying which kind, as in "API Gateway cannot stream".

The reasons for choosing Lambda are that it costs 0 while it is not being used, and that adding one API requires no network design. Consider other options in these cases.

- One unit of work takes more than 30 seconds. An HTTP API waits at most 30 seconds for Lambda's response (chapters 08 and 16, planned)
- You want to hold connections open all the time, or run an existing container as it is (chapter 12, planned)
- You want to run close to the reader. Lambda runs inside a Region (chapter 10, planned)

## Write the contract in one place

<!-- section: 04.contract -->

Start by writing the shapes of the API's input and output as schemas.

<<< @/examples/04-http-api/src/contract.ts{note}

This one definition is used in three places.

- The server validates incoming requests with `createNoteSchema`
- The client validates the responses it gets back with `noteSchema`
- Both derive their TypeScript types from these schemas

Errors get one shape as well.

<<< @/examples/04-http-api/src/contract.ts{error}

The caller can branch on `code` without interpreting prose. `requestId` is the key for finding the logs later.

## Write the app

<!-- section: 04.app -->

HTTP handling uses Hono. Hono is a small framework that works on the web-standard `Request` and `Response`, so the same app runs on Node.js and on Lambda.

<<< @/examples/04-http-api/src/app.ts{app}

`createApp` takes everything it needs as arguments: the clock, the ID generator, where logs go, and where notes are stored. It does not read `Date.now()` or `process.env` directly. That way a test can pass fixed values and pin the result, and production can pass the real things.

Request validation happens inside the route. `validator` runs the body through `createNoteSchema`, and if it does not match, returns a 400 that says which fields are wrong. TypeScript types do not exist at run time, so "the type is `CreateNote`, therefore it is correct" does not hold. Whether the JSON that arrived is correct can only be checked at run time.

Unexpected exceptions are caught by `onError`. The cause is written to the log, and the caller gets only the `requestId`. Stack traces are not included in the response.

Where notes are stored is an interface.

<<< @/examples/04-http-api/src/notes.ts{repository}

This chapter's implementation is a `Map`. Chapter 05 replaces it with a DynamoDB implementation, but the interface does not change.

The real clock, random numbers, and environment variables are touched in one place only.

<<< @/examples/04-http-api/src/compose.ts{compose}

## Validate the configuration

<!-- section: 04.env -->

Environment variables are also values that come from outside the type system. The type of `process.env` is "everything is `string` or `undefined`", and the type does not tell you whether a required variable is set.

<<< @/examples/04-http-api/src/env.ts{env}

Validation happens once, at startup. If a variable is missing, the first invocation fails with a message that includes the variable's name. That is far easier to find than "it reads `undefined` and breaks only for requests that meet some condition".

What is here is configuration, not secrets. Lambda environment variables can be read by anyone who can view the function's configuration in the console. Do not put secrets such as API keys and passwords directly in environment variables; fetch them at run time from Secrets Manager or a similar service. This chapter's example has no secrets, so it has no such implementation (chapter 21, planned).

## Run it locally

<!-- section: 04.local -->

Copy `examples/04-http-api/.env.example` to `.env` in the same directory.

<<< @/examples/04-http-api/.env.example

```bash
vp run dev:api
```

The API runs at <http://localhost:8787>. Call it from another terminal.

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":""}'
```

The last one is a 400 whose `code` is `invalid_request` and whose `issues` include `title`. The terminal prints one line of JSON per request. When you save a source file, the process restarts automatically.

The entry point of this local server is the following file.

<<< @/examples/04-http-api/src/dev.ts{dev}

There is no Docker, no AWS credentials, and no billing. In exchange, the following are not reproduced.

| Not reproduced | What it means in the real environment |
| --- | --- |
| API Gateway's event format and routes | For a path that is not defined, API Gateway returns 404 before the request reaches Lambda |
| Lambda's timeout and memory limit | Work that runs past 10 seconds is cut off |
| The IAM execution role | AWS operations that are not allowed are denied |
| Creation and disposal of execution environments | What is in memory does not necessarily survive across invocations |
| API Gateway's CORS configuration | API Gateway answers the preflight before it reaches Lambda |

### One step closer to the real environment

cdkd has a feature that reads the synthesized template and runs API Gateway and Lambda in local containers.

```bash
vp run dev:api:cdkd
```

This requires **a running Docker daemon**. The devShell contains only tools that have nothing to do with Docker, so start Docker Desktop or an equivalent separately.

According to the source and documentation of the pinned version, this feature invokes the handler with the event format of an API Gateway HTTP API and re-synthesizes when the source changes. On the other hand, the container that runs the handler is given **the developer's own credentials** by default. If the handler calls the AWS SDK, the call reaches real AWS and is billed, even though the handler is running locally. It also runs with your permissions, not the execution role's, so the fact that something worked here does not mean "the permissions are sufficient after deployment". This chapter's handler does not call AWS, so there is no effect here, but you need to keep it in mind from chapter 05 on.

This task has not been run and checked. It is **unverified**.

## Test it

<!-- section: 04.tests -->

```bash
vp run test:unit
```

The tests are split into three layers. Each can check different things.

| Layer | File | What it checks | What it cannot check |
| --- | --- | --- | --- |
| App | `test/app.test.ts` | Input validation, the error shape, the request ID, CORS | Behavior when the request goes through Lambda and API Gateway |
| Client | `test/client.test.ts` | The contract between client and server. Handling of responses that break the contract | A real network |
| Infrastructure | `infra/test/http-api-stack.test.ts` | Permissions, log retention, timeout, and routes in the template | That AWS behaves as the template says |

The app tests do not open a socket. They hand a `Request` directly to the Hono app. The clock and the IDs are fixed values.

The client tests do not use a hand-written mock. They pass the real app's `fetch` handler to the client as its transport. If a change to the server implementation breaks the contract, this test fails.

The typed client looks like this.

<<< @/examples/04-http-api/src/client.ts{client}

`hc<App>` carries the server's routes, parameters, and response types to the client at compile time. A mistyped path is a type error.

This type, however, is a claim about **the code in this repository**. The server that actually answers is not necessarily the same version. It may be an old deployment, or a proxy along the way may return an error page. So the client validates the response it received against the schema before returning it as a typed value. There are also tests for the cases "200 but the wrong shape" and "502 with HTML".

Of the properties being kept, here is one that matters as a distributed system.

**Two instances of the app do not share notes.** The last test creates two instances and checks that a note written to one is not visible from the other. This does not detect a defect; it pins down the limit of this chapter's implementation as a specification. The next section explains why.

## Where the state lives

<!-- section: 04.state -->

Lambda runs a function in an isolated place called an execution environment. An execution environment is created and initialized at the time of the first invocation. This is called a cold start. For a while after that, the same execution environment is reused.

<<< @/examples/04-http-api/src/lambda.ts{handler}

`composeApp` is at the top level of the file. That code runs once per execution environment, not once per request. The `Map` in `InMemoryNoteRepository` is also created then, one of it.

Here is what happens, as a timeline.

```text
time  request            execution environment A      execution environment B
t1    POST /notes  -->   created; Map = {n1}
t2    GET /notes   -->   reused;  returns [n1]
t3    GET /notes   --->  (busy with another request)  created; Map = {}; returns []
t4    (idle for a while) discarded; n1 is gone
```

- **t3**: When the next request arrives while execution environment A is busy with another one, Lambda creates a second execution environment. `n1` is not there. You called the same URL as at t2 and got a different result.
- **t4**: An execution environment that is not being used is eventually discarded. What was in its memory goes with it.

What you keep in Lambda's memory can serve as a cache, but **it cannot be the owner of the data**. In this chapter the owner of the state is "each individual execution environment": there is more than one of them, and you do not get to choose when one disappears. When chapter 05 adds DynamoDB, the owner of the state becomes the table, and a read from any execution environment gives the same answer.

You can observe this behavior on the deployed API.

```bash
vp run api:smoke
```

This task creates one note with the typed client and reads it back right away. If the read lands on a different execution environment it gets a 404, and the task reports that as "a different execution environment answered". It does not treat this as a failure, because the correct expectation is that this can happen with this chapter's implementation.

## Define the infrastructure

<!-- section: 04.infra -->

### Logs

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

The log group is created explicitly. If you leave it out, Lambda creates one automatically the first time the function runs. That log group has no retention limit and remains after the stack is deleted. Its storage keeps costing money, and on top of that you can no longer tell which stack it belonged to.

### Execution role

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

The execution role is the IAM role the function assumes when it runs in AWS. **It is separate from your own permissions.** An `aws` command succeeding on your machine does not mean the same operation succeeds inside Lambda.

If you specify nothing, CDK attaches a managed policy called `AWSLambdaBasicExecutionRole`. It grants permission to write to any log group in the account. Here the role is created by hand and allows writing only to the one log group created above. The test checks that the allowed actions are exactly these two (`logs:CreateLogStream` and `logs:PutLogEvents`) and that the resource is not `*`.

When chapter 05 adds DynamoDB, one permission on the table is added to this role. "What the function can do" is gathered in these few lines.

### Function

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

At synth time, `NodejsFunction` bundles the TypeScript into a single JavaScript file with esbuild. It does not use Docker.

`timeout` is 10 seconds. An HTTP API waits at most 30 seconds for Lambda's response, and this limit cannot be raised. With a longer function timeout, you would pay to continue work that the caller is no longer waiting for. The test checks that the timeout is less than 30 seconds.

`architecture` is arm64. In the Tokyo Region its unit price for duration is lower than x86 (USD 0.0000133334 versus USD 0.0000166667 per GB-second).

### API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

The routes are listed one by one. It is also possible to write "pass every path to Lambda", but then the function starts, and costs money, even for requests to paths that do not exist. With the routes listed, API Gateway returns 404 for everything else.

In exchange, the routes are written in two places: the Hono app and this stack. Fixing only one makes them diverge, so a test checks that "the stack's routes are exactly these five".

CORS is the setting that allows a browser to call the API from a different origin. Only one origin is allowed, and the default is the SPA's development server. To call the API from the chapter 03 SPA, pass the CloudFront URL at deploy time.

## Deploy and call it

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

To allow the origin of the chapter 03 SPA, pass it as context.

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

Connecting the SPA's screens to this API is not done in this chapter yet. Showing notes kept in memory on the screen would only give a different result on each reload, as the previous section showed. The connection is made in steps: in chapter 05, where there is somewhere to store notes, and in chapter 06, where it becomes possible to tell whose notes they are.

## Read the logs

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

This task takes the log group name from the stack outputs and runs the AWS CLI's `aws logs tail`. It reads from AWS but changes nothing.

Each log line is one JSON object.

<<< @/examples/04-http-api/src/log.ts{logger}

The procedure for following a single request is fixed.

1. Note the `x-request-id` header of the response, or the `requestId` in the error body
2. Search the logs for that value
3. Read `status`, `durationMs`, and, for an error, the stack trace in `error`

The test checks that the same ID appears in three places: the response header, the error body, and the log.

Lambda itself also writes `START`, `END`, and `REPORT` lines for each invocation. `REPORT` shows the duration, the billed duration, and the maximum memory used. On a cold start, `Init Duration` is added. Metrics, alarms, and traces that span several services are planned for chapter 19.

## Check for drift

```bash
vp run api:infra:drift
```

This is the same gate as in chapter 02. Every resource in this stack is of a type that the pinned version of cdkd handles with a dedicated implementation. The result against real AWS has not been checked.

## If you are used to Workers

<!-- section: 04.workers -->

If you have written an API on Cloudflare Workers, the flow so far should look familiar. Here are the places where the two differ.

| | Cloudflare Workers | This chapter (Lambda and API Gateway) |
| --- | --- | --- |
| Running locally | `wrangler dev` or the Vite plugin. Miniflare runs the code on the same runtime as production (workerd) | `vp run dev:api` is a Node.js HTTP server. It is not the Lambda runtime. To get closer, use `dev:api:cdkd` (requires Docker) |
| Connecting to other services | Bindings. Declare one in the configuration and it appears on `env`. Locally it connects to a local simulation by default | Call them with the AWS SDK. The target is passed in environment variables and the permissions are written in the execution role. No local simulation is provided |
| Permissions | The code can touch what it declared bindings for | IAM. Only the actions written in the role are allowed. Your local permissions and the permissions after deployment are separate |
| Where it runs | On Cloudflare's network | In one Region (Tokyo in this book) |
| Front door | The Worker itself receives HTTP | API Gateway receives the request and passes it to Lambda. The front door and the function are separate resources, with separate charges |
| Deployment | `wrangler deploy` | Synth to a template, which cdkd (or CloudFormation) applies |

The statements about Workers are based on Cloudflare's official documentation (checked 2026-10-11).

It is true that AWS has more parts. You define the front door, the function, the role, and the log group yourself, each one separately. In return, you can choose each part's settings individually. Which is better depends on what you are building. This book does not recommend that you stop using Workers.

CloudFront Functions (chapter 03) has a similar name, but it is not the counterpart of Workers. It cannot touch the network or the file system, and it exists to rewrite URLs and headers.

## Cost

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

**When it is not being used.** 0. Neither an API Gateway HTTP API nor Lambda has a charge for existing. Logs are deleted after 7 days.

**When it is being used.** This calculation assumes 1 million requests per month, an average duration of 50 milliseconds, 256 MB, arm64, and 0.5 KB of logs per request.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| API Gateway HTTP API requests | 1 million | 1.29 | 1.29 (a free allowance could not be confirmed, so none is subtracted) |
| Lambda requests | 1 million | 0.20 | 0 |
| Lambda duration | 12,500 GB-seconds | 0.17 | 0 |
| CloudWatch Logs ingestion | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs storage | 0.111 GB-months | 0.00 | 0 |
| Subtotal | | **2.02** | **1.29** |

A test checks that the calculation produces the same numbers as this table.

The free allowances are 1 million requests and 400,000 GB-seconds per month for Lambda, and 5 GB for CloudWatch Logs. They are shared across the whole account. The Lambda pricing page does not say whether this allowance has an expiry.

What this calculation leaves out is the data transfer charge for sending responses to the internet. It is not included; that does not make it 0.

The assumed duration (50 milliseconds) is not a measured value. You can find your function's value in the `REPORT` lines of the logs.

**After you delete it.** Nothing remains. The log group is deleted together with the stack.

## When it does not work

| Symptom | What to check |
| --- | --- |
| `dev:api` stops with `Invalid environment` | Does `examples/04-http-api/.env` exist? Check the variable name shown in the message |
| After deployment, every response is a 500 without an `x-request-id` header | The function is failing during initialization. Use `vp run api:logs` to look for `Invalid environment` or an import error |
| `{"message":"Not Found"}` comes back | This is API Gateway's response. You are calling a path that is not in the stack. You can tell because it is not this book's error shape (`error.code`) |
| Only some responses are errors without an `x-request-id` header | The function timed out or exited abnormally. Look at the duration in the `REPORT` line of the logs |
| Calling from a browser gives a CORS error | Does the `allowedOrigin` given at deploy time exactly match the caller's origin (including scheme and port)? |
| A note you created does not appear in `GET /notes` | A different execution environment answered. As the section "Where the state lives" explains, this is how this chapter is specified |
| A new account gets concurrency errors | New accounts are set up with a low limit on Lambda concurrent executions. Check it in Service Quotas |

Working out first whether an error response comes from API Gateway or from your app halves the places you have to look. If the `x-request-id` header is present, the request reached the app.

## If you take this to production

- **Add authentication and authorization.** Right now anyone can call it (chapter 06, planned).
- **Persist the data.** Right now it disappears (chapter 05, planned).
- **Limit the request rate.** The stage of an HTTP API has throttling settings. This chapter leaves them at their defaults. A public API with no limit has no limit on its cost either.
- **Set up alarms.** Monitor the error rate and the duration (chapter 19, planned).
- **Decide the log retention period.** 7 days is a value for learning. Decide by weighing the period you need against the storage cost.
- **Deploy through the AWS CDK CLI and CloudFormation.** As described in chapter 02.
- **Check the concurrency limit.** The default limit is 1,000 per Region, shared by all functions in the account. New accounts start with a lower value.

## Clean up

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

The function, the role, the API, and the log group are deleted. The log group's `removalPolicy` is set to `DESTROY`, so the logs are deleted with it.

All that remains is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

## Verification status of this chapter

- The unit tests for the app, the client, and the infrastructure, type checking, synth (including bundling with esbuild), starting with `dev:api`, and the `curl` commands above are **verified locally**.
- `dev:api:cdkd`, `api:infra:deploy`, `api:smoke`, `api:logs`, `api:infra:drift`, and `api:infra:destroy` have not been run. They are **unverified**.
- The following in particular need to be checked in a real environment: that the bundle runs on the Node.js 24 Lambda runtime, the status codes and bodies of the errors API Gateway returns (such as `Not Found` in the table above), the response a caller receives when the function times out, and what `api:smoke` displays when there is more than one execution environment.

## Source map for this chapter

| Section | Files | Tasks |
| --- | --- | --- |
| Write the contract in one place | `examples/04-http-api/src/contract.ts` | `test:unit` |
| Write the app | `examples/04-http-api/src/app.ts`, `src/notes.ts`, `src/compose.ts`, `src/log.ts` | `test:unit` |
| Validate the configuration | `examples/04-http-api/src/env.ts`, `test/env.test.ts`, `.env.example` | `test:unit` |
| Run it locally | `examples/04-http-api/src/dev.ts` | `dev:api`, `dev:api:cdkd` |
| Test it | `examples/04-http-api/test/app.test.ts`, `test/client.test.ts`, `src/client.ts` | `test:unit` |
| Where the state lives | `examples/04-http-api/src/lambda.ts`, `src/notes.ts`, `scripts/smoke.ts` | `api:smoke` |
| Define the infrastructure | `examples/04-http-api/infra/lib/http-api-stack.ts`, `infra/bin/app.ts`, `infra/test/http-api-stack.test.ts`, `cdk.json` | `api:infra:synth`, `test:unit` |
| Deploy and call it | `tools/src/infra/`, `examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`, `api:infra:deploy`, `api:smoke`, `api:infra:drift` |
| Read the logs | `examples/04-http-api/src/log.ts`, `scripts/logs.ts` | `api:logs` |
| Clean up | `tools/src/infra/` | `api:infra:destroy` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

## Primary sources

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html) (checked 2026-10-11)
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html) (checked 2026-10-11)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) (checked 2026-10-11)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) (checked 2026-10-11)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json), [API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json), [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json) (checked 2026-10-11)
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/) (checked 2026-10-11)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (checked 2026-10-11)
