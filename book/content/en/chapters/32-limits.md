---
title: "32 Limits: Quotas, Throttling, Retries, Load Tests, and Cost Breakdown"
sourceRevision: 1
---

# 32 Limits: Quotas, Throttling, Retries, Load Tests, and Cost Breakdown

Since chapter 04, every API in this book has had a throttle of 10 requests a second. You put that limit there. AWS has limits of its own that you never asked for. How many copies of a function Lambda runs at once, how many requests a second API Gateway accepts, and how much a table reads and writes per second are all set per account, and whatever goes past them is refused.

This chapter looks at limits from three sides. The first is where the limits are, how you look them up, and how you ask for more. The second is how the refused side should behave. Retries can make an outage worse depending on how they are written, so you reproduce that with seeded simulations, then hold it down with the way a client waits and with a budget on the total number of retries. The third is cost: when traffic runs up against the limits, you want to see which application the bill belongs to.

The subject is the notes API from [chapter 05](/en/chapters/05-dynamodb.md). The application code is unchanged. This chapter owns only the settings of the DynamoDB client and the stack around the API. You need [chapter 04](/en/chapters/04-http-api.md), [chapter 14](/en/chapters/14-kv-cache.md) and [chapter 19](/en/chapters/19-observability.md) first. The code is in `examples/32-limits/`.

## The big picture

<!-- section: 32.overview -->

```figure
caption: The limits a request passes before it reaches the function. Each number is a default or a value this chapter's stack chose
node client: Client | retries, backoff, budget
node account: API Gateway account limit | 10,000 req/s, all APIs together
node stage: Stage throttle | 10 req/s, POST /notes 2 req/s
node concurrency: Lambda concurrency | 1,000 per account, reserving is optional
node fn: Lambda | The app from chapter 05
node table: DynamoDB table | 150 read, 40 write units/s
edge client -> account: HTTPS
edge account -> stage
edge stage -> concurrency
edge concurrency -> fn
edge fn -> table: the SDK tries up to 3 times
edge stage --x client: 429
group aws: AWS account = account, stage, concurrency, fn, table
mark stage
```

```figure
caption: A tag shows up in cost data only after its key has been activated for billing
direction: right
node stack: AihLimits stack | project = aih-notes
node billing: Billing data | cost allocation tags
node explorer: Cost Explorer | by tag and service
node budget: Budget | monthly, for one tag
edge stack --> billing: usage and tags
edge billing -> explorer
edge billing -> budget
```

There are two kinds of limit, and they differ in who set them.

One kind is set by AWS and is called a quota. A service is shared by many customers, so each account gets a fixed share from the start. The Lambda documentation describes these as guardrails that protect your account and the workloads of other customers. Their size has nothing to do with what suits you.

The other kind is the limit you set yourself: the stage throttle, reserved concurrency, the request unit ceiling on the table, the rate limiter from chapter 14, and the 100 notes of chapter 05. These protect your bill and the resources of yours that sit behind the API. You place them far below the quotas, so in ordinary use they are the ones you meet first.

The two refuse in the same way, but what you do next differs. When you reach a quota, you change the design or request an increase. When you reach a limit of your own, you check whether its number still fits how the service is used. In both cases the caller has to be written on the assumption that it will sometimes be refused.

### This chapter's stack

The stack has nearly the same shape as chapter 19's: a table, a function and an HTTP API. What is new is a stricter throttle on the one route that writes, reserved concurrency that you can switch on, an alarm for when Lambda refuses the function, tags on every resource, and a budget filtered by one of those tags.

<<< @/examples/32-limits/infra/lib/limits-stack.ts{bounds}

Every number here is one you chose. The end of [Design and Build](/en/chapters/32-limits/build.md) works out which of them, or which quota behind them, takes effect first.

## Quotas

<!-- section: 32.quotas -->

Quotas are listed in Service Quotas. Choose a service in the console and you see its quotas, with a column that says whether each is adjustable. A quota has two values: the default value is what AWS set to begin with, and the applied quota is what holds for your account after an increase. The documentation lists defaults, so you do not know your own account's values until you look.

A new account can start below the defaults. The Lambda documentation says that new accounts have reduced concurrency and memory quotas, and that AWS raises them automatically based on usage. It does not say how far they are reduced.

The defaults this book's chapters lean on are collected in one file, each with its source.

```bash
vp run limits:quotas:book
```

```text
Lambda: Concurrent executions
  default 1,000 per Region (adjustable)
  chapters 04, 09, 17, 21, 29; read 2026-10-12, source "limits-lambda-quotas"
Lambda: Concurrency that must stay unreserved
  default 100 (fixed)
  chapters 09, 17, 21; read 2026-10-12, source "limits-lambda-reserved-concurrency"
Lambda: Function timeout
  default 900 seconds (fixed)
```

As a table, with the values as read on October 12, 2026. They can change.

| Service | Quota | Default | Adjustable | Chapters that lean on it |
| --- | --- | --- | --- | --- |
| Lambda | Concurrent executions (per Region, all functions together) | 1,000 | Yes | 04, 09, 17, 21, 29 |
| Lambda | Concurrency that must stay unreserved | 100 | No | 09, 17, 21 |
| Lambda | Function timeout | 900 seconds | No | 08, 12, 16, 23 |
| Lambda | Payload of a synchronous invocation | 6 MB each for request and response | No | 07, 09 |
| API Gateway | Account throttle (per Region, all APIs together) | 10,000 requests a second, with a bucket of 5,000 | Yes | 04, 05, 06, 13, 14, 19 |
| API Gateway | Integration timeout of an HTTP API | 30 seconds | No | 12 |
| DynamoDB | Throughput of one on-demand table | 40,000 units a second each for reads and writes | Yes | 05, 08, 19 |

The second row is why chapters 09, 17 and 21 warned that a deploy with reserved concurrency can be refused in a new account. You can reserve up to the account's concurrency minus 100. The remaining 100 are kept for functions that have no reservation. An account whose concurrency quota has been reduced to 100 or less therefore cannot reserve anything.

The SES sandbox in chapter 15, the size of a Step Functions payload in chapter 16, the per-model limits of Bedrock in chapter 17 and the concurrent viewers of IVS in chapter 18 are quotas too. Each of those chapters cites its own source, and they were not read again here.

To see the values of your own account, name a service.

```bash
vp run limits:quotas --service lambda
vp run limits:quotas --service apigateway
```

The task calls `aws service-quotas list-service-quotas`, checks the list that comes back against the schema below, and prints the adjustable quotas first. It was not run for this chapter.

<<< @/examples/32-limits/src/quotas.ts{listed}

`--service` takes the service code that Service Quotas uses. `lambda` and `apigateway` were confirmed from the console URLs in the documentation. For any other service, `aws service-quotas list-services` prints the codes.

### Requesting an increase

To request an increase, choose the quota in the console, or give `aws service-quotas request-service-quota-increase` the service code, the quota code and the value you want. For API Gateway's account throttle the code is `L-8A5B8E43`.

The documentation says this much about requests. Smaller increases are usually approved automatically, and larger ones go to Support, where review and deployment take time. A request can be approved, denied, or partially approved. Quota increase requests do not receive priority support.

Hurrying does not make it faster, so ask before you run short. Ahead of a large broadcast or a campaign, work out the value you need from the traffic you expect and request it with time to spare. [The first limit you reach](/en/chapters/32-limits/build.md) shows how to work that value out.

No request was made for this chapter either, so how long approval really takes is not known here.

## When you do not need this chapter

The caller's side of the story, how to wait after a 429 and how to budget retries, is useful on any platform. It applies as it stands to code on Cloudflare Workers that calls somebody else's API.

Looking up quotas and breaking down cost are for people who run an AWS account. If your application fits on Workers or Vercel and you hold no AWS resources, you can skip those two. Those platforms have limits as well, but fewer, and most are decided by the plan. The [last page](/en/chapters/32-limits/wrap.md) sets the differences side by side.
