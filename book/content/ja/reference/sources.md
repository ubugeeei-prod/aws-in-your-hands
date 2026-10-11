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
- 参照する章: 04
- この出典が支える主張:
  - Free tier: 1,000,000 requests and 400,000 GB-seconds per month
  - Response streaming: first 6 MB per request free, then per GB
- 注記: The page does not say whether the free tier expires.

### AWS Price List bulk API: Lambda, ap-northeast-1

- ID: `aws-price-list-lambda`
- URL: <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json>
- 確認日: 2026-10-11
- 参照する章: 04
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
- 参照する章: 04
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
- 参照する章: 02, 03, 04
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
- 参照する章: 02
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
  - With TypeScript 7.0.2, `vp check`'s type check and plain `tsc` intermittently mis-resolved aws-cdk-lib subpath imports on unchanged sources (observed here: 2 of 5 runs); `tsc --singleThreaded` did not (36 of 36 project checks passed)
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
- 注記: Verified by building and checking examples/03-spa. When `vize check` was also given the CDK code that imports aws-cdk-lib, it showed the same intermittent mis-resolution as TypeScript 7.0.2 (2 of 4 runs); limited to src/ it passed 8 of 8.

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
- 参照する章: 00, 13
- この出典が支える主張:
  - `wrangler dev` uses a local-only D1 by default and persists its data across runs
  - Local and remote data are separate; `--local` targets the local database for `wrangler d1 execute` and `wrangler d1 migrations apply`

### Cloudflare Workers AI: Bindings

- ID: `cloudflare-workers-ai-bindings`
- URL: <https://developers.cloudflare.com/workers-ai/configuration/bindings/>
- 確認日: 2026-10-11
- 参照する章: 00, 17
- この出典が支える主張:
  - The AI binding is declared in the wrangler configuration and called as env.AI.run(model, options)
  - `stream: true` returns results as a text/event-stream
- 注記: This page says nothing about local development or charges; that claim rests on cloudflare-workers-local-dev.

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

### Lambda response streaming

- ID: `lambda-response-streaming`
- URL: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html>
- 参照する章: 09, 17
- この出典が支える主張:
  - Which invocation paths support streaming responses
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

### Cloudflare Workers AI: Get started

- ID: `cloudflare-workers-ai-quickstart`
- URL: <https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/>
- 参照する章: 17
- この出典が支える主張:
  - A Worker calls a model through the AI binding
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon DynamoDB?

- ID: `dynamodb-intro`
- URL: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html>
- 参照する章: 05, 14
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

### Amazon VPC pricing

- ID: `vpc-pricing`
- URL: <https://aws.amazon.com/vpc/pricing/>
- 参照する章: 11, 23
- この出典が支える主張:
  - NAT gateway and public IPv4 address charges
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
- 参照する章: 17
- この出典が支える主張:
  - Service overview
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### Bedrock Converse API

- ID: `bedrock-converse`
- URL: <https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html>
- 参照する章: 17
- この出典が支える主張:
  - Converse and ConverseStream
- 注記: Listed in the research starter index (checked there 2026-10-11) but not re-read while writing. Re-verify before relying on it for a new claim.

### What is Amazon IVS?

- ID: `ivs-what-is`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html>
- 参照する章: 18
- この出典が支える主張:
  - Low-latency streaming overview
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
