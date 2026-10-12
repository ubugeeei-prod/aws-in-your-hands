---
title: "46 Shield: Costs, Pitfalls, and Cleanup"
---

# 46 Shield: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 46.cost -->

This page looks at what the things added in this chapter cost. Amounts are in USD, at list price, before tax, read on October 13, 2026. The arithmetic is in [Pricing](/en/reference/pricing.md).

**The default `AihShield` costs 0 when nobody calls it.** Neither the function, the function URL, the distribution nor the origin access control has a charge for merely existing. Shield Standard is free too.

**`AihShieldEdge` is 6.10 a month with no requests.** The web ACL is 5.00, its one rule 1.00, and the one alarm 0.10. The web ACL is charged from the moment it exists, attached to a distribution or not. There is no reason to keep both this one and chapter 21's web ACL (8.00 a month), so keep one of them. Whether an alarm in us-east-1 shares CloudWatch's free allowance with alarms in ap-northeast-1 was not confirmed, so nothing is deducted.

**With a Shield Advanced subscription it is 3,000.20 a month, 36,002.40 over twelve months.** The subscription is 3,000.00 and the two alarms 0.20. The web ACL and rule of a protected distribution have usage types priced at 0 in the Price List, so they are left out of this sum. The extra charge on data transfer (0.025 per GB out of CloudFront) and the Support plan needed to reach the SRT are not included. Deleting the stacks does not end the subscription.

In use, the cost per request is about that of chapter 21's arrangement. With the web ACL attached, the inspection charge of 0.60 per million is added. What an hour of flood costs, and thirty days of it, is under ["Denial of wallet" in Design and Build](/en/chapters/46-shield/build.md).

## If you come from Workers or Vercel

<!-- section: 46.compare -->

On Cloudflare and Vercel, DDoS mitigation is part of the platform. The following is from their official documentation as read on October 13, 2026.

| | Cloudflare | Vercel | This chapter (AWS) |
| --- | --- | --- | --- |
| DDoS mitigation | Layers 3 to 7, included in every plan, Free too | Layers 3, 4 and 7, mitigated automatically on every plan | Shield Standard for layers 3 and 4. For layer 7 you place the web ACL, the cache and the brake yourself |
| Charges for the attack | The billing systems exclude DDoS traffic from usage | No charge for traffic the Firewall blocked. Usage is incurred for requests served before a mitigation started and for requests not recognized as DDoS | No CloudFront charge for what AWS WAF blocked. Everything that got through is charged |
| Limits per source | Rate limiting rules exist on Free too. Free and Pro count by IP | Vercel WAF rate limiting is on every plan | The rate-based rule. The web ACL and the rule have monthly fees |
| An emergency measure by hand | Not checked for this chapter | Attack Mode: challenges every visitor. Free on every plan | Reserved concurrency of 0. AWS WAF has a challenge action, not used in this chapter |
| A ceiling on the bill | A limit can be set on a Worker's CPU time | Spend Management: pauses projects at an amount you set (Pro) | Budgets only notify. CloudFront's flat-rate pricing plans are a monthly price with no overage charges |
| A team of experts | Not checked for this chapter | Not checked for this chapter | The SRT of Shield Advanced: 3,000 a month, and the Business Support plan or above |

The largest difference is the idea of an origin. On Workers the code runs inside Cloudflare's network, with no separate origin behind it. What this chapter spent its first effort closing is not there to begin with. A Worker that calls an origin elsewhere (your own server, or an API on AWS) is another matter: that origin has the same problem as in this chapter.

The thinking about charges differs too. Cloudflare says it excludes from the bill the traffic it judges to be DDoS. On AWS, what is excluded is CloudFront's charge for requests that AWS WAF blocked, and placing the rule that blocks, and paying for its inspection, is up to you. A flat-rate pricing plan comes closer, but a plan covers CloudFront's side only.

Some things are the same on every platform. A request that slips past the judgement is counted as ordinary usage. Vercel's documentation says so plainly. Where an attack cannot be told from users, whether to protect the bill or the service is yours to decide wherever you are.

If your application is well served on Workers or Vercel, DDoS is no reason to move to AWS. Getting the same peace of mind on AWS takes as many more parts as this chapter has.

## Where people trip

| When this happens | Look here |
| --- | --- |
| The CloudFront URL answers 403 | The function URL's auth type is `AWS_IAM` and CloudFront has no permission. Check that there are two `AWS::Lambda::Permission` resources and that the `SourceArn` of both names this distribution |
| POST answers 403 | By design. This stack lets only GET and HEAD through. A POST behind OAC needs the sender to add `x-amz-content-sha256` |
| `/health` is not cached | Look at the response's `cache-control`. `no-store` means the application did not take it for the shared route. The header is added only when the path is exactly `/health` |
| A response that differs per user was cached | Only a route that answers the same whoever calls may go into `SHARED_CACHE`. A route that involves sign-in must not |
| `shield:edge:infra:deploy` stops at synth | That stack can only be created in us-east-1. With `-c shieldAdvanced=on`, `-c distributionArn` is required as well |
| The rate-based rule does not stop at exactly the limit | By design. It works from an estimate, with a delay. Choose a limit you can afford to have passed a little |
| Users at an office or a school were stopped together | Many people share one IP address. Raise the limit or change what is counted. Changing what is counted is not covered in this chapter |
| A deploy with `-c reservedConcurrency` is refused | The account's concurrency quota. Read the value with chapter 32's `vp run limits:quotas --service lambda` |
| With the brake on, 429s appear in normal times | Ten times the reserved concurrency is the ceiling per second. Put it above your highest normal rate |
| The alarm does not go off | Without `-c alarmTopicArn` there is nobody to tell. Only a topic in us-east-1 is accepted |
| `shield:origins` says `unknown` | It means the template alone cannot decide. The security group is in another stack, or the value is set at deploy time. Check the real resource |

## If you take this to production

- Have one entry point. The API chapters of this book publish an HTTP API directly. To put one behind CloudFront and a web ACL in production, the ways of closing an origin that this chapter checked are a function URL, or a load balancer behind a VPC origin
- Let writes through. Using POST behind OAC needs the client to send the SHA-256 of the body. This chapter does not build that
- Choose the rate-based rule's numbers from your own service's use. Run it as `count` for a week or so first, see how many requests it would have stopped, and then switch to `block`
- Go over the routes that come before sign-in. A route that runs the function for someone who is not signed in is what an attack aims at. Cache what can be cached, and make the rest light
- Consider the Anti-DDoS managed rule group. It is for telling a spread-out attack apart by behaviour and not by the number of sources. It has a monthly fee and a request fee, and was not tried in this chapter
- Keep the web ACL's logs. They are what you look at after an attack to see what arrived. Where to store them and what that costs is in chapters 21 and 26
- Put a limit on each pay-per-use thing behind the function: the table's request unit ceiling (chapter 32), the model call limits (chapter 17)
- Write the runbook, and decide who may call the emergency stop. [The Deploy page](/en/chapters/46-shield/deploy.md) is a starting point
- If you subscribe to Shield Advanced, set up the health check, the contacts for proactive engagement, and the SRT's access as well. Subscribing, or adding a protection, does not by itself make most of the benefits work
- Deploy through the AWS CDK CLI and CloudFormation, for the reason given in chapter 02

## Cleanup

<!-- section: 46.cleanup -->

With the web ACL attached, remove things in the reverse order. First deploy without `webAclArn`, which detaches it from the distribution.

```bash
vp run shield:infra:deploy
vp run shield:edge:infra:destroy
vp run shield:infra:destroy
```

The second line removes the web ACL and the alarm and stops the monthly fee. The third removes the distribution, the function and the log group.

Some things do not go with the stacks.

- The Shield Advanced subscription. The stack created only a protection; the subscription stays, and so does its monthly fee. Ending it and stopping the automatic renewal go through Support, as ["Price and commitment" on the overview page](/en/chapters/46-shield.md) says
- A flat-rate pricing plan. The documentation says a distribution subscribed to a plan cannot be deleted until the plan is cancelled
- An SNS topic you created yourself
- A reserved concurrency changed by hand goes with the function

The only other thing left is the storage that cdkd's bootstrap created (chapter 02). If you bootstrapped us-east-1 as well, it is left there too.

## Seen as a distributed system

Preparing for DDoS is a design that leans on state you do not hold.

- Who owns the state: AWS WAF holds the counts per source, each CloudFront location holds its cache, and Lambda holds the concurrency. Your code can read none of them. All you see is metrics, and they arrive late
- The invariant: a request that reaches the origin from the internet has always come through CloudFront
- Tests that try to break it: a function URL without authentication, a permission without `SourceArn`, and a security group that admits every source are each made into a template and run through the check, which must not say `closed`. For this chapter's own stack, `check:all` fails unless it says `closed`
- How exact the counting is: the rate-based rule's count is an estimate, and it takes time to act. What arrives during that delay goes on to the origin. In the simulation, 155,000 requests got through before the 20 addresses were stopped
- Partial failure: the brake refuses attack and users alike. The function is protected, and to its users the service is down. That refused users' retries add load is what chapter 32 showed
- The scope of consistency: the cache is per location. When it expires in one, others still give the old answer. Cache only routes whose answer may differ between locations for 5 seconds

::: details Verification notes for this chapter

**Checked locally.** The origin check, the cache header, the flood simulation, usage lines against the recorded scenarios, and assertions on the two stacks (6 files, 64 tests). The type check. `vp check --fix` on this chapter's paths only. Synth (with the esbuild bundle, two templates). Loading the bundle that synth produced in Node.js and calling `/health` and `/notes` with an event shaped like a function URL's: `cache-control` was `public, max-age=5` and `no-store`. `vp run shield:infra:synth`, `vp run shield:origins:gate` and `vp run shield:flood`: the table on the page is the output of `shield:flood`. For `shield:origins`, the script (`node examples/46-shield/scripts/origins.ts`) was run directly over the 56 templates present in this checkout. The task itself first synthesizes every chapter with `infra:synth`, and that was not run.

**Not checked yet.** `shield:infra:deploy`, `shield:edge:infra:deploy`, `shield:infra:drift` and `shield:infra:destroy` were not run against AWS. These points in particular are read from the documentation and the templates only.

- That a direct call to the function URL answers 403, that `/health` is cached by CloudFront, and that a different query string is the same object
- How many seconds the rate-based rule really takes to act. The simulation's 30 seconds is an assumption. That blocked requests keep being counted is a reading of the wording
- That a function URL with reserved concurrency answers 429 at ten times that many requests, and what CloudFront does with that 429. The size of the model's burst is this chapter's assumption
- Whether Lambda charges for a refused invocation. The cost arithmetic counts only the runs of the function
- That `BlockedRequests` in `AWS/WAFV2` is found for a CloudFront web ACL with the two dimensions `WebACL` and `Rule`
- Everything about Shield Advanced. No subscription was taken. That cdkd can create `AWS::Shield::Protection` through Cloud Control API, that a protection for CloudFront may be declared in a us-east-1 stack, the name of `DDoSDetected`'s dimension, and how a deploy fails without a subscription. The SRT, cost protection, proactive engagement and health-based detection are from the documentation only
- Whether anything appears in `AWS/DDoSProtection` in an account without a subscription
- CloudFront's flat-rate pricing plans: whether this chapter's distribution can join one, whether a plan can be set from CloudFormation, and what really happens above the allowance
- The three ways of closing a load balancer. Their templates were synthesized and run through the check, and nothing was deployed. The ID of the prefix list in ap-northeast-1 was not looked up
- The Anti-DDoS managed rule group, Bot Control and AWS WAF's challenge action. Only their names and prices were read
- The statements about Cloudflare and Vercel come from pages of their official documentation. "Not checked for this chapter" in the table means the pages read did not say
- On the Shield pricing page the monthly fee is filled in by script and was not in the HTML that was fetched. USD 3,000 is the Price List's value. The one-year commitment is in the page's own text

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture | `examples/46-shield/infra/bin/app.ts`, `src/defences.ts` | `shield:infra:synth` |
| Closing the origin | `examples/46-shield/src/origins.ts`, `test/origins.test.ts`, `scripts/origins.ts`, `infra/lib/alb-origin.ts`, `infra/lib/shield-stack.ts` | `test:unit`, `shield:origins`, `shield:origins:gate` |
| Thinning traffic at the edge | `examples/46-shield/src/cache.ts`, `test/cache.test.ts`, `infra/lib/shield-stack.ts`, `infra/lib/edge-stack.ts`, `infra/test/` | `test:unit`, `shield:infra:synth` |
| A brake on the origin | `examples/46-shield/src/defences.ts`, `infra/lib/config.ts`, `infra/lib/shield-stack.ts` | `test:unit` |
| Sending a flood through | `examples/46-shield/src/flood.ts`, `src/runs.ts`, `test/flood.test.ts`, `scripts/flood.ts` | `test:unit`, `shield:flood` |
| Denial of wallet | `examples/46-shield/src/bill.ts`, `test/pricing.test.ts` | `test:unit`, `shield:flood` |
| Putting the Advanced protection in the stack | `examples/46-shield/infra/lib/edge-stack.ts`, `infra/lib/config.ts`, `infra/test/edge-stack.test.ts` | `test:unit`, `shield:edge:infra:deploy` |
| Deploy and check | `examples/46-shield/infra/bin/app.ts`, `infra/lib/config.ts` | `shield:infra:diff`, `shield:infra:deploy`, `shield:edge:infra:deploy`, `shield:infra:drift` |
| Cleanup | `tools/src/infra/` | `shield:infra:destroy`, `shield:edge:infra:destroy` |

**How cdkd (0.296.28) handles the types.** Provider registrations were read in `dist/` of the installed package. With a provider of their own: `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::WAFv2::WebACL`, `AWS::CloudWatch::Alarm`. The two default stacks use only these ten. `AWS::Shield::Protection`, which `-c shieldAdvanced=on` adds, has no registration and goes through Cloud Control API.

**Primary sources** (checked on 2026-10-13)

- [How AWS Shield and Shield Advanced work](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-overview.html), [AWS Shield Standard overview](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-standard-summary.html), [AWS Shield Advanced overview](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary.html), [List of AWS resources that AWS Shield Advanced protects](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-protected-resources.html), [AWS Shield Advanced capabilities and options](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-capabilities.html), [Deciding whether to subscribe to AWS Shield Advanced](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-deciding.html)
- [AWS Shield detection logic for infrastructure layer threats](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-event-detection-infrastructure.html), [AWS Shield mitigation logic for CloudFront and Route 53](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-event-mitigation-logic-continuous-inspection.html), [Responding to DDoS events in AWS](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-responding.html)
- [Managed DDoS event response with SRT support](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-srt-support.html), [Setting up proactive engagement](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-srt-proactive-engagement.html), [Health-based detection](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-health-checks.html), [Requesting a credit in AWS Shield Advanced after an attack](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-request-service-credit.html), [Automating application layer DDoS mitigation](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-automatic-app-layer-response.html), [Grouping your AWS Shield Advanced protections](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-protection-groups.html), [AWS Shield Advanced metrics](https://docs.aws.amazon.com/waf/latest/developerguide/shield-metrics.html), [Subscribing to AWS Shield Advanced](https://docs.aws.amazon.com/waf/latest/developerguide/enable-ddos-prem.html)
- [AWS Shield Pricing](https://aws.amazon.com/shield/pricing/), [DDoS Simulation Testing Policy](https://aws.amazon.com/security/ddos-simulation-testing/)
- [Rate-based rule high-level settings](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html), [Rate-based rule caveats](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html), [Applying rate limiting to requests](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-request-limiting.html), [Listing IP addresses that are being rate limited](https://docs.aws.amazon.com/waf/latest/developerguide/listing-managed-ips.html), [AWS WAF DDoS prevention](https://docs.aws.amazon.com/waf/latest/developerguide/waf-anti-ddos.html), [AWS WAF metrics and dimensions](https://docs.aws.amazon.com/waf/latest/developerguide/waf-metrics.html)
- [Restrict access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html), [Restrict access with VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html), [Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html), [Locations and IP address ranges of CloudFront edge servers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html), [AWS-managed prefix lists](https://docs.aws.amazon.com/vpc/latest/userguide/working-with-aws-managed-prefix-lists.html)
- [Use managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html), [Request and response behavior for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html), [Metric types for CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/programming-cloudwatch-metrics.html), [CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html), [Amazon CloudFront no longer charges for requests blocked by AWS WAF](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-cloudfront-charges-requests-blocked-aws-waf/)
- [Creating and managing Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html), [Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- AWS Best Practices for DDoS Resiliency: [Mitigation techniques](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/mitigation-techniques.html), [Protecting your origin (BP1, BP5)](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/protecting-your-origin-bp1-bp5.html), [Protecting API endpoints (BP4)](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/protecting-api-endpoints-bp4.html)
- [AWS::Shield::Protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-shield-protection.html), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the installed package)
- AWS Price List bulk API: [AWSShield](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSShield/current/index.json), [awswaf](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json), [CloudFrontPlans](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/CloudFrontPlans/current/index.json), [AmazonCloudWatch (us-east-1)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-1/index.json)
- [Cloudflare DDoS Protection](https://developers.cloudflare.com/ddos-protection/), [FAQ](https://developers.cloudflare.com/ddos-protection/frequently-asked-questions/), [Workers: Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [WAF: Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Vercel Firewall](https://vercel.com/docs/vercel-firewall), [Vercel: DDoS Mitigation](https://vercel.com/docs/vercel-firewall/ddos-mitigation), [Vercel WAF: Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)

:::
