---
title: "33 Production Readiness: Run It Locally"
---

# 33 Production Readiness: Run It Locally

Everything in this chapter runs on your machine. It needs no AWS account and no credentials. This page runs the check built on [the previous page](/en/chapters/33-production-readiness/build.md) on this chapter's two stacks and then on every stack in the book. It ends with what the check cannot see.

## Running it locally

<!-- section: 33.local -->

```bash
vp test run examples/33-production-readiness
vp run ready:review
vp run ready:infra:synth
vp run ready:gate
```

The first line runs the tests: a passing and a failing case for each rule, the waivers, the verdict, and the synthesis and check of the two stacks. The tests do not read `cdk.out`. The rule tests use small templates built inside the test, and the stack tests synthesize inside the test, so they pass even when no other chapter has been synthesized.

There are two fixtures. `test/fixtures/ready.template.json` passes every rule, and `unready.template.json` has at least one finding for every rule. The two contain the same types of resources. If the passing template had no bucket, "no public bucket" might only mean that there was nothing to look at. That condition is a test too.

`ready:review` prints the 32 items of [the overview](/en/chapters/33-production-readiness.md). With the name of an area, as in `vp run ready:review data`, it prints that area only.

`ready:infra:synth` writes this chapter's two stacks to `examples/33-production-readiness/cdk.out`, and `ready:gate` runs the check on them.

```text
note AihReadyPractice
       iam-wildcard       HandlerRoleDefaultPolicy0112C0A8: wildcard-resource: xray:PutTraceSegments on Resource "*"
       iam-wildcard       HandlerRoleDefaultPolicy0112C0A8: wildcard-resource: xray:PutTelemetryRecords on Resource "*"
       table-pitr         Notes5BB3582F: point-in-time recovery is not enabled
       stateful-delete    Notes5BB3582F: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    HandlerLogs6FD01908: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       alarm-recipient    MonitoringServerErrorRate85F1112A: notifies MonitoringAlarms66989066, which has no subscription in this template
       alarm-recipient    MonitoringSlowResponses120B683C: notifies MonitoringAlarms66989066, which has no subscription in this template
ok   AihReadyProduction [gate] (2 waived with a reason)

findings by rule (chapter that does the work):
    0  bucket-public      ch.07  Objects meant for signed-in users can be read by anyone who has the URL.
    2  iam-wildcard       ch.21  A hole in one function reaches every resource the wildcard covers.
    0  function-url-auth  ch.09  The function answers requests that never passed the CDN, the WAF or sign-in.
    0  api-throttle       ch.04  One client can spend the account's whole request quota, and the bill with it.
    1  table-pitr         ch.22  A bad write or delete cannot be undone: there is no earlier state to restore.
    2  stateful-delete    ch.22  Destroying the stack, or an update that replaces the resource, deletes the data.
    0  log-retention      ch.19  Logs pile up for ever, or live in a log group nobody set a retention on.
    0  function-alarm     ch.19  The function fails for hours and the first report comes from a user.
    2  alarm-recipient    ch.19  The alarm goes to ALARM and no one is told.
    0  queue-dlq          ch.08  A message that always fails is retried until it expires, then is gone.

2 templates, 7 findings, 2 waived
gate passed: AihReadyProduction
```

A line starts with one of three marks. `ok` is a stack with no finding, `note` a stack with findings that was not asked to pass, and `FAIL` a stack with findings that was. A stack is asked to pass with `--gate <stack name>`.

<<< @/examples/33-production-readiness/src/report.ts{verdict}

The task fails when a stack asked to pass has a finding or an unused waiver, when the template of a stack asked to pass was not found, when a file could not be read, and when no template was read at all. Without the template of `AihReadyProduction`, `ready:gate` fails. It does not pass.

The 7 findings of the practice stack are the part of chapter 19's "If you take this to production" list that shows up in a template. In the production stack, settings removed 5 of them and the 2 for X-Ray became waivers with a reason. `function-alarm` is at 0 because chapter 19's alarms watch the API in front of the function.

`ready:gate` is part of `check:all`. Removing the aspect, or fixing a cause while leaving its waiver in place, makes `check:all` fail.

## The result for every stack in the book

<!-- section: 33.book-stacks -->

```bash
vp run ready:check
```

This task depends on `infra:synth`: it synthesizes every stack in the book and then reads every `cdk.out`. It asks no stack to pass. The practice stacks have findings on purpose.

The output below is from a run of the task (2026-10-13). It read 73 templates: those of every chapter that has a stack, and the book's site. By chapter, that is 02 to 36, 38 to 44, 46, 47, 49 to 64, and 66 to 68, and it includes this chapter's two stacks. Chapters 01, 37, 45, and 48 have no stack.

```text
note AihAsync
       table-pitr         Notes5BB3582F: point-in-time recovery is not enabled
       stateful-delete    Content88381566: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    Uploads4F6EB0FD: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    Users0A0EEA89: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    Notes5BB3582F: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    HandlerLogs6FD01908: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    WorkerLogsC1193B08: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    HousekeepingLogs276FB43B: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       function-alarm     Handler886CB40B: no alarm watches the function, an API in front of it, or a queue that feeds it
       function-alarm     Worker11F36D0F: no alarm watches the function, an API in front of it, or a queue that feeds it
       function-alarm     Housekeeping4D78E60A: no alarm watches the function, an API in front of it, or a queue that feeds it
```

That is chapter 08's stack. The totals follow.

```text
findings by rule (chapter that does the work):
    0  bucket-public      ch.07  Objects meant for signed-in users can be read by anyone who has the URL.
   43  iam-wildcard       ch.21  A hole in one function reaches every resource the wildcard covers.
    1  function-url-auth  ch.09  The function answers requests that never passed the CDN, the WAF or sign-in.
    0  api-throttle       ch.04  One client can spend the account's whole request quota, and the bill with it.
   27  table-pitr         ch.22  A bad write or delete cannot be undone: there is no earlier state to restore.
  135  stateful-delete    ch.22  Destroying the stack, or an update that replaces the resource, deletes the data.
    1  log-retention      ch.19  Logs pile up for ever, or live in a log group nobody set a retention on.
   50  function-alarm     ch.19  The function fails for hours and the first report comes from a user.
   15  alarm-recipient    ch.19  The alarm goes to ALARM and no one is told.
    0  queue-dlq          ch.08  A message that always fails is retried until it expires, then is gone.

73 templates, 272 findings, 9 waived
report only: no stack was asked to pass (--gate <stack>)
```

Of the 272 findings, 135 are `stateful-delete`. This book set every resource that holds data to `DESTROY`, so that nothing is left after cleanup, and that choice shows up directly as a number. Thirteen of the 73 stacks have no finding. Five of them are from the chapters up to 24: the stack with only a network, the stack with only an ECR repository, the CI roles, the web ACL, and the stack of [chapter 24](/en/chapters/24-celld.md), whose buckets were created with `Retain` from the start. The other eight are this chapter's production stack and the stacks of chapters 34, 41, 42 (the edge one), 52, 63, 64, and 66.

The 50 findings of `function-alarm` say that few stacks have alarms. There are 57 functions, and an alarm watches 7 of them: one each in the stacks of chapters 19, 31, 32, 54, and 61, and one in each of this chapter's two stacks. The 27 findings of `table-pitr` are the same story: of 30 tables, three have PITR, those of chapter 22, chapter 28, and this chapter's production stack. Both were set only in the chapters about them and left out of the others.

The 15 findings of `alarm-recipient` are of two kinds. Seven are alarms whose topic has no subscription, in chapters 19 and 54 and in this chapter's practice stack. The other eight are alarms with no action at all, in chapters 31, 32, 43, 46, 59, and 61.

The three rules at 0 mean something too. No stack in this book has a public bucket, an API without throttling, or a consumed queue without a dead-letter queue. These settings were never postponed to "If you take this to production". They were there from the start, which follows the policy stated in [chapter 01](/en/chapters/01-account.md): a chapter that opens an entry anyone can call limits, within that chapter, how much it accepts.

The one finding of `function-url-auth` is the function that receives webhooks in [chapter 62](/en/chapters/62-ci-runners/build.md). GitHub cannot add an IAM signature, so chapter 62 sets the function URL's authentication to `NONE` and verifies the signature of each request in code. That verification does not appear in a template, so to the check this is an entry without authentication.

`iam-wildcard` has 43 findings. The stacks up to chapter 24 have none because the 7 cases chapter 21 gave a reason for are counted as waivers. The `9 waived` in the output is those 7 plus the 2 of this chapter's production stack. Two of the 43 are in this chapter's practice stack, and the other 41 are in 12 stacks from chapter 25 onward. The largest groups are 18 `ec2:` actions for network interfaces in the function roles of chapters 53 and 59, and 10 `logs:` actions in the state machine role of chapter 47. No reason has been written for these 41 as waivers of this check. To take the stacks to production, write a reason for each one, as chapter 21's lint asks, or narrow the scope.

The one finding of `log-retention` is the Lambda@Edge function of [chapter 10](/en/chapters/10-edge.md), whose stack creates no log group. According to the Lambda documentation, a function by default gets a log group named `/aws/lambda/<function name>`, created automatically when it is first invoked. According to the CloudWatch Logs documentation, log data is kept indefinitely by default.

272 findings do not mean that this book's stacks should be changed in 272 places. For practice stacks, the settings they have are the right ones. Read the output as the list of where to start if you took the same stacks to production.

## What the check cannot see

<!-- section: 33.blind-spots -->

When the check that reads templates passes, what you can say is "this is what the template says", and no more. Here is what you cannot say.

**Whether this template is what is deployed.** The check reads `cdk.out` on your machine. It cannot tell whether the stack in the account was created from the same template, or whether someone changed it in the console afterwards. That is the job of drift detection ([chapter 02](/en/chapters/02-toolchain.md) and [chapter 20](/en/chapters/20-shipping.md)).

**Settings decided outside any template.** The account-wide S3 block public access, MFA on the root user, the SCPs of an organization, the values of Service Quotas, a CloudTrail trail, whether GuardDuty is on. All of these are outside a stack. `sec:posture` from [chapter 21](/en/chapters/21-security.md) reads things of this kind.

**Resources outside a stack.** As [chapter 22](/en/chapters/22-recovery/deploy.md) showed, a table restored with PITR appears outside the stack, with PITR off. A bucket created in the console is the same. What is not in a template is not checked.

**Values decided at deploy time.** Parameters, `Fn::If`, and imports from other stacks. The check reports them as unknown, and makes no judgment about whether the real value is safe. Nor does it look at whether a resource with a `Condition` is actually created.

**Whether a setting works as intended.** PITR being written as enabled is not the same as a restore working. An alarm having a recipient is not the same as a person waking up at night. Whether the link in the confirmation mail was clicked is written nowhere. Whether a threshold fits your service is not checked either.

**Paths the rules do not know.** `function-alarm` follows HTTP APIs and queues only. `api-throttle` looks at the default of an HTTP API stage only: not per-route settings, not a REST API, an ALB, or CloudFront. `bucket-public` does not evaluate a policy with a condition. `queue-dlq` looks only at queues a function reads. A problem where no rule looks still prints `ok`.

**The application code.** That one user cannot read another's notes ([chapter 06](/en/chapters/06-auth.md)), and that a message delivered twice has one result ([chapter 08](/en/chapters/08-async.md)), are kept by the tests of those chapters, not by a template.

AWS has a way to keep checking the state after a deploy. The list of AWS Config managed rules has entries with names close to this chapter's rules, such as `dynamodb-pitr-enabled`, `cw-loggroup-retention-period-check`, and `s3-bucket-level-public-access-prohibited`. What each of them evaluates was not read, and none was enabled. Config charges for every configuration item it records, so when to add it is a question for chapter 21's three tiers.

The check that reads templates is the cheapest and the earliest of all checks. It also sees the least. The next page goes through the rest, area by area.
