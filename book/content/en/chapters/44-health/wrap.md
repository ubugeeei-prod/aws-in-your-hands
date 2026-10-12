---
title: "44 Health: Costs, Pitfalls, and Cleanup"
---

# 44 Health: Costs, Pitfalls, and Cleanup

The [previous pages](/en/chapters/44-health/build.md) produced the stack that turns Health events into notices, and its tests. This page covers the deploy steps, the cost, how Cloudflare and Vercel differ, the pitfalls, and the cleanup.

## Deploy and check

<!-- section: 44.deploy -->

The steps in this section have not been run against real AWS.

```bash
vp run health:infra:diff
vp run health:infra:deploy -c alarmEmail=you@example.com
vp run health:global:infra:deploy -c alarmEmail=you@example.com
```

The first deploy is `AihHealth` in Tokyo and the second is `AihHealthGlobal` in us-east-1. Deploying to us-east-1 needs cdkd's storage in that Region as well, as when [chapter 10](/en/chapters/10-edge.md) placed a stack there. The mail address goes into the template and into cdkd's state. One confirmation mail arrives per topic, so follow the link in both.

To send into chapter 19's topic, pass `-c alarmTopicArn=<chapter 19's AlarmTopicArn>` in place of `alarmEmail`.

Nothing happens right after the deploy, because you cannot cause a Health event yourself. According to the documentation, public events might take up to one hour to start arriving after a rule is created. Two things can be checked without waiting.

One is the pattern. Open a rule in the EventBridge console, and the panel for testing a pattern offers Health samples under "Use sample events provided". It only shows whether the pattern matches. No event is sent.

The other is everything from the function onward. Paste one `event` from `fixtures/documented.json` into a test invocation in the Lambda console, and the write to the ledger and the publish to SNS run, and a mail arrives. Invoke it again with the same content, and the log should show `skipped` and `duplicate` and no mail should come. A test invocation is synchronous, so the asynchronous retries and the dead-letter queue cannot be checked this way.

Drift is checked as in the other chapters.

```bash
vp run health:infra:drift
vp run health:global:infra:drift
```

## Cost

<!-- section: 44.cost -->

Amounts are in USD for the Tokyo Region, on demand, before tax. The arithmetic is in [Pricing](/en/reference/pricing.md).

**A month in which no event arrives costs 0.** Nothing in this stack is billed for merely existing. The function is billed per invocation, the ledger per read, per write and per byte stored, SNS and SQS per request, and the log per byte written. There is no alarm, no schedule, no provisioned concurrency, and no KMS key. The stack's test checks that no resource type billed by the hour or the month is in the template.

On Health's own side:

- The dashboard is available to every customer at no additional cost
- Receiving Health events through EventBridge costs nothing extra either. The EventBridge pricing page says that events published by AWS services are ingested by the bus for free. That page lists no price for rules
- AWS User Notifications is free
- The Health API needs a Support plan. There is no charge per call. What you pay is the plan's monthly fee: for the cheapest, Business Support+, the greater of USD 29 a month per account or 9% of your charges (on the part up to USD 10,000)

Here is the arithmetic for a month in which events do arrive. It assumes that the function is invoked 40 times across the two stacks and that 30 of those become a notice: one issue that lasts a few hours, and a few scheduled changes and notices. It is an assumption, not a measurement.

| Item | Quantity | List price | After the monthly free tier |
| --- | --- | --- | --- |
| Lambda requests | 40 | 0.000008 | 0 |
| Lambda duration | 10 GB-seconds | 0.000133 | 0 |
| Ledger reads | 40 RRU | 0.0000057 | 0.0000057 |
| Ledger writes | 60 WRU | 0.0000429 | 0.0000429 |
| SNS publishes | 30 | 0 | 0 |
| SNS mail deliveries | 30 | 0 | 0 |
| Log ingestion | 0.0000763 GB | 0.000058 | 0 |
| Subtotal | | **0.00** | **0.00** |

The subtotals are rounded to the cent. Before rounding, the list price is about 0.00025. The function's duration (1 second per invocation) and the log volume (2 KB per invocation) are assumptions and were not measured. The us-east-1 stack's share is counted at Tokyo prices, and us-east-1 prices were not looked up. SNS is free up to 1 million requests and 1,000 mail deliveries a month.

What remains after deletion, and what it costs, is under "Cleanup".

## Coming from Cloudflare or Vercel

<!-- section: 44.platforms -->

Cloudflare and Vercel both have a way to tell you about outages and maintenance on the platform's side. What follows is from their official documentation and status pages as of 2026-10-13.

Cloudflare has "Incident Alerts" among the account's Notifications. They tell you when a Cloudflare incident is created, updated, and resolved, and can be filtered by impact level (minor, major, critical) and by affected component. "Maintenance Notification" tells you when maintenance of a data center (a point of presence) is scheduled, changed, or canceled, and lets you choose the locations. Both are available on all plans. Delivery is by mail and webhook on all plans and by PagerDuty on Business and above.

Vercel takes subscriptions on its status page (`vercel-status.com`): mail, SMS, Slack, webhook, and Atom and RSS feeds, for incidents created, updated, and resolved. The subscription forms showed no field for choosing a component or a region. Vercel's Alerts report anomalies in the usage and error rate of your own projects and are not notices about platform incidents.

The idea is the same. Have the outages the platform announces delivered to you, not fetched by you, and use them as an opinion separate from your own monitoring. AWS differs in these ways.

- What arrives with no setup is only mail about events that concern your own resources. To have announced outages (public events) delivered, you build a rule or a notification configuration yourself. On Cloudflare and Vercel, subscribing to announced outages is a matter of a few clicks
- An AWS event carries the IDs of your resources and a state for each. Notice at the level of "this instance of yours stops on this date" belongs to AWS, where you own instances. Workers and Vercel functions have no instance whose retirement the customer must prepare for
- Since you choose the Regions, you also decide which Region's events are received where. That took the most effort in this chapter

If all you want is notice of announced outages, Cloudflare's and Vercel's way is less work. On AWS too there is a way that needs only settings in User Notifications (the last section of the [first page](/en/chapters/44-health.md)).

## Pitfalls

| Symptom | Where to look |
| --- | --- |
| An outage has been announced and no notice comes | Check that a rule exists in that Region. A rule in Tokyo receives no other Region's events. Right after a rule is created, public events may not arrive for up to an hour |
| No events for IAM or CloudFront | Global events are delivered only to us-east-1. Check that `AihHealthGlobal` is deployed |
| A notice arrives with UNREADABLE in the subject | The event did not fit the schema. "What did not fit" in the body lists the fields. Read the event in the dashboard, then fix `src/event.ts` |
| An INFO notice arrives for a service you do use | The service's code is not on the list. Add the code shown in the subject to `SERVICES` in `src/watch.ts` |
| The same notice arrives twice | The function may have died after publishing and before writing to the ledger. Look for the error in the function's log. This duplicate is accepted in order to avoid a gap |
| No update arrives for an outage that is over | An update from before the closure arrived after it and was dropped. The log has `skipped` and `stale` |
| Calling the Health API returns `SubscriptionRequiredException` | It needs a Support plan. The stack in this chapter does not use the API |
| A pattern such as `"source": ["aws.health*"]` receives nothing | The documentation says a `source` with a wildcard does not match. Write `aws.health` |
| No mail arrives | Check that you followed the link in the confirmation mail. Each Region has its own topic, so there are two confirmation mails |

## For production

- Put an alarm on the dead-letter queue, firing as soon as one message is in it. Nobody has been told about an event that lands there. [Chapter 19](/en/chapters/19-observability.md) shows how to build an alarm
- Send the notices where people actually look. If mail is not enough, connect what sits behind the topic to chat or an on-call system. To send "incident" and "act by a date" to different places, SNS message attributes and subscription filters can be used ([chapter 25](/en/chapters/25-events.md))
- Make the account's contacts shared addresses. Health's mail goes to the account's contacts by default. Check that they are not still the personal address of someone who has left
- Fill in the list of services. The rule builder in the EventBridge console has a field for choosing Health's service codes. Confirm the codes of the services you use there and add them to `SERVICES`
- Decide what to do about the backup Region. To receive Tokyo's events even while EventBridge is down in Tokyo, place the same stack in us-west-2 too. As it stands, both Tokyo and us-west-2 would then announce the same event, because each Region has its own ledger. Avoiding the duplicate means either delaying the notice on the us-west-2 side and consulting Tokyo's ledger, or sharing the ledger across Regions. This chapter builds neither
- With several accounts, turn on organizational view and place this stack in the delegated administrator account
- Write down beforehand how you act during an outage. Runbooks and drills are covered in [chapter 33](/en/chapters/33-production-readiness.md) and [chapter 40](/en/chapters/40-disaster-recovery.md)

## Cleanup

<!-- section: 44.cleanup -->

```bash
vp run health:infra:destroy
vp run health:global:infra:destroy
```

The rules, the function, the ledger, the topic and its subscription, the dead-letter queue, and the log group are deleted, along with the ledger's records, any messages left in the queue, and the logs. Because this is for practice, every resource is set to be deleted with the stack. In production, keep at least the dead-letter queue and the log group.

Deleting the stack does not delete the Health events themselves. They stay in the dashboard, and the mail keeps arriving as before. Only the notification path you built is gone.

The only other thing left is the storage that cdkd's bootstrap created (chapter 02). If you bootstrapped in us-east-1, it remains there too.

## As a distributed system

- Who owns the state: the real state of an event is held by AWS Health. The ledger holds "the last state announced", not a copy of Health's state. Deleting the ledger loses only the history of notices, and the next event to arrive is announced as new
- The invariant: one notice per meaningful change of state of an event, and never zero notices for an open issue
- The tests that try to break it: a duplicate, an out-of-order update, a closure, a failed publish, a death between the publish and the record, and two deliveries at once, each reproduced in a fixed order
- What is not guaranteed: "exactly one". A death after the publish makes two. Nor is the order in which notices reach you guaranteed. The path from SNS to the mailbox is outside this chapter
- Delay: a Health event arrives after AWS has noticed the issue, written about it, and published it. By the time the notice arrives, the outage has already begun. Do not expect Health to tell you before your alarm does
- A failure you cannot observe: a wrong rule pattern produces no error. Nothing arrives, and that is all. This is why the chapter filters only on fields with fixed values, matches the patterns against fixtures in tests, and checks that the patterns in the template are those same ones

::: details Verification notes for this chapter

**Checked locally.** 89 unit tests (reading the five documented samples, time parsing, the rule patterns against the fixtures, classification, the ledger's decisions, a duplicate, an out-of-order update, a closure, a failed publish, a death in the middle and a concurrent run reproduced, the text of a notice, and stack assertions). Type checking. The output of `health:replay`. With `health:infra:synth`, that the templates of both stacks are generated without asking AWS anything, including the esbuild bundle. `vp check --fix` on this chapter's files, with no warnings, awscdk-lint included.

**Not checked yet.** Nothing has been run on AWS. In particular, the following points were only read from the documentation.

- The shape of a real Health event. None has been received. The fields on which the table and the samples disagree, the `detail` of an `AWS Health Abuse Event`, and the `eventRegion` of a global event are unknown
- That the rules match real events. This depends on `page` and `backupEvent` arriving as strings, as in the samples
- The codes in `detail.service`. Confirmed are only `EC2`, `LAMBDA`, `ELASTICLOADBALANCING`, `VPC`, `AUTOSCALING`, and `RDS` from the documentation's examples, `EBS` and `S3` read off event type codes, and `MULTIPLE_SERVICES` seen in the data of the Service health page. That last one was seen in the JSON the page loads (`https://health.aws.amazon.com/public/currentevents`), which is not documented
- Deploying with cdkd: the deploy to us-east-1, the rules' permission to invoke the function, TTL, the dead-letter queue, and how the subject and the body look in mail
- That with `-c alarmTopicArn` pointing at chapter 19's topic, the permission on the function's role is enough to publish. The policy of chapter 19's topic allows only CloudWatch, and the understanding that an IAM permission in the same account suffices has not been tried
- The permissions needed to forward to an event bus in another Region of the same account. They could not be settled, so that design was not built
- The Support plan the Health API requires. The user guide and the API reference do not agree, and until when the earlier plans remain valid could not be read from the pages opened. The plan comparison page was read as text, so which plan columns carry the check mark for the Health API could not be read
- The cost assumptions. The function's duration, the log volume, and the number of events a month were not measured
- Organizational view, and behaviour with several accounts

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What to do with each kind of event | `examples/44-health/src/message.ts`, `src/classify.ts` | `test:unit` |
| The Regions the rules go in | `examples/44-health/src/watch.ts`, `src/pattern.ts`, `test/pattern.test.ts` | `test:unit` |
| The shape of an event | `examples/44-health/src/event.ts`, `fixtures/`, `test/event.test.ts` | `test:unit` |
| Classification | `examples/44-health/src/classify.ts`, `test/classify.test.ts` | `test:unit` |
| One notice per state | `examples/44-health/src/ledger.ts`, `src/notify.ts`, `src/dynamodb-ledger.ts`, `test/ledger.test.ts`, `test/notify.test.ts` | `test:unit` |
| The stack | `examples/44-health/infra/lib/health-stack.ts`, `infra/bin/app.ts`, `src/lambda.ts`, `infra/test/health-stack.test.ts` | `test:unit`, `health:infra:synth` |
| Run it locally | `examples/44-health/scripts/replay.ts`, `fixtures/` | `health:replay` |
| Deploy and check | `examples/44-health/infra/bin/app.ts` | `health:infra:diff`, `health:infra:deploy`, `health:global:infra:deploy`, `health:infra:drift` |
| Cost | `data/pricing/` | |
| Cleanup | `tools/src/infra/` | `health:infra:destroy`, `health:global:infra:destroy` |

**How cdkd (0.296.28) handles the types.** With a dedicated implementation in `src/provisioning/register-providers.ts`: `AWS::Events::Rule`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::DynamoDB::Table`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::SNS::Subscription`, `AWS::SQS::Queue`, `AWS::SQS::QueuePolicy`, `AWS::Logs::LogGroup`, `AWS::IAM::Role`, `AWS::IAM::Policy`. No type in this stack goes through the Cloud Control API.

**Primary sources** (all checked on 2026-10-13)

- AWS Health user guide: [What is AWS Health?](https://docs.aws.amazon.com/health/latest/ug/what-is-aws-health.html), [Concepts for AWS Health](https://docs.aws.amazon.com/health/latest/ug/aws-health-concepts-and-terms.html), [Viewing your account events](https://docs.aws.amazon.com/health/latest/ug/aws-health-account-views.html), [AWS Health Dashboard (Service health)](https://docs.aws.amazon.com/health/latest/ug/aws-health-dashboard-status.html), [Planned lifecycle events](https://docs.aws.amazon.com/health/latest/ug/aws-health-planned-lifecycle-events.html), [Manage AWS Health notifications in AWS User Notifications](https://docs.aws.amazon.com/health/latest/ug/manage-user-notifications.html)
- Receiving through EventBridge: [Monitoring events in AWS Health with Amazon EventBridge](https://docs.aws.amazon.com/health/latest/ug/cloudwatch-events-health.html), [Creating EventBridge rules for AWS Region coverage](https://docs.aws.amazon.com/health/latest/ug/choosing-a-region.html), [Monitoring account-specific and public events](https://docs.aws.amazon.com/health/latest/ug/about-public-events.html), [Viewing paginated lists of AWS Health events](https://docs.aws.amazon.com/health/latest/ug/pagnation-of-health-events.html), [Configuring an EventBridge rule](https://docs.aws.amazon.com/health/latest/ug/creating-event-bridge-events-rule-for-aws-health.html), [Reference: AWS Health events Amazon EventBridge schema](https://docs.aws.amazon.com/health/latest/ug/aws-health-events-eventbridge-schema.html), [Running operations on EC2 instances automatically](https://docs.aws.amazon.com/health/latest/ug/automating-instance-actions.html)
- Several accounts: [Aggregating AWS Health events across accounts](https://docs.aws.amazon.com/health/latest/ug/aggregate-events.html), [Enabling organizational view](https://docs.aws.amazon.com/health/latest/ug/enable-organizational-view.html), [Registering a delegated administrator](https://docs.aws.amazon.com/health/latest/ug/register-a-delegated-administrator.html), [Aggregating AWS Health events using organizational view (EventBridge)](https://docs.aws.amazon.com/health/latest/ug/aggregating-health-events.html)
- The Health API: [Integrating AWS Health with other systems using the AWS Health API](https://docs.aws.amazon.com/health/latest/ug/health-api.html), [API Reference: Welcome](https://docs.aws.amazon.com/health/latest/APIReference/Welcome.html)
- Support plans: [Compare AWS Support Plans](https://aws.amazon.com/premiumsupport/plans/), [AWS Support Plan Pricing](https://aws.amazon.com/premiumsupport/pricing/)
- EC2 and Lambda: [Scheduled events for Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-instances-status-check_sched.html), [Instance retirement](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-retirement.html), [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), [How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- AWS User Notifications: [What is AWS User Notifications?](https://docs.aws.amazon.com/notifications/latest/userguide/what-is-service.html), [FAQs](https://aws.amazon.com/notifications/faqs/)
- EventBridge and SNS: [Amazon EventBridge Pricing](https://aws.amazon.com/eventbridge/pricing/), [Sending events between event buses](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-bus-to-bus.html), [SNS API: Publish](https://docs.aws.amazon.com/sns/latest/api/API_Publish.html)
- AWS Price List bulk API: [SNS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json) (the unit price of mail deliveries; the prices of Lambda, DynamoDB, and logs are the ones confirmed in chapters 04, 05, and 19)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- Cloudflare: [Notifications](https://developers.cloudflare.com/notifications/), [Available Notifications](https://developers.cloudflare.com/notifications/notification-available/)
- Vercel: [Vercel Status](https://www.vercel-status.com/), [Alerts](https://vercel.com/docs/alerts)

:::
