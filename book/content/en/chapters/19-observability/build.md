---
title: "19 Observability: Design and Build"
---

# 19 Observability: Design and Build

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
