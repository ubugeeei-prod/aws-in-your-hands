---
title: "33 Production Readiness: Costs, Pitfalls, and Cleanup"
---

# 33 Production Readiness: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers what the production settings add to the bill, where things go wrong, what to add when you take this to a project of your own, and cleanup. What was verified, and the primary sources, are in the verification notes at the end.

## Cost

<!-- section: 33.costs -->

This chapter's stacks are not deployed, so the chapter itself costs nothing. The check and the tests run on your machine.

What is calculated here is how much the settings applied by the aspect in [Design and Build](/en/chapters/33-production-readiness/build.md) add to chapter 19's notes API. Amounts are in USD, for the Tokyo Region, on demand, before tax. The calculation itself is in the [Pricing Worksheets](/en/reference/pricing.md).

The aspect changes four settings, and two of them have a price.

| Setting | Quantity | List price | After the monthly free tier |
| --- | --- | --- | --- |
| PITR storage | 1 GB-month | 0.23 | 0.23 |
| Log storage (the part added by going from 7 days to 90) | 2.638 GB-month | 0.09 | 0 |
| Subtotal | | **0.32** | **0.23** |

The assumptions are those of chapter 19's calculation: 1,000,000 requests a month, 1 KB of logs per request, and a table of 1 GB. PITR storage is assumed to equal the table's 1 GB. How the change history that PITR keeps is counted was not confirmed, and it is not included. The free tier for log storage (5 GB a month) is shared by the whole account.

The other two, deletion protection and `DeletionPolicy` with `UpdateReplacePolicy`, have no price item. None of the 27 products in the DynamoDB price list for the Tokyo Region corresponds to deletion protection (checked on 2026-10-12). `Retain`, however, leaves resources behind after the stack is deleted, so the storage of a table or a log group you forgot goes on being charged.

In a month with no calls, the only thing added is PITR storage for a nearly empty table. The alarms (0.30 a month at list price) belong to chapter 19's stack already and are not added by these settings.

The readiness items that have a monthly fee are in other chapters. The web ACL, a customer managed KMS key, and the secret are in [chapter 21's cost section](/en/chapters/21-security/wrap.md), AWS Backup and replication in [chapter 22](/en/chapters/22-recovery/wrap.md), and probes from outside in [chapter 19](/en/chapters/19-observability/wrap.md). Separate accounts, Organizations, and SCPs carry no extra charge, according to chapter 21.

People's time is larger than any of these amounts. Restore drills, on-call, and incident notes are in no price list. Of this chapter's 32 items, few have a cost you can look up.

## Where people get stuck

| Symptom | Where to look |
| --- | --- |
| `ready:gate` fails with `no such template was read` | `AihReadyProduction.template.json` is not in `cdk.out`. Run `vp run ready:infra:synth`. When `ready:gate` is run as a task, the synth runs first |
| It fails with `waiver for ... matches nothing; delete it` | The logical ID the waiver names has changed, or the cause was fixed. The last 8 characters of a logical ID come from the construct's path, so renaming a construct changes them. If the cause was fixed, delete the waiver |
| The output is full of `stateful-delete` | You are reading practice stacks. Name only the stacks you want to pass with `--gate`, and narrow the directories with arguments |
| `function-alarm` appears although there is an alarm | The alarm watches a path this rule does not follow. For a function behind a topic, a schedule, or a state machine, add an alarm on the function itself, or write a waiver with a reason |
| A subscription exists and no notification arrives | The check sees only that a subscription exists. Follow the steps of [chapter 19](/en/chapters/19-observability.md): was the link in the confirmation mail clicked, and does the topic's policy let the alarms publish |
| `ready:check` takes a long time | It synthesizes every stack in the book. Running the script directly, with the `cdk.out` directories you want as arguments, synthesizes nothing |
| A finding stays after the template was fixed | The check reads `cdk.out`. Without a new synth after the code changed, it reads the old template |

## If you take this to a project of your own

- **Start from an existing tool.** cdk-nag and CloudFormation Guard have far more rules than this chapter's 10. Use this chapter's code as the shape for the rules they lack
- **Read the very template you deploy.** On [chapter 20](/en/chapters/20-shipping.md)'s path, the template the CDK CLI synthesizes is what CloudFormation receives. Run the check on that same file. A template synthesized separately may have been given different context values
- **Make passing a condition of deploying.** In chapter 20's workflow, put it before the step that shows the diff, and name the production stacks with `--gate`
- **Date the waivers, and reread them on a schedule.** Reasons go stale. A waiver that says "to be fixed later" usually is not fixed
- **Check the state after the deploy too.** What a template check cannot see is listed on [the page on running it locally](/en/chapters/33-production-readiness/local.md). Run drift detection and the tasks that read the account as often as the check
- **Do not stop at one review before launch.** OPS07-BP02 describes the review as something done before launch and then throughout the life of the workload. Reread it when the architecture changes a lot, and after an incident
- **Make the items yours.** The 32 items in `src/review.ts` are for this book's application. If you take payments you need items for payments, and if you hold personal data you need items for the law that applies. Those are not in this book

## Cleaning up

<!-- section: 33.cleanup -->

Nothing was created in AWS, so there is nothing to delete there.

What stays on your machine is `examples/33-production-readiness/cdk.out`. Git ignores it, and `vp run ready:infra:synth` writes it again at any time. You may delete it.

If you deployed `AihReadyProduction` yourself, it is a different matter. Its table and log group have `Retain`, and the table has deletion protection. Deleting the stack leaves both, and both go on being charged. To remove them, turn off the table's deletion protection, then delete the table and the log group by hand. These steps were not run. If you try this, use a practice account and find out how to remove things first.

## As a distributed system

Three things own state in this chapter: the template the code synthesizes, the record the deploy tool keeps, and what really exists in AWS. [Chapter 02](/en/chapters/02-toolchain.md) split the checks that compare the three into diff and drift. This chapter's check reads only the first.

So a result of the check has a time attached. "Passed" means "the template synthesized at this time said so". If someone removes a retention in the console afterwards, the result does not change. The review items are the same: when the person on call leaves, last month's "yes" is this month's "no".

The invariant of the check itself fits in one sentence. **A stack asked to pass passes only when its template was read, it has no finding, and every waiver was used.** Three tests try to break it: the template of a stack asked to pass is missing, a cause was fixed and only its waiver is left, and something that is not a template is handed in. In none of them does the check answer "passed".

A check that read nothing and reports success is the failure of a check that is hardest to notice. Chapter 21's lint and chapter 22's audit put their guard in the same place.

::: details Verification notes for this chapter

**Checked locally.** Reading a template (an array, an object without `Resources`, and a resource without `Type` are refused; the logical IDs `constructor` and `__proto__` are not skipped; `Ref`, both spellings of `Fn::GetAtt`, and references in `Fn::Sub`; a literal, an absence, and an intrinsic kept apart). A passing and a failing case for each of the 10 rules (a block public access setting that is missing, `false`, the string `"true"`, or an intrinsic; a public ACL; a policy open to everyone, one under a condition, and a `Deny`; PITR and the replicas of a global table; `DeletionPolicy` and `UpdateReplacePolicy` for 12 resource types; the default snapshot of RDS; a log group with no retention and a function that names no log group; alarms watching a function, an API, an alias, a queue, and a dead-letter queue, and a function behind a schedule; an alarm with no recipient and a topic outside the template; throttling; function URL authentication; dead-letter queues). Waivers (a reason is required and has a minimum length, a waiver with neither a resource nor a wording is refused, unused waivers, chapter 21's exceptions taken in). The verdict (reported stacks, stacks asked to pass, a template that was not read). That the two fixtures contain the same types of resources. The 32 review items (every rule is placed under an item, every task exists in `vite.config.ts`). The synthesis and check result of the two stacks, the aspect reaching a table added later, and the aspect adding no resource. The type check, and runs of `ready:infra:synth`, `ready:gate`, and `ready:review`. The check over the book's stacks was run by calling the script directly on the 27 templates of chapters 02 to 24 and the book's site. In addition, the code was broken on purpose in 11 places to confirm that tests fail. One of them did not fail at first, which exposed the mistake of not reading the array in a bucket policy.

**Not checked yet.** Nothing was run against AWS. The findings of the check were never compared with the settings of a deployed account. `AihReadyProduction` was not deployed, so PITR, deletion protection, `Retain`, and the 90-day retention written by the aspect were not seen at work. The meaning of `DeletionPolicy` and `UpdateReplacePolicy` was read in the CloudFormation documentation; no stack deletion and no replacing update was run. That cdkd 0.296.28 reads the two attributes was seen only as strings in its bundled code. `vp run ready:check` was not run as a task (its `infra:synth` dependency synthesizes every stack again). Chapters 25 to 32 and 34 to 36 are named by their stated scope only; their text was not read and their stacks were not checked. The tasks on the deploy page (`account:whoami`, `sec:posture`, `sec:trail:iam`, `sec:secret:versions`, `sec:secret:rotate`, `obs:alarms`, `ship:cfn:diff`, `ship:cfn:drift`, `recovery:status`, `account:budget:create`) were not run for this chapter. cdk-nag, CloudFormation Guard, and the AWS Config managed rules were read about only, and what each Config rule evaluates was not read. How the change history of a table counts toward PITR storage was not confirmed. The end of support of `nodejs24.x` was not looked up. Whether Cloudflare publishes a list of pre-launch checks was not confirmed. Only the openings of the AWS multi-account whitepaper and of the ORR guide were read.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, how an item is written | `examples/33-production-readiness/src/review.ts`, `scripts/review.ts`, `test/review.test.ts` | `ready:review`, `test:unit` |
| Reading a template | `examples/33-production-readiness/src/template.ts`, `test/template.test.ts` | `test:unit` |
| The 10 rules | `examples/33-production-readiness/src/rules/rule.ts`, `src/rules/data.ts`, `src/rules/doors.ts`, `test/rules.test.ts` | `test:unit` |
| An alarm that watches the function | `examples/33-production-readiness/src/rules/watching.ts`, `test/rules.test.ts` | `test:unit` |
| Waivers with a reason | `examples/33-production-readiness/src/check.ts`, `readiness/waivers.json`, `test/check.test.ts` | `test:unit` |
| Applying production settings | `examples/33-production-readiness/infra/bin/app.ts`, `infra/lib/production-settings.ts`, `infra/test/twins.test.ts` | `ready:infra:synth`, `test:unit` |
| Running it locally | `examples/33-production-readiness/scripts/check.ts`, `src/report.ts`, `test/fixtures/` | `ready:gate`, `test:unit` |
| The result for every stack in the book | `examples/33-production-readiness/scripts/check.ts` | `ready:check` |
| The review by area | `examples/33-production-readiness/src/review.ts` | `ready:review`, tasks of the other chapters |
| Cost | `data/pricing/` | `test:unit` |

**Primary sources** (checked on 2026-10-12 unless a date is given)

- AWS Well-Architected Framework: [The pillars of the framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html), [OPS06-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_mit_deploy_risks_plan_for_unsucessful_changes.html), [OPS06-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_mit_deploy_risks_deploy_mgmt_sys.html), [OPS07-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_ready_to_support_const_orr.html), [OPS07-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_ready_to_support_use_runbooks.html), [OPS10-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_event_response_process_per_alert.html), [OPS11-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_evolve_ops_perform_rca_process.html), [SEC01-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_securely_operate_multi_accounts.html), [SEC03-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_permissions_least_privileges.html), [REL01-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_manage_service_limits_aware_quotas_and_constraints.html), [REL09-BP04](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_backing_up_data_periodic_recovery_testing_data.html), [REL12-BP05](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_testing_resiliency_game_days_resiliency.html), [REL13-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_planning_for_recovery_objective_defined_recovery.html), [COST01-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/cost_cloud_financial_management_budget_forecast.html). Of each, the opening description, the desired outcome, and the common anti-patterns were read
- [Operational Readiness Reviews (ORR)](https://docs.aws.amazon.com/wellarchitected/latest/operational-readiness-reviews/wa-operational-readiness-reviews.html), [Organizing Your AWS Environment Using Multiple Accounts](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html) (the opening of each only)
- CloudFormation: [DeletionPolicy attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html), [UpdateReplacePolicy attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatereplacepolicy.html) (2026-10-13), [AWS::Logs::LogGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.html), [AWS::S3::Bucket PublicAccessBlockConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-publicaccessblockconfiguration.html), [AWS::DynamoDB::Table](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html), [PointInTimeRecoverySpecification](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-dynamodb-table-pointintimerecoveryspecification.html), [AWS::CloudWatch::Alarm](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudwatch-alarm.html) (2026-10-13)
- [Configuring CloudWatch log groups](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html) (Lambda), [Working with log groups and log streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html) (2026-10-13), [Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [List of AWS Config Managed Rules](https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-aws-config.html) (rule names only), [the cdk-nag README](https://github.com/cdklabs/cdk-nag/blob/main/README.md), [the CloudFormation Guard README](https://github.com/aws-cloudformation/cloudformation-guard/blob/main/README.md) (its opening only)
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (type definitions of the installed package: `IAspect`, `CfnResource.applyRemovalPolicy`, the replica settings of `CfnGlobalTable`, `BucketAccessControl`, `RetentionDays`), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (`cdkd synth --help`, and strings in the bundled dist)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json) (the offer published 2026-09-11, 27 products). The unit price and free tier of log storage are the ones chapter 19 registered
- [Vercel: Production checklist for launch](https://vercel.com/docs/production-checklist), [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) (the retention limit only)

:::
