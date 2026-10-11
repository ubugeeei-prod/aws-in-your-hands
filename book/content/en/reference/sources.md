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
- Chapters: 02, 03, 04
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
- Chapters: 00, 13
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
- Chapters: 05, 14
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

### What is Amazon IVS?

- ID: `ivs-what-is`
- URL: <https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html>
- Chapters: 18
- Claims this source supports:
  - Low-latency streaming overview
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
