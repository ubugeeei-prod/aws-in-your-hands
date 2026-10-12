---
title: "19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics"
sourceRevision: 1
---

# 19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics

Since chapter 04, the API has written one JSON line per request and put an `x-request-id` on every response. But nothing happens unless somebody goes and reads those logs.

This chapter asks two questions. Would you notice that something is wrong? And once you notice, can you follow it to the cause? We take the notes API from [chapter 05](/en/chapters/05-dynamodb.md) and add alarms, ways to search the logs, and traces. Not one line of the chapter 05 application changes; we wrap it from the outside.

The other subject of this chapter is money. Left alone, the tools you observe with end up costing more than the thing they observe. At the end we work out what one more log line costs.

The prerequisite is [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/19-observability/`.

## The big picture

<!-- section: 19.overview -->

```figure
caption: Metrics come off the path a request takes, and an alarm tells you by email through SNS
node client: Browser / curl
node api: API Gateway HTTP API
node fn: Lambda | Hono app from chapter 05
node metrics: CloudWatch Metrics | Count, 4xx, 5xx, Latency
node table: DynamoDB table
node alarms: Alarms | 5xx rate, p95 latency
node dashboard: dashboard | causes: throttles, server errors
node sns: SNS topic
node email: email
edge client -> api: HTTPS (traceparent header, optional)
edge api -> fn
edge api --> metrics: metrics
edge fn -> table
edge metrics -> alarms
edge table --> dashboard: metrics
edge alarms -> sns: ALARM / OK
edge sns -> email
```

```figure
caption: Lambda sends logs to CloudWatch Logs and traces to X-Ray
node fn: Lambda | Node.js 24, active tracing
node logs: CloudWatch Logs | JSON events, kept 7 days
node xray: X-Ray | sampled: first request each second + 5%
node insights: Logs Insights queries | by requestId, by traceId, errors, slow
node filter: metric filter | status = 409
node conflicts: NoteConflicts metric
edge fn --> logs: logs: traceId on every log line
edge fn --> xray: traces: span per request, span per table call
edge logs -> insights
edge logs -> filter
edge filter -> conflicts
```

There are three kinds of tool, and each answers a different question.

**Metrics** are numbers over time: request counts, error counts, latency. They answer "is something wrong right now?" They are cheap and they stay around. What they don't tell you is which request is the bad one.

**Logs** are a record per event. They answer "which request failed, and how?" That detail is paid for by volume.

**Traces** are the path one request took, with the time spent in each step. They answer "where did the time go?" Not all of them are kept, and that will matter later.

The order is: notice (alarms), narrow down (metrics and logs), follow (traces).

### Why this stack is separate from chapter 05's

Chapter 05's `NotesStack` doesn't expose its function or its API to the outside. To add alarms we also want to change the function's settings (tracing, and the log format), so this chapter has a table and an API of the same shape in its own stack. About 60 lines of infrastructure are repeated, but the application code is chapter 05's, loaded as a workspace dependency. The monitoring part is a construct of its own, `Monitoring`, so you can carry it into your stack.

## Start with alarms on symptoms

<!-- section: 19.alarms -->

Put alarms on symptoms, not on causes. What hurts a user is an error or a slow answer. Whether DynamoDB throttled is one possible cause, and all the user ever sees is one of those two. An alarm per cause multiplies until nobody reads them when they fire.

So there are only two alarms.

<<< @/examples/19-observability/src/alarm-math.ts{rules}

The first is the share of 5xx responses. A share and not a count, because failures naturally grow with traffic. But a share has a trap. Two requests in the middle of the night, one of them failing, is "50%". You don't want to be woken for that. So when a minute has fewer than 20 requests, the rate counts as 0.

That condition is also written as a function that means the same as the CloudWatch expression.

<<< @/examples/19-observability/src/alarm-math.ts{point}

The stack uses those same constants and expressions.

<<< @/examples/19-observability/infra/lib/monitoring.ts{error-rate}

Two settings are hiding in there.

**Three minutes out of five.** With `evaluationPeriods: 5` and `datapointsToAlarm: 3`, the alarm fires when three of the last five data points are above the threshold. They don't have to be consecutive. A one-minute spike doesn't fire it; a sustained problem does in about three minutes.

**How to count minutes with no data.** A minute without a single request has no data point at all. CloudWatch calls this "missing" and makes you choose what it means with `treatMissingData`. The default, `missing`, puts the alarm into `INSUFFICIENT_DATA` when every point is missing. `breaching` pages you every night that nobody uses the API. Here it is `notBreaching`: nothing wrong. The documentation suggests `notBreaching` for metrics that report only when an error occurs.

The tests try to break that decision.

<<< @/examples/19-observability/src/alarm-math.ts{state}

`alarmState` is a model to think with. CloudWatch itself reaches further back than five points when data is missing, and the model does not reproduce that. Even so, "silent on a quiet night", "pages every night with `breaching`" and "a one-minute spike does not fire" can all be checked with it.

And the model is honest about one thing. **A quiet night and an outage nobody can get through look the same to this alarm.** In both, no request arrives and there is no data point. Telling them apart takes something that calls in from outside on a schedule (Synthetics, further down).

The second alarm is slowness.

<<< @/examples/19-observability/infra/lib/monitoring.ts{latency}

It watches p95, the 95th percentile, not the average. An average buries the slow few under the fast many. And it measures API Gateway's `Latency`, not Lambda's `Duration`. `Duration` doesn't include cold start time. What the user waited for is closer to what the front door measured.

### Where the notification goes

<<< @/examples/19-observability/infra/lib/monitoring.ts{topic}

<<< @/examples/19-observability/infra/lib/monitoring.ts{actions}

The alarms notify an SNS topic, and the topic fans out to email. An address is subscribed only when you pass one at deploy time. The subscription stays pending until you click the link in the confirmation mail. Forget that, and the alarm fires while nothing arrives.

Recovery (the return to OK) is notified too. When the incident ended is also something you want to know.

## The first numbers to look at

<!-- section: 19.metrics -->

When an alarm fires, open the dashboard. The top row is symptoms; the rows below are candidate causes.

<<< @/examples/19-observability/infra/lib/monitoring.ts{dashboard}

Service by service, here is what to look at first.

**API Gateway HTTP API.** `Count`, `4xx`, `5xx`, `Latency`, `IntegrationLatency`. `Latency` runs from receiving the request to returning the response; `IntegrationLatency` is the part spent waiting for Lambda. A large gap between the two means the time is going on API Gateway's side. Per-route numbers appear only when detailed metrics are enabled.

**Lambda.** `Errors`, `Throttles`, `Duration`, `ConcurrentExecutions`. Here's the catch. `Errors` counts invocations that ended in an exception, and timeouts. This application catches exceptions and returns a 500 response, so while users are getting 500s, Lambda's `Errors` stays at 0. That is why the symptom alarm sits on API Gateway's `5xx`. And when `Errors` does climb, suspect what is outside the application: a timeout, a failed initialization, memory. `Throttles` count as neither `Invocations` nor `Errors`, so they need their own look.

**DynamoDB.** `ThrottledRequests`, `SystemErrors`, and `ConditionalCheckFailedRequests`. The last one is how often chapter 05's optimistic locking stepped in.

There is one dashboard, and it refers to no more than 50 metrics, because that is where the free tier ends. A test guards the limit.

## Narrow it down to one request with logs

<!-- section: 19.logs -->

Once you know that 5xx responses are up, the next question is which requests. CloudWatch Logs Insights lets you write queries against a log group.

Before writing queries, pin down the shape of the log. The chapter 05 application really writes these two kinds of line.

<<< @/examples/19-observability/src/log-shape.ts{shape}

The point is `strictObject`: one field that isn't listed here, and the test fails. That will come back when we talk about personal data.

The queries are not written as strings directly. They are held as a structure first.

<<< @/examples/19-observability/src/queries.ts{model}

It looks roundabout, and there is a reason. A Logs Insights query cannot be run on your machine. But the condition, "which lines does it select", can be evaluated here. Produce both the text that goes to AWS and a filter that runs locally from the same structure, and a test can check that the query fits the shape of the real log.

There are four queries.

<<< @/examples/19-observability/src/queries.ts{queries}

`byRequestId` is the promise from chapter 04 being kept. When a user says "I got an error", ask for the `x-request-id` of the response and pass it to this query. Only the lines that request wrote come back: its request line and, if there is one, the line with the stack trace.

Zod checks that the ID is a UUID. A value from outside is being placed into a query string, which calls for the same care as SQL.

The tests run the real application, let it write log lines, and apply the queries to them.

<<< @/examples/19-observability/src/queries.ts{run}

What they check: filtering by ID returns only that request's lines, the 5xx count doesn't pick up 4xx, and every field name a query refers to exists in the log schema. The last one is there so that renaming a log field in chapter 05 fails here.

What they don't check: that Logs Insights accepts this text and returns the same result. The syntax follows the examples in the documentation, but it has not been run.

To see just the text, no AWS is needed.

```bash
vp run obs:query:print --name errors
```

```text
filter message = "request" and status >= 500
| stats count(*) as requests by method, path
| sort requests desc
| limit 20
```

### There are two request IDs

Logs Insights adds a field called `@requestId` to Lambda logs. That is the ID Lambda assigns to each invocation, and it is not the application's `requestId`. The one you hand to users is the application's, so the queries use `requestId` without the `@`. The names are close enough that everybody gets it wrong the first time.

### The log format changed to JSON

The functions in chapters 04 and 05 keep Lambda's default log format, plain text. In that format the Node.js runtime puts a timestamp, Lambda's request ID and a log level in front of whatever `console.log` writes. So one event in CloudWatch Logs is not pure JSON; it is a prefix followed by JSON.

Logs Insights finds the fields of the first JSON fragment in a Lambda log line, so the way chapter 04 searches still works. But the metric filter in the next section uses a JSON pattern, which is meant for JSON log events. Whether it matches a line with a prefix, I could not tell from the documentation.

So this chapter's function uses the JSON log format.

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

According to the documentation, with the JSON format Lambda does not wrap a line that is already JSON a second time. The application's line should become one event as it is. To be honest, this has not been checked on a real function. What to change if it turns out otherwise is in the verification notes at the end.

## Counting from logs: metric filters and EMF

<!-- section: 19.log-metrics -->

In chapter 05, an update based on an old version is refused with a 409. How often that happens is invisible in API Gateway's metrics: `4xx` lumps 400, 404 and 409 together.

But the log already has a line with `status: 409`. Count those.

<<< @/examples/19-observability/src/queries.ts{conflicts}

<<< @/examples/19-observability/infra/lib/monitoring.ts{metric-filter}

A **metric filter** counts the lines arriving in a log group that match a pattern and publishes the count as a metric. The condition is built from the same structure as the queries.

<<< @/examples/19-observability/src/conditions.ts{render}

Three things to know. It does not reach back to logs from before it was created. Delivery is at least once, so now and then a line is counted twice. And with dimensions, every distinct value becomes a separate metric, billed separately.

There is a second way to make metrics from logs. With the **embedded metric format (EMF)**, you write JSON of a fixed shape to the log and CloudWatch extracts the values. The difference:

| | Metric filter | EMF |
| --- | --- | --- |
| Where it is defined | Infrastructure (a setting on the log group) | Application code (the log line itself) |
| Good for | Counting lines that already exist | Emitting values and dimensions from code (durations, sizes) |
| Code change | None | Needed |
| Cost | The custom metric. No extra log volume | The custom metric plus the extra log ingestion |

Neither calls `PutMetricData`, so the request doesn't wait on it. This chapter only counts lines that already exist, hence the metric filter. When you want durations with dimensions, that's EMF.

Two cautions if you choose EMF. A dimension with many distinct values, such as a request ID, creates one metric per value. And an EMF line must be JSON with nothing before or after it. Lambda's documentation says to write it to `process.stdout` directly, not through `console.log`, when the log format is JSON.

## Traces: where the time went

<!-- section: 19.tracing -->

Logs tell you what happened. They are poor at telling you where, inside one request, the time was spent. That is what a trace records. One request gets one trace ID, and each step inside it is a span.

The instrumentation uses OpenTelemetry. The reason comes in the next section; first, the code.

<<< @/examples/19-observability/src/telemetry.ts{span}

This file imports `@opentelemetry/api` and nothing else. The API is the front desk for calls like "start a span" and "give me the current span"; what stands behind it, the SDK, is separate. With no SDK registered, every call does nothing. Whoever starts the process chooses: an SDK that prints to the console on a laptop, the layer's SDK in Lambda. The application code doesn't know which.

Chapter 05's repository gets wrapped, with one span per call to the table.

<<< @/examples/19-observability/src/traced-repository.ts{repository}

Making the repository an interface in chapter 05 pays off here. Neither the DynamoDB implementation nor the in-memory one is touched; they are wrapped from outside.

The whole application is wrapped the same way.

<<< @/examples/19-observability/src/app.ts{app}

The span is named just `GET` or `POST`. Naming it after a path that contains a note ID would create an unbounded number of names. The path goes into an attribute.

And this is where it is put together.

<<< @/examples/19-observability/src/compose.ts{compose}

## Getting traces out of Lambda

<!-- section: 19.lambda-tracing -->

AWS's tracing service is X-Ray. Let's untangle something that is often mixed up.

X-Ray came with the **X-Ray SDK**, which you build into an application, and the **X-Ray daemon**, which relays traces. Both entered maintenance mode on February 25, 2026, and from now on they receive only security fixes. AWS recommends moving instrumentation to OpenTelemetry.

Nothing on the support timeline page says that **X-Ray, the service**, is ending. Traces made with OpenTelemetry still go to X-Ray. What is winding down is the X-Ray-only instrumentation tooling, not the service that receives traces and shows them. So new code uses OpenTelemetry.

In Lambda there are two stages.

### Stage 1: active tracing, no code

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

With `tracing: lambda.Tracing.ACTIVE`, Lambda itself sends a record of each invocation to X-Ray: a segment for the Lambda service and one for the function. No SDK, no layer. How long a cold start took is visible with this alone.

The execution role gains two actions for writing to X-Ray. Those two cannot be narrowed to a resource, so the resource is `*`. The tests in earlier chapters checked that `*` is never used; this chapter's test checks that `*` appears for those two actions only.

At this stage, spans from inside the function, such as the calls to the table, are not recorded. There is no SDK, so the `withSpan` above does nothing.

### Stage 2: add the OpenTelemetry layer

Seeing inside the function takes an SDK. What AWS's migration guide recommends for Lambda is the **AWS Lambda Layer for OpenTelemetry**. Add the layer to the function, set one environment variable, and an SDK starts before the function's code is loaded.

<<< @/examples/19-observability/infra/lib/observability-stack.ts{otel-layer}

The layer's ARN is not in the code. It changes with the Region and the version, so it is passed at deploy time.

<<< @/examples/19-observability/infra/bin/app.ts{context}

The ARN is in the "Lambda Layer ARNs" table of the ADOT (AWS Distro for OpenTelemetry) documentation, under the Node.js tab. On October 12, 2026, the value for the Tokyo Region was `arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16`. The version keeps moving, so read the table when you use it.

`OTEL_AWS_APPLICATION_SIGNALS_ENABLED=false` means traces only. By default this layer also turns on Application Signals, a separate feature that builds per-service indicators automatically. It has its own price, so it is off here.

The function's code is the same in both stages.

<<< @/examples/19-observability/src/lambda.ts{handler}

From here, an honest list of what has not been checked.

- **Node.js 24 is not in this layer's list of supported runtimes.** The documentation lists 18, 20 and 22. This book's functions run on 24. It may work, and it may not
- **Whether auto-instrumentation works on a bundled function.** The layer turns AWS SDK calls into spans automatically, by hooking into how libraries are loaded. This book bundles the AWS SDK into a single file with esbuild, so that may not take effect. That is why the table spans are written by hand and don't rely on it
- **The API version.** The `@opentelemetry/api` bundled into the function (1.9.1) reaches the SDK the layer registered through a global variable. Reading the API's source: when the layer's API has an older minor version than ours, our calls silently do nothing. If no spans appear, look here
- **Permissions.** The documented steps attach the managed policy `CloudWatchLambdaApplicationSignalsExecutionRolePolicy`. With Application Signals off, this chapter doesn't attach it; whether that is enough is unconfirmed

Each of these is settled by one deploy. Stage 1 alone carries the rest of the chapter, so the layer is not attached by default.

There is also a way without the layer. The migration guide lists assembling the SDK yourself with an exporter for X-Ray. You don't wait for runtime support, and you own the initialization code. This chapter doesn't cover it.

## Following one ID

<!-- section: 19.ids -->

Several kinds of ID have shown up by now. Let's sort them.

| ID | Who assigns it | Where you see it |
| --- | --- | --- |
| `requestId` (application) | The application; a UUID per request | The `x-request-id` response header, error bodies, log lines, the span attribute `app.request_id` |
| `@requestId` (Lambda) | Lambda; per invocation | Logs Insights, the `REPORT` line |
| Trace ID | The first process that started the trace | `traceId` in log lines, X-Ray |
| Span ID | The process that created the span | `spanId` in log lines, X-Ray |

The request ID is what the user sees; the trace ID is what is shared across processes. So make each findable from the other.

<<< @/examples/19-observability/src/telemetry.ts{fields}

Every log line gets a `traceId`, and the span gets the request ID as an attribute. Given a request ID from a user, the log gives you the trace ID. Having found a slow span on the trace screen, its request ID takes you back to the log. The tests check the trip in both directions.

### Converting to X-Ray's notation

An OpenTelemetry trace ID is 32 hexadecimal characters. X-Ray writes the same value with `1-` in front and two hyphens.

<<< @/examples/19-observability/src/trace-context.ts{xray}

The log has the 32-character form; the X-Ray console and the `REPORT` line have the hyphenated one. Convert to whichever the place you are searching uses.

### Passing it across processes

How a trace ID travels to the next process is defined by a W3C specification, Trace Context. Over HTTP it is a header named `traceparent`.

<<< @/examples/19-observability/src/trace-context.ts{traceparent}

It is four parts joined by hyphens: a version, the trace ID, the caller's span ID, and flags. The lowest bit of the flags says "the caller is recording this trace".

Only the tests and `obs:smoke` use this chapter's own parsing of `traceparent`. The real hand-off is left to OpenTelemetry's propagator.

<<< @/examples/19-observability/src/telemetry.ts{propagation}

```figure
caption: The trace is carried from the browser to the worker, and a message delivered twice makes two spans with the same parent
type: sequence
actor browser: Browser
actor api: API | Lambda
actor queue: Queue
actor worker: Worker | Lambda
note browser: traceparent
step browser -> api: 00-<trace>-<a>-01
note api: span b, parent a
note api: log: traceId=<trace>
step api -> queue: message + trace header
note queue: traceparent / AWSTraceHeader
step queue -> worker: deliver
note worker: span c, parent b
step queue -> worker: deliver again
note worker: span c', parent b
note worker: log: traceId=<trace>
```

When the browser calls with a `traceparent`, the API continues that trace. When the API puts a message on a queue, it puts the same information on the message. The worker picks up from there. Everyone's log has the same `traceId`, so one query returns all the lines.

[Chapter 08](/en/chapters/08-async.md) built the queue and the worker. According to the X-Ray documentation, SQS carries the X-Ray trace header in a message attribute called `AWSTraceHeader`, and a Lambda consumer continues from it automatically. This chapter uses no SQS; the tests reproduce only "put it on the message, and the receiver continues". When the same message is delivered twice, there are two spans with the same parent. The duplicate delivery shows up in the trace.

One thing has not been checked on a real function. Inside Lambda, the layer has already opened a span for the invocation. In that case this chapter's code does not read `traceparent` itself and goes under the layer's span. Whether the browser's `traceparent` and Lambda's trace end up connected depends on how the layer and Lambda behave. Even if they don't, the `traceId` in the log and the request ID still let you follow the request.

## Not every trace is kept

<!-- section: 19.sampling -->

This is the part of the chapter that is easiest to get wrong.

Traces are sampled. Recording every request is expensive, so only a share is kept. Lambda's active tracing records the first request each second and 5% of the rest. That rate cannot be changed per function.

And the decision is made once. The process that starts the trace decides "record" or "don't", and everything downstream follows. No service in the middle decides again by its own rules; if it did, traces would break off halfway.

<<< @/examples/19-observability/src/local-tracing.ts{local}

Here is what that means, in one sentence. **A missing span is not evidence that the work didn't happen.**

- A request that was not sampled has no spans, even though it succeeded
- In a recorded trace, a span whose export failed is missing. The work finished; only the span never arrived
- X-Ray deletes traces after 30 days

The tests reproduce the first two in a fixed order. Create a note with sampling off: the response is 201, the log line is there, `sampled` is `false`, and there are zero spans. Run the worker with the exporter down: the job ran once, and its span is the only thing missing.

So whether something happened is settled with logs and data. Logs are not sampled. Whether the note was created, the table knows. Treat traces as a tool for seeing where things are slow, not as the record of what happened.

That is also why `sampled` is on the log line. Search X-Ray for the trace ID of a line that says `false` and nothing comes back. That is not an outage. It is how it works.

## What stays out of logs and traces

<!-- section: 19.privacy -->

[Chapter 06](/en/chapters/06-auth.md) set the rule "no tokens in logs". Every observability tool you add is another place a leak can land. Logs for 7 days, traces for 30, and both are usually readable by more people than the application's table.

The approach here is an allow-list, not a deny-list. "Remove the field named password" leaks as soon as a field with another name appears. So decide which fields may be written, and fail a test when anything else shows up.

- **Logs** are the `strictObject` from before. A new field means adding it to the schema, and that is when a person looks at it
- **Span attributes** are fixed by a test that lists their names. Seven of them: `http.request.method`, `url.path`, `http.response.status_code`, `app.request_id`, `app.repository.operation`, `app.repository.outcome`, `error.type`
- **The path has no query string.** Query strings sometimes carry tokens; the authorization code in chapter 06 did
- **Exceptions: the type only.** The standard way to record an exception on a span copies its message and stack trace whole. Messages can contain input verbatim, so this chapter keeps only the name of the exception type. The details are written once, in the log's `error`

The tests send note text, a token in the query string, an `Authorization` header, a cookie, and an email address inside an exception message, and check that none of them appears in a log line or a span.

One hole remains, and here it is. The log's `error` holds a stack trace. With a library that puts personal data into exception messages, it leaks from there. An allow-list of field names does not prevent that.

## Seeing it on your machine

<!-- section: 19.local -->

Copy `examples/19-observability/.env.example` to `.env` and start the server.

<<< @/examples/19-observability/.env.example

```bash
vp run dev:obs
```

<<< @/examples/19-observability/src/dev.ts{dev}

Locally, an exporter prints the spans to the console. Call the API from another terminal.

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-01'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-00'
```

The first prints two spans, `notes.create` and `POST`, and a log line with a `traceId`. A span is printed when it ends, so the inner `notes.create` comes first.

The second names a trace ID with `traceparent`. The log's `traceId` becomes `4efaaf4d…`, and the span's parent becomes `00f067aa0ba902b7`.

The third ends in `00`, which means "the caller is not recording". No span is printed. Only the log line remains, with `"sampled":false`.

Set `TRACE_SAMPLE_RATIO` to `0` in `.env` and restart, and every request behaves that way.

The tests:

```bash
vp run test:unit
```

And what is not reproduced locally:

- **CloudWatch and X-Ray themselves.** Alarm state changes, running Logs Insights, the metric filter, the X-Ray console
- **Lambda's sampling.** The local sampler has a ratio only; there is no "first request each second"
- **The layer.** The local SDK is set up differently from the Lambda layer
- **The system log lines Lambda writes**, such as `platform.report` in the JSON format

## Deploy and check

<!-- section: 19.deploy -->

From here it's AWS. The steps in this section have not yet been run against a real account.

```bash
vp run obs:infra:diff
vp run obs:infra:deploy -c alarmEmail=you@example.com
```

The email address goes into the template and into cdkd's state. Use a shared address, or leave it out and add a subscription later. When the confirmation mail arrives, click the link.

Send some requests.

```bash
vp run obs:smoke
```

It creates a note, updates it with a stale version to cause a 409, reads a note that doesn't exist to cause a 404, and deletes the note. It prints the `x-request-id` of every response.

```bash
vp run obs:query --name request --id <x-request-id>
vp run obs:query --name errors --minutes 60
vp run obs:alarms
```

`obs:query` reads every log event in the time range you give, and you are billed for the amount read. Keep the range narrow. `obs:alarms` shows the state of the two alarms. Right after a deploy they are in `INSUFFICIENT_DATA`, which is normal.

To add the layer, take the ARN from the table in the ADOT documentation and pass it.

```bash
vp run obs:infra:deploy -c otelLayerArn=arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
```

One note about cdkd. Reading the source of the pinned version (0.296.28), alarms, SNS topics and subscriptions, and log groups have dedicated implementations. Dashboards and metric filters do not, and go through Cloud Control API. Both types are on Cloud Control API's list of supported resources, but whether cdkd can really create them is unconfirmed.

Drift is checked as in earlier chapters.

```bash
vp run obs:infra:drift
```

## The browser side, and watching from outside

<!-- section: 19.browser-and-probes -->

Everything so far was on the server side. Two things are still out of sight.

**What happens in the user's browser.** The API may answer in 50 ms while the page takes 5 seconds to show. JavaScript errors never reach the server. **CloudWatch RUM** puts a small script into the page and collects load times and errors from real users. You choose what share of sessions to collect. The data is deleted after 30 days.

**Whether it is broken when nobody is there.** As we saw, with no requests the alarms stay silent. **CloudWatch Synthetics** runs scripts called canaries on a schedule, as often as once a minute, and calls your API or page from outside. Even in the middle of the night with no users, you find out that it is broken.

This chapter implements neither. Here is why.

- RUM needs a browser application, and a way to authorize the browser to send data to AWS. This chapter's subject is an API alone
- A Synthetics canary brings a Lambda function, an S3 bucket for its artifacts, and a runtime version of its own. Runtime versions are replaced often; written without checking, the example would be out of date quickly
- Both keep costing money for as long as they exist. The next section does the arithmetic

A rule of thumb for the order to add them. If your service has hours with no users, Synthetics comes first: it lets you tell "no data" from "broken". When how the SPA feels becomes the problem, that's RUM. Neither is late if it comes after server-side alarms and logs are in place.

The pinned cdkd has no dedicated implementation for `AWS::RUM::AppMonitor` or `AWS::Synthetics::Canary`. Both go through Cloud Control API.

## What it costs

<!-- section: 19.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The arithmetic is in the [pricing worksheets](/en/reference/pricing.md). The API, Lambda and DynamoDB themselves were priced in chapters 04 and 05, so this section covers observing only.

**A month in which nobody calls costs 0.30 at list price, and 0 after the free tier.** Only the alarms cost anything: 0.10 a month for each metric an alarm refers to. The two alarms refer to three metrics (the 5xx rate uses both `Count` and `5xx`, so it counts twice). With no requests there are no logs and no traces.

At 1,000,000 requests a month, it looks like this.

| Item | Quantity | List price | After the monthly free tier |
| --- | --- | --- | --- |
| Log ingestion | 0.954 GB | 0.72 | 0 |
| Log storage (7 days) | 0.223 GB-month | 0.01 | 0 |
| Data read by Logs Insights | 1 GB | 0.01 | 0 |
| Custom metric | 1 | 0.30 | 0 |
| Alarms | 3 metrics | 0.30 | 0 |
| Traces recorded | 1,000,000 | 5.00 | 4.50 |
| Traces retrieved | 10,000 | 0.005 | 0 |
| Subtotal | | **6.34** | **4.50** |

The assumptions: 1 KB of logs per request, 7-day retention, and requests arriving at a steady rate.

The most expensive line is traces. A million requests a month averages 0.38 per second. Lambda's sampling always records the first request of each second, so at this rate every request becomes a trace.

<<< @/examples/19-observability/src/cost-inputs.ts{traces}

That is the upper bound. Real requests arrive unevenly; those that share a second are recorded at 5%, and the count goes down. Put the other way round: the less traffic a service has, the closer its trace rate gets to 100%. Observing can cost more than the API and Lambda that chapter 04 priced at 2.02 list.

The free tier is 5 GB each for log ingestion, storage and queries, 10 custom metrics, 10 alarm metrics, 3 dashboards, 100,000 traces recorded and 1,000,000 retrieved a month. All of it is shared across the account.

The dashboard is left out of the amounts on the assumption that it is one of the three free ones. The price from the fourth onward is not in the Tokyo price list, and I could not read it from the pricing page either, so it stays unknown.

### What one more log line costs

The request line measures 167 bytes (a test pins that number). Writing one more line of that size per request comes to 0.156 GB at 1,000,000 requests a month: **0.12 a month**.

<<< @/examples/19-observability/src/cost-inputs.ts{logs}

It looks small, but it scales with requests. At 100 million requests a month it is 100 times that. And a line that dumps the whole input for debugging is not 167 bytes.

The three trace fields this chapter added (`traceId`, `spanId`, `sampled`) are 88 bytes per line. By the same arithmetic that is 0.082 GB of ingestion per 1,000,000 requests a month. That is the price of being able to look one up from the other.

### What one more metric costs

A custom metric is **0.30 a month** each, for the first 10,000. It is charged by the hour, only for hours in which data points arrived.

The thing to watch is dimensions. CloudWatch counts every distinct combination of dimension values as one metric. Give `NoteConflicts` a route dimension and you pay 0.30 per route; a user ID, per user. When you want to know who, or which note, use a log query and not a metric.

### Choosing a retention period

Most of what logs cost is ingestion (0.76 per GB); storage (0.033 per GB-month) is less than a twentieth of that. At the same traffic, 7-day retention keeps 0.22 GB around, and a year keeps 11.6 GB.

So choose retention less by price than by how far back you want to investigate and how long you are allowed to keep the data. For incident work, the time it takes to notice plus the time to investigate: two to four weeks. If an audit or a law sets a period, that period. If the logs may contain personal data, shorter is safer. A log group with nothing set keeps its data forever, so always set something.

When you need to cut the bill, writing less works better than keeping it for less time.

### RUM and Synthetics

Neither is in this chapter's stack. Rough figures for when you add them:

- **Synthetics**: 0.0019 per canary run. One canary every 5 minutes is 8,760 runs a month: **16.64** at list price, 16.45 after the free tier of 100 runs a month. The Lambda, S3 and log charges a canary incurs are extra
- **RUM**: 1 per 100,000 events. At 20 events per visit (the number in the pricing page's example), collecting all of 10,000 visits a month is **2.00**. There is a first-time free trial of 1 million events; it is not a monthly allowance, so it is not deducted

A canary every minute costs five times one every 5 minutes. Choose the interval by how many minutes of downtime you can accept.

Destroy the stack, and this chapter's charges stop.

## If you come from Workers

<!-- section: 19.workers -->

Observing Cloudflare Workers takes far fewer settings. Side by side:

| | Cloudflare Workers | This chapter (CloudWatch and X-Ray) |
| --- | --- | --- |
| Logs | Workers Logs. On by default for new Workers. Fields of JSON logs are indexed automatically | CloudWatch Logs. You decide the log group, the retention and the log format |
| Log retention | 7 days at most | From 1 day to forever |
| Log pricing | The Paid plan includes 20 million events a month, then USD 0.60 per additional million (by event count) | By bytes ingested and by volume stored |
| Traces | Enabled in configuration, instrumented automatically with no code change (beta). Records every request by default | Active tracing is configuration only. Inside the function needs the OpenTelemetry layer or code. One per second plus 5% by default |
| Trace retention | 7 days | 30 days |
| Alarms | Not checked in this chapter | CloudWatch alarms and SNS |
| Sending elsewhere | Can export to an OpenTelemetry endpoint | Instrumented with OpenTelemetry, the destination need not be X-Ray |

Workers gets you started sooner. On AWS you decide retention, sampling, the log format and the alarm conditions yourself. In return you can keep data longer and shape conditions finely.

A caveat about Workers pricing. The documentation says Workers Logs and traces move to a new scheme, Cloudflare Observability pricing, on December 1, 2026. The amounts in the table are those until then. What the new scheme contains was not checked for this chapter.

On either platform, instrumenting with OpenTelemetry keeps the application code from being tied to the observability backend. This chapter's `telemetry.ts` knows nothing about AWS.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| An alarm stays in `INSUFFICIENT_DATA` | Normal right after a deploy. If it lasts while requests arrive, check that the metric's dimension (`ApiId`) matches the real API |
| The alarm is in `ALARM` and no mail comes | The SNS subscription is still pending. Did you click the link in the confirmation mail? |
| Users get 500s and Lambda's `Errors` is 0 | Normal. The application catches the exception and returns a 500. Look at API Gateway's `5xx` |
| `obs:query` finds no lines | Is the time range (`--minutes`) wide enough? Logs arrive a few seconds late. If still nothing, the log shape may differ from what was assumed (`obs-lambda-json-log-shape` in the verification notes) |
| `NoteConflicts` has no data | A metric filter only applies to logs written after it was created. Also check that the logs are in the JSON format |
| Log lines have no `traceId` | No SDK is registered. In stage 1, without the layer, this is normal |
| The log has a `traceId` that X-Ray cannot find | Look at `sampled` on that line. `false` means it was not recorded. If `true`, convert the ID to the hyphenated notation and search again |
| The function doesn't start after adding the layer | Look for layer errors in the function's log. Is the runtime in the layer's list of supported runtimes? |
| A trace breaks off halfway | The sampling decision was not carried over, or a span failed to export. Join the pieces with the `traceId` in the logs |

## For production

- **Set alarm thresholds from your own service's numbers.** 5% and one second are practice values. Watch the metrics for a week or two first, learn what normal is, then decide
- **Add a probe from outside.** Synthetics, if there are hours with no users. It lets the alarms tell a quiet night from an outage nobody can get through
- **Route notifications to whoever is on call.** One email is not read at night. Point the topic at chat or an on-call system
- **Enable API Gateway access logs.** A request that never reached the function (throttled, timed out) leaves nothing in the application's log. The access log has it
- **Decide the log retention.** Seven days is a practice value
- **Write the response steps into the alarm.** Put the first dashboard and query to open into `alarmDescription`, and nobody has to think when it fires
- **Encrypt the topic, and check what a notification carries.** An alarm notification contains metric names and thresholds
- **Deploy through the AWS CDK CLI and CloudFormation**, as chapter 02 explained

## Cleaning up

<!-- section: 19.cleanup -->

```bash
vp run obs:infra:destroy
```

The table, the function, the API, the log group, the alarms, the dashboard, the topic and the metric filter are deleted. So are the notes and the logs.

Two things do not go away with the stack. Traces recorded in X-Ray stay until they are 30 days old (the charge is for the number recorded). The data points of the `NoteConflicts` metric are not a stack resource either, and stay in CloudWatch. How to remove either was not checked for this chapter.

Besides those, only the storage created by cdkd's bootstrap (chapter 02) remains.

## As a distributed system

The observability tools are a distributed system themselves. They deliver along a different path from the application, with a different reliability.

- **Who owns the state**: what happened is owned by the table (the data) and the logs (the record of requests). Metrics are aggregates, and traces are samples
- **The invariant**: sampled or not, every request leaves one log line with a request ID. Whether a trace exists says nothing about whether the work succeeded
- **The tests that try to break it**: with sampling off, with a caller that says "don't record", and with the exporter down, the response and the log are unchanged
- **Duplicates**: metric filters and EMF deliver at least once. A metric value is occasionally counted high. When you need an exact count, count log lines or items in the table
- **Delay**: logs and metrics arrive seconds to minutes late. By the time an alarm fires, the incident has been going on for a few minutes

::: details Verification notes for this chapter

**Checked locally.** Unit tests for the application, the log queries, tracing, the alarm conditions, the pricing inputs and the infrastructure. Type checking. Synth, including the esbuild bundle, also with `-c otelLayerArn`. Started `dev:obs` and ran the `curl` commands from the text: the spans and log lines correspond, `traceparent` is continued, and with `TRACE_SAMPLE_RATIO=0` no span is printed. The output of `obs:query:print`. The argument names the scripts use, against the AWS CLI's help for `logs start-query`.

**Not checked yet.** `obs:infra:deploy`, `obs:smoke`, `obs:query`, `obs:alarms`, `obs:infra:drift` and `obs:infra:destroy` have not been run against real AWS. In particular, the following are read from documentation.

- That under Lambda's JSON log format the application's JSON line becomes one log event as it is. If not, send the logger's output to `process.stdout` in `src/compose.ts`, or change the field names in the queries
- That Logs Insights accepts the generated query text
- That the metric math `IF` expression is accepted, that `Count` and `5xx` are missing while there are no requests, and the alarms' real state changes and SNS notifications
- Everything about the AWS Lambda Layer for OpenTelemetry on a Node.js 24 function: whether it starts, whether hand-written spans arrive, whether auto-instrumentation works, whether the permissions suffice, whether the browser's `traceparent` is connected
- That cdkd can create, update and read back the dashboard and the metric filter through Cloud Control API
- In pricing: the dashboard price from the fourth onward, the size of the system log lines Lambda writes in the JSON format (1 KB per request is an assumption), and how spans sent through the layer are billed

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/19-observability/infra/lib/observability-stack.ts` | |
| Start with alarms on symptoms | `examples/19-observability/src/alarm-math.ts`, `test/alarm-math.test.ts`, `infra/lib/monitoring.ts` | `test:unit` |
| The first numbers to look at | `examples/19-observability/infra/lib/monitoring.ts`, `infra/test/observability-stack.test.ts` | `test:unit`, `obs:infra:synth` |
| Narrow it down to one request with logs | `examples/19-observability/src/log-shape.ts`, `src/conditions.ts`, `src/queries.ts`, `test/log-shape.test.ts`, `test/queries.test.ts`, `scripts/query.ts` | `test:unit`, `obs:query:print` |
| Counting from logs | `examples/19-observability/src/conditions.ts`, `src/queries.ts`, `infra/lib/monitoring.ts` | `test:unit` |
| Traces: where the time went | `examples/19-observability/src/telemetry.ts`, `src/traced-repository.ts`, `src/app.ts`, `src/compose.ts`, `test/tracing.test.ts` | `test:unit` |
| Getting traces out of Lambda | `examples/19-observability/src/lambda.ts`, `infra/lib/observability-stack.ts`, `infra/bin/app.ts` | `obs:infra:synth`, `test:unit` |
| Following one ID | `examples/19-observability/src/trace-context.ts`, `src/telemetry.ts`, `test/trace-context.test.ts`, `test/tracing.test.ts` | `test:unit` |
| Not every trace is kept | `examples/19-observability/src/local-tracing.ts`, `src/cost-inputs.ts`, `test/tracing.test.ts` | `test:unit` |
| What stays out of logs and traces | `examples/19-observability/src/log-shape.ts`, `src/telemetry.ts`, `test/log-shape.test.ts`, `test/tracing.test.ts` | `test:unit` |
| Seeing it on your machine | `examples/19-observability/src/dev.ts`, `src/local-tracing.ts`, `.env.example` | `dev:obs`, `test:unit` |
| Deploy and check | `examples/19-observability/infra/bin/app.ts`, `scripts/smoke.ts`, `scripts/query.ts`, `scripts/alarms.ts` | `obs:infra:diff`, `obs:infra:deploy`, `obs:smoke`, `obs:query`, `obs:alarms`, `obs:infra:drift` |
| What it costs | `examples/19-observability/src/cost-inputs.ts`, `test/cost-inputs.test.ts`, `data/pricing/` | `test:unit` |
| Cleaning up | `tools/src/infra/` | `obs:infra:destroy` |

**How cdkd (0.296.28) handles the types.** With a dedicated implementation in `src/provisioning/register-providers.ts`: `AWS::CloudWatch::Alarm`, `AWS::SNS::Topic`, `AWS::SNS::Subscription`, `AWS::Logs::LogGroup`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::DynamoDB::Table`, `AWS::ApiGatewayV2::*`. Without one, and so through Cloud Control API: `AWS::CloudWatch::Dashboard` and `AWS::Logs::MetricFilter` (in this chapter's stack), `AWS::RUM::AppMonitor` and `AWS::Synthetics::Canary` (not in this chapter's stack).

**Primary sources** (all checked on 2026-10-12)

- [X-Ray SDK and Daemon Support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html), [Migrating from X-Ray instrumentation to OpenTelemetry instrumentation](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html), [Migrate to OpenTelemetry Node.js](https://docs.aws.amazon.com/xray/latest/devguide/migrate-xray-to-opentelemetry-nodejs.html)
- [AWS Distro for OpenTelemetry: Lambda](https://aws-otel.github.io/docs/getting-started/lambda) (the tables of layer ARNs and supported runtimes were read from the page's source, `src/config/` in `aws-otel/aws-otel.github.io`), [Enable your applications on Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html)
- [Visualize Lambda function invocations using AWS X-Ray](https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html), [Instrumenting Node.js code in AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-tracing.html), [Log and monitor Node.js Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html), [Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html), [Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)
- [Monitor CloudWatch metrics for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html), [Configure logging for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html), [DynamoDB metrics and dimensions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html)
- [Configuring how CloudWatch alarms treat missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html), [Alarm evaluation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html), [Using math expressions with CloudWatch metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/using-metric-math.html), [Notifying users on alarm changes](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)
- [Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html), [filter](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Filter.html), [stats](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Stats.html), [Supported logs and discovered fields](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html), [Working with log groups and log streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)
- [Creating metrics from log events using filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html), [Filter pattern syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html), [Embedding metrics within logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html), [Embedded metric format specification](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)
- [AWS X-Ray concepts](https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html), [Sending trace data to AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-api-sendingdata.html), [Configuring sampling rules](https://docs.aws.amazon.com/xray/latest/devguide/xray-console-sampling.html), [Amazon SQS and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html), [OTLP Endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html), [Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Transaction-Search.html)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html), [Synthetic monitoring (canaries)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)
- [Amazon CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/) (most prices are filled in by script, so only the free tier and the billing rules were read from it; `aws.amazon.com/xray/pricing/` redirects to a CloudWatch page)
- AWS Price List bulk API: [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json), [X-Ray](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSXRay/current/ap-northeast-1/index.json)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- [@opentelemetry/api 1.9.1](https://www.npmjs.com/package/@opentelemetry/api/v/1.9.1) (the version compatibility check is `build/src/internal/semver.js` in the tarball)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Cloudflare Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)

:::
