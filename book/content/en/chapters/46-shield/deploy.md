---
title: "46 Shield: Deploy"
---

# 46 Shield: Deploy

This page has the steps for deploying the two stacks built in [Design and Build](/en/chapters/46-shield/build.md), and what to decide before an attack comes. None of these steps was run for this chapter.

## Deploy and check

<!-- section: 46.deploy -->

The default stack creates nothing with a monthly fee.

```bash
vp run shield:infra:diff
vp run shield:infra:deploy
```

There are three things to check, named here by the stack's outputs.

- Calling `FunctionUrl` directly with `curl -i` answers 403. That confirms the origin is closed
- Calling `/health` on `Url` twice in a row gives a second response whose `x-cache` is `Hit from cloudfront` and whose `x-request-id` equals the first one's
- `/health?x=1` returns the same cached answer. `/notes` keeps saying `x-cache: Miss from cloudfront`, however often it is called

Attaching the web ACL takes two deploys, because the stacks are in two Regions. **From the moment the first line runs, it costs USD 6.10 a month.**

```bash
vp run shield:edge:infra:deploy
vp run shield:infra:deploy -c webAclArn=<WebAclArn of AihShieldEdge>
```

To add the brake as well, put it on the same command.

```bash
vp run shield:infra:deploy -c webAclArn=<WebAclArn of AihShieldEdge> -c reservedConcurrency=20
```

The `-c` values are passed on every deploy. Deploying again without one removes that setting.

For the alarm to reach a person, create an SNS topic in us-east-1 and add `-c alarmTopicArn=<ARN>` to `shield:edge:infra:deploy`. The alarms are in us-east-1, so pass a topic from the same Region. Whether an alarm can notify a topic in another Region was not confirmed, so the context check accepts only a topic in us-east-1. Chapter 19's topic (in ap-northeast-1) is refused. Without a topic the alarm only shows in the console.

In an account subscribed to Shield Advanced you can add the protection.

```bash
vp run shield:edge:infra:deploy -c shieldAdvanced=on -c distributionArn=<DistributionArn of AihShield>
```

To see the rate-based rule work, send only a little more than the limit, from one address of your own, to your own distribution. Ten requests a second for three minutes, for example. What AWS says about load testing is in [chapter 32](/en/chapters/32-limits.md).

You cannot run a test that imitates an attack yourself. AWS's DDoS Simulation Testing Policy restricts simulation tests to partners that AWS has approved in advance. The target is restricted too, to such things as a resource protected in an account subscribed to Shield Advanced, and the request volume may not exceed 50,000 a second. That is one more reason the simulation in this chapter is a model on your own machine.

```bash
vp run shield:infra:drift
```

After the emergency stop of the next section has been entered by hand, the function's reserved concurrency differs from the template and should show up as drift.

## What to prepare before an attack

<!-- section: 46.runbook -->

During an attack there is no time to put steps together from documentation you are reading for the first time. These are the things to write down beforehand, in order.

### The metrics to watch

None of them tells you anything unless you know its usual value. Look at a week of normal traffic first.

| Metric | Where | How to read it |
| --- | --- | --- |
| `Requests`, `4xxErrorRate`, `5xxErrorRate` in `AWS/CloudFront` | us-east-1 | How many times the usual number of requests. A rise in 429s means the brake is working |
| `BlockedRequests` in `AWS/WAFV2` | us-east-1 | What the rate-based rule is stopping. This chapter's alarm watches it |
| `Invocations`, `Throttles`, `ConcurrentExecutions` in `AWS/Lambda` | ap-northeast-1 | What reached the function, and what the brake refused |
| `DDoSDetected` and others in `AWS/DDoSProtection` | us-east-1 for CloudFront | Reported only for resources protected with Shield Advanced |

`AWS/DDoSProtection` holds the metrics Shield Advanced reports for the resources it protects. Whether anything appears in that namespace in an account without a subscription was not checked. The documentation describes it for Advanced customers only.

### The moves you have

From the gentlest to the harshest.

1. See who is sending. The web ACL is set to keep samples of requests. The list of IP addresses the rate-based rule is limiting right now is not shown in the console, so read it with `aws wafv2 get-rate-based-statement-managed-keys`
2. Lower the rate-based rule's limit. Change the numbers in `src/defences.ts` and run `shield:edge:infra:deploy`. Changing a setting resets the counts and pauses limiting for up to a minute
3. Cache more routes. If the attack concentrates on one route and its answer is the same for everyone, this helps most
4. Lower the function's reserved concurrency. It protects what is behind the function, and users are refused in the same proportion
5. The emergency stop. With reserved concurrency at 0, the function URL answers 429 to every request

```bash
aws lambda put-function-concurrency --function-name <the FunctionName output> --reserved-concurrent-executions 0
```

Number 5 takes your own service down. Use it only when something behind the function keeps running up the bill unless it is stopped. Decide beforehand who may make that call. To undo it, run `shield:infra:deploy` again.

### Who to contact

Without a Shield Advanced subscription, the contact is ordinary Support. Being put through to the SRT during an attack is only for Advanced customers who also have the Business Support plan or above. Find out which channel your account's Support plan gives you and how quickly it answers, and write it down.

To tell an attack from a problem on AWS's side, look at AWS Health from [chapter 44](/en/chapters/44-health.md).

### Afterwards

- Record what arrived and which move worked. Revisit the limit's numbers and the cached routes for next time
- Put settings changed by hand back into the code, or bring the code in line with them. Confirm with drift detection
- A Shield Advanced customer can apply for credits within 15 days after the end of the billing month of the attack, with a billing case that has `DDoS Concession` in its subject
