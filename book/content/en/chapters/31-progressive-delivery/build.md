---
title: "31 Progressive Delivery: Design and Build"
---

# 31 Progressive Delivery: Design and Build

The [previous page](/en/chapters/31-progressive-delivery.md) settled on moving code and flags separately. This page builds the code side: where the alias sits, the plan of a shift, the decision from the alarms, and the run. Flags are on the [next page](/en/chapters/31-progressive-delivery/more.md).

## Versions and the alias

<!-- section: 31.alias -->

Chapter 20 used Lambda versions and an alias. A version is a numbered copy of the code and configuration as they were at one moment, and an alias is a name given to a version. Have API Gateway invoke the alias, and changing what the alias points at changes where requests go.

An alias can also point at two versions at once. According to the Lambda documentation it can point at two at most, under these conditions (read on 2026-10-12).

- Both are published versions. An alias cannot point at `$LATEST`
- Both have the same execution role
- Both have the same dead-letter queue configuration, or neither has one

The split is a probability, decided per request. The documentation says that at low traffic the actual percentages can differ widely from the configured ones.

Chapter 20's stack used the CDK's `currentVersion`. Each change to the function made a new version resource and the alias pointed at it, so every request had switched by the time the deploy finished. In this chapter a deploy must not move the alias.

<<< @/examples/31-progressive-delivery/infra/lib/progressive-stack.ts{alias}

There is one version resource, and its only property is the function's name. When you change the code and deploy, nothing about this resource has changed in the template, so no new version is published and the alias stays where it was. Only `$LATEST` changes, and nothing invokes `$LATEST`. The stack's tests pin that there is one version resource and that the alias carries no weights.

Placing the alias this way means accepting two things.

One is that the alias drifts away from the template. Right after creation it points at version 1, and after the first shift it points at 2. The template still says 1. The same happens in a CodeDeploy setup: once created, the alias no longer belongs to the deployment tool. How chapter 02's drift check reports this difference is unknown, because it has not been run.

The other is that only code and function configuration sit behind the alias. Environment variables, memory, timeout, and layers are fixed into a version, so they shift gradually. IAM policies, API Gateway routes, and alarms are not part of a version, so they apply to every request the moment they are deployed. Put a change that removes a permission into the same deploy as a code change, and the old version loses the permission first.

## The plan of a shift

<!-- section: 31.plan -->

Which percentage moves, and over how long, is arithmetic that is settled before AWS is called. Here are the type for a plan and the function that makes one.

<<< @/examples/31-progressive-delivery/src/shift/plan.ts{plan}

Plan names are written the way CodeDeploy writes its configurations for Lambda. The CodeDeploy documentation lists nine predefined ones, such as `CodeDeployDefault.LambdaCanary10Percent5Minutes` (read on 2026-10-12). A canary moves 10% first and the rest all at once after a set time. A linear plan moves 10% at each interval. This function reads the name without the prefix, so the same name carries over when you move to CodeDeploy later. The tests check that the nine names produce the steps the documentation describes.

The last step is always 100%, and the time that step is watched is the bake time. After every request reaches the new version, the alarms are still watched for a while, and a firing alarm still sends the alias back.

You can print a plan locally.

```bash
vp run rollout:plan
```

```text
Canary10Percent5Minutes
  at     0 s:  10% on the new version, watched for 300 s
  at   300 s: 100% on the new version, watched for 300 s
  done after 600 s at the earliest
  at 10%, 20 requests all miss the new version with probability 0.122;
  it takes 44 requests to bring that below 0.01
```

Turning a percentage into the alias's settings is a function as well.

<<< @/examples/31-progressive-delivery/src/shift/plan.ts{weights}

Below 100%, the alias still points at the old version and the new one is only added as a weight. Going back is a single write that removes the weight, and there is no old version number to remember.

### What a small share sees

The last two lines of the output are the arithmetic behind "it means nothing when requests are few" from the previous page.

<<< @/examples/31-progressive-delivery/src/shift/plan.ts{sample}

If each request is routed independently, then with a 10% weight and 20 requests, the chance that not one of them reaches the new version is 0.9 to the 20th power, about 12%. Getting that chance under 1% takes 44 requests. An API with two requests a minute sees 10 requests during a five-minute canary, and one time in three it goes on to 100% without the new version having received a single one.

This treats Lambda's routing as independent trials. It is not a measurement of the real distribution. It does give a lower bound when you choose how long a step lasts: work back from the number of requests the new version must receive in that time.

## Deciding from the alarms

<!-- section: 31.decide -->

Whether to go on or go back is decided by the state of alarms. The stack creates two for the purpose.

<<< @/examples/31-progressive-delivery/infra/lib/progressive-stack.ts{alarms}

There are two because they watch different things. Lambda's `Errors` counts invocations that ended in an exception or timed out. Chapter 04's application catches an error raised along the way and builds the 500 response itself. To Lambda that is an invocation that ended normally, so `Errors` does not count it. What counts the 500s that reached users is API Gateway's `5xx`.

The threshold is one a minute. That is far too sensitive for an alarm that pages a person, but these two page nobody. They only decide whether a shift stops, so when in doubt they lean towards going back. A minute without data counts as not breaching (`NOT_BREACHING`), to keep "no requests came" apart from "it is broken".

The centre of the decision is a function from one observation to the next action.

<<< @/examples/31-progressive-delivery/src/shift/decide.ts{types}

<<< @/examples/31-progressive-delivery/src/shift/decide.ts{decide}

There are three rules.

If even one alarm is in `ALARM`, the shift goes back at once, whether in the middle of a step or of the bake time.

Only when every alarm answers `OK` does elapsed time move the shift to the next step. It does not advance when `INSUFFICIENT_DATA` is among the answers, or when the call that reads the alarms failed. Treating "could not read" as "not firing" would let the shift walk to 100% unwatched for as long as CloudWatch is having trouble.

When the alarms have been unreadable for longer than a set number of seconds, the shift goes back. Waiting at 10% forever is not an option either.

The same alarms are looked at before starting.

<<< @/examples/31-progressive-delivery/src/shift/decide.ts{start}

A shift does not start under an alarm that is already firing. There would be no telling whether the new version set it off or it was firing before.

This function knows neither the time nor AWS. The time is an argument, and so are the alarm states. The tests check that it waits at 299 seconds and advances at 300, and that it goes back after 180 seconds without a reading, all without a clock ticking.

## Running the shift

<!-- section: 31.run -->

```figure
type: sequence
caption: What happens when an alarm fires during the canary. The script reads the alarms every 30 seconds and removes the weight when one is firing
actor script: rollout:start
actor lambda: Lambda
actor cloudwatch: CloudWatch
step script -> lambda: PublishVersion
step lambda --> script: version 4
step script -> cloudwatch: DescribeAlarms
step cloudwatch --> script: OK, OK
step script -> lambda: UpdateAlias (0.1 on 4)
note script: reads every 30 s for 300 s
step script -> cloudwatch: DescribeAlarms
step cloudwatch --> script: ALARM
step script -> lambda: UpdateAlias (no weights)
```

The side that runs the shift treats three things as handed in from outside: the alias, the alarms, and the clock.

<<< @/examples/31-progressive-delivery/src/shift/run.ts{ports}

The real implementations are a thin layer over the Lambda and CloudWatch SDKs.

<<< @/examples/31-progressive-delivery/src/shift/aws.ts{alias}

<<< @/examples/31-progressive-delivery/src/shift/aws.ts{alarms}

Every write to the alias sends the `RevisionId` from the read before it. According to the Lambda API reference, `UpdateAlias` with a `RevisionId` fails when the alias has changed since it was read (read on 2026-10-12). This is the conditional write of chapter 05 put to the same use: an alias someone corrected by hand in the console is not overwritten by a script acting on an old decision.

The alarms are read by name, and a name that does not come back is a failure. A deleted alarm looks exactly like an alarm that is not firing.

The new version is published when the shift starts.

<<< @/examples/31-progressive-delivery/src/shift/aws.ts{publish}

`PublishVersion` does not make a new version when neither code nor configuration has changed since the last one. Running `rollout:start` again on the same code does not pile up versions.

### When a write fails

A write across a network can succeed while its answer never arrives.

<<< @/examples/31-progressive-delivery/src/shift/run.ts{put}

After a failure, the alias is read again first. If it is in the wanted state, the write did arrive, and the run moves on. If it is not, and the `RevisionId` is unchanged, the write did not arrive, and it is sent again. An alias setting is an absolute value, "10% on the new version", so sending it twice gives the same result. If the `RevisionId` has changed, someone else wrote, and the run stops there.

### The whole run

<<< @/examples/31-progressive-delivery/src/shift/run.ts{run}

There are four outcomes.

<<< @/examples/31-progressive-delivery/src/shift/run.ts{outcome}

`refused` and `abandoned` are separate because they differ in whether the alias was touched. `refused` declined before starting, so nothing changed. `abandoned` means someone else changed the alias partway, and the run ended without touching it further. The same holds when the run finds someone else's change at the moment it wants to roll back: it does not overwrite. The other party may know something this script does not. In both cases the task exits non-zero. So does a run that ends in a rollback: the rollback worked as designed, and the release still failed.

The invariant this code keeps fits in one sentence.

> During a shift the alias points only at the old version and the new one, and once an alarm has been seen in `ALARM`, the run ends with every request back on the old version. When it could not get back, it says so.

The tests replace the alias, the alarms, and the clock with fakes and try to break that. They replay, in a fixed order, an alarm firing during the canary, an alarm firing in the bake time after 100%, alarms becoming unreadable, the rollback write failing once, the answer to a write being lost, and someone else changing the alias partway.

### If the script stops partway

Unlike CodeDeploy, this script runs in your terminal or in a CI job. Close the terminal during the 10% step and the alias stays at 10%, with nobody watching the alarms. Nothing on AWS's side picks the work up.

So the script can be run again to continue. If the alias gives the new version some weight, the run resumes at the step for that percentage and starts watching that step from the beginning. If an alarm is firing when it resumes, it goes back. If the alias gives weight to a different version, another shift is in progress, and the run declines without doing anything.

Being able to resume is not a substitute for not stopping. For a plan longer than ten minutes, run it somewhere that does not disappear partway.

## Leaving it to CodeDeploy

<!-- section: 31.codedeploy -->

If the production stack is deployed with CloudFormation, CodeDeploy can do the same job. In the CDK it is these few lines.

<<< @/examples/31-progressive-delivery/infra/lib/codedeploy-sketch.ts{codedeploy}

This function is not part of the deployed app. A test synthesizes a template with it and checks only that the alias gets the `CodeDeployLambdaAliasUpdate` `UpdatePolicy` and that the deployment group names `CodeDeployDefault.LambdaCanary10Percent5Minutes`. According to the CloudFormation template reference, with this attribute CloudFormation performs a CodeDeploy deployment when the version on the alias changes (read on 2026-10-13). As said above, the pinned cdkd has no code that reads this attribute. What happens when cdkd deploys this template has not been tried.

Leaving it to CodeDeploy gets you what this chapter's script lacks. The shift proceeds on AWS's side, so closing a terminal does not stop it. The `UpdatePolicy` can name Lambda functions to run as hooks before and after traffic is moved.

The price could not be confirmed. The CodeDeploy list in the AWS Price List has only on-premises instance updates (USD 0.02 each) and no item for deployments to Lambda (read on 2026-10-13). The text of the pricing page could not be read, so this page does not say "free".
