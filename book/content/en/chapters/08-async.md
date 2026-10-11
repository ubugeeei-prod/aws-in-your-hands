---
title: "08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/08-async` does not exist yet.

## Outcome

Thumbnail generation moves to a queue, and a message delivered twice still produces one result.

## Prerequisites

- [07 Upload Images: Presigned URLs and S3](/en/chapters/07-uploads.md)

Reading paths: `shortest`

## Planned architecture

S3 event → SQS → Lambda worker → S3 / DynamoDB. Failures go to a DLQ. Scheduler triggers periodic cleanup.

Services: SQS, Lambda, EventBridge Scheduler

## Topics

- At-least-once delivery and the visibility timeout
- Partial batch responses
- Idempotency keys with conditional writes
- Monitoring and redriving a DLQ
- Backpressure and concurrency limits

## The distributed-systems angle

Invariant: at most one thumbnail record per image. Using SQS does not by itself provide exactly-once processing.

## Source required for completion

- Worker and idempotency store
- Deterministic tests injecting duplicates, reordering, and mid-flight interruption
- CDK for queue, DLQ, and event source mapping with assertions

## Primary sources to start from

- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html) (not re-read while writing)
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) (not re-read while writing)
