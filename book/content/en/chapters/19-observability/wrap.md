---
title: "19 Observability: Costs, Pitfalls, and Cleanup"
---

# 19 Observability: Costs, Pitfalls, and Cleanup

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

### When it's hammered

This API has no authentication. Anyone who knows the URL can call it, and so can a bot. So what does a month of nonstop hammering come to?

First, where it stops. The stage throttle is 10 requests a second (burst 20), so at most 25.92 million requests reach the function in 30 days. API Gateway answers the rest with a 429, and the function isn't invoked. The table takes up to 150 read request units and 40 write request units a second. Notes stop at 100, so storage doesn't keep growing.

Here's the list price for a month pinned at those limits.

| Item | Quantity | List price |
| --- | --- | --- |
| API Gateway | 25.92 million requests | 33.44 |
| Lambda (assuming 60 ms, 256 MB) | 25.92 million invocations | 10.37 |
| DynamoDB writes | the ceiling of 40 units a second | 74.13 |
| DynamoDB reads | the ceiling of 150 units a second | 55.40 |
| Log ingestion and storage | 24.7 GB | 18.98 |
| Traces recorded | 3.76 million | 18.79 |
| Total | | **211.11** |

The observing part, logs and traces together, is 37.77. Traces grow less than you might expect, thanks to sampling: at 10 requests a second, what's recorded is "the first one, plus 5% of the other nine," 1.45 a second. The more traffic, the smaller the share that is traced. Logs don't shrink that way. Every request that arrives adds its lines.

Whether API Gateway charges for requests it turns away with a 429 isn't something I've checked here. If it does, the first row of that table, and only that row, doesn't stop at 25.92 million.

One more thing the table leaves out: data transfer for the responses. Chapter 05's contract sets the response size: a list is one page of 20 summaries and at most 20 KiB, and one note is at most 64 KiB. At 10 requests a second for 30 days, if every response is a list, that's about 494 GB, and at the unit price for transfer out to the internet (0.114 per GB) about 56. If every response were one 64 KiB note, it would still stop at about 1,582 GB, or about 180. Whether that price applies as is to API Gateway responses hasn't been checked.

So how does a flood look in what this chapter built?

- **Top left of the dashboard.** The `4xx` line jumps. 429s land there, which is why the line is named `4xx (429 when throttled)`
- **No alarm fires.** A 429 isn't a 5xx, and it comes back fast. For alarms placed only on symptoms that's the right behavior, but real users sharing the same 10 a second get 429s too
- **Hit the table's ceiling, and one does.** DynamoDB throttles, and if the SDK's retries don't get through either, the application answers 500. `DynamoDB: throttled requests` climbs and the 5xx rate alarm fires. With a ceiling on the table, "too much traffic" shows up as an outage
- **Logs and traces have no record of the 429s.** They never reached the function. That's what the access log under "For production" is for

Before you let real users in, add authentication (chapter 06) and a per-IP limit at the entrance. AWS WAF can't be attached to an HTTP API directly, so that means putting CloudFront in front (chapter 21; the web ACL is 8.00 a month just for existing).

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
| The alarm is in `ALARM`, the subscription is confirmed, and still no mail | Does the topic's policy still have the statement that lets CloudWatch publish? A topic with `enforceSSL` doesn't use the default policy |
| You get a 429 | That's the stage throttle (10 a second, burst 20). Look at `4xx` on the dashboard. The application's log has nothing |
| Creating a note answers 409 `quota_exceeded` | The limit of 100 notes. Delete one and it works |
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
- **Reset the throttle and the ceilings to your own service's numbers.** 10 a second, 150 and 40 on the table, and 100 notes are practice bounds. As usage grows, revisit them before real users start getting 429s. If you put an alarm on `4xx`, look at what's normal before choosing the threshold
- **Decide the log retention.** Seven days is a practice value
- **Write the response steps into the alarm.** Put the first dashboard and query to open into `alarmDescription`, and nobody has to think when it fires
- **Encrypt the topic, and check what a notification carries.** An alarm notification contains metric names and thresholds. This chapter's topic goes as far as encryption in transit (`enforceSSL`) and names no key for encryption at rest
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
- That the bounds actually bite. Whether cdkd 0.296.28 applies the stage's `DefaultRouteSettings` (10 a second, burst 20) and the table's `OnDemandThroughput` (150 and 40). The pinned version's source has code that handles both properties, but it has not been run. Also unchecked: that 429s are counted in `4xx`, whether API Gateway charges for a 429, and how the SDK's retries play out before a request that hits the table's ceiling becomes a 500
- That CloudWatch alarms can publish to a topic with `enforceSSL`. A test sees the allowing statement in the template, but not one notification has been sent
- In pricing: the dashboard price from the fourth onward, the size of the system log lines Lambda writes in the JSON format (1 KB per request is an assumption), and how spans sent through the layer are billed

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/19-observability/infra/lib/observability-stack.ts`, `src/compose.ts`, `test/compose.test.ts`, `infra/test/observability-stack.test.ts` | `test:unit` |
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

**How cdkd (0.296.28) handles the types.** With a dedicated implementation in `src/provisioning/register-providers.ts`: `AWS::CloudWatch::Alarm`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::SNS::Subscription`, `AWS::Logs::LogGroup`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::DynamoDB::Table`, `AWS::ApiGatewayV2::*`. Without one, and so through Cloud Control API: `AWS::CloudWatch::Dashboard` and `AWS::Logs::MetricFilter` (in this chapter's stack), `AWS::RUM::AppMonitor` and `AWS::Synthetics::Canary` (not in this chapter's stack).

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
