---
title: "48 SDK: Design and Build"
---

# 48 SDK: Design and Build

The [previous page](/en/chapters/48-sdk.md) showed the order one `send` passes through, and the local endpoint. This page follows that order and reads, then confirms, each part in turn: middleware, credentials, Region and endpoint, retries, timeouts, and errors.

## Middleware

<!-- section: 48.middleware -->

The middleware stack has five steps. Summarizing the SDK's README:

| Step | What it does |
| --- | --- |
| `initialize` | Starts the call. There is no HTTP request yet |
| `serialize` | Makes an HTTP request from the input |
| `build` | Adds headers that stay the same across retries, such as `Content-Length` |
| `finalizeRequest` | The last touches before sending. Retries and signing are here |
| `deserialize` | Turns the answer into an output object or an exception |

Within a step, the order is set by priority (`high`, `normal`, `low`). Asking the installed `DynamoDBClient` for its list with `middlewareStack.identify()` returns the following, and a test pins it.

```text
loggerMiddleware - initialize
serializerMiddleware - serialize
contentLengthMiddleware - build
getUserAgentMiddleware - build
hostHeaderMiddleware - build
recursionDetectionMiddleware - build
retryMiddleware - finalizeRequest
httpSigningMiddleware (a.k.a. apiKeyMiddleware,tokenMiddleware,awsAuthMiddleware) - finalizeRequest
deserializerMiddleware - deserialize
```

A middleware is a function that takes the next handler (`next`) and returns a function wrapped around it. Before the call to `next` is the request's side; after it returns is the answer's side.

This chapter adds a middleware that writes one log line per attempt. How many times the SDK sent a request is in `$metadata.attempts` of the final result, but how long each attempt took, and which request ID the service gave each one, are lost unless every attempt is recorded. That request ID is the only name the service's side has for one request.

The line follows the shape of [chapter 19](/en/chapters/19-observability.md). The shared fields are taken from its schema, and this chapter's are added. As in chapter 19, a field that is not listed is refused.

<<< @/examples/48-sdk/src/attempt-log.ts{shape}

Only the exception's `name` goes into `error`. Its `message` is the sentence the service returned, which can contain a table name or a key.

The middleware goes in `finalizeRequest` at priority `low`. The retry middleware is `high` in the same step, so this one lands below it and is called on every turn of the retry loop. `deserialize` is lower still, so by the time `next` returns, the answer is already an output or an exception.

<<< @/examples/48-sdk/src/attempt-log.ts{plugin}

The middleware does not count attempts itself. The retry middleware writes a header on the request it is about to send, `amz-sdk-request: attempt=2; max=3`, and the middleware reads that. It is the same value the service receives.

<<< @/examples/48-sdk/src/attempt-log.ts{parse}

A client is reused across requests, so the application's request ID cannot be closed over by the middleware. It is given a function to ask when a line is written. In this example the function returns a value kept in `AsyncLocalStorage`.

<<< @/examples/48-sdk/scripts/tour.ts{wiring}

`vp run sdk:tour` makes one call with this client against a script that throttles twice and then answers. This was the output. `awsRequestId` is a number the local server assigned, and `durationMs` is what this machine measured.

```text
{"level":"warn","message":"aws attempt","requestId":"req-1","client":"DynamoDBClient","command":"GetItemCommand","attempt":1,"maxAttempts":3,"status":400,"awsRequestId":"LOCAL00000001","error":"ProvisionedThroughputExceededException","durationMs":15}
{"level":"warn","message":"aws attempt","requestId":"req-1","client":"DynamoDBClient","command":"GetItemCommand","attempt":2,"maxAttempts":3,"status":400,"awsRequestId":"LOCAL00000002","error":"ProvisionedThroughputExceededException","durationMs":3}
{"level":"info","message":"aws attempt","requestId":"req-1","client":"DynamoDBClient","command":"GetItemCommand","attempt":3,"maxAttempts":3,"status":200,"awsRequestId":"LOCAL00000003","durationMs":3}
{"attempts":3}
```

To carry trace IDs as well, wrap `log` with chapter 19's `withTraceFields`.

## Credentials

<!-- section: 48.credentials -->

When a client is given no `credentials`, the SDK tries a fixed list of sources in order and stops at the first that returns credentials. The list is called the credential provider chain. In the source of the installed `@aws-sdk/credential-provider-node`, the order is this.

<<< @/examples/48-sdk/src/credentials.ts{chain}

The list explains where each piece of this book's code gets its credentials.

On Lambda, the first step, `fromEnv`, settles it. Lambda starts a function with the execution role's temporary credentials in `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`. The three are environment variables Lambda reserves, and its documentation lists them. That is why no line of code since chapter 04 has mentioned credentials.

On your machine, chapter 01 ran `aws login`. The command writes `login_session` to the profile and keeps short-lived credentials under `~/.aws/login/cache`. The SDK reads the profile in `fromIni`, and when it finds `login_session`, takes the credentials from that cache. According to the reference guide, these credentials expire in 15 minutes and the CLI and SDKs refresh them automatically for up to 12 hours.

For an ECS task or an EC2 instance, the last step settles it. A container has environment variables that point at a credentials endpoint, and an instance has the metadata service.

Two things about the order are worth knowing.

The first is that `fromEnv` is skipped when `AWS_PROFILE` is set. Even with keys in the environment, the profile is used. When both are present the SDK prints a warning once, and the warning itself says a future version may reverse the preference. Setting only one of the two is the safe choice.

The second is that the developer guide's table and the installed source differ slightly. The table lists `fromLoginCredentials` as a step of its own after `fromIni`. The chain of the pinned version has no such step: credentials from `aws login` are reached only through a profile. Where the two disagree, the pinned version's source is taken as correct.

Credentials, once fetched, are remembered inside the client. Those with an expiry are fetched again when less than five minutes remain, which is also a value read in the source. As the previous page showed, they are fetched once per `send`, and every retry of that call uses the same ones.

### Which Source Was Used

"It was running as a different role than I thought" is a common cause of permission errors. The SDK leaves the source in two forms. Given a `logger`, the chain writes one `debug` line for each step it tries. It also marks the credentials it returns, in `$source`, with the providers that had a hand in them. `$source` is an internal value the SDK attaches for its own usage metrics and is not documented as public API, so check it with the tests whenever the version changes.

<<< @/examples/48-sdk/src/credentials.ts{source}

The function returns only the last four characters of the key ID. The rest of it, the secret key and the session token appear nowhere.

```bash
vp run sdk:credentials
```

Run with keys that are not real in the environment, it printed this.

```text
{
  "accessKeyIdEnd": "0001",
  "temporary": false,
  "sources": [
    "environment variables"
  ],
  "tried": [
    "fromEnv"
  ]
}
```

The task uses this machine's settings as they are. If the profile assumes a role it calls STS, and with IAM Identity Center or `aws login` it reaches AWS to refresh a token. It is therefore a `live` task. For this chapter it was run only with keys that are not real, and against profiles in temporary files written by the tests.

## Region and Endpoint

<!-- section: 48.region-endpoint -->

The Region is taken from the value given in code, then the `AWS_REGION` environment variable, then `region` in the profile in use. With none of them, the first call fails with `Region is missing`. There is no default Region.

A variable named `AWS_DEFAULT_REGION` also exists, but the pinned SDK does not read it when deciding the Region. A test confirms that a client with only `AWS_DEFAULT_REGION` set fails with `Region is missing`. Lambda sets `AWS_REGION`, so inside a function this does not come up.

The endpoint is normally derived by the SDK from the Region and the service. There are three ways to change it: `endpoint` in code, an environment variable, and `endpoint_url` in the shared config file. The environment variables are per service, such as `AWS_ENDPOINT_URL_DYNAMODB`, or `AWS_ENDPOINT_URL` for every service.

That an environment variable alone changes where a client goes is confirmed by a test. With no `endpoint` in the code, setting `AWS_ENDPOINT_URL_DYNAMODB` sends the client to the local server. That is convenient for a stand-in such as DynamoDB Local, but if the variable strays into a production environment, the app talks to somewhere else without saying so. If you keep a list of your environment variables, look through the ones that start with `AWS_` for any you did not intend.

To connect an S3 client to the local server, set `forcePathStyle: true`. Without it the SDK tries to put the bucket's name at the front of the host name, which `127.0.0.1` cannot do.

FIPS endpoints, and dual-stack endpoints that are also reachable over IPv6, are chosen with `useFipsEndpoint` and `useDualstackEndpoint` (or `AWS_USE_FIPS_ENDPOINT` and `AWS_USE_DUALSTACK_ENDPOINT`). Both are off by default, and this chapter uses neither.

## Retries

<!-- section: 48.retries -->

Why retries are spaced out, and why their total is given a budget, is in [chapter 32](/en/chapters/32-limits.md). Chapter 32 got as far as establishing that the SDK reference describes a new retry behaviour for 2026 and that the installed package's numbers differ from it. This section asks the installed packages themselves, and settles what the pinned version does by default and how the new behaviour is switched on.

```figure
type: sequence
caption: A throttled call. The retry middleware does both the waiting and the counting
actor app: Application
actor retry: retryMiddleware
actor endpoint: Endpoint
step app -> retry: send(GetItem)
step retry -> endpoint: attempt=1; max=3
step endpoint --x retry: 400 throttled
note retry: Takes 5 from the quota, waits 0 to 500 ms
step retry -> endpoint: attempt=2; max=3
step endpoint --> retry: 200
note retry: Puts 5 back in the quota
step retry --> app: output, attempts = 2
```

### The Defaults of the Pinned Version

These two constants are this chapter's conclusion. The first is what happens with nothing configured; the second is the same in a process started with `AWS_NEW_RETRIES_2026=true`.

<<< @/examples/48-sdk/src/defaults.ts{pinned}

The constants were written down from reading the source, and a test compares them with what the installed SDK answers when asked. The function below does the asking. For the number of attempts it does not read the client's configuration: it sends one request to the local endpoint and reads `max=` in the `amz-sdk-request` header that arrived. Configuration is resolved in several stages, and the value on the wire is the one to trust.

<<< @/examples/48-sdk/src/defaults.ts{read}

```bash
vp run sdk:defaults
AWS_NEW_RETRIES_2026=true vp run sdk:defaults
```

Here are the two behaviours side by side. The left column was confirmed with the installed packages. The right column was confirmed by running the installed packages with `AWS_NEW_RETRIES_2026=true`, and it also matches what the SDK reference says.

| | Nothing configured | `AWS_NEW_RETRIES_2026=true` |
| --- | --- | --- |
| Mode | `standard` | `standard` |
| Attempts, the first included | 3 | 3; 4 for DynamoDB |
| Base wait, not throttling | 100 ms | 50 ms; 25 ms for DynamoDB |
| Base wait, throttling | 500 ms | 1,000 ms |
| Longest wait | 20 seconds | 20 seconds |
| Retry quota | 500 | 500 |
| Cost of one retry, not throttling | 10 | 14 |
| Cost of one retry, throttling | 5 | 5 |

Under either behaviour a wait is the base, doubled for each retry, times a random number from 0 up to 1. A test with the random number fixed at 0.5 confirms that the two waits after throttling come to 750 ms (250 and 500), and after a 5xx to 150 ms (50 and 100). That total is in `$metadata.totalRetryDelay` of the result.

### Switching On the New Behaviour

The switch is one static value, decided once when the packages are loaded. Two places read it. `@smithy/core` looks at `SMITHY_NEW_RETRIES_2026` and `@aws-sdk/core` at `AWS_NEW_RETRIES_2026`, and it is on if either is the string `true`. `1` and `TRUE` do not turn it on.

Because it is decided at load, changing the environment variable in a running process switches nothing. The tests, too, start a separate process for each case. On Lambda, set it in the function's environment variables.

What changes when it is on is in the table: the base waits, the cost of a retry that is not for throttling, and the default number of attempts of the DynamoDB client. The S3 client stayed at 3. The reference says DynamoDB Streams also gets 4, which this chapter did not check. `AWS_MAX_ATTEMPTS`, and `maxAttempts` in code, take precedence over the default under either behaviour.

The reference says opting in is required "until it becomes the default behavior". The page did not say when that will be. On the day the default changes, the worst-case duration of a function that calls DynamoDB grows without a word. So the clients in this book have the number of attempts and the mode written down, which is also why chapter 32 did so.

### What Is Retried

The SDK sorts failures into three kinds: throttling, transient, and everything else. It retries only the first two.

Throttling means an answer with status 429, or one whose error code is in a fixed list. The list has 14 codes, among them `ThrottlingException`, `ProvisionedThroughputExceededException`, `RequestLimitExceeded` and `SlowDown`. DynamoDB reports throttling with status 400, so it is recognized by code.

Transient means an answer with status 500, 502, 503 or 504, a timeout, or a connection that failed. Failed connections include a refused or reset connection and a name that did not resolve.

Everything else, such as a mistake in the input, a missing permission, or a conditional write that failed, goes back to the caller after one attempt. The table below is the result of having the local endpoint give each answer and counting the requests that arrived.

| Answer | Requests that arrived |
| --- | --- |
| 400 `ProvisionedThroughputExceededException`, `ThrottlingException`, `RequestLimitExceeded` | 3 |
| 429 with a code that is not in the list | 3 |
| 500, 503 | 3 |
| Connection refused | 3 attempts (none arrived) |
| 400 `ValidationException`, `ConditionalCheckFailedException`, `ResourceNotFoundException`, `TransactionConflictException`, `AccessDeniedException` | 1 |

One caution. When the body being sent is a stream, no failure is retried, because a stream cannot be read twice. Giving S3's `PutObject` a Node.js stream and answering 500 produced one request. The same content given as bytes produced three.

When a service names a wait in the `x-amz-retry-after` header, in milliseconds, the SDK follows it, though never for less than the wait it computed itself and never for more than that plus 5 seconds. The reference describes this as part of the new behaviour, but the installed version follows the header without opting in. A test confirms it.

### The Retry Quota

On each retry the client takes the cost from a quota of 500. If not enough is left, it does not retry even when attempts remain. A success puts some back: what was taken, for a success after a retry, and 1 for a success on the first attempt.

A test called an endpoint that only throttles, over and over, with the random number fixed at 0. A call that fails after three attempts spends 10, the cost of two retries. After 50 calls the quota was empty, and the 51st call came back after a single request. Five successes later, the next failure got one retry back.

The quota belongs to a client. Another client pointed at the same endpoint starts full. Nor is it shared across processes: on Lambda, each execution environment has its own. It is not a mechanism that holds down the retries of a whole account.

If you pass your own `retryStrategy`, `retryMode` and `maxAttempts` are ignored, as the SDK's documentation says. There is also an `adaptive` mode, which chapter 32 explains is not suited to being a general default, and which this chapter did not run.

## Timeouts and Aborting

<!-- section: 48.timeouts -->

A client of the pinned version has **no default timeout of any kind.** Not on connecting, not on waiting for an answer, not on an idle socket. That is what the three `null` values under `http` in `defaults.ts` mean. Connected to an endpoint that accepts a request and never answers, a default client waited for as long as its caller was willing to. Inside Lambda, that is until the function's timeout.

The settings are on the request handler.

| Setting | What it measures |
| --- | --- |
| `connectionTimeout` | Until the TCP connection is open |
| `requestTimeout` | From starting to send the request until the answer's headers arrive |
| `socketTimeout` | Time with nothing moving on the socket |

`requestTimeout` has a trap. In the pinned version, passing the limit only logs one warning and the call goes on. To make it an error, set `throwOnRequestTimeout: true` as well. According to the comment in the type definitions, `requestTimeout` was for a long time wrongly applied as a socket idle timeout, and so, for compatibility, throwing was made the opt-in. A test confirms that a client with only `requestTimeout` set to 50 ms is still waiting after 300 ms, and that the warning was logged.

With `throwOnRequestTimeout`, running out of time becomes a `TimeoutError`. That is a transient failure, so it is retried. Against an endpoint that never answers, each of the three attempts timed out and three connections were thrown away.

`requestTimeout` measures up to the answer's headers. When the body is received as a stream, the time to finish reading it is not included.

This chapter's client holds the attempts and the timeouts as one policy.

<<< @/examples/48-sdk/src/call-policy.ts{policy}

<<< @/examples/48-sdk/src/call-policy.ts{config}

Setting `defaultsMode` to `standard` and the like makes the SDK choose a connection timeout itself. In the source, `standard` is 3,100 ms and `in-region` is 1,100 ms. No mode sets a limit on waiting for the answer. This chapter does not leave it to a mode and writes the numbers.

With the policy held as numbers, the longest one `send` can take is arithmetic: every attempt times out and every wait in between is the longest it can be. The waits come from chapter 32's function.

<<< @/examples/48-sdk/src/call-policy.ts{worst-case}

For the policy above that is 7.5 seconds under today's behaviour (three times 2 seconds, and up to 1.5 seconds of waiting) and 9 seconds under the 2026 behaviour. Chapter 32's function has 10 seconds, so both fit. Four attempts under the 2026 behaviour come to 15 seconds, which does not. The number of attempts is written on the DynamoDB client so that this arithmetic does not quietly break on the day the default becomes 4.

How `connectionTimeout` behaves was not confirmed for this chapter. On one machine a connection is either made at once or refused at once, and a connection that merely takes long could not be produced.

### AbortSignal

Passing `abortSignal` in the second argument of `send` lets the caller cut a call off. With `AbortSignal.timeout(ms)` it is a deadline across all attempts. Where the timeout settings bound one attempt, this bounds one `send`.

A call that was cut off ends with `AbortError` and is not retried. Called with a 50 ms deadline against an endpoint that never answers, one request arrived and the call returned at once.

An abort does not shorten the wait before a retry, however. With the random number fixed so that the first wait is 400 ms, a throttling endpoint, and a 100 ms deadline, the `AbortError` came back after about 400 ms. The abort is noticed when the wait ends and the next attempt begins. To keep a deadline strictly, allow for the longest wait as well. Under the new behaviour the waits after throttling grow to as much as 1 second and then 2, so the gap grows with them.

At the moment of an abort, nothing is known about whether the service carried out the operation. Cut off while waiting for the answer to a request that had arrived, the write may already be done. Making the operation one that can be sent again without changing the result, as chapter 05's conditional writes are, matters here too.

### Reusing Connections

The request handler keeps connections open and reuses them. Keep-alive is on by default, and at most 50 connections are open to one destination at a time. Calls beyond that wait for one to become free.

Tests confirm that three calls in a row use one connection, that six simultaneous calls with the limit at 2 are carried in turn over two, and that two clients make two connections. A client made on every call makes a connection, and its TLS handshake, on every call. That is half of the reason to make one client outside the handler. What it buys on Lambda is in [chapter 29](/en/chapters/29-lambda-tuning.md).

## Errors

<!-- section: 48.errors -->

When a service answers with anything other than 2xx, the SDK throws. The exception is a class that extends the service's base class (`DynamoDBServiceException`). An error that is in the service's model has a class of its own (`ConditionalCheckFailedException`). When a code that is not in the model comes back, the exception is an instance of the base class with that code as its `name`. These are called service exceptions.

An exception carries these fields.

| Field | Contents |
| --- | --- |
| `name` | The error code |
| `$fault` | `client` or `server`: whether the request or the service is at fault |
| `$metadata.httpStatusCode` | The status |
| `$metadata.requestId` | The request ID the service assigned |
| `$metadata.attempts`, `totalRetryDelay` | The number of attempts, and the total waited before retries |
| `$retryable` | Present only on errors the model declares retryable |

`$retryable` cannot be relied on. In the DynamoDB client of the pinned version, the only class that declares it is `ReplicatedWriteConflictException`. Neither `ThrottlingException` nor `ProvisionedThroughputExceededException` has it. The SDK itself decides whether something is throttling from the list of codes and the status, as the previous section showed.

To tell errors apart, read the class, `name`, `$fault` and `$metadata`. Do not read `message`. It is a sentence for people and may change at any time.

Telling them apart takes two stages. The first is for errors that mean something to the app, and they are caught by class. Chapter 05's repository does this when it catches `ConditionalCheckFailedException` with `instanceof` and reads it as "the limit is reached" or "someone updated it first". According to the SDK's documentation, the base class overrides `Symbol.hasInstance` so that `instanceof` works even when a package is installed twice.

The second stage is everything left. Those errors mean nothing to the app, and the only question is whether waiting will help. For that, ask the same functions the SDK uses to decide on a retry. A list of codes of your own would drift from the SDK's.

<<< @/examples/48-sdk/src/errors.ts{classify}

`isThrottlingError` and `isTransientError` are exported by `@smithy/core/retry`. It is the entry point the client packages themselves use, but no documentation was found that presents it for applications to call. It is used here with the version pinned and the results checked by tests.

This classification is needed for the problem at the end of chapter 32. When the SDK's retries run out, the exception rises to the app, and chapter 05's app turns it into a 500. The caller cannot tell a defect from something that would pass after a wait. With the classification, a failure that can be waited out is answered with 503 and `Retry-After`.

<<< @/examples/48-sdk/src/errors.ts{answer}

The one second in `Retry-After` is this chapter's choice. The code does not read a wait named by the service and pass it on.
