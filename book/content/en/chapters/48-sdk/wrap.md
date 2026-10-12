---
title: "48 SDK: Costs, Pitfalls, and Cleanup"
---

# 48 SDK: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 48.cost -->

This chapter creates no AWS resource. There is no stack and the tasks reach only a server on your machine, so nothing is billed, and there is nothing to clean up.

The SDK itself has no charge either. What is billed is the service that received the requests the SDK sent, and in that respect retries bear on cost: a call that took three attempts is three requests as the service sees it. Whether a refused or failed request is billed differs by service, and this chapter did not check.

The log line per attempt adds cost too. This chapter's middleware writes one line per attempt, which is normally one line per call and three times that during an outage. CloudWatch Logs pricing is in [chapter 19](/en/chapters/19-observability/wrap.md). If the volume matters, skip a first attempt that succeeded and keep only retries and failures.

## Pitfalls

<!-- section: 48.pitfalls -->

Of the things this chapter confirmed, these are the ones that hurt if you do not know them. Each is behaviour of the pinned version that a test pins.

| What happens | Why, and what to do |
| --- | --- |
| A call to an endpoint that never answers does not return until the function times out | A default client has no timeout. Write numbers on `requestHandler` |
| `requestTimeout` is set and the call still does not return when it passes | It only warns. Set `throwOnRequestTimeout: true` with it |
| A call cut off with `AbortSignal` takes a while to return | The wait before a retry is not shortened by an abort |
| It works on your machine and fails with `Region is missing` | The SDK does not read `AWS_DEFAULT_REGION`. Use `AWS_REGION`, or pass it in code |
| It runs with credentials other than the ones you expected | `AWS_PROFILE` wins over keys in the environment. Check with `vp run sdk:credentials` |
| A waiter ends in a timeout when the cause is a missing permission | It reads every exception as "not yet". Call the same operation once, directly, and look at the exception |
| An attribute you thought you updated disappears | `undefined` directly on an item is not sent and does not throw. A Put replaces the whole item |
| The API cannot turn a `bigint` into JSON and answers 500 | A large integer `N` comes back as a `bigint`. Consider `wrapNumbers` |
| An upload given a stream gives up after one failure | A stream body is not retried. To have it retried, pass bytes |
| Connections run out | A connection is not free until its `Body` is read to the end or destroyed |
| A presigned URL expires before the time you set | The credentials that signed it expired first |
| One environment variable makes a client talk to somewhere else | `AWS_ENDPOINT_URL`, and the per-service `AWS_ENDPOINT_URL_…` |

## Going to Production

<!-- section: 48.production -->

Write the client's configuration instead of leaving it to defaults: the number of attempts, the mode, and the timeouts for connecting and for the answer. Written down, the worst-case duration can be computed, and behaviour does not change on the day an SDK default does. The policy in [Design and Build](/en/chapters/48-sdk/build.md) is for short calls to DynamoDB, and the numbers differ by service. Two seconds is too short for an operation that takes long to answer. Hold a policy per kind of call, and use separate clients.

Derive the deadline for a whole call from the time the caller has left. Waiting beyond API Gateway's integration timeout, or beyond what remains of the Lambda invocation, serves nobody: there is no one left to receive the answer. Making a deadline from a function's remaining time is in [chapter 29](/en/chapters/29-lambda-tuning.md).

Do not wait for the 2026 retry behaviour to become the default. Decide, and switch it yourself. First set `AWS_NEW_RETRIES_2026=true` in an environment for testing and watch the attempts and durations in the logs. The wait after throttling doubles, so redo the timeout arithmetic as well. With the number of attempts written down, DynamoDB's fourth attempt does not come in.

Pin the SDK's version and bundle it with the function. According to the SDK's README, the SDK included in the Lambda runtime is at a specific version and not necessarily the latest. If a runtime update changes the SDK's version, the defaults this chapter pinned may change with it. When you bundle your own, they change only when you upgrade, and then the tests tell you.

Do not hand the caller a plain 500 for a failure the SDK gave up on. Classify it. A failure that can be waited out becomes a 503 with `Retry-After`. Otherwise the caller's own retries are spent on defects as well.

Do not use long-term access keys. An execution role, a task role and an instance profile are each found automatically within the chain and fetched again when they expire. No key needs to be written in code or in an environment variable.

## As a Distributed System

<!-- section: 48.distributed -->

A retry by the SDK is the same request sent again. Whether the first one never arrived, or arrived and was carried out with only the answer lost, the SDK cannot tell. It sends again without knowing. This chapter's invariant restates that.

**One `send` may be carried out by the service more than once.**

The test that breaks it reproduces a lost answer in a fixed order. The script counts each request that arrives by adding 1, gives no answer to the first, and answers the second. The client times out after 50 ms and retries, so one `send` of `ADD noteCount :one` left the count at 2. The application's code has not one line of retrying in it. The SDK did the adding.

What is added to is a variable in the script, not DynamoDB. It was not confirmed against the real DynamoDB, but `ADD` in `UpdateItem` is an operation that adds every time it arrives. Chapter 05 counts an owner's notes in this form. A retry after a lost answer should leave the count one higher than the truth. That is the same direction chapter 05 named when it said that any drift is towards fewer notes fitting, so the promise of never exceeding 100 is not broken.

The protection is the one chapters 05 and 08 showed: make the request one whose result does not change when it arrives twice, either by comparing a version in a conditional write or by carrying an idempotency key. Chapter 05's update compares the version, so when the SDK quietly retries, the second arrival is refused by the condition.

Stopping retries is also a choice. With `maxAttempts: 1`, the same script left the count at 1 and the caller got a timeout. But all the caller then knows is that it does not know. Whether the write was done can only be found out by reading again.

One note on who owns state. The retry quota, the open connections and the remembered credentials all live inside a client, which is to say inside one process. A hundred Lambda execution environments have a hundred quotas. The SDK's quota keeps one process from going on with pointless retries during an outage; it does not hold down the total. What holds down the total is the throttling at the entrance that chapter 32 set.

::: details Verification notes for this chapter

**Checked locally.** The defaults of the pinned SDK (`standard`, 3 attempts, bases of 100 ms and 500 ms, a quota of 500, no timeouts, keep-alive, 50 connections) were read in a separate process with the machine's settings cut off, and compared with the constants. That `AWS_NEW_RETRIES_2026=true` and `SMITHY_NEW_RETRIES_2026=true` change the values, that `1` and `TRUE` do not, and that `AWS_MAX_ATTEMPTS` takes precedence. Which errors are retried and which are not, the headers and the signature of each attempt, the total of the waits, `x-amz-retry-after`, the quota running out and coming back, and the quota belonging to one client. Four configurations against an endpoint that never answers, `AbortSignal`, connection reuse and its limit. Exception classes and fields, and the classification. The paginator and stopping it; a waiter succeeding, timing out, meeting a permission error, and being aborted. Reading a `Body`, reading with a ceiling, a stream body not being retried, and three cases of `Upload`. That a presigned URL is made without any request, its lifetime, the session token, and the checksum on `PutObject`. The document client's conversion. The log line per attempt and where it sits. The order of the credential chain, the precedence of `AWS_PROFILE`, and the environment variables for Region and endpoint. That a write whose answer is lost is sent twice (11 files, 104 tests). The type check. `vp run sdk:tour`, `vp run sdk:defaults` (with no variable and with `AWS_NEW_RETRIES_2026=true`), and `vp run sdk:credentials` with keys that are not real in the environment. All on Node.js 24.21.0, against the local server.

**Not checked yet.** AWS was never called. The following were only read in the source or the documentation.

- The form of the errors real services return, their statuses and request IDs, and whether they send `x-amz-retry-after`
- Connection behaviour against an HTTPS endpoint, and `connectionTimeout`. The local server speaks plain HTTP
- `adaptive` mode. Its source was read; it was not run
- That the DynamoDB Streams client also gets 4 attempts under the 2026 behaviour. DynamoDB's base of 25 ms was read from the value the client holds, but a wait at that value was not timed
- When the new retry behaviour becomes the default. The page that was read does not say
- Fetching credentials inside Lambda, ECS and EC2, and the sources IAM Identity Center, `aws login`, assuming a role, `credential_process` and web identity. The tests exercised only environment variables and static keys in a profile
- How much life the credentials of a Lambda execution role have left when the function receives them, and a presigned URL expiring because its credentials did
- What the empty-body checksum in a presigned `PutObject` URL does to a real upload
- The SDK in a browser. The request handler is `fetch` there, and this chapter's account of timeouts and connections does not apply
- Whether `aws-sdk-client-mock` works with the pinned SDK. It was not installed
- How much of retrying and timing out a Cloudflare binding takes on
- Whether each service bills a refused or failed request
- DynamoDB's `UpdateItem` adding twice when it receives the same `ADD` twice. It was reproduced only with a variable in the script

**Where documentation and source disagree.** The developer guide's table of credentials lists `fromLoginCredentials` as a step of its own, and the chain of `@aws-sdk/credential-provider-node` 3.972.85 has no such step. The reference guide's page on retries describes only the 2026 behaviour, so the numbers without opting in (100 ms, 500 ms, costs of 10 and 5) are not on it; the numbers in this chapter are the installed packages'. The same page presents `x-amz-retry-after` as part of the new behaviour, and the installed version follows it without opting in.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, a client and a command, the local endpoint | `examples/48-sdk/src/local-endpoint.ts`, `scripts/tour.ts` | `test:unit` |
| Middleware | `examples/48-sdk/src/attempt-log.ts`, `test/attempt-log.test.ts`, `scripts/tour.ts` | `test:unit`, `sdk:tour` |
| Credentials, Region and endpoint | `examples/48-sdk/src/credentials.ts`, `test/credentials.test.ts`, `scripts/credentials.ts` | `test:unit`, `sdk:credentials` |
| Retries | `examples/48-sdk/src/defaults.ts`, `test/defaults.test.ts`, `test/retry.test.ts`, `scripts/defaults.ts` | `test:unit`, `sdk:defaults` |
| Timeouts and aborting | `examples/48-sdk/src/call-policy.ts`, `test/timeouts.test.ts` | `test:unit` |
| Errors | `examples/48-sdk/src/errors.ts`, `test/errors.test.ts` | `test:unit` |
| Paginators and waiters | `examples/48-sdk/src/pages.ts`, `test/pages-waiters.test.ts` | `test:unit` |
| Streams | `examples/48-sdk/src/body.ts`, `test/streams.test.ts` | `test:unit` |
| Presigned URLs | `examples/48-sdk/test/presign.test.ts` | `test:unit` |
| Converting DynamoDB values | `examples/48-sdk/src/document.ts`, `test/document.test.ts` | `test:unit` |
| Tests | `examples/48-sdk/test/support.ts` | `test:unit` |
| As a distributed system | `examples/48-sdk/test/lost-response.test.ts` | `test:unit` |

**cdkd.** This chapter has no stack.

**Primary sources** (checked on 2026-10-13)

- Source of the installed packages: [@smithy/core 3.35.2](https://www.npmjs.com/package/@smithy/core/v/3.35.2), [@aws-sdk/core 3.978.2](https://www.npmjs.com/package/@aws-sdk/core/v/3.978.2), [@aws-sdk/client-dynamodb 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-dynamodb/v/3.1149.0), [@smithy/node-http-handler 4.12.1](https://www.npmjs.com/package/@smithy/node-http-handler/v/4.12.1), [@aws-sdk/credential-provider-node 3.972.85](https://www.npmjs.com/package/@aws-sdk/credential-provider-node/v/3.972.85)
- [Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html), [Login credentials provider](https://docs.aws.amazon.com/sdkref/latest/guide/feature-login-credentials.html), [Dual-stack and FIPS endpoints](https://docs.aws.amazon.com/sdkref/latest/guide/feature-endpoints.html) (AWS SDKs and Tools Reference Guide)
- [Set credentials in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), [Load credentials for a Node.js Lambda function](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/loading-node-credentials-lambda.html), [Reuse connections with keep-alive in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-reusing-connections.html), [Configure maxSockets in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-configuring-maxsockets.html) (AWS SDK for JavaScript v3 Developer Guide)
- The aws-sdk-js-v3 repository at tag v3.1149.0: [README](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/README.md), [SDK Clients](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/supplemental-docs/CLIENTS.md), [Error Handling](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/supplemental-docs/ERROR_HANDLING.md), [lib-storage](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/lib/lib-storage/README.md), [lib-dynamodb](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/lib/lib-dynamodb/README.md), [s3-request-presigner](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/packages/s3-request-presigner/README.md)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [aws-sdk-client-mock (npm registry)](https://registry.npmjs.org/aws-sdk-client-mock)
- [Cloudflare Workers: Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)

:::
