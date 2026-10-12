---
title: "32 Limits: Deploy"
---

# 32 Limits: Deploy

## Deploy and check

<!-- section: 32.deploy -->

From here on, the steps deploy to AWS and check the limits on the real thing. None of the steps on this page has been run against real AWS yet.

```bash
vp run limits:infra:diff
vp run limits:infra:deploy
```

There are five values you can pass.

<<< @/examples/32-limits/infra/bin/app.ts{context}

Pass nothing, and there is no reserved concurrency, the budget is 5 USD a month with nobody to notify, and the alarm notifies nothing. With everything on, the command looks like this.

```bash
vp run limits:infra:deploy -c reservedConcurrency=5 -c budgetEmail=you@example.com -c alarmTopicArn=<AlarmTopicArn of chapter 19's stack>
```

If a deploy with `reservedConcurrency` is refused with a concurrency error, look at the account's quota.

```bash
vp run limits:quotas --service lambda
```

If the concurrency quota is smaller than 100 plus 5, the 5 cannot be reserved. Deploy without it and leave the braking to the stage throttle.

The email address goes into the template and into cdkd's state. Use a shared address or leave it out.

Once it is deployed, send a few requests to the `ApiUrl` output to see that the API works. Then there are three things worth looking at.

- The stage's settings. Read the stage with `aws apigatewayv2 get-stage` and see that `DefaultRouteSettings` is there, and `POST /notes` under `RouteSettings`
- What a 429 contains. Send about 30 `curl -i` requests within a second and read the headers and body of a 429. If there is a `Retry-After`, the client from [Design and Build](/en/chapters/32-limits/build.md) follows it
- The function's settings. If you passed `-c reservedConcurrency=5`, the function's page in the console should show a concurrency of 5

Thirty `curl` requests are within ordinary checking. A test that keeps raising the rate is not among this chapter's steps, for the reason given at the end of [Run It Locally](/en/chapters/32-limits/local.md).

For cdkd, the source of the pinned version (0.296.28) was read. Every resource type in this stack has a dedicated implementation, the budget (`AWS::Budgets::Budget`) included. The installed package also has the code that handles reserved concurrency and the stage's `DefaultRouteSettings` and `RouteSettings`. None of it has been run.

The drift check is the same as in earlier chapters.

```bash
vp run limits:infra:drift
```

Limit settings tend to get changed in the console in the middle of an incident. Reserved concurrency set to 0 to stop a function, or a stage value raised to let traffic through, has to be put back into the source once things are calm, or found as drift.

## Split cost by tag

<!-- section: 32.allocation -->

With several stacks in one account, the bill shows only a total per service. You can see what Lambda cost, but not which application's Lambda. Tags are the tool for splitting it.

<<< @/examples/32-limits/src/cost.ts{tags}

<<< @/examples/32-limits/infra/lib/limits-stack.ts{tags}

`Tags.of(this).add` puts the same tag on every resource in the stack that can carry one. The tests check that the table, the function, the log group, the API and the stage have the tags.

Tagging by itself changes nothing on the bill. The tag key has to be activated as a cost allocation tag. No template can do that. It is done by hand.

1. Open **Cost allocation tags** in the Billing and Cost Management console
2. Select the `project` key and choose **Activate**

According to the documentation, it can take up to 24 hours after you tag a resource for the key to appear on that page, and up to 24 hours more after you activate it for the activation to take effect. If you delete a practice stack the same day, you never get to see its cost by tag. Also, only the management account of an organization, or a single account that belongs to no organization, can use that page.

Because of the wait, decide your tags before you create the first resource. If you later want to know what an application cost last month, the time during which the tag was not active cannot be split out. The documentation has a page on backfilling tags to earlier months, which was not read for this chapter.

### Totals per tag

Once the key is active, Cost Explorer can show cost per tag. Here the totals come from a script that calls the API.

```bash
vp run limits:cost:print
```

```text
aws ce get-cost-and-usage --time-period Start=2026-10-01,End=2026-10-12 --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=project Type=DIMENSION,Key=SERVICE --region us-east-1
```

<<< @/examples/32-limits/src/cost.ts{args}

The end of the period is exclusive. Today is still being counted, so the script asks for the first of this month up to yesterday.

<<< @/examples/32-limits/src/cost.ts{period}

The task without `:print` really calls the API.

```bash
vp run limits:cost
```

**Every run of this task costs 0.01 USD.** The Cost Explorer API is billed per request. Fetching the next page when the result does not fit in one would be another request, so the script stops after the first page and says so. It was not run for this chapter.

The response is checked against a schema before it is read.

<<< @/examples/32-limits/src/cost.ts{response}

Amounts come back as strings, and they stay strings until they are shown.

<<< @/examples/32-limits/src/cost.ts{breakdown}

The key of a group made by tag joins the key and the value with `$`, as in `project$aih-notes`. With no value it is `project$`. Resources without the tag land there, and so do charges that no tag reaches. The script sets these apart as untagged and prints their total beside the tagged one.

The untagged total will not be 0. Which of this stack's charges carry the tag has not been checked on a bill, but a line such as tax, which belongs to no resource, has no way of carrying one. Start by looking at how much of the whole is untagged, and if it is a lot, look for resources that have no tag.

### A budget filtered by tag

The budget made in chapter 01 watched the whole account's spending. The same mechanism works narrowed to a tag.

<<< @/examples/32-limits/infra/lib/limits-stack.ts{budget}

This budget counts only cost whose `project` is `aih-notes`. It notifies twice: when actual spending passes 80%, and when the forecast for the end of the month passes 100%. Monitoring a budget and being notified by it are not charged for.

Three cautions about the budget. First, a budget tells you and stops nothing. What stops spending is the brakes on the [previous page](/en/chapters/32-limits/build.md). Second, until the tag is active, this budget counts nothing. Third, the form of the tag key in `FilterExpression` has not been confirmed. It is written `project`, following the CDK's types, but in billing reports a user-defined tag carries the prefix `user:`. Which of the two a budget's filter wants could not be read from the documentation. After a deploy, open the budget's filter in the console and check.
