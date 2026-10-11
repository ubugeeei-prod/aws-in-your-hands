---
title: "Validation Record"
generated: true
---

<!-- Generated file. Do not edit. Source: data/validation.json (tools/src/book/generate.ts) -->

# Validation Record

This page keeps what was written apart from what was run and confirmed. A local pass is not evidence that something works in AWS.

Environment: macOS 26 (Darwin 25.6.0), arm64 (aarch64-darwin), Nix 2.25.3 (2026-10-11)

| Scope | Command | Kind | Result | Ran | Note |
| --- | --- | --- | --- | --- | --- |
| toolchain | `nix develop` | local | passed | 2026-10-11 | Node.js 24.21.0, pnpm 10.34.5, AWS CLI 2.35.11, and vp 1.1.0 are present, and vp env which node points at the Nix Node.js |
| toolchain | `vp install --frozen-lockfile` | local | passed | 2026-10-11 | Installed without rewriting pnpm-lock.yaml |
| toolchain | `clean checkout: nix develop → vp install --frozen-lockfile → vp run check:all` | local | passed | 2026-10-11 | Run from a separate directory holding only the staged tree; no pre-generated file or globally installed tool was needed |
| toolchain | `vp の初回セットアップと shell 設定 / vp first-run setup and shell profiles` | local | passed | 2026-10-11 | Tested with a throwaway HOME: by default lines are appended to ~/.zshrc, ~/.zshenv, ~/.bashrc, and ~/.profile; with VP_SELF_SETUP_NO_MODIFY_PATH=1 nothing is appended |
| all | `vp run check:all` | local | passed | 2026-10-11 | Format and lint, Vue lint and type check with Vize, tsc type checks, 218 tests (one skipped for lack of DynamoDB Local), generated-page freshness, locale and source-map consistency, synth of six CDK apps, builds of the book and two SPAs, and the link check |
| all | `vp run typecheck / tsc x12 (parallel)` | local | passed | 2026-10-11 | Intermittent type-check failures were caused by TypeScript 7 confusing identical index.d.ts files that pnpm had hard-linked to one inode (3,501 of them in aws-cdk-lib). After setting packageImportMethod: clone-or-copy, parallel tsc passed 12 of 12 runs and vize check including aws-cdk-lib passed 4 of 4 |
| book | `vp run build:book / vp run links:check` | local | passed | 2026-10-11 | Generates 34 pages per language plus the 404 page and search index. Confirmed that a cache hit restores the output and that changing an imported source file or a page re-runs the build |
| book | `vp run book:infra:synth` | local | passed | 2026-10-11 | 5 resources and 3 outputs; no change to AWS |
| 02 | `vp run hello:infra:synth -c stage=prod / vp run hello:infra:synth:cdk` | local | passed | 2026-10-11 | Context reaches cdkd, and the template shows the bucket retained for prod. The CDK CLI synthesizes the same app |
| 03 | `vp run build:spa / vp run typecheck:vue` | local | passed | 2026-10-11 | Built with the Vize Vite plugin; output is 152 KB. vize check passed 8 of 8 runs and caught a deliberately introduced type error |
| 04 | `vp run dev:api + curl` | local | passed | 2026-10-11 | Ran the four curl commands from the chapter: /health, create, list, and the 400 for invalid input |
| 04 | `vp run api:infra:synth` | local | passed | 2026-10-11 | Includes the esbuild bundle (no Docker); 17 resources |
| 05 | `vp run test:unit (examples/05-dynamodb)` | local | passed | 2026-10-11 | Repository contract (in memory), inspection of the requests sent to DynamoDB, 409s, pagination, retry after a lost response, and infrastructure assertions |
| 05 | `vp run dev:notes + curl (NOTES_STORE=memory)` | local | passed | 2026-10-11 | Checked create, update, the 409 for an update from a stale version, and list |
| 05 | `vp run notes:infra:synth` | local | passed | 2026-10-11 | Builds the bundle, AWS SDK included, with esbuild |
| 06 | `vp run test:unit (examples/06-auth)` | local | passed | 2026-10-11 | Authentication (401), authorization (another user's note is a 404; the owner comes only from the token), audit log, identity extraction, local sign-in, PKCE pending state, and infrastructure assertions |
| 06 | `vp run dev:app:api + vp run dev:app:web + ブラウザの自動操作 / browser automation` | local | passed | 2026-10-11 | Checked local sign-in, creating a note, a 404 for another user, a 401 without a token, the conflict panel and saving again, and being asked to sign in after a reload |
| 06 | `vp run app:infra:synth / build:app:web / typecheck:app:web / lint:app:web` | local | passed | 2026-10-11 | 19 resource types. The Cognito code path is type-checked only |
| 01 | `vp run account:whoami` | AWS | not run | - | Needs credentials |
| 01 | `vp run account:budget:create / account:budget:delete` | AWS | not run | - | Changes AWS |
| 02 | `vp run infra:bootstrap` | AWS | not run | - | Creates cdkd's storage |
| 02 | `vp run hello:infra:diff / deploy / drift / drift:revert:preview / drift:revert / drift:accept / destroy` | AWS | not run | - | Includes the drift lab |
| 03 | `vp run spa:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a CloudFront distribution |
| 03 | `vp run spa:publish:plan / publish / smoke / invalidate / unpublish` | AWS | not run | - | Publishing and live-URL checks |
| 04 | `vp run dev:api:cdkd` | local | not run | - | Needs a Docker daemon; not run |
| 04 | `vp run api:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates Lambda and API Gateway resources |
| 04 | `vp run api:smoke / api:logs` | AWS | not run | - | Needs the deployed API |
| book | `vp run book:infra:diff / deploy / drift / destroy` | AWS | not run | - | The book site is not deployed |
| book | `vp run book:publish:plan / publish / smoke / invalidate / unpublish` | AWS | not run | - | There is no public URL yet |
| pricing | `vp run pricing:refresh` | AWS | not run | - | Reads a public API. data/pricing/unit-prices.json was extracted from the same API once by hand |
| distribution | `vp run sources:pack` | local | not run | - | Cannot run without a commit |
| 05 | `vp run db:local:start / db:migrate:local / db:seed:local / db:reset:local / test:local:dynamodb` | local | not run | - | No Docker daemon was available. Only confirmed that test:local:dynamodb fails when DYNAMODB_ENDPOINT is missing |
| 05 | `vp run notes:infra:diff / deploy / drift / destroy, vp run notes:smoke` | AWS | not run | - | Creates a DynamoDB table |
| 06 | `vp run app:infra:diff / deploy / drift / destroy, app:user:create, app:publish, app:smoke:web, app:smoke:api, app:unpublish` | AWS | not run | - | Creates a user pool, a distribution, and a table |
| 18 | `vp run test:unit (examples/18-live)` | local | passed | 2026-10-11 | GetStream interpretation, event validation and order-independent folding, encoder-setting checks, the page's view decisions, and stack assertions |
| 18 | `vp run typecheck / typecheck:stream:web / lint:stream:web` | local | passed | 2026-10-11 | Type checks for the example and the player page, and the template lint |
| 18 | `vp run stream:infra:synth` | local | passed | 2026-10-11 | Synthesizes the template, including the esbuild bundle, without contacting AWS |
| 18 | `vp run build:stream:web / dev:stream:web` | local | passed | 2026-10-11 | Confirmed the build contains the player's worker and wasm files, and that the dev server shows the not-configured message |
| 18 | `vp run stream:infra:diff / deploy / drift / destroy, stream:key, stream:config, stream:status, stream:stop` | AWS | not run | - | Creates an IVS channel and stream key. Broadcasting and viewing cannot be checked without AWS |
| 11 | `vp run test:unit (examples/11-network)` | local | passed | 2026-10-11 | CIDR arithmetic, settings validation, the route model, pricing inputs, stack assertions, and import/export matching |
| 11 | `vp run net:infra:synth` | local | passed | 2026-10-11 | Synthesized the default layout and `-c egress=nat-per-az -c interfaceEndpoints=ecr.api,ecr.dkr,logs` |
| 11 | `vp run net:plan` | local | passed | 2026-10-11 | Ran with the defaults, `egress=nat`, `egress=nat-per-az`, `interfaceEndpoints=ecr.api,ecr.dkr,logs`, and invalid settings |
| 11 | `vp run net:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a VPC and, depending on context, NAT gateways and interface endpoints, which are billed by the hour |
| 17 | `vp run test:unit (examples/17-ai)` | local | passed | 2026-10-11 | 51 tests: fixture streams (complete, maxTokens, cut midway, throttled midway, throttled at open), cancellation and timeout, the client, and the CDK assertions |
| 17 | `vp run typecheck (examples/17-ai)` | local | passed | 2026-10-11 | Includes scripts/ and infra/ |
| 17 | `vp run ai:infra:synth` | local | passed | 2026-10-11 | Includes the esbuild bundle (no Docker); 5 resources |
| 17 | `vp run dev:ai + curl` | local | passed | 2026-10-11 | Started with AI_BACKEND=fixture. Checked /health, a streamed summary, the 400 for invalid input, the `cancelled` log line after disconnecting midway, and the error event with AI_FIXTURE=truncated |
| 17 | `vp run check:all` | local | passed | 2026-10-11 | Passed with chapter 17 added |
| 17 | `vp run dev:ai (AI_BACKEND=bedrock)` | AWS | not run | - | The local server calling real Bedrock; billed |
| 17 | `vp run ai:hello / ai:test:live` | AWS | not run | - | Calls a real model; billed. The model ID, the permissions, and the real event shapes can only be checked here |
| 17 | `vp run ai:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a Lambda function, a function URL, an IAM role, and a log group |
| 17 | `vp run ai:smoke / ai:logs` | AWS | not run | - | Needs the deployed function URL; billed |
| 15 | `vp run test:unit (examples/15-email)` | local | passed | 2026-10-11 | Header-injection refusals, record-first idempotent sending (faults injected at eight points, simultaneous requests, lost responses), validation of SES events with duplicates and reordering, inspection of the requests sent to DynamoDB and SES, and infrastructure assertions |
| 15 | `vp run dev:mail + curl` | local | passed | 2026-10-11 | Ran the curl commands from the chapter: the second request for a notification is a duplicate, a title with a line break is a 400, and after posting the bounce fixture the address is suppressed |
| 15 | `vp run mail:infra:synth` | local | passed | 2026-10-11 | Bundles both functions, AWS SDK included, with esbuild. Makes no call to AWS |
| 15 | `vp run mail:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates an SES identity and configuration set, an SNS topic, a DynamoDB table, Lambda functions and an HTTP API. Creating the identity sends a verification mail |
| 15 | `vp run mail:send / mail:status / mail:dns / mail:logs` | AWS | not run | - | Need the deployed stack. mail:send sends a real mail and is billed |
| 15 | `aws sesv2 get-account / get-email-identity / put-account-details / put-account-suppression-attributes` | AWS | not run | - | Checking the sandbox and the identity's verification, and requesting production access. The request is a manual step for a person |
| 10 | `vp test run examples/10-edge` | local | passed | 2026-10-11 | The function (the deployed file run under node:vm), KeyValueStore planning and sync, the SDK adapter, the Lambda@Edge handler, and both stacks |
| 10 | `vp run edge:infra:synth` | local | passed | 2026-10-11 | AihEdge has 6 resources and AihEdgeBodyDigest 4 (esbuild bundle included, no Docker). Also synthesized with -c bodyDigestVersionArn |
| 10 | `vp run dev:edge + curl` | local | passed | 2026-10-11 | Ran the curl commands from the chapter (redirects, query string carry-over, rewrites, 404) and flipped maintenance / newHome in edge-data.json |
| 10 | `vp run dev:edge:cdkd + curl` | local | passed | 2026-10-11 | cdkd local start-cloudfront (--kvs-file, --origin). Started with no Docker daemon running and returned the same responses as dev:edge. No credentials were used |
| 10 | `vp run typecheck (examples/10-edge)` | local | passed | 2026-10-11 | Type check |
| 10 | `vp run edge:infra:diff / deploy / drift / destroy, edge:publish / unpublish` | AWS | not run | - | Creates an S3 bucket, a CloudFront distribution, a function, and a key value store |
| 10 | `vp run edge:kvs:plan / edge:kvs:sync` | AWS | not run | - | Needs the deployed key value store. API operations cost USD 1 per 1,000 |
| 10 | `vp run edge:body:infra:deploy / destroy` | AWS | not run | - | Creates a Lambda function, a version, and an IAM role in us-east-1 |
| 13 | `vp run test:unit (examples/13-sql)` | local | passed | 2026-10-11 | Transaction retries, the repository on PGlite (quota, versions, owner isolation, constraints), injected COMMIT conflicts, migration lint and resuming after an interruption, grant statement checks, the API, and infrastructure assertions |
| 13 | `vp run sql:db:reset:local / sql:db:migrate:local / sql:db:seed:local, vp run dev:sql + curl (NOTES_DB=pglite)` | local | passed | 2026-10-11 | Applied the migrations and the seed, saw a second run change nothing, and checked create, update, the 409 for a stale version, the 404 for a non-UUID id, delete, and that reset is refused while the dev server runs |
| 13 | `vp run sql:infra:synth` | local | passed | 2026-10-11 | Builds a CommonJS bundle with node-postgres and the AWS SDK signer using esbuild. The bundle was loaded in Node.js 24 and answered the routes that do not touch the database (GET /health and a non-UUID id) |
| 13 | `vp run sql:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates an Aurora DSQL cluster. cdkd handles AWS::DSQL::Cluster through Cloud Control API |
| 13 | `vp run sql:db:migrate / sql:db:grant / sql:db:seed` | AWS | not run | - | Connects to the cluster as admin and creates the schema, the database role, and the seed |
| 13 | `vp run sql:smoke / sql:logs, vp run dev:sql (NOTES_DB=dsql)` | AWS | not run | - | Needs the deployed API and cluster |

## Open items and how to resume

### aws-validation

Nothing has been validated in AWS, because this request did not authorize creating, changing, or deleting resources.

To resume: Follow the order under "最初に実行する実環境検証" in docs/CONTINUATION.md in an authorized practice account. Record results here and update `verification` in data/section-map.json.

### cdkd-cloudfront-function

cdkd 0.296.28 handles AWS::CloudFront::Function through Cloud Control API. Whether create, update, and drift read-back work in practice is unconfirmed. The book site and chapter 03 depend on it.

To resume: Run vp run spa:infra:deploy and vp run spa:infra:drift. If they fail, record how and ask the author for a decision; do not substitute another tool.

### cdkd-state-outputs

tools/src/infra/outputs.ts assumes cdkd state show --json prints { state: { outputs } }. The key format (bare or stack-qualified) is unconfirmed against real output; the code accepts both.

To resume: After a deploy, save the real output of cdkd state show AihHello --json and replace the fixture in tools/src/infra/outputs.test.ts with it.

### drift-fixtures

The files in tools/src/drift/fixtures/ were written by hand from cdkd's type definition and documented exit codes; they are not captured output.

To resume: Run the chapter 02 drift lab and add the real output for clean, drifted, and missing-stack runs as fixtures.

### dynamodb-conditional-writes

The core claim of chapter 05, that a conditional write lets exactly one of two concurrent updates through, has been checked against neither DynamoDB Local nor real DynamoDB. Only the expressions sent, and the in-memory implementation's adherence to the same rules, were checked.

To resume: Start Docker and run vp run db:local:start, db:migrate:local, and test:local:dynamodb. Then run notes:infra:deploy and notes:smoke, and add a script under examples/05-dynamodb/scripts/ that races two updates against the real table.

### cognito-sign-in

The Cognito sign-in of chapter 06 (authorization code with PKCE, token exchange) has never been run; web/src/auth/cognito.ts is type-checked only. Also unconfirmed: that the JWT authorizer rejects ID tokens, that the token endpoint can be called from a browser, that the Issuer and AuthDomain written to config.json have the expected form, and that cdkd can handle AWS::Cognito::UserPoolClient and UserPoolDomain through Cloud Control API.

To resume: Run vp run app:infra:deploy, app:user:create, and app:publish, then sign in from a browser. Put the access token in AIH_ACCESS_TOKEN and run app:smoke:api. Send an ID token and confirm the 403.

### sdk-aws-login

Whether AWS SDK for JavaScript v3 3.1149.0 can read aws login credentials (login_session) is unconfirmed.

To resume: Run vp run account:whoami after aws login. If it cannot read them, add the documented credential_process profile to chapter 01 as a procedure.

### platforms

Only aarch64-darwin was verified. The Linux autoPatchelf path in nix/vp.nix and x86_64-darwin have not been run.

To resume: Run nix develop, vp install --frozen-lockfile, and vp run check:all on each platform and update verifiedPlatforms in data/toolchain.json.

### ox-content-peer-range

The vite peer range of @ox-content/vite-plugin 3.2.14 does not include vite-plus-core 1.1.0. pnpm-workspace.yaml allows it with peerDependencyRules. The build works.

To resume: When upgrading Ox Content or Vite+, check whether the exception is still needed.

### custom-domain

A custom domain (Route 53, ACM) is not implemented. With no siteUrl, canonical and hreflang links are not emitted.

To resume: Once a domain exists, add the hosted zone and a us-east-1 certificate to book/infra/ and build with AIH_BOOK_SITE_URL set. First confirm that cdkd handles the cross-Region stack.

### cloudformation-drift

CloudFormation drift detection (start, polling to completion, result parser, gate) is not implemented; it belongs to chapter 20. The current gate covers cdkd-managed stacks only.

To resume: In chapter 20, add CloudFormation detection to tools/src/drift/ and feed it into the same report shape and gate.

### unverified-sources

Sources with checkedAt null in data/sources.json are listed as starting points and were not re-read while writing. Chapters 01 and 02 contain general statements about IAM, CDK bootstrapping, and CloudFormation drift that rest on such sources.

To resume: Re-read those sources and update checkedAt and supports. Where the prose disagrees, correct the Japanese first.

### unverified-prices

AWS Budgets pricing, free allowances for API Gateway HTTP API and S3, and which chapters run on the Free plan are unconfirmed. The calculations treat them as unknown and deduct nothing.

To resume: Check the official pricing pages and resolve the `unknown` entries in data/pricing/allowances.json.

### publication

The repository's public URL, where archives are published, and the license are undecided. The CI examples in docs/examples/ have never been executed.

To resume: The author decides. Once decided, write only real URLs into the README and the prose.

### 18-live-broadcast

Chapter 18: no real broadcast has been made or watched. Unconfirmed: broadcasting from OBS, playback in the player, measured latency, the real shapes of GetStream and the events, creating and deleting IVS resources through Cloud Control API, whether cdkd's state holds the stream key value, and re-creating the key via streamKey=off.

To resume: Set AIH_AWS_ACCOUNT_ID, then run vp run stream:infra:deploy, stream:key --show, broadcast from OBS, watch with stream:config and preview:stream:web, then stream:status --events, stream:stop, stream:status --expect-offline, and stream:infra:destroy. Inspect the StreamKey attributes with `cdkd state show AihLive --json`.

### 11-deploy

The chapter 11 stack has never been deployed. Unverified: that cdkd 0.296.28 creates and deletes the whole VPC, that AWS::EC2::VPCEndpoint works through Cloud Control API, real reachability through the gateway and interface endpoints, and the drift check.

To resume: Run `vp run net:infra:deploy` with the defaults, then `vp run net:infra:drift` and `vp run net:infra:destroy`. Next deploy with `-c egress=nat` and `-c interfaceEndpoints=logs`, check reachability from a resource in a private subnet, and destroy right away (hourly charges).

### 11-cross-stack

Reading the chapter 11 outputs with `Fn::ImportValue` from a stack in another CDK app has not been run with cdkd. That destroy is refused while an import remains was only read in the documentation and source.

To resume: Deploy the chapter 11 stack, then deploy a small stack (one security group) from another app that uses `importNetwork`. Confirm that `vp run net:infra:destroy` stops with `StackHasActiveImportsError`, destroy the consumer first, and run it again.

### 11-zone-names

Whether the default zone names (ap-northeast-1a and ap-northeast-1c) accept new subnets in every account was not confirmed.

To resume: Check your account's zone names and IDs with `aws ec2 describe-availability-zones --region ap-northeast-1` and pass `-c availabilityZones=...` if they differ.

### 17-live-inference

Chapter 17 has never called real Bedrock. That the model IDs (such as jp.amazon.nova-2-lite-v1:0) can be called from Tokyo, that real ConverseStream events fit the schema in src/converse-stream.ts, and that the fixtures match the real shapes are all unconfirmed.

To resume: Prepare examples/17-ai/.env, run vp run ai:hello and then vp run ai:test:live (billed). If the event shapes differ, fix the schema and the fixtures.

### 17-deployed-streaming

The chapter 17 stack has not been deployed. Unconfirmed: that Hono's streamHandle and streamSSE deliver the response piece by piece on the Node.js 24 Lambda runtime through a function URL (RESPONSE_STREAM, AWS_IAM); that Lambda accepts the headers streamSSE sets, such as Transfer-Encoding; that an unsigned request answers 403; that ConverseStream passes with the IAM policy scoped to the inference profile; and that cdkd applies InvokeMode on AWS::Lambda::Url.

To resume: Run vp run ai:infra:deploy, vp run ai:smoke (it prints when each delta arrived), vp run ai:logs, vp run ai:infra:drift, and vp run ai:infra:destroy, in that order.

### 17-bedrock-billing-details

How many tokens are billed for a ConverseStream call that is aborted midway was not confirmed from a primary source. Neither were a free allowance for Bedrock or the quota values in the Tokyo Region.

To resume: Check the Bedrock pricing page and Service Quotas. For aborted calls, stop ai:test:live midway and compare the bill with the CloudWatch metrics.

### ses-send-and-events

Chapter 15 never called SES. Unconfirmed: identity verification, SendEmail passing under the sending role's policy (the ses:FromAddress condition and the two resources, identity and configuration set), whether a sandbox account also needs permission on the recipient's identity, real events matching the fixtures, delivery from SNS to the function, and the configuration set's suppression behavior.

To resume: Run vp run mail:infra:deploy -c fromAddress=... with your own address, follow the link in the verification mail, then run vp run mail:send --to your address, and again with --to bounce@simulator.amazonses.com and complaint@simulator.amazonses.com. Check the states and events with mail:status and mail:logs --events, and compare the received event JSON with test/fixtures. If AccessDenied appears, record the resource ARN the error names.

### ses-cdkd-cloud-control

cdkd 0.296.28 has no dedicated provider for AWS::SES::EmailIdentity, ConfigurationSet or ConfigurationSetEventDestination, so they go through Cloud Control API. Create, update, drift detection and delete on that path were never run, and reading the DKIM tokens as outputs is unconfirmed.

To resume: Run vp run mail:infra:deploy, mail:infra:drift and mail:infra:destroy. With a domain identity, confirm that vp run mail:dns can read DkimName1-3 and DkimValue1-3.

### email-dynamodb-claim

Chapter 15's "one notification, one mail" depends on a conditional PutItem letting exactly one of several simultaneous requests through. Only the expression sent, and the in-memory implementation's adherence to the same rule, were checked; neither DynamoDB Local nor real DynamoDB was used.

To resume: After deploying, add a script under examples/15-email/scripts/ that sends requests with one notificationId in parallel, and confirm in the inbox and with mail:status that one mail arrived.

### edge-function-on-real-runtime

Chapter 10's edge-router.js has not run on the CloudFront Functions runtime 2.0. Its syntax, the 10 KB and 2 MB limits, execution time (compute utilization), calling cf.kvs() without an ID, and get() rejecting for a missing key are confirmed only by documentation and tests under Node.js.

To resume: After vp run edge:infra:deploy, run aws cloudfront test-function (stage DEVELOPMENT, with the event from the chapter) and record the result and ComputeUtilization. Then run edge:publish and edge:kvs:sync and try the chapter's curl commands.

### kvs-stale-etag-error

Which error the KeyValueStore API returns for a stale If-Match is unconfirmed. The API reference lists ConflictException (409) without saying when it is returned. Chapter 10's adapter treats only ConflictException as a conflict and stops without retrying on anything else.

To resume: After deploying, run aws cloudfront-keyvaluestore put-key with an old ETag as --if-match and record the error name and status code. If it is not ConflictException, fix translate in examples/10-edge/src/kvs/store.ts and test/store.test.ts.

### kvs-propagation-time

The time for a KeyValueStore update to reach the edge has not been measured. The Developer Guide gives no figure; the only hint is "a few seconds" in the AWS News Blog.

To resume: Set maintenance to true in edge-data.json, run edge:kvs:sync, and time from its completion until curl starts returning 503, several times. Record it with where and how often it was measured, never as a guarantee.

### cdkd-kvs-and-lambda-edge

Whether cdkd 0.296.28 can create, update, and delete AWS::CloudFront::KeyValueStore (through Cloud Control API, treated as stateful) and the Lambda@Edge function and AWS::Lambda::Version in a us-east-1 stack is unconfirmed. The source shows only that the stack's own region is used and that cdkd's asset storage is probably needed in us-east-1 too. Node.js 24 on Lambda@Edge was not confirmed separately either.

To resume: Run AIH_AWS_REGION=us-east-1 vp run infra:bootstrap, then vp run edge:body:infra:deploy. Pass the BodyDigestVersionArn output to vp run edge:infra:deploy with -c bodyDigestVersionArn=..., and check /digest with curl -X POST. If it fails, record how and ask the author for a decision; do not substitute another tool.

### dsql-real-cluster

The chapter 13 code has never been connected to a real Aurora DSQL cluster. Unconfirmed: that the four migrations are accepted (CREATE SCHEMA IF NOT EXISTS, the foreign key, the CHECKs, CREATE INDEX ASYNC IF NOT EXISTS), that job_id can be read from the response to CREATE INDEX ASYNC and sys.jobs polled, that AWS IAM GRANT plus the schema GRANTs let notes_api read and write, that the token passes through the function given to node-postgres as password, that a conflict shows up as code 40001 on node-postgres's error, and how a dropped connection looks in an execution environment that was frozen. The local stand-in is PGlite (PostgreSQL 18.3), a different version from DSQL (PostgreSQL 16 compatible).

To resume: In a practice account run vp run sql:infra:deploy, sql:db:migrate, sql:db:grant, and sql:smoke in that order. Put concurrent updates on one note and look for "transaction retry" lines and 40001 with sql:logs. Call again after more than 15 minutes and watch the reconnect. Record the results in data/validation.json and remove everything with vp run sql:infra:destroy.

### cdkd-dsql-cluster

cdkd 0.296.28 has no dedicated provider for AWS::DSQL::Cluster and handles it through Cloud Control API. Whether create, Ref returning the cluster identifier, drift read-back, and delete work in practice is unconfirmed. The chapter 13 stack builds the endpoint and the ARN from Ref.

To resume: After vp run sql:infra:deploy, check that the ClusterEndpoint output has the form <26-character id>.dsql.ap-northeast-1.on.aws and that the function's environment variable and the IAM policy's Resource point at the same cluster. Record the results of vp run sql:infra:drift and sql:infra:destroy as well.

### dsql-dpu-estimate

The chapter 13 cost scenario borrows its DPUs per request from the documentation's worked examples. They were not measured on this chapter's queries.

To resume: On a deployed cluster use EXPLAIN ANALYZE VERBOSE, or the ComputeDPU, ReadDPU, and WriteDPU metrics in CloudWatch, to measure the DPUs of one create, one update, and one list. Correct the scenarios in data/fragments/13.json and apply it again.
