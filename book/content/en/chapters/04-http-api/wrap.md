---
title: "04 HTTP API: Costs, Pitfalls, and Cleanup"
---

# 04 HTTP API: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers how this setup differs from Cloudflare Workers, what it costs, where people get stuck, and what to change for production, and then it removes what you built.

## If you're coming from Workers

<!-- section: 04.workers -->

If you have written an API on Cloudflare Workers, the steps so far will look familiar. The app is a function that takes a `Request` and returns a `Response`, just as a Worker's `fetch` handler is. The table lists what differs.

| | Cloudflare Workers | This chapter (Lambda and API Gateway) |
| --- | --- | --- |
| Running locally | `wrangler dev` or the Vite plugin. Miniflare runs it on the same runtime as production (workerd) | `vp run dev:api` is a Node.js HTTP server, not the Lambda runtime. To get closer, use `dev:api:cdkd` (needs Docker) |
| Connecting to other services | Bindings. Write one in the configuration and it shows up on `env`. Locally it connects to a local simulation by default | You call them with the AWS SDK. Environment variables set the target and the execution role sets the permissions. No local simulation comes with it |
| Permissions | You can touch what you declared bindings for | IAM. Only the actions written in the role go through. Your local permissions and the permissions after deployment are separate |
| Where it runs | On Cloudflare's network | In one Region (Tokyo in this book) |
| Entry point | The Worker itself receives HTTP and is handed a `Request` | API Gateway receives the request and passes it to Lambda. They are separate resources with separate charges. The function gets a JSON event and turns it into a `Request` itself |
| Deployment | `wrangler deploy` | Synth produces a template, and cdkd (or CloudFormation) applies it |

AWS has more parts. You define the entry point, the function, the role, and the log group separately, and in return you choose the settings of each part. Which one fits depends on what you are building, and this book doesn't recommend giving up Workers.

CloudFront Functions (chapter 03) has a similar name, but it is not a counterpart of Workers. It is a small environment for rewriting URLs and headers, and it can't reach the network or the file system.

## Cost

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which nobody calls the API costs 0.** Neither the HTTP API nor Lambda charges you for existing. Logs disappear after 7 days.

The table below prices a month in which it is called, under these assumptions: 1 million requests a month, 50 milliseconds on average, 256 MB, arm64, and 0.5 KB of logs per request (the app's one line plus the `START`, `END`, and `REPORT` lines Lambda writes).

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| API Gateway HTTP API requests | 1 million | 1.29 | 1.29 (a free allowance couldn't be confirmed, so none is subtracted) |
| Lambda requests | 1 million | 0.20 | 0 |
| Lambda duration | 12,500 GB-seconds | 0.17 | 0 |
| CloudWatch Logs ingestion | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs storage | 0.111 GB-months | 0.00 | 0 |
| Subtotal | | **2.02** | **1.29** |

The free allowances are 1 million requests and 400,000 GB-seconds a month for Lambda and 5 GB for CloudWatch Logs, shared across the whole account. The Lambda pricing page doesn't say whether this allowance expires.

The table leaves out the data transfer charge for sending responses to the internet. That charge is not 0. It is simply not counted here. The 50-millisecond duration is an assumption too, and the `REPORT` lines in the logs show the real value for your function.

### When it gets hammered

Anyone who knows the URL can call this API as often as they like. Three things limit that: the stage's throttling (10 requests a second for the whole API), the cap on notes (100 per execution environment), and the caps on response size (20 KiB for a list, 64 KiB for one note).

Ten requests a second for 30 days is 25.92 million requests. Under the same assumptions as the table above, the list price is as follows.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration (324,000 GB-seconds) | 9.50 |
| CloudWatch Logs (12.36 GB) | 9.49 |
| Total | **52.43** |

That is about USD 52 a month. The budget notification you set up in chapter 01 arrives partway through.

This amount is a ceiling worked out from the number of requests alone, and it leaves out the following.

The first is data transfer for the responses. Throttling counts requests, not bytes, so the app sets the size itself. `GET /notes` returns summaries of the newest 20 notes and nothing else, and a test pins the response under 20 KiB even when every title is as large as a title can get. Sending that list 10 times a second for 30 days is about 494 GB. Data transfer from the Tokyo Region to the internet costs USD 0.114 per GB for the first 10 TB, so that comes to about USD 56.

The largest response this API has is one note, not the list. A note fits in a 64 KiB request, so a `GET /notes/:id` response is at most about 64 KiB too. If all 25.92 million responses were that large, they would add up to about 1,582 GB, or about USD 180. Added to the table above, that makes about USD 230 a month. Whether that unit price applies unchanged to API Gateway responses has not been checked.

The second is duration. The table assumes 50 milliseconds, but the ceiling the configuration allows is the 10-second `timeout`, and if every request ran that long, Lambda duration alone would cost USD 864. Nothing in this chapter's app is that slow.

Whether API Gateway charges for the 429s that throttling turns away has not been checked either.

Before real users arrive, the first thing to add is authentication (chapter 06). To stop one IP address at a time you would use AWS WAF, but it can't be attached to an HTTP API, so you would put CloudFront in front. The web ACL in [chapter 21](/en/chapters/21-security.md) costs USD 8.00 a month (USD 5 for the web ACL and USD 1 for each of its three rules) plus USD 0.60 per million requests inspected. This book doesn't build that setup.

Deleting the stack stops the charges for this chapter.

## Where people get stuck

| If you see this | Look here |
| --- | --- |
| `dev:api` stops with `Invalid environment` | Check that `examples/04-http-api/.env` exists, and check the variable named in the message |
| After deployment, every response is a 500 with no `x-request-id` header | The function is failing during initialization. Use `vp run api:logs` to look for `Invalid environment` or an import error |
| `{"message":"Not Found"}` comes back | API Gateway returned this response. You are calling a path that isn't in the stack. You can tell because it isn't this book's error shape (`error.code`) |
| Only some responses are errors with no `x-request-id` header | The function timed out or crashed partway. Check the duration in the `REPORT` line of the logs |
| Calling from a browser gives a CORS error | Check that the `allowedOrigin` passed at deploy time matches the caller's origin exactly, including scheme and port |
| A note you created doesn't show up in `GET /notes` | A different execution environment answered. This is the behavior [Where the notes live](/en/chapters/04-http-api/local.md) describes, and it is how this chapter is specified |
| There are 21 notes or more, and `GET /notes` returns only 20 | The list stops at the newest 20 and carries no bodies. An older note is still readable with `GET /notes/:id` |
| A 429 like `{"message":"Too Many Requests"}` comes back | This is the stage's throttling. The whole API went past 10 requests a second. Somebody else's requests can cause it even when you aren't calling |
| `POST /notes` answers 409 with `quota_exceeded` | The execution environment that answered already holds 100 notes. Delete one and there is room |
| A new account gets concurrency errors | New accounts have a fairly low limit on Lambda concurrent executions. Check it in Service Quotas |

When an error comes back, look first for the `x-request-id` header. If it is there, the request reached your app. If it isn't, the cause is before the app, in API Gateway or in the function starting up. That one check halves the places you have to look.

## If you take this to production

- Add authentication and authorization. Right now anyone can call the API (chapter 06)
- Save the data. Right now it disappears (chapter 05)
- Fit the throttling values to your API. 10 a second is a practice value. Throttling doesn't tell callers apart, so stopping one caller at a time takes authentication, or CloudFront with AWS WAF
- Fit the response size caps to your data. Today a list is 20 summaries and one note is at most 64 KiB. Before you add a field, work out how many bytes the largest response becomes
- Set alarms that watch the share of 5xx responses and slow responses. This app catches exceptions and returns a 500, so Lambda's `Errors` does not go up. Watch API Gateway's `5xx` and `Latency` instead ([chapter 19](/en/chapters/19-observability.md))
- Decide how long to keep logs. 7 days is a value for learning
- Deploy through the AWS CDK CLI and CloudFormation, for the reason chapter 02 gave
- Check the concurrency limit. The default is 1,000 per Region, shared by every function in the account, and new accounts start lower

## Cleaning up

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

The function, the role, the API, and the log group are deleted, and the logs go with them.

What remains is the storage created by the cdkd bootstrap (chapter 02) and the deployment files placed in it.

::: details Verification notes for this chapter

**Checked locally.** The unit tests for the app, the HTTP parts (`src/http/`), the client, and the infrastructure were run, along with type checking and synth (including the esbuild bundle). `dev:api` was started and the `curl` commands in the text were run. Tests pin the cap on notes (the 101st gets a 409, and one fits again after a delete) and the throttling values on the stage in the template. Tests also pin the list: it returns no body, it stops at 20 notes, and it stays under 20 KiB with the largest titles.

**Not checked yet.** `dev:api:cdkd`, `api:infra:deploy`, `api:smoke`, `api:logs`, `api:infra:drift`, and `api:infra:destroy` have not been run against real AWS. Four things in particular are waiting to be confirmed in a real environment: that the bundle runs on the Node.js 24 Lambda runtime, the status codes and bodies of the errors API Gateway returns (such as the `Not Found` in "Where people get stuck"), the response the caller gets when the function times out, and what `api:smoke` prints when there is more than one execution environment. The event used to test `toRequest` was written by hand from the type definitions and is not one the real API Gateway wrote. The stage's throttling is in the same state. The source of the pinned cdkd (0.296.28) passes `DefaultRouteSettings` on to API Gateway, and that much was read. That the setting takes effect, the shape of the 429 body, and whether a 429 is charged for were not checked. The amounts in "When it gets hammered", data transfer included, are computed from unit prices and settings, not measured under load.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Decide the contract first | `examples/04-http-api/src/contract.ts` | `test:unit` |
| Write the app | `examples/04-http-api/src/app.ts`, `src/http/router.ts`, `src/http/body.ts`, `src/http/cors.ts`, `src/http/api-gateway.ts`, `src/notes.ts`, `src/compose.ts`, `src/log.ts`, `test/http.test.ts` | `test:unit` |
| Check the configuration at startup | `examples/04-http-api/src/env.ts`, `test/env.test.ts`, `.env.example` | `test:unit` |
| Running it locally | `examples/04-http-api/src/dev.ts`, `src/http/node-server.ts` | `dev:api`, `dev:api:cdkd` |
| Tests | `examples/04-http-api/test/app.test.ts`, `test/http.test.ts`, `test/client.test.ts`, `src/client.ts` | `test:unit` |
| Where the notes live | `examples/04-http-api/src/lambda.ts`, `src/notes.ts`, `scripts/smoke.ts` | `api:smoke` |
| Getting ready for AWS | `examples/04-http-api/infra/lib/http-api-stack.ts`, `infra/bin/app.ts`, `infra/test/http-api-stack.test.ts`, `cdk.json` | `api:infra:synth`, `test:unit` |
| Deploying and calling | `tools/src/infra/`, `examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`, `api:infra:deploy`, `api:smoke` |
| Look at the logs | `examples/04-http-api/src/log.ts`, `scripts/logs.ts` | `api:logs`, `api:infra:drift` |
| Cleaning up | `tools/src/infra/` | `api:infra:destroy` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json), [API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json), [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
