---
title: "58 Ledger: Costs, Pitfalls, and Cleanup"
---

# 58 Ledger: Costs, Pitfalls, and Cleanup

This is the last page of the chapter: the price, where people trip, what to change before production, and cleanup. Cleanup has a caution that is particular to this chapter.

## Cost

<!-- section: 58.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The inputs and unit prices are in [Pricing calculations](/en/reference/pricing.md). I checked the unit prices against the AWS Price List bulk API on 2026-10-13.

Nothing in the default stack is billed by the hour. The digest function does run every hour, though, even with nothing appended. Each run sends S3 one version listing and one fetch of the newest digest, and sends the table one `Query`. A month with no appends costs **USD 0.01** at list price and **USD 0.00** after the monthly free allowances. The largest part is USD 0.0034 for 730 `ListObjectVersions` requests.

Take 100,000 appends a month. An entry is about 300 bytes, and one append is one `Query` for the tail and one write. Digests are taken hourly, 730 times, and the full audit runs once a month. The function is assumed to take 0.5 s at 256 MB. That is not a measurement.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| DynamoDB writes | 100,000 units | 0.07 | 0.07 |
| DynamoDB reads | 116,000 units | 0.02 | 0.02 |
| DynamoDB storage | 0.03 GB | 0.00 | 0.00 |
| S3 PUT and LIST | 1,461 | 0.01 | 0.01 |
| S3 GET | 1,460 | 0.00 | 0.00 |
| S3 storage | 0.001 GB | 0.00 | 0.00 |
| Lambda requests and duration | 730, 91 GB-seconds | 0.00 | 0 |
| CloudWatch Logs | 0.0002 GB | 0.00 | 0 |
| Subtotal | | **0.10** | **0.10** |

Nearly all of it is the appends themselves. What the ledger adds is one read unit for the tail on each append and the hourly requests to S3, a few cents together.

Some things are left out of this calculation. Retries from two writers taking the same number are assumed to be zero. A refused write uses units too. Whether a PartiQL `INSERT` is billed in the same units as `PutItem` was not confirmed. The hourly rule's own invocations of the function are left out, because I could not confirm which line of the price list they fall under. There are 730 a month. Whether Object Lock itself is billed was not checked on the pricing page either. The price list file has no line with Object Lock in its name.

Digests accumulate only in hours that had appends. Each is about 150 bytes, but the function lists every version on each run, so for every 1,000 digests one run's `ListObjectVersions` takes one more page. A year's worth, 8,760 digests, is 9 pages: 6,570 requests a month, USD 0.03. The full audit reads every entry in the ledger. At one unit per 4 KB, a million entries, 300 MB, is 75,000 units, USD 0.01.

After the stack is destroyed, the bucket and its digests remain and keep being billed for storage. At this size the amount shown stays at 0. If you chose compliance mode with a long period, remember, apart from the money, that they cannot be deleted until that day.

## Where people trip

| When this happens | Look here |
| --- | --- |
| `ledger:verify` returns `digest_mismatch` | Something before that number was rewritten after the digest was taken. Restore copies from chapter 22's backups as separate ledgers, verify them, and look for the one that matches the same digest |
| It returns `truncated` | The end is gone. The digest shows that entries existed at least up to that number |
| It returns `digest_hidden` | Someone put a delete marker over a digest. The content is still there. Use CloudTrail to find out who |
| The function keeps failing with `LedgerDamagedError` | What follows the previous digest does not match. Look at `findings` in the log. No new digest is written until it is resolved |
| `BusyError` | Appends to the same ledger overlapped and the number was taken five times in a row. Split the ledger, or send appends through one place |
| `BrokenTailError` | The tail row cannot be read as an entry. Someone has rewritten it. Stop appending and verify |
| After a deploy, an append gets `AccessDeniedException` | Check that the writer's role has the `AppendAccess` policy. Do not fix it by adding `dynamodb:PutItem` |
| The digest's `PutObject` is refused | The function's role can write under `digests/notes/` only. If you changed the ledger's name, change `LEDGER` in the stack too |
| The stack is gone and the bucket is still there | That is by design. See "Cleanup" below |

## Before production

- Decide the retention mode and period. The period is how many years later you must still be able to show that a rewrite happened. A rewrite can be found for as long as at least one digest taken before it still exists. If you choose governance mode, keep the holders of `s3:BypassGovernanceRetention` few enough to count
- Put the digest bucket in another account, so that an administrator of the app's account cannot touch the evidence (chapter 33)
- Protect the table. Set `removalPolicy` to `RETAIN` and enable deletion protection and point-in-time recovery (chapter 22). When a ledger is deleted, the digests tell you that it was. They do not bring the entries back
- Put an alarm on the function's failures (chapter 19). A failure is the news that the ledger stopped matching
- Have the full audit run regularly, by someone other than the operator. If nobody runs it, the digests are just sitting there
- Set the schedule's interval to a length of unprotected time you can accept
- Record data events for the table and the bucket on a trail (chapter 21). What tells you who rewrote something is CloudTrail, not a hash
- Put no personal data in an entry. It cannot be deleted
- Deploy through the AWS CDK CLI and CloudFormation, as chapter 02 explains

## Cleanup

<!-- section: 58.cleanup -->

```bash
vp run ledger:infra:destroy
vp run ledger:purge --bucket <DigestBucketName>
vp run ledger:purge --bucket <DigestBucketName> --apply
```

`ledger:infra:destroy` deletes the table, the function, the roles, the policies, the rule, and the log group. The entries in the table cannot be brought back.

**The digest bucket is not deleted.** From the moment a version in it was written until its retention period is over, either nobody can delete it or only someone with a special permission can. With the default settings that is one day after the last digest was written. If you chose compliance mode and a period, it is that period. Before the date, the only ways are `s3:BypassGovernanceRetention` in governance mode and closing the AWS account in compliance mode.

`ledger:purge` examines every version in the bucket and counts those whose lock has ended and those whose lock has not. Without `--apply` it deletes nothing.

<<< @/examples/58-ledger/src/purge.ts{plan}

With `--apply` it deletes the versions whose lock has ended and the delete markers, and if nothing is still locked, the bucket as well. If something is still locked, it prints when the last lock ends and stops. Run it again after that time. This task never sends a request that lifts a lock.

A bucket to which no digest was ever written can be deleted right away.

If you started DynamoDB Local with `db:local:start`, stop it with `vp run db:local:stop`. Chapter 05's table goes with it.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** I ran the tests of `examples/58-ledger` (83 passed, and the one for DynamoDB Local was skipped), the type check, and `ledger:infra:synth` (12 resources, with a bundle that includes the AWS SDK). I ran `ledger:demo`, and the output in the page is from that run. I confirmed that `shasum -a 256` gives the same value as the pinned hash. I ran the 5 journal rules through both the PartiQL `INSERT` and the conditional `PutItem`, plus one run from append to audit, against DynamoDB Local 3.3.1 (11 tests). That was without Docker, starting the jar AWS distributes directly with Java 21 (port 8058, `-inMemory -sharedDb -disableTelemetry`). `ledger:db:reset:local` and `ledger:test:local` were run as tasks, with the environment variable `DYNAMODB_ENDPOINT` pointing at that port.

**Not checked yet.** Nothing was ever deployed to AWS. `ledger:infra:diff`, `ledger:infra:deploy`, `ledger:append`, `ledger:digest`, `ledger:verify`, `ledger:infra:drift`, `ledger:infra:destroy`, and `ledger:purge` were not run. Nor was `db:local:start`, which starts DynamoDB Local through Docker, run for this chapter.

So the following have not been confirmed on the real services. That the real DynamoDB answers a duplicate PartiQL `INSERT` with `DuplicateItemException`. DynamoDB Local 3.3.1 answered with the name `DuplicateItem`, so the code accepts both. That a role with only `dynamodb:PartiQLInsert` and `dynamodb:Query` can append and cannot overwrite. The units a PartiQL `INSERT` is billed in. That a `PutObject` into a bucket with only a default retention needs just the `s3:PutObject` permission and comes out locked. That the checksum the SDK adds is accepted for a `PutObject` into a bucket with Object Lock. The 412 for `If-None-Match`. The shape of the `ListObjectVersions` answer. The 403 for deleting a locked version, and lifting governance mode. The error name `GetObjectRetention` gives for a version with no lock (`ledger:purge` expects `NoSuchObjectLockConfiguration`). That cdkd can really create the bucket with Object Lock, the rule, and the Lambda permission, and that `destroy` leaves the `RETAIN` bucket.

What the pages say about Object Lock, versioning, and conditional writes, and the in-memory model of the bucket, rest on the S3 user guide alone. The QLDB developer guide answered 404, so the description of QLDB rests on two AWS blog posts (in their Japanese translation) alone. The cost table is computed from unit prices and assumptions, not measured.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What this proves, and what it does not | `examples/58-ledger/test/verify.test.ts` | `test:unit` |
| Entries and hashes | `examples/58-ledger/src/entry.ts`, `src/journal.ts`, `test/entry.test.ts`, `test/journal-contract.ts` | `test:unit`, `ledger:test:local` |
| Guard the number with a conditional write | `examples/58-ledger/src/ledger.ts`, `test/ledger.test.ts` | `test:unit` |
| Give the writer no permission to overwrite | `examples/58-ledger/src/dynamodb-journal.ts`, `infra/lib/ledger-stack.ts`, `test/adapters.test.ts`, `test/dynamodb-local.test.ts` | `test:unit`, `ledger:test:local` |
| Put digests in a bucket with Object Lock | `examples/58-ledger/src/digest.ts`, `src/s3-digests.ts`, `src/memory-digests.ts`, `src/digest-lambda.ts`, `test/digest.test.ts`, `test/memory-digests.test.ts`, `test/digest-lambda.test.ts` | `test:unit` |
| Verification | `examples/58-ledger/src/verify.ts`, `src/audit.ts`, `test/verify.test.ts` | `test:unit` |
| What goes into an entry | `examples/58-ledger/src/events.ts`, `test/events.test.ts` | `test:unit` |
| Reproduce a rewrite | `examples/58-ledger/scripts/demo.ts`, `scripts/local-db.ts`, `.env.example` | `ledger:demo`, `ledger:db:migrate:local`, `ledger:db:reset:local` |
| Tests | `examples/58-ledger/test/`, `infra/test/ledger-stack.test.ts`, `scripts/test-local.ts` | `test:unit`, `ledger:test:local` |
| The stack | `examples/58-ledger/infra/lib/ledger-stack.ts`, `infra/bin/app.ts`, `infra/test/ledger-stack.test.ts`, `cdk.json` | `ledger:infra:synth`, `test:unit` |
| Deploy and check | `examples/58-ledger/scripts/ledger.ts` | `ledger:infra:diff`, `ledger:infra:deploy`, `ledger:append`, `ledger:digest`, `ledger:verify`, `ledger:infra:drift` |
| Cost | `data/pricing/` | `test:unit` |
| Cleanup | `examples/58-ledger/scripts/ledger.ts`, `src/purge.ts`, `test/purge.test.ts` | `ledger:infra:destroy`, `ledger:purge` |

**Primary sources** (all checked on 2026-10-13)

- QLDB's status: [Services in Full Shutdown](https://docs.aws.amazon.com/general/latest/gr/full_shutdown_services.html), [Services in Sunset](https://docs.aws.amazon.com/general/latest/gr/sunset_services.html), [the QLDB product page](https://aws.amazon.com/qldb/) (it redirects to the Aurora page), [Replace Amazon QLDB with Amazon Aurora PostgreSQL for audit use cases](https://aws.amazon.com/jp/blogs/news/replace-qldb-with-amazon-aurora-postgresql/) (Japanese translation), [Migrate an Amazon QLDB Ledger to Amazon Aurora PostgreSQL](https://aws.amazon.com/jp/blogs/news/amazon-qldb-to-aurora-postgresql/) (Japanese translation)
- DynamoDB: [PartiQL insert statements](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.insert.html), [IAM security policies with PartiQL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-iam.html), [the IAM service reference for DynamoDB](https://servicereference.us-east-1.amazonaws.com/v1/dynamodb/dynamodb.json), [Logging DynamoDB operations by using AWS CloudTrail](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/logging-using-cloudtrail.html), [Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- S3: [Locking objects with Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), [Configuring S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html), [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [ListObjectVersions (API reference)](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html), [the IAM service reference for S3](https://servicereference.us-east-1.amazonaws.com/v1/s3/s3.json)
- Tools: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (I read the installed package)
- Prices: the AWS Price List bulk API for [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json), [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json), and [EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json)
- Cloudflare and Vercel: [R2: Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), [Vercel Blob](https://vercel.com/docs/vercel-blob)

:::
