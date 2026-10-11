---
title: "19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/19-observability` does not exist yet.

## Outcome

You follow one request from the browser through Lambda to the queue worker by a single ID.

## Prerequisites

- [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Reading paths: `shortest`

## Planned architecture

Structured logs → CloudWatch Logs. Traces via OpenTelemetry → X-Ray. Alarms → notification.

Services: CloudWatch, X-Ray, CloudWatch RUM, CloudWatch Synthetics

## Topics

- Building on the chapter 04 log format
- OpenTelemetry for new instrumentation; the X-Ray SDK/daemon lifecycle is not the X-Ray service
- Log ingestion and storage cost
- Alarming on symptoms

## The distributed-systems angle

Traces are sampled; a missing span is not necessarily a failure.

## Source required for completion

- Instrumentation setup
- Alarm CDK with assertions
- Pricing inputs deriving cost from log volume

## Primary sources to start from

- [CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html) (not re-read while writing)
- [X-Ray SDK and daemon support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html) (not re-read while writing)
