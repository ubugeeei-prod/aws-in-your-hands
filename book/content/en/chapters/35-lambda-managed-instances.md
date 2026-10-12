---
title: "35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose"
sourceRevision: 1
---

# 35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose

The Lambda function in [chapter 04](/en/chapters/04-http-api.md) ran only when it was called, and you paid for the time it ran. The EC2 instance in [chapter 23](/en/chapters/23-ec2.md) was billed for every hour it was up, and everything from the operating system upward was yours to look after. Lambda Managed Instances sits between the two. You write and deploy a function the way you always have, it runs on EC2 instances in your own account, and you pay for instance-hours.

In this chapter you put the notes API from chapter 04 on Lambda Managed Instances as it is. Almost none of the code has to change, but one assumption does. On standard Lambda an execution environment handled one request at a time. On Lambda Managed Instances it handles several at once. The code that breaks because of that, and how to fix it, is the centre of this chapter.

What this chapter creates is **billed by the hour just for existing**. The default layout costs about USD 8.87 a day and USD 269.77 a month (730 hours) without one request arriving. It is the most expensive practice stack in this book, so once you have tried it, go on to the [cleanup](/en/chapters/35-lambda-managed-instances/wrap.md) the same day. The figures assume that Lambda launches three instances, which was not checked on AWS.

You need the notes API from chapter 04, the VPC from [chapter 11](/en/chapters/11-network.md), and EC2 from chapter 23. Tuning standard Lambda, cold starts and memory included, is the subject of [chapter 29](/en/chapters/29-lambda-tuning.md). The code is in `examples/35-lambda-managed-instances/`.

## What Lambda Managed Instances is

<!-- section: 35.what -->

Lambda Managed Instances is the Lambda feature that runs functions on EC2 instances in a VPC of your own account. It was announced on November 30, 2025. Lambda launches the instances, patches the operating system and the runtime, routes requests, and scales. Ordinary EC2 operations, such as terminating an instance yourself, are not available on them. The AWS documentation calls the Lambda you already know "Lambda (default)" to tell the two apart. This chapter calls it standard Lambda.

The name you meet in the API and in templates is the capacity provider. A capacity provider holds the subnets and security groups the instances go into, the role Lambda uses to manage them, the instance types it may use, and a ceiling on vCPUs. It is `CreateCapacityProvider` in the API and `AWS::Lambda::CapacityProvider` in CloudFormation. On the function's side you write the capacity provider's ARN into `CapacityProviderConfig`, and the rest looks like any standard function.

This is what was confirmed as of 2026-10-13.

- **Regions.** Tokyo (`ap-northeast-1`) is one of the five Regions named at launch. The AWS Price List published on 2026-10-09 carries Lambda Managed Instances prices for 30 Regions, Tokyo among them. A published price and an available feature are two different facts, but both hold for Tokyo, so this chapter's stack goes there
- **Runtimes.** Node.js 22 and later, Python 3.13 and later, Java 21 and later, .NET 8 and later, and Rust on the OS-only runtime (`provided.al2023` and later)
- **Architectures.** `x86_64` and `arm64`, one of them per capacity provider. This chapter uses `arm64`, like the others
- **Function size.** The smallest setting is 2 GB of memory with 1 vCPU. The function in chapter 04 had 256 MB, and you cannot go below 2 GB here
- **Isolation.** Standard Lambda separates execution environments with Firecracker microVMs. Lambda Managed Instances separates them with containers on the instance. The AWS documentation tells you not to treat those containers as a security boundary, and to put only functions that trust one another on the same capacity provider

## What it costs just to exist

<!-- section: 35.cost -->

Amounts are in USD at on-demand list prices for the Tokyo Region, before tax, with a month counted as 730 hours. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

Three things are billed.

- **The instances.** Ordinary EC2 prices. The `m6g.large` this chapter uses (2 vCPUs, 8 GiB) is USD 0.099 an hour, so three of them for 730 hours come to 216.81
- **A management fee.** 15% of the EC2 On-Demand list price, added to every instance-hour. For `m6g.large` that is USD 0.01485 an hour, or 32.52 for three instances over 730 hours
- **Requests.** USD 0.20 per million, the same as standard Lambda. The charge for execution time (GB-seconds) that standard Lambda has does not exist here

On top of that comes the interface endpoint you add to the chapter 11 stack. One endpoint for CloudWatch Logs in two zones is USD 0.014 an hour twice over, 20.44 for 730 hours. Together:

| State | A day | A month |
| --- | --- | --- |
| Default (assuming three instances) | 8.87 | 269.77 |
| Grown to the vCPU ceiling (six instances) and left there | 17.07 | 519.10 |
| Function switched off (zero execution environments) | 0.67 | 20.44 |

The "three" in the first row is an assumption taken from the Lambda guide. It says that when a function version is published, Lambda launches three instances by default for resiliency across Availability Zones and starts three execution environments. This chapter's stack hands over subnets in two zones, so how the three are placed, and whether there really are three, is unknown until you deploy.

The second row is roughly the most this stack can cost. A capacity provider has a ceiling on vCPUs (`maxVCpuCount`), and this stack sets it to 12, the lowest value CDK accepts. An `m6g.large` has 2 vCPUs, so no more than six are launched.

The third row is what remains when the function's minimum and maximum execution environments are both set to 0. According to the guide, Lambda terminates an instance once it has no execution environment left. The endpoint is still billed, until you delete the chapter 11 stack. Unlike standard Lambda, the bill does not go to 0 merely because requests stopped arriving.

What is billed is written as code.

<<< @/examples/35-lambda-managed-instances/src/cost.ts{billable}

You can get the amounts on your own machine before deploying. No AWS account is needed.

```bash
vp run lmi:plan
vp run lmi:plan instanceType=m7g.large
```

The table leaves out the EBS volumes attached to the instances, API Gateway, logs, and data transfer. That means not included, not zero. The pricing page says nothing about the size of those volumes or who is billed for them. It also does not say whether Lambda's free tier covers requests to Lambda Managed Instances, so nothing is deducted.

EC2 Savings Plans and Reserved Instances apply to the instance charge. They do not apply to the management fee, which stays at 15% of the On-Demand list price, not of the discounted one. The discount rate for `m6g.large` in Tokyo was not looked up, so every amount in this chapter is the On-Demand list price.

## The whole picture

<!-- section: 35.architecture -->

```figure
caption: A request goes from API Gateway through Lambda to an execution environment on an instance in your own VPC
node client: Client
node apigw: API Gateway | HTTP API
node lambda: Lambda | router, scaler
node a: Instances | Private1, ap-northeast-1a
node c: Instances | Private2, ap-northeast-1c
node vpce: Interface endpoint | logs (chapter 11 stack)
node logs: CloudWatch Logs
edge client -> apigw: HTTPS
edge apigw -> lambda: Invoke
edge lambda -> a
edge lambda -> c
edge a -> vpce: HTTPS 443
edge c -> vpce: HTTPS 443
edge vpce -> logs
group vpc: VPC AihNetwork = a, c, vpce
mark lambda
```

```figure
caption: The capacity provider holds where the instances go, the role Lambda uses, and the ceiling on how many there may be
node cp: Capacity provider | arm64, m6g.large, at most 12 vCPUs
node subnets: Private subnets | Private1, Private2
node sg: Security group | outbound tcp 443 only
node op: Operator role | assumed by Lambda
node fn: Lambda function | nodejs24.x, 2048 MB, 3 to 6 environments
node role: Execution role | writes its own log group only
edge cp -> subnets
edge cp -> sg
edge cp -> op
edge fn -> cp: CapacityProviderConfig
edge fn -> role
mark cp
```

The first figure is the path of a request. From API Gateway onward it looks like chapter 04, except that what stands behind Lambda is an instance in your own VPC. The router that picks an instance and the scaler that decides how many there are belong to Lambda, and you do not see them. The instances open their own connections to CloudWatch Logs to send logs.

The second figure shows how the stack's resources relate. Note that there are two roles. The operator role is the one Lambda assumes when it launches instances. The execution role is the one the function's code runs as, the same as in chapter 04.

Settings are taken through a Valibot schema, as in the other chapters.

<<< @/examples/35-lambda-managed-instances/src/config.ts{schema}

## When to choose it, and when not to

<!-- section: 35.when -->

The short answer first: for a small function like the API in chapter 04, with load that comes and goes, stay on standard Lambda. Lambda Managed Instances costs USD 269.77 a month with no requests at all, and the function's memory cannot go below 2 GB.

Lambda Managed Instances fits cases like these.

- **Steady load that lasts.** Standard Lambda bills memory multiplied by time for every request in flight. When several requests are always in flight, there is a point past which renting instances that each handle many of them is cheaper. Where the two cross is worked out on the [costs page](/en/chapters/35-lambda-managed-instances/wrap.md)
- **You want EC2 discounts.** An organization that already holds Savings Plans or Reserved Instances gets that discount on the instance charge
- **You want to choose the instance type.** You can ask for a memory-to-vCPU ratio, network bandwidth, or a newer CPU generation
- **You want to avoid cold starts.** No execution environment is created when a request arrives, so there is no slow first request. In exchange, load that rises suddenly is throttled

Here is the same month in other places. The load is 100 million requests a month at 200 ms each on average, which is 7.6 requests in flight on average.

| Where | A month | Not included |
| --- | --- | --- |
| Lambda Managed Instances (three `m6g.large`) | 289.77 | EBS volumes |
| Standard Lambda, 256 MB | 86.67 | |
| Standard Lambda, 1 GB | 286.67 | |
| Standard Lambda, 2 GB | 553.34 | |

None of the four includes API Gateway, logs, or data transfer, because they cost the same on every row. The three standard Lambda rows assume a request still takes 200 ms whatever the memory. The first row assumes three instances can carry this load. Whether they can depends on the CPU time one request uses, which this chapter did not measure.

Next, the same size of machine rented in three ways for a month. These amounts are for existing only, with no request charges.

| How it is rented | A month | What becomes your work |
| --- | --- | --- |
| Three `m6g.large` on EC2 (chapter 23's way) | 216.81 | OS patches, watching the process, scaling, a load balancer |
| Three `m6g.large` under Lambda Managed Instances | 249.33 | Code that keeps no per-request state in module scope |
| Three Fargate tasks of 2 vCPUs and 8 GB ([chapter 12](/en/chapters/12-containers.md)'s way) | 254.61 | A container image, a load balancer, scaling settings |

The 32.52 between the second row and the first is the management fee. That is what you pay each month to hand over OS patches, scaling, and routing for three machines. Fargate costs about the same at this size, but Fargate has smaller tasks, and chapter 12's default layout (two tasks of 0.25 vCPU and 0.5 GB) is USD 50.34 a month with its load balancer and public IPv4 addresses. If you want to start small and keep something running all the time, Fargate starts cheaper.

## Workers and Fluid compute

<!-- section: 35.others -->

If you come from Cloudflare Workers or Vercel, one process handling several requests at once is a model you already know. This was checked on 2026-10-13.

The Workers documentation says that a single Workers instance may handle multiple requests, concurrent ones included, in a single-threaded event loop. Another request may be processed while one is waiting at an `await`, and nothing guarantees that two requests reach the same instance or different ones, so it recommends that you neither use nor mutate global state. That is the same kind of warning as the bug in this chapter.

Vercel's Fluid compute has been the default for new projects since April 23, 2025, and on the Node.js and Python runtimes one function instance handles several invocations at once. The documentation says that multiple invocations share the same process and global state. It bills the CPU time your code is actually running, the time memory is provisioned, and the number of invocations, and once all requests have finished the instance is paused and nothing is charged until the next invocation.

Lambda Managed Instances differs from both in that it is billed when no request arrives, and in that the instances sit in a VPC of your own account. Workers and Fluid compute use the concurrent model and still cost nothing while unused. If all you want is a small API that runs cheaply, Workers, Fluid compute, and standard Lambda are each enough, and there is no reason to move to Lambda Managed Instances. The reasons to move are steady load that lasts long enough for EC2's pricing to come out cheaper, or wanting to decide the instance type and the placement inside a VPC yourself.

From here the chapter continues with [Design and Build](/en/chapters/35-lambda-managed-instances/build.md), [Run It Locally](/en/chapters/35-lambda-managed-instances/local.md), [Deploy](/en/chapters/35-lambda-managed-instances/deploy.md), and [Costs, Pitfalls, and Cleanup](/en/chapters/35-lambda-managed-instances/wrap.md).
