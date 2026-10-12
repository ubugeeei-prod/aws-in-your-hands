---
title: "19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics"
sourceRevision: 2
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

Same shape, so it gets the same bounds. This API, too, can be called by anyone who knows the URL.

<<< @/examples/19-observability/infra/lib/observability-stack.ts{bounds}

<<< @/examples/19-observability/infra/lib/observability-stack.ts{throttle}

The API takes 10 requests a second, the table has a ceiling on request units per second, and notes stop at 100 as in chapter 05. Past those you get a 429 or a 409 and not a bill. How that looks on the dashboard, and where the cost stops, is under "When it's hammered" in the cost section.

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

`enforceSSL` refuses a publish that comes in over an unencrypted connection. Setting it gives the topic a policy of its own, and a topic with its own policy stops using the default one. So the stack also writes down "CloudWatch alarms of this account may publish." Leave that out and the alarm fires while no notification goes out. To be honest, this combination hasn't been checked against real AWS yet.

Recovery (the return to OK) is notified too. When the incident ended is also something you want to know.

## The first numbers to look at

<!-- section: 19.metrics -->

When an alarm fires, open the dashboard. The top row is symptoms; the rows below are candidate causes.

<<< @/examples/19-observability/infra/lib/monitoring.ts{dashboard}

Service by service, here is what to look at first.

**API Gateway HTTP API.** `Count`, `4xx`, `5xx`, `Latency`, `IntegrationLatency`. `Latency` runs from receiving the request to returning the response; `IntegrationLatency` is the part spent waiting for Lambda. A large gap between the two means the time is going on API Gateway's side. Per-route numbers appear only when detailed metrics are enabled. Requests the stage throttle turns away are 429s, so they land in `4xx`. The line on the dashboard is labeled to say so.

**Lambda.** `Errors`, `Throttles`, `Duration`, `ConcurrentExecutions`. Here's the catch. `Errors` counts invocations that ended in an exception, and timeouts. This application catches exceptions and returns a 500 response, so while users are getting 500s, Lambda's `Errors` stays at 0. That is why the symptom alarm sits on API Gateway's `5xx`. And when `Errors` does climb, suspect what is outside the application: a timeout, a failed initialization, memory. `Throttles` count as neither `Invocations` nor `Errors`, so they need their own look.

**DynamoDB.** `ThrottledRequests`, `SystemErrors`, and `ConditionalCheckFailedRequests`. The last one is how often chapter 05's optimistic locking stepped in. `ThrottledRequests` also climbs when requests hit the ceiling set on the table.

There is one dashboard, and it refers to no more than 50 metrics, because that is where the free tier ends. A test guards the limit.
