---
title: "28 Multi-Region: Costs, Pitfalls, and Cleanup"
---

# 28 Multi-Region: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers the difference from platforms where you do not pick a Region, the cost, what to look at when something goes wrong, what to add for production, and cleanup.

## If you're coming from a platform where you don't pick a Region

<!-- section: 28.platforms -->

If you have been using Cloudflare Workers, the very premise of this chapter will have felt odd. Workers code runs in the location that receives the request. The developer does not choose which location, and does not design where requests go when one location becomes unavailable. The work this chapter gave to Route 53 is inside the platform. What follows is limited to what was confirmed by reading each company's documentation on 2026-10-13.

Only the code has no place, though. Data has somewhere it lives.

- **D1.** A database has a primary in one location. By default it is placed near where the request to create it was made. Turning on read replication (marked Beta in the documentation) creates read-only replicas in many places, but replication is asynchronous and every write is sent to the primary
- **Durable Objects.** The documentation says an object is created near its first request and does not change location afterwards
- **KV.** Data is written to a small number of central locations and cached at the locations that read it. A change can take 60 seconds or more to be visible elsewhere
- **R2.** A bucket's location is decided at creation, automatically or by a hint. Objects are stored across several data centers within one geographic region

In this chapter's words, D1's shape is "writes in one place, reads in many". Because writes gather in one place, a version check like chapter 05's works wherever the users are. The two `200` answers and one edit that this chapter's tests showed do not happen. In exchange, how fast and how available writes are depends on where the primary is. How D1 behaves when the primary's location becomes unavailable was not in the pages that were read, and was not confirmed. Whether R2 has a feature for replicating across regions was not looked into either.

On Vercel, you choose in the settings which region Functions run in. The default for a new project is `iad1` (Washington, D.C.). Running in several regions is for Pro (up to five) and Enterprise, and naming the regions to fail over to (`functionFailoverRegions`) is for Enterprise. What this chapter assembled from Route 53 and health checks is one setting included in a plan. Vercel's documentation recommends running a function near where its data lives, such as its database. The questions of replication and conflicting writes stay, unchanged, with that database.

On either platform there is far less to think about than on AWS when it comes to where code runs. If all you want is to answer near your users, or to have another location answer when one stops, there is no reason to move.

What keeping two Regions yourself on AWS makes possible is choosing. Which country and which places the two copies are in. Whether writes are replicated asynchronously for speed, or more slowly so that none is lost. What counts as unhealthy, and when to switch. In exchange, everything that has appeared up to this page is yours to keep: two stacks, the replication settings, the health checks, the target numbers, and the list of resources that exist on one side only.

## Cost

<!-- section: 28.cost -->

Amounts are in USD, on demand, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

The two default stacks contain no resource billed by the hour. With the table and the buckets empty and not a single request, the amount computed from the unit prices below is 0.00. Whether small amounts carry a minimum charge was not checked.

For a size that gives a sense of the amounts, the table below assumes a 1 GB table, 10 GB of images, and 100,000 writes a month. It lists what adding Osaka puts on top, and leaves out what the Tokyo side was already costing.

| Item | Per month |
| --- | --- |
| Writes to the Osaka replica (100,000 replicated write request units) | 0.07 |
| Storage of the Osaka replica (1 GB) | 0.00 |
| PITR on the Osaka replica (1 GB) | 0.23 |
| Storage in the Osaka bucket (10 GB) | 0.25 |
| Replication PUTs (10,000) | 0.05 |
| Data transfer from Tokyo to Osaka (1 GB) | 0.09 |
| Subtotal | **0.69** |

With a global table, the unit for writes changes to the replicated write request unit. One write (up to 1 KB) costs one unit per replica. The unit price is USD 0.715 per million in both Tokyo and Osaka, the same as an ordinary write request unit. So one write to Tokyo becomes one unit in Tokyo and one in Osaka, and the charge for writes doubles. The documentation says DynamoDB does not charge data transfer for replication between Regions.

Storage is 0.00 because the first 25 GB of DynamoDB storage is a tier priced at USD 0, per Region. PITR is turned on for both replicas by CDK, so Osaka's share is added.

S3 replication is billed for storage in Osaka, PUTs into Osaka, and data transfer from Tokyo to Osaka. Data transfer is USD 0.09 per GB, and in this table it is the item that grows most directly with volume. Replication PUTs were computed at the price of an ordinary PUT in Osaka.

The next table is what is added only when asked for.

| Setup | Per month |
| --- | --- |
| `-c domain=...` (2 HTTPS health checks, 1 hosted zone) | 2.50 |
| `-c rtc=on` (1 GB replicated, 4 metrics) | 1.22 |

For health checks of AWS endpoints, the first 50 fall in a tier whose base charge is USD 0. HTTPS counts as an optional feature, at USD 1.00 a month per health check. A hosted zone is USD 0.50 a month and adds nothing if you use a zone you already own. This 2.50 is charged without a single request. Queries to alias records are free. Whether the ACM certificates and the API Gateway custom domain names carry a charge was not looked up.

RTC is billed at USD 0.015 per GB replicated, plus the replication metrics. The documentation says the metrics are billed at the rate of CloudWatch custom metrics, and 1.20 of the 1.22 assumes four metrics billed for the whole month. The real number per rule, and whether they are billed in a month with nothing to replicate, was not confirmed. If you are not using the free allowance for custom metrics (10 of them) elsewhere, this line comes to 0.02.

Whether replicated write request units, inter-Region data transfer, or RTC have a free allowance was not looked into. None is subtracted in either table.

## Pitfalls

| When this happens | Look here |
| --- | --- |
| `mr:infra:deploy` fails on the bucket's replication configuration | The destination, Osaka's bucket, does not exist yet. Run `mr:standby:infra:deploy` first |
| `/health/region` in Osaka returns `503` | The table is created by the Tokyo stack. Wait until the Tokyo deploy has finished and `mr:status` shows the Osaka replica as `ACTIVE` |
| `mr:conflict --apply` gives one `409` | Not a failure. The two `PUT` requests were further apart than the replication lag |
| A note written in Tokyo cannot be read in Osaka | Replication lag. If it lasts, look at `ReplicationLatency` in CloudWatch |
| An image deleted in Tokyo is still in Osaka | By default, delete markers are not replicated. This is as designed |
| An image put there before the deploy is not in Osaka | Only objects written after the rule was created are replicated |
| Replication in the other direction is gone after the next deploy | `-c back=on` was left out. Pass the context every time, or write it in `cdk.json` |
| synth says "domain, zoneId and zoneName go together" | Pass the three together |
| synth stops with "Invalid type" | A context value is misspelled. The accepted values are in `infra/bin/app.ts` |
| Tokyo's API returns errors, yet nothing switches | The health check looks at `/health/region` only. While that path returns `200`, the destination does not change |
| `destroy` cannot delete a bucket | Versions are left. Run `mr:empty --apply` first |
| A deploy says the bucket or the table name already exists | This chapter fixes the names. Check that nothing was left behind by an earlier cleanup |

## For production

- **Decide about each thing that exists on one side only.** For sign-in, the secrets, the deploy machinery, the queue, and the alarms on the list on the [Overview page](/en/chapters/28-multi-region.md), decide whether to replicate it, build it in Osaka as well, or accept that it stops. The table and the bucket are the easy part
- **Put alarms on replication lag.** An RPO can be kept only while the lag is watched: `ReplicationLatency` for the table, the replication metrics for the bucket. Make sure the alarm also reaches a Region other than the one being watched
- **Switch regularly.** A setup that has never been switched cannot be expected to work for the first time on the day of a failure. The DynamoDB documentation gives the example of users who move their write Region every day, and notes the benefit that the switching code is exercised daily
- **Do not depend on the control plane to switch.** A procedure that rewrites records by hand may not be available in the middle of a failure. The Route 53 documentation recommends health checks or the routing controls of Amazon Application Recovery Controller. The latter was not looked into
- **Rethink the shape of your writes.** Deciding a write Region per user in advance (what the documentation calls write to your Region) gives the speed of active-active together with a single writer per item. You then have to keep the mechanism that assigns users to Regions
- **Consider MRSC for data that must not be lost.** The RPO becomes zero, in exchange for three Regions, slower writes, and features that stop being available. The pinned cdkd does not appear able to create it, so you would use the AWS CDK CLI
- **Protect the table and the buckets.** That means `RemovalPolicy.RETAIN` and deletion protection. Deletion protection is turned on per replica
- **Make the check after a switch part of the procedure.** Run chapter 22's `check` in Osaka and find attachment records without an image
- **Keep the backups.** Replication carries a mistaken write too, within a second. That is why this chapter's stack keeps PITR on for both replicas

## Cleanup

<!-- section: 28.cleanup -->

```bash
vp run mr:empty
vp run mr:empty --apply
vp run mr:infra:destroy
vp run mr:standby:infra:destroy
```

First, empty the two buckets. A bucket with versioning is not empty until every version and delete marker is gone. `mr:empty` only prints the counts, and with `--apply` it deletes. What it deletes cannot be brought back.

Next, delete the Tokyo stack. The global table is a resource of the Tokyo stack, so the replica in Osaka should go with it at this point. Last, delete the Osaka stack. The order is the reverse of the deploy.

A stack that was deployed with context is deleted with the same context. If you passed `-c domain=...`, pass it to `destroy` too. The hosted zone does not belong to this chapter's stacks, so it remains. Whether the validation records are left in the zone was not confirmed.

As chapter 22 said, deleting a table that had PITR on leaves a system backup that DynamoDB keeps for 35 days. Whether one is left per replica of a global table was not confirmed.

Deleting stacks that span two Regions was never run. In what order cdkd deletes the replicas of a global table, and what is left when it fails halfway, is not known. After cleaning up, check in the console of both Regions that no table and no bucket is left.

## As a distributed system

There are now two owners of the state. The replica in Tokyo and the replica in Osaka each take writes on the assumption that they are right. Chapter 05's invariant was "an update goes through only if the version that was read is still the latest". Only inside one replica can "still the latest" be checked.

This chapter showed two ways to stretch the invariant beyond a Region: have one writer, or reach agreement on every write. Routing does the first, and MRSC does the second. Both are paid for with somewhere being unable to write when a Region is cut off. A setup in which both keep writing under MREC does not stop when cut off, and settles the disagreement afterwards by last writer wins. **When cut off, stop or disagree.** You can choose one, and this chapter chose to disagree for a short time.

Here is what is not closed. In the window around a switch, one of two edits to the same note disappears without a record. The length of the window was estimated, not measured. Chapter 05's counter loses increments when it advances in two Regions at once. The table and the bucket arrive at different speeds, so right after a switch Osaka can hold an attachment record without an image. Each of these was put in a form a test can reproduce. None was fixed.

::: details Verification notes for this chapter

**Checked locally.** On a model that keeps two Regions in memory: replication lag in MREC, two simultaneous edits from two Regions both being told they succeeded while one disappears, chapter 05's check working when writes go to Tokyo, a strongly consistent read not seeing an update made in the other Region, a counter losing an increment, the overwrite after Tokyo is cut off and the write that arrives late and stays, and the two sides merging after both kept writing. In MRSC mode: the `409`, an isolated Region refusing while still answering eventually consistent reads, writing on together with the witness, catching up after returning, stopping when two of the three cannot be reached, and the API returning `500`. The rules of S3 replication (replicas keeping the version ID, objects older than the rule, delete markers by default and when turned on, deletes that name a version, holding while paused, two-way replication not circling, the difference in speed from the table). A health checker's opinion and the 18% aggregate, failover and latency answers, the answer when everything is unhealthy, the parts of the RTO and the RPO verdict, the overwrite by a client holding an old DNS answer, and a read-only standby refusing it. The per-Region wrapper of the API (the header, the health check succeeding, failing, and timing out, failing on purpose for a drill, refusing writes, the environment variables). Chapter 05's repository contract against a replica in both modes. Stack assertions (the list of types, the table being defined in Tokyo only, no consistency mode being named, PITR on both replicas, deletion policies, the buckets' public access settings, the replication rule and RTC, replication in the other direction, the role's name, permissions without wildcards, each function reaching only its own Region's replica, the environment variables, and with a domain the five types, the health check, the record, and the certificate). The type check, synth (the default, every context option together, and stopping on a misspelled value), and a run of `mr:demo`. In addition, the code was broken on purpose in seven places to confirm that the tests fail.

**Not checked yet.** Nothing was run against AWS: not `mr:standby:infra:deploy`, `mr:infra:deploy`, `diff`, `drift`, `destroy`, `mr:status`, `mr:conflict`, or `mr:empty`. No Region failure and no failover was ever caused, so there is no measured RTO or RPO. The following were not confirmed on the real services either. That cdkd can create the global table and its replica, deploy the Osaka stack from the same app, and do so with the bootstrap done for Tokyo. The replication configuration into a bucket with a fixed name, and the second deploy that adds the other direction. Which of two simultaneous edits from two Regions really survives. How writes with the same time are treated. Real values of `ReplicationLatency`. How an MRSC table behaves, and the name of the error the SDK throws in an isolated Region. How long a health check takes to turn unhealthy, the TTL of an alias record that points to an API Gateway domain name, and how long clients take to notice a switch. Creating the three types that go through the Cloud Control API, and two stacks validating a certificate for the same domain. Whether chapter 06's JWT authorizer keeps validating while Tokyo cannot be reached. The number of replication metrics and how they are billed. Deleting stacks that span two Regions, and what is left afterwards. The model only copies the rules in the documentation.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Global tables and the two consistency modes | `examples/28-multi-region/infra/lib/region-stack.ts`, `src/global-table.ts`, `src/replica-repository.ts` | `test:unit` |
| Editing from two Regions at once | `examples/28-multi-region/test/global-table.test.ts` | `test:unit`, `mr:demo` |
| When a Region is cut off | `examples/28-multi-region/test/global-table.test.ts`, `test/failover.test.ts`, `src/regional-app.ts` | `test:unit`, `mr:demo` |
| Replicating the bucket | `examples/28-multi-region/src/bucket-replication.ts`, `test/bucket-replication.test.ts`, `infra/lib/region-stack.ts` | `test:unit` |
| Route 53 health checks and where requests go | `examples/28-multi-region/src/failover.ts`, `src/regional-app.ts`, `src/lambda.ts`, `src/env.ts`, `test/regional-app.test.ts` | `test:unit` |
| Putting numbers on RTO and RPO | `examples/28-multi-region/src/objectives.ts`, `test/failover.test.ts` | `test:unit`, `mr:demo` |
| Run it locally | `examples/28-multi-region/scripts/demo.ts`, `src/local.ts` | `mr:demo`, `test:unit` |
| Getting ready for AWS | `examples/28-multi-region/infra/lib/region-stack.ts`, `infra/bin/app.ts`, `infra/test/region-stack.test.ts`, `src/regions.ts`, `cdk.json` | `mr:infra:synth`, `test:unit` |
| Deploying and checking | `examples/28-multi-region/scripts/mr.ts` | `mr:standby:infra:deploy`, `mr:infra:deploy`, `mr:status`, `mr:conflict`, `mr:infra:drift` |
| A failover drill | `examples/28-multi-region/infra/bin/app.ts`, `src/objectives.ts` | `mr:infra:deploy`, `mr:status` |
| Cleanup | `examples/28-multi-region/scripts/mr.ts` | `mr:empty`, `mr:infra:destroy`, `mr:standby:infra:destroy` |
| Cost | `data/pricing/` | `test:unit` |

**Primary sources** (all checked on 2026-10-13)

- [How DynamoDB global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html), [Using DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.html), [Write modes with DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.prescriptive-guidance.writemodes.html), [Evacuation processes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.prescriptive-guidance.evacuation.html), [Best practices for global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables-bestpractices.html), [Understanding Amazon DynamoDB billing for global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/global-tables-billing.html). The first two pages disagree about which Regions can be combined for MRSC. Tokyo, Osaka, and Seoul can be used under either description
- [Replicating objects within and across Regions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html), [What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html), [Requirements and considerations for replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-requirements.html), [S3 Replication Time Control](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-time-control.html), [Replicating delete markers between buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-marker-replication.html), [Getting replication status information](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-status.html), [Setting up permissions for live replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/setting-repl-config-perm-overview.html), [Using S3 Replication metrics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/repl-metrics.html)
- [How Amazon Route 53 determines whether a health check is healthy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html), [Values that you specify when you create or update health checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html), [Active-active and active-passive failover](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-types.html), [How Amazon Route 53 averts failover problems](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-problems.html), [Latency-based routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-latency.html), [Choosing between alias and non-alias records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html), [Best practices for Amazon Route 53 DNS](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/best-practices-dns.html)
- [AWS::Route53::RecordSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-recordset.html), [AWS::Route53::HealthCheck HealthCheckConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-route53-healthcheck-healthcheckconfig.html), [Configure custom health checks for DNS failover for an API Gateway API](https://docs.aws.amazon.com/apigateway/latest/developerguide/dns-failover.html), [Set up a Regional custom domain name in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-regional-api-custom-domain-create.html), [Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- [Amazon Cognito: Regional data considerations](https://docs.aws.amazon.com/cognito/latest/developerguide/security-cognito-regional-data-considerations.html), [Replicate AWS Secrets Manager secrets across Regions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html)
- AWS Price List bulk API: DynamoDB ([Tokyo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json), [Osaka](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-3/index.json)), S3 ([Tokyo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json), [Osaka](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-3/index.json)), [AWS Data Transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json), [Route 53](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/current/index.json). [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) (the paragraph on replication), [Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/) (optional health check features and the definition of an AWS endpoint)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the dist of the installed package), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (type definitions)
- Cloudflare: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/), [D1: Global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [D1: Data location](https://developers.cloudflare.com/d1/configuration/data-location/), [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [Durable Objects: Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/), [R2: Data location](https://developers.cloudflare.com/r2/reference/data-location/), [R2: Durability](https://developers.cloudflare.com/r2/reference/durability/)
- Vercel: [Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region)

:::
