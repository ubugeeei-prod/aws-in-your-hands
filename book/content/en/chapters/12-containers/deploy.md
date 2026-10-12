---
title: "12 Containers: Deploy"
---

# 12 Containers: Deploy

## Deploying

<!-- section: 12.deploy -->

Hourly charges start in this section. The order matters, so one step at a time.

First the chapter 11 VPC, in its default layout. This is free.

```bash
vp run net:infra:deploy
```

Next, deploy without a tag. Only the repository is created.

```bash
vp run ecs:infra:deploy
```

Build the image and push it. This is where you need a Docker daemon.

```bash
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

`ecs:image:push` reads the repository URI from the stack's outputs, pipes the output of `aws ecr get-login-password` into `docker login` on standard input, then tags the image and pushes it. The login is valid for 12 hours.

Then deploy with the tag. **Billing starts here.**

```bash
vp run ecs:infra:diff -c imageTag=v1
vp run ecs:infra:deploy -c imageTag=v1
```

This book's deploy task passes `--full-wait` to cdkd, so it waits until the service is stable. According to cdkd's documentation, the load balancer takes 90 to 180 seconds to become usable, and the wait for the service is capped at 600 seconds. When it finishes, `ServiceUrl` shows a URL of the form `http://xxxx.ap-northeast-1.elb.amazonaws.com`.

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
vp run ecs:watch
vp run ecs:logs
```

If `x-app-version: v1` comes back, you have reached the server inside the image.

Next, replace it without stopping. Keep `ecs:watch` running in a second terminal while you do.

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run ecs:infra:deploy -c imageTag=v2
```

Here's the catch, the same as in chapter 11: `-c` applies to that one command only. Forget `-c imageTag=...` on a deploy and the load balancer and the tasks show up as resources to delete. Handy as a way to stop; a way to go down if you do it by accident. Pass the same `-c` to `diff` and look first.

The drift check is the same as in chapter 02.

```bash
vp run ecs:infra:drift
```

To be honest, I have not been able to run the commands in this section against real AWS yet. The path that chapter 11 called "the first thing to run when chapter 12 is written", reading the VPC through `Fn::ImportValue` from a stack in another app, is still unverified too. And there is one more thing I don't know. When the task definition changes, cdkd registers a new revision, updates the service, and deregisters the old revision. Whether the `--full-wait` wait reports success or failure when the circuit breaker rolls back, I could not tell from the source. The revision that a rollback returns to is the one cdkd deregisters in that sequence. After deploying a broken image, don't judge by cdkd's output alone: look at `rolloutState` with `aws ecs describe-services`.
