---
title: "12 Containers: Build, Continued"
---

# 12 Containers: Build, Continued

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
