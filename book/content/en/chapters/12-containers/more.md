---
title: "12 Containers: Build, Continued"
---

# 12 Containers: Build, Continued

[The previous page](/en/chapters/12-containers/build.md) settled the server, the image, the repository, and the subnets for the tasks. This page covers the task's roles, the service and the ALB, what happens during an update, and how the number of tasks is adjusted.

## The two roles

<!-- section: 12.roles -->

The Lambda function in chapter 04 had one execution role. An ECS task has two roles with similar names, so it helps to separate what each one does first.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{roles}

The **task execution role** is used by the ECS agent **before** your code starts. It does two things: fetch the image from ECR and write to the log stream. Code inside the container cannot use it.

The **task role** is used by the code inside the container when it calls AWS. This is the one that corresponds to Lambda's execution role.

Side by side with chapter 04, they look like this.

| | Lambda (chapter 04) | An ECS task |
| --- | --- | --- |
| Permission for your code to call AWS | Execution role | Task role |
| Fetching the code and shipping logs | Lambda does it (logs are written with the execution role's permission) | Task execution role |

This app makes no AWS calls, so the task role has no permissions. To connect it to chapter 05's table, you would write `table.grantReadWriteData(taskRole)`. Granting the same thing to the task execution role would not help, because the app cannot use that role. Granting the task execution role's permissions to the task role would give the app permissions it does not need.

CDK assembles the task execution role's permissions. `ecs.ContainerImage.fromEcrRepository` adds pulling from this repository, and `ecs.LogDrivers.awsLogs` adds writing to this log group.

<<< @/examples/12-containers/infra/lib/containers-stack.ts{task}

The tests check that the policy is attached only to the task execution role and that it allows exactly six actions. One of them, `ecr:GetAuthorizationToken`, has `*` as its resource. That action cannot be limited to a repository, so it is an exception to the "no `*`" rule the book has kept since chapter 04. A test also pins that this is the only `*` in the stack.

`readonlyRootFilesystem` makes the container's file system read-only. The app writes nothing to disk, so nothing else is allowed to either.

## The service and the load balancer

<!-- section: 12.service -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{service}

<<< @/examples/12-containers/infra/lib/containers-stack.ts{load-balancer}

The only listener is HTTP on port 80. HTTPS needs a certificate, and a certificate needs a domain name. This chapter has no domain name, so the traffic is not encrypted. Do not send anything through it that must not be seen, such as the tokens from chapter 06.

### Health checks

The ALB sends `GET /health` at a fixed interval to every task registered in the target group. It stops sending requests to a task whose checks keep failing.

The interval is 10 seconds, down from the default of 30. A newly registered task counts as healthy after **one** success. (The 2 in `healthyThresholdCount` is the number of successes an unhealthy task needs to come back.) A task is taken out after two failures in a row, so requests reach a broken task for about 20 seconds at most.

You should know what happens when every task is unhealthy. The ALB does not conclude that it has nowhere to send requests. It sends them to all the tasks (fail open). The reasoning is that sending to a task that may be working is better than taking every task out because the health check was too strict.

### How the durations depend on each other

This chapter has several durations that depend on each other. Written in separate places they drift apart, so they are in one file, and both the server and the stack read it.

<<< @/examples/12-containers/src/timing.ts{timing}

What happens when the relations break is written as a function too.

<<< @/examples/12-containers/src/timing.ts{rules}

The first rule is the reason for `Keep-Alive: timeout=65` on [the previous page](/en/chapters/12-containers/build.md). The ALB reuses its connections to a task and closes one after 60 seconds without use. A Node.js server closes it after 5 seconds by default. When the server closes first, the ALB sends a request down a connection it still believes is usable, and that request, with nowhere to go, becomes a 502. The AWS documentation also recommends making the application's timeout longer than the ALB's, so the sample uses 65 seconds.

<<< @/examples/12-containers/test/timing.test.ts{broken}

Types do not protect this relation. `serverKeepAlive: 5` is a `number` like any other. The tests check that the current values have no problems and what is reported when one value is broken. The stack tests check that the values in the template are the same as the ones in this file.

## What happens during an update

<!-- section: 12.rollout -->

When you deploy with `-c imageTag=v2`, the task definition changes and the service starts replacing tasks. This is a rolling update. The two figures below show a replacement that goes well and one where the new tasks cannot start.

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

`minimumHealthyPercent: 100` says never to drop below two healthy tasks. `maximumPercent: 200` says up to four may run during the replacement. Together they fix the order: new tasks start before old ones stop. With 50 and 100, one task stops first and then one starts. That needs no extra tasks, and capacity is halved while the replacement runs.

The **deployment circuit breaker** is for the situation in the second figure, where the new tasks never get past step 3. When new tasks keep failing to start or keep failing their health check, it marks the update as failed. The number of failures it allows is half the number of tasks (at least 3, at most 200), which is 3 for two tasks. With `rollback: true`, as set here, it returns to the last state that succeeded on its own.

Without the circuit breaker, an update is never marked as failed and keeps going.

There is a kind of failure the circuit breaker cannot find. It looks only at whether tasks started and whether they passed the health check. It does not detect a version that answers `/health` with 200 while `/notes` returns 500. The section "Old and new run side by side" below produces exactly that failure.

### When a task is stopped

In step 4 of the rolling update figure, the old tasks were draining. The next figure shows what happens during that time in more detail.

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

ECS takes the task out of the ALB first and sends SIGTERM afterwards. Because of that order, no new requests should be arriving by the time SIGTERM does.

The **deregistration delay** is how long the ALB waits for requests in flight to finish on a task it has decided to take out. At the default of 300 seconds, stopping one task could take up to five minutes, so the sample shortens it to 30 seconds. That assumes this app's requests take 10 seconds at most. In an app with long requests, such as file uploads or streaming, a delay that is too short cuts requests off.

If the ALB takes the task out first, a graceful shutdown may look unnecessary. It is still needed. Requests longer than the deregistration delay remain, and as [the previous page](/en/chapters/12-containers/build.md) showed, the process cannot exit until its keep-alive connections are closed. Work that does not come through the ALB, such as the queue processing in [chapter 08](/en/chapters/08-async.md), has no deregistration step at all.

I read this order from the sequence of task states in the ECS documentation (deregistration in DEACTIVATING, then SIGTERM in STOPPING). I have not run it and checked the timestamps in the logs. There is a command for checking it.

```bash
vp run ecs:watch
```

`ecs:watch` calls `/health` once a second and keeps printing which version answered. Leave it running in another terminal while you deploy, and you can see the period in which v1 and v2 are mixed. There should be no errors at all, and that has not been checked either.

## Old and new run side by side

<!-- section: 12.versions -->

In step 3 of the rolling update figure, v1 and v2 were answering at the same time. That period can last tens of seconds, or minutes when there are many tasks. If a rollback happens, there is also a period in which v1 reads what v2 wrote.

If there is data outside the tasks, both versions read and write it.

This chapter's invariant, in one sentence: **"Every version that is running can read a record written by any version that is running."**

As an example, suppose v2 adds a field called `pinned` to a note.

<<< @/examples/12-containers/src/compat.ts{formats}

`v1` and `v2` are a pair that works. v1 silently drops fields it does not know, and v2 fills in a missing field with a default.

`v2Required` and `v1Strict` both look strict and correct, and both break an update.

For the tests, there is a stand-in for the data outside the tasks.

<<< @/examples/12-containers/src/compat.ts{store}

It stores JSON strings, and each task reads and writes them through the schema of its own version. The same thing happens with a DynamoDB item, an SQL row, or a queue message.

The test starts two real HTTP servers at the same time.

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

The two formats that break do so as follows.

**The new version requires a field that old records do not have (`v2Required`).** A `GET /notes` that reaches a v2 task returns 500. One that reaches a v1 task succeeds, so to users it looks as if every other call fails. `/health` stays at 200 the whole time, so neither the ALB nor the circuit breaker notices. The test checks, side by side, that the health check passes and that listing fails.

**The old version rejects a field it does not know (`v1Strict`).** From the moment v2 writes one record, the v1 tasks can no longer read. A quick rollback does not fix it, because the v2 code goes away and the records v2 wrote remain.

These two failures lead to rules about the order of changes.

- To **add** a field, add it as optional and fill in a default when reading. Make sure old versions can ignore fields they do not know
- Make a field **required** only after no running version omits it and the old records have been filled in. Adding a field and making it required are separate deploys
- Do not **remove or rename** a field in one step. Add the new name, write both, switch the readers, then remove the old one

These rules are not specific to ECS. Any mechanism that replaces versions without stopping has a period in which old and new run together. Lining up two tasks and replacing them in turn has made that period visible.

When you deploy this sample, the tasks share no data. The notes are still in memory. In the deployed environment, the only thing that touches old and new at the same time is, for now, the user, and the changing `x-app-version` that `ecs:watch` prints is that. The `SharedRecords` class in the tests lets you check locally, ahead of time, what happens once the app is connected to the data stores of chapter 05 or 13.

## More tasks, fewer tasks

<!-- section: 12.scaling -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{scaling}

The method is **target tracking**. You set only a goal, here an average CPU utilization of 60% across the service, and leave the number of tasks to the service. It resembles telling an air conditioner only the temperature you want.

Two metrics are commonly used.

**CPU utilization.** This is the one the sample uses. It suits apps that get busy computing. Node.js handles requests on one thread, so on a 0.25 vCPU task requests start waiting as soon as the CPU is used up. The target is 60% so that tasks are added early.

**Requests per target** (`ALBRequestCountPerTarget`). This is the number of requests per task, as counted by the ALB. An app that spends most of its time waiting for a database or an external API can be busy while its CPU utilization stays low, so the request count describes it better. The sample does not use it, because you cannot choose a target value without measuring how many requests one task can handle.

You can attach both metrics. In that case tasks are added when any one metric says to add, and removed only when every metric says removing is fine. Scaling out is fast and scaling in is cautious by design.

The maximum of 4 is also a limit on cost. Each added task costs USD 12.65 a month in public subnets. If the service stays at four tasks, this stack's fixed cost is USD 75.62 a month. Auto scaling without a maximum means a bill without a maximum.

When scale-in removes a task, the task stops the same way as in an update. It is taken out of the ALB, receives SIGTERM, and receives SIGKILL once `stopTimeout` has passed. The graceful shutdown helps here too. While a deployment is in progress, scale-in is paused (scale-out is not).

Auto scaling has not been tried under load. The only thing checked is that the settings appear in the template.
