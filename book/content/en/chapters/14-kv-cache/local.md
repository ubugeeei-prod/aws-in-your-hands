---
title: "14 Cache: Run It Locally"
---

# 14 Cache: Run It Locally

## Running it locally

<!-- section: 14.local -->

Memory first. Copy `examples/14-kv-cache/.env.example` to `.env` in the same directory.

<<< @/examples/14-kv-cache/.env.example

```bash
vp run dev:kv
```

From another terminal, call it six times.

```bash
curl -s -i http://localhost:8794/items
```

The first call says `x-cache: miss` and takes about 300 ms. From the second on it says `x-cache: hit` and returns at once. `ratelimit-remaining` goes 4, 3, 2, and the sixth call gets 429 with `retry-after`.

Whose five calls they are is decided by the address the request came from.

<<< @/examples/14-kv-cache/src/caller.ts{address}

On AWS that is the source IP address as API Gateway saw it. It arrives in the event's `requestContext`, and no header the caller sends can change it. On the local development server it is the address at the other end of the socket. Headers such as `x-forwarded-for` are never read, because the caller can write anything into them.

<<< @/examples/14-kv-cache/src/caller.ts{subject}

IPv6 addresses are grouped by their first 64 bits, because one network hands a single caller that many addresses. Requests whose address could not be read all share one budget, so that a misconfiguration makes the limit stricter rather than looser.

The sample does not ask callers to name themselves in a header such as `x-client-id`, because that protects nothing. Claim another name and you are counted separately, and every new name adds an item to the store. A rate limit in front of authentication counts by something the caller cannot choose.

An IP address has limits too. Behind one office or campus exit, everyone inside shares the five calls. And a caller with many addresses gets that many budgets. To tell users apart, take the ID from the verified token of [chapter 06](/en/chapters/06-auth.md). Counting by IP address is a rough brake in front of authentication.

In the app, the rate limit runs before the cache.

<<< @/examples/14-kv-cache/src/app.ts{limit}

Look inside the `catch`. When the counting store is down, do you let the request through or refuse it? That is a product decision, not a technical one. For a list API, let it through: a store outage shouldn't take the API down with it. For login attempts, refuse: you don't want to wave people through with the guard down. So it is a setting, `RATE_ON_ERROR`, and not something buried in a `catch`.

This chapter's stack sets it to `allow`, and here is what that costs. While the store is down, the app's limit does not apply: the same caller gets through as often as they like. The only brake left is the stage throttle in front of the API (10 requests a second across all callers). If that is not enough for your API, set it to `deny`.

Which store is used is decided at startup, from the environment.

<<< @/examples/14-kv-cache/src/env.ts{env}

<<< @/examples/14-kv-cache/src/compose.ts{stores}

### With Valkey and DynamoDB Local

To run against real servers, start two containers.

```bash
vp run kv:local:start
vp run kv:local:migrate
vp run kv:test:local
```

`kv:local:start` needs a running Docker daemon. The devShell doesn't bring one, so start Docker Desktop or similar yourself. It starts `valkey/valkey:9.0.6-alpine` (port 6390) and `amazon/dynamodb-local:3.3.1` (port 8001).

`kv:test:local` runs the contract tests against those two. If either is not running, it fails instead of skipping, because a skip looks like a pass at a glance.

Change `KV_STORE` in `.env` to `valkey` or `dynamodb`, and `vp run dev:kv` uses that store too.

One thing to be upfront about. The machine this chapter was written on had no Docker daemon, so `kv:local:start` was never run. Instead, Valkey 9.1.2 and DynamoDB Local 3.3.1 were started as plain processes, not containers, and the 22 contract tests and `dev:kv` ran against them. The tests and the app are checked against real servers; only the tasks that start the containers are not.

Here is what a local run does not reproduce.

- **IAM and TLS.** The local Valkey has no password and no TLS. Token signing and the TLS 1.3 connection can only be checked against ElastiCache
- **Cluster mode.** The local Valkey is a single node. ElastiCache Serverless runs in cluster mode, and the client behaves differently
- **TTL deletion.** Nothing locally depends on an expired item being gone
- **Several execution environments.** The dev server is one process, so even the memory rate limit looks correct

Watch the last one. `KV_STORE=memory` looks perfect on your machine and loosens the limit the moment it runs on Lambda.
