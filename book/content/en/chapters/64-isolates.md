---
title: "64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS"
sourceRevision: 1
---

# 64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS

The app in [chapter 04](/en/chapters/04-http-api.md) is a function that takes a `Request` and returns a `Response`. Cloudflare Workers runs functions of the same shape, and its runtime is published under the name workerd. This chapter runs workerd in your own AWS account and puts chapter 04's app on it without changing a line. Then it works out which of the jobs the Workers platform used to do are now yours.

What this chapter builds **is billed by the hour just for existing**. A load balancer and one Fargate task cost about USD 1.24 a day and USD 37.68 a month (730 hours) with no requests at all. The default layout is an image repository and nothing else; the hourly resources appear only when you deploy with an image tag. Go on to [cleanup](/en/chapters/64-isolates/wrap.md) the same day you try it.

workerd was really started on the machine this chapter was written on (macOS, arm64). Chapter 04's app ran in it and was called, and the tests run against that real binary. The container image, on the other hand, was never built, and nothing was deployed to AWS. The Linux build of workerd was downloaded and inspected, not run. The details are in the [verification notes](/en/chapters/64-isolates/wrap.md) at the end of the chapter.

You need chapter 04's notes API, the VPC from [chapter 11](/en/chapters/11-network.md), and the container stack from [chapter 12](/en/chapters/12-containers.md). The part about requests in flight sharing module scope continues [chapter 35](/en/chapters/35-lambda-managed-instances.md). The code is in `examples/64-isolates/`.

## What workerd is

<!-- section: 64.what -->

workerd's README describes it as a JavaScript and Wasm server runtime based on the same code that powers Cloudflare Workers. It names three uses: an application server for self-hosting applications designed for Workers, a tool for local development and testing, and a programmable HTTP proxy. The license is Apache License 2.0.

The README carries one warning in bold. In its own words:

> `workerd` is not a hardened sandbox. `workerd` tries to isolate each Worker so that it can only access the resources it is configured to access. However, `workerd` on its own does not contain suitable defense-in-depth against the possibility of implementation bugs. When using `workerd` to run possibly-malicious code, you must run it inside an appropriate secure sandbox, such as a virtual machine.

The example in this chapter runs chapter 04's app, which you wrote, and nothing else. Running other people's code is ruled out, once the next section has laid out where the boundaries are.

What was confirmed on 2026-10-13:

- **Distribution.** Prebuilt binaries are distributed through npm. The `workerd` package brings the one per-platform package that fits the machine (darwin-arm64, darwin-64, linux-arm64, linux-64, windows-64). Linux arm64 is among them, so it fits the arm64 Fargate tasks the other chapters use
- **Versions.** A version number is a date. According to the README it is the newest compatibility date that version supports. This chapter pins 1.20261012.1, published on 2026-10-12
- **Requirements.** On Linux the README asks for glibc 2.35 or newer (Ubuntu 22.04, Debian 12). On macOS it asks for 13.5 or newer
- **Configuration.** One file in Cap'n Proto text format. It lists the workers (services), the sockets to listen on, and the bindings each worker receives
- **Compatibility.** Each worker names a compatibility date. The README promises that a newer workerd does not change how a worker with an older date behaves

The pinned version is written in one place in the repository.

<<< @/examples/64-isolates/src/release.ts{release}

`version` is the same value as the devDependency in `package.json`, and a test checks that the two agree. npm brings the binary for the machine you develop on, but the image needs the Linux arm64 binary whatever that machine is. So that archive is pinned separately, by size and digest.

## What an isolate separates, and what it does not

<!-- section: 64.isolate -->

An isolate is a unit of execution that V8 creates inside one process. Cloudflare's documentation says that each isolate's memory is completely isolated, that one runtime can run hundreds or thousands of isolates, and that because no virtual machine is created per function, the cold starts of the virtual machine model are gone. On speed and memory it says that an isolate starts around a hundred times faster than a Node process on a container or virtual machine, and on startup consumes an order of magnitude less memory. Those are Cloudflare's figures; this book did not measure them.

Set beside the units from earlier chapters, the difference is what each shares with its neighbour. Processes share the operating system's kernel. A container is a process whose view the kernel has narrowed, and it still shares the kernel. Of a Fargate task, AWS's documentation says that each has its own isolation boundary and does not share the underlying kernel, CPU resources, memory resources, or elastic network interface with another task. An isolate shares the most of all. The process, the thread, and V8 itself are the same as its neighbour's; the only thing kept apart is the memory V8 manages. [Chapter 67](/en/chapters/67-firecracker.md) makes the comparison with microVMs included.

Cloudflare puts strangers' code side by side in one process on top of this thin boundary. According to its security model page, it can do so because it stacks the following outside the isolates:

- A sandbox around the whole process. Linux namespaces and seccomp prohibit all access to the file system and the network, and another process mediates every exchange with the outside
- Separating Workers of different trust levels into different processes (cordons), and moving some Workers into a process of their own
- Defenses against Spectre. While code runs, the value of `Date.now()` is locked in place, and no other timers and no threads are provided
- A release process that puts a new runtime into production within 24 hours of a V8 security fix being published

The same page concedes that V8 has a wider attack surface than virtual machines.

What is in the workerd repository is the isolate and runtime part of that. The outer layers are not. The README's warning points at that gap. One part of the gap showed in the workerd run locally: inside a worker that held the CPU for two seconds, the clock kept moving (see "The limits workerd does not enforce" in [Design and Build](/en/chapters/64-isolates/build.md)).

What a self-hoster has to add is what the README says: a boundary like a virtual machine around the workerd process. In this chapter's design the Fargate task plays that part. But a Fargate task separates one task from another. Workers loaded into the same workerd process are still kept apart by isolates alone. Code that does not trust each other must not share a process.

## What you give up by leaving the platform, and what stays

<!-- section: 64.leave -->

What stays is the code. Chapter 04's app relies only on web-standard APIs such as `Request`, `Response`, `URLPattern`, and `fetch`, and on `randomUUID` from `node:crypto`. workerd has both, so the app's files are not touched. All that [Design and Build](/en/chapters/64-isolates/build.md) writes is a three-line entry point and a configuration file.

What you give up is everything that was outside the runtime.

- **The global network.** Workers code runs in Cloudflare's locations around the world. The workerd in this chapter runs in one task in the Tokyo Region
- **What bindings lead to.** workerd's configuration has binding kinds for KV, R2, and Queues. According to the comments in its schema, though, they only turn operations into HTTP requests aimed at a service you name in the configuration. The stores themselves are not in workerd, so you provide them. There is no binding kind called D1 in this version's schema
- **Durable Objects across machines.** Durable Objects run inside workerd. Their storage is in memory or on a local disk marked experimental, and the schema says that objects are always local to one instance of the runtime. workerd has nothing that keeps one object across several machines. celld in [chapter 24](/en/chapters/24-celld.md) is a different runtime that takes on that part itself
- **Limits per request.** Workers fails a request that exceeds its CPU time limit and replaces an isolate that exceeds its memory limit. workerd enforces neither
- **Deploy tooling and observability.** There is no `wrangler deploy` and no Workers Logs. In their place you use a container image, an ECS service that replaces tasks, and CloudWatch Logs
- **The speed of security fixes.** To take in a V8 fix, you raise the workerd version, rebuild the image, and deploy it
- **The shape of the bill.** A price per request becomes a price per hour for a task and a load balancer

The AWS counterpart of a binding is an IAM role and the SDK. To put an app that uses DynamoDB or S3 on workerd, you would have to check that the SDK runs on workerd and decide how credentials reach it. This chapter covers only chapter 04's app, which keeps notes in memory, and did not check that far.

## The design on AWS

<!-- section: 64.architecture -->

```figure
caption: workerd is one process inside a Fargate task, and hands each request from the load balancer to the worker its configuration ties to the socket
node client: Client
node alb: ALB | HTTP :80
node workerd: workerd | socket http, *:8080
node notes: notes worker | chapter 04's app, isolate
node ecr: ECR repository | workerd + config + bundle
node logs: CloudWatch Logs
edge client -> alb: HTTP
edge alb -> workerd: requests, /health
edge workerd -> notes: fetch(request, env)
edge ecr --> workerd: image pull
edge workerd --> logs: standard output
group task: Fargate task (arm64) = workerd, notes
mark workerd
```

The candidates for where workerd runs were the EC2 instance of [chapter 23](/en/chapters/23-ec2.md) and Fargate from chapter 12. There are four reasons for choosing Fargate.

The first is the requirement. The prebuilt workerd binary asks for glibc 2.35 or newer. Amazon Linux 2023, the operating system of chapter 23's instance, has glibc 2.34 according to AWS's documentation. The Linux arm64 binary that was downloaded does refer to symbols of version `GLIBC_2.35`. Starting it on Amazon Linux 2023 was not tried, but there is no reason to choose a place that does not meet the requirement. In a container, making Debian 12 the base image is all it takes.

The second is isolation. As the previous section showed, the workerd process needs a boundary around it. A Fargate task is a unit for which AWS provides that boundary.

The third is replacement. workerd has `--watch`, which watches the configuration and reloads it, but its help text says it is not recommended in production. What the README shows for production is systemd opening the sockets and handing them to workerd. Neither describes a way to load new code into a running process without downtime. So a new version starts as a new process and takes the place of the old one. The ECS service and load balancer of chapter 12 already do that replacement.

The fourth is logs. workerd writes the lines a worker passes to `console.log` to its standard output. A container's standard output reaches CloudWatch Logs with the same setting as in chapter 12.

The design does not put CloudFront in place of the load balancer. Spreading requests over tasks and carrying replacements with health checks is the load balancer's job, so if you use CloudFront, the distribution from [chapter 03](/en/chapters/03-spa.md) goes in front of the load balancer.

The stack is nearly chapter 12's, and takes the same three settings through CDK context.

<<< @/examples/64-isolates/src/config.ts{config}

<<< @/examples/64-isolates/infra/bin/app.ts{context}

A deploy without `imageTag` creates only the repository. Chapter 12's caution applies here too. `-c` lasts for one run only, so if you deploy without `-c imageTag=...` after the service exists, cdkd sets out to delete the load balancer and the service.

## When self-hosting fits, and when it does not

<!-- section: 64.when -->

If Workers is enough, staying on Workers is the good choice. Locations around the world, bindings, limits per request, and the layers of defense are none of them in the workerd binary. At a small load Workers is also cheaper. In the example of 15 million requests a month, Workers costs USD 8.00 and this chapter's design costs USD 39.02 (see [Costs](/en/chapters/64-isolates/wrap.md)).

If all you want is the same app on AWS, the Lambda function of chapter 04 comes first. The code is the same, and nothing is billed just for existing.

Reasons to run workerd yourself all the same could be these:

- You want code written for Workers to run next to data inside a VPC
- You want the production runtime on your machine and in CI. For this alone no AWS is needed; the [Run It Locally](/en/chapters/64-isolates/local.md) page is enough
- You have to decide yourself which country and which network the data stays in
- You want to run many small workers you wrote yourself together in one process

In none of these is this chapter's design enough for taking in code other people wrote and running it. [Chapter 63](/en/chapters/63-agent-sandbox.md) builds an environment for that out of a different unit.

Of similar runtimes in the open, only one was checked for existence and upkeep. Supabase Edge Runtime is a server based on Deno; its README calls itself beta software and describes a main runtime that proxies and user runtimes that execute users' code. Its latest release was on 2026-10-01. It does not run the Workers API as it is, and it was not tried for this chapter. celld in chapter 24 is another runtime, for Workers and Durable Objects applications.
