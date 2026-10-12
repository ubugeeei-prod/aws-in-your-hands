---
title: "46 Shield: Preparing for DDoS, Standard and Advanced"
sourceRevision: 1
---

# 46 Shield: Preparing for DDoS, Standard and Advanced

Every AWS account is protected from DDoS by AWS Shield Standard without any setup. The paid tier, Shield Advanced, is USD 3,000 a month with a one-year commitment. Most readers of this book do not need that subscription. They need to know what Standard covers and to close the rest with the way the application is put together. This chapter builds that arrangement and checks it.

It checks in two ways. One is a check that reads synthesized templates and looks for an origin that can be reached without going through CloudFront. The other is a seeded simulation that counts where a flood of requests stops (the rate-based rule, the cache, the brake on the function), how much of it reaches the function, and what that hour costs.

**Subscribing to Shield Advanced costs USD 36,000 over its twelve months.** The stacks of this chapter do not subscribe. For an account that already has a subscription there is a flag that adds a protection, and it is off by default.

You need CloudFront from [chapter 03](/en/chapters/03-spa.md), the load balancer from [chapter 12](/en/chapters/12-containers.md) and the web ACL from [chapter 21](/en/chapters/21-security.md). Throttling and retries were covered in [chapter 32](/en/chapters/32-limits.md) and are not repeated. The code is in `examples/46-shield/`.

## The whole picture

<!-- section: 46.overview -->

```figure
caption: What a request passes on its way to the function. The places where an attack's requests can be dropped come one after another, nearest the client first
node client: Client | users, and attackers
node shield: Shield Standard | layers 3 and 4. Always on, free
node waf: AWS WAF | rate-based rule. Optional, monthly fee
node cf: CloudFront | /health comes from the cache
node url: function URL | AWS_IAM. Only CloudFront can sign
node fn: Lambda | chapter 04's app. Reserved concurrency is optional
edge client -> shield: HTTPS
edge shield -> waf
edge waf -> cf
edge cf -> url: signed with SigV4
edge url -> fn
edge client -x url: 403 when called directly
group edge: AWS edge = shield, waf, cf
group region: ap-northeast-1 = url, fn
mark url
```

There are two stacks.

<<< @/examples/46-shield/infra/bin/app.ts{stacks}

`AihShield` runs the notes API of [chapter 04](/en/chapters/04-http-api.md) in Lambda, behind a function URL that only CloudFront may call. Left alone it costs nothing. `AihShieldEdge` is the web ACL and its alarm in us-east-1. It has a monthly fee, so it is deployed only when you name it.

Both stacks and the simulation read one definition. The flood in the tests meets the same numbers that are deployed.

<<< @/examples/46-shield/src/defences.ts{defences}

## The defence you already have

<!-- section: 46.standard -->

DDoS (distributed denial of service) is an attack that sends traffic from many sources so that real users cannot use a service. Shield's documentation sorts attacks into three kinds: network layer (layer 3) attacks that fill the capacity of a link or a resource, transport layer (layer 4) attacks such as a TCP SYN flood that exhaust protocol state, and application layer (layer 7) attacks that send large numbers of well-formed HTTP requests.

Shield Standard comes with every account that uses AWS, at no additional charge. There is nothing to turn on. It defends against the common attacks at layers 3 and 4.

How well you are defended depends on where your entry point is. According to the documentation, every packet to CloudFront and Route 53 is inspected by a mitigation system that sits in the path, and attacks are mitigated as they arrive, whether or not you subscribe to Shield Advanced. CloudFront lets through only traffic that is valid for a web application and terminates TLS at the edge, so what reaches the origin is well-formed HTTP requests and nothing else.

A load balancer or an Elastic IP address in a Region is handled differently. Shield evaluates the traffic to each resource every minute and places a mitigation when it judges that the resource's capacity has been exceeded. The documentation says that such a mitigation reduces DDoS traffic and may not eliminate it.

The first rule follows from this. Make CloudFront the entry point from the internet, and do not expose a load balancer or a function directly. With CloudFront in front, layers 3 and 4 get the strongest defence AWS has, with no subscription.

There is something Standard does not do: attacks at layer 7, made of well-formed requests. The documentation says that for application layer attacks AWS attempts to detect them and notify Shield Advanced customers, and by default does not apply mitigations automatically, so as not to block valid users. When well-formed requests arrive in bulk, counting them and stopping them is your job. Most of [Design and Build](/en/chapters/46-shield/build.md) is about that.

## What Advanced adds

<!-- section: 46.advanced -->

You use Shield Advanced by subscribing and then naming, one by one, the resources to protect. Subscribing alone protects nothing. The resources you can name are CloudFront distributions, Route 53 hosted zones, Global Accelerator standard accelerators, Elastic IP addresses, Application Load Balancers and Classic Load Balancers. EC2 instances and Network Load Balancers are protected through an Elastic IP address.

This is what the documentation says a named resource gets.

- Detection thresholds are lower. For a resource in a Region, a mitigation is placed at half the calculated capacity. With a Route 53 health check attached (health-based detection), a smaller deviation is enough while the application is unhealthy
- You can reach the Shield Response Team (SRT), a team that specializes in responding to DDoS. It analyzes AWS WAF logs and, with your approval, adds rules to the web ACL. **Using the SRT requires the Business or the Enterprise Support plan as well**
- With proactive engagement set up, the SRT contacts you when the health check turns unhealthy
- Part of the charges an attack caused is given back afterwards as credits (cost protection). Only some charges qualify: CloudFront requests and data transfer, Route 53 queries, Application Load Balancer capacity units, EC2 instances that auto scaling launched in response to the attack, and a few more
- The standard AWS WAF fees (web ACL, rules, requests) for protected resources are included in the subscription, up to 50 billion requests a month
- A protection group lets several resources be detected as one unit
- Detection and mitigation metrics appear in CloudWatch under `AWS/DDoSProtection`

Cost protection has conditions. The protection must have been in place before the attack. For CloudFront and Application Load Balancers the web ACL must contain a rate-based rule that blocks. The DDoS resiliency best practices must have been implemented. You apply with a support case within 15 days after the end of the billing month of the attack. The credits can be used for Shield Advanced charges only. Lambda's charges are not in the list of what qualifies.

Automatic mitigation of layer 7 attacks changed shape on March 26, 2026. In place of the earlier Shield Advanced feature (automatic application layer DDoS mitigation), the Anti-DDoS managed rule group of AWS WAF (`AWSManagedRulesAntiDDoSRuleSet`) became the default. That rule group can be used without a Shield Advanced subscription. On CloudFront it adds USD 20 a month and USD 0.15 per million requests processed to the web ACL's fees. It is not in this chapter's stacks.

### Price and commitment

This is what the pricing page and the Price List say. They were read on October 13, 2026.

- The monthly fee is USD 3,000. Accounts that share one organization's consolidated bill pay it once, however many of them subscribe
- The subscription is a commitment for a year and renews automatically every year. To stop the renewal you contact Support between 30 and 5 days before the renewal date. Unsubscribing before then also needs Support
- On top of the monthly fee, data transferred out of protected resources is charged. Out of CloudFront it is USD 0.025 per GB for the first 100 TB
- Every benefit, cost protection included, is subject to fulfilling the one-year commitment

### When not to subscribe

The account you run this book's examples in does not need it. You would be protecting stacks that cost a few dollars a month for USD 3,000 a month.

For a real service too, the arrangement of this chapter does more for you first if any of these is true.

- An hour of downtime costs far less than the monthly fee
- Nobody is there to work with the SRT while an attack is under way, or you do not have the Business Support plan or above
- CloudFront is the only entry point, the origin is closed, and a rate-based rule and a brake are in place. With that, Standard takes layers 3 and 4, and the extra charges stay small, as [Design and Build](/en/chapters/46-shield/build.md) shows

AWS names these as reasons to consider subscribing: you have promised availability to your users, you want quick access to experts during an attack, you want AWS to tell you about attacks, and you want costs to stay predictable under attack. A service whose availability is tied directly to revenue or to a contract, and that has people to respond, fits that description.

## When you do not need this chapter

If your application runs entirely on Cloudflare Workers or Vercel, DDoS mitigation is the platform's job and comes with every plan. The differences are on [the last page](/en/chapters/46-shield/wrap.md). Even then, one result of [the simulation](/en/chapters/46-shield/build.md) holds on any platform: a brake does not tell users from an attack.

If all you publish on AWS is CloudFront in front of a private S3 bucket (chapter 03), there is little to add either. With no function and no load balancer there is no origin to protect and no compute charge to inflate. What is left is CloudFront's request and data transfer charges, and how to bound them is under ["Denial of wallet" in Design and Build](/en/chapters/46-shield/build.md).
