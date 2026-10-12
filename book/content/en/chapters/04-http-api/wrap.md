---
title: "04 HTTP API: Costs, Pitfalls, and Cleanup"
---

# 04 HTTP API: Costs, Pitfalls, and Cleanup

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

### If it gets hammered

Anyone who knows the URL can call it, as often as they like. Two things stand in the way: the stage's throttling (10 requests a second for the whole API) and the cap on notes (100 per execution environment).

Say those 10 a second keep coming for 30 days. That's 25.92 million requests. With the same assumptions as the table above, the list price comes to this.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration (324,000 GB-seconds) | 9.50 |
| CloudWatch Logs (12.36 GB) | 9.49 |
| Total | **52.43** |

About USD 52 a month. The budget notification from chapter 01 arrives somewhere along the way.

But that's the ceiling on the number of requests. Here's what it leaves out, plainly.

The big one is data transfer for the responses. Throttling counts requests, not bytes. `GET /notes` returns every note it holds. One note fits in a 64 KiB request, so 100 of them come to about 6 MB at most. Send that 10 times a second for 30 days and it's roughly 158,000 GB. At the unit price for data transfer from the Tokyo Region to the internet (USD 0.114 per GB for the first 10 TB), that works out to about USD 14,000. A different order of magnitude. Whether a response that large actually gets through, and whether that unit price applies as is to API Gateway responses, hasn't been checked. Still, remember that a lid on the request count doesn't close this hole.

The duration is an assumption too. The table uses 50 milliseconds, but the ceiling the configuration allows is the 10-second timeout, and if every request ran that long, Lambda duration alone would be USD 864. Nothing in this chapter's app is that slow.

Whether API Gateway charges for the 429s that throttling turns away hasn't been checked either.

Before real users arrive, add authentication first (chapter 06). Then make the list smaller (pages, or no bodies in it). If you want to stop one IP address at a time, that's AWS WAF, but it can't be attached to an HTTP API, so you'd put CloudFront in front. The web ACL in [chapter 21](/en/chapters/21-security.md) costs USD 8.00 a month plus USD 0.60 per million requests. This book doesn't build that setup.

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
| A 429 like `{"message":"Too Many Requests"}` comes back | That's the stage's throttling. The whole API went past 10 requests a second. It happens on somebody else's traffic too, not only yours |
| `POST /notes` answers 409 with `quota_exceeded` | The execution environment that answered already holds 100 notes. Delete one and there's room |
| A new account gets concurrency errors | New accounts have a fairly low limit on Lambda concurrent executions. Check it in Service Quotas |

One tip. When an error comes back, first check whether the `x-request-id` header is there. If it is, the request made it to your app. If it isn't, the problem is before that (API Gateway, or the function starting up). That alone halves the places you have to look.

## If you take this to production

- **Add authentication and authorization.** Right now anyone can call it (chapter 06)
- **Save the data.** Right now it disappears (chapter 05)
- **Fit the rate limit to your API.** 10 a second is a value for practice. And throttling doesn't pick its targets, so stopping one caller at a time takes authentication, or CloudFront with AWS WAF
- **Put a limit on response size.** Capping the count doesn't help if each one is large: the transfer still grows
- **Set up alarms.** Keep watch on the share of 5xx responses and on slowness. This app catches exceptions and returns a 500, so Lambda's `Errors` does not go up. What you watch is API Gateway's `5xx` and `Latency` ([chapter 19](/en/chapters/19-observability.md))
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

**Checked locally.** The unit tests for the app, the client, and the infrastructure. Type checking. Synth (including the esbuild bundle). Starting `dev:api` and running the `curl` commands from the text. Tests pin the cap on notes (note 101 gets a 409, and one fits again after a delete) and the throttling values on the stage in the template.

**Not checked yet.** `dev:api:cdkd`, `api:infra:deploy`, `api:smoke`, `api:logs`, `api:infra:drift`, and `api:infra:destroy` have not been run against real AWS. In particular, these are still waiting to be confirmed in a real environment: that the bundle runs on the Node.js 24 Lambda runtime, the status codes and bodies of the errors API Gateway returns (such as the `Not Found` in "Where people get stuck"), the response the caller gets when the function times out, and what `api:smoke` prints when there is more than one box. The stage's throttling is in the same state. The source of the pinned cdkd (0.296.28) passes `DefaultRouteSettings` on to API Gateway, and that much was read. That it takes effect, the shape of the 429 body, and whether a 429 is charged for were not checked. The amounts in "If it gets hammered" are computed from unit prices and settings, not measured under load.

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
