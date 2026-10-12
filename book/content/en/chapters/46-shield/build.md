---
title: "46 Shield: Design and Build"
---

# 46 Shield: Design and Build

The [previous page](/en/chapters/46-shield.md) ended here: Shield Standard takes layers 3 and 4, and an attack made of well-formed requests is yours to stop. This page builds the places where it is stopped, nearest the client first. It closes the origin, thins the traffic at the edge, puts a brake on the origin, and then sends a flood through all of it to count what arrives and what it costs.

## Closing the origin

<!-- section: 46.origins -->

The web ACL and the cache both belong to CloudFront. If a way from the internet straight to the origin is left open, an attacker sends there and passes both of them by. The strong defence of Shield Standard described on the previous page is on CloudFront's side too. So closing the origin is what everything else rests on.

The invariant of this chapter is: **a request that reaches the origin from the internet has always come through CloudFront.**

How to close an origin depends on what it is.

### A function URL

A Lambda function URL with the auth type `AWS_IAM` accepts only requests signed with SigV4. The signer is CloudFront's origin access control (OAC). This is the arrangement chapters 09 and 21 used.

<<< @/examples/46-shield/infra/lib/shield-stack.ts{origin}

`withOriginAccessControl` creates two `AWS::Lambda::Permission` resources that let CloudFront's service principal invoke the function. Both carry this distribution's ARN as `SourceArn`. A permission without `SourceArn` lets any distribution in any account invoke the function, so the check built below looks at that as well.

There is one constraint. With OAC, a POST or PUT request needs the SHA-256 of its body in the `x-amz-content-sha256` header, sent by the caller, because Lambda does not accept an unsigned payload. Like chapters 09 and 21, this stack lets only GET and HEAD through. Letting writes through means having the client add that header, and this chapter does not build it.

### A load balancer

Chapter 12's load balancer faces the internet, and its security group admits every source. With CloudFront in front, anyone who knows the load balancer's DNS name still reaches it directly.

<<< @/examples/46-shield/infra/lib/alb-origin.ts{open}

CloudFront's documentation gives three ways to close a load balancer.

The first is a secret header. CloudFront adds a custom header to the requests it sends to the origin, and the load balancer's listener forwards only requests that carry it and answers 403 to the rest. It stops working once the header's name and value leak, so the documentation asks you to treat them like credentials and to use HTTPS between CloudFront and the load balancer. The load balancer refuses a request only after receiving it, so as a network it is still open.

The second is a security group that admits only CloudFront's managed prefix list. `com.amazonaws.global.cloudfront.origin-facing` is the set of IP address ranges of the servers CloudFront uses to connect to origins, kept up to date by AWS.

<<< @/examples/46-shield/infra/lib/alb-origin.ts{prefix-list}

Two cautions. This prefix list counts as 55 rules of a security group. The default quota is 60, so the same security group has room for 5 more. And what the list admits is all of CloudFront: other people's distributions arrive from the same ranges. To narrow it to your own distribution, combine it with the header of the first way.

The third is a VPC origin, which the AWS whitepaper on DDoS resiliency names as the newest and recommended way. The load balancer sits in private subnets and has no public address. CloudFront connects to it from a network interface of its own inside the VPC. The whitepaper says there is no additional cost.

<<< @/examples/46-shield/infra/lib/alb-origin.ts{vpc-origin}

The documentation's conditions are these: the VPC has an internet gateway attached (it is not used for routing), the load balancer's security group admits CloudFront's prefix list or the security group that CloudFront creates, and the Region is supported. ap-northeast-1 is, except for the Availability Zone `apne1-az3`.

These three functions exist for the tests and for this page, and no stack of this chapter contains them. A load balancer is billed by the hour, so they were not made deployable. Use them as material when you change chapter 12's stack.

### API Gateway

An API Gateway API cannot be closed. An HTTP API has neither a security group nor a resource policy, and the endpoint API Gateway provides can be called straight from the internet. What the whitepaper recommends for a REST API is to put your own CloudFront distribution in front of a regional endpoint, refuse direct access with an `x-api-key` header that CloudFront adds, and set a rate limit on each method. That is the same kind of measure as the first way for a load balancer.

The API chapters of this book (most of chapters 04 to 32) publish an HTTP API directly. Their brake is the stage throttling of chapter 32. With neither CloudFront nor a web ACL in front, they are outside this chapter's arrangement.

### Checking it in the template

Whether an origin is closed can be read from the synthesized template, before anything is deployed. There are four verdicts.

<<< @/examples/46-shield/src/origins.ts{finding}

For a function URL the check looks at the auth type and at the permissions on the function.

<<< @/examples/46-shield/src/origins.ts{function-url}

For a load balancer it looks at `Scheme` and at the ingress rules of its security groups.

<<< @/examples/46-shield/src/origins.ts{load-balancer}

What separates `bypassable` from `direct` is whether a distribution in the same template names the resource as an origin. An open origin with CloudFront in front of it is `bypassable`, and it is the harder one to notice, because the web ACL in front makes it look safe.

<<< @/examples/46-shield/src/origins.ts{check}

The tests run the check on templates that CDK actually produced as well as on hand-written JSON. The three load balancers of the previous section come out, in order, `bypassable`, `closed` and `closed`.

A task runs it over every stack of this book.

```bash
vp run shield:origins
```

This is part of the result from October 13, 2026, over the 56 templates present in this checkout.

```text
AihSecurity  (examples/21-security/cdk.out)
  closed     HandlerFunctionUrl003AF664  AWS::Lambda::Url
             AuthType AWS_IAM, and no permission for an unnamed caller
AihLimits  (examples/32-limits/cdk.out)
  direct     ApiF70053CD  AWS::ApiGatewayV2::Api
             API Gateway serves it on a public endpoint of its own; its throttle is the only brake
AihFargate  (examples/41-fargate/cdk.out)
  direct     LoadBalancerBE9EEC3A  AWS::ElasticLoadBalancingV2::LoadBalancer
             internet-facing, and its security group admits 0.0.0.0/0 or ::/0
AihShield  (examples/46-shield/cdk.out)
  closed     HandlerFunctionUrl003AF664  AWS::Lambda::Url
             AuthType AWS_IAM, and no permission for an unnamed caller

56 templates, 28 function URLs, load balancers and APIs looked at.
report only: no stack was asked to be closed (--gate <stack>)
```

Of the 28 found, 22 were `direct` and 6 `closed`. Most of the `direct` ones are HTTP APIs, which is as intended for practice stacks. This chapter's own stack is the exception: `check:all` contains a gate that fails unless it is `closed`.

```bash
vp run shield:origins:gate
```

Some things this check cannot see.

- Anything outside the template. A security group from another stack, or a value decided at deploy time, comes out as `unknown`
- What is in a prefix list. A template cannot tell whether an ID is CloudFront's
- A CIDR narrower than everyone. The check cannot judge whose range it is, so it says `unknown`
- EC2 instances with a public IP address, and S3 buckets. [Chapter 42](/en/chapters/42-firewall-manager.md) looks at instances' security groups and [chapter 33](/en/chapters/33-production-readiness.md) at buckets' public settings
- The real thing. A closed template opens again when someone adds a rule in the console afterwards. Finding that is drift detection's job

## Thinning traffic at the edge

<!-- section: 46.edge -->

With the origin closed, the next step is to reduce, on CloudFront's side, the requests that go on to the origin. There are two ways. A cache absorbs requests that can be given the same answer, whoever sent them. A rate-based rule stops a source that sends too much.

### The cache

A route whose answer is the same for everyone can be answered by CloudFront. In this application that is `/health`. One function wrapped around the application marks the successful GET of that route, and only that, as shareable.

<<< @/examples/46-shield/src/cache.ts{cache}

Every other response gets `no-store`. Without a header, whether a response is cached would be left to the distribution's default TTL.

On the distribution's side, that one route gets a cache policy.

<<< @/examples/46-shield/infra/lib/shield-stack.ts{distribution}

The policy is the managed `CachingOptimized`. It puts neither query strings nor cookies in the cache key. Sending `/health?x=1`, `/health?x=2` and so on asks CloudFront for one and the same object, and nothing goes on to the origin. A policy of your own that puts the query string in the key gives that property away.

When requests for the same route pile up at the moment the cache expires, one of them goes to the origin. CloudFront waits for that first answer and gives it to the rest. The documentation calls this request collapsing.

Two things to know. The cache exists per CloudFront location, so what the origin sees is not "one every 5 seconds" but "one every 5 seconds for each location". And a cached response is reused whole, so the `x-request-id` that chapter 04's application adds comes back as the first request's.

### The rate-based rule

A route that cannot be cached gets a limit per source.

<<< @/examples/46-shield/infra/lib/edge-stack.ts{web-acl}

When requests from one IP address pass 300 in the last 60 seconds, that address is blocked. Chapter 21's web ACL allowed 300 in 5 minutes. Here the look-back is shorter and the sustained rate is 5 a second, so that sources where many people share one address, such as an office or a school, are less likely to be stopped. Choose the numbers from how your own service is used.

The action is `block`, not `count`, which would only count. Shield Advanced's cost protection also requires a rate-based rule that blocks.

This rule is not an exact limit. AWS WAF's documentation says the following. The rate is an estimate; limiting happens near the limit you set, with no guarantee of an exact match. Requests can come in too fast for up to several minutes before the rule detects and limits them, and usually the delay is below 30 seconds. Changing a setting resets the counts and can pause limiting for up to a minute. One rule can limit at most 10,000 IP addresses at a time, and when more than that are over the limit it limits those with the highest rates.

When the rule starts blocking, you want to know.

<<< @/examples/46-shield/infra/lib/edge-stack.ts{alarm}

The metrics of a web ACL for CloudFront are reported in us-east-1, so the alarm lives in this stack too. All the alarm says is that somebody passed the limit. It may be a broken script, and it may be the first minute of an attack.

## A brake on the origin

<!-- section: 46.brake -->

Every request that gets past the edge runs the function. The last brake is a ceiling on how many copies of the function run at once.

<<< @/examples/46-shield/infra/lib/shield-stack.ts{function}

For a function URL with reserved concurrency, Lambda's documentation says the following. The maximum number of requests a second is ten times the reserved concurrency. Past the concurrency or that rate, the function URL answers 429. The setting incurs no additional charge.

<<< @/examples/46-shield/src/defences.ts{brake}

With `-c reservedConcurrency=20`, at most 200 requests a second reach the function. The simulation below treats that ceiling as a token bucket. The rate is the documentation's; the size of the burst is this chapter's assumption.

It is off by default for the reason chapter 32 gave. You can reserve only up to the account's concurrency minus 100, so an account with a small quota refuses the deploy.

`-c reservedConcurrency=0` is refused when the context is checked. Zero turns every request into a 429. It is not a setting to leave in a stack. It is an emergency stop, entered by hand during an attack, and it is in [the steps on the Deploy page](/en/chapters/46-shield/deploy.md).

## Sending a flood through

<!-- section: 46.flood -->

A simulation shows which attacks these three stop and which they do not. Like the ones in chapter 32 it is seeded, and gives the same result every time. The token bucket and the random numbers are chapter 32's code.

<<< @/examples/46-shield/src/flood.ts{scenario}

A source is a crowd of addresses that behave alike. The users are 200 addresses sending one request every two seconds each, 100 a second in all. The attack is 5,000 requests a second in every case. What changes is how many addresses share it and which route it asks for.

<<< @/examples/46-shield/src/flood.ts{scenarios}

Second by second, requests pass the rate-based rule, then the cache, then the brake.

<<< @/examples/46-shield/src/flood.ts{run}

```bash
vp run shield:flood
```

```text
One hour. 100 requests a second from users; 5,000 a second of attack for 50 minutes.

attack                            defences                      blocked      cached       throttled    ran function users*       USD
20 addresses                      none                          0            0            0            15360000     100.0%       25.73
20 addresses                      rate rule                     14845000     0            0            515000       100.0%       10.08
20,000 addresses                  rate rule                     0            0            0            15360000     100.0%       34.95
20,000 addresses                  rate rule, brake              0            0            14699981     660019       4.0%         27.96
20,000 addresses, cached route    cache                         0            15071280     0            288720       100.0%       20.21

The same 5,000 a second for 30 days with nothing in front: USD 21660.02
  cloudfront.jp.request.https   15552.00
  cloudfront.jp.transfer        1356.01
  lambda.request.arm            2592.00
  lambda.duration.arm           2160.01

* The share of the users' requests answered while the attack runs.
USD is the list price of that hour's usage: CloudFront, AWS WAF where attached, Lambda.
A model with stated assumptions (src/flood.ts, src/bill.ts), not a measurement.
```

Read the rows from the top.

The first row has nothing in front. All 15 million requests run the function. The users are not affected, because the model assumes Lambda keeps up with that rate and leaves out the account's concurrency limit. The bill is what suffers.

The second row puts the rate-based rule in front of the same attack. Each of the 20 addresses passes the limit within 2 seconds and is blocked 30 seconds later. The attack's requests that reach the function stop at 155,000, and not one user request is stopped. Against an attack from few sources this rule works well.

The third row spreads the same 5,000 a second over 20,000 addresses. One address sends a request every 4 seconds, which is 15 in 60 seconds, far from the limit of 300. The rule stops nothing, and only the inspection charge is added. A rule that counts per source cannot find an attack that is spread widely enough.

The fourth row adds the brake. At most 200 requests a second reach the function. But the brake does not look at who sent a request. Of 5,100 a second, 200 get through, so while the attack lasts only 4.0% of the users' requests do. **What the brake protects is the function and what is behind it, not the users.**

The fifth row sends the same spread-out attack to the cached route. For that route the function runs only for the 720 refills, one every 5 seconds, and CloudFront answers the rest. Neither the rule nor the brake is needed.

Stopping a spread-out attack without stopping users takes something that tells them apart by what a request contains or how its sender behaves, not by how many sources there are. On AWS that is the Anti-DDoS managed rule group mentioned on the previous page, Bot Control, and the SRT of Shield Advanced. None of them was tried in this chapter.

The model's assumptions are these.

- The rate-based rule blocks an address once it has been over the limit for 30 seconds. Thirty seconds is the value the documentation says the delay is usually below. The real delay was not measured
- The rule keeps counting requests it blocks. An address that keeps sending stays blocked. That is a reading of the documentation's wording
- CloudFront is treated as one location. The real cache is per location
- A refused request puts no load on the origin. There is no latency and no retry. What happens when refused users retry is what chapter 32's simulation covers

The tests pin the properties of this table: every request is counted in exactly one outcome, the rule does not block at exactly the limit and does block above it, in no second does the function run more often than the brake allows, the users get through again one second after the attack ends, and so on.

## Denial of wallet

<!-- section: 46.wallet -->

On pay-per-request services the aim of an attack can be to inflate the bill, not to stop the service. This is called denial of wallet. The service keeps working, so the first sign is often the invoice.

The simulation's result becomes lines of usage.

<<< @/examples/46-shield/src/bill.ts{items}

The amounts are those lines multiplied by the unit prices in `data/pricing/`. One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB. Neither was measured.

Three things can be read from the USD column of the table above.

The first is that the most expensive part of this stack is not the function. It is CloudFront's request charge. Of the first row's USD 25.73, 18.43 is CloudFront requests and 5.63 is Lambda.

The second is that the brake does not reduce CloudFront's charge. In the fourth row the function ran 23 times less often, but a request answered with 429 is still a CloudFront request, so the total is USD 27.96, only 6.99 below the third row (34.95), which has the rule alone.

The third is that a request blocked by AWS WAF incurs no CloudFront charge. That has been so since October 25, 2024. Of the second row's USD 10.08, 9.22 is AWS WAF's inspection charge, which applies to blocked requests too. This fills in the point chapter 21 recorded as not confirmed.

Over one hour every row is a few tens of dollars. The trouble is when it goes on with nothing to stop it. The same 5,000 a second for 30 days comes to **USD 21,660.02** at list price, of which 15,552.00 is CloudFront requests. That is more than seven times the monthly fee of Shield Advanced.

These are the ways to put a ceiling on the bill, in the order of how much they help.

- Block with a web ACL. For what is blocked, CloudFront's charge disappears and the inspection charge of USD 0.60 per million remains. It helps only against attacks the rules can find
- Join a CloudFront flat-rate pricing plan. These are monthly plans per distribution, and the documentation says there are no overage charges regardless of traffic spikes or attacks. The Free plan's allowance is 1 million requests and 100 GB a month, and the Pro plan's, at USD 15 a month, 10 million requests and 50 TB. Requests blocked by AWS WAF do not count against the allowance. Staying far above it for a long time can lead to reduced performance, such as being served from more distant locations
- Put a brake on the origin. CloudFront's charge stays, but the function and the pay-per-use things behind it (the model calls of [chapter 17](/en/chapters/17-ai.md), the writes to the table of [chapter 05](/en/chapters/05-dynamodb.md)) get a ceiling. The more expensive what is behind, the more this helps

Flat-rate pricing plans have constraints. A distribution with Shield Advanced enabled cannot join one. An account using AWS Free Tier is not eligible. A plan requires a web ACL, and it covers the charges of CloudFront, AWS WAF, Route 53 and a few others only, so Lambda is billed separately. No plan was tried in this chapter.

Budgets (chapters 01 and 32) are not on this list. A budget notifies and does not stop anything, and it is refreshed a few times a day. You need it to notice. It is not a ceiling.

## Putting the Advanced protection in the stack

<!-- section: 46.advanced-stack -->

For an account that has subscribed to Shield Advanced, the part that adds a protection is ready.

<<< @/examples/46-shield/infra/lib/edge-stack.ts{advanced}

Only with both `-c shieldAdvanced=on` and `-c distributionArn=<ARN>` does this part enter the template. Passing the ARN alone does not turn it on.

**This flag does not subscribe.** Subscribing is something a person does in the console or through the API, and CloudFormation has no resource for it. Deploying with this flag in an account without a subscription should fail when the protection is created. How it fails was not checked.

What is included is one protection for the distribution and an alarm on `DDoSDetected`. AWS recommends, for each protected resource, an alarm for when this metric is not zero. It also says a non-zero value does not necessarily mean an attack.

What is left out, and why:

- A health check (`HealthCheckArns`). Health-based detection and proactive engagement need one, but what counts as healthy is for each service to decide, and Route 53 health checks have a price too
- The earlier automatic mitigation (`ApplicationLayerAutomaticResponseConfiguration`). As the previous page said, new subscribers do not get it by default
- A protection group. With one resource it means nothing
- The role that lets the SRT into the account, and the contacts for proactive engagement. Those are people's contact details and permissions, and a practice stack cannot hold defaults for them

The pinned cdkd has no provider of its own for `AWS::Shield::Protection`. The type is on Cloud Control API's list of supported resources, so it should be created that way. This was not tried.
