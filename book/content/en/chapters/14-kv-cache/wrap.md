---
title: "14 Cache: Costs, Pitfalls, and Cleanup"
---

# 14 Cache: Costs, Pitfalls, and Cleanup

## Coming from Workers KV or Durable Objects

<!-- section: 14.cloudflare -->

Cloudflare doesn't have just one KV either. Here is what I could confirm.

**Workers KV** is, in its documentation's words, "an eventually-consistent edge key-value store". A change is usually visible at once where it was made and may take 60 seconds or more elsewhere. It suits read-heavy, cacheable data, and the documentation says it is not ideal where you need atomic operations and points to Durable Objects.

It is tempting to map that onto one of the three on AWS. I won't, because each overlaps in a different way.

- DynamoDB shares "the code that plays the Worker's part reads and writes it". But it lives in one Region and offers strongly consistent reads and conditional updates. It is far more of a database than KV is
- CloudFront KeyValueStore shares "read at the edge" and "arrives late". But functions cannot write to it, and it is orders of magnitude smaller (1 KB per value, against 25 MiB in KV)
- Valkey resembles neither. It is a server in memory in one Region

A job like a rate limit, counting accurately, isn't Workers KV's job on Cloudflare either. **Durable Objects** are small single-threaded instances, each uniquely identified by a name and each with its own strongly consistent storage. By handling one thing at a time they give, in another form, the guarantee this chapter got from a DynamoDB condition expression and a Valkey script. AWS has no part that corresponds directly.

Workers also have a binding made for rate limiting. Its documentation says limits are counted per Cloudflare location and that the API is "permissive, eventually consistent", and not meant as an accurate accounting system. This chapter's DynamoDB version chooses the opposite: one Region, one write per request, an exact count. The binding wins on speed and ease, this wins on strictness. Which you need depends on what you are protecting.

The pricing has a different shape as well. Workers KV includes 100,000 reads and 1,000 writes a day on the Free plan, and 10 million reads and 1 million writes a month on the Paid plan, then USD 0.50 per million reads and USD 5.00 per million writes. Nothing is charged for merely having it until you store more than 1 GB. "A KV that costs money just sitting there" is probably the strangest part when you come from Cloudflare. I did not check Durable Objects pricing for this chapter.

## Which one to choose

<!-- section: 14.choose -->

All of the above on one page.

| | DynamoDB | ElastiCache Serverless (Valkey) | CloudFront KeyValueStore | Lambda memory |
| --- | --- | --- | --- | --- |
| Good for | Data it owns. Exact counts. Expiring records you cannot lose | Very frequent reads and writes. Counts and copies you can lose. Purpose-built operations such as rankings | Small configuration read at the edge | Copies for one execution environment |
| Consistency | Strongly consistent reads on request. A conditional update is one step | One command or one script is one step. Replication across zones is asynchronous | Updates arrive late; no figure confirmed | Not shared |
| Lifetime of data | Until you delete it. TTL deletion can be days late | Until expiry (0 to 1 ms error). Can be lost to eviction and failures | Until you change it | Until the environment is discarded |
| Where | One Region. No VPC | One Region. In a VPC or behind a public endpoint | Every edge location | Inside the environment |
| Price while unused | Storage only (USD 0.00 for this chapter's setup) | From USD 7.37 a month | 0 in this chapter (chapter 10) | 0 |
| Writable from Lambda | Yes | Yes | No | By that environment only |

From this table the decisions mostly follow.

**When in doubt, DynamoDB.** It costs next to nothing idle, needs no VPC, and is protected by the same permission system as Lambda. Both the rate limit and the cache can be built on it, as you saw. It has two weak spots: one operation takes from a few to a dozen milliseconds (around 10 ms against the local DynamoDB Local, which is not a figure for the real service), and every write is billed.

**Valkey, when you can say why.** You read and write many times per request. A millisecond matters. You need operations DynamoDB lacks, such as sorted sets or pub/sub. Or you write so much that DynamoDB's per-request price goes well past USD 7.37 a month. If one of those holds, Valkey has a job. If none does, you are taking on a standing charge, data that can vanish, and one more thing to operate, for no reason.

**KeyValueStore, only for configuration that edge functions read.**

**Memory is the first cache layer you get for free.** Don't trust it with correctness.

## The money

<!-- section: 14.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The working is in [Pricing calculations](/en/reference/pricing.md).

**A month of sitting there.**

| Setup | Per month (730 hours) |
| --- | --- |
| The default stack (DynamoDB) | 0.00 |
| `-c store=valkey` (ElastiCache Serverless, Valkey) | 7.37 |
| For comparison: node-based Valkey, one `cache.t4g.micro` | 14.60 |

Serverless's 7.37 is the minimum charge. Serverless Valkey is metered as 100 MB even when it stores less. At USD 0.101 per GB-hour, 0.1 GB x 730 hours x 0.101 comes to 7.37. For Redis OSS and Memcached the minimum is 1 GB and the rate is higher, USD 0.151. That is one of the reasons for picking Valkey.

The node-based 14.60 is not something this chapter's stack creates; it is there to compare. It is a single node without a replica, so when that node fails the cache is empty.

On free tiers: according to the ElastiCache pricing page, accounts created before July 15, 2025 get 750 hours of `cache.t3.micro` for 12 months, which excludes Serverless. Newer accounts get credits instead. Neither is deducted in this table.

**A month with one million requests.** Assuming Lambda on arm64 with 256 MB and 30 ms on average, and 0.5 KB of logs per request.

| Item | DynamoDB, list price | Valkey, list price |
| --- | --- | --- |
| API Gateway HTTP API requests (1 million) | 1.29 | 1.29 |
| Lambda requests and duration | 0.30 | 0.30 |
| CloudWatch Logs | 0.36 | 0.36 |
| DynamoDB writes (1,262,800 units) | 0.90 | - |
| DynamoDB reads (543,800 units) | 0.08 | - |
| ElastiCache data stored (the 73 GB-hour minimum) | - | 7.37 |
| ElastiCache ECPUs (10 million, assumed) | - | 0.03 |
| Subtotal (list) | **2.94** | **9.36** |
| Subtotal (after monthly free allowances) | **2.27** | **8.69** |

Only the Lambda and CloudWatch Logs allowances are deducted (they are shared across the account). I could not confirm a free allowance for HTTP API, so none is deducted.

The DynamoDB writes are one million rate limit increments plus 87,600 cache refills x 3 (take the lock, write the copy, release the lock). The refill count rests on a generous assumption: a refill happens every single time the 30-second TTL runs out. A sliding window adds one strongly consistent read per request, another million read units (USD 0.14).

The Valkey ECPUs assume 10 per request, on the generous side. A simple read or write is 1 ECPU per KB, but I have not measured what a script uses. Even so it is USD 0.03; at this scale the storage minimum is almost the whole bill.

Compare the two subtotals. At a million requests a month, DynamoDB is far cheaper. DynamoDB writes reach USD 7.37 a month at roughly 10 million writes. Before assuming "cache means Valkey", it is worth doing this sum once.

Some things are not in the table (not zero, just not included): data transfer of the responses out to the internet, and data transfer to the public endpoint, which the pricing page puts at USD 0.01 per GB on the application side within the same Region.

**A month of being hammered.** This API has no authentication. Anyone who knows the URL can call it. Three things stand in the way: the stage throttle (10 requests a second in total), the rate limit in the app (5 a minute per address), and the cap on the table.

Suppose the full 10 requests a second arrive for 30 days. That is 25.92 million requests. Under the same assumptions as the table above (30 ms on average, 0.5 KB of logs), the list price of the DynamoDB variant comes to this.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration | 7.78 |
| CloudWatch Logs | 9.39 |
| DynamoDB writes (26,182,800 units) | 18.72 |
| DynamoDB reads (13,003,800 units) | 1.85 |
| Total (list price) | **71.18** |

About USD 71 a month. As long as the throttle holds, that is roughly this stack's ceiling. A request the app refuses with 429 still pays for API Gateway, for Lambda, and for the write whose condition failed, so the figure barely drops even if almost everything is a 429. Whether API Gateway bills a request it throttles with 429 has not been checked. Data transfer of the responses is not included either.

Against a caller who keeps changing addresses, the rate limit in the app does nothing: every address has a fresh budget. What grows then is counter items, at most 10 a second. They are small and TTL deletes them within days, but how far they pile up has not been measured.

If the throttle is not in effect (unknown until someone deploys and looks), what remains is the cap on the table: 40 write units and 60 read units a second. Pinned at the cap for 30 days, the DynamoDB part stops at USD 74.13 for writes and USD 22.16 for reads. The API Gateway and Lambda parts do not stop. After deploying, look at the stage's throttling values in the console once.

In the Valkey variant the counting moves to ElastiCache, where the ceiling is `cacheUsageLimits`. Pinned at 1,000 ECPUs a second for 30 days, that is USD 7.00; with storage at its 1 GB maximum, USD 73.73 for 730 hours.

Before real users arrive, add authentication (chapter 06) and, if you need it, AWS WAF. WAF cannot be attached to an HTTP API, so that means putting CloudFront in front. The web ACL of [chapter 21](/en/chapters/21-security.md), with its three rules, is USD 8.00 a month plus USD 0.60 per million requests. This book does not build an HTTP API behind CloudFront.

Delete the stack and this chapter's charges stop.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| `dev:kv` stops with `Invalid environment` | Is there an `examples/14-kv-cache/.env`? Each `KV_STORE` needs different variables |
| Locally the sixth call gets 429, deployed more get through | Did you deploy with `KV_STORE=memory`? Each execution environment counts on its own |
| A 429 without a `ratelimit-limit` header | API Gateway's throttle refused it, not the app. The API as a whole went past 10 requests a second |
| A 429 before you have made five calls | Someone behind the same exit IP address called first. The count is per address, not per person |
| Expired items are still in the DynamoDB console | That is normal. TTL deletion can be days late. The reader checks the expiry |
| `x-cache` stays `miss` | Nothing is being written to the cache. Search `vp run kv:logs` for `cache store failed` |
| `WRONGPASS` in the logs | Per the official troubleshooting table: an expired token, the wrong user name, missing `elasticache:Connect`, or a cache name that is not lowercase |
| `NOAUTH` in the logs | The client sent a command before authenticating. iovalkey sends `AUTH` first as far as its source shows, but that is unconfirmed on a real cache |
| The TLS handshake fails | A public endpoint speaks TLS 1.3 only. Is the client pinned to an older version? |
| `Valkey did not answer within 1000 ms` | The cache is unreachable or slow. The API keeps answering from the source |
| A sliding window refuses one request earlier than expected | Fractions are rounded down. It approximates; it does not guarantee exactly the limit |

## Before production

- **To tell users apart, count by a verified ID.** An IP address lumps together everyone behind one exit and counts a caller with many addresses separately (chapter 06)
- **Fit the throttle to your API.** 10 requests a second is a practice value. Raise the cap on the table along with it. AWS WAF cannot be attached to an HTTP API, so needing it means choosing the layout again ([chapter 04](/en/chapters/04-http-api.md)). A rate limit in the app shares capacity fairly; it does not absorb an attack
- **Fit `RATE_ON_ERROR` to what you protect.** `allow` for a list, `deny` for anything like login attempts where a missing guard hurts
- **Reconsider the table's `removalPolicy`.** This chapter's table holds only disposable items, but in a table shared with data it owns, that is `RETAIN`
- **Choose a TTL you can put into words.** Can you say "the list is at most 36 seconds old" (30 seconds plus 20% jitter)?
- **Watch the hit rate.** `x-cache` is in the logs. For counting from logs and alarming on the result, see [chapter 19](/en/chapters/19-observability.md)
- **If you use Valkey, decide whether a public endpoint is acceptable.** It is protected by IAM, but some organizations rule out any data store reachable from the internet. Then the connection type is VPC and the function moves into chapter 11's VPC. The `elasticache:ConnectionType` condition key can forbid creating public caches at all
- **Give Valkey users one purpose each.** This chapter uses `default.iam-user`, which may do anything. In production, create users limited to the commands and keys they need
- **Deploy through the AWS CDK CLI and CloudFormation.** As chapter 02 said

## Cleaning up

<!-- section: 14.cleanup -->

```bash
vp run kv:infra:destroy
```

If you deployed the Valkey variant, pass the same context.

```bash
vp run kv:infra:destroy -c store=valkey
```

The table, the function, the role, the API, the log group, and the ElastiCache cache are deleted. No final snapshot name is set, so no snapshot is meant to remain. To be sure it is gone, check that the list of caches in the ElastiCache console is empty. If the cache is still there, so is the charge.

Stop the local containers too.

```bash
vp run kv:local:stop
```

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

## As a distributed system

This chapter has two owners of state. The shared store (DynamoDB or Valkey) owns the rate limit counts. The source of truth owns the list. The cache owns nothing.

Here is what must hold, one sentence each.

- **A window lets through at most the limit, however many requests arrive at once.** Tests that try to break it: two requests through a read-then-write store; 50 at once against a real store
- **The caller does not choose whose count a request lands on.** Tests that try to break it: calls from one address under a different claimed name and `x-forwarded-for` each time; an address that cannot be read
- **A copy past its expiry is never returned, even while the store still holds it.** Test that tries to break it: a DynamoDB that returns the expired item
- **With the cache absent, slow, or broken, the response equals the source.** Tests that try to break it: a store whose reads and writes always fail, a store holding unreadable values, a lock holder that never returns
- **A copy is never older than the TTL.** Test that tries to break it: a slow read that straddles an update and its invalidation

Note that the last one is not "never returns an old value". It does. There is a bound, that's all.

The second carries a caveat too. What the caller cannot choose is which address a request appears to come from; a caller with many addresses has that many budgets. The lid on everyone's total is the stage throttle, not the app.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (rate limiter boundaries and concurrency, the store contracts, the requests sent to DynamoDB and Valkey, the read-side TTL check, stale reads, stampedes, jitter, the token signature, the app, stack assertions). Type checking. Synth (default and `-c store=valkey`, including the esbuild bundle). Loading the bundled handler in Node.js and invoking it with an API Gateway shaped event. The 22 store contract tests against Valkey 9.1.2 and DynamoDB Local 3.3.1. Starting `dev:kv` with memory, valkey, and dynamodb, and running the `curl` commands from the text. After the count moved to the source address, I started it again with memory and confirmed that changing headers lands on the same budget (not rerun with valkey and dynamodb).

**Not checked yet.** `kv:infra:deploy`, `kv:smoke`, `kv:logs`, `kv:infra:drift`, and `kv:infra:destroy` have not been run against real AWS. For the stage throttle and the table cap, a test pins that they are in the template, and I read that the source of cdkd 0.296.28 passes them to the AWS API; that is all. That they take effect, what a throttled 429 looks like and whether it is billed, what happens at the table cap, and the actual `sourceIp` in an API Gateway event are unchecked. `kv:local:start` and `kv:local:stop` were not run, for lack of a Docker daemon (Valkey and DynamoDB Local ran as processes, from nixpkgs' `valkey-server` and the jar AWS distributes). Nothing about ElastiCache was checked on a real cache: that CloudFormation and Cloud Control API accept `ConnectionType: public` with `UserGroupId: default.iam-user-group`; that 1,000 is a valid ECPU maximum in `CacheUsageLimits` (the documentation gives no smallest maximum, and 1,000 is the value its own example uses for a minimum); that the hand-signed SigV4 token is accepted; that iovalkey's `Cluster` can read the topology through a public endpoint; the TLS 1.3 connection; what a script costs in ECPUs; how long the cache takes to create and delete. For DynamoDB: how long TTL really takes to delete an item, and response times on the real service. `@valkey/valkey-glide` was only read about on npm, neither installed nor run. Durable Objects pricing was not checked.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Two exercises, swappable backends | `examples/14-kv-cache/src/stores.ts`, `test/store-contracts.ts` | `test:unit` |
| Counting for a rate limit | `examples/14-kv-cache/src/rate-limit.ts`, `test/rate-limit.test.ts` | `test:unit` |
| Read, then write, and you miscount | `examples/14-kv-cache/src/dynamodb-store.ts`, `test/dynamodb-store.test.ts`, `test/rate-limit.test.ts` | `test:unit`, `kv:test:local` |
| TTL does not mean "delete now" | `examples/14-kv-cache/src/dynamodb-store.ts`, `test/dynamodb-store.test.ts` | `test:unit` |
| The same thing on Valkey | `examples/14-kv-cache/src/valkey-store.ts`, `test/valkey-store.test.ts`, `test/local-stores.test.ts` | `test:unit`, `kv:test:local` |
| What ElastiCache adds | `examples/14-kv-cache/src/elasticache-token.ts`, `src/valkey-client.ts`, `test/elasticache-token.test.ts` | `test:unit` |
| Cache only what you can afford to lose | `examples/14-kv-cache/src/read-through.ts`, `src/catalog.ts`, `src/contract.ts`, `test/read-through.test.ts` | `test:unit` |
| The moment it expires, everyone arrives at once | `examples/14-kv-cache/src/read-through.ts`, `test/read-through.test.ts` | `test:unit` |
| Lambda memory is a cache too | `examples/14-kv-cache/src/memory-store.ts`, `src/lambda.ts`, `test/memory-store.test.ts` | `test:unit` |
| Edge configuration is chapter 10's KeyValueStore | `examples/10-edge/` | - |
| Running it locally | `examples/14-kv-cache/src/app.ts`, `src/caller.ts`, `test/caller.test.ts`, `src/compose.ts`, `src/env.ts`, `src/dev.ts`, `scripts/local-stores.ts`, `scripts/test-local.ts`, `.env.example` | `dev:kv`, `kv:local:start`, `kv:local:migrate`, `kv:test:local`, `kv:local:stop` |
| Getting ready for AWS | `examples/14-kv-cache/infra/lib/kv-cache-stack.ts`, `infra/bin/app.ts`, `infra/test/kv-cache-stack.test.ts`, `cdk.json` | `kv:infra:synth`, `test:unit` |
| Deploy and check | `examples/14-kv-cache/scripts/smoke.ts`, `scripts/logs.ts` | `kv:infra:diff`, `kv:infra:deploy`, `kv:smoke`, `kv:logs`, `kv:infra:drift` |
| The money | `data/pricing/` | `test:unit` |
| Cleaning up | `tools/src/infra/` | `kv:infra:destroy`, `kv:local:stop` |

**Primary sources** (checked 2026-10-12 unless noted)

- DynamoDB: [Using time to live (TTL)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), [Working with expired items and TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html), [Working with items and attributes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html), [Update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html), [Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- ElastiCache: [What is Amazon ElastiCache?](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html), [Choosing between deployment options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html), [Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html), [Create a Valkey serverless cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/serverless-public-endpoints-chapter.html), [Connect to a cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connecting-public-endpoint.html), [Authenticating with IAM](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html), [Role-Based Access Control](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Clusters.RBAC.html), [In-transit encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html), [Supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html), [Scaling ElastiCache Serverless](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html), [Engine versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html), [Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/), [AWS::ElastiCache::ServerlessCache](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-serverlesscache.html)
- AWS Price List bulk API: [ElastiCache](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-1/index.json), [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json) (the DynamoDB, Lambda, API Gateway, and CloudWatch unit prices were recorded on 2026-10-11; the DynamoDB read and write prices were confirmed unchanged on 2026-10-12)
- Lambda: [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- Valkey: [README](https://github.com/valkey-io/valkey/blob/unstable/README.md), [Scripting with Lua](https://valkey.io/topics/eval-intro/), [SET](https://valkey.io/commands/set/), [EXPIRE](https://valkey.io/commands/expire/), [INCR](https://valkey.io/commands/incr/), [tags of the valkey/valkey image](https://hub.docker.com/r/valkey/valkey/tags)
- Clients: [iovalkey 0.4.0](https://www.npmjs.com/package/iovalkey/v/0.4.0), [@valkey/valkey-glide 2.5.3](https://www.npmjs.com/package/@valkey/valkey-glide/v/2.5.3)
- CloudFront KeyValueStore: the sources of chapter 10 (checked 2026-10-11; not re-read for this chapter)
- Cloudflare: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- cdkd: [`register-providers.ts` at v0.296.28](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) and the npm tarball of the same version

:::
