---
title: "19 Observability: Build, Continued"
---

# 19 Observability: Build, Continued

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
