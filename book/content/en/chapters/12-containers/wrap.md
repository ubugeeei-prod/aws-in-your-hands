---
title: "12 Containers: Costs, Pitfalls, and Cleanup"
---

# 12 Containers: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 12.cost -->

Amounts are in USD for the Tokyo Region, on demand, before tax, with a month counted as 730 hours. The calculations are in [Pricing calculations](/en/reference/pricing.md).

The first table is what the default setup costs just for existing.

| Item | Quantity | Unit price | Per month |
| --- | --- | --- | --- |
| Fargate vCPU (arm64) | 2 tasks × 0.25 vCPU × 730 hours | 0.04045 per vCPU-hour | 14.76 |
| Fargate memory (arm64) | 2 tasks × 0.5 GB × 730 hours | 0.00442 per GB-hour | 3.23 |
| ALB | 730 hours | 0.0243 per hour | 17.74 |
| Public IPv4 addresses | (2 for the ALB + 2 tasks) × 730 hours | 0.005 per hour | 14.60 |
| Subtotal | | | **50.33** |

That is USD 1.65 a day. Storage for the image in the repository comes on top (USD 0.10 per GB a month, which is USD 0.01 if one image is assumed to be 0.1 GB).

The table shows three things.

**Doing nothing costs about 25 times what the Lambda chapter did.** Chapter 04 came to USD 2.02 for a million requests a month, and this chapter comes to USD 50.33 for zero requests. If you choose containers, you need a reason that justifies this fixed cost.

**Public IPv4 addresses cost about as much as Fargate.** Four of them are USD 14.60 a month. The ALB has a node in each zone, and each node uses one address. The tasks' addresses are no longer needed if you move the tasks to private subnets, but then you pay for a NAT gateway or for endpoints.

**arm64 is a fifth cheaper.** One task of the same size is USD 9.00 a month on arm64 and USD 11.25 on x86.

The next table assumes a million requests a month, with the number of tasks staying at two.

| Item | Quantity | List price |
| --- | --- | --- |
| Just existing (the table above, and the image) | | 50.34 |
| ALB LCUs | 11.1 LCU-hours | 0.09 |
| CloudWatch Logs ingestion | 0.191 GB | 0.15 |
| CloudWatch Logs storage | 0.045 GB-month | 0.00 |
| Data transfer out to the internet | 0.477 GB | 0.05 |
| Subtotal | | **50.63** |

After the monthly free allowance of CloudWatch Logs (5 GB), it is USD 50.48. A million more requests add only USD 0.29. Almost all of it is fixed cost.

An LCU is the unit the ALB uses to bill for the work it does. Of four measures (new connections, active connections, bytes processed, and rule evaluations), the largest is the one billed. The calculation here treats one request as one connection and uses new connections. LCU usage with no requests (whether health checks count) could not be confirmed, so it is not in the first table. That means it is left out, not that it is zero.

Changing where the tasks are changes the totals as follows.

| Layout | This chapter's stack | Chapter 11's side | Total |
| --- | --- | --- | --- |
| Default (public subnets) | 50.33 | 0 | 50.34 |
| `-c taskSubnets=private` and one NAT gateway | 43.03 | 48.91 | 92.07 |
| `-c taskSubnets=private` and three interface endpoints | 43.03 | 61.32 | 104.37 |

The totals include image storage (USD 0.01) and the cost of assumed data volumes: 2 GB a month through the NAT gateway and 1 GB a month through the endpoints.

No free allowance is deducted. I found none on the Fargate pricing page. The ALB and ECR pages describe allowances for new customers, and those do not apply to every account.

**When it gets hammered.** Anyone who knows the ALB's URL can call it over HTTP. There is no authentication. An ALB also has no rate limit that comes at no extra charge, as the stage throttling of API Gateway does, so every request that arrives reaches a task.

Under a flood of requests, some things have a ceiling and some do not.

- **The fixed cost has a ceiling.** The number of tasks never goes past `maxCount`, which is 4. Four tasks running all month cost USD 75.62 just for existing (Fargate 35.98, the ALB 17.74, six public IPv4 addresses 21.90)
- **Memory has a ceiling.** A task keeps at most 100 notes, and the 101st gets a 409. A body is at most 10,000 characters, so the notes one task holds come to about a million characters at most. A task holds at most 512 connections, and a request body is at most 64 KiB
- **LCUs, logs, and data transfer have no ceiling.** Each grows with the requests that arrive

To size the part without a ceiling, take the assumptions of the table above (one connection per request, 0.2 KB of logs, a 0.5 KB response). At 100 requests a second for 30 days, that is 259.2 million requests: USD 23.04 for LCUs, USD 37.57 for log ingestion, and USD 14.09 for data transfer, USD 74.70 a month in all. At 1,000 a second it is ten times that. Whether four tasks of 0.25 vCPU can answer that many requests has not been measured. The requests the tasks fail to answer have still reached the ALB.

Two things are missing from that calculation. An LCU is counted on the largest of its four measures, and what a stream of large request bodies would come to on the bytes measure has not been calculated. Data transfer also changes with the size of the responses. Under chapter 04's contract, a list is 20 summaries and at most 20 KiB, and one note is at most 64 KiB. If all of 100 responses a second were 64 KiB notes, that would be about 15,820 GB in 30 days, or about USD 1,664 for data transfer alone.

Before real users arrive, the entry point needs a rate limit. AWS WAF can be attached to an ALB ([chapter 21](/en/chapters/21-security.md)). The WAF unit prices this book holds are the ones for CloudFront, though, and the price of a web ACL on an ALB in the Tokyo Region has not been checked. While you are only practicing, you can also narrow the ALB's security group to your own IP address (this chapter's stack does not).

If you redeploy without a tag and leave only the repository, the hourly charges stop and only image storage remains.

How the hourly items are counted is written as code.

<<< @/examples/12-containers/src/cost.ts{billable}

The tests check that the hours this function produces match the scenarios in the pricing data, and that the amounts on this page match what the calculator returns.

## If you're coming from Cloudflare

<!-- section: 12.cloudflare -->

Cloudflare has Containers too. The differences below come from reading its documentation (I have not used it to check them).

| | Cloudflare Containers | This chapter (ECS on Fargate and an ALB) |
| --- | --- | --- |
| Entry point | A Worker. A container is reached only through a Durable Object | The ALB, which routes HTTP straight to tasks |
| Starting | When a request arrives or when Worker code starts it. Sleeps when unused | The service keeps the number you set running, always |
| Pricing | Only while running, in 10 ms steps. The Workers Paid plan includes some usage | For the time it exists, used or not |
| How many | Decided by Worker code. Built-in autoscaling for stateless apps is not available today | Can be left to target tracking |
| Replacing | Two steps by default, 10% then 100%. Stopping sends SIGTERM, then SIGKILL after 15 minutes | Rolling update. At most 120 seconds after SIGTERM |
| Network | Nothing to design | You decide the VPC, subnets, and security groups |
| Locally | `wrangler dev`, which needs a Docker-compatible CLI and engine | This sample runs directly on Node.js. Only building the image needs Docker |

The biggest difference is what happens while nothing is using it. A Cloudflare container sleeps and its charges stop, at the price of a start from the stopped state (a cold start), which the documentation puts at 1 to 3 seconds in many cases. An ECS service does not stop, so nobody waits for a start, and you pay for the time it is not used.

The other difference is where routing and starting are decided. On Cloudflare a Worker and a Durable Object always sit in front of the container, and you write routing and starting as code. On ECS the ALB and the service settings do that job. Which one fits depends on what you are building.

Finishing the work in flight after SIGTERM and then stopping is the right design on both. Old and new running together during an update is the same too: Cloudflare's documentation also says that new Worker code can reach containers on the previous image. "What happens during an update" and "Old and new run side by side" in [Build, Continued](/en/chapters/12-containers/more.md) apply to Cloudflare as they are.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:ecs` stops with `Invalid environment` | Check that `examples/12-containers/.env` exists, and check the variable named in the message |
| `ecs:image:build` stops with `No Docker daemon answered` | You have the client and no running daemon. Start Docker Desktop or similar |
| The push fails with `ImageTagAlreadyExistsException` | That tag is already in use. Tags are immutable, so use a new one |
| The deploy sits at the service for a long time, then fails | The tasks cannot start. Read `stoppedReason` with `aws ecs list-tasks --desired-status STOPPED` and `aws ecs describe-tasks`. Often the image cannot be fetched (a mistyped tag, or private subnets with no route) |
| The tasks run, but the ALB's URL returns an error | Check with `aws elbv2 describe-target-health` whether the targets are healthy. Check that `/health` answers 200 and that the security group allows port 8080 |
| A 502 comes back now and then | Check whether the server's keep-alive is shorter than the ALB's idle timeout. Look at the relations in `src/timing.ts` |
| A few requests fail on every update | SIGTERM is not received (is `CMD` written as an array?), or some requests take longer than the deregistration delay |
| A note you created appears and disappears from call to call | There are two tasks, each with its own `Map`. That is how this chapter is built |
| A POST gets 409 with `quota_exceeded` | That task's `Map` is full at 100 notes. The count is per task, so the same POST gets through on one task and not on another. Delete a note, or wait for the task to be replaced |
| `net:infra:destroy` stops with `StackHasActiveImportsError` | This chapter's stack uses the VPC. Run `ecs:infra:destroy` first |
| You are billed although you use nothing | The service is running. Redeploy without a tag, or destroy |

Apart from the first two rows, these were put together from the documentation. I have not made them happen to check them.

## If you take this to production

- **Switch to HTTPS.** Get a domain name and a certificate and make the listener port 443. Right now everything is plain text
- **Add authentication and authorization.** As in chapter 04, anyone who knows the URL can call it (chapter 06)
- **Put a rate limit at the entry point.** An ALB passes every request that arrives. Attach an AWS WAF rate-based rule to it (chapter 21; this book has not checked the price for an ALB)
- **Keep data outside the tasks.** Right now it is lost on every update (chapters 05 and 13). Once it is outside, the rules in [Old and new run side by side](/en/chapters/12-containers/more.md) become real constraints
- **Put the tasks in private subnets.** Use the table in chapter 11 to decide between a NAT gateway and endpoints for the way out
- **Do not write secrets directly into environment variables.** Pass them in at start from Secrets Manager or similar with `secrets` in the task definition. The permission to read them goes on the task execution role (handling secrets is in [chapter 21](/en/chapters/21-security.md), where the example is a Lambda function)
- **Stop updates on application metrics too.** The circuit breaker sees only starts and health checks. ECS can also fail a deployment on a CloudWatch alarm (how to build an alarm is in [chapter 19](/en/chapters/19-observability.md))
- **Pin the base image by digest.** The contents behind the tag `node:24-bookworm-slim` keep changing. If every build should use the same image, name it by digest
- **Use three zones and three or more tasks.** With two, you are at half capacity as soon as one zone stops
- **Review the log retention, the ALB's deletion protection, and the repository's `emptyOnDelete`.** All of them are set to be easy to delete, for practice
- **Deploy through the AWS CDK CLI and CloudFormation.** cdkd's own documentation says cdkd is for development and testing and recommends the AWS CDK CLI for production (chapter 02)

## Cleaning up

<!-- section: 12.cleanup -->

To stop only the hourly charges and keep the images, redeploy without a tag.

```bash
vp run ecs:infra:diff
vp run ecs:infra:deploy
```

Run the deploy only after `diff` shows the ALB, the service, the task definition, and so on as deletions, and the repository as staying.

To remove everything, run these two.

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

Keep this order. While a stack that uses the VPC remains, chapter 11's destroy is refused.

The repository is deleted together with its images (`emptyOnDelete`), and so is the log group. Nothing is left outside the stack, and a test checks that no resource is set to be retained.

To be sure, check for yourself at the end.

```bash
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws ecr describe-repositories --region ap-northeast-1
```

If the first shows no load balancer from this chapter and the second shows no cluster, this chapter's hourly charges have stopped. The third should show only the repository that `cdkd bootstrap` created in chapter 02.

The daemon on your machine still has the images you built. `docker image rm aih-notes:v1` removes one.

::: details Verification notes for this chapter

**Checked locally.** The test that starts the server as a child process and sends SIGTERM in the middle of a request. The graceful shutdown tests (including that removing `sweep` turns `drained` into `forced` and fails them). The test that runs an old and a new version at the same time. Unit tests for the timing relations, the settings, how the `docker` commands are assembled, pricing, and the stack assertions. Type checking. `ecs:infra:synth` (without a tag, with `-c imageTag=v1`, with `-c imageTag=v1 -c taskSubnets=private`, and that `-c imageTag=latest` is refused). `ecs:bundle` and `ecs:bundle:check`. `dev:ecs`, started, with the `curl` commands from the text and the log lines on Ctrl-C. `ecs:image:build`, `ecs:image:run`, and `ecs:image:push` with `--dry-run`, and the message they print when run without a daemon. `ecs:watch`, pointed at a local server with `--url`. That a synth using `ecs.ContainerImage.fromAsset` passes with no `docker` command on the PATH (aws-cdk-lib 2.273.0). The `docker` flags were checked against the help of Docker CLI 29.7.2. The amounts in the text are what `tools/src/pricing/calc.ts` computes from Price List unit prices, and `examples/12-containers/test/pricing.test.ts` compares them.

**Not checked yet.** The connection limit (`maxConnections`) was checked only on local Node.js: a connection past the limit is closed without an answer. What a caller gets behind an ALB when the connections are at the limit, and what happens to the health checks, have not been checked. The number 512 was not chosen by measuring either. No Docker daemon was running, so the image has never been built. As a result these are unverified: that the Dockerfile builds, that the exception in `.dockerignore` works, that the image starts on the arm64 base image, that it runs with `--read-only`, and how large the image is (the 0.1 GB in the cost tables is an assumption). `ecs:infra:diff`, `ecs:infra:deploy`, `ecs:image:push`, `ecs:watch`, `ecs:logs`, `ecs:infra:drift`, and `ecs:infra:destroy` have not been run against real AWS. All of the following wait for a check in a real environment. That cdkd 0.296.28 can create and delete this stack. That the chapter 11 VPC can be read with `Fn::ImportValue` from another app's stack. That the three types that go through the Cloud Control API work. That tasks in public subnets can fetch the image, and that egress on port 443 alone is enough. Both routes for `-c taskSubnets=private`. The ALB's health checks and fail open. That no errors occur during a rolling update. That SIGTERM arrives after the target has been deregistered. The circuit breaker's rollback, and what cdkd prints when it happens. Auto scaling up and down. That redeploying without a tag removes only the ALB and the tasks. The symptoms under "Where it goes wrong".

Not confirmed from a primary source. An ALB's LCU usage with no requests. Whether the service-linked roles for ECS and Application Auto Scaling are created automatically on the first deploy in an account. Whether redeploying a service while auto scaling is active sets the number of tasks back to the `desiredCount` of 2. How many public IPv4 addresses an ALB uses once it adds nodes under load. That `node:24-bookworm-slim` on Docker Hub has an arm64 variant: I read only the beginning of the API response (the amd64 entry) and did not confirm it. For Cloudflare Containers, I only read the documentation.

Resource types that cdkd handles. In `src/provisioning/register-providers.ts` at the `v0.296.28` tag, dedicated implementations are registered for `AWS::ECS::Cluster`, `TaskDefinition`, and `Service` (the ECS provider), `AWS::ElasticLoadBalancingV2::LoadBalancer`, `TargetGroup`, and `Listener` (the ELBv2 provider), `AWS::ECR::Repository`, `AWS::EC2::SecurityGroup`, `SecurityGroupIngress`, `AWS::IAM::Role`, `Policy`, and `AWS::Logs::LogGroup`. `AWS::ApplicationAutoScaling::ScalableTarget`, `ScalingPolicy`, and `AWS::EC2::SecurityGroupEgress` are not registered and are not on the unsupported list, so they go through the Cloud Control API. The ECS provider treats a change to a task definition as a replacement (it registers a new revision and deregisters the old one). For a service, it returns by default once `CreateService` or `UpdateService` is accepted, and waits for stability only with `--full-wait`. The ECR provider deletes a repository together with its images only when `EmptyOnDelete` is true. The npm tarball contains no TypeScript source, so I read the archive of the GitHub tag.

**Where the code is.**

| Section | Files | `vp run` tasks |
| --- | --- | --- |
| The big picture | `examples/12-containers/infra/lib/containers-stack.ts`, `src/config.ts` | `ecs:infra:synth` |
| docker is two programs | `examples/12-containers/src/image.ts`, `scripts/image.ts` | `ecs:image:build` |
| From a handler to a server that keeps running | `examples/12-containers/src/compose.ts`, `src/env.ts`, `src/server.ts`, `test/compose.test.ts`, `.env.example` | `dev:ecs`, `test:unit` |
| What the server does when it is stopped | `examples/12-containers/src/serve.ts`, `src/server.ts`, `test/shutdown.test.ts` | `test:unit` |
| Build the image | `examples/12-containers/Dockerfile`, `.dockerignore`, `scripts/bundle.ts`, `scripts/check-bundle.ts`, `src/image.ts` | `ecs:bundle`, `ecs:bundle:check`, `ecs:image:build`, `ecs:image:run` |
| Where the image is kept | `examples/12-containers/infra/lib/containers-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `test/config.test.ts` | `ecs:infra:synth`, `ecs:image:push`, `test:unit` |
| Which subnets the tasks go in | `examples/12-containers/infra/lib/containers-stack.ts`, `infra/test/containers-stack.test.ts`, `examples/11-network/infra/lib/import-network.ts` | `test:unit`, `net:plan` |
| The two roles | `examples/12-containers/infra/lib/containers-stack.ts`, `infra/test/containers-stack.test.ts` | `test:unit` |
| The service and the load balancer | `examples/12-containers/infra/lib/containers-stack.ts`, `src/timing.ts`, `test/timing.test.ts` | `test:unit`, `ecs:infra:synth` |
| What happens during an update | `examples/12-containers/infra/lib/containers-stack.ts`, `src/timing.ts`, `scripts/watch.ts`, `src/watch.ts` | `ecs:watch` |
| Old and new run side by side | `examples/12-containers/src/compat.ts`, `test/versions.test.ts` | `test:unit` |
| More tasks, fewer tasks | `examples/12-containers/infra/lib/containers-stack.ts`, `src/config.ts` | `test:unit` |
| Checking it locally | `examples/12-containers/test/`, `infra/test/containers-stack.test.ts`, `scripts/check-bundle.ts` | `test:unit`, `ecs:bundle:check`, `ecs:infra:synth`, `dev:ecs` |
| Deploying | `examples/12-containers/infra/bin/app.ts`, `cdk.json`, `scripts/image.ts`, `scripts/watch.ts`, `scripts/logs.ts`, `tools/src/infra/` | `ecs:infra:diff`, `ecs:infra:deploy`, `ecs:image:push`, `ecs:watch`, `ecs:logs`, `ecs:infra:drift` |
| Cost | `examples/12-containers/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `test:unit` |
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
