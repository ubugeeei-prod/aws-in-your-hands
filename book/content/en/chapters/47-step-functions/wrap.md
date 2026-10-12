---
title: "47 Step Functions: Costs, Pitfalls, and Cleanup"
---

# 47 Step Functions: Costs, Pitfalls, and Cleanup

## Costs

<!-- section: 47.cost -->

Amounts are in USD for the Tokyo Region, pay-as-you-go, before tax. The inputs and unit prices are in [the pricing reference](/en/reference/pricing.md).

The unit price of a Standard workflow is the one from chapter 16: 0.000025 per state transition, with 4,000 a month free. New in this chapter are the prices of an Express workflow: 0.000001 per request and 0.00001667 per GB-second of duration. The duration price drops past 3.6 million GB-seconds in a month. No free allowance for Express could be found on the pricing page.

| Configuration | List price | After the free allowance |
| --- | --- | --- |
| Deployed and never started | 0.00 | 0.00 |
| 1,000 imports a month (Standard, all succeeding) | 0.24 | 0.14 |
| 100,000 lookups of 10 notes a month (Express) | 0.20 | 0.20 |
| The same lookups as a Standard workflow | 32.57 | 32.47 |

An import is counted as 9 state transitions per execution: the seven states it passes, plus one each for start and end. That count follows the pricing page's example and is an estimate, not something checked against a bill. Nearly all of the amount is state transitions. DynamoDB, S3, SQS, and SNS together stay under 0.02.

Taking the way back does not by itself add state transitions. An import the scan refused passes `RemoveAttachment`, `RemoveNote`, and `RolledBack` in place of `Publish`, `Notify`, and `Imported`, which is 9 again. What adds to the count is retries. Each retry is counted as a state transition, so if 1,000 imports each retry three times while the service they call is down, 3,000 are added. `MaxAttempts` in a `Retry` is also a setting that caps the bill.

The two lookup rows extend the sum on [the overview page](/en/chapters/47-step-functions.md) to a month. The 300 ms of duration is an assumption. What Express really bills can be read from what `sfn:digest` prints, or from the `ExpressExecutionBilledDuration` and `ExpressExecutionBilledMemory` metrics.

The logs of an Express workflow are billed at CloudWatch Logs' vended logs rate. This stack sends `ERROR` only, so nothing is sent unless something fails. At the `ALL` level every entry to and exit from a state becomes a log event, and for a workflow that runs often the logs can cost more than the executions. The vended logs rate was not looked up for this chapter.

Deleting the stack stops this chapter's charges.

## Pitfalls

| If this happens | Look here |
| --- | --- |
| The deploy fails to create a state machine because the role cannot be assumed | Do the conditions in the role's trust policy (`aws:SourceArn`) fit the form of the state machine's ARN? They are the conditions chapter 16 uses, and were not checked on the real service |
| An execution fails in its first state with `States.QueryEvaluationError` | The input lacks a field the definition reads. `sfn:start` checks it against the schema before starting, but nobody does when you start from the console or the CLI |
| No error, and yet a key comes out as `attachments//` | A catcher has no `Output`, and the next state received only the error. `&` joins a side with no value as an empty string |
| `sfn:start` answers `ExecutionAlreadyExists` | An import with this owner and note ID has already ended. A name cannot be reused for 90 days after its execution ended |
| An execution ends with `NoteIdTaken` | Another import wrote the item with that note ID. This execution wrote nothing, so there is nothing to clean up |
| An execution stays in `WaitForScan` | Nobody is returning the token. Return it with `sfn:callback`. If nothing is returned, the heartbeat is missed after five minutes, and after one retry the execution goes on to the compensations |
| `sfn:callback` fails with `TaskTimedOut` | The task that token belonged to has already timed out. A message with a new token should have arrived from the retry |
| An execution is `FAILED` in `Publish`, `RemoveAttachment`, or `RemoveNote` | It stopped as designed. Fix the cause (a permission, the service being called) and continue with `sfn:status --redrive` |
| A redrive fails again at once | An execution that ended with `ImportRolledBack` or `NoteIdTaken` only re-enters its `Fail` state. And if you fixed the definition, the redrive still runs the old one |
| A notice arrives twice | The answer of `Notify` was lost and it was retried. If the `saga` message attribute is the same, both are notices of the same import |
| `sfn:digest` prints `FAILED` and you cannot tell why | Is there an `ERROR` log in the log group? If no log ever appears, see whether the account has reached the limit of CloudWatch Logs resource policies per Region (10) |
| The lookup answers `missing` for a note that was imported | Is the note's `phase` `ready`? The note of an import that stopped before `Publish` is still `pending` |

## For production

- Tell a person about an import that stopped. This chapter's invariant protects an execution that stopped among its compensations only as far as "it can be continued". Pick up `FAILED` and `TIMED_OUT` with an EventBridge rule and notify, or put an alarm on `ExecutionsFailed`. Without that, an unpublished note and its attachment stay where they are and nobody notices
- Start imports through an API. In this chapter a script takes `owner` as an argument. A real entry point takes the owner from the token of [chapter 06](/en/chapters/06-auth.md) and checks that `upload` lies under that owner's `inbox/`
- Add the scanner. It has the shape of chapter 08's worker: it reads the queue, sends `SendTaskHeartbeat` when the work is long, and returns the result at the end. It treats two requests for the same file, and an answer refused with `TaskTimedOut`, as ordinary events
- Decide how this relates to chapter 05's limit on notes. The import writes the item without going through chapter 05's repository, so it does not count the notes per owner. If it writes to the same table, it needs a step that raises the count, and a compensation for it
- Decide whether the history of the Standard workflow should outlive 90 days. If so, give the Standard workflow a `LoggingConfiguration` as well and send it to CloudWatch Logs, remembering that the inputs and outputs contain the notes
- Decide the procedure for changing a definition. Running executions stay on the old one. For a workflow with long waits, use versions and aliases, and do not delete an old version until its executions have ended
- Keep the table and the bucket from being deleted with the stack. Both are `RemovalPolicy.DESTROY`
- Think again about shipping the lookup in this form. It is a small example made to show Express. To read 10 items, one Lambda function is simpler in its parts and in its pricing. Express fits when a short sequence of calls to several services should be wired together without code

## Cleanup

<!-- section: 47.cleanup -->

```bash
vp run sfn:empty --yes
vp run sfn:infra:destroy
```

The pinned cdkd does not delete a bucket that has objects in it, so the bucket is emptied first. Without `--yes`, `sfn:empty` only counts the objects.

`sfn:infra:destroy` removes the two state machines, the table, the bucket, the queue, the topic, the log group, and the two roles. Executions that are still running go with their state machine. An import that was waiting for its scan disappears without running its compensations, so look at `sfn:status` first and make sure nothing is `RUNNING`.

What remains is the storage that cdkd's bootstrap created ([chapter 02](/en/chapters/02-toolchain.md)) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** 66 tests. Interpreter tests (how each retrier counts its retries and how long it waits, held against the documentation's examples, `MaxDelaySeconds`, `FULL` jitter, `MaxAttempts: 0`, what `States.TaskFailed` and `States.ALL` match, an expression with no value, a catcher's output, the evaluation order of `Assign`, a task token per attempt, the items and order of a `Map`, a failing iteration). Import tests (running to the end, each of three steps refused every time and each done with its answer lost every time, a scan that refuses and a scan that fails, a step that runs twice, the duplicated notice, the retry after a missed heartbeat, a failing `Notify`, a failure past `Publish` and its redrive, a failing compensation and its redrive, a compensation that runs twice, two imports of one note ID, two definitions broken on purpose, the definition's targets and timeouts, the schemas of the input and the messages). Lookup tests (an unpublished note and another owner's note stay hidden, the same answer and no write when it runs twice, a retried read, no call pattern Express cannot run). The table sent to TestState against the interpreter. Stack assertions (resource types, deletion settings, nothing public, trust policies, permissions, the template's definition equal to the function's output, the definition taken from the template walked by the interpreter). The type check and the synth. `sfn:local` was run in the three ways shown on [the local page](/en/chapters/47-step-functions/local.md).

**Not checked yet.** Nothing has been run against AWS. None of `sfn:infra:diff`, `sfn:infra:deploy`, `sfn:start`, `sfn:callback`, `sfn:status`, `sfn:digest`, `sfn:test-state`, `sfn:infra:drift`, `sfn:empty`, or `sfn:infra:destroy`. So the following are unconfirmed on the real service. That the local interpreter gives the results Step Functions gives (including the evaluation of the JSONata expressions, how retriers and catchers are chosen, and an array of one element). The default of a missing `Output`. That cdkd creates a state machine from a JSONata definition, and an Express one with a `LoggingConfiguration`. That the trust policy conditions on the roles are accepted. That each state's permissions suffice. That the DynamoDB condition expressions behave as intended, and the name of their error. The error name when the copy source is missing. That an object given as `MessageBody` arrives as a JSON string. The error name of a missed heartbeat. That a retry is given a new token. That a redrive continues from a compensation state. The real number of state transitions (including how the iterations of a `Map` are counted), and the duration and billed memory of the Express workflow. Whether cdkd can create versions and aliases. Distributed Map, `Parallel`, `Wait`, and `.sync` were only read about and have no code. Cloudflare Workflows and Vercel Workflows were only read about as well.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture | `examples/47-step-functions/src/saga.ts`, `src/digest.ts`, `infra/lib/step-functions-stack.ts` | - |
| Standard and Express | `examples/47-step-functions/src/saga.ts`, `src/digest.ts`, `test/digest.test.ts` | `test:unit` |
| The state language | `examples/47-step-functions/src/asl.ts`, `src/saga.ts`, `src/interpreter.ts`, `test/interpreter.test.ts` | `test:unit` |
| Calling a service | `examples/47-step-functions/src/saga.ts`, `src/interpreter.ts`, `test/saga.test.ts` | `test:unit` |
| Retry and Catch | `examples/47-step-functions/src/asl.ts`, `src/saga.ts`, `src/interpreter.ts`, `test/interpreter.test.ts` | `test:unit` |
| The saga | `examples/47-step-functions/src/saga.ts`, `src/invariant.ts`, `test/saga.test.ts` | `test:unit` |
| Choice, Map, Parallel, and Wait | `examples/47-step-functions/src/digest.ts`, `src/interpreter.ts`, `test/digest.test.ts`, `test/interpreter.test.ts` | `test:unit` |
| Run it locally | `examples/47-step-functions/src/interpreter.ts`, `src/local-world.ts`, `src/local.ts`, `scripts/run-local.ts` | `sfn:local`, `test:unit` |
| Tests that try to break it | `examples/47-step-functions/test/saga.test.ts`, `test/harness.ts`, `src/invariant.ts`, `src/local-world.ts` | `test:unit` |
| TestState | `examples/47-step-functions/src/test-state-cases.ts`, `test/test-state-cases.test.ts`, `scripts/test-state.ts` | `sfn:test-state`, `test:unit` |
| The stack | `examples/47-step-functions/infra/lib/step-functions-stack.ts`, `infra/bin/app.ts`, `infra/test/step-functions-stack.test.ts`, `cdk.json` | `sfn:infra:synth`, `test:unit` |
| Deploy and check | `examples/47-step-functions/scripts/start.ts`, `scripts/callback.ts`, `scripts/status.ts`, `scripts/digest.ts` | `sfn:infra:diff`, `sfn:infra:deploy`, `sfn:start`, `sfn:callback`, `sfn:status`, `sfn:digest`, `sfn:infra:drift` |
| Changing a definition | `examples/47-step-functions/scripts/status.ts`, `infra/lib/step-functions-stack.ts` | `sfn:status` |
| Making it visible | `examples/47-step-functions/infra/lib/step-functions-stack.ts`, `scripts/status.ts` | `sfn:status` |
| Costs | `data/pricing/` | `test:unit` |
| Cleanup | `examples/47-step-functions/scripts/empty.ts` | `sfn:empty`, `sfn:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- Workflow types and the language: [Choosing workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html), [Transforming data with JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html), [Passing data between states with variables](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html), [the Amazon States Language specification](https://states-language.net/spec.html)
- States: [Task](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html), [Choice](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html), [Map](https://docs.aws.amazon.com/step-functions/latest/dg/state-map.html), [Inline mode](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-inline.html), [Distributed mode](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-distributed.html), [Parallel](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html), [Wait](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html)
- Calls and errors: [Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html), [AWS SDK integrations](https://docs.aws.amazon.com/step-functions/latest/dg/supported-services-awssdk.html), [DynamoDB](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ddb.html), [SQS](https://docs.aws.amazon.com/step-functions/latest/dg/connect-sqs.html), [SNS](https://docs.aws.amazon.com/step-functions/latest/dg/connect-sns.html), [Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- Operations: [Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html), [Redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html), [Versions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html), [Aliases](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-alias.html), [CloudWatch Logs](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html), [CloudWatch metrics](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html), [EventBridge](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html), [IAM role](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html)
- Testing: [Testing with the TestState API](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html), [Step Functions Local (unsupported)](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)
- API reference: [StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html), [StartSyncExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartSyncExecution.html), [SendTaskSuccess](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html), [SendTaskHeartbeat](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskHeartbeat.html), [UpdateStateMachine](https://docs.aws.amazon.com/step-functions/latest/apireference/API_UpdateStateMachine.html), [TestState](https://docs.aws.amazon.com/step-functions/latest/apireference/API_TestState.html)
- S3 and DynamoDB: [DeleteObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html), [CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html), [Reserved words in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)
- Pricing: [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/), AWS Price List bulk API: [Step Functions](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json)
- Cloudflare and Vercel: [Cloudflare Workflows](https://developers.cloudflare.com/workflows/), [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/), [Vercel Workflows](https://vercel.com/docs/workflow)
- [The npm registry's data for jsonata](https://registry.npmjs.org/jsonata) and the installed package's type definitions, [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) (checked in the dist of the installed package)

:::
