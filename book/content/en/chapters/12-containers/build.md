---
title: "12 Containers: Design and Build"
---

# 12 Containers: Design and Build

This page turns the app from chapter 04 into a server that keeps running, packages it as an image, puts the image in ECR, and decides which subnets the tasks go in. Roles, the load balancer, and what happens during an update are on [the next page](/en/chapters/12-containers/more.md).

## From a handler to a server that keeps running

<!-- section: 12.server -->

The app in chapter 04 was written to take everything it needs as arguments, so the app itself does not change by a single line.

<<< @/examples/12-containers/src/compose.ts{compose}

`createApp` is imported from chapter 04 as it is. The only additions are two functions that wrap the app.

<<< @/examples/12-containers/src/compose.ts{wrap}

`quietHealth` keeps successful health checks out of the log. The ALB calls `/health` every 10 seconds, from its node in each zone, for each task, and logging every one would fill the log with health checks. Failed health checks are still logged.

`withVersion` adds an `x-app-version` header to each response. Its value is the image tag. During an update two versions answer at the same time, and the header lets you tell from a response which one answered.

There are two more environment variables.

<<< @/examples/12-containers/src/env.ts{env}

This is the server's entry point.

<<< @/examples/12-containers/src/server.ts{main}

The difference from a Lambda handler is in the `for` at the end. With Lambda you rarely had to think about when the function stops. A process that keeps running **decides for itself how it behaves when it is stopped**. The next section covers how.

To run it locally, first copy `examples/12-containers/.env.example` to `.env` in the same directory.

<<< @/examples/12-containers/.env.example

```bash
vp run dev:ecs
```

```bash
curl -si http://localhost:8080/health
curl -s -X POST http://localhost:8080/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8080/notes
```

The first response carries `x-app-version: dev` and `Keep-Alive: timeout=65`. The reason for 65 seconds is in [How the durations depend on each other](/en/chapters/12-containers/more.md) on the next page. When you stop the server with Ctrl-C, it logs two lines, `draining` and `stopped`, and then exits.

## What the server does when it is stopped

<!-- section: 12.shutdown -->

ECS stops a task whenever it replaces a version, scales in, or sees health checks fail. To stop it, ECS sends the signal **SIGTERM** to the process in the container, which asks it to exit, and waits for `stopTimeout` (30 seconds by default on Fargate, 120 at most). If the process is still running after that, ECS sends SIGKILL, which the process cannot refuse.

If you write no handling for SIGTERM, requests in flight are not protected. When the process exits on the spot, clients lose their connection without getting a response. Node.js running as the first process in a container (PID 1), on the other hand, does not react to a signal it has no handler for, according to the documentation of the Node.js Docker image. In that case the task waits 30 seconds, receives SIGKILL, and the result is the same.

What you want is for the server to stop taking new requests, answer the ones in flight to the end, and then exit. That is called a graceful shutdown.

<<< @/examples/12-containers/src/serve.ts{serve}

`server.close()` stops accepting new connections and waits for the responses in flight to finish. The Node.js example in the ECS documentation is this one line too.

When I tried it, `server.close()` alone was not enough. The ALB reuses its connections to a task (keep-alive). `server.close()` closes the connections that are idle at the moment it is called, but a connection that was in the middle of a response stays open, idle, after that response ends. The server cannot exit until the other side closes it or the keep-alive timeout expires. This sample sets keep-alive to 65 seconds, so if nothing else is done, the 30 seconds of `stopTimeout` run out first.

`sweep` is a timer that deals with this by closing idle connections at short intervals. Past the deadline of 25 seconds, the server also cuts whatever is still open and reports `forced`. The exit code is 0 for `drained` and 1 for `forced`.

`maxConnections` has nothing to do with shutdown. It limits a task to 512 open connections and closes any connection beyond that without answering. A request body is at most 64 KiB, so the bodies being received at any moment add up to about 32 MiB at most. This setting does not limit the request rate. It limits memory use. While the connections are at the limit, the ALB's health checks compete for the same slots, so under a sustained flood a task can be judged unhealthy.

The test starts a real process and sends it SIGTERM, without Docker.

<<< @/examples/12-containers/test/shutdown.test.ts{sigterm}

The test had to create the state "in the middle of a request" without relying on a delay. It does that by sending only the headers first, with `Expect: 100-continue`. Once the server answers `100 Continue`, the request has certainly arrived and the server is waiting for the body. The test sends SIGTERM in that state, checks for the `draining` log line, and then sends the body. The response is a 201 with the note, and after it the process exits with code 0. Because the order is fixed, the test gives the same result on every run.

Run this test with `sweep` removed and it fails, because the result that should be `drained` becomes `forced`. That failure is how I found the problem with leftover keep-alive connections.

The other tests check that idle keep-alive connections do not delay the exit, that work which never finishes is cut at the deadline and reported as `forced`, and that a second signal joins the shutdown already under way.

## Build the image

<!-- section: 12.image -->

Only one file goes into the image.

<<< @/examples/12-containers/scripts/bundle.ts{bundle}

```bash
vp run ecs:bundle
vp run ecs:bundle:check
```

esbuild bundles the server and all its dependencies, such as Hono and Zod, into `dist/server.mjs` (about 860 KiB at the time of writing). In chapter 04 `NodejsFunction` did this during synth. Here you run it yourself.

`ecs:bundle:check` copies `dist/server.mjs` to a place with no `node_modules`, starts it, calls `/health`, and checks that SIGTERM ends it with exit code 0. This is the very file that goes into the image, so a dependency that cannot be found inside the container shows up in this check, before Docker is involved.

This is the Dockerfile.

<<< @/examples/12-containers/Dockerfile

It is short, for the following reasons.

**It is not multi-stage.** The Dockerfiles you usually see install dependencies and build in a first stage, then copy only the result into a second one, so that build tools stay out of the final image. This sample builds outside the image, so there are no tools to leave behind. Building outside is safe here because Nix and the lockfile pin the tool versions, and because the output is plain JavaScript that does not depend on the operating system or CPU of the machine that built it. If a dependency includes a native module, you need a stage that builds inside the same operating system and CPU as the one the image runs on.

**It does not run as root.** `USER node` switches to an unprivileged user that the base image already has. Port 8080 is used for the same reason: a process can listen on it without privileges.

**There is no `HEALTHCHECK`.** ECS ignores a health check embedded in an image and looks only at one written in the task definition. You could write one there, but a check made from inside the container tells you less than one the ALB makes from outside, along the same path as real requests. The sample uses only the ALB's health check.

**`CMD` is written as an array.** If you write `CMD node server.mjs`, `/bin/sh -c` sits in between and SIGTERM goes to the shell. The shell does not pass the signal on to node, so the graceful shutdown never runs and SIGKILL arrives 30 seconds later.

There is a `.dockerignore` as well. It limits what the build sends to the daemon to `dist/server.mjs`, so that neither the source nor `.env` ends up in the image.

With a daemon running, you can build the image and run it locally.

```bash
vp run ecs:image:build v1
vp run ecs:image:run v1
```

The build passes `--platform linux/arm64`, because the task definition asks for arm64. On an x86 machine, the daemon has to be set up to build arm64 images. To see the command without running it, add `--dry-run` at the end.

I could not run these two commands, because there was no daemon.

## Where the image is kept

<!-- section: 12.registry -->

An image you build exists only inside your local daemon. For Fargate to fetch it, it goes into an ECR repository.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{repository}

**Tags are immutable.** The tag `v1` can never point at a different image later, and if you push the same tag again, ECR refuses. "`v1` is running" then identifies exactly one image, so you can say what a replacement or a rollback will do. The sample avoids `latest` for the same reason, and the settings schema rejects it.

<<< @/examples/12-containers/src/config.ts{schema}

The lifecycle rule keeps the 10 newest images and deletes older ones, because stored images are billed for as long as they stay.

### Why the deploy has two steps

Look at the `return` in the code below. Without `-c imageTag=...`, this stack contains only the repository.

<<< @/examples/12-containers/infra/bin/app.ts{context}

A service tries to fetch its image as soon as it starts. If you create the service while the repository is empty, the tasks keep failing to start, and the deploy waits until its timeout and then fails. So the procedure is split into three steps.

1. Deploy without a tag. Only the repository is created
2. Build the image and push it
3. Deploy with `-c imageTag=v1`. The ALB and the tasks are created only now

The split gives you one more thing. If you deploy without a tag again, the ALB and the tasks are deleted and the repository and its images stay. That stops the hourly charges while keeping the images.

### Why not `ecs.ContainerImage.fromAsset`

CDK has `ecs.ContainerImage.fromAsset`, which takes a directory and handles everything from the build to the push. It is convenient, and this chapter does not use it.

I tried it on the pinned version (aws-cdk-lib 2.273.0), and synth passes without Docker even with `fromAsset`. Synth only copies the directory into `cdk.out` and writes a list of which image goes into which repository. Docker is needed at deploy time. According to the source of cdkd (0.296.28), the deploy runs `docker build`, `docker tag`, and `docker push`, and the image goes into a shared repository named `cdkd-container-assets-<account>-<region>`, which `cdkd bootstrap` creates. The tag is a hash of the content.

With `fromAsset`, then, every deploy needs a daemon, you do not choose the tag, and the image goes into a shared repository. I wanted you to go through creating the repository, logging in, pushing, and tagging by hand once, so this chapter keeps them separate. For production deploys from CI, `fromAsset`, or passing the digest of an image that CI pushed, is often easier.

## Which subnets the tasks go in

<!-- section: 12.network -->

The stack reads chapter 11's VPC by name. `importNetwork` is a function chapter 11 provides, and every value it returns is an `Fn::ImportValue`, so synth does not query AWS.

A Fargate task fetches its image from ECR when it starts. The ECR endpoints are outside the VPC, and in chapter 11's default setup the private subnets had no route out. There are three ways to place the tasks.

| Where the tasks are | What chapter 11 adds | Billed by the hour (per month) |
| --- | --- | --- |
| Public subnets, a public IP on each task | Nothing | Two public IPv4 addresses for the tasks: USD 7.30 |
| Private subnets | `-c egress=nat` | A NAT gateway and its Elastic IP address: USD 48.91 |
| Private subnets | `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` | Three interface endpoints in two zones: USD 61.32 |

The third option needs three endpoints because fetching the image uses `ecr.api` and `ecr.dkr`, and shipping logs uses `logs`. The image contents (the layers) come from S3, and that traffic goes through the gateway endpoint chapter 11 creates by default.

**The default is the first one.** The reason is cost. I did not want to add USD 49 or USD 61 a month of idle charges to a practice setup.

A public IP on a task does not make the task reachable from the internet. What decides the traffic that gets in is the security group, not whether there is a public IP.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{firewall}

The task's security group has no inbound rules written in it. When the service is attached to the ALB later, CDK adds exactly one: from the ALB's security group to port 8080. A call from the internet straight to a task's public IP does not arrive. A test checks that this rule is the only way in to the tasks.

Outbound, only port 443 is allowed, because ECR, S3, and CloudWatch Logs all use HTTPS. Name resolution (DNS) is traffic that security groups do not filter, so it needs no rule.

The first option is still the simple one. Each task has its own public IPv4 address, so the cost grows with the number of tasks, and some organizations forbid putting apps in public subnets at all. In that case, switch like this.

```bash
vp run ecs:infra:deploy -c imageTag=v1 -c taskSubnets=private
```

Before you switch, deploy chapter 11's stack with NAT or with the endpoints. Otherwise the tasks cannot fetch the image and keep failing to start.
