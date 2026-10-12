---
title: "33 Production Readiness: Deploy"
---

# 33 Production Readiness: Deploy

This chapter has no stack to deploy. This page is about what to check before the stacks of the other chapters go to a production account. It goes through the 8 areas of [the overview](/en/chapters/33-production-readiness.md) in order.

For each item it says what goes wrong without it, how to check it, and which chapter does the work. The part a template check can see was covered up to [the previous page](/en/chapters/33-production-readiness/local.md), so this page is mostly about tasks that read the account and questions for a person. None of the tasks shown here was run for this chapter. Chapters from 25 onward are named by the scope each of them covers and nothing more.

The same list can be read with `vp run ready:review`.

## Accounts and environments

<!-- section: 33.accounts -->

The first thing to settle is which account is production, and who can do what in it. While that is vague, one mistake by one person with strong permissions undoes everything in the other areas. The security pillar of Well-Architected lists it as SEC01-BP01 (separate workloads using accounts), and describes the account boundary as a strong boundary for security, billing, and access.

### An account for production only

Every stack in this book went into one account. [Chapter 20](/en/chapters/20-shipping.md) separated stacks by environment, and as long as they share an account, only their names are separate. One wrong letter in the target of a command that destroys a practice stack reaches the production table. A role that is too wide reaches all the data in the account as well.

The check is whether you can state the ID of the production account. Every task in this book shows the target account before it touches AWS, and stops if it differs from `AIH_AWS_ACCOUNT_ID` in `.env`.

```bash
vp run account:whoami
```

Adding accounts and joining them in an organization is in ["Once you are an organization" in chapter 21](/en/chapters/21-security/more.md). AWS also publishes a whitepaper on organizing an environment with multiple accounts. This book read only its opening and did not try the structure it recommends.

### The root user

If the root user's password leaks, the account, its bill, and the backups in it belong to someone else. Give it MFA, create no access keys for it, and do not use it for daily work. [Chapter 01](/en/chapters/01-account.md) did this, and each account you add has a root user of its own.

```bash
vp run sec:posture
```

This task from chapter 21 fails when the root user has no MFA or has an access key. What it cannot answer is where the MFA device is and who else can use it.

### A record that cannot be erased

The first thing someone who has taken over an administrator role does is erase the record of what they did. Make stopping the CloudTrail trail impossible from inside the production account. The tool is an SCP of AWS Organizations, and chapter 21 has the policy JSON and its tests. As chapter 21 says, it was never attached to a real organization. The item shows up in no template and no task, so the check is whether you can say which SCPs apply to this account.

## Identity and least privilege

<!-- section: 33.identity -->

This area corresponds to SEC03-BP02 (grant least privilege access) in the security pillar.

### What running code may do

When the role of a function that handles requests from the internet contains `*`, one hole in that function is a hole in everything the `*` covers. This is what `iam-wildcard` in the template check looks at. Underneath it is the lint of [chapter 21](/en/chapters/21-security/build.md), which wants a reason for each action that keeps `*`.

The permissions of people appear in no template. After deploys moved to the CI role (chapter 20), you should be able to say who still has administrator access and for which task. SEC03-BP02 describes, as the outcome to aim for, developers who are given access to production only for the duration of a task and lose it afterwards.

### Keys that never expire

An access key is a secret with no expiry. A key left in a laptop backup or a CI log works until someone notices. This book uses `aws login` from chapter 01 for people and OIDC from chapter 20 for CI, and creates no access key at all. The check is whether any IAM user still has an access key, and what uses it. This book has no task that lists them.

### The caller

[Chapter 06](/en/chapters/06-auth.md) confirms the caller on every route of the API, and pins with tests that a user reaches only their own notes. If that breaks, guessing one ID returns someone else's notes. It is a property of the application code and is almost invisible in a template. The only part the check sees is the `AuthType` of a function URL.

A feature added later can break the same invariant by another path. Search is the typical case. That a search never returns another owner's note is the subject of [chapter 27](/en/chapters/27-search.md). The question for a person is which routes are open without authentication, and what they return.

## Data

<!-- section: 33.data -->

The reliability pillar has REL09-BP04 (perform periodic recovery of the data to verify backup integrity and processes). The anti-patterns on that page include assuming that a backup exists, and restoring a backup without reading any data from it to check.

### Try a restore once

Turning PITR on does not tell you whether you can restore. Whether someone knows how, how many minutes it takes, and whether the application can be pointed at the restored table are unknown until you do it. If the first restore happens during a production incident, it is done while reading the manual.

[Chapter 22](/en/chapters/22-recovery.md) provides the steps of a drill, the tasks, and a file to record it in.

```bash
vp run recovery:status
vp run recovery:drill new first
```

`table-pitr` in the template check sees only whether the setting is there. As chapter 22 also says, the author of this book has never run a restore against AWS. This item is therefore not yet satisfied for this book's own application.

### It does not go away with the stack

This is the item the `stateful-delete` rule looks at. Deleting a stack, or an update that replaces a resource, deletes data. Chapter 22's stack gets `RETAIN` and deletion protection with `-c protect=on`, and this chapter's aspect applies the same settings to a whole stack.

`Retain` has a price. According to the CloudFormation documentation, a retained resource continues to exist after the stack is deleted, and continues to be charged for. Removing it is done by hand. The question for a person is which stacks hold data, and who may delete them.

### It is not public

This is the item the `bucket-public` rule looks at. Since [chapter 03](/en/chapters/03-spa.md) the buckets of this book have blocked public access, and the only ways to read them are CloudFront and presigned URLs ([chapter 07](/en/chapters/07-uploads.md)). What a template does not show is the account-wide block public access setting.

### Retention and deletion

Keeping data too long is a problem as well. Write down where a user's data remains after they delete their account, and until when. For this book's application there are at least these places.

- Items in the table. After a delete they can be restored for up to 35 days while PITR is on (chapter 22)
- Objects in the bucket. With versioning on, older versions remain after a delete. Chapter 22's stack removes them after 30 days
- Logs. They remain for the retention period. [Chapter 19](/en/chapters/19-observability/more.md) decides what is never written to them
- Copies of events sent off for analysis (the scope of [chapter 26](/en/chapters/26-analytics.md)), and the search index (the scope of [chapter 27](/en/chapters/27-search.md))

The template check sees only whether a log group has a retention written. Whether the number of days matches what you promised is for a person to decide.

### The Regions that hold data

Adding replication, as [chapter 28](/en/chapters/28-multi-region.md) does, adds places where data is kept. The cross-Region inference settings that [chapter 36](/en/chapters/36-bedrock.md) covers do the same for the Regions where requests are processed. If your terms or contracts promise that data stays in Japan, be able to name the Regions that hold a copy and the Regions that process.

### Who owns the key

That data is encrypted at rest says nothing about who can read it. What matters is which key encrypts it and who may use that key. Whether some of your data needs a key you manage and can disable is decided with the section "Who owns the key" in chapter 21.

## Failure

<!-- section: 33.failure -->

### Finding out, and being told

Without an alarm, the first to tell you the service is down is a user. With an alarm and nobody at the other end, it is the same. `function-alarm` and `alarm-recipient` in the template check look at these two.

[Chapter 19](/en/chapters/19-observability.md) built alarms on symptoms and a place for them to notify. After a deploy, this task reads their state.

```bash
vp run obs:alarms
```

What the task cannot know either is whether a notification arrives. An email subscription stays pending until the link in the confirmation mail is clicked. The question for a person is who received the last test notification, and on which device.

### Work that keeps failing

A message that can never be processed is retried until it expires and then is gone without a trace, unless it has somewhere to go. The queue of [chapter 08](/en/chapters/08-async.md) has a dead-letter queue, and the `queue-dlq` rule looks at it. Retries and a dead-letter queue per target of an event bus are the scope of [chapter 25](/en/chapters/25-events.md).

A dead-letter queue solves nothing by existing. It is useful once it is decided who looks at what collects there, and what they do with it.

### RTO and RPO

RTO is how long the service may be down before it is back. RPO is how much time's worth of data may be lost. REL13-BP01 in the reliability pillar asks for both to be set for every workload, and lists as anti-patterns arbitrary numbers and unrealistic ones such as zero.

Without the numbers, nobody can judge during an incident whether two hours of downtime is acceptable. Chapter 22's drill is how you measure whether you meet them. The numbers for a whole Region being down are the scope of [chapter 28](/en/chapters/28-multi-region.md).

### The first limit you reach

Every service has limits per account. When users grow, or retries pile up, the service stops at a line nobody had looked up. This is REL01-BP01 (aware of service quotas and constraints).

How to look limits up, and how to retry when refused, is the scope of [chapter 32](/en/chapters/32-limits.md). Function concurrency and timeouts are the scope of [chapter 29](/en/chapters/29-lambda-tuning.md). When functions run on your own EC2 capacity, as in [chapter 35](/en/chapters/35-lambda-managed-instances.md), the limit on capacity is a value you set. The question for a person is which limit is closest, and how long an increase takes.

### Runbooks

The person paged at night starts by finding out what the alarm means. OPS10-BP02 in the operational excellence pillar asks for a defined response to every alert. A runbook, in the words of OPS07-BP03, is a documented process to achieve a specific outcome.

Chapter 19 suggested writing, in the description of an alarm, the dashboard and the query to open first. The text of a query can be printed without touching AWS.

```bash
vp run obs:query:print --name errors
```

Whether a runbook works is unknown until someone other than its author has followed it once.

## Change

<!-- section: 33.change -->

### Only the pipeline changes production

While production can be deployed from a laptop, what runs there stops matching any commit, and during an incident nobody can say what changed. [Chapter 20](/en/chapters/20-shipping.md) built the path: a reviewed commit, deployed by the CI role, through CloudFormation.

cdkd, which this book uses for its everyday deploys, is described by its own documentation as a tool for development and testing. Why the production path is the AWS CDK CLI and CloudFormation is explained in [chapter 02](/en/chapters/02-toolchain.md) and chapter 20.

```bash
vp run ship:cfn:diff
```

### What comes back, and what does not

A rollback brings back code and configuration. The data the new code wrote stays. If that data is in a shape the old code cannot read, things are more broken after the rollback than before. OPS06-BP01 in the operational excellence pillar asks for a plan for an unsuccessful change before the change is made.

Chapter 20's [deploy page](/en/chapters/20-shipping/deploy.md) has the steps for changing a schema "in an order old code survives". The time during which old and new containers run side by side is in [chapter 12](/en/chapters/12-containers.md), SQL schemas are in [chapter 13](/en/chapters/13-sql.md), and moving DynamoDB keys without downtime is the scope of [chapter 30](/en/chapters/30-data-modeling.md). The question for a person is whether the previous version can run against today's data.

### A few requests first

Released to everyone at once, a bug reaches everyone at once. OPS06-BP03 lists feature flags, canaries, traffic splitting, and blue/green among the safe ways to deploy.

Chapter 20 wrote that shifting traffic gradually with nothing connected to an error-rate alarm to stop it only delays noticing, and left it out. [Chapter 31](/en/chapters/31-progressive-delivery.md) continues from there. The check is which alarm stops a rollout, and whether it has ever stopped one.

### Changes made by hand

A setting fixed in the console at night is undone by the next deploy. Run drift detection on a schedule and send the result where a person reads it.

```bash
vp run ship:cfn:drift
```

As chapter 20 warns, a scheduled run can stop running. Do not rely on a failure notification alone. Check who read the last report.

## Cost

<!-- section: 33.cost -->

COST01-BP03 (establish cloud budgets and forecasts) in the cost optimization pillar asks for budgeting that follows costs which vary by the month, the day, and the hour.

### The budget notification

The budget from [chapter 01](/en/chapters/01-account.md) is a notification, not a cap. It is updated at most three times a day, and by the time the mail arrives the threshold may already be behind you. It is still far better than nothing: without it, you find out about overspending from next month's invoice.

The check is who the notification reaches and what that person does when it arrives. Budgets per environment or per feature connect to the tags of [chapter 32](/en/chapters/32-limits.md).

### The bill of a month in which nothing happens

Resources billed by the hour cost money at zero requests. In this book these were the NAT gateway and interface endpoints ([chapter 11](/en/chapters/11-network.md)), the ALB and containers ([chapter 12](/en/chapters/12-containers.md)), the database if you chose RDS or Aurora ([chapter 13](/en/chapters/13-sql.md)), ElastiCache when `-c store=valkey` is given ([chapter 14](/en/chapters/14-kv-cache.md)), and EC2 instances ([chapter 23](/en/chapters/23-ec2.md)). The later chapters have more of the same kind: the search backend ([chapter 27](/en/chapters/27-search.md)), the EKS control plane ([chapter 34](/en/chapters/34-eks.md)), EC2 capacity for functions ([chapter 35](/en/chapters/35-lambda-managed-instances.md)), and provisioned concurrency ([chapter 29](/en/chapters/29-lambda-tuning.md)).

Each chapter's cost section has an amount for "when not in use". Once the production setup is decided, add up what a month with no users costs in that setup. What the production settings themselves add is calculated on [the last page](/en/chapters/33-production-readiness/wrap.md).

### The breakdown

When the invoice doubles, you should be able to say which part grew. Tagging, activating tags for billing, and grouping by tag are the scope of chapter 32.

### What one caller can spend

One script in a loop, or one user who keeps sending long prompts, can decide the month's bill. This book put a brake on every public entry within its own chapter: API throttling ([chapter 04](/en/chapters/04-http-api.md)), a rate limit per user ([chapter 14](/en/chapters/14-kv-cache.md)), and an input limit with reserved concurrency ([chapter 17](/en/chapters/17-ai.md)). Token budgets per user are the scope of [chapter 36](/en/chapters/36-bedrock.md), and a cap on what a query may scan is the scope of [chapter 26](/en/chapters/26-analytics.md).

`api-throttle` in the template check sees whether an HTTP API stage has limits written. It does not judge the values. The question for a person is the most one user can make you spend in a day.

## Abuse and security

<!-- section: 33.abuse -->

### A brake at every entry

Check that every public entry has some brake in front of it. It matters just as much that the brake cannot be bypassed. A WAF in front of CloudFront does nothing if the function URL behind it can be called directly. [Chapter 09](/en/chapters/09-ssr.md) and chapter 21 set the function URL to `AWS_IAM` so that only CloudFront can call it, and the `function-url-auth` rule looks at that.

Which entries can carry a WAF and which cannot is in [chapter 21's continued build page](/en/chapters/21-security/more.md). A web ACL cannot be attached to an HTTP API directly, so there the brakes are throttling and the application's rate limit. API Gateway throttling and usage plans are the scope of chapter 32. Brakes on what goes into a model and what comes out are the scope of chapter 36.

### Secrets

Chapter 21 moved secrets out of environment variables and out of the repository. What remains is whether a replacement was ever tried. A leaked key stays valid until it is replaced. If the procedure was never run, the first run is on the day of the leak.

```bash
vp run sec:secret:versions
vp run sec:secret:rotate
```

The second task writes a new version of the secret. It changes AWS.

### Records and detection

The question "who did this, and when" usually comes up after the record is gone. CloudTrail's event history covers 90 days, and nothing older exists unless you created a trail. A detector such as GuardDuty, once enabled, is watched by nobody unless you arrange it.

```bash
vp run sec:posture
vp run sec:trail:iam
```

These two tasks from chapter 21 only read. They show what is enabled and who changed IAM recently. The question for a person is where findings go, and who looked at the last one.

## Operations

<!-- section: 33.operations -->

From here on, nothing appears in a template or a task. This area is the core of what OPS07-BP02 in the operational excellence pillar means by a review before launch.

### On call

Check that a reachable person is named for every hour the service promises to be up. Chapter 19's alarms arrive as mail, and mail is not read until Monday morning. Connecting the notification to chat or to an on-call system, and deciding who covers when that person is away, is work outside this book.

If you operate alone, the true answer may be "nobody watches at night". Sometimes that is fine. What matters is to put that answer next to the RTO. If the RTO is one hour and nobody watches at night, one of the two is false.

### Incident notes

After every incident, write down what happened, when it was noticed, what was done, and what will change. Without the note, when the same incident comes back, the investigation starts from the beginning. In the operational excellence pillar this is OPS11-BP02 (perform post-incident analysis).

The drill record of chapter 22 (`examples/22-recovery/drill/TEMPLATE.md`) is filled in time by time, and works as a form for incident notes as it is.

The notes are also what this review grows from. OPS07-BP02 says that your own post-incident analysis should drive the evolution of your own ORR. After each incident, consider whether `src/review.ts` needs one more item.

### Drills

Cause a failure on purpose, and find out whether the procedures, the access, and the alarms actually work. Well-Architected calls this a game day, and REL12-BP05 in the reliability pillar recommends holding them regularly with the same people who would handle a real event.

Chapter 22's drill is one form of it: delete data, restore it, record how long it took. A drill for a Region failure is the scope of [chapter 28](/en/chapters/28-multi-region.md). What a drill usually finds is not a mistake in the runbook but an assumption the runbook never stated: the person on call lacked a permission, or the notification went to the address of someone who had left.

### The day support ends

Runtimes, database engines, and clusters have a day on which support ends. With no owner, the upgrade is forced on a date you did not choose. Cluster versions and their support windows are the scope of [chapter 34](/en/chapters/34-eks.md). For Lambda runtimes, every stack in this book uses `nodejs24.x`, and this chapter did not look up when its support ends.

The next page covers what the production settings cost, where things go wrong, cleanup, and the verification notes.
