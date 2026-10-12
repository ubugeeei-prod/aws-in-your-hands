---
title: "19 Observability: Design and Build"
---

# 19 Observability: Design and Build

The [previous page](/en/chapters/19-observability.md) put alarms on symptoms and built the dashboard you open when one fires. This page implements how to narrow a problem down to a single request with logs, and how to see where the time went with traces.

## Narrowing down to one request with logs

<!-- section: 19.logs -->

Once you know that 5xx responses are increasing, the next thing you want to know is which requests are failing. CloudWatch Logs Insights lets you write a query against a log group to find out.

Before you write queries, fix the shape of the log. The chapter 05 application writes two kinds of line.

<<< @/examples/19-observability/src/log-shape.ts{shape}

Because the schemas use `strictObject`, a test fails as soon as a single field that is not listed here appears in the log. [What stays out of logs and traces](/en/chapters/19-observability/more.md) relies on the same property for personal data.

The queries are not written directly as strings. They are held as a structure first.

<<< @/examples/19-observability/src/queries.ts{model}

The structure is there because a Logs Insights query cannot be run on your machine. The condition that decides which lines a query selects can be evaluated locally, though. If the same structure produces both the string that goes to AWS and a filter that runs locally, a test can check that the query fits the shape of the real log.

There are four queries.

<<< @/examples/19-observability/src/queries.ts{queries}

`byRequestId` is the reason chapter 04 put `x-request-id` on every response. When a user reports an error, ask for the `x-request-id` of the response and pass it to this query. It returns only the lines that request wrote: the request line and, if there is one, the line with the stack trace.

Zod checks that the ID is a UUID, because a value from outside is being placed into a query string and that needs the same care as SQL.

The tests run the real application, have it write log lines, and apply the queries to those lines.

<<< @/examples/19-observability/src/queries.ts{run}

The tests check that filtering by ID returns only the lines of that request, that the 5xx count does not include any 4xx, and that every field name a query refers to exists in the log schema. Because of the check on field names, a test fails here if someone renames a log field in chapter 05.

The tests do not check that Logs Insights accepts this string and returns the same result. The syntax follows the examples in the official documentation, but the queries have not been run.

You do not need AWS to look at the query string.

```bash
vp run obs:query:print --name errors
```

```text
filter message = "request" and status >= 500
| stats count(*) as requests by method, path
| sort requests desc
| limit 20
```

### The two request IDs

Logs Insights adds a field named `@requestId` to Lambda logs automatically. `@requestId` is the ID Lambda assigns to each invocation, and it is not the application's `requestId`. The ID you return to users is the application's, so the queries use `requestId` without the `@`. The two names are similar and easy to mix up.

### Why the log format is JSON

The functions in chapters 04 and 05 keep Lambda's default log format, which is plain text. In the text format, the Node.js runtime puts a timestamp, Lambda's request ID and a log level in front of what `console.log` writes. One event in CloudWatch Logs is therefore not pure JSON. It is a prefix followed by JSON.

Logs Insights finds fields in the first JSON fragment of a Lambda log line, so the way chapter 04 searches works with the text format too. The JSON pattern of the metric filter in the next section, however, is meant for JSON logs. The documentation did not make clear whether it matches a line with a prefix.

For that reason, the function in this chapter uses the JSON log format.

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

According to the official documentation, in the JSON format Lambda does not wrap a line that is already JSON a second time. If that holds, each line the application writes becomes one log event as it is. This has not been checked on a real function. The [verification notes](/en/chapters/19-observability/wrap.md) say what to change if it turns out to be different.

## Counting from logs: metric filters and EMF

<!-- section: 19.log-metrics -->

In chapter 05, an update based on an old version is refused with a 409. API Gateway's metrics cannot tell you how often that happens, because `4xx` counts 400, 404 and 409 together.

The log already has a line with `status: 409`, though, so counting those lines is enough.

<<< @/examples/19-observability/src/queries.ts{conflicts}

<<< @/examples/19-observability/infra/lib/monitoring.ts{metric-filter}

A metric filter is a setting that counts the lines arriving in a log group that match a pattern and turns the count into a metric. Its condition is built from the same structure as the queries above.

<<< @/examples/19-observability/src/conditions.ts{render}

You should know three properties of a metric filter. First, it does not apply to logs written before the filter was created. Second, delivery is at least once, so a line is occasionally counted twice. Third, if you add a dimension, each distinct value becomes a separate metric and you are charged for each one.

There is a second way to create metrics from logs. With the embedded metric format (EMF), you write JSON of a fixed shape to the log and CloudWatch extracts the values from it. The two compare as follows.

| | Metric filter | EMF |
| --- | --- | --- |
| Where it is defined | Infrastructure (a setting on the log group) | Application code (the log line itself) |
| Good for | Counting lines that already exist | Emitting values and dimensions from code (durations, counts) |
| Code change | None | Needed |
| Cost | The custom metric. No extra log volume | The custom metric plus the extra log ingestion |

Neither one calls `PutMetricData`, so request handling does not wait for it. This chapter only counts lines that already exist, so it uses a metric filter. If you want to emit durations with dimensions, use EMF.

Two cautions apply if you choose EMF. A dimension with many distinct values, such as a request ID, creates one metric for each value. An EMF line must also be JSON with nothing before or after it. Lambda's official documentation says to write directly to `process.stdout` and not through `console.log` when the log format is JSON.

## Traces: where the time went

<!-- section: 19.tracing -->

Logs tell you what happened, but it is hard to read from them where the time went inside one request. A trace records that breakdown. Each request gets one trace ID, and each part of the work inside it is a span.

The instrumentation uses OpenTelemetry. The next section explains why. First, here is the code.

<<< @/examples/19-observability/src/telemetry.ts{span}

This file imports only `@opentelemetry/api`. `@opentelemetry/api` is the entry point for calls such as starting a span or getting the current span, and the SDK that does the recording is separate. If no SDK is registered, every call does nothing. Whoever starts the process chooses the SDK: locally it is one that prints to the console, and in Lambda it is the layer's SDK. The application code does not know which one is running.

The code wraps chapter 05's repository and creates one span for each call to the table.

<<< @/examples/19-observability/src/traced-repository.ts{repository}

Chapter 05 made the repository an interface, so neither the DynamoDB implementation nor the in-memory one needs to change. Wrapping them from outside is enough.

The whole application is wrapped the same way.

<<< @/examples/19-observability/src/app.ts{app}

The span name is only `GET` or `POST`. If the name were a path containing a note ID, the number of distinct names would grow without limit. The path goes into an attribute.

The following function puts these pieces together.

<<< @/examples/19-observability/src/compose.ts{compose}

## Tracing in Lambda

<!-- section: 19.lambda-tracing -->

The AWS service for traces is X-Ray. People often confuse the end of X-Ray's tools with the end of the service, so this section sorts that out first.

X-Ray came with the X-Ray SDK, which you built into an application, and the X-Ray daemon, which relayed traces. Both entered maintenance mode on February 25, 2026, and they will receive only security fixes from now on. AWS recommends moving instrumentation to OpenTelemetry.

The support timeline page, on the other hand, says nothing about the X-Ray service ending. Traces created with OpenTelemetry are still sent to X-Ray. What is ending is the instrumentation tooling specific to X-Ray, not the service that receives traces and displays them. That is why new code uses OpenTelemetry.

Adding tracing to Lambda takes two stages.

### Stage 1: active tracing, no code

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

With `tracing: lambda.Tracing.ACTIVE`, Lambda itself sends a record of each invocation to X-Ray. The record has a segment for the Lambda service and a segment for the function. You need no SDK and no layer. This alone shows you how long a cold start took.

The execution role gains two actions for writing to X-Ray. These two actions cannot be limited to a resource, so their resource is `*`. The tests in earlier chapters checked that `*` is not used. The test in this chapter checks that `*` appears only for these two actions.

At this stage, spans from inside the function, such as calls to the table, are not recorded. No SDK is present, so the `withSpan` function above does nothing.

### Stage 2: adding the OpenTelemetry layer

Seeing inside the function takes an SDK. For Lambda, AWS's migration guide recommends the AWS Lambda Layer for OpenTelemetry. When you add this layer to the function and set one environment variable, an SDK starts before the function's code is loaded.

<<< @/examples/19-observability/infra/lib/observability-stack.ts{otel-layer}

The layer's ARN changes with the Region and the version, so it is not in the code. You pass it when you deploy.

<<< @/examples/19-observability/infra/bin/app.ts{context}

The ARN is listed under the Node.js tab of the "Lambda Layer ARNs" table in the ADOT (AWS Distro for OpenTelemetry) documentation. As of October 12, 2026, the value for the Tokyo Region was `arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16`. The version keeps increasing, so check the table when you use it.

`OTEL_AWS_APPLICATION_SIGNALS_ENABLED=false` makes the layer produce traces only. By default the layer also enables Application Signals, a separate feature that creates per-service indicators automatically. Application Signals is priced separately, so it is turned off here.

The function's code is the same in stage 1 and stage 2.

<<< @/examples/19-observability/src/lambda.ts{handler}

Four things about stage 2 have not been checked.

- Node.js 24 is not in this layer's list of supported runtimes. The list in the documentation stops at 18, 20 and 22, and this book's functions run on 24. It may work, and it may not
- Whether auto-instrumentation works in a bundled function. The layer turns AWS SDK calls into spans automatically, and it does so by hooking into how libraries are loaded. This book bundles the AWS SDK into a single file with esbuild, so the hook may not take effect. That is why the spans for the table are written by hand and do not rely on auto-instrumentation
- The API version. The `@opentelemetry/api` bundled into the function (1.9.1) connects to the SDK the layer registered through a global variable. According to the API's source, if the minor version of the layer's API is older than ours, our calls silently do nothing. If no spans appear, check this
- Permissions. The documented steps attach the managed policy `CloudWatchLambdaApplicationSignalsExecutionRolePolicy`. This chapter turns Application Signals off and does not attach it, and whether that is enough is unconfirmed

One deploy would settle each of these. Stage 1 alone is enough for the rest of the chapter, so the layer is not attached by default.

You can also trace without the layer. The migration guide lists a way to assemble the SDK yourself and use an exporter for X-Ray. You do not have to wait for runtime support, but you maintain the initialization code yourself. This chapter does not cover it.
