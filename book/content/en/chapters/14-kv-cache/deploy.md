---
title: "14 Cache: Deploy"
---

# 14 Cache: Deploy

## Getting ready for AWS

<!-- section: 14.infra -->

By default the stack creates a DynamoDB table, a Lambda function, and an HTTP API, and nothing else.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{table}

`timeToLiveAttribute` is the TTL setting. The table only says which attribute to look at; when to delete is written on each item.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{role}

The role allows the four operations the stores call. No `Query`, no `Scan`.

Anyone who knows the URL can call this API. So two bounds are there from the start.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{bounds}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{throttle}

The first is throttling on the HTTP API stage: 10 requests a second across the whole API, with a burst of up to 20. Beyond that API Gateway answers 429, and neither Lambda nor DynamoDB is called. The rate limit in the app shares capacity fairly per address. This one puts a lid on the total.

The second is a cap on the table. An on-demand table has no ceiling of its own. With `maxWriteRequestUnits` and `maxReadRequestUnits`, DynamoDB throttles whatever goes past that many units in a second. The values sit just above what the throttle lets through. One second admits at most 30 requests (the burst of 20, plus the 10 refilled during that second). Each is one write unit, and a cache refill takes three. So writes are capped at 40, and reads at 60 to cover the two reads of a sliding window. Think of it as a second lid that does nothing day to day and only bites if the throttle is gone. When it does bite, the counting store fails, and the API behaves as `RATE_ON_ERROR` says.

Valkey is created only when you ask for it.

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

Step by step.

Always read `connectionType: "public"` and `userGroupId` together. `default.iam-user-group` is a group ElastiCache provides in every account, containing only users that authenticate with IAM. A public cache attached to a group with a password user is the accident to avoid, and a test guards against it.

`cacheUsageLimits` caps the data stored and the ECPUs. Past them, ElastiCache evicts keys and throttles requests. It trades performance for a bill that has a ceiling.

`elasticache:Connect` is granted on two ARNs only, the cache and the user. There is no `*`.

I also checked how cdkd treats these. The pinned version (0.296.28) has dedicated implementations for the table, the function, the role, the log group, and the HTTP API. It has none for `AWS::ElastiCache::ServerlessCache`, which goes through Cloud Control API. That type is also on cdkd's list of stateful resources, so a change that replaces it (changing the connection type, for one) needs `--force-stateful-recreation`. A test pins the list of resource types the stack uses.

For the two bounds, I read in the source of the same version that the stage implementation passes `DefaultRouteSettings`, and the table implementation passes `OnDemandThroughput`, straight to the AWS API. Reading is all I did. Whether they take effect is unknown until someone deploys and looks.

## Deploy and check

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` calls `GET /items` repeatedly and prints at which request it gets 429 and how `x-cache` changes. On DynamoDB, the sixth request should be refused whichever execution environment answers. The count is per source address, so a second run within a minute still carries the first run's calls and is refused sooner.

To try Valkey, add the context to the same tasks.

```bash
vp run kv:infra:deploy -c store=valkey
vp run kv:smoke
vp run kv:infra:destroy -c store=valkey
```

Once more: the cache is billed from the moment it exists until it is deleted. Run all three lines in one sitting.

If something doesn't connect, read the logs.

```bash
vp run kv:logs
```

You should find one of `valkey connection error`, `cache store failed`, or `rate limiter failed`. With the cache down the API keeps answering 200, so you won't notice from the responses alone. An `x-cache` that stays `miss` is the sign that the cache isn't being reached.

Drift is checked as in chapter 02.

```bash
vp run kv:infra:drift
```

To be honest, none of the commands in this section have been run against real AWS. The Valkey variant in particular has many open points: whether CloudFormation accepts this combination of settings, whether the hand-signed token is accepted, whether iovalkey can read the cluster topology through a public endpoint. The verification notes at the end list them, with the steps to pick the work up.
