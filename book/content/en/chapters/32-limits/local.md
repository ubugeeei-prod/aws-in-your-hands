---
title: "32 Limits: Run It Locally"
---

# 32 Limits: Run It Locally

## Run it locally

<!-- section: 32.local -->

The two limits built on [the pages so far](/en/chapters/32-limits/build.md) run on a laptop without AWS. Copy `examples/32-limits/.env.example` to `.env` and start the server.

<<< @/examples/32-limits/.env.example

```bash
vp run dev:limits
```

<<< @/examples/32-limits/src/dev.ts{dev}

A request meets the two limits in the order it would in AWS: first the one bucket for everybody, then the window for its own caller. The per-caller counters live in the process's memory. The development server is a single process, so that counts correctly. On Lambda there would be a separate counter in each execution environment, which is why the function has no such limit. To count per caller in AWS, keep the counters in a store outside the function, as chapter 14 does.

From another terminal, send 30 requests in a row.

```bash
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code} ' http://localhost:8787/health; done; echo
```

The first twenty or so come back 200, and after that 429s are mixed in. Send a single one with `curl -i` and the presence or absence of `retry-after` on a 429 tells you which limit refused it.

Run the tests with this command.

```bash
vp run test:unit
```

## Put load on it locally

<!-- section: 32.load -->

A load test is for learning which limit you reach first and what comes back when you do. This chapter's load generator sends to the development server on your own machine and nowhere else.

<<< @/examples/32-limits/src/load.ts{target}

The target is checked before the script sends a single byte. The tests confirm that it also refuses other host names that begin with `localhost` and forms such as `localhost@example.com`. Giving it the URL of a deployed API does not work. The reason is at the end of this page, under "Before you put load on a deployed API".

Every request's start time is fixed before the run begins.

<<< @/examples/32-limits/src/load.ts{schedule}

A generator that sends the next request when the previous answer arrives slows down whenever the server does. The load drops by itself, and the answers from the moments when the server was struggling most never get recorded. With the times fixed in advance, the next request leaves on schedule even when answers are late.

<<< @/examples/32-limits/scripts/load.ts{step}

Refused requests are left out of the response times.

<<< @/examples/32-limits/src/load.ts{summary}

A 429 comes back fast. Mix it into an average or a percentile and a server that refuses nearly everything looks quicker than one that serves. A 429 that carries `retry-after` is also counted apart, because which limit refused is the first thing you want to know.

With the development server still running, run this from another terminal.

```bash
vp run limits:load
```

```text
target http://localhost:8787/health, 5 s at each rate

req/s   sent   p50 ms   p95 ms   max ms   answers
5       25     1.6      4.1      45.3     200: 25
10      50     1.3      2.4      3.0      200: 37, 429 retry-after: 13
20      100    1.2      4.0      9.9      200: 27, 429: 31, 429 retry-after: 42
40      200    1.4      3.5      13.0     200: 39, 429: 131, 429 retry-after: 30

The first limit shows at 10 requests a second.
```

This is the output on the author's machine, with only the port number rewritten to the default. Response times depend on the machine and on whatever else is running on it.

The first limit reached was not the bucket of 10 a second for everybody. It was the limit per caller. The load comes from one address, so a rate of 10 a second uses up that address's window of 50 per 10 seconds first. Those are the 429s with `retry-after`. At 20 a second, the bucket's 429s begin to appear too.

The same thing is common against a deployed API: load from a single machine reaches the per-caller limit first. You can believe you tested the throttle at the entrance when what you measured was a rate-based rule in WAF or your own rate limiter.

Take the per-caller limit out of the way, in effect, and the bucket shows.

```bash
CALLER_LIMIT=100000 vp run dev:limits
```

```text
target http://localhost:8787/health, 5 s at each rate

req/s   sent   p50 ms   p95 ms   max ms   answers
5       25     1.9      4.9      44.7     200: 25
10      50     1.2      1.9      2.8      200: 50
20      100    1.3      1.8      2.1      200: 69, 429: 31
40      200    1.1      2.4      4.3      200: 69, 429: 131

The first limit shows at 20 requests a second.
```

Everything passed up to 10 a second, and at 20 a second 69 of 100 did. That is about the burst of 20 plus 5 seconds' worth at 10 a second. At 40 a second the number that passes is the same. The limit is where sending more stops letting more through.

<<< @/examples/32-limits/src/load.ts{first-limit}

### What a load test on a laptop cannot tell you

What you can check locally is how the limits refuse and how a client behaves. These you cannot learn.

- Response times. The other end is a Node.js process on the same machine reading a Map in memory. There is no network, no Lambda cold start and no DynamoDB. The few milliseconds in the tables say nothing about the figures in AWS
- Lambda's concurrency. On the development server one process takes everything. Neither the concurrency limit nor the limit on how fast execution environments are added (1,000 every 10 seconds) exists locally
- Throttling by the table. The in-memory store never refuses. A situation in which the SDK's retries really do their work can be made locally only against the fake handler
- How API Gateway really counts. The stand-in's bucket counts exactly, and the real one is best-effort
- The limits of the sending side. The load generator is one process lining up `fetch` calls. As the rate goes up, the script is what clogs first, and nothing in the output says so. That is why the script accepts at most 500 requests a second

### Before you put load on a deployed API

Read the AWS policies before sending load to anything you have deployed. This is what they said on October 12, 2026.

The EC2 testing policy is about tests that send high volumes of traffic from EC2 instances, and it defines a network stress test like this.

```text
In these guidelines we consider a "network stress test" to be when a test sends a large volume
of legitimate or test traffic to a specific intended target application. The endpoint and
infrastructure are expected to be able to handle this traffic, and this traffic meets their
network stress testing policy.
```

A test that purposefully tries to overwhelm the target or the infrastructure is treated as a DDoS test, not a stress test, and volumetric DDoS simulations from EC2 are prohibited. The page also says that a target hosted in AWS should be in the same Region.

The penetration testing policy lists this line among its prohibited activities.

```text
Request flooding (login request flooding, API request flooding)
```

What the two pages make clear is a distinction: a test that sends as much as the target should be able to take, in order to measure performance, is one thing, and a test meant to overwhelm it is another. A test that keeps raising the rate to find a limit moves towards the second, depending on how it is done.

Some things could not be determined. The EC2 page gives no threshold for the rate and no procedure for prior notice. Neither page says what is needed when the load comes from a machine outside AWS and goes to your own API. Before a test against a deployed API, read both pages again, and if you are still unsure, tell AWS Support your plan and ask. No deployed API was load tested for this chapter.

A test against a deployed API also has a cost to watch. As in chapter 19, whether API Gateway charges for requests it refused with a 429 has not been confirmed. Requests that pass are billed as usual by Lambda, DynamoDB and the logs.
