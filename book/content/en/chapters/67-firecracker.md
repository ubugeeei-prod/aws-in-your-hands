---
title: "67 Firecracker: The MicroVM under Lambda and Fargate"
sourceRevision: 1
---

# 67 Firecracker: The MicroVM under Lambda and Fargate

A Lambda function runs on the same physical machine as other customers' functions. They cannot touch each other because each execution environment sits inside a microVM, a small virtual machine whose boundary is guarded by the CPU's virtualization features. Firecracker is what creates those microVMs. This chapter reads, from public material, what Firecracker does and what it leaves out, and then places the behavior of Lambda and Fargate that earlier chapters showed on top of it.

Firecracker is open source: its code, its design documents and its API specification can all be read. How AWS uses it inside its own services is known only as far as AWS has written. So this chapter keeps three kinds of statement apart: what a source states, what follows from that, and what nobody outside AWS can confirm.

One thing first. The machine this chapter was written on runs macOS, and Firecracker does not run there. It needs Linux and KVM. Every boot time and memory figure in the chapter is a value published by the Firecracker project or by AWS, and none was measured by this book. What ran locally is the code that builds the requests for Firecracker's API and checks them against the specification, with its tests. The steps for a reader who has a Linux machine are written down, and were not run.

The chapter builds on the app of [chapter 04](/en/chapters/04-http-api.md), the execution environment and cold starts of [chapter 29](/en/chapters/29-lambda-tuning.md), Fargate in [chapter 12](/en/chapters/12-containers.md) and [chapter 41](/en/chapters/41-fargate.md), and EC2 in [chapter 23](/en/chapters/23-ec2.md). The code is in `examples/67-firecracker/`. The content was checked on October 13, 2026 against the Firecracker v1.17.0 repository and AWS's documentation.

## What Firecracker is

<!-- section: 67.what -->

Firecracker is a **virtual machine monitor** (VMM). Running a virtual machine takes two parts. One uses the CPU's virtualization features to run the guest's code directly, and on Linux that is KVM, in the kernel. The other presents devices such as disks and network interfaces to the guest and handles what happens when the guest touches them. That part is the VMM. The widely used one is QEMU, and Firecracker is a different implementation that takes its place.

The repository's README describes Firecracker like this. It uses KVM to create and run microVMs. It leaves out unnecessary devices and guest-facing functionality, to reduce the memory footprint and the attack surface of each microVM. AWS developed it for services like Lambda and Fargate, and publishes it under the Apache License 2.0.

```figure
caption: One Firecracker process is one microVM. The devices the guest sees are connected to a TAP device and to files on the host.
node client: API client
node fc: Firecracker | one process
node guest: microVM | guest kernel and code
node kvm: KVM | host kernel
node tap: TAP device
node file: File | the guest's disk
edge client -> fc: HTTP on a Unix socket
edge fc -> guest: virtio devices
edge fc -> kvm: /dev/kvm
edge fc -> tap: packets
edge fc -> file: blocks
group host: Host = client, fc, kvm, tap, file
mark fc
```

These points from the design document decide its shape.

- One Firecracker process is responsible for exactly one microVM. Run `ps` on the host and there is one process per microVM
- The threads in the process are the API thread, the VMM thread, and one per vCPU. The design document treats vCPU threads as running malicious code from the moment they start
- The guest's network is connected to a TAP device on the host, and the guest's disk to a file on the host. There is no mechanism to lend a file system to the guest
- All configuration goes through an HTTP API that the process serves on a Unix domain socket. Its specification is in the repository, in OpenAPI form
- Host and guest are both Linux. The CPU is x86_64 or aarch64, and the guest must have the same architecture as the host

What is left out is what characterizes Firecracker. The FAQ names six emulated devices: virtio-net, virtio-balloon, virtio-block, virtio-vsock, a serial console, and a minimal keyboard controller used only to stop the microVM. The README of the same release lists newer features beyond these, such as an entropy device and pmem. The 2020 paper names what is absent, no BIOS, no booting of arbitrary kernels, no VM migration, and says that Firecracker replaces QEMU, not Docker or Kubernetes. Distributing images and placing microVMs on many hosts are not Firecracker's job.

The figures the project commits to are in its specification document (`SPECIFICATION.md`). Each is a value the project holds in its own test environment.

- They are measured on EC2 M5D.metal and M6G.metal instances, given that the host has resources to spare
- For a microVM with one vCPU and 128 MiB of memory, the VMM's own memory overhead is 5 MiB or less. A note says it grows with the workload and the configuration
- From receiving the `InstanceStart` API call to the start of `/sbin/init` in the guest takes 125 milliseconds or less. That is with the serial console disabled and a minimal kernel and root file system
- The VMM process reaches the point where its API socket is available within 8 milliseconds of CPU time. Wall-clock time spreads from 6 to 60 milliseconds

The 125 milliseconds are not the time until an application answers its first request. The measurement ends when init starts. Starting a runtime and initializing an application come after it and are not included.

## Process, container, isolate, microVM

<!-- section: 67.boundaries -->

There are several ways to run someone else's code on the same machine, and they differ in where the boundary that must not break is. Three have already appeared in this book: the containers of Lambda Managed Instances ([chapter 35](/en/chapters/35-lambda-managed-instances.md)), the isolates of Workers ([chapter 64](/en/chapters/64-isolates.md)), and the microVMs of Lambda and Fargate. Side by side:

| | What is shared | What guards the boundary | What the sources say about startup and overhead |
| --- | --- | --- | --- |
| Process | Kernel, file system, network | Users and permissions of the operating system | The baseline. No figure is quoted |
| Container | Kernel | Namespaces, cgroups, and system calls narrowed with seccomp | The paper says that the safer it is made, the more code stops working. No figure is quoted |
| Isolate | Process and runtime | V8, and a sandbox around the process | Cloudflare says an isolate starts around a hundred times faster than a Node process on a container or VM, and uses an order of magnitude less memory at startup |
| MicroVM | Hardware only | CPU virtualization features, KVM, and the VMM | Firecracker's specification says 125 milliseconds or less to the start of init, and 5 MiB or less of VMM overhead |

The right-hand column holds what each source says under its own conditions. The values were not obtained under the same conditions, and this book measured none of them.

The paper explains the container row as follows. Code in a container calls the host kernel directly. The boundary is at the system call entry, and the only way to harden it is to allow fewer system calls. Lambda promises to run arbitrary Linux binaries, so there is a limit to how many can be taken away. With virtualization the guest has a whole kernel of its own, and the boundary moves to the CPU's virtualization features and a much smaller VMM. The price is the memory and startup time of a kernel and a VMM per guest. Firecracker is a VMM built to cut that overhead.

An isolate puts the boundary further inside. One process holds thousands of isolates, and V8 guarantees that none reaches another's memory. No kernel and no process start, so an isolate begins quickly and needs little memory. What it runs is JavaScript and WebAssembly. Cloudflare itself writes that V8 has a wider attack surface than virtual machines, and explains that it adds a layer that encloses the whole process with namespaces and seccomp and keeps it from the file system and the network. The paper dismisses isolation by language virtual machines in one sentence: it did not suit Lambda and Fargate, which need to run arbitrary binaries. The difference is in what each platform promised to run, not in which is better.

The microVM boundary is strong, and Firecracker alone does not complete it. The production host setup document states that Firecracker cannot mitigate the host's hardware vulnerabilities, and asks for SMT to be disabled where tenants are separated, and for each Firecracker process to correspond to one tenant.

## Where it runs in AWS

<!-- section: 67.aws -->

This is where the three kinds of statement are kept apart.

**What the sources state.**

- Firecracker's README and FAQ say AWS developed it for Lambda and Fargate. According to the FAQ, Lambda, launched in 2014, first isolated customers with per-customer EC2 instances
- The Lambda developer guide, on the page that explains Lambda Managed Instances, describes default Lambda as using Firecracker microVM technology to isolate execution environments on shared fleets. The same page says Lambda Managed Instances isolate with containers and not with Firecracker
- The whitepaper "Security Overview of AWS Lambda" (last revised December 27, 2022) says the Workers that hold execution environments are bare metal EC2 Nitro instances that Lambda manages in a separate account, each with one or more microVMs created by Firecracker. Execution environments are never reused across function versions or customers
- The 2020 paper describes the Lambda of that time in more detail. One worker holds hundreds or thousands of microVMs, and one microVM is one slot. A slot is used for one function and for one concurrent invocation, and reused for invocations that follow one another. A small pool of booted microVMs hides the boot latency. A slot is recycled after 12 hours at most
- The SnapStart page says that when a function version is published, Lambda takes a Firecracker microVM snapshot of the memory and disk state of the initialized execution environment, and resumes new execution environments from it. The supported runtimes are Java 11 and later, Python 3.12 and later, and .NET 8 and later, and the page states that `nodejs24.x` is not supported
- Lambda MicroVMs, announced on June 22, 2026, are environments for running code written by users or by AI, and their guide says they are delivered through Firecracker virtualization
- For Fargate, AWS's Open Source Blog of November 2018 says tasks that used to run in a dedicated EC2 VM each now execute on Firecracker microVMs. Today's ECS developer guide says Fargate runs each task in a hardware virtualization environment, and that a task does not share the kernel, CPU, memory or network interface with another task. The name Firecracker does not appear on those two pages

**What follows from that.**

- "One execution environment handles one request at a time", from chapter 29, is structure and not a setting. The boundary is the microVM, and inside it there is one function and one invocation
- Firecracker's share of a cold start should be small. Its specified value is 125 milliseconds or less to the start of init, and according to the paper even that is hidden by the pool. What the `Init Duration` of a REPORT line contains is, as chapter 29 showed, the start of extensions and the runtime, and the code outside the handler
- SnapStart cannot be used for this book's Node.js functions. Where it can be used, many execution environments start from one snapshot, so a random value or an ID created during initialization is not different per environment. It is the problem Firecracker's snapshot document describes: resuming from the same state more than once is not safe without a mechanism that keeps unique things unique

**What nobody outside AWS can confirm.**

- Whether, in today's Lambda, one execution environment is exactly one microVM. The paper describes 2020, and the whitepaper says only "one or more microVMs" per Worker
- Whether the Firecracker AWS runs is the published release. Boot times in production, the size of the pool, the memory overhead
- Whether the memory configured for a function is the memory of its microVM
- Whether every Fargate task is on Firecracker today. Differences between platform versions, and Fargate on EKS, cannot be told from the pages read. The whitepaper "Security Overview of AWS Fargate" could not be read: its host answered 403
- Whether a SnapStart snapshot has the format of the published Firecracker snapshots

## What this explains in earlier chapters

<!-- section: 67.explains -->

The cold start of chapter 29 can be read again like this. When no execution environment is free, Lambda prepares a new slot. That includes making a microVM available, placing the function's code, starting the runtime, and running the code outside the handler. The first is kept short by Firecracker's speed and by the pool, and the last three are what a customer can change. Making the bundle smaller and the initialization lighter, the work of chapter 29, was cutting the part left to the customer.

The reuse of execution environments comes from the same structure. The paper prints a function that increments a variable in module scope and returns it, and the number grows as it is invoked again and again, because the microVM and the process inside it both stay across invocations. Putting clients outside the handler in chapter 29 relied on that. Between one invocation and the next, an execution environment holds memory and uses no CPU, and the paper calls this central to Lambda's economics.

Lambda Managed Instances in chapter 35 carry the Lambda name and have a different boundary. The guide says they isolate with containers and not with Firecracker, and that the security boundary is the capacity provider. The instances are in the customer's account, so the boundary to other customers is EC2's, and the containers inside it only separate functions that trust each other. As chapter 35 showed, one execution environment handles many requests at once, so module scope is shared between concurrent requests. A mix-up that could not happen with one request per microVM slot becomes possible here.

Why a Fargate task is one unit, in chapter 41, has its reason here too. The ECS guide says containers are not a security boundary, and puts the boundary at the task. The containers of one task are on the same side of it. To separate things that do not trust each other, separate tasks, not containers. That a task pulls its whole image at every start, which chapter 41 showed, can be read as the other face of the same boundary: if the next task could read the previous task's cache, the two tasks would be sharing something.

The unit of price also lines up with the unit of the boundary. Lambda bills the time an execution environment spends handling invocations, and Fargate the time of the vCPU and memory assigned to a task. In both, the unit of isolation is the unit that is metered. This is a reading of the price list next to the sources above, not a reason AWS gives for its pricing.

## Who runs it themselves, and who does not

<!-- section: 67.who -->

Operating Firecracker yourself is justified when you are building a service that runs other people's code and want a kernel per tenant. Execution environments for code that users write, CI jobs, and sandboxes for coding agents ([chapter 63](/en/chapters/63-agent-sandbox.md)) are such services.

In that case Firecracker brings the VMM and nothing else, and the rest is yours. From the sources:

- Starting it through the jailer, and configuring the host. The production host setup document says of its own list that the guarantees hold only if it is implemented
- Narrowing where the guest's network traffic may go. Firecracker filters no packets
- Building, distributing and patching kernel and root file system images
- Deciding which microVM goes on which host, and what happens when a host fails
- With snapshots, protecting the files, and recreating random values and IDs inside the resumed guest

Most readers have no reason to own this. As of October 13, 2026, these come first.

- For running your own code, Lambda and Fargate already provide the microVM boundary
- For running other people's code on AWS, there is Lambda MicroVMs. The announcement lists the Tokyo Region. Its prices and limits were not looked into for this chapter
- For an execution environment for agents, [chapter 50](/en/chapters/50-agentcore.md) covers AgentCore
- Vercel has Vercel Sandbox, and its documentation says each sandbox runs in a Firecracker microVM
- Cloudflare Workers chose a different boundary, the isolate. If what you run is JavaScript and WebAssembly and the platform's promise is enough, there is no reason to bring in a microVM. Running isolates on your own machines is chapter 64

The physical ground Firecracker runs on, bare metal instances and Nitro, continues in [chapter 68](/en/chapters/68-nitro.md). The next page writes code that calls Firecracker's API from TypeScript, checked against the specification.
