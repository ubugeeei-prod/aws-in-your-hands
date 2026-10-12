---
title: "41 Fargate: Deploy"
---

# 41 Fargate: Deploy

## Deploying

<!-- section: 41.deploy -->

The steps on this page have never been run against AWS. The commands and their order were put together from chapter 12's steps and from the source of the pinned cdkd. Billing by the hour starts partway through, so take them one at a time.

If chapter 12's stack still has its service, take it back to "no tag" first. There is no reason to run two services of the same shape.

```bash
vp run ecs:infra:deploy
```

If chapter 11's VPC does not exist, deploy it. In its default layout it costs nothing.

```bash
vp run net:infra:deploy
```

Deploy this chapter's stack without a tag. Only the repository is created.

```bash
vp run fargate:infra:deploy
```

Build the image and push it. This is the step that needs a Docker daemon. Use a tag such as `f1` that does not collide on your machine with chapter 12's images (`v1`, `v2`).

```bash
vp run fargate:bundle
vp run fargate:image:build f1
vp run fargate:image:push f1
```

Deploy with the tag. **Billing starts with this deploy.**

```bash
vp run fargate:infra:diff -c imageTag=f1
vp run fargate:infra:deploy -c imageTag=f1
```

When it finishes, `ServiceUrl` shows the load balancer's URL. The check is chapter 12's.

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
```

Which capacity a task runs on is in its `capacityProviderName`. The two default tasks should both say `FARGATE`. Look at the auto scaling settings and at the alarms Application Auto Scaling created as well. The alarms' names are in the policy's `Alarms`. Their `EvaluationPeriods` and `Period` are the real values of what the model had to assume: how many minutes it takes.

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
aws ecs describe-tasks --cluster <ClusterName> --tasks <task id> --region ap-northeast-1 --query "tasks[].capacityProviderName"
aws application-autoscaling describe-scaling-policies --service-namespace ecs --region ap-northeast-1
aws cloudwatch describe-alarms --alarm-names <AlarmName> --region ap-northeast-1
```

The job starts every day at 03:00 Japan time. To check it without waiting, run it once. That one run is billed for at least a minute too.

```bash
vp run fargate:job:run
vp run fargate:job:run --start-at 12 --on-demand
```

When the task whose ARN was printed has stopped, look at its exit code. 0 means it finished; 75 means it was stopped partway.

```bash
aws ecs describe-tasks --cluster <ClusterName> --tasks <task id> --region ap-northeast-1 --query "tasks[].{stopCode: stopCode, reason: stoppedReason, exit: containers[0].exitCode}"
```

To try ECS Exec, deploy again with the flag. Every task is replaced, and the container's root file system becomes writable. When you are done, deploy again without the flag to put things back.

```bash
vp run fargate:infra:diff -c imageTag=f1 -c exec=true
vp run fargate:infra:deploy -c imageTag=f1 -c exec=true
vp run fargate:exec <task id>
vp run fargate:infra:deploy -c imageTag=f1
```

A `-c` applies to that one command only. As in chapter 12, a deploy without `-c imageTag=...` deletes the load balancer and the tasks. A deploy without `-c exec=true` puts ECS Exec back to off, which is the safe direction to slip in.

The drift check is chapter 02's.

```bash
vp run fargate:infra:drift
```

With auto scaling at work, read drift with care. Application Auto Scaling rewrites the service's desired count, so the 2 in the template and the real number differ. That difference is intended. Whether a new deploy puts the count back to 2 is something chapter 12 could not check either, and it is still unconfirmed here.
