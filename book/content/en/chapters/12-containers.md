---
title: "12 Containers: ECR, ECS/Fargate, and ALB"
sourceRevision: 3
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

256 is in "CPU units", where 1024 is one vCPU. Of the combinations Fargate offers, this uses 0.25 vCPU with 512 MiB. `MAX_CONNECTIONS` caps how many connections one task holds at once. With only 512 MiB of memory, it is worth putting a lid on how much a task can be holding.

One thing has not changed since chapter 04: the notes are still in memory. Two tasks means two `Map`s, and the load balancer routes round robin by default, so a note you created shows up every other time. Tasks are also replaced on every update, and each time everything is gone. It's the same story chapter 04 told about Lambda execution environments, only easier to see. A task keeps at most 100 notes: the cap on chapter 04's repository applies here unchanged. Unlike a Lambda execution environment, a task keeps running, so without a cap its memory would fill up for as long as someone kept POSTing. Moving the data out of the task is the job of [chapter 05](/en/chapters/05-dynamodb.md) and [chapter 13](/en/chapters/13-sql.md). This chapter stays with the container around it.

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
