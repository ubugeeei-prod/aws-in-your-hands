---
title: "16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/16-long-jobs` does not exist yet.

## Outcome

You build a full-notes export that resumes where it stopped after an interruption.

## Prerequisites

- [08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)
- [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Reading paths: `containers`

## Planned architecture

Scheduler → workflow (Step Functions or a durable function) → Lambda or ECS task per step → S3.

Services: Step Functions, Lambda durable functions, ECS, AWS Batch, EventBridge Scheduler

## Topics

- Lambda's 15-minute limit and splitting work
- Lambda durable functions (resumable progress) versus Durable Objects (state per identity)
- Compensation
- State-transition billing and the cost of waiting

## The distributed-systems angle

Steps can run again; make each one idempotent and choose the checkpoint granularity.

## Source required for completion

- Workflow definition and step implementations
- A test that resuming after a worker interruption produces no duplicate output

## Primary sources to start from

- [Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) (not re-read while writing)
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) (not re-read while writing)
