---
title: "19 Observability: Costs, Pitfalls, and Cleanup"
---

# 19 Observability: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 19.cost -->

This page works out what the alarms, logs and traces built so far cost. Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The calculations are in the [pricing worksheets](/en/reference/pricing.md). Chapters 04 and 05 priced the API, Lambda and DynamoDB themselves, so this section covers only the cost of observing.

**A month in which nobody calls the API costs 0.30 at list price and 0 after the free tier.** Only the alarms cost anything, at 0.10 a month for each metric an alarm refers to. The two alarms refer to three metrics. The 5xx rate uses both `Count` and `5xx`, so that alarm alone counts as two. Without requests there are no logs and no traces.

At 1,000,000 requests a month, the cost is as follows.

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

The assumptions are 1 KB of logs per request, 7-day retention, and requests arriving at a steady rate.

Traces are the most expensive item. A million requests a month averages 0.38 requests a second. Lambda's sampling always records the first request of each second, so at this rate every request becomes a trace.

<<< @/examples/19-observability/src/cost-inputs.ts{traces}

The count in the table is an upper bound. Real requests arrive unevenly, and those that fall in the same second are recorded at only 5%, so the count goes down. Seen the other way, the less traffic a service has, the closer the share of traced requests gets to 100%. Observing can therefore cost more than the API and Lambda themselves, which chapter 04 priced at 2.02 at list price.

The free tier is 5 GB each for log ingestion, storage and queries, 10 custom metrics, alarms on 10 metrics, 3 dashboards, 100,000 traces recorded a month and 1,000,000 retrieved a month. All of it is shared across the whole account.

The dashboard is left out of the amounts on the assumption that it fits within the 3 free ones. The unit price from the fourth dashboard onward was not in the Tokyo list of the Price List and could not be read from the pricing page either, so it is recorded as unknown.

### When it gets hammered

This API has no authentication, so anyone who knows the URL can call it, and so can a bot. This section therefore also works out the cost of the API being hammered for a whole month.

First, check where the traffic stops. The stage throttle is 10 requests a second (burst 20), so at most 25.92 million requests reach the function in 30 days. API Gateway answers anything beyond that with a 429, and the function is not invoked. The table accepts up to 150 read request units and 40 write request units a second. Notes stop at 100, so storage does not keep growing.

The list price for a month spent at those limits is as follows.

| Item | Quantity | List price |
| --- | --- | --- |
| API Gateway | 25.92 million requests | 33.44 |
| Lambda (assuming 60 ms, 256 MB) | 25.92 million invocations | 10.37 |
| DynamoDB writes | the ceiling of 40 units a second | 74.13 |
| DynamoDB reads | the ceiling of 150 units a second | 55.40 |
| Log ingestion and storage | 24.7 GB | 18.98 |
| Traces recorded | 3.76 million | 18.79 |
| Total | | **211.11** |

The observing part, logs and traces together, is 37.77. Traces do not grow as fast as traffic because they are sampled. At 10 requests a second, what is recorded is the first request plus 5% of the other nine, which is 1.45 a second. The more traffic there is, the smaller the share that is traced. The share of requests that are logged does not fall, and every request that arrives adds lines.

Whether API Gateway charges for requests it refuses with a 429 has not been checked here. If it does, the first row of the table above, and only that row, does not stop at 25.92 million.

Data transfer for the responses is not in the table either. Chapter 05's contract sets the response size: a list is one page of 20 summaries and at most 20 KiB, and one note is at most 64 KiB. At 10 requests a second for 30 days, if every response is a list, that is about 494 GB, and applying the unit price for transfer out to the internet (0.114 per GB) gives about 56. Even if every response were one 64 KiB note, it would stay at about 1,582 GB and about 180. Whether that unit price applies as it is to API Gateway responses has not been checked.

Seen through what this chapter built, a flood looks like this.

- At the top left of the dashboard, the `4xx` line jumps. 429s are counted in `4xx`, which is why the line is named `4xx (429 when throttled)`
- No alarm fires, because a 429 is not a 5xx and it is answered quickly. That is correct behavior for alarms placed only on symptoms, but real users who share the same 10 requests a second receive 429s too
- When traffic hits the table's ceiling, an alarm does fire. DynamoDB throttles, and if the SDK's retries do not get through either, the application returns 500. `DynamoDB: throttled requests` then rises and the 5xx rate alarm fires. On a table with a ceiling, too much traffic shows up as an outage
- Logs and traces have no record of the 429s, because those requests never reached the function. That is why you need the access log listed under "For production"

Before you let real users in, add authentication (chapter 06) and a per-IP limit at the entrance. AWS WAF cannot be attached to an HTTP API directly, so that means putting CloudFront in front (chapter 21; the web ACL costs 8.00 a month just for existing).

### The cost of one more log line

The request line measured 167 bytes, and a test pins that number. Writing one more line of the same size for each request comes to 0.156 GB at 1,000,000 requests a month, which is **0.12 a month**.

<<< @/examples/19-observability/src/cost-inputs.ts{logs}

That looks small, but it grows in proportion to the number of requests, so at 100 million requests a month it is 100 times as much. A line that writes the whole input for debugging is also far larger than 167 bytes.

The three trace fields this chapter added (`traceId`, `spanId`, `sampled`) are 88 bytes per line. By the same calculation, that is 0.082 GB of ingestion per 1,000,000 requests a month. That is what it costs to look up logs and traces from each other.

### The cost of one more metric

A custom metric costs **0.30 a month** each, for the first 10,000. It is charged by the hour, only for the hours in which data points arrived.

Dimensions are what you need to watch. CloudWatch counts each combination of dimension values as one metric. If you add a route dimension to `NoteConflicts`, you pay 0.30 for each route, and if you add a user ID, 0.30 for each user. When you want to know who had a conflict, or on which note, use a log query and not a metric.

### Choosing a retention period

Most of the cost of logs is ingestion (0.76 per GB), and storage (0.033 per GB-month) is less than a twentieth of that. At the same traffic, 7-day retention keeps 0.22 GB stored and one year keeps 11.6 GB.

So decide retention by how far back you want to investigate and how long you are allowed to keep the data, more than by cost. For investigating incidents, add the time it takes to notice to the time it takes to investigate, which gives two to four weeks. If an audit or a law sets a period, use that period. If the logs may contain personal data, shorter is safer. A log group with no setting keeps its data indefinitely, so always set something.

When you want to reduce cost, writing less has more effect than shortening retention.

### RUM and Synthetics

Neither is in this chapter's stack. These are rough costs for when you add them.

- Synthetics costs 0.0019 for each canary run. Running one canary every 5 minutes is 8,760 runs a month, which is **16.64** at list price and 16.45 after the free tier of 100 runs a month. The Lambda, S3 and log charges that a canary incurs are separate
- RUM costs 1 per 100,000 events. At 20 events per visit (the number in the pricing page's example), collecting all of 10,000 visits a month comes to **2.00**. There is a one-time free trial of 1 million events, but it is not a monthly allowance, so it is not deducted

A canary that runs every minute costs five times as much as one that runs every 5 minutes. Decide the interval by how many minutes of downtime you can accept.

Destroying the stack stops this chapter's charges.

## How Cloudflare Workers differs

<!-- section: 19.workers -->

Observing Cloudflare Workers takes far fewer settings. The table lists the differences.

| | Cloudflare Workers | This chapter (CloudWatch and X-Ray) |
| --- | --- | --- |
| Logs | Workers Logs. On by default for new Workers. Fields of JSON logs are indexed automatically | CloudWatch Logs. You decide the log group, the retention and the log format |
| Log retention | 7 days at most | From 1 day to indefinitely |
| Log pricing | The Paid plan includes 20 million events a month, then USD 0.60 per additional million (by event count) | By bytes ingested and by volume stored |
| Traces | Enabled in configuration, instrumented automatically with no code change (beta). Records every request by default | Active tracing is configuration only. Inside the function needs the OpenTelemetry layer or code. One per second plus 5% by default |
| Trace retention | 7 days | 30 days |
| Alarms | Not checked in this chapter | CloudWatch alarms and SNS |
| Sending elsewhere | Can export to an OpenTelemetry endpoint | Instrumented with OpenTelemetry, the destination need not be X-Ray |

Workers takes less time to get started. On AWS you decide the retention, the sampling, the log format and the alarm conditions yourself. In exchange, you can keep data longer and define conditions in detail.

One caution applies to Workers pricing. According to the official documentation, Workers Logs and traces move to a new pricing scheme named Cloudflare Observability on December 1, 2026. The amounts in the table above are the ones that apply until then. The details of the new scheme were not checked for this chapter.

On either platform, instrumenting with OpenTelemetry keeps the application code from being tied to the observability backend. This chapter's `telemetry.ts` contains no code specific to AWS.

## Common problems

| If this happens | Look here |
| --- | --- |
| An alarm stays in `INSUFFICIENT_DATA` | This is normal right after a deploy. If it continues while requests arrive, check that the metric's dimension (`ApiId`) matches the real API |
| The alarm is in `ALARM` and no email arrives | The SNS subscription is still pending. Check that you clicked the link in the confirmation email |
| The alarm is in `ALARM`, the subscription is confirmed, and still no email arrives | Check that the topic's policy still has the statement that allows CloudWatch to publish. A topic with `enforceSSL` does not use the default policy |
| You get a 429 | This is the stage throttle (10 a second, burst 20). Look at `4xx` on the dashboard. Nothing is written to the application's log |
| Creating a note returns 409 `quota_exceeded` | This is the limit of 100 notes. Delete one and you can create another |
| Users get 500s and Lambda's `Errors` is 0 | This is normal. The application catches the exception and returns a 500. Look at API Gateway's `5xx` |
| `obs:query` finds no lines | Check that the time range (`--minutes`) is wide enough. Logs arrive a few seconds late. If there is still nothing, the log shape may differ from what was assumed (`obs-lambda-json-log-shape` in the verification notes) |
| `NoteConflicts` has no data | A metric filter applies only to logs written after it was created. Also check that the logs are in the JSON format |
| Log lines have no `traceId` | No SDK is registered. In stage 1, without the layer, this is normal |
| The log has a `traceId` but X-Ray cannot find it | Look at `sampled` on that line. `false` means the trace was not recorded. If it is `true`, convert the ID to the hyphenated notation and search again |
| The function does not start after you add the layer | Look for layer errors in the function's log. Also check that the runtime is in the layer's list of supported runtimes |
| A trace breaks off partway | Either the sampling decision was not carried over or a span failed to export. Connect the parts with the `traceId` in the logs |

## For production

- Set the alarm thresholds from your own service's numbers. 5% and one second are practice values. Watch the metrics for a week or two first to learn the normal values, then decide
- Add monitoring from outside. If there are hours with no users, Synthetics lets the alarms tell a quiet night apart from an outage that nobody can get through
- Connect notifications to the people on call. A single email is not read late at night, so point the SNS topic at chat or an on-call system
- Enable API Gateway access logs. A request that never invoked the function because of throttling or a timeout leaves nothing in the application's log, but it is in the access log
- Change the throttle and the ceilings to your own service's numbers. 10 a second, 150 and 40 on the table, and 100 notes are practice bounds. As usage grows, review them before real users start receiving 429s. If you put an alarm on `4xx`, decide the threshold after looking at the normal values
- Decide the log retention period. Seven days is a practice value
- Write the response steps into the alarm. If `alarmDescription` names the first dashboard and query to open, nobody has to work it out when the alarm fires
- Encrypt the topic and check what a notification contains. An alarm notification includes metric names and thresholds. This chapter's topic goes only as far as encryption in transit (`enforceSSL`) and specifies no key for encryption at rest
- Deploy through the AWS CDK CLI and CloudFormation, for the reasons chapter 02 gives

## Cleaning up

<!-- section: 19.cleanup -->

```bash
vp run obs:infra:destroy
```

This deletes the table, the function, the API, the log group, the alarms, the dashboard, the topic and the metric filter. The notes and the logs are deleted with them.

Two things are not deleted with the stack. Traces recorded in X-Ray remain until they are 30 days old (the charge is for the number recorded). The data points of the `NoteConflicts` metric are not a stack resource either, so they remain in CloudWatch. How to delete either was not checked for this chapter.

The only other thing that remains is the storage created by cdkd's bootstrap (chapter 02).

## As a distributed system

The observability tools are themselves a distributed system: their records travel by a different path from the application's and arrive with a different reliability.

- Owner of the state: the table, which holds the data, and the logs, which record the requests, own what happened. Metrics are aggregates and traces are samples
- Invariant: whether or not it was sampled, every request leaves one log line with a request ID. Whether a trace exists says nothing about whether the work succeeded
- Tests that try to break the invariant: with sampling turned off, with a caller that says not to record, and with the exporter down, the tests check that the response and the log do not change
- Duplicates: metric filters and EMF deliver at least once, so a metric value is occasionally counted too high. When you need an exact count, count log lines or items in the table
- Delay: logs and metrics arrive seconds to minutes late. By the time an alarm fires, the incident has already lasted a few minutes

::: details Verification notes for this chapter

**Checked locally.** Unit tests for the application, the log queries, tracing, the alarm conditions, the pricing inputs and the infrastructure. Type checking. Synth, including the esbuild bundle, also with `-c otelLayerArn`. Started `dev:obs` and ran the `curl` commands from the text, confirming that the spans and log lines correspond, that `traceparent` is continued, and that no span is printed with `TRACE_SAMPLE_RATIO=0`. The output of `obs:query:print`. The argument names the scripts use, against the AWS CLI's help for `logs start-query`.

**Not checked yet.** `obs:infra:deploy`, `obs:smoke`, `obs:query`, `obs:alarms`, `obs:infra:drift` and `obs:infra:destroy` have not been run against real AWS. In particular, the following points were only read from documentation.

- That under Lambda's JSON log format the application's JSON line becomes one log event as it is. If it does not, change the logger's output to `process.stdout` in `src/compose.ts`, or change the field names in the queries
- That Logs Insights accepts the generated query string
- That the metric math `IF` expression is accepted, that `Count` and `5xx` are missing while there are no requests, and the real state changes of the alarms and the SNS notifications
- Everything about attaching the AWS Lambda Layer for OpenTelemetry to a Node.js 24 function: whether it starts, whether hand-written spans arrive, whether auto-instrumentation works, whether the permissions are enough, and whether the browser's `traceparent` is connected
- That cdkd can create, update and read back the dashboard and the metric filter through Cloud Control API
- That the bounds actually take effect. Whether cdkd 0.296.28 applies the stage's `DefaultRouteSettings` (10 a second, burst 20) and the table's `OnDemandThroughput` (150 and 40). The source of the pinned version has code that handles both properties, but it has not been run. Also unchecked: that 429s are counted in `4xx`, whether API Gateway charges for a 429, and how the SDK's retries behave before a request that hits the table's ceiling becomes a 500
- That CloudWatch alarms can publish to a topic with `enforceSSL`. A test checks that the allowing statement is in the template, but not a single notification has been sent
- In pricing: the unit price of dashboards from the fourth onward, the size of the system logs Lambda writes in the JSON format (1 KB per request is an assumption), and how spans sent through the layer are billed

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Overview | `examples/19-observability/infra/lib/observability-stack.ts`, `src/compose.ts`, `test/compose.test.ts`, `infra/test/observability-stack.test.ts` | `test:unit` |
| Alarms on symptoms | `examples/19-observability/src/alarm-math.ts`, `test/alarm-math.test.ts`, `infra/lib/monitoring.ts` | `test:unit` |
| The first numbers to look at | `examples/19-observability/infra/lib/monitoring.ts`, `infra/test/observability-stack.test.ts` | `test:unit`, `obs:infra:synth` |
| Narrowing down to one request with logs | `examples/19-observability/src/log-shape.ts`, `src/conditions.ts`, `src/queries.ts`, `test/log-shape.test.ts`, `test/queries.test.ts`, `scripts/query.ts` | `test:unit`, `obs:query:print` |
| Counting from logs | `examples/19-observability/src/conditions.ts`, `src/queries.ts`, `infra/lib/monitoring.ts` | `test:unit` |
| Traces: where the time went | `examples/19-observability/src/telemetry.ts`, `src/traced-repository.ts`, `src/app.ts`, `src/compose.ts`, `test/tracing.test.ts` | `test:unit` |
| Tracing in Lambda | `examples/19-observability/src/lambda.ts`, `infra/lib/observability-stack.ts`, `infra/bin/app.ts` | `obs:infra:synth`, `test:unit` |
| Following one ID | `examples/19-observability/src/trace-context.ts`, `src/telemetry.ts`, `test/trace-context.test.ts`, `test/tracing.test.ts` | `test:unit` |
| Only some traces are kept | `examples/19-observability/src/local-tracing.ts`, `src/cost-inputs.ts`, `test/tracing.test.ts` | `test:unit` |
| What stays out of logs and traces | `examples/19-observability/src/log-shape.ts`, `src/telemetry.ts`, `test/log-shape.test.ts`, `test/tracing.test.ts` | `test:unit` |
| Seeing it on your machine | `examples/19-observability/src/dev.ts`, `src/local-tracing.ts`, `.env.example` | `dev:obs`, `test:unit` |
| Deploy and check | `examples/19-observability/infra/bin/app.ts`, `scripts/smoke.ts`, `scripts/query.ts`, `scripts/alarms.ts` | `obs:infra:diff`, `obs:infra:deploy`, `obs:smoke`, `obs:query`, `obs:alarms`, `obs:infra:drift` |
| Cost | `examples/19-observability/src/cost-inputs.ts`, `test/cost-inputs.test.ts`, `data/pricing/` | `test:unit` |
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
