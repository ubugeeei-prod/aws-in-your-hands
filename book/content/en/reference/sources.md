---
title: "Source Registry"
generated: true
---

<!-- Generated file. Do not edit. Source: data/sources.json (tools/src/book/generate.ts) -->

# Source Registry

Claims in this book about specifications, prices, and safety rest on the primary sources recorded here.

## Sources read while writing

### Login for AWS local development using console credentials

- ID: `aws-cli-login`
- URL: <https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html>
- Checked: 2026-10-11
- Chapters: 01
- Claims this source supports:
  - `aws login` needs AWS CLI 2.32.0 or later
  - Works for root, IAM user, and IAM federation sign-in; IAM Identity Center uses `aws configure sso` instead
  - Non-root identities need the SignInLocalDevelopmentAccess managed policy
  - Credentials refresh every 15 minutes; the session lasts up to the principal's session duration, 12 hours at most
  - Cache lives in ~/.aws/login/cache; `aws logout` deletes it

### Managing your costs with AWS Budgets

- ID: `aws-budgets-managing-costs`
- URL: <https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html>
- Checked: 2026-10-11
- Chapters: 01
- Claims this source supports:
  - Budget data is updated up to three times a day, typically 8-12 hours apart
  - A notification can arrive after spending has already passed the threshold

### AWS Free Tier

- ID: `aws-free-tier`
- URL: <https://aws.amazon.com/free/>
- Checked: 2026-10-11
- Chapters: 01
- Claims this source supports:
  - New accounts receive USD 100 in credits and can earn up to USD 100 more
  - A Free plan account closes after 6 months or when credits run out, whichever is first, unless upgraded
  - Always-free offers apply on both Free and Paid plans
- Note: The page does not state the account-creation date from which this model applies.

### Amazon CloudFront pay-as-you-go pricing

- ID: `cloudfront-pricing-payg`
- URL: <https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - Always-free each month: 1 TB data transfer out, 10,000,000 HTTP/HTTPS requests, 2,000,000 CloudFront Function invocations, 2,000,000 KeyValueStore reads
  - First 1,000 invalidation paths per month are free, then USD 0.005 per path
  - Origin fetches from AWS origins such as S3 are free of data-transfer charges

### Amazon CloudFront pricing (flat-rate plans)

- ID: `cloudfront-pricing-plans`
- URL: <https://aws.amazon.com/cloudfront/pricing/>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - Flat-rate plans exist: Free USD 0, Pro USD 15, Business USD 200, Premium USD 1,000 per month
  - Flat-rate plans cannot be combined with other offers or discounts
- Note: Which features and origins each plan allows, and CloudFormation/CDK support for selecting a plan, were not verified. The book's examples use pay-as-you-go.

### AWS Lambda pricing

- ID: `lambda-pricing`
- URL: <https://aws.amazon.com/lambda/pricing/>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Free tier: 1,000,000 requests and 400,000 GB-seconds per month
  - Response streaming: first 6 MB per request free, then per GB
- Note: The page does not say whether the free tier expires.

### AWS Price List bulk API: Lambda, ap-northeast-1

- ID: `aws-price-list-lambda`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AWSLambda

### AWS Price List bulk API: API Gateway, ap-northeast-1

- ID: `aws-price-list-apigw`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonApiGateway
  - HTTP API requests are priced lower than REST API requests in ap-northeast-1

### AWS Price List bulk API: S3, ap-northeast-1

- ID: `aws-price-list-s3`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonS3

### AWS Price List bulk API: CloudWatch, ap-northeast-1

- ID: `aws-price-list-cloudwatch`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCloudWatch
  - The price list has a USD 0 tier for the first 5 GB of log ingestion and 5 GB-month of log storage

### AWS Price List bulk API: CloudFront

- ID: `aws-price-list-cloudfront`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCloudFront

### @go-to-k/cdkd 0.296.28 (npm tarball and tagged source)

- ID: `cdkd-npm`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-11
- Chapters: 02, 03, 04, 05, 06
- Claims this source supports:
  - Command list, flags, and exit codes used by tools/src/infra and tools/src/drift
  - `drift --json` output shape (StackDriftJson) and exit codes 0/1/2
  - `cdkd bootstrap` creates cdkd-state-{account}, cdkd-assets-{account}-{region}, and an ECR repository; it creates no IAM roles and no CDKToolkit stack
  - Without AWS_REGION cdkd uses us-east-1
  - A CloudFront distribution is waited for only with --full-wait
  - State is stored at s3://{bucket}/{prefix}/{stack}/{region}/state.json with an S3 conditional-write lock
  - AWS::CloudFront::Function is provisioned and read back through Cloud Control API, not a dedicated provider
  - A non-empty bucket without the CDK auto-delete tag makes destroy fail
- Note: Read from the published tarball, --help output, and the v0.296.28 source tag. No cdkd command was run against AWS.

### cdkd: Introduction

- ID: `cdkd-introduction`
- URL: <https://cdkd.dev/introduction/>
- Checked: 2026-10-11
- Chapters: 02
- Claims this source supports:
  - cdkd describes itself as for dev/test workflows and recommends the AWS CDK CLI for production

### @ox-content/vite-plugin 3.2.14 (npm tarball)

- ID: `ox-content-npm`
- URL: <https://www.npmjs.com/package/@ox-content/vite-plugin/v/3.2.14>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - Option names and defaults used in book/vite.config.ts
  - Pages are written as <path>/index.html; internal links end in /index.html
  - i18n uses a locale-prefixed file tree; ssg.localeSwitcher adds the language switcher
  - search-index.json is written to the output root; files under assets/ carry a content hash
  - codeImports enables `<<< @/path{region}` snippet imports
- Note: Verified by building this repository's book. The package's peer range for vite does not list vite-plus-core 1.1.0; see pnpm-workspace.yaml.

### vite-plus 1.1.0 (npm tarball, bundled docs, and local CLI)

- ID: `viteplus-npm`
- URL: <https://www.npmjs.com/package/vite-plus/v/1.1.0>
- Checked: 2026-10-11
- Chapters: 02, 04
- Claims this source supports:
  - run.tasks keys: command, cwd, dependsOn, cache
  - Tasks are cached by default and package.json scripts are not; `cache: false` cannot be overridden from the CLI
  - A task with `cache: false` receives the caller's full environment
  - `vp install --frozen-lockfile` runs the pinned package manager with that flag
  - Bundles vite 8.3.3, vitest 5.0.3, oxlint 1.87.0, oxfmt 0.72.0
  - `vp check`'s type check does not cover Vue single-file components
  - With TypeScript 7.0.2, `vp check`'s type check and plain `tsc` intermittently mis-resolved aws-cdk-lib subpath imports on unchanged sources (observed here: 2 of 5 runs); `tsc --singleThreaded` did not (36 of 36 project checks passed)
- Note: Verified by experiment with the binary built by nix/vp.nix on aarch64-darwin.

### vize and @vizejs/vite-plugin 0.443.0 (npm tarballs and local CLI)

- ID: `vize-npm`
- URL: <https://www.npmjs.com/package/vize/v/0.443.0>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - `@vizejs/vite-plugin` default export is a Vite plugin that compiles Vue single-file components
  - `vize check` type-checks .vue and .ts files using the tsconfig include list
  - `vize lint` lints Vue templates; `--preset essential` selects the essential rules
  - Adding `@vizejs/vite-plugin` to compilerOptions.types lets TypeScript resolve .vue imports without a shim
- Note: Verified by building and checking examples/03-spa. When `vize check` was also given the CDK code that imports aws-cdk-lib, it showed the same intermittent mis-resolution as TypeScript 7.0.2 (2 of 4 runs); limited to src/ it passed 8 of 8.

### nixpkgs at the revision in flake.lock

- ID: `nixpkgs-pin`
- URL: <https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30>
- Checked: 2026-10-11
- Chapters: 02
- Claims this source supports:
  - nodejs_24 is 24.21.0, pnpm_10 is 10.34.5, awscli2 is 2.35.11
  - There is no vite-plus attribute; `vp` is an unrelated package

### Restrict access to an Amazon S3 origin

- ID: `cloudfront-oac-s3`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - AWS recommends origin access control over origin access identity
  - The bucket policy allows the cloudfront.amazonaws.com service principal with an AWS:SourceArn condition naming the distribution
  - An S3 website endpoint is a custom origin and cannot use OAC
  - With signing behavior `always`, CloudFront always uses HTTPS to S3

### Choose between REST APIs and HTTP APIs

- ID: `apigw-http-vs-rest`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - HTTP APIs are designed with minimal features so that they can be offered at a lower price
  - REST API only: AWS WAF, API keys, per-client throttling, request validation, caching, private endpoints, X-Ray tracing, response streaming
  - HTTP API only: JWT authorizers, automatic deployments

### Cloudflare Workers: Local development

- ID: `cloudflare-workers-local-dev`
- URL: <https://developers.cloudflare.com/workers/local-development/>
- Checked: 2026-10-11
- Chapters: 00, 04
- Claims this source supports:
  - Local development runs Workers in workerd through Miniflare, started by wrangler dev or the Cloudflare Vite plugin
  - Bindings connect to local simulations by default; `remote: true` on a binding sends its operations to the deployed resource
  - Workers AI has no local simulation: AI models always run remotely

### Cloudflare D1: Local development

- ID: `cloudflare-d1-local-dev`
- URL: <https://developers.cloudflare.com/d1/best-practices/local-development/>
- Checked: 2026-10-11
- Chapters: 00, 05, 13
- Claims this source supports:
  - `wrangler dev` uses a local-only D1 by default and persists its data across runs
  - Local and remote data are separate; `--local` targets the local database for `wrangler d1 execute` and `wrangler d1 migrations apply`

### Cloudflare Workers AI: Bindings

- ID: `cloudflare-workers-ai-bindings`
- URL: <https://developers.cloudflare.com/workers-ai/configuration/bindings/>
- Checked: 2026-10-11
- Chapters: 00, 17
- Claims this source supports:
  - The AI binding is declared in the wrangler configuration and called as env.AI.run(model, options)
  - `stream: true` returns results as a text/event-stream
- Note: This page says nothing about local development or charges; that claim rests on cloudflare-workers-local-dev.

### Restrictions on CloudFront Functions

- ID: `cloudfront-functions-restrictions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html>
- Checked: 2026-10-11
- Chapters: 03, 10
- Claims this source supports:
  - CloudFront Functions cannot read the request body
  - The runtime restricts network, file system, environment variable, and timer access
  - Execution time is limited and reported as compute utilization

### Quotas for HTTP APIs in API Gateway

- ID: `apigw-http-quotas`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Maximum integration timeout is 30 seconds and cannot be increased
  - Payload size is 10 MB
  - 300 routes per API by default

### Lambda quotas

- ID: `lambda-quotas`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Function timeout is at most 900 seconds
  - Memory is 128 MB to 10,240 MB
  - Synchronous invocation payload is 6 MB for request and for response
  - Default concurrent executions quota is 1,000 per Region; new accounts start with a reduced quota
  - Environment variables total at most 4 KB

### Amazon S3 API: GetObject

- ID: `s3-getobject`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - For a missing object S3 returns 404 when the caller has s3:ListBucket and 403 when it does not

### DynamoDB read consistency

- ID: `dynamodb-read-consistency`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - A write that returned HTTP 200 has been durably persisted
  - Eventually consistent reads are the default, may not reflect a recently completed write, and cost half of strongly consistent reads
  - ConsistentRead is available on GetItem, Query, and Scan for tables and local secondary indexes, not for global secondary indexes or streams
  - Global tables have two modes: multi-Region eventual consistency (default, typically replicated within a second) and multi-Region strong consistency (synchronous replication before the write returns)

### DynamoDB condition expression CLI example

- ID: `dynamodb-condition-expressions`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - PutItem overwrites an item with the same primary key unless a condition prevents it
  - attribute_not_exists on a key attribute is true only when no item with that full key exists
  - A write whose condition evaluates to false is rejected with "The conditional request failed"

### Paginating table query results in DynamoDB

- ID: `dynamodb-query-pagination`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - A Query returns at most 1 MB per call
  - LastEvaluatedKey becomes the next ExclusiveStartKey; its absence is the only sign that the result set is finished
  - A non-empty LastEvaluatedKey does not guarantee that more items remain

### DynamoDB on-demand capacity mode

- ID: `dynamodb-on-demand`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - On-demand tables are billed per read and write request, with no throughput charge at zero traffic
  - One read request unit is one strongly consistent read, or two eventually consistent reads, of an item up to 4 KB; one write request unit is one write of an item up to 1 KB
  - New on-demand tables sustain up to 4,000 writes and 12,000 reads per second and can be throttled when traffic more than doubles within 30 minutes
  - A maximum read or write throughput can be configured per on-demand table

### Constraints in Amazon DynamoDB

- ID: `dynamodb-constraints`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - Maximum item size is 400 KB
  - A transaction can contain at most 100 unique items and 4 MB
  - Sort key values are at most 1024 bytes and partition key values 2048 bytes

### AWS Price List bulk API: DynamoDB, ap-northeast-1

- ID: `aws-price-list-dynamodb`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonDynamoDB
  - The storage price has a USD 0 tier for the first 25 GB-month

### amazon/dynamodb-local container image tags (Docker Hub)

- ID: `dynamodb-local-image`
- URL: <https://hub.docker.com/r/amazon/dynamodb-local/tags>
- Checked: 2026-10-11
- Chapters: 05
- Claims this source supports:
  - Tag 3.3.1 exists for amd64 and arm64 and was the image `latest` pointed at
- Note: Only the tag listing was read. The image was not pulled or run.

### Control access to HTTP APIs with JWT authorizers in API Gateway

- ID: `apigw-jwt-authorizer`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - The authorizer checks signature (RSA-based algorithms only), iss, aud or client_id, exp, nbf, iat, and route scopes; a failure denies the request
  - client_id is evaluated only when aud is absent
  - Public keys are cached for up to two hours
  - Verified claims reach a Lambda integration at requestContext.authorizer.jwt.claims
  - There is no standard way to tell access tokens from ID tokens; requiring scopes on routes is recommended
  - For Cognito the issuer is https://cognito-idp.{region}.amazonaws.com/{userPoolId}

### Cognito: the redirect and authorization endpoint

- ID: `cognito-authorize-endpoint`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - /oauth2/authorize accepts response_type, client_id, redirect_uri, state, scope, code_challenge, and code_challenge_method
  - Only S256 is supported for PKCE
  - The redirect URI must be pre-registered and HTTPS, except http://localhost
  - An implicit grant is described as less secure because it exposes tokens
  - An authorization code is valid for five minutes
  - An ID token is returned only when the openid scope is requested

### Cognito: understanding the access token

- ID: `cognito-access-token`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - Access tokens are signed with RS256 and carry sub, client_id, token_use = access, and scope
  - sub is the recommended way to identify a user
  - Access token validity is configurable from 5 minutes to 1 day
  - Managed login sets a browser cookie valid for one hour; token durations under an hour are discouraged with managed login

### Cognito: ending user sessions with token revocation

- ID: `cognito-token-revocation`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - Revoked tokens cannot be used with Cognito API calls, but are still valid to any JWT library that verifies only signature and expiration
  - Token revocation is enabled by default on new app clients

### Cognito: the managed login sign-out endpoint

- ID: `cognito-logout-endpoint`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - GET /logout with client_id and logout_uri signs the user out of managed login and redirects to an allowed sign-out URL

### Amazon Cognito pricing

- ID: `cognito-pricing`
- URL: <https://aws.amazon.com/cognito/pricing/>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - Essentials is the default feature plan for new user pools
  - Lite and Essentials include 10,000 free MAUs per month per account or organization, and that allowance does not expire
  - A user counts as a MAU when an identity operation occurs for them in the month
  - SMS and email are charged separately
- Note: Whether managed login is available on the Lite plan is not clearly stated on the page.

### AWS Price List bulk API: Cognito, ap-northeast-1

- ID: `aws-price-list-cognito`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCognito

### oauth4webapi 3.8.8 and jose 6.2.12 (npm type definitions)

- ID: `oauth4webapi-npm`
- URL: <https://www.npmjs.com/package/oauth4webapi/v/3.8.8>
- Checked: 2026-10-11
- Chapters: 06
- Claims this source supports:
  - Function signatures used in examples/06-auth/web/src/auth/cognito.ts and api/src/local-auth.ts
- Note: Type-checked only. The Cognito flow in cognito.ts has never been run against a user pool.

### What is Amazon IVS Low-Latency Streaming?

- ID: `ivs-what-is`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - IVS channels can deliver video with latency under 5 seconds; IVS stages under 300 ms
  - Ingest protocols are RTMP, RTMPS, and SRT
  - The data plane (ingest and viewing) is global; the control plane (API, channels, stream keys) is regional
  - Observed latency varies between users with location, network, and the components in the chain

### What is Amazon IVS Real-Time Streaming?

- ID: `ivs-realtime-what-is`
- URL: <https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Real-time streaming delivers latency that can be under 300 milliseconds from host to viewer
  - Up to 12 hosts on a stage; the resource is a stage, not a channel

### Amazon Interactive Video Service endpoints and quotas

- ID: `ivs-endpoints-quotas`
- URL: <https://docs.aws.amazon.com/general/latest/gr/ivs.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - ap-northeast-1 has endpoints for IVS low-latency streaming, real-time streaming, and chat
  - One stream key per channel, not adjustable
  - Default quotas per Region: 100 concurrent streams and 15,000 concurrent views
  - BASIC ingest bitrate: 1.5 Mbps at 480p or less, 3.5 Mbps above 480p; STANDARD and ADVANCED: 8.5 Mbps; ingest resolution up to 1080p
  - PutMetadata: 1 KB payload, 5 transactions per second per channel
  - Real-time stages: 12 publishers and 10,000 subscribers per stage by default

### Amazon IVS Streaming Configuration

- ID: `ivs-streaming-config`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/streaming-config.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Four channel types; STANDARD is the default; BASIC is transmuxed into a single rendition, STANDARD and ADVANCED are transcoded into several
  - Exceeding the allowed input resolution or bitrate probably disconnects the stream immediately
  - The RTMPS ingest URL form rtmps://<ingest endpoint>:443/app/<stream key>
  - Keyframe interval of 2 seconds is recommended; values above 5 seconds are to be avoided; a 2-second interval gives a stream-start latency of roughly 6 to 7 seconds
  - For the lowest latency the IVS player is required; H.264 video and AAC audio; CBR is recommended

### Getting started with IVS: Set Up Streaming Software

- ID: `ivs-setup-streaming`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/getting-started-set-up-streaming.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - OBS Studio 30.2 or later has an Amazon IVS service entry that takes the stream key
  - A stream lasts 48 hours at most; a reconnect starts a new stream
  - IVS disconnects after 30 seconds without data from the encoder
  - The FFmpeg example for RTMPS

### Amazon IVS Pricing

- ID: `ivs-pricing`
- URL: <https://aws.amazon.com/ivs/pricing/>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - All streams sent to IVS incur video input costs, even if they are not viewed; input is rounded up to the minute, output to the second
  - Input per hour: Basic 0.20, Standard 2.00, Advanced SD 0.50, Advanced HD 0.85 USD
  - Output is billed per hour delivered, by resolution (SD up to 480, HD up to 720, Full HD up to 1080) and by where viewers are served from
  - Japan is in the output group 'Japan, Hong Kong, and South East Asia'
  - Free tier for new customers, first 12 months: 5 hours of basic input and 100 hours of SD output a month
  - Real-time streaming is billed per participant hour
- Note: The page describes no charge for a channel that exists but is not live.

### AWS Price List bulk API: IVS

- ID: `aws-price-list-ivs`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonIVS/current/index.json>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonIVS
  - The offer contains only input-hour, output-hour, and real-time-hour products; none for an idle channel
- Note: The offer has no per-Region file; region_index.json lists only aws-other. The usage types prefixed AP- are described in the file as 'Japan, Hong Kong, SEA'.

### IVS Costs: Low-Latency Streaming

- ID: `ivs-costs`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/costs.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Auto-record to S3 has no IVS charge; S3 storage, the S3 API calls IVS makes, and serving the recordings are charged
  - As a rule of thumb, on average 50% of a stream is delivered to each viewer

### AWS::IVS::Channel

- ID: `cfn-ivs-channel`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-channel.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - The Channel resource does not create a stream key, unlike the CreateChannel API
  - Properties Type, LatencyMode (default LOW), Authorized, InsecureIngest, RecordingConfigurationArn, and their defaults
  - Attributes Arn, IngestEndpoint, PlaybackUrl; the playback URL contains the account ID

### AWS::IVS::StreamKey

- ID: `cfn-ivs-streamkey`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-streamkey.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Attributes Arn and Value; Value is the stream key itself
  - Changing ChannelArn replaces the resource

### IVS API: GetStream

- ID: `ivs-api-getstream`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_GetStream.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - An offline channel is reported as the ChannelNotBroadcasting error (HTTP 404), not as a response

### IVS API: Stream

- ID: `ivs-api-stream`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_Stream.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Do not rely on the OFFLINE state; the API may not return it
  - viewerCount of -1 means the request timed out; health is HEALTHY, STARVING, or UNKNOWN

### IVS API: StopStream

- ID: `ivs-api-stopstream`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_StopStream.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - StopStream disconnects the incoming stream; encoders often reconnect, so revoke the stream key to stop it for good

### IVS API: DeleteChannel

- ID: `ivs-api-deletechannel`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_DeleteChannel.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Deleting a channel deletes its stream keys
  - Deleting a live channel fails with 409 ConflictException; stop the stream and wait for Stream End first

### Using Amazon EventBridge with IVS Low-Latency Streaming

- ID: `ivs-eventbridge`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Events are best effort: they may be missing, hours late, or out of order (Stream Down before Stream Up)
  - Detail types, event names, and the example payloads used as test fixtures
  - Each time a channel goes live it gets a new stream_id
  - Session Ended may arrive before Stream End

### IVS Player SDK

- ID: `ivs-player-sdk`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - The IVS player is required for low latency; latency is under five seconds depending on location and settings
  - Browsers on iOS get normal-latency playback only; a service worker brings iOS Safari to about 6 to 8 seconds
  - Third-party players can be brought to about 10 seconds

### Getting Started with the IVS Web Player SDK

- ID: `ivs-web-player-guide`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/web-getting-started.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - The SDK is offered as a script tag and as an npm module; the page names 1.57.0 as the latest
  - playsinline is required for inline playback on iOS Safari
  - The WebAssembly binary must be served as application/wasm when self-hosted

### amazon-ivs-player 1.57.0 (npm tarball)

- ID: `ivs-player-npm`
- URL: <https://www.npmjs.com/package/amazon-ivs-player/v/1.57.0>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - create() takes wasmWorker and wasmBinary URLs; the files ship under dist/assets
  - ErrorType.NOT_AVAILABLE with code 404 means the stream does not exist or is offline, 429 that the viewer limit was reached
  - getLiveLatency() returns the latency from the server to the player in seconds; isLiveLowLatency() and TEXT_METADATA_CUE exist
  - The package is AWS Content under the AWS Customer Agreement, not an open-source license; peer dependencies are bowser and lodash
- Note: Read from dist/index.d.ts and package.json of the installed tarball.

### Embedding Metadata within a Video Stream

- ID: `ivs-timed-metadata`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/metadata.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Timed metadata is embedded in the video segments, so every viewer receives it at the same point in the stream
  - PutMetadata works only on a live stream; there is no guarantee when the metadata is inserted
  - The web player delivers it as TEXT_METADATA_CUE

### IVS Auto-Record to Amazon S3

- ID: `ivs-record-to-s3`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Recordings are written under ivs/v1/<account>/<channel>/<date>/<recording id> as HLS media, thumbnails, and JSON metadata
  - Process a recording only after the Recording End event

### What Is MediaLive?

- ID: `medialive-what-is`
- URL: <https://docs.aws.amazon.com/medialive/latest/ug/what-is.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - MediaLive transforms live video from one format and package into others, for broadcast and streaming delivery

### MediaLive: Related Services

- ID: `medialive-related-services`
- URL: <https://docs.aws.amazon.com/medialive/latest/ug/related-services.html>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - MediaPackage is a just-in-time video packaging and origination service that can package content encoded by MediaLive

### AWS Elemental MediaLive Pricing

- ID: `medialive-pricing`
- URL: <https://aws.amazon.com/medialive/pricing/>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - A running channel is charged whether or not its inputs receive content; push inputs and channels are also charged while idle
  - Running time is rounded up to the minute above a 10-minute minimum

### Cloudflare Stream: Stream live video

- ID: `cloudflare-stream-live`
- URL: <https://developers.cloudflare.com/stream/stream-live/>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - Ingest over RTMPS or SRT; playback in the Stream Player or any HLS or DASH player
  - Every live stream is recorded automatically
  - Priced per 1,000 minutes recorded and per 1,000 minutes delivered, with no separate encoding charge
- Note: The page gives no latency figures.

### @go-to-k/cdkd 0.296.28: IVS resource types (npm tarball)

- ID: `cdkd-npm-ivs`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-11
- Chapters: 18
- Claims this source supports:
  - register-providers.ts registers no provider for any AWS::IVS type, so Channel and StreamKey go through Cloud Control API; AWS::Events::Rule, AWS::Lambda::*, AWS::IAM::*, and AWS::Logs::LogGroup have dedicated providers
  - The Cloud Control provider stores the resource model returned by a create as the resource's attributes in state
  - AWS::IVS::StreamKey Value is on cdkd's list of secret-valued attributes
- Note: Read from the bundled dist of the tarball, which keeps the src/ region markers. No cdkd command was run against AWS, so what state.json holds for a stream key is not observed.

## Sources not re-read yet (starting points for later chapters)

### Security best practices in IAM

- ID: `iam-best-practices`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html>
- Chapters: 01, 21
- Claims this source supports:
  - Prefer temporary credentials; protect the root user with MFA and do not use it for everyday work
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### nix develop

- ID: `nix-develop`
- URL: <https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-develop>
- Chapters: 02
- Claims this source supports:
  - `nix develop` enters the devShell of a flake
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### nix flake

- ID: `nix-flake`
- URL: <https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-flake>
- Chapters: 02
- Claims this source supports:
  - flake.lock pins every input to an exact revision and hash
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Vite+: Run

- ID: `viteplus-run`
- URL: <https://viteplus.dev/guide/run>
- Chapters: 02
- Claims this source supports:
  - Task runner and cache behavior
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Vite+: Check

- ID: `viteplus-check`
- URL: <https://viteplus.dev/guide/check>
- Chapters: 02
- Claims this source supports:
  - `vp check` runs format, lint, and type checks
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Vite+: Environment

- ID: `viteplus-env`
- URL: <https://viteplus.dev/guide/env>
- Chapters: 02
- Claims this source supports:
  - Node.js and package-manager selection
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### AWS CDK bootstrapping

- ID: `cdk-bootstrapping`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html>
- Chapters: 02
- Claims this source supports:
  - `cdk bootstrap` deploys the CDKToolkit stack with an asset bucket, an ECR repository, and IAM roles
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdk diff

- ID: `cdk-diff`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html>
- Chapters: 02, 20
- Claims this source supports:
  - `cdk diff` compares the synthesized template with the deployed template
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Detect unmanaged configuration changes to stacks and resources with drift detection

- ID: `cfn-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html>
- Chapters: 02, 20
- Claims this source supports:
  - CloudFormation drift detection compares live resource properties with the template; not every resource type or property is covered
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Detect drift on an entire CloudFormation stack

- ID: `cfn-detect-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html>
- Chapters: 20
- Claims this source supports:
  - Detection is asynchronous and must be polled to completion
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: Concepts

- ID: `cdkd-concepts`
- URL: <https://cdkd.dev/concepts/index.html>
- Chapters: 02
- Claims this source supports:
  - cdkd provisions through AWS SDK and Cloud Control API calls and keeps its own state in S3
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: Drift

- ID: `cdkd-drift`
- URL: <https://cdkd.dev/drift/index.html>
- Chapters: 02, 20
- Claims this source supports:
  - Outcome categories and resolution with --accept and --revert
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: drift CLI reference

- ID: `cdkd-cli-drift`
- URL: <https://cdkd.dev/cli-drift/index.html>
- Chapters: 20
- Claims this source supports:
  - Flags and exit codes of `cdkd drift`
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### cdkd: Local emulation

- ID: `cdkd-local`
- URL: <https://cdkd.dev/local-emulation/index.html>
- Chapters: 04
- Claims this source supports:
  - `cdkd local start-api` runs HTTP APIs in local containers and needs Docker
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Ox Content: Site generation

- ID: `ox-content-site-generation`
- URL: <https://ox-content.dev/built-in/site-generation/>
- Chapters: 03
- Claims this source supports:
  - Static site generation options
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Lambda response streaming

- ID: `lambda-response-streaming`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html>
- Chapters: 09, 17
- Claims this source supports:
  - Which invocation paths support streaming responses
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Lambda durable functions

- ID: `lambda-durable-functions`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html>
- Chapters: 16
- Claims this source supports:
  - Durable functions checkpoint progress and resume
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Cloudflare D1: Migrations

- ID: `cloudflare-d1-migrations`
- URL: <https://developers.cloudflare.com/d1/reference/migrations/>
- Chapters: 13
- Claims this source supports:
  - wrangler applies numbered SQL migration files locally and remotely
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Cloudflare D1: Read replication

- ID: `cloudflare-d1-read-replication`
- URL: <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- Chapters: 13
- Claims this source supports:
  - Read replicas and the Sessions API
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Cloudflare Workers AI: Get started

- ID: `cloudflare-workers-ai-quickstart`
- URL: <https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/>
- Chapters: 17
- Claims this source supports:
  - A Worker calls a model through the AI binding
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon DynamoDB?

- ID: `dynamodb-intro`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html>
- Chapters: 14
- Claims this source supports:
  - Data model and capacity modes
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### DynamoDB global tables

- ID: `dynamodb-global-tables`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html>
- Chapters: 05
- Claims this source supports:
  - Multi-Region replication overview
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### DynamoDB global tables core concepts

- ID: `dynamodb-global-tables-concepts`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables-CoreConcepts.html>
- Chapters: 05
- Claims this source supports:
  - Consistency modes
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Amazon Cognito user pools

- ID: `cognito-user-pools`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html>
- Chapters: 06
- Claims this source supports:
  - User pools as an OIDC identity provider
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon SQS?

- ID: `sqs-welcome`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html>
- Chapters: 08
- Claims this source supports:
  - Standard queues deliver at least once
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon EventBridge Scheduler?

- ID: `eventbridge-scheduler`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html>
- Chapters: 08, 16
- Claims this source supports:
  - One-time and recurring schedules
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Amazon CloudFront KeyValueStore

- ID: `cloudfront-kvs`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html>
- Chapters: 10, 14
- Claims this source supports:
  - Read-only key-value data for CloudFront Functions
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Restrictions on Lambda@Edge

- ID: `lambda-edge-restrictions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html>
- Chapters: 10
- Claims this source supports:
  - Region, version, and configuration restrictions
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Amazon VPC pricing

- ID: `vpc-pricing`
- URL: <https://aws.amazon.com/vpc/pricing/>
- Chapters: 11, 23
- Claims this source supports:
  - NAT gateway and public IPv4 address charges
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Elastic Load Balancing pricing

- ID: `elb-pricing`
- URL: <https://aws.amazon.com/elasticloadbalancing/pricing/>
- Chapters: 12
- Claims this source supports:
  - ALB hourly and LCU charges
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon ECS?

- ID: `ecs-welcome`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html>
- Chapters: 12
- Claims this source supports:
  - ECS, Fargate, and ECR relationships
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Docker overview

- ID: `docker-overview`
- URL: <https://docs.docker.com/get-started/docker-overview/>
- Chapters: 12
- Claims this source supports:
  - The Docker client talks to a separate daemon
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Aurora DSQL?

- ID: `dsql-what-is`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html>
- Chapters: 13
- Claims this source supports:
  - Service overview
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL PostgreSQL compatibility

- ID: `dsql-pg-compat`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html>
- Chapters: 13
- Claims this source supports:
  - Supported and unsupported PostgreSQL features
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL DDL

- ID: `dsql-ddl`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html>
- Chapters: 13
- Claims this source supports:
  - DDL behavior and limits
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL Node.js connectors

- ID: `dsql-node-connectors`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html>
- Chapters: 13
- Claims this source supports:
  - Connecting with IAM authentication from Node.js
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL concurrency control

- ID: `dsql-concurrency`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html>
- Chapters: 13
- Claims this source supports:
  - Optimistic concurrency control and retry
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora DSQL pricing

- ID: `dsql-pricing`
- URL: <https://aws.amazon.com/rds/aurora/dsql/pricing/>
- Chapters: 13
- Claims this source supports:
  - Billing units
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Aurora Serverless v2 auto-pause

- ID: `aurora-auto-pause`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
- Chapters: 13
- Claims this source supports:
  - Conditions for pausing and what is still billed
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon RDS?

- ID: `rds-welcome`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html>
- Chapters: 13
- Claims this source supports:
  - Service overview
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Request SES production access

- ID: `ses-production-access`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html>
- Chapters: 15
- Claims this source supports:
  - Sandbox limits and the production-access request
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Bedrock?

- ID: `bedrock-what-is`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html>
- Chapters: 17
- Claims this source supports:
  - Service overview
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Bedrock Converse API

- ID: `bedrock-converse`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html>
- Chapters: 17
- Claims this source supports:
  - Converse and ConverseStream
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### CloudWatch RUM

- ID: `cloudwatch-rum`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html>
- Chapters: 19
- Claims this source supports:
  - Real-user monitoring
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### X-Ray SDK and daemon support timeline

- ID: `xray-sdk-timeline`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html>
- Chapters: 19
- Claims this source supports:
  - The X-Ray SDKs and daemon move to maintenance; OpenTelemetry is recommended. The X-Ray service itself continues
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Inspector?

- ID: `inspector-what-is`
- URL: <https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html>
- Chapters: 21
- Claims this source supports:
  - Vulnerability scanning
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon GuardDuty?

- ID: `guardduty-what-is`
- URL: <https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html>
- Chapters: 21
- Claims this source supports:
  - Threat detection
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld source

- ID: `celld-source`
- URL: <https://github.com/denoland/celld>
- Chapters: 24
- Claims this source supports:
  - Project source
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld limitations

- ID: `celld-limitations`
- URL: <https://github.com/denoland/celld/blob/main/docs/limitations.md>
- Chapters: 24
- Claims this source supports:
  - Maturity (beta) and known limits
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld security

- ID: `celld-security`
- URL: <https://github.com/denoland/celld/blob/main/docs/security.md>
- Chapters: 24
- Claims this source supports:
  - Trust model
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld guarantees

- ID: `celld-guarantees`
- URL: <https://celld.dev/docs/guarantees/>
- Chapters: 24
- Claims this source supports:
  - Durability guarantees and their assumptions
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### celld documentation

- ID: `celld-docs`
- URL: <https://celld.dev/docs/>
- Chapters: 24
- Claims this source supports:
  - Compatibility and upgrade notes
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.
