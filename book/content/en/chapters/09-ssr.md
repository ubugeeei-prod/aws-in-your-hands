---
title: "09 SSR and a BFF: Nuxt on Regional Lambda"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 09 SSR and a BFF: Nuxt on Regional Lambda

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/09-ssr` does not exist yet.

## Outcome

A Nuxt app renders HTML on Lambda in the Tokyo region while static assets come from S3.

## Prerequisites

- [03 Publish a SPA: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)
- [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Reading paths: `ssr`

## Planned architecture

CloudFront → (/_nuxt/* from S3) / (everything else to SSR on Lambda). This is regional SSR, not edge rendering.

Services: Lambda, CloudFront, S3

## Topics

- Nitro's AWS Lambda preset (verified at the pinned version)
- Cache-key design that keeps cookies and personalized pages out of the shared cache
- Verifying response streaming across the whole path
- Passing authentication through a BFF

## The distributed-systems angle

A CDN cache can serve stale content; state whose staleness is acceptable and for how long.

## Source required for completion

- Nuxt app and CDK
- Assertions and local tests for Cache-Control and cache policies
- Smoke-test procedure showing signed-in pages are not cached

## Primary sources to start from

- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html) (checked 2026-10-11)
