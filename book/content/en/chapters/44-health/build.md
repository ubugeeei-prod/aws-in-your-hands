---
title: "44 Health: Design and Build"
---

# 44 Health: Design and Build

The [previous page](/en/chapters/44-health.md) sorted out what Health tells you, what it does not, and what to do with each kind of event. This page builds the stack that receives Health events and turns them into notices, in this order: the Regions the rules go in, the shape of an event, classification, deduplication, the stack, and replaying events locally.

## The Regions the rules go in

<!-- section: 44.regions -->

An AWS service puts its events on the default event bus of its own Region. Health does the same, so an EventBridge rule is created in each Region you want events from. The user guide gives four rules.

- An event of a Region is delivered to that Region. A Tokyo issue arrives on Tokyo's bus
- Events of services that have no Region, such as IAM (global events), are delivered only to N. Virginia (us-east-1)
- For reliability, events are also sent to a backup Region. The backup is Oregon (us-west-2), and only Oregon's own backup is N. Virginia. A copy delivered to a backup has `detail.backupEvent` set to `true`
- One rule in Oregon receives the account-specific events of all Regions (simplified integration). Public events do not arrive that way

```figure
caption: The Regions this book's stacks use, and the Health events delivered there. The copies delivered to Oregon are not received
node tokyo: Events of ap-northeast-1 | account-specific and public
node global: Global events | IAM and others
node virginia: Events of us-east-1
node oregon: Events of us-west-2
node busT: default event bus | ap-northeast-1
node busV: default event bus | us-east-1
node busO: default event bus | us-west-2
node stackT: AihHealth
node stackV: AihHealthGlobal
edge tokyo -> busT
edge tokyo --> busO: copy
edge global -> busV
edge virginia -> busV
edge oregon --> busV: copy
edge busT -> stackT
edge busV -> stackV: only where backupEvent is false
```

Nearly all of this book's stacks are in Tokyo. A few are in us-east-1 for CloudFront's sake (the Lambda@Edge function of [chapter 10](/en/chapters/10-edge.md) and the web ACL of [chapter 21](/en/chapters/21-security.md)). Every chapter uses IAM. So the same stack goes into two places, Tokyo and us-east-1, one each. The Regions to receive in are kept in one list.

<<< @/examples/44-health/src/watch.ts{watch}

Oregon's simplified integration was not used because public events do not arrive through it. The first question of this chapter, whether an alarm is about a problem on AWS's side, is answered by public events.

Forwarding events from a rule in us-east-1 to Tokyo's bus, so that one function would do, was also considered. It was rejected for two reasons. With trouble in Tokyo, global events would stop arriving as well. And the permissions needed to forward to a bus in another Region of the same account could not be settled from the documentation. Two stacks mean more parts and fewer dependencies.

A third stack in Oregon would receive the copies of Tokyo's events even while EventBridge itself is down in Tokyo. This chapter does not place one. The [last page](/en/chapters/44-health/wrap.md) says what to watch for if you do.

The rule patterns are made from that list.

<<< @/examples/44-health/src/watch.ts{patterns}

There are two rules, and both invoke the same function. `Events` is for ordinary Health events and `Abuse` for abuse events. The shape of an abuse event's `detail` is unknown, so that rule puts no condition on `detail`.

The condition on `page` deals with pagination. When so many resources are affected that one event would exceed 256 KB, Health splits it into pages and publishes them as separate messages. Apart from the list of resources, every page says the same. For notices read by people, the documentation recommends letting only the first page through.

### No filter on the service

The patterns have no condition on the service. It is tempting to write "only the issues of services this book uses", and there are two reasons not to.

One is that the documentation has no list of the codes that appear in `detail.service`. `EC2`, `LAMBDA`, and `ELASTICLOADBALANCING` appear in the samples, but the codes for DynamoDB or API Gateway could not be confirmed. A guessed code that is wrong makes the rule pass nothing, without any error. In the middle of an outage, "the spelling was off" is a poor reason for a notice not to come.

The other is that a large outage is sometimes announced not under one service but under the code `MULTIPLE_SERVICES`. The data of the Service health page, read on 2026-10-13, held an event with that code. A rule filtered by service names drops the largest outages.

The public events of one Region are few. So the rules filter only on fields whose values are fixed (`source`, `detail-type`, `page`, `backupEvent`), and the judgment about the service lives in the function. An issue of a service that is not on the list still arrives, as an "inform" notice with the code in its subject. Seeing the code, you can add it to the list.

### Checking the patterns locally

To check the patterns without deploying, the part of EventBridge's matching that these rules use was written out, and nothing more.

<<< @/examples/44-health/src/pattern.ts{matcher}

It implements three things: exact match of a string, nested objects, and AND across fields. It implements no prefix match, no `anything-but`, no numeric comparison, no `exists`, no wildcard, and no `$or`. How to write patterns is the subject of [chapter 25](/en/chapters/25-events.md).

The tests run the fixtures through this matcher and check that a first page meant for Tokyo matches exactly one rule, that a second page does not invoke the function, that the rules in us-east-1 drop copies, and that no event matches two rules of the same Region. The stack's test checks that the patterns in the template are the ones from this list, so that what was matched locally and what gets deployed cannot drift apart.

## The shape of an event

<!-- section: 44.event-shape -->

The JSON the function receives comes from outside the types, so it is checked against Valibot on the way in. The schema was written from the table in the user guide's "AWS Health events Amazon EventBridge schema".

<<< @/examples/44-health/src/event.ts{schema}

Setting the table beside the samples shows disagreements. The schema sides with what lets the samples through.

- `lastUpdatedTime` is required in the table, but two of the five samples lack it. It is optional here
- One sample has no `resources`. Missing, it is read as an empty array
- The persona value is `OPERATIONAL` in the table and `OPERATIONS` in the samples and on the concepts page. The function does not use personas, so it only accepts an array of strings
- `page`, `totalPages`, and `backupEvent` arrive as strings, not as numbers or booleans

`eventRegion` and `region` are different things. `region` is the Region the event was delivered to, and the Region where the issue is happening is in `detail.eventRegion`. On a copy, the two differ.

Times arrive in the form `Fri, 27 Jan 2023 06:02:51 GMT`. They are read against a fixed form, not handed to `Date.parse`.

<<< @/examples/44-health/src/event.ts{time}

The weekday is not checked because the weekdays in the documentation's samples do not fit their dates (27 January 2026 is a Tuesday, and the sample says `Thu`).

A category or a status with an unknown value makes the check fail. A failed event is not dropped. Only the envelope is read again, and the event becomes a notice that says an unreadable event arrived.

<<< @/examples/44-health/src/event.ts{envelope}

An unknown extra field does not fail the check and is skipped. New fields are common, and every notice turning "unreadable" each time one appears would help nobody.

There are two sets of fixtures. `fixtures/documented.json` holds the five samples from the documentation, copied unchanged. `fixtures/written.json` was written for this chapter from the table and the samples: three events for a Lambda issue in Tokyo that opens, is updated, and closes, the retirement of chapter 23's instance, the end of support of a Lambda runtime, and others. Neither set was received from AWS. No real event has been received yet.

## Classification

<!-- section: 44.classify -->

An event that could be read is sorted into one of four kinds.

<<< @/examples/44-health/src/classify.ts{kinds}

The sorting is one pure function.

<<< @/examples/44-health/src/classify.ts{classify}

Where in doubt, it leans toward telling.

- Only copies delivered to a backup Region and pages after the first are ignored. The rules already drop both, so they reach this code only after someone changes the rules
- An account-specific issue is an "incident" whatever the service, because your own resources are named
- A public issue is an "incident" if the service is on the list and "inform" if it is not
- A scheduled change is "act by a date", and the date is the event's start time. One labelled `INFORMATIONAL`, or one that is already over, is lowered to "inform"
- An account notification is "act by a date" unless it is explicitly `INFORMATIONAL`, because urgent ones are mixed into this category and may carry no label. It gets no date
- An abuse report is "act by a date" even though its category is issue

## One notice per state

<!-- section: 44.dedup -->

The invariant of this chapter is: **one notice per meaningful change of state of an event, and never zero notices for an open issue.**

Three things work against it. Delivery from Health to EventBridge is at least once, so the same thing arrives twice. While an issue lasts, the same event is updated and delivered many times, in no guaranteed order. And EventBridge invokes the function asynchronously, so when the function fails, Lambda invokes it again with the same event.

So the last state announced for each event is remembered in a DynamoDB table. This chapter calls that table the ledger.

<<< @/examples/44-health/src/ledger.ts{entry}

The key is the pair of account ID and event ARN. The documentation says that an event ARN can be the same across accounts.

What counts as a "meaningful change" depends on the kind. An incident is announced every time AWS writes an update, since a change in the situation is what you want to hear. Everything else is announced only when its status or its dates move. A planned lifecycle event is updated each time a resolved resource is ticked off, and a mail for each of those would stop being read.

Order is decided by `lastUpdatedTime`. For an event without that field, the time it was delivered to EventBridge stands in.

What to do with an arriving event is decided by comparing it with the ledger.

<<< @/examples/44-health/src/ledger.ts{decide}

The same state arriving again is dropped. So is a state older than the ledger's. Announcing a late intermediate update after an issue has closed would read as if the issue were still going on. Within the same second, the state that is further along (`upcoming`, then `open`, then `closed`) counts as newer.

### Write before sending, and write again after

Writing to the ledger and sending to SNS are separate operations, and the function can die between them. Send first and write second, and a death before the write produces the same notice again. Write first and send second, and a death before the send produces no notice at all, and the retry concludes that it was already announced. The latter breaks the second half of the invariant.

This chapter writes to the ledger twice.

```figure
type: sequence
caption: A place is claimed in the ledger before the notice goes out, and settled once SNS has accepted it. If it dies in between, the retry claims it again
actor eb: EventBridge
actor fn: Lambda
actor ledger: Ledger
actor sns: SNS
step eb -> fn: event
step fn -> ledger: read
step fn -> ledger: claim (notified: false)
step fn -> sns: Publish
step fn -> ledger: settle (notified: true)
```

<<< @/examples/44-health/src/notify.ts{announce}

The first write declares "the notice for this state is mine to send", with `notified` set to `false`. Once the publish to SNS has succeeded, it is rewritten to `true`. If the publish fails, the function ends with an error and Lambda invokes it again a minute later. The retried function finds an unsettled record of the same state. If 30 seconds or more have passed since the claim, it takes the earlier run to be over and sends the notice itself. Thirty seconds is longer than the function's timeout (10 seconds) and shorter than Lambda's first retry (after one minute). The stack's test pins that ordering.

Each write carries a condition: that the ledger's record has not changed since it was read. When two deliveries of the same event come almost at once, both read "nothing yet" and both try to write, and only one gets through. The loser reads again and decides again. It is the same technique as the version check in [chapter 05](/en/chapters/05-dynamodb.md).

<<< @/examples/44-health/src/dynamodb-ledger.ts{ledger}

What this procedure guarantees goes as far as "never zero". If the function dies after the publish succeeded and before the second write, the retry sends one more. "Exactly one" is not guaranteed. For a notice about an outage a duplicate can be lived with and a gap cannot, so the design leans this way.

Last, the function that connects the entrance to the exit.

<<< @/examples/44-health/src/notify.ts{handle}

The clock, the ledger, the publish, and the log are passed in as arguments. The tests swap the ledger for one in memory and the publish for a push onto an array, and reproduce these situations in a fixed order.

- The same event arrives twice, including as a separate message with a different EventBridge ID
- An update arrives after the closure that happened later than it
- The first thing heard of an event is its closure
- The publish fails once and the function is retried a minute later
- An earlier run died before publishing and another delivery comes 10 seconds later. It keeps its hands off until 30 seconds have passed
- The function dies after the publish and before the second write. Two notices go out
- Between a read and its write, another run handles the same event from start to finish

## The stack

<!-- section: 44.stack -->

The stack is made of rules, a function, the ledger, a topic, and a dead-letter queue.

<<< @/examples/44-health/infra/lib/health-stack.ts{rules}

The rules go on the default event bus, which is what you get when `eventBusName` is not given. The patterns are the ones made from the list above, passed as they are.

<<< @/examples/44-health/infra/lib/health-stack.ts{function}

The function's role is given `GetItem` and `PutItem` on the ledger, `Publish` on the topic, writing to the log group, and `SendMessage` on the dead-letter queue, and nothing else. Each is narrowed to one resource, and there is no `*`.

The dead-letter queue receives an event that failed three times (the first attempt and two retries). Nobody has been told about an event that lands there. In production, add an alarm that fires as soon as one message is in this queue. This chapter's stack has none because an alarm costs money just by existing.

The log is kept for three months. One line remains for every ignored event, with the reason, so "why did no notice come for that outage" can be answered for as long as the dashboard keeps the event, 90 days.

<<< @/examples/44-health/infra/lib/health-stack.ts{topic}

The stack makes the topic unless one is given. The policy that `enforceSSL` adds is a single statement refusing a publish that does not use TLS, with no statement that allows anyone anything. The only thing that can publish is whatever in this account holds an IAM permission, which is the function's role.

To send into chapter 19's topic, pass the output `AlarmTopicArn` of chapter 19's stack as `-c alarmTopicArn=...`. Alarms and Health notices then reach the same destination. The function's SNS client reads the Region from the ARN, so the stack in us-east-1 can send to a topic in Tokyo too. In that case, though, notices about global events also stop while SNS is unavailable in Tokyo.

<<< @/examples/44-health/infra/lib/health-stack.ts{ledger}

The ledger is an on-demand table, with no reads or writes unless an event arrives. A record is removed by TTL 180 days after it was last written.

<<< @/examples/44-health/infra/bin/app.ts{stacks}

The app creates the same stack once for each Region on the list.

<<< @/examples/44-health/src/lambda.ts{handler}

The Lambda handler only calls the function above with the real ledger and SNS.

The resource types in use are `AWS::Events::Rule`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::DynamoDB::Table`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::SNS::Subscription`, `AWS::SQS::Queue`, `AWS::SQS::QueuePolicy`, `AWS::Logs::LogGroup`, `AWS::IAM::Role`, and `AWS::IAM::Policy`. The pinned cdkd (0.296.28) has a dedicated implementation for every one of them. None goes through the Cloud Control API.

## Run it locally

<!-- section: 44.local -->

This chapter has no server to start locally, because there is no way to cause a Health event yourself. A task sends the fixtures through the same code the function runs and prints the text that would be sent.

```bash
vp run health:replay
```

It does not touch AWS. The ledger is in memory and the publish only counts. The order of arrival is written in the script.

<<< @/examples/44-health/scripts/replay.ts{order}

The fixtures for the Lambda issue are arranged as the opening, a duplicate, the closure, and an update that arrives late. What follows is part of the output: the notice for the opening, the two that were dropped, the one that never reached the function, and the last line. The output in between, including the notice for the closure, is left out.

```text
== tokyo-lambda-issue-open (delivered to ap-northeast-1)
   rule: AihHealth / Events
   sent (new)
   Subject: [AWS Health] INCIDENT LAMBDA ap-northeast-1 open: AWS_LAMBDA_OPERATIONAL_ISSUE
   | incident: a public issue of LAMBDA, which this app uses
   | What to do: Note it in the incident. Start no new deploy. Fail over only by your own criteria.
   |
   | Event: AWS_LAMBDA_OPERATIONAL_ISSUE (issue, PUBLIC)
   | Status: open
   | Region: ap-northeast-1, delivered to ap-northeast-1
   | Account: 123456789012
   | Started: 2026-10-13T17:48:00Z
   | Updated: 2026-10-13T18:04:00Z
   |
   | We are investigating increased error rates for Lambda invocations in the AP-NORTHEAST-1 Region.
   |
   | Dashboard: https://health.aws.amazon.com/health/home
   | Event ARN: arn:aws:health:ap-northeast-1::event/LAMBDA/AWS_LAMBDA_OPERATIONAL_ISSUE/AWS_LAMBDA_OPERATIONAL_ISSUE_EXAMPLE_0001

== tokyo-lambda-issue-open (delivered to ap-northeast-1)
   rule: AihHealth / Events
   skipped: duplicate

== tokyo-lambda-issue-update (delivered to ap-northeast-1)
   rule: AihHealth / Events
   skipped: stale

== docs-account-ec2-backup-copy (delivered to us-west-2)
   no stack in that Region: never seen

12 arrivals, 8 messages.
```

The text inside is the fixture's, not something AWS wrote. The event type code `AWS_LAMBDA_OPERATIONAL_ISSUE` is also a name this chapter gave its fixture.

The tests, the type check, and the synth are run as follows.

```bash
vp test run examples/44-health
vp run health:infra:synth
```

`health:infra:synth` writes the templates of both stacks to `examples/44-health/cdk.out/`. It asks AWS nothing.

What cannot be checked locally should be said too. Whether the rules match real Health events, and whether real events pass the schema, will not be known until an event arrives. The matcher is not EventBridge, and the fixtures were written from the documentation.
