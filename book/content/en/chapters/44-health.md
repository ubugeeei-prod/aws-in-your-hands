---
title: "44 Health: Knowing When the Problem Is on AWS's Side"
sourceRevision: 1
---

# 44 Health: Knowing When the Problem Is on AWS's Side

Suppose the alarm from [chapter 19](/en/chapters/19-observability.md) fires at 3 a.m. The share of 5xx responses is up. The cause may be your last deploy, or Lambda may be having trouble in the Tokyo Region. You can fix the first yourself. For the second you can only wait, so what you should do next is entirely different.

There is a second situation. Suppose the hardware under the instance from [chapter 23](/en/chapters/23-ec2.md) is failing, and AWS has scheduled the instance to be stopped next Tuesday. Most teams have never decided who receives that news.

Both are the business of AWS Health. This chapter sorts out what AWS Health tells you, what it does not, and what to do once it has told you. Then it builds a small stack that sends Health events down the same notification path as chapter 19.

The chapter builds on [chapter 19](/en/chapters/19-observability.md). Running a function from an event was covered in [chapter 08](/en/chapters/08-async.md), and the instance that can be retired comes from [chapter 23](/en/chapters/23-ec2.md). The code is in `examples/44-health/`.

## The big picture

<!-- section: 44.overview -->

```figure
caption: A Health event goes from the default event bus of the Region it was delivered to, through a rule, to a function, and on to SNS only when its state has changed
node health: AWS Health
node bus: default event bus | ap-northeast-1
node rules: Rules | source: aws.health
node fn: Lambda | validate, classify, deduplicate
node ledger: DynamoDB table | last state of each event
node topic: SNS topic
node mail: email
node dlq: SQS | dead-letter queue
edge health -> bus: at least once
edge bus -> rules
edge rules -> fn
edge fn -> ledger: read, then conditional write
edge fn -> topic: only on a change of state
edge topic -> mail
edge fn --x dlq: events that failed 3 times
mark fn
```

AWS Health is how AWS sends notices to its customers on behalf of its services. One notice is called a Health event. Looking at them in the console needs no setup, but like the logs at the start of chapter 19, they tell you nothing until you go and look.

The stack in this chapter receives Health events through EventBridge rules, reads them in a function, and sends a short text to an SNS topic. The function does three things. It checks with Valibot that the JSON has the shape the documentation describes, it sorts each event into one of four kinds (ignore, inform, act by a date, incident), and it never announces the same state twice.

The third is needed because a Health event does not arrive exactly once. Delivery is at least once, and while an issue lasts the same event is updated and delivered again and again. Forward them blindly and the same mail piles up, and when two arrive out of order, an issue that is over appears to have started again.

The same stack goes into two Regions, because a rule sees only the events delivered to its own Region. The [next page](/en/chapters/44-health/build.md) explains why. While no event arrives, the stack costs nothing.

## Where to look, and how events reach you

<!-- section: 44.pieces -->

There are two places to see Health information.

One is the Service health page (`https://health.aws.amazon.com/health/status`), which needs neither an account nor a sign-in. It lists the issues AWS has made public, for every service and Region, and holds the history of the last 12 months.

The other is the dashboard of your own account (`https://health.aws.amazon.com/health/home`), which you open signed in. "Your account health" shows the public issues and, in addition, the events that concern your resources. It has four tabs, Open and recent issues, Scheduled changes, Other notifications, and Event log, and the event log keeps the events of the past 90 days.

Events differ in scope. A public event is announced regardless of account and reaches you even if you do not use that service or Region. An account-specific event concerns your own resources and carries the IDs of the resources affected.

Events also differ in content. The documentation names three categories.

- issue: something unexpected, such as a degraded service or a problem with particular resources
- scheduled change: something planned. Instance retirements, maintenance, and the end of support for a runtime or a version belong here. Every event in this category is account-specific
- account notification: a notice about the administration or security of the account and its services. Some only need reading, and some need action urgently

The specification of the events on EventBridge lists a fourth value, `investigation`, without saying what it carries.

These are the routes by which events reach you.

| Route | What arrives | What it needs |
| --- | --- | --- |
| The dashboard | Both public and account-specific events | Someone to sign in and look |
| Mail (managed notifications in AWS User Notifications) | Account-specific events. Public events do not arrive | Nothing: it goes to the account's contacts |
| EventBridge (source `aws.health`) | Both, with the IDs and states of the affected resources | A rule in each Region |
| The AWS Health API | The same information as the dashboard | A paid Support plan |

Since December 15, 2025, the mail has been delivered by managed notifications in AWS User Notifications. It comes from `health@aws.com` and by default goes to the account's contacts (the root user's address and the operations, billing, and security addresses). In the User Notifications console you can choose which categories you receive and add other destinations, chat and push notifications to the mobile app. User Notifications is free of charge.

The point to watch is that **public events do not arrive through managed notifications**. A Lambda issue in the Tokyo Region does not come by mail unless it is tied to your own resources. To receive public events you set up an EventBridge rule or a user-configured notification in User Notifications yourself. This chapter builds the former.

### The Health API and Support plans

The Health API reads, from a program, what the dashboard shows. Using it requires an AWS Business Support+, AWS Enterprise Support, or AWS Unified Operations plan. An account in a Region where those plans are not offered, or one that has not yet transitioned, can use it with one of the earlier Business, Enterprise On-Ramp, or Enterprise plans. A call from an account with none of these returns `SubscriptionRequiredException`. That is what the user guide said on 2026-10-13. On the same day the opening of the API reference named only the three earlier plans, so the two pages do not agree.

A reader with only Basic Support, which every account has, cannot call the Health API. The dashboard, the mail, and EventBridge are still available at no additional cost. The content of an event is the same on every route, so this chapter is built without the API.

As for the price of a Support plan, the cheapest, Business Support+, costs the greater of USD 29 a month per account or 9% of the monthly AWS charges (on the part up to USD 10,000, with lower rates above).

### With several accounts

If you separate accounts with AWS Organizations, turning on organizational view lets you see the Health events of every account in the organization in one place. Viewing it in the console costs nothing extra on any Support plan. It is turned on from the management account.

To keep everyday work out of the management account, the documentation recommends registering a member account as a delegated administrator. Up to five accounts can be registered. With organizational view on, the events of all accounts arrive as one feed on EventBridge in the management account or a delegated administrator account. The stack in this chapter tells events apart by the pair of account ID and event ARN, so that it can be placed in that account as it is. It has not been tried with more than one account.

How to divide accounts in the first place belongs to [chapter 33](/en/chapters/33-production-readiness.md).

## What does not arrive

<!-- section: 44.silence -->

Nothing on Health does not mean nothing wrong at AWS. Three things never come from Health.

The first is a degradation AWS has not yet announced. A Health event is written and published by AWS, and time passes between the start of an issue and its announcement. The documentation gives no upper bound for that time, as far as could be found. A quiet dashboard at the moment your alarm fires does not rule out a problem on AWS's side.

The second is your own quota running out. A 429 because you hit Lambda's concurrency limit is the service working as specified, not an issue. Quotas are covered in [chapter 32](/en/chapters/32-limits.md).

The third is your own misconfiguration. A wrong IAM policy that produces 403s shows up nowhere on Health.

So the first signal remains the alarm from chapter 19. Health is a second opinion, used after the alarm to check whether the problem is yours alone. The absence of a Health event is no reason to doubt the alarm, and the presence of one does not prove that it is the cause of your outage.

## What to do with each kind of event

<!-- section: 44.responses -->

A notice that comes with no decision about what to do stops being read. The function in this chapter writes the next step for each kind on the second line of the notice.

<<< @/examples/44-health/src/message.ts{next-step}

**An issue in a service and Region you use.** First add the ARN and the time of the Health event to the record of the incident in progress. That takes the diagnosis one step further. Next, start no new deploy. A deploy made while AWS is unstable leaves you unable to tell why it failed. With the pipeline from [chapter 20](/en/chapters/20-shipping.md), leave the production approval ungranted. A job that is already running is left to finish, because stopping it leaves the CloudFormation update running on half done. Whether to switch to another Region is decided by criteria you set beforehand, not by the wording of the Health event. Those criteria and the procedure are the subject of [chapter 28](/en/chapters/28-multi-region.md) and [chapter 40](/en/chapters/40-disaster-recovery.md). Health's issue events carry no label saying whether action is needed (actionability). The documentation explains that the action needed depends on how the application is built.

**A scheduled change.** Decide who acts and by when. For an instance retirement, an instance whose root volume is on EBS, like the one in chapter 23, is stopped at the scheduled time. A stopped instance can be started again, and starting it moves it to new hardware. Stopping and starting it yourself, at a convenient time before the date, is all it takes. An instance whose root volume is an instance store is terminated and cannot be brought back. Events for scheduled maintenance are said to arrive about two weeks before the start.

**An account notification.** Make it a ticket with a date. The end of support of a Lambda runtime, for example, is announced at least 180 days ahead to accounts that have functions on that runtime. Something six months away is forgotten unless it is a ticket. Health calls this kind of change a planned lifecycle event and asks you to treat the event's start time as the date of the change. Resources that have been dealt with change from `PENDING` to `RESOLVED`, which can take up to 72 hours to show.

**Abuse and security notices.** These are the most urgent. The abuse report the documentation gives as an example is one where the account may be suspended if you do not act. On EventBridge they arrive as a separate type of event, `AWS Health Abuse Event`, whose content is not documented. The function in this chapter does not drop an event it cannot read. It sends a notice saying that an unreadable event arrived and that the dashboard should be opened. Preparing for abuse itself is in [chapter 21](/en/chapters/21-security.md).

## When you do not need this

For an account one person owns, it is enough to make the account's contact address one that is actually read. Scheduled changes and account notifications arrive there with nothing built. What does not arrive is public events, and putting the Service health page into your incident runbook covers that.

To receive public events too without writing code, there are user-configured notifications in User Notifications. You state the equivalent of an EventBridge rule in the console and send the result to mail or chat. This chapter did not use them because it wanted to decide the deduplication and the classification itself. User Notifications can also aggregate notices, which this chapter did not try.

The other way round, the function here stops being enough when you want the notices to go straight into tickets or an on-call system. Even then the classification and the deduplication stay the same, and only what sits behind the SNS topic changes.
