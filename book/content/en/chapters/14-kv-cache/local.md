---
title: "14 Cache: Run It Locally"
---

# 14 Cache: Run It Locally

## Running it locally

<!-- section: 14.local -->

On this page you run the rate limit and the cache built so far as one API on your machine. Start with the memory store. Copy `examples/14-kv-cache/.env.example` to a file named `.env` in the same directory.

<<< @/examples/14-kv-cache/.env.example

```bash
vp run dev:kv
```

From another terminal, call it six times.

```bash
curl -s -i http://localhost:8794/items
```

The first call returns `x-cache: miss` and takes about 300 ms. From the second call on, the response has `x-cache: hit` and comes back at once. `ratelimit-remaining` goes down through 4, 3, and 2, and the sixth call returns 429 with `retry-after`.

The app decides whose 5 calls these are by the address the request came from.

<<< @/examples/14-kv-cache/src/caller.ts{address}

On AWS, the app uses the source IP address that API Gateway saw. That address is in the event's `requestContext`, and the caller cannot change it with a header. On the local development server, the app uses the address of the peer on the socket. It does not read headers such as `x-forwarded-for`, because the caller can write any value into them.

A `Request` does not carry the source address, so the app takes the address as its second argument. The Lambda handler reads it from the event and passes it in. The development server passes in the address of the socket's peer, which chapter 04's `nodeServer` reports.

<<< @/examples/14-kv-cache/src/dev.ts{dev}

<<< @/examples/14-kv-cache/src/caller.ts{subject}

IPv6 addresses are counted together by their first 64 bits, because one network hands that many addresses to a single caller. Requests whose address could not be read are all counted in one shared budget, so that a configuration mistake makes the limit stricter and not looser.

The sample does not ask callers to identify themselves in a header such as `x-client-id`, because that would be no defense. A caller who claims a different name is counted under a separate limit, and each new name adds one item to the store. A rate limit placed before authentication counts by something the caller cannot choose.

Counting by IP address has limits too. On a network with a single exit, such as an office or a school, everyone inside shares the 5 calls. In the other direction, a caller with many addresses has as many budgets as addresses. To tell users apart, take the ID from the verified token in [chapter 06](/en/chapters/06-auth.md). A rate limit that counts by IP address is a rough brake placed before authentication.

Inside the app, the rate limit runs before the cache. `limited` is a function that wraps the `/items` route and calls the route inside only while budget is left.

<<< @/examples/14-kv-cache/src/app.ts{limit}

The `catch` block decides whether to let a request through or refuse it when the counting store is down. That is a product decision, not a technical one. For a list API you would probably let the request through, because a store failure should not stop the API as well. For login attempts you would probably refuse, because you do not want to let requests through while the protection is missing. The choice is therefore a setting, `RATE_ON_ERROR`, and is not fixed inside the `catch`.

This chapter's stack sets it to `allow`, and that has a cost. While the store is down, the app's limit does not apply, and the same caller can get through any number of times. The only brake left at that point is the stage throttling in front of the API (10 requests a second across the whole API, configured on the [Deploy](/en/chapters/14-kv-cache/deploy.md) page). If that is not enough for your API, set it to `deny`.

The store is chosen at startup from environment variables.

<<< @/examples/14-kv-cache/src/env.ts{env}

<<< @/examples/14-kv-cache/src/compose.ts{stores}

### With Valkey and DynamoDB Local

To run against real servers, start two containers.

```bash
vp run kv:local:start
vp run kv:local:migrate
vp run kv:test:local
```

`kv:local:start` needs a running Docker daemon. Entering the devShell does not give you Docker, so start Docker Desktop or an equivalent separately. The task starts `valkey/valkey:9.0.6-alpine` (port 6390) and `amazon/dynamodb-local:3.3.1` (port 8001).

`kv:test:local` runs the contract tests introduced on [the first page of the chapter](/en/chapters/14-kv-cache.md) against these two. If either one is not running, the task fails and does not skip, because a skip looks like a pass at a glance.

If you change `KV_STORE` in `.env` to `valkey` or `dynamodb`, `vp run dev:kv` uses that store too.

The machine this chapter was written on had no Docker daemon, so `kv:local:start` has not been run. In its place, Valkey 9.1.2 and DynamoDB Local 3.3.1 were started as processes, not containers, and the 22 contract tests and `dev:kv` ran against them. The tests and the app have been checked against real servers, and only the tasks that start the containers are unconfirmed.

Some things are not reproduced locally.

- IAM and TLS. The local Valkey has no password and no TLS. Token signing and the TLS 1.3 connection can only be checked against ElastiCache
- Cluster mode. The local Valkey is a single node. ElastiCache Serverless runs in cluster mode, where the client behaves differently
- Deletion by TTL. Nothing in the local run depends on whether an expired item has been deleted
- Several execution environments. The development server is a single process, so even the memory rate limit appears to work correctly

Pay particular attention to the last of these. `KV_STORE=memory` appears to work correctly on your machine, but on Lambda its limit becomes looser.
