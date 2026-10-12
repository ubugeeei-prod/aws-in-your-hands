---
title: "21 Security: Build, Continued"
---

# 21 Security: Build, Continued

## Entry points that can carry WAF, and ones that can't

<!-- section: 21.waf -->

AWS WAF inspects requests before they reach your application, and stops some. Its unit of configuration is called a web ACL.

It can't be attached just anywhere. This is the list in the official documentation (checked 2026-10-12).

- CloudFront distributions
- API Gateway REST APIs
- Application Load Balancers
- AppSync GraphQL APIs, Cognito user pools, App Runner services, Bedrock AgentCore Gateway, Verified Access instances, and Amplify

Of the entry points this book has used, API Gateway HTTP APIs (chapter 04) and Lambda function URLs (chapters 09 and 17) are not on that list. If you want WAF there, you put CloudFront in front and attach it to CloudFront. That is why this chapter's setup starts at CloudFront.

Attaching it to CloudFront is not enough by itself, however. If a back entrance is open, people come in that way.

<<< @/examples/21-security/infra/lib/security-stack.ts{entry}

Set the function URL's `AuthType` to `AWS_IAM` and have CloudFront's origin access control sign the requests: the same shape as chapter 09. Lambda refuses unsigned requests before the function runs. With no way around CloudFront, there is no way around the web ACL.

Putting an HTTP API behind CloudFront is something this book has neither implemented nor verified. If you do it, decide how the back entrance gets closed first.

Signing brings constraints of its own. CloudFront puts its signature in the `Authorization` header, so this API takes its token in a separate header, `x-aih-token`. And as chapter 09 explained, for POST and PUT the caller has to put the SHA-256 of the body in a header. This API sticks to GET and HEAD.

### The web ACL

<<< @/examples/21-security/infra/lib/waf-stack.ts{web-acl}

A web ACL for CloudFront is created in us-east-1, wherever the distribution's origin is. This stack stops at synth if you name any other Region.

There are three rules.

The first is a rate-based rule. Above 300 requests in five minutes from one IP address, it blocks. The difference from the rate limit in [chapter 14](/en/chapters/14-kv-cache.md) is where it sits. That one is inside the application, for sharing fairly. This one is in front of the application, for keeping Lambda from being invoked at all.

Don't expect precision. According to the documentation, AWS WAF estimates the rate about every 10 seconds and limits "near" the limit you set, with no guarantee of an exact match. From crossing the limit to the block starting usually takes under 30 seconds, and can take several minutes. Requests in that interval get through.

The second and third are managed rule groups that AWS maintains: a list of IP addresses with a bad reputation, and the core rule set, a collection of common attack patterns.

The core rule set starts out as `count`. It doesn't stop anything; it only counts what it would have stopped. This rule group contains rules such as one that blocks bodies over 8 KB, and it can stop legitimate requests. AWS also recommends watching in count mode against production traffic before enabling. Switching to block is `-c wafCommonRules=block`.

### Attaching it

The stacks live in two Regions, so there are two steps.

```bash
vp run sec:waf:infra:deploy
vp run sec:infra:deploy -c webAclArn=<the WebAclArn output>
```

The web ACL's monthly fee begins the moment the first line runs, attached to a distribution or not.

The price is USD 5 a month per web ACL, USD 1 a month per rule (a managed rule group counts as one), and USD 0.60 per million requests inspected. For this chapter's setup that is USD 8.00 a month with no requests at all, and USD 8.60 with a million. Add-on rule groups such as Bot Control carry their own monthly and per-request fees, so they are not included. A test pins that they are absent.

Detaching goes in reverse. First `sec:infra:deploy` without `webAclArn` to take it off the distribution, then `sec:waf:infra:destroy`.

## IAM changes don't arrive at once

<!-- section: 21.iam-consistency -->

This chapter's distributed-systems story is IAM.

The IAM documentation has a passage like this. As a service accessed through computers in data centers around the world, IAM uses a distributed computing model called eventual consistency. A change takes time to become visible from all possible endpoints. There is caching too, so a change might not be visible until the old data times out.

In other words, a call right after adding a permission to a role can be denied. A call right after removing one can go through. The documentation gives no number for how long, and this book has not measured it.

AWS recommends two things. Don't put IAM changes in the middle of work that must not stop. And verify that a change has propagated before depending on it.

### After granting

A deploy creates a role and immediately runs a function as that role. That is "right after a change" exactly. So the smoke script does not treat a single refusal as failure.

<<< @/examples/21-security/src/propagation.ts{until-allowed}

Only refusals are retried. Other errors won't be fixed by waiting, so they are raised at once. And there is a cap on attempts. If it is still refused at the cap, that is no longer propagation delay; it's a mistake in the policy. Somewhere you have to draw the line between "waiting fixes it" and "waiting doesn't".

The function, for its part, answers 503 with `retry-after` when it lacks permission to read the secret.

<<< @/examples/21-security/src/app.ts{unavailable}

<<< @/examples/21-security/scripts/smoke.ts{wait-for-iam}

To be honest, whether a 503 actually comes back right after a deploy has not been checked. Maybe it doesn't. If it doesn't, this wait is never used, and does no harm.

### After revoking

The other direction is the dangerous one. When a key has leaked or a role has been taken over, people remove the permission, try once, see the refusal, and relax.

<<< @/examples/21-security/src/propagation.ts{until-denied}

One refusal means only that this one request reached an endpoint that knows about the change. This function doesn't say "stopped" until several refusals in a row. The test replays denied, allowed, denied, denied, denied, and checks that the first denial is not taken as confirmation.

Even so, it can't say more than "refused several times in a row". When it is really urgent, remove the permission and also change the thing being protected. In this chapter, that means rotating the secret (with `--force`). Once the leaked key is no longer the right key, how far IAM has propagated stops mattering.

No task in this chapter calls this function. The steps for trying it are in the resume notes of the verification records.

### CloudTrail knows when you changed it

```bash
vp run sec:trail:iam
```

It lists the changes made to IAM in the last 24 hours: who, when, and which operation. After a deploy you should see `CreateRole` and `PutRolePolicy` lined up.

One catch. IAM is a global service, and its events are recorded in us-east-1. Search the Tokyo Region's event history as long as you like and IAM changes won't appear. This task goes to us-east-1 from the start.

And the time shown is when the API was called. It is not when the change took effect at every endpoint.

## The watchers each look at something different

<!-- section: 21.detect -->

Four names that blur together, side by side.

```text
service      question it answers                          looks at                               result
Inspector    does my code have known vulnerabilities?     Lambda packages, ECR images, EC2       findings per CVE
GuardDuty    is someone acting like an attacker?          CloudTrail events, VPC flow, DNS logs  findings per suspicious activity
CloudTrail   who called which API, and when?              every management API call              events, 90 days free
AWS Config   what did this resource look like last week?  resource configurations over time      configuration items
```

"Inspector or GuardDuty, which one do I need?" is a common question, but they are different things.

**Inspector** is vulnerability scanning. It examines the packages inside your Lambda functions, the container images in ECR, and EC2 instances for known vulnerabilities (CVEs). It doesn't look at whether an attack is happening. It rescans when you deploy a function, and when a new CVE is published. For a setup like this book's, which bundles dependencies into Lambda, it is how you notice a vulnerability found after you deployed.

**GuardDuty** is threat detection. It analyzes CloudTrail events and records of VPC traffic to find suspicious behavior: leaked credentials being used from somewhere unfamiliar, traffic that looks like cryptocurrency mining. It doesn't look at whether your code has holes.

**CloudTrail** is the record. It makes no judgments. Event history is on from the start and holds 90 days of management events, per Region, for free. When you want to keep more than 90 days, search them in S3, or let Access Analyzer read them, you create a trail. Delivering the first copy of management events to S3 is free; what you pay is the S3 storage.

**AWS Config** is the history of resource configurations. It answers "when did this security group change, and how?". Drift detection in [chapter 02](/en/chapters/02-toolchain.md) asked "does it differ from the code right now?". Config asks "how has it changed over time?". It charges for every configuration item it records.

### Why they are not in the stack

GuardDuty and Inspector sit in the second tier. Once you have something to protect, they are worth enabling. But they are not in this chapter's CDK, for three reasons.

One. Both are a single setting per account and Region. They shouldn't be switched off just because a practice stack was deleted.

Two. Their defaults are broad. According to the GuardDuty documentation, enabling it for the first time turns on, by default, every protection plan available in that Region. Enabling Inspector from the console likewise starts every type of scan. You should decide while looking at the screen that shows what got enabled.

Three. You can't know the price until you use them. Both have a free trial (30 days for GuardDuty, 15 for Inspector), and during it the console estimates what a month would cost if you carried on. Deciding after seeing that number is the most reliable way.

So the procedure is: enable in the console, then confirm with `vp run sec:posture`. The same treatment as root MFA in chapter 01. It is also the case that the pinned cdkd has no dedicated implementation for a GuardDuty detector.

To be honest, this section comes from reading the documentation only. Neither service has been enabled. We haven't seen what a finding looks like, either.

## Once you are an organization

<!-- section: 21.organizations -->

While one person uses one account, what we have so far is enough. More people and more accounts bring a different problem: you can no longer rely on everyone configuring things correctly.

AWS Organizations groups several accounts into one organization, at no additional charge. The account that creates the organization becomes the management account. It consolidates the billing and can attach policies to the other accounts (member accounts).

Chapter 20 said that as long as dev and prod sit in one account, they are separated by name only. This is what lies beyond that.

### An SCP grants nothing

An SCP (service control policy) sets the upper bound on what the IAM users and roles of a member account can be allowed. It looks just like an IAM policy, but it works differently.

An SCP grants no permission. It only sets the limit.

<<< @/examples/21-security/src/policy-model.ts{decide}

This is a small model, for testing, of how IAM and SCPs combine. It is not IAM's real evaluation. But the point fits in three lines.

- An explicit `Deny` anywhere means denied
- The SCPs at every level, from the root through each OU to the account, must allow it
- And the principal's own IAM policy must allow it too; only then is it allowed

The second line is where people new to SCPs have their accident. When SCPs are turned on, Organizations attaches an "allow everything" SCP named `FullAWSAccess` at every level. Detach it and replace it with an SCP made only of `Deny`, and there is no SCP left that allows anything: nothing works in that account. The tests include that sequence.

One more caution. SCPs don't apply to the management account, nor to service-linked roles. That is why you don't do everyday work in the management account.

### First guardrails

<<< @/examples/21-security/policies/scp-guardrails.json

All four statements are `Deny`. They are layered on top of `FullAWSAccess`, which stays attached.

1. Nobody leaves the organization
2. Nobody stops the audit records: the CloudTrail trail, the GuardDuty detector, the Config recorder
3. Nothing happens in Regions this book doesn't use. It has the same shape as the example in the AWS documentation, excluding global services with `NotAction`. The exclusion list here is just the four from that example; the example policy AWS publishes lists about forty services. Add the ones you use
4. The root user of a member account does nothing

The first three work even on someone with administrator permissions. Still holding chapter 01's `AdministratorAccess`, you can no longer stop the trail. That is the other answer to "how do I narrow it".

The tests run this JSON through the model.

- Even an administrator is denied `cloudtrail:StopLogging` and `organizations:LeaveOrganization`
- Even an administrator is denied `ec2:RunInstances` in `eu-west-1`. In `ap-northeast-1` it goes through
- Someone with no IAM policy can do nothing, even when the SCPs allow everything
- A statement containing `Principal` fails to load (SCPs can't have one)
- Without whitespace, it is shorter than the SCP limit of 10,240 characters
- A policy with a condition the model doesn't know is refused. An unknown condition is never treated as true

### This is not built with CDK

Organizations and SCPs are not in this chapter's stack. There is no task for them.

Creating an organization, moving accounts, attaching SCPs: each one changes the structure of real accounts, and unlike a practice stack, deleting does not put things back. Attach a wrong SCP to the root and every account stops. AWS strongly recommends not attaching SCPs to the root right away, but creating a dedicated OU and moving accounts in one at a time to test.

So what this chapter hands you is the policy JSON and the tests to run before attaching it. The attaching is yours: your organization, the OU you choose, your hands.

The model has limits. It knows two conditions, `aws:RequestedRegion` and `aws:PrincipalArn`, and it doesn't match resources. "The tests passed" means "within this model, it is written as intended". It has not been attached to a real organization.
