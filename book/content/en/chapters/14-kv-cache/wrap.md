---
title: "14 Cache: Costs, Pitfalls, and Cleanup"
---

# 14 Cache: Costs, Pitfalls, and Cleanup

## If you're coming from Workers KV or Durable Objects

<!-- section: 14.cloudflare -->

This last page of the chapter covers how Cloudflare's products correspond, how to choose among the four places to store data, what they cost, and how to clean up.

Cloudflare does not have a single KV either. This is what I was able to confirm.

Workers KV is, in the words of its documentation, "an eventually-consistent edge key-value store". A write is usually visible at once in the location where it was made, and can take 60 seconds or more to reach other locations. It suits data that is read often and caches well, and the documentation says it is not a fit where you need atomic operations and suggests considering Durable Objects.

It is tempting to map Workers KV onto one of the three on AWS, but each overlaps with it in a different way, so this chapter does not.

- DynamoDB is the same in that the code playing the Worker's part can read and write it. It is in one Region, however, and it offers strongly consistent reads and conditional updates. In character it is much closer to a database than Workers KV is
- CloudFront KeyValueStore is similar in that it is read at the edge and its updates arrive late. Functions cannot write to it, however, and it holds data that is smaller by orders of magnitude (a value of up to 1 KB, against up to 25 MiB in Workers KV)
- Valkey resembles neither. It is a server in memory in one Region

Counting accurately, as a rate limit must, is not a job for Workers KV on Cloudflare either. Durable Objects are small single-threaded instances, each uniquely identified by a name and each with its own strongly consistent storage. They handle requests that arrive together one at a time, and so reach in another form the guarantee this chapter got from a DynamoDB condition expression and a Valkey script. AWS has no component that corresponds directly to Durable Objects.

Workers also has a binding dedicated to rate limiting, the Rate Limiting binding. According to its documentation, it counts per Cloudflare location and is "permissive, eventually consistent", not designed as an accurate accounting system. This chapter's DynamoDB variant makes the opposite choice and counts exactly, in one Region, with one write per request. The binding is ahead on speed and ease, and the DynamoDB variant is ahead on strictness. Which one you need depends on what you want to protect.

The pricing has a different shape as well. Workers KV includes 100,000 reads and 1,000 writes a day on the Free plan, and 10 million reads and 1 million writes a month on the Paid plan, and beyond that costs USD 0.50 per million reads and USD 5.00 per million writes. There is no charge for data that merely sits there until you store more than 1 GB. If you come from Cloudflare, ElastiCache charging money just for existing is probably the part that feels strangest. I did not check Durable Objects pricing for this chapter.

## Which one to choose

<!-- section: 14.choose -->

The table below sums up the chapter so far.

| | DynamoDB | ElastiCache Serverless (Valkey) | CloudFront KeyValueStore | Lambda memory |
| --- | --- | --- | --- | --- |
| Good for | Data it owns. Exact counts. Expiring records you cannot lose | Very frequent reads and writes. Counts and copies you can lose. Purpose-built operations such as rankings | Small configuration read at the edge | Copies for one execution environment |
| Consistency | Strongly consistent reads on request. A conditional update is one step | One command or one script is one step. Replication across zones is asynchronous | Updates arrive late; no figure confirmed | Not shared |
| Lifetime of data | Until you delete it. TTL deletion can be days late | Until expiry (0 to 1 ms error). Can be lost to eviction and failures | Until you change it | Until the environment is discarded |
| Where | One Region. No VPC | One Region. In a VPC or behind a public endpoint | Every edge location | Inside the environment |
| Price while unused | Storage only (USD 0.00 for this chapter's setup) | From USD 7.37 a month | 0 in this chapter (chapter 10) | 0 |
| Writable from Lambda | Yes | Yes | No | By that environment only |

From this table, the decisions come out roughly as follows.

When in doubt, choose DynamoDB. It costs almost nothing while idle, needs no VPC, and is protected by the same permission system as Lambda. You can build both the rate limit and the cache on it, as this chapter showed. Its weaknesses are that one operation takes from a few milliseconds to a little over ten, and that every write is billed. One operation took around 10 ms against DynamoDB Local on my machine, but that is not a figure for the real service.

Choose Valkey when you can say why. You read and write many times in one request. A single millisecond matters. You need operations DynamoDB does not have, such as sorted sets or pub/sub. You write so much that DynamoDB's pay-per-request charge goes well beyond USD 7.37 a month. Any one of these is a reason to use Valkey. If none applies, you take on a standing charge, data that can disappear, and one more thing to operate, without a reason.

Use CloudFront KeyValueStore only for configuration that edge functions read.

Lambda memory is a first cache layer that comes at no extra charge, and you do not rely on it for correctness.

## Cost

<!-- section: 14.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The calculations are in [Pricing calculations](/en/reference/pricing.md).

**A month of sitting idle.**

| Setup | Per month (730 hours) |
| --- | --- |
| The default stack (DynamoDB) | 0.00 |
| `-c store=valkey` (ElastiCache Serverless, Valkey) | 7.37 |
| For comparison: node-based Valkey, one `cache.t4g.micro` | 14.60 |

The 7.37 for Serverless is the minimum charge. Serverless Valkey is billed as 100 MB even when it stores less than 100 MB. The rate is USD 0.101 per GB-hour, so 0.1 GB x 730 hours x 0.101 comes to 7.37. For Redis OSS and Memcached the minimum is 1 GB, and the rate is higher at USD 0.151. That is one reason this chapter uses Valkey.

The 14.60 for node-based is not a setup this chapter's stack creates. It was calculated for comparison. It is a single node with no replica, so when that node fails the cache is empty.

A note on the free tier. According to the ElastiCache pricing page, accounts created before July 15, 2025 get 750 hours of `cache.t3.micro` for 12 months, but Serverless is not covered. Accounts created later get credits instead. This table deducts neither.

**A month with one million requests.** The assumptions are Lambda on arm64 with 256 MB and 30 ms on average, and 0.5 KB of logs per request.

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

Only the free allowances for Lambda and CloudWatch Logs are deducted (both are shared across the whole account). I could not confirm a free allowance for HTTP API, so none is deducted.

The DynamoDB writes consist of one million rate limit increments and 87,600 cache refills x 3 writes (take the lock, write the copy, release the lock). The number of refills comes from a generous assumption, that a refill happens every time the 30-second TTL runs out. A sliding window adds one strongly consistent read per request, which adds one million read units (USD 0.14).

The ECPUs for the Valkey variant are set generously at 10 ECPUs per request. A simple read or write is 1 ECPU per KB, but I have not measured how many a script consumes. Even at that generous figure the cost is USD 0.03, so at this scale the minimum charge for storage is almost the whole amount.

Comparing the two subtotals, the DynamoDB variant is far cheaper at one million requests a month. DynamoDB writes reach USD 7.37 a month at roughly 10 million writes. It is worth doing this calculation once before deciding that a cache means Valkey.

Some things are not in the table. That means they were not included, not that they are zero. One is data transfer for sending responses to the internet. The other is data transfer to the public endpoint, which according to the pricing page costs the application side USD 0.01 per GB within the same Region.

**When it gets hammered.** This API has no authentication, and anyone who knows the URL can call it. Three things stop a flood of requests. They are the stage throttling (10 requests a second in total), the rate limit in the app (5 calls a minute per address), and the cap on the table.

Suppose 10 requests a second, the full amount the throttling allows, continue for 30 days. That is 25.92 million requests. Under the same assumptions as the table above (30 ms on average, 0.5 KB of logs), the list price of the DynamoDB variant is as follows.

| Item | List price |
| --- | --- |
| API Gateway HTTP API requests (25.92 million) | 33.44 |
| Lambda requests and duration | 7.78 |
| CloudWatch Logs | 9.39 |
| DynamoDB writes (26,182,800 units) | 18.72 |
| DynamoDB reads (13,003,800 units) | 1.85 |
| Total (list price) | **71.18** |

That is about USD 71 a month. As long as the throttling is working, this amount is a rough ceiling for the stack. A request the app refuses with 429 is still charged for API Gateway, for Lambda, and for the write whose condition failed. The amount therefore drops very little even when most requests get a 429. Whether API Gateway charges for a 429 returned by throttling has not been checked. Data transfer for the responses is not included either.

The rate limit in the app does nothing against a caller who keeps calling from changing addresses, because every address has a fresh budget. What grows in that case is the number of counter items, at most 10 a second. The items are small and TTL deletes them within a few days, but how far they pile up has not been measured.

If the throttling is not working (which is not known until someone deploys and looks), what remains is the cap on the table, at 40 write units and 60 read units a second. Even pinned at the cap for 30 days, the DynamoDB part stops at USD 74.13 for writes and USD 22.16 for reads. The API Gateway and Lambda parts do not stop. After you deploy, check the stage's throttling values once in the console.

In the Valkey variant, the counting moves to ElastiCache and the ceiling is `cacheUsageLimits`. Pinned at 1,000 ECPUs a second for 30 days, the cost is USD 7.00, and with storage staying at its 1 GB limit it is USD 73.73 for 730 hours.

Before real users arrive, add authentication (chapter 06) and, if you need it, AWS WAF. WAF cannot be attached to an HTTP API, however, so that means a setup with CloudFront in front. The web ACL of [chapter 21](/en/chapters/21-security.md), with three rules, is USD 8.00 a month, plus USD 0.60 per million requests. This book does not build a setup with an HTTP API behind CloudFront.

Deleting the stack stops this chapter's charges.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:kv` stops with `Invalid environment` | Check that `examples/14-kv-cache/.env` exists. The variables needed differ for each `KV_STORE` |
| Locally the sixth call gets 429, but more get through after deploying | Check whether you deployed with `KV_STORE=memory`. With memory, each execution environment counts separately |
| A 429 without a `ratelimit-limit` header | API Gateway's throttling refused it, not the app. The API as a whole went past 10 requests a second |
| A 429 before you have made 5 calls | Someone using the same exit IP address called first. The count is per address, not per person |
| Expired items are still in the DynamoDB console | This is normal. TTL deletion can be days late, and the reader checks the expiry |
| `x-cache` stays `miss` | Nothing is being written to the cache. Search `vp run kv:logs` for `cache store failed` |
| `WRONGPASS` in the logs | According to the official troubleshooting table, the cause is an expired token, the wrong user name, missing `elasticache:Connect`, or a cache name that is not lowercase |
| `NOAUTH` in the logs | The client sent a command before authenticating. As far as its source shows, iovalkey sends `AUTH` first, but that is unconfirmed on a real cache |
| The TLS handshake fails | A public endpoint accepts TLS 1.3 only. Check whether the client is pinned to an older version |
| `Valkey did not answer within 1000 ms` | The cache is not being reached, or it is answering slowly. The API keeps answering from the source |
| A sliding window refuses one request sooner than expected | Fractions are rounded down. It is an approximation and does not guarantee exactly the limit |

## If you take this to production

- To tell users apart, count by a verified ID. An IP address lumps together everyone behind the same exit and counts a caller with many addresses separately (chapter 06)
- Set the throttling values to fit your API. 10 requests a second is a practice value, and if you raise it, raise the cap on the table with it. AWS WAF cannot be attached to an HTTP API, so if you need it you have to choose the setup again ([chapter 04](/en/chapters/04-http-api.md)). The rate limit in the app is for sharing out calls fairly, not for absorbing an attack
- Set `RATE_ON_ERROR` to fit what you protect. Use `allow` for a list, and `deny` for something like login attempts, where missing protection does harm
- Review the table's `removalPolicy`. This chapter's table holds only data that can be lost, but if it shares a table with data it owns, use `RETAIN`
- Make the TTL a length you can explain in words. With this chapter's settings you can say that the list is at most 36 seconds old (30 seconds plus 20% of jitter)
- Watch the cache hit rate. `x-cache` is written to the logs. [Chapter 19](/en/chapters/19-observability.md) shows how to count from logs and raise an alarm
- If you use Valkey, decide whether a public endpoint is acceptable. It is protected by IAM, but some organizations do not allow a data store that can be reached from the internet. In that case, set the connection type to VPC and put the function into chapter 11's VPC with it. The `elasticache:ConnectionType` condition key can also prevent public caches from being created
- Separate Valkey users by purpose. This chapter uses `default.iam-user`, which can do anything. In production, create users restricted to the commands and keys they need
- Deploy through the AWS CDK CLI and CloudFormation, for the reason given in chapter 02

## Cleaning up

<!-- section: 14.cleanup -->

```bash
vp run kv:infra:destroy
```

If you deployed the Valkey variant, add the same context.

```bash
vp run kv:infra:destroy -c store=valkey
```

The table, the function, the role, the API, the log group, and the ElastiCache cache are deleted. No final snapshot name is set, so the configuration leaves no snapshot. To confirm the deletion, check that the list of caches in the ElastiCache console is empty. If the cache remains, the charge continues.

Stop the local containers too.

```bash
vp run kv:local:stop
```

All that remains is the storage created by cdkd's bootstrap (chapter 02) and the deployment files in it.

## As a distributed system

This chapter has two owners of state. The shared store (DynamoDB or Valkey) owns the rate limit counts, and the source of truth owns the list. The cache owns nothing.

Here is what has to hold, one sentence each.

- A window lets through at most the limit, however many requests arrive at once. The tests that try to break it pass two requests at once through a store that reads and then writes, and send 50 at once to a real store
- The caller cannot choose whose count a request is added to. The tests that try to break it call from the same address with a different claimed name and `x-forwarded-for` each time, and pass an address that cannot be read
- A copy past its expiry is not returned even if it is still in the store. The test that tries to break it is a DynamoDB that returns an expired item
- With the cache missing, slow, or broken, the response is the same as the source. The tests that try to break it are a store whose reads and writes always fail, a store holding a value that cannot be read, and a lock holder that never returns
- A copy is never older than the TTL. The test that tries to break it is a slow read that straddles an update and a delete

The last one does not mean that an old value is never returned. Old values are returned, and their age has an upper bound.

The second also carries a caveat. What the caller cannot choose is which address a request appears to come from, and a caller with several addresses has that many budgets. The total for everyone is held down by the stage throttling, not by the app.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (rate limiter boundaries and concurrency, the store contracts, the shape of the requests sent to DynamoDB and Valkey, the read-side TTL check, stale reads, stampedes, jitter, the token signature, the app, stack assertions). Type checking. Synth (default and `-c store=valkey`, including the esbuild bundle). Loading the bundled handler in Node.js and invoking it with an event in the API Gateway shape. Running the 22 store contract tests against Valkey 9.1.2 and DynamoDB Local 3.3.1. Starting `dev:kv` with memory, valkey, and dynamodb, and running the `curl` commands from the text. After the count was changed to the source address, I started it again with memory and confirmed that requests with different headers are counted in the same budget (not rerun with valkey and dynamodb).

**Not checked yet.** `kv:infra:deploy`, `kv:smoke`, `kv:logs`, `kv:infra:drift`, and `kv:infra:destroy` have not been run against real AWS. For the stage throttling and the table cap, a test pins that they are in the template, and I read that the source of cdkd 0.296.28 passes them to the AWS API, and that is all. That they take effect, the shape of a 429 returned by throttling and whether it is billed, the behavior when the table cap is reached, and the actual value of `sourceIp` in an API Gateway event have not been checked. `kv:local:start` and `kv:local:stop` were not run, because there was no Docker daemon (Valkey and DynamoDB Local were started as processes, from nixpkgs' `valkey-server` and the jar AWS distributes). Nothing about ElastiCache has been checked on a real cache. In detail, that covers CloudFormation and Cloud Control API accepting `ConnectionType: public` with `UserGroupId: default.iam-user-group`, 1,000 being a valid ECPU maximum in `CacheUsageLimits` (the documentation gives no smallest value for the maximum, and 1,000 is the value the official example uses as a minimum), the hand-written SigV4 token being accepted, iovalkey's `Cluster` reading the cluster topology through a public endpoint, the TLS 1.3 connection, how many ECPUs a script consumes, and how long the cache takes to create and delete. For DynamoDB, the actual time until TTL deletes an item and the response time of the real service have not been checked. `@valkey/valkey-glide` was only read about on npm, and was neither installed nor run. Durable Objects pricing was not checked.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Two exercises, swappable stores | `examples/14-kv-cache/src/stores.ts`, `test/store-contracts.ts` | `test:unit` |
| Counting for a rate limit | `examples/14-kv-cache/src/rate-limit.ts`, `test/rate-limit.test.ts` | `test:unit` |
| Read, then write, and you miscount | `examples/14-kv-cache/src/dynamodb-store.ts`, `test/dynamodb-store.test.ts`, `test/rate-limit.test.ts` | `test:unit`, `kv:test:local` |
| TTL deletes late | `examples/14-kv-cache/src/dynamodb-store.ts`, `test/dynamodb-store.test.ts` | `test:unit` |
| The same thing on Valkey | `examples/14-kv-cache/src/valkey-store.ts`, `test/valkey-store.test.ts`, `test/local-stores.test.ts` | `test:unit`, `kv:test:local` |
| What ElastiCache adds | `examples/14-kv-cache/src/elasticache-token.ts`, `src/valkey-client.ts`, `test/elasticache-token.test.ts` | `test:unit` |
| Cache only what you can afford to lose | `examples/14-kv-cache/src/read-through.ts`, `src/catalog.ts`, `src/contract.ts`, `test/read-through.test.ts` | `test:unit` |
| Reads that pile up when the copy expires | `examples/14-kv-cache/src/read-through.ts`, `test/read-through.test.ts` | `test:unit` |
| Lambda memory as a cache | `examples/14-kv-cache/src/memory-store.ts`, `src/lambda.ts`, `test/memory-store.test.ts` | `test:unit` |
| Edge configuration and CloudFront KeyValueStore | `examples/10-edge/` | - |
| Running it locally | `examples/14-kv-cache/src/app.ts`, `src/caller.ts`, `test/caller.test.ts`, `src/compose.ts`, `src/env.ts`, `src/dev.ts`, `scripts/local-stores.ts`, `scripts/test-local.ts`, `.env.example` | `dev:kv`, `kv:local:start`, `kv:local:migrate`, `kv:test:local`, `kv:local:stop` |
| Getting ready for AWS | `examples/14-kv-cache/infra/lib/kv-cache-stack.ts`, `infra/bin/app.ts`, `infra/test/kv-cache-stack.test.ts`, `cdk.json` | `kv:infra:synth`, `test:unit` |
| Deploying and checking | `examples/14-kv-cache/scripts/smoke.ts`, `scripts/logs.ts` | `kv:infra:diff`, `kv:infra:deploy`, `kv:smoke`, `kv:logs`, `kv:infra:drift` |
| Cost | `data/pricing/` | `test:unit` |
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
