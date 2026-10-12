---
title: "12 Containers: ECR, ECS/Fargate, and ALB"
sourceRevision: 5
---

# 12 Containers: ECR, ECS/Fargate, and ALB

Chapter 11 built a network. This chapter puts the first thing on it that keeps running while nobody is calling it.

You take the notes API from chapter 04, package it as a Node.js HTTP server in a container, run two copies on ECS on Fargate, and put them behind an Application Load Balancer (ALB). Then you replace them with a new version without stopping the service.

Most chapters so far cost nothing when nobody called them. This one does not work that way. **While the service is running, it costs about USD 0.069 an hour, USD 1.65 a day, and USD 50.33 if you leave it for a month, even with no requests** (Tokyo, default setup; the breakdown is in [What it costs](/en/chapters/12-containers/wrap.md)). That pays for the ALB, two tasks, and four public IPv4 addresses. When you have finished trying it, go through [Cleaning up](/en/chapters/12-containers/wrap.md) the same day.

You need the VPC from [chapter 11](/en/chapters/11-network.md) and the app from [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/12-containers/`.

## When a container is the right choice

<!-- section: 12.when -->

The Lambda function in chapter 04 ran only when it was called and cost nothing when it was not. If that is enough for you, there is no reason to move to containers.

Choose a container when what you are building does not fit the shape of Lambda.

- One piece of work takes a long time. A Lambda invocation can last 15 minutes at most, and an API Gateway HTTP API stops waiting well before that, at 30 seconds
- You want to keep connections open. WebSockets, and a pool that reuses database connections ([chapter 13](/en/chapters/13-sql.md)), assume a process that stays alive across requests
- You want to run a server you already have. That covers apps that are already container images and apps that depend on another language or on operating system packages
- The calls never stop. If the service is always busy, there is a load above which paying for the time it exists is cheaper than paying for the time it is called. Where that point lies depends on your load, and this book has not calculated it

If all you want is to ship a container image, Lambda can do that too. Lambda can create a function from an image, and the image is kept in ECR, the same place this chapter uses. Packaging as an image and keeping a process running are separate choices.

With a container you give up the zero cost of idle time. You also decide for yourself how many copies run, how they are replaced, and what happens when one is stopped. Most of the second half of this chapter is about those decisions.

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
node app: Chapter 04's app
node svc: NoteService
node map: Map | one per task
edge srv -> app
edge app -> svc
edge svc -> map
group t: task: 0.25 vCPU, 0.5 GB, arm64, one network interface = srv, exec, role, app, svc, map
```

A few terms from the figures first.

An **image** is your app packaged together with every file it needs to run. **ECR** (Elastic Container Registry) is where images are kept.

A **task definition** says which image to run, with how much CPU and memory, and under which role. A **task** is a running copy started from a task definition. A **service** is the instruction to keep two tasks running at all times, together with the machinery that enforces it: when a task dies the service starts another, and when the task definition changes the service replaces the tasks.

**Fargate** means AWS runs the servers under the tasks. You can also run your own EC2 instances for that, which this chapter does not cover. With Fargate you only have to think about the size of a task and how long it runs, and that is why the sample uses it.

The **ALB** is the HTTP entry point and spreads requests over the tasks behind it. The list of tasks it sends to is a **target group**.

The size and number of tasks are set here.

<<< @/examples/12-containers/src/config.ts{size}

The 256 is in CPU units, where 1024 is one vCPU. Of the combinations Fargate offers, the sample uses 0.25 vCPU and 512 MiB. `MAX_CONNECTIONS` caps how many connections one task holds at a time. With only 512 MiB of memory, the task needs a limit on how much it holds at once.

One thing has not changed since chapter 04: the notes are still in memory. Two tasks mean two `Map`s, and because the ALB takes turns between tasks by default, a note you create shows up on only every other call. Tasks are replaced on every update, so every update also erases all the notes. This is what chapter 04 showed about Lambda execution environments, and here it is easier to see.

Each task holds at most 100 notes, because the limit in chapter 04's repository layer still applies. Unlike a Lambda function, a task keeps running, so without a limit its memory would fill by however much was POSTed. Moving the data out of the task is the subject of [chapter 05](/en/chapters/05-dynamodb.md) and [chapter 13](/en/chapters/13-sql.md). This chapter looks only at what the app runs in.

## docker is two programs

<!-- section: 12.docker -->

One point trips people up before containers even come into it.

The command that runs when you type `docker` is a client. Building images and running containers is done by a separate long-running program, the **daemon** (`dockerd`), and the client only sends it requests. The two can be on different machines.

The difference matters in these cases.

- You have the `docker` command and it prints `failed to connect to the docker API ... check if the path is correct and if the daemon is running`. The client is there and no daemon is running. (This is the actual message from Docker CLI 29.7.2 on the machine this chapter was written on.)
- You installed the `docker` command and nothing runs. The daemon comes from separate software such as Docker Desktop or Colima

This book's devShell (Nix) contains neither the client nor the daemon. The steps that handle the image (`ecs:image:build`, `ecs:image:run`, `ecs:image:push`) need Docker Desktop or similar started separately.

Everything else works without Docker: starting the server, running the tests, checking the file that goes into the image, and the CDK synth.

No daemon was running on my machine while I wrote this chapter, so the image has never been built. The Dockerfile and the `docker` commands were written from primary sources and the help output, and they have not been run.
