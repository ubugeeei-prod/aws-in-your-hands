---
title: "38 Data Movement: Costs, Pitfalls, and Cleanup"
---

# 38 Data Movement: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers moving data between Cloudflare R2 and S3, the cost, where things go wrong, what to add for production, and cleanup.

## Moving between R2 and S3

<!-- section: 38.cloudflare -->

What someone coming from Cloudflare wants to move usually sits between R2 and S3. Both directions were checked in each side's documentation (2026-10-13).

**From S3 to R2.** Cloudflare has two tools. Super Slurper copies the contents of a bucket in S3 or elsewhere into an R2 bucket in one job. You choose whether a key that already exists in R2 is overwritten or skipped, and the default is to overwrite. Objects over 1 TB, and objects in the Glacier classes other than Glacier Instant Retrieval, are skipped. Sippy copies an object to R2 the first time it is requested, reading it from the source and returning it as it does so. It is a tool for moving data little by little, as it is used, with no bulk copy. Its page says that once an object has been copied, later changes on the source side are not reflected in R2. Both pages warn that an ETag after the move is not guaranteed to equal the original.

Both sides charge. According to R2's pricing page, the Class A operations Super Slurper makes on the R2 bucket are billed. On the AWS side, data that leaves S3 for somewhere outside AWS is charged for data transfer. The Price List's rate for the Tokyo Region is USD 0.114 per GB for the first 10 TB. The Super Slurper and Sippy pages state no amount for this charge. Sippy's page explains that copying within the flow of the application's requests reduces the transfer fees a migration causes.

**From R2 to S3.** The two pages read in Cloudflare's documentation were both tools for the direction into R2. For the other direction there is DataSync. DataSync's documentation names Cloudflare R2 among the other clouds' storage it works with. R2 is registered as a DataSync object storage location. The endpoint is `<account ID>.r2.cloudflarestorage.com`, and you give it an access key and a secret key.

Whether an agent is needed depends on the mode. In Enhanced mode, a copy between another cloud's object storage and S3 runs without an agent. In Basic mode, an agent has to run as an EC2 instance. Enhanced mode's price, in Osaka and Tokyo alike, is USD 0.55 per execution and USD 0.015 per GB. On the R2 side, the pricing page says data going out is not charged for transfer. Reads are counted as Class B operations. What AWS charges for receiving the data was not looked into.

One point needs care. DataSync's documentation says an execution can fail on copying tags with a cloud that does not support object tags. In that case set `ObjectTags` to `NONE`. Whether R2 supports tags was not checked. The author has not run a copy in this direction either.

Which is better depends on who reads the data. If the only readers are an application on Cloudflare and users on the internet, there is reason enough to leave it in R2, where data going out costs nothing. The realistic use is to carry to S3 only the part you want to process on AWS, such as the analysis of [chapter 26](/en/chapters/26-analytics.md) or input to the models of [chapter 17](/en/chapters/17-ai.md).

## Cost

<!-- section: 38.cost -->

Amounts are in USD, pay as you go, before tax. The DataSync and S3 rates come from the AWS Price List for Tokyo and Osaka. The calculations are in [Pricing calculations](/en/reference/pricing.md).

First, when nothing runs. DataSync's pricing page says there are no upfront costs and no minimum charges. Locations and tasks are not billed for existing. All that the two stacks cost when deployed without `sourceLocation` is the storage of what is in the buckets.

Next, with the schedule enabled. The task runs even on a day with nothing to copy and examines the buckets on both sides. Take a bucket of 10,000 attachments, 10 GB in all, in which nothing changes for a month.

| Item | Per month |
| --- | --- |
| DataSync (Basic mode, 0 GB copied) | 0.00 |
| S3 requests (Tokyo and Osaka, 30 executions) | 0.64 |
| Subtotal | **0.64** |

The 0.64 comes from assumed request counts. Each execution was counted as one LIST per prefix and one HEAD per object on both sides, and one read of the tags per object on the source side. The documentation says DataSync sends LIST and HEAD requests on every execution and that the HEAD requests are charged even when nothing is moved, but it gives no counts. The real numbers are not known until you see the bill. What is certain is that this cost is **proportional to the number of objects in place, not to the amount moved**.

The first execution moves everything.

| Item | List price |
| --- | --- |
| DataSync (Basic mode, 10 GB) | 0.13 |
| Data transfer between Regions (Tokyo to Osaka, 10 GB) | 0.90 |
| S3 requests | 0.08 |
| Archive storage (10 GB, one month) | 0.25 |
| Subtotal | **1.35** |

The largest line is not DataSync but the data transfer across Regions. At USD 0.09 per GB it is about seven times DataSync's USD 0.0125. Moving to a second bucket in the same Region removes that line.

Running the same month in Enhanced mode adds the execution fee.

| Item | Per month |
| --- | --- |
| Enhanced mode execution fee (30 executions) | 16.50 |

The 16.50 assumes that an execution that copies nothing is charged the fee. The pricing page says Enhanced mode tasks are charged a fee per execution, but not how an execution that moved nothing, or one that failed, is treated.

Some things are left out. Function invocations, SNS notifications, and log group storage are expected to come to less than a cent together at a few events a day; they were not calculated. Old versions in the archive are each charged storage in full for their 30 days. No free allowance is deducted in any table. No mention of a free allowance for DataSync was found on its pricing page.

## Where things go wrong

| When this happens | Look here |
| --- | --- |
| Creating a location fails | Check the role's policy and its trust policy. The CloudFormation reference also says AWS STS has to be activated in that Region |
| An execution does not start, with a network connection error | In Basic mode, the task is in a different Region from the destination. Create the task in the same Region as the destination location |
| An `ERROR` notice arrives every night | See whether `VerifyMode` verifies everything. On a live bucket, verify only what was copied |
| The notices stopped one day | Tell apart a run of successes from a stopped schedule. Look at `Schedule` in `aws datasync describe-task` |
| An `unreadable_event` notice arrives | The real event's shape differs from this chapter's schema. Read the field names in the function's log and correct the schema |
| Nothing appears in the log group | With `BASIC`, nothing does when there are no errors. If there are errors and still nothing, check the resource policy |
| Some objects are not carried | Keys that begin with `/` or contain `//`, `/./`, or `/../` cannot be carried in Basic mode. Objects in Glacier Flexible Retrieval and Deep Archive cannot be read until restored |
| The S3 request charges went up | The number of objects went up. Narrow the scope with filters or widen the schedule's interval |
| The archive is larger than the source | `PRESERVE` keeps what was deleted in the source. Old versions also stay for 30 days |
| `AccessDenied` that names KMS | The bucket uses SSE-KMS. Put the DataSync role in the key's policy. DataSync cannot work with an SSE-C bucket |
| `move:archive:infra:destroy` cannot delete the bucket | Versions remain. Run `move:empty --yes` first |

## For production

- **Put the archive in another account.** A copy in the same account is deleted along with everything else when the account's credentials leak. "Into another account's bucket" on [the Design and Build page](/en/chapters/38-data-movement/build.md) is that shape
- **Decide beforehand what happens to deleted data.** `PRESERVE` is strong against accidents and weak against promises made to users. `REMOVE` is the reverse. Which to use is decided not by technology but by what the application promises its users
- **Report the absence of success.** A failure notice alone misses the case in which the notice itself does not arrive. Watch the time since the last success
- **Write the lag bound down as a number.** With this chapter's settings it is 26 hours normally and 50 hours when one failure is tolerated. If you want less, choose S3 Replication from [chapter 28](/en/chapters/28-multi-region.md) over a tighter schedule
- **Try the way back at least once.** Restoring from the archive needs a task in the opposite direction, or `aws s3 sync`. This chapter does not build the restoring side. As chapter 22 said, a copy you have never restored from cannot yet be called a copy
- **Make the archive bucket outlive its stack.** This chapter uses `RemovalPolicy.DESTROY` because it is an exercise
- **Keep task reports.** They record, for each execution, what was moved and what was skipped. Enable them for data that needs an audit trail
- **Review the mode as the numbers grow.** Before objects and prefixes together approach 25 million, create the task again in Enhanced mode. The daily execution fee comes with it

## Cleanup

<!-- section: 38.cleanup -->

```bash
vp run move:empty
vp run move:empty --yes
vp run move:archive:infra:destroy
vp run move:infra:destroy
```

The first line only counts the versions in the two buckets. The second deletes every version and delete marker. The pinned version of cdkd does not delete a bucket that is not empty, so the buckets are emptied before the stacks go.

<<< @/examples/38-data-movement/scripts/empty.ts{empty}

Delete the Osaka stack first. The task refers to the Tokyo location, so deleting Tokyo first would leave a task whose reference points at nothing. Deleting the Osaka stack deletes the schedule with it, and no more executions start. What happens when the stack is deleted in the middle of an execution was not checked.

One thing remains. The cdkd storage prepared in the Osaka Region stays after the stack is deleted (chapter 02).

None of the cleanup steps was run on AWS.

## Seen as a distributed system

State lives in two places, with one copy flowing between them.

The source bucket holds the truth. The archive is derived from the source, and when the two disagree it is always the source that is right. That is why only the DataSync role may write to the archive: neither the application nor a person writes there. A test pins that something written directly to the archive is overwritten by the next execution.

The archive is behind the source. The bound on the lag is the sum of the schedule's interval, the time an execution takes, and how many failures you put up with. This chapter chose the numbers 26 hours and 50 hours. That number is the bound on the data you lose when you restore from the archive.

Someone who reads the archive in the middle of an execution sees part of the source. Each object is whole. According to S3's documentation, a write to one key is atomic, and a reader sees the old contents or the new. There is no atomicity across keys, though. A note may have three attachments while, for a moment, the archive holds only two of them. DataSync does not know the unit called a note.

The archive lacks one more thing. The records of the attachments are in DynamoDB, and this chapter's copy does not carry DynamoDB. Restoring the archive bucket alone gives back which attachment belongs to which note only as far as the shape of the key tells you. The disagreement between a table and a bucket restored separately is exactly chapter 22's.

The invariant is the one sentence on [the Run It Locally page](/en/chapters/38-data-movement/local.md). That a re-run is safe is not something DataSync promises: it follows from an execution working out "what is missing now" every time when `TransferMode` is `CHANGED`. Chapter 08's worker gets the same property from conditional writes, and this chapter from computing the difference.

::: details Verification notes for this chapter

**Checked locally.** The model of the plan (sorting into new, changed, and same; `PRESERVE` and `REMOVE`; deleting everything when the source listing is empty; not deleting what a filter excludes; overwriting an object that is newer in the archive, and its mark; what `OverwriteMode` `NEVER` protects and what it holds back; `TransferMode` `ALL`; include and exclude together; refusing `ALL` with `REMOVE`; the listing schema). The model of filters (splitting on `|` and escapes, folder matches, wildcards, the include restriction). The model of an execution (convergence and re-runs on a quiet source; finishing an interrupted execution, and the number of writes; a replacement after the copy; a replacement, an upload, and a delete after the listing; `ERROR` under whole-dataset verification; the delay of a delete under `REMOVE`; a direct write to the archive). The event schema and the decision (`ERROR`, `SUCCESS`, other states, other tasks, unreadable events), sending the notification and its failure, the lag bound, the function's environment. Assertions for the two stacks (the list of types, the list of actions per role, the trust policy's conditions, `aws:ResourceAccount`, the order of location and policy, the buckets' public access settings and lifecycle, the task's options and schedule, the log group's resource policy, the rule's pattern, the `deletes`, `excludes`, and `writerRole` layouts, refusing a setting). The type check, synth, and `move:demo`. In addition, the code was broken on purpose in eight places to confirm that tests fail.

**Not checked yet.** Nothing was run against AWS: none of `move:infra:diff`, `deploy`, `drift`, `destroy`, `move:archive:infra:*`, `move:empty`, or the `aws datasync` and `aws sns` commands. The following were not confirmed on the real service. That cdkd can create the two DataSync types and `AWS::Logs::ResourcePolicy` through Cloud Control API. What a deploy to the Osaka Region needs beforehand. That the role is checked when a location is created. That a Basic mode task holding a location from another Region runs. What DataSync judges to be a "difference" (including a tag-only change and objects written in parts). The outcome when the source changes during an execution, and what verification decides. Whether an object a filter excludes is deleted under `REMOVE`. That DataSync's delete becomes a delete marker in the versioned archive. The real shape of the EventBridge event (in the sample, the ARN in `resources` begins `arn:aws:sync:`, while the patterns in the same article use `arn:aws:datasync:`; the schema follows the latter) and the spelling of states other than `SUCCESS` and `ERROR`. The number of S3 requests in an execution that copies nothing, and how the Enhanced mode execution fee is applied. A copy across accounts. A copy to or from R2. The models of the plan and of an execution were written by the author from the documentation and were not compared against DataSync. AWS Data Pipeline cannot be used by a new customer, so nothing of it was run. No end-of-support date was found.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The parts of DataSync, the task's settings | `examples/38-data-movement/src/task.ts`, `infra/lib/archive-stack.ts`, `infra/test/stacks.test.ts` | `test:unit`, `move:infra:synth` |
| Roles and the bucket policy | `examples/38-data-movement/infra/lib/datasync-access.ts`, `infra/lib/source-stack.ts`, `infra/lib/archive-stack.ts`, `infra/test/stacks.test.ts` | `test:unit`, `move:infra:synth` |
| Reading the plan locally | `examples/38-data-movement/src/plan.ts`, `src/filters.ts`, `test/plan.test.ts`, `test/filters.test.ts` | `test:unit` |
| A source that changes on the way | `examples/38-data-movement/src/execution.ts`, `src/memory-bucket.ts`, `test/execution.test.ts`, `test/world.ts` | `test:unit`, `move:demo` |
| Knowing that an execution has ended | `examples/38-data-movement/src/execution-event.ts`, `src/alert.ts`, `src/alert-lambda.ts`, `src/notifier.ts`, `src/env.ts`, `src/lag.ts`, `test/execution-event.test.ts` | `test:unit` |
| Running it locally | `examples/38-data-movement/scripts/demo.ts` | `move:demo`, `test:unit` |
| Putting it on AWS | `examples/38-data-movement/infra/bin/app.ts`, `infra/lib/regions.ts`, `cdk.json` | `move:infra:synth`, `move:infra:diff`, `move:infra:deploy`, `move:archive:infra:diff`, `move:archive:infra:deploy`, `move:infra:drift` |
| Cleanup | `examples/38-data-movement/scripts/empty.ts` | `move:empty`, `move:archive:infra:destroy`, `move:infra:destroy` |
| Cost | `data/pricing/` | `test:unit` |

**Primary sources** (all checked on 2026-10-13)

- AWS Data Pipeline: [What is AWS Data Pipeline?](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/what-is-datapipeline.html), [Migrating workloads from AWS Data Pipeline](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/migration.html), [Pipeline Definition](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/dp-how-pipeline-definition.html), [Migrate workloads from AWS Data Pipeline](https://aws.amazon.com/blogs/big-data/migrate-workloads-from-aws-data-pipeline/) (read as excerpts)
- DataSync user guide: [What is AWS DataSync?](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html), [How AWS DataSync transfers work](https://docs.aws.amazon.com/datasync/latest/userguide/how-datasync-transfer-works.html), [Choosing a task mode](https://docs.aws.amazon.com/datasync/latest/userguide/choosing-task-mode.html), [Where can I transfer my data](https://docs.aws.amazon.com/datasync/latest/userguide/working-with-locations.html), [Do I need an agent?](https://docs.aws.amazon.com/datasync/latest/userguide/do-i-need-datasync-agent.html), [Configuring transfers with Amazon S3](https://docs.aws.amazon.com/datasync/latest/userguide/create-s3-location.html), [Transferring between S3 buckets across accounts](https://docs.aws.amazon.com/datasync/latest/userguide/tutorial_s3-s3-cross-account-transfer.html), [Handling files, objects, and metadata](https://docs.aws.amazon.com/datasync/latest/userguide/configure-metadata.html), [How DataSync handles metadata](https://docs.aws.amazon.com/datasync/latest/userguide/metadata-copied.html), [Verifying data integrity](https://docs.aws.amazon.com/datasync/latest/userguide/configure-data-verification-options.html), [Filters](https://docs.aws.amazon.com/datasync/latest/userguide/filtering.html), [Manifests](https://docs.aws.amazon.com/datasync/latest/userguide/transferring-with-manifest.html), [Scheduling](https://docs.aws.amazon.com/datasync/latest/userguide/task-scheduling.html), [Starting a task](https://docs.aws.amazon.com/datasync/latest/userguide/run-task.html), [Task reports](https://docs.aws.amazon.com/datasync/latest/userguide/task-reports.html), [CloudWatch Logs](https://docs.aws.amazon.com/datasync/latest/userguide/configure-logging.html), [EventBridge events](https://docs.aws.amazon.com/datasync/latest/userguide/events.html), [Quotas](https://docs.aws.amazon.com/datasync/latest/userguide/datasync-limits.html), [Confused deputy prevention](https://docs.aws.amazon.com/datasync/latest/userguide/cross-service-confused-deputy-prevention.html), [Other cloud object storage](https://docs.aws.amazon.com/datasync/latest/userguide/creating-other-cloud-object-location.html), [API: Options](https://docs.aws.amazon.com/datasync/latest/userguide/API_Options.html)
- Events: [EventBridge events reference: AWS DataSync](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-datasync.html), [the AWS Knowledge Center article](https://repost.aws/knowledge-center/datasync-task-execution-notification) (the sample event), [Lambda's retries for asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- Pricing: [AWS DataSync pricing](https://aws.amazon.com/datasync/pricing/) (read as excerpts). AWS Price List bulk API: [DataSync (Osaka)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataSync/current/ap-northeast-3/index.json), [S3 (Osaka)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-3/index.json), [Data Transfer (Tokyo)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)
- CloudFormation and cdkd: [AWS::DataSync::Task](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-datasync-task.html), [Cloud Control API's supported types](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html), [AWS DataSync endpoints](https://docs.aws.amazon.com/general/latest/gr/datasync.html), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the installed package's `dist`)
- S3: [Replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html), [Replication requirements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-requirements.html), [Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html), [API: Object](https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html) (ETag), [the data consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html), [aws s3 sync](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/sync.html)
- Other ways: [AWS Transfer Family](https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html), [Snowball Edge](https://docs.aws.amazon.com/snowball/latest/developer-guide/whatisedge.html) (the notice at the top), [AWS DMS](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html), [Amazon Data Firehose](https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html)
- Cloudflare: [R2 Super Slurper](https://developers.cloudflare.com/r2/data-migration/super-slurper/), [R2 Sippy](https://developers.cloudflare.com/r2/data-migration/sippy/), [R2 Pricing](https://developers.cloudflare.com/r2/pricing/) (all read as excerpts)

:::
