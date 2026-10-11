---
title: "出典台帳"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/sources.json (tools/src/book/generate.ts) -->

# 出典台帳

本文の仕様・料金・安全性に関する主張は、ここに記録した一次情報に基づきます。主張の文面は台帳の原文（英語）のまま載せています。

## 執筆時に内容を確認した出典

### Login for AWS local development using console credentials

- ID: `aws-cli-login`
- URL: <https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html>
- 確認日: 2026-10-11
- 参照する章: 01
- この出典が支える主張:
  - `aws login` needs AWS CLI 2.32.0 or later
  - Works for root, IAM user, and IAM federation sign-in; IAM Identity Center uses `aws configure sso` instead
  - Non-root identities need the SignInLocalDevelopmentAccess managed policy
  - Credentials refresh every 15 minutes; the session lasts up to the principal's session duration, 12 hours at most
  - Cache lives in ~/.aws/login/cache; `aws logout` deletes it

### Managing your costs with AWS Budgets

- ID: `aws-budgets-managing-costs`
- URL: <https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html>
- 確認日: 2026-10-11
- 参照する章: 01
- この出典が支える主張:
  - Budget data is updated up to three times a day, typically 8-12 hours apart
  - A notification can arrive after spending has already passed the threshold

### AWS Free Tier

- ID: `aws-free-tier`
- URL: <https://aws.amazon.com/free/>
- 確認日: 2026-10-11
- 参照する章: 01
- この出典が支える主張:
  - New accounts receive USD 100 in credits and can earn up to USD 100 more
  - A Free plan account closes after 6 months or when credits run out, whichever is first, unless upgraded
  - Always-free offers apply on both Free and Paid plans
- 注記: The page does not state the account-creation date from which this model applies.

### Amazon CloudFront pay-as-you-go pricing

- ID: `cloudfront-pricing-payg`
- URL: <https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - Always-free each month: 1 TB data transfer out, 10,000,000 HTTP/HTTPS requests, 2,000,000 CloudFront Function invocations, 2,000,000 KeyValueStore reads
  - First 1,000 invalidation paths per month are free, then USD 0.005 per path
  - Origin fetches from AWS origins such as S3 are free of data-transfer charges

### Amazon CloudFront pricing (flat-rate plans)

- ID: `cloudfront-pricing-plans`
- URL: <https://aws.amazon.com/cloudfront/pricing/>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - Flat-rate plans exist: Free USD 0, Pro USD 15, Business USD 200, Premium USD 1,000 per month
  - Flat-rate plans cannot be combined with other offers or discounts
- 注記: Which features and origins each plan allows, and CloudFormation/CDK support for selecting a plan, were not verified. The book's examples use pay-as-you-go.

### AWS Lambda pricing

- ID: `lambda-pricing`
- URL: <https://aws.amazon.com/lambda/pricing/>
- 確認日: 2026-10-11
- 参照する章: 04, 17
- この出典が支える主張:
  - Free tier: 1,000,000 requests and 400,000 GB-seconds per month
  - Response streaming: first 6 MB per request free, then per GB
- 注記: The page does not say whether the free tier expires.

### AWS Price List bulk API: Lambda, ap-northeast-1

- ID: `aws-price-list-lambda`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 04, 17
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AWSLambda

### AWS Price List bulk API: API Gateway, ap-northeast-1

- ID: `aws-price-list-apigw`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 04
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonApiGateway
  - HTTP API requests are priced lower than REST API requests in ap-northeast-1

### AWS Price List bulk API: S3, ap-northeast-1

- ID: `aws-price-list-s3`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonS3

### AWS Price List bulk API: CloudWatch, ap-northeast-1

- ID: `aws-price-list-cloudwatch`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 04, 17
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCloudWatch
  - The price list has a USD 0 tier for the first 5 GB of log ingestion and 5 GB-month of log storage

### AWS Price List bulk API: CloudFront

- ID: `aws-price-list-cloudfront`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCloudFront

### @go-to-k/cdkd 0.296.28 (npm tarball and tagged source)

- ID: `cdkd-npm`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- 確認日: 2026-10-11
- 参照する章: 02, 03, 04, 05, 06, 17
- この出典が支える主張:
  - Command list, flags, and exit codes used by tools/src/infra and tools/src/drift
  - `drift --json` output shape (StackDriftJson) and exit codes 0/1/2
  - `cdkd bootstrap` creates cdkd-state-{account}, cdkd-assets-{account}-{region}, and an ECR repository; it creates no IAM roles and no CDKToolkit stack
  - Without AWS_REGION cdkd uses us-east-1
  - A CloudFront distribution is waited for only with --full-wait
  - State is stored at s3://{bucket}/{prefix}/{stack}/{region}/state.json with an S3 conditional-write lock
  - AWS::CloudFront::Function is provisioned and read back through Cloud Control API, not a dedicated provider
  - A non-empty bucket without the CDK auto-delete tag makes destroy fail
- 注記: Read from the published tarball, --help output, and the v0.296.28 source tag. No cdkd command was run against AWS.

### cdkd: Introduction

- ID: `cdkd-introduction`
- URL: <https://cdkd.dev/introduction/>
- 確認日: 2026-10-11
- 参照する章: 02, 11
- この出典が支える主張:
  - cdkd describes itself as for dev/test workflows and recommends the AWS CDK CLI for production

### @ox-content/vite-plugin 3.2.14 (npm tarball)

- ID: `ox-content-npm`
- URL: <https://www.npmjs.com/package/@ox-content/vite-plugin/v/3.2.14>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - Option names and defaults used in book/vite.config.ts
  - Pages are written as <path>/index.html; internal links end in /index.html
  - i18n uses a locale-prefixed file tree; ssg.localeSwitcher adds the language switcher
  - search-index.json is written to the output root; files under assets/ carry a content hash
  - codeImports enables `<<< @/path{region}` snippet imports
- 注記: Verified by building this repository's book. The package's peer range for vite does not list vite-plus-core 1.1.0; see pnpm-workspace.yaml.

### vite-plus 1.1.0 (npm tarball, bundled docs, and local CLI)

- ID: `viteplus-npm`
- URL: <https://www.npmjs.com/package/vite-plus/v/1.1.0>
- 確認日: 2026-10-11
- 参照する章: 02, 04
- この出典が支える主張:
  - run.tasks keys: command, cwd, dependsOn, cache
  - Tasks are cached by default and package.json scripts are not; `cache: false` cannot be overridden from the CLI
  - A task with `cache: false` receives the caller's full environment
  - `vp install --frozen-lockfile` runs the pinned package manager with that flag
  - Bundles vite 8.3.3, vitest 5.0.3, oxlint 1.87.0, oxfmt 0.72.0
  - `vp check`'s type check does not cover Vue single-file components
- 注記: Verified by experiment with the binary built by nix/vp.nix on aarch64-darwin.

### vize and @vizejs/vite-plugin 0.443.0 (npm tarballs and local CLI)

- ID: `vize-npm`
- URL: <https://www.npmjs.com/package/vize/v/0.443.0>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - `@vizejs/vite-plugin` default export is a Vite plugin that compiles Vue single-file components
  - `vize check` type-checks .vue and .ts files using the tsconfig include list
  - `vize lint` lints Vue templates; `--preset essential` selects the essential rules
  - Adding `@vizejs/vite-plugin` to compilerOptions.types lets TypeScript resolve .vue imports without a shim

### nixpkgs at the revision in flake.lock

- ID: `nixpkgs-pin`
- URL: <https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30>
- 確認日: 2026-10-11
- 参照する章: 02
- この出典が支える主張:
  - nodejs_24 is 24.21.0, pnpm_10 is 10.34.5, awscli2 is 2.35.11
  - There is no vite-plus attribute; `vp` is an unrelated package

### Restrict access to an Amazon S3 origin

- ID: `cloudfront-oac-s3`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - AWS recommends origin access control over origin access identity
  - The bucket policy allows the cloudfront.amazonaws.com service principal with an AWS:SourceArn condition naming the distribution
  - An S3 website endpoint is a custom origin and cannot use OAC
  - With signing behavior `always`, CloudFront always uses HTTPS to S3

### Choose between REST APIs and HTTP APIs

- ID: `apigw-http-vs-rest`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html>
- 確認日: 2026-10-11
- 参照する章: 04
- この出典が支える主張:
  - HTTP APIs are designed with minimal features so that they can be offered at a lower price
  - REST API only: AWS WAF, API keys, per-client throttling, request validation, caching, private endpoints, X-Ray tracing, response streaming
  - HTTP API only: JWT authorizers, automatic deployments

### Cloudflare Workers: Local development

- ID: `cloudflare-workers-local-dev`
- URL: <https://developers.cloudflare.com/workers/local-development/>
- 確認日: 2026-10-11
- 参照する章: 00, 04
- この出典が支える主張:
  - Local development runs Workers in workerd through Miniflare, started by wrangler dev or the Cloudflare Vite plugin
  - Bindings connect to local simulations by default; `remote: true` on a binding sends its operations to the deployed resource
  - Workers AI has no local simulation: AI models always run remotely

### Cloudflare D1: Local development

- ID: `cloudflare-d1-local-dev`
- URL: <https://developers.cloudflare.com/d1/best-practices/local-development/>
- 確認日: 2026-10-11
- 参照する章: 00, 05, 13
- この出典が支える主張:
  - `wrangler dev` uses a local-only D1 by default and persists its data across runs
  - Local and remote data are separate; `--local` targets the local database for `wrangler d1 execute` and `wrangler d1 migrations apply`

### Restrictions on CloudFront Functions

- ID: `cloudfront-functions-restrictions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html>
- 確認日: 2026-10-11
- 参照する章: 03, 10
- この出典が支える主張:
  - CloudFront Functions cannot read the request body
  - The runtime restricts network, file system, environment variable, and timer access
  - Execution time is limited and reported as compute utilization

### Quotas for HTTP APIs in API Gateway

- ID: `apigw-http-quotas`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html>
- 確認日: 2026-10-11
- 参照する章: 04
- この出典が支える主張:
  - Maximum integration timeout is 30 seconds and cannot be increased
  - Payload size is 10 MB
  - 300 routes per API by default

### Lambda quotas

- ID: `lambda-quotas`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html>
- 確認日: 2026-10-11
- 参照する章: 04
- この出典が支える主張:
  - Function timeout is at most 900 seconds
  - Memory is 128 MB to 10,240 MB
  - Synchronous invocation payload is 6 MB for request and for response
  - Default concurrent executions quota is 1,000 per Region; new accounts start with a reduced quota
  - Environment variables total at most 4 KB

### Amazon S3 API: GetObject

- ID: `s3-getobject`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html>
- 確認日: 2026-10-11
- 参照する章: 03
- この出典が支える主張:
  - For a missing object S3 returns 404 when the caller has s3:ListBucket and 403 when it does not

### DynamoDB read consistency

- ID: `dynamodb-read-consistency`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - A write that returned HTTP 200 has been durably persisted
  - Eventually consistent reads are the default, may not reflect a recently completed write, and cost half of strongly consistent reads
  - ConsistentRead is available on GetItem, Query, and Scan for tables and local secondary indexes, not for global secondary indexes or streams
  - Global tables have two modes: multi-Region eventual consistency (default, typically replicated within a second) and multi-Region strong consistency (synchronous replication before the write returns)

### DynamoDB condition expression CLI example

- ID: `dynamodb-condition-expressions`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - PutItem overwrites an item with the same primary key unless a condition prevents it
  - attribute_not_exists on a key attribute is true only when no item with that full key exists
  - A write whose condition evaluates to false is rejected with "The conditional request failed"

### Paginating table query results in DynamoDB

- ID: `dynamodb-query-pagination`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - A Query returns at most 1 MB per call
  - LastEvaluatedKey becomes the next ExclusiveStartKey; its absence is the only sign that the result set is finished
  - A non-empty LastEvaluatedKey does not guarantee that more items remain

### DynamoDB on-demand capacity mode

- ID: `dynamodb-on-demand`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - On-demand tables are billed per read and write request, with no throughput charge at zero traffic
  - One read request unit is one strongly consistent read, or two eventually consistent reads, of an item up to 4 KB; one write request unit is one write of an item up to 1 KB
  - New on-demand tables sustain up to 4,000 writes and 12,000 reads per second and can be throttled when traffic more than doubles within 30 minutes
  - A maximum read or write throughput can be configured per on-demand table

### Constraints in Amazon DynamoDB

- ID: `dynamodb-constraints`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - Maximum item size is 400 KB
  - A transaction can contain at most 100 unique items and 4 MB
  - Sort key values are at most 1024 bytes and partition key values 2048 bytes

### AWS Price List bulk API: DynamoDB, ap-northeast-1

- ID: `aws-price-list-dynamodb`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonDynamoDB
  - The storage price has a USD 0 tier for the first 25 GB-month

### amazon/dynamodb-local container image tags (Docker Hub)

- ID: `dynamodb-local-image`
- URL: <https://hub.docker.com/r/amazon/dynamodb-local/tags>
- 確認日: 2026-10-11
- 参照する章: 05
- この出典が支える主張:
  - Tag 3.3.1 exists for amd64 and arm64 and was the image `latest` pointed at
- 注記: Only the tag listing was read. The image was not pulled or run.

### Control access to HTTP APIs with JWT authorizers in API Gateway

- ID: `apigw-jwt-authorizer`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - The authorizer checks signature (RSA-based algorithms only), iss, aud or client_id, exp, nbf, iat, and route scopes; a failure denies the request
  - client_id is evaluated only when aud is absent
  - Public keys are cached for up to two hours
  - Verified claims reach a Lambda integration at requestContext.authorizer.jwt.claims
  - There is no standard way to tell access tokens from ID tokens; requiring scopes on routes is recommended
  - For Cognito the issuer is https://cognito-idp.{region}.amazonaws.com/{userPoolId}

### Cognito: the redirect and authorization endpoint

- ID: `cognito-authorize-endpoint`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - /oauth2/authorize accepts response_type, client_id, redirect_uri, state, scope, code_challenge, and code_challenge_method
  - Only S256 is supported for PKCE
  - The redirect URI must be pre-registered and HTTPS, except http://localhost
  - An implicit grant is described as less secure because it exposes tokens
  - An authorization code is valid for five minutes
  - An ID token is returned only when the openid scope is requested

### Cognito: understanding the access token

- ID: `cognito-access-token`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - Access tokens are signed with RS256 and carry sub, client_id, token_use = access, and scope
  - sub is the recommended way to identify a user
  - Access token validity is configurable from 5 minutes to 1 day
  - Managed login sets a browser cookie valid for one hour; token durations under an hour are discouraged with managed login

### Cognito: ending user sessions with token revocation

- ID: `cognito-token-revocation`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - Revoked tokens cannot be used with Cognito API calls, but are still valid to any JWT library that verifies only signature and expiration
  - Token revocation is enabled by default on new app clients

### Cognito: the managed login sign-out endpoint

- ID: `cognito-logout-endpoint`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - GET /logout with client_id and logout_uri signs the user out of managed login and redirects to an allowed sign-out URL

### Amazon Cognito pricing

- ID: `cognito-pricing`
- URL: <https://aws.amazon.com/cognito/pricing/>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - Essentials is the default feature plan for new user pools
  - Lite and Essentials include 10,000 free MAUs per month per account or organization, and that allowance does not expire
  - A user counts as a MAU when an identity operation occurs for them in the month
  - SMS and email are charged separately
- 注記: Whether managed login is available on the Lite plan is not clearly stated on the page.

### AWS Price List bulk API: Cognito, ap-northeast-1

- ID: `aws-price-list-cognito`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCognito

### oauth4webapi 3.8.8 and jose 6.2.12 (npm type definitions)

- ID: `oauth4webapi-npm`
- URL: <https://www.npmjs.com/package/oauth4webapi/v/3.8.8>
- 確認日: 2026-10-11
- 参照する章: 06
- この出典が支える主張:
  - Function signatures used in examples/06-auth/web/src/auth/cognito.ts and api/src/local-auth.ts
- 注記: Type-checked only. The Cognito flow in cognito.ts has never been run against a user pool.

### What is Amazon IVS Low-Latency Streaming?

- ID: `ivs-what-is`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - IVS channels can deliver video with latency under 5 seconds; IVS stages under 300 ms
  - Ingest protocols are RTMP, RTMPS, and SRT
  - The data plane (ingest and viewing) is global; the control plane (API, channels, stream keys) is regional
  - Observed latency varies between users with location, network, and the components in the chain

### What is Amazon IVS Real-Time Streaming?

- ID: `ivs-realtime-what-is`
- URL: <https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Real-time streaming delivers latency that can be under 300 milliseconds from host to viewer
  - Up to 12 hosts on a stage; the resource is a stage, not a channel

### Amazon Interactive Video Service endpoints and quotas

- ID: `ivs-endpoints-quotas`
- URL: <https://docs.aws.amazon.com/general/latest/gr/ivs.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - ap-northeast-1 has endpoints for IVS low-latency streaming, real-time streaming, and chat
  - One stream key per channel, not adjustable
  - Default quotas per Region: 100 concurrent streams and 15,000 concurrent views
  - BASIC ingest bitrate: 1.5 Mbps at 480p or less, 3.5 Mbps above 480p; STANDARD and ADVANCED: 8.5 Mbps; ingest resolution up to 1080p
  - PutMetadata: 1 KB payload, 5 transactions per second per channel
  - Real-time stages: 12 publishers and 10,000 subscribers per stage by default

### Amazon IVS Streaming Configuration

- ID: `ivs-streaming-config`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/streaming-config.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Four channel types; STANDARD is the default; BASIC is transmuxed into a single rendition, STANDARD and ADVANCED are transcoded into several
  - Exceeding the allowed input resolution or bitrate probably disconnects the stream immediately
  - The RTMPS ingest URL form rtmps://<ingest endpoint>:443/app/<stream key>
  - Keyframe interval of 2 seconds is recommended; values above 5 seconds are to be avoided; a 2-second interval gives a stream-start latency of roughly 6 to 7 seconds
  - For the lowest latency the IVS player is required; H.264 video and AAC audio; CBR is recommended

### Getting started with IVS: Set Up Streaming Software

- ID: `ivs-setup-streaming`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/getting-started-set-up-streaming.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - OBS Studio 30.2 or later has an Amazon IVS service entry that takes the stream key
  - A stream lasts 48 hours at most; a reconnect starts a new stream
  - IVS disconnects after 30 seconds without data from the encoder
  - The FFmpeg example for RTMPS

### Amazon IVS Pricing

- ID: `ivs-pricing`
- URL: <https://aws.amazon.com/ivs/pricing/>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - All streams sent to IVS incur video input costs, even if they are not viewed; input is rounded up to the minute, output to the second
  - Input per hour: Basic 0.20, Standard 2.00, Advanced SD 0.50, Advanced HD 0.85 USD
  - Output is billed per hour delivered, by resolution (SD up to 480, HD up to 720, Full HD up to 1080) and by where viewers are served from
  - Japan is in the output group 'Japan, Hong Kong, and South East Asia'
  - Free tier for new customers, first 12 months: 5 hours of basic input and 100 hours of SD output a month
  - Real-time streaming is billed per participant hour
- 注記: The page describes no charge for a channel that exists but is not live.

### AWS Price List bulk API: IVS

- ID: `aws-price-list-ivs`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonIVS/current/index.json>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonIVS
  - The offer contains only input-hour, output-hour, and real-time-hour products; none for an idle channel
- 注記: The offer has no per-Region file; region_index.json lists only aws-other. The usage types prefixed AP- are described in the file as 'Japan, Hong Kong, SEA'.

### IVS Costs: Low-Latency Streaming

- ID: `ivs-costs`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/costs.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Auto-record to S3 has no IVS charge; S3 storage, the S3 API calls IVS makes, and serving the recordings are charged
  - As a rule of thumb, on average 50% of a stream is delivered to each viewer

### AWS::IVS::Channel

- ID: `cfn-ivs-channel`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-channel.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - The Channel resource does not create a stream key, unlike the CreateChannel API
  - Properties Type, LatencyMode (default LOW), Authorized, InsecureIngest, RecordingConfigurationArn, and their defaults
  - Attributes Arn, IngestEndpoint, PlaybackUrl; the playback URL contains the account ID

### AWS::IVS::StreamKey

- ID: `cfn-ivs-streamkey`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-streamkey.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Attributes Arn and Value; Value is the stream key itself
  - Changing ChannelArn replaces the resource

### IVS API: GetStream

- ID: `ivs-api-getstream`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_GetStream.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - An offline channel is reported as the ChannelNotBroadcasting error (HTTP 404), not as a response

### IVS API: Stream

- ID: `ivs-api-stream`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_Stream.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Do not rely on the OFFLINE state; the API may not return it
  - viewerCount of -1 means the request timed out; health is HEALTHY, STARVING, or UNKNOWN

### IVS API: StopStream

- ID: `ivs-api-stopstream`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_StopStream.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - StopStream disconnects the incoming stream; encoders often reconnect, so revoke the stream key to stop it for good

### IVS API: DeleteChannel

- ID: `ivs-api-deletechannel`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_DeleteChannel.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Deleting a channel deletes its stream keys
  - Deleting a live channel fails with 409 ConflictException; stop the stream and wait for Stream End first

### Using Amazon EventBridge with IVS Low-Latency Streaming

- ID: `ivs-eventbridge`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Events are best effort: they may be missing, hours late, or out of order (Stream Down before Stream Up)
  - Detail types, event names, and the example payloads used as test fixtures
  - Each time a channel goes live it gets a new stream_id
  - Session Ended may arrive before Stream End

### IVS Player SDK

- ID: `ivs-player-sdk`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - The IVS player is required for low latency; latency is under five seconds depending on location and settings
  - Browsers on iOS get normal-latency playback only; a service worker brings iOS Safari to about 6 to 8 seconds
  - Third-party players can be brought to about 10 seconds

### Getting Started with the IVS Web Player SDK

- ID: `ivs-web-player-guide`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/web-getting-started.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - The SDK is offered as a script tag and as an npm module; the page names 1.57.0 as the latest
  - playsinline is required for inline playback on iOS Safari
  - The WebAssembly binary must be served as application/wasm when self-hosted

### amazon-ivs-player 1.57.0 (npm tarball)

- ID: `ivs-player-npm`
- URL: <https://www.npmjs.com/package/amazon-ivs-player/v/1.57.0>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - create() takes wasmWorker and wasmBinary URLs; the files ship under dist/assets
  - ErrorType.NOT_AVAILABLE with code 404 means the stream does not exist or is offline, 429 that the viewer limit was reached
  - getLiveLatency() returns the latency from the server to the player in seconds; isLiveLowLatency() and TEXT_METADATA_CUE exist
  - The package is AWS Content under the AWS Customer Agreement, not an open-source license; peer dependencies are bowser and lodash
- 注記: Read from dist/index.d.ts and package.json of the installed tarball.

### Embedding Metadata within a Video Stream

- ID: `ivs-timed-metadata`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/metadata.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Timed metadata is embedded in the video segments, so every viewer receives it at the same point in the stream
  - PutMetadata works only on a live stream; there is no guarantee when the metadata is inserted
  - The web player delivers it as TEXT_METADATA_CUE

### IVS Auto-Record to Amazon S3

- ID: `ivs-record-to-s3`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Recordings are written under ivs/v1/<account>/<channel>/<date>/<recording id> as HLS media, thumbnails, and JSON metadata
  - Process a recording only after the Recording End event

### What Is MediaLive?

- ID: `medialive-what-is`
- URL: <https://docs.aws.amazon.com/medialive/latest/ug/what-is.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - MediaLive transforms live video from one format and package into others, for broadcast and streaming delivery

### MediaLive: Related Services

- ID: `medialive-related-services`
- URL: <https://docs.aws.amazon.com/medialive/latest/ug/related-services.html>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - MediaPackage is a just-in-time video packaging and origination service that can package content encoded by MediaLive

### AWS Elemental MediaLive Pricing

- ID: `medialive-pricing`
- URL: <https://aws.amazon.com/medialive/pricing/>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - A running channel is charged whether or not its inputs receive content; push inputs and channels are also charged while idle
  - Running time is rounded up to the minute above a 10-minute minimum

### Cloudflare Stream: Stream live video

- ID: `cloudflare-stream-live`
- URL: <https://developers.cloudflare.com/stream/stream-live/>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - Ingest over RTMPS or SRT; playback in the Stream Player or any HLS or DASH player
  - Every live stream is recorded automatically
  - Priced per 1,000 minutes recorded and per 1,000 minutes delivered, with no separate encoding charge
- 注記: The page gives no latency figures.

### @go-to-k/cdkd 0.296.28: IVS resource types (npm tarball)

- ID: `cdkd-npm-ivs`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- 確認日: 2026-10-11
- 参照する章: 18
- この出典が支える主張:
  - register-providers.ts registers no provider for any AWS::IVS type, so Channel and StreamKey go through Cloud Control API; AWS::Events::Rule, AWS::Lambda::*, AWS::IAM::*, and AWS::Logs::LogGroup have dedicated providers
  - The Cloud Control provider stores the resource model returned by a create as the resource's attributes in state
  - AWS::IVS::StreamKey Value is on cdkd's list of secret-valued attributes
- 注記: Read from the bundled dist of the tarball, which keeps the src/ region markers. No cdkd command was run against AWS, so what state.json holds for a stream key is not observed.

### Amazon VPC pricing

- ID: `vpc-pricing`
- URL: <https://aws.amazon.com/vpc/pricing/>
- 確認日: 2026-10-11
- 参照する章: 11, 23
- この出典が支える主張:
  - A NAT gateway is billed per NAT gateway-hour while provisioned and available, plus per GB processed regardless of source or destination; a partial hour is billed as a full hour
  - Standard data transfer charges apply on top of NAT gateway data processing
  - Every public IPv4 address is billed by the hour, in use or idle, at the same rate; Elastic IP addresses attached to NAT gateways are named as an example
  - A Regional NAT gateway is billed per hour for each Availability Zone it is configured in
- 注記: The page renders its regional price tables with JavaScript. The numbers in the book come from the Price List bulk API, not from this page.

### What is Amazon VPC?

- ID: `vpc-what-is`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - There is no additional charge for using a VPC; some components such as NAT gateways are charged
  - Private IPv4 addresses are not charged
  - AWS Free Tier customers get 750 hours of public IPv4 address usage with the EC2 service

### Subnets for your VPC

- ID: `vpc-subnet-types`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - The subnet type is determined by its routing: a public subnet has a direct route to an internet gateway, a private subnet does not and needs a NAT device for internet access, an isolated subnet has no routes to destinations outside its VPC
  - Network ACLs allow or deny traffic at the subnet level

### Subnet CIDR blocks

- ID: `vpc-subnet-sizing`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - A subnet's IPv4 CIDR block is between /28 and /16
  - The first four addresses and the last address of every subnet are reserved

### VPC CIDR blocks

- ID: `vpc-cidr-blocks`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - A VPC's IPv4 CIDR block is between /16 and /28
  - Some AWS services use 172.17.0.0/16, so that range is best avoided

### Route table concepts

- ID: `vpc-route-table-concepts`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - The main route table controls routing for every subnet not explicitly associated with another route table
  - Every route table has a local route for communication within the VPC
  - A route has a destination CIDR and a target such as an internet gateway

### Control traffic to your AWS resources using security groups

- ID: `vpc-security-groups`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Security groups are stateful: responses to allowed traffic are allowed regardless of the rules in the other direction

### Control subnet traffic with network access control lists

- ID: `vpc-network-acls`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Network ACLs are stateless: responses to allowed traffic are not automatically allowed
  - Network ACL rules are evaluated when traffic enters and leaves the subnet, not as it is routed within a subnet
  - The default network ACL allows all inbound and outbound traffic
- 注記: The default rules were read on the linked page https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html.

### Infrastructure security in Amazon VPC

- ID: `vpc-security-comparison`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Security groups work at the instance level with allow rules only; network ACLs work at the subnet level with allow and deny rules, evaluated in ascending order
  - You can secure your instances using only security groups

### Enable internet access for a VPC using an internet gateway

- ID: `vpc-internet-gateway`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - There is no charge for an internet gateway itself

### NAT gateway basics

- ID: `vpc-nat-gateway-basics`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - A NAT gateway is created in one Availability Zone and is redundant within that zone
  - If zones share one NAT gateway and its zone is down, resources in the other zones lose internet access; one NAT gateway per zone avoids this
  - A public NAT gateway sits in a public subnet and needs an Elastic IP address
- 注記: The Elastic IP requirement was read on https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html.

### Gateway endpoints

- ID: `vpc-gateway-endpoints`
- URL: <https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Gateway endpoints exist for Amazon S3 and DynamoDB only, and need no internet gateway or NAT device
  - There is no additional charge for using gateway endpoints
  - Creating one adds a route to each selected route table: destination the service's prefix list, target the endpoint
  - Prefix lists are specific to a Region, so traffic to the service in another Region does not use the endpoint

### Access an AWS service using an interface VPC endpoint

- ID: `vpc-interface-endpoints`
- URL: <https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - An interface endpoint creates an endpoint network interface with a private IP address in each chosen subnet, one subnet per Availability Zone
  - Interface endpoints are billed for hourly usage and for data processing
  - Private DNS needs DNS hostnames and DNS resolution enabled on the VPC
  - The endpoint's security group must allow inbound HTTPS from the resources that call it

### AWS services that integrate with AWS PrivateLink

- ID: `privatelink-aws-services`
- URL: <https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Service names com.amazonaws.region.ecr.api, ecr.dkr, logs, secretsmanager, ssm, ssmmessages, and ec2messages

### AWS PrivateLink pricing

- ID: `privatelink-pricing`
- URL: <https://aws.amazon.com/privatelink/pricing/>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - An interface endpoint is billed for each hour it stays provisioned in each Availability Zone; a partial hour is billed as a full hour
  - Data processing is billed per GB regardless of the traffic's source or destination, in tiers over the Region's monthly total
- 注記: The hourly rate is rendered with JavaScript; the book's number comes from the Price List bulk API.

### AWS::EC2::VPCEndpoint

- ID: `cfn-ec2-vpcendpoint`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Properties VpcEndpointType, ServiceName, VpcId, RouteTableIds, SubnetIds, SecurityGroupIds, and PrivateDnsEnabled

### Giving Lambda functions access to resources in an Amazon VPC

- ID: `lambda-vpc`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - By default a Lambda function can reach the public internet; attached to a VPC it can reach only what the VPC can
  - Connecting a function to a public subnet gives it neither internet access nor a public IP address
  - The execution role needs ec2:CreateNetworkInterface, DescribeNetworkInterfaces, DescribeSubnets, DeleteNetworkInterface, AssignPrivateIpAddresses, and UnassignPrivateIpAddresses on all resources, and the function's code is implicitly granted them too
  - A new function stays Pending while Lambda creates the Hyperplane ENI, which can take several minutes; functions with the same subnets and security groups share one
  - After 14 idle days Lambda reclaims unused Hyperplane ENIs and the function becomes Inactive

### Amazon ECR interface VPC endpoints (AWS PrivateLink)

- ID: `ecr-vpc-endpoints`
- URL: <https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Fargate tasks on platform version 1.4.0 or later need both ECR endpoints (ecr.api, ecr.dkr) and the S3 gateway endpoint to pull images privately
  - Fargate tasks that use the awslogs driver in a VPC without an internet gateway need the com.amazonaws.region.logs interface endpoint

### Fargate task networking

- ID: `ecs-fargate-networking`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - A Fargate task pulls its image over a public IP address in a public subnet, a NAT gateway from a private subnet, or ECR interface endpoints

### Improve the security of EC2 instances by using VPC endpoints for Systems Manager

- ID: `ssm-vpc-endpoints`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Systems Manager without internet access uses the ssm, ssmmessages, and ec2messages interface endpoints, and S3 for agent updates
  - ssmmessages is required for Session Manager

### Working with a DB instance in a VPC

- ID: `rds-vpc`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - A VPC for an RDS DB instance needs at least two subnets in two different Availability Zones

### AWS Availability Zones

- ID: `aws-availability-zones`
- URL: <https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Each Region has at least three Availability Zones
  - An AZ ID such as apne1-az1 is the same physical location in every account; ap-northeast-1 has apne1-az1 to apne1-az4
  - AWS may restrict new resources in a constrained Availability Zone

### AZ IDs for your AWS resources

- ID: `aws-az-mapping`
- URL: <https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - In Asia Pacific (Tokyo), accounts created before November 2025 have Availability Zone names mapped independently per account
  - `aws ec2 describe-availability-zones` lists the zone names and IDs of an account

### AWS Fault Isolation Boundaries: Availability Zones

- ID: `fault-isolation-availability-zones`
- URL: <https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - An Availability Zone is one or more discrete data centers with separate power, networking, and connectivity inside one Region
  - Zones in a Region are up to about 100 km apart and designed not to fail together

### AWS Fault Isolation Boundaries: Regions

- ID: `fault-isolation-regions`
- URL: <https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/regions.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Regions are isolated from each other, which limits a service failure to one Region
  - Resources and data in one Region do not exist in another unless you replicate them

### AWS Price List bulk API: EC2, ap-northeast-1

- ID: `aws-price-list-ec2`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonEC2: NAT gateway hours and data processing
  - The offer also lists a Regional NAT gateway at the same hourly and per-GB rate, and regional data transfer at USD 0.01 per GB
- 注記: The file is about 445 MB. NAT gateway prices live in the EC2 offer, not the VPC offer.

### AWS Price List bulk API: VPC, ap-northeast-1

- ID: `aws-price-list-vpc`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonVPC: interface endpoint hours and data processing, public IPv4 address hours
  - The offer has no SKU for a VPC, subnet, route table, internet gateway, or gateway endpoint

### cdkd v0.296.28 source: provider registry and property coverage

- ID: `cdkd-source-network`
- URL: <https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - register-providers.ts registers one EC2 provider for AWS::EC2::VPC, Subnet, InternetGateway, EIP, VPCGatewayAttachment, NatGateway, RouteTable, Route, SubnetRouteTableAssociation, SecurityGroup, SecurityGroupIngress, Instance, NetworkAcl, NetworkAclEntry, and SubnetNetworkAclAssociation
  - AWS::EC2::VPCEndpoint is not registered and is not in the unsupported list, so it goes through Cloud Control API
  - property-coverage.generated.ts lists the properties the EC2 provider writes; a resource using any other property is routed through Cloud Control API
  - The intrinsic resolver handles Fn::GetAZs
- 注記: Read from the source archive of the v0.296.28 tag. The npm tarball ships bundled JavaScript without the TypeScript sources. No cdkd command was run against AWS.

### cdkd v0.296.28: Cross-Stack References

- ID: `cdkd-cross-stack-references`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cross-stack-references.md>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - cdkd resolves Fn::ImportValue against the outputs other stacks recorded in its state, and falls back to CloudFormation ListExports when no cdkd stack exports the name
  - `cdkd destroy` of a stack whose exports are still imported is refused with StackHasActiveImportsError, and there is no flag to force it
  - cdkd also resolves Fn::GetStackOutput as a weak reference that does not block the producer's destroy; its documentation calls the intrinsic cdkd-specific
  - Outputs are stored in the state file; state version 9 records which output keys are Export names
- 注記: Read together with docs/stack-outputs.md and src/types/state.ts at the same tag. Not exercised against AWS. CloudFormation's own documentation also lists Fn::GetStackOutput (see cfn-stack-exports); how the two relate was not investigated.

### Default security groups for your VPCs

- ID: `vpc-default-security-group`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Every VPC comes with a default security group, and a resource created without a security group is associated with it
  - AWS recommends creating security groups for specific resources instead of using the default one

### Get exported outputs from a deployed CloudFormation stack

- ID: `cfn-stack-exports`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Export names must be unique within a Region for each AWS account
  - After another stack imports an output value, the exporting stack cannot be deleted and the exported value cannot be modified until every import is removed
  - CloudFormation documents Fn::GetStackOutput for references across accounts or Regions

### AWS::EC2::Subnet

- ID: `cfn-ec2-subnet`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - Updating a subnet's CidrBlock replaces the subnet: a new one is created and the old one deleted

### Amazon VPCs and ElastiCache security

- ID: `elasticache-vpc`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html>
- 確認日: 2026-10-11
- 参照する章: 11
- この出典が支える主張:
  - All node-based ElastiCache clusters are launched in a VPC; ElastiCache Serverless caches can also be configured with a public endpoint that needs no VPC configuration

### Inference using Converse API

- ID: `bedrock-converse`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Converse needs bedrock:InvokeModel; ConverseStream needs bedrock:InvokeModelWithResponseStream
  - Order of ConverseStream events: messageStart, content block events, messageStop (with stopReason), metadata (usage and metrics)
  - contentBlockStart is sent for tool use only; a text delta is {contentBlockDelta: {delta: {text}, contentBlockIndex}}
  - Shape of a Converse response: output.message.content[].text, stopReason, usage, metrics

### ConverseStream (API reference)

- ID: `bedrock-converse-stream-api`
- URL: <https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Request fields modelId, messages, system, inferenceConfig.maxTokens
  - modelId accepts a base model ID or an inference profile ID
  - Stream members include internalServerException (500), modelStreamErrorException (424), serviceUnavailableException (503), throttlingException (429), validationException (400)
  - Errors: AccessDeniedException 403, ModelErrorException 424, ModelNotReadyException 429, ModelTimeoutException 408, ResourceNotFoundException 404, ServiceUnavailableException 503, ThrottlingException 429, ValidationException 400
  - The AWS CLI does not support ConverseStream

### MessageStopEvent (API reference)

- ID: `bedrock-message-stop-event`
- URL: <https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - stopReason values: end_turn, tool_use, max_tokens, stop_sequence, guardrail_intervened, content_filtered, malformed_model_output, malformed_tool_use, model_context_window_exceeded

### Request access to models

- ID: `bedrock-model-access`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Access to many foundation models is enabled by default; there is no per-model request step in commercial Regions
  - The first invocation of a third-party model starts an AWS Marketplace subscription, which needs aws-marketplace:Subscribe, Unsubscribe, and ViewSubscriptions and can take up to 15 minutes
  - Anthropic models need a one-time use case form per account or organization before the first call
  - Amazon models are not sold through AWS Marketplace
  - After a model is enabled, callers no longer need the Marketplace permissions

### Route model inference requests across AWS Regions with cross-Region inference

- ID: `bedrock-cross-region-inference`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - A geographic profile routes within a geography; a global profile routes to any commercial Region
  - No additional routing cost; the price is that of the Region the profile is called from
  - CloudTrail logs the request in the source Region with additionalEventData.inferenceRegion

### Supported Regions and models for inference profiles

- ID: `bedrock-inference-profiles-support`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Profile IDs and destination Regions are documented on each model's card
  - GetInferenceProfile lists the destination Regions of a profile as seen from one source Region
  - Do not infer the destinations from the geographic prefix of the profile ID alone

### Prerequisites for inference profiles

- ID: `bedrock-inference-profiles-prereq`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - A policy that names an inference profile must also name the foundation model in each Region associated with it
  - The bedrock:InferenceProfileArn condition key limits a foundation-model statement to calls made through one profile
  - The example for a global profile names the model in the source Region and with an empty Region

### Model card: Amazon Nova 2 Lite

- ID: `bedrock-model-card-nova-2-lite`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Model ID amazon.nova-2-lite-v1:0; profiles jp.amazon.nova-2-lite-v1:0 and global.amazon.nova-2-lite-v1:0
  - From ap-northeast-1 the model is offered through Geo and Global profiles, not In-Region
  - jp.amazon.nova-2-lite-v1:0 called from ap-northeast-1 routes to ap-northeast-1 and ap-northeast-3
  - Supports Converse and response streaming; max output 64K tokens

### Model card: Anthropic Claude Haiku 4.5

- ID: `bedrock-model-card-claude-haiku-4-5`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - On bedrock-runtime the model needs a geo or global inference profile ID; the bare model ID is not supported for on-demand use
  - jp.anthropic.claude-haiku-4-5-20251001-v1:0 called from ap-northeast-1 routes to ap-northeast-1 and ap-northeast-3
  - Billed through AWS Marketplace; EOL no sooner than 2026-10-16

### Troubleshooting Amazon Bedrock API Error Codes

- ID: `bedrock-troubleshooting-errors`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - ThrottlingException (429) means the account quota was exceeded; retry with exponential backoff and jitter, or request a quota increase
  - ServiceUnavailable (503) is capacity, not the account quota
  - A missing Anthropic use case form answers 404

### Quotas for Amazon Bedrock

- ID: `bedrock-quotas`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Model inference is controlled by per-model quotas on token usage
  - The quotas that apply to an account can be lower than the published defaults; Service Quotas shows the applied values

### Response streaming for Lambda functions

- ID: `lambda-response-streaming`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html>
- 確認日: 2026-10-11
- 参照する章: 09, 17
- この出典が支える主張:
  - Streaming is available through function URLs, InvokeWithResponseStream, and API Gateway proxy integrations
  - A streamed response is not interrupted when the client disconnects, and the full function duration is billed
  - Node.js managed runtimes support response streaming natively
  - Streamed payloads can be up to 200 MB; the first 6 MB is not rate limited
  - Function URLs do not support response streaming for a function in a VPC

### Writing response streaming-enabled Lambda functions

- ID: `lambda-response-streaming-write`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - A streaming handler is wrapped in awslambda.streamifyResponse, a global the Node.js runtime on Lambda provides

### Control access to Lambda function URLs

- ID: `lambda-urls-auth`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - AuthType is AWS_IAM or NONE
  - With AWS_IAM, a caller in the same account needs lambda:InvokeFunctionUrl and lambda:InvokeFunction in an identity policy or in the function's resource-based policy
  - With NONE, anyone with the URL can invoke the function once the resource-based policy grants public access

### Stream the integration response for your proxy integrations in API Gateway

- ID: `apigw-response-streaming`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Response streaming is supported for REST APIs only, with responseTransferMode STREAM on proxy integrations
  - Streams run up to 15 minutes; idle timeout is 5 minutes for Regional endpoints
  - The Lambda function may keep running after the connection closes

### Restrict access to an AWS Lambda function URL origin

- ID: `cloudfront-oac-lambda-url`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - CloudFront origin access control signs requests to a function URL whose AuthType is AWS_IAM
  - For POST and PUT the client must send the SHA-256 of the body in x-amz-content-sha256

### AWS Lambda pricing (response streaming)

- ID: `lambda-pricing-streaming`
- URL: <https://aws.amazon.com/lambda/pricing/>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - The first 6 MB streamed per request is free
  - The page lists no separate charge for function URLs
- 注記: Same page as lambda-pricing, re-read for chapter 17.

### AWS Price List: Amazon Bedrock, ap-northeast-1

- ID: `aws-price-list-bedrock`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Nova 2.0 Lite in Tokyo: USD 0.000396 per 1K input tokens, USD 0.003311 per 1K output tokens
  - Nova 2.0 Lite through the global profile from Tokyo: USD 0.00036 and USD 0.00301 per 1K tokens
- 注記: The offer has a plain row and a `cross-region-global` row. It has no row named for the jp. profile; the chapter applies the plain row to it, following the user guide's statement that the price is that of the calling Region.

### AWS Price List: Amazon Bedrock foundation models (Marketplace), ap-northeast-1

- ID: `aws-price-list-bedrock-fm`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Claude Haiku 4.5 in Tokyo, Regional: USD 1.10 per 1M input tokens, USD 5.50 per 1M output tokens

### Cloudflare Workers AI: Get started

- ID: `cloudflare-workers-ai-quickstart`
- URL: <https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Workers AI always accesses your Cloudflare account to run models and incurs usage charges even in local development
  - A Worker calls a model as env.AI.run("@cf/...", {...})

### Cloudflare Workers AI: Bindings

- ID: `cloudflare-workers-ai-bindings`
- URL: <https://developers.cloudflare.com/workers-ai/configuration/bindings/>
- 確認日: 2026-10-11
- 参照する章: 00, 17
- この出典が支える主張:
  - The AI binding is declared in the wrangler configuration and called as env.AI.run(model, options)
  - `stream: true` returns results as a text/event-stream
- 注記: This page says nothing about local development or charges; that claim rests on cloudflare-workers-ai-quickstart and cloudflare-bindings-per-env.

### Cloudflare Workers: Supported bindings per development mode

- ID: `cloudflare-bindings-per-env`
- URL: <https://developers.cloudflare.com/workers/development-testing/bindings-per-env/>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - The AI binding has no local simulation; it connects to the remote service during local development

### Cloudflare Workers AI: Pricing

- ID: `cloudflare-workers-ai-pricing`
- URL: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - Billing unit is Neurons: 10,000 per day free, then USD 0.011 per 1,000 Neurons on the Workers Paid plan
  - LLM prices are also listed per million input and output tokens for each model

### hono 4.13.13 (published package)

- ID: `hono-npm`
- URL: <https://www.npmjs.com/package/hono/v/4.13.13>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - hono/aws-lambda exports streamHandle, which wraps the app in awslambda.streamifyResponse
  - streamHandle does not cancel the response body when writing to the Lambda response stream fails, so stream.onAbort does not fire there
  - hono/aws-lambda is marked deprecated in favor of @hono/aws-lambda for v5
  - streamSSE calls stream.onAbort listeners when the response body is cancelled
- 注記: Read from dist/adapter/aws-lambda/handler.js, dist/helper/streaming/sse.js, and dist/utils/stream.js of the installed package. Not run on Lambda.

### @aws-sdk/client-bedrock-runtime 3.1149.0 (published package)

- ID: `aws-sdk-bedrock-runtime-npm`
- URL: <https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0>
- 確認日: 2026-10-11
- 参照する章: 17
- この出典が支える主張:
  - ConverseStreamCommand returns `stream`, an async iterable of ConverseStreamOutput
  - An exception message in the event stream is thrown by the iterator as an error named after the exception
  - The default retry strategy makes up to 3 attempts
- 注記: Read from the type definitions and from @smithy/core 3.35.2 (event-streams getUnmarshalledStream.js, DEFAULT_MAX_ATTEMPTS) in the installed packages. No request was sent.

## 未再確認の出典（後続章の調査の出発点）

### Security best practices in IAM

- ID: `iam-best-practices`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html>
- 参照する章: 01, 21
- この出典が支える主張:
  - Prefer temporary credentials; protect the root user with MFA and do not use it for everyday work
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### nix develop

- ID: `nix-develop`
- URL: <https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-develop>
- 参照する章: 02
- この出典が支える主張:
  - `nix develop` enters the devShell of a flake
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### nix flake

- ID: `nix-flake`
- URL: <https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-flake>
- 参照する章: 02
- この出典が支える主張:
  - flake.lock pins every input to an exact revision and hash
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Vite+: Run

- ID: `viteplus-run`
- URL: <https://viteplus.dev/guide/run>
- 参照する章: 02
- この出典が支える主張:
  - Task runner and cache behavior
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Vite+: Check

- ID: `viteplus-check`
- URL: <https://viteplus.dev/guide/check>
- 参照する章: 02
- この出典が支える主張:
  - `vp check` runs format, lint, and type checks
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Vite+: Environment

- ID: `viteplus-env`
- URL: <https://viteplus.dev/guide/env>
- 参照する章: 02
- この出典が支える主張:
  - Node.js and package-manager selection
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### AWS CDK bootstrapping

- ID: `cdk-bootstrapping`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html>
- 参照する章: 02
- この出典が支える主張:
  - `cdk bootstrap` deploys the CDKToolkit stack with an asset bucket, an ECR repository, and IAM roles
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdk diff

- ID: `cdk-diff`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html>
- 参照する章: 02, 20
- この出典が支える主張:
  - `cdk diff` compares the synthesized template with the deployed template
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Detect unmanaged configuration changes to stacks and resources with drift detection

- ID: `cfn-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html>
- 参照する章: 02, 20
- この出典が支える主張:
  - CloudFormation drift detection compares live resource properties with the template; not every resource type or property is covered
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Detect drift on an entire CloudFormation stack

- ID: `cfn-detect-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html>
- 参照する章: 20
- この出典が支える主張:
  - Detection is asynchronous and must be polled to completion
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: Concepts

- ID: `cdkd-concepts`
- URL: <https://cdkd.dev/concepts/index.html>
- 参照する章: 02
- この出典が支える主張:
  - cdkd provisions through AWS SDK and Cloud Control API calls and keeps its own state in S3
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: Drift

- ID: `cdkd-drift`
- URL: <https://cdkd.dev/drift/index.html>
- 参照する章: 02, 20
- この出典が支える主張:
  - Outcome categories and resolution with --accept and --revert
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: drift CLI reference

- ID: `cdkd-cli-drift`
- URL: <https://cdkd.dev/cli-drift/index.html>
- 参照する章: 20
- この出典が支える主張:
  - Flags and exit codes of `cdkd drift`
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: Local emulation

- ID: `cdkd-local`
- URL: <https://cdkd.dev/local-emulation/index.html>
- 参照する章: 04
- この出典が支える主張:
  - `cdkd local start-api` runs HTTP APIs in local containers and needs Docker
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Ox Content: Site generation

- ID: `ox-content-site-generation`
- URL: <https://ox-content.dev/built-in/site-generation/>
- 参照する章: 03
- この出典が支える主張:
  - Static site generation options
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Lambda durable functions

- ID: `lambda-durable-functions`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html>
- 参照する章: 16
- この出典が支える主張:
  - Durable functions checkpoint progress and resume
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Cloudflare D1: Migrations

- ID: `cloudflare-d1-migrations`
- URL: <https://developers.cloudflare.com/d1/reference/migrations/>
- 参照する章: 13
- この出典が支える主張:
  - wrangler applies numbered SQL migration files locally and remotely
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Cloudflare D1: Read replication

- ID: `cloudflare-d1-read-replication`
- URL: <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- 参照する章: 13
- この出典が支える主張:
  - Read replicas and the Sessions API
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon DynamoDB?

- ID: `dynamodb-intro`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html>
- 参照する章: 14
- この出典が支える主張:
  - Data model and capacity modes
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### DynamoDB global tables

- ID: `dynamodb-global-tables`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html>
- 参照する章: 05
- この出典が支える主張:
  - Multi-Region replication overview
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### DynamoDB global tables core concepts

- ID: `dynamodb-global-tables-concepts`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables-CoreConcepts.html>
- 参照する章: 05
- この出典が支える主張:
  - Consistency modes
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Amazon Cognito user pools

- ID: `cognito-user-pools`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html>
- 参照する章: 06
- この出典が支える主張:
  - User pools as an OIDC identity provider
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon SQS?

- ID: `sqs-welcome`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html>
- 参照する章: 08
- この出典が支える主張:
  - Standard queues deliver at least once
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon EventBridge Scheduler?

- ID: `eventbridge-scheduler`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html>
- 参照する章: 08, 16
- この出典が支える主張:
  - One-time and recurring schedules
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Amazon CloudFront KeyValueStore

- ID: `cloudfront-kvs`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html>
- 参照する章: 10, 14
- この出典が支える主張:
  - Read-only key-value data for CloudFront Functions
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Restrictions on Lambda@Edge

- ID: `lambda-edge-restrictions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html>
- 参照する章: 10
- この出典が支える主張:
  - Region, version, and configuration restrictions
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Elastic Load Balancing pricing

- ID: `elb-pricing`
- URL: <https://aws.amazon.com/elasticloadbalancing/pricing/>
- 参照する章: 12
- この出典が支える主張:
  - ALB hourly and LCU charges
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon ECS?

- ID: `ecs-welcome`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html>
- 参照する章: 12
- この出典が支える主張:
  - ECS, Fargate, and ECR relationships
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Docker overview

- ID: `docker-overview`
- URL: <https://docs.docker.com/get-started/docker-overview/>
- 参照する章: 12
- この出典が支える主張:
  - The Docker client talks to a separate daemon
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Aurora DSQL?

- ID: `dsql-what-is`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html>
- 参照する章: 13
- この出典が支える主張:
  - Service overview
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL PostgreSQL compatibility

- ID: `dsql-pg-compat`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html>
- 参照する章: 13
- この出典が支える主張:
  - Supported and unsupported PostgreSQL features
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL DDL

- ID: `dsql-ddl`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html>
- 参照する章: 13
- この出典が支える主張:
  - DDL behavior and limits
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL Node.js connectors

- ID: `dsql-node-connectors`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html>
- 参照する章: 13
- この出典が支える主張:
  - Connecting with IAM authentication from Node.js
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL concurrency control

- ID: `dsql-concurrency`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html>
- 参照する章: 13
- この出典が支える主張:
  - Optimistic concurrency control and retry
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL pricing

- ID: `dsql-pricing`
- URL: <https://aws.amazon.com/rds/aurora/dsql/pricing/>
- 参照する章: 13
- この出典が支える主張:
  - Billing units
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora Serverless v2 auto-pause

- ID: `aurora-auto-pause`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
- 参照する章: 13
- この出典が支える主張:
  - Conditions for pausing and what is still billed
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon RDS?

- ID: `rds-welcome`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html>
- 参照する章: 13
- この出典が支える主張:
  - Service overview
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Request SES production access

- ID: `ses-production-access`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html>
- 参照する章: 15
- この出典が支える主張:
  - Sandbox limits and the production-access request
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Bedrock?

- ID: `bedrock-what-is`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html>
- この出典が支える主張:
  - Service overview
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### CloudWatch RUM

- ID: `cloudwatch-rum`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html>
- 参照する章: 19
- この出典が支える主張:
  - Real-user monitoring
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### X-Ray SDK and daemon support timeline

- ID: `xray-sdk-timeline`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html>
- 参照する章: 19
- この出典が支える主張:
  - The X-Ray SDKs and daemon move to maintenance; OpenTelemetry is recommended. The X-Ray service itself continues
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Inspector?

- ID: `inspector-what-is`
- URL: <https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html>
- 参照する章: 21
- この出典が支える主張:
  - Vulnerability scanning
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon GuardDuty?

- ID: `guardduty-what-is`
- URL: <https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html>
- 参照する章: 21
- この出典が支える主張:
  - Threat detection
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld source

- ID: `celld-source`
- URL: <https://github.com/denoland/celld>
- 参照する章: 24
- この出典が支える主張:
  - Project source
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld limitations

- ID: `celld-limitations`
- URL: <https://github.com/denoland/celld/blob/main/docs/limitations.md>
- 参照する章: 24
- この出典が支える主張:
  - Maturity (beta) and known limits
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld security

- ID: `celld-security`
- URL: <https://github.com/denoland/celld/blob/main/docs/security.md>
- 参照する章: 24
- この出典が支える主張:
  - Trust model
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld guarantees

- ID: `celld-guarantees`
- URL: <https://celld.dev/docs/guarantees/>
- 参照する章: 24
- この出典が支える主張:
  - Durability guarantees and their assumptions
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld documentation

- ID: `celld-docs`
- URL: <https://celld.dev/docs/>
- 参照する章: 24
- この出典が支える主張:
  - Compatibility and upgrade notes
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.
