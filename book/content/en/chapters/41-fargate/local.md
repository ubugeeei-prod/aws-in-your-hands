---
title: "41 Fargate: Run It Locally"
---

# 41 Fargate: Run It Locally

## Checking it locally

<!-- section: 41.local -->

What this chapter can check without Docker and without AWS runs with these commands.

```bash
vp run test:unit
vp run fargate:size --cpu 180 --memory 410
vp run fargate:simulate
vp run dev:fargate:job
vp run fargate:bundle:check
vp run fargate:infra:synth
vp run fargate:infra:synth -c imageTag=f1
vp run fargate:infra:synth -c imageTag=f1 -c exec=true
```

`dev:fargate:job` runs the job on your machine's Node.js as it is. Press Ctrl-C partway and it takes the path a Spot interruption would: it logs the number of the item it would have done next and exits with 75. The rest is passed in an environment variable.

```bash
JOB_START_AT=12 vp run dev:fargate:job
```

`fargate:bundle:check` builds the two files that go into the image (`server.mjs` and `job.mjs`) and starts them away from `node_modules`. It checks that the server answers and exits with 0 on SIGTERM, and that the job exits with 0 when it finishes and with 75 when it is interrupted.

This is what the tests look at, and what they do not.

| Subject | File | Checked | Not checked |
| --- | --- | --- | --- |
| Size | `test/sizes.test.ts` | The rows and boundaries of the table; the cheapest pair that holds a measured peak with headroom | That the table is the same today; what a real task uses |
| Placement | `test/strategy.test.ts` | The rules of a strategy; that the minimum tasks always land on on-demand | How ECS really rounds and places; whether Spot has capacity |
| Scaling | `test/scaling.test.ts` | Inside the model: the lag, the cooldown, the ceiling, and what becomes of the requests a stopping task holds | What Application Auto Scaling really decides; how long its alarms take |
| Interruption | `test/spot.test.ts`, `test/job.test.ts` | How the server and the job behave on SIGTERM; that the durations fit in two minutes | Whether deregistration or SIGTERM comes first at a Spot interruption |
| Commands | `test/commands.test.ts` | How the arguments of `run-task` and `execute-command` are assembled | That AWS accepts the commands |
| Cost | `test/pricing.test.ts` | That the amounts in the text equal what the price data computes | The Spot price; an invoice |
| Infrastructure | `infra/test/fargate-stack.test.ts` | The strategy's base, the two policies, no new `*` in permissions, ECS Exec off by default, the resource types | That AWS does what the template says |

One more word on the scaling tests. `src/scaling.ts` is a model: this chapter's transcription of documented behaviour. What the tests check is that the model keeps its own rules, not that Application Auto Scaling behaves that way. The model is worth having because it lets you think ahead about which way things move when you change the start time or the target.

These cannot be reproduced locally.

- Building the image and running it as a container. This book's devShell has no Docker daemon
- Real placement by a capacity provider strategy, a Spot interruption, a task retirement
- What target tracking really does, and what the load balancer does at scale-in
- RunTask from Scheduler, and its retries
- An ECS Exec session
- cdkd creating the resources the template describes

For cdkd, the source of the pinned version (0.296.28) was read. Of the 16 resource types this stack uses, cdkd has a provider of its own for 13. The provider for ECS clusters, task definitions, and services handles `CapacityProviders` on the cluster and `CapacityProviderStrategy` and `EnableExecuteCommand` on the service. The provider for `AWS::Scheduler::Schedule` handles `EcsParameters` inside `Target`, and the time zone. The other three, `AWS::ApplicationAutoScaling::ScalableTarget`, `AWS::ApplicationAutoScaling::ScalingPolicy`, and `AWS::EC2::SecurityGroupEgress`, go through Cloud Control API as in chapter 12. A test pins the list of resource types and that only properties those providers handle are used.
