---
title: "12 Containers: Deploy"
---

# 12 Containers: Deploy

## Deploying

<!-- section: 12.deploy -->

Hourly charges start partway through this page. The order of the steps matters, so take them one at a time.

First, deploy the VPC from chapter 11. In its default setup it costs nothing.

```bash
vp run net:infra:deploy
```

Next, deploy without a tag. Only the repository is created.

```bash
vp run ecs:infra:deploy
```

Build the image and push it. This is the step that needs a Docker daemon.

```bash
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

`ecs:image:push` reads the repository URI from the stack's outputs, pipes the output of `aws ecr get-login-password` into `docker login` on standard input, then tags the image and pushes it. The login is valid for 12 hours.

Finally, deploy with a tag. **Billing starts with this deploy.**

```bash
vp run ecs:infra:diff -c imageTag=v1
vp run ecs:infra:deploy -c imageTag=v1
```

This book's deploy commands pass `--full-wait` to cdkd, so they wait until the service is stable. According to the cdkd documentation, the ALB takes 90 to 180 seconds to become usable, and the wait for the service is capped at 600 seconds. When the deploy finishes, `ServiceUrl` shows a URL of the form `http://xxxx.ap-northeast-1.elb.amazonaws.com`.

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
vp run ecs:watch
vp run ecs:logs
```

If `x-app-version: v1` comes back, the request reached the server inside the image.

Now replace v1 with v2 without stopping the service. Keep `ecs:watch` running in another terminal and run these commands.

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run ecs:infra:deploy -c imageTag=v2
```

As in chapter 11, `-c` applies only to the one command it is given to. If you deploy and forget `-c imageTag=...`, the ALB and the tasks are deleted. That is a convenient way to stop the hourly charges, and it stops the service if you do it by accident. Pass the same `-c` to `diff` and look at the changes first.

You can also name the image by digest instead of by tag. Pass `-c imageDigest=sha256:...` in place of `-c imageTag=v2`, and the task definition points at the image by its digest, and `x-app-version` is the digest too. A value that is not `sha256:` followed by 64 lowercase hex digits, or a digest given together with `imageTag`, is refused at synth. [Chapter 52](/en/chapters/52-ecr.md) explains why a deployment should name its image by digest and how to find the digest of an image you pushed.

The drift check is the same as in chapter 02.

```bash
vp run ecs:infra:drift
```

The commands in this section have not yet been run against real AWS. The path that chapter 11 called "the first thing to run when writing chapter 12", reading the VPC with `Fn::ImportValue` from another app's stack, is also still unconfirmed.

One point about cdkd's behavior is unknown too. When the task definition changes, cdkd registers a new revision, updates the service, and deregisters the old revision. I could not tell from the source whether the `--full-wait` wait reports success or failure when the circuit breaker rolls back. The revision that the rollback returns to is the one cdkd deregisters in that procedure. After deploying a broken image, do not rely on cdkd's output alone. Check `rolloutState` with `aws ecs describe-services`.
