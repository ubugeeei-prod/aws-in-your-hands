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
| partition key | partition key | 05 | The key that decides where an item is stored. Items with the same value are stored together. |
| sort key | sort key | 05 | The key that orders and distinguishes items within one partition key value. |
| 条件式（condition expression） | condition expression | 05 | A condition sent with a write. If it does not hold, the write does not happen. |
| 楽観ロック | optimistic locking | 05 | Checking at write time that the stored version is still the one that was read, instead of locking in advance. |
| 結果整合の読み取り | eventually consistent read | 05 | A read that may not reflect a write completed a moment ago. The DynamoDB default. |
| 強整合の読み取り | strongly consistent read | 05 | A read that reflects every write that succeeded before it. |
| request unit | request unit | 05 | The billing unit in which on-demand DynamoDB counts reads and writes. |
| 認証 | authentication | 06 | Establishing who a call comes from. |
| 認可 | authorization | 06 | Deciding whether that caller may perform that operation. |
| user pool | user pool | 06 | Amazon Cognito's directory of users. It verifies passwords and issues tokens. |
| access token | access token | 06 | The token used to call an API. |
| ID token | ID token | 06 | The token that tells the app itself that sign-in happened and who the user is. It is not sent to APIs. |
| PKCE | PKCE | 06 | A mechanism that keeps an intercepted authorization code from being exchanged for tokens. |
| public client | public client | 06 | An app that cannot keep a secret, such as a SPA running in a browser. |
| JWT authorizer | JWT authorizer | 06 | The API Gateway HTTP API feature that verifies a token before the function is invoked. |
| channel | channel | 18 | The unit in IVS low-latency streaming that takes one broadcast and delivers it to viewers. It has an ingest endpoint and a playback URL. |
| stream key | stream key | 18 | The secret string an encoder presents when it sends to a channel. Anyone who has it can broadcast to that channel. |
| ingest | ingest | 18 | A service receiving the video that an encoder sends. |
| rendition | rendition | 18 | One version of the same video at a particular resolution and bitrate. The player switches between them to fit the connection. |
| timed metadata | timed metadata | 18 | A small piece of data embedded at a point in the video. It reaches each viewer at the same moment of the video, whatever that viewer's delay. |
