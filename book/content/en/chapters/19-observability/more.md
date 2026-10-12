---
title: "19 Observability: Build, Continued"
---

# 19 Observability: Build, Continued

The [previous page](/en/chapters/19-observability/build.md) built the log queries and the trace instrumentation. This page connects logs and traces through IDs, then covers the cases where a trace is not kept and what must not be written to logs or traces.

## Following one ID

<!-- section: 19.ids -->

Four kinds of ID have appeared so far.

| ID | Who assigns it | Where you see it |
| --- | --- | --- |
| `requestId` (application) | The application. A UUID per request | The `x-request-id` response header, error bodies, log lines, the span attribute `app.request_id` |
| `@requestId` (Lambda) | Lambda. Per invocation | Logs Insights, the `REPORT` line |
| Trace ID | The first process that started the trace | `traceId` in log lines, X-Ray |
| Span ID | The process that created the span | `spanId` in log lines, X-Ray |

The request ID is the one the user sees, and the trace ID is the one shared across processes. The code therefore makes it possible to look up either one from the other.

<<< @/examples/19-observability/src/telemetry.ts{fields}

Every log line gets a `traceId`, and each span gets the request ID as an attribute. If a user gives you a request ID, the log gives you the trace ID. If you find a slow span on the trace screen, its request ID attribute takes you back to the log. The tests check the lookup in both directions.

### Converting to X-Ray's notation

An OpenTelemetry trace ID is 32 hexadecimal characters. X-Ray writes the same value with `1-` at the front and two hyphens inserted.

<<< @/examples/19-observability/src/trace-context.ts{xray}

The log has the 32-character notation, and the X-Ray console and the `REPORT` line have the hyphenated notation. When you search, convert the ID to the notation used where you are searching.

### Passing it across processes

A W3C specification named Trace Context defines how a trace ID is passed to the next process, and over HTTP it uses the `traceparent` header.

<<< @/examples/19-observability/src/trace-context.ts{traceparent}

The value of `traceparent` is four parts joined by hyphens: a version, the trace ID, the caller's span ID, and flags. The lowest bit of the flags means that the caller is recording this trace.

In this chapter, only the tests and `obs:smoke` parse `traceparent` with the chapter's own code. The real passing between processes is left to OpenTelemetry's propagator.

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

When the browser calls with a `traceparent`, the API continues that trace. When the API puts a message on the queue, it puts the same information on the message, and the worker continues from there. The log of every process has the same `traceId`, so one query returns all the lines.

[Chapter 08](/en/chapters/08-async.md) built the queue and the worker. According to the X-Ray documentation, SQS carries the X-Ray trace header in a message attribute named `AWSTraceHeader`, and a Lambda receiver continues from it automatically. This chapter does not use SQS. Its tests reproduce only the part where the trace is put on a message and the receiver continues it. When the same message is delivered twice, two spans with the same parent appear, as the figure shows. A duplicate delivery is therefore visible in the trace.

One thing has not been checked on a real function. Inside Lambda, the layer has already opened a span for the invocation. In that case this chapter's code does not read `traceparent` itself and places its span under the layer's span. Whether the browser's `traceparent` and Lambda's trace are connected depends on how the layer and Lambda behave. If they are not connected, you can still follow the request with the `traceId` in the log and the request ID.

## Only some traces are kept

<!-- section: 19.sampling -->

This section covers the part of the chapter that is most often misunderstood.

Traces are sampled. Recording every request is expensive, so only some are kept. Lambda's active tracing records the first request of each second and 5% of the rest. You cannot change that rate per function.

The decision to record is made only once. The process that starts the trace decides, and everything downstream follows that decision. If a service in the middle decided again by its own rules, the trace would break off partway.

<<< @/examples/19-observability/src/local-tracing.ts{local}

One consequence follows from this. **A missing span is not evidence that the work did not happen.**

- A request that was not sampled has no spans even when it succeeded
- In a trace that was recorded, a span whose export failed is missing. The work finished and only the span did not arrive
- X-Ray deletes traces after 30 days

The tests reproduce the first two of these three in a fixed order. When a note is created with sampling turned off, the response is 201, the log line is written, `sampled` is `false`, and there are zero spans. When the worker runs with the exporter down, the job has been done once and only the span is missing.

For that reason, check whether something happened with logs and data. Logs are not sampled, and the table shows whether the note was created. A trace is a tool for seeing where things are slow, and it cannot serve as the record of what happened.

That is also why the log line has `sampled`. If you search X-Ray for the trace ID of a line where `sampled` is `false`, nothing comes back. That is not an outage. It is the specified behavior.

## What stays out of logs and traces

<!-- section: 19.privacy -->

[Chapter 06](/en/chapters/06-auth.md) decided that tokens are not written to logs. Each observability tool you add is one more place where data can leak. Logs are kept for 7 days and traces for 30, and both are usually readable by more people than the application's table.

This chapter uses a list of allowed fields, not a list of forbidden ones. A rule such as "remove the field named password" leaks as soon as a field with a different name is added. It is more reliable to decide in advance which fields may be written and to fail a test when any other field appears.

- The log fields are fixed by the `strictObject` schemas on the [previous page](/en/chapters/19-observability/build.md). Adding a field means adding it to the schema, and a person reviews it at that point
- The span attributes are fixed by a test that lists their names. There are only seven: `http.request.method`, `url.path`, `http.response.status_code`, `app.request_id`, `app.repository.operation`, `app.repository.outcome` and `error.type`
- The path does not include the query string. A query string can contain a token, and the authorization code in chapter 06 was an example
- For an exception, only its type is kept. The standard way to record an exception on a span copies the whole message and stack trace. A message can contain input as it was received, so this chapter keeps only the name of the exception type. The details are written once, in the `error` field of the log

The tests send a note body, a token in the query string, an `Authorization` header, a cookie, and an email address inside an exception message, and check that none of them appears in a log line or a span.

One gap remains that this method does not close. The `error` field of the log contains a stack trace, so a library that puts personal data in its exception messages leaks it there. A list of allowed fields cannot prevent that.
