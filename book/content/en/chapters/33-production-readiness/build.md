---
title: "33 Production Readiness: Design and Build"
---

# 33 Production Readiness: Design and Build

[The overview](/en/chapters/33-production-readiness.md) split the review into three ways of checking. This page builds the first: the check that reads synthesized templates. At the end it applies production settings to chapter 19's stack, so that there is one stack the check passes.

Tools with the same purpose exist. cdk-nag checks CDK applications or CloudFormation templates against rule packs (AWS Solutions, HIPAA Security, NIST 800-53, and others). CloudFormation Guard validates JSON and YAML against policies written in its own language. For the state after a deploy, the list of AWS Config managed rules has names such as `dynamodb-pitr-enabled` and `cw-loggroup-retention-period-check`. This book read their descriptions and ran none of them.

This repository has two checks of its own already. `vp check` includes the recommended rules of awscdk-lint, which find mistakes in CDK code such as a construct ID built from a variable. `sec:iam:lint` from [chapter 21](/en/chapters/21-security/build.md) finds IAM wildcards in templates.

The chapter still writes a small check, so that you find out by doing what a check that reads templates can see and what it cannot. It has 10 rules, each of which checks something an earlier chapter of this book decided. In a real project it is quicker to start from an existing tool and write only the rules it lacks.

## Reading a template

<!-- section: 33.template -->

`vp run <name>:infra:synth` turns CDK code into a CloudFormation template and writes it to `cdk.out` as `<stack name>.template.json`. That file is the input of the check.

A template is a value from outside, so its shape is checked before it is read.

<<< @/examples/33-production-readiness/src/template.ts{template}

`Resources` is required because a check handed an empty object must not answer "nothing found". A check that read nothing has not passed. The same idea comes back several times below.

Objects are checked with `jsonObject` and `jsonEntries` from chapter 21. Valibot's `v.object` accepts an array, and `v.record` silently drops keys with names such as `constructor`. A check must not miss a single logical ID, so the stricter versions chapter 21 wrote are imported as they are.

A rule reads property values, and how resources are connected. The connections are collected by following the intrinsic functions `Ref`, `Fn::GetAtt`, and `Fn::Sub`.

<<< @/examples/33-production-readiness/src/template.ts{references}

Values need one caution. A value in a template is not always a literal. If `RetentionInDays` is written as `{ "Ref": "RetentionDays" }`, the number of days is decided at deploy time, and reading the template does not tell you what it is.

<<< @/examples/33-production-readiness/src/template.ts{setting}

`setting` tells three cases apart: not written, written as a literal, and decided at deploy time. [Chapter 02](/en/chapters/02-toolchain.md)'s drift detection kept "no difference found" apart from "everything compared and equal", and this does the same: what cannot be known is not counted as fine. A value decided at deploy time is a finding in every rule.

## The 10 rules

<!-- section: 33.rules -->

A rule has a name, what happens when its finding is left alone, and the chapter that does the work.

<<< @/examples/33-production-readiness/src/rules/rule.ts{rules}

`iam-wildcard` calls chapter 21's `lintTemplate` unchanged. Two pieces of code that check the same thing end up with only one of them being fixed.

<<< @/examples/33-production-readiness/src/rules/rule.ts{iam}

Of the rest, look at the three that protect data.

### Data that goes away with its stack

<<< @/examples/33-production-readiness/src/rules/data.ts{stateful-delete}

Every stack in this book used `RemovalPolicy.DESTROY`, so that nothing was left when practice was over. Production wants the opposite: deleting a stack must not double as deleting data.

The rule looks at two attributes. `DeletionPolicy` decides what happens to the real resource when the stack is deleted or the resource is removed from the template. According to the CloudFormation documentation, a resource with no `DeletionPolicy` is deleted. The exceptions are `AWS::RDS::DBCluster` and an `AWS::RDS::DBInstance` that belongs to no cluster, for which a snapshot is taken by default.

The other, `UpdateReplacePolicy`, is easy to overlook. Changing some properties makes CloudFormation replace the resource. It creates the new one first and then, by default, deletes the old one. A deploy that changes one letter of a table's name deletes the old table with everything in it. `DeletionPolicy: Retain` does not stop that deletion, so a resource with only one of the two set to `Retain` is a finding too.

The types it covers are those whose contents the repository cannot rebuild: tables, buckets, databases, volumes, user pools, secrets, keys, and log groups. Queues and functions are not included. Neither are ECR repositories, since an image can be built again from source. Where this line is drawn is this book's judgment.

The meaning of the two attributes was read from the CloudFormation documentation and not confirmed by deleting a stack. cdkd, which this book normally deploys with, reads both attributes in the code of the pinned version, and that was not run either.

### A public bucket

<<< @/examples/33-production-readiness/src/rules/data.ts{bucket-public}

For a bucket, the rule checks whether the template blocks public access. It passes when all four settings of `PublicAccessBlockConfiguration` are written as `true`. A bucket without them is not necessarily public. According to the S3 documentation, new buckets do not allow public access by default, and there are account-wide settings as well. It is still a finding, because the template alone does not let you say that access is blocked.

In a bucket policy, the rule reports an `Allow` statement whose `Principal` is `*` and which has no `Condition`. A statement with a `Condition` passes. The check does not evaluate whether the condition means "from this VPC endpoint" or something anyone satisfies. A policy open to everyone under a condition has to be read by a person.

This rule had a mistake that was found while it was being written. The first version checked the shape of a statement with Valibot's `v.looseObject`, which takes an array for an object and turns it into an object with the keys `0`, `1`, and so on. CDK always writes statements as an array, so no statement inside an array was ever inspected, and the tests passed, because they used a single statement that was not in an array. It was found when breaking the condition check on purpose did not make any test fail. The rule now uses chapter 21's `jsonObject`, and the tests cover both shapes.

### A table whose past cannot be restored

<<< @/examples/33-production-readiness/src/rules/data.ts{table-pitr}

This is the point-in-time recovery that [chapter 22](/en/chapters/22-recovery.md) turned on. A global table (`AWS::DynamoDB::GlobalTable`) has the setting per replica, so every replica is checked: it can be on in one Region and off in another. Global tables themselves are the subject of [chapter 28](/en/chapters/28-multi-region.md).

Passing this rule does not mean the table can be restored. It checks that the setting is written. Whether a restore was ever tried does not appear in a template.

## An alarm that watches the function

<!-- section: 33.watching -->

A rule that finds "a function with no alarm" is useless if written plainly, because the alarms of [chapter 19](/en/chapters/19-observability.md) are on the API, not on the function. Chapter 19 put its alarms on the symptom (the share of 5xx answers and slowness, as users see them) and not on the cause (errors of the function). Reporting that the function's `Errors` metric has no alarm would call chapter 19's decision a mistake.

So the rule works out, from the connections in the template, where an alarm may watch on behalf of a function.

<<< @/examples/33-production-readiness/src/rules/watching.ts{watch-points}

These are the function itself, an HTTP API that integrates with it, a queue that feeds it, and that queue's dead-letter queue. When the API calls an alias, as in [chapter 20](/en/chapters/20-shipping.md)'s stack, the rule follows the alias to the function.

<<< @/examples/33-production-readiness/src/rules/watching.ts{function-alarm}

If no alarm in the template watches any of those places, it is a finding.

Those three paths are the only ones followed. A function invoked by a schedule, an SNS topic, a state machine, or a bucket notification is a finding even when its caller has an alarm. The reasoning is that a function run by a clock, like the housekeeping function of [chapter 08](/en/chapters/08-async.md), has no user who would notice its failure, so it needs an alarm of its own. Functions invoked from an event bus or a topic, which [chapter 25](/en/chapters/25-events.md) covers, are treated the same way.

An alarm that reaches nobody is no better than none.

<<< @/examples/33-production-readiness/src/rules/watching.ts{alarm-recipient}

There are three cases that are findings: no `AlarmActions`, `ActionsEnabled` set to `false`, and a topic in the template that nobody subscribed to. Chapter 19's stack is in the third state when it is deployed without an email address. Chapter 19 described that state as "the alarm fires and nothing arrives", and this rule finds it before the deploy.

When the action is an ARN written out, or imported from another stack, the rule says nothing, because the template does not show whether anyone is behind it. A subscription that exists still delivers nothing until the link in the confirmation mail is clicked, and that does not appear in a template either.

## Waivers with a reason

<!-- section: 33.waivers -->

Some findings are looked at and kept. Chapter 21 required a reason for each action that keeps `Resource: "*"`. The same mechanism is extended here to every rule.

<<< @/examples/33-production-readiness/src/check.ts{waiver}

A waiver has a rule, a resource or the wording of a finding (or both), and a reason. A waiver with neither a resource nor a wording is refused, because allowing it would let one rule be switched off for a whole stack. The reason is at least 20 characters, so that "practice" alone is not enough.

<<< @/examples/33-production-readiness/src/check.ts{check}

A waiver that nothing used is treated like a finding and fails a stack that was asked to pass. A waiver left behind after the cause was fixed silently hides the next finding of its kind. Chapter 21's lint has the same rule.

Chapter 21's file of exceptions is read as it is.

<<< @/examples/33-production-readiness/src/check.ts{iam-exceptions}

Chapter 21 wrote, per stack and with a reason, which actions may stay on `*`. Those are converted into this chapter's waivers and applied to the same stacks, so that no reason has to be written in two places.

This chapter has two waivers of its own.

<<< @/examples/33-production-readiness/readiness/waivers.json

Chapter 19's function uses active tracing, for which CDK allows two X-Ray actions on `*`. The reason is the one chapter 21 wrote for `AihObservability`, under this chapter's stack name.

## Applying production settings

<!-- section: 33.twins -->

The chapter needs one stack the check passes. It does not build a new application. It uses the stack class of chapter 19 twice, unchanged.

<<< @/examples/33-production-readiness/infra/bin/app.ts{twins}

`AihReadyPractice` is the stack exactly as chapter 19 wrote it. `AihReadyProduction` is the same class with production settings applied. Both are synthesized to be read, and there is no deploy task for them. That is also why the default recipient is `oncall@example.com`: `example.com` is a reserved domain and delivers nowhere.

The settings are applied by a CDK aspect.

<<< @/examples/33-production-readiness/infra/lib/production-settings.ts{aspect}

An aspect visits the constructs of a stack one at a time. When it finds a table, it turns on PITR and deletion protection and sets `Retain`. When it finds a log group, it sets the retention to 90 days and sets `Retain`. `applyRemovalPolicy` writes both `DeletionPolicy` and `UpdateReplacePolicy`.

The aspect was chosen so that chapter 19's files would not have to change, and it has another advantage. An aspect runs at synthesis, so a table added to the stack later gets the same settings. A test adds a table after the aspect was attached and checks that it has PITR too. This closes the most common gap, which is the person who creates a new table and forgets the settings.

In a stack of your own, though, the settings are easier to read when written where the table is created. An aspect fits when you want the same rule on every stack of an organization.

The retention of 90 days is a value this chapter chose, not a recommendation. How to decide is on chapter 19's [cost page](/en/chapters/19-observability/wrap.md): by how far back you need to investigate, and how long you are allowed to keep the data.

The aspect changes settings of existing resources and adds no resource. Comparing the resource types of the two stacks, the only difference is the subscription of the recipient (`AWS::SNS::Subscription`). A test pins this as well.

The next page runs the check on these two stacks, and on every stack in the book.
