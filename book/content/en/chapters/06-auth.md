---
title: "06 Add Login: Cognito and Authorization"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 06 Add Login: Cognito and Authorization

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/06-auth` does not exist yet.

## Outcome

The SPA signs in with authorization code + PKCE, and the API returns only the caller's own notes.

## Prerequisites

- [03 Publish a SPA: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)
- [05 Persist Notes: DynamoDB](/en/chapters/05-dynamodb.md)

Reading paths: `shortest`

## Planned architecture

SPA → Cognito managed login → SPA (code) → token endpoint. The API Gateway JWT authorizer validates the token and Lambda scopes data by sub.

Services: Cognito user pools, API Gateway HTTP API JWT authorizer

## Topics

- The minimum OIDC/OAuth vocabulary
- PKCE with a standard library instead of Amplify
- Separating authentication (who) from authorization (may they touch this note)
- Token storage and lifetime
- Cognito billing units (MAU and tiers; verify against current pricing)

## The distributed-systems angle

A token stays valid until it expires; revocation does not propagate instantly.

## Source required for completion

- CDK for the user pool, app client, and callback URLs
- Authorization tests where another user's note ID returns 404
- A fixture that signs local test tokens (explicitly not a Cognito emulation)

## Primary sources to start from

- [Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html) (not re-read while writing)
