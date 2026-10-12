---
title: "63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS"
sourceRevision: 1
---

# 63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS

A coding agent runs commands that a model chose. On your laptop, those commands run next to your AWS credentials, your SSH keys, and every other repository you have. This chapter builds the place to run the agent instead, inside AWS: one environment per job, thrown away when the job ends, from which the only things in reach are the model, the one repository the job is about, and the package registry.

The agent here is Claude Code. Everything this chapter says about Claude Code is something its public documentation says. Where the documentation did not settle a question, the chapter says it was not confirmed. No agent was started while writing this chapter, and no model was called. What was run locally is the decision to launch, the allowlist evaluator, the IAM policy evaluator, and the contents of the stack.

**Left in place with no task running, the stack costs about USD 0.09 a month** (Tokyo, list price; the breakdown is under [Cost](/en/chapters/63-agent-sandbox/wrap.md)). A task runs only while there is a job. Thirty minutes of one costs about USD 0.03 in Fargate, and the model costs far more than that. What is billed by the hour is the task's way out of its subnet: a NAT gateway, interface endpoints, or Network Firewall, at USD 20 to USD 292 a month depending on which you choose. The way out is decided by [chapter 11](/en/chapters/11-network.md)'s stack and by a context flag of this chapter's.

The chapter builds on the VPC of [chapter 11](/en/chapters/11-network.md), the IAM and secrets of [chapter 21](/en/chapters/21-security.md), the one-off task of [chapter 41](/en/chapters/41-fargate.md), the inference profiles and IAM of [chapter 36](/en/chapters/36-bedrock.md), and the logs of [chapter 19](/en/chapters/19-observability.md). The code is in `examples/63-agent-sandbox/`.

## What it is protected from

<!-- section: 63.threats -->

Claude Code's documentation gives two reasons an agent does the wrong thing: it follows instructions embedded in content it processes (prompt injection), or the model makes a mistake. The documentation's example is a repository's README with unusual instructions that Claude Code takes into its actions. It says the models are designed to resist this, and recommends defense in depth all the same.

This chapter is designed on the assumption that the agent will, one day, run a wrong command. What happens then falls into a few kinds.

- **Prompt injection.** Instructions come in through the files of the cloned repository, a fetched web page, the description of an installed package. The ways in cannot all be closed, so the design narrows what is in reach once the agent has followed one
- **Exfiltration.** Whatever the agent can read, it can send. It can read the repository's code, its environment variables, and the credentials the task holds. The egress allowlist narrows where things can be sent; the permission design narrows what there is to read
- **Destructive commands.** Deleting files, rewriting a branch, deleting AWS resources. The files do not matter, because they are thrown away with the task. The branch is protected by rules on GitHub's side, and AWS by IAM
- **Runaway cost.** Left alone, an agent keeps going. Both the model's bill and the task's hours get a limit that is enforced from outside
- **Supply chain.** `npm install` runs code that someone else wrote. That happens without an agent too, but an agent chooses packages by itself. This is also treated as a question of what is in reach after the code has run

All of them lead to the same answer: do not trust what goes on inside the agent, and let a mechanism outside it decide what the place it runs in can reach. Claude Code has a permission system and a sandbox of its own, and this chapter uses both. But those are an inner wall, kept by the same process as the agent. The outer wall is built on the AWS side.

The chapter has one invariant. **Nothing the agent can do from inside reaches production data or the deploy role.** A stack test and a small policy evaluator written for this chapter pin it.

## The whole picture

<!-- section: 63.architecture -->

```figure
caption: One task is started per job. From the task, the model, one repository, and the package registry are all there is to reach
node person: Requester | lambda:InvokeFunction
node launcher: Launcher | Lambda
node secret: GitHub App key | Secrets Manager
node task: Agent task | Fargate, 1 vCPU, 4 GB
node model: Bedrock | one inference profile
node git: GitHub | one repository
node logs: CloudWatch Logs | written by the execution role
node reaper: Reaper | Lambda, every minute
edge person -> launcher: request
edge launcher -> secret: read the key
edge launcher -> task: RunTask
edge task -> model: InvokeModel
edge task -> git: clone, push, pull request
edge task --> logs: stdout
edge reaper -x task: StopTask
group sandbox: An account that is not production = launcher, secret, task, logs, reaper
mark task
```

The parts, one at a time.

The **launcher** is a Lambda function. It takes a request, checks that the repository is allowed and the request is inside the limits, and only then has GitHub make a token that is good for that one repository and expires in an hour, and starts one task.

The **task** is a one-off Fargate task. It starts from a known image, clones the repository, runs Claude Code once, pushes a work branch and opens a pull request if anything changed, and exits. Its file system is read-only; the only places it can write are volumes that disappear with it.

The **task role** is what the agent may do in AWS. It can call the model through one pinned inference profile, and nothing else. It cannot even write its own log: the execution role, which is outside the container, does that.

The **reaper** is a Lambda function that runs every minute. From outside, it stops tasks that are past their deadline, and every task once the day's budget is spent.

The limits are in one place.

<<< @/examples/63-agent-sandbox/src/config.ts{limits}

Each number answers one way a task can run away. `maxMinutes` is 50 because a GitHub token expires an hour after it is made, and the task pushes at the end with the token it cloned with. Stopping at 50 minutes leaves ten for the launch and the push.

Without an image tag in the context, the stack is an ECR repository and nothing else. With a tag, the rest is created, and nothing in the default configuration is billed by the hour.

## Why the environment is a Fargate task

<!-- section: 63.isolation -->

There are several ways to make one environment per job. Claude Code's documentation ranks isolation technologies by strength: containers are as strong as their setup, gVisor and virtual machines are strong when set up correctly. A container is separated by Linux namespaces and shares the host's kernel, so a kernel vulnerability could let code out of it. A virtual machine has a kernel of its own.

On AWS the choices are these.

**Containers on an EC2 instance.** Several jobs on one instance share a kernel, and what one job leaves behind is there for the next to find. That does not fit this chapter's purpose.

**An EC2 instance per job.** An instance is a virtual machine, so each job has its own kernel, and [chapter 23](/en/chapters/23-ec2.md)'s tools can build it. In exchange you keep an AMI patched, wait for instances to boot, design around the fact that the instance profile's credentials can be fetched from instance metadata, and own the mechanism that makes sure a finished instance is really gone.

**A Fargate task.** The ECS documentation says Fargate runs each workload on an isolated virtual environment, and that tasks do not share network interfaces, ephemeral storage, CPU, or memory with other tasks. Another page, quoted in [chapter 41](/en/chapters/41-fargate.md), adds that they do not share a kernel. Neither customers nor AWS operators can connect to the host that runs a task.

This chapter chooses the Fargate task. It gives a boundary per job without a host to own, there is nothing to clean up after a task ends, and it is billed by the second and not at all between jobs.

Choosing Fargate also takes some things away.

- No privileged containers, and the only Linux capability that can be added is `SYS_PTRACE`. Claude Code's reference dev container narrows egress with a firewall inside the container, which by the documentation needs `NET_ADMIN` and `NET_RAW`. That is not available on Fargate, so egress is narrowed outside the task
- No containers inside the container. A repository whose tests need Docker cannot be worked on here
- The whole image is pulled for every task (chapter 41). A start should take tens of seconds; it was not measured

It is worth being exact about what the task boundary does not protect. Inside it, the agent can use the task role's credentials, the repository token, and whatever network the task can reach. As the ECS documentation says, the task role's credentials are there for the asking at a fixed address inside the container. Isolation protects other jobs and the host. It does not protect what you handed the agent. So most of this chapter's design is the work of handing it less.

About microVMs such as Firecracker: Claude Code's documentation names them among the virtual machine options. The AgentCore Runtime documentation says each session gets a dedicated microVM. For Fargate, the pages read for this chapter say "isolated virtual environment" and name no technology. What runs under Fargate is [chapter 67](/en/chapters/67-firecracker.md)'s subject.

## When not to build this yourself

<!-- section: 63.when -->

This design is for running an agent inside your own account, with permissions and a network you decided. It has a good many parts, and every one of them stays yours to keep. If one of the following fits, start there.

**Claude Code's cloud sessions.** Claude Code can run a session on a virtual machine that Anthropic manages. By the documentation, each session runs in an isolated virtual machine, the network is limited to a default allowlist, and the GitHub token is held by a proxy outside the sandbox. Keeping the token away from the agent is a stronger design than this chapter's. It needs a Claude subscription, and the model is not reached through Bedrock. There are also self-hosted environments, which run the same sessions on your infrastructure: as of 2026-10-13 a public beta on Team and Enterprise plans, where isolation, egress control, and git credentials are stated to be the operator's responsibility. What that responsibility consists of is what this chapter covers.

**AgentCore Runtime.** [Chapter 50](/en/chapters/50-agentcore.md)'s AgentCore Runtime gives each session a dedicated microVM, and says the microVM is terminated and its memory sanitized when the session ends. It is a runtime for hosting an agent as a service that answers invocations. A one-time job of cloning, changing, and opening a pull request fits a task more plainly. If the agent is a feature of your own application, read chapter 50.

**Cloudflare's and Vercel's sandboxes.** Both have an environment for running code an agent wrote. Cloudflare's documentation says a Sandbox container is a microVM with its own kernel and network, started from a Worker, which decides whether it can reach the internet (as of 2026-10-13: on the Workers Paid plan, with a scheduling policy in public beta). Vercel Sandbox says it runs agent-generated code in isolated Linux microVMs. If your application is already there and the agent has no need to touch things inside a VPC or IAM, there is no reason to move.

**GitHub Actions.** If the agent only has to react to a pull request, a GitHub-hosted runner is enough. Hosting runners on your own AWS is [chapter 62](/en/chapters/62-ci-runners.md)'s subject. A runner is also a place that runs whatever it is handed, so the main points of the design are the same as here.

What makes building it on AWS worth the parts is one of three things: keeping model calls inside the Bedrock of your own AWS account, narrowing egress by your own network's rules, or keeping the records in your own CloudTrail and CloudWatch Logs.

The build is in [Design and Build](/en/chapters/63-agent-sandbox/build.md) and [Build, Continued](/en/chapters/63-agent-sandbox/more.md); cost and cautions are in [Costs, Pitfalls, and Cleanup](/en/chapters/63-agent-sandbox/wrap.md).
