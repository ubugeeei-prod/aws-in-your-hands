---
title: "12 Containers: Design and Build"
---

# 12 Containers: Design and Build

## From a handler to a server that keeps running

<!-- section: 12.server -->

The app in chapter 04 was written from the start to receive everything it needs as arguments. Thanks to that, the app itself needs not a single changed line.

<<< @/examples/12-containers/src/compose.ts{compose}

`createApp` is imported from chapter 04 as it is. Only two things were added around it.

<<< @/examples/12-containers/src/compose.ts{wrap}

`quietHealth` is a wrapper that keeps successful health checks out of the log. The load balancer calls `/health` every 10 seconds, from its node in each zone, for each task. Log all of them and most of your log is health checks. Failed ones are kept.

`withVersion` adds an `x-app-version` header to every response. Its value is the image tag. During an update two versions answer at the same time, and you'll want to see which one just did.

There are two more environment variables.

<<< @/examples/12-containers/src/env.ts{env}

And this is the entry point.

<<< @/examples/12-containers/src/server.ts{main}

The difference from a Lambda handler shows in the final `for`. With Lambda you rarely had to care when your function stops. A process that keeps running **decides for itself how it is stopped**. That's the next section.

Let's run it. Copy `examples/12-containers/.env.example` to `.env` in the same place.

<<< @/examples/12-containers/.env.example

```bash
vp run dev:ecs
```

```bash
curl -si http://localhost:8080/health
curl -s -X POST http://localhost:8080/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8080/notes
```

The first response should carry `x-app-version: dev` and `Keep-Alive: timeout=65`. The reason for 65 comes later. Stop it with Ctrl-C and two lines, `draining` and `stopped`, appear in the log before it exits.

## Decide how you are stopped

<!-- section: 12.shutdown -->

ECS stops tasks all the time: to replace them with a new version, to scale in, after failed health checks. Each time it sends the process in the container a signal called **SIGTERM**. It is a request: please finish. Then it waits for `stopTimeout` (30 seconds by default on Fargate, 120 at most) and, if the process is still there, sends SIGKILL. That one can't be refused.

If you wrote nothing to handle SIGTERM, requests in flight are not protected. If the process ends on the spot, their connections are cut with no response. And a Node.js process that runs as the very first process in a container (PID 1) does not react to signals it has no handler for, according to the documentation of the Node.js Docker image. In that case you wait 30 seconds and SIGKILL does the same thing.

What you want is this: take no new requests, answer the ones in flight to the end, then exit. That is called graceful shutdown.

<<< @/examples/12-containers/src/serve.ts{serve}

`server.close()` stops accepting new connections and waits for the responses in progress. The Node.js example in the ECS documentation is exactly that one line.

It turned out not to be enough, though. This is something I only learned by trying.

The load balancer reuses its connections to a task (keep-alive). `server.close()` closes connections that are idle at the moment it is called, but a connection that was in the middle of a response stays open as an idle connection once that response is out. Until the other side closes it or the keep-alive timeout passes, the server can't finish. This sample sets keep-alive to 65 seconds, so left alone, the 30 seconds of `stopTimeout` would come first.

That is what `sweep` is for. It keeps closing connections as they become idle, at short intervals. There is also a safety net: past a deadline (25 seconds) the rest is cut, and the result is reported as `forced`. The exit code differs as well: 0 for `drained`, 1 for `forced`.

The test really starts the process and sends it SIGTERM. No Docker.

<<< @/examples/12-containers/test/shutdown.test.ts{sigterm}

It took a small trick. I wanted the state "in the middle of a request" without relying on sleeps. So the test sends only the headers, with `Expect: 100-continue`. Once the server answers `100 Continue`, the request has certainly arrived and the server is waiting for the body. In that state the test sends SIGTERM, waits for the `draining` log line, and only then sends the body. The response is a 201 with the note in it, and after that the process exits with code 0. The order is fixed, so every run gives the same result.

Take `sweep` out and this test fails: `forced` where `drained` was expected. That is how I found the problem above.

Other tests check that an idle keep-alive connection doesn't hold the shutdown up, that work which never finishes is cut at the deadline and reported as `forced`, and that a second signal is the same one shutdown.

## Build the image

<!-- section: 12.image -->

One file goes into the image.

<<< @/examples/12-containers/scripts/bundle.ts{bundle}

```bash
vp run ecs:bundle
vp run ecs:bundle:check
```

esbuild puts the server and all of its dependencies, Hono and Zod included, into `dist/server.mjs` (about 860 KiB when this was written). It's what `NodejsFunction` did during synthesis in chapter 04; here you do it yourself.

`ecs:bundle:check` copies that file to a place with no `node_modules`, starts it, calls `/health`, and checks that SIGTERM leads to exit code 0. The image gets this very file, so "a dependency is missing inside the container" is caught here, before Docker is involved.

Here is the Dockerfile.

<<< @/examples/12-containers/Dockerfile

Short, isn't it. The reasons, in order.

**It is not multi-stage.** The Dockerfiles you usually see install dependencies and build in a first stage, then copy only the result into a second one. That keeps build tools out of the final image. This sample builds outside the image, so there is nothing to leave behind. Building outside is fine here for two reasons: Nix and the lockfile pin the versions of the tools, and the result is pure JavaScript that doesn't depend on the OS or CPU of the machine that built it. With a dependency that contains native modules it's a different story, and you need a stage that builds inside the same OS and CPU the image will run on.

**It doesn't run as root.** `USER node` switches to an unprivileged user that the base image already has. Port 8080 is used for the same reason: a process can listen on it without privileges.

**There is no `HEALTHCHECK`.** If there were, ECS would not look at it: it ignores a health check embedded in an image and only monitors one written in the task definition. You could write one there, but a check from inside the container tells you less than the load balancer checking from outside, over the same path real requests take. So the load balancer's health check is the only one.

**`CMD` is written as an array.** Write `CMD node server.mjs` and `/bin/sh -c` sits in between, so SIGTERM goes to the shell. The shell doesn't pass it on to node, your graceful shutdown never runs, and SIGKILL arrives 30 seconds later.

There is a `.dockerignore` too. It makes `dist/server.mjs` the only thing sent to the daemon for a build, so no source and no `.env` can slip into the image.

With a daemon running, you can build the image and run it locally.

```bash
vp run ecs:image:build v1
vp run ecs:image:run v1
```

The build passes `--platform linux/arm64`, because the task definition asks for arm64. If you build on an x86 machine, the daemon has to be set up to produce arm64 images. To see the commands without running them, append `--dry-run`.

To repeat: I have not been able to run these two.

## Where the image is kept

<!-- section: 12.registry -->

A built image only exists inside the daemon on your machine. It has to go where Fargate can fetch it: an ECR repository.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{repository}

**Tags are immutable.** The tag `v1` can never point at a different image later. Push the same tag again and ECR refuses. "`v1` is running" then means exactly one thing, so you can say for sure what a replacement or a rollback will do. Not using `latest` has the same reason, and the settings schema rejects it.

<<< @/examples/12-containers/src/config.ts{schema}

The lifecycle rule keeps the ten newest images and deletes older ones. Images left lying around are billed for storage.

### Why it is deployed in two steps

Look at the `return`. Without `-c imageTag=...`, the stack is the repository and nothing else.

<<< @/examples/12-containers/infra/bin/app.ts{context}

A service goes for its image as soon as it starts. Create the service while the repository is still empty and the tasks keep failing to start, and the deploy fails after waiting as long as it is allowed to. So the order is split.

1. Deploy without a tag. Only the repository is created
2. Build the image and push it
3. Deploy with `-c imageTag=v1`. Now, and only now, the load balancer and the tasks are created

This shape comes with a bonus. Deploy without a tag again and the load balancer and the tasks disappear, while the repository and its images stay. You can stop the hourly charges and keep the images.

### Why not `ecs.ContainerImage.fromAsset`

CDK has `ecs.ContainerImage.fromAsset`: hand it a directory and it takes care of everything from build to push. Convenient, and I didn't use it.

Here is what I found. With the pinned version (aws-cdk-lib 2.273.0), synthesis succeeds without Docker even with `fromAsset`. All synthesis does is copy the directory into `cdk.out` and write a list saying "this image goes into this repository". Docker is needed at deploy time. Reading the source of cdkd (0.296.28): during a deploy it runs `docker build`, `docker tag`, and `docker push`, and the destination is a shared repository named `cdkd-container-assets-<account>-<region>`, created by `cdkd bootstrap`. The tag is a hash of the content.

So with `fromAsset`, every deploy needs a daemon, you don't choose the tag, and the image goes into a shared repository. In this chapter I wanted you to go through the repository, the login, the push, and the tag by hand once, so they are separate. For production deploys from CI, `fromAsset`, or passing the digest of an image that CI pushed, is often the easier way.

## Which subnet do the tasks live in?

<!-- section: 12.network -->

The chapter 11 VPC is fetched by name. `importNetwork` is the function chapter 11 provides; everything becomes an `Fn::ImportValue`, so synthesis asks AWS nothing.

Now, a Fargate task fetches its image from ECR when it starts. ECR's entry point is outside the VPC, and in chapter 11's default layout the private subnets had no route out. There are three ways.

| Where the tasks are | What chapter 11 adds | Billed by the hour (per month) |
| --- | --- | --- |
| Public subnets, a public IP on each task | Nothing | Two public IPv4 addresses for the tasks: USD 7.30 |
| Private subnets | `-c egress=nat` | A NAT gateway and its Elastic IP address: USD 48.91 |
| Private subnets | `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` | Three interface endpoints in two zones: USD 61.32 |

The third way needs three endpoints because pulling the image uses `ecr.api` and `ecr.dkr`, and shipping logs uses `logs`. The contents of the image (its layers) come from S3, and those go through the gateway endpoint that chapter 11 creates by default.

**The default is the first one.** The reason is cost. I didn't want to add USD 49 or USD 61 a month of idle charges to a practice setup.

"A public IP on a task, is that all right?" you may ask. What decides which traffic gets in is not whether there is a public IP. It's the security group.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{firewall}

The tasks' security group has not a single inbound rule written here. Later, when the service is attached to the load balancer, CDK adds exactly one: port 8080 from the load balancer's security group. Hit a task's public IP directly from the internet and nothing arrives. A test checks that this one rule is the only way in.

Outbound is port 443 only. ECR, S3, and CloudWatch Logs all speak HTTPS. Name resolution (DNS) is traffic that security groups don't look at, so it needs no rule.

Even so, the first way is the simple layout. Every task holds a public IPv4 address, so more tasks cost more. Some organizations forbid putting applications in public subnets at all. When that applies, switch.

```bash
vp run ecs:infra:deploy -c imageTag=v1 -c taskSubnets=private
```

In that case, deploy chapter 11 with a NAT gateway or the endpoints first. If you don't, the tasks can't fetch the image and keep failing to start.
