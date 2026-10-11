---
title: "Glossary"
generated: true
---

<!-- Generated file. Do not edit. Source: data/glossary.json (tools/src/book/generate.ts) -->

# Glossary

The term pairs that keep both languages using one word for one concept. API names, CLI syntax, file names, and resource IDs are never translated.

| Japanese | English | First used | Meaning |
| --- | --- | --- | --- |
| アカウント | account | 01 | The container for AWS resources and their bill, identified by a 12-digit ID. |
| root ユーザー | root user | 01 | The identity that signs in with the account's email address and cannot be restricted. Not for everyday work. |
| 一時認証情報 | temporary credentials | 01 | An access key, secret key, and session token issued with an expiry. |
| リージョン | Region | 01 | A geographic unit in which AWS offers services. Tokyo is ap-northeast-1. |
| 予算（AWS Budgets） | budget (AWS Budgets) | 01 | A mechanism that notifies when spending passes, or is forecast to pass, a threshold. It is not a spending cap. |
| devShell | devShell | 02 | A shell environment, defined by a Nix flake, that contains tools at pinned versions. |
| タスク | task | 02 | In this book, something defined under run.tasks in vite.config.ts and executed with vp run <name>. |
| construct | construct | 02 | A TypeScript class in CDK that represents one or more AWS resources. |
| stack | stack | 02 | A unit of resources that are created, updated, and deleted together. |
| synth（合成） | synth (synthesis) | 02 | Running CDK code to produce a cloud assembly, including CloudFormation templates. It changes nothing in AWS. |
| diff | diff | 02 | A preview of an intended change: the template built from source compared with what the deployment tool has recorded. |
| drift | drift | 02 | A difference between what the deployment tool has recorded and the actual AWS configuration. |
| state | state | 02 | The deployment tool's record of what it created. For cdkd, JSON in S3. |
| origin | origin | 03 | Where a CDN fetches the original content from. In this book, an S3 bucket or an API. |
| origin access control (OAC) | origin access control (OAC) | 03 | A mechanism in which CloudFront signs its origin requests and the bucket admits only that distribution. |
| distribution | distribution | 03 | One CloudFront delivery configuration, with its own domain name. |
| edge location | edge location | 03 | A CloudFront site that serves cached responses close to the reader. |
| invalidation | invalidation | 03 | An operation that makes edge caches discard objects before they expire. |
| SPA fallback | SPA fallback | 03 | Answering URLs that match no file with index.html so that the client-side router handles them. |
| 実行環境 | execution environment | 04 | The isolated environment in which Lambda runs a function. Each handles one request at a time and may be reused or discarded. |
| cold start | cold start | 04 | An invocation that includes creating and initializing a new execution environment. |
| 実行 role | execution role | 04 | The IAM role a function assumes when it runs in AWS. It is separate from the developer's own permissions. |
| HTTP API | HTTP API | 04 | One kind of API Gateway API. Its features and prices differ from REST APIs and WebSocket APIs. |
| integration | integration | 04 | Where API Gateway sends a request that matched a route. In this book, a Lambda function. |
| runtime validation | runtime validation | 02 | Checking data against a schema when it arrives at run time. A type annotation does not do this. |
| invariant | invariant | 04 | A property that must hold at all times; the thing tests and failure injection target. |
| 冪等性 | idempotency | 08 | The property that performing the same operation several times has the same result as performing it once. |
