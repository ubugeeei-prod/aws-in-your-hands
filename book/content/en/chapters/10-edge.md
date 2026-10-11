---
title: "10 Understand the Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 10 Understand the Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/10-edge` does not exist yet.

## Outcome

Redirects and a feature flag run at the edge, and you can explain which work belongs in which runtime.

## Prerequisites

- [03 Publish a SPA: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)

Reading paths: `ssr`, `cloudflare-workers`

## Planned architecture

Viewer request → CloudFront Function (+ KeyValueStore) → cache → origin.

Services: CloudFront Functions, CloudFront KeyValueStore, Lambda@Edge

## Topics

- CloudFront Functions runtime limits (no network, execution time, size)
- KeyValueStore propagation and intended use
- Lambda@Edge region, version, and environment-variable restrictions
- A candid comparison: these are not Workers

## The distributed-systems angle

KVS reads are eventually consistent per edge; a write is not immediately visible everywhere.

## Source required for completion

- Function code with unit tests that feed the same events under Node
- KVS CDK and an update script
- How it relates to the book site's own URL-rewrite function

## Primary sources to start from

- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html) (checked 2026-10-11)
- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html) (not re-read while writing)
- [Restrictions on Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html) (not re-read while writing)
