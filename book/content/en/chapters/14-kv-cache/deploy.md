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

Valkey is created only when you ask for it.

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

Step by step.

Always read `connectionType: "public"` and `userGroupId` together. `default.iam-user-group` is a group ElastiCache provides in every account, containing only users that authenticate with IAM. A public cache attached to a group with a password user is the accident to avoid, and a test guards against it.

`cacheUsageLimits` caps the data stored and the ECPUs. Past them, ElastiCache evicts keys and throttles requests. It trades performance for a bill that has a ceiling.

`elasticache:Connect` is granted on two ARNs only, the cache and the user. There is no `*`.

I also checked how cdkd treats these. The pinned version (0.296.28) has dedicated implementations for the table, the function, the role, the log group, and the HTTP API. It has none for `AWS::ElastiCache::ServerlessCache`, which goes through Cloud Control API. That type is also on cdkd's list of stateful resources, so a change that replaces it (changing the connection type, for one) needs `--force-stateful-recreation`. A test pins the list of resource types the stack uses.

## Deploy and check

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` calls `GET /items` repeatedly under a new caller ID and prints at which request it gets 429 and how `x-cache` changes. On DynamoDB, the sixth request should be refused whichever execution environment answers.

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
