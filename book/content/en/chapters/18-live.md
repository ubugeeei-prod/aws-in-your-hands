---
title: "18 A Live-Streaming Recipe: IVS"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 18 A Live-Streaming Recipe: IVS

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/18-live` does not exist yet.

## Outcome

You broadcast to an IVS channel from streaming software and watch it in a web player.

## Prerequisites

- [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)


## Planned architecture

Encoder → IVS channel → player. The stream key is handled as a secret.

Services: IVS

## Topics

- Low-latency versus real-time streaming
- Billing by input and viewing hours
- The cost of forgetting to stop a stream
- When MediaLive and friends become necessary

## The distributed-systems angle

Latency differs per viewer; do not assume sync with side channels such as chat.

## Source required for completion

- Channel CDK
- Player page
- A script that checks stream state

## Primary sources to start from

- [What is Amazon IVS?](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html) (not re-read while writing)
