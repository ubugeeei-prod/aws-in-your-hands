---
title: "12 Containers: Costs, Pitfalls, and Cleanup"
---

# 12 Containers: Costs, Pitfalls, and Cleanup

## What it costs

<!-- section: 12.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax, with a month of 730 hours. The arithmetic is in the [pricing worksheet](/en/reference/pricing.md).

First, what it costs just to exist, in the default layout.

| Item | Quantity | Unit price | Per month |
| --- | --- | --- | --- |
| Fargate vCPU (arm64) | 2 tasks × 0.25 vCPU × 730 hours | 0.04045 per vCPU-hour | 14.76 |
| Fargate memory (arm64) | 2 tasks × 0.5 GB × 730 hours | 0.00442 per GB-hour | 3.23 |
| ALB | 730 hours | 0.0243 per hour | 17.74 |
| Public IPv4 addresses | (2 for the ALB + 2 tasks) × 730 hours | 0.005 per hour | 14.60 |
| Subtotal | | | **50.33** |

One day is USD 1.65. On top comes the storage of the images in the repository (USD 0.10 per GB a month; USD 0.01 assuming one image of 0.1 GB).

Three things to read from the table.

**Doing nothing costs about 25 times the Lambda chapter.** Chapter 04 came to USD 2.02 for a million requests a month. This is USD 50.33 for zero requests. If you choose containers, you need a reason worth that fixed cost.

**Public IPv4 addresses cost about as much as Fargate.** Four of them are USD 14.60 a month. The load balancer has a node per zone, and each uses one. The tasks' share goes away if you move them to private subnets, but then the charge for a NAT gateway or endpoints comes in its place.

**arm64 is a fifth cheaper.** One task of the same size is USD 9.00 a month on arm64 and USD 11.25 on x86.

When it is called, it looks like this. The assumption: a million requests a month, with the service staying at two tasks.

| Item | Quantity | List price |
| --- | --- | --- |
| Just existing (the table above, and the image) | | 50.34 |
| ALB LCUs | 11.1 LCU-hours | 0.09 |
| CloudWatch Logs ingestion | 0.191 GB | 0.15 |
| CloudWatch Logs storage | 0.045 GB-month | 0.00 |
| Data transfer out to the internet | 0.477 GB | 0.05 |
| Subtotal | | **50.63** |

After the monthly CloudWatch Logs allowance (5 GB) it is USD 50.48. A million more requests add USD 0.29. Nearly all of it is the fixed part.

An LCU is the unit a load balancer bills its work in. Of new connections, concurrent connections, bytes passed, and rule evaluations, the largest one counts. Here I assumed one connection per request and computed with new connections. What the LCU usage is with no requests (whether health checks count) I could not confirm, so the first table doesn't include it. That means not included, not zero.

Changing where the tasks live gives this.

| Layout | This chapter's stack | Chapter 11's side | Total |
| --- | --- | --- | --- |
| Default (public subnets) | 50.33 | 0 | 50.34 |
| `-c taskSubnets=private` and one NAT gateway | 43.03 | 48.91 | 92.07 |
| `-c taskSubnets=private` and three interface endpoints | 43.03 | 61.32 | 104.37 |

The totals include image storage (USD 0.01) and assumed data volumes: 2 GB a month through the NAT gateway, 1 GB a month through the endpoints.

About free allowances. I found no free allowance on the Fargate pricing page. The ALB and ECR pages describe allowances for new customers, but they don't apply to every account, so nothing is deducted.

Redeploy without a tag, leaving only the repository, and the hourly charges stop. What remains is image storage.

How the hourly items are counted is in code.

<<< @/examples/12-containers/src/cost.ts{billable}

The tests check that the hours this function produces match the scenarios in the pricing data, and that the amounts written here match what the calculator returns.

## If you come from Cloudflare

<!-- section: 12.cloudflare -->

Cloudflare has Containers too. Here are the differences as far as I read the documentation. (I have not used it to check.)

| | Cloudflare Containers | This chapter (ECS on Fargate and an ALB) |
| --- | --- | --- |
| Entry point | A Worker. A container is reached only through a Durable Object | The ALB, which routes HTTP straight to tasks |
| Starting | When a request arrives or when Worker code starts it. Sleeps when unused | The service keeps the number you set running, always |
| Pricing | Only while running, in 10 ms steps. The Workers Paid plan includes some usage | For the time it exists, used or not |
| How many | Decided by Worker code. Built-in autoscaling for stateless apps is not available today | Can be left to target tracking |
| Replacing | Two steps by default, 10% then 100%. Stopping sends SIGTERM, then SIGKILL after 15 minutes | Rolling update. At most 120 seconds after SIGTERM |
| Network | Nothing to design | You decide the VPC, subnets, and security groups |
| Locally | `wrangler dev`, which needs a Docker-compatible CLI and engine | This sample runs directly on Node.js. Only building the image needs Docker |

The biggest difference is the idle time. A Cloudflare container sleeps and the charges stop. In exchange there is a start from the stopped state (a cold start), which the documentation puts at 1 to 3 seconds in many cases. An ECS service doesn't stop, so nobody waits. In exchange you pay for the time it isn't used.

One more. On Cloudflare a Worker and a Durable Object always sit in front of the container, and you write routing and starting as code. On ECS the load balancer and the service settings play that part. Which fits depends on what you're building.

Receiving SIGTERM and finishing the work in flight before stopping is the same on both. So is old and new living together during an update: Cloudflare's documentation also says that new Worker code can reach containers on the previous image. The second half of this chapter carries over as it is.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| `dev:ecs` stops with `Invalid environment` | Does `examples/12-containers/.env` exist? Check the variable named in the message |
| `ecs:image:build` stops with `No Docker daemon answered` | You have the client and no running daemon. Start Docker Desktop or similar |
| The push fails with `ImageTagAlreadyExistsException` | That tag is taken. Tags are immutable, so use a new one |
| The deploy sits at the service for a long time, then fails | The tasks can't start. Read `stoppedReason` with `aws ecs list-tasks --desired-status STOPPED` and `aws ecs describe-tasks`. Often the image can't be fetched (a mistyped tag, or private subnets with no route) |
| The tasks run, but the load balancer's URL returns an error | Check with `aws elbv2 describe-target-health` whether the targets are healthy. Does `/health` answer 200, and does the security group allow port 8080? |
| A 502 comes back now and then | Is the server's keep-alive shorter than the load balancer's idle timeout? Check the relations in `src/timing.ts` |
| A few requests fail on every update | SIGTERM isn't received (is `CMD` written as an array?), or some requests take longer than the deregistration delay |
| A note you created appears and disappears from call to call | There are two tasks, each with its own `Map`. That is how this chapter is built |
| `net:infra:destroy` stops with `StackHasActiveImportsError` | This chapter's stack uses the VPC. Run `ecs:infra:destroy` first |
| You are billed although you use nothing | The service is running. Redeploy without a tag, or destroy |

Apart from the first two rows, these were put together from the documentation, not seen by making them happen.

## Before production

- **Switch to HTTPS.** Get a domain name and a certificate and make the listener port 443. Right now everything is plain text
- **Add authentication and authorization.** As in chapter 04, anyone who knows the URL can call it (chapter 06)
- **Keep data outside the tasks.** Right now it is gone on every update (chapters 05 and 13). At that point the rules from "Old and new run side by side" become real constraints
- **Put the tasks in private subnets.** Whether the way out is a NAT gateway or endpoints is decided with the table in chapter 11
- **Don't write secrets directly into environment variables.** With `secrets` in the task definition they are passed in at start from Secrets Manager or similar. The permission to read them goes on the execution role (for handling secrets, see [chapter 21](/en/chapters/21-security.md); its example is a Lambda function)
- **Stop updates on application metrics too.** The circuit breaker only sees starting and health checks. ECS can also fail a deployment on a CloudWatch alarm (for how to put an alarm together, see [chapter 19](/en/chapters/19-observability.md))
- **Pin the base image by digest.** The tag `node:24-bookworm-slim` keeps getting new contents. If every build should use the same image, name it by digest
- **Use three zones and three or more tasks.** With two, the moment one zone stops you are at half capacity
- **Review the log retention, the load balancer's deletion protection, and the repository's `emptyOnDelete`.** All of them lean toward "easy to delete", for practice
- **Deploy through the AWS CDK CLI and CloudFormation.** cdkd's own documentation says cdkd is for development and testing and recommends the AWS CDK CLI for production (chapter 02)

## Cleaning up

<!-- section: 12.cleanup -->

To stop only the hourly charges and keep the images, redeploy without a tag.

```bash
vp run ecs:infra:diff
vp run ecs:infra:deploy
```

Run it after `diff` shows the load balancer, the service, the task definition and so on as deletions, and the repository as staying.

To remove everything, use these.

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

In this order. While a stack that uses the VPC remains, chapter 11's destroy is refused.

The repository goes together with its images (`emptyOnDelete`). So does the log group. Nothing is left outside the stack, and a test checks that no resource is set to be retained.

In the end, looking for yourself is the sure way.

```bash
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws ecr describe-repositories --region ap-northeast-1
```

If the first shows no load balancer from this chapter and the second no cluster, this chapter's hourly charges have stopped. The third should show only the repository that `cdkd bootstrap` created in chapter 02.

The daemon on your machine keeps the images you built. `docker image rm aih-notes:v1` removes one.

::: details Verification notes for this chapter

**Checked locally.** The test that starts the server as a child process and sends SIGTERM in the middle of a request. The graceful shutdown tests (including that removing `sweep` turns `drained` into `forced` and fails them). The test that runs an old and a new version at the same time. Unit tests for the timing relations, settings, the `docker` command lines, pricing, and the stack assertions. Type checking. `ecs:infra:synth` (without a tag, with `-c imageTag=v1`, with `-c imageTag=v1 -c taskSubnets=private`, and that `-c imageTag=latest` is refused). `ecs:bundle` and `ecs:bundle:check`. `dev:ecs`, started, with the chapter's `curl` commands and the log lines on Ctrl-C. `ecs:image:build`, `ecs:image:run`, and `ecs:image:push` with `--dry-run`, and the message they print without a daemon. `ecs:watch`, pointed at a local server with `--url`. That a synthesis using `ecs.ContainerImage.fromAsset` succeeds with no `docker` command on the PATH (aws-cdk-lib 2.273.0). The `docker` flags were checked against the help of Docker CLI 29.7.2. The amounts in the text are what `tools/src/pricing/calc.ts` computes from Price List unit prices, and `examples/12-containers/test/pricing.test.ts` compares them.

**Not checked yet.** No Docker daemon was running, so the image has never been built. Unverified as a result: that the Dockerfile builds, that the `.dockerignore` exception works, that the image starts on the arm64 base image, that it runs with `--read-only`, and how large the image is (the 0.1 GB in the cost tables is an assumption). `ecs:infra:diff`, `ecs:infra:deploy`, `ecs:image:push`, `ecs:watch`, `ecs:logs`, `ecs:infra:drift`, and `ecs:infra:destroy` have not been run against real AWS. All of the following wait for a real environment. That cdkd 0.296.28 creates and deletes this stack. That the chapter 11 VPC can be read through `Fn::ImportValue` from a stack in another app. That the three types routed through Cloud Control API work. That tasks in public subnets can fetch the image, and that egress on port 443 alone is enough. Both routes for `-c taskSubnets=private`. The load balancer's health checks and fail-open behavior. That no request fails during a rolling update. That SIGTERM arrives after the target has been deregistered. The circuit breaker's rollback, and what cdkd prints then. Auto scaling in both directions. That redeploying without a tag removes only the load balancer and the tasks. The symptoms under "Where it goes wrong".

Not confirmed from a primary source. A load balancer's LCU usage with no requests. Whether the service-linked roles for ECS and Application Auto Scaling are created automatically on the first deploy in an account. Whether redeploying a service that auto scaling has grown sets the number of tasks back to the `desiredCount` of 2. How many public IPv4 addresses a load balancer uses once it adds nodes under load. That `node:24-bookworm-slim` on Docker Hub has an arm64 variant: only the beginning of the API response (the amd64 entry) was read. Cloudflare Containers was only read about.

Resource types and cdkd. In `src/provisioning/register-providers.ts` at the `v0.296.28` tag, dedicated implementations are registered for `AWS::ECS::Cluster`, `TaskDefinition`, and `Service` (the ECS provider), `AWS::ElasticLoadBalancingV2::LoadBalancer`, `TargetGroup`, and `Listener` (the ELBv2 provider), `AWS::ECR::Repository`, `AWS::EC2::SecurityGroup`, `SecurityGroupIngress`, `AWS::IAM::Role`, `Policy`, and `AWS::Logs::LogGroup`. `AWS::ApplicationAutoScaling::ScalableTarget`, `ScalingPolicy`, and `AWS::EC2::SecurityGroupEgress` are not registered and not on the unsupported list, so they go through Cloud Control API. The ECS provider treats a changed task definition as a replacement (a new revision is registered, the old one deregistered); for a service it returns by default once `CreateService` or `UpdateService` is accepted, and waits for stability only with `--full-wait`. The ECR provider deletes a repository together with its images only when `EmptyOnDelete` is true. The npm tarball contains no TypeScript source, so I read the archive of the GitHub tag.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/12-containers/infra/lib/containers-stack.ts`, `src/config.ts` | `ecs:infra:synth` |
| docker is two programs | `examples/12-containers/src/image.ts`, `scripts/image.ts` | `ecs:image:build` |
| From a handler to a server that keeps running | `examples/12-containers/src/compose.ts`, `src/env.ts`, `src/server.ts`, `test/compose.test.ts`, `.env.example` | `dev:ecs`, `test:unit` |
| Decide how you are stopped | `examples/12-containers/src/serve.ts`, `src/server.ts`, `test/shutdown.test.ts` | `test:unit` |
| Build the image | `examples/12-containers/Dockerfile`, `.dockerignore`, `scripts/bundle.ts`, `scripts/check-bundle.ts`, `src/image.ts` | `ecs:bundle`, `ecs:bundle:check`, `ecs:image:build`, `ecs:image:run` |
| Where the image is kept | `examples/12-containers/infra/lib/containers-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `test/config.test.ts` | `ecs:infra:synth`, `ecs:image:push`, `test:unit` |
| Which subnet do the tasks live in? | `examples/12-containers/infra/lib/containers-stack.ts`, `infra/test/containers-stack.test.ts`, `examples/11-network/infra/lib/import-network.ts` | `test:unit`, `net:plan` |
| There are two roles | `examples/12-containers/infra/lib/containers-stack.ts`, `infra/test/containers-stack.test.ts` | `test:unit` |
| The service and the load balancer | `examples/12-containers/infra/lib/containers-stack.ts`, `src/timing.ts`, `test/timing.test.ts` | `test:unit`, `ecs:infra:synth` |
| What happens during an update | `examples/12-containers/infra/lib/containers-stack.ts`, `src/timing.ts`, `scripts/watch.ts`, `src/watch.ts` | `ecs:watch` |
| Old and new run side by side | `examples/12-containers/src/compat.ts`, `test/versions.test.ts` | `test:unit` |
| More tasks, fewer tasks | `examples/12-containers/infra/lib/containers-stack.ts`, `src/config.ts` | `test:unit` |
| Checking things locally | `examples/12-containers/test/`, `infra/test/containers-stack.test.ts`, `scripts/check-bundle.ts` | `test:unit`, `ecs:bundle:check`, `ecs:infra:synth`, `dev:ecs` |
| Deploying | `examples/12-containers/infra/bin/app.ts`, `cdk.json`, `scripts/image.ts`, `scripts/watch.ts`, `scripts/logs.ts`, `tools/src/infra/` | `ecs:infra:diff`, `ecs:infra:deploy`, `ecs:image:push`, `ecs:watch`, `ecs:logs`, `ecs:infra:drift` |
| What it costs | `examples/12-containers/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `test:unit` |
| Cleaning up | `tools/src/infra/` | `ecs:infra:deploy`, `ecs:infra:destroy` |

**Primary sources** (all checked on 2026-10-12)

- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html), [Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html), [ContainerDefinition](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html), [Best practices for Amazon ECS container images](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-considerations.html), [Fargate task definition differences](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html), [64-bit ARM workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-arm64.html)
- [Deploy Amazon ECS services by replacing tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html), [deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html), [connection draining parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html), [load balancer health check parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html), [container health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html), [AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html), [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html), [Use a target metric to scale Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)
- [Amazon ECS task networking options for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html), [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html) (checked for chapter 11 on 2026-10-11), [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html), [Edit target group attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html), [Edit attributes for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html), [Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html)
- [Pushing a Docker image to an Amazon ECR private repository](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html), [Image tag mutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/), [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/)
- AWS Price List bulk API: [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json) (Fargate), [ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json), [ECR](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-northeast-1/index.json). The unit prices for NAT gateways, interface endpoints, public IPv4 addresses, CloudWatch Logs, and data transfer were fetched for earlier chapters (checked on 2026-10-11)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [What is Docker?](https://docs.docker.com/get-started/docker-overview/), [Dockerfile reference](https://docs.docker.com/reference/dockerfile/), [docker-node: Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md), [Docker Hub: node:24-bookworm-slim](https://hub.docker.com/v2/repositories/library/node/tags/24-bookworm-slim), [Node.js v24: HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)
- Cloudflare Containers: [Overview](https://developers.cloudflare.com/containers/), [Pricing](https://developers.cloudflare.com/containers/platform/pricing/), [Rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/), [Lifecycle of a container](https://developers.cloudflare.com/containers/concepts/architecture/), [FAQ](https://developers.cloudflare.com/containers/faq/), [Local development](https://developers.cloudflare.com/containers/guides/local-dev/)
- cdkd v0.296.28: [src/provisioning](https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning), [docs/cli-deploy.md](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-deploy.md), [src/assets/docker-asset-publisher.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/assets/docker-asset-publisher.ts), [Introduction](https://cdkd.dev/introduction/) (checked on 2026-10-11)
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (observed by running a synthesis with `ecs.ContainerImage.fromAsset`)

:::
