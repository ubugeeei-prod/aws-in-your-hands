---
title: "05 Persist Notes: DynamoDB"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 05 Persist Notes: DynamoDB

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/05-dynamodb` does not exist yet.

## Outcome

The chapter 04 API stores notes in DynamoDB, and a test shows that concurrent updates never silently overwrite each other.

## Prerequisites

- [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Reading paths: `shortest`

## Planned architecture

Browser → API Gateway HTTP API → Lambda (ap-northeast-1) → DynamoDB table (on-demand).

Services: DynamoDB

## Topics

- Deriving partition and sort keys from access patterns
- Optimistic locking with a version attribute and ConditionExpression
- Eventually versus strongly consistent reads and their cost
- Choosing on-demand or provisioned capacity
- Global Tables consistency modes (extension; verify against current docs)
- When the data is relational enough to take the chapter 13 branch

## The distributed-systems angle

The table owns the state. Invariant: the version increases by exactly one per save, and updates from a stale version are rejected.

## Source required for completion

- DynamoDB and in-memory NoteRepository adapters passing one contract test suite
- CDK table definition with removalPolicy assertions
- Deterministic tests for conflicting updates and retry after a lost response
- Local integration against DynamoDB Local (stating the Docker daemon requirement)

## Primary sources to start from

- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) (not re-read while writing)
- [DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html) (not re-read while writing)
- [DynamoDB global tables core concepts](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables-CoreConcepts.html) (not re-read while writing)
