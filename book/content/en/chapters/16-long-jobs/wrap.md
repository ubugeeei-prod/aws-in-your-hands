---
title: "16 Workflow: Costs, Pitfalls, and Cleanup"
---

# 16 Workflow: Costs, Pitfalls, and Cleanup

## What it costs

<!-- section: 16.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The inputs and unit prices are in [the pricing reference](/en/reference/pricing.md).

The new unit price is the state transition of a Standard workflow: USD 0.000025 each, 2.5 cents per thousand. The first 4,000 a month are free, and according to the pricing page that allowance does not expire. Retries and redrives count as state transitions.

Take a month with 10,000 notes of 1 KB in the table, exported once a day.

| Setup | List price | After free allowances |
| --- | --- | --- |
| No notes at all (just deployed) | 0.00 | 0.00 |
| This chapter's default (every page in one invocation) | 0.03 | 0.02 |
| Returning to the workflow after every page | 0.18 | 0.07 |
| The durable-function variant | 0.03 | 0.02 |
| For comparison: a one-hour step, daily, as a Fargate task | 0.52 | 0.52 |

They are all small numbers. An export of this size runs for next to nothing. What to look at is the gap between rows two and three.

The same work and the same output, and the list price differs six times over. The only difference is the number of state transitions. The default setup makes 6 per execution, 180 a month. Returning after every page makes 204 per execution, 6,120 a month, which is over the 4,000 of the free allowance. The size of a checkpoint is a pricing setting too. With a hundred times the notes, row three's state transitions grow a hundredfold, and before that the 25,000-event history limit is reached.

The number of state transitions is an estimate that follows the way the pricing page's example counts. That example counts four for a workflow of two states: the start and the end count as one each. It was not checked against a real bill.

### The price of waiting

Long work comes with waiting: for a person's approval, for an outside service to finish, until tomorrow. What is billed while waiting differs from tool to tool.

- **A Standard workflow.** Only state transitions are billed. Whether a `Wait` state waits a day or a month, the number of transitions before and after is the same
- **An Express workflow.** Duration and memory are billed, so waiting costs that much. And five minutes is the limit anyway
- **Waiting inside a Lambda function.** While a `setTimeout` waits, the function is running. The seconds waited are billed as they are
- **A wait in a durable function.** The function is suspended, and no duration is billed while it waits. What is billed is retention, by the amount of checkpoint data kept
- **Waiting inside a Fargate task.** While the task runs, vCPU and memory are billed even if it does nothing

Put work that waits in a tool that holds no compute while it waits. That is the principle.

The unit prices of durable functions in Tokyo are USD 0.0000106 per operation, 0.33 per GB written, and 0.20 per GB-month retained. No free allowance was found on the pricing page. Row four of the table counts 7 operations per execution.

Deleting the stack removes the state machine, the functions, and the schedule, and this chapter's charges stop.

## Where it goes wrong

| If this happens | Look here |
| --- | --- |
| The deploy fails creating the state machine, saying it cannot assume the role | Do the conditions in the role's trust policy (`aws:SourceArn`) match the form of the state machine's ARN? See also "Not checked yet" at the end of the chapter |
| An execution fails at `ExportPages` with `States.Runtime` or `States.DataLimitExceeded` | `States.ALL` does not retry these two. Is the function returning more than 256 KiB? |
| The `ExportPages` log has a 403, and the step fails after three retries | Does the role have `s3:PutObject` and `s3:GetObject`? The `HeadObject` after a 412 is authorized by `s3:GetObject` |
| An execution succeeds, but the number of notes does not match the table | A note written or deleted during the export may be in it or not. A `Scan` is not a copy as of one instant |
| An execution ends as `ExportDiscarded` | A part disappeared before the manifest was written: someone cleaned the bucket by hand, it took longer than 7 days, or another execution of the same export got as far as `Discard` |
| `export:start` says `ExecutionAlreadyExists` | That ID has been started already. Change `--id`. A name cannot be reused for 90 days after the execution closes |
| A redrive fails again right away | Was the cause fixed? An execution that reached `Discarded` only re-enters the `Fail` state on a redrive |
| An execution stays `RUNNING` forever | Do the `Task` states have `TimeoutSeconds`? This chapter's definition also cuts the whole thing off at six hours |
| The durable function fails for lack of checkpoint permissions | Is the role's resource `function:<name>:*`? A function ARN without `:*` does not match an execution's ARN |
| Invoking the durable function says a qualifier is required | Is it invoked with an alias or a version? `export:durable:start` uses the alias's ARN |

## Before production

- **Make failures noticeable.** This chapter's workflow tells nobody when it fails. Step Functions sends an event to EventBridge when an execution's status changes. Connect that to a notification, or put an alarm on the number of failed executions ([chapter 19](/en/chapters/19-observability.md))
- **Build the way out for an export.** An API that reads the manifest and the parts and hands them to a user. To split by owner, write parts under a prefix per owner, or filter when handing over. This chapter's export mixes everyone's notes in one file
- **Decide on consistency.** If "every note as of the start" is needed, a `Scan` is not enough. DynamoDB has a feature that writes a table out to S3 (export to S3), which can take the state as of a point in time for a table with point-in-time recovery enabled. It was not tried in this chapter
- **Close the gap between `Finish` and `Discard`.** Start executions with a name so that two of the same export do not overlap. Or change `Discard` from "delete" to "write a marker that it was discarded"
- **Keep the state machine's logs.** This chapter leaves the execution history to Step Functions, where it is gone after 90 days. There is a setting that sends it to CloudWatch Logs (`LoggingConfiguration`), which this chapter does not turn on
- **Watch the history limit.** How does the event count that `export:status` shows compare with 25,000? If it gets close, go further per invocation, or split the execution
- **Keep the bucket and the table from being deleted.** Both are `RemovalPolicy.DESTROY`. A table with real notes in it should be `RETAIN`
- **If you use durable functions, decide how versions are handled.** Do not change the names or the order of steps while executions are running. If you must, ship it as a new version and wait for the old executions to end

## Cleaning up

<!-- section: 16.cleanup -->

```bash
vp run export:empty --yes
vp run export:infra:destroy
```

Empty the bucket first: the pinned cdkd does not delete a bucket that has objects in it. Without `--yes`, `export:empty` only counts.

`export:infra:destroy` removes the state machine, the three functions, the schedule, the bucket, and the table. An execution that is still running goes with the state machine. If you deployed with `-c durable=true`, pass the same option when destroying.

What remains is the storage that cdkd's bootstrap created ([chapter 02](/en/chapters/02-toolchain.md)) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** Step tests (the same step a second time, the table changing after a lost answer, a failed write in the middle of a call, a failed read, a stalled worker writing late, two runs of the same export overlapping, the same output whatever the checkpoint size, an empty table). Manifest and compensation tests (a missing part, `Finish` before the last page, `Finish` twice, a `Discard` that stopped halfway run again, never deleting a finished export). Input validation (the ID from the time, an ID that would leave the prefix, damaged progress). Tests that run the workflow definition on the local runner (a lost answer, retries running out and a resume, a restart from the beginning, `ExportCorrupt` going to `Discard` without a retry, a retried `Discard`, every target in the definition existing). The requests sent to S3 and DynamoDB, and the handling of 412, 409, 404, and 403. Tests that run the durable-function variant on the SDK's `LocalDurableTestRunner` (where the steps fall, a failed step redone). Infrastructure assertions (the default and `-c durable=true`). Type checks, and synth of both layouts. Two conditions were also broken on purpose, and each made two tests fail. `export:local` was run three ways: the default, `--notes 450 --lose 2 --break 4`, and `--notes 1000 --pages-per-call 20`.

**Not checked yet.** Nothing has been run against AWS. None of `export:infra:diff`, `export:infra:deploy`, `export:seed`, `export:start`, `export:status`, `export:logs`, `export:infra:drift`, `export:empty`, `export:infra:destroy`, or `export:durable:start`. So the following are unconfirmed on the real service. That cdkd creates the state machine from a `DefinitionString` assembled with `Fn::Join`. That the conditions in the trust policy of the state machine's role are accepted. That Scheduler calls `StartExecution` with `<aws.scheduler.scheduled-time>` replaced in the input, and whether the execution then gets a name. The shape of input and output of a `Task` whose `Resource` is a function ARN. That the `name` of a Lambda exception matches the `ExportCorrupt` catcher. That S3 answers 412 to `If-None-Match: *` and the pinned SDK throws it as an exception with status 412. That `HeadObject` returns metadata keys in lower case. Whether the function keeps running after a `Task` times out. The real numbers of state transitions and history events. How a redrive behaves. The read units of the `Scan` and the functions' run times (the 200 ms and 20 s in the cost example are assumptions). For the durable function: that it is available in the Tokyo Region, that cdkd creates a function with `DurableConfig` and the version and alias, that the role's permissions are enough, that the bundled SDK runs on Lambda, that `DurableExecutionName` prevents a duplicate start, what happens when one invocation hits the function timeout, and the real number of durable operations. ECS tasks and AWS Batch are described only; there is no code. Express workflows were only read about. Cloudflare Workflows too was only read about, not run.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The big picture | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`, `src/workflow.ts` | - |
| Splitting the work | `examples/16-long-jobs/src/job.ts`, `src/note-source.ts`, `src/dynamodb-note-source.ts`, `test/adapters.test.ts` | `test:unit` |
| A step runs twice | `examples/16-long-jobs/src/steps.ts`, `src/export-store.ts`, `src/s3-export-store.ts`, `test/steps.test.ts`, `test/harness.ts`, `test/adapters.test.ts` | `test:unit` |
| The last file makes it visible | `examples/16-long-jobs/src/steps.ts`, `src/job.ts`, `test/steps.test.ts` | `test:unit` |
| Leave the order to the workflow | `examples/16-long-jobs/src/workflow.ts`, `test/workflow.test.ts` | `test:unit` |
| How big a checkpoint | `examples/16-long-jobs/src/steps.ts`, `src/export-pages-lambda.ts`, `src/env.ts`, `test/steps.test.ts` | `test:unit` |
| Running it locally | `examples/16-long-jobs/src/local-workflow.ts`, `src/local.ts`, `scripts/run-local.ts`, `test/workflow.test.ts` | `export:local`, `test:unit` |
| Getting ready for AWS | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`, `infra/bin/app.ts`, `infra/test/long-jobs-stack.test.ts`, `src/finish-lambda.ts`, `src/discard-lambda.ts`, `cdk.json` | `export:infra:synth`, `test:unit` |
| Deploying and checking | `examples/16-long-jobs/scripts/seed.ts`, `scripts/start.ts`, `scripts/status.ts`, `scripts/logs.ts` | `export:infra:diff`, `export:infra:deploy`, `export:seed`, `export:start`, `export:status`, `export:logs`, `export:infra:drift` |
| The same thing as a durable function | `examples/16-long-jobs/src/durable-export.ts`, `src/durable-lambda.ts`, `test/durable.test.ts`, `scripts/durable-start.ts`, `infra/lib/long-jobs-stack.ts` | `test:unit`, `export:durable:start` |
| Steps that do not fit in Lambda | (no code) | - |
| What it costs | `data/pricing/` | `test:unit` |
| Cleaning up | `examples/16-long-jobs/scripts/empty.ts` | `export:empty`, `export:infra:destroy` |

**Primary sources** (all checked on 2026-10-12)

- Step Functions: [Choosing workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html), [Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html), [Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html), [Invoke an AWS Lambda function](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html), [Handling error conditions (tutorial)](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-handling-error-conditions.html), [ResultPath](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html), [Redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html), [Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html), [Best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html), [Creating an IAM role for your state machine](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html), [Run Amazon ECS or Fargate tasks](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html), [Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html), [Event delivery with EventBridge](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html), [StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html), [AWS::StepFunctions::StateMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html)
- Lambda durable functions: [Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html), [Basic concepts](https://docs.aws.amazon.com/lambda/latest/dg/durable-basic-concepts.html), [Idempotency](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html), [Invoking](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html), [Security and permissions](https://docs.aws.amazon.com/lambda/latest/dg/durable-security.html), [Infrastructure as Code](https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html), [Supported runtimes](https://docs.aws.amazon.com/lambda/latest/dg/durable-supported-runtimes.html), [Durable execution SDK (metering)](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html), [Durable functions or Step Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-step-functions.html), [Best practices](https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html)
- AWS Durable Execution SDK Developer Guide: [Key concepts](https://docs.aws.amazon.com/durable-execution/getting-started/key-concepts/), [Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/). [@aws/durable-execution-sdk-js 2.6.0](https://www.npmjs.com/package/@aws/durable-execution-sdk-js/v/2.6.0) (README and type definitions)
- Lambda: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [The Node.js context object](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html)
- EventBridge Scheduler: [Adding context attributes](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html), [Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html), [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
- S3 and DynamoDB: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html), [Scanning tables in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html), [DynamoDB data export to Amazon S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html)
- AWS Batch: [What is AWS Batch?](https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html), [Fargate compute environments](https://docs.aws.amazon.com/batch/latest/userguide/fargate.html)
- Pricing: [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/), [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/), AWS Price List bulk API: [Step Functions](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json), [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- Cloudflare: [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [Workflows](https://developers.cloudflare.com/workflows/), [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), [Workflows: Limits](https://developers.cloudflare.com/workflows/reference/limits/), [Workflows: Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [register-providers.ts of cdkd v0.296.28](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) (checked in the dist of the installed package), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
