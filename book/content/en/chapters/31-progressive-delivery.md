---
title: "31 Progressive Delivery: Aliases, Canaries, Blue/Green, and Feature Flags"
sourceRevision: 1
---

# 31 Progressive Delivery: Aliases, Canaries, Blue/Green, and Feature Flags

In [chapter 20](/en/chapters/20-shipping.md), the moment a deploy succeeded, every request reached the new code. The only way back was to revert the code and deploy again. A defect that slipped past the tests was found after it had reached everyone.

In this chapter a change reaches a part of the requests first, and the rest only if no alarm fires. If one fires, the change is taken back before a person has noticed. You also add feature flags, which switch the behaviour of code that is already deployed without deploying. The subject is the notes API from chapter 04.

None of the AWS steps in this chapter has been run for real. What was checked locally is the tests, the type check, synthesis, and the local server. The [verification notes at the end](/en/chapters/31-progressive-delivery/wrap.md) list what is unconfirmed.

You need [chapter 20](/en/chapters/20-shipping.md) and [chapter 12](/en/chapters/12-containers.md). The alarms follow the thinking of [chapter 19](/en/chapters/19-observability.md). The code is in `examples/31-progressive-delivery/`.

## The whole picture

<!-- section: 31.overview -->

```figure
caption: A request goes through the alias to one of two versions, and both versions read the same flags
node client: Client
node api: API Gateway | HTTP API
node alias: alias live | weights
node old: version 3 | 90%
node new: version 4 | 10%
node extension: AppConfig extension | localhost:2772
node appconfig: AppConfig | flags
edge client -> api
edge api -> alias
edge alias -> old
edge alias -> new
edge old -> extension
edge new -> extension
edge extension --> appconfig: checks every 45 s
group aws: AWS account (ap-northeast-1) = api, alias, old, new, extension, appconfig
mark alias
```

```figure
caption: Code, alias, and flags are each moved by a different task, and the same two alarms stop both the shift and the flags
direction: right
node deploy: rollout:infra:deploy | cdkd
node start: rollout:start
node flags: flags:deploy
node latest: $LATEST | new code
node alias: alias live | weights
node config: AppConfig | flag version
node alarms: CloudWatch alarms | Errors, 5xx
edge deploy -> latest
edge start -> alias: UpdateAlias
edge flags -> config: StartDeployment
edge alarms --> start: read every 30 s
edge alarms --> config: monitor
```

The first figure is the path of a request. API Gateway does not invoke the function itself. It invokes an alias named `live`. The alias normally points at one version, and during a shift it points at two and splits requests between them by percentage. Both versions ask the AppConfig extension, which runs inside the same execution environment, for the flags.

The second figure shows who moves what. In this chapter, delivering a change is three separate operations.

- `rollout:infra:deploy` puts the new code in `$LATEST`. The alias does not move, so at this point it reaches nobody
- `rollout:start` freezes that code as a version and moves the alias's weight to it a step at a time. If an alarm fires, it goes back
- `flags:deploy` stores the flag values in AppConfig and hands them out to the execution environments gradually

All three use the same two alarms to decide when to stop.

## Releasing code and releasing behaviour

<!-- section: 31.release-vs-deploy -->

Up to chapter 20, deploying and changing what users experience were one event. This chapter separates the two, so that each can be moved on its own.

The alias's weight decides which code answers a request. Give the new version 10%, and 10% of requests are handled by the new code. What you want to learn is that the new code does not crash, does not get slower, and can read the old data. The split is decided per request, so two requests in a row from one user can land on different versions.

A flag decides what the same code does. The code of a new feature goes out to everyone with its flag off. Who sees the feature is decided later, by the flag. That is decided by the user's ID, so the same user always gets the same answer.

With the two apart, you can choose what to take back when something goes wrong. If the new code itself is broken, move the alias back. If the new feature is the problem, turn the flag off. Turning a flag off needs no deploy.

The price is more combinations of state. Two versions of the code and a flag that is on or off make four combinations running at once. Code that reads and writes data has to coexist with all of them. This is the invariant from chapter 12's rolling update, and [Build, Continued](/en/chapters/31-progressive-delivery/more.md) turns it into a test.

## Why it is built this way

<!-- section: 31.choices -->

AWS has a ready-made mechanism for moving a Lambda alias in steps: CodeDeploy. In a CloudFormation template you put an attribute called `UpdatePolicy` on the alias, and when the version the alias points at changes, CloudFormation asks CodeDeploy to do the shift.

This book's stacks are deployed with cdkd. The pinned cdkd (0.296.28) calls each service's API directly without going through CloudFormation, and it has no code that reads `UpdatePolicy`. A search of the installed cdkd finds neither `UpdatePolicy` nor `CodeDeploy` anywhere. So this chapter writes the part that moves the weight itself: a small script that calls the Lambda API, with its decisions as pure functions under test.

Writing it yourself lets you read what CodeDeploy hides: how often the alarms are looked at, what happens when they cannot be read, what the alias looks like if the script dies partway. In exchange, when the terminal or the job running the script stops, the shift and the watching stop with it. CodeDeploy keeps running on AWS's side. If production goes through CloudFormation (chapter 20), CodeDeploy is the more natural choice, and the end of [Design and Build](/en/chapters/31-progressive-delivery/build.md) shows what you would write for it.

Flags use AppConfig. Keeping values as JSON, handing them out to execution environments at a set pace, and going back to the previous values when an alarm fires are all in one service. Environment variables look as if they could do the same, but a Lambda function's environment variables are fixed into a version. Changing one means making a new version, and then a flag change cannot be told apart from a code shift.

### When this setup does not fit

A gradual shift only means something when there are enough requests to judge by. On an API that gets a few requests a minute, sending 10% to the new version can mean that not one request reaches it in the minutes the canary lasts. An alarm that stayed quiet while nothing arrived is not evidence of health. [Design and Build](/en/chapters/31-progressive-delivery/build.md) does this arithmetic. While traffic is low, chapter 20's way plus a check right after the deploy is more dependable.

Flags, too, turn into debt as they multiply. A flag that is not removed when it is done leaves a switch that nobody reads in both the code and the configuration. The tests in this chapter fail when the configuration still holds a flag the code does not read.

If you are on Cloudflare Workers or Vercel and only want traffic split by percentage, both have a feature for exactly that. The [last page](/en/chapters/31-progressive-delivery/wrap.md) compares them.
