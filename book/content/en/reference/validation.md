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
| 07 | `vp run test:unit (examples/07-uploads)` | local | passed | 2026-10-11 | Authorization (another user's note is a 404; the key comes only from the token), permit contents, finishing with its deadline and limit, the state of S3 and DynamoDB when stopped partway, the sweep, the replay of a form, the POST policy and presigned GET the SDK produces (signed with made-up credentials only), the shape of DynamoDB requests, and infrastructure assertions |
| 07 | `vp run dev:uploads:api + vp run dev:uploads:web + ブラウザの自動操作 / browser automation` | local | passed | 2026-10-11 | Checked sign-in, creating a note, choosing a file and seeing the image, a 404 for another user's permit, list, and finish, refusal of an oversized file, another type, and another key, finishing twice, and the image URL no longer loading after a delete and after deleting the note. The store was the in-memory implementation, not S3 |
| 07 | `vp run uploads:infra:synth / build:uploads:web / typecheck:uploads:web / lint:uploads:web / typecheck` | local | passed | 2026-10-11 | The same 19 resource types as chapter 06. The Cognito code path and scripts/ are type-checked only |
| 07 | `S3 互換のローカル実装での確認 / a run against an S3-compatible local implementation` | local | not run | - | No task is provided. It needs a Docker daemon, which was not running where this was written |
| 07 | `vp run uploads:infra:diff / deploy / drift / destroy, uploads:user:create, uploads:publish, uploads:smoke:web, uploads:smoke:api, uploads:sweep, uploads:empty, uploads:unpublish` | AWS | not run | - | Creates two buckets, a user pool, a distribution, and a table. The presigned POST to S3, the lifecycle rules, CORS, and attachment records in DynamoDB are all unconfirmed in AWS |
| 09 | `vp run test:unit (examples/09-ssr)` | local | passed | 2026-10-11 | The cache decision, the leak replayed through a shared cache, sessions, the publish plan, the smoke verdicts, and the CDK assertions |
| 09 | `vp run typecheck / typecheck:ssr / lint:ssr` | local | passed | 2026-10-11 | tsc over core, server, infra, scripts, and test; Vize over the .vue files in app. A type error introduced on purpose made vize check fail |
| 09 | `vp run ssr:check:output (runs build:ssr first)` | local | passed | 2026-10-11 | Called the buffered Lambda handler built by Nuxt 4.6.1 and nitropack 2.13.4 with function URL shaped events and checked headers, sign-in, and the replay through a shared cache. /feed and the HTML were each written in one write. Not run on Lambda |
| 09 | `vp run ssr:check:output:stream (runs build:ssr:stream first)` | local | passed | 2026-10-11 | Called the streaming handler with the awslambda global replaced by a recording fake. /feed was written in three writes about 300 ms apart, the HTML in one. The Lambda runtime, a function URL, and CloudFront were not involved |
| 09 | `vp run ssr:infra:synth` | local | passed | 2026-10-11 | Synthesized with cdkd. The template has the function URL (AWS_IAM), the OAC, two Lambda::Permission resources, the cache policy, and the response headers policy |
| 09 | `vp run dev:ssr + HTTP requests` | local | passed | 2026-10-11 | Started with AIH_SSR_SIGN_IN=dev and checked public pages, the 404, /me, sign-in, sign-out, the 403 for a cross-site POST, and /feed arriving in three chunks. Not exercised in a browser |
| 09 | `vp run ssr:infra:diff / deploy / drift / destroy, ssr:assets:plan, ssr:assets:publish, ssr:smoke, ssr:unpublish` | AWS | not run | - | Creates a distribution, a Lambda function with a function URL, and a bucket |
| 19 | `vp run test:unit (examples/19-observability)` | local | passed | 2026-10-12 | The shape and size of the lines really written, log queries and the metric filter condition evaluated on real lines, traceparent and X-Ray trace ID conversion, cross-references between spans and log lines, the attribute allow-list, unsampled requests and a lost span reproduced, the alarm conditions, the pricing inputs, and infrastructure assertions |
| 19 | `vp run dev:obs + curl` | local | passed | 2026-10-12 | Ran the curl commands from the chapter: log lines carry a traceId, spans are printed to the console, a request with traceparent continues that trace ID, and with TRACE_SAMPLE_RATIO=0 no span is printed while the log line remains |
| 19 | `vp run obs:query:print` | local | passed | 2026-10-12 | Prints the text of a Logs Insights query. Makes no call to AWS |
| 19 | `vp run obs:infra:synth` | local | passed | 2026-10-12 | Bundles the function, the OpenTelemetry API included, with esbuild. Also synthesized with -c otelLayerArn. Makes no call to AWS |
| 19 | `vp run obs:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a DynamoDB table, a Lambda function, an HTTP API, an SNS topic, two alarms, a dashboard and a metric filter. cdkd handles the dashboard and the metric filter through Cloud Control API |
| 19 | `vp run obs:smoke / obs:query / obs:alarms` | AWS | not run | - | Need the deployed stack. obs:smoke creates and deletes one note. obs:query is billed by the amount of log data scanned |
| 19 | `vp run obs:infra:deploy -c otelLayerArn=...` | AWS | not run | - | The configuration with the AWS Lambda Layer for OpenTelemetry. The Node.js 24 runtime is not in the layer's list of supported runtimes |
| 14 | `vp run test:unit (examples/14-kv-cache)` | local | passed | 2026-10-12 | Rate limiter boundaries and concurrency, the store contracts (memory), the requests sent to DynamoDB and Valkey, the read-side TTL check, stale reads, stampedes, TTL jitter, the IAM auth token signature, the app, and stack assertions |
| 14 | `vp run kv:infra:synth` | local | passed | 2026-10-12 | Synthesized the default layout and `-c store=valkey`, including the esbuild bundle |
| 14 | `vp run dev:kv` | local | passed | 2026-10-12 | Started with KV_STORE set to memory, valkey, and dynamodb and ran the curl commands from the chapter; valkey and dynamodb against the local servers of the next row |
| 14 | `node scripts/test-local.ts (examples/14-kv-cache; the command behind vp run kv:test:local)` | local | passed | 2026-10-12 | Ran the 22 store contract tests against valkey-server 9.1.2 from nixpkgs and DynamoDB Local 3.3.1 as distributed by AWS (the jar on a JRE 21). With no Docker daemon available, both ran as plain processes, not containers |
| 14 | `vp run kv:local:start / kv:local:stop` | local | not run | - | Not run: no Docker daemon. The images valkey/valkey:9.0.6-alpine and amazon/dynamodb-local:3.3.1 were neither pulled nor started |
| 14 | `vp run kv:infra:diff / deploy / drift / destroy, kv:smoke, kv:logs` | AWS | not run | - | Creates a DynamoDB table, a Lambda function, and an HTTP API; with `-c store=valkey` also an ElastiCache Serverless cache, which is billed for as long as it exists |
| 20 | `vp run test:unit (examples/20-shipping, tools/src/drift)` | local | passed | 2026-10-12 | CloudFormation drift polling, classification, and gate (clean, drifted, deleted, unchecked, nested stack, failed detection, missing stack, timeout, stale result, inconsistency, malformed response), the call order through a substituted SDK client, OIDC trust policies and role permissions, per-stage stacks, CDK CLI arguments, the next step for every stack status, preview listing, and the workflow YAML |
| 20 | `vp run ship:cfn:synth` | local | passed | 2026-10-12 | Synthesized with the pinned AWS CDK CLI 2.1145.0 and no credentials. Checked that cdk.out holds the AihShipApi and AihShipCi templates and that AihShipApi has no AWS::IAM::Policy or AWS::CDK::Metadata. Also run with -c stage=prod and -c stage=pr-12 |
| 20 | `vp run ship:cfn:deploy -c stage=staging / vp run ship:ci:deploy (no AWS call)` | local | passed | 2026-10-12 | Checked that an unknown stage, and a deploy of the CI roles without a repository, stop before any AWS call |
| 20 | `vp run check:all` | local | passed | 2026-10-12 | Format, lint, type check, all tests, synthesis of every CDK app, the book build, and the link check |
| 20 | `vp run ship:cfn:bootstrap` | AWS | not run | - | Creating the CDKToolkit stack was not run. What it creates is described from `cdk bootstrap --show-template` of the pinned CLI |
| 20 | `vp run ship:cfn:diff / ship:cfn:deploy / ship:smoke / ship:cfn:status / ship:cfn:destroy` | AWS | not run | - | The CloudFormation path was not deployed or checked. That the integration works through the alias, and what a rollback looks like, are unconfirmed |
| 20 | `vp run ship:ci:deploy -c githubRepository=<owner>/<repo>` | AWS | not run | - | The OIDC provider and four roles were not created. That IAM accepts the trust policies and that the bootstrap roles can be assumed are unconfirmed |
| 20 | `vp run ship:cfn:drift (and the drift lab)` | AWS | not run | - | Drift detection was not run against a real stack. The fixtures were written from the API reference and the SDK types, not captured |
| 20 | `vp run ship:preview:list` | AWS | not run | - | Listing preview stacks was not run |
| 20 | `examples/20-shipping/workflows/*.yml on GitHub Actions` | AWS | not run | - | None of the four workflows has run on GitHub Actions. That the Nix devShell works on an x86_64-linux runner is also unconfirmed |
| 20 | `cdkd export / cdkd import --migrate-from-cloudformation` | AWS | not run | - | Moving a stack between cdkd and CloudFormation was not run. The description comes from the pinned version's help output |
| 12 | `vp run test:unit (examples/12-containers)` | local | passed | 2026-10-12 | The child-process SIGTERM test, graceful shutdown, old and new versions side by side, the timing rules, settings, the docker command lines, pricing, and stack assertions |
| 12 | `vp run ecs:infra:synth` | local | passed | 2026-10-12 | Synthesized three ways: without an image tag, with `-c imageTag=v1`, and with `-c imageTag=v1 -c taskSubnets=private` |
| 12 | `vp run ecs:bundle / ecs:bundle:check` | local | passed | 2026-10-12 | Built dist/server.mjs, started it where no node_modules exists, called /health, and saw exit code 0 on SIGTERM |
| 12 | `vp run dev:ecs` | local | passed | 2026-10-12 | Started it, ran the chapter's curl commands, and saw the draining and stopped log lines on Ctrl-C (SIGINT) |
| 12 | `vp run ecs:image:build v1 --dry-run / ecs:image:run / ecs:image:push` | local | passed | 2026-10-12 | Printed the commands with --dry-run, and saw the task explain itself and exit with 1 when no daemon answers |
| 12 | `vp run ecs:watch --url http://localhost:8099 --for 3` | local | passed | 2026-10-12 | Pointed at a server started locally, and saw the per-version summary. Not pointed at a deployed service |
| 12 | `vp run ecs:image:build / ecs:image:run / ecs:image:push` | local | not run | - | No Docker daemon was running, so the image has never been built |
| 12 | `vp run ecs:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates an ECR repository and, given an image tag, a load balancer and two Fargate tasks, which are billed by the hour |
| 12 | `vp run ecs:watch / ecs:logs` | AWS | not run | - | Tasks that only read the deployed service |
| 08 | `vp run test:unit (examples/08-async)` | local | passed | 2026-10-12 | Duplicate delivery (the same message, the same event under another ID, two workers at once), reordering (an older create, a late delete), interruption (before and after the record), a partly failed batch, moving to the DLQ and back, the S3 test event, the repair of chapter 07's gap (a form sent twice), housekeeping run again, run concurrently, and interrupted, image type and size detection (real files written by sips and cwebp), the shape of requests to DynamoDB and S3, and infrastructure assertions. Two conditions were also broken on purpose to confirm that tests fail |
| 08 | `vp run dev:async + スクリプトによる HTTP の操作 / driven over HTTP by a script` | local | passed | 2026-10-12 | Checked through /local/queue: sign-in, creating a note, a form upload, the worker's record (ok, 1x1), finishing, the record turning to rejected after the same form sent HTML, a housekeeping dry run, and the record disappearing on delete. The queue and the bucket were the in-memory stand-ins, not SQS or S3 |
| 08 | `vp run async:infra:synth / typecheck` | local | passed | 2026-10-12 | Chapter 07's 19 resource types plus five (SQS::Queue, SQS::QueuePolicy, Lambda::EventSourceMapping, Lambda::EventInvokeConfig, Scheduler::Schedule): 24 in all, and no Custom:: resource. scripts/ is type-checked only |
| 08 | `vp run async:infra:diff / deploy / drift / destroy, async:smoke, async:queue, async:logs, async:housekeeping, async:publish, async:smoke:web, async:user:create, async:empty, async:unpublish` | AWS | not run | - | Creates two queues, two functions, one schedule, and everything of chapter 07 (two buckets, a user pool, a distribution, a table). S3 notifications, SQS, the event source mapping, Scheduler, and the conditional writes to DynamoDB are all unconfirmed in AWS |
| 23 | `vp run test:unit (examples/23-ec2)` | local | passed | 2026-10-12 | The file-backed repository under power loss at each step, behavior on SIGTERM over a real socket, generation of user data and the unit with injection refused, the data volume script run by bash, Run Command arguments, the model of the path to SSM, pricing inputs, and stack assertions |
| 23 | `vp run ec2:infra:synth` | local | passed | 2026-10-12 | Synthesized the default layout and `-c placement=public`, `-c dataOnDestroy=snapshot`, `-c dataSnapshotId=snap-0123456789abcdef0`, and `-c amiId=ami-0123456789abcdef0` |
| 23 | `vp run ec2:plan / ec2:render / ec2:app:build` | local | passed | 2026-10-12 | ec2:plan ran with the defaults, `placement=public`, a network without the endpoints, and invalid settings. ec2:render confirmed deploy/ matches the generators. ec2:app:build produces a single ESM file |
| 23 | `vp run dev:ec2 + curl, SIGTERM` | local | passed | 2026-10-12 | Started both the built dist/server.mjs and src/server.ts on Node.js 24. Checked create, list, that notes survive a restart, that SIGTERM ends with exit code 0, and that a damaged notes.json is refused at startup |
| 23 | `vp run ec2:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates an EC2 instance (billed by the hour), an EBS volume, and an S3 bucket. Needs the chapter 11 stack first |
| 23 | `vp run ec2:status / ec2:session / ec2:forward / ec2:app:release / ec2:app:rollback / ec2:smoke / ec2:logs` | AWS | not run | - | Reaches the instance through Systems Manager, ships a release, and checks it. ec2:session and ec2:forward need the Session Manager plugin, which the devShell does not include |
| 23 | `vp run ec2:patch:check / ec2:patch:apply / ec2:data:unmount / ec2:data:mount / ec2:releases:empty` | AWS | not run | - | Runs dnf on the instance, unmounts and mounts the data volume, and deletes release objects |
| 23 | `aws ec2 create-snapshot / create-volume / detach-volume / attach-volume（snapshot と restore の手順）` | AWS | not run | - | The procedure in the text was not run. The flags were checked against the help of AWS CLI 2.35.11 in the devShell |
| 16 | `vp run test:unit (examples/16-long-jobs)` | local | passed | 2026-10-12 | A step that runs again (the same step twice, the table changing after a lost answer, a failure in the middle of a call, a failed read), two workers (a stalled worker writing late, two runs of the same export overlapping), the same output whatever the checkpoint size, the manifest and the compensation (a missing part, an interrupted discard, never deleting a finished export), the workflow definition run by the local runner (a lost answer, retries running out and a resume, a restart from the beginning, a discard), the requests sent to S3 and DynamoDB, the durable-function variant (the SDK's LocalDurableTestRunner), and stack assertions. Two conditions were also broken on purpose; each made two tests fail |
| 16 | `vp run export:local` | local | passed | 2026-10-12 | Ran the default (250 notes), `--notes 450 --lose 2 --break 4` (a lost answer, then retries running out and a resume), and `--notes 1000 --pages-per-call 20`, and checked that the manifest's line count and distinct note count equal the number of notes. The stores were in memory: not Step Functions, S3, or DynamoDB |
| 16 | `vp run export:infra:synth / typecheck` | local | passed | 2026-10-12 | Synthesized the default layout and `-c durable=true`, including the esbuild bundles (the durable variant bundles the SDK too). The default has nine resource types, each with a dedicated provider in cdkd 0.296.28; the durable variant adds Lambda::Version and Lambda::Alias, which go through Cloud Control API. scripts/ is type-checked only |
| 16 | `vp run export:infra:diff / deploy / drift / destroy, export:seed, export:start, export:status, export:logs, export:empty, export:durable:start` | AWS | not run | - | Creates a bucket, a table, three functions, a state machine, and a schedule; with `-c durable=true` also a durable function, a version, and an alias. Step Functions, the start from Scheduler, S3 conditional writes, the DynamoDB Scan, and the durable function are all unconfirmed in AWS |
| 21 | `vp run test:unit (examples/21-security)` | local | passed | 2026-10-12 | Token signing and verification; the key cache across a rotation (an environment with a stale cache, two rotations, a flood of made-up version ids, Secrets Manager down, concurrent requests); the rotation procedure (a rerun after a lost response, a second rotation too soon, a reused version id); reading the secret through a substituted SDK client; the wildcard lint and its reasoned exceptions; the lint applied to chapter 20's CI roles; the SCP JSON and the evaluation model; waiting for IAM propagation; the posture verdicts; stack assertions (by default only one secret has a monthly fee; the key and the web ACL are opt-in) |
| 21 | `vp run sec:infra:synth` | local | passed | 2026-10-12 | Synthesized with the pinned cdkd 0.296.28 and no credentials. Checked that cdk.out holds the AihSecurity and AihSecurityWaf templates, that -c cmk=on and -c webAclArn=... change the template, and that a malformed webAclArn stops the synth |
| 21 | `vp run sec:iam:lint (own cdk.out, and every chapter's cdk.out)` | local | passed | 2026-10-12 | This chapter's two templates pass with no exceptions. The result of passing every chapter's cdk.out after `vp run infra:synth` is as written in the chapter's "Running it over the whole book" |
| 21 | `vp run dev:sec` | local | passed | 2026-10-12 | Checked /health, /token, and /verify on the local server with curl. The key exists only in memory; AWS is not called |
| 21 | `vp run sec:infra:deploy / sec:smoke / sec:infra:drift / sec:infra:destroy` | AWS | not run | - | Not run. Behavior through CloudFront, the function URL, and Secrets Manager; whether a 503 appears right after a deploy; that no secret remains after destroy |
| 21 | `vp run sec:secret:versions / sec:secret:rotate` | AWS | not run | - | Not run. How the staging labels move after PutSecretValue, a rerun with the same version id, and an environment with a stale cache accepting new tokens after a rotation |
| 21 | `vp run sec:waf:infra:deploy / sec:infra:deploy -c webAclArn=... / sec:waf:infra:destroy` | AWS | not run | - | Not run. Creating the web ACL in us-east-1, associating it with the distribution, how long the rate-based rule takes to start blocking, and what the counted rule group records |
| 21 | `vp run sec:infra:deploy -c cmk=on` | AWS | not run | - | Not run. Encrypting the secret with a customer managed key, the function reading it under the kms:ViaService condition, and the state of the key after destroy |
| 21 | `vp run sec:posture / sec:trail:iam` | AWS | not run | - | Not run. The actual responses of the read APIs of six services, and the output when a permission is missing |
| 22 | `vp run test:unit (examples/22-recovery)` | local | passed | 2026-10-12 | Detection and repair with the table and the bucket restored to different points (same point, table only, before an upload, after an overwrite, no version left); repair as a dry run, run twice, and interrupted; chapter 08's leftover inspection records; the object restore plan and its re-run; version numbers rolled back and the fence; the PITR plan; the drill record; item classification; chapter 05's repository contract; the requests sent to DynamoDB and S3; and stack assertions |
| 22 | `vp run recovery:demo` | local | passed | 2026-10-12 | Ran, on the in-memory table and bucket, the accident, the table restore, the check (4 findings), the bucket restore, the second check (0), and the fence. The output quoted in the chapter is from this run |
| 22 | `vp run recovery:infra:synth` | local | passed | 2026-10-12 | Synthesized the default layout, including the esbuild bundle. `-c table`, `-c protect=on`, `-c backup=on`, and `-c replica=on` were synthesized inside the tests and by passing context to `node infra/bin/app.ts` |
| 22 | `vp run recovery:drill new / mark / set / summary` | local | passed | 2026-10-12 | Created a record file, stamped moments and counts, saw an overwrite refused, and printed the summary. The values were for checking the tool, not measurements of a drill, and the file was deleted |
| 22 | `vp run recovery:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a DynamoDB table with PITR, an S3 bucket with versioning, and a Lambda function; `-c backup=on` adds an AWS Backup vault and plan, `-c replica=on` a second bucket and a replication configuration |
| 22 | `vp run recovery:status / seed / accident / restore:table / restore:objects / diff / verify / repair / protect / audit / drop-table / empty` | AWS | not run | - | The steps of the drill. None was run against AWS, and there are no measured RPO or RTO values |
| 24 | `vp run test:unit (examples/24-celld)` | local | passed | 2026-10-12 | Failures injected at each step of the update ordering (no waiting), the ledger judged against a toy fleet, the probe script run by bash and curl, the install script's arguments and its checksum refusal, generation of the unit and user data, reading diagnose output, backup and restore plans, pricing inputs, and stack assertions |
| 24 | `vp run celld:infra:synth` | local | passed | 2026-10-12 | Synthesized the default (no node) and `-c nodes=1`, `-c nodes=3`, `-c nodes=2 -c stateOnDestroy=delete`, and `-c nodes=2 -c dataSnapshots=a:snap-0123456789abcdef0` |
| 24 | `vp run celld:plan / vp run celld:render` | local | passed | 2026-10-12 | The plan and fixed cost per fleet size, and that deploy/ matches what the generators produce |
| 24 | `vp run celld:fetch` | local | passed | 2026-10-12 | Downloaded the Linux arm64 archives of v0.6.2 and v0.6.1 from the GitHub releases and confirmed their size and SHA-256 against the pinned values. Nothing was unpacked or run (`--host` was not used) |
| 24 | `celld の実行（celld dev、celld deploy、node の起動）` | local | not run | - | The downloaded binary was never run. Everything said about celld's behavior comes from reading the v0.6.2 documentation and source |
| 24 | `vp run celld:infra:deploy と node への配置（artifacts、install、start、app-deploy）` | AWS | not run | - | Deploying the stack, uploading the archive to S3, installing and starting on the nodes, and deploying the application were not run |
| 24 | `vp run celld:rollout / celld:drain / celld:stop-all` | AWS | not run | - | Draining and the rolling update from v0.6.1 to v0.6.2 were not run on real nodes. The ordering was checked against a local stand-in only |
| 24 | `vp run celld:loss-check` | AWS | not run | - | The check that loses a node and judges the invariant has never been pointed at a real celld fleet |
| 24 | `vp run celld:backup / celld:restore` | AWS | not run | - | Backup and restore of a stopped fleet were not run. Whether a fleet restored from the bucket copy and the snapshots starts correctly is unconfirmed |

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

### uploads-s3-post-policy

Chapter 07: the presigned POST has never been sent to real S3. In particular, whether S3 accepts the form's tagging field under the policy condition {"tagging": ...} is unconfirmed, because the table of POST policy conditions does not list tagging. Refusal by content-length-range and Content-Type, the bucket's CORS, and HeadObject right after the POST are unconfirmed too.

To resume: After vp run uploads:infra:deploy, uploads:user:create, and uploads:publish, sign in, put the access token into AIH_ACCESS_TOKEN, and run vp run uploads:smoke:api. If S3 refuses the tagging field, switch to uploading under a separate prefix and copying the object on finish.

### uploads-lifecycle

Chapter 07: that the lifecycle rule deletes objects tagged pending, that it leaves objects whose tag was removed, and that cdkd can create and read back the lifecycle and CORS settings are all unconfirmed.

To resume: After deploying, make one upload that is never finished and one that is, then check two days later with vp run uploads:sweep and vp run uploads:infra:drift.

### uploads-credential-lifetime

Chapter 07: the lifetime of the temporary credentials of a Lambda execution role could not be confirmed from a primary source. How often a presigned URL expires early is unknown.

To resume: Look for a figure in the official Lambda documentation. Failing that, record the credentials' expiration in a deployed function and report it as an observation.

### uploads-form-replay

Chapter 07: replaying the same form within the permit's lifetime (5 minutes) after finishing puts the object back to pending, and a day later only the record is left. Written up as a gap in the prose and in a test, and not closed.

To resume: Switch to a presigned PUT with If-None-Match (after confirming on real S3 that a signed Content-Length pins the size), or add a step that removes the tag again after the permit expires.

### ssr-aws-path

The chapter 09 setup has never run in AWS. Unconfirmed: that Nitro's handler runs on the Node.js 24 runtime behind a function URL, that the function URL accepts OAC-signed requests and refuses direct ones, that the cache policy and the response headers policy behave as intended, the real values of the x-cache and age headers the smoke test reads, and the response to a method that is not allowed.

To resume: Run vp run build:ssr, ssr:infra:deploy, ssr:assets:publish, and ssr:smoke in that order. If the smoke test fails, record whether the verdict (examples/09-ssr/scripts/smoke-spec.ts) or the real headers differ before changing anything. Finish with ssr:unpublish --yes and ssr:infra:destroy.

### ssr-streaming-path

Whether a streamed response arrives piece by piece across Lambda, the function URL (RESPONSE_STREAM), CloudFront, and a browser is unconfirmed. So are CloudFront not compressing a streamed response and what is returned when the handler's shape and InvokeMode disagree. Only the number and timing of the Nitro handler's writes were checked locally.

To resume: After vp run ssr:check:output:stream, ssr:assets:publish, and ssr:infra:deploy, fetch /feed with curl -sN and / with curl -s -o /dev/null -D - --compressed, and record the spacing of the lines and the content-encoding. Go through the distribution, not the function URL directly.

### ssr-cdkd-cloudfront-policies

cdkd 0.296.28 has no dedicated implementation for AWS::CloudFront::CachePolicy or AWS::CloudFront::ResponseHeadersPolicy and handles them through Cloud Control API. Whether create, update, drift read-back, and delete work in practice is unconfirmed, as is whether a cache policy with minTtl and defaultTtl of 0 and maxTtl of 60 accepts the compression settings.

To resume: Run vp run ssr:infra:deploy and ssr:infra:drift. If they fail, record how and ask the author for a decision; do not substitute another tool.

### ssr-bff-deployed

Chapter 09's BFF (sign-in, sessions, holding the token) works only locally: sessions sit in process memory, sign-in is a POST, and a function URL with OAC does not pass a browser form POST as it is. That a deployed environment returns each cookie holder their own page was not checked.

To resume: The author decides the approach (for example, sessions in DynamoDB and API Gateway as the POST entry point). Once decided, implement it in examples/09-ssr and add a check with a real session to ssr:smoke.

### obs-lambda-json-log-shape

Not checked in AWS: that under Lambda's JSON log format the JSON line the application passes to console.log reaches CloudWatch Logs unchanged. The metric filter's JSON pattern and the field names in the Logs Insights queries depend on it.

To resume: After vp run obs:infra:deploy and vp run obs:smoke, run vp run obs:query --name request --id <x-request-id>. Check that the lines are found with fields such as status, and that NoteConflicts gets a data point. If the shape differs, write through process.stdout in src/compose.ts or change the field names in the queries.

### obs-otel-layer-node24

The configuration with the AWS Lambda Layer for OpenTelemetry on a Node.js 24 function has not been run. The ADOT documentation lists runtimes up to Node.js 22. Also unconfirmed for an ESM function bundled by esbuild: whether hand-written spans reach the layer's SDK, whether the AWS SDK auto-instrumentation takes effect, and whether xray:PutTraceSegments on the execution role is enough.

To resume: Take the Tokyo layer ARN from the Node.js table in the ADOT documentation and run vp run obs:infra:deploy -c otelLayerArn=<ARN>. After vp run obs:smoke, check in the X-Ray console that notes.* spans appear under Lambda's segment. If not, look for layer errors in the function's log and compare with the nodejs22.x runtime.

### obs-alarm-behavior

The alarms' real state changes have not been observed. That the metric math IF expression is accepted, that 5xx and Count have no data points while there are no requests, and that the SNS notification arrives are read from the documentation.

To resume: After vp run obs:infra:deploy -c alarmEmail=<your address>, confirm the subscription mail and check the states with vp run obs:alarms. To cause 5xx responses, deploy a change that temporarily removes the table permission, from another branch and in a practice account.

### obs-cdkd-cloud-control

cdkd 0.296.28 handles AWS::CloudWatch::Dashboard and AWS::Logs::MetricFilter through Cloud Control API. Whether create, update and drift read-back work in practice is unconfirmed.

To resume: Run vp run obs:infra:deploy and vp run obs:infra:drift. If they fail, record how and ask the author for a decision; do not substitute another tool.

### obs-pricing-gaps

Not confirmed: the price of a dashboard beyond the third, the size of the system log lines Lambda writes in the JSON format, and whether spans sent through the layer are billed as X-Ray traces.

To resume: Open the pricing page in a browser that runs JavaScript and read the dashboard price. After deploying, measure the total bytes of @message per request with Logs Insights and correct the assumption in data/fragments/19.json. A few days later, look at the usage types in Cost Explorer.

### 14-deploy

The chapter 14 stack has never been deployed. Unconfirmed: that the conditional `ADD` loses no concurrent increment on the real service, how long TTL really takes to delete an item, how the memory variant behaves once Lambda runs several execution environments, and creation and deletion through cdkd 0.296.28.

To resume: Run `vp run kv:infra:deploy`, then `vp run kv:smoke` and check that the sixth request is refused with 429. Run `vp run kv:infra:drift`, and finally `vp run kv:infra:destroy`.

### 14-elasticache

Nothing has ever connected to an ElastiCache Serverless cache with a public endpoint. Unconfirmed: that CloudFormation and Cloud Control API accept `ConnectionType: public` with `UserGroupId: default.iam-user-group`; that 1,000 is a valid ECPU maximum in `CacheUsageLimits`; that ElastiCache accepts the hand-signed SigV4 token; that iovalkey's `Cluster` can read the topology through a public endpoint; the TLS 1.3 connection; how many ECPUs a script (EVAL) uses; and how long the cache takes to create and delete.

To resume: Knowing that it is billed, run `vp run kv:infra:deploy -c store=valkey`. Check with `vp run kv:smoke` that the store is reported as `elasticache` and the sixth request is refused. On failure, search `vp run kv:logs` for `valkey connection error`, `cache store failed`, and `rate limiter failed`, and compare with the Troubleshooting table of 'Connect to a cache with a public endpoint'. Run `vp run kv:infra:destroy -c store=valkey` as soon as you are done.

### 14-docker

`vp run kv:local:start` and `kv:local:stop`, which start and stop Valkey and DynamoDB Local in Docker containers, were not run. The contract tests themselves passed against the same DynamoDB Local version and a Valkey 9.1.2 process.

To resume: Start a Docker daemon, copy `examples/14-kv-cache/.env.example` to `.env`, and run `vp run kv:local:start`, `vp run kv:local:migrate`, `vp run kv:test:local`, and `vp run kv:local:stop` in that order.

### 20-cfn-deploy

The CloudFormation path (bootstrap, diff, deploy, smoke, status, destroy) has not been run in a real account

To resume: After `vp run ship:cfn:bootstrap`, run `vp run ship:cfn:diff`, `ship:cfn:deploy`, `ship:smoke`, `ship:cfn:status`, and `ship:cfn:destroy` in order. Record that `ship:smoke` gets a 200 through the alias and that `cdk diff --method template` works with the lookup role alone. Compare what the CDKToolkit stack created with the table in the chapter

### 20-oidc-roles

The OIDC roles have not been assumed from GitHub Actions

To resume: Run `vp run ship:ci:deploy -c githubRepository=<owner>/<repo>` and put the four output ARNs and the account ID into the repository's variables. Copy the four files in workflows/ to .github/workflows/ and run a pull request, a push to main, and a manual drift run once each. Record that assuming from another branch or repository is refused, whether the repository's sub uses the immutable format, and that the plan job does not run for a fork's pull request

### 20-drift-role-permissions

The DriftRole's read permissions were derived from resource type schemas; whether they suffice for a real detection is unconfirmed

To resume: Run `vp run ship:cfn:drift -c stage=prod` as the DriftRole. If it ends `failed` or `incomplete`, add the action named in the report's reason to examples/20-shipping/infra/lib/ci-stack.ts and update the list in the test. If it suffices, check CloudTrail for actions that were never used and remove them

### 20-drift-live

No real CloudFormation drift response has been captured. Coverage (whether the Integration is left unchecked, whether an inline policy change shows as drift on the Role) is unconfirmed

To resume: Run the 'Break it on purpose' procedure in the chapter. At each step keep reports/drift/AihShipApi.json and the output of `aws cloudformation describe-stack-resource-drifts` at the same moment, and compare their shape with the fixtures in tools/src/drift/fixtures/cloudformation/. Run against a stack name that does not exist and confirm the error's name and message are `ValidationError` and `does not exist`. Compare the resource types left unchecked with the two lists in examples/20-shipping/src/drift-coverage.ts

### 20-rollback-live

A failed deploy's rollback, moving the alias, and `cdk rollback` have not been observed in a real account

To resume: Deploy a change that fails on purpose (for example a Lambda memorySize above the limit) and record the statuses `vp run ship:cfn:status` reports until UPDATE_ROLLBACK_COMPLETE. Deploy twice successfully and confirm the older version remains, and that versions are gone once the stack is deleted

### 20-tool-migration

Moving a stack between cdkd and CloudFormation (`cdkd export`, `cdkd import --migrate-from-cloudformation`) has not been run

To resume: Deploy a practice stack with cdkd, read the plan from `cdkd export <stack> --dry-run`, then run it. Record whether it stops on a resource type that cannot be imported, and that afterwards cdkd's state is gone and `cdk diff` on the CloudFormation stack is empty. Try the reverse direction on the same stack

### 12-image-build

The chapter 12 Dockerfile has never been built. Unverified: that the .dockerignore exception leaves only dist/server.mjs in the context, that the image starts on the arm64 variant of node:24-bookworm-slim, that it runs with --read-only, and how large the image is.

To resume: Start a Docker daemon, then run `vp run ecs:bundle`, `vp run ecs:image:build v1`, and `vp run ecs:image:run v1`. Call `curl http://localhost:8080/health` from another terminal, press Ctrl-C, and check for the `stopped` log line and exit code 0. Read the size from `docker image ls aih-notes`.

### 12-deploy

The chapter 12 stack has never been deployed. Unverified: that cdkd 0.296.28 creates and deletes the ECR, ECS, and ALB resources, that it reads the chapter 11 VPC through Fn::ImportValue, that the three types routed through Cloud Control API (ScalableTarget, ScalingPolicy, SecurityGroupEgress) work, that tasks in public subnets can pull the image, and that the load balancer's DNS name answers.

To resume: Run `vp run net:infra:deploy`, `vp run ecs:infra:deploy`, `vp run ecs:image:push v1`, and `vp run ecs:infra:deploy -c imageTag=v1` in that order, then `curl` the `ServiceUrl` output. After `vp run ecs:infra:drift`, remove everything with `vp run ecs:infra:destroy` and `vp run net:infra:destroy` (hourly charges).

### 12-rolling-update

A rolling update has not been observed on AWS. Unverified: that no request fails during one, that old and new versions answer alternately, that SIGTERM arrives only after the target has been deregistered, that the circuit breaker rolls back when given a broken image, and what cdkd's --full-wait reports when it does.

To resume: With v1 deployed, run `vp run ecs:watch` in a second terminal, then `vp run ecs:image:push v2` and `vp run ecs:infra:deploy -c imageTag=v2`. Read the summary of `ecs:watch` and the times of the `draining` and `stopped` lines in `vp run ecs:logs`. Then deploy a tag that does not exist and record `rolloutState` from `aws ecs describe-services` and cdkd's exit code.

### 12-private-subnets

The `-c taskSubnets=private` layout has not been run on AWS. Unverified: that tasks pull the image and ship logs through a NAT gateway and through interface endpoints, and that egress on port 443 alone is enough.

To resume: Deploy chapter 11 with `-c egress=nat`, deploy chapter 12 with `-c imageTag=v1 -c taskSubnets=private`, and check `ServiceUrl`. Then redeploy chapter 11 with `-c interfaceEndpoints=ecr.api,ecr.dkr,logs`, replace the tasks by deploying a new tag, and check again. Destroy right afterwards.

### 12-alb-idle-lcu

What a load balancer's LCU usage is with no requests (whether health checks count) was not confirmed from a primary source. The cost tables leave LCUs out of the idle figures.

To resume: Deploy, wait a day, and read the quantity of `APN1-LCUUsage` in Cost Explorer or the bill.

### async-s3-event-shape

Chapter 08: whether a create event from a form (ObjectCreated:Post) and a delete event from a lifecycle rule (LifecycleExpiration:Delete) carry a sequencer is unconfirmed. The documentation says it is "only used with PUT and DELETE requests". The worker fails a create event without one, which sends it to the DLQ, and accepts a delete event without one while doing nothing.

To resume: After vp run async:infra:deploy, run vp run async:smoke with AIH_ACCESS_TOKEN set. If no record appears for the form upload, look at the DLQ with vp run async:queue. If POST events have no sequencer, order by eventTime and eTag instead, or route S3 notifications through EventBridge.

### async-notification-deploy

Chapter 08: that fixing the bucket's name to avoid a cycle with the queue policy actually deploys with cdkd is unconfirmed. So are: S3 validating that it can send to the queue when the notification is configured, S3 sending to a queue encrypted with SQS-managed keys (SSE-SQS), Lambda validating the role's permissions when the event source mapping is created, and GetObject answering 412 for an If-Match with a quoted ETag.

To resume: Run vp run async:infra:deploy. If creating the bucket fails with "Unable to validate the following destination configurations", check that the queue policy was created first. Then run vp run async:smoke.

### async-idle-polling-cost

Chapter 08: the documentation does not say how often Lambda long-polls an empty queue, so the number of SQS requests in an idle month cannot be estimated.

To resume: Deploy, wait a day, read the SQS metric NumberOfEmptyReceives in CloudWatch, and report it as an observation.

### async-housekeeping-scale

Chapter 08: one housekeeping run looks at every object in the bucket and reads DynamoDB four times per image, in sequence. Its duration has not been measured. As the count grows it runs into both the function's timeout (15 minutes) and the cost of reads.

To resume: Read the duration in the REPORT line with vp run async:logs --function housekeeping. If it is too long for the number of images, run less often, look only at recent objects, or use S3 Inventory as the input.

### async-inspection-orphans

Chapter 08: there are two ways an inspection record can be left without its object. A worker handling a create event is about to write when another worker finishes the delete event for the same key. Or a lifecycle delete event arrives without a sequencer. Neither is visible to users, but the record stays.

To resume: Instead of deleting the record on a delete event, write a tombstone carrying the sequencer under the same condition, and let DynamoDB's TTL remove it.

### 23-deploy

The chapter 23 stack has never been deployed. Unverified: that cdkd 0.296.28 creates the instance, instance profile, and security group with its own providers and the volume and attachment through Cloud Control API, that the AMI ID resolves from the SSM-typed parameter, and that the chapter 11 outputs are read through `Fn::ImportValue`.

To resume: After `vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages`, run `vp run ec2:infra:deploy`, `vp run ec2:status`, and `vp run ec2:infra:drift`. Then delete everything in the order of the cleanup section (hourly charges).

### 23-first-boot

The user data has not run on a real Amazon Linux 2023. Unverified: that dnf reaches the repositories from a private subnet through the S3 gateway endpoint alone (that they are in S3 was inferred from host names in sample output in the documentation), that `nodejs24` and `xfsprogs` install, that the `/dev/sdf` link appears, that the wait loop outlasts the attachment, that the unit's directives (such as `AssertPathIsMountPoint`) are accepted by the systemd on AL2023, and the size of the root volume (pricing assumes 8 GiB).

To resume: After deploying, run `vp run ec2:status` to see the cloud-init result, the service state, and the mount. If it failed, connect with `vp run ec2:session` and read `/var/log/cloud-init-output.log`. Check the root volume with `aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=<instance id>`; if it is not 8 GiB, fix `ASSUMED_ROOT_GIB` in `src/cost.ts` and the amounts in the text.

### 23-ssm-endpoints

Whether all three interface endpoints are needed was not checked. The Systems Manager documentation says SSM Agent 3.3.40.0 and later prefers ssmmessages, but does not say the ec2messages endpoint can be omitted. The agent version in the AMI was not looked at either.

To resume: Redeploy the chapter 11 stack with `-c interfaceEndpoints=ssm,ssmmessages`, reboot the instance, and see whether `vp run ec2:status` reports Online and `vp run ec2:smoke` passes. If so, the monthly cost drops by USD 20.44.

### 23-release

The release path (upload to S3, Run Command, `notes-release` on the instance, restart, and the `/health` check) and that a restart lets a request in flight finish have not been run on a real instance. Session Manager and port forwarding were not run either (the plugin is not in the devShell).

To resume: Run `vp run ec2:app:release`, `vp run ec2:smoke`, and `vp run ec2:logs`. Release again, then go back with `vp run ec2:app:rollback <version>`. Install the Session Manager plugin, run `vp run ec2:forward`, and call `curl http://localhost:8787/health` from your machine.

### 23-replace-and-restore

Not run: that the data volume survives and is reattached when the instance is replaced, restoring from a snapshot, and what happens to the volume attachment on destroy. In the cdkd source, a change to `UserData` is not applied to the instance and a change to `ImageId` replaces it. How the attachment behaves during a replacement (detached from the old instance and attached to the new, or failing midway) could not be determined from the source.

To resume: Create one note, run `vp run ec2:data:unmount`, then deploy with `-c amiId=<the previous AMI>` to force a replacement. On the new instance run `vp run ec2:status`, `vp run ec2:app:release`, and `vp run ec2:smoke`, and see whether the note is still there. Then go through the snapshot and restore procedure.

### 23-patch

`ec2:patch:check` and `ec2:patch:apply` have not been run on a real instance. Patch Manager (`AWS-RunPatchBaseline`) is described only; there is no task for it.

To resume: Deploy with an AMI a few weeks old through `-c amiId=...`, confirm that `vp run ec2:patch:check` lists a newer release, and run `vp run ec2:patch:apply <releasever>`. If the kernel was updated, reboot with `aws ec2 reboot-instances` and run `vp run ec2:smoke`.

### 16-deploy

The chapter 16 stack has never been deployed. Unconfirmed: that cdkd 0.296.28 creates the state machine from an inline DefinitionString (an Fn::Join); that the trust policy conditions on the state machine's role are accepted; that Scheduler calls StartExecution with `<aws.scheduler.scheduled-time>` replaced in the input; the input and output of a Task whose Resource is a function ARN; that the name of a Lambda exception matches the `ExportCorrupt` catcher; that S3 answers 412 to `If-None-Match: *` and the SDK throws it as an exception with status 412; that HeadObject returns metadata keys in lower case; whether the Lambda function keeps running after a Task times out; and the real number of state transitions.

To resume: Run `vp run export:infra:deploy`, `vp run export:seed --notes 250`, and `vp run export:start --id check-1 --wait`, then look at the manifest and the history count with `vp run export:status`. Run `export:start` again with the same ID and check for ExecutionAlreadyExists. For the failure paths, delete one part in the S3 console during a run, or shorten the ExportPages function's timeout for a while. Finish with `vp run export:empty --yes` and `vp run export:infra:destroy`.

### 16-durable

The Lambda durable function has never been deployed. Unconfirmed: that it is available in ap-northeast-1 (the only evidence is the Tokyo SKUs in the Price List); that cdkd 0.296.28 creates a function with DurableConfig, and Lambda::Version and Lambda::Alias through Cloud Control API; that the execution role's permissions (CheckpointDurableExecution and GetDurableExecutionState on `function:<name>:*`) are enough; that SDK 2.6.0 bundled by esbuild runs on nodejs24.x; that `DurableExecutionName` prevents a duplicate start; what really happens when one invocation hits the function timeout; and the real number of durable operations and their cost.

To resume: Run `vp run export:infra:deploy -c durable=true`, then `vp run export:seed` and `vp run export:durable:start --id check-1`, and follow it in the Durable executions tab of the Lambda console and with `vp run export:logs --function durable`. Start the same ID again and check that no new execution appears. Check the manifest with `vp run export:status`. Finish with `vp run export:empty --yes` and `vp run export:infra:destroy -c durable=true`.

### 16-containers

Running a step as an ECS task (`ecs:runTask.sync`) or an AWS Batch job is described in prose only; there is no code and no test. The IAM, the networking, how a task's exit code is handled, and the measured cost are unconfirmed.

To resume: Package the export worker as an image the way chapter 12 does (immutable tags, no `fromAsset`) and replace the ExportPages state with `arn:aws:states:::ecs:runTask.sync`. Progress then has to live in S3, since a task returns no value. This needs a Docker daemon.

### 21-deploy

The default stack (CloudFront, the function URL, Secrets Manager) has not been run in a real account

To resume: After `vp run sec:infra:deploy`, run `vp run sec:smoke` immediately and record the N in "after N refusals". Check that a direct curl of the function URL gets 403, record the result of `vp run sec:infra:drift`, and after `vp run sec:infra:destroy` confirm in the Secrets Manager console that no secret remains, not even as scheduled for deletion

### 21-rotation

Rotating the secret has not been tried in a real account

To resume: After deploying, run `vp run sec:smoke`, `vp run sec:secret:rotate`, and `vp run sec:smoke` again. Record that a token issued with the old key version verifies right after the rotation, that `sec:secret:versions` shows AWSCURRENT and AWSPREVIOUS, that a rerun with the same `--version-id` reports already-rotated, and that a second rotation within ten minutes stops with too-soon. Also check whether GetSecretValue on a secret with no AWSPREVIOUS fails with ResourceNotFoundException

### 21-waf

The web ACL has not been created, and the rate-based rule has not been observed

To resume: Pass the WebAclArn output of `vp run sec:waf:infra:deploy` to `vp run sec:infra:deploy -c webAclArn=<ARN>`. Send more than 300 requests in five minutes from one IP address and record how long, and how many requests, it takes before 403s begin. Confirm in the WAF console that AwsCommonRules records matches as counts. Check on the bill whether the usage type is Global-* or USE1-*. Afterwards detach with `sec:infra:deploy` (no webAclArn), then `vp run sec:waf:infra:destroy`

### 21-cmk

The customer managed key variant has not been tried in a real account

To resume: Run `vp run sec:infra:deploy -c cmk=on`, then `vp run sec:smoke`. Confirm the function reads the secret with only kms:Decrypt under the kms:ViaService condition. After `vp run sec:infra:destroy`, record that the key is pending deletion in the KMS console and due to disappear in 7 days, and whether the bill shows a key charge for that period

### 21-iam-propagation

The delay before an IAM change takes effect has not been observed

To resume: Record over several deploys whether `vp run sec:smoke` right after a deploy reports 0 refusals. Then delete ReadSigningKey from HandlerRole in the console, wait for a new execution environment, call `/token` repeatedly, and record how long it takes to get a 503 and whether a 200 appears again after the first 503. Afterwards check the difference with `vp run sec:infra:drift` and revert

### 21-posture

`sec:posture` and `sec:trail:iam` have not been run against a real account, and GuardDuty, Inspector, Config, a trail, and Organizations have not been enabled

To resume: Run `vp run sec:posture` and confirm all six reads succeed, and that an account outside any organization answers AWSOrganizationsNotInUseException. Enable GuardDuty in the console, confirm the line turns to on, and record the estimate the console's usage page shows during the 30-day trial. With `vp run sec:trail:iam`, confirm the CreateRole from a deploy appears in the us-east-1 event history. Try the SCP only if you can set up a practice organization and OU: attach `policies/scp-guardrails.json` to the OU

### 22-drill

The chapter 22 recovery drill has never been run on AWS. Unconfirmed: how long a PITR restore takes, the real lag of `LatestRestorableDateTime`, which settings a restored table does and does not inherit (deletion protection and PITR included), the ETag, `LastModified`, and notifications after removing a delete marker or copying a version on top in S3, the order of versions that share a timestamp in `ListObjectVersions`, and any measured RPO or RTO.

To resume: After `vp run recovery:infra:deploy`, follow the chapter's drill section: `recovery:drill new`, `recovery:seed --apply`, `recovery:accident --apply`, `recovery:restore:table --apply`, `recovery:restore:objects --at <time> --apply`, `recovery:verify --table <restored table> --frozen`, `recovery:repair`, then record what `recovery:drill summary` prints in a copy of `examples/22-recovery/drill/TEMPLATE.md`. Finish with the three cleanup tasks.

### 22-cutover

The cutover to a restored table was not tried on AWS. Unconfirmed: that deploying with `-c table=<name>` changes only the function's environment and IAM policy, that cdkd's drift check does not report the restored table, that `cdkd orphan` and `cdkd import --resource` can swap the stack's table, what destroying a `-c protect=on` stack with cdkd does, and creating and deleting `-c backup=on` (through Cloud Control API) and `-c replica=on`.

To resume: Continuing the drill, read the diff from `vp run recovery:infra:diff -c table=<restored table>`, deploy, then run `vp run recovery:audit` and `vp run recovery:infra:drift`. To try the import, first read the output of `cdkd orphan AihRecovery/Notes --dry-run` and `cdkd import AihRecovery --resource <logical ID>=<restored table> --dry-run` in `examples/22-recovery`.

### 24-deploy

The chapter 24 stack has never been deployed and celld has never been started on EC2. Unverified: that cdkd 0.296.28 can create this template, that nodes in a private subnet reach the fleet bucket through the S3 gateway endpoint alone, that celld obtains credentials from the instance role with IMDSv2 required, that this chapter's list of IAM actions is enough, that celld runs under the systemd sandboxing (ProtectSystem=strict), and that a t4g.small is enough.

To resume: Run, in order: `vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages`, `vp run celld:fetch --host`, `vp run celld:infra:deploy -c nodes=1`, `vp run celld:artifacts`, `vp run celld:install`, `vp run celld:app-deploy`, `vp run celld:start`, `vp run celld:status`, `vp run celld:smoke`, `vp run celld:diagnose`. If celld does not start, read `vp run celld:logs`. Then delete everything in the order of the cleanup section (hourly charges).

### 24-fleet-operations

Draining, a rolling update, losing a node, and backup and restore have never been run on a real fleet of two or three nodes. Unverified: that `celld diagnose --json` prints what this chapter's parser expects, that the health gate really closes and opens, that the remaining nodes take over cells after a stop with `--skip-os-shutdown`, and that a fleet restored from `aws s3 sync` and EBS snapshots starts.

To resume: After `vp run celld:infra:deploy -c nodes=3`, run `vp run celld:install v0.6.1`, `vp run celld:app-deploy`, `vp run celld:start`, `vp run celld:rollout v0.6.2`, `vp run celld:loss-check b`, `vp run celld:revive b`, `vp run celld:stop-all`, `vp run celld:backup`, and `vp run celld:restore <id>` (dry run), and record each output in the verification notes.

### 24-recheck-celld

celld is beta, with a release roughly every week around the time of writing. The upgrade notes, defaults, CLI flags, and diagnose output format this chapter copied are those of v0.6.2.

To resume: Before using a newer release, reread that tag's `docs/README.md` (Upgrade notes, Shut down and roll out a node, Environment variables), `docs/guarantees.md`, `docs/security.md`, and `docs/limitations.md`, then update the version, digests, upgrade notes, and defaults in `examples/24-celld/src/celld.ts` and run the tests.
