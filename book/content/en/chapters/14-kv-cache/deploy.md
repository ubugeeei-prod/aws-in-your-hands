---
title: "14 Cache: Deploy"
---

# 14 Cache: Deploy

## Getting ready for AWS

<!-- section: 14.infra -->

On this page you put the API you ran locally on AWS. By default the stack creates only a DynamoDB table, a Lambda function, and an HTTP API.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{table}

`timeToLiveAttribute` is the TTL setting. The table only decides which attribute to look at, and the time of deletion is written on each item.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{role}

The role allows only the four operations the stores call, with no `Query` and no `Scan`.

Anyone who knows the URL can call this API. For that reason the stack has two limits from the start.

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{bounds}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{throttle}

The first is throttling on the HTTP API stage. It accepts 10 requests a second across the whole API, with a burst of up to 20. API Gateway answers anything beyond that with 429, and neither Lambda nor DynamoDB is called. The rate limit in the app shares out calls fairly per address, while the stage throttling holds down the total for everyone.

The second is a cap on the table. An on-demand table has no upper limit of its own. With `maxWriteRequestUnits` and `maxReadRequestUnits` set, DynamoDB throttles the units per second that go beyond those values. The values are a little above what the stage throttling lets through. At most 30 requests pass in one second (the burst of 20, plus the 10 refilled during that second). Each request is one write unit and a cache refill takes three, so the write cap is 40. The read cap is 60, to allow for the two reads of a sliding window. The cap is a second brake that does nothing in normal operation and takes effect only if the stage throttling is not working. When the cap is reached, the counting store fails, and the API behaves as `RATE_ON_ERROR` is set ([Run It Locally](/en/chapters/14-kv-cache/local.md)).

Valkey is created only when you ask for it explicitly.

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

The settings are explained in order from the top.

Always check `connectionType: "public"` and `userGroupId` as a pair. `default.iam-user-group` is a group that ElastiCache provides in the account and that contains only users who authenticate with IAM. A test prevents the accident of attaching a group that has a password user to a public cache.

`cacheUsageLimits` sets the upper limits for data stored and ECPUs. Beyond them, ElastiCache evicts keys and throttles requests. Performance drops, and in return the bill has a ceiling.

`elasticache:Connect` is allowed only on two ARNs, the cache and the user, and there is no `*`.

I also checked how cdkd handles these resources. The pinned version (0.296.28) has dedicated implementations for the table, the function, the role, the log group, and the HTTP API. It has none for `AWS::ElastiCache::ServerlessCache`, which is handled through Cloud Control API. That type is also on cdkd's list of stateful resources, so a change that replaces it (changing the connection type, for example) needs `--force-stateful-recreation`. A test pins the list of resource types the stack uses.

For the two limits, I read in the source of the same version that the stage implementation passes `DefaultRouteSettings`, and the table implementation passes `OnDemandThroughput`, to the AWS API unchanged. Reading the source is as far as the check went, and whether the limits take effect is not known until someone deploys and looks.

## Deploy and check

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` calls `GET /items` repeatedly and prints the request at which it gets 429 and how `x-cache` changes. With the DynamoDB variant, the sixth request should be refused whichever execution environment answers. The count is per source address, so if you run the task again within a minute, the calls from the previous run are still counted and the refusal comes sooner.

To try the Valkey variant, add the context to the same tasks.

```bash
vp run kv:infra:deploy -c store=valkey
vp run kv:smoke
vp run kv:infra:destroy -c store=valkey
```

The cache is billed from the moment it is created until it is deleted. Run all three lines, through `destroy`, without a break.

If the connection does not work, read the logs.

```bash
vp run kv:logs
```

One of `valkey connection error`, `cache store failed`, or `rate limiter failed` should appear. The API keeps returning 200 while the cache is down, so you will not notice from the responses alone. If `x-cache` stays `miss`, assume the cache is not being reached.

Drift is checked the same way as in chapter 02.

```bash
vp run kv:infra:drift
```

None of the commands in this section have been run against real AWS. The Valkey variant in particular has many unconfirmed points, such as whether CloudFormation accepts this combination of settings, whether the hand-written token is accepted, and whether iovalkey can read the cluster topology through a public endpoint. The breakdown and the steps for resuming are in "Verification notes for this chapter" on [the last page](/en/chapters/14-kv-cache/wrap.md).
