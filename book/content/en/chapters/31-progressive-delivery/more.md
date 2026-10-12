---
title: "31 Progressive Delivery: Build, Continued"
---

# 31 Progressive Delivery: Build, Continued

The [previous page](/en/chapters/31-progressive-delivery/build.md) built the side that shifts code in steps. This page makes the feature flags and builds them into the application, then turns the condition for two versions reading the same data into a test. It ends with the options for doing the same with chapter 12's container service.

## Defining the flags

<!-- section: 31.flag-document -->

The flag values live in one file in the repository.

<<< @/examples/31-progressive-delivery/flags/flags.json

AppConfig configuration profiles come in types, and one of type `AWS.AppConfig.FeatureFlags` accepts JSON of this shape. `flags` holds the definitions and `values` the current values. A flag can have attributes, and an attribute can have a type and a range. The `rolloutPercent` of `noteStats` is declared as a number from 0 to 100. According to the AppConfig documentation, AppConfig checks a profile of this type against a JSON Schema when a version is stored (read on 2026-10-13).

There are two flags. `readOnly` is an operational switch: while it is on, writes are refused. `noteStats` decides who sees a new route, `GET /stats`.

The same shape exists as a Valibot schema.

<<< @/examples/31-progressive-delivery/src/flags/document.ts{document}

AppConfig checks the file, and it is checked locally as well, for two reasons. An editor and CI notice a mistake before anything is sent to AWS. And rules that AppConfig does not know can be added.

<<< @/examples/31-progressive-delivery/src/flags/document.ts{check}

The rule that matters most among the added ones is that the file and the code agree on which flags exist. A flag the code reads and the file lacks is a failure, and so is a flag in the file that the code does not read. The second looks harmless. But a switch connected to nothing is the one somebody flips during an incident, to no effect, at the cost of time. The same test is what prompts you to remove a flag once it has done its job.

Valibot's `v.record` lets an array through, and silently drops keys with three particular names, `constructor` among them. A flag going missing while the check still passes would be a problem, so the schema refuses both before the record is read.

What the application receives is not this file as it stands.

<<< @/examples/31-progressive-delivery/src/flags/document.ts{retrieved}

According to the AppConfig documentation, the application gets only a map from flag name to value, with the definitions removed. A flag that is off becomes just `enabled: false`, without its attributes (read on 2026-10-12). Reproducing that conversion locally lets the local server and the tests read the same shape they would receive on AWS.

```bash
vp run flags:check
```

```text
flags/flags.json is valid. An application would receive:
{
  "readOnly": {
    "enabled": false
  },
  "noteStats": {
    "enabled": false
  }
}
```

## Reading the flags

<!-- section: 31.flag-read -->

The application checks the JSON it receives against a schema of the flags it reads.

<<< @/examples/31-progressive-delivery/src/flags/evaluate.ts{flags}

Every flag has a default, and a flag the build does not know is ignored. Configuration and code are deployed separately, so there is always a time when only one of them is new. New code may read an old configuration that does not have its flag yet, and old code brought back by a rollback may read a new configuration with a flag it has never heard of. Both must keep working.

What is not a set of flags is refused. Accepting an empty array or a string as "all defaults" would let a broken answer pass as a healthy configuration.

Who sees `noteStats` is decided by percentage.

<<< @/examples/31-progressive-delivery/src/flags/evaluate.ts{bucket}

The flag's name and the user's ID are joined and hashed into a number from 0 to 9999. If that number is below the percentage, the user is in. The same user always gets the same number, so the feature does not appear and vanish from one request to the next. When the percentage goes from 10 to 25, everyone who was in at 10 is still in. And because the flag's name is part of the hash, the first 10% are not the same people for every flag. The tests check these three properties over ten thousand IDs.

<<< @/examples/31-progressive-delivery/src/flags/evaluate.ts{decisions}

This is decided differently from the alias's weight. The weight is a draw per request, and one person calling twice in a row can land on two versions. A flag's percentage is fixed per person and gives the same answer however often they call. A code shift asks "does it crash", on the premise that users see no difference. A flag switches something users can see, so it is pinned per person.

AppConfig has a feature of its own for pinning a configuration per user. Ask the agent with an `Entity-Id` header, and even in the middle of a rollout the same ID gets the same version. The documentation says this needs agent version 2.0.136060 or later. The newest version in the table of Lambda extension versions, however, was 2.0.22365 (both read on 2026-10-13). Whether the Lambda extension supports the feature could not be confirmed, so this chapter does not use it and keeps the percentage arithmetic in its own code.

## When AppConfig cannot be reached

<!-- section: 31.flag-fallback -->

Reading flags from an outside service adds one more condition for the application to work. Decide beforehand what happens when AppConfig cannot be reached.

<<< @/examples/31-progressive-delivery/src/flags/reader.ts{reader}

The function that reads the flags always answers. When it could read, it uses the value and remembers it. When it could not, it uses the last value it read. When it has never read one, it uses the defaults written in the code. Where the value came from goes into the response's `x-flags-origin` header as `live`, `last-known`, or `defaults`. The log gets one line when that state changes. A warning per request for as long as AppConfig is away would put a flood of logs on top of the outage.

On Lambda, the function does not call AppConfig directly. AWS recommends adding the AppConfig Agent Lambda extension to the function as a layer.

<<< @/examples/31-progressive-delivery/src/flags/reader.ts{extension}

The extension is a separate process that runs inside the same execution environment as the function. According to the documentation it serves HTTP on `localhost:2772` and keeps the configuration in a cache of its own. When the function is invoked and a set time (45 seconds by default) has passed since the last check, it asks AppConfig whether there is a newer version. If AppConfig does not answer within a set time (3,000 milliseconds by default), it skips that check and returns what is in the cache (read on 2026-10-12). Each execution environment has its own cache.

So there are two lines of defence. The extension holds out on its cache, and when even that gives no answer, the application uses the last value it read or the defaults. The function's request to the extension has a 500-millisecond deadline. Answering with an old value is preferred to failing a request while waiting for flags.

Some things the documentation did not settle: what the extension returns for a configuration that was never deployed, and what it returns when AppConfig cannot be reached right after a cold start. The application treats any status other than 200, a timeout, and unreadable JSON as the same failure, so whatever form the answer takes, it runs on the defaults.

### Choosing the defaults

Both flags default to off. For `noteStats` that needs no thought: a feature nobody has released is not released.

`readOnly` takes more. A default of off means that when the flag cannot be read, writes are accepted. Suppose someone turned `readOnly` on and AppConfig then became unreachable. Execution environments that were already running use the last value they read and go on refusing writes. An execution environment that cold-starts in the meantime has never read anything, uses the default, and accepts writes. At the same moment, some environments refuse and some accept.

The tests pin exactly these two behaviours. For a switch that absolutely has to hold, one that stops writes during a data migration for example, make the default on, or stop the writes with something that is not a flag. With this chapter's API, one way is to deploy with the write routes removed from API Gateway. Use flags for things that may fall either way when they cannot be read.

## Building the flags into the application

<!-- section: 31.flag-app -->

Chapter 04's application is not changed. A layer goes around it that handles only the requests a flag is involved in and passes the rest to chapter 04's application as they are.

<<< @/examples/31-progressive-delivery/src/app.ts{app}

In order: the flags are read once per request. If the values change partway, one request still sees one set of values.

With `readOnly` on, write methods get a 503. It is JSON in the shape of chapter 04's errors, with the same CORS headers. Without those headers a browser does not show the page what the error says.

`GET /stats` answers only when `noteStats` is on for that user. When it is off, the request goes on to chapter 04's application, and chapter 04's 404 comes back. Until the flag is turned on, this route's code looks exactly as if it did not exist. That is what it means to deliver new code to everyone first and release the feature afterwards.

The user's ID comes from the `x-client-id` header. Chapter 04's application has no authentication, so this is a stand-in for the ID of chapter 06's signed-in user. A browser cannot send it (the preflight allows only `content-type`). It is there for `curl` and for `rollout:probe`, used later. A request without an ID is not in the rollout until the percentage reaches 100.

Every response carries the number of the version that answered, in `x-app-version`. The value is `AWS_LAMBDA_FUNCTION_VERSION`, which Lambda sets in the execution environment. During a shift, the caller can count how many answers each version gave. Like `x-flags-origin`, it is a header for practice: remove both in production, or limit them to internal callers.

`FAULT_PERCENT` makes a set share of requests answer 500 on purpose. It exists to deploy a broken version and watch the rollback work.

Everything is put together in one place.

<<< @/examples/31-progressive-delivery/src/compose.ts{compose}

The environment variables this chapter adds are read through a schema of their own, next to chapter 04's. When nothing says where the flags are, the build stops at startup. That keeps a function that was told nothing from running quietly on the defaults.

<<< @/examples/31-progressive-delivery/src/env.ts{env}

## How flags are deployed

<!-- section: 31.flag-deploy -->

The stack creates the containers for the flags and no more.

<<< @/examples/31-progressive-delivery/infra/lib/progressive-stack.ts{flags}

These are an AppConfig application, a configuration profile, and a deployment strategy. The flag values are not in the stack. If every flag change needed a stack deploy, separating code from behaviour would have been for nothing. Storing the values and handing them out is the job of `flags:deploy`.

A deployment strategy is the pace of handing out. This one takes five minutes at 20% a step, then watches the alarms for five more. AppConfig has predefined strategies too. `AppConfig.Linear20PercentEvery6Minutes`, which AWS recommends for production, takes 30 minutes to hand out and watches for 30. That is long for trying things repeatedly, so the stack makes a short one.

The unit that is handed to here is not a user. It is whoever comes to fetch the configuration, and on Lambda that is the extension in each execution environment. Partway through, some execution environments have the new configuration and some do not. One user's requests landing on both will see the flag come and go. The per-person pinning that `rolloutPercent` gives `noteStats` holds within one configuration. For the few minutes until a new configuration has reached every execution environment, there are two configurations.

The function gets the extension's layer and the place to read from.

<<< @/examples/31-progressive-delivery/infra/lib/progressive-stack.ts{extension}

<<< @/examples/31-progressive-delivery/infra/lib/progressive-stack.ts{function}

The layer's ARN comes from the version table in the AppConfig User Guide (read on 2026-10-12). There is also a public SSM parameter that returns the latest ARN, but what it returns can change from one deploy to the next, so the version is pinned like every other dependency in this book. With `AWS_APPCONFIG_EXTENSION_PREFETCH_LIST` set, the extension fetches the configuration when it starts, without waiting for the function to initialize.

The environment and the permissions are created after the alarms exist.

<<< @/examples/31-progressive-delivery/infra/lib/progressive-stack.ts{environment}

The AppConfig environment has the two alarms from the previous page attached as monitors. If an alarm fires while flags are being handed out, or in the bake time afterwards, AppConfig goes back to the previous configuration. The alarms that stop a code shift stop flags too.

The role AppConfig reads the alarms with has only `cloudwatch:DescribeAlarms` on the two alarms. The example in the AppConfig documentation uses `*` as the resource, giving as the reason that reading composite alarms needs `*`. This chapter's alarms are not composite, and the AWS service reference lists `DescribeAlarms` as something that can be limited to individual alarms, but whether automatic rollback works with the narrowed permission has not been checked on AWS.

The function can read this one configuration, in this one environment, of this one application.

Storing and handing out is two API calls.

<<< @/examples/31-progressive-delivery/src/flags/appconfig.ts{deploy}

The first stores the file's content as a new version. At that point it reaches nobody. The second starts handing that version out to the environment with the chosen strategy. `flags:deploy` begins by checking the file against the local schema and rules, and does not call AWS if it fails.

Stopping means different things depending on the current state.

<<< @/examples/31-progressive-delivery/src/flags/appconfig.ts{stop}

According to the description in the SDK's type definitions, `StopDeployment` without `AllowRevert` works only on a deployment whose state is `DEPLOYING`. With it, a deployment in progress becomes `ROLLED_BACK`, and a completed one becomes `REVERTED` and goes back to the previous version. After 72 hours from completion it can no longer be reverted. This script always sends `AllowRevert`, and prints whether it is going to stop or revert before it does.

## Data both versions can read

<!-- section: 31.shared-data -->

Moving the alias back moves the code back. The data the new version wrote while it had 10% does not move back.

The [rolling update section](/en/chapters/12-containers/more.md) of chapter 12 turned the invariant for old and new tasks reading the same records into a test. With a weighted alias the condition is the same, and stricter in one respect. Chapter 12's update only went forward. This chapter's shift can turn around partway, and after it does, the old version reads records the new version wrote.

The record formats and the shared store of chapter 12 are used as they are.

<<< @/examples/31-progressive-delivery/test/versions.test.ts{shared-data}

The test runs two versions at 50% each and lets both write, then sets the weight back to 0 and has the old version read the list. The random numbers are seeded, so requests are routed in the same order every time.

It looks at three cases. With a pair that can read each other's records, everything succeeds during the shift and after going back. When the new version requires a field the old records lack, only the requests that land on the new version answer 500. That is a failure an alarm catches, and going back fixes it.

The third is the case going back does not fix. When the old version is built to reject fields it does not know, it cannot read the records the new version wrote. After the alias is moved back, every request reaches the old version, and every one of them fails. The rollback succeeded and the service is still broken.

When the shape of data changes, split the change as in chapter 12. First ship, to everyone, code that can read the new shape and still writes the old one. Then ship code that writes the new shape. Only that second change is one worth shifting gradually, because the version you would turn back to can already read the new shape.

## Shifting an ECS service in steps

<!-- section: 31.ecs -->

Chapter 12's service was updated by rolling update. New tasks are added, and once they pass the health check, old tasks are removed. When they do not start properly, the circuit breaker goes back to the previous deployment.

What the circuit breaker counts is tasks that could not start and tasks replaced for failing health checks. According to the ECS documentation, the default threshold is 50% of the desired task count, bounded to at least 3 and at most 200 (read on 2026-10-13). A version that starts, answers `/health` with 200, and answers 500 to some real requests is invisible to the circuit breaker.

ECS has two mechanisms that fill the gap. Both are features of ECS itself and need no CodeDeploy.

One is tying alarms to a deployment. When a named alarm goes into `ALARM`, ECS marks the deployment failed and, depending on the setting, goes back to the previous one. It works with the rolling update as it is.

The other is changing the deployment strategy itself. According to the ECS API reference there are four: `ROLLING`, `BLUE_GREEN`, `LINEAR`, and `CANARY` (read on 2026-10-13). `BLUE_GREEN` stands a new set of tasks up beside the old set and switches traffic all at once. `CANARY` first sends a set percentage to the new set, and the rest after a set time. `LINEAR` sends the same percentage at the same interval. The documentation for blue/green and canary says the old set is kept running for a while after the switch. That time is the bake time, and going back is only a matter of returning traffic to the old set, which is still running.

Written in the CDK, a canary looks like this.

<<< @/examples/31-progressive-delivery/infra/lib/ecs-canary-sketch.ts{ecs}

Compared with a rolling-update service, three things are added. It needs two target groups. ECS registers the old tasks in one and the new tasks in the other, and moves traffic by rewriting the weights of a rule on the load balancer's listener. For that you tell ECS which rule it may rewrite and give it a role for operating the load balancer. And during the shift and the bake time, old and new tasks both run. The task count is temporarily up to double, and Fargate charges for it.

`canaryPercent` takes 0.1 to 100 in steps of 0.1 and defaults to 5. The canary time takes 0 to 1,440 minutes and defaults to 10.

One difference from the previous page's script is worth writing down. According to the ECS documentation, when an alarm is already in `ALARM` as a deployment starts, ECS does not watch the alarms for that deployment. This is to let through the next deployment, the one that fixes a broken one. This chapter's script, in the same situation, declines to start at all. Neither is the right one. A deployment that repairs something that is down and a deployment that changes something that is up want different behaviour.

This stack is only synthesized and read in a test. It is not part of the deployed app, because a load balancer and two tasks are billed by the hour just for existing. Whether chapter 12's service can be updated to this strategy without being recreated, and whether the pinned cdkd sends the new properties to ECS, have not been checked. As for the circuit breaker, the API reference says it "can only be used for services using the rolling update" deployment type. Whether it can be combined with `CANARY` and the other strategies is also unconfirmed.
