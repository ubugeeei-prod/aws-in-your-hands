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
| 09 | `nuxt dev on port 3909 (the command behind dev:ssr, started directly) + HTTP requests` | local | passed | 2026-10-11 | Started with AIH_SSR_SIGN_IN=dev and checked public pages, the 404, /me, sign-in, sign-out, the 403 for a cross-site POST, and /feed arriving in three chunks. Not exercised in a browser |
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
| 17 | `vp run test:unit (examples/17-ai)` | local | passed | 2026-10-12 | 59 tests: fixture streams (complete, maxTokens, cut midway, throttled midway, throttled at open), cancellation and timeout, the client, the SSE frame, the function URL adapter run with a stand-in for awslambda, and the CDK assertions |
| 17 | `vp run typecheck (examples/17-ai)` | local | passed | 2026-10-12 | Includes scripts/ and infra/ |
| 17 | `vp run ai:infra:synth` | local | passed | 2026-10-12 | Includes the esbuild bundle (no Docker); 5 resources |
| 17 | `vp run dev:ai + curl` | local | passed | 2026-10-12 | Started with AI_BACKEND=fixture. Checked /health, a streamed summary, the 400 for invalid input, the `cancelled` log line after disconnecting midway (curl cut off at 0.5 s; durationMs 501), and the error event with AI_FIXTURE=truncated |
| 17 | `vp run check:all` | local | passed | 2026-10-11 | Passed with chapter 17 added |
| 17 | `vp run dev:ai (AI_BACKEND=bedrock)` | AWS | not run | - | The local server calling real Bedrock; billed |
| 17 | `vp run ai:hello / ai:test:live` | AWS | not run | - | Calls a real model; billed. The model ID, the permissions, and the real event shapes can only be checked here |
| 17 | `vp run ai:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a Lambda function, a function URL, an IAM role, and a log group |
| 17 | `vp run ai:smoke / ai:logs` | AWS | not run | - | Needs the deployed function URL; billed |
| 21 | `vp run test:unit (examples/21-security)` | local | passed | 2026-10-12 | Token signing and verification; the key cache across a rotation (an environment with a stale cache, two rotations, a flood of made-up version ids, Secrets Manager down, concurrent requests); the rotation procedure (a rerun after a lost response, a second rotation too soon, a reused version id); reading the secret through a substituted SDK client; the wildcard lint and its reasoned exceptions; the lint applied to chapter 20's CI roles; the SCP JSON and the evaluation model; waiting for IAM propagation; the posture verdicts; stack assertions (by default only one secret has a monthly fee; the key and the web ACL are opt-in) |
| 21 | `vp run sec:infra:synth` | local | passed | 2026-10-12 | Synthesized with the pinned cdkd 0.296.28 and no credentials. Checked that cdk.out holds the AihSecurity and AihSecurityWaf templates, that -c cmk=on and -c webAclArn=... change the template, and that a malformed webAclArn stops the synth |
| 21 | `vp run sec:iam:lint (own cdk.out, and every chapter's cdk.out)` | local | passed | 2026-10-12 | This chapter's two templates pass with no exceptions. The result of passing every chapter's cdk.out after `vp run infra:synth` is as written in the chapter's "Running it over the whole book" |
| 21 | `vp run dev:sec` | local | passed | 2026-10-12 | Checked /health, /token, and /verify on the local server with curl. The key exists only in memory; AWS is not called |
| 21 | `vp run sec:infra:deploy / sec:smoke / sec:infra:drift / sec:infra:destroy` | AWS | not run | - | Not run. Behavior through CloudFront, the function URL, and Secrets Manager; whether a 503 appears right after a deploy; that no secret remains after destroy |
| 21 | `vp run sec:secret:versions / sec:secret:rotate` | AWS | not run | - | Not run. How the staging labels move after PutSecretValue, a rerun with the same version id, and an environment with a stale cache accepting new tokens after a rotation |
| 21 | `vp run sec:waf:infra:deploy / sec:infra:deploy -c webAclArn=... / sec:waf:infra:destroy` | AWS | not run | - | Not run. Creating the web ACL in us-east-1, associating it with the distribution, how long the rate-based rule takes to start blocking, and what the counted rule group records |
| 21 | `vp run sec:infra:deploy -c cmk=on` | AWS | not run | - | Not run. Encrypting the secret with a customer managed key, the function reading it under the kms:ViaService condition, and the state of the key after destroy |
| 21 | `vp run sec:posture / sec:trail:iam` | AWS | not run | - | Not run. The actual responses of the read APIs of six services, and the output when a permission is missing |
| 30 | `vp run modeling:test:local (DynamoDB Local 3.3.1)` | local | passed | 2026-10-13 | Ran the 14 table rules and the 21 notebook rules against DynamoDB Local 3.3.1, started directly from the jar AWS distributes with Java 21 (port 8030, -inMemory -sharedDb -disableTelemetry) and not through Docker; the table was created by `scripts/local-db.ts reset`. The stream consumer and the migration were not run on DynamoDB Local |
| 33 | `node examples/33-production-readiness/scripts/check.ts` | local | passed | 2026-10-13 | Ran the script behind `vp run ready:check` directly, without its `infra:synth` dependency (other chapters were being written in the same tree, so every stack could not be synthesized again). It read the 27 templates of chapters 02 to 24 and the book site that were already in cdk.out, plus this chapter's 2. The counts in the chapter are from this run and do not include the stacks of chapters 25 to 32 and 34 to 36 |
| 46 | `node examples/46-shield/scripts/origins.ts --gate AihShield examples/46-shield/cdk.out` | local | passed | 2026-10-13 | What shield:origins:gate runs. The function URL of AihShield is closed |
| 46 | `node scripts/flood.ts (examples/46-shield)` | local | passed | 2026-10-13 | What shield:flood runs. The table in the chapter is this output |
| 64 | `vp run isolates:infra:drift -c imageTag=<tag>` | AWS | not run | - | Not run |
| 66 | `vp run distsql:local:start, then vp run distsql:local:verify (no TLS)` | local | passed | 2026-10-13 | Three pairs of yb-master and yb-tserver on 127.0.0.1 (PostgreSQL 15.12-YB-2025.2.7.0-b0). Chapter 13's four migrations and its repository ran unchanged. Twelve creates at once through three nodes against a quota of 3: 3 created, 9 quota_exceeded, 16 retries after 40001, note_count and the rows agreeing at 3. After SIGKILL of node b, a and c returned all 40 acknowledged notes, and the next 20 creates took 1.1 s. With b and c down, the one node left acknowledged no write in 20 s; with them back, all 40 acknowledged notes were there (and, in this run, the unacknowledged one too) |
| 66 | `vp run distsql:local:certs, vp run distsql:local:start --tls, then vp run distsql:local:verify` | local | passed | 2026-10-13 | With a CA and a certificate for 127.0.0.1 made by openssl (Homebrew's 3.6.1; the Nix shell has none), and TLS and password authentication on, the same verification ran twice. A client without TLS was refused. 12 retries after 40001. The 20 creates after losing b took 4.3 s. The one create with two nodes lost timed out on connect in one run and got no answer for 20 s in the other, and was absent afterwards in both. A ysql_dump fed into a second database with ysqlsh held all 40 acknowledged notes. yb-admin answered list_all_masters and modify_placement_info with --certs_dir_name, and without it gave up after 60 s without finding the leader |
| 66 | `vp run distsql:artifact / distsql:install / distsql:certs / distsql:configure / distsql:start / distsql:status / distsql:health / distsql:logs / distsql:stop` | AWS | not run | - | No task that touches the nodes was run |
| 25 | `vp test run examples/25-events` | local | passed | 2026-10-13 | 7 files, 97 tests. Patterns that match and do not (the very objects the stack deploys, evaluated by the local matcher), the matcher refusing operators it does not implement, stream records turned into events and the stability of their IDs, the contract and its version (a gained field is read, the next version and a lost field are refused), duplicate delivery, reordering, a failing target retried and set aside, a replay from the archive delivered to an idempotent and a non-idempotent consumer, replay planning, telling dead letters apart, the shape of requests to DynamoDB, and infrastructure assertions. The bus is the in-memory model, not EventBridge. Four conditions were also broken on purpose, and 5, 3, 2, and 11 tests failed |
| 25 | `vp run events:demo` | local | passed | 2026-10-13 | Ran creations, an update, a duplicate publish, a doubled delivery in reverse order, and a replay through the in-memory bus, and read from the output that the counter that remembers IDs stays at 1, the one that does not reaches 3, and the rejection notice is still sent once after the replay |
| 25 | `vp run events:infra:synth / tsc --noEmit -p examples/25-events` | local | passed | 2026-10-13 | Chapter 08's 24 resource types plus seven (Events::EventBus, Events::Rule, Events::Archive, Pipes::Pipe, SNS::Topic, SNS::TopicPolicy, SNS::Subscription): 31 in all, and no Custom:: resource. scripts/ is type-checked only |
| 25 | `vp run events:infra:diff / events:infra:deploy / events:smoke / events:status / events:replay / events:infra:drift / events:empty / events:infra:destroy` | AWS | not run | - | Nothing was run against AWS |
| 26 | `vp test run examples/26-analytics` | local | passed | 2026-10-13 | 62 tests: the record schema against the table's columns, no note text or path in a record, an unchanged answer when the record cannot be written, a double write and a timeout reproduced with the real SDK and a faked network, an object that straddles midnight, queries that count a duplicate once, the rendered SQL, per-column sizes in Parquet, the pricing inputs, and stack assertions |
| 26 | `tsc --noEmit -p examples/26-analytics` | local | passed | 2026-10-13 | Type check |
| 26 | `vp run analytics:infra:synth` | local | passed | 2026-10-13 | Synth including the esbuild bundle, also with -c format=parquet |
| 26 | `vp run dev:analytics + curl + vp run analytics:query:local` | local | passed | 2026-10-13 | Ran the curl commands from the chapter: objects appear under dist/lake and the local model prints the aggregates. No SQL was executed |
| 26 | `vp run analytics:query:print` | local | passed | 2026-10-13 | Prints the SQL that would go to Athena. Makes no call to AWS |
| 26 | `vp run analytics:sizes` | local | passed | 2026-10-13 | Writes 5,000 sample records as gzip JSON and as Parquet and prints bytes per column. The Parquet file is written by a JavaScript library on the laptop |
| 26 | `vp run analytics:infra:deploy` | AWS | not run | - | Not run. None of the Firehose, Glue or Athena resources was created |
| 26 | `vp run analytics:smoke` | AWS | not run | - | Not run |
| 26 | `vp run analytics:query` | AWS | not run | - | Not run. Whether Athena accepts the rendered SQL was not checked |
| 26 | `vp run analytics:infra:drift` | AWS | not run | - | Not run |
| 26 | `vp run analytics:empty / analytics:infra:destroy` | AWS | not run | - | Not run |
| 27 | `vp test run examples/27-search` | local | passed | 2026-10-13 | 9 files, 80 tests: tokenizing and BM25, rank fusion, cutting passages, owner separation (an index that ignores the filter, a forged owner, 200 rounds of random hits), table and index out of step, idempotent indexing and deletes, a failure mid-batch and its retry, the race between a rebuild and the stream, sources and citations of an answer, input limits of the API, the shape of requests to S3 Vectors, and stack assertions |
| 27 | `tsc --noEmit -p examples/27-search` | local | passed | 2026-10-13 | Type check of src, infra, test and scripts |
| 27 | `vp run search:infra:synth` | local | passed | 2026-10-13 | Bundled the two functions with esbuild and wrote a template with 14 resources. Asked AWS nothing |
| 27 | `vp run dev:search` | local | passed | 2026-10-13 | Started with SEARCH_BACKEND=local and ran the curl commands in the chapter (/health, /search per owner, the 401 without an owner, /answers, and /answers that finds nothing). The output quoted in the chapter is from this run |
| 27 | `vp run search:infra:deploy` | AWS | not run | - | Not deployed. That the S3 Vectors index is created through Cloud Control and that the event source mapping is accepted are unconfirmed |
| 27 | `vp run search:seed` | AWS | not run | - | Not run |
| 27 | `vp run search:smoke` | AWS | not run | - | Not run. Titan embeddings, S3 Vectors queries and the streamed answer have never been called for real |
| 27 | `vp run search:reindex` | AWS | not run | - | Not run |
| 27 | `vp run search:logs` | AWS | not run | - | Not run |
| 27 | `vp run search:infra:drift` | AWS | not run | - | Not run |
| 27 | `vp run search:infra:destroy` | AWS | not run | - | Not run. That an index holding vectors, and then its bucket, can be deleted is unconfirmed |
| 28 | `vp test run examples/28-multi-region` | local | passed | 2026-10-13 | 85 tests. On a model that keeps two Regions in memory: replication lag in MREC, one of two simultaneous edits from two Regions vanishing, chapter 05's check working again when writes go to one Region, a counter losing an increment, an overwrite after Tokyo is cut off and a write that arrives late, the 409 and the refusal of an isolated Region in MRSC. The rules of S3 replication (objects older than the rule, delete markers, deletes that name a version, two-way, the difference in speed from the table). Health check decisions, failover and latency answers, a client holding an old DNS answer, the parts of the RTO. The per-Region wrapper of the API (header, health check, refusing writes). Stack assertions. Chapter 05's repository contract against a replica in both modes |
| 28 | `tsc --noEmit -p examples/28-multi-region` | local | passed | 2026-10-13 | Type check. No errors |
| 28 | `vp run mr:infra:synth` | local | passed | 2026-10-13 | Wrote the templates of both stacks (AihMultiRegionStandby in ap-northeast-3, AihMultiRegion in ap-northeast-1). No call to AWS |
| 28 | `vp run mr:demo` | local | passed | 2026-10-13 | Ran the six scenes on two Regions in memory. The output quoted in the chapter is from this run |
| 28 | `mutation check (7 changes to examples/28-multi-region)` | local | passed | 2026-10-13 | Broke the code in seven places on purpose (the last-writer-wins comparison, the answer when every record is unhealthy, refusing writes, delete marker replication, the version condition, EvaluateTargetHealth, and others) and confirmed that the tests failed each time |
| 28 | `vp run mr:standby:infra:deploy / mr:infra:deploy / mr:infra:diff / mr:infra:drift / mr:infra:destroy / mr:standby:infra:destroy` | AWS | not run | - | Not run. That cdkd can create the AWS::DynamoDB::GlobalTable and its replica, deploy a stack in another Region from one app, and apply replication into a bucket with a fixed name was not confirmed on AWS |
| 28 | `vp run mr:status / mr:conflict / mr:empty` | AWS | not run | - | Not run. What a real global table does with two simultaneous edits from two Regions was confirmed only against the documentation and the model |
| 29 | `vp test run examples/29-lambda-tuning` | local | passed | 2026-10-13 | Reading REPORT lines and platform.report (with the lines printed in the Lambda documentation), billed duration, the concurrency model, the timeout chain, the deadline against a table that never answers, the size and budget of five bundles, the deployed bundle loaded in plain Node.js and talking to a stand-in for DynamoDB, and infrastructure assertions |
| 29 | `tsc --noEmit -p examples/29-lambda-tuning` | local | passed | 2026-10-13 | Type check |
| 29 | `vp run tune:infra:synth` | local | passed | 2026-10-13 | Synthesizes the template, bundling with esbuild. Makes no call to AWS |
| 29 | `vp run tune:bundle` | local | passed | 2026-10-13 | Bytes of five bundles, the share of each package, and the time a fresh Node.js process takes to import each. The times are a Mac's, not Lambda's |
| 29 | `vp run tune:plan` | local | passed | 2026-10-13 | Prints the timeout chain, the price at each memory setting and the price of provisioned concurrency. Makes no call to AWS |
| 29 | `vp run tune:report:sample` | local | passed | 2026-10-13 | Summarizes the REPORT lines copied from the Lambda documentation |
| 29 | `vp run tune:infra:deploy` | AWS | not run | - | Not run |
| 29 | `vp run tune:smoke` | AWS | not run | - | Not run |
| 29 | `vp run tune:report` | AWS | not run | - | Not run. No time was measured on Lambda |
| 29 | `vp run tune:infra:drift` | AWS | not run | - | Not run |
| 29 | `vp run tune:infra:destroy` | AWS | not run | - | Not run |
| 30 | `vp test run examples/30-data-modeling` | local | passed | 2026-10-13 | 119 passed, 1 skipped (the one for DynamoDB Local). Key ranges and order, write plans, page tokens, the table rules and the notebook rules on the in-memory model, index lag and the number of index writes, retries of colliding transactions, a delete stopped half way, stream batches delivered twice, the function's own writes, the migration phases with resume and interleaving, the shape of requests to DynamoDB, and stack assertions |
| 30 | `vp run modeling:db:reset:local && vp run modeling:test:local (DynamoDB Local 3.3.1)` | local | passed | 2026-10-13 | Ran the 16 table rules and the 19 notebook rules against DynamoDB Local 3.3.1, started directly from the jar AWS distributes with Java 21 (port 8030, -inMemory -sharedDb -disableTelemetry) and not through Docker; the tasks were given `DYNAMODB_ENDPOINT=http://localhost:8030` in the environment. The stream consumer and the migration were not run on DynamoDB Local |
| 30 | `vp run modeling:demo` | local | passed | 2026-10-13 | Ran every access pattern once on the in-memory model. The output quoted in the chapter is from this run |
| 30 | `vp run modeling:infra:synth` | local | passed | 2026-10-13 | Synthesized the default layout, including the esbuild bundle (9 resources). `-c insights=on` was synthesized inside the tests. The bundle was imported in plain Node.js |
| 30 | `tsc --noEmit -p examples/30-data-modeling` | local | passed | 2026-10-13 | Type check |
| 30 | `vp run modeling:infra:deploy` | AWS | not run | - | Never deployed to AWS |
| 30 | `vp run modeling:smoke` | AWS | not run | - | Not run against a real table, index, stream, or function |
| 30 | `vp run modeling:backfill / modeling:verify / modeling:remove-legacy` | AWS | not run | - | The migration tasks were not run against a real table |
| 30 | `vp run modeling:infra:drift / modeling:infra:destroy` | AWS | not run | - | Not run |
| 31 | `vp test run examples/31-progressive-delivery` | local | passed | 2026-10-13 | The shift plan (CodeDeploy's nine predefined names), decisions from alarm states, running a shift (alarms, a lost answer, a failed write, a change by someone else, interruption and resume), the order of the calls to AppConfig and the stop plan, checks on the flag file, flag evaluation and percentage rollout, the fallback when AppConfig cannot be reached, the application layer, two versions reading the same records, stack assertions, and the CodeDeploy and ECS canary templates. 12 files, 103 tests |
| 31 | `tsc --noEmit -p examples/31-progressive-delivery` | local | passed | 2026-10-13 | The type check |
| 31 | `vp run rollout:infra:synth` | local | passed | 2026-10-13 | Synthesis with cdkd 0.296.28. It asks AWS nothing |
| 31 | `vp run rollout:plan` | local | passed | 2026-10-13 | Printing the plan. The output quoted in the chapter is from this run |
| 31 | `vp run flags:check` | local | passed | 2026-10-13 | Checking the flag file. The output quoted in the chapter is from this run |
| 31 | `vp run dev:rollout` | local | passed | 2026-10-13 | On the local server: editing the flag file takes effect from the next request, a broken file leaves the last values in use, and the probe counts answers per version |
| 31 | `vp run rollout:infra:deploy` | AWS | not run | - | Not run. Whether cdkd can actually create the Lambda alias and version and the four AppConfig types, all of which go through the Cloud Control API, is unconfirmed |
| 31 | `vp run rollout:start --apply` | AWS | not run | - | Not run |
| 31 | `vp run rollout:status / rollout:rollback / rollout:probe` | AWS | not run | - | Not run |
| 31 | `vp run flags:deploy --apply / flags:status / flags:stop / flags:clear` | AWS | not run | - | Not run |
| 31 | `vp run rollout:infra:diff / rollout:infra:drift / rollout:infra:destroy` | AWS | not run | - | Not run |
| 32 | `vp test run examples/32-limits` | local | passed | 2026-10-13 | 12 files, 91 tests: the token bucket, backoff and jitter, the retry budget, the retrying client, two seeded simulations, how many attempts the installed SDK makes when DynamoDB throttles (against a fake handler), the development server's two limits, the first-limit arithmetic, the load target check and summary, reading a Cost Explorer response, and stack assertions |
| 32 | `tsc --noEmit -p examples/32-limits` | local | passed | 2026-10-13 | Type check |
| 32 | `vp run limits:infra:synth` | local | passed | 2026-10-13 | Synth, including the esbuild bundle. Asks AWS nothing |
| 32 | `vp run limits:simulate` | local | passed | 2026-10-13 | The table of the two simulations. The numbers in the chapter are this output |
| 32 | `vp run dev:limits + vp run limits:load` | local | passed | 2026-10-13 | Started the development server and sent 5, 10, 20 and 40 requests a second for 5 seconds each, once with the default CALLER_LIMIT of 50 and once with 100000. The tables in the chapter are this output. Also checked that a target other than localhost is refused |
| 32 | `vp run limits:cost:print / vp run limits:quotas:book` | local | passed | 2026-10-13 | Prints the command that would run, and the book's list of quotas. No AWS call. Argument names checked against the help of aws service-quotas and aws ce (AWS CLI 2.35.11) |
| 32 | `vp run limits:infra:deploy` | AWS | not run | - | Not deployed |
| 32 | `vp run limits:quotas` | AWS | not run | - | The account's actual quotas were not read |
| 32 | `vp run limits:cost` | AWS | not run | - | Cost Explorer was not called (USD 0.01 a run) |
| 32 | `vp run limits:infra:drift` | AWS | not run | - | Not run |
| 32 | `vp run limits:infra:destroy` | AWS | not run | - | Not run |
| 33 | `vp test run examples/33-production-readiness` | local | passed | 2026-10-13 | 5 files, 110 tests. Reading a template (refusing what is not one, following references, telling a literal from an intrinsic), a passing and a failing case for each of the 10 rules, waivers (a reason is required, unused waivers, chapter 21's exceptions taken in), the verdict (reported stacks, gated stacks, a gate that read nothing), the two fixtures, the review items (every rule is placed, every task exists), the synth and the check result of the practice and production twins, and the aspect reaching a table added later. The code was also broken on purpose in 11 places to confirm that tests fail (one did not at first, which exposed a bucket policy array that was never read) |
| 33 | `tsc --noEmit -p examples/33-production-readiness` | local | passed | 2026-10-13 | Type check of the sample, its scripts, tests, and CDK code |
| 33 | `vp run ready:infra:synth` | local | passed | 2026-10-13 | Wrote the two templates, AihReadyPractice and AihReadyProduction, to cdk.out. It asks AWS nothing |
| 33 | `vp run ready:gate` | local | passed | 2026-10-13 | The practice stack reported 7 findings and the production stack passed with 2 reasoned waivers. The output quoted in the chapter is from this run |
| 33 | `vp run ready:review` | local | passed | 2026-10-13 | Printed the list: 8 areas, 32 items |
| 33 | `node examples/33-production-readiness/scripts/check.ts <cdk.out of chapters 02-24 and book/infra>` | local | passed | 2026-10-13 | Ran the script behind `vp run ready:check` directly, without its `infra:synth` dependency (other chapters were being written in the same tree, so every stack could not be synthesized again). It read the 27 templates of chapters 02 to 24 and the book site that were already in cdk.out: 81 findings and 7 waived. The counts in the chapter are from this run and do not include the stacks of chapters 25 to 32 and 34 to 36 |
| 33 | `vp run ready:check` | local | not run | - | Not run as a task: it depends on `infra:synth`, which synthesizes every stack of the book again |
| 33 | `account:whoami, sec:posture, sec:trail:iam, sec:secret:versions, sec:secret:rotate, obs:alarms, ship:cfn:diff, ship:cfn:drift, recovery:status, account:budget:create` | AWS | not run | - | The tasks the review points at that read or change the account. None was run for this chapter |
| 34 | `vp test run examples/34-eks` | local | passed | 2026-10-13 | The manifest schemas and reference checks, k8s/ against the generators, the arithmetic of rolling updates, disruption budgets and drains, the timing rules, support windows, pricing, and stack assertions |
| 34 | `tsc --noEmit -p examples/34-eks` | local | passed | 2026-10-13 | Type check |
| 34 | `vp run eks:infra:synth` | local | passed | 2026-10-13 | Synthesized twice: without context and with `-c deployRoleArn=arn:aws:iam::123456789012:role/aih-deploy`. Nothing was asked of AWS |
| 34 | `vp run eks:render` | local | passed | 2026-10-13 | k8s/cluster.json and k8s/app.json match what the generators produce |
| 34 | `vp run eks:manifests cluster --node-role ... --security-group ... ; vp run eks:manifests app --image ...` | local | passed | 2026-10-13 | Printed the manifests with every value given as a flag, reading nothing from AWS |
| 34 | `vp run eks:infra:deploy` | AWS | not run | - | No cluster was created. Whether cdkd 0.296.28 can create AWS::EKS::Cluster, AccessEntry, and PodIdentityAssociation through Cloud Control API is unverified |
| 34 | `kubectl apply -f - (vp run eks:manifests cluster / app)` | AWS | not run | - | kubectl is not in the Nix shell, and there is no cluster. The manifests were never given to an API server |
| 34 | `vp run eks:infra:destroy` | AWS | not run | - | Not run |
| 35 | `vp test run examples/35-lambda-managed-instances` | local | passed | 2026-10-13 | 8 files, 52 tests. Two requests in flight swapping request IDs with module scope and not with AsyncLocalStorage, replayed in a fixed order both as function calls and over real sockets. Two worker threads each holding their own Map. Settings validation, the model of the path to CloudWatch Logs, pricing inputs, the break-even arithmetic, and stack assertions |
| 35 | `tsc --noEmit -p examples/35-lambda-managed-instances` | local | passed | 2026-10-13 | Type check |
| 35 | `vp run lmi:infra:synth` | local | passed | 2026-10-13 | Synthesized the defaults and `-c instanceType=m7g.large`, `-c minExecutionEnvironments=0 -c maxExecutionEnvironments=0`, and `-c maxVCpuCount=16`. esbuild bundles the handler. Nothing is asked of AWS |
| 35 | `vp run lmi:plan` | local | passed | 2026-10-13 | Ran the defaults, `instanceType=m7g.large`, `interfaceEndpoints=` (no endpoint, exit code 2), and `maxVCpuCount=8` (an invalid setting, exit code 1) |
| 35 | `vp run dev:lmi` | local | passed | 2026-10-13 | Started the local server through the task and got answers from `/health` and `POST /notes` with curl |
| 35 | `node src/dev.ts (the command behind vp run dev:lmi, without --watch)` | local | passed | 2026-10-13 | Started the local server and got answers from `/health` and `POST /notes` with curl. Also started it with `SCOPE=module` |
| 35 | `vp run net:infra:deploy -c interfaceEndpoints=logs` | AWS | not run | - | Adds the CloudWatch Logs endpoint to the chapter 11 network. Billed by the hour |
| 35 | `vp run lmi:infra:diff` | AWS | not run | - | Not run |
| 35 | `vp run lmi:infra:deploy` | AWS | not run | - | Not run. Three instances are expected to start, billed by the hour |
| 35 | `vp run lmi:smoke` | AWS | not run | - | Not run |
| 35 | `vp run lmi:infra:drift` | AWS | not run | - | Not run |
| 35 | `vp run lmi:infra:destroy` | AWS | not run | - | Not run |
| 36 | `vp run test:unit (examples/36-bedrock)` | local | passed | 2026-10-13 | 110 tests: hand-written answer sequences (answering with tools, a tool that does not exist, input that is not JSON, a guardrail block, a cut in the middle of a tool request, a cut in the middle of the answer, throttling, a model that never stops asking for tools, a model that obeys a note), the test that breaks the invariant, structured output with one repair, reserving and settling the budget, cache point placement, batch input and output, the evaluation, the app, the function URL adapter, and the CDK assertions |
| 36 | `tsc --noEmit -p examples/36-bedrock` | local | passed | 2026-10-13 | Includes scripts/ and infra/ |
| 36 | `vp run bedrock:infra:synth` | local | passed | 2026-10-13 | Includes the esbuild bundle (no Docker); 9 resources of 8 types |
| 36 | `vp run dev:bedrock (AI_BACKEND=scripted) と curl` | local | passed | 2026-10-13 | /health, the 401 without a token, the SSE of /assistant, the JSON of /notes/:id/action-items, and the two log lines; turn_limit with AI_TRANSCRIPT=runaway-tools |
| 36 | `vp run bedrock:eval` | local | passed | 2026-10-13 | 4 cases, against the scripted model; no model was called |
| 36 | `vp run bedrock:batch:plan` | local | passed | 2026-10-13 | Passes with 100 records and stops with --records 40; nothing is sent to S3 |
| 36 | `vp run bedrock:eval:live` | AWS | not run | - | Billed. No real model has ever been called |
| 36 | `vp run bedrock:infra:deploy` | AWS | not run | - | The stack has not been deployed |
| 36 | `vp run bedrock:smoke` | AWS | not run | - | Billed. Needs the deployed stack |
| 36 | `vp run bedrock:logs` | AWS | not run | - | Needs the deployed stack |
| 36 | `vp run bedrock:infra:drift` | AWS | not run | - | Needs the deployed stack |
| 36 | `vp run bedrock:infra:destroy` | AWS | not run | - | Needs the deployed stack |
| 37 | `vp test run examples/37-cloudshell` | local | passed | 2026-10-13 | 5 files, 50 tests. The actions the three policies let through; budget states; state keys and resources; the table of billed types against each chapter's example; batches of 1,000; the loop emptying an in-memory bucket (refusal, re-run, a write partway, no progress); and the built file run against a fake aws |
| 37 | `tsc --noEmit -p examples/37-cloudshell` | local | passed | 2026-10-13 | Type check |
| 37 | `vp run cloudshell:build` | local | passed | 2026-10-13 | Wrote dist/aih-cloudshell.mjs. Run on Node.js 24.21.0; not run on Node.js 18 |
| 37 | `vp run cloudshell:demo` | local | passed | 2026-10-13 | Ran whoami, budget, left and empty against the fake aws. The output quoted in the chapter is from this run. Nothing reached AWS |
| 37 | `vp run cloudshell:policy use-no-files` | local | passed | 2026-10-13 | Printed the policy JSON quoted in the chapter |
| 37 | `nix path-info -r (devShell の 5 つの道具) / du -sh node_modules` | local | passed | 2026-10-13 | 166 store paths and 1,968,352,824 bytes; node_modules is 1.9 GB. Values on macOS (aarch64-darwin) |
| 37 | `node aih-cloudshell.mjs whoami / budget / left (CloudShell)` | AWS | not run | - | No CloudShell session was opened |
| 37 | `node aih-cloudshell.mjs empty <bucket> --yes --account <id> (CloudShell)` | AWS | not run | - | Not run |
| 37 | `aws iam create-policy / attach (cloudshell:policy の出力)` | AWS | not run | - | The policies were not attached to a real role |
| 38 | `vp test run examples/38-data-movement` | local | passed | 2026-10-13 | 63 tests. The plan (new, changed, same; PRESERVE and REMOVE; an empty source listing deleting everything; filtered-out objects not deleted; overwriting a newer archive object and OverwriteMode NEVER; TransferMode ALL; include and exclude; refusing ALL with REMOVE; the listing schema). The filter model (splitting, escapes, folders, wildcards, the include restriction). The execution model (convergence and re-runs on a quiet source, finishing an interrupted execution, overwrites after the copy and after the listing, an upload after the listing, ERROR under whole-dataset verification, deletes in the source, writes made in the archive). The event schema and decision, the handler's notification and failure, the lag bound, the environment. Assertions for both stacks |
| 38 | `tsc --noEmit -p examples/38-data-movement` | local | passed | 2026-10-13 | Type check of src, infra, test, and scripts |
| 38 | `vp run move:demo` | local | passed | 2026-10-13 | Ran, on two in-memory buckets, an execution that stops part-way, the one that finishes it, one after changes on both sides, and one with nothing to do. The output quoted in the chapter is from this run |
| 38 | `vp run move:infra:synth` | local | passed | 2026-10-13 | Wrote the templates of both stacks. The layout with `-c sourceLocation=<ARN>` was synthesized inside the tests and by passing context to `node infra/bin/app.ts` |
| 38 | `vp run move:infra:diff / deploy / drift / destroy, move:archive:infra:diff / deploy / destroy` | AWS | not run | - | Creates a bucket and a DataSync location in Tokyo, and the archive bucket and its location in Osaka. `-c sourceLocation=<ARN>` adds the scheduled task, a log group, an EventBridge rule, a function, and an SNS topic. The DataSync resources go through Cloud Control API |
| 38 | `aws datasync start-task-execution / describe-task-execution, vp run move:empty` | AWS | not run | - | Running the task and cleaning up. None was run against AWS |
| 39 | `vp test run examples/39-database-migration` | local | passed | 2026-10-13 | On this chapter's model (two PGlite instances, changes recorded by triggers): updates and deletes during the copy, a change in both the copy and the log, a resume after a stop before the checkpoint advanced, duplicates and uncarried updates on a table without a primary key, a copy with foreign keys quiet, the sequence collision and the advance, what the count-and-digest comparison sees and misses, a late write and an overwrite by a resume after the switch. Also the table-mapping schema and its application, the preflight check, the cutover decisions, and the stack assertions. 7 files, 56 tests |
| 39 | `tsc --noEmit -p examples/39-database-migration` | local | passed | 2026-10-13 | Type check |
| 39 | `vp run dbmig:demo` | local | passed | 2026-10-13 | Ran the preflight check, the preparation, the full load, the apply step, the write stop, the comparison, the sequences, and the cutover decision on two PGlite instances. The output quoted in the chapter is from this run. It is this chapter's model, not DMS |
| 39 | `vp run dbmig:infra:synth` | local | passed | 2026-10-13 | Synthesized the default layout (placeholder host names that cannot exist). `-c accountRoles=existing` and the capacity options were synthesized inside the tests |
| 39 | `vp run dbmig:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a DMS Serverless configuration, two endpoints, a subnet group, two secrets, IAM roles, a security group and rules, an SNS topic and an EventBridge rule. cdkd 0.296.28 has no dedicated implementation for AWS::DMS, and Endpoint and ReplicationSubnetGroup are not in the Cloud Control API list of supported types, so it is not expected to finish |
| 39 | `aws dms start-replication / describe-replications / describe-replication-table-statistics / stop-replication` | AWS | not run | - | Starting, watching, and stopping the replication. DMS was never run, and there are no measured durations, lags, or outage times |
| 39 | `vp run dbmig:preflight / dbmig:verify / dbmig:sequences` | AWS | not run | - | Connect directly to two PostgreSQL databases. Not run against real databases; the same functions are tested on PGlite |
| 40 | `vp test run examples/40-disaster-recovery` | local | passed | 2026-10-13 | The drill planner and verdict, a recovery order failing in the middle and resumed, the two-site model and split brain, validation of DRS events, API response shapes and the still-billed list, source and path checks, pricing inputs, and stack assertions |
| 40 | `tsc --noEmit -p examples/40-disaster-recovery` | local | passed | 2026-10-13 | Type check |
| 40 | `vp run dr:infra:synth` | local | passed | 2026-10-13 | Synthesized the default layout and `-c placement=public`, `-c templates=declare`, and `-c sourceRoleName=... -c sourceSecurityGroupId=sg-0123456789abcdef0` |
| 40 | `vp run dr:demo` | local | passed | 2026-10-13 | Printed the two-site failover and failback, the resumed order, and a drill summary locally |
| 40 | `vp run dr:plan` | local | passed | 2026-10-13 | With default arguments the 6.18 kernel is reported as a BLOCKER and the task exits with 2, as intended. Also run with `kernel=6.1` and `placement=public` |
| 40 | `vp run dr:infra:deploy` | AWS | not run | - | Not deployed |
| 40 | `aws drs initialize-service / create-replication-configuration-template` | AWS | not run | - | The service was not initialized and no template was created |
| 40 | `vp run dr:status / dr:drill / dr:job / dr:terminate / dr:billed` | AWS | not run | - | The DRS API was never called. No drill, recovery, or failback was performed |
| 41 | `vp test run examples/41-fargate` | local | passed | 2026-10-13 | 8 files, 89 tests: the size table and the choice from it, the strategy, the model of target tracking (not Application Auto Scaling), a stopping task's requests, SIGTERM to chapter 12's server, interrupting and resuming the job, command assembly, cost, and the stack assertions |
| 41 | `tsc --noEmit -p examples/41-fargate` | local | passed | 2026-10-13 | Type check |
| 41 | `vp run fargate:infra:synth` | local | passed | 2026-10-13 | Synthesized with no tag, with -c imageTag=f1, with -c exec=true added, and with -c taskSubnets=private. -c exec=yes is refused |
| 41 | `vp run fargate:bundle && vp run fargate:bundle:check` | local | passed | 2026-10-13 | Started server.mjs and job.mjs away from node_modules: the server exits with 0 on SIGTERM, the job with 0 when done and 75 when interrupted |
| 41 | `vp run fargate:simulate` | local | passed | 2026-10-13 | Ran this chapter's model over the morning curve. It is not Application Auto Scaling |
| 41 | `vp run fargate:size --cpu 180 --memory 410` | local | passed | 2026-10-13 | Printed 0.5 vCPU, 1 GB, USD 17.99 from the table and the prices in data/pricing |
| 41 | `vp run fargate:job:run --dry-run / fargate:exec --dry-run / fargate:image:push --dry-run` | local | passed | 2026-10-13 | Prints the AWS CLI and docker commands only. Flags checked against the help of AWS CLI 2.35.11 |
| 41 | `vp run fargate:image:build f1` | local | not run | - | Not run: no Docker daemon. The image has never been built |
| 41 | `vp run fargate:image:push f1` | AWS | not run | - | Not run |
| 41 | `vp run fargate:infra:diff` | AWS | not run | - | Not run |
| 41 | `vp run fargate:infra:deploy` | AWS | not run | - | Not run |
| 41 | `vp run fargate:job:run` | AWS | not run | - | Not run |
| 41 | `vp run fargate:exec` | AWS | not run | - | Not run |
| 41 | `vp run fargate:infra:drift` | AWS | not run | - | Not run |
| 41 | `vp run fargate:infra:destroy` | AWS | not run | - | Not run |
| 42 | `vp test run examples/42-firewall-manager` | local | passed | 2026-10-13 | 94 tests in 7 files: the scope decision (include and exclude maps, child OUs, AND and OR over tags, a resource created later, a resource leaving by tag, quotas), the security group audit rule and CIDR containment, rules read from a template, the managed service data of both policies, the web ACL association model with a seeded walk of 2,000 steps, the finding event and the notice, the cost arithmetic, and assertions on both stacks and the context. Also confirmed that the invariant tests fail when the model's decision is loosened |
| 42 | `tsc --noEmit -p examples/42-firewall-manager` | local | passed | 2026-10-13 | Type check |
| 42 | `vp run fwm:infra:synth:example` | local | passed | 2026-10-13 | Synthesized with the example account ID of AWS's documentation and an OU ID that only follows the documented shape. Two stacks (11 resources in AihFirewallManager, 1 in AihFirewallManagerEdge). Also confirmed that `vp run fwm:infra:synth` without context stops, and loaded the synthesized bundle of the notifier function in Node.js outside the test runner |
| 42 | `vp run fwm:cost` | local | passed | 2026-10-13 | Computed the example organization of five accounts from the unit prices in data/pricing: USD 226.04 a month at list price. The output quoted in the chapter is from this run |
| 42 | `vp run fwm:audit:templates` | local | passed | 2026-10-13 | Read the 46 templates that had a cdk.out at the time. Of 7 security groups: 4 compliant, 0 non-compliant, 3 with a rule the model does not evaluate. The output quoted in the chapter is from this run. No file of another chapter was changed |
| 42 | `vp run fwm:infra:deploy / fwm:edge:infra:deploy` | AWS | not run | - | Not run: the book has no organization. It needs a Firewall Manager administrator account, AWS Organizations with all features, and AWS Config in each account |
| 42 | `vp run fwm:infra:diff / fwm:infra:drift / fwm:edge:infra:drift` | AWS | not run | - | Not run, since nothing was deployed. How far drift detection can compare AWS::FMS::Policy, which goes through Cloud Control API, is unconfirmed |
| 42 | `vp run fwm:edge:infra:destroy / fwm:infra:destroy` | AWS | not run | - | Not run, since nothing was deployed. What stays in member accounts after the policies are deleted is unconfirmed |
| 43 | `vp test run examples/43-glue` | local | passed | 2026-10-13 | 62 tests: the specification (midnight, duplicates), the folder layout and which days can be rebuilt, the model of job runs (re-runs, a crash part-way, designs that use a bookmark), the DQDL text and the evaluation of the rules, the columns and rules copied into the script, the pricing quantities, rows read back from Parquet, and stack assertions |
| 43 | `tsc --noEmit -p examples/43-glue` | local | passed | 2026-10-13 | Type check |
| 43 | `vp run glue:infra:synth` | local | passed | 2026-10-13 | Synth, also with -c schedule=on |
| 43 | `vp run glue:spec` | local | passed | 2026-10-13 | From the 11 sample raw files: 401 rows for 2026-10-10 and 400 for 2026-10-11; all seven rules pass on both days |
| 43 | `vp run glue:contract` | local | passed | 2026-10-13 | The script's generated block is up to date |
| 43 | `python3 -c 'ast.parse(...)' glue/curate.py` | local | passed | 2026-10-13 | A syntax check only. The Nix shell has no Python, so the machine's own Python 3.12.2 parsed the file. Neither awsglue nor pyspark was imported |
| 43 | `vp check --fix (chapter 43's paths)` | local | passed | 2026-10-13 | Formatting and lint, awscdk-lint included, over the example, the pages and the fragment |
| 43 | `node book/theme/figure-cli.ts (chapter 43's pages)` | local | passed | 2026-10-13 | The four figures, two in each language |
| 43 | `vp run glue:infra:deploy` | AWS | not run | - | The stack was not created |
| 43 | `vp run glue:seed` | AWS | not run | - | The sample was not uploaded |
| 43 | `vp run glue:run` | AWS | not run | - | The job was not run. The Spark script has never been executed |
| 43 | `vp run glue:verify` | AWS | not run | - | The job's output was not compared with the specification |
| 43 | `vp run glue:infra:drift` | AWS | not run | - | No drift check was made |
| 43 | `vp run glue:empty` | AWS | not run | - | The bucket was not emptied |
| 43 | `vp run glue:infra:destroy` | AWS | not run | - | The stack was not destroyed |
| 44 | `vp test run examples/44-health` | local | passed | 2026-10-13 | 89 tests: reading the five documented samples, time parsing, the rule patterns against the fixtures, classification, the ledger's decisions, a duplicate, an out-of-order update, a closure, a failed publish, a crash in the middle and a concurrent copy reproduced, the text of a notice, and stack assertions (the deployed patterns are the tested ones, least privilege, the topic is not public, the resource types in use) |
| 44 | `tsc --noEmit -p examples/44-health` | local | passed | 2026-10-13 | Type check |
| 44 | `vp run health:replay` | local | passed | 2026-10-13 | Replayed 12 arrivals from the fixtures: 8 notices are printed, the duplicate and the stale update are dropped, and the second page and the copy delivered to us-west-2 never reach the function |
| 44 | `vp run health:infra:synth` | local | passed | 2026-10-13 | Both templates, AihHealth and AihHealthGlobal, are synthesized without asking AWS anything, including the esbuild bundle |
| 44 | `vp run health:infra:deploy / health:global:infra:deploy` | AWS | not run | - | Not deployed. That the rules match real Health events, the function, the ledger, and the mail have not been checked on AWS |
| 45 | `vp test run examples/45-infrastructure-composer` | local | passed | 2026-10-13 | 5 files, 46 tests. The four forms followed and the forms not followed; attributes, literals and map variables of Fn::Sub; parameters and pseudo parameters; names missing from the template; omitted types; refusing an entry without a Type and Fn::ForEach; the summary (counts, unreferenced resources, chains, cycles); the comparison of two templates; text and figure output; that the figure in the pages equals the CLI's output; choosing a template in cdk.out |
| 45 | `tsc --noEmit -p examples/45-infrastructure-composer` | local | passed | 2026-10-13 | Type check |
| 45 | `vp run composer:graph` | local | passed | 2026-10-13 | Printed the fixture's graph; the output quoted in the chapter is from this run. The --figure output was pasted into the chapter's figure |
| 45 | `vp run composer:graph:hello` | local | passed | 2026-10-13 | After hello:infra:synth, printed AihHello: 2 resources, 1 connection |
| 45 | `vp run composer:graph:ship` | local | passed | 2026-10-13 | After ship:cfn:synth, printed AihShipApi: 18 resources, 29 connections, longest chain 7 |
| 45 | `node scripts/graph.ts <リポジトリにあった cdk.out のテンプレート 50 個>` | local | passed | 2026-10-13 | All 50 templates found in the repository's cdk.out directories were read; no missing names and no cycles. The count is from a moment when other chapters were still being written |
| 45 | `node book/theme/figure-cli.ts (45章の 4 ページ)` | local | passed | 2026-10-13 | 4 figures, 0 problems |
| 45 | `Infrastructure Composer (AWS Toolkit for Visual Studio Code) で cdk.out のテンプレートを開く` | AWS | not run | - | Infrastructure Composer in VS Code was not opened |
| 45 | `CloudFormation コンソールの template studio でテンプレートを開く` | AWS | not run | - | The console was not opened |
| 46 | `vp test run examples/46-shield` | local | passed | 2026-10-13 | 6 files, 64 tests: the origin check (on templates CDK actually produced and on hand-written JSON), the cache header, the seeded flood simulation (rate-based rule, cache, brake), usage lines against the recorded scenarios, and assertions on the two stacks |
| 46 | `tsc --noEmit -p examples/46-shield` | local | passed | 2026-10-13 | Type check |
| 46 | `vp run shield:infra:synth` | local | passed | 2026-10-13 | Wrote the two templates, AihShield and AihShieldEdge, to cdk.out (with the esbuild bundle). No call to AWS |
| 46 | `vp run shield:origins:gate` | local | passed | 2026-10-13 | The function URL of AihShield is closed |
| 46 | `node examples/46-shield/scripts/origins.ts` | local | passed | 2026-10-13 | Read the 56 templates present in this checkout (of 28 resources, 22 direct and 6 closed). The numbers change as other chapters are synthesized. shield:origins runs infra:synth first; here the script was run directly against the cdk.out directories that already existed |
| 46 | `vp run shield:flood` | local | passed | 2026-10-13 | The table in the chapter is this output |
| 46 | `node -e import(cdk.out/asset.*/index.mjs) with a function URL event` | local | passed | 2026-10-13 | Loaded the bundle that synth produced in Node.js 25.8.1 and called /health and /notes with an event shaped like a function URL's. cache-control was public, max-age=5 and no-store |
| 46 | `vp run shield:infra:deploy` | AWS | not run | - | Not run |
| 46 | `vp run shield:edge:infra:deploy` | AWS | not run | - | Not run. A web ACL is billed by the month from the moment it exists |
| 46 | `vp run shield:edge:infra:deploy -c shieldAdvanced=on -c distributionArn=<arn>` | AWS | not run | - | Not run. Needs an account subscribed to Shield Advanced |
| 46 | `vp run shield:infra:drift` | AWS | not run | - | Not run |
| 46 | `vp run shield:infra:destroy / shield:edge:infra:destroy` | AWS | not run | - | Not run |
| 47 | `vp test run examples/47-step-functions` | local | passed | 2026-10-13 | 66 tests. The local interpreter (how retries are counted and how long they wait, error name matching, an expression with no value, a catcher's output, the evaluation order of Assign, callback tokens, Map), the import saga (each step failing and each step's answer getting lost, a step that runs twice, a refused scan, failures past Publish, a failing compensation and its redrive, two imports of one note ID, two definitions broken on purpose), the digest (a note not yet published stays hidden, the same answer when run twice), the table sent to TestState against the interpreter, and stack assertions. Everything ran against in-memory stand-ins: not Step Functions, DynamoDB, or S3 |
| 47 | `tsc --noEmit -p examples/47-step-functions` | local | passed | 2026-10-13 | Type check of src, test, scripts, and infra |
| 47 | `vp run sfn:local` | local | passed | 2026-10-13 | Ran the default, `--infected --refuse RemoveAttachment --times 4 --redrive`, and `--lose CreateNote`, and checked that the states passed, what was left behind, and the invariant verdict are what the page shows |
| 47 | `vp run sfn:infra:synth` | local | passed | 2026-10-13 | The AihStepFunctions template is synthesized without asking AWS anything |
| 47 | `vp run sfn:infra:deploy / sfn:start / sfn:callback / sfn:status / sfn:digest / sfn:empty / sfn:infra:destroy` | AWS | not run | - | Not deployed. Neither state machine has ever run on AWS |
| 47 | `vp run sfn:test-state` | AWS | not run | - | The TestState API was not called (it needs credentials). Whether the local interpreter and the real Step Functions give the same answers has not been checked |
| 48 | `vp test run examples/48-sdk` | local | passed | 2026-10-13 | 11 files, 104 tests. The real clients, observed against an HTTP server on the loopback interface. The tests of the defaults run in a separate process with environment variables and ~/.aws cut off |
| 48 | `tsc --noEmit -p examples/48-sdk` | local | passed | 2026-10-13 | Type check |
| 48 | `vp check examples/48-sdk (format and lint)` | local | passed | 2026-10-13 | Format and lint. No warnings |
| 48 | `vp run sdk:tour` | local | passed | 2026-10-13 | One call against a script that throttles twice and then answers; three log lines, one per attempt. The output quoted in the chapter is from this run |
| 48 | `vp run sdk:defaults` | local | passed | 2026-10-13 | Run with no variable and with AWS_NEW_RETRIES_2026=true. Reads this machine's ~/.aws/config. The output quoted in the chapter is from this run |
| 48 | `AWS_ACCESS_KEY_ID=<not real> AWS_SECRET_ACCESS_KEY=<not real> vp run sdk:credentials` | local | passed | 2026-10-13 | Run with keys that are not real in the environment and AWS_PROFILE unset. It stopped at fromEnv and did not reach AWS |
| 48 | `node book/theme/figure-cli.ts (48-sdk pages)` | local | passed | 2026-10-13 | No problems in the four figures, two per language |
| 48 | `vp run sdk:credentials (with this machine's real profile)` | AWS | not run | - | Not run. Depending on the profile it reaches AWS: STS, IAM Identity Center, or a sign-in token refresh |
| 48 | `any call to a real AWS endpoint with the pinned SDK` | AWS | not run | - | Not run. Everything this chapter observed was against the local server |
| 49 | `vp test run examples/49-athena` | local | passed | 2026-10-13 | 70 tests: statement text that does not change with a user's value, quoting of parameters, checks on values placed into DDL and MERGE, a duplicated start, the bounded wait, stopping, and paging against the chapter's own stand-in for the API, the scan and cost arithmetic, filling in the documented log tables, and stack assertions. No SQL was executed |
| 49 | `tsc --noEmit -p examples/49-athena` | local | passed | 2026-10-13 | Type check |
| 49 | `vp run athena:infra:synth` | local | passed | 2026-10-13 | Synth, also with -c lakeBucketName=<name>. Makes no call to AWS |
| 49 | `vp run athena:sql / vp run athena:logs:ddl` | local | passed | 2026-10-13 | Printed the ten statements and the four log table definitions. They only print text; nothing is run |
| 49 | `vp run athena:infra:deploy` | AWS | not run | - | Not run. Neither the workgroup, the saved queries, the role nor the bucket was created |
| 49 | `vp run athena:run` | AWS | not run | - | Not run. Whether Athena accepts this chapter's SQL was not checked |
| 49 | `vp run athena:infra:drift` | AWS | not run | - | Not run |
| 49 | `vp run athena:empty / athena:infra:destroy` | AWS | not run | - | Not run |
| 50 | `vp test run examples/50-agentcore` | local | passed | 2026-10-13 | 8 files, 51 tests. The HTTP contract (/ping and /invocations), refusal of a prompt that is not a string and of extra keys, reading the user from a forwarded token (pinning that the signature is not checked), refusal of another user's session ID in the same process and in a replaced one, the invariant against a model that obeys a note, folding memory (duplicates, holes, any order), agreement of process and store when the store refuses a write, when two answers finish together, and when the process is replaced, the mapping to Memory events, and stack assertions |
| 50 | `tsc --noEmit -p examples/50-agentcore` | local | passed | 2026-10-13 | Type check |
| 50 | `vp run agentcore:infra:synth` | local | passed | 2026-10-13 | 7 resources, 7 outputs. esbuild bundles src/server.ts into app.js, which becomes a ZIP asset. No call to AWS |
| 50 | `vp run agentcore:bundle:check` | local | passed | 2026-10-13 | app.js (1,750.8 KiB) started from a directory with no package.json under Node.js 24. GET /ping answers 200 Healthy and POST /invocations without a token answers 401. Not run on the Runtime's Node.js 22 |
| 50 | `node src/dev.ts (vp run dev:agentcore) + curl` | local | passed | 2026-10-13 | With chapter 36's transcript tool-then-answer, checked with curl that /invocations answers server-sent events, that Bob's token with Alice's session ID gets 403, and that a body with an added owner gets 400 |
| 50 | `vp check --fix (chapter 50 paths)` | local | passed | 2026-10-13 | Formatting and lint, awscdk-lint included. No warnings |
| 50 | `node book/theme/figure-cli.ts (chapter 50 pages)` | local | passed | 2026-10-13 | 4 figures (2 per language), no problems |
| 50 | `vp run agentcore:infra:deploy` | AWS | not run | - | Not deployed |
| 50 | `vp run agentcore:invoke` | AWS | not run | - | Not run (billed) |
| 50 | `vp run agentcore:infra:drift` | AWS | not run | - | Not run |
| 50 | `vp run agentcore:infra:destroy` | AWS | not run | - | Not run |
| 51 | `vp test run examples/51-chime-sdk` | local | passed | 2026-10-13 | 69 tests: who gets a join token (not signed in, not a member, owner-only actions), the order of seat operations (two first joins at once, two tabs, a removal and a close in the middle of a join, a meeting ending by itself, Chime failing), the in-memory table's conditions, the shape of the calls to DynamoDB and Chime, the page's decisions, and stack assertions (least privilege, /health as the only open route, the resource types in use). The seat code was also broken in six ways and the tests failed for each |
| 51 | `tsc --noEmit -p examples/51-chime-sdk / vp run typecheck:calls:web / lint:calls:web` | local | passed | 2026-10-13 | Type checks for the example and, with Vize, the page; the template lint |
| 51 | `vp run calls:infra:synth` | local | passed | 2026-10-13 | Synthesizes the template including the esbuild bundle (40 resources, 8 outputs) without contacting AWS. The bundle was also loaded in Node.js |
| 51 | `vp run build:calls:web` | local | passed | 2026-10-13 | The page build. The chunk containing amazon-chime-sdk-js is 1,325.59 kB (294.80 kB gzipped) and is loaded only on joining |
| 51 | `node --env-file=.env.example api/src/dev.ts と vp dev --port 5193（dev:calls:api、dev:calls:web と同じコマンド）` | local | passed | 2026-10-13 | Against the development API with curl: creating a room, 404 for a non-member, 401 without a token, adding a member, joining, leaving, closing. In a browser: sign-in, creating a room, joining, leaving and closing shown on screen, and session.ts (amazon-chime-sdk-js) loading. Port 5173 was in use, so the page ran on 5193 |
| 51 | `vp run calls:infra:diff / deploy / drift / destroy, calls:user:create, calls:config, preview:calls:web, calls:end` | AWS | not run | - | Creates the user pool, table, function and HTTP API, and makes a call in a Chime SDK meeting. A real call cannot be checked without AWS |
| 52 | `vp test run examples/52-ecr` | local | passed | 2026-10-13 | 60 tests: writing and reading references, wildcards, the four values of the tag setting, the two ways a moved tag breaks the invariant and the two repairs (on the repository model), the documentation's six examples reproduced, this chapter's policy, policies the schema refuses, the deploy decision, reading describe-images, the comparison with a preview, and the stack's assertions (the template's lifecycle policy equals the tested one, the push role's trust policy and exact list of actions, no deleting or configuring action, the resource types used) |
| 52 | `tsc --noEmit -p examples/52-ecr` | local | passed | 2026-10-13 | Type check |
| 52 | `vp run ecr:lifecycle:preview` | local | passed | 2026-10-13 | On the 46 images of the fixture, rule 1 expires 2, rule 2 expires 1, rule 3 expires 8, and 35 are kept. This is the chapter's evaluator, not ECR's preview |
| 52 | `vp run ecr:infra:synth` | local | passed | 2026-10-13 | The templates of the default layout (the repository alone) and of the layout with -c githubRepository=example/notes -c pullThroughCache=on are synthesized without asking AWS anything |
| 52 | `vp run ecr:infra:deploy` | AWS | not run | - | Not deployed. The repository, the push role and the pull-through cache rule were not created on AWS |
| 52 | `docker build / docker push` | local | not run | - | The Nix shell has no Docker daemon. No image was built or pushed |
| 52 | `vp run ecr:lifecycle:compare` | AWS | not run | - | ECR's lifecycle policy preview was not run. The evaluator has not been compared with ECR |
| 52 | `vp run ecr:scan:gate` | AWS | not run | - | No real scan result was read |
| 53 | `vp test run examples/53-efs` | local | passed | 2026-10-13 | 53 tests. The one-file-per-note repository interrupted at each step of a write. On a real file system (macOS, APFS): an in-place write shows half a note, rename into place shows only the old or the new content at every step, two copies of chapter 23's repository lose an acknowledged note, and a model of append. The chapter 04 API on top, IDs that climb out of the directory refused, and stack assertions |
| 53 | `tsc --noEmit -p examples/53-efs` | local | passed | 2026-10-13 | Type check |
| 53 | `vp run efs:infra:synth` | local | passed | 2026-10-13 | Synthesized the default layout and `-c dataOnDestroy=retain -c backup=true` without asking AWS anything (esbuild bundling included) |
| 53 | `vp run dev:efs (two processes, one directory)` | local | passed | 2026-10-13 | Started two servers on different ports over one directory; a note posted to one appeared in the other's list, and `/notes/..%2F..%2Fetc%2Fpasswd` answered 404 (curl) |
| 53 | `vp run efs:infra:deploy / efs:infra:drift / efs:infra:destroy` | AWS | not run | - | Nothing was run against AWS |
| 54 | `vp test run examples/54-kinesis` | local | passed | 2026-10-13 | 7 files, 76 tests. Partition keys mapped to shards (MD5), order within a shard, two readers reading the same records, reading again from a chosen position, retention, the per-shard write limit and a hot key, a shard split, PutRecords reordering a note's revisions on a partial failure and the fix, a duplicate from a write whose answer was lost, the handler applying records and reporting a poison record, a failed batch redelivered without being counted twice, a poison record holding back a shard and what each setting changes, a partial batch response being skipped when the mapping is not told to listen, the gap left by reading a child shard before its parent, a consumer added later reading from the start, the shape of requests to DynamoDB and Kinesis, parsing the documented failure record, and stack assertions. They run against the in-memory stream and the model of the event source mapping, not Kinesis or Lambda. Six conditions were also broken on purpose, and 4, 5, 7, 8, 3, and 1 tests failed |
| 54 | `vp run kinesis:demo` | local | passed | 2026-10-13 | Ran the four scenes through the in-memory stream and read the output. After a batch is redelivered because its answer was lost, the consumer that compares versions stays at 5 revisions and the one that does not reaches 10. With Lambda's defaults the poison record keeps b unapplied after 500 tries; with the stack's settings one record is given up on and b gets both revisions. When the first of two entries in a PutRecords request is refused once, resending the refused entries leaves version 2 built from 1 revision, and one revision of a note per request leaves 2. A consumer added an hour later ends with the same history as the first |
| 54 | `vp run kinesis:infra:synth / tsc --noEmit -p examples/54-kinesis` | local | passed | 2026-10-13 | The template was generated without calling AWS, function bundle included. Twelve resource types, each with a provider of its own in cdkd 0.296.28, and no Custom:: resource. scripts/ is type-checked only |
| 54 | `vp check --fix (examples/54-kinesis, the chapter's pages, data/fragments/54.json)` | local | passed | 2026-10-13 | Run on the chapter's own files only. No warnings, awscdk-lint included |
| 54 | `vp run kinesis:infra:diff / kinesis:infra:deploy / kinesis:put / kinesis:history / kinesis:replay / kinesis:failures / kinesis:infra:drift / kinesis:infra:destroy` | AWS | not run | - | Nothing was run against AWS |
| 55 | `vp test run examples/55-grafana` | local | passed | 2026-10-13 | The definition equals the dashboard in chapter 19's template, a drifted dashboard is refused, the generated Grafana JSON passes this chapter's schema and reads exactly chapter 19's metrics, the schema refuses broken input, the calls to Grafana's HTTP API (against a fake fetch), where the token may go, the pricing inputs, and the stack assertions |
| 55 | `tsc --noEmit -p examples/55-grafana` | local | passed | 2026-10-13 | Type check |
| 55 | `vp run grafana:infra:synth` | local | passed | 2026-10-13 | Synth of the default (the role only) and with -c authentication=AWS_SSO. No call to AWS |
| 55 | `vp run grafana:render` | local | passed | 2026-10-13 | Printed the Grafana dashboard JSON and, with --cloudwatch, the CloudWatch body |
| 55 | `aws grafana <command> help` | local | passed | 2026-10-13 | Checked the commands and option names scripts/push.ts uses against the help of AWS CLI 2.35.11. No call to AWS |
| 55 | `vp run grafana:infra:deploy -c authentication=AWS_SSO` | AWS | not run | - | Creates the workspace. The monthly bill starts |
| 55 | `vp run grafana:push` | AWS | not run | - | Reads chapter 19's dashboard, mints a token, saves the data source and the dashboard, deletes the token |
| 55 | `vp run grafana:infra:destroy` | AWS | not run | - | Deletes the workspace and the role |
| 56 | `vp test run examples/56-nova` | local | passed | 2026-10-13 | 98 tests: the list and retired models, the cost arithmetic, building the request and its limits, the describing job (simultaneous requests, a run that outlives its lease, taking over a dead run, failures, cut-off answers, another user), the app, the shape of the requests sent to S3, and the CDK assertions |
| 56 | `tsc --noEmit -p examples/56-nova` | local | passed | 2026-10-13 | Includes src, test, infra and scripts |
| 56 | `vp run nova:infra:synth` | local | passed | 2026-10-13 | Includes the esbuild bundle (no Docker); 7 resources and 4 outputs |
| 56 | `vp run nova:catalog` | local | passed | 2026-10-13 | Prints the catalog against today's date; no AWS call |
| 56 | `vp run dev:nova (NOVA_BACKEND=scripted)` | local | passed | 2026-10-13 | Overlapped two PUTs with curl and saw the 202 and the 200, then a third PUT answer reused: true, and checked billed in the log. Also confirmed that the server does not start with the ID of a retired model |
| 56 | `vp run nova:models` | AWS | not run | - | Asks the account with ListFoundationModels and ListInferenceProfiles; needs credentials |
| 56 | `vp run nova:hello` | AWS | not run | - | Hands one image to a real model; billed |
| 56 | `vp run nova:infra:deploy` | AWS | not run | - | Deploys the stack |
| 56 | `vp run nova:smoke` | AWS | not run | - | Describes one image through the deployed function URL; billed |
| 56 | `vp run nova:empty / nova:infra:destroy` | AWS | not run | - | Empties the bucket and destroys the stack |
| 57 | `vp test run examples/57-polly` | local | passed | 2026-10-13 | 72 tests: SSML escaping and injected tags, chunking a long note, cache keys, two and ten simultaneous requests, a failed synthesis, a holder that stops with its claim, two simultaneous takeovers of an old claim, the route and its input checks, no note text in the logs, playback order, the shape of the requests to S3 and Polly, and stack assertions (least privilege, the bucket is not public, lifecycle rules, the timeout against the claim's lifetime, the resource types in use) |
| 57 | `tsc --noEmit -p examples/57-polly` | local | passed | 2026-10-13 | Type check |
| 57 | `vp run polly:infra:synth` | local | passed | 2026-10-13 | The AihPolly template is produced without asking AWS anything, bundling included |
| 57 | `SPEECH_BACKEND=fake node src/dev.ts (examples/57-polly) と curl` | local | passed | 2026-10-13 | POST /speech answered with the URLs of two parts; the second request for the same note had billedCharacters 0 and source cache; a URL returned a WAV (RIFF) file; a voice outside the list was refused with 400 |
| 57 | `vp check --fix (examples/57-polly and the chapter's pages)` | local | passed | 2026-10-13 | Run on this chapter's own files only: no finding, awscdk-lint included |
| 57 | `vp run polly:infra:deploy` | AWS | not run | - | Not deployed |
| 57 | `vp run polly:listen` | AWS | not run | - | Not run. Polly was never called. Billed: about 70 characters a run |
| 57 | `vp run polly:empty --yes` | AWS | not run | - | Not run |
| 57 | `vp run polly:infra:destroy` | AWS | not run | - | Not run |
| 58 | `vp test run examples/58-ledger` | local | passed | 2026-10-13 | 83 passed, 1 skipped (the one for DynamoDB Local). The pinned hash, reading rows back, a race for the next number and a lost response, the journal rules on the in-memory model, taking and refusing a digest, detection of changed, removed, swapped and cut-off entries, attacks on the digest, the Object Lock model, the shape of requests to DynamoDB and S3, the function, the purge plan, and stack assertions |
| 58 | `tsc --noEmit -p examples/58-ledger` | local | passed | 2026-10-13 | Type check, no errors |
| 58 | `vp run ledger:demo` | local | passed | 2026-10-13 | Appends, a digest, a rewrite of history and an audit, in memory. The output in the page is from this run |
| 58 | `vp run ledger:db:reset:local && vp run ledger:test:local (DynamoDB Local 3.3.1)` | local | passed | 2026-10-13 | Ran the 5 journal rules through both the PartiQL INSERT and the conditional PutItem, plus one run from append to digest to audit, against DynamoDB Local 3.3.1 (11 tests), started directly from the jar AWS distributes with Java 21 (port 8058, -inMemory -sharedDb -disableTelemetry) and not through Docker; the tasks were given `DYNAMODB_ENDPOINT=http://localhost:8058` in the environment. The duplicate INSERT was answered with the name `DuplicateItem`. The digest store was the in-memory model |
| 58 | `vp run ledger:infra:synth` | local | passed | 2026-10-13 | Synthesized the template: 12 resources, with the function bundle including the AWS SDK. No AWS lookups |
| 58 | `vp run ledger:infra:deploy` | AWS | not run | - | Not deployed |
| 58 | `vp run ledger:append / ledger:digest / ledger:verify` | AWS | not run | - | Not run |
| 58 | `vp run ledger:infra:destroy / ledger:purge` | AWS | not run | - | Not run |
| 59 | `vp test run examples/59-rds` | local | passed | 2026-10-13 | 48 tests. Parsing and comparing LSNs, the real positions PGlite reports, read-your-writes and reads that never go back on the model of a primary and a replica, the write lost when a lagging replica is promoted, the API's headers and CORS, the operations function (creating roles, chapter 13's migrations, what notes_api may do, idempotency, input checks), configuration and environment, and 15 stack assertions over three synthesized variants |
| 59 | `tsc --noEmit -p examples/59-rds` | local | passed | 2026-10-13 | Type check of src, infra, test, and scripts |
| 59 | `vp run rds:infra:synth` | local | passed | 2026-10-13 | Writes the template (32 resources, 8 outputs) and two bundles to cdk.out. Asks AWS nothing. Both bundles were loaded under Node.js 24.21.0: the API function answered GET /health with 200, and the operations function refused an unknown command before opening a connection |
| 59 | `vp run dev:rds + curl` | local | passed | 2026-10-13 | Started with REPLICA_LAG_MS=1500 and checked a create, a read without the header (404 from the replica), a read with x-notes-seen (200 from the primary), a read without the header two seconds later (200 from the replica), and /health |
| 59 | `vp run rds:infra:deploy` | AWS | not run | - | Creates the RDS instance, parameter group, subnet group, security groups, two functions, the HTTP API, and the alarm. Billed by the hour |
| 59 | `vp run rds:db:bootstrap` | AWS | not run | - | Reads the master user's secret and invokes the operations function to create the two database roles |
| 59 | `vp run rds:db:migrate` | AWS | not run | - | Hands chapter 13's migrations to the operations function, which applies them |
| 59 | `vp run rds:db:status` | AWS | not run | - | Prints the connected role, the PostgreSQL version, and whether the session uses TLS |
| 59 | `vp run rds:smoke` | AWS | not run | - | Creates, reads back, and deletes a note through the API |
| 59 | `vp run rds:infra:drift` | AWS | not run | - | Compares cdkd's state with the live resources |
| 59 | `vp run rds:infra:destroy` | AWS | not run | - | Destroys the stack, the instance and its automated backups included |
| 60 | `vp test run examples/60-aurora` | local | passed | 2026-10-13 | On PGlite: the session dropped before and after each of the append's five statements, applied once in every case; a retry without a key applying twice; keys kept apart per owner; purging. SQLSTATE classification. The Data API adapter (parameter and row conversion, sorting of exceptions, a lost answer to commit against a stand-in service built on PGlite). The break-even between Standard and I/O-Optimized. Stack assertions. 54 tests in 5 files |
| 60 | `tsc --noEmit -p examples/60-aurora` | local | passed | 2026-10-13 | Type check of src, infra, test, and scripts. The node-postgres adapter (src/pg.ts) and scripts/cloud.ts were type-checked only, never run |
| 60 | `vp run aurora:infra:synth` | local | passed | 2026-10-13 | Wrote the default configuration's template to cdk.out. Asks AWS nothing |
| 60 | `vp run aurora:infra:deploy / aurora:db:schema / aurora:smoke / aurora:infra:drift / aurora:infra:destroy` | AWS | not run | - | No cluster was created. The Data API, auto-pause, and a failover were never seen on the real service |
| 61 | `vp test run examples/61-sqs` | local | passed | 2026-10-13 | 8 files, 75 tests. The rules of the queue model (required IDs, five minutes of deduplication, order within a group and nothing returned from a group that is still out, receipt handles, extending the visibility timeout and the 12-hour limit, the move to the dead-letter queue and the messages of the same batch dragged along, redrive), the invariant of the worker and the ledger (a resend after five minutes, the race with a worker past its visibility timeout, a failure inside a batch, setting aside an unreadable message, a redrive after a long outage), the building of batches, large messages, how requests are counted, the shape of requests to DynamoDB and SQS, and infrastructure assertions. The queue is the in-memory model, not SQS. The code was also broken on purpose in four places, and 3, 4, 2, and 3 tests failed |
| 61 | `vp run sqs:demo` | local | passed | 2026-10-13 | Ran an immediate resend, a resend after five minutes, a worker past its visibility timeout, and an unreadable message through the model queue and the deployed worker code, and read from the output that the ledger with markers ends with three lines, the one without with five, and the unreadable message is in the dead-letter queue either way |
| 61 | `vp run sqs:infra:synth / tsc --noEmit -p examples/61-sqs` | local | passed | 2026-10-13 | Nine resource types (SQS::Queue, SQS::QueuePolicy, Lambda::Function, Lambda::EventSourceMapping, DynamoDB::Table, CloudWatch::Alarm, Logs::LogGroup, IAM::Role, IAM::Policy), each with a dedicated provider in cdkd 0.296.28, and no Custom:: resource. scripts/ is type-checked only |
| 61 | `vp run sqs:infra:diff / sqs:infra:deploy / sqs:send / sqs:status / sqs:infra:drift / sqs:infra:destroy` | AWS | not run | - | Nothing was run against AWS |
| 62 | `vp test run examples/62-ci-runners` | local | passed | 2026-10-13 | 9 files, 95 tests: the signature (including the test values in the GitHub documentation), the decision, the receiver (a forged signature, a fork, duplicate and simultaneous deliveries, a failed launch and its redelivery, a receiver that stopped midway), the requests sent to the GitHub API (with fetch replaced), the RunTask input, the sweeper, the configuration, the workflow, cost, and the stack assertions |
| 62 | `tsc --noEmit -p examples/62-ci-runners` | local | passed | 2026-10-13 | Type check |
| 62 | `vp run runners:infra:synth` | local | passed | 2026-10-13 | Synthesized without context and with -c repositories=example-org/notes -c appClientId=Iv23example. -c repositories='example-org/*' is refused |
| 62 | `vp run runners:decide` | local | passed | 2026-10-13 | Seven hand-written deliveries through the real receiver, with stand-ins for GitHub, ECS and DynamoDB |
| 62 | `vp run runners:infra:deploy` | AWS | not run | - | Nothing was run against AWS |
| 62 | `GitHub App の作成、webhook の配送、ジョブの実行` | AWS | not run | - | No GitHub App was created, GitHub's API was never called with credentials, no runner was registered and no job ran |
| 63 | `vp test run examples/63-agent-sandbox` | local | passed | 2026-10-13 | 12 files, 103 tests: the launcher's decisions, the allowlist evaluator, the limits and the reaper, the GitHub App JWT and the token check, the agent's command, settings and environment, the task's steps (against a fake command runner), the policy evaluator, command assembly, cost, and the stack assertions |
| 63 | `tsc --noEmit -p examples/63-agent-sandbox` | local | passed | 2026-10-13 | Type check |
| 63 | `vp run sandbox:infra:synth` | local | passed | 2026-10-13 | Synthesized with no tag, with -c imageTag=a1 -c repositories=acme/notes, and with -c modelEndpoint=true and -c exec=true added. -c exec=yes and -c model=jp.amazon.nova-2-lite-v1:0 are refused |
| 63 | `vp run sandbox:plan / sandbox:policy / sandbox:bundle` | local | passed | 2026-10-13 | The decision and the RunTask input, the agent's command and settings, and the Network Firewall rule source; each role's statements and the probes against the agent's role; dist/entry.mjs and dist/settings.json written |
| 63 | `node scripts/ops.ts <image-build\|image-push\|launch\|logs\|exec> --dry-run` | local | passed | 2026-10-13 | Printed the commands only. Neither docker nor aws was called |
| 63 | `vp run sandbox:image:build / sandbox:image:push` | AWS | not run | - | No Docker daemon: the image was never built |
| 63 | `vp run sandbox:infra:deploy / sandbox:launch / sandbox:infra:destroy` | AWS | not run | - | Nothing was created in AWS. No agent was started and no model was called |
| 64 | `vp test run examples/64-isolates` | local | passed | 2026-10-13 | 5 files, 45 tests. test/workerd.test.ts starts the real workerd 1.20261012.1 (darwin-arm64) from npm inside the Nix devShell: chapter 04's app answers as its contract says, two workers running the same code in one process share no state, two requests in flight swap a request ID kept in module scope and do not with AsyncLocalStorage, and bindings arrive from environment variables. Also: validating and rendering the configuration, the adapter, pricing, and stack assertions |
| 64 | `tsc --noEmit -p examples/64-isolates` | local | passed | 2026-10-13 | Type check |
| 64 | `vp run isolates:bundle` | local | passed | 2026-10-13 | Wrote notes.mjs, scoped.mjs, spin.mjs, and the image's config.capnp to dist/ |
| 64 | `vp run dev:isolates` | local | passed | 2026-10-13 | Started chapter 04's app in the local workerd and called /health, POST /notes, and GET /notes with curl |
| 64 | `vp run isolates:observe` | local | passed | 2026-10-13 | Ran the four observations on workerd for macOS (arm64). A 2000 ms CPU loop was not cut off, and /health on another worker in the same process waited 1807 ms. On SIGTERM it answered the request in flight with 201 and then exited with code 0, without answering a new request that arrived meanwhile. With nothing in flight it exited in 2 ms |
| 64 | `vp run isolates:fetch` | local | passed | 2026-10-13 | Downloaded the Linux arm64 archive (39,889,339 bytes) from the npm registry, matched it against the pinned SHA-512, and unpacked the binary. The binary was not run |
| 64 | `vp run isolates:infra:synth` | local | passed | 2026-10-13 | Synthesized the default (repository only), `-c imageTag=v1`, and `-c imageTag=v1 -c taskSubnets=private`. Nothing is asked of AWS |
| 64 | `vp run isolates:image:build v1 --dry-run` | local | passed | 2026-10-13 | Prints the docker commands and runs none. The same for `isolates:image:push v1 --dry-run` |
| 64 | `vp run isolates:image:build <tag>` | local | not run | - | Not run. The Nix shell has no Docker daemon. The image was never built |
| 64 | `vp run isolates:image:push <tag>` | AWS | not run | - | Not run |
| 64 | `vp run isolates:infra:diff -c imageTag=<tag>` | AWS | not run | - | Not run |
| 64 | `vp run isolates:infra:deploy -c imageTag=<tag>` | AWS | not run | - | Not run |
| 64 | `vp run isolates:smoke` | AWS | not run | - | Not run |
| 64 | `vp run isolates:infra:drift` | AWS | not run | - | Not run |
| 64 | `vp run isolates:infra:destroy` | AWS | not run | - | Not run |
| 66 | `vp test run examples/66-distributed-sql` | local | passed | 2026-10-13 | Flag file generation and validation, failover between nodes, the quorum model (every loss of one node, the loss of two, the write that asynchronous replication loses), chapter 13's retry loop given YugabyteDB's errors on PGlite, the files a node gets, certificate arguments, pricing, and the stack assertions. 7 files, 73 tests |
| 66 | `tsc --noEmit -p examples/66-distributed-sql` | local | passed | 2026-10-13 | Type check |
| 66 | `vp run distsql:infra:synth` | local | passed | 2026-10-13 | Synth with the default settings (no nodes, 10 resources) and with `-c nodes=3` (19 resources). Asks AWS nothing |
| 66 | `vp run distsql:render` | local | passed | 2026-10-13 | The files in deploy/ match what the generators produce |
| 66 | `vp run distsql:fetch` | local | passed | 2026-10-13 | On macOS 26.6 (arm64): fetched yugabyte-2025.2.7.0-b107-darwin-arm64.tar.gz (130,180,590 bytes) from software.yugabyte.com. Its SHA-256 matched the .sha published next to it (4a6a23f6…edde49). Unpacked into .yugabyte/ |
| 66 | `vp run distsql:local:start, then vp run distsql:local:verify (no TLS, 2 runs)` | local | passed | 2026-10-13 | Three pairs of yb-master and yb-tserver on 127.0.0.1 (PostgreSQL 15.12-YB-2025.2.7.0-b0). Chapter 13's four migrations and its repository ran unchanged. Twelve creates at once through three nodes against a quota of 3: in both runs 3 created, 9 quota_exceeded, note_count and the rows agreeing at 3. 16 and 4 retries after 40001. After SIGKILL of node b, a and c returned all 40 acknowledged notes, and the next 20 creates took 1.1 s and 0.9 s. With b and c down, the one node left acknowledged no write (no answer for 20 s; a timeout on connect); with them back, all 40 acknowledged notes were there. The unacknowledged write was there after the first run and not after the second. In the second run a ysql_dump fed into another database held all 40 |
| 66 | `vp run distsql:local:certs, vp run distsql:local:start --tls, then vp run distsql:local:verify (TLS, 5 runs, 1 failed)` | local | passed | 2026-10-13 | With a CA and a certificate for 127.0.0.1 made by openssl (Homebrew's 3.6.1; the Nix shell has none), and TLS and password authentication on, the same verification ran five times. A client without TLS was refused. 12, 12, 12, 26, and 29 retries after 40001. The 20 creates after losing b took 1.1 s to 4.3 s. The one create with two nodes lost was never acknowledged, and was there afterwards in 2 runs of 5. The third run ended in failure: the CREATE DATABASE right after the two nodes returned failed with "current transaction is expired or aborted". The two runs after a retry was added to the backup block passed. A ysql_dump fed into another database held everything in 4 runs. yb-admin answered list_all_masters and modify_placement_info with --certs_dir_name, and without it gave up after 60 s without finding the leader. After the verification, distsql:local:destroy stopped every process |
| 66 | `vp run distsql:fetch --nodes` | local | not run | - | The archive for the nodes (el8-aarch64, 479,462,171 bytes) was not downloaded. Its SHA-256 is copied from the published .sha |
| 66 | `vp run distsql:infra:deploy -c nodes=3` | AWS | not run | - | Nothing was created in AWS |
| 66 | `vp run distsql:artifact / distsql:install / distsql:certs / distsql:configure / distsql:start / distsql:status / distsql:health / distsql:logs / distsql:stop / distsql:session` | AWS | not run | - | No task that touches the nodes was run |
| 66 | `vp run distsql:infra:destroy` | AWS | not run | - | Not run |
| 67 | `vp test run examples/67-firecracker` | local | passed | 2026-10-13 | 5 files, 67 tests. The check against the specification, validation of the configuration, the order of requests, the client over a Unix domain socket, no start after a refused configuration, the lost answer to InstanceStart, the precondition of a snapshot, how boot time is measured, the assertions on the stack |
| 67 | `tsc --noEmit -p examples/67-firecracker` | local | passed | 2026-10-13 | Type check |
| 67 | `vp run firecracker:plan` | local | passed | 2026-10-13 | Printed the five requests of a boot as curl commands; the output quoted in the chapter is from this run |
| 67 | `vp run firecracker:spec` | local | passed | 2026-10-13 | Downloaded the v1.17.0 specification from GitHub, checked its SHA-256, and found the subset equal to the committed JSON |
| 67 | `vp run firecracker:kit:build` | local | passed | 2026-10-13 | Wrote guest-server.mjs, plan.mjs, boot.mjs and deploy/ to dist/kit |
| 67 | `PORT=18067 ALLOWED_ORIGIN=http://localhost:5173 node dist/kit/guest-server.mjs; curl /health` | local | passed | 2026-10-13 | Started the bundle on macOS; /health answered 200 with {"status":"ok","stage":"local"}. Not inside a microVM |
| 67 | `vp run firecracker:boot (macOS)` | local | passed | 2026-10-13 | Sent nothing, said Linux and KVM are needed, and exited with code 69 |
| 67 | `vp run firecracker:infra:synth` | local | passed | 2026-10-13 | 7 resources and 1 output (without the flag). No lookup against AWS |
| 67 | `bash -n deploy/prepare.sh deploy/tap.sh` | local | passed | 2026-10-13 | Syntax check only. The scripts were not executed |
| 67 | `node book/theme/figure-cli.ts (67章の図のある 4 ページ)` | local | passed | 2026-10-13 | 6 figures, 0 problems |
| 67 | `bash deploy/prepare.sh; sudo bash deploy/tap.sh up; sudo work/firecracker --api-sock ...; sudo work/node/bin/node boot.mjs` | local | not run | - | macOS has no KVM; Firecracker was never started |
| 67 | `vp run firecracker:infra:deploy -c run=true / firecracker:kit:publish / firecracker:kit:empty / firecracker:infra:destroy` | AWS | not run | - | Nothing was run against AWS |
| 68 | `vp test run examples/68-nitro` | local | passed | 2026-10-13 | Reading instance type names, finding a device from a volume ID, PCR3 and PCR4 (matching the user guide's example values), the key policy and its evaluator, the model of parent, enclave and KMS with its invariant, pricing inputs, and stack assertions |
| 68 | `tsc --noEmit -p examples/68-nitro` | local | passed | 2026-10-13 | Type check |
| 68 | `vp run nitro:infra:synth` | local | passed | 2026-10-13 | Synthesized the default layout and `-c measurement=<96 hex digits>`, `-c instanceType=m6g.large` |
| 68 | `vp run nitro:demo` | local | passed | 2026-10-13 | On the model: sealing and opening a note, the parent's direct Decrypt refused, a replayed document, and debug mode refused |
| 68 | `vp run nitro:names` | local | passed | 2026-10-13 | Read the six default names |
| 68 | `vp run nitro:prices` | local | passed | 2026-10-13 | Printed the arm64 and x86 unit prices and the stack's idle cost |
| 68 | `vp run nitro:infra:deploy` | AWS | not run | - | Not deployed |
| 68 | `nitro-cli build-enclave / run-enclave` | AWS | not run | - | No enclave image was built and no enclave was started. This machine is macOS without Docker |
| 68 | `vp run nitro:infra:destroy` | AWS | not run | - | Nothing was deployed, so nothing was destroyed |

## Open items and how to resume

### bundles-on-lambda

The ESM Lambda bundles that include the AWS SDK (chapters 05, 06, 07, 08, 15, 16, 17, 19, 21, and 22) carry a banner that defines `require`. `vp run bundles:check` confirms they load in plain Node.js; that they initialize on the Lambda runtime (Node.js 24) has not been checked. Before the banner they failed locally with `Dynamic require of "node:https" is not supported`.

To resume: Run `vp run notes:infra:deploy`, then `vp run notes:smoke` (or invoke the function once), and check CloudWatch Logs for an initialization error such as `Runtime.ImportModuleError`. If it passes, the other chapters with the same shape should pass for the same reason, but invoke each one once to be sure.

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

Which error the KeyValueStore API returns for a stale If-Match is unconfirmed. The API reference lists ConflictException (409) without saying when it is returned. Chapter 10's adapter treats only ConflictException as a conflict. Of the other errors, it retries a 5xx or one with no status code up to five rounds and stops at once on the rest.

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

### bounds-applied-by-cdkd

The bounds on public entry points (`DefaultRouteSettings` on HTTP API stages, `OnDemandThroughput` on DynamoDB tables, opt-in `ReservedConcurrentExecutions`) are pinned in templates by tests only. Whether cdkd 0.296.28 applies them has not been checked. Reading the pinned code, it passes all three to the AWS APIs.

To resume: Deploy chapter 04 and read `DefaultRouteSettings` with `aws apigatewayv2 get-stage`; deploy chapter 05 and read `OnDemandThroughput` with `aws dynamodb describe-table`. Then send more than 10 requests a second and confirm a 429 comes back.

### throttle-scope-and-billing

Whether a stage's default throttle is one budget for the whole API or one per route has not been checked. If it is per route, the prose's "10 a second" multiplies by the number of routes (7 in chapter 06, 11 in chapters 07 and 08). Whether throttled 429s and requests refused by an authorizer are billed has not been checked either.

To resume: Send 10 requests a second to each of two routes of a deployed API at once and see whether the total is held to 10. Check the bill a day later for charges on the 429s.

### worst-case-amounts-computed

The worst-case amounts in each chapter's "when it gets hammered" passage are computed from unit prices in the repository and the chapter's assumptions, not taken from a bill. Response data transfer is counted separately, and whether the internet transfer price applies to API Gateway responses has not been checked.

To resume: After a load test, compare Cost Explorer with the chapter's table item by item.

### limits-under-real-concurrency

The per-owner note limit (chapter 05) and the per-day permit limit (chapter 07) count with conditional writes. In memory and on DynamoDB Local, concurrent creates never pass the limit; on real DynamoDB this has not been checked. How the SDK retries at the table's throughput cap, and when that becomes a 500, is also unchecked.

To resume: Against a deployed chapter 05 API, send concurrent creates from just under the limit and confirm the 101st is a 409.

### reserved-concurrency-on-new-accounts

`-c reservedConcurrency=N` in chapters 09, 17 and 21 is only checked as far as the template. A new account's concurrency limit can be low enough that a reservation is refused at deploy, which is why it is not the default. What a function URL and CloudFront answer at the ceiling is unchecked.

To resume: Read the limit with `aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384`, then deploy with `-c reservedConcurrency=2`.

### edge-and-cache-bounds

Dropping query strings from the cache key in chapter 09 (`QueryStringBehavior: none`) and answering anything but POST on `/digest` with a 405 from the CloudFront Function in chapter 10 are checked in templates and in Node.js tests only. Whether CloudFront Functions accepts a 405 with an `allow` header, and that Lambda@Edge does not run for it, is unchecked.

To resume: After deploying, send `curl -i 'https://<domain>/?x=1'` twice and confirm the second is served from cache. For chapter 10, confirm `curl -i https://<domain>/digest` answers 405.

### ivs-viewer-flood

The worst case in chapter 18's "when the URL gets around" comes from the default concurrent-views quota (15,000) and the per-viewer-hour price. What IVS does past the quota, and how quickly output billing stops after `StopStream`, is unchecked.

To resume: Run `vp run stream:stop` while live and watch `vp run stream:status` until concurrent views reach 0.

### alarm-topic-tls

Chapter 19's alarm topic now requires TLS (`enforceSSL`) and carries an explicit statement that lets CloudWatch publish. That a CloudWatch alarm can publish under this policy is unchecked.

To resume: After deploying, force the alarm with `aws cloudwatch set-alarm-state` and confirm the subscriber is notified.

### list-response-size

A list of notes returns at most 20 summaries and never a body. Tests confirm that it stays at or under 20 KiB with the largest notes the contract accepts; a deployed API's response has not been checked. The SPAs of chapters 06 and 07 were type-checked and passed their existing tests, but have not been driven in a browser since this change.

To resume: Create 20 largest notes on a deployed API and confirm `curl -s <url>/notes | wc -c` is at most 20,480. Open the SPA with `vp run dev:app` and confirm a note opens from the list.

### 17-live-inference

Chapter 17 has never called real Bedrock. That the model IDs (such as jp.amazon.nova-2-lite-v1:0) can be called from Tokyo, that real ConverseStream events fit the schema in src/converse-stream.ts, and that the fixtures match the real shapes are all unconfirmed.

To resume: Prepare examples/17-ai/.env, run vp run ai:hello and then vp run ai:test:live (billed). If the event shapes differ, fix the schema and the fixtures.

### 17-deployed-streaming

The chapter 17 stack has not been deployed. Unconfirmed: that this chapter's adapter (src/function-url.ts) delivers the response piece by piece on the Node.js 24 Lambda runtime through a function URL (RESPONSE_STREAM, AWS_IAM); that Lambda reads the keys passed to awslambda.HttpResponseStream.from (statusCode, headers, cookies) as written; whether a disconnect makes a write to the response stream fail; that an unsigned request answers 403; that ConverseStream passes with the IAM policy scoped to the inference profile; and that cdkd applies InvokeMode on AWS::Lambda::Url.

To resume: Run vp run ai:infra:deploy, vp run ai:smoke (it prints when each delta arrived), vp run ai:logs, vp run ai:infra:drift, and vp run ai:infra:destroy, in that order.

### 17-bedrock-billing-details

How many tokens are billed for a ConverseStream call that is aborted midway was not confirmed from a primary source. Neither were a free allowance for Bedrock or the quota values in the Tokyo Region.

To resume: Check the Bedrock pricing page and Service Quotas. For aborted calls, stop ai:test:live midway and compare the bill with the CloudWatch metrics.

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

### events-pipe-to-bus

Chapter 25: not confirmed on AWS that the pipe reads the DynamoDB stream and puts each element of the array the enrichment function returns into an event's detail as is, that `$.type` in DetailType resolves against the enrichment's output, and that the function receives an array when the batch size is 1. The same goes for creating the pipe with a role whose trust policy has no condition.

To resume: After vp run events:infra:deploy, run vp run events:smoke. If no timeline entry appears, read the Shape and Timeline log groups and the dead letters in vp run events:status. If the shape log says `shaped` and nothing reaches the bus, suspect the pipe's target parameters.

### events-archive-cloud-control

Chapter 25: cdkd 0.296.28 has no dedicated provider for AWS::Events::Archive and creates it through Cloud Control API. Creating, updating, and deleting it this way was not confirmed.

To resume: Run vp run events:infra:deploy and vp run events:infra:destroy. If either stops at the archive, take the archive out of the stack, create it by hand with `aws events create-archive`, and delete it by hand too.

### events-replay-shape

Chapter 25: not confirmed on AWS that a replayed event carries `replay-name` in a function's input and in an SQS message body, whether it keeps its original id and time, that a replay reaches only the rules it names, and that a rule requiring `replay-name` to be absent (rejections) does not match a replayed event. The consumers do not rely on EventBridge's id.

To resume: Ten minutes after events:smoke, run vp run events:replay -- --minutes 30 --rule timeline --yes, then read the `replay` field in the Timeline log and check that the timeline entries did not change.

### events-delivery-permissions

Chapter 25: these were not confirmed on AWS. Delivery into queues encrypted with SQS-managed keys from an EventBridge rule, a pipe's dead-letter configuration, Lambda's on-failure destination, and SNS. Publishing from EventBridge to SNS under a topic policy with no condition. The input transformer's output becoming the SNS message and landing in the queue as is with raw message delivery.

To resume: See whether the last step of vp run events:smoke passes (it puts a file that is not an image and waits for the notice in the inbox). If not, read which rule's dead letter and which ERROR_CODE vp run events:status shows.

### events-streams-read-billing

Chapter 25: whether the GetRecords calls a pipe makes on the stream are billed as DynamoDB Streams read request units was not confirmed. The pricing page exempts Lambda triggers and global tables only. The page's USD 1.83 for an idle month assumes they are billed, one shard, and four polls a second.

To resume: Deploy, leave it for a few days, and read the quantity of the DynamoDB usage type `APN1-Streams-Requests` in Cost Explorer.

### events-pattern-matcher-gap

Chapter 25: the local matcher (src/pattern.ts) is not EventBridge's. It compares numbers after JSON.parse (EventBridge compares how they are written), treats a non-leaf value as absent for exists, and does not handle arrays in events. That the stack's patterns give the same answers in EventBridge was not confirmed.

To resume: With credentials, run `aws events test-event-pattern --event-pattern <pattern> --event <event>` on the matching and non-matching cases of test/pattern.test.ts.

### events-custom-event-bus-v2

Chapter 25: EventBridge's new Custom Event Bus (AWS::EventsV2) is not used. The documentation recommends it for new applications, but cdkd 0.296.28 has no provider for it and the Cloud Control API list read on 2026-10-13 had no AWS::EventsV2 type. Whether a pipe can target it was not confirmed either.

To resume: When the cdkd version is raised, look at register-providers.ts and the Cloud Control API list again. If it can be deployed, replace the rules and the archive with subscribers and the bus's retention, following the mapping in the migration guide.

### analytics-athena-sql-not-executed

The rendered SQL was never executed in Athena. The functions (substr, count(DISTINCT), approx_percentile), partition pruning from BETWEEN on the string column dt, and the shape of the results are taken from documentation. The local tests evaluate the same query structure with the chapter's own function, not with a SQL engine.

To resume: After vp run analytics:infra:deploy and vp run analytics:smoke, wait for the buffer interval (60 s) and run vp run analytics:query --name actions --from <today> --to <today>. Check that it reaches SUCCEEDED, that the rows match what the smoke test did, and that the bytes scanned are at most the day's objects.

### analytics-hive-json-serde-nulls

Not checked: that Athena's Hive JSON SerDe reads these records (JSON null, integers, ISO 8601 strings) into the table's columns. The OpenX JSON SerDe was avoided because its documentation warns of non-deterministic results.

To resume: After deploying and running the smoke test, run SELECT * FROM "aih_analytics"."requests" WHERE dt = '<today>' LIMIT 10 in the Athena console. Check the rows where action and note_id are NULL, and the numeric columns. If they cannot be read, revisit STORAGE.json.serializationLibrary in infra/lib/analytics-stack.ts.

### analytics-parquet-conversion

Firehose's format conversion (-c format=parquet) was not run. Unconfirmed: the minimum buffer size (64 MB is given), that the OpenX deserializer handles JSON null and the bigint column, the real size of the Parquet files Firehose writes, and the bytes Athena reports as scanned. The Parquet numbers in the chapter were measured on a file written by a library on the laptop.

To resume: Deploy with vp run analytics:infra:deploy -c format=parquet, run the smoke test and wait five minutes. Check that .parquet objects appear under requests_parquet/ and that errors/format-conversion-failed/ is empty. Run the same query against a json and a parquet stack and compare the bytes scanned.

### analytics-cdkd-cloud-control

Not checked: that cdkd 0.296.28 creates, updates and deletes AWS::Athena::WorkGroup and AWS::Logs::LogStream through Cloud Control API, and that its Firehose provider succeeds in creating a stream with DataFormatConversionConfiguration and CloudWatchLoggingOptions passed through.

To resume: Read the route and result per resource in the output of vp run analytics:infra:deploy, then run vp run analytics:infra:drift and vp run analytics:infra:destroy.

### analytics-s3-requests-per-query

Not checked: how many S3 requests one Athena query makes. The pricing scenarios assume one GET per object, and count neither LIST requests nor the separate reads of a Parquet footer and its columns.

To resume: A day or more after running a few queries, compare the S3 Requests-Tier1 and Requests-Tier2 usage in Cost Explorer with a day on which Athena was not used.

### analytics-put-latency

Not measured: how much waiting for PutRecord slows a response. The 500 ms bound is not based on a measurement.

To resume: After deploying, run vp run analytics:smoke a few times and compare p95_ms from vp run analytics:query --name routes with the same routes on chapter 19's stack.

### 27-aws

The chapter 27 stack has never been deployed. Unconfirmed: that cdkd 0.296.28 creates AWS::S3Vectors::Index through Cloud Control, that Titan Text Embeddings V2 can be called from Tokyo and returns 1,024 dimensions, that real S3 Vectors responses fit the adapter's schema, that a query with the owner filter is accepted, what DeleteVectors does with a key that does not exist, that real DynamoDB Streams records fit the handler's schema, that a failed batch reaches the dead-letter queue, and that the answer arrives piece by piece through the function URL.

To resume: Run `vp run search:infra:deploy`, `vp run search:seed`, then `vp run search:smoke`. Read the indexer's log with `vp run search:logs -- --indexer` and the difference between table and index with `vp run search:reindex`. To see what deleting a missing key does, delete one note after `search:seed` and run `search:reindex -- --apply` twice in a row. Finish with `vp run search:infra:destroy`.

### 27-distance

The distance past which a hit counts as unrelated (`MAX_DISTANCE`, 0.7) and the passage length (800 characters) were not tuned against real Titan embeddings. How many tokens a Japanese character takes was not measured either.

To resume: After deploying, search with `search:smoke` and with your own notes, read `tokens` in the `embedded` log lines and the distances S3 Vectors returns, and set `MAX_DISTANCE` in `examples/27-search/src/search.ts` again.

### 27-opensearch-nextgen

For OpenSearch Serverless NextGen collections, availability in Tokyo, whether the Tokyo OCU price equals Classic's, and the time to come back from zero could not be confirmed from the primary sources opened. The Bedrock managed knowledge base prices (USD 5 per GB a month, USD 1 per 1,000 Retrieve calls) are the pricing page's figures and were not found as Tokyo rows in the Price List.

To resume: Choose Tokyo in the OpenSearch Serverless console and see whether a NextGen collection group can be created. Confirm prices from the bill or from the usage types in Cost Explorer.

### 28-two-regions

The two stacks of chapter 28 have never been deployed. Unconfirmed: that cdkd 0.296.28 can create the AWS::DynamoDB::GlobalTable (per-replica PITR included), that the ap-northeast-3 stack deploys from the same app (and whether a bootstrap done for Tokyo is enough), the replication configuration into a bucket in another Region referred to by a fixed name, the second deploy with `-c back=on`, real ReplicationLatency values, and which of two simultaneous edits from two Regions survives.

To resume: Deploy with `vp run mr:standby:infra:deploy`, then `vp run mr:infra:deploy`, and check with `vp run mr:status` that both replicas are ACTIVE. Record what `vp run mr:conflict --apply` prints (the status of the two PUTs and the title both Regions hold five seconds later). Look at ReplicationLatency in CloudWatch. Finish with `vp run mr:empty --apply`, `vp run mr:infra:destroy`, and `vp run mr:standby:infra:destroy`.

### 28-failover

No Region failure and no failover was ever exercised. Unconfirmed: how long a Route 53 health check really takes to turn unhealthy, the TTL of an alias record that points to an API Gateway custom domain name, how long clients take to notice the switch, that cdkd can create AWS::Route53::HealthCheck, AWS::ApiGatewayV2::DomainName and ApiMapping through the Cloud Control API, that two stacks can each validate an ACM certificate for the same domain through DNS, and any measured RTO or RPO.

To resume: Prepare a hosted zone and deploy both stacks with `-c domain=<name> -c zoneId=<id> -c zoneName=<zone>`. Record the TTL that `dig <name>` shows. Deploy Tokyo's stack with `-c drill=on` so its health check fails, time how long `x-aih-region` takes to become ap-northeast-3, and compare it with the numbers in `examples/28-multi-region/src/objectives.ts`. Pausing replication with the AWS FIS global table actions is a separate experiment to plan.

### 28-mrsc

This chapter's stacks do not create an MRSC global table: the list of properties handled by the pinned cdkd's GlobalTable provider has neither MultiRegionConsistency nor GlobalTableWitnesses, and a third Region is needed. MRSC behaviour was checked against the documentation and the model only. The name of the error the SDK throws in an isolated Region was not confirmed.

To resume: Create an empty table as MRSC (Tokyo, Osaka, witness in Seoul) with the AWS CDK CLI or the AWS CLI, send updates of the same version from two Regions at once, and record whether ConditionalCheckFailedException or ReplicatedWriteConflictException comes back.

### tune-no-lambda-timings

No time was measured on Lambda. The chapter has no measured value for initialization time, the share of cold starts, or duration at another memory setting. What was measured locally is bundle bytes and import time on a Mac.

To resume: After vp run tune:infra:deploy and vp run tune:smoke, wait a few minutes and run vp run tune:report. Redeploy with -c memorySize=512 and so on, repeat, and compare the tables.

### tune-json-report-shape

Not checked in AWS: that platform.report in the JSON log format reaches CloudWatch Logs in the documented shape and can be read as the message of aws logs filter-log-events.

To resume: Run vp run tune:report. If it prints No reports found, or fails on the shape, look at one raw line with aws logs tail and compare it with the schemas in src/report.ts.

### tune-module-first-on-lambda

The bundle built with mainFields module,main and minified has not run on Lambda. It was loaded in plain Node.js 24 and sent a GetItem to a stand-in for DynamoDB.

To resume: After vp run tune:infra:deploy, check that vp run tune:smoke answers 201, 200 and 204. On a 500, look for a failed initialization with vp run tune:report and in the logs.

### tune-deadline-on-lambda

Not checked on Lambda: that the handler's own deadline, one second before the function timeout, stops the SDK call and leaves a 500 answer and a log line. Nor what API Gateway answers when the function times out.

To resume: Rather than removing the table permission, deploy a copy of the function whose DYNAMODB_ENDPOINT points at an unreachable address, call it, and read the answer and the Status in its REPORT line.

### tune-concurrency-options

Deploys with -c reservedConcurrency and -c provisionedConcurrency were not run. cdkd 0.296.28 handles AWS::Lambda::Version and AWS::Lambda::Alias through Cloud Control API. Also unconfirmed: when a new account refuses a reservation, and how long allocating provisioned concurrency takes.

To resume: Check ConcurrentExecutions with aws lambda get-account-settings, then run vp run tune:infra:deploy -c reservedConcurrency=5 -c provisionedConcurrency=1. Afterwards redeploy without the options, or destroy, to stop the hourly charge.

### tune-init-duration-contents

Whether Init Duration in the REPORT line includes downloading the code and starting the environment could not be read from the documentation.

To resume: After a deploy, compare API Gateway's IntegrationLatency for the first call with Init Duration plus Duration in its REPORT line.

### 30-aws

The chapter 30 stack has never run on AWS. Unconfirmed: the cancellation reasons and the effect of retries when transactions really collide (DynamoDB Local reports no conflicts), how far the index actually lags, how often the stream function sees a record again, that the event source mapping's filter keeps the function's own writes away from it, that a batch out of retries reaches the dead-letter queue, TTL deletion of the markers, how a ConditionCheck is billed, the answer to an ExclusiveStartKey in another partition, the errors at the table's and the index's limits, and that cdkd can really create the index, the stream, the filtered event source mapping, and the managed policy.

To resume: Run `vp run modeling:infra:diff`, `vp run modeling:infra:deploy`, then `vp run modeling:smoke`, which prints how long the list and the count took to appear. The function's logs are in the log group named by the `ProjectorLogGroupName` output. Finish with `vp run modeling:infra:destroy`.

### 30-migration

The migration of the table from chapters 05 to 08 (adding the index, the backfill, switching reads, removing old keys) was only exercised on the in-memory model. Unconfirmed: how long and how much the backfill of a new index on an existing table takes, how `modeling:backfill` behaves while the application is live, and exactly how chapter 05's list query fails when it reads an attachment under the new key.

To resume: Add `gsi1` to the table of the chapter 05 or 07 stack and deploy, then run `vp run modeling:backfill --table <table name>` (plan only), again with `--apply`, then `vp run modeling:verify --table <table name>`.

### 30-docker

Starting DynamoDB Local through Docker (chapter 05's `db:local:start`) was not run. This chapter's tasks were run against DynamoDB Local started directly from the jar, on port 8030.

To resume: Start a Docker daemon, copy `examples/30-data-modeling/.env.example` to `.env`, then run `vp run db:local:start`, `vp run modeling:db:migrate:local`, and `vp run modeling:test:local`.

### 31-shift-on-aws

Chapter 31's stack and its two scripts have never been run on AWS. Unconfirmed: that cdkd 0.296.28 can create `AWS::Lambda::Alias`, `AWS::Lambda::Version`, and the four AppConfig types through the Cloud Control API; that updating the stack leaves the alias alone; the name of the error when `RevisionId` does not match in `UpdateAlias`; that an empty map removes the weights; how a weighted alias really splits requests; the version number `x-app-version` reports; how long a one-minute alarm takes to reach `ALARM` during a shift; and how cdkd's drift check reports the moved alias.

To resume: After `vp run rollout:infra:deploy`, run `vp run rollout:probe`, `vp run flags:deploy --apply`, `vp run rollout:infra:deploy -c fault=50`, then `vp run rollout:start --apply` (with `vp run rollout:probe --count 300` in another terminal) and watch it roll back. Deploy again with `-c fault=0` and watch `rollout:start --apply` complete. Finish with `vp run rollout:infra:drift`, `vp run flags:clear --apply`, and `vp run rollout:infra:destroy`.

### 31-appconfig-behaviour

Behaviour of AppConfig and its extension that the documentation did not settle: what the extension answers for a configuration that was never deployed; what it answers, and after how long, when AppConfig cannot be reached right after a cold start; whether automatic rollback works with `cloudwatch:DescribeAlarms` limited to the alarms' ARNs (the documented example uses `*`); whether a configuration profile with stored versions can be deleted; and what exactly counts as one "Configuration Received".

To resume: Right after deploying and before `flags:deploy`, run `vp run rollout:probe` and look for `x-flags-origin: defaults` and the `flags` line in the log. After `flags:deploy --apply`, shift to a `-c fault=50` build to fire the alarms and see whether `flags:status` shows `ROLLED_BACK`. Try `rollout:infra:destroy` without `flags:clear` and record whether it fails. Compare the billed quantity of `APN1-AppConfig-Deployments` with the number of cold starts.

### 31-ecs-and-codedeploy

The ECS canary and the CodeDeploy setup were only synthesized and read in tests; neither is in the deployed app. Unconfirmed: whether the ECS circuit breaker acts under the `BLUE_GREEN`, `LINEAR`, and `CANARY` strategies, whether chapter 12's service can be updated to another strategy in place, and whether cdkd sends `AdvancedConfiguration` and `DeploymentConfiguration.Strategy`. That CodeDeploy charges nothing for Lambda and ECS deployments is supported only by the absence of a SKU in the price list.

To resume: Deploy chapter 12's stack to a practice account, move the settings of `examples/31-progressive-delivery/infra/lib/ecs-canary-sketch.ts` into its service, and try an update. Try CodeDeploy through chapter 20's `ship:cfn:*` path by adding `codedeploy-sketch.ts` to that stack.

### limits-stage-429-shape

Not confirmed: the body of the 429 an HTTP API returns when it throttles, and whether it carries a Retry-After header. The local stand-in answers {"message":"Too Many Requests"} with no such header.

To resume: After vp run limits:infra:deploy, send about 30 curl -i requests within a second to the ApiUrl output and record the headers and body of a 429. If they differ, fix the stand-in in src/throttle.ts and the page.

### limits-route-throttle-cdkd

Not run: whether cdkd 0.296.28 applies the per-route throttle (RouteSettings for "POST /notes") and honours the DependsOn. The assumption that a stage created before its route fails was not checked either.

To resume: After a deploy, read RouteSettings with aws apigatewayv2 get-stage --api-id <id> --stage-name '$default', and send POST /notes ten times a second to see 429s start at about two a second.

### limits-lambda-throttle-status

Not confirmed: the status an HTTP API returns to the caller when Lambda throttles the function (reserved concurrency reached).

To resume: Deploy with -c reservedConcurrency=1 (the account needs a concurrency of at least 101), send a few requests at the same moment, and record the status returned and the Throttles metric.

### limits-budget-tag-filter

Not confirmed: that cdkd can create the tag-filtered budget (Tags in FilterExpression), whether the key is written project or user:project, and whether a budget created before the tag is activated starts counting afterwards.

To resume: Deploy and look at the budget's filter in the Budgets console. Activate the project tag, wait about two days, and compare the budget's actual spend with what vp run limits:cost prints.

### limits-untagged-charges

Not checked on a bill: which of this stack's charges carry the project tag (API Gateway requests, data transfer, the CloudWatch alarm, tax).

To resume: After activating the tag and using the stack for a few days, run vp run limits:cost and record which services remain in the (no tag) rows.

### limits-load-test-outside-aws

Could not determine from primary sources whether a load test sent from outside AWS (a laptop) against your own API needs notice or has a threshold. The EC2 testing policy is about tests from EC2, and the penetration testing policy prohibits request flooding. This chapter's load generator refuses anything but localhost.

To resume: Before load testing a deployed API, read the two policy pages again and, if in doubt, tell AWS Support the plan and ask.

### 33-live-account

Chapter 33's check reads synthesized templates only. Its findings were never compared with the real settings of a deployed account. AihReadyProduction was not deployed, so PITR, deletion protection, Retain and the 90-day retention set by the aspect were not seen at work. No stack deletion and no replacing update was run, with CloudFormation or with cdkd.

To resume: Deploy a stack with the production settings to a practice account through chapter 20's path (the CDK CLI, as `ship:cfn:*` uses it), confirm the settings with `aws dynamodb describe-continuous-backups` and `aws logs describe-log-groups`, then delete the stack and record that the table and the log group remain, and how to remove them.

### 33-sibling-chapters

Chapter 33 refers to chapters 25 to 32 and 34 to 36 by their stated scope only. Their text was not read, and the check results do not include their stacks.

To resume: Once every chapter is in, run `vp run ready:check` and compare the counts in the chapter's section on the book's stacks, and what each area's section says about the chapters it points at.

### 33-other-platforms

Whether Cloudflare publishes a list comparable to Vercel's production checklist was not confirmed. For Cloudflare, only the retention limit of Workers Logs was read. AWS Config managed rules, cdk-nag and CloudFormation Guard were read about, not run.

To resume: Look in Cloudflare's documentation for a page of pre-launch checks. Run cdk-nag on one stack and compare what it reports with this chapter's 10 rules.

### 34-cluster-deploy

The chapter 34 stack has never been deployed. cdkd 0.296.28 has no provider of its own for AWS::EKS types and goes through Cloud Control API. Unverified: creating and deleting the cluster, the access entries, the Pod Identity association, and Fn::ImportValue from another app's stack.

To resume: Run `vp run net:infra:deploy`, `vp run eks:infra:diff`, and `vp run eks:infra:deploy` in that order, then check with `aws eks describe-cluster --name aih-eks` that the status is ACTIVE and that computeConfig, accessConfig, and upgradePolicy are what the template says. Finish with `vp run eks:infra:destroy`.

### 34-manifests-on-a-cluster

The manifests in k8s/ were never given to an API server. Unverified: that nodes of the custom NodeClass (public subnets, associatePublicIPAddress) start and join, that t4g.medium is what gets launched, that the load balancer's subnets can be chosen by the Name tag, that the Ingress annotations take effect under Auto Mode, that 15 seconds of preStop are enough, and that Pod Identity credentials reach the pod.

To resume: Deploy the cluster, get kubectl, and run `aws eks update-kubeconfig --name aih-eks --region ap-northeast-1`, `vp run eks:manifests cluster | kubectl apply -f -`, and `vp run eks:manifests app --tag v1 | kubectl apply -f -`. Look at `kubectl get nodes -o wide` and `kubectl -n notes get pods,ingress`, and send `curl -si .../health` to the Ingress host name. During `kubectl -n notes rollout restart deployment/notes-api`, watch with chapter 12's `vp run ecs:watch --url http://<host>` that no request fails.

### 34-flake-kubectl

The Nix devShell has no kubectl. The deploy steps of chapter 34 assume it is provided some other way.

To resume: The author decides whether to add `pkgs.kubectl` to the devShell in flake.nix. If so, check with `kubectl version --client` that it is within one minor version of the cluster (1.37), and update the note on chapter 34's deploy page.

### 35-deploy

The chapter 35 stack has never been deployed. Unverified: that cdkd 0.296.28 creates `AWS::Lambda::CapacityProvider` and an `AWS::Lambda::Function` with `CapacityProviderConfig` through Cloud Control API, that `$LATEST.PUBLISHED` is published automatically, that API Gateway can invoke the unqualified function, and that the deploying identity needs `lambda:PassCapacityProvider` and `iam:CreateServiceLinkedRole`.

To resume: After `vp run net:infra:deploy -c interfaceEndpoints=logs`, run `vp run lmi:infra:deploy`, `vp run lmi:smoke`, and `vp run lmi:infra:drift`. Then delete with `vp run lmi:infra:destroy` and `vp run net:infra:destroy`, in that order (hourly charges, about USD 8.87 a day).

### 35-fleet

Not confirmed: how many instances start, the size and price of their EBS volumes, how three instances are placed across subnets in two zones, and the count when `minExecutionEnvironments` is below 3. The cost figures rest on the assumption of three instances.

To resume: After a deploy, read the instance count from the capacity provider's system logs and CloudWatch metrics (namespace `AWS/Lambda`, dimension `CapacityProviderName`). Switch EC2's managed resource visibility to see the instances and volumes, and compare with the bill a few days later.

### 35-runtime

Never observed on Lambda's own execution environment: concurrent invocations, the number of worker threads, scaling, throttling (429), instance replacement, and code that keeps running after a timeout. The local tests reproduce one Node.js process and worker_threads started by the test itself.

To resume: After a deploy, pass `vp run lmi:smoke`, then apply load and watch `ConcurrencyThrottles`, `CPUThrottles`, and the number of execution environments. Follow chapter 32 for load testing.

### 35-network

Beyond CloudWatch Logs and X-Ray, the destinations the instances must reach from the VPC were not confirmed. Whether a function version becomes ACTIVE in private subnets with only the CloudWatch Logs interface endpoint is unverified.

To resume: Deploy the default layout and see whether the function version becomes ACTIVE. If not, try `vp run net:infra:deploy -c egress=nat` and look up the refused destinations in VPC Flow Logs.

### 36-live-model

Chapter 36 has never called real Bedrock. Unconfirmed: that real ConverseStream returns tool requests in the shape of this chapter's schema and fixtures; how a real model behaves (when it calls a tool, what it does after a refusal, whether it obeys a note, whether a named tool's input fits the schema); whether the 4 evaluation cases pass. Also unconfirmed: that naming a tool in toolChoice and cache checkpoints work on Nova 2 Lite, that outputConfig.textFormat works on Claude Haiku 4.5 through the jp. profile, that the cache is hit, and how cache writes priced at USD 0 in the Price List are counted on a bill.

To resume: Prepare examples/36-bedrock/.env and run vp run bedrock:eval:live (billed), once per model by changing BEDROCK_MODEL_ID. If the event shapes differ, fix src/converse.ts and fixtures/transcripts.

### 36-deployed-stack

The chapter 36 stack has not been deployed. Unconfirmed: that cdkd can create, update and delete AWS::Bedrock::Guardrail and GuardrailVersion through the Cloud Control API; that a guardrail with sensitive information filters only can be created; that ConverseStream with a guardrail passes with a role whose bedrock:ApplyGuardrail is narrowed to its own guardrail; what requestContext.authorizer.iam.userId holds in the function URL event for an assumed role; that the conditional update in DynamoDB holds the budget under simultaneous requests; which pieces arrive when a guardrail blocks partway through the output; how text units are counted in a call with several rounds.

To resume: Run vp run bedrock:infra:deploy, vp run bedrock:smoke, vp run bedrock:logs, vp run bedrock:infra:drift, and vp run bedrock:infra:destroy, in that order. Check a deploy with -c promptAttackFilter=standard once too.

### 36-batch-job

No batch inference job was created. The input file's shape and the limit checks were verified locally, but the S3 buckets, the service role, CreateModelInvocationJob and the real shape of the output are unconfirmed. Whether structured outputs work in a batch is stated differently on two documentation pages (batch-inference and structured-output).

To resume: Put the output of vp run bedrock:batch:plan in S3, create the service role as batch-iam-sr describes, and create a job. Run the output through parseOutputLine in src/batch.ts.

### 36-agentcore

Amazon Bedrock AgentCore and Agents Classic were not run. The chapter only presents the structure described in their documentation.

To resume: Run the same tools on AgentCore Harness or Runtime and check how the caller's identity reaches the tools.

### 37-cloudshell-node

CloudShell's Node.js version is not documented, and whether aih-cloudshell.mjs (esbuild target node18) runs there is unconfirmed. It was not run on Node.js 18 either.

To resume: Run vp run cloudshell:build locally, open CloudShell in Tokyo, upload dist/aih-cloudshell.mjs with Actions > Upload file, record node --version, and run node aih-cloudshell.mjs whoami.

### 37-cloudshell-cli-shapes

Whether the fake aws answers in the real shapes is unconfirmed: --query 'Contents[].Key' on an empty prefix, NextToken from list-object-versions with --max-items, a successful quiet delete-objects, and the state.json cdkd really writes.

To resume: In an account with chapter 02's hello stack deployed, run left from CloudShell. Put a few objects in chapter 07's bucket with an overwrite and a delete, run empty without and then with --yes, and compare counts and results. Fix the schemas in src/stacks.ts and src/empty.ts where they disagree.

### 37-cloudshell-policies

The behavior of allowShell, denyShell and denyPublicEnvironments on a real role is unconfirmed. allowedActions in src/policy.ts is not IAM's evaluation.

To resume: Open the console as a role with only the output of vp run cloudshell:policy use-no-files attached; see that CloudShell opens, that Upload file under Actions is refused, and that aws sts get-caller-identity works. Add deny and see that it no longer opens. Check the 11 actions in the IAM policy simulator as well.

### 37-cloudshell-nix

Whether Nix can be installed in CloudShell, and whether it would survive a session, was not tried. The free space outside the home directory and the CPU architecture could not be confirmed from the documentation.

To resume: In CloudShell record uname -m and df -h / /home. Run the official Nix installer with --no-daemon, record the result, and after Actions > Restart see whether /nix is still there.

### 37-cloudshell-vpc

No CloudShell VPC environment was created. That one placed in chapter 11's default configuration (no NAT) reaches no API other than S3 and DynamoDB is an inference from the documentation.

To resume: After net:infra:deploy, choose Create VPC environment from + in CloudShell with chapter 11's private subnet and a security group. Compare aws sts get-caller-identity with aws s3 ls, then delete the environment and check that no network interface is left.

### 37-remote-editor

SSH through Session Manager and the AWS Toolkit for VS Code connection to EC2 were not run. Chapter 23's stack registers no SSH key. The end date of Cloud9, the date CodeCatalyst closed to new customers, and the prerequisites and price of Code Editor in SageMaker Studio are unconfirmed.

To resume: Enter chapter 23's instance with Session Manager, add a public key to ec2-user's authorized_keys, then try ssh i-... with the chapter's ProxyCommand. For Cloud9 and CodeCatalyst, read the notices in their user guides and the AWS Lifecycle Changes page in a browser.

### 38-datasync-run

The chapter 38 DataSync task has never been run on AWS. Unconfirmed: that cdkd 0.296.28 can create `AWS::DataSync::LocationS3` and `AWS::DataSync::Task` through Cloud Control API; creating `AWS::Logs::ResourcePolicy`; whether deploying a stack to the Osaka Region needs extra preparation; that the role is checked when a location is created; that a Basic mode task holding a location ARN from another Region runs; scheduled executions; what DataSync treats as changed (a tag-only change and objects written in parts in particular); the outcome when the source changes during an execution; whether an object a filter excludes is deleted under REMOVE; that a delete in the versioned archive becomes a delete marker; the real shape of the EventBridge event and the spelling of states other than SUCCESS and ERROR; the number and cost of S3 requests in an execution that copies nothing.

To resume: Note `SourceLocationArn` from `vp run move:infra:deploy`, then run `vp run move:archive:infra:deploy -c sourceLocation=<ARN>`. Following the chapter's deploy page, put objects in the Tokyo bucket, run `aws datasync start-task-execution --region ap-northeast-3 --task-arn <TaskArn>`, and read the counters from `describe-task-execution`. Run it again to see zero copies, and check the S3 requests on the bill. Finish with `vp run move:empty --yes`, `move:archive:infra:destroy`, and `move:infra:destroy`.

### 38-cross-account

A copy across accounts was not tried. `-c writerRole=<ARN>` only adds one statement to the archive's bucket policy; creating the role, the locations, and the task in the source account is not part of this chapter's stacks. Copies to and from R2 (a DataSync object storage location, Super Slurper, Sippy) were not run either.

To resume: Follow the DataSync user guide's "Transferring data between Amazon S3 buckets across AWS accounts": create the role in the source account, pass its ARN as `-c writerRole=` when deploying the archive stack, and create the location with `aws datasync create-location-s3`.

### 39-cdkd-dms

Whether cdkd 0.296.28 can deploy the chapter 39 stack was not confirmed. The installed package has no dedicated implementation for AWS::DMS, and AWS::DMS::ReplicationInstance is on its list of types that cannot be provisioned. The Cloud Control API list of supported types (last updated 2025-12-23) has neither AWS::DMS::Endpoint nor AWS::DMS::ReplicationSubnetGroup.

To resume: Read `ProvisioningType` from `aws cloudformation describe-type --type RESOURCE --type-name AWS::DMS::Endpoint` (and ReplicationSubnetGroup). If it is FULLY_MUTABLE or IMMUTABLE, try `vp run dbmig:infra:deploy`. If it is NON_PROVISIONABLE, manage this stack with the AWS CDK CLI alone and correct the table under "How far cdkd can deploy".

### 39-dms-run

The chapter 39 migration was never run on AWS. Unconfirmed: whether a `text` primary key fails in a PostgreSQL to PostgreSQL migration, whether a 10,000-character body escapes truncation at LobMaxSize 64 KB, whether the target user can run `SET session_replication_role = replica`, whether the HeartbeatSchema schema must exist beforehand, whether a Serverless replication works behind a security group limited to port 5432 and port 443 inside the VPC, the billing of an unstarted configuration and of a stopped replication, whether deleting the configuration drops the source's slot, the retention of the DMS log group, and every duration (full load, lag, outage).

To resume: Follow the Deploy page: deploy the chapter 11 VPC with `-c interfaceEndpoints=secretsmanager`, prepare an RDS for PostgreSQL and an Aurora PostgreSQL, then run `vp run dbmig:preflight`, `aws dms start-replication` (with a premigration assessment), `aws dms describe-replication-table-statistics`, `vp run dbmig:verify`, `aws dms stop-replication`, and `vp run dbmig:sequences --apply`, recording durations and lag. Finish in the order under Cleanup and check `pg_replication_slots` on the source.

### 39-other-sources

Whether Neon can be an AWS DMS source, and whether the output of `wrangler d1 export` loads into PostgreSQL, were not tried. Neither Neon nor SQLite is in the list of DMS sources, and Neon's documentation covers DMS only with Neon as the target.

To resume: Enable logical replication on a Neon project and try the connection test and a full load from a DMS source endpoint. For D1, export a small database with `wrangler d1 export`, load it into PGlite, and record which types and syntax need changing.

### 40-deploy

The chapter 40 stack has never been deployed. Unverified: that cdkd 0.296.28 creates the interface endpoints (drs, ec2) and `AWS::EC2::SecurityGroupEgress` through Cloud Control API, that the managed policy attaches to another stack's role, and that the EventBridge rule invokes the function.

To resume: After deploying chapters 11 and 23, run `vp run dr:infra:deploy -c sourceRoleName=<role> -c sourceSecurityGroupId=<sg>`, `vp run dr:infra:drift`, and chapter 23's `vp run ec2:infra:drift`. Then delete everything in the order of the cleanup section (the endpoints are billed by the hour).

### 40-agent

The AWS Replication Agent was never installed. Unverified: that the installer succeeds on Graviton Amazon Linux 2023 with a kernel up to 6.12, that this chapter's policy (the managed one minus cross-account and source network permissions) is enough, that the interface endpoint is found through private DNS without `--endpoint`, that the agent works with IMDSv2 required and a hop limit of 1, and that the S3 gateway endpoint alone delivers the installer and the replication server software.

To resume: On a chapter 23 instance pinned with `-c amiId=` to an AMI whose kernel is 6.12 or older, open `vp run ec2:session` and run the installer. On failure, first swap in the AWS managed `AWSElasticDisasterRecoveryEc2InstancePolicy` to tell a permission gap from anything else.

### 40-drill

No drill, recovery, or failback was ever run, so there are no measured RPO or RTO values. Unverified: the real format of `lagDuration`, how long a `StartRecovery` job takes, that the launched instance appears in SSM, that the data volume mounts by the same UUID, reversed replication and launching into the original instance, and how long after a disconnect the charges stop.

To resume: Once the initial sync is done: `vp run dr:status`, `vp run dr:drill --apply`, `vp run dr:job --job <id>`. Copy `drill/record.template.json`, fill in the times, then `vp run dr:terminate --apply`, and finally `vp run dr:billed`.

### 40-cfn-drs-types

In the CloudFormation resource provider schemas downloaded on 2026-10-13, `AWS::DRS::*` existed in us-east-1 and us-west-2 and was absent from ap-northeast-1 and four other Regions. Not every Region was checked, and the registry itself (which needs credentials) was not asked. `-c templates=declare` was never deployed.

To resume: Check with `aws cloudformation describe-type --type RESOURCE --type-name AWS::DRS::ReplicationConfigurationTemplate --region ap-northeast-1`. If it exists, try `vp run dr:infra:deploy -c templates=declare` and record the order of initialization (whether `initialize-service` has to come first).

### fargate-deploy

Chapter 41's stack has never been deployed. That cdkd 0.296.28 can create the service with a capacity provider strategy, the cluster's CapacityProviders, the Schedule with EcsParameters, and the two scaling policies through Cloud Control was read from source only.

To resume: Deploy chapter 11's VPC, then run fargate:infra:deploy, fargate:bundle, fargate:image:build f1, fargate:image:push f1, and fargate:infra:deploy -c imageTag=f1 in that order; check capacityProviderStrategy in ecs describe-services and application-autoscaling describe-scaling-policies. Destroy afterwards.

### fargate-spot-order

Whether a Spot interruption deregisters the task from the load balancer before SIGTERM could not be settled from the pages read. The page and the tests assume the worst case, both at once. The Tokyo Spot price is not in the Price List, and the pricing page's table is filled in by script.

To resume: Run tasks on Spot. A stop-task call does not reproduce it, so compare the times of the ECS Task State Change event (stopCode SpotInterruption) with the load balancer's access log. Read the price from the pricing page in a browser.

### fargate-scaling-model

How many minutes the target tracking alarms take (3 to scale out and 15 to scale in, in the model) and how many tasks one scale-in removes are not given as numbers in the primary sources; they remain assumptions of the model.

To resume: After deploying, take the alarm names from Alarms in aws application-autoscaling describe-scaling-policies, read EvaluationPeriods and Period with aws cloudwatch describe-alarms, and replace the numbers in src/model-defaults.ts. Apply load and compare with describe-scaling-activities.

### fargate-scheduler-input

What a Target's Input becomes for Scheduler's ECS templated target (the RunTask overrides or not) could not be confirmed from primary sources, so the example does not use Input. The job does not receive its scheduled time.

To resume: After deploying, create one schedule whose Input is a containerOverrides JSON and look at overrides in describe-tasks for the task it starts.

### fargate-exec-session

ECS Exec was never run. Whether the default logging (DEFAULT) writes the session to the task's log group, whether that needs log permissions on the task role, and whether the AWS CLI in the Nix devShell has the Session Manager plugin are not confirmed.

To resume: Deploy with -c exec=true, wait until ExecuteCommandAgent is RUNNING in aws ecs describe-tasks, and run fargate:exec. Check CloudTrail's ExecuteCommand event and the log group, then deploy again without exec.

### 42-firewall-manager-deploy

The two stacks of chapter 42 have never been deployed to AWS (there is no organization). Unconfirmed: that cdkd 0.296.28 can create, update, and delete `AWS::FMS::Policy` and `AWS::FMS::NotificationChannel` through Cloud Control API; that the `ORGUNIT` key of `IncludeMap` and `ManagedServiceData` as a string are accepted; whether Firewall Manager's real decisions match this chapter's models (scope, tags, "within the allowed range", rules whose source is a security group); what happens to an existing web ACL when `overrideCustomerWebACLAssociation` is false; the time from a resource's creation to the compliance report and to the web ACL association; the real fields and the account of the findings that reach Security Hub; the content of the messages on the SNS notification channel; what stays in member accounts after a policy is deleted; and proration and the usage type of the policy fee.

To resume: Prepare a practice OU with one or two accounts and follow the chapter's deploy page. After all features in Organizations, designating the Firewall Manager administrator account, AWS Config in the accounts in scope and in the administrator account (us-east-1 and ap-northeast-1, continuous recording), and Security Hub CSPM, run `vp run fwm:infra:deploy -c adminAccountId=<ID> -c orgUnitIds=<ou-id>` and `vp run fwm:edge:infra:deploy` with the same context, then compare the compliance status and violation details in the console with the local models. Deploy again with `-c wafRemediation=on` and `-c sgRemediation=on`, and record the time to association, a real finding event (the notifier's log), and the SNS messages. Finish with the two destroy tasks and check which web ACLs and AWS Config rules stay in the member accounts. Each policy is USD 100 a month.

### glue-script-not-executed

glue/curate.py has never been executed. There is no Spark on this machine and AWS was not touched. That the script does what src/curate.ts specifies is a claim, not an observation. In particular: reading the partition column with dt STRING added to a user schema, FAILFAST stopping on a field of the wrong type, DataFrame.isEmpty, awsgluedq's process_rows returning the same shape on AWS Glue 5.1, and an overwrite replacing only the dt=<day>/ folder.

To resume: Run vp run glue:infra:deploy, vp run glue:seed, then vp run glue:run --days 2026-10-10,2026-10-11 and check that the state is SUCCEEDED. Run vp run glue:verify and check that both days print identical to the specification. Run the same glue:run once more and check that glue:verify still says the same.

### glue-role-minimum

Whether the job's role is enough was not checked. It can list the bucket, read raw, read, write and delete curated, read the one script, and write to two log groups; it has no glue: and no cloudwatch: action at all. Whether an AWS Glue 5.1 job with bookmarks disabled and data quality publishing off still calls an AWS Glue API, whether it asks for logs:CreateLogGroup on groups that exist, and whether the S3 connector writes marker objects outside the curated prefix could not be read from the documentation.

To resume: If glue:run fails with AccessDenied, find the denied action and resource in the log group /aih/glue/curate/error and in CloudTrail. Add that action alone to the role in infra/lib/glue-stack.ts and update the test's expectation.

### glue-dq-model

evaluate in src/quality.ts is this chapter's model written from the DQDL reference, not AWS Glue Data Quality. That between excludes both ends and that a NULL fails ColumnValues follow the reference. How IsUnique counts NULLs, what an empty dataset gives, and how a numeric = compares were not confirmed.

To resume: After deploying, put a raw file with one row whose status is 600 under requests_json/dt=<day>/ and run glue:run. Check that the state is FAILED, that the error names ColumnValues "status" between 99 and 600, and that the day's curated folder is as it was.

### glue-failure-signal

The failure signal was not exercised. The field names in the detail of Glue Job State Change (jobName, state) were taken from the source of aws-cdk's aws-glue-alpha, because the AWS documentation page for them now redirects. That MatchedEvents in AWS/Events is recorded for this rule, and that the alarm stays in ALARM for a day, are unconfirmed too.

To resume: After deploying, subscribe an email address to the topic. Put a file with a line that is not JSON under requests_json/dt=<day>/ and make a run fail by running glue:run for that day. Check that the email carries jobName and state, and that the CloudWatch alarm goes to ALARM.

### glue-cdkd-deploy

This stack was not deployed with cdkd 0.296.28. Read from its source only: that the script's file asset goes to cdkd's asset bucket and that the bucket name inside ScriptLocation and inside the role's ARN is rewritten to it; and that an update of a Glue trigger does not send StartOnCreation (adding -c schedule=on later does not activate a trigger that already exists).

To resume: After vp run glue:infra:deploy, look at the bucket in ScriptLocation with aws glue get-job --job-name aih-glue-curate and check with aws s3 ls that the object is there. Deploy again with -c schedule=on and look at State in aws glue get-trigger --name aih-glue-curate-daily. If it is still CREATED, activate it with aws glue start-trigger.

### glue-run-duration

No run was timed. The price table works out three cases only: the one-minute minimum, an assumed three minutes, and the ten-minute timeout. Whether start-up time is billed was not confirmed either.

To resume: Record the execution time glue:run prints over several runs and compare it with the ETL-DPU-Hour quantity on the bill.

### health-no-real-event

No real Health event has been received. The event shape was written from the documentation's table and samples. Unconfirmed: the fields on which table and samples disagree (whether lastUpdatedTime is present, the spelling of the persona), the detail of an AWS Health Abuse Event, the eventRegion of a global event, and any field the table does not list.

To resume: After vp run health:infra:deploy and vp run health:global:infra:deploy, wait for events (an outage cannot be provoked; scheduled changes and notices may arrive a few times a month). Read the sent, ignored and unreadable lines in the function's log group. If an UNREADABLE notice arrives, fix the schema in src/event.ts as its 'What did not fit' list says, and add the received JSON to the fixtures with identifying values removed.

### health-service-codes

The documentation has no list of the service codes that appear in detail.service. Confirmed: EC2, LAMBDA, ELASTICLOADBALANCING, VPC, AUTOSCALING and RDS (examples in the text), EBS and S3 (read off event type codes), and MULTIPLE_SERVICES (observed in the public page's data). The codes for DynamoDB, API Gateway, CloudFront, Cognito, SQS, SNS and others are unconfirmed and are not in SERVICES.

To resume: Open the rule builder in the EventBridge console and choose Health as the service name and Specific service(s): the list of codes appears (the documented procedure). With a Support plan, aws health describe-event-types returns them too. Add the confirmed codes to SERVICES in src/watch.ts. Until then a public issue of an unlisted service arrives as INFO with its code in the subject.

### health-deploy-unverified

The stacks have not been deployed with cdkd. Unverified: deploying the second stack to us-east-1 (including whether that Region needs its own bootstrap), the rules' permission to invoke the function, a real invocation, TTL, the dead-letter queue, and how the subject and body look in mail. Also unverified: that with -c alarmTopicArn pointing at chapter 19's topic the function's role alone is enough to publish (that topic's policy allows only CloudWatch).

To resume: Run vp run health:infra:diff, vp run health:infra:deploy -c alarmEmail=<address>, then vp run health:global:infra:deploy -c alarmEmail=<address>, and confirm the subscription mail. In the rule's page of the EventBridge console choose a Health sample under 'Use sample events provided' and see whether the pattern matches (no event is sent). Invoking the function with an event from fixtures/documented.json as the test payload exercises the ledger and SNS end to end. Destroy afterwards.

### health-support-plan-pages-disagree

The Support plans named as required for the AWS Health API differ between the user guide (Business Support+, Enterprise Support, Unified Operations; Business, Enterprise On-Ramp, or Enterprise where those plans are not offered or the account has not transitioned) and the API reference's Welcome page (Business, Enterprise On-Ramp, Enterprise only). Until when the older plans remain valid could not be read from the pages opened.

To resume: Re-read https://aws.amazon.com/premiumsupport/plans/ and the opening of the AWS Health user guide. Check your own account's plan in the Support Center.

### 45-composer-vscode

Infrastructure Composer in VS Code was not opened. Whether it opens the JSON templates in cdk.out, which resources become enhanced component cards, how a template changes when merely opened and saved, and whether drawing needs credentials are unconfirmed.

To resume: Install the AWS Toolkit in VS Code, run vp run hello:infra:synth, open examples/02-toolchain/cdk.out/AihHello.template.json and press the Infrastructure Composer button. Compare the lines with the output of vp run composer:graph:hello. Copy the file, save it from the diagram unchanged, and compare with the original using vp run composer:graph ../02-toolchain AihHello --against <copy> and diff.

### 45-template-studio

Template studio was not opened. Whether this module's graph has the same lines as its diagram, and whether a local file can be loaded, are unconfirmed. That template studio is the replacement editor of the notice is a judgment from the former Infrastructure Composer page's URL now returning the template studio page.

To resume: In the CloudFormation console open Template studio from the navigation and paste the contents of examples/20-shipping/cdk.out/AihShipApi.template.json into the editor. Compare the diagram's lines one by one with the connections printed by vp run composer:graph:ship, and fix the walk in src/graph.ts where they differ. Do not save.

### 45-cfn-cycle

How CloudFormation treats a template whose references form a cycle could not be confirmed from the pages read.

To resume: Look for a statement on circular dependencies in the CloudFormation User Guide. Failing that, run aws cloudformation validate-template on a two-resource template with a cycle and record the answer (a read, but it needs credentials).

### shield-deploy-not-run

AihShield and AihShieldEdge were not deployed. That a direct request to the function URL gets 403, that /health is cached through CloudFront, and that a different query string is the same object, are read from the documentation and the template only.

To resume: After vp run shield:infra:deploy: curl -i the FunctionUrl output and expect 403; curl -i <Url>/health twice and expect the second to say x-cache: Hit from cloudfront with the same x-request-id; then the same for /health?x=1.

### shield-rate-rule-timing

How many seconds the rate-based rule takes to act was not measured. The simulation's 30 seconds is the value the documentation calls the usual upper bound. That blocked requests keep being counted is this chapter's reading of the documentation.

To resume: With AihShieldEdge attached to AihShield, send 10 requests a second from one address of your own for three minutes, and record the seconds until the first 403 and, after stopping, until requests pass again. Keep it to your own resources.

### shield-function-url-brake

Not confirmed: that a function URL with reserved concurrency starts answering 429 at ten times that many requests a second, and what CloudFront does with the 429 (including whether it caches it). The model's burst (one request per reserved unit) is this chapter's assumption. Whether Lambda charges for a refused invocation is not confirmed either.

To resume: After vp run shield:infra:deploy -c reservedConcurrency=1, send about 30 requests a second to /notes for 10 seconds and record the share of 429s, their headers and x-cache. The next day, compare Lambda's billed requests with the Invocations and Throttles metrics.

### shield-waf-metric-dimensions

Not confirmed against live metrics: that BlockedRequests in AWS/WAFV2 for a CloudFront web ACL is found with only the WebACL and Rule dimensions the alarm uses.

To resume: Deploy AihShieldEdge, trip the rule once, and run aws cloudwatch list-metrics --namespace AWS/WAFV2 --metric-name BlockedRequests in us-east-1 to see the dimension sets. If they differ, fix infra/lib/edge-stack.ts.

### shield-advanced-not-subscribed

No Shield Advanced subscription was taken. Not confirmed: that cdkd 0.296.28 can create AWS::Shield::Protection (it has no provider of its own and goes through Cloud Control API), that a protection for CloudFront may be declared in a us-east-1 stack, that DDoSDetected's dimension is named ResourceArn, and how a deploy fails without a subscription. The SRT, cost protection, proactive engagement and health-based detection are from the documentation only.

To resume: In a subscribed account, run vp run shield:edge:infra:deploy -c shieldAdvanced=on -c distributionArn=<DistributionArn of AihShield>, then check the protection in the Shield console and the dimensions with list-metrics --namespace AWS/DDoSProtection in us-east-1. The subscription comes to USD 36,000 over its year, so do not take it for this alone.

### shield-flat-rate-plan

CloudFront's flat-rate pricing plans were not tried. Not confirmed: that this chapter's distribution (a function URL origin with origin access control) can join a plan, whether a plan can be set from CloudFormation, and what actually happens above the allowance.

To resume: Open the deployed distribution in the CloudFront console and record whether the Free plan can be chosen, or why it is refused. The documentation says an account using AWS Free Tier is not eligible.

### shield-alb-closing-not-deployed

The three ways of putting a load balancer behind CloudFront (infra/lib/alb-origin.ts) were only synthesized and run through this chapter's check; no stack deploys them. VPC origins and looking up the prefix list ID were not tried in an account.

To resume: Put the shape of prefixListLoadBalancer into chapter 12's stack, look up the ID with aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing, deploy, and confirm that curl to the load balancer's DNS name does not connect. A load balancer is billed by the hour.

### 47-test-state

Chapter 47's local interpreter is a model of the author's own and has not been compared with the real Step Functions. Unconfirmed: that Step Functions evaluates the JSONata expressions (`$merge`, concatenation with `&`, `$exists`, `$count`, an array of one element) to the same values; how retriers and catchers are chosen, and how a retrier with `MaxAttempts: 0` behaves; the default of a missing `Output` (the specification says two different things in two places).

To resume: With credentials, run `vp run sfn:test-state`. No stack is needed, and with mocks no other service is called. A line marked `DIFFERENT` is an error in the model or in the table. After fixing it, check with `vp test run examples/47-step-functions` that the table and the interpreter agree.

### 47-deploy

The chapter 47 stack has never been deployed. Unconfirmed: that cdkd 0.296.28 creates a state machine from a JSONata `DefinitionString` assembled with `Fn::Join`, and an Express one with a `LoggingConfiguration`; that the trust policy conditions are accepted; that each state's permissions suffice (in particular whether `s3:GetObject` and `s3:PutObject` are enough for `aws-sdk:s3:copyObject`); that the DynamoDB condition expressions behave as intended and the error is named `DynamoDB.ConditionalCheckFailedException`; the error name when the copy source is missing; that `sqs:sendMessage.waitForTaskToken` sends an object `MessageBody` as a JSON string; the error name of a missed heartbeat (the documentation says `States.Timeout` on some pages and `States.HeartbeatTimeout` on another); that a retry is given a new token; that a redrive resumes from a compensation state; the duration and billed memory of the Express workflow, and the real number of state transitions, including how Map iterations are counted.

To resume: Run `vp run sfn:infra:deploy`, `vp run sfn:start`, `vp run sfn:callback --verdict clean`, `vp run sfn:status`, and `vp run sfn:digest --ids note-1,nope`. For the failure path, start another note ID and answer `sfn:callback --verdict infected`. To make a compensation fail, remove `s3:DeleteObject` from the role for a while during a run, put it back, and resume with `vp run sfn:status --redrive <ARN>`. Finish with `vp run sfn:empty --yes` and `vp run sfn:infra:destroy`.

### 48-real-service-errors

The form of real services' errors, their statuses and request IDs, and whether they send x-amz-retry-after were not checked

To resume: Deploy chapter 05's or 32's stack, cause throttling with a client that has attemptLogPlugin, and read status, error and awsRequestId in the log

### 48-https-and-connection-timeout

Connection behaviour against an HTTPS endpoint and connectionTimeout were not checked. The local server is plain HTTP

To resume: Add an HTTPS server with a self-signed certificate to examples/48-sdk, or point a client with connectionTimeout at an address that does not respond, and time how long until TimeoutError

### 48-retries-2026-default-date

When the 2026 retry behaviour becomes the default was not established. Nor were DynamoDB Streams' 4 attempts or an actual wait at DynamoDB's 25 ms

To resume: Read the announcement the reference's Retry behavior page points to. Run vp test run examples/48-sdk on every SDK upgrade, and when defaults.test.ts fails, update PINNED_DEFAULTS and the tables in the pages

### 48-adaptive-mode

adaptive mode was not run

To resume: Point a client with retryMode: "adaptive" at a script that only throttles, and confirm from arrival times that the first request of a later call is delayed

### 48-credential-sources

Sources other than environment variables and static keys in a profile were not exercised: Lambda, ECS, EC2, IAM Identity Center, aws login, assuming a role, credential_process, web identity

To resume: Run vp run sdk:credentials on a machine where aws login was done and read sources and tried. On Lambda, log the result of reportDefaultCredentials

### 48-presign-expiry

A presigned URL expiring with its credentials, how much life a Lambda execution role's credentials have left, and what the empty-body checksum in a presigned PutObject URL does to a real upload were not checked

To resume: In chapter 07's stack, log the expiration from config.credentials() inside the function. PUT a body to a PutObject URL and read S3's answer

### 48-client-mock

aws-sdk-client-mock was not tried with the pinned SDK

To resume: Add it to examples/48-sdk as a devDependency and write one test that replaces DynamoDBDocumentClient's send

### 48-update-add-twice

That DynamoDB's UpdateItem adds twice on receiving the same ADD twice was confirmed neither against the real service nor against DynamoDB Local

To resume: Start DynamoDB Local as chapter 05 does, send the same UpdateItemCommand twice, and read the value

### 48-cloudflare-binding-retries

How much of retrying and timing out a Cloudflare binding takes on was not checked

To resume: Look for statements on retries and timeouts in the Workers API pages of D1 and R2

### athena-sql-not-executed

None of this chapter's SQL (the parameterized SELECT, CREATE EXTERNAL TABLE, INSERT INTO, CTAS, UNLOAD, the Iceberg CREATE TABLE, MERGE INTO, OPTIMIZE, VACUUM, FOR TIMESTAMP AS OF) was executed in Athena. The syntax follows the documented forms and nothing more. Also unconfirmed: that a dt condition given as parameters prunes partitions, and that removing duplicates by grouping on every column is accepted.

To resume: Deploy chapter 26's stack and this one with -c lakeBucketName=<chapter 26's LakeBucketName>, run chapter 26's analytics:smoke, then vp run athena:run --name route, create-compact, compact, create-iceberg, merge, merge again, yesterday, optimize, vacuum, scratch, unload in that order. Check that each reaches SUCCEEDED, that route scans no more than the day's objects, and that the second merge adds no rows.

### athena-execution-parameter-parsing

Not checked: how Athena interprets an execution parameter's value. The documentation says a string must be enclosed in single quotes and that a value may be CAST(...), so the value is taken to be read as a SQL literal or expression, and text is quoted with its quotes doubled. That a quoted value is always treated as one string was not confirmed.

To resume: After deploying, run SELECT ? AS v in the console or with the CLI, passing as the execution parameter 'O''Reilly', then 'a'' OR ''1''=''1', then abc without quotes, and look at the value or the error that comes back.

### athena-enforced-workgroup-writes

Not checked: that a workgroup which enforces its result location accepts an Iceberg CREATE TABLE with a location, an UNLOAD with TO, and a CREATE EXTERNAL TABLE with LOCATION. The documentation says only that a CTAS with external_location fails there. That a CTAS table lands under results/tables/<query ID>/ is also as documented, not as observed.

To resume: After deploying, run vp run athena:run --name create-iceberg, --name unload and --name scratch. After scratch, look at aws s3 ls s3://<OutputBucketName>/results/tables/ to see where the files went.

### athena-analyst-role-sufficient

Not checked: that the analyst role can run every statement in this chapter. Its Glue actions are those of the documented examples (GetDatabase, GetTable, GetTables, GetPartitions, CreateTable) plus CreatePartition, BatchCreatePartition, UpdateTable and DeleteTable, which INSERT INTO and Iceberg commits are thought to need. A missing action would show as AccessDenied.

To resume: Assume the role in AnalystRoleArn (aws sts assume-role) and run the steps of athena-sql-not-executed. On AccessDenied, add the action named in the message to the matching statement in infra/lib/athena-stack.ts.

### athena-result-header-row

The API reference does not say that the first row GetQueryResults returns holds the column names. The client drops the first row of the first page only when it equals the column names exactly. A one-row result whose values happen to equal its column names would lose that row.

To resume: After deploying, run vp run athena:run --name route and compare the rows it prints with the result in the console.

### athena-limit-and-cutoff

Not checked: whether a query with only a LIMIT stops reading early, and how much a query reads past the workgroup's limit before it is cancelled. The pricing scenarios take a query that sorts or aggregates to read everything, and a cancelled query to have read exactly the limit.

To resume: Once a few days of records exist, run SELECT * FROM aih_analytics.requests LIMIT 10 and the same with ORDER BY duration_ms DESC LIMIT 10, and compare the bytes scanned. For the limit, look at the bytes scanned when the route query with --from 2026-10-01 is cancelled.

### athena-cdkd-cloud-control

Not checked: that cdkd 0.296.28 creates, updates and deletes AWS::Athena::WorkGroup (with engineVersion and expectedBucketOwner) and AWS::Athena::NamedQuery through Cloud Control API.

To resume: Read the route and result per resource in the output of vp run athena:infra:deploy, then run vp run athena:infra:drift, vp run athena:empty --yes and vp run athena:infra:destroy.

### athena-log-tables-not-created

The table definitions for CloudTrail, ALB, CloudFront and S3 access logs are the documentation's statements stored as they are; none was created in Athena. None of the book's stacks delivers these logs to S3.

To resume: With a bucket that receives one of these logs, run the output of vp run athena:logs:ddl --kind <kind> --bucket <name> --prefix <folder> in the Athena console and check with SELECT * … LIMIT 10 that the columns are read.

### 50-deploy

The chapter 50 stack has never been deployed. Unverified: that cdkd 0.296.28 creates `AWS::BedrockAgentCore::Runtime` (through Cloud Control API, because it carries `RequestHeaderConfiguration`) and `AWS::BedrockAgentCore::Memory`, that the direct code deployment ZIP can be placed as a cdkd asset and read by the execution role, that the CommonJS `app.js` starts on Node.js 22, that the execution role is enough without the X-Ray statements and `logs:PutResourcePolicy`, and what MMDSv2 defaults to (`CfnRuntime` has no property for it).

To resume: After `vp run agentcore:infra:deploy`, create a user and a token as the deploy page describes, then run `AIH_ACCESS_TOKEN=... vp run agentcore:invoke` and `vp run agentcore:infra:drift`. If an invocation answers `ValidationException`, suspect `metadataConfiguration.requireMMDSV2`. Finish with `vp run agentcore:infra:destroy` and delete the log groups that start with `/aws/bedrock-agentcore/runtimes/`.

### 50-runtime-request

The request the Runtime hands the agent was never observed. Unverified: that an allowlisted `Authorization` arrives under that name, that `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` arrives, that server-sent events flow through as they are, that the agent's 4xx becomes 424, that the AWS SDK finds the execution role's credentials inside the microVM with no configuration, and that a Cognito access token from `AdminInitiateAuth` passes the `allowedClients` check.

To resume: Deploy, run `vp run agentcore:invoke`, and check the `invocation` lines and their `owner` in the agent's log group. If a header does not arrive, log header names only for a while with `LOG_LEVEL=debug` (never the token's value).

### 50-memory

AgentCore Memory was never called. Unverified: that `CreateEvent` accepts this chapter's payload (two conversational items and a `seq` metadata value), that a repeated `clientToken` is ignored, the shape `ListEvents` returns, that a Cognito `sub` and this chapter's session ID (32 hex digits, a hyphen, a UUID) are accepted as `actorId` and `sessionId`, and the Tokyo price of short-term memory. The API reference gives 3 as the minimum of `eventExpiryDuration` and the quotas page 7 (the stack uses 30).

To resume: After deploying, ask two questions in one session and check that the second builds on the first, and still does after a pause of more than 5 minutes. Look at the events with `aws bedrock-agentcore list-events` and compare them with the schema in `src/memory-events.ts`. Read the short-term memory line item and rate from the bill or Cost Explorer, and add the price to `data/fragments/50.json`.

### 50-status

No primary source was found that says whether the Runtime's Instances compute type and platform version V2 are generally available or in preview. The documentation says CloudFormation and the CDK do not support `platformVersion`, while `CfnRuntime` in `aws-cdk-lib` 2.273.0 has the property.

To resume: Read the release notes and What's New again. To try V2, add `platformVersion: "V2"`, synth, and let a deployment show whether Cloud Control API accepts it (creation takes minutes, and `/ping` must answer Healthy within 120 seconds).

### 51-chime-real-call

Chapter 51: no real call has been made. Unconfirmed: the real shapes of the Chime API's responses, that GetMeeting and CreateAttendee answer NotFoundException for an ended meeting, that the IAM policy lets the five calls through (and the Region in the ARN when the media Region is not Tokyo), microphone, camera, audio, video and reconnection in a browser, the status codes the library reports for a second connection with the same join token and after DeleteAttendee, and when billing stops after a tab is closed.

To resume: Set AIH_AWS_ACCOUNT_ID, then run vp run calls:infra:deploy, calls:user:create for two users, calls:config and preview:calls:web. Join from two browsers, make the three checks on the Deploy page (Remove, Leave, Join from another tab), and look for MeetingsError in the function's log. Afterwards run calls:end --yes and calls:infra:destroy.

### 51-chime-dynamodb-conditions

Chapter 51: DynamoDbRoomStore's condition expressions (seats.#sub, contains(members, :sub), size(members), and string-set updates with ADD and DELETE) have not been run against DynamoDB. The tests only pin the expressions that are sent.

To resume: Where Docker is available, run vp run db:local:start (chapter 05), set DYNAMODB_ENDPOINT and NOTES_STORE=dynamodb, and run the conditions of api/test/room-store.test.ts against DynamoDbRoomStore. Or deploy, and join, remove and close with two users.

### 51-chime-idempotency

Chapter 51: what CreateMeeting returns for a repeated ClientRequestToken, and CreateAttendee for a repeated ExternalUserId, could not be read from the API reference. The code relies on neither.

To resume: After deploying, call aws chime-sdk-meetings create-meeting twice with the same --client-request-token and compare the MeetingId. Call create-attendee twice with the same --external-user-id and compare AttendeeId and JoinToken. Then delete-meeting.

### ecr-lifecycle-not-previewed

The lifecycle policy was never evaluated by ECR. The evaluator in src/lifecycle.ts is written from the documented evaluation rules and six worked examples; it reproduces the examples, which does not make it ECR's implementation. The boundary of "older than N days", the order of images pushed at the same instant, manifest lists and reference artifacts are not implemented or not confirmed.

To resume: After vp run ecr:infra:deploy, push a few dozen images, tagged and untagged, and run vp run ecr:lifecycle:compare. It reports whether start-lifecycle-policy-preview and the evaluator agree, digest by digest and rule by rule. On a difference, fix src/lifecycle.ts and add that input to test/lifecycle.test.ts.

### ecr-nothing-pushed

No image was built or pushed. Not confirmed: that the immutable repository refuses a second push of a tag, that a second tag can be added to the same digest, whether a tag can be reused after its image is deleted, that docker push succeeds with the push role's permissions, and the real size of an image.

To resume: With a Docker daemon, build an image with chapter 12's vp run ecs:image:build <tag> and push it to AihEcr's RepositoryUri following chapter 12's deploy page. Check that pushing another image under the same tag fails with ImageTagAlreadyExistsException, read imageSizeInBytes from aws ecr describe-images, and push from GitHub Actions with the push role.

### ecr-scan-not-observed

No scan result was observed. Not confirmed: that scan on push runs, the shape of findingSeverityCounts when there are no findings (an empty object or absent), how long a scan takes, and whether chapter 12's image (node:24-bookworm-slim) is an operating system basic scanning supports.

To resume: After pushing an image, run vp run ecr:scan:gate --digest <digest>. If the schema refuses the response, fix src/scan.ts to the shape that came back.

### ecr-cache-not-deployed

The pull-through cache rule was not deployed. Not confirmed: that cdkd 0.296.28 creates AWS::ECR::PullThroughCacheRule through the Cloud Control API, that the first pull through the cache creates the repository, and that the push role's permissions are enough for it.

To resume: Deploy with vp run ecr:infra:deploy -c pullThroughCache=on -c githubRepository=<owner/repo>, then docker pull <registry>/ecr-public/docker/library/node:24-bookworm-slim. Check that ecr-public/docker/library/node appears in aws ecr describe-repositories. Delete that repository by hand when cleaning up.

### ecr-ecs-rollback-digest

The documentation says ECS resolves tags to digests per deployment. Whether a circuit breaker rollback reuses the digests of the earlier deployment or resolves the tag again was not confirmed.

To resume: Read the ECS documentation on service revisions to see whether the revision rolled back to carries digests. On a mutable repository, move a tag, force a rollback, and read imageDigest from aws ecs describe-tasks.

### 53-deploy

The chapter 53 stack has never been deployed. Unverified: that cdkd 0.296.28's EFS provider creates the file system, mount targets, and access point; that the function finds the mount targets at creation; that a file system policy made only of a Deny statement is accepted; that Lambda can mount under it (the statement that Lambda mounts over TLS was found only in an official blog post from 2020); and that the access point's root directory is created on first mount.

To resume: After `vp run net:infra:deploy`, run `vp run efs:infra:deploy`. Send a POST and a GET to the `ApiUrl` output, check the settings with `aws efs describe-file-system-policy` and `aws efs describe-mount-targets`, and run `vp run efs:infra:drift`. If the mount fails, read the error the invocation returns and the function's log, and remove the Deny from the policy to narrow it down. Then `vp run efs:infra:destroy`.

### 53-nfs-behaviour

No behaviour was observed on NFS. Every test ran on a local file system (APFS on macOS). How late a renamed file or a directory listing appears to another execution environment (client attribute caching), which mount options Lambda uses, and how concurrent appends actually break were read from documentation and manual pages only.

To resume: Give the deployed function a concurrency of two or more, repeat a write in one environment followed at once by a read in another, and record how often and for how long the old content comes back. Mount the same access point on an EC2 instance, read the options from `mount`, and run `examples/53-efs/test/two-writers.test.ts` with `TMPDIR` set to that mount.

### 53-metering

Elastic throughput metering was not checked against a bill. The arithmetic reads the guide's sentence, that data operations are metered in 1 KiB increments after the first 32 KiB, as: one read or write of up to 32 KiB is metered as 32 KiB. Metadata operations were not counted.

To resume: After deploying, send a fixed number of writes and lists, then compare CloudWatch's `MeteredIOBytes` and the next day's Cost Explorer usage type `APN1-ETDataAccess-Bytes`, with this chapter's assumptions.

### 53-s3-files

Only the overview page of Amazon S3 Files was read. Its price, availability in Tokyo, the delay of synchronization with the bucket, and support in CloudFormation and cdkd were not checked.

To resume: Read the S3 Files chapters of the S3 user guide (synchronization, metering, quotas) and the S3 pricing page, and look for its SKUs in the AmazonS3 offer of the Price List.

### kinesis-mapping-on-aws

Chapter 54: the event source mapping's behaviour was checked only against a model built from the documentation. Not confirmed on AWS: that with partial batch responses and bisecting both on only the one failing record is given up on, how retries are counted for the halves of a split batch, that the failure record reaches SQS in the documented shape, and that the IteratorAge metric keeps growing while the mapping is stuck.

To resume: After vp run kinesis:infra:deploy, write revisions with vp run kinesis:put and check with vp run kinesis:history. Then put one record that is not JSON with vp run kinesis:put -- --poison, and run vp run kinesis:put -- --from 6 --count 3. If, a few minutes later, vp run kinesis:failures shows a range of one record and vp run kinesis:history shows version 8, the service behaves as the model does. The number of `poison record` lines in the function's log is the number of attempts.

### kinesis-reshard-and-lambda

Chapter 54: whether a Lambda event source mapping finishes a parent shard before reading its children after a split or merge could not be confirmed from the Lambda documentation that was read. The Kinesis guide asks a reader to exhaust the parent first, and the chapter's model does.

To resume: While writing revisions of one note to the deployed stream, run `aws kinesis update-shard-count --target-shard-count 2 --scaling-type UNIFORM_SCALING` and watch whether vp run kinesis:history keeps showing missing 0. If not, read the order per shard from the function's log. Two shards cost twice as much, so set it back to 1 afterwards.

### kinesis-idle-bill

Chapter 54: of the idle month's cost, the KMS requests (about 105,120 a month) are the Kinesis guide's estimate taken as is. Whether that many are billed for the AWS managed key, and at the same rate while the function is not running, was not checked on a bill.

To resume: Deploy, leave it for a few days, and look at `APN1-Storage-ShardHour` and `ap-northeast-1-KMS-Requests` in Cost Explorer grouped by usage type.

### kinesis-alarm-topic

Chapter 54: not confirmed on AWS that the chapter's three alarms can publish to chapter 19's topic when it is passed with `-c alarmTopicArn`.

To resume: After vp run kinesis:infra:deploy -c alarmTopicArn=<chapter 19's AlarmTopicArn>, set an alarm to ALARM with `aws cloudwatch set-alarm-state` and see whether the notice arrives.

### grafana-workspace-never-created

No Amazon Managed Grafana workspace was ever created. Not confirmed: that cdkd 0.296.28 can create AWS::Grafana::Workspace through Cloud Control API and read its Endpoint and Id attributes into outputs, what happens when AWS_SSO is given in an account without IAM Identity Center, and that a workspace with SAML and no SamlConfiguration is accepted.

To resume: In an account with IAM Identity Center enabled, run vp run grafana:infra:deploy -c authentication=AWS_SSO and check the WorkspaceId and WorkspaceEndpoint outputs. Assign yourself in the console's Authentication tab, make yourself Admin, and sign in. Finish with vp run grafana:infra:destroy.

### grafana-dashboard-never-loaded

The generated dashboard JSON was never loaded by a real Grafana. This chapter's schema is not Grafana's validation. In particular it is not confirmed that a version 13 workspace accepts and draws JSON with schemaVersion 41, that the expression query (a sum over hidden parts) becomes a line, that jsonData.authType: default uses the workspace role, and that the role's two actions are enough to draw the panels.

To resume: Deploy the stacks of chapters 19 and 55, run vp run obs:smoke and then vp run grafana:push. Open the Notes API dashboard in the workspace and compare its seven panels with the CloudWatch dashboard. If a permission error appears, add the missing action to WORKSPACE_ACTIONS in infra/lib/grafana-stack.ts and adjust the test.

### grafana-live-body-equality

Not confirmed: that the body aws cloudwatch get-dashboard returns equals, as JSON, what the CDK wrote. The agreement check in scripts/push.ts assumes it does. Whether the WorkspaceEndpoint output carries a scheme is also unconfirmed (the code accepts both).

To resume: Run vp run grafana:push. If the agreement check stops it, compare the returned body with the output of vp run grafana:render --cloudwatch, and exclude from the comparison in src/cloudwatch.ts whatever CloudWatch added.

### grafana-billing-details

Of the bill, these could not be confirmed: proration for a workspace created and deleted mid-month, how the one-license minimum is treated during the free trial, whether GetMetricData has a free allowance, and how many metrics one reload of the dashboard actually requests.

To resume: After a workspace has existed for a month, look at Cost Explorer by usage type (APN1-Grafana:EditorUser, APN1-CW:GMD-Metrics) and compare with grafana-idle and grafana-small in reference/pricing.

### 56-live-model

Chapter 56 has never called real Bedrock. Unconfirmed: that jp.amazon.nova-2-lite-v1:0 can read an image passed by S3 URI; that a real Converse response has the shape of the fixtures; that one image shows up as 230 tokens in usage; what the model answers when it declines an image (stopReason content_filtered, or something else). Whether the image can be read when the bucket is in a different Region from where the inference runs (Osaka, with the jp. profile) could not be confirmed from the documentation either.

To resume: Run vp run nova:hello with the path of an image (billed). Then run vp run nova:infra:deploy and vp run nova:smoke. If the response differs, fix fixtures/converse and src/describe.ts.

### 56-catalog-against-account

src/catalog.ts was written from the model cards and the lifecycle pages as read on 2026-10-13, not from an answer by an account. Nova Micro is marked Geo for Tokyo in its card's table, but the only profile IDs listed are us. and eu., so no ID for calling it from Tokyo is confirmed. Whether Nova 2.0 Pro, Nova 2.0 Omni and Nova 2.5 Sonic, which have rows only in the Price List, can be called is unconfirmed too.

To resume: Run vp run nova:models and correct src/catalog.ts from the profiles and models it lists. The tests in test/catalog.test.ts fail until they match.

### 56-deployed-stack

The chapter 56 stack has not been deployed. Unconfirmed: that S3 conditional writes (If-None-Match and If-Match) pass with this chapter's role; that simultaneous requests create only one claim; what requestContext.authorizer.iam.userId holds in the function URL event for an assumed role; how many S3 requests Bedrock makes to fetch the image, and who is billed for them.

To resume: Run vp run nova:infra:deploy, vp run nova:smoke, vp run nova:infra:drift, vp run nova:empty --yes and vp run nova:infra:destroy, in that order.

### polly-never-called

Polly was never called. Unconfirmed: how the voices sound, how long a synthesis takes, the size and bitrate of the MP3 that comes back, the value of x-amzn-RequestCharacters, how an escaped character such as &amp; or a line break is counted, and how a Japanese voice reads English words.

To resume: After vp run polly:infra:deploy, run vp run polly:listen (billed). Compare the first call's billedCharacters with the length of the text sent, confirm the second is 0, and record the audio's Content-Type, size and the time taken. Try a text with & and line breaks too, and bring what you learn about counting into the comment on billedSize in src/ssml.ts and into the page.

### polly-conditional-writes-on-s3

The conditional writes were not tried against S3. That only one of several simultaneous PutObject calls with If-None-Match or If-Match succeeds, the shape of the errors the losers get (412 and 409), and whether the SDK retries a 409 by itself, are written from the documentation and the SDK's types.

To resume: After deploying, run vp run polly:listen from two terminals at once with the same new text, and check in the function's log that the two together synthesized once and that one of them waited. If an error name other than a 412 or a 409 shows up in the log, fix refused in src/s3-audio-cache.ts.

### polly-iam-resource

polly:SynthesizeSpeech is allowed on Resource "*". Polly's only resource type is the lexicon, and it could not be confirmed which ARN a request that uses no lexicon is evaluated against.

To resume: After deploying, change the Resource in the role's policy to arn:aws:polly:ap-northeast-1:<account>:lexicon/* and run vp run polly:listen to see whether it is denied. If it is allowed, change the stack and its test to that ARN.

### polly-player-in-a-browser

src/player.ts was not run in a browser. It was tested against a stand-in for the audio element only; that an audio element plays the presigned URLs, and how the joins between parts sound, are unconfirmed.

To resume: Add a button to the note view of chapter 06's web app that calls requestSpeech and playInOrder(urls, (url) => new Audio(url)). Listen to the joins with a note long enough to become two or more parts.

### 58-aws

The chapter 58 stack has never run on AWS. Unconfirmed: that the real DynamoDB answers a duplicate PartiQL INSERT with DuplicateItemException (DynamoDB Local 3.3.1 used the name DuplicateItem), that a role with only dynamodb:PartiQLInsert and dynamodb:Query can append and cannot overwrite, the units a PartiQL INSERT is billed in, that PutObject into a bucket with only a default retention needs just s3:PutObject and comes out locked, that the checksum the SDK adds satisfies PutObject under Object Lock, the 412 for If-None-Match, the shape of the ListObjectVersions answer, the 403 for deleting a locked version, lifting governance mode, the error name GetObjectRetention gives for a version with no lock, the price of the hourly rule, that cdkd can really create the bucket with Object Lock, the rule and the Lambda permission, and that cdkd destroy leaves the retained bucket. The QLDB developer guide answered 404, so what QLDB offered rests on two AWS blog posts only.

To resume: Run `vp run ledger:infra:diff`, `vp run ledger:infra:deploy`, `vp run ledger:append` twice, `vp run ledger:digest`, then `vp run ledger:verify`. The function's logs are in the log group named by the `DigestLogGroupName` output. Note the `DigestBucketName` output, then run `vp run ledger:infra:destroy`. Once the retention period (one day by default) is over, delete the bucket with `vp run ledger:purge --bucket <name> --apply`.

### rds59-never-deployed

The chapter 59 stack has never been deployed. Unconfirmed: that cdkd 0.296.28 creates AWS::RDS::DBInstance with ManageMasterUserPassword and resolves MasterUserSecret.SecretArn, DbiResourceId and Endpoint.Address; that AWS::RDS::DBParameterGroup can be created through Cloud Control API; that RDS writes into the log group /aws/rds/instance/aih-notes/postgresql created beforehand; that PostgreSQL 18.3 can still be chosen for a new instance; that a db.t4g.micro has enough memory for IAM database authentication; what Database Insights is set to by default; and that cdkd resolves Fn::ImportValue from the chapter 11 stack.

To resume: In a practice account run vp run net:infra:deploy and then vp run rds:infra:deploy. If it stops on the version, list what is offered with aws rds describe-db-engine-versions --engine postgres and pass -c postgresVersion=<version>. Afterwards record what vp run rds:infra:drift says and remove everything with vp run rds:infra:destroy.

### rds59-never-connected

Nothing was ever connected to a real RDS instance. Unconfirmed: that NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem lets the Node.js 24 runtime verify the RDS certificate; that a token from @aws-sdk/rds-signer is accepted through node-postgres's password function; that the JSON of the secret RDS manages has username and password; that notes_admin may grant rds_iam and CREATE on the database and on the public schema; that notes_migrator can run chapter 13's migrations; that the bootstrap, which carries the password in the invocation payload, goes through; and how a dropped connection looks to node-postgres after a failover or a reboot.

To resume: After the deploy run vp run rds:db:bootstrap, rds:db:migrate, rds:db:status and rds:smoke in that order. Check that status reports tls true and role notes_migrator. Run rds:smoke again after aws rds reboot-db-instance --db-instance-identifier aih-notes, and record the function's idle connection lost lines and the answers.

### rds59-replica-not-exercised

The read replica ran only as the local model. The model replays committed statements in order; it is not PostgreSQL streaming replication. Unconfirmed: that the stack deploys with -c readReplica=true (which properties CloudFormation accepts for a same-Region replica); that pg_last_wal_replay_lsn() on the replica returns values comparable with the primary's pg_current_wal_lsn(); that notes_api can sign in to the replica with an IAM token too; and how large the real lag is.

To resume: Run vp run rds:infra:deploy -c readReplica=true, then the bootstrap and the migration. In the output of rds:smoke, see whether the read right after the create came from the primary or the replica. Record ReplicaLag from CloudWatch. The replica is billed by the hour, so destroy the stack afterwards.

### rds59-operations-not-exercised

None of these was run: a Multi-AZ failover, a point-in-time restore, a restore from a snapshot, a minor or a major version upgrade, a blue/green deployment, RDS Proxy, storage autoscaling, and a stop with its automatic start after seven days. The figures in the text (60-120 seconds, under 35 seconds, five minutes, 66% and so on) are the documentation's statements, not this book's measurements. Prices were computed from the price list and stated assumptions; no bill was looked at. Whether a secret that RDS manages is charged, and how the free tier applies, could not be confirmed.

To resume: Deploy with the production profile, repeat rds:smoke during aws rds reboot-db-instance --force-failover, and record for how many seconds it fails. Restore to a new instance with aws rds restore-db-instance-to-point-in-time and see that the endpoint is new and the parameter group is back to the default. After a month, look at the RDS and Secrets Manager lines in Cost Explorer.

### aurora-real-cluster

The chapter 60 stack has never been deployed. Unconfirmed: that a new cluster can be created in Tokyo with engine version 17.9; that cdkd 0.296.28 creates the DBCluster through Cloud Control API, that EnableHttpEndpoint and SecondsUntilAutoPause take effect, and that the MasterUserSecret.SecretArn output resolves; that the Data API reaches a cluster whose security group has no inbound rule; that the secret Aurora manages works as the Data API's secretArn; that SQL with $1 rewritten to :p1 and the CASTs are accepted; that rows of UPDATE ... RETURNING come back in records with labels in columnMetadata; whether a call to a paused instance fails with DatabaseResumingException or waits and succeeds; that the instance really pauses after 300 seconds, and how long a resume takes.

To resume: In a practice account, with the chapter 11 VPC deployed, run vp run aurora:infra:deploy, aurora:db:schema, and aurora:smoke in that order. Wait about ten minutes, check that ServerlessDatabaseCapacity in CloudWatch reads 0, run aurora:smoke again, and record the retry log and the time taken. Write the results to data/validation.json and remove everything with vp run aurora:infra:destroy.

### aurora-failover-not-exercised

No failover was ever caused. A lost connection is imitated on PGlite's single session by running a statement, issuing ROLLBACK, and throwing. Unconfirmed: the error node-postgres really reports during a failover (SQLSTATE 57P01, or a disconnect with no SQLSTATE); that a session still attached to a demoted writer answers a write with 25006; how long the cluster endpoint's name takes to point at the new writer; which exceptions the Data API throws during a failover.

To resume: Add a second db.serverless instance in another AZ to the deployed cluster (one more CfnDBInstance in the stack; two instances are billed while awake). Run aurora:smoke in a loop while running aws rds failover-db-cluster --db-cluster-identifier <ID>, and record the exceptions seen and that the same key was applied once. Do the same with src/pg.ts from inside the VPC, and record each error's code.

### aurora-concurrent-same-key

Two requests with the same key running at once in separate sessions were not run on a real PostgreSQL. PGlite has one session, so the test only scripts the answer 'INSERT ... ON CONFLICT DO NOTHING returned no row'.

To resume: Open two connections to a PostgreSQL server (the deployed Aurora will do) and run appendToNote at the same time with the same owner and key. Check that one waits on the row lock, starts over after the other commits, and returns the stored result.

### sqs-fifo-on-aws

Chapter 61: not confirmed on AWS that cdkd 0.296.28 creates the two FIFO queues with their fixed names, or that a FIFO queue's deduplication (five minutes) and message group order, and maximum concurrency and partial batch responses on an event source mapping for a FIFO queue, behave as the model and the documentation say.

To resume: After vp run sqs:infra:deploy, run vp run sqs:send and vp run sqs:status. A note with the title Shopping, the lines milk and eggs, and three commands applied is the expected result. With two lines of milk check the deduplication ID, and with a wrong order the message group ID, in the worker's log group (output WorkerLogGroupName).

### sqs-park-and-redrive

Chapter 61: not confirmed on AWS that the worker can send an unreadable message straight to the FIFO dead-letter queue with SendMessage, or that such a message can be moved back with StartMessageMoveTask and a DestinationArn. What happens to a message SQS did not move itself when DestinationArn is left out was not confirmed either.

To resume: After vp run sqs:send --poison, check with vp run sqs:status that the dead-letter queue holds one message marked "parked by the worker". Run vp run sqs:status --redrive and watch the move task's state, and that the message is set aside again once it is back.

### sqs-batch-mates

Chapter 61: that messages handed over in the same batch as a message that keeps failing have their receive counts go up with it and move to the dead-letter queue. This is derived from two documented rules (the receive count is per message; a message past maxReceiveCount is moved) and reproduced in the model only. How many messages Lambda's poller receives at a time is not documented.

To resume: Deploy with the worker's park temporarily replaced by one that throws, and send an unreadable message followed by two good commands for the same note. About five minutes later, check with vp run sqs:status whether the dead-letter queue holds three messages or one.

### sqs-ledger-on-dynamodb

Chapter 61: the transaction of the DynamoDB ledger (the update expression with list_append and if_not_exists, the size condition, the order of CancellationReasons) was run against neither DynamoDB nor DynamoDB Local. DynamoDB Local needs Docker, which the Nix shell lacks. That TTL removes the markers was not confirmed either.

To resume: After vp run sqs:infra:deploy, run vp run sqs:send twice (command IDs differ each time, so lines are added). Check that the worker's log has no ValidationException and that the applied count in vp run sqs:status goes up. To resend the same command after five minutes, fix the command ID in scripts/send.ts.

### sqs-empty-receives

Chapter 61: how often Lambda reads an empty FIFO queue. The cost estimate assumes five long polls of 20 seconds at all times (657,000 a month); the official documentation gives no count. The worker's run time (assumed 100 ms) was not measured either.

To resume: Deploy, wait a day, and read the sum of NumberOfEmptyReceives for the command queue in CloudWatch. Multiply by 30.4, compare with 657,000, and correct the quantities of sqs-idle and sqs-small in data/fragments/61.json.

### sqs-cross-account-and-alarms

Chapter 61: not confirmed on AWS that another account can send under the queue policy added by senderAccountId, or that the two alarms notify the topic given as alarmTopicArn. Only the template's shape was asserted.

To resume: Deploy with vp run sqs:infra:deploy -c alarmTopicArn=<chapter 19's AlarmTopicArn>, put one message in the dead-letter queue with vp run sqs:send --poison, and wait for the notification. Check the send from another account with -c senderAccountId=<ID> when a second account is at hand.

### ci-runners-end-to-end

Chapter 62's design has never run. Receiving a delivery from a GitHub App, creating a JIT configuration, a Fargate task registering as the runner, running one job and going away: none of it was observed.

To resume: Deploy chapter 11's VPC, then run runners:infra:deploy with -c repositories and -c appClientId. Create a GitHub App, set the webhook URL and secret, and put its private key into the AppPrivateKey secret. Put workflows/ci.yml into .github/workflows/ of a private practice repository, push, and check the ECS task, the list of runners and the job's log. Destroy afterwards.

### ci-runners-jit-config-size

The length of encoded_jit_config was not confirmed. RunTask allows 8,192 characters for all overrides; a longer configuration cannot be passed the way this chapter passes it (as container arguments).

To resume: Call generate-jitconfig for real and count the characters of encoded_jit_config. launcher.ts fails before calling RunTask when it is too long. If it is, put the configuration in S3 and pass it with environmentFiles (the runner reads ACTIONS_RUNNER_INPUT_JITCONFIG, as seen in CommandSettings.cs of actions/runner v2.338.0), or register a task definition per task.

### ci-runners-runner-labels

Whether a runner registered just in time gets default labels such as self-hosted was not confirmed. The chapter relies on its one custom label only. That the default runner group has ID 1 was read from the API's example only.

To resume: Look at a registered runner with GET /repos/{owner}/{repo}/actions/runners and read its labels. Check the group's ID with the organization's runner groups API and pass -c runnerGroupId if it differs.

### ci-runners-run-lookup

That the workflow run of a workflow_job delivery can be read through the API when the delivery arrives, and that head_repository names the fork for a pull request from a fork, was not observed.

To resume: Open a pull request from a fork of a private repository (with fork workflows enabled) and check that the receiver's log shows reason: fork.

### ci-runners-image-on-fargate

The ghcr.io/actions/actions-runner image was never started on Fargate. The manifest shows an arm64 image, but the pull time, run.sh working in an unprivileged task, and the process exiting (and the task stopping) after the job were not observed.

To resume: After the end-to-end steps, read pullStartedAt, pullStoppedAt, startedAt, stoppedAt and the exit code with aws ecs describe-tasks.

### ci-runners-function-url-policy

That addFunctionUrl in aws-cdk-lib 2.273.0 also grants lambda:InvokeFunction, required since October 2025, was seen in the synthesized template. That cdkd 0.296.28 creates it and that the URL answers was not observed.

To resume: After deploying, send curl -X POST <WebhookUrl> and expect 401 with {"error":"bad_signature"}. On a 403, read the function's resource-based policy.

### ci-runners-other-platforms

CodeBuild-hosted runners, ARC, the scale set client, and GitLab Runner with its fleeting plugin were read about, not run. CodeBuild's start-up time, and how arm1.small compares with a 2 vCPU, 8 GB task, were not checked.

To resume: Follow each one's official tutorial: action-runner.html for CodeBuild; the fleeting plugin's README and the Instance executor page for GitLab.

### agent-sandbox-deploy

Chapter 63's stack was never deployed and its image never built. Not checked: that the task starts, that Claude Code runs with a read-only root and three volumes, and that the bubblewrap sandbox can start inside Fargate at all, even with enableWeakerNestedSandbox. If it cannot, failIfUnavailable keeps Claude Code from starting.

To resume: On a machine with Docker, run sandbox:bundle and sandbox:image:build a1. In an account that is not production, deploy chapter 11's VPC with egress=nat, then sandbox:infra:deploy, sandbox:image:push a1, and sandbox:infra:deploy -c imageTag=a1 -c repositories=<owner/name>. Create the GitHub App secret, start one task with sandbox:launch, and look for the system/init and result lines with sandbox:logs. Destroy afterwards.

### agent-sandbox-bare-settings

Whether claude with --bare reads /etc/claude-code/managed-settings.json could not be confirmed from the documentation, which is why the same file is also passed with --settings. The settings reference says strictAllowlist takes effect from --settings; this was not run.

To resume: Inside the image, run claude --bare -p with and without --settings, and compare whether a curl to a host that is not on the list is refused.

### agent-sandbox-bedrock-permissions

The task role has bedrock:InvokeModel and InvokeModelWithResponseStream only. The IAM policy in Claude Code's documentation also lists ListInferenceProfiles and GetInferenceProfile. The page says Claude Code goes on without checking when profile discovery is unavailable, but that it starts without these two was not checked.

To resume: In a deployed task's log, see whether the startup model check and the first inference succeed. If not, check whether adding these two is what fixes it, and scope GetInferenceProfile to the profile's ARN if it is added.

### agent-sandbox-token-metrics

The day's spend estimate sums the AWS/Bedrock token metrics with no dimension. Whether InputTokenCount includes cached tokens, what ModelId holds for a call through an inference profile, and how late the metrics arrive could not be confirmed from the documentation.

To resume: After one task, compare the sums of the four CloudWatch metrics with the usage in the log's result line and with the next day's Bedrock amount in Cost Explorer.

### agent-sandbox-overrides-visibility

The Git token is handed over in RunTask's environment overrides. That DescribeTasks returns the overrides is read from the response shape in the API reference; whether CloudTrail's RunTask event keeps the values was not checked.

To resume: Start one task and read requestParameters of the RunTask event in CloudTrail. If the value is there, consider a per-task secret instead.

### agent-sandbox-network-firewall

The Network Firewall allowlist exists only as a printed rule source; it is not in the stack, because the firewall's subnets and the route changes belong to chapter 11's stack.

To resume: Give chapter 11's stack a mode that adds the firewall subnets, the firewall, and routes from the private subnets to the firewall endpoint, and put the output of sandbox:plan into a rule group.

### 64-image

The chapter 64 container image was never built (the Nix shell has no Docker daemon). The Linux arm64 workerd was downloaded and its digest checked, but it was not run. Unverified: that it starts on `debian:bookworm-slim`, that user `nobody` can listen on port 8080, that it receives SIGTERM as PID 1, and how large the image is.

To resume: With a Docker daemon, run `vp run isolates:fetch`, `vp run isolates:bundle`, and `vp run isolates:image:build v1`, start it with `docker run --rm --read-only -p 8080:8080 -e ALLOWED_ORIGIN=http://localhost:5173 aih-isolates:v1`, and call `/health`. Use `docker stop` to see the exit code and how long it takes.

### 64-deploy

The chapter 64 stack has never been deployed. Unverified: that workerd starts on Fargate, that it runs with `readonlyRootFilesystem` (only checked on macOS, where it started with file writes denied), that the health check passes, that no request is lost while tasks are replaced, and that log lines reach CloudWatch Logs one by one.

To resume: Run `vp run net:infra:deploy` and `vp run isolates:infra:deploy` to create the repository, push the image, then `vp run isolates:infra:deploy -c imageTag=<tag>`, `vp run isolates:smoke`, and `vp run isolates:infra:drift`. If the task does not start, read its logs and stopped reason, and remove `readonlyRootFilesystem` to narrow it down. Delete with `vp run isolates:infra:destroy` and then `vp run net:infra:destroy` (hourly charges, about USD 1.24 a day).

### 64-linux-behaviour

That a CPU loop is not cut off, that a worker in the same process waits, and the behaviour on SIGTERM were observed only on workerd 1.20261012.1 for macOS (arm64). Not confirmed: that Linux behaves the same, and how long it waits for a request in flight (whether there is a bound). No memory limit was tried (only read: the configuration schema has no such field, and the server source has an enforcer that enforces no limits).

To resume: Run `vp run isolates:observe` on a Linux machine or in a container and compare the output. For the bound, hold a request in flight for longer than `stopTimeout`.

### 64-install-script

The `workerd` npm package has a postinstall script, which pnpm 10 does not run without approval. Every `vp install` prints "Ignored build scripts: workerd". Without the script the chapter's code still finds the binary in the per-platform package. `pnpm-workspace.yaml` is a shared file and was not changed from this chapter.

To resume: Add `workerd` to `ignoredBuiltDependencies` in `pnpm-workspace.yaml` (the script is not needed, for the same reason as esbuild's).

### 66-nothing-on-aws

The chapter 66 stack was never deployed. YugabyteDB was never started on EC2.

To resume: Deploy the chapter 11 network with three zones, run `vp run distsql:infra:deploy -c nodes=3`, then, in the order of the deploy page, `distsql:artifact`, `distsql:install`, `distsql:certs`, `distsql:configure`, `distsql:start`, `distsql:health`. Finish with `distsql:infra:destroy` and delete the volumes.

### 66-linux-archive

The archive for the nodes (el8-aarch64) was neither downloaded nor run. That it runs on Amazon Linux 2023 (arm64) on a t4g.medium, that post_install.sh succeeds, and that the systemd units and user data scripts work on a real machine are unconfirmed.

To resume: Fetch it with `vp run distsql:fetch --nodes` to check the SHA-256, then run `vp run distsql:install` and `vp run distsql:status` on deployed nodes.

### 66-operations-not-exercised

The rolling upgrade, the replacement of a dead node (adding a master and a tablet server at a new address and removing the old ones), and snapshot-based backups are copied from the documentation and were not run, locally or anywhere.

To resume: On the local cluster, start a fourth node on other ports and run the documented `change_master_config` and `change_blacklist` steps. For the upgrade, fetch the previous v2025.2 patch release and follow the same page.

### 66-start-tservers-page

The documentation's "Start YB-TServers" page could not be read (the fetch tool returned another page's content). The yb-tserver flags were confirmed from --helpfull of the pinned binary and from the fact that the local cluster started with them.

To resume: Open https://docs.yugabyte.com/stable/deploy/manual-deployment/start-tservers/ in a browser and compare it with the flags in `src/topology.ts` and with the placement step after start (`yb-admin modify_placement_info`).

### 66-openssl-not-in-nix

`distsql:local:certs` and `distsql:certs` use the openssl on PATH. The Nix devShell does not provide one (Homebrew's 3.6.1 was used here).

To resume: Decide whether to add openssl to the flake's devShell. If not, check that the same arguments work with the /usr/bin/openssl (LibreSSL) that macOS ships.

### 66-deadlock-and-rotation

A deadlock (SQLSTATE 40P01) was not produced on the real cluster. Chapter 13's retry loop retries 40001 only. No certificate rotation procedure for manual deployments was found in the documentation.

To resume: Make two transactions update two rows in opposite orders to observe 40P01, and decide whether to add it to the retry predicate. For certificates, reissue under the same CA, replace and restart one node at a time on the local cluster, and see whether connections hold.

### 66-transfer-not-measured

The cross-zone transfer is computed from an assumed 2,000 bytes per write, not measured. Whether three t4g.medium carry 10 writes and 90 reads a second was not measured either.

To resume: Put load on a deployed cluster and read each node's NetworkOut in CloudWatch and DataTransfer-Regional-Bytes in Cost Explorer.

### 67-firecracker-not-run

Firecracker was never started. That the client talks to the real v1.17.0, that this book's fake server refuses what the real one refuses, the scripts in deploy/, Node.js and the server inside the guest, boot times and snapshots are unconfirmed.

To resume: On a machine with Linux and KVM, place dist/kit from vp run firecracker:kit:build and run in order: bash deploy/prepare.sh, sudo bash deploy/tap.sh up, sudo work/firecracker --api-sock /tmp/firecracker.socket, and in another terminal sudo work/node/bin/node boot.mjs. Compare the status and fault_message of any refused request with the rules in test/support/fake-firecracker.ts and correct them, and record the three durations printed. Then try --snapshot.

### 67-nested-virtualization

That /dev/kvm appears on a c7i.large with nested virtualization enabled, and that Firecracker runs there, is unconfirmed. The Firecracker project tests only .metal, and its quickstart says EC2 supports KVM only on .metal (which disagrees with the EC2 guide).

To resume: After vp run net:infra:deploy, vp run firecracker:infra:deploy -c run=true and vp run firecracker:kit:publish, enter through Session Manager and record from the output of ls -l /dev/kvm onward. If it does not work, change instanceType or compare with a .metal instance. Finish with firecracker:kit:empty and firecracker:infra:destroy.

### 67-cdkd-cloud-control

Whether cdkd 0.296.28 can create AWS::EC2::LaunchTemplate, and an AWS::EC2::Instance that uses the LaunchTemplate property, through the Cloud Control API is unconfirmed. That the former has no provider of its own, and that LaunchTemplate is not in the list of properties the latter's provider writes, was checked in the installed package.

To resume: Read the plan with vp run firecracker:infra:diff -c run=true, deploy, and confirm with aws ec2 describe-instances that the instance's CPU options carry nested virtualization.

### 67-imds-from-guest

That a guest cannot reach the instance metadata, given the hop limit of 1 and the rule in tap.sh, is unconfirmed.

To resume: Enter the guest by SSH and check that curl -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' gets no answer. Try it without the rule of tap.sh as well, and record which of the two is effective.

### 67-fargate-whitepaper

The whitepaper Security Overview of AWS Fargate could not be read (d1.awsstatic.com answered 403). Whether every Fargate task today runs on Firecracker cannot be confirmed from the pages read.

To resume: Open the whitepaper in a browser from the link on the Fargate security pages of the ECS developer guide, read what it says about Firecracker and EC2 instances and its revision date, and correct section 67.aws and the sources.

### 67-node-in-ci-rootfs

Whether the official Node.js binary runs in the root file system of Firecracker's CI (Ubuntu) is an expectation from its package list, and unconfirmed.

To resume: After prepare.sh, run sudo chroot work/squashfs-root /opt/node/bin/node --version. If it fails, find the missing libraries with ldd and add an apt step to prepare.sh.

### 68-deploy

The chapter 68 stack has never been deployed. The installed cdkd 0.296.28 does not wire `EnclaveOptions` in its EC2 provider and routes an instance that sets it through Cloud Control API. Unverified: that this route creates an enclave-enabled instance, that KMS accepts the key policy, and that the listed administrative actions are enough for cdkd to create and delete the key.

To resume: After deploying chapter 11, run `vp run nitro:infra:deploy`, check that `aws ec2 describe-instances --query 'Reservations[].Instances[].EnclaveOptions'` returns `Enabled: true`, and run `vp run nitro:infra:drift`. Then `vp run nitro:infra:destroy` (the instance is billed by the hour).

### 68-enclave

No enclave was ever started. Unverified: that the hello sample runs on a 2-vCPU Graviton instance with the allocator set to 1 vCPU and `--cpu-count 1`, that the default root volume holds the Docker images and the image file, and whether the user guide's parent container can read credentials from IMDSv2 with a hop limit of 1.

To resume: After the deploy, enter with Session Manager and follow the page's steps in order: `dnf install`, the allocator setting, `docker build`, `nitro-cli build-enclave`, `run-enclave --debug-mode`, `console`, `terminate-enclave`.

### 68-attestation

KMS attestation was never exercised. That Decrypt and GenerateDataKey succeed from inside the enclave and are refused from the parent under this chapter's key policy is known only from the documentation and from the book's own evaluator. The part that would turn the TypeScript vault (`src/enclave/vault.ts`) into an enclave image (a vsock listener, the attestation document from the NSM, the call to `kmstool_enclave_cli`) is not in this repository.

To resume: Follow the user guide's "Connect the parent instance with an enclave by using virtio-vsock" and "Connect an enclave with AWS KMS" as written. Pass the PCR0 printed by `nitro-cli build-enclave` with `vp run nitro:infra:deploy -c measurement=<PCR0>`, then check that `kmstool_enclave_cli decrypt` succeeds from an enclave started without debug mode, that `aws kms decrypt` on the parent is denied, and what CloudTrail records under `additionalEventData.recipient`.

### 68-lsblk

`lsblk --json --nodeps --output NAME,SERIAL` was not run on an instance. The test input was written by hand from the util-linux 2.40.2 source and was not compared with what Amazon Linux 2023 prints.

To resume: On the chapter 23 instance run `lsblk --json --nodeps --output NAME,SERIAL`, pass the output to `findDevice`, and check that it returns the device of the volume ID that `vp run ec2:status` shows.
