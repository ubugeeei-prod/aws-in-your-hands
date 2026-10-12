---
title: "19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics"
sourceRevision: 5
---

# 19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics

Since chapter 04, the API has written one line of JSON to the log for each request and put an `x-request-id` on every response. A log tells you nothing, though, until somebody goes and reads it.

This chapter does two things: it makes sure you notice when something is wrong, and it makes sure you can follow the problem to its cause once you have noticed. You take the notes API from [chapter 05](/en/chapters/05-dynamodb.md) and add alarms, ways to search the logs, and traces. The chapter 05 application code does not change by a single line. You wrap it from the outside.

Cost is the other subject. If you add observability tools without thinking about it, they end up costing more than the thing they observe. The [last page](/en/chapters/19-observability/wrap.md) works the numbers down to what one more log line costs.

You need [chapter 04](/en/chapters/04-http-api.md) first. The code is in `examples/19-observability/`.

## The big picture

<!-- section: 19.overview -->

```figure
caption: Metrics come off the path a request takes, and an alarm tells you by email through SNS
node client: Browser / curl
node api: API Gateway HTTP API
node fn: Lambda | The app from chapter 05
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

You work with three kinds of tool, metrics, logs and traces, and each answers a different question.

Metrics are numbers over time, such as request counts, error counts and response times. They tell you whether something is wrong right now. They are cheap and they are kept for a long time, but they cannot tell you which request went wrong.

Logs are a record of each event, so they tell you which request failed and how. That detail costs money in proportion to how much you write.

A trace records the path one request took and the time each part of it needed, so it tells you where the time went. Not every trace is kept, which [Only some traces are kept](/en/chapters/19-observability/more.md) covers in detail.

You use them in that order: an alarm makes you notice, metrics and logs narrow the problem down, and a trace lets you follow it.

### Why this stack is separate from chapter 05's

Chapter 05's `NotesStack` does not expose its function or its API in a form other code can reach. Adding alarms also means changing the function's settings (tracing and the log format), so this chapter keeps a table and an API of the same shape in a stack of its own. About 60 lines of infrastructure are repeated, but the application code is chapter 05's, loaded unchanged as a workspace dependency. The monitoring part is a separate construct named `Monitoring`, so you can carry it into your own stack.

Anyone who knows the URL can call this API too, so it has the same bounds as chapter 05.

<<< @/examples/19-observability/infra/lib/observability-stack.ts{bounds}

<<< @/examples/19-observability/infra/lib/observability-stack.ts{throttle}

The API accepts at most 10 requests a second, the table has a ceiling on request units per second, and notes stop at 100 as they do in chapter 05. Anything beyond those limits becomes a 429 or a 409 response and not a charge. What hitting the limits looks like on the dashboard, and where the cost stops, is under [When it gets hammered](/en/chapters/19-observability/wrap.md) in the cost section.

## Alarms on symptoms

<!-- section: 19.alarms -->

Put alarms on symptoms, not on causes. Two things hurt a user: getting an error and getting a slow answer. DynamoDB throttling is only one possible cause, and what the user sees in the end is one of those two. If you create an alarm for each cause, you end up with so many that nobody looks when one fires.

So this chapter has only two alarms.

<<< @/examples/19-observability/src/alarm-math.ts{rules}

The first alarm watches the share of 5xx responses. It uses a share and not a count because the number of failures grows with the number of requests. A share on its own has a problem, though: two requests late at night with one failure is 50%, and that would wake you up. To avoid that, a minute with fewer than 20 requests counts as a rate of 0.

The same condition is also written as a function that means what the CloudWatch expression means.

<<< @/examples/19-observability/src/alarm-math.ts{point}

The stack uses those constants and expressions as they are.

<<< @/examples/19-observability/infra/lib/monitoring.ts{error-rate}

Two settings in this code are easy to miss.

One is the rule of three minutes out of five. With `evaluationPeriods: 5` and `datapointsToAlarm: 3`, the alarm fires when three of the last five data points are above the threshold. The three do not have to be consecutive. A spike that lasts one minute does not fire the alarm, and a problem that continues fires it in about three minutes.

The other is how to count a minute with no data. A minute without a single request has no data point at all. CloudWatch treats that as missing data and has you choose how to count it with `treatMissingData`. With the default, `missing`, the alarm goes to `INSUFFICIENT_DATA` when every point is missing. With `breaching`, it fires every night that nobody uses the API. This chapter uses `notBreaching`, which counts a missing point as no problem. The official documentation also recommends `notBreaching` for metrics that report a value only when an error occurs.

The tests feed the rule inputs that would break that decision.

<<< @/examples/19-observability/src/alarm-math.ts{state}

`alarmState` is a model for thinking about the condition. CloudWatch itself looks further back than five points when data is missing, and the model does not reproduce that. The model is still enough to check that the alarm stays quiet on a quiet night, that `breaching` would fire every night, and that a one-minute spike does not fire it.

The model also shows one limit. **A quiet night and an outage that nobody can get through look the same to this alarm.** In both cases no request arrives and there is no data point. Telling them apart takes something that calls the API from outside on a schedule. That is Synthetics, which the [deploy page](/en/chapters/19-observability/deploy.md) introduces.

The second alarm watches slowness.

<<< @/examples/19-observability/infra/lib/monitoring.ts{latency}

An average hides the slow few among the fast many, so the alarm watches p95, the 95th percentile. It measures API Gateway's `Latency` and not Lambda's `Duration`. `Duration` does not include cold start time, so the value measured at the entrance is closer to how long the user waited.

### Where notifications go

<<< @/examples/19-observability/infra/lib/monitoring.ts{topic}

<<< @/examples/19-observability/infra/lib/monitoring.ts{actions}

The alarms notify an SNS topic, and the topic delivers to email. An email address is subscribed only if you pass one when you deploy. The subscription stays pending until you click the link in the confirmation email, so if you forget to click it, nothing arrives when the alarm fires.

`enforceSSL` refuses a publish that arrives over an unencrypted connection. Setting it gives the topic a policy, and a topic that has its own policy stops using the default one. The stack therefore adds a statement that allows the CloudWatch alarms of this account to publish. Without that statement the alarm fires and no notification goes out. This combination has not yet been checked against real AWS.

The alarms also notify when they return to OK, because you want to know when the incident ended as well.

## The first numbers to look at

<!-- section: 19.metrics -->

When an alarm fires, open the dashboard. The top row shows symptoms and the rows below show possible causes.

<<< @/examples/19-observability/infra/lib/monitoring.ts{dashboard}

Here are the metrics to look at first for each service.

For the API Gateway HTTP API, look at `Count`, `4xx`, `5xx`, `Latency` and `IntegrationLatency`. `Latency` is the time from receiving the request to returning the response, and `IntegrationLatency` is the part of it spent waiting for Lambda. A large gap between the two means the time is being spent on the API Gateway side. Per-route numbers appear only if you enable detailed metrics. Requests that the stage throttle refuses are 429s, so they are counted in `4xx`. The name of the line on the dashboard says so.

For Lambda, look at `Errors`, `Throttles`, `Duration` and `ConcurrentExecutions`. `Errors` needs care, because it counts only invocations that ended in an exception and timeouts. This application catches exceptions and returns a 500 response, so Lambda's `Errors` stays at 0 while users are receiving 500s. That is why the symptom alarm is on API Gateway's `5xx`. If `Errors` does rise, suspect a cause outside the application, such as a timeout, a failed initialization or running out of memory. `Throttles` is counted in neither `Invocations` nor `Errors`, so look at it separately.

For DynamoDB, look at `ThrottledRequests`, `SystemErrors` and `ConditionalCheckFailedRequests`. `ConditionalCheckFailedRequests` is the number of times chapter 05's optimistic locking stepped in. `ThrottledRequests` also rises when requests hit the ceiling set on the table.

There is one dashboard, and it refers to no more than 50 metrics because that is as far as the free tier goes. A test watches that limit.
