---
title: "41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec"
sourceRevision: 1
---

# 41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec

[Chapter 12](/en/chapters/12-containers.md) put the notes API in a container, ran two of them on Fargate, and replaced them without stopping the service. This chapter picks up there. It covers what a team decides once the service is running: how large a task is, how much discounted capacity (Fargate Spot) to use, what drives the number of tasks up and down, how to run a task that is not a service, and how to look inside a running container.

Like chapter 12's stack, this one costs money just by existing. **While it is deployed with an image tag, it costs about USD 0.069 an hour, USD 1.65 a day, and USD 50.35 a month, whether or not anyone calls it** (Tokyo, default configuration; the breakdown is under [Cost](/en/chapters/41-fargate/wrap.md)). That pays for the load balancer, two on-demand tasks, and four public IPv4 addresses, almost exactly what chapter 12's default costs. If auto scaling took the service to its ceiling of six tasks and left it there for a month, the bill would be bounded by USD 100.93. When you have finished trying it, go on to [Cleanup](/en/chapters/41-fargate/wrap.md) the same day. If chapter 12's stack is still running you are paying for both; take chapter 12's back to "no tag" first.

You need the VPC from [chapter 11](/en/chapters/11-network.md), the server from [chapter 12](/en/chapters/12-containers.md), and the way of thinking about long work from [chapter 16](/en/chapters/16-long-jobs.md). The code is in `examples/41-fargate/`. It does not copy chapter 12's code; it imports it as a workspace dependency.

## What you decide once the service runs

<!-- section: 41.when -->

Chapter 12's stack left most decisions at their defaults. Its tasks are the smallest size Fargate offers, all on demand, and their number moves between 2 and 4 by CPU utilization alone. That is enough for practice. A service that takes real load has each of those decided again, with a reason.

These are the decisions this chapter covers, and what each is based on.

- **The size of a task.** CPU and memory come as pairs from a fixed table. A function picks the cheapest pair in the table that holds a measured peak with the headroom you state
- **Which capacity it runs on.** Fargate Spot is cheaper, and AWS can stop its tasks with two minutes' notice. The tasks the service cannot do without stay on demand; part of what is added goes to Spot
- **What moves the count.** A local model follows target tracking, to see how long capacity lags behind load and what has to hold so that scaling in does not cut requests in flight
- **Tasks that are not services.** A job that runs once a night and ends is started by EventBridge Scheduler from the same image
- **A way into a running container.** ECS Exec is switched on only by a context flag, and is off by default

Some things are left to other chapters. Blue/green and canary deployments and the circuit breaker are in [chapter 31](/en/chapters/31-progressive-delivery.md). The same container on Kubernetes, including Fargate profiles on EKS, is in [chapter 34](/en/chapters/34-eks.md). Tuning on the Lambda side is in [chapter 29](/en/chapters/29-lambda-tuning.md) and [chapter 35](/en/chapters/35-lambda-managed-instances.md).

If you do not have a service yet, read chapter 12 first. And if Lambda is enough for your application, you need none of these decisions. The [cost section](/en/chapters/41-fargate/wrap.md) works out the load at which Fargate becomes the cheaper of the two.

## The whole picture

<!-- section: 41.architecture -->

```figure
caption: The service's tasks are split across two capacity providers. The two it cannot go below run on on-demand Fargate; what auto scaling adds goes one to three with Fargate Spot
node client: Client
node alb: Application Load Balancer | deregistration delay 30 s
node od: Two tasks | FARGATE, base 2
node spot: Added tasks | FARGATE and FARGATE_SPOT, 1 to 3
node aas: Application Auto Scaling | CPU 60 %, 600 requests/min per task
node cw: CloudWatch | one-minute metrics
edge client -> alb: HTTP :80
edge alb -> od
edge alb -> spot
edge od --> cw
edge alb --> cw: RequestCountPerTarget
edge cw --> aas: alarm
edge aas -> spot: desired count 2..6
group svc: ECS service = od, spot
mark aas
```

```figure
caption: The nightly job is a standalone task: the service's image with a different command. EventBridge Scheduler calls RunTask, and the task is gone when it ends
node sch: EventBridge Scheduler | daily at 03:00 Asia/Tokyo
node role: Schedule role | ecs:RunTask and iam:PassRole
node job: Task "job" | node job.mjs, FARGATE_SPOT
node ecr: ECR repository | server.mjs and job.mjs
node logs: CloudWatch Logs | kept 7 days
edge sch -> role: AssumeRole
edge sch -> job: RunTask
edge job -> ecr: image pull
edge job -> logs: progress and exit code
```

First, what has not changed since chapter 12. The task size (0.25 vCPU, 512 MiB, arm64), the load balancer and target group settings, and the durations for health checks and stopping are chapter 12's `TASK` and `timing`, imported as they are. The server is chapter 12's file. What this chapter adds is code that changes the conditions it runs under.

These values are new.

<<< @/examples/41-fargate/src/config.ts{scaling}

The number of tasks moves between 2 and 6. `STRATEGY` says which capacity tasks go to. Its `base` is 2, the same as the minimum, so the two tasks the service never goes below always run on on-demand Fargate. A test pins that the two numbers agree.

The image goes to a repository of its own, not chapter 12's, because it holds the nightly job (`job.mjs`) next to chapter 12's server (`server.mjs`). As in chapter 12, a deploy without a tag creates the repository and nothing that is billed by the hour.

Notes are still in the memory of each task. With more tasks, a note is visible on fewer of the requests that ask for it. Moving data out of the task is the subject of [chapter 05](/en/chapters/05-dynamodb.md) and [chapter 13](/en/chapters/13-sql.md), not of this one.

## What is underneath a task

<!-- section: 41.underneath -->

On Fargate you do not see the server a task runs on, and you do not need to. There are three things to know about it all the same, because each is a reason a task will stop one day.

The first is that every task has an environment of its own. The ECS documentation says each Fargate task has its own isolation boundary and does not share the kernel, CPU, memory, or network interface with another task. The page on image pulls adds that each task runs on its own single-use, single-tenant instance. That design has a cost beyond the price. A task cannot reuse an image that an earlier task pulled, so every task pulls the whole image when it starts. [Build, Continued](/en/chapters/41-fargate/more.md) comes back to slow starts.

The second is the **platform version**: the version of the kernel and container runtime a task runs on. On 2026-10-13 the only one available for Linux is 1.4.0, which is also what `LATEST` means (1.3.0 was deprecated on 2026-06-15). Within 1.4.0 there are revisions, a new one for each round of fixes. A running task is never moved to a new revision. Tasks started afterwards run on it.

The third is how old revisions leave. When a new revision exists, AWS stops the tasks that run on the old one. This is called **task retirement**. The notice arrives in the AWS Health Dashboard and by email, and by default tasks start being stopped seven days later. The account setting `fargateTaskRetirementWaitPeriod` changes the wait to 0, 7, or 14 days. There is no way to opt out.

What happens at retirement depends on the kind of task.

- A service's tasks are replaced by the scheduler. With the settings of chapter 12 and this chapter (`minimumHealthyPercent` 100, `maximumPercent` 200) it starts a new task and waits for it to run before it stops an old one. If the replacement cannot be started, the old task is stopped without one
- A standalone task, one that belongs to no service, is only stopped. Nothing starts in its place

A fault in the underlying host is a separate case: the host is replaced without a notice.

So every Fargate task will be stopped from outside sooner or later, with or without a deployment or Spot. The server chapter 12 wrote, which finishes the requests in flight when it receives SIGTERM, is not only there for rollouts. Spot and scale-in in this chapter rely on the same mechanism. A standalone task that runs for a long time has to be able to continue from where it was stopped. This chapter's job is written that way.
