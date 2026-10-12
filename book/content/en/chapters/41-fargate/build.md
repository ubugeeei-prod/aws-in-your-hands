---
title: "41 Fargate: Design and Build"
---

# 41 Fargate: Design and Build

Of the decisions listed in the [overview](/en/chapters/41-fargate.md), this page covers three: the size of a task, Fargate Spot, and auto scaling. In each case the documented rules are first written down as local code that tests can check, and then put into the stack's settings.

## The size of a task

<!-- section: 41.sizing -->

You cannot write any number you like for a Fargate task's CPU and memory. The valid pairs are fixed, and a task definition with a pair outside the table cannot be registered. For Linux tasks, these were the pairs on 2026-10-13.

| CPU | Memory |
| --- | --- |
| 256 (0.25 vCPU) | 512 MiB, 1 GB, 2 GB |
| 512 (0.5 vCPU) | 1 to 4 GB in steps of 1 GB |
| 1024 (1 vCPU) | 2 to 8 GB in steps of 1 GB |
| 2048 (2 vCPU) | 4 to 16 GB in steps of 1 GB |
| 4096 (4 vCPU) | 8 to 30 GB in steps of 1 GB |
| 8192 (8 vCPU) | 16 to 60 GB in steps of 4 GB |
| 16384 (16 vCPU) | 32 to 120 GB in steps of 8 GB |
| 32768 (32 vCPU) | 60 GB, 120 GB, 244 GB |

What the table says is that memory cannot grow alone. A 0.25 vCPU task stops at 2 GB. If you need 3 GB you take 0.5 vCPU with it and pay for CPU you do not use. The reverse holds too: more CPU raises the least memory you can have.

The table is in the code as it stands.

<<< @/examples/41-fargate/src/sizes.ts{table}

**How to decide.** The size comes from measurements. ECS sends `CPUUtilization` and `MemoryUtilization` for each service to CloudWatch every minute, with nothing to set up. Both are averages over the whole service, as a share of what its tasks reserve. They do not show how far a single task went at its worst moment.

To see what was actually used, turn on Container Insights ([chapter 19](/en/chapters/19-observability.md)). It records `CpuUtilized` in CPU units and `MemoryUtilized` in MiB. The unit is labelled megabytes, and the documentation notes that it is really MiB. Values per task and per container need the enhanced observability variant.

Container Insights is not free: the metrics it collects are billed as custom metrics. An example on the CloudWatch pricing page counts, for Fargate, 13 metrics per cluster, 15 per service (of which `RunningTaskCount` is free from 2026-10-01), and 10 per task. Applied to this chapter's layout (one cluster, one service, one kind of task definition) that is 37 metrics, and at Tokyo's custom metric price of USD 0.30 it comes to USD 11.10 a month. This is an estimate that borrows the example's way of counting, not an amount checked against a bill. Enhanced observability is counted and priced differently; Tokyo's Price List has a rate of USD 0.07 per metric a month. This chapter's stack does not turn Container Insights on. You can turn it on for the weeks in which you are choosing a size, and off again afterwards.

With a measured peak in hand, you choose from the table.

<<< @/examples/41-fargate/src/sizing.ts{recommend}

`maxUtilization` is how full the task may be at its peak. At 0.7, 30 % is left as headroom. There is no right value. One-minute averages hide the spikes inside the minute, so there is no case for a headroom of zero, and the more headroom you keep the more you pay. The function returns, among the pairs that satisfy the condition, the one that is cheapest at the unit prices.

Locally it looks like this. A task that peaks at 180 CPU units and 410 MiB does not fit chapter 12's size (256 and 512 MiB), and the next one up is chosen.

```bash
vp run fargate:size --cpu 180 --memory 410
```

```text
needed:  258 CPU units, 586 MiB
size:    512 CPU units (0.5 vCPU), 1024 MiB
at peak: CPU 35 %, memory 40 %
price:   USD 17.99 for one arm64 task running 730 hours, on demand
```

The need is 258 units, barely over 256, and the price doubles. The steps are coarse. Near a boundary it is worth asking whether the headroom is right, or whether more tasks of the smaller size would do.

**arm64 and x86.** At the same size, arm64 is a fifth cheaper. These are list prices for one task running for a month of 730 hours.

| Size | arm64 | x86 |
| --- | --- | --- |
| 0.25 vCPU, 512 MiB | 9.00 | 11.25 |
| 0.5 vCPU, 1 GB | 17.99 | 22.49 |
| 0.5 vCPU, 4 GB | 27.67 | 34.60 |
| 1 vCPU, 2 GB | 35.98 | 44.98 |

Whether you can choose arm64 depends on the image. Chapter 12's is built for `linux/arm64`. If an OS package or a native module exists for x86 only, you cannot.

**Ephemeral storage.** A task comes with 20 GiB of disk that exists only while it runs. `ephemeralStorage` in the task definition takes 21 to 200 GiB, and only what goes beyond 20 is billed. Tokyo's price is USD 0.000133 per GB-hour: a task with 50 GiB pays USD 2.91 a month for the extra 30 GB, and one with the maximum of 200 GiB pays USD 17.48. The pulled image is stored there as well, both compressed and unpacked, so the application has 20 GiB less the image. The pages read do not say what happens when the disk fills. The containers of chapter 12 and of this chapter have a read-only root file system and write nothing to disk.

**At the memory limit.** In the documentation's words, a task's memory is the hard limit of memory to present to the task. A container that tries to exceed its memory limit is killed. The stopped task is recorded under the `OutOfMemoryError` category, as "container killed due to memory usage". If the task belongs to a service, a replacement is started. There is no warning and no stage in which things merely slow down. Unlike with SIGTERM, the requests in flight get no chance to finish. The exact text of `stoppedReason` and the exit code could not be confirmed from a primary source for Fargate. Keep more headroom for memory than for CPU. Too little CPU makes the task slow; too little memory makes it die.

## Fargate Spot and the capacity provider strategy

<!-- section: 41.spot -->

Chapter 12's service named `FARGATE` as its launch type. The other way to say where tasks run is a **capacity provider strategy**. Fargate has two capacity providers, `FARGATE` and `FARGATE_SPOT`, and a strategy says in what proportion tasks go to each.

`FARGATE_SPOT` runs tasks on capacity AWS has to spare. The pricing page says up to 70% off the regular Fargate price. In exchange, when AWS needs the capacity back, the task is stopped with two minutes' notice. When there is no spare capacity, tasks wait to start. The documentation says in so many words that Fargate does not replace Spot capacity with on-demand capacity.

A strategy has rules.

- It can only name capacity providers that are associated with the cluster
- `base` is the number of tasks, at a minimum, that run on a provider. Only one provider can have a `base`, and it is satisfied before any `weight`
- `weight` is the ratio for the tasks beyond the base. In the documentation's example, with 1 for A and 4 for B, four tasks run on B for every one on A
- At least one provider needs a `weight` above zero
- A launch type and a strategy cannot both be given

A function checks these rules before the strategy reaches the stack.

<<< @/examples/41-fargate/src/strategy.ts{rules}

This chapter's strategy is the `STRATEGY` shown on the overview page: `FARGATE` with a `base` of 2 and a `weight` of 1, `FARGATE_SPOT` with a `weight` of 3. With two tasks, both are on demand. What auto scaling adds is split one to three. At the ceiling of six, three are on demand and three on Spot.

The documentation does not say how the ratio is rounded to whole tasks. The next function is a model: this chapter's reading, turned into counts. The tests check the documented example (ten tasks at 1 to 4 are 2 and 8) and that on-demand never drops below 2 whatever the number of tasks.

<<< @/examples/41-fargate/src/strategy.ts{split}

In the stack, the two providers are associated with the cluster, and then the service is given the strategy.

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{cluster}

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{service}

The cluster construct also has a property named `enableFargateCapacityProviders`, which is not used here. In a local synthesis it created the association as a separate resource (`AWS::ECS::ClusterCapacityProviderAssociations`) that the service did not depend on. If the service were created before the association, the strategy could be refused. Written into the cluster's own `CapacityProviders`, the association is in place before any service that refers to the cluster. It is also the form that cdkd handles with a provider of its own.

To move a service that already runs with a launch type to a strategy, the documentation says, you have to force a new deployment. This chapter's stack starts with a strategy.

**What happens at an interruption.** A Spot task that is about to be stopped gets two minutes' notice, in two forms: a task state change event in EventBridge, and SIGTERM to the task. The event for the stopped task carries `SpotInterruption` as its `stopCode`. The service scheduler tries to start a replacement on Spot if capacity is available.

Seen from the task, an interruption is a SIGTERM. The task cannot tell whether it came from Spot or from a deployment, and does not need to. Chapter 12's server stops accepting connections on SIGTERM, finishes the requests in flight, and exits with 0. The next test starts chapter 12's server through the workspace dependency and checks that this fits inside the two-minute notice.

<<< @/examples/41-fargate/test/spot.test.ts{interruption}

The relations between the durations are checked on chapter 12's `timing` as it is. On Fargate `stopTimeout` can be at most 120 seconds, the length of the notice.

<<< @/examples/41-fargate/src/spot.ts{spot}

One thing could not be settled. For deployments and scale-in, ECS first deregisters the task from the load balancer and sends SIGTERM after the deregistration delay. Whether a Spot interruption follows the same order could not be determined from the pages read. If SIGTERM arrives before deregistration, requests sent to the task fail between the moment the server stops accepting connections and the moment the load balancer stops routing to it. This chapter's tests and model treat both happening at once as the worst case.

**What must not run on Spot.** The test is whether being stopped with two minutes' notice is a problem.

- The tasks the service needs at a minimum. That is why the `base` is on the on-demand side. The documentation also says that a service with only one task is interrupted until capacity is available
- A task that holds the only copy of some state. This chapter's application keeps notes in each task's memory, so when a Spot task is stopped its notes are gone. That is tolerable only because it is practice; a service with its state elsewhere has no such problem
- Work that cannot be done again, and work that takes more than two minutes to stop: a long batch that cannot resume, or a long-lived connection that must not drop

AWS moves the Spot price gradually with demand. The Tokyo price is not in the Price List bulk API, and the table on the pricing page is filled in by script, so this book does not have it. The cost calculations count Spot tasks at the on-demand rate and treat the result as an upper bound.

## Moving the number of tasks

<!-- section: 41.scaling -->

Chapter 12 attached one target tracking policy with a target of 60% CPU. This chapter chooses again what to steer by, and looks at what happens on the way up and on the way down.

An ECS service can have target tracking, step scaling, scheduled scaling, and predictive scaling. The documentation calls target tracking the easiest: you pick a metric and a target, and Application Auto Scaling creates and manages the alarms. With step scaling you define the thresholds and the adjustments yourself, which lets you react faster to sudden changes. Scheduled scaling changes the minimum and maximum at set times. If you know traffic rises on weekday mornings, you can raise the minimum before it does.

**What to steer by.** The predefined metrics are the service's average CPU utilization, its average memory utilization, and requests per target on the load balancer (`ALBRequestCountPerTarget`). The documentation gives two conditions for a scaling metric: it moves with demand, and it moves in proportion to capacity. If doubling the tasks does not halve the value, the arithmetic that steers toward a target does not work. Memory utilization is not recommended for runtimes with garbage collection, where it often moves independently of demand. Node.js is such a runtime.

This chapter's service has two policies.

<<< @/examples/41-fargate/infra/lib/fargate-stack.ts{scaling}

With several policies, a service scales out when any one of them says to, and scales in only when all of them agree. It grows when CPU-heavy work rises and when the number of requests rises, and it does not shrink until both have calmed down.

The target for requests is a count per target per minute. The 600 here is an assumption, not a measurement. A load test ([chapter 32](/en/chapters/32-limits.md)) tells you how many requests one task answers while keeping its response time, and the target goes somewhat below that. `ALBRequestCountPerTarget` cannot be used with blue/green deployments.

**Cooldowns.** A cooldown is the time to wait for the previous change to take effect. During the scale-out cooldown, tasks are added again only if a larger scale-out is called for. During the scale-in cooldown, scaling in is blocked. If a scale-out is needed in that time it happens at once. For ECS services both default to 300 seconds. Like chapter 12, this chapter uses 60 seconds out and 300 seconds in. Scaling out too far costs money; scaling in too far costs requests, so the way back is the slow one.

**The time capacity lags behind load.** Target tracking does not add tasks at the moment load rises. Metrics arrive once a minute, and the alarm has to see the target exceeded several times in a row before the count changes. Then the new tasks pull the image, start, and pass a health check, and only then take requests.

A model shows how much that delay matters. The model is this chapter's transcription of the documented behaviour; it is not Application Auto Scaling. Where the documentation gives no number, the number is a parameter.

<<< @/examples/41-fargate/src/model-defaults.ts{defaults}

Two of the durations are this chapter's assumptions: tasks are added after three minutes above the target, and removed after fifteen minutes below nine tenths of it. The documentation says scale-in happens only once the metric is far enough below the target (usually more than 10% lower), and does not say how many minutes the alarms take. After deploying, read the alarms that Application Auto Scaling created with `aws cloudwatch describe-alarms` and replace the numbers. The two minutes a task takes to start, and the 900 requests a minute one task can answer, are unmeasured assumptions as well.

<<< @/examples/41-fargate/src/scaling.ts{simulate}

The load curve was written by hand in the shape of a morning: from 600 requests a minute it climbs over ten minutes to five times that, 3,000, stays there for forty minutes, and falls. It is not a recording of real load.

```bash
vp run fargate:simulate
```

```text
minute  load  serving  desired  per-task  over-capacity  action
     0   600        2        2       300              0
    10   840        2        2       420              0
    11  1080        2        2       540              0
    12  1320        2        2       660              0
    13  1560        2        2       780              0
    14  1800        2        3       900              0   out
    15  2040        2        4      1020            240   out
    16  2280        3        4       760              0
    17  2520        4        5       630              0   out
    18  2760        4        5       690              0
    19  3000        5        5       600              0
    61  2760        5        5       552              0
    62  2520        5        5       504              0
    63  2280        5        5       456              0
    64  2040        5        5       408              0
    65  1800        5        5       360              0
    66  1560        5        5       312              0
    67  1320        5        5       264              0
    68  1080        5        5       216              0
    69   840        5        5       168              0
    70   600        5        5       120              0
    76   600        5        2       120              0   in
    77   600        2        2       300              0

peak: 5 tasks, 419 task-minutes in all
requests that arrived while every serving task was full: 240
scale-in at minute 76 removes 3 task(s), each holding 3 request(s):
  deregistration delay 30 s: 0 cut per task
  deregistration delay 0 s: 3 cut per task
```

Load passes 600 per task in minute 12. The decision to add comes in minute 14, and the first new task takes requests in minute 16. In between, in minute 15, the load is 240 requests beyond what the serving tasks can answer. On the same curve, with five minutes to start a task, that number is 2,700 (try `--start-minutes 5`).

The model says two things. Target tracking cannot keep up with load that grows fivefold in minutes. And how far it falls short is decided almost entirely by how long a task takes to start. The answers are a smaller image that starts faster, a lower target that keeps slack in normal times, and, when you know the hour, scheduled scaling that adds tasks ahead of it. The model removes three tasks in one scale-in. The documentation describes scale-in as gradual, and how many tasks one scale-in really removes was not checked.

**Scaling in without cutting requests.** What goes wrong when scaling out is lateness. What goes wrong when scaling in is a request cut off halfway, which the user sees as an error. The task chosen for removal is handling requests at that very moment.

```figure
caption: When Application Auto Scaling lowers the desired count, ECS first takes the task out of the load balancer, gives it time to finish the requests in flight, and only then sends SIGTERM
type: sequence
actor ecs: ECS
actor alb: ALB
actor task: Task being removed
note ecs: desired count 5 -> 2
step ecs -> alb: deregister
note alb: draining
step alb -> task: in-flight only
step task --> alb: responses
step ecs -> task: SIGTERM after delay
step task -> task: finish, exit 0
step ecs -x task: SIGKILL if late
```

In this order, the conditions under which no request is cut are the relations between durations that chapter 12 set. The deregistration delay is longer than the longest request you expect. The time the server waits after SIGTERM is longer than that too. The time until SIGKILL is longer than the time the server waits. This chapter's stack imports chapter 12's `timing` and puts the same values into the target group and the task definitions.

The model builds the requests a stopping task is holding as a list of remaining times, and counts how many get their answer.

<<< @/examples/41-fargate/src/drain.ts{outcome}

A task receiving 600 requests a minute, of which one in five takes eight seconds, is holding 20 requests at any instant. With a deregistration delay of 30 seconds all 20 are answered. With 0 seconds all 20 are cut. With 5 seconds, those with more than five seconds left are cut. A test pins one invariant of this chapter. **With the deployed durations, a request within its expected time is not cut, neither by scale-in nor by a Spot interruption.** Make a value in chapter 12's `timing` shorter than the longest request, and that test fails.

The invariant protects requests that finish within ten seconds, and nothing longer. If a task carries on with work that takes minutes, a longer deregistration delay is not enough. ECS has **task scale-in protection**, with which a task declares that it should not be stopped for now. Protection lasts two hours by default and 48 hours at most, and is meant for workers that process long jobs taken from a queue. It protects against scale-in and deployments, and only for a service's tasks. This chapter's service takes short requests only and does not use it.

**Scaling to zero.** The documentation says to set a minimum capacity of 0 if you want the task count to go to zero when there is nothing to do. With zero tasks, target tracking waits for one data point that shows demand, scales out by the smallest possible amount, and then returns to its normal behaviour. A metric that reports real zeros, such as `ALBRequestCountPerTarget`, lets the service go down to 0 after a sustained period without requests.

Behind a load balancer, though, a service at zero has no task to answer the first request. Until a task has started and passed its health check, requests fail. What the load balancer returns in that time was not checked. If what you want is a bill of zero for idle time, Lambda fits better than a Fargate service scaled to zero. This chapter's service has a minimum of 2.
