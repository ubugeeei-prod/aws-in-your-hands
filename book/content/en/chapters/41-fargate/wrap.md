---
title: "41 Fargate: Costs, Pitfalls, and Cleanup"
---

# 41 Fargate: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 41.cost -->

Amounts are in USD for the Tokyo Region, on demand, before tax, with a month of 730 hours. The arithmetic is in [Pricing](/en/reference/pricing.md).

The first table is what the default configuration costs just by existing.

| Item | Quantity | Unit price | Per month |
| --- | --- | --- | --- |
| Fargate vCPU (arm64) | 2 tasks × 0.25 vCPU × 730 hours | 0.04045 per vCPU-hour | 14.76 |
| Fargate memory (arm64) | 2 tasks × 0.5 GB × 730 hours | 0.00442 per GB-hour | 3.23 |
| Load balancer | 730 hours | 0.0243 per hour | 17.74 |
| Public IPv4 addresses | (2 for the load balancer + 2 tasks) × 730 hours | 0.005 per hour | 14.60 |
| Nightly job | 30 runs × 60 seconds (the minimum) | as above | 0.01 |
| Image storage | 0.1 GB (assumption) | 0.10 per GB-month | 0.01 |
| Subtotal | | | **50.35** |

The difference from chapter 12's default (USD 50.34) is the nightly job's one cent. The capacity provider strategy, the scaling policies, the Scheduler schedule, and the ECS Exec setting cost nothing in themselves. What costs is the time of the tasks that run as a result. Per day it is USD 1.65.

Fargate bills the vCPU and memory a task requested, from the start of the image pull until the task stops, by the second, with a minimum of one minute. A job that ends after five seconds is billed for sixty.

**The ceiling.** If auto scaling took the service to six tasks and left it there for a month, the bill would be USD 100.93. Each added task adds about USD 12.65 (9.00 for Fargate and 3.65 for its public IPv4 address). That ceiling counts all six at the on-demand rate. In fact three of the four added tasks run on Spot and cost less. How much less is not calculated, because the Tokyo Spot price could not be obtained. The pricing page says "up to 70%".

The costs that grow with requests (the load balancer's LCUs, logs, data transfer), and the bounds on the bill when the URL is hammered, work as in chapter 12's [cost section](/en/chapters/12-containers/wrap.md) and are not repeated here.

What is billed while idle is counted in code. The service's part is chapter 12's function, given this chapter's number of tasks.

<<< @/examples/41-fargate/src/cost.ts{billable}

**Compute Savings Plans.** A Savings Plan lowers unit prices in exchange for a promise to spend a certain amount per hour for one or three years. Compute Savings Plans apply to EC2 and also to Fargate and Lambda usage. The pricing page says up to 50% for Fargate. The promised amount is paid whether you use it or not. It suits only the part you can say will still be running a year from now, such as this chapter's `base` of two. It does not suit what auto scaling adds, or a service whose size is not settled. The order is: settle the size, move to arm64, send to Spot what can go there, and only then think about a plan for the on-demand floor that remains. Whether Spot usage counts toward a Savings Plan could not be confirmed from the pages read. This book does not calculate discounted rates.

**Against Lambda and EC2.** Chapter 04's shape (an HTTP API and Lambda) and this chapter's (a load balancer and Fargate) are compared under two loads. One is 20 requests a second, all month. The other is the same 20 a second for two hours a day and nothing for the other 22. Lambda has 512 MB and takes 50 ms per request on average.

| Load | Lambda and HTTP API | Fargate and load balancer | Two t4g.small and load balancer |
| --- | --- | --- | --- |
| 20 a second all month (51.84 million) | 94.52 | 54.94 | 70.02 |
| 20 a second for 2 hours a day (4.32 million) | 7.88 | 52.79 | not calculated |

After Lambda's monthly free allowance the two are USD 88.99 and USD 6.24. The Fargate column runs two tasks of 0.25 vCPU all month; in the second row auto scaling adds two more for the two busy hours.

One large assumption sits in this table. **Whether two tasks of 0.25 vCPU can answer 20 requests a second was not measured.** If they cannot, there will be more tasks or larger ones, and the Fargate column goes up accordingly. In the Lambda column, more requests mean a higher bill and no question about capacity. Logs, data transfer, and a database are in none of the columns.

With that said, here is what the table shows. When load does not let up, Fargate's fixed cost is lower than Lambda's price per request. When load is concentrated in a short part of the day, Lambda is far cheaper, because Fargate costs almost the same in the two busy hours as in the 22 quiet ones.

The crossover can be calculated too. Under these assumptions Lambda with an HTTP API is USD 1.82 per million requests. Dividing what this chapter's stack costs by the hour (USD 50.34) by that rate gives about 27.66 million requests a month, or 10.7 a second. If the average over a whole month is below that, Lambda is cheaper on price alone.

<<< @/examples/41-fargate/src/breakeven.ts{even}

The EC2 column is two of [chapter 23](/en/chapters/23-ec2.md)'s t4g.small instances behind the same load balancer. One instance with its 8 GB volume is USD 16.54 a month. One Fargate task is USD 9.00 at 0.25 vCPU and 0.5 GB, and USD 35.98 at 1 vCPU and 2 GB. For something of similar size that is always on, EC2 can be cheaper. In return you own OS updates, replacing containers, and the number of instances. That work is not in the table.

No free allowance is deducted except Lambda's. None was found on the Fargate pricing page.

## For readers coming from Cloudflare or Vercel

<!-- section: 41.platforms -->

Both sets of documentation were read on 2026-10-13. Neither was tried.

Cloudflare Containers turns many of this chapter's decisions into things you do not decide.

| | Cloudflare Containers | This chapter (ECS on Fargate) |
| --- | --- | --- |
| Size | Six types from `lite` (1/16 vCPU, 256 MiB) to `standard-4` (4 vCPU, 12 GiB), and custom ones up to 4 vCPU and 12 GiB | The pairs in the table, up to 32 vCPU and 244 GB |
| When idle | Sleeps after 10 unused minutes by default, and billing stops. A start from stopped is often 1 to 3 seconds | The minimum number of tasks keeps running and is billed |
| Scaling | Requests are spread over a number of instances you set, with `getRandom`. Built-in autoscaling for stateless applications is not available today (it is described as planned) | Left to target tracking and the like |
| Discounted capacity | Nothing comparable was found | Fargate Spot, stopped with two minutes' notice |
| Scheduled runs | An example starts a container from a Worker on a Workers Cron Trigger | RunTask from EventBridge Scheduler |
| Network | Nothing to design | You choose subnets, the way out, and endpoints |

Some ideas are the same. A container is something that will be stopped from outside; the signal to stop is SIGTERM; a large image starts slowly. None of that differs. The way this chapter's job is written (stop between items, leave the number to resume from) works in a Cloudflare container as it is.

Vercel, according to an article in its knowledge base, can run OCI-compatible container images as Vercel Functions. With a `Dockerfile.vercel` at the root of the project, Vercel builds the image, keeps it in its own registry, and serves it as a function that scales automatically. Scheduled runs are Cron Jobs, which send an HTTP GET to a fixed path of the production deployment. Vercel Functions have a maximum duration: with Fluid compute, 300 seconds on Hobby and 800 seconds on Pro and Enterprise (up to 1,800 in beta). Whether the same limits apply to a function that runs a container was not checked.

On neither platform is the table of task sizes, the capacity provider, the durations of scale-in, or the VPC endpoint something the user thinks about. If your application takes a request and answers it, fits within their limits, and does not need to talk directly to resources inside a VPC (such as [chapter 13](/en/chapters/13-sql.md)'s database), staying there is simpler. If it sits unused much of the time, it is cheaper as well.

These are the cases that make Fargate the choice. You need to talk to things in a VPC on their own network. You need large tasks. Load does not let up, and paying for time is cheaper. You want jobs that run for hours and can carry on after being stopped. You want to tune the scaling rules yourself. In return, every decision in this chapter is yours.

## Seen as a distributed system

Three things hold state in this chapter. The desired number of tasks is held by ECS and rewritten by Application Auto Scaling. The registration and draining state of targets is held by the load balancer. Requests in flight and the job's progress are held by the task's process. The three change at different speeds, and none learns of another's state at once.

There are three invariants.

- A request within its expected time gets its answer even when its task is removed or interrupted. Chapter 12's relations between durations protect it, and `test/scaling.test.ts` and `test/spot.test.ts` check it, including that requests are cut when a duration is shortened
- The tasks the service never goes below are not placed on capacity that can be taken back. `test/strategy.test.ts` and the stack assertions check it
- However often it is stopped, the job processes every item exactly once, provided it continues from its checkpoint. `test/job.test.ts` checks it by sending a real SIGTERM. The same test shows that a restart without the number repeats items

Some partial failures remain. Requests at a Spot interruption in which SIGTERM arrives before deregistration. Requests a task was handling when it was killed at its memory limit. A scheduled time for which Scheduler starts the job twice. This chapter's code prevents none of them. Retries on the caller's side ([chapter 32](/en/chapters/32-limits.md)) and idempotent work absorb them.

## Where people trip

| If this happens | Look here |
| --- | --- |
| Registering a task definition is refused for its CPU and memory | The pair is not in the table. Check with `vp run fargate:size` |
| Creating the service fails on the capacity provider | Check that the providers are associated with the cluster, in `capacityProviders` of `aws ecs describe-clusters`. Check that a launch type and a strategy are not both given |
| Added tasks never start | Spot may have no capacity. Fargate does not make up for Spot with on-demand. Read the service's events |
| A task stops with `SpotInterruption` | A Spot interruption, working as designed. Check that the minimum tasks are still there |
| Load rises and no task is added for minutes | Target tracking looks at several minutes of metrics before it acts. Try other start times with `vp run fargate:simulate` |
| Load falls and tasks stay | Scale-in waits for a sustained value well below the target, and for the cooldown. It is also paused during a deployment |
| A few requests fail at every scale-in | Is the deregistration delay shorter than a long request? Does the server receive SIGTERM (chapter 12)? |
| You cannot tell whether the job ran last night | Scheduler does not know the outcome. Look at the log streams that begin with `job`, and at the exit code in `describe-tasks` |
| The job's exit code is 75 | It was stopped partway. Pass the `next` value from the log to `--start-at` and run the rest |
| `fargate:exec` fails | Was the stack deployed with `-c exec=true`? Was the task started after that deploy? Is the Session Manager plugin installed? In private subnets, is there an `ssmmessages` endpoint? |
| A secret was updated and the application still uses the old value | Values are passed at start only. Force a new deployment |
| There is a charge although nothing is in use | The service is running. Deploy again without a tag, or destroy |

This table was put together from the documentation. None of it was provoked and observed.

## For production

[For production](/en/chapters/12-containers/wrap.md) in chapter 12 applies to this stack as it stands: HTTPS, authentication, throttling at the door, where the data lives, and the rest. This chapter adds the following.

- **Measure before you set the size and the targets.** Neither 512 MiB nor 600 requests per task was measured. Turn on Container Insights for a limited time, run a load test, and decide (chapters 19 and 32)
- **Use three Availability Zones, and a `base` of at least 3.** With an on-demand floor of one task in each of two zones, losing a zone leaves one. Spot may have nothing to offer at that moment
- **Count Spot interruptions.** Catch task state change events whose `stopCode` is `SpotInterruption` with an EventBridge rule ([chapter 25](/en/chapters/25-events.md)) and watch how often they come. If often, lower the `weight`
- **Turn a failed job into a notification.** Connect a task that stops with an exit code other than 0 or 75 to an alarm (chapter 19). You also need a way to notice a night on which the job never started
- **Keep the job's checkpoint in storage, not in the log.** Chapter 16 has the shape
- **Forbid ECS Exec with an organization policy.** When it is needed, make an exception with an end date, and name the log group that records sessions
- **Choose the log `mode` by whether a log line may go missing.**
- **Check quotas before raising the auto scaling ceiling.** A higher ceiling adds nothing once the vCPU quota is reached (chapter 32)
- **Choose the deployment method again.** This chapter keeps the rolling update. Blue/green and canary are in [chapter 31](/en/chapters/31-progressive-delivery.md). The `ALBRequestCountPerTarget` policy cannot be used with blue/green deployments
- **Deploy through the AWS CDK CLI and CloudFormation.** cdkd's own documentation describes cdkd as intended for development and testing, and recommends the AWS CDK CLI for production (chapter 02)

## Cleanup

<!-- section: 41.cleanup -->

To stop the hourly charges and keep the image, deploy again without a tag. The service, the load balancer, and the schedule go; the repository stays.

```bash
vp run fargate:infra:diff
vp run fargate:infra:deploy
```

To remove everything, run these in this order. Chapter 11's VPC cannot be destroyed while a stack that uses it remains.

```bash
vp run fargate:infra:destroy
vp run ecs:infra:destroy
vp run net:infra:destroy
```

The repository goes with the images in it, and so does the log group. Nothing is meant to remain outside the stack, and a test checks that no resource is set to be retained.

Before destroying, make sure no standalone task is still running. A task started with `fargate:job:run` is not a resource of the stack, so destroy does not stop it. Normally it ends within seconds, but one started with a large `JOB_ITEMS` keeps being billed while it runs. Whether a cluster can be deleted while a task is running was not checked.

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws scheduler list-schedules --region ap-northeast-1
```

If the second shows no load balancer of this chapter, the third no cluster, and the fourth no schedule of this chapter, this chapter's charges have stopped. The alarms Application Auto Scaling created are deleted with the policy, according to the documentation.

The image you built stays in your local daemon. `docker image rm aih-notes:f1` removes it.

::: details Verification notes for this chapter

**Checked locally.** 89 unit tests (the size table and the choice from it, the rules and the split of a strategy, the model of target tracking, what becomes of a stopping task's requests, a test that sends SIGTERM to chapter 12's server, a test that interrupts and resumes the job as a child process, the assembly of the AWS CLI commands, cost, the stack assertions). The type check. `fargate:infra:synth` (without a tag, with `-c imageTag=f1`, with `-c exec=true` added, with `-c taskSubnets=private` added; also that `-c exec=yes` is refused). `fargate:bundle` and `fargate:bundle:check`. `fargate:simulate` (the output in the text is that command's real output). `fargate:size`. `fargate:job:run`, `fargate:exec`, and `fargate:image:push` with `--dry-run`. The AWS CLI flags (`--capacity-provider-strategy`, `--overrides`, `--client-token`, and `--started-by` of `run-task`; `--interactive`, `--command`, and `--container` of `execute-command`) were checked against the help of AWS CLI 2.35.11 in the devShell. The amounts in the text are computed by `tools/src/pricing/calc.ts` from Price List unit prices, and `examples/41-fargate/test/pricing.test.ts` compares them.

**Not checked yet.** Nothing was run against AWS. No Docker daemon was available, so the image has never been built (the `Dockerfile` and `.dockerignore` are unverified). None of the following was therefore checked on the real thing. That cdkd 0.296.28 can create and delete this stack. That the cluster's `CapacityProviders` and the service with a strategy can be created. That tasks are split as the strategy says. A Spot interruption, and the order of deregistration and SIGTERM in it. How long the target tracking alarms take, and how many tasks one scale-in removes (the model's 3 minutes, 15 minutes, 2 minutes to start, and 900 requests per task are all assumptions). That scale-in cuts no request. That Scheduler can call RunTask, what happens when Spot has no capacity, and the retries. `fargate:job:run` and its environment overrides. An ECS Exec session, its logs, and the Session Manager plugin. What reaching a quota looks like. The symptoms under "Where people trip".

Not confirmed from primary sources. The Tokyo price of Fargate Spot (absent from the Price List; the table on the pricing page is filled in by script). Whether Spot usage counts toward a Savings Plan. The order of deregistration and SIGTERM at a Spot interruption. The exact text of `stoppedReason` and the exit code when a task is stopped at its memory limit. What happens when ephemeral storage fills. The evaluation periods of the target tracking alarms. What `Input` becomes for Scheduler's ECS templated target. For task retirement, the page that explains why the replacement starts first credits `maximumPercent` in one passage and the minimum healthy percent in another. Whether Container Insights metrics count toward the free allowance of ten custom metrics. That `APN1-CW:MetricsUsage` (USD 0.07) in Tokyo's Price List is the enhanced observability rate is an inference from the matching rate in the pricing page's example. The maximum duration of a Vercel function that runs a container. Cloudflare Containers and Vercel were read about, not used.

Resource types and cdkd. At the `v0.296.28` tag, `src/provisioning/register-providers.ts` registers providers for `AWS::ECS::Cluster`, `TaskDefinition`, `Service`, `AWS::ElasticLoadBalancingV2::LoadBalancer`, `TargetGroup`, `Listener`, `AWS::ECR::Repository`, `AWS::EC2::SecurityGroup`, `SecurityGroupIngress`, `AWS::IAM::Role`, `Policy`, `AWS::Logs::LogGroup`, and `AWS::Scheduler::Schedule`. The ECS provider's `handledProperties` include `CapacityProviders` on the cluster and `CapacityProviderStrategy` and `EnableExecuteCommand` on the service. The Scheduler provider has code that converts `EcsParameters` in `Target`. `AWS::ApplicationAutoScaling::ScalableTarget`, `ScalingPolicy`, and `AWS::EC2::SecurityGroupEgress` have no provider and are not on the unsupported list, so they go through Cloud Control API. `AWS::ECS::ClusterCapacityProviderAssociations` would be treated the same way, but this stack does not use it.

Observed by synthesizing with aws-cdk-lib 2.273.0. `enableFargateCapacityProviders` creates the association as a separate resource that the service does not depend on. `enableExecuteCommand` on `FargateService` adds, besides the four `ssmmessages` actions, `logs:DescribeLogGroups`, `logs:CreateLogStream`, `logs:DescribeLogStreams`, and `logs:PutLogEvents` with `Resource: "*"` to the task role. `grantRun` grants `ecs:RunTask` on the task definition and `iam:PassRole` on its two roles, with an `iam:PassedToService` condition.

**Where the code is.**

| Section | Files | `vp run` tasks |
| --- | --- | --- |
| The whole picture | `examples/41-fargate/infra/lib/fargate-stack.ts`, `src/config.ts` | `fargate:infra:synth` |
| The size of a task | `examples/41-fargate/src/sizes.ts`, `src/sizing.ts`, `scripts/size.ts`, `test/sizes.test.ts` | `fargate:size`, `test:unit` |
| Fargate Spot and the capacity provider strategy | `examples/41-fargate/src/strategy.ts`, `src/spot.ts`, `test/strategy.test.ts`, `test/spot.test.ts`, `infra/lib/fargate-stack.ts` | `test:unit`, `fargate:infra:synth` |
| Moving the number of tasks | `examples/41-fargate/src/scaling.ts`, `src/drain.ts`, `src/model-defaults.ts`, `scripts/simulate.ts`, `test/scaling.test.ts` | `fargate:simulate`, `test:unit` |
| Tasks that are not services | `examples/41-fargate/src/job.ts`, `src/job-main.ts`, `src/commands.ts`, `scripts/task.ts`, `test/job.test.ts`, `test/commands.test.ts` | `dev:fargate:job`, `fargate:job:run`, `test:unit` |
| Network choices and their cost | `examples/41-fargate/infra/lib/fargate-stack.ts`, `infra/test/fargate-stack.test.ts`, `examples/11-network/src/config.ts` | `test:unit`, `net:plan` |
| ECS Exec | `examples/41-fargate/infra/lib/fargate-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `src/commands.ts`, `infra/test/fargate-stack.test.ts` | `fargate:exec`, `test:unit` |
| Checking it locally | `examples/41-fargate/test/`, `scripts/bundle.ts`, `scripts/check-bundle.ts`, `Dockerfile` | `test:unit`, `fargate:bundle:check`, `fargate:infra:synth` |
| Deploying | `examples/41-fargate/infra/bin/app.ts`, `scripts/image.ts`, `scripts/task.ts`, `tools/src/infra/` | `fargate:infra:diff`, `fargate:infra:deploy`, `fargate:image:build`, `fargate:image:push`, `fargate:infra:drift` |
| Cost | `examples/41-fargate/src/cost.ts`, `src/breakeven.ts`, `test/pricing.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `fargate:infra:deploy`, `fargate:infra:destroy` |

**Primary sources** (all checked on 2026-10-13; sources checked for chapters 12 and 08 carry their dates there)

- What Fargate is: [Architect for AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html), [Fargate platform versions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform-fargate.html), [Linux platform version change log](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform-versions-changelog.html), [Task retirement and maintenance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-maintenance.html), [Prepare for task retirement](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/prepare-task-retirement.html)
- Size: [Task definition differences for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html) (the table, and SOCI), [Fargate task ephemeral storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html), [EphemeralStorage](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_EphemeralStorage.html), [Task definition parameters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html), [Troubleshooting OutOfMemoryError](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/out-of-memory.html)
- Metrics: [Amazon ECS CloudWatch metrics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/available-metrics.html), [Container Insights metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-metrics-ECS.html), [enhanced observability metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-enhanced-observability-metrics-ECS.html), [Container Insights for ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-container-insights.html), [Amazon CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/)
- Spot and strategies: [Amazon ECS clusters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html), [CapacityProviderStrategyItem](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CapacityProviderStrategyItem.html), [AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)
- Auto scaling: [Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html), [Use a target metric](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html), [scheduled actions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-schedulescaling.html), [Optimizing service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-autoscaling-best-practice.html), [task scale-in protection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html), [How target tracking scaling works](https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html), [PredefinedMetricSpecification](https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html)
- Tasks that are not services: [standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html), [Using EventBridge Scheduler to schedule Amazon ECS tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html), [EcsParameters](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_EcsParameters.html), [RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html), [task state change events](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_task_events.html)
- Network: [Amazon ECS interface VPC endpoints](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/vpc-endpoints.html), [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html), [image pull behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-pull-behavior.html)
- Operating: [ECS Exec](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html), [task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html), [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html), [Secrets Manager secrets through environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), [HealthCheck](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_HealthCheck.html), [LogConfiguration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_LogConfiguration.html), [FireLens](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html)
- Limits: [Amazon ECS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ecs-service.html), [AWS Fargate throttling quotas](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/throttling.html)
- Cost: [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/), [What are Savings Plans?](https://docs.aws.amazon.com/savingsplans/latest/userguide/what-is-savings-plans.html), the AWS Price List bulk API for [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json) (ephemeral storage; no Spot price) and [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json). The unit prices for Fargate, the load balancer, Lambda, HTTP APIs, EC2, NAT gateways, endpoints, and public IPv4 addresses were obtained for their own chapters
- Cloudflare Containers: [Limits and Instance Types](https://developers.cloudflare.com/containers/platform-details/limits/), [Scaling and Routing](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing/), [FAQ](https://developers.cloudflare.com/containers/faq/), [Cron container](https://developers.cloudflare.com/containers/examples/cron/)
- Vercel: [Does Vercel support Docker deployments?](https://vercel.com/kb/guide/does-vercel-support-docker-deployments), [Vercel Functions Limits](https://vercel.com/docs/functions/limitations), [Cron Jobs](https://vercel.com/docs/cron-jobs)
- cdkd v0.296.28: [src/provisioning/register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts), `providers/ecs-provider.ts`, `providers/scheduler-schedule-provider.ts`, `unsupported-types.generated.ts`
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (observed by running a synthesis)

:::
