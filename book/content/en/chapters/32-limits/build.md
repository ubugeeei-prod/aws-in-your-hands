---
title: "32 Limits: Design and Build"
---

# 32 Limits: Design and Build

The [previous page](/en/chapters/32-limits.md) showed where the limits are and how to look up a quota. This page builds, in order, the way the refusing side counts, the way the refused side waits, how retries make an outage worse and what holds that down, and the brakes you set yourself.

## How the refusing side counts

<!-- section: 32.bucket -->

According to the API Gateway documentation, throttling counts with a token bucket. Tokens build up in the bucket at a fixed rate, and each request spends one. With no token left, the request is refused. There are two settings: the rate at which tokens build up, and the burst, which is the most the bucket holds.

<<< @/examples/32-limits/src/token-bucket.ts{bucket}

The rate decides the speed that can be kept up forever. The burst decides how many requests can arrive at once after a quiet spell. With a rate of 10 and a burst of 20, twenty requests pass together after nobody has called for a while, and from then on only ten a second do. The tests check that 20 of 50 simultaneous requests pass, that 100 requests a second for the next 3 seconds let 30 through, and that the bucket never holds more than the burst however long you wait.

Tokens are kept as whole thousandths. Added up as fractions, ten times 0.1 does not make 1, and a request that should pass is refused.

This function is not what runs inside API Gateway. It is the same way of counting, written so that it runs on a laptop. The documentation says throttles are applied on a best-effort basis and should be thought of as targets rather than guaranteed request ceilings. The real thing sometimes lets a little more through than the setting.

On the development server this function stands in for the stage throttle, in front of the application.

<<< @/examples/32-limits/src/throttle.ts{stage}

There is one bucket for everybody. It does not look at who is calling, so when one caller empties it, everyone else gets a 429. A test checks that after one address has sent 50 requests, the first request from another address is refused.

The body of the 429 is this file's own. What API Gateway really sends, and whether it adds a `Retry-After` header, could not be read from the documentation. The stand-in sends no such header.

The limit per caller is chapter 14's rate limiter, used as it is.

<<< @/examples/32-limits/src/throttle.ts{caller}

Chapter 14's limiter counts in windows, so it knows when the caller can pass again and says so in `retry-after`. That header is how you tell the two kinds of 429 apart.

## How the refused side waits

<!-- section: 32.retry -->

A 429 is not a failure. It is an answer: not now, come back later. The caller has three things to decide: whether the request may be sent again, how long to wait, and when to give up.

First, whether to send it again.

<<< @/examples/32-limits/src/retry.ts{retryable}

A 429 was refused before any work began, so it can be sent again whatever the method. A 503 or a 504 is different. The work may have been done, with only the answer lost. Send `POST /notes` again after a 503 and you can end up with two notes. So 502, 503 and 504 are retried only for methods that give the same result when repeated. A 500 is not retried: in this application it usually means a defect that waiting does not fix.

"A 429 means nothing was done" holds for this chapter's stack, because both the stage throttle and chapter 14's limiter refuse before the application runs. Whether another service's 429 means the same is for that service's documentation to say.

Next, how long to wait.

<<< @/examples/32-limits/src/backoff.ts{backoff}

The ceiling of the wait doubles with every retry. This is exponential backoff. The longer the other side takes to recover, the further apart the attempts fall. The ceiling itself is capped by `capMs`.

`jitter` says whether to mix randomness into the wait. With `"full"`, the wait is anywhere from 0 up to the ceiling. The simulation in the next section shows why you want it. The AWS SDK computes its waits with the same formula.

When the server names a wait in `Retry-After`, that becomes the floor.

<<< @/examples/32-limits/src/retry.ts{retry-after}

The header is text from outside, so only a number of seconds or an HTTP date is accepted. Left to `Date.parse`, a value such as `-1` would be read as a date.

Put together, it looks like this.

<<< @/examples/32-limits/src/retry.ts{send}

The wait is the longer of the client's own backoff and what the server asked for, because the server is the one that knows when room comes back. If the server asks for more than `maxWaitMs`, though, the client gives up without waiting and returns the refusal as it is. A call that waits an hour because it was told to looks frozen to its user.

`sleep`, `random` and `now` are passed in. The tests move a clock instead of sleeping and fix the random number at 0.5, so the waits can be checked exactly. Against the same arrangement as the development server, they check that a `POST /notes` sent while the bucket is empty still creates exactly one note after its retries, and that a caller refused by its own limit waits the 10 seconds `retry-after` named before passing. With backoff alone it would have come back after 50 milliseconds and been refused again.

## How retries make an outage worse

<!-- section: 32.storm -->

A retry is good for the one call that makes it. When everyone does the same, it stops being good. The other side is refusing because it cannot take any more, and if everyone it refused sends again, more reaches it, not less. An article in the Amazon Builders' Library calls retries selfish: they spend more of the server's capacity to raise one client's chance of success.

You can reproduce this on a laptop. The model uses no network and only moves time forward in steps of 10 milliseconds.

<<< @/examples/32-limits/src/simulation.ts{scenario}

A call retries until it succeeds. The service admits requests through the same token bucket as in the section before and refuses the rest at once. The random numbers are seeded, so every run gives the same figures.

<<< @/examples/32-limits/src/random.ts{seeded}

There are two scenes.

<<< @/examples/32-limits/src/simulation.ts{scenarios}

```bash
vp run limits:simulate
```

```text
1,000 callers start at once; the service lets 200 a second through (burst 100)

                      sent        succeeded   gave up     peak retries in 10 ms
jitter: none          6060        640         360         900
jitter: full          5635        988         12          130

500 calls a second; the service refuses everything for 3 seconds

                      sent        in outage   held back   gave up
no retry budget       7968        4388        0           1420
retry budget          5100        1600        1464        1500

First attempts in those 3 seconds: 1500. Everything above that is retries.
```

### A thousand calls that start together

In the first scene, 1,000 calls begin in the same instant. This is what happens just after a service comes back, or when a job runs on the hour. The service lets 200 a second through, and only the first 100 pass on the burst.

Without jitter, the 900 that were refused all wait the same 100 milliseconds and come back within the same 10. About twenty tokens have built up by then. The rest wait the same time again and come back together again. The wait doubles each time, but the crowd never spreads. The 360 calls that have not passed after eight attempts end in failure.

With jitter, the same 900 scatter across the whole width of the wait. At most 130 come back within any 10 milliseconds, and 988 calls succeed. The service also sees fewer requests: 5,635 instead of 6,060. The only thing that changed is `jitter`. The service's capacity, the number of attempts and the ceiling of the wait are the same.

### A service that refuses everything for three seconds

In the second scene, 500 calls a second pass with room to spare until, for 3 seconds, the service refuses all of them. Each call tries up to three times.

With nothing holding retries back, 4,388 requests reach the service in those 3 seconds, against 1,500 first attempts. That is nearly three times as much. A service that is trying to recover is being hit with three times its usual load. Where calls pass through several layers, each layer multiplies again. The Builders' Library article gives an example in which five layers that each retry three times raise the load on the lowest one 243 times. This growth is called a retry storm.

What holds it down is a retry budget.

<<< @/examples/32-limits/src/retry-budget.ts{budget}

The budget is shared by every call one client makes. Each retry pays tokens, and a success gives a few back. When failures go on, the budget runs out, and from then on the client does not retry and returns the first failure as it is. The budget stops retries only. It never stops a first attempt.

The numbers in the simulation are the ones the AWS SDK uses: a capacity of 500, 5 for a retry, and 1 back for a call that succeeds on its first attempt. With this budget, 1,600 requests reach the service during the 3 seconds of the outage. The first 100 retries empty the budget, and after that only first attempts go out.

The budget has a price. 1,500 calls ended in failure with it, against 1,420 without. The 80 in between began near the end of the outage and would have passed after the recovery if they had retried. In exchange for stopping retries that cannot succeed, a budget also stops a few that could have.

All this model can tell you is the shape. A real network has latency, refusing costs the server something, and clients do not share one budget. Do not apply the figures themselves to your own service.

## The SDK's retries

<!-- section: 32.sdk -->

Where the application calls DynamoDB, you do not have to write any of this yourself. The AWS SDK for JavaScript has the backoff, the jitter and the budget. What you need to know is what the defaults are and which of them you decide.

<<< @/examples/32-limits/src/sdk-retry.ts{sdk}

The first two are values read in the source of the versions this book pins: `@aws-sdk/client-dynamodb` 3.1149.0 and the `@smithy/util-retry` 4.6.2 inside it. The retry mode is `standard`, there are 3 attempts including the first, the wait after throttling is full jitter on a base of 500 milliseconds, and the budget is 500. A test compares these constants with the ones the package exports.

The third is what AWS has published as its new retry behaviour for 2026. According to the SDK reference guide, you opt into it by setting `AWS_NEW_RETRIES_2026=true` in the environment until it becomes the default. Under it the base after throttling becomes 1,000 milliseconds, and the DynamoDB client's default number of attempts becomes 4. The installed version's source reads that environment variable too.

Rather than rely on a default that is due to change, this chapter's client states the number of attempts and the mode.

<<< @/examples/32-limits/src/sdk-retry.ts{table-client}

<<< @/examples/32-limits/src/compose.ts{repository}

Chapter 05's repository code is unchanged. Only the client handed to it is made here.

Whether the SDK really tries three times was counted in a test. The client's `requestHandler` is replaced by a fake that does nothing but return a response in the shape DynamoDB uses when it throttles: an HTTP 400 with `ProvisionedThroughputExceededException`. Nothing leaves the process. The test checks that the fake is called three times for throttling and once for a `ValidationException`. How the real DynamoDB behaves when it throttles was not checked.

There is also an `adaptive` mode, which slows the client's own sending when it is throttled. The reference guide describes it as meant for a client that talks to a single resource and does not recommend it as a general default. Throttling on one table slows every other call from the same client.

### Keeping the timeout in proportion

Retries take time. The function's timeout has to be longer than the retries take, or the function is cut off before the SDK sends its third attempt.

<<< @/examples/32-limits/src/backoff.ts{worst-case}

The waits between three attempts add up to at most 1.5 seconds under today's behaviour and 3 seconds under the 2026 behaviour. The function's timeout is 10 seconds, which is shorter than the 30 seconds of an HTTP API's integration timeout. With four attempts, the waits alone could reach 7 seconds under the 2026 behaviour, and 10 seconds would be cutting it fine. That is the reason for stating the number of attempts, and a test on the stack keeps watch over the relation.

When the SDK's retries run out, the exception reaches the application. Chapter 05's application turns an exception into a 500, so while the table is throttling, the user gets a 500. The caller cannot tell a defect from something that would pass after a wait. "If you take this to production" comes back to this.

## Brakes you set yourself

<!-- section: 32.brakes -->

A quota is a share that protects AWS. It is far too large to protect your bill or the database behind your API. So you set limits of your own in front of it.

The limit at the entrance is the stage throttle.

<<< @/examples/32-limits/infra/lib/limits-stack.ts{throttle}

To the setting used since chapter 04, this adds one value for a single route. `POST /notes`, which creates a note, gets 2 requests a second and a burst of 4. Writes cost more than reads and reach the table's ceiling sooner, so they are narrowed at the entrance.

In CloudFormation, `routeSettings` is untyped JSON. The CDK's types end there as well, so the property names are spelled the way API Gateway spells them. The `DependsOn` on the stage is there on the understanding that naming a route that does not exist yet makes the stage fail to create. Whether cdkd applies this combination correctly has not been run and checked.

An HTTP API has no usage plans or API keys. That feature, which throttles and sets a quota per API key, belongs to REST APIs. The official documentation also says that a usage plan's throttling and quotas are not hard limits and that you should not rely on them to control costs or block access. If you need a limit per caller, count for yourself as chapter 14 does, or use AWS WAF from chapter 21.

The limit on the function is reserved concurrency.

<<< @/examples/32-limits/infra/lib/limits-stack.ts{function}

Reserved concurrency is a ceiling and a share at once. Set it to 5 and the function runs at most five at a time, and no other function in the account can use those five. The setting itself is not charged for. Set it to 0 and the function processes nothing. That makes it the quickest switch for stopping a function during an incident.

It is off by default. As the [previous page](/en/chapters/32-limits.md) showed, an account has to leave 100 unreserved, and a new account may not have that to spare. To switch it on, pass `-c reservedConcurrency=5`.

The limit on the table is the same `maxReadRequestUnits` and `maxWriteRequestUnits` as in chapter 05. An on-demand table has only a large quota, 40,000 units a second by default, so your own values sit in front of it.

You learn that Lambda refused the function from an alarm.

<<< @/examples/32-limits/infra/lib/limits-stack.ts{alarm}

`Throttles` rises when the reserved amount is used up, or when the whole account's concurrency is. In the second case the cause may be another function. Chapter 19 put alarms on symptoms only, and this alarm is on a cause. It is there on purpose, because you want to know that a brake took hold. For the notification, pass the topic of chapter 19's stack with `-c alarmTopicArn=`. Without it the alarm shows in the console and reaches nobody.

Which status an HTTP API returns to the caller when Lambda refuses the function was not checked.

## The first limit you reach

<!-- section: 32.first-limit -->

With limits at several levels, it gets hard to see which one takes effect first. So each is converted to the number of requests a second at which it starts to refuse, and they are put in order.

<<< @/examples/32-limits/src/ceilings.ts{ceilings}

The formula that turns concurrency into a rate is from the Lambda documentation: the concurrency you need is requests per second times the seconds one request takes. Read the other way, a concurrency of 5 with requests that take 2 seconds each allows 2.5 requests a second. There is one more rule: one execution environment serves at most 10 requests a second. However fast the function, a concurrency of 5 tops out at 50 requests a second.

Worked out for this chapter's stack with its defaults, the first limit is the stage's 10 requests a second, and the next is the table's 150 a second for reads. The tests also check that the order changes with the conditions. Raise the stage's value and the table comes first; make each request slow and concurrency does.

The Lambda documentation uses the mismatch between two defaults as its example. API Gateway accepts 10,000 requests a second, and Lambda's concurrency is 1,000. For a function that takes 0.5 seconds per request, that allows 2,000 a second, and Lambda refuses the rest of what the entrance let in. The documentation recommends finding which quota is the limiting one with a load test before production.

The inputs to this arithmetic are assumptions. Neither the time one request takes nor the units it uses is known until it is measured. The arithmetic tells you where to look, and only sending real traffic confirms it. The [next page](/en/chapters/32-limits/local.md) tries as much of that as a laptop allows.
