---
title: "21 Security: Build, Continued"
---

# 21 Security: Build, Continued

The [previous page](/en/chapters/21-security/build.md) built the function and the secret. This page covers the WAF at the entry point and the delay before an IAM change takes effect everywhere, and then explains the detection services and Organizations, which are not in this chapter's stack.

## Entry points that can carry WAF, and ones that can't

<!-- section: 21.waf -->

AWS WAF inspects requests before they reach your application and stops the ones that match its rules. Its unit of configuration is called a web ACL.

A web ACL can't be attached to every kind of entry point. The official documentation lists these resources (checked 2026-10-12).

- CloudFront distributions
- API Gateway REST APIs
- Application Load Balancers
- AppSync GraphQL APIs, Cognito user pools, App Runner services, Bedrock AgentCore Gateway, Verified Access instances, and Amplify

Of the entry points this book has used, API Gateway HTTP APIs (chapter 04) and Lambda function URLs (chapters 09 and 17) are not on the list. To use WAF with them, you put CloudFront in front and attach the web ACL to CloudFront. That is why this chapter's setup starts at CloudFront.

An entry point that can't carry WAF is not left without any bound. The chapters that use an HTTP API, from chapter 04 on, hold the whole API to 10 requests a second with stage throttling, which costs nothing. That limit covers all callers together, though, and is not split by IP address. A function URL has no equivalent setting.

Attaching the web ACL to CloudFront is not enough by itself, because an open back entrance lets requests in without passing through CloudFront.

<<< @/examples/21-security/infra/lib/security-stack.ts{entry}

The function URL's `AuthType` is `AWS_IAM`, and CloudFront's origin access control signs the requests, as in chapter 09. Lambda rejects unsigned requests before the function runs. Since nothing can go around CloudFront, nothing can go around the web ACL.

This book has neither implemented nor verified an HTTP API behind CloudFront. If you try it, decide first how you will close the back entrance.

Signing brings constraints as well. CloudFront puts its signature in the `Authorization` header, so this API takes its token in a separate header, `x-aih-token`. And as chapter 09 explained, for POST and PUT the caller has to put the SHA-256 of the body in a header. So CloudFront lets through only GET and HEAD. The app answers only GET, and a HEAD gets a 404.

### The web ACL

<<< @/examples/21-security/infra/lib/waf-stack.ts{web-acl}

A web ACL for CloudFront is created in us-east-1, wherever the distribution and its origin are. This stack stops at synth if you specify any other Region.

It has three rules.

The first is a rate-based rule, which blocks an IP address once it sends more than 300 requests in five minutes. It differs from the rate limit in [chapter 14](/en/chapters/14-kv-cache.md) in where it sits and what it is for. Chapter 14's rate limit is inside the application and shares capacity fairly among users. This rule is in front of the application and keeps Lambda from being invoked.

Don't expect it to be exact. According to the documentation, AWS WAF estimates the rate about every 10 seconds and limits "near" the limit you set, without guaranteeing that it stops exactly at the limit. Blocking usually starts within 30 seconds of the limit being exceeded and can take several minutes. Requests sent in that interval get through.

The second and third are managed rule groups maintained by AWS: a list of IP addresses with a bad reputation, and the core rule set, which collects common attack patterns.

The core rule set starts as `count`. In `count` mode it stops nothing and only counts the requests it would have stopped. The rule group includes rules such as one that blocks bodies over 8 KB, so it can stop legitimate requests. AWS also recommends watching it in count mode against production traffic before enabling it. To switch to blocking, pass `-c wafCommonRules=block`.

### Attaching it

The stacks are in two Regions, so the deploy takes two steps.

```bash
vp run sec:waf:infra:deploy
vp run sec:infra:deploy -c webAclArn=<the WebAclArn output>
```

The web ACL's monthly fee starts when the first line runs, even if the web ACL is not attached to a distribution.

The price is USD 5 a month per web ACL, USD 1 a month per rule (a managed rule group counts as one rule), and USD 0.60 per million requests inspected. For this chapter's setup that comes to USD 8.00 a month with no requests and USD 8.60 with a million. Add-on rule groups such as Bot Control carry their own monthly and per-request fees, so they are not included, and a test pins their absence.

To detach it, go in reverse order. First run `sec:infra:deploy` without `webAclArn` to remove the web ACL from the distribution, then run `sec:waf:infra:destroy`.

## Until an IAM change takes effect everywhere

<!-- section: 21.iam-consistency -->

The distributed-systems problem in this chapter is in IAM.

The IAM documentation says the following. IAM is a service accessed through computers in data centers around the world, so it uses a distributed computing model called eventual consistency. A change takes time to become visible from all possible endpoints. There is also caching, so a change might not be visible until the old data times out.

As a result, a call made right after you add a permission to a role can be denied, and a call made right after you remove one can succeed. The documentation gives no number for how long this lasts, and this book has not measured it.

AWS recommends two things: don't put IAM changes in the middle of work that must not stop, and verify that a change has propagated before you depend on it.

### After granting

A deploy creates a role and immediately runs a function with it, which is exactly "right after a change". For that reason the smoke script does not fail on a single denial.

<<< @/examples/21-security/src/propagation.ts{until-allowed}

It retries only denials. Other errors won't go away by waiting, so it raises them at once. The number of attempts is also capped. If the call is still denied at the cap, the cause is a mistake in the policy and not propagation delay. Somewhere you have to separate what waiting fixes from what it doesn't.

The function, for its part, wraps the call to the router in a `try`, and answers 503 with `retry-after` whenever handling a request throws, whatever the cause. Lacking permission to read the secret is one such case, and only the message in the response tells it apart.

<<< @/examples/21-security/src/app.ts{unavailable}

<<< @/examples/21-security/scripts/smoke.ts{wait-for-iam}

Whether a 503 actually comes back right after a deploy has not been checked. It may not. If it doesn't, this wait is never used and does no harm.

### After revoking

Revoking is the dangerous direction. When a key has leaked or a role has been taken over, people remove the permission, try once, see the denial, and feel safe.

<<< @/examples/21-security/src/propagation.ts{until-denied}

One denial tells you only that one request reached an endpoint that knows about the change. This function does not report "stopped" until it sees several denials in a row. The test reproduces the sequence denied, allowed, denied, denied, denied, and checks that the first denial is not taken as confirmation.

Even so, all it can tell you is that the call was denied several times in a row. When it is truly urgent, remove the permission and also change the thing being protected. In this chapter that means rotating the secret with `--force`. Once the leaked key is no longer the valid key, how far the IAM change has propagated stops mattering.

No task in this chapter calls this function. The steps for trying it are in the resume steps of the [Validation Record](/en/reference/validation.md).

### Finding the time of a change in CloudTrail

```bash
vp run sec:trail:iam
```

The task lists the changes made to IAM in the last 24 hours: who made each one, when, and with which operation. After a deploy it should show `CreateRole` and `PutRolePolicy`.

There is one thing to watch for. IAM is a global service, and its events are recorded in us-east-1. Searching the Tokyo Region's event history will not turn up IAM changes. This task queries us-east-1 from the start.

The time in the list is when the API was called. It is not when the change took effect at every endpoint.

## Four services for detection and recording

<!-- section: 21.detect -->

Inspector, GuardDuty, CloudTrail, and AWS Config have similar names and descriptions and are easy to confuse, so here they are side by side.

```text
service      question it answers                          looks at                               result
Inspector    does my code have known vulnerabilities?     Lambda packages, ECR images, EC2       findings per CVE
GuardDuty    is someone acting like an attacker?          CloudTrail events, VPC flow, DNS logs  findings per suspicious activity
CloudTrail   who called which API, and when?              every management API call              events, 90 days free
AWS Config   what did this resource look like last week?  resource configurations over time      configuration items
```

People often treat Inspector and GuardDuty as a choice between two options, but they are separate services that look at different things.

Inspector scans for vulnerabilities. It examines the packages inside your Lambda functions, the container images in ECR, and EC2 instances for known vulnerabilities (CVEs). It does not look at whether an attack is happening. It rescans when you deploy a function and when a new CVE is published. For a setup like this book's, which bundles dependencies into Lambda, it is how you notice a vulnerability found after you deployed.

GuardDuty detects threats. It analyzes CloudTrail events and records of VPC traffic to find suspicious behavior, such as leaked credentials being used from an unfamiliar location or traffic that looks like cryptocurrency mining. It does not look at whether your code has holes.

CloudTrail only records and makes no judgments. Event history is on from the start and holds 90 days of management events, per Region, for free. When you want to keep more than 90 days, search the events in S3, or let Access Analyzer read them, you create a trail. Delivering the first copy of management events to S3 is free, and what you pay for is the S3 storage.

AWS Config records the history of resource configurations. It answers questions like "when did this security group change, and how?". Drift detection in [chapter 02](/en/chapters/02-toolchain.md) checks whether a resource differs from the code right now, while Config records how it has changed over time. It charges for every configuration item it records.

### Why they are not in the stack

GuardDuty and Inspector are in the second tier. Once you have something to protect, they are worth enabling. They are still left out of this chapter's CDK code, for three reasons.

First, each is a single setting per account and Region. Deleting a practice stack should not switch them off.

Second, they enable a lot by default. According to the GuardDuty documentation, enabling it for the first time turns on every protection plan available in that Region. Enabling Inspector from the console likewise starts every type of scan. Decide what to keep while looking at the screen that shows what was enabled.

Third, you can't know the price until you use them. Both have a free trial (30 days for GuardDuty, 15 for Inspector), and during the trial the console estimates the monthly cost of continuing. Deciding after you see that number is the most reliable approach.

The procedure is therefore to enable them in the console and confirm with `vp run sec:posture`, the same treatment chapter 01 gave root user MFA. Another factor is that the pinned cdkd has no dedicated implementation for a GuardDuty detector.

This section was written from the documentation. Neither service has been enabled, and what a finding looks like has not been seen.

## Once you are an organization

<!-- section: 21.organizations -->

While one person uses one account, what the chapter has covered so far is enough. With more people and more accounts, you can no longer rely on everyone configuring things correctly.

AWS Organizations groups several accounts into one organization at no additional charge. The account that creates the organization becomes the management account. It consolidates billing and can attach policies to the other accounts, called member accounts.

Chapter 20 said that as long as dev and prod sit in one account, they are separated by name only. Separating the accounts and grouping them with Organizations is the next step after that.

### An SCP grants nothing

An SCP (service control policy) sets the upper bound on the permissions that a member account's IAM users and roles can be allowed. It looks just like an IAM policy but works differently.

An SCP grants no permission. It only sets the limit.

<<< @/examples/21-security/src/policy-model.ts{decide}

This code is a small model, written for tests, of how IAM and SCPs combine. It is not IAM's actual evaluation. The essentials still fit in these three lines.

- An explicit `Deny` anywhere means denied
- The SCPs at every level, from the root through each OU to the account, must allow it
- And the principal's own IAM policy must allow it too; only then is it allowed

The second line is where people new to SCPs cause accidents. When SCPs are enabled, Organizations attaches an "allow everything" SCP named `FullAWSAccess` at every level. If you detach it and replace it with an SCP made only of `Deny` statements, no SCP allows anything any more, and nothing works in that account. The tests include that sequence.

One more caution: SCPs do not apply to the management account or to service-linked roles. That is why you don't do everyday work in the management account.

### First guardrails

<<< @/examples/21-security/policies/scp-guardrails.json

All four statements are `Deny`. They are layered on top of `FullAWSAccess`, which stays attached.

1. Nobody can leave the organization
2. Nobody can stop the audit records, meaning the CloudTrail trail, the GuardDuty detector, and the Config recorder
3. Nothing can be done in Regions this book doesn't use. The statement has the same shape as the example in the AWS documentation and excludes global services with `NotAction`. The exclusion list is only the four from that example. The example policy AWS publishes lists about forty services. Add the ones you use
4. The root user of a member account can do nothing

The first three apply even to someone with administrator permissions. Even with chapter 01's `AdministratorAccess`, you can no longer stop the trail. This is the other answer to how to narrow it.

The tests run this JSON through the model and check the following.

- Even an administrator is denied `cloudtrail:StopLogging` and `organizations:LeaveOrganization`
- Even an administrator is denied `ec2:RunInstances` in `eu-west-1`. In `ap-northeast-1` it is allowed
- Someone with no IAM policy can do nothing, even when the SCPs allow everything
- A statement containing `Principal` fails to load (SCPs can't have one)
- Without whitespace, it is shorter than the SCP limit of 10,240 characters
- A policy with a condition the model doesn't know is refused. An unknown condition is never treated as true

### Why Organizations and SCPs are not built with CDK

Organizations and SCPs are not in this chapter's stack, and there is no task for them.

Creating an organization, moving accounts, and attaching SCPs all change the structure of real accounts, and unlike a practice stack, deleting them does not put things back. A wrong SCP attached to the root stops every account. AWS strongly recommends that you not attach SCPs to the root right away, and that you create a dedicated OU and move accounts into it one at a time to test.

So this chapter provides only the policy JSON and the tests to run before attaching it. Choosing the organization and the OU, and attaching the policy, is your work.

The model has limits. It knows only two conditions, `aws:RequestedRegion` and `aws:PrincipalArn`, and it does not match resources. "The tests passed" means that within this model, the policy is written as intended. It has not been attached to a real organization.
