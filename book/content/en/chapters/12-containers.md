---
title: "12 Containers: ECR, ECS/Fargate, and ALB"
sourceRevision: 1
---

# 12 Containers: ECR, ECS/Fargate, and ALB

Chapter 11 gave you a network. In this chapter, something that runs all the time moves in for the first time.

You'll take the notes API from chapter 04, turn it into a container as a plain Node.js HTTP server, run two copies on ECS on Fargate, and put them behind an Application Load Balancer (ALB). Then you'll replace them with a new version without stopping the service.

Money first. Most chapters so far cost nothing while nobody called them. This one is different. **While the service runs, it costs about USD 0.069 an hour, USD 1.65 a day, and USD 50.33 if you leave it for a month, even if nobody calls it** (Tokyo, the default layout; the breakdown is under "What it costs"). That is the load balancer, two tasks, and four public IPv4 addresses. When you're done trying it, please go all the way to "Cleaning up" the same day.

You need the VPC from [chapter 11](/en/chapters/11-network.md) and the app from [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/12-containers/`.

## When is a container the right call?

<!-- section: 12.when -->

The Lambda function in chapter 04 ran only when it was called and cost nothing otherwise. If that is enough for you, there is no reason to move to containers. Let's get that out of the way.

You pick a container when your work doesn't fit Lambda's shape.

- One piece of work takes long. A Lambda invocation runs for 15 minutes at most, and an API Gateway HTTP API stops waiting after 30 seconds
- You want connections that stay open: WebSockets, or a pool of database connections that is reused ([chapter 13](/en/chapters/13-sql.md)). Anything that assumes the process lives across requests
- You have a server and want to run it as it is: an app that already ships as a container image, or one that depends on another language or on OS packages
- The calls never pause. If you're always busy, there is a point where paying for the time something exists gets cheaper than paying for the time it is called. (Where that point is depends on your load. This book doesn't compute it.)

By the way, if all you want is to ship a container image, Lambda can do that too. Lambda can build a function from an image, and those images live in ECR, the same place this chapter uses. Packaging as an image and running all the time are two separate choices.

What you give up is just as clear: the zero while idle. And you now decide how many copies run, how they are replaced, and what happens when one is stopped. Most of the second half of this chapter is about that.

## The big picture

<!-- section: 12.architecture -->

```figure
caption: The Application Load Balancer spreads requests over tasks in two zones. The security group lets through only that traffic, and the VPC, subnets, and route tables are read from chapter 11's stack AihNetwork through Fn::ImportValue
node client: Client | curl, later the SPA
node alb: Application Load Balancer | Public1 + Public2, one node and one public IPv4 per zone
node tg: target group | target type: ip, GET /health every 10 s
node t1: task | zone 1a, in Public1 by default
node t2: task | zone 1c, in Public2 by default
node ecr: ECR repository | image tags are immutable
node logs: CloudWatch Logs | kept 7 days
edge client -> alb: HTTP :80, no certificate (no domain name)
edge alb -> tg: listener :80
edge tg -> t1: HTTP :8080
edge tg -> t2
edge t1 -> ecr: HTTPS :443
edge t2 -> ecr
edge t1 -> logs
edge t2 -> logs: HTTPS :443
group svc: ECS service on Fargate: desired count 2, auto scaling 2..4 (CPU 60 %) = t1, t2
```

```figure
caption: Inside one task, the container keeps the notes in a Map, and the execution role is what pulls the image and writes the logs
node srv: container "api" | node server.mjs
node exec: execution role | pulls the image, writes the log stream
node role: task role | nothing
node app: Hono app
node svc: NoteService
node map: Map | one per task
edge srv -> app
edge app -> svc
edge svc -> map
group t: task: 0.25 vCPU, 0.5 GB, arm64, one network interface = srv, exec, role, app, svc, map
```

A few words to settle.

An **image** is your app packed together with every file it needs to run. **ECR** (Elastic Container Registry) is where images are kept.

A **task definition** is the blueprint: which image, how much CPU and memory, which roles. A **task** is one running thing started from it. A **service** is the instruction to keep two of these tasks running, and the machinery that keeps it true. It replaces tasks that die, and swaps them when the task definition changes.

**Fargate** means AWS runs the servers under those tasks. You could line up EC2 instances yourself instead; this chapter doesn't. I picked the option where the size of a task and the time it runs are all you have to think about.

The **ALB** is the HTTP entry point and spreads requests over the tasks behind it. The list of destinations is a **target group**.

Sizes and counts are decided here.

<<< @/examples/12-containers/src/config.ts{size}

256 is in "CPU units", where 1024 is one vCPU. Of the combinations Fargate offers, this uses 0.25 vCPU with 512 MiB.

One thing has not changed since chapter 04: the notes are still in memory. Two tasks means two `Map`s, and the load balancer routes round robin by default, so a note you created shows up every other time. Tasks are also replaced on every update, and each time everything is gone. It's the same story chapter 04 told about Lambda execution environments, only easier to see. Moving the data out of the task is the job of [chapter 05](/en/chapters/05-dynamodb.md) and [chapter 13](/en/chapters/13-sql.md). This chapter stays with the container around it.

## docker is two programs

<!-- section: 12.docker -->

Before the container work, let's clear up something that trips people.

The command you run by typing `docker` is a client. Building images and running containers is done by another, long-running program: the **daemon** (`dockerd`). The client only sends it requests. The two may even be on different machines.

Here is where that matters.

- You have the `docker` command and it says `failed to connect to the docker API ... check if the path is correct and if the daemon is running`. The client is there; no daemon is running. (That wording is what Docker CLI 29.7.2 printed on the machine this chapter was written on.)
- Installing the `docker` command starts nothing. The daemon comes from separate software such as Docker Desktop or Colima

This book's devShell (Nix) contains neither the client nor the daemon. Only the steps that build an image (`ecs:image:build`, `ecs:image:run`, `ecs:image:push`) need Docker Desktop or similar started separately.

Put the other way round: everything else works without Docker. Starting the server, the tests, checking the file that goes into the image, and CDK synthesis.

To be honest, no daemon was running on my machine while I wrote this chapter. So the image has never been built. The Dockerfile and the `docker` commands were written from primary sources and help output, not from running them. Please read on with that in mind.

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

## There are two roles

<!-- section: 12.roles -->

The Lambda function in chapter 04 had one execution role. An ECS task has two. The names are confusing, so let's sort them out here.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{roles}

The **task execution role** is used by the ECS agent **before** your code starts running. Pull the image from ECR. Open the log stream. That's all. Code inside the container can't use it.

The **task role** is what code inside the container uses when it calls AWS. This is the counterpart of a Lambda execution role.

Side by side with chapter 04:

| | Lambda (chapter 04) | An ECS task |
| --- | --- | --- |
| Permission for your code to call AWS | Execution role | Task role |
| Fetching the code and shipping logs | Lambda does it (logs are written with the execution role's permission) | Task execution role |

This app calls no AWS API at all, so the task role is empty. To connect it to the table from chapter 05 you would write `table.grantReadWriteData(taskRole)`. Granting it to the execution role would do nothing for the app. And putting the execution role's permissions on the task role would give the app permissions it has no use for.

CDK assembles the execution role's contents. `ecs.ContainerImage.fromEcrRepository` adds the pull from this repository, and `ecs.LogDrivers.awsLogs` adds writing to this log group.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{task}

A test checks that the policy is attached to the execution role only and that it allows exactly six actions. One of them, `ecr:GetAuthorizationToken`, has `*` as its resource. That is an exception to the "no `*`" rule kept since chapter 04: the action can't be limited to a repository. The test also pins that this is the only `*` in the stack.

`readonlyRootFilesystem` makes the container's file system read-only. This app writes nothing to disk, so nobody gets to.

## The service and the load balancer

<!-- section: 12.service -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{service}

<<< @/examples/12-containers/infra/lib/containers-stack.ts{load-balancer}

The listener is HTTP on port 80 only. HTTPS needs a certificate, and a certificate needs a domain name. This chapter has no domain name, so traffic is not encrypted. Don't send anything through it that must not be seen, such as the tokens from chapter 06.

### Health checks

The load balancer sends `GET /health` to every task registered in the target group at a fixed interval. A task that keeps failing stops receiving requests.

The default interval is 30 seconds; I set it to 10. A newly registered task counts as healthy after **one** success. (The 2 in `healthyThresholdCount` is the number of successes an unhealthy task needs to come back.) In the other direction, two failures in a row take a task out, so a broken task receives requests for about 20 seconds at the longest.

One behavior is worth knowing: what happens when every task is unhealthy. The load balancer doesn't decide there is nowhere to send requests. It sends them to all tasks (fail open). The reasoning: better to try tasks that may be working than to lose everything to a health check that is too strict.

### How the durations depend on each other

This chapter has a lot of "seconds" that depend on one another. Written in separate places they drift apart, so they are in one. The server and the stack both read it.

<<< @/examples/12-containers/src/timing.ts{timing}

What goes wrong when they disagree is a function too.

<<< @/examples/12-containers/src/timing.ts{rules}

The first rule is the 65 seconds from before. The load balancer reuses its connections to a task and closes one after 60 seconds without use. A Node.js server closes one after 5 seconds by default. If the server closes first, the load balancer sends a request into a connection it still believes is usable, and the request, with nowhere to go, becomes a 502. The AWS documentation also recommends making the application's timeout longer than the load balancer's. Hence 65.

<<< @/examples/12-containers/test/timing.test.ts{broken}

Types don't protect these relations. `serverKeepAlive: 5` is a `number` too. The tests check that the combination of values as shipped has no problem, and what is reported when one of them is changed. The stack test checks that the values in the template are the values in this table.

## What happens during an update

<!-- section: 12.rollout -->

Deploy with `-c imageTag=v2`, and the task definition is new and the service begins replacing tasks. This is a rolling update.

```figure
caption: In a rolling update with desired count 2, minimumHealthyPercent 100, and maximumPercent 200, the old tasks stop only after the new tasks pass their health check
type: sequence
actor old: old tasks (v1)
actor new: new tasks (v2)
actor req: requests | who answers
note old: 1: 2 running
step req -> old: 1: v1 v1
note new: 2: up to 2 starting (pull, boot)
step req -> old: 2: v1 v1
note new: 3: running, first health check ok
step req -> old: 3: v1 v1
step req -> new: 3: v2 v2 (both versions answer)
note old: 4: 2 draining
note old: v1 finishes what is in flight
note new: 4: 2 running
step req -> new: 4: v2 v2
note old: 5: stopped
note new: 5: 2 running
step req -> new: 5: v2 v2
```

```figure
caption: When the new tasks never get past step 3, the circuit breaker marks the deployment as failed and rolls back to the last COMPLETED one
type: sequence
actor old: old tasks (v1)
actor new: new tasks (v2)
note old: 3': 2 running
step new -x new: 3': start or health check fails, 3 times
note old: 4': 2 running
note new: 4': circuit breaker: deployment FAILED
step new --> old: 4': rolled back to the last COMPLETED
```

`minimumHealthyPercent: 100` says: never fewer than two healthy tasks. `maximumPercent: 200` says: up to four may run while replacing. Together they fix the order: start new tasks before stopping old ones. With 50 and 100 it would be the other way round, stop one and then start one, which needs no extra task but halves the capacity on the way.

The **deployment circuit breaker** is there for 3' and 4'. When new tasks keep failing to start, or to pass health checks, it declares the update failed. How many failures it takes is half the number of tasks (at least 3, at most 200). With two tasks that is 3. Because `rollback: true` is set, it goes back to the last state that worked by itself.

Without it, the update goes on without ever being declared failed.

Please remember one thing it can't do. The circuit breaker looks at whether tasks started and whether they passed health checks. A version that answers `/health` with 200 and `/notes` with 500 is a kind of broken it does not see. The next section breaks things in exactly that way.

### When a task is stopped

Here is what "draining" in step 4 consists of.

```figure
caption: To stop a task, ECS first takes it out of the load balancer, then sends SIGTERM, and sends SIGKILL if the process is still there
type: sequence
actor ecs: ECS and the load balancer
actor srv: the server in the task
step ecs -> ecs: t0: ECS decides to stop the task
note ecs: task: DEACTIVATING, target: draining
note ecs: no new requests go to this target
note srv: still answers what is in flight
step ecs -> ecs: t0+?: connections gone, or 30 s passed
note ecs: deregistrationDelay = 30
step ecs -> srv: t1: task: STOPPING, SIGTERM
step srv -> srv: logs "draining"; stops listening
step srv -> srv: closes idle keep-alive connections
step srv -> srv: finishes what is still in flight
step srv -> srv: logs "stopped"; exits with 0
step srv -> srv: t1+25: deadline: cuts the rest; exit 1
step ecs -> srv: t1+30: SIGKILL if still there
note ecs: stopTimeout = 30
```

First out of the load balancer, then SIGTERM. Thanks to that order, new requests should already have stopped coming by the time SIGTERM arrives.

The **deregistration delay** is how long the load balancer waits for requests in flight on a task it has decided to remove. The default is 300 seconds. That is up to five minutes of waiting for every task that is stopped, so I cut it to 30 seconds, on the assumption that this app's requests take 10 seconds at most. If you have long requests, such as file uploads or streaming, cutting it too far cuts them off.

"Then graceful shutdown isn't needed?" you might think. It is. Requests longer than the deregistration delay are still there, and as you saw, the process can't finish unless keep-alive connections are cleaned up. Work that doesn't come through a load balancer (queue processing, as in [chapter 08](/en/chapters/08-async.md)) has no first half at all.

To be honest, I read this order off the sequence of task states in the ECS documentation (deregistration during DEACTIVATING, then SIGTERM in STOPPING). I have not run it and compared log timestamps. A task for checking it is ready.

```bash
vp run ecs:watch
```

It calls `/health` once a second and keeps printing which version answered. Leave it running in a second terminal while you deploy, and you'll see the time during which v1 and v2 are mixed, and that not a single request fails. (It shouldn't.)

## Old and new run side by side

<!-- section: 12.versions -->

Back to line 3 of the first diagram. There is a time when v1 and v2 both answer. It may be tens of seconds, or minutes with many tasks. And if a rollback happens, there comes a time when v1 reads what v2 wrote.

If there is data outside the tasks, both versions read and write it.

This chapter's invariant in one sentence: **"Every version that is running can read every record written by any version that is running."**

Let's make it concrete. Say v2 adds a field named `pinned` to notes.

<<< @/examples/12-containers/src/compat.ts{formats}

`v1` and `v2` are a pair that works. v1 silently drops fields it doesn't know, and v2 fills a missing field with a default.

`v2Required` and `v1Strict` both look like the careful way to write it, and both break the update.

For the tests there is a stand-in for data that lives outside the tasks.

<<< @/examples/12-containers/src/compat.ts{store}

What is stored is JSON text, and each task reads and writes it through the schema of its own version. With DynamoDB items, SQL rows, or queue messages, the same things happen.

Then two real HTTP servers are started at the same time.

<<< @/examples/12-containers/test/versions.test.ts{rollout}

```figure
caption: The records outlive every task, so v1 and v2 end up reading the records each other wrote
type: sequence
actor v1: task running v1
actor rec: records | outlive every task
actor v2: task running v2
step v1 -> rec: t1 POST /notes
note rec: {id,title,body,createdAt}
step v2 -> rec: t2 POST /notes
note rec: {..., pinned:false}
step rec --> v1: t3 GET /notes: reads both
note v1: drops "pinned"
step rec --> v2: t4 GET /notes: reads both
note v2: fills pinned=false
note v2: t5 rollback: v2 stops
step rec --> v1: t5 still reads what v2 wrote
```

The two that break, break like this.

**The new version requires a field that old records don't have (`v2Required`).** A `GET /notes` that reaches a v2 task becomes a 500. One that reaches a v1 task succeeds, so what users see is "it fails every other time". And `/health` still answers 200. Neither the load balancer nor the circuit breaker notices. The test checks, side by side, that the health check passes and that the list fails.

**The old version rejects a field it doesn't know (`v1Strict`).** From the moment v2 writes one record, the v1 tasks can't read. Rolling back in a hurry doesn't fix it. The v2 code goes away, but the record v2 wrote stays.

From this come rules about order.

- To **add** a field, add it as optional and fill in a default when reading. Make sure old versions can ignore fields they don't know
- To **make a field required**, wait until no version that doesn't write it runs anywhere, and until old records have been filled in. Adding and requiring are two separate deploys
- To **remove or rename** a field, never do it in one step. Add the new name, write both, switch the readers, then remove the old one

These rules are not specific to ECS. Any mechanism that replaces things without stopping has a time when old and new live together. Putting two tasks side by side and replacing them one after the other only made it visible.

One caveat: deploy this sample and there is no data that tasks share (the notes are still in memory). In the deployed environment, the only thing both versions touch for now is the user. The `x-app-version` values alternating in `ecs:watch` are exactly that. `SharedRecords` in the tests exists to show you, locally and ahead of time, what happens once you connect the data stores from chapter 05 or 13.

## More tasks, fewer tasks

<!-- section: 12.scaling -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{scaling}

This is **target tracking**. You only say "keep the average CPU utilization of the service at 60%" and leave the number of tasks to it. A bit like the temperature setting on an air conditioner.

Two metrics are commonly used.

**CPU utilization.** This is the one the sample uses. It suits apps that get busy computing. Node.js handles requests on one thread, so a 0.25 vCPU task that runs out of CPU starts queueing at once. I wanted more tasks early, hence the target of 60%.

**Requests per target** (`ALBRequestCountPerTarget`). The number of requests per task, as counted by the load balancer. An app that spends most of its time waiting for a database or an external API keeps an idle CPU even when it is busy, so this metric matches reality better. It is not in the sample, because you can't choose the target value before measuring how many requests one task can handle.

You can attach both. Then the service scales out if either one says "more", and scales in only when all of them say "fewer is fine". Out fast, in carefully: that's the design.

The upper bound of 4 is also an upper bound on the bill. One more task costs USD 12.65 a month in a public subnet. Pinned at four, this stack's fixed cost is USD 75.62 a month. Adding auto scaling without an upper bound is the same as accepting a bill without one.

When a scale-in removes a task, it is stopped the same way as during an update: out of the load balancer, SIGTERM, SIGKILL after `stopTimeout`. Graceful shutdown pays off here too. By the way, scale-in is paused while a deployment is in progress (scale-out is not).

To be honest, I have not tried auto scaling under load. I only checked that it ends up in the template.

## Checking things locally

<!-- section: 12.local -->

Here is everything so far that needs neither Docker nor AWS.

```bash
vp run test:unit
vp run ecs:bundle:check
vp run ecs:infra:synth
vp run ecs:infra:synth -c imageTag=v1
```

The tests look at four places.

| Where | File | What it checks | What it doesn't |
| --- | --- | --- | --- |
| The process | `test/shutdown.test.ts` | That SIGTERM lets the request in flight finish before the exit | How signals arrive inside a container, the order ECS sends things in |
| Versions together | `test/versions.test.ts` | That old and new read the same records, and the two ways to break that | A real data store, the load balancer's routing |
| Settings and durations | `test/timing.test.ts`, `test/config.test.ts`, `test/compose.test.ts` | How the durations relate, tag validation, the `docker` command lines | That those values really prevent 502s |
| Infrastructure | `infra/test/containers-stack.test.ts` | Permissions, the ways in, the replacement settings, no hourly resources without a tag | That AWS behaves as the template says |

Let's also be clear about what is not reproduced locally.

- Building the image, and starting it as a container
- Whether Fargate can fetch the image (route and permissions)
- The load balancer's routing and health checks
- How rolling updates, the circuit breaker, and auto scaling actually behave
- That cdkd creates the resources as the template says

About cdkd, I read the source of the pinned version (0.296.28). Of the 15 resource types this stack uses, cdkd has its own implementation for 12: the ECS cluster, task definition, and service; the load balancer, listener, and target group; the ECR repository; the security group and its ingress rule; the IAM role and policy; the log group. The other three, `AWS::ApplicationAutoScaling::ScalableTarget`, `AWS::ApplicationAutoScaling::ScalingPolicy`, and `AWS::EC2::SecurityGroupEgress`, go through Cloud Control API. A test pins the list of types, and that the stack uses only properties the dedicated implementations handle.

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
