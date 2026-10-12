---
title: "41 Fargate: Build, Continued"
---

# 41 Fargate: Build, Continued

The [previous page](/en/chapters/41-fargate/build.md) dealt with the size, the placement, and the number of the service's tasks. This page covers tasks that are not services, the network choices, ECS Exec, the operating decisions, and the limits.

## Tasks that are not services

<!-- section: 41.tasks -->

A service keeps a set number of tasks running. It does not suit a program that does its work and ends, because the service takes the finished task for a failed one and starts it again. The ECS documentation says to run an application that performs some work and then stops, such as a batch process, as a standalone task that belongs to no service.

This chapter's job is a program that processes a fixed number of items in order and ends. The work itself is a stand-in: a short pause per item. What the chapter is showing is not the work but how the program behaves when it is stopped from outside, and how it reports the way it ended.

<<< @/examples/41-fargate/src/job.ts{run}

The job checks for a request to stop only between two items. If one has arrived, it logs the number of the item it would have done next, and ends. Everything before that number is done; nothing at or after it has been touched. It never stops in the middle of an item.

<<< @/examples/41-fargate/src/job-main.ts{main}

There are two exit codes: 0 when everything is done, 75 when the job was stopped early. The container's exit code is all that ECS records about how the job went, so "it failed" and "there is more to do" are told apart by a number. A Spot interruption, a task retirement, and a manual stop all reach the job as the same SIGTERM.

The next test starts the job as a child process, sends SIGTERM after the third item, and starts it again with the number from the log. It checks that across the two runs every item is processed exactly once.

<<< @/examples/41-fargate/test/job.test.ts{interrupted}

Started again from the beginning, without the number, the job repeats the items that were already done. A test pins that too. The work on an item has to be written so that doing it twice changes nothing (the idempotency of [chapter 08](/en/chapters/08-async.md)). This chapter's job leaves its checkpoint in the log and nowhere else. A real job writes it to S3 or DynamoDB, where the next run reads it by itself. [Chapter 16](/en/chapters/16-long-jobs.md) covers that shape.

**The same image with a different command.** The job gets a task definition of its own. The image is the service's; only the command is replaced.

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{job}

The image is not split because, once the server and the job share code, it is easier when both are at the same version. The task role is separate from the service's. A permission added for the job, or for the service, then does not reach the other.

**Starting it on a schedule.** In [chapter 08](/en/chapters/08-async.md) EventBridge Scheduler invoked a Lambda function. It can call ECS RunTask as well.

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{schedule}

The target's `arn` is the cluster's ARN, and `ecsParameters` says which task definition to run in which subnets. The job can continue from where it stopped, so it runs on Spot alone.

The permissions of the schedule's role come from `grantRun`. Synthesized, they are `ecs:RunTask` on the job's task definition and `iam:PassRole` on the two roles the task uses (only when the role is passed to `ecs-tasks.amazonaws.com`), and a test pins both. `iam:PassRole` is needed because Scheduler starts a task with roles that carry permissions Scheduler itself does not have. The conditions in the trust policy are chapter 08's.

Three things to know about Scheduler.

- **All Scheduler knows is whether RunTask could be called.** The retry policy applies when the RunTask call itself fails. If the job it started fails, Scheduler does nothing. To notice a failed job you have to look yourself, at EventBridge's task state change events (a stopped task carries `stopCode` and `stoppedReason`) or at the container's exit code in `aws ecs describe-tasks`
- **Delivery is at least once.** The same scheduled time can start the job twice. The job has to survive two copies of itself running together
- **Some nights Spot has no capacity.** Whether RunTask then returns a failure or the task waits was not checked for standalone tasks

A Scheduler target can also carry an `Input`. What `Input` becomes for the ECS templated target could not be confirmed from the pages read, so this example does not use it. The job does not know which scheduled time it was started for.

**Running it once, with overrides.** To continue an interrupted job, or to run it once with a different count, you do not register a new task definition. RunTask can override the command, the environment variables, the CPU, and the memory of a container for that one run.

<<< @/examples/41-fargate/src/commands.ts{run-task}

`--client-token` is a name that makes the same call, made twice, start one task. The same token with different contents is an error. One RunTask call can start up to 10 tasks. The command is assembled and run by the following task; with `--dry-run` it is only printed.

```bash
vp run fargate:job:run --start-at 12 --dry-run
```

**Where chapter 16 takes over.** One task that can resume, and can wait for the next night when it fails, needs nothing more than Scheduler and a standalone task. When there are several steps, each with its own retries and waits, make the task one step of a Step Functions workflow as in [chapter 16](/en/chapters/16-long-jobs.md). When there are many jobs to queue and work through, AWS Batch in the same chapter fits. And work that fits in Lambda's 15 minutes has no reason to be a task at all.

## Network choices and their cost

<!-- section: 41.network -->

Chapter 12 showed three places to put tasks: in public subnets with a public IPv4 address each, in private subnets behind a NAT gateway, or in private subnets with interface endpoints. This chapter's stack takes the same `-c taskSubnets=private`.

Once the number of tasks moves, the comparison looks different. A public IPv4 address is USD 3.65 a month, and there is one per task: USD 21.90 at the ceiling of six. A NAT gateway, with its address, is a fixed USD 48.91 a month however many tasks there are (the data it carries is billed on top). On addresses alone, one NAT gateway costs about as much as thirteen tasks' addresses. Below thirteen tasks, public subnets are the cheaper choice. The reason to choose private subnets is not the price but that tasks then have no address the internet can reach. Chapter 12 already checked that, even with a public address, the security group lets in only what comes from the load balancer.

If the way out is endpoints, these are what a Fargate task needs, collected from the ECR and ECS documentation.

| For | Endpoint |
| --- | --- |
| Pulling the image | `ecr.dkr` and `ecr.api` (interface), `s3` (gateway) |
| Logs with awslogs | `logs` (interface) |
| ECS Exec | `ssmmessages` (interface) |
| `secrets` in the task definition | `secretsmanager` (interface; `ssm` for Parameter Store) |

ECR keeps image layers in S3, so the S3 gateway endpoint is needed too. Gateway endpoints are free. The endpoints for ECS itself (`ecs`, `ecs-agent`, `ecs-telemetry`), which tasks on EC2 need, are not required for Fargate tasks according to the documentation.

One interface endpoint in two Availability Zones is USD 20.44 a month. The three in chapter 12's table (USD 61.32 a month) cover the image pull and the logs, and nothing else. ECS Exec adds one, and passing secrets adds one. Unlike a NAT gateway, endpoints are a way out whose fixed cost grows with every feature you use. Chapter 11's stack takes more of them, as in `-c interfaceEndpoints=ecr.api,ecr.dkr,logs,ssmmessages`.

The nightly job runs in the same subnets and behind the same security group as the service's tasks. In public subnets it too has a public IPv4 address for as long as it runs.

## ECS Exec

<!-- section: 41.exec -->

Fargate has no server to SSH into. **ECS Exec** is the way to run a command inside a running container. It goes through Systems Manager Session Manager: ECS brings the agent's programs into the container and runs them there.

It is convenient, and in this chapter's stack it is off by default. Only `exec=true` in the context switches it on.

<<< @/examples/41-fargate/infra/bin/app.ts{context}

<<< @/examples/41-fargate/src/config.ts{schema}

CDK context arrives as text, so anything other than `true` or `false` is an error rather than a silent `false`.

Switching it on adds three things to the stack.

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{exec}

The first is four actions on the task role. Chapter 12 drew the line between the task execution role, "used by ECS before your code runs", and the task role, "used by your code". The ECS Exec agent talks to Systems Manager from inside the container, standing where your code stands, so the permission belongs on the task role. These four actions take no resource, so their `Resource` is `*`. In the default configuration the whole stack has one `*`, on `ecr:GetAuthorizationToken`, and a test pins that.

The second is `EnableExecuteCommand` on the service. The service construct has a property of the same name, which is not used here. In a local synthesis that property added, besides the four actions, permission to write logs to every log group to the task role. This chapter grants the four actions the documentation says are needed and no more.

The third is a change in the task definition.

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{task}

The reasons for leaving it off are all here. According to the documentation, ECS Exec has these properties.

- **Commands run as root.** The agent and its child processes are root even when the container names a user. Chapter 12's image runs as the user `node`; whoever comes in through ECS Exec is root
- **It does not work with a read-only root file system.** The agent writes to the container's file system. The `readonlyRootFilesystem` that chapter 12 set has to go when Exec is on. The stack always sets the two as opposites of each other, and a test pins it
- **It cannot be turned on for running tasks.** Only tasks started afterwards have it. Deploying with the flag replaces every task. A task whose state you wanted to look at is gone at that point
- **A session ends after 20 idle minutes.** That time cannot be changed

Who came in and when is recorded in CloudTrail as an `ExecuteCommand` event. The commands and their output can be logged to CloudWatch Logs or S3. By default, the documentation says, they go where the task definition's awslogs configuration sends logs; whether that needs further permissions on the task role was not checked. For production, name the log group in the cluster's configuration and grant the permissions the documentation lists on that log group alone.

Who may come in is a matter for the caller's IAM policy. `ecs:ExecuteCommand` can be limited by cluster, by a task's tags, and by container name (`ecs:container-name`). Beyond that, the condition key `ecs:enable-execute-command` lets a policy deny creating a service or task with ECS Exec enabled at all. In a production account the safe default is the latter, as an organization-wide policy, so that it cannot be enabled ([chapter 21](/en/chapters/21-security.md)).

The nightly job does not get ECS Exec. Its task role is not the service's, so the flag changes nothing about what the job may do.

The command is assembled by the next function, which first checks that the task ID contains nothing but a task ID.

<<< @/examples/41-fargate/src/commands.ts{exec}

The AWS CLI on your machine needs the Session Manager plugin. The Systems Manager documentation says the plugin is required to start Session Manager sessions from the AWS CLI. Whether the AWS CLI in this book's devShell has it was not checked.

## Operating decisions

<!-- section: 41.operate -->

This section adds no code, only how to decide. This chapter's stack leaves each of these at its default.

**Secrets.** Chapter 12's container takes its settings from environment variables. A password or an API key written there directly is visible to everyone who can read the task definition. With `secrets` in the task definition you give the name of an environment variable and the ARN of a Secrets Manager secret (or a Parameter Store parameter), and ECS fetches the value and passes it when the container starts. A Secrets Manager ARN can be followed by a JSON key and a version.

The permission to read goes on the task execution role, not the task role, because it is ECS that fetches the value and not your code. If the secret is encrypted with a key of your own, `kms:Decrypt` is needed as well ([chapter 21](/en/chapters/21-security.md) covers secrets and keys).

The value is passed once, when the container starts. After a rotation, running tasks keep the old value. To hand out the new one, force a new deployment and let the tasks be replaced. Right after a rotation, tasks with the old and the new value run side by side. For a database password, the old one has to stay valid for a while.

**Health checks.** Chapter 12 used the load balancer's health check and no container health check. So does this chapter. The load balancer's check reaches the task along the path requests take. A container health check runs a command inside the container (by default every 30 seconds, with a 5-second timeout and 3 retries). A service's task is stopped and replaced when either one finds it unhealthy. A task that belongs to no service keeps running even when unhealthy.

For a service behind a load balancer, the load balancer's check is enough. A container health check is for services without one, such as workers reading a queue, and its command has to be in the image. With both, there are two reasons a task may be replaced and two places to look when you ask why.

**Logs.** The awslogs log driver has an option named `mode`. In `blocking` mode, writes to standard output stall while CloudWatch Logs cannot be reached, and the application can stop responding. In `non-blocking` mode, logs collect in a memory buffer (`max-buffer-size`) and what overflows is dropped. On 2025-06-25 ECS changed the default from `blocking` to `non-blocking`. This chapter's stack does not set `mode`, so when logs cannot be delivered the application keeps running and log lines go missing.

For ordinary application logs that default is fine. If records that must not go missing (an audit trail, or the basis for billing) are written to standard output, think about sending those records somewhere other than a log before you go back to `blocking`.

FireLens routes logs to places other than CloudWatch Logs (other AWS services, or a partner's), by running a container such as Fluent Bit inside the same task. The CPU and memory that container uses come out of the task's size. If logs only go to CloudWatch Logs, awslogs is enough.

## Limits, and slow starts

<!-- section: 41.limits -->

[Chapter 32](/en/chapters/32-limits.md) covers how to think about quotas. Here are the ones a growing Fargate service meets first. The numbers were read on 2026-10-13 and will change. Check them in the Service Quotas console or on the ECS "endpoints and quotas" page.

**vCPUs in use at once.** Each Region has one quota for the vCPUs running on on-demand Fargate and another for those on Spot. Both default to 6, and both can be raised on request. New accounts, the page says, may start lower. This chapter's ceiling (six tasks of 0.25 vCPU, 1.5 vCPU in all) is well within it, but six tasks of 1 vCPU reach the default. When you set a ceiling for auto scaling, check this quota with it. What a service looks like when it reaches the quota was not checked.

**How fast tasks can start.** Fargate limits task launches per account and Region. In Tokyo that is up to 100 at once, refilled at 20 a second. A service can start up to 500 tasks a minute, and RunTask takes 20 calls a second. None of this matters at this chapter's scale. For a batch that starts hundreds of tasks together, it is the first limit to bite.

**How long a start takes.** As the overview said, Fargate does not reuse an image between tasks. Each task pulls and unpacks the whole image when it starts. The documentation says the time to pull is directly correlated with the time to start. Billing also begins when the image pull begins.

The documentation names these ways to start faster.

- A smaller image. Chapter 12's image has the application as one file and no `node_modules`
- The image in ECR in the same Region as the task
- zstd compression, which unpacks faster
- More vCPUs for the task, since unpacking uses CPU

There is also lazy loading with SOCI (Seekable OCI). With an index attached to the image, Fargate starts the container without waiting for the whole image. On 2026-10-13 it is available for Linux tasks on platform version 1.4.0. The image has to be in an ECR private repository and compressed with gzip or not at all (zstd does not work), and anyone starting now has to use index format v2. The documentation recommends trying it for images above 250 MiB compressed. This chapter's image is small and does not use it. zstd and SOCI cannot be chosen together.

As the scale-out model showed, the time a task takes to start decides how many requests the service cannot serve when load rises. The size of the image is not a build detail. It is part of the auto scaling design.
