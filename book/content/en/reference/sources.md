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

### Amazon CloudFront pricing (flat-rate plans)

- ID: `cloudfront-pricing-plans`
- URL: <https://aws.amazon.com/cloudfront/pricing/>
- Checked: 2026-10-11
- Chapters: 03
- Claims this source supports:
  - Flat-rate plans exist: Free USD 0, Pro USD 15, Business USD 200, Premium USD 1,000 per month
  - Flat-rate plans cannot be combined with other offers or discounts
- Note: Which features and origins each plan allows, and CloudFormation/CDK support for selecting a plan, were not verified. The book's examples use pay-as-you-go.

### AWS Price List bulk API: Lambda, ap-northeast-1

- ID: `aws-price-list-lambda`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 04, 08, 09, 14, 16, 17, 20
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AWSLambda

### AWS Price List bulk API: API Gateway, ap-northeast-1

- ID: `aws-price-list-apigw`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 04, 14
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonApiGateway
  - HTTP API requests are priced lower than REST API requests in ap-northeast-1

### AWS Price List bulk API: S3, ap-northeast-1

- ID: `aws-price-list-s3`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 03, 07, 08, 09, 16, 20, 24
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonS3

### AWS Price List bulk API: CloudWatch, ap-northeast-1

- ID: `aws-price-list-cloudwatch`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 04, 08, 12, 14, 16, 17, 19
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCloudWatch
  - The price list has a USD 0 tier for the first 5 GB of log ingestion and 5 GB-month of log storage

### AWS Price List bulk API: CloudFront

- ID: `aws-price-list-cloudfront`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json>
- Checked: 2026-10-11
- Chapters: 03, 09, 10
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonCloudFront

### cdkd: Introduction

- ID: `cdkd-introduction`
- URL: <https://cdkd.dev/introduction/>
- Checked: 2026-10-11
- Chapters: 02, 11, 12, 20, 23, 24
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
- Chapters: 04, 09, 19
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

### Quotas for HTTP APIs in API Gateway

- ID: `apigw-http-quotas`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html>
- Checked: 2026-10-11
- Chapters: 04
- Claims this source supports:
  - Maximum integration timeout is 30 seconds and cannot be increased
  - Payload size is 10 MB
  - 300 routes per API by default

### Create AWS Lambda proxy integrations for HTTP APIs in API Gateway

- ID: `apigw-http-lambda-payload`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html>
- Checked: 2026-10-12
- Chapters: 04
- Claims this source supports:
  - In payload format 2.0, duplicate headers are combined with commas and included in the headers field; there is no multiValueHeaders field
  - Format 2.0 has a cookies field for the request's cookies, and in the response each entry of cookies becomes a set-cookie header
  - All header names in the event are lowercased
  - The 2.0 event carries rawPath, rawQueryString, requestContext.domainName, requestContext.http.method, body, and isBase64Encoded
  - A customized 2.0 response has cookies, isBase64Encoded, statusCode, headers, and body

### Lambda quotas

- ID: `lambda-quotas`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html>
- Checked: 2026-10-11
- Chapters: 04, 07, 08, 12, 16
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
- Chapters: 05, 14
- Claims this source supports:
  - A write that returned HTTP 200 has been durably persisted
  - Eventually consistent reads are the default, may not reflect a recently completed write, and cost half of strongly consistent reads
  - ConsistentRead is available on GetItem, Query, and Scan for tables and local secondary indexes, not for global secondary indexes or streams
  - Global tables have two modes: multi-Region eventual consistency (default, typically replicated within a second) and multi-Region strong consistency (synchronous replication before the write returns)

### DynamoDB condition expression CLI example

- ID: `dynamodb-condition-expressions`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html>
- Checked: 2026-10-11
- Chapters: 05, 08, 14
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
- Chapters: 05, 14
- Claims this source supports:
  - On-demand tables are billed per read and write request, with no throughput charge at zero traffic
  - One read request unit is one strongly consistent read, or two eventually consistent reads, of an item up to 4 KB; one write request unit is one write of an item up to 1 KB
  - New on-demand tables sustain up to 4,000 writes and 12,000 reads per second and can be throttled when traffic more than doubles within 30 minutes
  - A maximum read or write throughput can be configured per on-demand table

### Constraints in Amazon DynamoDB

- ID: `dynamodb-constraints`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html>
- Checked: 2026-10-11
- Chapters: 05, 14
- Claims this source supports:
  - Maximum item size is 400 KB
  - A transaction can contain at most 100 unique items and 4 MB
  - Sort key values are at most 1024 bytes and partition key values 2048 bytes

### AWS Price List bulk API: DynamoDB, ap-northeast-1

- ID: `aws-price-list-dynamodb`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 05, 08, 14, 16
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonDynamoDB
  - The storage price has a USD 0 tier for the first 25 GB-month

### amazon/dynamodb-local container image tags (Docker Hub)

- ID: `dynamodb-local-image`
- URL: <https://hub.docker.com/r/amazon/dynamodb-local/tags>
- Checked: 2026-10-11
- Chapters: 05, 14
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

### Amazon VPC pricing

- ID: `vpc-pricing`
- URL: <https://aws.amazon.com/vpc/pricing/>
- Checked: 2026-10-11
- Chapters: 11, 12, 23
- Claims this source supports:
  - A NAT gateway is billed per NAT gateway-hour while provisioned and available, plus per GB processed regardless of source or destination; a partial hour is billed as a full hour
  - Standard data transfer charges apply on top of NAT gateway data processing
  - Every public IPv4 address is billed by the hour, in use or idle, at the same rate; Elastic IP addresses attached to NAT gateways are named as an example
  - A Regional NAT gateway is billed per hour for each Availability Zone it is configured in
- Note: The page renders its regional price tables with JavaScript. The numbers in the book come from the Price List bulk API, not from this page.

### What is Amazon VPC?

- ID: `vpc-what-is`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - There is no additional charge for using a VPC; some components such as NAT gateways are charged
  - Private IPv4 addresses are not charged
  - AWS Free Tier customers get 750 hours of public IPv4 address usage with the EC2 service

### Subnets for your VPC

- ID: `vpc-subnet-types`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - The subnet type is determined by its routing: a public subnet has a direct route to an internet gateway, a private subnet does not and needs a NAT device for internet access, an isolated subnet has no routes to destinations outside its VPC
  - Network ACLs allow or deny traffic at the subnet level

### Subnet CIDR blocks

- ID: `vpc-subnet-sizing`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - A subnet's IPv4 CIDR block is between /28 and /16
  - The first four addresses and the last address of every subnet are reserved

### VPC CIDR blocks

- ID: `vpc-cidr-blocks`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - A VPC's IPv4 CIDR block is between /16 and /28
  - Some AWS services use 172.17.0.0/16, so that range is best avoided

### Route table concepts

- ID: `vpc-route-table-concepts`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - The main route table controls routing for every subnet not explicitly associated with another route table
  - Every route table has a local route for communication within the VPC
  - A route has a destination CIDR and a target such as an internet gateway

### Control traffic to your AWS resources using security groups

- ID: `vpc-security-groups`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
- Checked: 2026-10-11
- Chapters: 11, 12
- Claims this source supports:
  - Security groups are stateful: responses to allowed traffic are allowed regardless of the rules in the other direction

### Control subnet traffic with network access control lists

- ID: `vpc-network-acls`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Network ACLs are stateless: responses to allowed traffic are not automatically allowed
  - Network ACL rules are evaluated when traffic enters and leaves the subnet, not as it is routed within a subnet
  - The default network ACL allows all inbound and outbound traffic
- Note: The default rules were read on the linked page https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html.

### Infrastructure security in Amazon VPC

- ID: `vpc-security-comparison`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Security groups work at the instance level with allow rules only; network ACLs work at the subnet level with allow and deny rules, evaluated in ascending order
  - You can secure your instances using only security groups

### Enable internet access for a VPC using an internet gateway

- ID: `vpc-internet-gateway`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - There is no charge for an internet gateway itself

### NAT gateway basics

- ID: `vpc-nat-gateway-basics`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - A NAT gateway is created in one Availability Zone and is redundant within that zone
  - If zones share one NAT gateway and its zone is down, resources in the other zones lose internet access; one NAT gateway per zone avoids this
  - A public NAT gateway sits in a public subnet and needs an Elastic IP address
- Note: The Elastic IP requirement was read on https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html.

### Gateway endpoints

- ID: `vpc-gateway-endpoints`
- URL: <https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Gateway endpoints exist for Amazon S3 and DynamoDB only, and need no internet gateway or NAT device
  - There is no additional charge for using gateway endpoints
  - Creating one adds a route to each selected route table: destination the service's prefix list, target the endpoint
  - Prefix lists are specific to a Region, so traffic to the service in another Region does not use the endpoint

### Access an AWS service using an interface VPC endpoint

- ID: `vpc-interface-endpoints`
- URL: <https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html>
- Checked: 2026-10-11
- Chapters: 11, 23, 24
- Claims this source supports:
  - An interface endpoint creates an endpoint network interface with a private IP address in each chosen subnet, one subnet per Availability Zone
  - Interface endpoints are billed for hourly usage and for data processing
  - Private DNS needs DNS hostnames and DNS resolution enabled on the VPC
  - The endpoint's security group must allow inbound HTTPS from the resources that call it

### AWS services that integrate with AWS PrivateLink

- ID: `privatelink-aws-services`
- URL: <https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Service names com.amazonaws.region.ecr.api, ecr.dkr, logs, secretsmanager, ssm, ssmmessages, and ec2messages

### AWS PrivateLink pricing

- ID: `privatelink-pricing`
- URL: <https://aws.amazon.com/privatelink/pricing/>
- Checked: 2026-10-11
- Chapters: 11, 12, 23
- Claims this source supports:
  - An interface endpoint is billed for each hour it stays provisioned in each Availability Zone; a partial hour is billed as a full hour
  - Data processing is billed per GB regardless of the traffic's source or destination, in tiers over the Region's monthly total
- Note: The hourly rate is rendered with JavaScript; the book's number comes from the Price List bulk API.

### AWS::EC2::VPCEndpoint

- ID: `cfn-ec2-vpcendpoint`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Properties VpcEndpointType, ServiceName, VpcId, RouteTableIds, SubnetIds, SecurityGroupIds, and PrivateDnsEnabled

### Giving Lambda functions access to resources in an Amazon VPC

- ID: `lambda-vpc`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html>
- Checked: 2026-10-11
- Chapters: 11, 14
- Claims this source supports:
  - By default a Lambda function can reach the public internet; attached to a VPC it can reach only what the VPC can
  - Connecting a function to a public subnet gives it neither internet access nor a public IP address
  - The execution role needs ec2:CreateNetworkInterface, DescribeNetworkInterfaces, DescribeSubnets, DeleteNetworkInterface, AssignPrivateIpAddresses, and UnassignPrivateIpAddresses on all resources, and the function's code is implicitly granted them too
  - A new function stays Pending while Lambda creates the Hyperplane ENI, which can take several minutes; functions with the same subnets and security groups share one
  - After 14 idle days Lambda reclaims unused Hyperplane ENIs and the function becomes Inactive

### Amazon ECR interface VPC endpoints (AWS PrivateLink)

- ID: `ecr-vpc-endpoints`
- URL: <https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html>
- Checked: 2026-10-11
- Chapters: 11, 12
- Claims this source supports:
  - Fargate tasks on platform version 1.4.0 or later need both ECR endpoints (ecr.api, ecr.dkr) and the S3 gateway endpoint to pull images privately
  - Fargate tasks that use the awslogs driver in a VPC without an internet gateway need the com.amazonaws.region.logs interface endpoint

### Fargate task networking

- ID: `ecs-fargate-networking`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html>
- Checked: 2026-10-11
- Chapters: 11, 12
- Claims this source supports:
  - A Fargate task pulls its image over a public IP address in a public subnet, a NAT gateway from a private subnet, or ECR interface endpoints

### Improve the security of EC2 instances by using VPC endpoints for Systems Manager

- ID: `ssm-vpc-endpoints`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Systems Manager without internet access uses the ssm, ssmmessages, and ec2messages interface endpoints, and S3 for agent updates
  - ssmmessages is required for Session Manager

### AWS Availability Zones

- ID: `aws-availability-zones`
- URL: <https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Each Region has at least three Availability Zones
  - An AZ ID such as apne1-az1 is the same physical location in every account; ap-northeast-1 has apne1-az1 to apne1-az4
  - AWS may restrict new resources in a constrained Availability Zone

### AZ IDs for your AWS resources

- ID: `aws-az-mapping`
- URL: <https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - In Asia Pacific (Tokyo), accounts created before November 2025 have Availability Zone names mapped independently per account
  - `aws ec2 describe-availability-zones` lists the zone names and IDs of an account

### AWS Fault Isolation Boundaries: Availability Zones

- ID: `fault-isolation-availability-zones`
- URL: <https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - An Availability Zone is one or more discrete data centers with separate power, networking, and connectivity inside one Region
  - Zones in a Region are up to about 100 km apart and designed not to fail together

### AWS Fault Isolation Boundaries: Regions

- ID: `fault-isolation-regions`
- URL: <https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/regions.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Regions are isolated from each other, which limits a service failure to one Region
  - Resources and data in one Region do not exist in another unless you replicate them

### AWS Price List bulk API: EC2, ap-northeast-1

- ID: `aws-price-list-ec2`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 11, 12
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonEC2: NAT gateway hours and data processing
  - The offer also lists a Regional NAT gateway at the same hourly and per-GB rate, and regional data transfer at USD 0.01 per GB
- Note: The file is about 445 MB. NAT gateway prices live in the EC2 offer, not the VPC offer.

### AWS Price List bulk API: VPC, ap-northeast-1

- ID: `aws-price-list-vpc`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 11, 12, 16, 23, 24
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonVPC: interface endpoint hours and data processing, public IPv4 address hours
  - The offer has no SKU for a VPC, subnet, route table, internet gateway, or gateway endpoint

### cdkd v0.296.28 source: provider registry and property coverage

- ID: `cdkd-source-network`
- URL: <https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - register-providers.ts registers one EC2 provider for AWS::EC2::VPC, Subnet, InternetGateway, EIP, VPCGatewayAttachment, NatGateway, RouteTable, Route, SubnetRouteTableAssociation, SecurityGroup, SecurityGroupIngress, Instance, NetworkAcl, NetworkAclEntry, and SubnetNetworkAclAssociation
  - AWS::EC2::VPCEndpoint is not registered and is not in the unsupported list, so it goes through Cloud Control API
  - property-coverage.generated.ts lists the properties the EC2 provider writes; a resource using any other property is routed through Cloud Control API
  - The intrinsic resolver handles Fn::GetAZs
- Note: Read from the source archive of the v0.296.28 tag. The npm tarball ships bundled JavaScript without the TypeScript sources. No cdkd command was run against AWS.

### cdkd v0.296.28: Cross-Stack References

- ID: `cdkd-cross-stack-references`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cross-stack-references.md>
- Checked: 2026-10-11
- Chapters: 11, 12, 23
- Claims this source supports:
  - cdkd resolves Fn::ImportValue against the outputs other stacks recorded in its state, and falls back to CloudFormation ListExports when no cdkd stack exports the name
  - `cdkd destroy` of a stack whose exports are still imported is refused with StackHasActiveImportsError, and there is no flag to force it
  - cdkd also resolves Fn::GetStackOutput as a weak reference that does not block the producer's destroy; its documentation calls the intrinsic cdkd-specific
  - Outputs are stored in the state file; state version 9 records which output keys are Export names
- Note: Read together with docs/stack-outputs.md and src/types/state.ts at the same tag. Not exercised against AWS. CloudFormation's own documentation also lists Fn::GetStackOutput (see cfn-stack-exports); how the two relate was not investigated.

### Default security groups for your VPCs

- ID: `vpc-default-security-group`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Every VPC comes with a default security group, and a resource created without a security group is associated with it
  - AWS recommends creating security groups for specific resources instead of using the default one

### Get exported outputs from a deployed CloudFormation stack

- ID: `cfn-stack-exports`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Export names must be unique within a Region for each AWS account
  - After another stack imports an output value, the exporting stack cannot be deleted and the exported value cannot be modified until every import is removed
  - CloudFormation documents Fn::GetStackOutput for references across accounts or Regions

### AWS::EC2::Subnet

- ID: `cfn-ec2-subnet`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html>
- Checked: 2026-10-11
- Chapters: 11
- Claims this source supports:
  - Updating a subnet's CidrBlock replaces the subnet: a new one is created and the old one deleted

### Amazon VPCs and ElastiCache security

- ID: `elasticache-vpc`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html>
- Checked: 2026-10-11
- Chapters: 11, 14
- Claims this source supports:
  - All node-based ElastiCache clusters are launched in a VPC; ElastiCache Serverless caches can also be configured with a public endpoint that needs no VPC configuration

### Request production access (Moving out of the Amazon SES sandbox)

- ID: `ses-production-access`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - New accounts start in the SES sandbox, and the sandbox status is per Region
  - In the sandbox: mail only to verified addresses and domains or the mailbox simulator, at most 200 messages per 24 hours, at most 1 message per second
  - In the sandbox, bulk actions and SES API calls for suppression list management are disabled
  - After leaving the sandbox, From, Source, Sender and Return-Path identities still have to be verified
  - The console request asks for mail type (Marketing or Transactional), website URL, up to 4 additional contact addresses, preferred contact language (English or Japanese), and an acknowledgement
  - `aws sesv2 put-account-details --production-access-enabled --mail-type --website-url --additional-contact-email-addresses --contact-language` submits the same request
  - AWS Support gives an initial response within 24 hours; details cannot be edited while the review is open

### Using the Amazon SES account-level suppression list

- ID: `ses-suppression-list`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - The account-level suppression list applies to one account in one Region
  - Accounts that started using SES after 2019-11-25 use it by default for bounces and complaints
  - A message to a suppressed address (with a matching reason) is accepted by SES but not sent
  - Such messages count toward the daily sending quota, and not toward the reputation bounce and complaint rates
  - Only hard bounces are added; addresses stay until removed
  - Gmail does not provide complaint data to SES
  - PutSuppressedDestination and CreateImportJob are unavailable in the sandbox
  - A configuration set can override the account-level suppression settings; with it, addresses are added only for mail sent with that configuration set
  - List entries are case-sensitive in the management API
  - `aws sesv2 put-account-suppression-attributes`, `list-suppressed-destinations`, and `delete-suppressed-destination`

### How email sending works in Amazon SES

- ID: `ses-sending-process`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-process.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - A successful request returns a message ID; delivery, bounce, and complaint happen afterwards
  - On rare occasions SES may accept an email for delivery even though the send request returns an error; a retry may then send a second email with a different message ID
  - SES recommends message tags, not only the message ID, to correlate event notifications with sending logic
  - Definitions of hard bounce and soft bounce; SES retries soft bounces for a period before reporting them

### SES API v2: SendEmail

- ID: `ses-sendemail-api`
- URL: <https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Request fields used: FromEmailAddress, Destination.ToAddresses, Content.Simple, ConfigurationSetName, EmailTags
  - The request has no idempotency or client token parameter
  - The response is a MessageId, and SES can accept a message without sending it
  - Errors: AccountSuspendedException, BadRequestException, LimitExceededException, MailFromDomainNotVerifiedException, MessageRejected, SendingPausedException (400), NotFoundException (404), TooManyRequestsException (429)

### SES API v2: MessageTag

- ID: `ses-message-tag`
- URL: <https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageTag.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Tag names and values: ASCII letters, digits, underscore and dash only, at most 256 characters

### Monitor email sending using Amazon SES event publishing

- ID: `ses-event-publishing`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Events are published only for mail sent with a configuration set that has an event destination
  - Meaning of the Send, Delivery, Bounce, Complaint, Reject and DeliveryDelay events
  - Delivery means delivered to the recipient's mail server
  - Message tags and auto-tags are included in published events

### Contents of event data that Amazon SES publishes to Amazon SNS

- ID: `ses-event-contents`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Top-level fields eventType, mail, bounce, complaint, delivery, and the possible eventType values
  - mail.messageId and mail.tags; bounce.bounceType, bounceSubType, bouncedRecipients[].emailAddress, timestamp, feedbackId
  - bounceType is Undetermined, Permanent or Transient; Permanent includes the OnAccountSuppressionList subtype
  - Only hard bounces, and soft bounces SES has stopped retrying, are published
  - Most ISPs redact the complainer's address, so complainedRecipients lists every recipient of the mail on the complaining domain

### Examples of event data that Amazon SES publishes to Amazon SNS

- ID: `ses-event-examples`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - The Bounce, Complaint and Delivery example records that examples/15-email/test/fixtures/ follow
- Note: The fixtures are edited copies of the documented examples. No event was captured from a real account.

### Set up an Amazon SNS event destination for event publishing

- ID: `ses-sns-destination`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - SES supports standard SNS topics only as an event destination, not FIFO
  - The topic policy must allow sns:Publish to ses.amazonaws.com, conditioned on AWS:SourceAccount and the configuration set's AWS:SourceArn

### Creating and verifying identities in Amazon SES

- ID: `ses-identities`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - An identity is a domain or an email address, verified separately in each Region
  - Verifying a domain covers its addresses and subdomains
  - An address verified only through its domain is limited to straightforward sending; advanced sending includes using the address with configuration sets
  - Email address identities are case-sensitive; the verification mail comes from no-reply-aws@amazon.com and its link expires after 24 hours
  - A domain identity is verified by publishing three Easy DKIM CNAME records, which can take up to 72 hours to be detected
  - The CNAME value is the token followed by the SigningHostedZone returned by CreateEmailIdentity and GetEmailIdentity
- Note: What "using the address with configuration sets" excludes for an address that is verified only through its domain is not spelled out. The stack sets the configuration set as the identity's default as well as naming it on each send.

### Easy DKIM in Amazon SES

- ID: `ses-easy-dkim`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - With Easy DKIM, SES signs every mail from the identity with a 2048-bit key by default
  - The SES console can publish the records itself when Route 53 hosts the domain

### Using a custom MAIL FROM domain

- ID: `ses-mail-from`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/mail-from.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - By default the MAIL FROM domain is a subdomain of amazonses.com, and SPF passes for that domain
  - A custom MAIL FROM domain must be a subdomain of the verified identity's domain, not used for sending or receiving
  - It needs exactly one MX record `10 feedback-smtp.<region>.amazonses.com` and a TXT record "v=spf1 include:amazonses.com ~all"
  - Behavior on MX failure is either falling back to the default MAIL FROM domain or rejecting the message
  - SES looks for the MX record for up to 72 hours

### Complying with DMARC authentication protocol in Amazon SES

- ID: `ses-dmarc`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - SPF checks the MAIL FROM domain, DKIM checks the signing domain, and DMARC requires one of them to align with the From domain
  - A message passes DMARC if either the SPF or the DKIM alignment check passes
  - The DMARC policy is a TXT record at _dmarc.<domain>; p=none, quarantine, and reject, rolled out in that order
  - SPF alignment through SES needs a custom MAIL FROM domain; DKIM alignment needs Easy DKIM on the From domain
  - `dig TXT _dmarc.<domain>` shows the published policy

### Sending test emails in Amazon SES with the simulator

- ID: `ses-mailbox-simulator`
- URL: <https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - success@, bounce@, complaint@, ooto@ and suppressionlist@simulator.amazonses.com and what each simulates
  - The simulator works in the sandbox
  - Simulator mail does not count toward the daily quota or the bounce and complaint rates, and is billed like any other mail
  - bounce@simulator.amazonses.com is not placed on the suppression list

### SES API v2: GetAccount

- ID: `ses-getaccount-api`
- URL: <https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - ProductionAccessEnabled false means the account is in the sandbox in that Region
  - SendQuota (Max24HourSend, MaxSendRate, SentLast24Hours), SendingEnabled, EnforcementStatus, SuppressionAttributes.SuppressedReasons

### SES API v2: GetEmailIdentity

- ID: `ses-getemailidentity-api`
- URL: <https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailIdentity.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - VerifiedForSendingStatus, VerificationStatus (PENDING, SUCCESS, FAILED, TEMPORARY_FAILURE, NOT_STARTED)
  - DkimAttributes (Status, Tokens, SigningHostedZone) and MailFromAttributes (MailFromDomain, MailFromDomainStatus)
  - Without an event destination or another mechanism, bounce and complaint notifications are sent by email

### AWS Service Reference: actions, resources and condition keys for SES

- ID: `ses-service-reference`
- URL: <https://servicereference.us-east-1.amazonaws.com/v1/ses/ses.json>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - ses:SendEmail is authorized against the resource types identity, configuration-set and template
  - ARN formats arn:aws:ses:<region>:<account>:identity/<name> and :configuration-set/<name>
  - ses:SendEmail supports the condition keys ses:FromAddress, ses:FromDisplayName, ses:Recipients, ses:FeedbackAddress and ses:ApiVersion
- Note: The JSON does not mark which resource types are required. Whether a sandbox account also needs permission on the recipient's identity was not confirmed from a primary source.

### Amazon SES pricing

- ID: `ses-pricing`
- URL: <https://aws.amazon.com/ses/pricing/>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Outbound email is USD 0.10 per 1,000 emails, charged per recipient, plus USD 0.12 per GB of attachments
  - The page describes Free Tier credits for new AWS customers (up to USD 200, a free plan available for 6 months, credits to be used within 12 months) and no monthly count of free messages
  - Dedicated IPs and Virtual Deliverability Manager are separate charges
- Note: Read as rendered on 2026-10-11. The Free Tier terms depend on when and how an account was created; the calculation applies no allowance.

### AWS Price List bulk API: SES, ap-northeast-1

- ID: `aws-price-list-ses`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonSES
  - Mail to the mailbox simulator has its own SKU at the same USD 0.0001 per recipient

### AWS Price List bulk API: SNS, ap-northeast-1

- ID: `aws-price-list-sns`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonSNS
  - The first 1,000,000 SNS API requests a month are a USD 0 tier
  - Deliveries to Lambda are USD 0

### Invoking Lambda functions with Amazon SNS notifications

- ID: `lambda-sns`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/with-sns.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - SNS invokes the function asynchronously; only standard topics are supported
  - Asynchronous invocations process each event at least once, and duplicates can occur
  - The event shape: Records[].Sns.Message and MessageId

### How Lambda handles errors and retries with asynchronous invocation

- ID: `lambda-async-errors`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html>
- Checked: 2026-10-11
- Chapters: 08, 15
- Claims this source supports:
  - When the function returns an error, Lambda runs it two more times by default
  - A function can receive the same event more than once even without an error
  - An event that fails all attempts is discarded unless a dead-letter queue or an on-failure destination is configured

### Amazon SNS message delivery retries

- ID: `sns-delivery-retries`
- URL: <https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - When SNS cannot reach a Lambda endpoint it makes up to 100,015 attempts over 23 days
  - When the delivery policy is exhausted the message is discarded unless the subscription has a dead-letter queue

### AWS SDKs and Tools: Retry behavior

- ID: `sdk-retry-behavior`
- URL: <https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - The default is 3 attempts in total; max attempts 1 disables retries
  - Timeouts, connection failures and HTTP 500, 502, 503, 504 are retried as transient errors; TooManyRequestsException as throttling

### Control access to HTTP APIs with IAM authorization in API Gateway

- ID: `apigw-http-iam-auth`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - With IAM authorization on a route, clients sign requests with SigV4, and API Gateway invokes the route only if the caller has execute-api permission
  - Resource policies are not supported for HTTP APIs

### Using time to live (TTL) in DynamoDB

- ID: `dynamodb-ttl`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html>
- Checked: 2026-10-11
- Chapters: 14, 15
- Claims this source supports:
  - The TTL attribute is a Number holding Unix epoch seconds
  - Expired items are deleted typically within a few days of expiring, without consuming write throughput
  - Until then an expired item can still be read and updated

### Email settings for Amazon Cognito user pools

- ID: `cognito-email-settings`
- URL: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - The default email configuration limits the number of emails per day and is below typical production volume
  - With the SES configuration, the user pool sends through a verified identity in your account, under your SES limits
  - The account must be out of the SES sandbox before Cognito can mail users through your SES configuration
- Note: The daily limit of the default configuration is on the Cognito quotas page, which was not read.

### Cloudflare Email Service

- ID: `cloudflare-email-service`
- URL: <https://developers.cloudflare.com/email-service/>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - Email Sending is in beta for outbound transactional email
  - A Worker sends through a send_email binding (env.EMAIL.send); a REST API and SMTP also exist
  - Email Sending requires the Workers Paid plan
- Note: Only the overview page was read. Domain onboarding, DNS records, bounce handling, limits and prices were not checked.

### @go-to-k/cdkd 0.296.28: provider routing for the resource types of chapter 15 (npm tarball)

- ID: `cdkd-npm-ses`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - No SDK provider is registered for AWS::SES::EmailIdentity, AWS::SES::ConfigurationSet or AWS::SES::ConfigurationSetEventDestination; types without one are routed to Cloud Control API
  - AWS::SNS::Topic, AWS::SNS::TopicPolicy, AWS::SNS::Subscription, AWS::DynamoDB::Table, AWS::Lambda::Function, AWS::Lambda::Permission, AWS::Logs::LogGroup, AWS::IAM::Role, AWS::IAM::Policy and the four AWS::ApiGatewayV2 types have registered SDK providers
- Note: Read from dist/ of the published tarball (the bundled register calls and the provider registry). No cdkd command was run against AWS, so the Cloud Control path for the SES types is unexercised.

### aws-cdk-lib 2.273.0: aws-ses constructs (type definitions and compiled source)

- ID: `aws-cdk-lib-ses`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-11
- Chapters: 15
- Claims this source supports:
  - EmailIdentity exposes dkimRecords, and accepts configurationSet, mailFromDomain and mailFromBehaviorOnMxFailure
  - ConfigurationSet.addEventDestination with an SNS topic also adds a topic policy for ses.amazonaws.com conditioned on the configuration set's ARN
  - ConfigurationSet.suppressionReasons synthesizes SuppressionOptions.SuppressedReasons

### Restrictions on CloudFront Functions

- ID: `cloudfront-functions-restrictions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html>
- Checked: 2026-10-11
- Chapters: 03, 10
- Claims this source supports:
  - CloudFront Functions cannot read the request body
  - The runtime restricts network, file system, environment variable, and timer access
  - Execution time is limited and reported as compute utilization
  - Function logs are truncated at 10 KB
  - KeyValueStore requires JavaScript runtime 2.0
  - The KeyValueStore API uses SigV4A, which needs version 2 session tokens: use a Regional STS endpoint

### JavaScript runtime 2.0 features for CloudFront Functions

- ID: `cloudfront-functions-runtime-20`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - The runtime is ES 5.1 compliant with selected ES 6 to 12 features; const, let, async, and await are supported in runtime 2.0
  - No eval or Function constructor, no setTimeout/setImmediate/clearTimeout, no file system, no process, no environment variables, no network calls
  - Date returns the function's start time for the whole run
  - console supports only log(), without comma-separated arguments
  - Built-in modules are buffer, querystring, and crypto
- Note: The page lists supported features. Syntax it does not list (optional chaining, spread, destructuring, classes, for...of) is treated as unsupported in this book; that inference was not tested on the runtime.

### CloudFront Functions event structure

- ID: `cloudfront-functions-event-structure`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - A function can return a response with statusCode, headers, and a body given as { encoding, data }
  - A status of 400 or above returned by a function is not replaced by a custom error page

### Test functions

- ID: `cloudfront-functions-test`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/test-function.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - CloudFront can run a function against an event object before it is live and report the result, logs, and compute utilization

### Amazon CloudFront KeyValueStore

- ID: `cloudfront-kvs`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - Read-only key-value data for CloudFront Functions
  - Values are strings, byte-encoded strings, or JSON
  - Intended uses include URL rewrites and redirects, A/B testing and feature flags, and access authorization

### Helper methods for key value stores

- ID: `cloudfront-kvs-helper-methods`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - A function starts with `import cf from 'cloudfront'` and `cf.kvs()`
  - get(key, { format }) rejects when the key does not exist; exists(key) and meta() are the other two methods
  - Awaiting reads one after another is recommended over promise combinators, which use more memory and are not faster
  - meta().lastUpdatedDateTime does not include the propagation time to the edge

### Work with key value data

- ID: `cloudfront-kvs-data`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - Pairs in an existing store are changed through the CloudFront KeyValueStore API, which is global and uses SigV4A
  - Write operations take the store's ETag as If-Match and return a new ETag
  - The ETags of the CloudFront API and the KeyValueStore API are not interchangeable
  - UpdateKeys is one all-or-nothing operation
  - Values are not changed during a function invocation; updates are processed between invocations

### Create a key value store

- ID: `cloudfront-kvs-create`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - A file of pairs can be imported only when the store is first created

### File format for key-value pairs

- ID: `cloudfront-kvs-file-format`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create-s3-kvp.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - Import file limits: 5 MB, 512-character keys, 1024-character values, no duplicate keys

### CloudFront KeyValueStore API: UpdateKeys

- ID: `cloudfront-kvs-api-updatekeys`
- URL: <https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - UpdateKeys requires If-Match and returns the new ETag, ItemCount, and TotalSizeInBytes
  - Listed errors: AccessDenied 403, Conflict 409, InternalServer 500, ResourceNotFound 404, ServiceQuotaExceeded 402, Validation 400
- Note: The page does not say which error a stale If-Match produces.

### CloudFront KeyValueStore API: ListKeys

- ID: `cloudfront-kvs-api-listkeys`
- URL: <https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_ListKeys.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - ListKeys returns at most 50 pairs per call (default 10) and a NextToken

### CloudFront quotas

- ID: `cloudfront-quotas`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - CloudFront Functions: 10 KB maximum function size (not adjustable), 2 MB maximum function memory, 100 functions per account
  - Key value stores: 512-byte key, 1 KB value, 5 MB per store, 50 keys or 3 MB per update request, one store per function, 100 functions per store, 200 stores per account
  - Lambda@Edge: 30-second function timeout, 50 MB compressed size, generated response up to 40 KB (viewer events) or 1 MB (origin events), 10,000 requests per second per Region

### Differences between CloudFront Functions and Lambda@Edge

- ID: `cloudfront-edge-functions-choosing`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - CloudFront Functions run on viewer request and viewer response only; Lambda@Edge also on origin request and origin response
  - CloudFront Functions: submillisecond duration, 2 MB memory, 10 KB code, no network, no file system, no request body
  - Lambda@Edge: Node.js and Python, up to 30 seconds, network and file system access, request body access, no KeyValueStore

### Restrictions on all edge functions

- ID: `cloudfront-edge-restrictions-all`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - One edge function per event type per cache behavior
  - CloudFront Functions and Lambda@Edge cannot be combined on viewer events; a CloudFront Function on a viewer event with Lambda@Edge on an origin event is allowed
  - Viewer response functions are not invoked when the origin returns 400 or higher

### Edge function logs

- ID: `cloudfront-edge-function-logs`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-logs.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - CloudFront Functions log only console.log() lines, always to us-east-1, in /aws/cloudfront/function/<FunctionName>
  - Lambda@Edge logs to /aws/lambda/us-east-1.<FunctionName> in the Region where the function ran
  - Edge function logs are delivered on a best-effort basis

### Restrictions on Lambda@Edge

- ID: `lambda-edge-restrictions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - The function must be in us-east-1 and must be referenced by a numbered version, not $LATEST or an alias
  - Not supported: environment variables (other than reserved ones), VPC access, layers, dead letter queues, X-Ray, provisioned concurrency, container images, arm64, more than 512 MB of ephemeral storage
  - With include body, the body is base64 encoded and truncated at 40 KB (viewer request) or 1 MB (origin request)
  - The execution role must be assumable by lambda.amazonaws.com and edgelambda.amazonaws.com

### Set up IAM permissions and roles for Lambda@Edge

- ID: `lambda-edge-permissions`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-permissions.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - Associating a function needs lambda:GetFunction, lambda:EnableReplication*, lambda:DisableReplication*, and iam:CreateServiceLinkedRole
  - The service-linked roles AWSServiceRoleForLambdaReplicator and AWSServiceRoleForCloudFrontLogger are created automatically

### Delete Lambda@Edge functions and replicas

- ID: `lambda-edge-delete-replicas`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - A Lambda@Edge function can be deleted only after CloudFront has deleted its replicas, typically within a few hours of removing the last association

### AWS News Blog: Introducing Amazon CloudFront KeyValueStore

- ID: `aws-blog-kvs-launch`
- URL: <https://aws.amazon.com/blogs/aws/introducing-amazon-cloudfront-keyvaluestore-a-low-latency-datastore-for-cloudfront-functions/>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - Updates to a store are described as propagating to all edge locations in a few seconds
- Note: A launch post, not a specification. The Developer Guide pages read for this chapter give no propagation time and no guarantee.

### Amazon CloudFront pay-as-you-go pricing

- ID: `cloudfront-pricing-payg`
- URL: <https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/>
- Checked: 2026-10-11
- Chapters: 03, 09, 10, 14
- Claims this source supports:
  - Always-free each month: 1 TB data transfer out, 10,000,000 HTTP/HTTPS requests, 2,000,000 CloudFront Function invocations, 2,000,000 KeyValueStore reads
  - First 1,000 invalidation paths per month are free, then USD 0.005 per path
  - Origin fetches from AWS origins such as S3 are free of data-transfer charges
  - KeyValueStore reads from functions cost USD 0.03 per million; other KeyValueStore API actions cost USD 1 per 1,000 requests
  - Lambda@Edge costs USD 0.60 per million requests and USD 0.00005001 per GB-second, metered per millisecond, with no free tier

### @aws-sdk/signature-v4a 3.1138.0 (npm registry metadata and package source)

- ID: `aws-sdk-signature-v4a`
- URL: <https://registry.npmjs.org/@aws-sdk/signature-v4a>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - Importing the package registers a JavaScript SigV4A signer that @aws-sdk/signature-v4-multi-region uses when no CRT signer is loaded
- Note: Read from the installed package and from @aws-sdk/signature-v4-multi-region 3.996.48. The AWS documentation example imports @aws-sdk/signature-v4-crt instead.

### Cloudflare Workers: Limits

- ID: `cloudflare-workers-limits`
- URL: <https://developers.cloudflare.com/workers/platform/limits/>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - CPU time per HTTP request: 10 ms on Workers Free, 30 seconds by default and up to 5 minutes on Workers Paid; waiting on fetch or KV does not count
  - 128 MB of memory per isolate; Worker size up to 64 MiB uncompressed
  - Subrequests per invocation: 50 on Free, 10,000 by default on Paid
  - No hard duration limit for HTTP-triggered Workers while the client stays connected

### Cloudflare Workers: Pricing

- ID: `cloudflare-workers-pricing`
- URL: <https://developers.cloudflare.com/workers/platform/pricing/>
- Checked: 2026-10-11
- Chapters: 10
- Claims this source supports:
  - Workers Free: 100,000 requests per day
  - Workers Standard: 10 million requests and 30 million CPU milliseconds included per month, then USD 0.30 per million requests and USD 0.02 per million CPU milliseconds

### Cloudflare Workers KV: How KV works

- ID: `cloudflare-kv-how-it-works`
- URL: <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - KV is eventually consistent: a change may take up to 60 seconds or more to be visible in other locations
  - Data is stored centrally and cached at locations after access

### Cloudflare Workers KV: Limits

- ID: `cloudflare-kv-limits`
- URL: <https://developers.cloudflare.com/kv/platform/limits/>
- Checked: 2026-10-11
- Chapters: 10, 14
- Claims this source supports:
  - Key size 512 bytes, value size 25 MiB, 1 write per second to the same key
  - A Worker can write to KV; Free allows 1,000 writes per day

### @go-to-k/cdkd 0.296.28 (npm tarball and tagged source)

- ID: `cdkd-npm`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-11
- Chapters: 02, 03, 04, 05, 06, 07, 08, 09, 10, 12, 14, 16, 17, 19, 20
- Claims this source supports:
  - Command list, flags, and exit codes used by tools/src/infra and tools/src/drift
  - `drift --json` output shape (StackDriftJson) and exit codes 0/1/2
  - `cdkd bootstrap` creates cdkd-state-{account}, cdkd-assets-{account}-{region}, and an ECR repository; it creates no IAM roles and no CDKToolkit stack
  - Without AWS_REGION cdkd uses us-east-1
  - A CloudFront distribution is waited for only with --full-wait
  - State is stored at s3://{bucket}/{prefix}/{stack}/{region}/state.json with an S3 conditional-write lock
  - AWS::CloudFront::Function is provisioned and read back through Cloud Control API, not a dedicated provider
  - A non-empty bucket without the CDK auto-delete tag makes destroy fail
  - AWS::CloudFront::KeyValueStore is in the list of stateful types, whose replacement needs --force-stateful-recreation
  - Asset publishing uses the stack's own region when the stack sets one (stack.region || base region)
  - `cdkd local start-cloudfront` serves a distribution locally with its viewer-request functions; --kvs-file backs cf.kvs().get() with a JSON file, and Lambda@Edge is skipped with a warning
- Note: Read from the published tarball, --help output, and the v0.296.28 source tag. No cdkd command was run against AWS.

### What is Amazon Aurora DSQL?

- ID: `dsql-what-is`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Aurora DSQL is available in Asia Pacific (Tokyo), ap-northeast-1
  - Serverless, with no instances to provision; data is replicated synchronously across three Availability Zones
  - Currently compatible with PostgreSQL version 16
  - ACID transactions with strong consistency and snapshot isolation
  - Multi-Region clusters must stay inside one Region set; Tokyo, Osaka, and Seoul are in the Asia Pacific set

### Migrating from PostgreSQL to Aurora DSQL

- ID: `dsql-pg-compat`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - The isolation level is fixed at PostgreSQL Repeatable Read
  - DDL and DML need separate transactions; a transaction holds one DDL statement; a transaction modifies at most 3,000 rows
  - Connections time out after 1 hour
  - One built-in database named postgres per cluster; UTF-8, C collation only, UTC
  - No temporary tables, no triggers, no PL/pgSQL (SQL functions only); DELETE FROM or DROP/CREATE instead of TRUNCATE; CREATE INDEX ASYNC instead of CREATE INDEX
  - Foreign keys are supported
  - Conflicts return a serialization error instead of waiting for a lock; AWS recommends idempotent transactions with retry, and random primary keys
  - Permissions are schema-level grants: admin manages objects in public, non-admin roles use user-created schemas

### Supported SQL for Aurora DSQL

- ID: `dsql-sql-features`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - BEGIN accepts ISOLATION LEVEL REPEATABLE READ and READ WRITE | READ ONLY
  - INSERT supports ON CONFLICT; SELECT supports FOR UPDATE and FOR KEY SHARE, joins, CTEs, and window functions
  - CREATE SCHEMA, CREATE VIEW, CREATE SEQUENCE, CREATE FUNCTION ... LANGUAGE SQL, and CREATE [UNIQUE] INDEX ASYNC are supported
  - The page says the list is not exhaustive

### DDL and distributed transactions in Aurora DSQL

- ID: `dsql-ddl`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - A transaction can contain only one DDL statement and cannot mix DDL and DML
  - A schema change updates the catalog version; a session holding an older cached catalog can receive SQLSTATE 40001 with OCC code OC001, and a retry typically succeeds

### Concurrency control in Aurora DSQL

- ID: `dsql-concurrency`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Optimistic concurrency control: conflicts are evaluated at commit time, without locks
  - A conflict is returned as SQLSTATE 40001; OC000 is a data conflict, OC001 a schema conflict
  - Of two transactions that modified the same row, the one that commits first succeeds
  - SELECT ... FOR UPDATE is adjudicated at commit as if the transaction wrote the rows
  - AWS recommends retrying, with idempotent transactions, and random primary keys to avoid contention on a few keys

### Cluster quotas and database limits in Amazon Aurora DSQL

- ID: `dsql-quotas`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - 3,000 rows mutated per transaction, 10 MiB of data modified per write transaction, 5 minutes maximum transaction time, 60 minutes maximum connection duration
  - 10,000 connections per cluster by default, 100 new connections per second with a burst of 1,000
  - 1 database per cluster, 10 schemas per database, 1,000 tables per database, 24 indexes per table, 2 MiB per row
  - 20 single-Region clusters per account per Region by default

### Aurora DSQL: CREATE TABLE

- ID: `dsql-create-table`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - CREATE TABLE supports IF NOT EXISTS, CHECK, DEFAULT, UNIQUE, PRIMARY KEY, REFERENCES / FOREIGN KEY with referential actions, and identity columns
  - CASCADE, SET NULL, and SET DEFAULT actions count toward the per-transaction row limit

### Aurora DSQL: ALTER TABLE

- ID: `dsql-alter-table`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - ADD COLUMN takes a column name and a data type; the supported syntax lists no constraint or default on that form
  - CHECK and FOREIGN KEY constraints added to an existing table must be NOT VALID and are validated with ALTER TABLE ASYNC ... VALIDATE CONSTRAINT
  - The listed actions include DROP NOT NULL but no SET NOT NULL and no change of a column's type

### Aurora DSQL: CREATE INDEX

- ID: `dsql-create-index`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-index-syntax-support.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Index creation is always asynchronous, so the ASYNC keyword must be specified
  - CREATE [UNIQUE] INDEX ASYNC supports IF NOT EXISTS, INCLUDE, and a WHERE predicate

### Asynchronous indexes in Aurora DSQL

- ID: `dsql-async-index`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - CREATE INDEX ASYNC returns a job_id immediately
  - sys.jobs has job_id, status (submitted, processing, failed, completed), and details
  - A failed build leaves the index INVALID until it is dropped; completed and failed jobs are removed from sys.jobs after 30 minutes
- Note: The page names sys.wait_for_job but shows no complete call, so the sample polls sys.jobs instead.

### Working with foreign key constraints in Aurora DSQL

- ID: `dsql-foreign-keys`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Foreign keys are checked against the transaction snapshot and again at commit; a violation by a concurrent transaction surfaces as a serialization error
  - Updating a non-key column of the referenced row does not conflict with an insert that references it
  - DML on referenced or referencing tables incurs extra reads

### Aurora DSQL: Working with sequences and identity columns

- ID: `dsql-sequences`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-working-with.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - UUIDs are the recommended default identifier type; sequences and identity columns exist for when integers are needed
  - CREATE SEQUENCE requires an explicit CACHE of 1 or at least 65536 (stated on the CREATE SEQUENCE page, which was read too)

### Primary keys in Aurora DSQL

- ID: `dsql-primary-keys`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-primary-keys.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - A primary key cannot be changed or added after the table is created
  - For tables with many writes, AWS advises against monotonically increasing integer keys and for randomly distributed ones

### Authentication and authorization for Aurora DSQL

- ID: `dsql-auth`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/authentication-authorization.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - dsql:DbConnectAdmin connects as the admin role; dsql:DbConnect connects as a custom database role
  - AWS IAM GRANT associates a database role with an IAM identity
  - After revoking the IAM permission, existing connections can stay authorized until they end

### Generating an authentication token in Amazon Aurora DSQL

- ID: `dsql-auth-token`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_authentication-token.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - The token is the password, used only when a connection is established; an open connection stays valid after the token expires
  - Tokens expire after 15 minutes by default, one week at most
  - Generating a token is a local signing operation that does not contact AWS
  - The cluster endpoint has the form <cluster id>.dsql.<region>.on.aws
  - The JavaScript signer is DsqlSigner in @aws-sdk/dsql-signer, with getDbConnectAuthToken and getDbConnectAdminAuthToken

### Aurora DSQL: Using database roles and IAM authentication

- ID: `dsql-db-roles`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - CREATE ROLE ... WITH LOGIN, then AWS IAM GRANT <role> TO '<IAM role ARN>', then GRANT USAGE ON SCHEMA and GRANT ... ON ALL TABLES IN SCHEMA
  - sys.iam_pg_role_mappings lists the mappings, with arn and pg_role_name columns

### Aurora DSQL Connectors for Node.js

- ID: `dsql-node-connectors`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - AWS publishes authentication plugins for node-postgres and for Postgres.js

### Aurora DSQL Connector for node-postgres

- ID: `dsql-node-postgres-connector`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - The connector wraps node-postgres's Client and Pool and generates a token for each connection
  - A user named admin gets an admin token, any other user a regular one
- Note: The sample does not use the connector; it passes the same signer to node-postgres directly, as the AWS Lambda sample does.

### Amazon Aurora DSQL cluster connectivity tools

- ID: `dsql-connectivity-tools`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/aws-sdks.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - AWS lists driver samples for node-postgres, node-postgres on AWS Lambda, and Postgres.js
  - AWS lists an adapter for Drizzle ORM and samples for Prisma, Sequelize, and TypeORM

### aws-samples/aurora-dsql-samples: Using AWS Lambda with Amazon Aurora DSQL

- ID: `dsql-lambda-sample`
- URL: <https://github.com/aws-samples/aurora-dsql-samples/blob/main/lambda/README.md>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - A Lambda function defined without a VPC connects with node-postgres, passing a function that calls DsqlSigner as the pool's password
  - The pool is kept in a module-level variable and shared between invocations
  - The sample builds the endpoint as <identifier>.dsql.<region>.on.aws and says an admin database role is not good practice for production

### Aurora DSQL cluster lifecycle

- ID: `dsql-cluster-lifecycle`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/cluster-lifecycle.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - A cluster without connection activity becomes Idle and then Inactive, where running resources are scaled to zero and data is kept
  - Connecting wakes it; the first connection to an Idle or Inactive cluster is slower
  - A backup needs an Active cluster

### Backup and restore for Amazon Aurora DSQL

- ID: `dsql-backup`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Backups go through AWS Backup: full cluster backups, on demand or on a schedule with retention
  - A restore always creates a new cluster
- Note: The page does not describe point-in-time recovery for Aurora DSQL.

### How billing works in Aurora DSQL

- ID: `dsql-billing`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Activity is metered in DPUs (compute, read, and write components) and storage in GB-month
  - Worked examples: a point lookup of 0.00675 DPU and a single-row insert of 0.06175 DPU
- Note: The examples' DPU figures are used as stand-ins in the chapter's cost scenario. Nothing was measured.

### Amazon Aurora DSQL pricing

- ID: `dsql-pricing`
- URL: <https://aws.amazon.com/rds/aurora/dsql/pricing/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Billed for DPUs and for storage in GB-month; an idle cluster incurs no DPU charges
  - Each month the first 100,000 DPUs and 1 GB of storage are free
  - Backups are billed through AWS Backup
- Note: The page shows prices through a script; the numbers in the book come from the Price List. The page does not say whether the free tier ends.

### Managing and connecting to Amazon Aurora DSQL clusters using AWS PrivateLink

- ID: `dsql-privatelink`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/privatelink-managing-clusters.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - The default cluster host name is a public DNS name; interface VPC endpoints are an option for private connectivity
  - Connecting through an endpoint's own DNS name or IP address does not support verify-full

### Troubleshooting issues in Aurora DSQL

- ID: `dsql-troubleshooting`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/troubleshooting.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - After an error during COMMIT the transaction might have committed; AWS says to design transactions to be idempotent
  - 'Wrong user to action mapping' means the token type does not match the database role
  - A connection is rejected when the assumed role's credentials have expired, even if the token has not

### Considerations for working with Amazon Aurora DSQL

- ID: `dsql-considerations`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/considerations.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - GRANT and REVOKE changes reach existing connections within the connection lifetime; a new connection sees them at once
  - A connection should be refreshed to see schemas and tables created in another connection

### Release notes for Aurora DSQL

- ID: `dsql-release-notes`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/release-notes.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Foreign key constraints were added on August 26, 2026
  - Identity columns and sequences were added on February 13, 2026; partial indexes on September 15, 2026

### Configuring SSL/TLS certificates for Aurora DSQL connections

- ID: `dsql-tls`
- URL: <https://docs.aws.amazon.com/aurora-dsql/latest/userguide/configure-root-certificates.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - The server certificate chains to Amazon Root CA 1; AWS recommends verify-full for production

### AWS::DSQL::Cluster

- ID: `cfn-dsql-cluster`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Properties: DeletionProtectionEnabled, KmsEncryptionKey, MultiRegionProperties, PolicyDocument, Tags; none is required
  - Ref returns the cluster identifier

### cdkd v0.296.28: src/provisioning/register-providers.ts

- ID: `cdkd-register-providers`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts>
- Checked: 2026-10-11
- Chapters: 10, 12, 13
- Claims this source supports:
  - No dedicated provider is registered for AWS::DSQL::Cluster, so it is handled through Cloud Control API
  - Dedicated providers are registered for the other types the chapter 13 stack uses
- Note: src/provisioning/cc-protection-properties.ts at the same tag lists AWS::DSQL::Cluster with DeletionProtectionEnabled among Cloud-Control-routed types.

### aws-cdk-lib 2.273.0: aws-dsql module (type definitions)

- ID: `aws-cdk-lib-aws-dsql`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - aws-cdk-lib/aws-dsql exports the generated CfnCluster (L1) and no higher-level construct
  - CfnCluster has deletionProtectionEnabled and exposes attrIdentifier, attrEndpoint, and attrResourceArn

### AWS Price List: Aurora DSQL, ap-northeast-1

- ID: `aws-price-list-dsql`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AuroraDSQL/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - USD 0.00001 per DPU and USD 0.40 per GB-month of storage in Tokyo
  - Global SKUs priced at zero for the first 100,000 DPUs and the first GB-month

### AWS Price List: Amazon RDS and Aurora, ap-northeast-1

- ID: `aws-price-list-rds`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - db.t4g.micro PostgreSQL Single-AZ: USD 0.025 per hour; gp3 storage for PostgreSQL Single-AZ: USD 0.138 per GB-month
  - Aurora PostgreSQL Serverless v2: USD 0.15 per ACU-hour; Aurora PostgreSQL storage: USD 0.12 per GB-month

### Scaling to Zero ACUs with automatic pause and resume for Aurora serverless

- ID: `aurora-auto-pause`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Auto-pause is a minimum capacity of 0 ACUs; before it existed the lowest minimum was 0.5 ACUs
  - An instance pauses after 300 to 86,400 seconds without user connections (default 300)
  - A paused instance has no instance charge; storage is still charged
  - Resuming takes about 15 seconds, and 30 seconds or longer after more than 24 hours paused
  - An open user connection, an associated RDS Proxy, logical replication, or a zero-ETL integration keeps instances from pausing
  - Aurora PostgreSQL needs 16.3, 15.7, 14.12, 13.15 or higher

### How Aurora serverless works

- ID: `aurora-serverless-v2-how`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Capacity ranges from 0 to 256 ACUs; one ACU is about 2 GiB of memory with matching CPU and networking

### Using the Amazon RDS Data API

- ID: `aurora-data-api`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Data API is an HTTP endpoint for an Aurora cluster that lets a Lambda function run SQL without being configured for a VPC
  - It uses database credentials stored in AWS Secrets Manager
- Note: Region and engine-version availability was not checked.

### Overview of backing up and restoring an Aurora DB cluster

- ID: `aurora-backups`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Aurora automated backups are continuous, with a retention period of 1 to 35 days, and cannot be disabled

### Working with a DB instance in a VPC

- ID: `rds-vpc`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html>
- Checked: 2026-10-11
- Chapters: 11, 13
- Claims this source supports:
  - An RDS DB instance is in a VPC and needs a DB subnet group

### Amazon RDS DB instance storage

- ID: `rds-storage`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - General Purpose gp3 storage for PostgreSQL starts at 20 GiB

### IAM database authentication for MariaDB, MySQL, and PostgreSQL

- ID: `rds-iam-auth`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - RDS offers IAM database authentication with 15-minute tokens as an option next to standard passwords

### Amazon RDS Proxy

- ID: `rds-proxy`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - RDS Proxy pools and shares database connections for applications that open many of them

### Restoring a DB instance to a specified time for Amazon RDS

- ID: `rds-pitr`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Point-in-time restore creates a new DB instance within the backup retention period

### PostgreSQL 16: Transaction Isolation

- ID: `postgres-transaction-iso`
- URL: <https://www.postgresql.org/docs/16/transaction-iso.html>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Read Committed is the default isolation level in PostgreSQL
  - Repeatable Read is implemented as snapshot isolation and raises 'could not serialize access due to concurrent update'; the application should retry the whole transaction

### pg 8.23.1 and @types/pg 8.23.1

- ID: `node-postgres-npm`
- URL: <https://www.npmjs.com/package/pg/v/8.23.1>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Pool accepts a function returning a promise as password, and maxLifetimeSeconds (read in the pinned type definitions)
  - pg 8.23.1 was the latest version on the npm registry

### @aws-sdk/dsql-signer 3.1149.0

- ID: `dsql-signer-npm`
- URL: <https://www.npmjs.com/package/@aws-sdk/dsql-signer/v/3.1149.0>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - DsqlSigner takes hostname, region, and optional credentials and expiresIn (read in the pinned type definitions)

### @electric-sql/pglite 0.5.8

- ID: `pglite-npm`
- URL: <https://www.npmjs.com/package/@electric-sql/pglite/v/0.5.8>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - 0.5.8 was the latest version on the npm registry and declares no dependencies
  - Run locally, it reports PostgreSQL 18.3 and lets a second process open the same data directory (observed, not documented)
- Note: Only the registry metadata was read and the package was run; its documentation was not.

### Cloudflare D1: Migrations

- ID: `cloudflare-d1-migrations`
- URL: <https://developers.cloudflare.com/d1/reference/migrations/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Migrations are numbered .sql files in a migrations folder, applied in order by Wrangler
  - Applied migrations are recorded in the d1_migrations table

### Cloudflare D1: Global read replication

- ID: `cloudflare-d1-read-replication`
- URL: <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - Read replicas are asynchronously replicated and can be arbitrarily out of date; all writes go to the primary
  - Read replication is used only through the Sessions API, which provides sequential consistency within a session by passing bookmarks
  - withSession('first-primary') routes the first query to the primary

### Cloudflare D1: D1 Database (Workers Binding API)

- ID: `cloudflare-d1-database-api`
- URL: <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - batch() runs its statements as one SQL transaction and rolls the whole sequence back if one fails

### Cloudflare D1: SQL statements

- ID: `cloudflare-d1-sql-statements`
- URL: <https://developers.cloudflare.com/d1/sql-api/sql-statements/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - D1 uses SQLite's query engine and is compatible with most of SQLite's SQL

### Cloudflare D1: Pricing

- ID: `cloudflare-d1-pricing`
- URL: <https://developers.cloudflare.com/d1/platform/pricing/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - D1 bills rows read, rows written, and storage, with no charge for hours or capacity when no queries run

### Cloudflare Wrangler: d1 commands

- ID: `cloudflare-wrangler-d1`
- URL: <https://developers.cloudflare.com/workers/wrangler/commands/d1/>
- Checked: 2026-10-11
- Chapters: 13
- Claims this source supports:
  - `wrangler d1 migrations apply` takes --local or --remote
  - If applying a migration results in an error, that migration is rolled back

### Download and upload objects with presigned URLs

- ID: `s3-presigned-url`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - A presigned URL uses the credentials of the principal who generated it, and its capabilities are limited by that principal's permissions
  - Presigned URLs are bearer tokens that grant access to those who possess them, and can be used multiple times until they expire
  - A presigned URL made with temporary credentials expires when those credentials expire, even if a later expiration was requested
  - With the AWS CLI or SDKs the expiration can be set as high as 7 days
  - S3 checks the expiration at the time of the HTTP request
  - A bucket policy can deny presigned requests by signature age with the s3:signatureAge condition key
- Note: The page gives typical credential lifetimes for EC2 instance profiles, ECS tasks, and STS AssumeRole. It gives none for a Lambda execution role.

### Uploading objects with presigned URLs

- ID: `s3-presigned-upload`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - An upload to a key that already exists replaces the existing object
  - The content type in the upload request must match the one given when the presigned PUT URL was generated

### POST Policy

- ID: `s3-post-policy`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - A POST policy holds an expiration and a list of conditions the request must meet
  - content-length-range sets the minimum and maximum allowable size of the uploaded content
  - Conditions support exact matching and starts-with matching on fields such as key and Content-Type
  - Each form field except x-amz-signature, file, policy, and x-ignore- fields must appear in the list of conditions
- Note: On 2026-10-11 the older path /AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html redirected to the API reference index; the page was read at the /developerguide/ path. Its conditions table does not list the tagging field by name.

### POST Object

- ID: `s3-post-object`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - The file must be the last field in the form
  - POST Object has a tagging form field that takes an XML tag set
  - success_action_status defaults to 204
  - A request without a policy is anonymous and works only on publicly writable buckets
- Note: Read at the /developerguide/ path, as the /API/ path redirected to the index on 2026-10-11.

### Authenticating Requests: Using Query Parameters (AWS Signature Version 4)

- ID: `s3-sigv4-query-auth`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - X-Amz-Expires is between 1 and 604800 seconds
  - The host header and any x-amz-* headers must be signed, and signing every header you plan to send is recommended
  - A presigned URL made with STS credentials carries X-Amz-Security-Token
- Note: The page does not state a rule for content-length specifically. That a signed Content-Length pins the size of a presigned PUT was not confirmed.

### How to prevent object overwrites with conditional writes

- ID: `s3-conditional-writes`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html>
- Checked: 2026-10-11
- Chapters: 07, 24
- Claims this source supports:
  - If-None-Match prevents overwriting an existing key
  - If-None-Match can be used with PutObject, CompleteMultipartUpload, and CopyObject; POST Object is not in the list

### HeadObject

- ID: `s3-head-object`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - For a key that does not exist, S3 returns 404 if the caller has s3:ListBucket on the bucket and 403 if it does not

### Expiring objects

- ID: `s3-lifecycle-expiration`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html>
- Checked: 2026-10-11
- Chapters: 07, 08
- Claims this source supports:
  - In a nonversioned bucket, S3 queues an expired object for removal and removes it asynchronously
  - Tag-based filters are evaluated daily, and the object's current tags are re-evaluated when the action executes; if the tag is gone, the expiration does not proceed
  - There may be a delay between the expiration date and the removal, and expired objects are not charged for storage
  - A bucket policy cannot prevent deletions by a lifecycle rule

### Configuring a bucket lifecycle configuration to delete incomplete multipart uploads

- ID: `s3-lifecycle-abort-mpu`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html>
- Checked: 2026-10-11
- Chapters: 07, 24
- Claims this source supports:
  - AWS recommends a lifecycle rule with AbortIncompleteMultipartUpload to minimize storage costs
  - The rule aborts multipart uploads not completed within the given number of days and deletes their parts; it deletes no objects

### Tagging your objects

- ID: `s3-object-tagging`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html>
- Checked: 2026-10-11
- Chapters: 07, 08
- Claims this source supports:
  - Tags can be set in a POST Object request
  - Lifecycle rules can filter on object tags
  - DELETE Object tagging removes the tag set without a request charge, where PUT Object tagging is billed as a Tier 1 request

### Using cross-origin resource sharing (CORS)

- ID: `s3-cors`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - S3 uses the first CORS rule whose origin, method, and requested headers match the request
  - ACLs and policies continue to apply when CORS is enabled

### Elements of a CORS configuration

- ID: `s3-cors-elements`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - AllowedMethods accepts GET, PUT, POST, DELETE, and HEAD
  - AllowedOrigins lists the origins allowed to make cross-origin requests

### Blocking public access to your Amazon S3 storage

- ID: `s3-block-public-access`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - The four settings BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, and RestrictPublicBuckets

### What is Amazon S3? (Strong consistency)

- ID: `s3-consistency`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html>
- Checked: 2026-10-11
- Chapters: 07, 08, 24
- Claims this source supports:
  - S3 provides strong read-after-write consistency for PUT and DELETE of objects, and reads of object tags and metadata such as HEAD are strongly consistent
- Note: The sentence names PUT and DELETE. It does not name POST Object.

### @aws-sdk/s3-presigned-post 3.1149.0 (type definitions and source)

- ID: `aws-sdk-s3-presigned-post-npm`
- URL: <https://www.npmjs.com/package/@aws-sdk/s3-presigned-post/v/3.1149.0>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - createPresignedPost signs locally and sends no request
  - Each entry in Fields becomes an exact-match condition, and Conditions accepts content-length-range
  - The session token of temporary credentials is added as the X-Amz-Security-Token field

### AWS Price List bulk API: Data Transfer, ap-northeast-1

- ID: `aws-price-list-data-transfer`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 07, 12
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AWSDataTransfer
  - Data transfer in from the internet is USD 0.000 per GB in ap-northeast-1
- Note: The first tier is described as "beyond the global free tier". The size of that free tier was not confirmed.

### Cloudflare R2: Presigned URLs

- ID: `cloudflare-r2-presigned-urls`
- URL: <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- Checked: 2026-10-11
- Chapters: 07
- Claims this source supports:
  - R2 presigned URLs support GET, HEAD, PUT, and DELETE; POST form uploads are not currently supported
  - R2 presigned URLs work on the S3 API domain and cannot be used with custom domains
  - R2's documentation also calls presigned URLs bearer tokens

### Working with Lambda environment variables

- ID: `lambda-runtime-env-vars`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html>
- Checked: 2026-10-11
- Chapters: 07, 14
- Claims this source supports:
  - Lambda sets AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN to the access keys obtained from the function's execution role
- Note: The page does not say how long these credentials stay valid.

### nuxt 4.6.1 (npm registry metadata and tarball)

- ID: `nuxt-npm`
- URL: <https://www.npmjs.com/package/nuxt/v/4.6.1>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - 4.6.1 was the `latest` dist-tag on 2026-10-11
  - Its server builder @nuxt/nitro-server 4.6.1 depends on nitropack ^2.13.4 (Nitro 2, not the nitro 3 beta)
  - engines.node is ^22.22.3 || ^24.15.0 || >=26.0.0
  - `nuxt build` with the aws-lambda preset writes .output/server (handler and traced node_modules), .output/public/_nuxt, and .output/nitro.json
- Note: The last item was observed by building examples/09-ssr. That Nuxt renders a page into one string before the handler writes it is an observation of the built handler (one write per page), not a documented guarantee.

### nitropack 2.13.4 (npm tarball: dist/presets/aws-lambda)

- ID: `nitropack-npm`
- URL: <https://www.npmjs.com/package/nitropack/v/2.13.4>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - The preset is named `aws-lambda`; its only option is `awsLambda.streaming` (boolean, default false)
  - With streaming false the entry exports `handler(event, context)` returning { statusCode, headers, cookies, body, isBase64Encoded }
  - With streaming true the entry is `awslambda.streamifyResponse(...)`, writes metadata through `awslambda.HttpResponseStream.from`, and adds `Transfer-Encoding: chunked`
  - Both entries rebuild the Cookie header from the event's `cookies` array and decode a base64 request body as UTF-8 text
  - .output/nitro.json records the preset and `config.awsLambda.streaming`
- Note: Read from the installed package, dist/presets/aws-lambda/preset.mjs, types.d.ts, and runtime/aws-lambda{,-streaming}.mjs. The Nitro documentation site was not used as the basis.

### @vizejs/nuxt 0.443.0 (npm tarball and local build)

- ID: `vize-nuxt-npm`
- URL: <https://www.npmjs.com/package/@vizejs/nuxt/v/0.443.0>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - `@vizejs/nuxt` is a Nuxt module with the config key `vize`; its peer range for nuxt is ^2.16.0 || ^3.0.0 || ^4.0.0
  - With the module listed in `modules`, Nuxt 4.6.1 `nuxt dev` and `nuxt build` compiled the .vue files of examples/09-ssr
  - `vize check` and `vize lint` ran on the Nuxt app directory with explicit imports from `nuxt/app`
- Note: The package depends on @nuxt/kit 3.11.2, whose c12 reports an unmet peer (magicast ^0.3.4, found 0.5.5) at install. The build and dev server worked regardless. Auto-imported composables were not used, so type checking them through Vize is unverified. `vize check` reported no error for the globally registered NuxtLink and NuxtPage components; whether it type-checks their props was not examined.

### Restrict access to an AWS Lambda function URL origin

- ID: `cloudfront-oac-lambda`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - To use OAC the function URL's AuthType must be AWS_IAM
  - CloudFront needs lambda:InvokeFunctionUrl and lambda:InvokeFunction, granted to cloudfront.amazonaws.com with the distribution as source ARN
  - For PUT or POST, the viewer must send the SHA256 of the body in x-amz-content-sha256; Lambda does not support unsigned payloads
  - With signing behavior `always`, CloudFront signs every origin request; `no-override` passes a viewer Authorization header through instead

### Invoking Lambda function URLs

- ID: `lambda-urls-invocation`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - Function URL events and responses follow API Gateway payload format version 2.0
  - Request cookies arrive in a `cookies` array; response cookies are returned in a `cookies` array

### Invoking a response streaming enabled function using Lambda function URLs

- ID: `lambda-furl-invoke-mode`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - InvokeMode BUFFERED is the default, uses the Invoke API, and has a 6 MB maximum payload
  - InvokeMode RESPONSE_STREAM uses InvokeWithResponseStream and has a 200 MB maximum response payload
- Note: The page does not describe what a client receives when the invoke mode and the handler type disagree.

### Select a method to invoke your Lambda function using an HTTP request

- ID: `lambda-furl-vs-apigw`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - Function URLs have no charge beyond Lambda's own; authentication is IAM or none
  - API Gateway adds authorizers, throttling, request validation, custom domain names, and WAF integration
  - A function URL answers HTTP 429 once the function's concurrency limit is reached

### Manage how long content stays in the cache (expiration)

- ID: `cloudfront-expiration`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - With minimum TTL 0, CloudFront respects Cache-Control: no-cache, no-store, and private from the origin
  - With minimum TTL above 0, CloudFront caches for the minimum TTL even when those directives are present
  - With both max-age and s-maxage, CloudFront uses the lesser of s-maxage and the maximum TTL; browsers use max-age
  - Without Cache-Control, CloudFront caches for the default TTL
  - CloudFront supports stale-while-revalidate and stale-if-error, bounded by the maximum TTL

### Understand cache policies

- ID: `cloudfront-cache-policy`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - Values in the cache key are automatically included in origin requests
  - Cookies set to None are not in the cache key and not automatically sent to the origin
  - Minimum, maximum, and default TTL all 0 disables caching

### Cache content based on cookies

- ID: `cloudfront-cookies`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Cookies.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - By default CloudFront ignores cookies and removes them before forwarding a request to the origin
  - When cookies are forwarded, CloudFront caches Set-Cookie with the object and sends it on every cache hit
  - With cookies not forwarded, CloudFront removes Set-Cookie from responses before returning them
- Note: The page is written in terms of the legacy forwarding settings. Whether Set-Cookie is removed under a cache policy with cookies set to None was not confirmed, which is why the stack also removes it with a response headers policy.

### Understand response headers policies

- ID: `cloudfront-response-headers-policy`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - Removed headers are removed from every response sent to viewers, whether served from the cache or from the origin
  - Set-Cookie is not in the list of headers that cannot be removed

### Serve compressed files

- ID: `cloudfront-compression`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - CloudFront compresses only when the origin response has a Content-Length header, between 1,000 and 10,000,000 bytes
  - A response with Content-Encoding is passed through uncompressed-by-CloudFront
  - Compression needs Gzip or Brotli enabled in the cache policy

### How CloudFront processes HTTP 4xx and 5xx status codes from your origin

- ID: `cloudfront-error-caching`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - CloudFront caches 404, 414, and 5xx responses for the error caching minimum TTL, 10 seconds by default
  - With the CachingDisabled managed policy, those status codes are not cached
  - CloudFront caches responses to GET and HEAD, optionally OPTIONS, and no other method
- Note: How a `no-store` on a 404 interacts with the 10-second error caching minimum TTL is not stated plainly on the page.

### Origin settings

- ID: `cloudfront-origin-settings`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - The default origin response timeout is 30 seconds

### Working with Lambda environment variables

- ID: `lambda-envvars`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - AWS_LAMBDA_FUNCTION_NAME is a defined runtime environment variable holding the function's name

### MDN: Set-Cookie header

- ID: `mdn-set-cookie`
- URL: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - HttpOnly forbids JavaScript from accessing the cookie
  - SameSite=Lax sends the cookie on same-site requests and on a limited set of cross-site navigations
  - A __Host- cookie must be Secure, set from HTTPS, have no Domain, and have Path=/

### Cloudflare Workers: Nuxt

- ID: `cloudflare-workers-nuxt`
- URL: <https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - `wrangler deploy` detects Nuxt and generates a configuration with main .output/server/index.mjs, assets directory .output/public, and the nodejs_compat flag
  - Nuxt applications reach Cloudflare products through bindings, in local development and in production
- Note: How Workers static assets are cached and billed was not read for this chapter.

### AWS Lambda pricing

- ID: `lambda-pricing`
- URL: <https://aws.amazon.com/lambda/pricing/>
- Checked: 2026-10-11
- Chapters: 04, 08, 09, 14, 16, 17
- Claims this source supports:
  - Free tier: 1,000,000 requests and 400,000 GB-seconds per month
  - Response streaming: first 6 MB per request free, then per GB
  - Response streaming is USD 0.008 per GB streamed, with 100 GB per month in the free tier
- Note: The page does not say whether the free tier expires. It lists no separate charge for function URLs.

### aws-cdk-lib 2.273.0 (installed package and synthesized template)

- ID: `aws-cdk-lib-npm`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-11
- Chapters: 09
- Claims this source supports:
  - `FunctionUrlOrigin.withOriginAccessControl` synthesizes an OAC of origin type lambda and two AWS::Lambda::Permission resources: lambda:InvokeFunctionUrl, and lambda:InvokeFunction with InvokedViaFunctionUrl true, both limited to the distribution's ARN
  - `ResponseHeadersPolicy` accepts `removeHeaders`
  - `CachePolicy.CACHING_DISABLED` is 4135ea2d-6df8-44a3-9df3-4b5a84be39ad and `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` is b689b0a8-53d0-40ab-baf2-68738e2966ac
- Note: Read from the type definitions and from cdk.out/AihSsr.template.json produced by `vp run ssr:infra:synth`.

### X-Ray SDK and Daemon Support timeline

- ID: `xray-sdk-timeline`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - The X-Ray SDKs and daemon entered maintenance mode on February 25th, 2026: releases are limited to security issues, with no new features
  - The page lists no end date for maintenance mode
  - AWS recommends migrating to OpenTelemetry for instrumenting applications and sending traces to AWS X-Ray
- Note: The page is about the SDKs and the daemon. It says nothing about the X-Ray service ending; traces are still sent to X-Ray.

### Migrating from X-Ray instrumentation to OpenTelemetry instrumentation

- ID: `xray-otel-migration`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - For Lambda, the options are an auto-instrumentation layer (recommended: AWS Lambda Layer for OpenTelemetry; also the AWS managed Lambda layer for ADOT) or a manual setup with a simple span processor, an X-Ray UDP span exporter and an X-Ray Lambda propagator
  - To use only tracing with the AWS Lambda Layer for OpenTelemetry, set OTEL_AWS_APPLICATION_SIGNALS_ENABLED=false
  - When sent to X-Ray, server spans become segments, other spans become subsegments, and attributes become metadata by default

### Migrate to OpenTelemetry Node.js

- ID: `xray-otel-migration-nodejs`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/migrate-xray-to-opentelemetry-nodejs.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Manual spans in a Lambda function that has the layer are created with @opentelemetry/api, whose version is recommended to match the one the ADOT JavaScript SDK uses

### AWS Distro for OpenTelemetry: Lambda

- ID: `adot-lambda`
- URL: <https://aws-otel.github.io/docs/getting-started/lambda>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - The layer is enabled with AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument, and its ARN is listed per Region and language
  - On 2026-10-12 the Node.js ARN for ap-northeast-1 was arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
  - Supported Node.js runtimes listed: 18.x, 20.x, 22.x. Node.js 24.x is not in the list
  - By default only the AWS SDK and HTTP instrumentations are enabled; sampling is parent-based and adjustable with OTEL_TRACES_SAMPLER
  - Traces are exported through the Lambda embedded agent to X-Ray by default; the older layers that bundle a collector are marked not recommended
  - The documented CDK setup attaches the managed policy CloudWatchLambdaApplicationSignalsExecutionRolePolicy
- Note: The ARN and runtime tables are rendered by script. They were read from the page's source, src/config/lambdaLayerArns.js and src/config/supportedRuntimes.js in github.com/aws-otel/aws-otel.github.io (main).

### Enable your applications on Lambda (Application Signals)

- ID: `appsignals-lambda`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - The AWS Lambda Layer for OpenTelemetry is also a component of Lambda OpenTelemetry support and provides tracing
  - Manual steps: add the layer, set AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument, attach CloudWatchLambdaApplicationSignalsExecutionRolePolicy, and optionally enable Lambda active tracing
- Note: CloudWatch-Application-Signals-Enable-Lambda.html redirects here.

### Visualize Lambda function invocations using AWS X-Ray

- ID: `lambda-xray`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - With Active tracing Lambda records two segments per trace for sampled requests; PassThrough only forwards the tracing header
  - The sampling rate is 1 request per second and 5 percent of additional requests, and it cannot be configured for functions
  - The execution role needs xray:PutTraceSegments and xray:PutTelemetryRecords
  - An upstream service's tracing header decides whether Lambda sends a trace

### Instrumenting Node.js code in AWS Lambda

- ID: `lambda-nodejs-tracing`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/nodejs-tracing.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Lambda's Node.js guide offers ADOT layers or the X-Ray SDK for Node.js to send trace data to X-Ray

### Log and monitor Node.js Lambda functions

- ID: `lambda-nodejs-logging`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - In the text format the Node.js runtime adds a timestamp, the request ID and a log level in front of each line the function logs
  - With the JSON log format Lambda doesn't double-encode logs that are already JSON encoded
  - Code that emits embedded metric format with console.log should write to process.stdout instead when the log format is JSON
  - Log-level filtering needs a level and an RFC 3339 timestamp in the JSON; without a valid timestamp Lambda assigns INFO

### Configuring JSON and plain text log formats

- ID: `lambda-log-format`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - The default log format for all Lambda runtimes is plain text
  - The log format applies to both system logs and application logs, and JSON formatting can increase the size of log messages

### Types of metrics for Lambda functions

- ID: `lambda-metrics`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Errors counts invocations that end in a function error: exceptions the code throws and those the runtime throws, such as timeouts
  - Throttled requests count as neither Invocations nor Errors
  - Duration supports percentile statistics and does not include cold start time
  - ConcurrentExecutions is read with the Max statistic

### Monitor CloudWatch metrics for HTTP APIs in API Gateway

- ID: `apigw-http-metrics`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - HTTP API metrics: 4xx, 5xx, Count, IntegrationLatency, Latency, DataProcessed, sent in one-minute periods
  - Latency runs from receiving the request to returning the response; IntegrationLatency is the backend part
  - Route-level metrics need detailed metrics to be enabled

### Configure logging for HTTP APIs in API Gateway

- ID: `apigw-http-logging`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - An HTTP API stage can write access logs to a CloudWatch Logs group in a format built from $context variables

### DynamoDB metrics and dimensions

- ID: `dynamodb-metrics`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - ThrottledRequests, SystemErrors, SuccessfulRequestLatency and ConditionalCheckFailedRequests exist as table metrics
  - SystemErrors counts requests that generate an HTTP 500

### Configuring how CloudWatch alarms treat missing data

- ID: `cloudwatch-alarm-missing-data`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Missing data points can be treated as notBreaching, breaching, ignore or missing; the default is missing
  - For a metric that reports only when an error occurs, notBreaching is the suggested treatment
  - When points are missing, CloudWatch evaluates over a wider evaluation range than the evaluation periods

### Alarm evaluation

- ID: `cloudwatch-alarm-evaluation`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Datapoints to Alarm (M) out of Evaluation Periods (N): the breaching points need not be consecutive

### Using math expressions with CloudWatch metrics

- ID: `cloudwatch-metric-math`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/using-metric-math.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - IF(condition, trueValue, falseValue) with a time series compared to a scalar; the result is 0 when the chosen metric has no data point at that time
  - FILL in an alarm can leave the alarm stuck when the latest minute never has data; an M out of N alarm is the suggested workaround

### Notifying users on alarm changes

- ID: `cloudwatch-alarm-sns`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - An email subscription to the SNS topic stays pending until the recipient confirms it

### CloudWatch Logs Insights language query syntax

- ID: `logs-insights-syntax`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Commands are separated by the pipe character; fields, filter, stats, sort and limit are commands
  - Queries are charged by data scanned: select only the needed log groups and the narrowest time range

### Logs Insights: filter

- ID: `logs-insights-filter`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Filter.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Conditions are combined with and / or; string values are written in double quotes, as in filter requestId = "1234656"
  - Field indexes speed up equality filters; filters with like do not use them

### Logs Insights: stats

- ID: `logs-insights-stats`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Stats.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - stats count(*) by field groups and counts, and an alias is given with as

### Supported logs and discovered fields

- ID: `logs-insights-fields`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - For Lambda logs, fields are discovered automatically only for the first embedded JSON fragment in each log event
  - Lambda logs get @requestId, @duration, @billedDuration, @maxMemoryUsed, and @xrayTraceId when the line has a trace ID
  - Field discovery is supported only in the Standard log class

### Creating metrics from log events using filters

- ID: `logs-metric-filters`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Metric filters are not retroactive: they publish data points only for events after the filter was created
  - The default value is reported for periods in which logs are ingested and nothing matches; with no logs at all, nothing is reported
  - A filter with dimensions cannot have a default value, and each distinct dimension value creates another metric
  - Delivery to the metric is at least once; duplicates may occasionally occur

### Filter pattern syntax for metric filters

- ID: `logs-filter-pattern-syntax`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - JSON patterns are written in braces with $. property selectors, and combined with && and ||, as in { ($.user.id = 1) && ($.users[0].email = "John.Doe@example.com") }

### Embedding metrics within logs

- ID: `cloudwatch-emf`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Embedded metric format needs logs:PutLogEvents and not cloudwatch:PutMetricData; charges are log ingestion and storage plus the custom metrics generated
  - A high-cardinality dimension such as requestId creates one custom metric per distinct value
  - Delivery is at least once; duplicate metric values may occasionally occur

### Embedded metric format specification

- ID: `cloudwatch-emf-spec`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - The log event must be a valid JSON object with no additional data at the beginning or end
  - At most 100 metric definitions per event and 30 dimension keys per dimension set

### Working with log groups and log streams

- ID: `logs-retention`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - By default log data is stored indefinitely; retention is set per log group
  - Expired log events are not deleted immediately; it can take up to 72 hours

### AWS X-Ray concepts

- ID: `xray-concepts`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Trace data is retained for 30 days
  - The tracing header is X-Amzn-Trace-Id, with Root, Parent and Sampled fields
  - By default the first request each second and five percent of additional requests are recorded

### Sending trace data to AWS X-Ray

- ID: `xray-sending-trace-ids`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-api-sendingdata.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - X-Ray accepts trace IDs that follow the W3C Trace Context specification, written in X-Ray's format: 4efaaf4d1e8720b39541901950019ee5 becomes 1-4efaaf4d-1e8720b39541901950019ee5

### Configuring sampling rules

- ID: `xray-sampling-rules`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-console-sampling.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - X-Ray sampling is parent-based: the decision is made once by the first service, and downstream services honor it regardless of their own rules
  - The default is a reservoir of one request per second plus five percent of the rest

### Amazon SQS and AWS X-Ray

- ID: `xray-sqs`
- URL: <https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - SQS carries the trace header in the AWSTraceHeader message system attribute, which does not count against message size or attribute quotas
  - With a Lambda consumer, trace context propagation is automatic

### OTLP Endpoints

- ID: `cloudwatch-otlp-endpoints`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Traces can be sent over OTLP/HTTP to https://xray.<region>.amazonaws.com/v1/traces with Signature Version 4

### Transaction Search

- ID: `cloudwatch-transaction-search`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Transaction-Search.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - With Transaction Search enabled, spans sent to X-Ray are ingested as logs in the aws/spans log group

### W3C Trace Context

- ID: `w3c-trace-context`
- URL: <https://www.w3.org/TR/trace-context/>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - traceparent is version-traceid-parentid-flags: 2, 32, 16 and 2 lowercase hex characters
  - Version ff is invalid, and an all-zero trace-id or parent-id is forbidden
  - The lowest bit of trace-flags is the sampled flag

### CloudWatch RUM

- ID: `cloudwatch-rum`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - RUM collects client-side data from real user sessions: page load times, client-side errors and user behavior for web applications
  - An app monitor generates a snippet for the page, and collects from a chosen percentage of sessions
  - Data is retained for 30 days; copies can be sent to CloudWatch Logs to keep them longer
  - With X-Ray active tracing on the app monitor, client page requests appear connected to the services they call

### Synthetic monitoring (canaries)

- ID: `cloudwatch-synthetics`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Canaries are scripts that run on a schedule, as often as once per minute, and check endpoints even when there is no customer traffic
  - Canaries create Lambda functions in the account and publish metrics in the CloudWatchSynthetics namespace

### Amazon CloudWatch Pricing

- ID: `cloudwatch-pricing`
- URL: <https://aws.amazon.com/cloudwatch/pricing/>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Free tier: 5 GB of log data (ingestion, storage, and data scanned by Logs Insights), 10 custom metrics, 10 alarm metrics, 3 dashboards of up to 50 metrics, 100 canary runs a month, 100,000 traces recorded and 1,000,000 retrieved or scanned a month
  - RUM has a one-time free trial of 1 million web RUM events per account, not a monthly allowance
  - Custom metric charges are prorated by the hour and incurred only when metrics are sent in that hour
  - A metric alarm is charged for each metric listed in its expression
  - Each canary run may also incur Lambda, S3, CloudWatch Logs and CloudWatch Metrics charges
  - RUM pricing example: 20 data events per visit
- Note: Most prices on the page are filled in by script and were not visible in the fetched HTML; the dashboard price could not be read. https://aws.amazon.com/xray/pricing/ redirects to a CloudWatch page.

### AWS Price List bulk API: CloudWatch, ap-northeast-1 (metrics, alarms, queries, RUM, Synthetics)

- ID: `aws-price-list-cloudwatch-observability`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Unit prices for custom metrics, standard alarms, Logs Insights data scanned, RUM events and canary runs in data/pricing/unit-prices.json
  - USD 0 tiers: 10 metrics, 10 alarms, 5 GB of data scanned, 100 canary runs
  - No dashboard price appears in the ap-northeast-1 offer file

### AWS Price List bulk API: X-Ray, ap-northeast-1

- ID: `aws-price-list-xray`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSXRay/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Traces stored USD 0.000005 each, traces retrieved or scanned USD 0.0000005 each
  - USD 0 tiers: 100,000 traces stored and 1,000,000 traces accessed

### cdkd v0.296.28: src/provisioning/register-providers.ts (CloudWatch, Logs, SNS)

- ID: `cdkd-register-providers-observability`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Dedicated providers are registered for AWS::CloudWatch::Alarm, AWS::SNS::Topic, AWS::SNS::Subscription and AWS::Logs::LogGroup
  - No dedicated provider is registered for AWS::CloudWatch::Dashboard, AWS::Logs::MetricFilter, AWS::RUM::AppMonitor or AWS::Synthetics::Canary, so they go through Cloud Control API
- Note: Also checked in the published tarball's dist. No cdkd command was run against AWS.

### Resource types that support Cloud Control API

- ID: `cloud-control-supported-resources`
- URL: <https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - AWS::CloudWatch::Dashboard, AWS::Logs::MetricFilter, AWS::RUM::AppMonitor and AWS::Synthetics::Canary are listed as supported

### @opentelemetry/api 1.9.1 and @opentelemetry/sdk-trace-node 2.12.0 (npm tarballs)

- ID: `opentelemetry-js-npm`
- URL: <https://www.npmjs.com/package/@opentelemetry/api/v/1.9.1>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Without a registered SDK the API returns no-op tracers and spans
  - A caller's API version is accepted when the registered global has the same major version and an equal or higher minor version; otherwise the caller gets the no-op implementation
  - NodeTracerProvider.register() installs an AsyncLocalStorage context manager and the W3C trace context propagator
- Note: Read from build/src/internal/semver.js and the type definitions of the installed packages.

### Cloudflare Workers Logs

- ID: `cloudflare-workers-logs`
- URL: <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - New Workers have observability enabled by default, and JSON logs have their fields extracted and indexed
  - Retention is at most 7 days; the paid plan includes 20 million log events a month and charges USD 0.60 per additional million
  - From December 1, 2026, Workers Logs moves to Cloudflare Observability pricing

### Cloudflare Workers tracing

- ID: `cloudflare-workers-traces`
- URL: <https://developers.cloudflare.com/workers/observability/traces/>
- Checked: 2026-10-12
- Chapters: 19
- Claims this source supports:
  - Tracing is enabled in the Wrangler configuration and instruments Workers without code changes or an SDK; it is in beta
  - The default head sampling rate is 1 (every request); head_sampling_rate lowers it
  - Traces are kept for seven days and can be exported to an OpenTelemetry endpoint

### Working with expired items and time to live (TTL)

- ID: `dynamodb-ttl-expired-items`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Expired items that are not filtered keep showing in read and write operations until the background process deletes them
  - Expired items still count towards storage and read costs until they are deleted
  - A filter expression on the TTL attribute removes expired items from Scan and Query results
- Note: The parent page (source dynamodb-ttl) was re-read the same day: deletion is 'within a few days', 'typically within a few days after their expiration'.

### Working with items and attributes in DynamoDB

- ID: `dynamodb-working-with-items`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - UpdateItem can implement an atomic counter: a numeric attribute incremented without interfering with other write requests; all write requests are applied in the order received
  - Atomic counter updates are not idempotent, so a retried UpdateItem can overcount; the page recommends a conditional update where miscounting cannot be tolerated
  - A conditional write whose condition evaluates to false still consumes write capacity (a minimum of 1 unit)

### Using update expressions in DynamoDB

- ID: `dynamodb-update-expressions`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - ADD mathematically adds a number to an existing Number attribute, and sets the attribute to that number when it does not exist
  - ADD supports only number and set data types
  - An update expression can combine SET and ADD clauses

### Deploying DynamoDB locally on your computer

- ID: `dynamodb-local-download`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - DynamoDB Local is available as a downloadable archive with a published SHA-256 checksum, and as a Docker image
  - The downloadable version needs a Java Runtime Environment 17.x or newer
- Note: The archive linked from this page was downloaded, its checksum compared, and run as version 3.3.1 for the store contract tests.

### What is Amazon ElastiCache?

- ID: `elasticache-what-is`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - ElastiCache runs in two formats: serverless caches and node-based clusters, with the Valkey, Memcached, and Redis OSS engines
  - ElastiCache Serverless supports two connection types, VPC and Public; a public endpoint is reached over the internet without a VPC and requires IAM authentication and TLS 1.3 for every connection
  - The connection type is chosen when the cache is created
  - ElastiCache Serverless is compatible with Valkey 7.2 and later, Memcached 1.6.22 and later, and Redis OSS 7.1; public endpoints need Valkey 9.0 or later

### Choosing between deployment options

- ID: `elasticache-deployment-options`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Serverless operates engines in cluster mode enabled only; clients must support cluster mode
  - Serverless: clients connect to a single endpoint; encryption in transit and at rest are always enabled
  - Serverless: data is replicated asynchronously across multiple Availability Zones; durability (the Multi-AZ transactional log) is not supported
  - Node-based clusters: public endpoints are not supported; pricing is per node-hour, while serverless is billed for data stored in GB-hours and requests in ECPUs
  - Serverless configuration is limited to basic settings such as subnets, backups, and maximum cache usage limits

### Create a Valkey serverless cache with a public endpoint

- ID: `elasticache-public-endpoint-create`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/serverless-public-endpoints-chapter.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Public endpoints are available on ElastiCache Serverless for Valkey 9.0 or later
  - ElastiCache provides a system-managed IAM user (default.iam-user) and user group (default.iam-user-group); a custom group must contain only users that authenticate with IAM
  - The CLI example creates the cache with --engine valkey --major-engine-version 9 --connection-type public --user-group-id default.iam-user-group
  - The ability to create public caches can be restricted with the elasticache:ConnectionType condition key

### Connect to a cache with a public endpoint

- ID: `elasticache-public-endpoint-connect`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connecting-public-endpoint.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - All public endpoint connections require IAM authentication and TLS 1.3
  - The caller needs elasticache:Connect on both the serverless cache ARN and the ElastiCache user ARN
  - Three ways to produce the token: the GLIDE client, the Developer Toolkit for ElastiCache (Python), or manual SigV4 signing
  - Tokens are valid for 15 minutes; with the toolkit or manual signing a new token is generated for each new connection; expiry does not affect established connections; a token signed with temporary credentials expires with them if sooner
  - Connections expire after 12 hours; revoking elasticache:Connect does not disconnect active sessions
  - Troubleshooting: WRONGPASS (expired token, wrong user, missing permission, cache name not lowercase), NOAUTH when a client sends a command before authenticating, TLS handshake failure without TLS 1.3

### Authenticating with IAM

- ID: `elasticache-iam-auth`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - IAM authentication passes a short-lived token instead of a password in AUTH or HELLO; it needs Valkey 7.2 or above (or Redis OSS 7.0 or above) and in-transit encryption
  - The token is a SigV4 pre-signed GET request to http://<cache name>/ with query parameters Action=connect, User=<user id>, and ResourceType=ServerlessCache for serverless caches, signed for service elasticache with a 900-second expiry, with the http:// prefix removed
  - For IAM-enabled users the user name and user ID must be identical
  - Cache names are lowercased at creation, and the signing code must use the lowercase name
  - An IAM-authenticated connection is disconnected after 12 hours unless re-authenticated
  - GLIDE 2.2 and later generate, cache, and refresh the token themselves
- Note: The reference implementation on the page is Java. The sample's TypeScript signer follows it and was never presented to ElastiCache.

### Role-Based Access Control (RBAC)

- ID: `elasticache-rbac`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Clusters.RBAC.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - ElastiCache users carry an access string and belong to user groups, which are attached to caches
  - ElastiCache configures a default user with full access; the page tells you to replace it with one that is disabled or has a strong password
  - The nopass option is not recommended

### ElastiCache in-transit encryption (TLS)

- ID: `elasticache-in-transit-encryption`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - All serverless caches have in-transit encryption enabled; node-based clusters can turn it on or off
  - Caches with a public endpoint require TLS 1.3

### Supported and restricted Valkey, Memcached, and Redis OSS commands

- ID: `elasticache-supported-commands`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - EVAL and EVALSHA are listed among the commands supported by serverless caches

### Scaling ElastiCache Serverless clusters

- ID: `elasticache-serverless-scaling`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - A maximum can be set on cache data storage and on ECPUs per second to control cost
  - At the storage maximum ElastiCache evicts keys that have a TTL, and writes fail with an out-of-memory error when nothing can be evicted; above the ECPU maximum requests are throttled
  - A minimum usage limit is billed even when actual usage is lower
- Note: Neither this page nor the API reference pages for DataStorage and ECPUPerSecond state the smallest accepted maximum. The stack's ECPU maximum of 1,000 is the value the page uses in its CLI example for a minimum.

### Engine versions and upgrading in ElastiCache

- ID: `elasticache-engine-versions`
- URL: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - All features available with Redis OSS 7.2 are available in Valkey 7.2 and above
  - Some existing ElastiCache for Redis OSS engines can be upgraded to a Valkey engine
  - ElastiCache versions 9.0 and 9.1 for Valkey exist

### Amazon ElastiCache pricing

- ID: `elasticache-pricing`
- URL: <https://aws.amazon.com/elasticache/pricing/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Serverless is billed for data stored (GB-hours, from an hourly average) and for ECPUs; a read or write uses 1 ECPU per KB transferred, and commands needing more vCPU time use proportionally more
  - Minimum metered data storage is 100 MB per cache for ElastiCache Serverless for Valkey and 1 GB for Memcached and Redis OSS
  - Billing starts when a serverless cache becomes available and continues until it is deleted
  - Accounts created before 2025-07-15 get 750 hours of cache.t3.micro for 12 months, which excludes ElastiCache Serverless; newer accounts get credits instead
  - Serverless with a public endpoint: no data transfer charge on the cache side, and USD 0.01 per GB in or out of the application within the same Region
  - Valkey is priced 33% lower than the other engines on Serverless and 20% lower on nodes
- Note: The price tables on the page are rendered by script and were not read; unit prices come from the Price List.

### AWS Price List bulk API: ElastiCache, ap-northeast-1

- ID: `aws-price-list-elasticache`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with offerCode AmazonElastiCache
  - Serverless Valkey in Tokyo: USD 0.101 per GB-hour stored and USD 0.0027 per million ECPUs
  - A cache.t4g.micro node running Valkey in Tokyo: USD 0.02 per node-hour

### AWS::ElastiCache::ServerlessCache

- ID: `cfn-elasticache-serverlesscache`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-serverlesscache.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Properties include CacheUsageLimits, ConnectionType (vpc | public, default vpc, replacement on change), Engine (valkey | redis | memcached), MajorEngineVersion (an integer such as 9), ServerlessCacheName (required, at most 40 characters), UserGroupId, SubnetIds, SecurityGroupIds, FinalSnapshotName, and SnapshotRetentionLimit
  - Fn::GetAtt returns ARN, Endpoint.Address, and Endpoint.Port
  - CacheUsageLimits holds DataStorage (Maximum, Minimum, Unit = GB) and ECPUPerSecond (Maximum, Minimum)
- Note: aws-cdk-lib 2.273.0 exposes the same properties on CfnServerlessCache, including connectionType.

### cdkd v0.296.28: src/provisioning/register-providers.ts

- ID: `cdkd-register-providers-kv`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Dedicated providers are registered for AWS::DynamoDB::Table, AWS::Logs::LogGroup, AWS::Lambda::Function, AWS::Lambda::Permission, AWS::IAM::Role, AWS::IAM::Policy, and the AWS::ApiGatewayV2 types the chapter 14 stack uses
  - For ElastiCache only AWS::ElastiCache::SubnetGroup and AWS::ElastiCache::CacheCluster have a dedicated provider; AWS::ElastiCache::ServerlessCache has none and is handled through Cloud Control API
- Note: src/provisioning/stateful-types.ts at the same tag lists AWS::ElastiCache::ServerlessCache as a stateful type. Both were also confirmed in the bundled dist of the npm tarball.

### valkey-io/valkey README

- ID: `valkey-readme`
- URL: <https://github.com/valkey-io/valkey/blob/unstable/README.md>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Valkey was forked from the open source Redis project right before the transition to its new source-available licenses
  - Valkey is a data structure server that primarily serves key/value workloads

### Valkey: Scripting with Lua

- ID: `valkey-eval-intro`
- URL: <https://valkey.io/topics/eval-intro/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Valkey guarantees a script's atomic execution; all server activities are blocked while it runs
  - Every key a script accesses must be passed explicitly as a key argument, in standalone and clustered deployments alike

### Valkey command: SET

- ID: `valkey-command-set`
- URL: <https://valkey.io/commands/set/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - PXAT sets the Unix time in milliseconds at which the key expires; NX sets the key only if it does not exist
  - SET key value NX with an expiry is described as a simple way to implement a lock

### Valkey command: EXPIRE

- ID: `valkey-command-expire`
- URL: <https://valkey.io/commands/expire/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - The expire error is from 0 to 1 milliseconds
  - Expired keys are reclaimed on access and by a background cycle; a key found to be timed out on access is deleted at that moment

### Valkey command: INCR

- ID: `valkey-command-incr`
- URL: <https://valkey.io/commands/incr/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - INCR is an atomic increment; the page describes the counter and rate limiter patterns built on it

### valkey/valkey container image tags (Docker Hub)

- ID: `valkey-container-image`
- URL: <https://hub.docker.com/r/valkey/valkey/tags>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Tag 9.0.6-alpine exists (last updated 2026-09-21)
- Note: Read through the Docker Hub tags API. The image was not pulled or run; the contract tests ran against valkey-server 9.1.2 from nixpkgs instead.

### iovalkey 0.4.0 (npm registry metadata and tarball)

- ID: `iovalkey-npm`
- URL: <https://www.npmjs.com/package/iovalkey/v/0.4.0>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - 0.4.0 was the latest version, published 2026-07-27, MIT, with no native or platform-specific dependencies
  - Exports Redis (also as Valkey) and Cluster; RedisOptions.username and password are plain strings
  - On connect, AUTH is sent before any other command when a password is set (built/redis/event_handler.js)
  - The README recommends dnsLookup: (address, callback) => callback(null, address) with redisOptions.tls for ElastiCache clusters with TLS
  - valkey:// and valkeys:// URLs are accepted

### @valkey/valkey-glide 2.5.3 (npm registry metadata)

- ID: `valkey-glide-npm`
- URL: <https://www.npmjs.com/package/@valkey/valkey-glide/v/2.5.3>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - 2.5.3 was the latest version, published 2026-09-24, Apache-2.0
  - Its native code ships as optional dependencies per platform: darwin-x64, darwin-arm64, linux-x64-gnu, linux-x64-musl, linux-arm64-gnu, linux-arm64-musl
- Note: Only the registry metadata was read. The package was not installed, and its IAM configuration for Node.js was not checked against its types.

### Understanding the Lambda execution environment lifecycle

- ID: `lambda-execution-environment`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - After an invocation Lambda freezes the execution environment and keeps it for some time in anticipation of another invocation
  - Lambda terminates execution environments every few hours for runtime updates and maintenance, even for functions invoked continuously
  - Objects declared outside the handler stay initialized when the environment is reused

### Understanding Lambda function scaling

- ID: `lambda-concurrency`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Concurrency is the number of in-flight requests a function handles at the same time; for each concurrent request Lambda provisions a separate instance of the execution environment

### Cloudflare Workers KV: Pricing

- ID: `cloudflare-kv-pricing`
- URL: <https://developers.cloudflare.com/kv/platform/pricing/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - Workers KV is included in the Free and Paid Workers plans
  - Free: 100,000 reads, 1,000 writes, 1,000 deletes, 1,000 list requests per day, and 1 GB stored
  - Paid: 10 million reads and 1 million writes a month included, then USD 0.50 per million reads and USD 5.00 per million writes; 1 GB stored included, then USD 0.50 per GB-month
- Note: The pages 'How KV works' (source cloudflare-kv-how-it-works) and 'Limits' (cloudflare-kv-limits) were re-read the same day; the statements recorded there still stand, and How KV works also says KV is not ideal where atomic operations are needed and points to Durable Objects.

### Cloudflare: What are Durable Objects?

- ID: `cloudflare-durable-objects-what`
- URL: <https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/>
- Checked: 2026-10-12
- Chapters: 14, 16
- Claims this source supports:
  - Each Durable Object has a globally unique name and is single-threaded
  - Each has its own durable, transactional, strongly consistent storage, accessible only within that object
  - In-memory state is reset when the object hibernates after being idle

### Cloudflare Workers: Rate Limiting binding

- ID: `cloudflare-workers-rate-limit-binding`
- URL: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- Checked: 2026-10-12
- Chapters: 14
- Claims this source supports:
  - A rate limit is defined by a limit and a period of 10 or 60 seconds
  - Limits are local to the Cloudflare location the Worker runs in
  - The API is described as permissive, eventually consistent, and not intended as an accurate accounting system

### Detect unmanaged configuration changes to stacks and resources with drift detection

- ID: `cfn-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html>
- Checked: 2026-10-12
- Chapters: 02, 20
- Claims this source supports:
  - CloudFormation drift detection compares live resource properties with the template; not every resource type or property is covered
  - Only property values explicitly set in the template or through parameters are compared; default values are not
  - Resources that do not support drift detection get NOT_CHECKED; a stack with no supported resources is IN_SYNC
  - Detection on a stack does not detect drift in its nested stacks; run it on the nested stack itself
  - Detection can run on stacks in CREATE_COMPLETE, UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE, and UPDATE_ROLLBACK_FAILED
  - The caller needs read permission for each resource, plus cloudformation:DetectStackDrift, DetectStackResourceDrift, and BatchDescribeTypeConfigurations
  - KMSKeyId is never compared; values the service does not return, and Lambda function code, cannot be compared; attachments across stacks may give inaccurate results
  - DETECTION_FAILED means detection failed for at least one resource; results are available for the others
  - Stack-level tags are also checked for drift

### Detect drift on an entire CloudFormation stack

- ID: `cfn-detect-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Detection is asynchronous and must be polled to completion
  - detect-stack-drift returns a detection ID, describe-stack-drift-detection-status reports progress, describe-stack-resource-drifts returns per-resource results
  - Only one drift detection operation can run on a stack at a time; it may take several minutes
  - The guide warns to compare the last drift check time with the result timestamps to avoid using stale data

### Resource type support

- ID: `cfn-resource-type-support`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Drift detection column is Yes for AWS::ApiGatewayV2::Api, Route, Stage, AWS::IAM::Role, AWS::IAM::OIDCProvider, AWS::Lambda::Function, Version, Alias, Permission, and AWS::Logs::LogGroup
  - Drift detection column is No for AWS::ApiGatewayV2::Integration and AWS::CloudFormation::Stack
  - AWS::IAM::Policy is not in the table
  - The table is described as not exhaustive

### DescribeStackDriftDetectionStatus

- ID: `cfn-api-drift-status`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackDriftDetectionStatus.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - DetectionStatus is DETECTION_IN_PROGRESS, DETECTION_FAILED, or DETECTION_COMPLETE; StackDriftStatus is DRIFTED, IN_SYNC, UNKNOWN, or NOT_CHECKED
  - Response fields used by tools/src/drift/cloudformation-schema.ts

### DescribeStackResourceDrifts

- ID: `cfn-api-resource-drifts`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackResourceDrifts.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Returns one result per resource that has been checked; resources not yet checked or not supporting drift detection are not included
  - Results are paginated with NextToken

### StackResourceDrift

- ID: `cfn-api-stack-resource-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_StackResourceDrift.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - StackResourceDriftStatus is IN_SYNC, MODIFIED, DELETED, NOT_CHECKED, UNKNOWN, or UNSUPPORTED
  - Each result carries the Timestamp of when that resource was checked

### DetectStackDrift

- ID: `cfn-api-detect-stack-drift`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DetectStackDrift.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Returns a StackDriftDetectionId; can take up to several minutes; does not descend into nested stacks
  - The page lists no specific error for a stack that does not exist

### ListStackResources

- ID: `cfn-api-list-stack-resources`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListStackResources.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Returns every resource of the stack as StackResourceSummary, paginated with NextToken

### @aws-sdk/client-cloudformation 3.1149.0 (type definitions)

- ID: `aws-sdk-cloudformation-npm`
- URL: <https://www.npmjs.com/package/@aws-sdk/client-cloudformation/v/3.1149.0>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Enum values of StackStatus, StackDriftStatus, StackDriftDetectionStatus, StackResourceDriftStatus, and DifferenceType
  - StackResourceDriftInformationSummary: resources skipped by ContinueUpdateRollback also have NOT_CHECKED
  - PropertyDifferences are present only for MODIFIED resources

### cdk diff

- ID: `cdk-diff`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html>
- Checked: 2026-10-12
- Chapters: 02, 20
- Claims this source supports:
  - `cdk diff` compares the synthesized template with the deployed template
  - --method auto (the default) creates a change set with the deploy role and falls back to a template diff; --method template compares templates and uses the lookup role

### cdk drift

- ID: `cdk-drift-command`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-drift.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - `cdk drift` calls CloudFormation drift detection; `cdk diff` compares templates
  - --fail returns exit code 1 when drift is detected; no other command-specific option is documented

### AWS CDK bootstrapping

- ID: `cdk-bootstrapping`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html>
- Checked: 2026-10-12
- Chapters: 02, 20
- Claims this source supports:
  - `cdk bootstrap` deploys the CDKToolkit stack with an asset bucket, an ECR repository, and IAM roles
  - Each environment (account and Region) must be bootstrapped before deploying into it

### Bootstrap your environment for use with the AWS CDK

- ID: `cdk-bootstrapping-env`
- URL: <https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Bootstrapping creates five IAM roles: CloudFormationExecutionRole, DeploymentActionRole, FilePublishingRole, ImagePublishingRole, and LookupRole
  - Physical names follow cdk-<qualifier>-<description>-<account>-<Region>; the default qualifier is hnb659fds
  - The deploy role is assumed by the CDK CLI; the CloudFormation execution role is what CloudFormation uses to create resources

### aws-cdk 2.1145.0 (help output, README, and `cdk bootstrap --show-template`)

- ID: `aws-cdk-cli-npm`
- URL: <https://www.npmjs.com/package/aws-cdk/v/2.1145.0>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Bootstrap template version 32: bucket cdk-<qualifier>-assets-<account>-<region> (versioned, retained on stack deletion, noncurrent versions expire after 30 days), ECR repository cdk-<qualifier>-container-assets-<account>-<region>, five roles, and the SSM parameter /cdk-bootstrap/<qualifier>/version
  - The CloudFormation execution role gets AdministratorAccess unless --cloudformation-execution-policies or trusted accounts are given
  - The bootstrap roles trust the account's own principals for sts:AssumeRole; the lookup role has ReadOnlyAccess with a deny on kms:Decrypt
  - The deploy role's CloudFormation permissions are on Resource *, so it cannot be limited to stacks of one name
  - Flags of cdk deploy, diff, destroy, drift, rollback, and bootstrap used in examples/20-shipping/src/cdk-args.ts
  - cdk deploy uses a change set by default and rolls back on failure unless --no-rollback or --express is given
  - CDK_DISABLE_CLI_TELEMETRY and CDK_DISABLE_VERSION_CHECK environment variables; `notices: false` in cdk.json

### aws-cdk-lib 2.273.0 (type definitions used by chapter 20)

- ID: `aws-cdk-lib-ship`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - OidcProviderNative creates AWS::IAM::OIDCProvider directly; thumbprints are optional
  - StackProps.terminationProtection, AppProps.analyticsReporting, Function.currentVersion with currentVersionOptions.removalPolicy
  - StackProps has no stack policy property

### Choose how to handle failures when provisioning resources

- ID: `cfn-stack-failure-options`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - With rollback disabled, successfully provisioned resources are preserved and failed ones stay in CREATE_FAILED or UPDATE_FAILED
  - CloudFormation stops at the first failure in each independent provisioning path
  - A stack in that state is remediated by a retry, an update, or a rollback

### CreateStack

- ID: `cfn-api-create-stack`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - DisableRollback defaults to false and OnFailure to ROLLBACK
  - Termination protection is deactivated by default

### Monitor stack progress

- ID: `cfn-stack-status-codes`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - ROLLBACK_COMPLETE exists only after a failed creation, and only a delete can be performed on it
  - UPDATE_ROLLBACK_FAILED: delete the stack or continue the rollback
  - During an update with replacement, new resources are created first and old ones deleted in UPDATE_COMPLETE_CLEANUP_IN_PROGRESS
  - DELETE_FAILED: the stack cannot be updated; delete it again

### Continue rolling back an update

- ID: `cfn-continue-rollback`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - A stack in UPDATE_ROLLBACK_FAILED cannot be updated, but can be rolled back to UPDATE_ROLLBACK_COMPLETE
  - Resources skipped while forcing a rollback end up inconsistent with the template

### Update CloudFormation stacks using change sets

- ID: `cfn-change-sets`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - A change set previews how proposed changes affect running resources, including replacement and deletion, before it is executed
  - A change set does not guarantee that the update will succeed

### Prevent updates to stack resources

- ID: `cfn-stack-policy`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - A stack policy applies only during stack updates and is a fail-safe, not access control
  - Once a stack policy is set, every resource is protected unless explicitly allowed

### Protect CloudFormation stacks from being deleted

- ID: `cfn-termination-protection`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - With termination protection, deleting the stack fails and the stack is unchanged; it is disabled by default
  - Termination protection applies only to attempts to delete the stack; an update that removes a nested stack still deletes it

### AWS CloudFormation pricing

- ID: `cfn-pricing`
- URL: <https://aws.amazon.com/cloudformation/pricing/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - No additional charge for resource providers in the AWS::* namespace; you pay for the resources created

### AWS IAM FAQs

- ID: `iam-faqs`
- URL: <https://aws.amazon.com/iam/faqs/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - IAM is offered at no additional charge

### CloudFormation resource provider schemas, ap-northeast-1

- ID: `cfn-resource-schemas`
- URL: <https://schema.cloudformation.ap-northeast-1.amazonaws.com/CloudformationSchema.zip>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Read handler permissions of AWS::Lambda::Function, Version, Alias, Permission, AWS::ApiGatewayV2::Api, Route, Stage, AWS::IAM::Role, and AWS::Logs::LogGroup, used for the DriftRole policy
- Note: That drift detection needs exactly these actions is an inference from the schemas, not a documented statement.

### AWS service reference: CloudFormation

- ID: `aws-service-reference-cloudformation`
- URL: <https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - DescribeStackDriftDetectionStatus and BatchDescribeTypeConfigurations have no resource type, so a policy must use Resource *
  - DetectStackDrift, DetectStackResourceDrift, DescribeStackResourceDrifts, ListStackResources, and DescribeStacks can be limited to a stack ARN

### AWS service reference: CloudWatch Logs

- ID: `aws-service-reference-logs`
- URL: <https://servicereference.us-east-1.amazonaws.com/v1/logs/logs.json>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - DescribeLogGroups, DescribeIndexPolicies, and DescribeResourcePolicies have no resource type

### Create a role for OpenID Connect federation

- ID: `iam-oidc-role`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - For GitHub's provider, IAM rejects a trust policy whose token.actions.githubusercontent.com:sub condition is missing or only a wildcard
  - AWS recommends limiting the condition to specific repositories or branches, and protection rules on GitHub environments used in OIDC policies

### Create an OpenID Connect (OIDC) identity provider in IAM

- ID: `iam-oidc-provider`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - AWS verifies the provider's JWKS endpoint with its own trusted root CAs and falls back to thumbprints only when it cannot

### GitHub Actions: OpenID Connect reference

- ID: `github-oidc-reference`
- URL: <https://docs.github.com/en/actions/reference/security/oidc>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Subject formats: repo:OWNER/REPO:environment:NAME, repo:OWNER/REPO:pull_request (only if the job references no environment), repo:OWNER/REPO:ref:refs/heads/BRANCH
  - Repositories created after July 15, 2026 use immutable subjects of the form repo:OWNER@OWNER-ID/REPO@REPO-ID:...; older ones keep the previous format unless opted in or renamed
  - A job needs permissions id-token: write to request the token; that permission grants no write access to anything else

### GitHub Actions: Configuring OpenID Connect in Amazon Web Services

- ID: `github-oidc-aws`
- URL: <https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Provider URL https://token.actions.githubusercontent.com and audience sts.amazonaws.com for the official action
  - Custom claims for OIDC are not available in AWS
  - OIDC lets workflows reach AWS without storing AWS credentials as long-lived GitHub secrets

### GitHub Actions: Secure use reference

- ID: `github-secure-use`
- URL: <https://docs.github.com/en/actions/reference/security/secure-use>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Pinning an action to a full-length commit SHA is the only way to use an action as an immutable release

### GitHub Actions: Events that trigger workflows

- ID: `github-events`
- URL: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Scheduled workflows run on the latest commit of the default branch, can be delayed or dropped under load, and are disabled in public repositories after 60 days without activity
  - For pull requests from forks, secrets are not passed and GITHUB_TOKEN is read-only

### GitHub Actions: Deployments and environments

- ID: `github-environments`
- URL: <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Environments support required reviewers and deployment branch restrictions
  - On GitHub Free, Pro, and Team, required reviewers are available only for public repositories

### GitHub Actions billing

- ID: `github-actions-billing`
- URL: <https://docs.github.com/en/billing/concepts/product-billing/github-actions>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Standard GitHub-hosted runners are free in public repositories
  - Private repositories get a monthly quota of minutes by plan; GitHub Free includes 2,000

### aws-actions/configure-aws-credentials v6.3.0 (action.yml and README at the tagged commit)

- ID: `configure-aws-credentials-v6`
- URL: <https://github.com/aws-actions/configure-aws-credentials/tree/e1253824e5c10ff9df46874f81ed3ec929e19cfd>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - v6.3.0 was the latest release on the check date; its tag points at commit e1253824e5c10ff9df46874f81ed3ec929e19cfd
  - Inputs role-to-assume, aws-region (required), and allowed-account-ids; audience defaults to sts.amazonaws.com; role-duration-seconds defaults to 3600
  - Session tagging is not used when authenticating with OIDC

### actions/checkout: latest release

- ID: `actions-checkout-release`
- URL: <https://api.github.com/repos/actions/checkout/releases/latest>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - v7.0.1, commit 3d3c42e5aac5ba805825da76410c181273ba90b1; has a persist-credentials input

### cachix/install-nix-action: latest release

- ID: `install-nix-action-release`
- URL: <https://api.github.com/repos/cachix/install-nix-action/releases/latest>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - v31.11.1, commit 13d8dd58da0234aa297dedd986986ccb8e7f3e24

### actions/upload-artifact: latest release

- ID: `upload-artifact-release`
- URL: <https://api.github.com/repos/actions/upload-artifact/releases/latest>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - v7.0.2, commit cf430e030ddbb5b0abf93d22962f4752f3646cd9; inputs name, path, if-no-files-found

### Manage Lambda function versions

- ID: `lambda-versions`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - A published version's code and most configuration are immutable; deploying code overwrites $LATEST

### Implement Lambda canary deployments using a weighted alias

- ID: `lambda-alias-routing`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - An alias can split traffic between at most two published versions with the same execution role; a weighted alias cannot point to $LATEST
  - The split is probabilistic, so low traffic can differ widely from the configured percentage

### Working with deployment configurations in CodeDeploy

- ID: `codedeploy-deployment-configs`
- URL: <https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Predefined canary, linear, and all-at-once configurations exist for Lambda, such as CodeDeployDefault.LambdaCanary10Percent5Minutes

### Cloudflare Workers: Versions & deployments

- ID: `cloudflare-workers-versions`
- URL: <https://developers.cloudflare.com/workers/versions-and-deployments/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - By default `wrangler deploy` creates a version and deploys it to 100% of traffic in one step
  - A version captures code, static assets, bindings, and compatibility settings; state in KV, R2, Durable Objects, and D1 is not tracked with versions

### Cloudflare Workers: Gradual deployments

- ID: `cloudflare-workers-gradual`
- URL: <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - A deployment can split traffic between two versions by percentage

### Cloudflare Workers: Rollbacks

- ID: `cloudflare-workers-rollbacks`
- URL: <https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - `wrangler rollback` creates a new deployment with an earlier version; only the 100 most recent versions can be rolled back to
  - Resources connected to the Worker are not changed by a rollback, and errors can follow if the structure of data changed between versions

### Cloudflare Workers: GitHub Actions

- ID: `cloudflare-workers-github-actions`
- URL: <https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - The documented setup stores a Cloudflare API token and the account ID as CI secrets for Wrangler

### cdkd: Drift

- ID: `cdkd-drift`
- URL: <https://cdkd.dev/drift/index.html>
- Checked: 2026-10-12
- Chapters: 02, 20
- Claims this source supports:
  - Outcome categories and resolution with --accept and --revert
  - cdkd drift compares cdkd's state with AWS; cdkd diff compares the template with the state

### cdkd: drift CLI reference

- ID: `cdkd-cli-drift`
- URL: <https://cdkd.dev/cli-drift/index.html>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - Flags and exit codes of `cdkd drift`
  - cdkd's state holds a snapshot of every property AWS reported, so drift catches a change to a property never set in the CDK code
  - CloudFormation's drift detection has nothing to inspect for a stack deployed by cdkd

### cdkd: Introduction (re-read for chapter 20)

- ID: `cdkd-introduction-tools`
- URL: <https://cdkd.dev/introduction/>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - cdkd recommends the AWS CDK CLI for production because CloudFormation provides change sets, stack policies, and the rest of its tooling
  - One CDK app can be deployed by cdkd to a dev environment and by the AWS CDK CLI to production; a stack can be moved from one tool to the other

### @go-to-k/cdkd 0.296.28 (help of export and import, provider registry)

- ID: `cdkd-npm-migration`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-12
- Chapters: 20
- Claims this source supports:
  - `cdkd export` hands a stack to CloudFormation through an IMPORT change set, deletes cdkd's state on success, and aborts if a resource is not importable
  - `cdkd import --migrate-from-cloudformation` writes cdkd state, sets Retain policies on every resource, then deletes the CloudFormation stack
  - No dedicated provider is registered for AWS::Lambda::Alias, AWS::Lambda::Version, or AWS::IAM::OIDCProvider; the other types chapter 20 uses have one
- Note: Read from the installed package's help output and bundled code. Neither command was run.

### What is Amazon ECS?

- ID: `ecs-welcome`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html>
- Checked: 2026-10-12
- Chapters: 12, 16
- Claims this source supports:
  - ECS runs containers on capacity that you choose; Fargate is the serverless, pay-as-you-go option where you manage no servers

### Elastic Load Balancing pricing

- ID: `elb-pricing`
- URL: <https://aws.amazon.com/elasticloadbalancing/pricing/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - An Application Load Balancer is charged for each hour or partial hour it runs, plus Load Balancer Capacity Units (LCU)
  - An LCU is the highest of four dimensions: 25 new connections per second, 3,000 active connections per minute, 1 GB per hour for EC2, container, and IP targets, and 1,000 rule evaluations per second
  - Standard public IPv4 address charges apply to all addresses a load balancer consumes
  - The Free Tier text describes 750 hours a month and 15 LCUs for new AWS customers, and credits for accounts created after 2025-07-15; it names no always-free allowance

### What is Docker?

- ID: `docker-overview`
- URL: <https://docs.docker.com/get-started/docker-overview/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Docker is client-server: the docker client talks to the Docker daemon (dockerd) over a REST API, on a UNIX socket or a network interface
  - The daemon builds, runs, and distributes containers; the client and the daemon can run on different systems

### Dockerfile reference

- ID: `dockerfile-reference`
- URL: <https://docs.docker.com/reference/dockerfile/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The shell form runs the command as a subcommand of /bin/sh -c, which does not pass signals, so the executable is not PID 1 and does not receive Unix signals
  - The exec form is a JSON array and does not invoke a command shell
  - STOPSIGNAL sets the signal sent to the container to exit

### docker-node: Docker and Node.js Best Practices

- ID: `docker-node-best-practices`
- URL: <https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The node images provide a user named node with uid 1000 for running the container unprivileged
  - A Node.js process running as PID 1 does not respond to SIGINT and similar signals by default; an init wrapper such as docker run --init handles that
- Note: Read from the main branch on 2026-10-12; the file is not versioned with the image tag.

### Docker Hub API: library/node tag 24-bookworm-slim

- ID: `docker-hub-node-24`
- URL: <https://hub.docker.com/v2/repositories/library/node/tags/24-bookworm-slim>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The tag node:24-bookworm-slim exists; its linux/amd64 image was 80,826,636 bytes compressed when checked
- Note: Only the beginning of the API response was read. The arm64 entry and its size were not read, and the image was not pulled.

### Node.js v24 documentation: HTTP

- ID: `node-http`
- URL: <https://nodejs.org/docs/latest-v24.x/api/http.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - server.close() stops the server from accepting new connections and closes connections that are not sending a request or waiting for a response; since v19.0.0 it closes idle connections before returning
  - server.closeIdleConnections() and server.closeAllConnections() exist since v18.2.0
  - A server has a 5 second keep-alive timeout by default (server.keepAliveTimeout)

### Amazon ECS task lifecycle

- ID: `ecs-task-lifecycle`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html>
- Checked: 2026-10-12
- Chapters: 12, 16
- Claims this source supports:
  - A task passes through PROVISIONING, PENDING, ACTIVATING, RUNNING, DEACTIVATING, STOPPING, DEPROVISIONING, STOPPED
  - ACTIVATING is where ECS pulls images, creates containers, and registers load balancer target groups
  - For a service with Elastic Load Balancing target groups, deregistration happens in DEACTIVATING, the state before STOPPING
  - In STOPPING the agent sends the image's STOPSIGNAL (SIGTERM by default), then SIGKILL after the StopTimeout of the task definition

### Amazon ECS API Reference: ContainerDefinition

- ID: `ecs-api-container-definition`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - stopTimeout on Fargate: 30 seconds when not specified, 120 seconds at most, valid values 2 to 120
  - healthCheck maps to the HEALTHCHECK of docker run and is set per container definition
  - Plaintext environment variables are not recommended for sensitive information
  - readonlyRootFilesystem gives the container read-only access to its root file system

### Optimize load balancer connection draining parameters for Amazon ECS

- ID: `ecs-connection-draining`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - ECS waits for the load balancer to report the target as UNUSED; the time the load balancer takes is the deregistration delay (deregistration_delay.timeout_seconds, 300 by default)
  - ECS sends the stop signal first and SIGKILL after the stop timeout; an application that ignores SIGTERM makes ECS wait
  - The page's own Node.js example handles SIGTERM with server.close()

### Optimize load balancer health check parameters for Amazon ECS

- ID: `ecs-lb-health-check`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - A newly registered target needs one successful health check to be considered healthy, whatever the healthy threshold count is
  - The healthy threshold count applies when a target moves from unhealthy back to healthy
  - The defaults are an interval of 30 seconds and a healthy threshold of 5

### Determine Amazon ECS task health using container health checks

- ID: `ecs-container-health-checks`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - ECS monitors only health checks specified in the task definition; it does not monitor a Docker health check that is embedded in the image and absent from the container definition
  - A container health check command runs inside the container, so the image has to contain the command

### Best practices for Amazon ECS container images

- ID: `ecs-container-image-practices`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-considerations.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Make the application handle SIGTERM: stop taking new work and finish the work in progress
  - Tag images with a unique tag for each build, for example the git commit hash, and use latest only for testing
  - Turning on immutable image tags in Amazon ECR is recommended
  - Write logs to stdout and stderr

### Deploy Amazon ECS services by replacing tasks

- ID: `ecs-rolling-update`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - minimumHealthyPercent is the lower limit of running, healthy tasks during a rolling deployment, as a percent of the desired count, rounded up
  - maximumPercent is the upper limit of running tasks during a rolling deployment, rounded down; at 200 with a desired count of four the scheduler can start four new tasks before stopping four old ones
  - The circuit breaker is for deployments whose tasks cannot start; CloudWatch alarms are for failing a deployment on application metrics
  - By default ECS resolves the image tag in a task definition to a digest, so all tasks of a deployment run the same image

### How the Amazon ECS deployment circuit breaker detects failures

- ID: `ecs-circuit-breaker`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - With the rollback option, a failed deployment is rolled back to the most recent deployment in the COMPLETED state
  - Stage 1 counts tasks that fail to reach RUNNING; stage 2 counts tasks replaced because of failed Elastic Load Balancing, Cloud Map, or container health checks
  - The default threshold type BOUNDED_PERCENT with value 50 multiplies by the desired count and clamps the result to between 3 and 200
  - With resetOnHealthyTask true (the default) only consecutive failures count

### AWS::ECS::Service

- ID: `cfn-ecs-service`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - HealthCheckGracePeriodSeconds is how long the service scheduler ignores unhealthy Elastic Load Balancing and container health checks after a task has first started; the default is 0

### Health checks for Application Load Balancer target groups

- ID: `alb-health-checks`
- URL: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Defaults for ip targets: interval 30 seconds (range 5 to 300), timeout 5 seconds (range 2 to 120), healthy threshold 5 and unhealthy threshold 2 (range 2 to 10), matcher 200, path /
  - Each load balancer node checks each target
  - If a target group contains only unhealthy targets, the load balancer routes to all of them (fail open)
  - A deregistering target is in the draining state

### Edit target group attributes for your Application Load Balancer

- ID: `alb-target-group-attributes`
- URL: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The load balancer stops sending requests to a deregistering target and waits the deregistration delay, 300 seconds by default, so that in-flight requests can complete
  - If a deregistering target has no in-flight requests and no active connections, deregistration completes at once
  - If a deregistering target terminates the connection before the delay elapses, the client receives a 500-level error
  - Round robin is the default routing algorithm of a target group

### Edit attributes for your Application Load Balancer

- ID: `alb-attributes`
- URL: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The connection idle timeout is 60 seconds by default, with a valid range of 1 to 4000 seconds
  - AWS recommends configuring the application's idle timeout to be larger than the load balancer's; otherwise the load balancer can send a request into a connection the application has closed and return 502 Bad Gateway

### Application Load Balancers

- ID: `alb-overview`
- URL: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - A load balancer needs subnets in at least two Availability Zones
  - An Application Load Balancer has one IP address per enabled Availability Zone; the addresses come from EC2's public IPv4 pool and are managed by the service
  - routing.http.drop_invalid_header_fields.enabled exists as a load balancer attribute

### Amazon ECS task IAM role

- ID: `ecs-task-role`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The permissions of the task role are vended to the containers of the task, for application code that uses other AWS services
  - Pulling images from ECR is not a task role permission; it belongs to the task execution role

### Amazon ECS task execution IAM role

- ID: `ecs-task-execution-role`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - The task execution role grants the ECS container and Fargate agents permission to make AWS API calls on your behalf
  - It is used to pull an image from an ECR private repository and to send container logs to CloudWatch Logs with the awslogs driver
  - A custom policy for pulling from ECR includes ecr:GetAuthorizationToken, ecr:BatchCheckLayerAvailability, ecr:GetDownloadUrlForLayer, and ecr:BatchGetImage

### Automatically scale your Amazon ECS service

- ID: `ecs-service-auto-scaling`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Application Auto Scaling turns off scale-in while an ECS deployment is in progress; scale-out continues
  - Scale-in is blocked until the scale-in cooldown has expired; a scale-out during that period happens immediately

### Use a target metric to scale Amazon ECS services

- ID: `ecs-target-tracking`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - A target tracking policy keeps a metric at or near a target value and manages its own CloudWatch alarms
  - The service scales out proportionally to the metric as fast as it can, and scales in more gradually
  - With several target tracking policies, the service scales out if any is ready to and scales in only if all are
  - With insufficient data the policy does not scale in

### Amazon ECS task networking options for Fargate

- ID: `ecs-fargate-image-route`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - To pull an image a Fargate task needs a route to the internet: a public IP address on the task ENI in a public subnet, a NAT gateway for a private subnet, or ECR interface endpoints
  - Every Fargate task gets an elastic network interface with a primary private IP address
- Note: Same page as ecs-fargate-networking, read again on 2026-10-12.

### Fargate task definition differences

- ID: `ecs-fargate-task-sizes`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - 256 CPU units (.25 vCPU) can be combined with 512 MiB, 1 GB, or 2 GB of memory
  - Fargate runs X86_64 and ARM64 tasks

### Amazon ECS task definitions for 64-bit ARM workloads

- ID: `ecs-arm64`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-arm64.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - ARM64 tasks on Fargate need platform version 1.4.0 or later
  - The only place listed as not supporting 64-bit ARM on Fargate is the use1-az3 Availability Zone of US East (N. Virginia)

### Control traffic to your AWS resources using security groups

- ID: `vpc-security-groups-dns`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Security groups do not filter traffic to and from Amazon DNS, DHCP, EC2 instance metadata, or ECS task metadata endpoints
- Note: Same page as vpc-security-groups, read again on 2026-10-12 for the egress rule of the task's security group.

### Pushing a Docker image to an Amazon ECR private repository

- ID: `ecr-push-image`
- URL: <https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - aws ecr get-login-password piped into docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com authenticates Docker
  - The authorization token is valid for 12 hours
  - The image is tagged as <account>.dkr.ecr.<region>.amazonaws.com/<repository>:<tag> and pushed with docker push

### Preventing image tags from being overwritten in Amazon ECR

- ID: `ecr-image-tag-mutability`
- URL: <https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - With immutable tags, pushing an image with a tag that already exists returns ImageTagAlreadyExistsException

### AWS Fargate pricing

- ID: `fargate-pricing`
- URL: <https://aws.amazon.com/fargate/pricing/>
- Checked: 2026-10-12
- Chapters: 12, 16
- Claims this source supports:
  - Fargate is billed for vCPU and memory from the start of the image download until the task terminates, per second with a one-minute minimum
  - 20 GB of ephemeral storage is included for every task
  - Public IPv4 addresses of tasks and CloudWatch Logs usage are charged separately
- Note: No Fargate free allowance was found on the page.

### Amazon ECR pricing

- ID: `ecr-pricing`
- URL: <https://aws.amazon.com/ecr/pricing/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - ECR charges for stored data and for data transferred to the internet
  - New ECR customers get 500 MB a month of private repository storage for one year

### AWS Price List: Amazon ECS, ap-northeast-1

- ID: `aws-price-list-ecs`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 12, 16
- Claims this source supports:
  - Fargate ARM: USD 0.04045 per vCPU-hour and USD 0.00442 per GB-hour
  - Fargate x86: USD 0.05056 per vCPU-hour and USD 0.00553 per GB-hour
- Note: Offer published 2026-09-11T12:44:25Z.

### AWS Price List: Elastic Load Balancing, ap-northeast-1

- ID: `aws-price-list-elb`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Application Load Balancer: USD 0.0243 per hour (or partial hour) and USD 0.008 per LCU-hour
- Note: Offer published 2026-09-11T12:45:44Z.

### AWS Price List: Amazon ECR, ap-northeast-1

- ID: `aws-price-list-ecr`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Private repository storage: USD 0.10 per GB-month
- Note: Offer published 2026-09-11T12:44:25Z.

### cdkd v0.296.28: providers for ECS, ELBv2, and ECR

- ID: `cdkd-source-containers`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Dedicated providers are registered for AWS::ECS::Cluster, TaskDefinition, and Service; AWS::ElasticLoadBalancingV2::LoadBalancer, TargetGroup, and Listener; AWS::ECR::Repository; AWS::EC2::SecurityGroup and SecurityGroupIngress; AWS::IAM::Role and Policy; AWS::Logs::LogGroup
  - No provider is registered for AWS::ApplicationAutoScaling::ScalableTarget, AWS::ApplicationAutoScaling::ScalingPolicy, or AWS::EC2::SecurityGroupEgress, and none of them is on the unsupported list, so they go through Cloud Control API
  - The ECS provider refuses an in-place update of a task definition; a changed task definition is replaced: a new revision is registered and the previous one is deregistered
  - Without --full-wait the ECS provider returns as soon as CreateService or UpdateService is accepted; with it, it waits for services-stable (at least 600 seconds) and then for the primary deployment's rolloutState to be COMPLETED for up to about two minutes
  - The ECR provider deletes a repository with force only when EmptyOnDelete is true, the CDK auto-delete tag is present, or a forced replacement was consented to
- Note: Read from the v0.296.28 tag archive: register-providers.ts, providers/ecs-provider.ts, providers/ecr-provider.ts, providers/elbv2-provider.ts, providers/ec2-provider.ts, unsupported-types.generated.ts. What the wait does when the circuit breaker rolls a deployment back was not found in the source and is not known.

### cdkd v0.296.28: docs/cli-deploy.md

- ID: `cdkd-cli-deploy-wait`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-deploy.md>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - An ECS service that never stabilizes under --full-wait fails the deploy; on create, cdkd deletes the service it just created before failing
  - By default cdkd waits for a load balancer to become active, which it puts at 90 to 180 seconds
  - The steady-state wait is capped at 600 seconds unless --resource-timeout raises it

### cdkd v0.296.28: Docker image asset publishing

- ID: `cdkd-docker-assets`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/assets/docker-asset-publisher.ts>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - For a Docker image asset cdkd checks whether the tag already exists in the repository, runs docker build, then docker tag and docker push, logging in to ECR only after a push fails for authentication
  - cdkd bootstrap creates a container-asset repository named cdkd-container-assets-{accountId}-{region} with immutable tags, and assets aimed at the default CDK bootstrap repository are redirected to it
- Note: Read from src/assets/docker-asset-publisher.ts, src/assets/asset-redirect.ts, and docs/cli-bootstrap.md at the v0.296.28 tag. Not run.

### aws-cdk-lib 2.273.0: ContainerImage.fromAsset during synthesis

- ID: `aws-cdk-lib-container-asset`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Synthesizing a task definition that uses ContainerImage.fromAsset succeeds with no docker command on the PATH: synthesis copies the directory into cdk.out and writes a dockerImages entry to the asset manifest
  - The entry's destination is the repository cdk-hnb659fds-container-assets-<account>-<region> with the asset hash as the image tag
- Note: Observed by running a synthesis on 2026-10-12 with the pinned version, not read from documentation.

### Lambda quotas

- ID: `lambda-limits-containers`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Code can run for up to 15 minutes in a single invocation
  - Functions can be defined as container images, which are stored in Amazon ECR
- Note: Same page as lambda-quotas, read again on 2026-10-12.

### Cloudflare Containers

- ID: `cloudflare-containers`
- URL: <https://developers.cloudflare.com/containers/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Containers are available on the Workers Paid plan
  - Container instances are started on demand and controlled by code in a Worker; a container is reached through a Durable Object
  - wrangler deploy builds and pushes the image named in the Wrangler configuration

### Cloudflare Containers: Pricing

- ID: `cloudflare-containers-pricing`
- URL: <https://developers.cloudflare.com/containers/platform/pricing/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Containers are billed for every 10 ms they are actively running; charges stop after the instance goes to sleep
  - Workers Paid includes 25 GiB-hours of memory and 375 vCPU-minutes a month; beyond that USD 0.0000025 per GiB-second and USD 0.000020 per vCPU-second
  - Memory and disk are billed on provisioned size, CPU on active usage
- Note: https://developers.cloudflare.com/containers/pricing/ redirects here.

### Cloudflare Containers: Rollouts

- ID: `cloudflare-containers-rollouts`
- URL: <https://developers.cloudflare.com/containers/configuration/rollouts/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - By default a deploy rolls out in steps of 10 and then 100 percent of instances
  - An instance being replaced gets SIGTERM, and SIGKILL after 15 minutes if it has not exited
  - During a rollout new Worker code can still reach container instances on the previous image
- Note: https://developers.cloudflare.com/containers/platform-details/rollouts/ redirects here.

### Cloudflare Containers: Lifecycle of a container

- ID: `cloudflare-containers-architecture`
- URL: <https://developers.cloudflare.com/containers/concepts/architecture/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - A container can only be accessed through its Durable Object
  - A Durable Object and its container instance are not guaranteed to run in the same location
- Note: https://developers.cloudflare.com/containers/platform-details/architecture/ redirects here.

### Cloudflare Containers: Frequently Asked Questions

- ID: `cloudflare-containers-faq`
- URL: <https://developers.cloudflare.com/containers/faq/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - Built-in autoscaling for stateless applications is not available today
  - Container cold starts are often in the 1 to 3 second range, depending on the image

### Cloudflare Containers: Local development

- ID: `cloudflare-containers-local-dev`
- URL: <https://developers.cloudflare.com/containers/guides/local-dev/>
- Checked: 2026-10-12
- Chapters: 12
- Claims this source supports:
  - wrangler dev and vite dev run the Worker and the container locally, and need a Docker-compatible CLI and engine such as Docker Desktop or Colima
- Note: https://developers.cloudflare.com/containers/local-dev/ redirects here.

### What is Amazon SQS?

- ID: `sqs-welcome`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Standard queues deliver at least once
  - Standard queues support at-least-once message delivery, and FIFO queues support exactly-once message processing

### Amazon SQS standard queues

- ID: `sqs-standard-queues`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Standard queues ensure at-least-once delivery; more than one copy of a message might be delivered, and messages may occasionally arrive out of order
  - Ordering is best effort
  - SQS stores a message redundantly in multiple Availability Zones before acknowledging SendMessage
  - Standard queues suit applications that can handle messages arriving more than once or out of order

### Amazon SQS at-least-once delivery

- ID: `sqs-at-least-once`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - If a server holding a copy of a message is unavailable when the message is received or deleted, that copy is not deleted and may be delivered again
  - Applications should be idempotent: not adversely affected by processing the same message more than once

### Amazon SQS visibility timeout

- ID: `sqs-visibility-timeout`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A received message stays in the queue and is hidden from other consumers for the visibility timeout
  - If the message is not deleted before the timeout expires, it becomes visible again and can be received by the same or another consumer
  - The default visibility timeout is 30 seconds; the maximum is 12 hours from the first receive
  - For standard queues there is no absolute guarantee that a message is not delivered more than once during the visibility timeout
  - Standard queues allow approximately 120,000 in-flight messages

### Using dead-letter queues in Amazon SQS

- ID: `sqs-dead-letter-queues`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - maxReceiveCount is the number of times a consumer can receive a message from a source queue before it is moved to the dead-letter queue
  - The dead-letter queue must be in the same account and Region as the source queue
  - For standard queues, a message's expiration is based on its original enqueue timestamp, which does not change when it moves to the dead-letter queue, so the dead-letter queue's retention period should be longer than the source queue's
  - With maxReceiveCount above 3, a message received 3 or more times without being deleted is moved to the back of the queue

### Learn how to configure a dead-letter queue redrive in Amazon SQS

- ID: `sqs-dlq-redrive`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - By default a redrive moves messages from the dead-letter queue back to their source queue
  - Redriven messages are considered new messages: they get a new messageID and enqueueTime, and the retention period is reset
  - Messages cannot be filtered or modified while they are redriven
  - A redrive task can run for at most 36 hours
  - Starting a redrive needs sqs:StartMessageMoveTask, sqs:ReceiveMessage, sqs:DeleteMessage, and sqs:GetQueueAttributes on the dead-letter queue and sqs:SendMessage on the destination

### StartMessageMoveTask

- ID: `sqs-start-message-move-task`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - SourceArn must be a dead-letter queue whose source is another SQS queue
  - Without DestinationArn, messages go back to their original source queues
  - MaxNumberOfMessagesPerSecond is at most 500
  - Only one active message movement task is supported per queue

### Amazon SQS message quotas

- ID: `sqs-message-quotas`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A message is retained for 4 days by default; the minimum is 60 seconds and the maximum is 14 days
  - The maximum message size is 1 MiB
  - A batch request holds at most 10 messages

### Creating alarms for dead-letter queues using Amazon CloudWatch

- ID: `sqs-dlq-alarms`
- URL: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A dead-letter queue is monitored with an alarm on the ApproximateNumberOfMessagesVisible metric

### Amazon SQS pricing

- ID: `sqs-pricing`
- URL: <https://aws.amazon.com/sqs/pricing/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - All customers can make 1 million SQS requests for free each month, counted across all Regions
  - Every SQS action counts as a request
  - A request can carry 1 to 10 messages, and each 64 KB chunk of payload is billed as one request
- Note: The unit prices on the page are filled in by script and were read from the Price List instead.

### AWS Price List bulk API: Amazon SQS, ap-northeast-1

- ID: `aws-price-list-sqs`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Standard queue requests in Tokyo: USD 0.40 per million up to 100 billion a month (SKU 5Q2SBURHPCGERHBD)
  - A separate global SKU (MNCJEPJRCSC9RFY2) prices the first 1,000,000 requests a month at 0
- Note: Publication date 2026-09-11T12:46:07Z.

### Using Lambda with Amazon SQS

- ID: `lambda-sqs`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Lambda polls the queue and invokes the function synchronously with a batch of messages
  - When the function processes a batch successfully, Lambda deletes its messages from the queue
  - By default, an error anywhere in a batch makes all its messages visible again after the visibility timeout
  - Event source mappings process each event at least once, and duplicate processing can occur; AWS strongly recommends idempotent function code
  - The function and the queue must be in the same Region

### Creating and configuring an Amazon SQS event source mapping

- ID: `lambda-sqs-configure`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Set the queue's visibility timeout to at least six times the function timeout
  - The function timeout must not exceed the queue's visibility timeout; Lambda validates this when the mapping is created or updated
  - AWS recommends a maxReceiveCount of at least 5 on the source queue's redrive policy
  - Batch size is up to 10,000 for a standard queue; above 10 a batch window of at least 1 second is required
  - A batch is also limited by the 6 MB synchronous invocation payload

### Configuring scaling behavior for SQS event source mappings

- ID: `lambda-sqs-scaling`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - For standard queues Lambda long-polls the queue, starts with five concurrent invocations, and adds up to 300 more per minute up to 1,250
  - Maximum concurrency limits the concurrent function instances one SQS event source can invoke; it is between 2 and 1,000 and costs nothing
  - Maximum concurrency and reserved concurrency are independent; reserved concurrency lower than the total maximum concurrency can lead to throttled messages
  - With maximum concurrency set, Lambda's optimization down to 2 concurrent invokes at low traffic is not available
- Note: The page gives no number for how often an idle queue is polled.

### Handling errors for an SQS event source in Lambda

- ID: `lambda-sqs-errors`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - With ReportBatchItemFailures in FunctionResponseTypes, the function returns the failed message IDs as batchItemFailures[].itemIdentifier and only those become visible again
  - An empty or null batchItemFailures list means the whole batch succeeded
  - If the function throws, the entire batch is a failure
  - An invalid response, an empty or null itemIdentifier, or a message ID that is not in the batch makes the whole batch a failure
  - With ReportBatchItemFailures activated, Lambda does not scale down polling when invocations fail
  - A throttled invocation is retried until the message's timestamp exceeds the queue's visibility timeout, and then dropped by Lambda

### Lambda parameters for Amazon SQS event source mappings

- ID: `lambda-sqs-parameters`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - BatchSize defaults to 10 and MaximumBatchingWindowInSeconds to 0
  - ScalingConfig holds the maximum concurrency; FunctionResponseTypes holds ReportBatchItemFailures

### AWSLambdaSQSQueueExecutionRole

- ID: `lambda-sqs-managed-policy`
- URL: <https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaSQSQueueExecutionRole.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - The permissions Lambda needs on the queue are sqs:ReceiveMessage, sqs:DeleteMessage, and sqs:GetQueueAttributes
  - The managed policy grants them, and the log permissions, on Resource "*"

### Amazon S3 Event Notifications

- ID: `s3-event-notifications`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - S3 event notifications are designed to be delivered at least once
  - They are typically delivered in seconds but can sometimes take a minute or longer
  - SQS FIFO queues are not supported as a destination

### Event notification types and destinations

- ID: `s3-notification-types`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Notifications are not guaranteed to arrive in the order the events occurred, and S3's retries can on rare occasions produce duplicates
  - S3 sends one event entry per notification message
  - s3:ObjectCreated:* covers Put, Post, Copy, and CompleteMultipartUpload
  - s3:ObjectRemoved events are not sent for deletes made by a lifecycle configuration; those are s3:LifecycleExpiration events
  - s3:TestEvent is published when a notification is enabled
  - Messages can be up to 64 KB; the destination queue must be in the bucket's Region

### Event message structure

- ID: `s3-notification-structure`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - The object key in an event is URL encoded; a space becomes +
  - The sequencer is a hexadecimal string; for one key, the greater value is the later event
  - Sequencers can differ in length: left-pad the shorter with zeros, then compare lexicographically
  - A sequencer cannot order events on different keys
  - The test message has no Records array: {"Service":"Amazon S3","Event":"s3:TestEvent",...}
  - eventName omits the s3: prefix
- Note: The page says the sequencer is "only used with PUT and DELETE requests" and that create events "(PUT requests)" and delete events contain one. It does not say whether an ObjectCreated:Post or a LifecycleExpiration:Delete event carries a sequencer.

### Granting permissions to publish event notification messages to a destination

- ID: `s3-notification-permissions`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/grant-destinations-permissions-to-s3.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - The queue's policy allows the s3.amazonaws.com service principal SQS:SendMessage, with conditions on aws:SourceArn (the bucket) and aws:SourceAccount
  - A queue encrypted with a customer managed KMS key needs a key policy statement for the S3 service principal
- Note: The page does not mention queues encrypted with SQS-managed keys (SSE-SQS).

### Using Amazon SQS, Amazon SNS, and Lambda (enabling notifications)

- ID: `s3-notification-config`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-enable-disable-notification-intro.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - After the notification configuration changes, it usually takes about five minutes to take effect
  - When a notification is first enabled, an s3:TestEvent occurs

### AWS::S3::Bucket NotificationConfiguration

- ID: `cfn-s3-notification-configuration`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-notificationconfiguration.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Creating the destination and its permissions in the same template as the bucket can produce a circular dependency, because the bucket cannot be created until it has permission to publish and the permission refers to the bucket
  - QueueConfigurations take one Event, a Queue ARN, and an optional S3Key filter

### How to retrieve or copy objects based on metadata with conditional reads

- ID: `s3-conditional-reads`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - GetObject with If-Match returns the object only if its ETag matches the one provided
  - An object's ETag represents a specific version of the object

### GetObject

- ID: `s3-getobject-if-match`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - When If-Match does not match, GetObject returns 412 Precondition Failed

### Manage event ordering and duplicate events with Amazon S3 Event Notifications (AWS Storage Blog)

- ID: `s3-blog-event-ordering`
- URL: <https://aws.amazon.com/blogs/storage/manage-event-ordering-and-duplicate-events-with-amazon-s3-event-notifications/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Duplicate notifications for one object event have the same key, versionId, operation, and sequencer
  - The post's design stores the newest sequencer per key in DynamoDB and does not update it for an older one
- Note: An AWS blog post that the S3 user guide links to. Used for the statement about duplicates sharing a sequencer.

### What is Amazon EventBridge Scheduler?

- ID: `eventbridge-scheduler`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - One-time and recurring schedules
  - EventBridge Scheduler provides at-least-once event delivery to targets: at least one delivery succeeds with a response from the target
  - Templated targets exist for SQS, SNS, Lambda, and EventBridge; a retry limit and a maximum retention time for failed triggers can be set

### Using templated targets in EventBridge Scheduler

- ID: `scheduler-templated-targets`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - A function ARN as the target means Lambda's Invoke operation
  - The schedule's execution role needs lambda:InvokeFunction for a Lambda target

### Setting up Amazon EventBridge Scheduler

- ID: `scheduler-execution-role`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - The execution role is an IAM role that EventBridge Scheduler assumes to call the target; its trust policy names scheduler.amazonaws.com

### Confused deputy prevention in EventBridge Scheduler

- ID: `scheduler-confused-deputy`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - AWS recommends aws:SourceArn and aws:SourceAccount conditions in the execution role's trust policy
  - The aws:SourceArn value must be a schedule group ARN, not a schedule or a name prefix

### RetryPolicy (EventBridge Scheduler API)

- ID: `scheduler-retry-policy`
- URL: <https://docs.aws.amazon.com/scheduler/latest/APIReference/API_RetryPolicy.html>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - MaximumEventAgeInSeconds is 60 to 86,400; MaximumRetryAttempts is 0 to 185
  - Retries use exponential backoff until either limit is reached
- Note: The page states no default for either value.

### Schedule types in EventBridge Scheduler

- ID: `scheduler-schedule-types`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - A rate expression is rate(value unit) with minutes, hours, or days
  - A rate-based schedule without a StartDate starts invoking its target immediately

### Invoke a Lambda function on a schedule

- ID: `lambda-eventbridge-scheduler`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - EventBridge Scheduler invokes a Lambda function asynchronously

### Amazon EventBridge pricing

- ID: `eventbridge-pricing`
- URL: <https://aws.amazon.com/eventbridge/pricing/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - EventBridge Scheduler: 14,000,000 invocations a month are free

### AWS Price List bulk API: Amazon EventBridge, ap-northeast-1

- ID: `aws-price-list-events`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 08, 16
- Claims this source supports:
  - Scheduled invocations in Tokyo (SKU 29C3758CBCYNXH8B): USD 0 for the first 14 million a month, then USD 1.25 per million
- Note: Publication date 2026-09-24T16:39:03Z.

### Supported data types and naming rules in Amazon DynamoDB

- ID: `dynamodb-data-types`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - DynamoDB collates and compares strings using the bytes of the underlying UTF-8 encoding

### cdkd v0.296.28: register-providers.ts and property-coverage.generated.ts

- ID: `cdkd-source-async`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Dedicated providers are registered for AWS::SQS::Queue, AWS::SQS::QueuePolicy, AWS::Lambda::EventSourceMapping, AWS::Lambda::EventInvokeConfig, and AWS::Scheduler::Schedule
  - property-coverage.generated.ts lists BucketName and NotificationConfiguration among the AWS::S3::Bucket properties the provider handles, and RedrivePolicy, VisibilityTimeout, MessageRetentionPeriod, and SqsManagedSseEnabled for AWS::SQS::Queue
  - For AWS::Lambda::EventSourceMapping it lists BatchSize, FunctionResponseTypes, and ScalingConfig; for AWS::Scheduler::Schedule it lists Name, ScheduleExpression, FlexibleTimeWindow, and Target
  - The dependency graph honours DependsOn except for a fixed list of VPC resource pairs
- Note: Both files were read from the v0.296.28 tag; the DependsOn handling was read in the bundled JavaScript of the npm tarball. No cdkd command was run against AWS.

### aws-cdk-lib 2.273.0: aws-s3 notifications and the synthesized AihAsync template

- ID: `aws-cdk-lib-s3-notifications`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - `Bucket.addEventNotification` is implemented with a Custom::S3BucketNotifications resource (aws-s3/lib/notifications-resource)
  - Setting `notificationConfiguration` on the CfnBucket synthesizes a plain NotificationConfiguration property and no custom resource
  - `Function.configureAsyncInvoke` synthesizes AWS::Lambda::EventInvokeConfig; `EventSourceMapping` with maxConcurrency and reportBatchItemFailures synthesizes ScalingConfig.MaximumConcurrency and FunctionResponseTypes
- Note: Read from the installed package and from cdk.out/AihAsync.template.json produced by `vp run async:infra:synth`.

### WebP Container Specification

- ID: `webp-container-spec`
- URL: <https://developers.google.com/speed/webp/docs/riff_container>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A WebP file is a RIFF container whose first chunk is 'VP8 ' (lossy), 'VP8L' (lossless), or 'VP8X' (extended)
- Note: The byte offsets used in src/inspect.ts were checked against files written by cwebp, not derived from this page alone.

### Graphics Interchange Format, Version 89a

- ID: `gif89a-spec`
- URL: <https://www.w3.org/Graphics/GIF/spec-gif89a.txt>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A GIF data stream starts with a 3-byte signature and a 3-byte version, followed by the logical screen width and height as unsigned 16-bit values

### Cloudflare Queues: Delivery guarantees

- ID: `cloudflare-queues-delivery`
- URL: <https://developers.cloudflare.com/queues/reference/delivery-guarantees/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - Queues provides at-least-once delivery by default; a message may on rare occasions be delivered more than once
  - Cloudflare suggests a unique ID used as a primary key or an idempotency key to de-duplicate

### Cloudflare Queues: Batching, Retries and Delays

- ID: `cloudflare-queues-batching`
- URL: <https://developers.cloudflare.com/queues/configuration/batching-retries/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A consumer receives batches; max_batch_size defaults to 10 and max_batch_timeout to 5 seconds
  - ack() and retry() on a single message acknowledge or redeliver just that message
  - max_retries defaults to 3; after that a message is deleted, or written to the dead-letter queue if one is configured

### Cloudflare Queues: Dead Letter Queues

- ID: `cloudflare-queues-dlq`
- URL: <https://developers.cloudflare.com/queues/configuration/dead-letter-queues/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A dead-letter queue is set in the consumer configuration and is a queue like any other
  - Without one, messages that reach the retry limit are deleted permanently

### Cloudflare R2: Event notifications

- ID: `cloudflare-r2-event-notifications`
- URL: <https://developers.cloudflare.com/r2/buckets/event-notifications/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - R2 sends object-create and object-delete notifications to a Cloudflare Queue, with optional prefix and suffix rules
  - The example message has account, bucket, object key, size and eTag, action, and eventTime
- Note: No field corresponding to S3's sequencer appears in the message format on this page.

### Cloudflare Workers: Cron Triggers

- ID: `cloudflare-cron-triggers`
- URL: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Checked: 2026-10-12
- Chapters: 08
- Claims this source supports:
  - A Worker can be run on a schedule with a cron expression through its scheduled() handler
- Note: The page was not found to state a delivery guarantee for scheduled runs.

### Improve the security of EC2 instances by using VPC endpoints for Systems Manager

- ID: `ssm-endpoints-for-ec2`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - The page lists the interface endpoints ssm, ec2messages, and ssmmessages, plus S3 for SSM Agent updates
  - ssmmessages is required for SSM Agent to communicate with Systems Manager, for Run Command, and for Session Manager
  - Beginning with SSM Agent 3.3.40.0, Systems Manager uses the ssmmessages endpoint whenever available instead of ec2messages
  - Without endpoints, the instance needs outbound HTTPS (443) to the ssm, ssmmessages, and ec2messages endpoints
  - SSM Agent initiates all connections, so no inbound traffic has to be allowed
  - The security group of an endpoint must allow inbound 443 from the instance's subnet
  - A logs endpoint is needed to send Session Manager, Run Command, or agent logs to CloudWatch Logs without internet access

### Reference: ec2messages, ssmmessages, and other API operations

- ID: `ssm-message-endpoints`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-setting-up-messageAPIs.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - With SSM Agent 3.3.40.0 or later and ssmmessages permissions, the agent connects to ssmmessages even when both are allowed
  - In Regions launched before 2024, ec2messages permissions can be removed from policies; Regions launched in 2024 and later support only ssmmessages
- Note: The page speaks of IAM permissions. It does not say in so many words that the ec2messages VPC endpoint can be left out, so this chapter keeps all three endpoints.

### Find AMIs with the SSM Agent preinstalled

- ID: `ssm-agent-preinstalled`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/ami-preinstalled-agent.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - SSM Agent is preinstalled on Amazon Linux 2023 AMIs provided by AWS
  - The preinstalled version might not be the latest

### SSM Agent technical reference

- ID: `ssm-agent-technical-reference`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/ssm-agent-technical-details.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - SSM Agent creates the local ssm-user account and adds it to /etc/sudoers.d; it is the default OS user of a session
  - The agent must reach AWS managed S3 buckets such as aws-ssm-<region> and patch-baseline-snapshot-<region>

### AWS Systems Manager Session Manager

- ID: `ssm-session-manager`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Session Manager needs no open inbound ports, no bastion hosts, and no SSH keys
  - Access is controlled with IAM policies; port forwarding redirects a port on the managed node to a local port
  - Session activity can be logged through CloudTrail, S3, and CloudWatch Logs

### Step 1: Complete Session Manager prerequisites

- ID: `ssm-session-prerequisites`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Port forwarding needs SSM Agent 3.0.222.0 or later on the managed node
  - Sessions run as ssm-user, an account with root or administrator permissions that the agent creates

### Start a session

- ID: `ssm-session-start`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - aws ssm start-session --target <instance id> starts a session and needs the Session Manager plugin on the local machine
  - AWS-StartPortForwardingSession takes portNumber and localPortNumber parameters

### Install the Session Manager plugin for the AWS CLI

- ID: `ssm-session-plugin`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - The Session Manager plugin must be installed separately on the local machine to start sessions with the AWS CLI
  - The page asks for plugin version 1.2.764.0 or later

### Configure instance permissions required for Systems Manager

- ID: `ssm-instance-permissions`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - An instance profile with AmazonSSMManagedInstanceCore is one of the two documented ways to let Systems Manager manage an instance
  - The other is Default Host Management Configuration at the account level, which this chapter does not use

### AmazonSSMManagedInstanceCore (AWS managed policy reference)

- ID: `ssm-managed-instance-core-policy`
- URL: <https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSSMManagedInstanceCore.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - The policy (version v2) allows ssm, ssmmessages, and ec2messages actions on Resource "*"
  - Among them are ssm:GetParameter and ssm:GetParameters on every resource

### Walkthrough: Use the AWS CLI with Run Command

- ID: `ssm-run-command-walkthrough`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/walkthrough-cli.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - AWS-RunShellScript runs commands on a managed node as if logged on locally
  - Commands in the pre-configured AWS-* documents run with administrative permissions; a user allowed to run them has administrator access to the node
  - send-command returns a command ID; get-command-invocation returns the result per instance

### GetCommandInvocation (Systems Manager API reference)

- ID: `ssm-api-get-command-invocation`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Status is one of Pending, InProgress, Delayed, Success, Cancelled, TimedOut, Failed, Cancelling
  - ResponseCode is the script's exit code; StandardOutputContent holds the first 24,000 characters of stdout

### AWS Systems Manager pricing

- ID: `ssm-pricing-ec2`
- URL: <https://aws.amazon.com/systems-manager/pricing/>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Session Manager, Run Command, and Patch Manager have no additional charge for use on Amazon EC2 instances
  - From September 30, 2026, sessions and Run Command invocations on hybrid and multicloud nodes are billed

### AWS Systems Manager Patch Manager

- ID: `ssm-patch-manager`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Patch Manager can scan managed nodes for missing patches or scan and install them, and reports compliance

### Patch Manager prerequisites

- ID: `ssm-patch-prerequisites`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-prerequisites.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Without internet access, nodes must still reach their configured patch repositories and the AWS managed S3 buckets

### How patch baseline rules work on Linux-based systems

- ID: `ssm-patch-amazon-linux`
- URL: <https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-linux-rules.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - On AL2023 EC2 instances, Patch Manager uses the latest repository versions, independent of the version the system is locked to

### Use the Instance Metadata Service to access instance metadata

- ID: `ec2-imds`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - IMDS answers at 169.254.169.254; IMDSv2 is session-oriented: a PUT request returns a token that later requests must present
  - PUT requests carrying an X-Forwarded-For header are rejected
  - The response to the PUT has a hop limit of 1 by default

### Configure the Instance Metadata Service options

- ID: `ec2-imds-options`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - The hop limit can be 1 to 64; a hop limit of 1 can cause issues in a container environment
  - Options not given at launch come from account-level defaults, then from the AMI

### IMDSv2 (Amazon Linux 2023 User Guide)

- ID: `al2023-imdsv2`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/imdsv2.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Instances launched from the AL2023 AMI require IMDSv2 and get a hop limit of 2 by default

### IAM roles for Amazon EC2

- ID: `ec2-iam-roles`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Applications on an instance retrieve temporary credentials for the instance's role from instance metadata
  - An instance profile can contain only one IAM role

### Run commands when you launch an EC2 instance with user data input

- ID: `ec2-user-data`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - User data scripts run only during the boot cycle of the first launch, by default
  - They run as root, not interactively; output goes to /var/log/cloud-init-output.log
  - User data is limited to 16 KB before base64 encoding

### Amazon EC2 instance state changes

- ID: `ec2-instance-lifecycle`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - A stopped instance is not billed for instance usage, but its EBS volumes are still charged
  - A running instance is billed per second with a one-minute minimum, even when idle
  - EBS volumes and Elastic IP addresses incur charges regardless of the instance's state

### Stop and start Amazon EC2 instances

- ID: `ec2-stop-start`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - A started instance typically moves to a new host and gets a new public IPv4 address
  - Data on instance store volumes is erased when an instance stops

### Amazon EC2 instance IP addressing

- ID: `ec2-instance-addressing`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - An auto-assigned public IPv4 address is released when the instance is stopped, hibernated, or terminated, and a new one is assigned on start
  - A persistent public address needs an Elastic IP address

### Automatic instance recovery

- ID: `ec2-auto-recovery`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-recover.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Simplified automatic recovery is enabled by default on supported instances and acts when a system status check fails
  - A recovered instance keeps its instance ID, IP addresses, attached EBS volumes, and Availability Zone, and loses what was in memory
  - Automatic recovery does not operate when only the instance status check fails

### Configure simplified automatic recovery on an Amazon EC2 instance

- ID: `ec2-simplified-recovery`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-configuration-recovery.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Simplified automatic recovery needs available capacity and does not operate during service events in the AWS Health Dashboard
  - It is not supported for instances with instance store volumes, metal sizes, or Dedicated Hosts

### Status checks for Amazon EC2 instances

- ID: `ec2-status-checks`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - System status checks detect problems with the AWS systems under the instance; instance status checks detect problems you must fix yourself
  - Status checks run every minute

### Unlimited mode concepts for burstable performance instances

- ID: `ec2-burstable-unlimited`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - T4g, T3a, T3, and T8i instances launch in unlimited mode by default
  - In unlimited mode, CPU use above the baseline averaged over 24 hours is billed at a flat rate per vCPU-hour

### Preserve data when an instance is terminated

- ID: `ec2-preserve-volumes`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - By default the root volume is deleted on termination, and a data volume attached after launch is preserved
  - The default at launch comes from the DeleteOnTermination attribute in the AMI

### AL2023 on Amazon EC2

- ID: `al2023-on-ec2`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/ec2.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - The latest AL2023 AMI is published under /aws/service/ami-amazon-linux-latest/, for example al2023-ami-kernel-default-arm64
  - From August 17, 2026 the default kernel of al2023-ami-kernel-default AMIs is 6.18; version-specific AMIs such as kernel-6.1 remain

### Deterministic upgrades through versioned repositories on AL2023

- ID: `al2023-deterministic-upgrades`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - An AL2023 instance is locked to the repository version its AMI was built from and does not receive newer updates on its own
  - dnf check-release-update lists newer releases; dnf upgrade --releasever=<version> moves to one
  - The AMI behind the SSM parameter is always the latest version

### Updating AL2023

- ID: `al2023-updating`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/updating.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Running dnf with --releasever=latest is called out as not best practice; a specific release version should be named

### Deterministic updates via instance replacement

- ID: `al2023-instance-replacement`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/security-instance-replacement.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Replacing instances with ones launched from a newer AMI is presented as a predictable way to roll out OS updates

### Node.js in AL2023

- ID: `al2023-nodejs`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - AL2023 provides Node.js 20, 22, and 24 as namespaced packages (nodejs24) with versioned executables (node-24)
  - The plain `node` name is an alternatives link that can point at a different version

### AWS CLI v2 (Amazon Linux 2023 User Guide)

- ID: `al2023-awscli`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/awscli2.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - AL2023 ships with AWS CLI version 2

### systemd journal replaces rsyslog

- ID: `al2023-journald`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/journald.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - AL2023 does not install rsyslog by default; logs are in the systemd journal and read with journalctl

### gp3 as default Amazon EBS volume type

- ID: `al2023-gp3-xfs`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/continuing-al2-filesystem.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - AL2023 AMIs use gp3 volumes by default, and XFS on the root file system

### Manage package and operating system updates in AL2023

- ID: `al2023-repositories`
- URL: <https://docs.aws.amazon.com/linux/al2023/ug/managing-repos-os-updates.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Sample dnf output shows the repositories at https://al2023-repos-<region>-de612dc2.s3.dualstack.<region>.amazonaws.com/
- Note: This is the only evidence found that the repositories are S3 buckets in the instance's Region. No page read states that an S3 gateway endpoint is enough to reach them.

### Amazon EBS volumes

- ID: `ebs-volumes`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - An EBS volume persists independently of the life of an instance
  - The volume and the instance must be in the same Availability Zone

### Map Amazon EBS volumes to NVMe device names

- ID: `ebs-nvme-device-names`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/identify-nvme-ebs-device.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - NVMe device names can change between boots; stable identifiers are recommended
  - Amazon Linux AMIs later than 2017.09.01 ship a udev rule that links the block device mapping name to the NVMe device

### Make an Amazon EBS volume available for use

- ID: `ebs-make-available`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/ebs-using-volumes.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - A new volume has no file system; mkfs on a volume that has data destroys it
  - fstab entries should use the UUID, with the nofail option so the instance boots without the volume

### Amazon EBS snapshots

- ID: `ebs-snapshots`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Snapshots are incremental, stored in Amazon S3, and replicated across the Availability Zones of the Region
  - A volume can be restored from a snapshot in any Availability Zone of that Region

### Create Amazon EBS snapshots

- ID: `ebs-create-snapshot`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Snapshot creation is asynchronous; the snapshot stays pending until its data has been transferred
  - For a consistent snapshot, pause writes or unmount the volume first; writes can resume once the snapshot is pending
  - Snapshots of encrypted volumes are encrypted

### Replace an Amazon EBS volume using a snapshot

- ID: `ebs-restore-volume`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/ebs-restoring-volume.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - A volume created from a snapshot must be in the same Availability Zone as the instance it will attach to
  - aws ec2 create-volume takes --snapshot-id and --availability-zone

### Initialize Amazon EBS volumes

- ID: `ebs-initialize`
- URL: <https://docs.aws.amazon.com/ebs/latest/userguide/initalize-volume.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Blocks of a volume created from a snapshot are downloaded from S3 on first access, which adds latency until the volume is initialized

### AWS::EC2::Instance

- ID: `cfn-ec2-instance`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - ImageId: update requires replacement
  - UserData: update requires some interruptions; with an EBS root volume CloudFormation restarts the instance
  - CreditSpecification accepts standard and unlimited

### AWS::EC2::Volume

- ID: `cfn-ec2-volume`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - A deletion policy can retain the volume, delete it, or create a snapshot before deleting it
  - AvailabilityZone and SnapshotId cannot be updated

### AWS::EC2::VolumeAttachment

- ID: `cfn-ec2-volumeattachment`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volumeattachment.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - The volume must be unmounted inside the instance before the attachment is deleted, or it can be stuck in the busy state
  - Every property requires replacement on update

### AWS::IAM::InstanceProfile

- ID: `cfn-iam-instanceprofile`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Only one role can be assigned to an EC2 instance at a time, and all applications on the instance share it

### Specify existing resources at runtime with CloudFormation-supplied parameter types

- ID: `cfn-ssm-parameter-types`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-supplied-parameter-types.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - A parameter of type AWS::SSM::Parameter::Value<AWS::EC2::Image::Id> makes CloudFormation fetch the value from Parameter Store when the stack is created or updated

### DeletionPolicy attribute

- ID: `cfn-deletion-policy`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Snapshot is supported for resources such as AWS::EC2::Volume; Retain is supported for any resource

### AWS Price List bulk API: EC2, ap-northeast-1 (instances and EBS)

- ID: `aws-price-list-ec2-compute`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - Unit prices in data/pricing/unit-prices.json with ids ec2.t4g-micro.linux.hour, ec2.t4g-small.linux.hour, ec2.t4g.cpu-credit, ebs.gp3.storage, ebs.snapshot.storage
  - t4g.micro is 2 vCPU and 1 GiB; t4g.small is 2 vCPU and 2 GiB
- Note: Publication date 2026-10-09T20:31:34Z. The file is about 446 MB. Instance SKUs were filtered to Linux, shared tenancy, no preinstalled software, capacity status Used.

### cdkd v0.296.28 source: EC2 instance, volume, and parameter handling

- ID: `cdkd-source-ec2`
- URL: <https://github.com/go-to-k/cdkd/tree/v0.296.28/src>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - register-providers.ts registers AWS::EC2::Instance and AWS::EC2::SecurityGroup with the EC2 provider and AWS::IAM::InstanceProfile with its own provider
  - AWS::EC2::Volume, AWS::EC2::VolumeAttachment, and AWS::EC2::LaunchTemplate are not registered, so they go through Cloud Control API
  - property-coverage.generated.ts: the EC2 provider writes ImageId, InstanceType, SubnetId, SecurityGroupIds, NetworkInterfaces, IamInstanceProfile, MetadataOptions, CreditSpecification, UserData, BlockDeviceMappings, and Tags; Volumes and LaunchTemplate would route the instance through Cloud Control
  - replacement-rules.ts replaces an instance when ImageId, SubnetId, AvailabilityZone, KeyName, EbsOptimized, or NetworkInterfaces changes; UserData is not in the list and updateInstance does not apply it
  - intrinsic-resolver/params-conditions.ts resolves a referenced AWS::SSM::Parameter::Value<...> parameter with GetParameter at deploy time
  - ec2-volume-delete.ts deletes a volume with EC2 DeleteVolume instead of Cloud Control; stateful-types.ts lists AWS::EC2::Volume, so replacing one needs --force-stateful-recreation
- Note: Read from the source archive of the v0.296.28 tag. Nothing was run against AWS.

### cdkd v0.296.28: destroy

- ID: `cdkd-cli-destroy`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-destroy.md>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - A non-empty S3 bucket fails the destroy unless the bucket opted in to being emptied

### aws-cdk-lib 2.273.0: aws-ec2 machine image and instance types

- ID: `aws-cdk-lib-ec2-machine-image`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - MachineImage.latestAmazonLinux2023() adds a template parameter of type AWS::SSM::Parameter::Value<AWS::EC2::Image::Id> and looks nothing up during synthesis
  - Its documentation comment says the image updates on every deployment, that instances are replaced when a new image appears, and not to store stateful information on the instance
  - latestAmazonLinux2023() always sets kernel to CDK_LATEST, which is 6.1 in this version, so it synthesizes al2023-ami-kernel-6.1-<arch> whatever kernel option is passed
  - AmazonLinux2023ImageSsmParameter with kernel DEFAULT gives al2023-ami-kernel-default-<arch>; unless cachedInContext is false it looks the AMI up during synthesis and fails without an account (StackAccountRegionNotSpecified)
- Note: Read from the type definitions and the compiled JavaScript in the npm package, and confirmed by synthesizing.

### systemd v252: systemd.service(5)

- ID: `systemd-service-man`
- URL: <https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Restart=on-failure restarts on a non-zero exit code, a signal, a timeout, or a watchdog, not on a clean exit
  - TimeoutStopSec= is how long to wait for a stop before the service is terminated with SIGKILL
- Note: The systemd version on Amazon Linux 2023 was not checked on an instance.

### systemd v252: systemd.unit(5)

- ID: `systemd-unit-man`
- URL: <https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - RequiresMountsFor= adds Requires= and After= on the mount units for a path
  - AssertPathIsMountPoint= fails the start when the path is not a mount point; ConditionPathExists= skips it quietly
  - StartLimitIntervalSec= and StartLimitBurst= limit how often a unit may be started

### systemd v252: systemd.exec(5)

- ID: `systemd-exec-man`
- URL: <https://github.com/systemd/systemd/blob/v252/man/systemd.exec.xml>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - ProtectSystem=strict mounts the file system hierarchy read-only for the service; ReadWritePaths= makes exceptions
  - NoNewPrivileges=, ProtectHome=, PrivateTmp=, User=, and EnvironmentFile= behave as the unit in this chapter assumes

### systemd v252: systemd.kill(5)

- ID: `systemd-kill-man`
- URL: <https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml>
- Checked: 2026-10-12
- Chapters: 23, 24
- Claims this source supports:
  - KillSignal= is the first signal sent on stop (SIGTERM by default), followed by SIGKILL after the timeout

### Node.js v24: HTTP, server.close()

- ID: `node-http-server-close`
- URL: <https://nodejs.org/docs/latest-v24.x/api/http.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - server.close() stops the server from accepting new connections and closes connections that are not sending a request or waiting for a response
  - server.closeAllConnections() closes every connection, including active ones

### Control traffic to your AWS resources using security groups

- ID: `vpc-security-groups-unfiltered`
- URL: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Security groups do not filter traffic to Amazon DNS, DHCP, EC2 instance metadata, or the Amazon Time Sync Service

### Lambda quotas

- ID: `lambda-limits-timeout`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - A function invocation can run for up to 900 seconds (15 minutes); memory is up to 10,240 MB

### Fargate task ephemeral storage for Amazon ECS

- ID: `fargate-ephemeral-storage`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - A Fargate task on platform version 1.4.0 or later gets 20 GiB of ephemeral storage by default, up to 200 GiB

### AWS Fargate for Amazon ECS

- ID: `fargate-what-is`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Fargate runs containers without servers or clusters of EC2 instances to manage
  - Each Fargate task has its own isolation boundary and does not share a kernel with another task; kernel and runtime updates arrive as platform version revisions

### Amazon ECS services

- ID: `ecs-services-replace`
- URL: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - When a task of a service fails or stops, the service scheduler launches another to replace it

### Configure ephemeral storage for Lambda functions

- ID: `lambda-ephemeral-storage`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - Lambda gives each execution environment temporary storage in /tmp, configurable from 512 MB to 10,240 MB

### Health checks for instances in an Auto Scaling group

- ID: `ec2-auto-scaling-health`
- URL: <https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - An Auto Scaling group replaces an instance it finds unhealthy with a new one launched from its launch template

### Manually create or edit the CloudWatch agent configuration file

- ID: `cloudwatch-agent-journald`
- URL: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html>
- Checked: 2026-10-12
- Chapters: 23
- Claims this source supports:
  - The agent's logs section can collect systemd journal entries on Linux through a journald section

### Lambda durable functions

- ID: `lambda-durable-functions`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - A durable execution can run for up to one year; it uses checkpoints and recovers through replay, re-executing from the beginning while skipping completed work
  - Waits suspend execution without compute charges
  - The page's own comparison: durable functions run within Lambda in standard programming languages; Step Functions is a standalone service with a graph-based DSL and native integrations to 220+ services
  - The SDK is available for JavaScript, TypeScript, Python, and Java

### Lambda durable functions: Basic concepts

- ID: `lambda-durable-concepts`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-basic-concepts.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - On resume Lambda invokes the function again from the beginning and substitutes stored values for completed operations
  - Code must be deterministic during replay; random numbers and the current time belong inside steps
  - DurableConfig has ExecutionTimeout (default 86,400 s, 60 s to 31,536,000 s) and RetentionPeriodInDays (default 14, 1 to 90)
  - The Lambda function timeout (at most 15 minutes) limits each invocation; the execution timeout limits the whole durable execution

### Lambda durable functions: Idempotency

- ID: `lambda-durable-idempotency`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Steps have at-least-once execution semantics by default; a step that fails or is interrupted before completing might execute multiple times
  - An execution name acts as an idempotency key: the same name with the same payload returns the existing execution, a different payload returns DurableExecutionAlreadyStartedException
  - Event source mappings do not support execution-name idempotency at launch

### Invoking durable Lambda functions

- ID: `lambda-durable-invoking`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - A durable function must be invoked with a qualified identifier: a version number, an alias, or $LATEST
  - An execution is pinned to the function version that started it; $LATEST executions can resume on updated code
  - Synchronous invocations are limited to 15 minutes; asynchronous invocations support executions up to one year
  - Durable functions support dead-letter queues but not Lambda destinations

### Security and permissions for Lambda durable functions

- ID: `lambda-durable-security`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-security.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - The execution role needs lambda:CheckpointDurableExecution and lambda:GetDurableExecutionState
  - Lambda authorizes most durable execution actions against the durable execution ARN, which extends a qualified function ARN; a policy naming the unqualified function ARN does not match
  - The managed policy AWSLambdaBasicDurableExecutionRolePolicy contains these permissions together with basic logging

### Deploy Lambda durable functions with Infrastructure as Code

- ID: `lambda-durable-iac`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - CloudFormation: AWS::Lambda::Function takes DurableConfig with ExecutionTimeout and RetentionPeriodInDays
  - The CDK example sets durableConfig on lambda.Function and invokes through an alias of currentVersion
  - IaC deployments must enable durable execution, grant checkpoint permissions, and publish a version or alias

### Supported runtimes for durable functions

- ID: `lambda-durable-runtimes`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-supported-runtimes.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Managed runtimes that support durable functions include nodejs22.x and nodejs24.x
  - The Node.js runtimes include the SDK, and the page recommends bundling it in the deployment package anyway
  - The JavaScript SDK is the npm package @aws/durable-execution-sdk-js

### Durable execution SDK: how durable operations are metered

- ID: `lambda-durable-metering`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Starting an execution counts as one operation; a step counts as one plus one per retry; a wait counts as one
  - Data persisted is the input payload and the payload returned by each step attempt

### Durable functions or Step Functions

- ID: `lambda-durable-vs-sfn`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-step-functions.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - AWS's own guidance: durable functions when the logic lives mostly in Lambda and the team prefers code; Step Functions for orchestration across many AWS services, visual workflows, and zero-maintenance infrastructure

### Best practices for Lambda durable functions

- ID: `lambda-durable-best-practices`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Do not rename steps or change their behavior while executions are in progress: replay matches saved state to step definitions
  - Unlike standard functions, Lambda does not automatically retry a failed durable execution after an asynchronous invocation; configure a dead-letter queue

### Lambda quotas (function timeout and durable functions)

- ID: `lambda-quotas-durable`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Function timeout: 900 seconds (15 minutes); the function configuration quotas cannot be changed except as noted, and the one noted exception is 5,400 seconds for Lambda Managed Instances
  - At most 3,000 durable operations per durable execution; cannot be increased
  - At most 100 MB of durable execution storage written per execution; cannot be increased
  - Durable function quotas apply per Region, with higher defaults in three named Regions
- Note: The page lists no Regions where durable functions are unavailable. Availability in ap-northeast-1 was inferred only from the Price List entries (source aws-price-list-lambda-durable), not confirmed by running anything.

### Using the Lambda context object to retrieve Node.js function information

- ID: `lambda-nodejs-context`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - context.getRemainingTimeInMillis() returns the milliseconds left before the execution times out

### AWS Durable Execution SDK Developer Guide: Key concepts

- ID: `durable-sdk-key-concepts`
- URL: <https://docs.aws.amazon.com/durable-execution/getting-started/key-concepts/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - For each durable operation the SDK checks for an existing checkpoint, runs the operation if there is none, serializes the result, and persists the checkpoint before continuing
  - The orchestration code must make the same sequence of durable operation calls on every invocation
  - After a wait, the SDK terminates the current Lambda invocation and the service invokes the function again later

### AWS Durable Execution SDK Developer Guide: Idempotency and retries

- ID: `durable-sdk-idempotency`
- URL: <https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - At-least-once per retry is the default: if an attempt is interrupted (the sandbox dies, the network drops, the runtime hits the invocation timeout), the step runs again on replay
  - At-most-once per retry waits for the START checkpoint and raises StepInterrupted on replay instead of re-executing; neither semantic guarantees exactly one run across the workflow

### @aws/durable-execution-sdk-js 2.6.0 and @aws/durable-execution-sdk-js-testing 1.3.0 (npm tarballs)

- ID: `durable-sdk-npm`
- URL: <https://www.npmjs.com/package/@aws/durable-execution-sdk-js/v/2.6.0>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - withDurableExecution wraps a handler that receives (event, DurableContext); context.step(name, fn, config) returns the checkpointed result
  - StepConfig accepts retryStrategy(error, attempt) returning { shouldRetry, delay } and semantics (StepSemantics.AtLeastOncePerRetry by default)
  - The testing package's LocalDurableTestRunner runs a handler against a checkpoint store in the local process, with skipTime to skip waits and retry delays
  - Both packages require Node.js 22 or later and depend on @aws-sdk/client-lambda
- Note: Read from the installed tarballs (README and dist-types). Version 2.6.0 was published on 2026-10-02.

### Choosing workflow type in Step Functions

- ID: `sfn-workflow-types`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Standard workflows run up to one year and are billed by state transition; Express workflows run up to five minutes and are billed by executions, duration, and memory
  - Standard workflows follow an exactly-once model: tasks and states are never run more than once unless Retry is specified in the definition
  - Asynchronous Express workflows are at-least-once
  - The workflow type cannot be changed after the state machine is created
  - Standard: starting an execution with the same name as a running one returns an idempotent response; execution history is removed after 90 days
  - Express workflows do not support the .sync or .waitForTaskToken integration patterns

### Handling errors in Step Functions workflows

- ID: `sfn-error-handling`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Retry fields: ErrorEquals, IntervalSeconds (default 1), MaxAttempts (default 3; 0 means never retried), BackoffRate (default 2.0), MaxDelaySeconds, JitterStrategy (FULL or NONE)
  - States.ALL matches any known error name but not States.DataLimitExceeded or States.Runtime; States.TaskFailed matches any error except States.Timeout
  - Catch has ErrorEquals, Next, and ResultPath; catchers apply when there is no Retry or retries are exhausted
  - Catchers exist for Task, Parallel, and Map states, not for top-level execution failures
  - Retries are treated as state transitions
  - Without Retry or Catch, an error fails the entire execution

### Task workflow state

- ID: `sfn-task-state`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - TimeoutSeconds: the maximum time a task can run before it fails with States.Timeout; the default is 99,999,999
  - The timeout counts from the task's start event; if the worker does not respond in time, Step Functions marks the task as failed
- Note: The page says what Step Functions does when the time runs out. It does not say that the Lambda function is stopped.

### Invoke an AWS Lambda function with Step Functions

- ID: `sfn-connect-lambda`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - A function ARN can be given directly in Resource; the task result is then the function's output alone, and .waitForTaskToken is not available
  - With the optimized integration (arn:aws:states:::lambda:invoke) the function output is nested under Payload

### Handling error conditions in a Step Functions state machine

- ID: `sfn-custom-error`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-handling-error-conditions.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - An error thrown by a Node.js Lambda function is matched in Retry and Catch by the error's name (the tutorial sets this.name = 'CustomError' and catches "CustomError")
  - The tutorial retries Lambda.ServiceException, Lambda.AWSLambdaException, Lambda.SdkClientException, and Lambda.TooManyRequestsException

### Specifying state output using ResultPath in Step Functions

- ID: `sfn-resultpath`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - ResultPath in a Catch keeps the state's input and adds the error under the given field

### Restarting state machine executions with redrive in Step Functions

- ID: `sfn-redrive`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - A failed, aborted, or timed-out Standard execution can be redriven for 14 days; it continues from the unsuccessful step with the same input and the same definition
  - Successful steps are not rerun; a redriven Task state is scheduled and started again with its retry count reset
  - A redrive re-enters a Fail state and fails again
  - Redrives count as state transitions; an execution with 24,999 or more history events cannot be redriven

### Step Functions service quotas

- ID: `sfn-quotas`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Standard workflows: at most 25,000 events in one execution history; reaching it fails the execution
  - Input or output of a task, state, or execution is at most 256 KiB as a UTF-8 string
  - Execution history is kept for 90 days after an execution closes

### Best practices for Step Functions

- ID: `sfn-best-practices`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Without TimeoutSeconds on a Task, an execution can be stuck waiting for a response that never comes
  - To stay under the history quota, use a Distributed Map or start a new execution from a Task state

### Creating an IAM role for your state machine in Step Functions

- ID: `sfn-iam-role`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - The state machine's role is assumed by states.amazonaws.com
  - The documented trust policy limits it with ArnLike aws:SourceArn arn:aws:states:<region>:<account>:stateMachine:* and StringEquals aws:SourceAccount

### Run Amazon ECS or Fargate tasks with Step Functions

- ID: `sfn-connect-ecs`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - The optimized integration calls ecs:runTask and supports the Run a Job (.sync) pattern
  - With .sync, a non-empty Failures field fails the task with AmazonECS.Unknown
  - Input reaches the container through overrides (ContainerOverride)

### Discover service integration patterns in Step Functions

- ID: `sfn-integration-patterns`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - With .sync Step Functions waits for the job to complete before moving on; AWS Batch submitJob.sync and ECS runTask.sync are examples
  - If a .sync task is aborted and Step Functions cannot cancel the job, the integrated service may keep charging

### StartExecution

- ID: `sfn-start-execution`
- URL: <https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - StartExecution is idempotent for STANDARD workflows: the same name and input as a running execution returns the same response
  - If the execution is closed or the input differs, it returns 400 ExecutionAlreadyExists; a name can be reused 90 days after the execution closes
  - An execution name is at most 80 characters and must not contain, among others, colons, slashes, brackets, or white space; without a name Step Functions generates a UUID

### AWS::StepFunctions::StateMachine

- ID: `cfn-sfn-statemachine`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Properties include DefinitionString, RoleArn, StateMachineType, LoggingConfiguration, and DefinitionSubstitutions

### AWS Step Functions pricing

- ID: `sfn-pricing`
- URL: <https://aws.amazon.com/step-functions/pricing/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Standard workflows are charged per state transition, retries included
  - The free tier is 4,000 state transitions a month, does not expire, and applies to existing and new customers
  - The page's example counts four transitions for a workflow of two states: Start, the two states, and End
- Note: Prices on the page are filled in by script; the numbers used in the book come from the Price List (source aws-price-list-states).

### AWS Price List: Step Functions, ap-northeast-1

- ID: `aws-price-list-states`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - SKU BTKF2VQUME7BCFVV (APN1-StateTransition): USD 0.000025 per state transition
  - SKU DCMZZXP5RBUG8FGP (Global-StateTransition): USD 0 for the first 4,000 state transitions
  - Express workflows: SKU DAVXY63QBMD93BC2, USD 0.000001 per request, plus a tiered GB-second duration charge
- Note: Offer publication date 2026-09-11T12:45:11Z.

### AWS Price List: Lambda durable execution, ap-northeast-1

- ID: `aws-price-list-lambda-durable`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - SKU 38G2CJHVYQC45MTY (APN1-Lambda-Durable-Execution-Operations): USD 0.0000106 per durable operation
  - SKU MVB47QVZRQ9MSHUU (APN1-Lambda-Durable-Execution-Written-Bytes): USD 0.33 per GB written
  - SKU A7USWCXHVDSE3RNW (APN1-Lambda-Durable-Execution-TimedStorage-ByteHrs): USD 0.20 per GB-month retained
- Note: Offer publication date 2026-10-09T22:31:22Z. The presence of APN1 SKUs is the only evidence gathered that durable functions are offered in ap-northeast-1.

### AWS Lambda pricing: Lambda Durable Functions Pricing

- ID: `lambda-pricing-durable`
- URL: <https://aws.amazon.com/lambda/pricing/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Durable functions are charged for durable operations (starting executions, completing steps, creating waits), for data written, and for data retained during and after execution, on top of normal Lambda compute
  - During a wait an on-demand function incurs no duration charge until execution resumes
  - Compute charges apply to the invocations that replays cause
- Note: The section names no free allowance for durable operations or storage.

### Adding context attributes in EventBridge Scheduler

- ID: `scheduler-context-attributes`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - <aws.scheduler.scheduled-time> in the target's payload is replaced with the time the schedule was due, for example 2022-03-22T18:59:43Z
  - <aws.scheduler.execution-id> is unique per attempted invocation, and <aws.scheduler.attempt-number> counts attempts

### Using templated targets in EventBridge Scheduler: Step Functions StartExecution

- ID: `scheduler-templated-sfn`
- URL: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Step Functions StartExecution is a templated target: the target ARN is the state machine's, and Input is the execution input
  - The schedule's execution role needs states:StartExecution
- Note: The page's example policy uses Resource "*"; the chapter's role names the one state machine instead.

### How to prevent object overwrites with conditional writes (re-read for chapter 16)

- ID: `s3-conditional-writes-if-none-match`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - PutObject with If-None-Match: * succeeds only if no object has the key; otherwise S3 answers 412 Precondition Failed
  - When several conditional writes target the same key, the first to finish succeeds and the rest get 412
  - A 409 Conflict is possible when a delete of the key succeeds before the conditional write completes; a PutObject may be retried after it
  - If-None-Match needs only the s3:PutObject permission

### Scanning tables in DynamoDB

- ID: `dynamodb-scan`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - One Scan request reads at most 1 MB; the limit and the Limit parameter apply before the filter expression
  - The absence of LastEvaluatedKey is the only way to know the last page was reached; it is passed back as ExclusiveStartKey
  - Read capacity is consumed by the items read, whether or not a filter or projection drops them

### HeadObject (permissions, re-read for chapter 16)

- ID: `s3-head-object-permissions`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - HEAD needs the s3:GetObject permission
  - For a missing object S3 answers 404 if the caller has s3:ListBucket on the bucket and 403 if not

### DynamoDB data export to Amazon S3: how it works

- ID: `dynamodb-export-s3`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Export to S3 exports a table as of any time within its point-in-time recovery window; PITR must be enabled on the table
- Note: Read only to point at the alternative; not used or tried in the chapter.

### Automating Step Functions event delivery with EventBridge

- ID: `sfn-eventbridge`
- URL: <https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Step Functions sends an Execution Status Change event to EventBridge when the status of a Standard workflow execution changes

### What is AWS Batch?

- ID: `batch-what-is`
- URL: <https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - AWS Batch plans, schedules, and runs containerized batch jobs on ECS, EKS, Fargate, and EC2 (Spot or On-Demand), provisioning compute in response to submitted jobs

### AWS Batch: Fargate compute environments

- ID: `batch-fargate`
- URL: <https://docs.aws.amazon.com/batch/latest/userguide/fargate.html>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Batch can run jobs on Fargate without managing instances; Fargate is available only for Batch compute environments that use ECS as the orchestrator

### Cloudflare Workflows

- ID: `cloudflare-workflows`
- URL: <https://developers.cloudflare.com/workflows/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Workflows chain steps with step.do, retry failed steps automatically, and persist state; a WorkflowEntrypoint class defines run(event, step)

### Cloudflare Workflows: Rules of Workflows

- ID: `cloudflare-workflows-rules`
- URL: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - A step might be retried multiple times, so steps should be idempotent
  - A Workflow may hibernate and lose in-memory state; state must be built from step.do return values, and non-deterministic calls belong inside steps

### Cloudflare Workflows: Limits

- ID: `cloudflare-workflows-limits`
- URL: <https://developers.cloudflare.com/workflows/reference/limits/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Wall-clock duration per step is unlimited; CPU time per step is 30 seconds by default on the paid plan, configurable to 5 minutes
  - A step result is at most 1 MiB; a Workflow has at most 10,000 steps by default on the paid plan (1,024 on free)
  - step.sleep can last up to 365 days
  - Workers invoked by Cron Triggers and Durable Object alarm handlers have a 15-minute wall time limit

### Cloudflare Workflows: Pricing

- ID: `cloudflare-workflows-pricing`
- URL: <https://developers.cloudflare.com/workflows/reference/pricing/>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Workflows are billed on CPU time, requests, storage, and steps; a sleeping or waiting Workflow incurs no CPU time
  - Billing for steps and storage started on 2026-08-10; the paid plan includes 500,000 steps a month

### cdkd v0.296.28: providers used by chapter 16 (read from the npm tarball's dist)

- ID: `cdkd-source-long-jobs`
- URL: <https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - Dedicated providers are registered for AWS::StepFunctions::StateMachine, AWS::Scheduler::Schedule, AWS::Lambda::Function, AWS::S3::Bucket, AWS::S3::BucketPolicy, AWS::DynamoDB::Table, AWS::Logs::LogGroup, AWS::IAM::Role, and AWS::IAM::Policy
  - No provider is registered for AWS::Lambda::Version or AWS::Lambda::Alias, so they go through Cloud Control API
  - The Step Functions provider applies DefinitionSubstitutions only to a definition fetched from DefinitionS3Location; an inline DefinitionString or Definition is sent as it is
  - The Lambda function provider passes DurableConfig to CreateFunction and UpdateFunctionConfiguration, and treats adding or removing DurableConfig as a replacement
- Note: Checked in the installed package (dist/program-*.js, provider-classes-*.js, deploy-engine-*.js), not on GitHub.

### aws-cdk-lib 2.273.0: durableConfig and CfnStateMachine (type definitions)

- ID: `aws-cdk-lib-durable`
- URL: <https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0>
- Checked: 2026-10-12
- Chapters: 16
- Claims this source supports:
  - FunctionProps.durableConfig takes { executionTimeout: Duration; retentionPeriod?: Duration } and renders CfnFunction.DurableConfig
  - When no role is passed, a function with durableConfig gets the managed policy AWSLambdaBasicDurableExecutionRolePolicy; with a role of your own, nothing is added
  - CfnStateMachine accepts definitionString, roleArn, and stateMachineType
- Note: Read from aws-lambda/lib/durable-config.d.ts, function.js, and aws-stepfunctions in the installed package.

### Point-in-time backups for DynamoDB

- ID: `dynamodb-pitr`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - Point-in-time recovery gives continuous backups with up to 35 days of recovery points at per-second granularity
  - RecoveryPeriodInDays can be set between 1 and 35 (default 35), and shortening it does not change the price
  - Disabling and re-enabling point-in-time recovery resets the start of the restorable window
  - A table can be restored into a different Region

### Enable point-in-time recovery in DynamoDB

- ID: `dynamodb-pitr-enable`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery_Howitworks.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - PITR is charged on the size of the table, including local secondary indexes, until it is turned off; the recovery period does not affect the price
  - A restore is possible to any point between EarliestRestorableDateTime and LatestRestorableDateTime, and LatestRestorableDateTime is typically five minutes before the current time
  - The point-in-time recovery process always restores to a new table
  - ContinuousBackupsStatus is always ENABLED; whether a table can be restored is PointInTimeRecoveryStatus, which is DISABLED by default
  - Deleting a table that has PITR enabled creates a system backup that is kept for 35 days at no additional cost

### Restoring a DynamoDB table to a point in time

- ID: `dynamodb-pitr-restore`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.Tutorial.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - The source table stays available for reads and writes while the restore runs
  - Restore duration depends on the amount of data and the number of secondary indexes, and no fixed completion time is guaranteed
  - A restore recreates the data, secondary indexes, provisioned capacity, and encryption settings; auto scaling policies, IAM policies, CloudWatch metrics and alarms, tags, stream settings, TTL settings, and point-in-time recovery settings must be set up again by hand
  - While a restore is in progress the table shows as being created with restore in progress, and becomes ACTIVE when it is finished

### RestoreTableToPointInTime

- ID: `dynamodb-api-restore-table-to-point-in-time`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_RestoreTableToPointInTime.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - The request takes SourceTableName, TargetTableName, and either RestoreDateTime or UseLatestRestorableTime
  - Up to 50 restores can run concurrently in an account
  - The settings that are restored come from the current settings of the source table at the time of the restore

### Basic operations on DynamoDB tables

- ID: `dynamodb-table-basics`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - Deletion protection keeps a table from being deleted by anyone while it is enabled
  - Deletion protection is off by default for every table, including global replicas and tables restored from backups

### How DynamoDB global tables work

- ID: `dynamodb-global-tables-how`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - In the default consistency mode, item changes are replicated asynchronously to all other replicas, typically within a second or less
  - Conflicting writes are resolved by last writer wins
  - A TTL delete in one replica is replicated to all other replicas
- Note: The page states delete replication explicitly only for TTL deletes; that a user's DeleteItem replicates is read from 'item changes ... are replicated'.

### Retaining multiple versions of objects with S3 Versioning

- ID: `s3-versioning`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - Each version of an object is the entire object, and normal rates apply for every version stored: three versions are charged as three objects
  - Versioning is disabled by default and must be enabled per bucket

### Working with delete markers

- ID: `s3-delete-markers`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - A DELETE without a version ID in a versioning-enabled bucket does not delete the object: a delete marker becomes the current version
  - A GET without a version ID on a key whose current version is a delete marker returns 404
  - Delete markers are listed only by ListObjectVersions; ListObjectsV2 does not return keys whose current version is a delete marker
  - A delete marker is billed for the size of its key name

### Managing delete markers

- ID: `s3-managing-delete-markers`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManagingDelMarkers.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - To undelete an object, delete its delete marker with a DeleteObject request that names the marker's version ID
  - A DeleteObject without a version ID on a key whose current version is a delete marker removes nothing and adds another delete marker
  - An expired object delete marker is one with no versions left under it, and a lifecycle rule can remove it

### Restoring previous versions

- ID: `s3-restoring-previous-versions`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/RestoringPreviousVersions.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - A previous version is restored either by copying it into the same bucket, which makes the copy the current version and preserves all versions, or by permanently deleting the current version

### ListObjectVersions

- ID: `s3-api-list-object-versions`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - The response lists versions and delete markers as separate elements, each with Key, VersionId, IsLatest, and LastModified
  - A truncated response continues with NextKeyMarker and NextVersionIdMarker

### Lifecycle configuration elements

- ID: `s3-lifecycle-rules`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - NoncurrentVersionExpiration permanently deletes noncurrent versions a number of days after they became noncurrent; they cannot be recovered
  - In a versioning-enabled bucket the Expiration action applies only to the current version and adds a delete marker instead of removing the object
  - ExpiredObjectDeleteMarker removes delete markers that have no versions left

### What does Amazon S3 replicate?

- ID: `s3-replication-what`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - By default only objects created after the replication configuration was added are replicated
  - With the latest configuration version (a rule with a Filter), delete markers are not replicated by default
  - A DELETE that names a version ID is not replicated to the destination
  - Actions performed by a lifecycle configuration are not replicated

### Replicating delete markers between buckets

- ID: `s3-delete-marker-replication`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-marker-replication.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - By default a delete in the source bucket adds a delete marker in the source only
  - With delete marker replication enabled, markers are copied and S3 behaves as if the object was deleted in both buckets

### Event notification types and destinations

- ID: `s3-event-types-versioned`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - s3:ObjectRemoved:Delete is sent when an object is deleted or a versioned object is permanently deleted; s3:ObjectRemoved:DeleteMarkerCreated is sent when a delete marker is created for a versioned object
  - There is a separate s3:LifecycleExpiration:DeleteMarkerCreated event for versioned buckets
- Note: Chapter 08 cites the same page for the event types of an unversioned bucket; this entry records the ones a versioned bucket adds.

### Emptying a general purpose bucket

- ID: `s3-empty-bucket`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/empty-bucket.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - Emptying a bucket with versioning enabled or suspended means deleting all versions of all objects, delete markers included

### Advanced DynamoDB backup

- ID: `backup-advanced-dynamodb`
- URL: <https://docs.aws.amazon.com/aws-backup/latest/devguide/advanced-ddb-backup.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - AWS Backup takes periodic snapshot-based backups of DynamoDB tables; they do not replace or duplicate point-in-time recovery, and using both incurs charges for both
  - A custom role needs AWSBackupServiceRolePolicyForBackup to back up and AWSBackupServiceRolePolicyForRestores to restore
  - Charges for these backups appear under Backup in the bill

### Restore a Amazon DynamoDB table

- ID: `backup-restore-dynamodb`
- URL: <https://docs.aws.amazon.com/aws-backup/latest/devguide/restoring-dynamodb.html>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - Restoring a DynamoDB recovery point from AWS Backup asks for a new table name

### AWS Price List: Amazon DynamoDB, ap-northeast-1 (backup and restore SKUs)

- ID: `aws-price-list-dynamodb-backup`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - APN1-TimedPITRStorage-ByteHrs: USD 0.228 per GB-month of PITR backup storage
  - APN1-RestoreDataSize-Bytes: USD 0.171 per GB of data restored
  - APN1-TimedBackupStorage-ByteHrs: USD 0.114 per GB-month of on-demand backup storage
- Note: Offer publication date 2026-09-11T12:44:22Z.

### AWS Price List: AWS Backup, ap-northeast-1

- ID: `aws-price-list-backup`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBackup/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - APN1-WarmStorage-ByteHrs-DynamoDB: USD 0.114 per GB-month of warm backup storage for DynamoDB
  - APN1-Restore-WarmBytes-DynamoDB: USD 0.171 per GB restored from warm storage for DynamoDB
- Note: Offer publication date 2026-09-28T17:01:20Z.

### Amazon S3 pricing (Replication)

- ID: `s3-pricing-replication`
- URL: <https://aws.amazon.com/s3/pricing/>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - For replication you pay for storage in the destination storage class and for replication PUT requests
  - Inter-region data transfer is charged for Cross-Region Replication; the page lists no data transfer charge for Same-Region Replication
- Note: Read through a fetch tool that returned excerpts, not the full page text.

### @go-to-k/cdkd 0.296.28: help output and bundled dist (import, orphan, DynamoDB provider)

- ID: `cdkd-recovery`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - `cdkd import --resource <logicalId>=<physicalId>` adopts an already-deployed resource into cdkd state; with at least one --resource only the listed resources are imported, and --dry-run shows the plan without writing state
  - `cdkd orphan <construct path>` removes a resource from cdkd state without deleting the AWS resource
  - The DynamoDB table provider applies PointInTimeRecoverySpecification through UpdateContinuousBackups and reads it back with DescribeContinuousBackups, and reads DeletionProtectionEnabled from DescribeTable
  - Deleting a table with deletion protection needs `--remove-protection`; without it the provider does not turn protection off
  - Dedicated providers are registered for AWS::DynamoDB::Table, AWS::S3::Bucket, AWS::S3::BucketPolicy, AWS::IAM::Role, AWS::IAM::Policy, AWS::Lambda::Function, and AWS::Logs::LogGroup; none is registered for the AWS::Backup types
- Note: Read from the installed package: `cdkd import --help`, `cdkd orphan --help`, `cdkd --help`, and the bundled dist/provider-classes and dist/program files. Nothing was run against AWS.

### Cloudflare D1: Time Travel and backups

- ID: `cloudflare-d1-time-travel`
- URL: <https://developers.cloudflare.com/d1/reference/time-travel/>
- Checked: 2026-10-12
- Chapters: 13, 22
- Claims this source supports:
  - Time Travel is always on and restores a database to any minute within the last 30 days (7 days on the Workers Free plan)
  - Database history and restoring incur no additional cost
  - A restore is destructive and overwrites the database in place; in-flight queries are cancelled; the restore returns a bookmark that undoes it
  - Time Travel cannot yet clone or fork a database into a new copy

### Cloudflare R2: S3 API compatibility

- ID: `cloudflare-r2-s3-api`
- URL: <https://developers.cloudflare.com/r2/api/s3/api/>
- Checked: 2026-10-12
- Chapters: 22
- Claims this source supports:
  - The compatibility table marks GetBucketVersioning and PutBucketVersioning as not implemented

### celld source

- ID: `celld-source`
- URL: <https://github.com/denoland/celld>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - The repository describes celld as self-hosted, distributed Durable Objects, under Apache-2.0, owned by denoland
  - On 2026-10-12 the default branch pointed at commit 90b43017241f81189453d326d05948f388b34652, the same commit as the v0.6.2 tag
  - Pull requests are disabled; patches go by email
- Note: Read through the GitHub API (repository, tags, releases, tree) and the raw files of the default branch.

### celld limitations

- ID: `celld-limitations`
- URL: <https://github.com/denoland/celld/blob/main/docs/limitations.md>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - celld v0.6.2 is a beta release
  - A fleet runs one application; there is no account service, multi-tenant scheduler, or managed ingress
  - celld does not terminate TLS; peer traffic is plaintext HTTP, and the fleet HMAC does not encrypt
  - The installer supplies binaries for Linux x86-64, Linux ARM64, and Apple Silicon

### celld security

- ID: `celld-security`
- URL: <https://github.com/denoland/celld/blob/main/docs/security.md>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - v0.6.2 is a beta release, not safe for hostile multi-tenant use; only the latest release receives security fixes
  - celld opens two HTTP listeners and terminates TLS on neither; --internal-listen serves the peer protocol and the operator API
  - Most operator routes on the internal listener have no request authentication, including POST /shutdown and /state
  - The public listener reserves only /.well-known/celld/health: 200 with {"ok":true} when healthy, 503 otherwise
  - The fleet bucket is the root of authority; a holder of the bucket credentials controls the fleet
  - The operator API is an alpha interface; a release can change its paths or response formats

### celld guarantees

- ID: `celld-guarantees`
- URL: <https://celld.dev/docs/guarantees/>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - The page exists and carries the same guarantees text as docs/guarantees.md in the repository
- Note: Read through a summarizing fetch; the claims this chapter relies on are taken from the repository file at the v0.6.2 tag (celld-guarantees-v062).

### celld documentation

- ID: `celld-docs`
- URL: <https://celld.dev/docs/>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - The documentation site lists pages for limitations, security, guarantees, testing, telemetry, Cloudflare compatibility, and one page per service
- Note: Read through a summarizing fetch; the claims this chapter relies on are taken from the repository files at the v0.6.2 tag.

### celld v0.6.2: README

- ID: `celld-readme-v062`
- URL: <https://github.com/denoland/celld/blob/v0.6.2/README.md>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - celld runs a Cloudflare Workers application on your own machines and stores long-term state in an S3-compatible, Google Cloud Storage, or Azure Blob Storage bucket
  - A node is one celld process; nodes that share one bucket are a fleet; a conditional bucket write gives a node the ownership of a cell
  - celld uses the standard AWS credential chain; a node is started with --bucket, --listen, --internal-listen, and --advertise
  - The container example sets CELLD_WATCH to a directory on a persistent volume
  - One node proves each write through the bucket; with a second node the write finishes once that node holds it on disk
  - Put every advertised address on a trusted private network or an encrypted overlay; celld rejects a literal public IP unless --unsafe-public-advertise is given
  - Treat access to the bucket and its credentials as fleet administrator access
  - The installer downloads the binary from GitHub releases; provenance is verifiable with gh attestation verify

### celld v0.6.2: documentation (operate, shut down, upgrade notes, environment variables)

- ID: `celld-docs-v062`
- URL: <https://github.com/denoland/celld/blob/v0.6.2/docs/README.md>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - CELLD_DURABILITY defaults to fleet; a one-node fleet waits for the bucket on every write; a fleet that loses all but one node falls back to the bucket and stays correct
  - celld shuts down gracefully on SIGTERM or SIGINT: health reports 503, accepted requests finish, and the node hands its cells off to a peer; POST /shutdown on the internal listener starts the same handoff
  - CELLD_SHUTDOWN_TOTAL_MS defaults to 40000; the orchestrator stop grace (systemd TimeoutStopSec) must be above it or SIGKILL can interrupt the handoff
  - To roll out a new version: stop each node with SIGTERM, wait for its replacement to report healthy, then move to the next node
  - During a rolling update, wait for restoring=0 on every node (celld diagnose) before restarting the next
  - A new process does not report healthy until the fleet settles; CELLD_READY_FLEET_GATE_MS defaults to 120000
  - Upgrade notes: v0.1.0 to v0.2.0 stop all; v0.2.1 to v0.3.0 rolling; v0.3.0 to v0.4.0 stop all; v0.4.0 to v0.4.1 rolling; v0.5.1 to v0.6.0 stop all with fleet durability; v0.6.0 to v0.6.1 rolling; v0.6.1 to v0.6.2 rolling
  - The node lease lives CELLD_TTL_MS (default 10000) and renews at one third of that; the fleet sample is read every CELLD_REBALANCE_INTERVAL_MS (default 5000); deploy/current.json is read every CELLD_DEPLOY_POLL_S (default 30)
  - CELLD_BUCKET, AWS_REGION, CELLD_ADDR, CELLD_INTERNAL_ADDR, CELLD_ADVERTISE, and CELLD_WATCH are the environment forms of the node settings; CELLD_NODE is an explicit node-session ID
  - A bucket value can add a key prefix (s3://BUCKET/PREFIX)
  - celld deploy needs esbuild on PATH for Worker code; CELLD_ESBUILD overrides the path; a running node adopts a new deployment without a restart
  - celld diagnose reads the node leases and probes each live peer without taking a lease; celld cell list prints one Class:ID scope per line
  - One 8 GB node holds 1,000 resident cells
  - celld does not scale itself; an external system starts and stops the nodes

### celld v0.6.2: what celld guarantees

- ID: `celld-guarantees-v062`
- URL: <https://github.com/denoland/celld/blob/v0.6.2/docs/guarantees.md>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - Two promises: exactly one node serves a cell at a time, and an acknowledged write is never lost; both require a bucket with working conditional writes and ranged reads, and a supervisor that restarts the process
  - The qualified stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage, and Azure Blob Storage; the release tests run against R2, and the S3 path uses the same client and headers
  - The supervisor must restart without an attempt limit and wait at least one lease lifetime between attempts
  - Each cell has one ownership record in the bucket, naming the owner's session and a fencing epoch, acquired by conditional create or compare-and-swap
  - In fleet mode the owner sends each write to one or two followers and every follower must fsync it; a fleet needs two running nodes for a fleet proof; a fleet of three or more holds three copies of an acknowledged write
  - In fleet mode celld can acknowledge a write before its bucket upload completes; a follower disk can hold acknowledged writes that the bucket does not yet hold
  - Recovery limits: a follower's HTTP error can block recovery and startup; a deleted final batch is undetectable if nothing later records its range; a mixed-version tail can stall recovery
  - A node whose lease expires fences itself, logs a line starting with SELF-FENCE:, and exits with code 3; only a restart returns it
  - celld reserves the key prefixes probe/, cells/, nodes/, node-cells/, fleet/, deploy/, deploy-blobs/, log/, wake/, and telemetry/
  - The v0.4.1 upgrade procedure: stop every node and wait for every lease to expire, back up the bucket and node data keeping node names, peer addresses, and data directories; to roll back, restore the full stopped-fleet backup, which loses writes made after it
  - Each node runs the storage test (four conditional writes and a ranged read) before it serves, and cannot disable it

### celld v0.6.2: testing

- ID: `celld-testing-v062`
- URL: <https://github.com/denoland/celld/blob/v0.6.2/docs/testing.md>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - The coordination protocol is specified in TLA+ and exercised by deterministic simulation; the model grants a linearizable object store
  - Live-fleet fault scenarios include SIGKILL mid-write-stream, freezing an owner, cutting a node off from the bucket, and stopping a host; a verification pass fetches each cell through different nodes
  - A cell can be briefly unavailable while ownership moves
  - A fleet at its resident limit has no space for a lost node's cells

### celld releases (GitHub API)

- ID: `celld-releases`
- URL: <https://api.github.com/repos/denoland/celld/releases>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - v0.6.2 was published 2026-10-07 and is the latest of 11 releases; none is marked prerelease
  - Each release carries celld-aarch64-unknown-linux-gnu.gz, celld-x86_64-unknown-linux-gnu.gz, and celld-aarch64-apple-darwin.gz with a sha256 digest
  - v0.6.2 release notes: upgrading from v0.6.1 can use a rolling update
- Note: The six archives of v0.6.2 and v0.6.1 were downloaded on 2026-10-12 and their SHA-256 matched the published digests. None was unpacked or run.

### celld installer script

- ID: `celld-install-script`
- URL: <https://celld.dev/install.sh>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - The installer downloads celld-<target>.gz from the GitHub release named by CELLD_VERSION, decompresses it, and switches one symlink
  - It relies on gzip's CRC for corruption and on the release attestation for provenance; it carries no checksum of its own
- Note: Read as text, not run.

### celld v0.6.2: source (cli, fleet diagnostics, bucket client)

- ID: `celld-source-v062`
- URL: <https://github.com/denoland/celld/tree/v0.6.2/crates/celld>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - main/cli.rs: with no arguments and CELLD_BUCKET set, celld runs a node from the environment; the help text lists the flags and variables
  - main/cli.rs: celld diagnose accepts --json, --read-only, and --peer
  - fleet.rs: a diagnose row is {verdict, check, detail}; a live peer is 'peer <node> at <addr>' with restoring=<n> in the detail; an expired lease is a skip row
  - main.rs: without CELLD_WATCH the data directory is a celld-<pid> directory under the system temporary directory; without CELLD_NODE the node-session ID is random
  - bucket.rs: large writes go through multipart upload
  - protocol.rs documents the deployment objects only; the ownership record format is not a documented interface
- Note: Read as text at the tag. Nothing was compiled or run.

### celld v0.6.2: counter example

- ID: `celld-example-counter`
- URL: <https://github.com/denoland/celld/tree/v0.6.2/examples/counter>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - One Durable Object class, Counter; the Worker picks the instance from the ?name= query parameter
  - Every request reads n, adds 1, stores it, and answers JSON {n, url}

### StopInstances (Amazon EC2 API reference)

- ID: `ec2-api-stop-instances`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_StopInstances.html>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - By default a stop includes a graceful OS shutdown; SkipOsShutdown bypasses it and might result in data loss or skipped shutdown scripts
  - Force first attempts a graceful shutdown
  - A stopped instance retains its root volume and data volumes, and volume usage is still charged

### Data protection in Amazon EC2

- ID: `ec2-data-protection-transit`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - Some instance types automatically encrypt in-transit traffic between instances in the same VPC; the list includes M7g, C7g, and R7g and does not include T4g
  - All traffic between Availability Zones is encrypted at the physical layer
  - It is the customer's responsibility to use an encryption protocol such as TLS for sensitive data in transit

### Use instance metadata to manage your EC2 instance

- ID: `ec2-instance-metadata-categories`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - local-ipv4 is the private IPv4 address of the instance (the device with device number 0)

### Access instance metadata for an EC2 instance

- ID: `ec2-imds-retrieval`
- URL: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - IMDSv2: a PUT to /latest/api/token with X-aws-ec2-metadata-token-ttl-seconds returns a token; requests then send X-aws-ec2-metadata-token
  - User data is limited to 16 KB before base64 encoding
  - With curl -f, an IMDS error becomes a non-zero exit

### Uploading and copying objects using multipart upload in Amazon S3

- ID: `s3-mpu-permissions`
- URL: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - Creating, uploading parts of, and completing a multipart upload need s3:PutObject; stopping one needs s3:AbortMultipartUpload
  - Parts of an upload that was never completed or stopped are billed; a lifecycle rule with AbortIncompleteMultipartUpload removes them

### aws s3 sync (AWS CLI reference)

- ID: `aws-cli-s3-sync`
- URL: <https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - sync recursively copies new and updated files from the source to the destination
  - --delete removes files that exist in the destination but not in the source; --dryrun displays the operations without running them

### systemd v252: systemd.service(5), Restart= and RestartSec=

- ID: `systemd-service-restart-always`
- URL: <https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - Restart=always restarts the service whether it exited cleanly, was terminated by a signal, or hit a timeout
  - RestartSec= is the time to sleep before restarting; it defaults to 100ms
- Note: The systemd version on Amazon Linux 2023 was not checked on an instance.

### systemd v252: systemd.unit(5), StartLimitIntervalSec=

- ID: `systemd-unit-start-limit-off`
- URL: <https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - StartLimitIntervalSec= may be set to 0 to disable any kind of rate limiting
  - A unit configured for Restart= that reaches the start limit is not restarted any more
- Note: The systemd version on Amazon Linux 2023 was not checked on an instance.

### @go-to-k/cdkd 0.296.28 (npm package, dist)

- ID: `cdkd-package-0-296-28`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-12
- Chapters: 24
- Claims this source supports:
  - AWS::EC2::SecurityGroupIngress is registered with the EC2 provider; its handled properties include GroupId, IpProtocol, FromPort, ToPort, Description, and SourceSecurityGroupId
  - AWS::EC2::SecurityGroupEgress is not registered
  - The S3 bucket provider handles LifecycleConfiguration, OwnershipControls, PublicAccessBlockConfiguration, and BucketEncryption
- Note: Read from the installed package's dist directory. Nothing was run against AWS.

### Inference using Converse API

- ID: `bedrock-converse`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Converse needs bedrock:InvokeModel; ConverseStream needs bedrock:InvokeModelWithResponseStream
  - Order of ConverseStream events: messageStart, content block events, messageStop (with stopReason), metadata (usage and metrics)
  - contentBlockStart is sent for tool use only; a text delta is {contentBlockDelta: {delta: {text}, contentBlockIndex}}
  - Shape of a Converse response: output.message.content[].text, stopReason, usage, metrics

### ConverseStream (API reference)

- ID: `bedrock-converse-stream-api`
- URL: <https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Request fields modelId, messages, system, inferenceConfig.maxTokens
  - modelId accepts a base model ID or an inference profile ID
  - Stream members include internalServerException (500), modelStreamErrorException (424), serviceUnavailableException (503), throttlingException (429), validationException (400)
  - Errors: AccessDeniedException 403, ModelErrorException 424, ModelNotReadyException 429, ModelTimeoutException 408, ResourceNotFoundException 404, ServiceUnavailableException 503, ThrottlingException 429, ValidationException 400
  - The AWS CLI does not support ConverseStream

### MessageStopEvent (API reference)

- ID: `bedrock-message-stop-event`
- URL: <https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - stopReason values: end_turn, tool_use, max_tokens, stop_sequence, guardrail_intervened, content_filtered, malformed_model_output, malformed_tool_use, model_context_window_exceeded

### Request access to models

- ID: `bedrock-model-access`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Access to many foundation models is enabled by default; there is no per-model request step in commercial Regions
  - The first invocation of a third-party model starts an AWS Marketplace subscription, which needs aws-marketplace:Subscribe, Unsubscribe, and ViewSubscriptions and can take up to 15 minutes
  - Anthropic models need a one-time use case form per account or organization before the first call
  - Amazon models are not sold through AWS Marketplace
  - After a model is enabled, callers no longer need the Marketplace permissions

### Route model inference requests across AWS Regions with cross-Region inference

- ID: `bedrock-cross-region-inference`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - A geographic profile routes within a geography; a global profile routes to any commercial Region
  - No additional routing cost; the price is that of the Region the profile is called from
  - CloudTrail logs the request in the source Region with additionalEventData.inferenceRegion

### Supported Regions and models for inference profiles

- ID: `bedrock-inference-profiles-support`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Profile IDs and destination Regions are documented on each model's card
  - GetInferenceProfile lists the destination Regions of a profile as seen from one source Region
  - Do not infer the destinations from the geographic prefix of the profile ID alone

### Prerequisites for inference profiles

- ID: `bedrock-inference-profiles-prereq`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - A policy that names an inference profile must also name the foundation model in each Region associated with it
  - The bedrock:InferenceProfileArn condition key limits a foundation-model statement to calls made through one profile
  - The example for a global profile names the model in the source Region and with an empty Region

### Model card: Amazon Nova 2 Lite

- ID: `bedrock-model-card-nova-2-lite`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Model ID amazon.nova-2-lite-v1:0; profiles jp.amazon.nova-2-lite-v1:0 and global.amazon.nova-2-lite-v1:0
  - From ap-northeast-1 the model is offered through Geo and Global profiles, not In-Region
  - jp.amazon.nova-2-lite-v1:0 called from ap-northeast-1 routes to ap-northeast-1 and ap-northeast-3
  - Supports Converse and response streaming; max output 64K tokens

### Model card: Anthropic Claude Haiku 4.5

- ID: `bedrock-model-card-claude-haiku-4-5`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - On bedrock-runtime the model needs a geo or global inference profile ID; the bare model ID is not supported for on-demand use
  - jp.anthropic.claude-haiku-4-5-20251001-v1:0 called from ap-northeast-1 routes to ap-northeast-1 and ap-northeast-3
  - Billed through AWS Marketplace; EOL no sooner than 2026-10-16

### Troubleshooting Amazon Bedrock API Error Codes

- ID: `bedrock-troubleshooting-errors`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - ThrottlingException (429) means the account quota was exceeded; retry with exponential backoff and jitter, or request a quota increase
  - ServiceUnavailable (503) is capacity, not the account quota
  - A missing Anthropic use case form answers 404

### Quotas for Amazon Bedrock

- ID: `bedrock-quotas`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Model inference is controlled by per-model quotas on token usage
  - The quotas that apply to an account can be lower than the published defaults; Service Quotas shows the applied values

### Response streaming for Lambda functions

- ID: `lambda-response-streaming`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html>
- Checked: 2026-10-11
- Chapters: 09, 17
- Claims this source supports:
  - Streaming is available through function URLs, InvokeWithResponseStream, and API Gateway proxy integrations
  - A streamed response is not interrupted when the client disconnects, and the full function duration is billed
  - Node.js managed runtimes support response streaming natively
  - Streamed payloads can be up to 200 MB; the first 6 MB is not rate limited
  - Function URLs do not support response streaming for a function in a VPC

### Writing response streaming-enabled Lambda functions

- ID: `lambda-response-streaming-write`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html>
- Checked: 2026-10-12
- Chapters: 17
- Claims this source supports:
  - A streaming handler is wrapped in awslambda.streamifyResponse, a global the Node.js runtime on Lambda provides
  - The response stream is a Node.js writable stream; pipeline() is recommended for writing to it, and it ends the stream
  - The page does not describe awslambda.HttpResponseStream.from or the keys of the object passed to it

### Control access to Lambda function URLs

- ID: `lambda-urls-auth`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html>
- Checked: 2026-10-11
- Chapters: 09, 17
- Claims this source supports:
  - AuthType is AWS_IAM or NONE
  - With AWS_IAM, a caller in the same account needs lambda:InvokeFunctionUrl and lambda:InvokeFunction in an identity policy or in the function's resource-based policy
  - With NONE, anyone with the URL can invoke the function once the resource-based policy grants public access

### Stream the integration response for your proxy integrations in API Gateway

- ID: `apigw-response-streaming`
- URL: <https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Response streaming is supported for REST APIs only, with responseTransferMode STREAM on proxy integrations
  - Streams run up to 15 minutes; idle timeout is 5 minutes for Regional endpoints
  - The Lambda function may keep running after the connection closes

### Restrict access to an AWS Lambda function URL origin

- ID: `cloudfront-oac-lambda-url`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - CloudFront origin access control signs requests to a function URL whose AuthType is AWS_IAM
  - For POST and PUT the client must send the SHA-256 of the body in x-amz-content-sha256

### AWS Lambda pricing (response streaming)

- ID: `lambda-pricing-streaming`
- URL: <https://aws.amazon.com/lambda/pricing/>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - The first 6 MB streamed per request is free
  - The page lists no separate charge for function URLs
- Note: Same page as lambda-pricing, re-read for chapter 17.

### AWS Price List: Amazon Bedrock, ap-northeast-1

- ID: `aws-price-list-bedrock`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Nova 2.0 Lite in Tokyo: USD 0.000396 per 1K input tokens, USD 0.003311 per 1K output tokens
  - Nova 2.0 Lite through the global profile from Tokyo: USD 0.00036 and USD 0.00301 per 1K tokens
- Note: The offer has a plain row and a `cross-region-global` row. It has no row named for the jp. profile; the chapter applies the plain row to it, following the user guide's statement that the price is that of the calling Region.

### AWS Price List: Amazon Bedrock foundation models (Marketplace), ap-northeast-1

- ID: `aws-price-list-bedrock-fm`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Claude Haiku 4.5 in Tokyo, Regional: USD 1.10 per 1M input tokens, USD 5.50 per 1M output tokens

### Cloudflare Workers AI: Get started

- ID: `cloudflare-workers-ai-quickstart`
- URL: <https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Workers AI always accesses your Cloudflare account to run models and incurs usage charges even in local development
  - A Worker calls a model as env.AI.run("@cf/...", {...})

### Cloudflare Workers AI: Bindings

- ID: `cloudflare-workers-ai-bindings`
- URL: <https://developers.cloudflare.com/workers-ai/configuration/bindings/>
- Checked: 2026-10-11
- Chapters: 00, 17
- Claims this source supports:
  - The AI binding is declared in the wrangler configuration and called as env.AI.run(model, options)
  - `stream: true` returns results as a text/event-stream
- Note: This page says nothing about local development or charges; that claim rests on cloudflare-workers-ai-quickstart and cloudflare-bindings-per-env.

### Cloudflare Workers: Supported bindings per development mode

- ID: `cloudflare-bindings-per-env`
- URL: <https://developers.cloudflare.com/workers/development-testing/bindings-per-env/>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - The AI binding has no local simulation; it connects to the remote service during local development

### Cloudflare Workers AI: Pricing

- ID: `cloudflare-workers-ai-pricing`
- URL: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - Billing unit is Neurons: 10,000 per day free, then USD 0.011 per 1,000 Neurons on the Workers Paid plan
  - LLM prices are also listed per million input and output tokens for each model

### hono 4.13.13 (published package)

- ID: `hono-npm`
- URL: <https://www.npmjs.com/package/hono/v/4.13.13>
- Checked: 2026-10-12
- Chapters: 17
- Claims this source supports:
  - streamHandle in hono/aws-lambda passes { statusCode, headers, cookies } to awslambda.HttpResponseStream.from, then pipes the response body into the stream it returns
  - streamHandle writes an empty string to the stream when the response has no body
- Note: No longer a dependency of the example. Read from dist/adapter/aws-lambda/handler.js of the package as it was installed, as the only available evidence for the keys of the prelude: the Lambda documentation pages checked do not describe them. Not run on Lambda.

### @types/aws-lambda 8.10.164 (published package)

- ID: `types-aws-lambda-npm`
- URL: <https://www.npmjs.com/package/@types/aws-lambda/v/8.10.164>
- Checked: 2026-10-12
- Chapters: 17
- Claims this source supports:
  - Declares the global namespace awslambda with streamifyResponse(handler) and HttpResponseStream.from(writable, metadata)
  - LambdaFunctionURLEvent is an alias of APIGatewayProxyEventV2
- Note: Read from handler.d.ts and trigger/lambda-function-url.d.ts of the installed package. The metadata parameter is typed Record<string, unknown>, so the types do not say which keys Lambda reads.

### @aws-sdk/client-bedrock-runtime 3.1149.0 (published package)

- ID: `aws-sdk-bedrock-runtime-npm`
- URL: <https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0>
- Checked: 2026-10-11
- Chapters: 17
- Claims this source supports:
  - ConverseStreamCommand returns `stream`, an async iterable of ConverseStreamOutput
  - An exception message in the event stream is thrown by the iterator as an error named after the exception
  - The default retry strategy makes up to 3 attempts
- Note: Read from the type definitions and from @smithy/core 3.35.2 (event-streams getUnmarshalledStream.js, DEFAULT_MAX_ATTEMPTS) in the installed packages. No request was sent.

### Troubleshoot IAM: Changes that I make are not always immediately visible

- ID: `iam-eventual-consistency`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - IAM uses a distributed computing model called eventual consistency; changes take time to become visible from all possible endpoints
  - IAM also uses caching, so a change might not be visible until previously cached data times out
  - AWS recommends not including IAM changes in critical, high-availability code paths, and verifying that changes have propagated before production workflows depend on them

### Security best practices in IAM

- ID: `iam-best-practices`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html>
- Checked: 2026-10-12
- Chapters: 01, 21
- Claims this source supports:
  - Human users should use federation and temporary credentials; workloads should use IAM roles
  - Apply least-privilege permissions: grant only the permissions required to perform a task
  - Get started with AWS managed policies and move toward least-privilege permissions
  - Use IAM Access Analyzer to generate least-privilege policies based on access activity
  - Establish permissions guardrails across multiple accounts

### IAM Access Analyzer policy generation

- ID: `iam-access-analyzer-policy-generation`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - IAM Access Analyzer reviews CloudTrail logs and generates a policy template containing the permissions an entity used
  - You specify a time period of up to 90 days, and the CloudTrail trail that is logging events for the account

### Policy evaluation logic

- ID: `iam-policy-evaluation-logic`
- URL: <https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - An explicit deny in any policy overrides an allow
  - With SCPs, the resulting permissions are the intersection of the identity's policies and the service control policies

### AWS service reference (secretsmanager, kms, cloudtrail, guardduty, config, organizations, inspector2, iam, cloudformation, logs)

- ID: `aws-service-reference-security`
- URL: <https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - secretsmanager:GetSecretValue, PutSecretValue, and ListSecretVersionIds take the Secret resource type; kms:Decrypt takes the key resource type
  - The action names used in the SCP exist: organizations:LeaveOrganization, cloudtrail:StopLogging, DeleteTrail, UpdateTrail, PutEventSelectors, guardduty:DeleteDetector, DisassociateFromAdministratorAccount, config:StopConfigurationRecorder, DeleteConfigurationRecorder, DeleteDeliveryChannel
  - The five actions chapter 20 leaves on Resource "*" list no resource type: cloudformation:DescribeStackDriftDetectionStatus, cloudformation:BatchDescribeTypeConfigurations, logs:DescribeLogGroups, logs:DescribeIndexPolicies, logs:DescribeResourcePolicies
- Note: Same URL pattern per service: /v1/<service>/<service>.json.

### Resources that you can protect with AWS WAF

- ID: `waf-protectable-resources`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - A web ACL can be associated with CloudFront distributions and, regionally, with API Gateway REST APIs, Application Load Balancers, AppSync GraphQL APIs, Cognito user pools, App Runner services, Bedrock AgentCore Gateway, Verified Access instances, and Amplify; API Gateway HTTP APIs and Lambda function URLs are not in the list
  - For CloudFront, the web ACL and everything it uses must be created in US East (N. Virginia)
  - Each resource can have one web ACL; a web ACL associated with CloudFront distributions cannot be associated with other resource types

### Using rate-based rule statements in AWS WAF

- ID: `waf-rate-based-statement`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - A rate-based rule costs 2 WCUs as a base
  - Each use of a rate-based rule is tracked separately

### Rate-based rule caveats in AWS WAF

- ID: `waf-rate-based-caveats`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS WAF applies rate limiting near the limit that you set, but does not guarantee an exact limit match
  - Requests can come in at too high a rate for up to several minutes before AWS WAF detects and rate limits them; usually the delay is below 30 seconds
  - Changing a rate limit setting resets the rule's counts and can pause rate limiting for up to a minute

### Baseline rule groups (AWS Managed Rules)

- ID: `waf-managed-baseline`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWSManagedRulesCommonRuleSet uses 700 WCUs
  - Its SizeRestrictions_BODY rule blocks request bodies over 8 KB
  - For CloudFront the default body inspection limit is 16 KB, and can be raised to 64 KB

### IP reputation rule groups (AWS Managed Rules)

- ID: `waf-managed-ip-reputation`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWSManagedRulesAmazonIpReputationList uses 25 WCUs

### Web ACL capacity units (WCUs) in AWS WAF

- ID: `waf-capacity-units`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The basic price for a web ACL includes up to 1,500 WCUs; using more incurs additional fees
  - The maximum capacity for a web ACL is 5,000 WCUs

### Testing and tuning your AWS WAF protections

- ID: `waf-testing`
- URL: <https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-testing.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS recommends testing and tuning rules in count mode with production traffic before enabling them

### AWS::WAFv2::WebACL

- ID: `cfn-wafv2-webacl`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Scope is CLOUDFRONT or REGIONAL; for CLOUDFRONT the resource must be created in us-east-1
  - DefaultAction, Scope, and VisibilityConfig are required

### AWS::WAFv2::WebACL RateBasedStatement

- ID: `cfn-wafv2-ratebasedstatement`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Limit has a minimum of 10
  - EvaluationWindowSec may be 60, 120, 300, or 600, and defaults to 300
  - AWS WAF checks the rate about every 10 seconds

### Use AWS WAF protections (CloudFront)

- ID: `cloudfront-waf`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-awswaf.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS WAF can be enabled on a distribution with one-click protection in the CloudFront console or with a preconfigured web ACL

### Restrict access to an AWS Lambda function URL origin

- ID: `cloudfront-oac-lambda-security`
- URL: <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - With origin access control, PUT and POST requests need the SHA-256 of the body in the x-amz-content-sha256 header, supplied by the caller
  - CloudFront signs an origin request by adding its own Authorization header; the no-override setting passes the viewer's Authorization header through instead

### AWS Price List: AWS WAF

- ID: `aws-price-list-waf`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Global-WebACLV2: USD 5.00 per web ACL per month, prorated hourly
  - Global-RuleV2: USD 1.00 per rule per month, prorated hourly
  - Global-RequestV2-Tier1: USD 0.60 per million requests
  - The same three prices appear under the ap-northeast-1 and us-east-1 usage types
- Note: Which usage type a CLOUDFRONT-scope web ACL is metered under was not confirmed on a bill; the Global-* SKUs are described as being for CloudFront.

### What's in a Secrets Manager secret?

- ID: `secretsmanager-secret`
- URL: <https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - A secret has versions; Secrets Manager tracks three by staging label: AWSCURRENT, AWSPREVIOUS, and AWSPENDING
  - A secret always has a version labeled AWSCURRENT, and that version is returned by default
  - Unlabeled versions are deprecated and removed when there are more than 100; versions created less than 24 hours ago are not removed
  - The secret ARN ends in six random characters, so a secret re-created under the same name has a different ARN

### PutSecretValue

- ID: `secretsmanager-put-secret-value`
- URL: <https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Without VersionStages, AWSCURRENT moves to the new version and AWSPREVIOUS moves to the version AWSCURRENT was removed from
  - The operation is idempotent: the same ClientRequestToken with the same secret data succeeds and does nothing; with different data it fails
  - ClientRequestToken becomes the VersionId of the new version
  - Do not call PutSecretValue at a sustained rate of more than once every 10 minutes

### GetSecretValue

- ID: `secretsmanager-get-secret-value`
- URL: <https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - VersionStage selects a version by staging label; without it AWSCURRENT is returned
  - AWS recommends caching secret values on the client to improve speed and reduce cost
  - With a customer managed key the caller also needs kms:Decrypt on that key

### DeleteSecret

- ID: `secretsmanager-delete-secret`
- URL: <https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - A deleted secret has a recovery window: minimum 7 days, default 30 days
  - While scheduled for deletion, the secret value cannot be retrieved

### AWS Secrets Manager best practices

- ID: `secretsmanager-best-practices`
- URL: <https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The supported caching components are for Java, Python, .NET, Go, and Rust, plus the AWS Parameters and Secrets Lambda Extension; none is listed for JavaScript

### Rotation by Lambda function

- ID: `secretsmanager-rotation-lambda`
- URL: <https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - A rotation function has four steps: createSecret, setSecret, testSecret, finishSecret
  - Secrets Manager uses staging labels to identify versions during rotation

### AWS Secrets Manager pricing

- ID: `secretsmanager-pricing`
- URL: <https://aws.amazon.com/secrets-manager/pricing/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Secrets are billed per secret per month, prorated by the hour for secrets stored less than a month
  - A replica secret is billed as a distinct secret

### AWS Price List: AWS Secrets Manager (ap-northeast-1)

- ID: `aws-price-list-secretsmanager`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - USD 0.40 per secret per month
  - USD 0.05 per 10,000 API requests

### AWS::SecretsManager::Secret

- ID: `cfn-secretsmanager-secret`
- URL: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - GenerateSecretString generates the value; SecretString sets a specific one
  - Without KmsKeyId, Secrets Manager uses the key aws/secretsmanager

### Working with Lambda environment variables

- ID: `lambda-env-vars-secrets`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS recommends Secrets Manager instead of environment variables for database credentials, API keys, and authorization tokens

### Use Secrets Manager secrets in Lambda functions

- ID: `lambda-secrets-manager`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS describes two ready-made approaches: the AWS Parameters and Secrets Lambda Extension and the Powertools for AWS Lambda parameters utility; both keep a local cache
  - The extension caches secrets for 300 seconds by default

### AWS KMS keys

- ID: `kms-concepts`
- URL: <https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Customer managed keys carry a monthly fee and a per-use fee; AWS managed keys carry no monthly fee
  - AWS managed keys are created, managed, and used on your behalf by an AWS service; they rotate every year
  - Unless you are required to control the key, an AWS managed key is a good choice

### Rotate AWS KMS keys

- ID: `kms-rotate-keys`
- URL: <https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - With automatic rotation enabled, AWS KMS generates new key material every year by default
  - AWS KMS charges a monthly fee for the first and second rotation of key material; the increase is capped at the second rotation

### Delete an AWS KMS key

- ID: `kms-deleting-keys`
- URL: <https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Deleting a KMS key requires a waiting period of 7 to 30 days; the default is 30
  - A key pending deletion cannot be used in any cryptographic operation
  - Deletion can be cancelled before the waiting period ends, and not after

### AWS KMS pricing

- ID: `kms-pricing`
- URL: <https://aws.amazon.com/kms/pricing/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Each KMS key you create costs USD 1 a month, prorated hourly
  - The first and second rotation of a key each add USD 1 a month
  - AWS KMS provides a free tier of 20,000 requests a month, calculated across all Regions
  - There is no charge for creating and storing AWS managed keys

### AWS Price List: AWS KMS (ap-northeast-1)

- ID: `aws-price-list-kms`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - USD 1 per customer managed KMS key version per month
  - USD 0.03 per 10,000 requests
  - A Global-KMS-Requests SKU at USD 0 covers the first 20,000 requests a month

### What is Amazon GuardDuty?

- ID: `guardduty-what-is`
- URL: <https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - GuardDuty is a threat detection service that monitors and analyzes AWS data sources and logs
  - It detects, for example, compromised credentials, cryptomining, and unusual login patterns
  - Foundational threat detection starts ingesting CloudTrail events, VPC flow logs, and DNS logs when GuardDuty is enabled

### Getting started with GuardDuty

- ID: `guardduty-getting-started`
- URL: <https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_settingup.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Enabling GuardDuty for the first time in a Region also enables, by default, all protection types available in that Region
  - AWS recommends enabling GuardDuty in all supported Regions

### Monitoring GuardDuty usage and estimating costs

- ID: `guardduty-costs`
- URL: <https://docs.aws.amazon.com/guardduty/latest/ug/monitoring_costs.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - GuardDuty offers a 30-day free trial per account for most protection plans
  - Usage and estimated cost can be monitored in the GuardDuty console

### AWS Price List: Amazon GuardDuty (ap-northeast-1)

- ID: `aws-price-list-guardduty`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - USD 0.00000472 per CloudTrail event analyzed (USD 4.72 per million)

### What is Amazon Inspector?

- ID: `inspector-what-is`
- URL: <https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Inspector is a vulnerability management service that scans workloads for software vulnerabilities and unintended network exposure
  - It scans EC2 instances, container images in ECR, and Lambda functions

### Scanning AWS Lambda functions with Amazon Inspector

- ID: `inspector-scanning-lambda`
- URL: <https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Lambda standard scanning checks application dependencies for package vulnerabilities; code scanning is a separate, optional type
  - On activation Inspector scans functions invoked or updated in the last 90 days, and rescans on deploys and when a new CVE is added
  - Inspector does not scan Lambda functions encrypted with customer managed keys

### Getting started with Amazon Inspector

- ID: `inspector-getting-started`
- URL: <https://docs.aws.amazon.com/inspector/latest/user/getting_started_tutorial.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Activating Inspector for a standalone account in the console activates all scan types by default

### Amazon Inspector pricing

- ID: `inspector-pricing`
- URL: <https://aws.amazon.com/inspector/pricing/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Accounts new to Inspector get a 15-day free trial
  - Lambda standard scanning is billed per function, prorated by coverage hours

### AWS Price List: Amazon Inspector (ap-northeast-1)

- ID: `aws-price-list-inspector`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Lambda standard scanning: USD 0.0005 per function-hour

### Working with CloudTrail event history

- ID: `cloudtrail-event-history`
- URL: <https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - CloudTrail is enabled by default; event history holds the past 90 days of management events in a Region
  - Event history is immutable, and there is no CloudTrail charge for viewing it

### CloudTrail concepts

- ID: `cloudtrail-concepts`
- URL: <https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Events created by CloudFront, IAM, and AWS STS are recorded in us-east-1
  - Event history and lookup-events show global service events in the Region where they occurred

### LookupEvents

- ID: `cloudtrail-lookup-events`
- URL: <https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Looks up management events from the last 90 days in a Region
  - At most 50 results per call; lookup requests are limited to two per second per account per Region

### AWS CloudTrail pricing

- ID: `cloudtrail-pricing`
- URL: <https://aws.amazon.com/cloudtrail/pricing/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The 90-day event history is available at no additional cost
  - One copy of ongoing management events can be delivered to S3 for free by creating a trail; additional copies cost USD 2.00 per 100,000 events

### What is AWS Config?

- ID: `config-what-is`
- URL: <https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS Config records the configuration of resources and how configurations and relationships change over time

### AWS Config pricing

- ID: `config-pricing`
- URL: <https://aws.amazon.com/config/pricing/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - You pay per configuration item delivered, per account per Region
  - Recording can be continuous or periodic (once every 24 hours, only if a change occurred)

### AWS Price List: AWS Config (ap-northeast-1)

- ID: `aws-price-list-config`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - USD 0.003 per configuration item recorded continuously
  - USD 0.012 per configuration item recorded daily

### Service control policies (SCPs)

- ID: `organizations-scps`
- URL: <https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - SCPs do not grant permissions; they set the maximum available permissions for IAM users and roles in member accounts
  - SCPs need an organization with all features enabled
  - SCPs do not affect users or roles in the management account, or service-linked roles
  - AWS strongly recommends not attaching SCPs to the root without testing; removing FullAWSAccess without a replacement makes all actions fail

### SCP evaluation

- ID: `organizations-scp-evaluation`
- URL: <https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - An action needs an explicit Allow at every level from the root through each OU to the account
  - A Deny at any level denies the action for everything beneath it
  - Organizations attaches the AWS managed SCP FullAWSAccess when SCPs are enabled

### SCP syntax

- ID: `organizations-scp-syntax`
- URL: <https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Principal and NotPrincipal are not supported in SCPs
  - Action, NotAction, Resource, NotResource, and Condition are supported in Allow and Deny statements
  - The example that denies operations outside chosen Regions uses NotAction with cloudfront:*, iam:*, route53:*, support:* and StringNotEquals on aws:RequestedRegion

### Quotas and service limits for AWS Organizations

- ID: `organizations-quotas`
- URL: <https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The maximum size of a service control policy document is 10,240 characters

### Create an organization with AWS Organizations

- ID: `organizations-create`
- URL: <https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_org_create.html>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The account that creates an organization becomes its management account
  - An organization supports all features by default, or consolidated billing only

### AWS Organizations FAQs

- ID: `organizations-faqs`
- URL: <https://aws.amazon.com/organizations/faqs/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - AWS Organizations is offered at no additional charge

### aws-samples/service-control-policy-examples

- ID: `aws-scp-examples`
- URL: <https://github.com/aws-samples/service-control-policy-examples>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The root-user example denies with ArnLike on aws:PrincipalArn arn:aws:iam::*:root
  - The Region example exempts about forty global or cross-Region services through NotAction
- Note: Linked from the Organizations user guide's SCP examples page. Read: Deny-the-root-user-from-performing-actions-except-S3-bucketpolicy-changes.json and Deny-access-to-AWS-based-on-the-requested-AWS-region.json on the main branch.

### @go-to-k/cdkd 0.296.28 (npm tarball, dist/)

- ID: `cdkd-npm-security`
- URL: <https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - cdkd registers dedicated providers for AWS::SecretsManager::Secret, AWS::KMS::Key, AWS::WAFv2::WebACL, AWS::CloudFront::Distribution, AWS::CloudFront::OriginAccessControl, AWS::Lambda::Function, AWS::Lambda::Url, AWS::Lambda::Permission, AWS::IAM::Role, and AWS::Logs::LogGroup
  - No provider is registered for AWS::GuardDuty::Detector
  - The secret provider generates the GenerateSecretString value in the cdkd process and passes it to CreateSecret
  - The secret provider deletes with ForceDeleteWithoutRecovery; the KMS provider schedules key deletion with PendingWindowInDays, 7 when unset

### AWS SDK for JavaScript v3 3.1149.0: client-secrets-manager, client-iam, client-cloudtrail, client-guardduty, client-inspector2, client-config-service, client-organizations (type definitions)

- ID: `aws-sdk-security-clients`
- URL: <https://www.npmjs.com/package/@aws-sdk/client-secrets-manager/v/3.1149.0>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The request and response shapes used by the adapters and scripts
  - The Secrets Manager client has no AccessDeniedException class; a denial is matched by error name
  - The Organizations client's endpoint rules use organizations.us-east-1.amazonaws.com in the aws partition

### Cloudflare Workers: Secrets

- ID: `cloudflare-workers-secrets`
- URL: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Secrets are a type of binding that attaches encrypted text values to a Worker
  - Secrets on that page are per Worker; account-level secrets are the Secrets Store, in beta
  - Local development reads secrets from .dev.vars or .env

### Cloudflare WAF: Managed Rules

- ID: `cloudflare-waf-managed-rules`
- URL: <https://developers.cloudflare.com/waf/managed-rules/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - The Cloudflare Free Managed Ruleset is available on all Cloudflare plans

### Cloudflare WAF: Rate limiting rules

- ID: `cloudflare-rate-limiting-rules`
- URL: <https://developers.cloudflare.com/waf/rate-limiting-rules/>
- Checked: 2026-10-12
- Chapters: 21
- Claims this source supports:
  - Rate limiting rules are available on the Free plan, with features that depend on the plan

## Sources not re-read yet (starting points for later chapters)

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

### cdkd: Concepts

- ID: `cdkd-concepts`
- URL: <https://cdkd.dev/concepts/index.html>
- Chapters: 02
- Claims this source supports:
  - cdkd provisions through AWS SDK and Cloud Control API calls and keeps its own state in S3
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

### What is Amazon DynamoDB?

- ID: `dynamodb-intro`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html>
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

### What is Amazon RDS?

- ID: `rds-welcome`
- URL: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html>
- Claims this source supports:
  - Service overview
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon Bedrock?

- ID: `bedrock-what-is`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html>
- Claims this source supports:
  - Service overview
- Note: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.
