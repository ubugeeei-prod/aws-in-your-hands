---
title: "64 Isolates: Costs, Pitfalls, and Cleanup"
---

# 64 Isolates: Costs, Pitfalls, and Cleanup

This page covers the bill, the places people trip, what to change for production, and cleanup, and ends with the chapter's verification notes.

## Costs

<!-- section: 64.cost -->

The unit prices were read again from the AWS Price List bulk API for the Tokyo Region on 2026-10-13. The amounts are list prices, with no discounts or credits.

Deployed without a tag, the stack is the repository alone. The charge is image storage: USD 0.01 a month if one image is assumed to be 0.1 GB. The image was never built, so its real size is not measured. The workerd binary alone is 139 MB unpacked and 40 MB as the compressed archive.

Deployed with a tag, hourly billing starts. With no requests at all it is USD 37.68 a month (730 hours) and USD 1.24 a day. The month breaks down into USD 7.38 for Fargate vCPU, USD 1.61 for memory, USD 17.74 for the load balancer, and USD 10.95 for three public IPv4 addresses. Two of the addresses belong to the load balancer's nodes and one to the task in a public subnet.

<<< @/examples/64-isolates/src/cost.ts{idle}

With the task in private subnets (`-c taskSubnets=private`), pulling the image and writing logs needs a NAT gateway or interface endpoints. What those cost is in chapter 12's section on costs.

For a comparison under load, the numbers are borrowed from the first example on Cloudflare's pricing page: 15 million requests a month, at 7 ms of CPU time per request.

<<< @/examples/64-isolates/src/cost.ts{load}

- **This chapter's design.** USD 39.02. The load balancer's LCUs add about USD 1.33 to the idle bill. The task costs the same busy or idle. Averaged over the month, this load is 16% of 0.25 vCPU. Whether one task withstands a burst was neither calculated nor measured
- **Chapter 04's design.** An HTTP API and a 256 MB Lambda function: USD 24.85. That is USD 19.35 for the HTTP API, USD 3.00 for Lambda requests, and USD 2.50 for duration; after the free allowance it is USD 22.15. Lambda bills duration, not CPU time, so one request is assumed to take 50 ms, as in chapter 04's scenario
- **Workers.** USD 8.00, as the arithmetic on Cloudflare's page has it. To USD 5 a month it adds USD 1.50 for the requests beyond 10 million and USD 1.50 for the CPU time beyond 30 million ms

<<< @/examples/64-isolates/src/cost.ts{workers}

The three numbers do not compare like with like. The Workers price includes locations around the world and everything else this chapter gave up. The two on AWS are billed separately for logs and data transfer. Cloudflare's page says there are no additional charges for data transfer. With that said, at a load of this size the bill is not a reason to self-host workerd.

## Pitfalls

<!-- section: 64.pitfalls -->

**A compatibility date in the future.** workerd refuses to start. The message, when it was given a date one day ahead locally, was `Can't set compatibility date in the future`. This chapter's schema accepts no date beyond the one the pinned version knows, so it stops before the configuration file is written.

**A required setting does not arrive.** If the environment variables in the task definition and the `fromEnvironment` names in the configuration disagree, the binding is empty. With `ALLOWED_ORIGIN` empty the app fails to compose, and every request answers 500, health checks included. ECS does not consider the new task healthy, so the old task stays and the circuit breaker rolls the deployment back. Of that chain, the part up to the 500 was checked on the local workerd.

**Notes vanish, or come and go.** Notes live in the memory of the workerd process. They are gone when a deploy replaces the task. With two tasks, which notes you see depends on which task the request reached.

**One request stops everything.** A long loop inside a worker stops every worker in the same process, and the health check. workerd does not cut it off. workerd's log does not tell you which request caused it, because chapter 04's app writes its log line when a request has been handled.

**The image's architecture and glibc.** The task definition is arm64. When you build on an x86-64 machine, make sure `--platform linux/arm64` is there (`isolates:image:build` adds it). Change the base image to Alpine or Amazon Linux 2023 and the glibc 2.35 that workerd asks for is missing. The message that appears then was not checked.

**Where to look.** When the task does not start, read the stopped reason of the stopped task in the ECS console or with `aws ecs describe-tasks`. The lines workerd and the worker wrote are in the log group named by the stack output `TaskLogGroupName`. This chapter has no task like chapter 12's `ecs:logs`.

## For production

<!-- section: 64.production -->

- **Move the state out.** Replace the `Map` in memory with a data store outside the task. Until then you cannot run two or more tasks. Whether the AWS SDK runs on workerd was not checked in this chapter
- **Run two or more tasks, in two Availability Zones.** That comes after the state is outside. Scaling is the subject of [chapter 41](/en/chapters/41-fargate.md)
- **Use HTTPS.** Put a certificate on the load balancer, or CloudFront in front of it. `forwardedProtoHeader` in the configuration is there for that day
- **Keep raising workerd.** V8 security fixes arrive as new versions of workerd. Cloudflare writes that it ships them to its own platform within 24 hours; when you self-host, raising the version, rebuilding the image, and deploying it is your job. Put it on the pipeline from [chapter 20](/en/chapters/20-shipping.md) and do not leave it to hand work
- **Load no code you do not trust.** Only workers that trust each other go into one workerd process. Code on different sides of a trust boundary goes into different tasks
- **Prepare for a runaway.** There is no limit on CPU time per request. Hold down the number of requests at the door (the WAF in [chapter 21](/en/chapters/21-security.md)), and have an alarm tell you when failed health checks replace a task ([chapter 19](/en/chapters/19-observability.md))
- **Move the tasks to private subnets.** Chapter 12's options apply as they are

## Cleanup

<!-- section: 64.cleanup -->

To stop only the hourly billing and keep the images, deploy again without a tag.

```bash
vp run isolates:infra:diff
vp run isolates:infra:deploy
```

Run it after `diff` shows the load balancer, the service, the task definition, and the rest as deletions, and the repository as staying.

To delete everything, run these two in this order. Chapter 11's destroy is refused while a stack that uses the VPC remains.

```bash
vp run isolates:infra:destroy
vp run net:infra:destroy
```

The repository goes together with the images in it. So does the log group. A test checks that no resource is set to be retained.

On your machine, the 139 MB binary in `examples/64-isolates/.workerd/` and the Docker images remain. Delete them if you do not need them.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (5 files, 45 tests). Eleven of them, in `test/workerd.test.ts`, start the real workerd 1.20261012.1 (darwin-arm64) installed from npm, inside the Nix devShell: chapter 04's app answers as its contract says, two workers running the same code in one process share no state, two requests in flight swap a request ID kept in module scope and do not with `AsyncLocalStorage`, bindings arrive from the configuration and from environment variables, and workerd accepts the image's configuration file. The other tests look at the configuration schema and the generated file, the adapter, the pricing arithmetic, and stack assertions. Type check. `isolates:bundle`, `dev:isolates` (`/health`, `POST /notes`, and `GET /notes` with curl), `isolates:observe`, `isolates:fetch`, `isolates:infra:synth` (the default, `-c imageTag=v1`, and `-c imageTag=v1 -c taskSubnets=private`), `isolates:image:build v1 --dry-run`, and `isolates:image:push v1 --dry-run`.

Observed on the local workerd. A 2000 ms CPU loop was not cut off, and `/health` on another worker in the same process waited 1807 ms. On SIGTERM it answered the request in flight with 201 and then exited with code 0, and a new request that arrived meanwhile got no answer in 1500 ms. With nothing in flight it exited within 2 ms, even with an idle connection open. A compatibility date one day ahead was refused at startup. With every file write denied by macOS's `sandbox-exec`, it still started and answered requests.

About the Linux arm64 archive. The SHA-512 of the 39,889,339 bytes downloaded from the npm registry matched the registry's `dist.integrity`. The binary inside is a dynamically linked aarch64 ELF that needs `libc.so.6` and `libm.so.6` and refers to symbols of versions up to `GLIBC_2.35` (read with `file` and `strings`).

**Not checked yet.** Nothing was run against AWS: none of `net:infra:deploy`, `isolates:infra:diff`, `isolates:infra:deploy`, `isolates:image:push`, `isolates:smoke`, `isolates:infra:drift`, `isolates:infra:destroy`. The container image was never built either. So all of the following wait to be confirmed. That the Linux arm64 workerd starts on `debian:bookworm-slim`. That user `nobody` can listen on port 8080. That it receives SIGTERM as PID 1. That it runs on Fargate with `readonlyRootFilesystem`. That the health check passes and no request is lost while tasks are replaced. That log lines reach CloudWatch Logs one by one. The size of the image. That workerd does not start on Amazon Linux 2023 (only read that the requirement is not met; not tried).

The local observations were made on macOS. Whether Linux behaves the same, how long workerd waits for a request in flight, and what happens when memory runs out were not checked.

What primary sources did not settle. No way to load a new configuration or new code into a running workerd without downtime was found in the README or the help text. No document on how SIGTERM is handled was found either. That workerd enforces no limits was concluded from the configuration schema having no such field and from two places in the server's source. The rest of the source was not read. Nothing about Vercel was looked up for this chapter.

About a shared file. pnpm does not run the postinstall script of the `workerd` package, so every `vp install` prints a warning. Adding `workerd` to `ignoredBuiltDependencies` in `pnpm-workspace.yaml` would silence it, but that is a shared file and was not changed from this chapter.

Resource types cdkd handles. In the installed `@go-to-k/cdkd` 0.296.28 package, `AWS::ECR::Repository`, `AWS::ECS::Cluster`, `Service`, `TaskDefinition`, `AWS::ElasticLoadBalancingV2::LoadBalancer`, `Listener`, `TargetGroup`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Logs::LogGroup`, `AWS::EC2::SecurityGroup`, and `SecurityGroupIngress` are registered with providers of their own. `AWS::EC2::SecurityGroupEgress` is not registered and goes through Cloud Control API. The per-property lists are the ones chapter 12 recorded from the same version.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What workerd is | `examples/64-isolates/src/release.ts` | |
| The design on AWS | `examples/64-isolates/infra/lib/isolates-stack.ts`, `infra/bin/app.ts`, `src/config.ts` | `isolates:infra:synth` |
| Making the app a worker | `examples/64-isolates/src/worker.ts`, `src/entry.ts`, `src/bundle.ts`, `test/worker.test.ts` | `isolates:bundle`, `test:unit` |
| A configuration file from types | `examples/64-isolates/src/definition.ts`, `src/capnp.ts`, `src/deployments.ts`, `test/definition.test.ts` | `test:unit` |
| Two workers in one process | `examples/64-isolates/test/workerd.test.ts`, `test/harness.ts`, `src/runtime.ts` | `test:unit` |
| Two requests in one worker | `examples/64-isolates/src/entry-scoped.ts`, `test/workerd.test.ts`, `test/worker.test.ts` | `test:unit` |
| The limits workerd does not enforce | `examples/64-isolates/src/spin.ts`, `scripts/observe.ts` | `isolates:observe` |
| The image and the stack | `examples/64-isolates/src/release.ts`, `scripts/fetch.ts`, `Dockerfile`, `.dockerignore`, `src/image.ts`, `scripts/image.ts`, `infra/lib/isolates-stack.ts`, `infra/test/isolates-stack.test.ts` | `isolates:fetch`, `isolates:image:build`, `isolates:infra:synth`, `test:unit` |
| Chapter 04's app in workerd on your machine | `examples/64-isolates/scripts/serve.ts`, `scripts/bundle.ts`, `scripts/observe.ts`, `test/` | `dev:isolates`, `isolates:bundle`, `isolates:observe`, `test:unit`, `isolates:infra:synth` |
| Deploy and check | `examples/64-isolates/scripts/image.ts`, `scripts/smoke.ts`, `infra/bin/app.ts` | `isolates:fetch`, `isolates:bundle`, `isolates:image:build`, `isolates:image:push`, `isolates:infra:diff`, `isolates:infra:deploy`, `isolates:smoke`, `isolates:infra:drift` |
| Costs | `examples/64-isolates/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `isolates:infra:destroy`, `net:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- workerd (tag v1.20261012.1): [README](https://github.com/cloudflare/workerd/blob/v1.20261012.1/README.md), [workerd.capnp](https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/server/workerd.capnp) (the configuration schema), [server.c++](https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/server/server.c++) (the two places with `NullIsolateLimitEnforcer`), [LICENSE](https://github.com/cloudflare/workerd/blob/v1.20261012.1/LICENSE), [the npm registry](https://registry.npmjs.org/workerd) (version, platforms, digest), and `--help` of the installed binary
- Cloudflare Workers: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/), [Security model](https://developers.cloudflare.com/workers/reference/security-model/), [Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Limits](https://developers.cloudflare.com/workers/platform/limits/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [Compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- AWS: [Architect for AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html) (task isolation), [glibc in Amazon Linux 2023](https://docs.aws.amazon.com/linux/al2023/ug/glibc-gcc-and-binutils.html), [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) (what an LCU is)
- AWS Price List bulk API: [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json), [ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json), [VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json), [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json), [API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json). The unit prices this chapter uses are the SKUs other chapters registered, and their values were confirmed unchanged
- Other runtimes: [supabase/edge-runtime](https://github.com/supabase/edge-runtime) (the README, and the date of the latest release from GitHub's API)
- Pinned package: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the JavaScript in `dist/`)

:::
