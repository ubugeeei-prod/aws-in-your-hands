---
title: "33 Production Readiness: The Review Before You Ship"
sourceRevision: 1
---

# 33 Production Readiness: The Review Before You Ship

Every chapter so far ended with a short list headed "If you take this to production" and moved on. The tables still have `RemovalPolicy.DESTROY`, the alarm thresholds are still practice values, and there is still one account. This chapter takes on those lists together.

It asks what has to be true before the notes application, grown since chapter 04, is opened to real users and real data. It is not a list of recommended settings. Each item says what goes wrong without it, how to check it, and which chapter does the work.

There is one runnable part. A check reads synthesized templates (the `*.template.json` files in `cdk.out`) and finds a public bucket, a policy with `*`, a log group with no retention, a table whose past cannot be restored, a function with no alarm, and data that goes away with its stack. The chapter shows what it reports for every stack in this book. They are practice stacks, so it reports a lot.

This chapter deploys nothing to AWS. The check reads templates only and never looks at the real state of an account. What the check cannot see has a section of its own at the end of [the page on running it locally](/en/chapters/33-production-readiness/local.md).

You need [chapter 19](/en/chapters/19-observability.md), [chapter 20](/en/chapters/20-shipping.md), [chapter 21](/en/chapters/21-security.md), and [chapter 22](/en/chapters/22-recovery.md). The other chapters appear as the places the items point to. The code is in `examples/33-production-readiness/`.

## The whole picture

<!-- section: 33.overview -->

The review has 8 areas and 32 items.

```text
area        items  what it asks
accounts    3      which account is production, and who can do what in it
identity    3      what running code may do, and how people and CI sign in
data        6      what survives an accident, a stack deletion, and a user's request to delete
failure     5      who finds out, how fast, and what they do next
change      4      how a change gets in, and how it gets out again
cost        4      what a quiet month costs, and what bounds a loud one
abuse       3      what stands in front of every public entry
operations  4      who is on call, what is written down, what was rehearsed
```

The items are kept as data in the code. This task prints them as a checklist.

```bash
vp run ready:review
```

An item is checked in one of three ways.

```figure
caption: An item of the review is checked by reading templates, by a task that reads the account, or by asking a person
node review: Review items | 8 areas, 32 items
node template: ready:check | reads synthesized templates
node tasks: Chapter tasks | sec:posture, recovery:status, obs:alarms
node person: A person | on call, restore drill, RTO and RPO
node cdkout: cdk.out | *.template.json, no AWS call
node account: AWS account | real settings and records
edge review -> template: part of 10 items
edge review -> tasks: 13 items
edge review -> person: all 32 items
edge template -> cdkout: reads
edge tasks -> account: reads, some change it
mark review
```

The first is the check that reads templates. This chapter builds it, and it runs on your machine before any deploy. It sees what is written in a template and nothing else.

The second is a task that reads the account. Whether the root user has MFA, from when to when a table can be restored, and what state an alarm is in are not written in any template. Earlier chapters provide tasks for these. This chapter ran none of them.

The third is a question only a person can answer. Who is on call this week, when a restore was last tried, who agreed to the RTO. Every one of the 32 items ends with a question of this kind. If the template check passes and a question is left without an answer, you are not ready.

## How an item is written

<!-- section: 33.item -->

One item has this shape.

<<< @/examples/33-production-readiness/src/review.ts{item}

`must` is what has to be true, and `without` is what happens when it is not. `chapters` lists the chapters that do the work, `rules` the rules of the template check, `tasks` the tasks that look at the account, and `ask` the question for a person.

`without` is required because an item nobody understands stops being followed. An item that says only "set a log retention" is skipped on a busy day. One that says "without it, data a user asked you to delete stays in the logs for years" lets you judge for yourself whether it can be skipped.

Because the items are data, tests can check that the list has not drifted from the code. Every rule of the check is placed under some item, and every task an item names exists in `vite.config.ts`. If either stops being true, a test fails.

AWS already has something with the same purpose. The Well-Architected Framework reviews a design under six pillars: operational excellence, security, reliability, performance efficiency, cost optimization, and sustainability. Within it, OPS07-BP02 calls the review of whether you can operate a workload before launch an operational readiness review (ORR), and describes it as a review that uses a checklist of requirements. According to the AWS documentation, AWS built the ORR from the lessons of its own incidents, and the items are meant to grow out of your own post-incident analysis.

The 32 items of this chapter are that ORR, written for this book's application. Where an item says the same thing as Well-Architected, [the deploy page](/en/chapters/33-production-readiness/deploy.md) names the pillar and the number. It does not copy the content. Well-Architected is far wider, and some pillars are not touched here: [chapter 29](/en/chapters/29-lambda-tuning.md) is the nearest to performance efficiency, and this book does not cover sustainability.

## Not all at once

<!-- section: 33.stages -->

You do not have to satisfy all 32 items before the first user arrives. [Chapter 21](/en/chapters/21-security.md) split its protections into three tiers, and the items differ in the same way in when they start to matter.

A practice account that only you use needs MFA on the root user, no access keys, and a budget notification. Chapter 01 did those. At this stage it is convenient that data disappears with its stack, and most of what the template check reports is not something to fix.

That changes on the day you hold someone else's data. Now there is something you cannot afford to lose, so the data items come first: it can be restored, it does not go away with a stack, it is not public. Next comes noticing that the service is down, which is the alarms and their recipient in the failure area.

Once you take money, or once someone's work stops when the service does, you need the rest: separate accounts, gradual rollouts, on-call and drills.

This order is this book's judgment, and you may reorder it to fit your situation. What matters is the same as in chapter 21: for an item you have not done, you can say that you chose to postpone it and did not forget it. That is why the template check has waivers that carry a reason.

Sometimes the review is not needed at all. A prototype you will throw away in a few days, or an internal tool nobody misses when it is down, needs no on-call and no drills. Even then, look at the first three items of the data area, because real data ends up in prototype buckets all the time.

## If you come from Workers or Vercel

<!-- section: 33.platforms -->

The items of this chapter are of two kinds: those specific to AWS, and those that stay the same wherever the code runs.

The template check looks almost entirely at the first kind. A role per function, the retention of a log group, `DeletionPolicy`, and the public access settings of a bucket are settings you make one by one on AWS, and a setting you forget takes its default. The default is not always the safe one. A log group with no retention keeps its logs for ever.

On Cloudflare and Vercel the platform decides many settings of this kind. Workers Logs, for example, keeps logs for at most 7 days (checked on 2026-10-12), so what you decide is not the number of days but what to do when you need more than 7. Fewer decisions mean fewer forgotten ones. In exchange, when the platform's value does not fit your requirement, you add something that moves the data elsewhere.

Vercel publishes a pre-launch checklist in its documentation (checked on 2026-10-12). Its areas are operational excellence, security, reliability, performance efficiency, and cost optimization, and its items include an incident response plan with rollback steps, a WAF, rate limiting, team roles, Log Drains to keep logs, and spend notifications. It overlaps this chapter's areas well. Some items, such as audit logs and load testing, are marked as Enterprise only. Whether Cloudflare publishes a list of the same kind was not confirmed.

What stays the same everywhere is the questions for a person. Who is on call, whether a restore was tried, how many hours the RTO and RPO are, where you delete when a user asks for their data to be removed. A platform can take over settings. It cannot take over these answers.

If the values your current platform chose meet your requirements, and you can answer the questions, you are ready as you are. Moving to AWS gives you more to decide. Each decision can be fitted to your requirement, and where no fitting is needed, the added settings are only more things to forget.

The next page builds the check that reads templates.

- [Design and Build](/en/chapters/33-production-readiness/build.md): reading a template, the 10 rules, waivers with a reason, and a stack with production settings applied
- [Run It Locally](/en/chapters/33-production-readiness/local.md): the tests, the result for every stack in the book, and what the check cannot see
- [Deploy](/en/chapters/33-production-readiness/deploy.md): the review before a production account, area by area
- [Costs, Pitfalls, and Cleanup](/en/chapters/33-production-readiness/wrap.md): what being ready costs, where it goes wrong, and the verification notes
