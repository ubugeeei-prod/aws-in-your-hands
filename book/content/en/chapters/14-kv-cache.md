---
title: "14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/14-kv-cache` does not exist yet.

## Outcome

Using a rate limiter and a list cache, you pick among three "KV" options by purpose, consistency, lifetime, and price.

## Prerequisites

- [05 Persist Notes: DynamoDB](/en/chapters/05-dynamodb.md)
- [10 Understand the Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge](/en/chapters/10-edge.md)
- [11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)


## Planned architecture

DynamoDB (TTL) and Valkey behind one interface, with edge configuration kept in KVS.

Services: DynamoDB, ElastiCache, CloudFront KeyValueStore

## Topics

- Cache only data you can afford to lose
- TTL deletion is not immediate
- Valkey brings a VPC and standing cost (check the serverless minimum)
- Cache stampedes

## The distributed-systems angle

Assume the cache and the source of truth disagree, and decide which one wins.

## Source required for completion

- Rate limiter with boundary tests using an injected clock
- CDK for each store
- A test reproducing a stale read

## Primary sources to start from

- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html) (checked 2026-10-11)
- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) (not re-read while writing)
