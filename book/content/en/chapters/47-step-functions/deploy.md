---
title: "47 Step Functions: Deploy"
---

# 47 Step Functions: Deploy

By the end of [the previous page](/en/chapters/47-step-functions/local.md) the definitions and their tests were in place. This page covers the stack that puts the definitions on AWS, how to check them once they are there, what happens when a definition changes, and how to make the workflows visible. Nothing from the deploy onwards was run.

## The stack

<!-- section: 47.infra -->

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{data}

The table has the keys of chapter 05 and belongs to this stack alone. The bucket holds both `inbox/`, where uploads wait, and `attachments/`, where imported files go. Objects under `inbox/` are gone after a day. The queue is where `WaitForScan` leaves its requests, and a message is gone after a day. The task times out after 30 minutes, so a request a day old has nobody left to answer to.

### A role holds only the APIs the definition calls

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{trust}

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{saga}

In chapter 16 the state machine's role could only invoke functions, and the permissions on the table and the bucket sat in the functions' roles. With no function in between, the state machine's role in this chapter holds the permissions on the table, the bucket, the queue, and the topic directly. It is given only the APIs that the definition's `Task` states call. It cannot read the table, it cannot write under `inbox/`, and it cannot delete anything outside `attachments/`.

For optimized integrations, the page of each integration shows the IAM policy Step Functions generates from a definition. For SDK integrations the documentation says no policy can be generated, so you find the actions yourself. `aws-sdk:s3:copyObject` was given `s3:GetObject` on the source and `s3:PutObject` on the destination, the permissions the CopyObject API reference names. Whether that is enough has not been checked by deploying.

The definition comes from the same function the tests walked. Only the names passed in differ. Locally they are plain strings, and in the stack they are CDK tokens that stand for the table name or the queue URL. `toJsonString` turns the JSON with its tokens into an `Fn::Join`.

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{express}

An Express workflow leaves no execution history in Step Functions. Without logging, there is no way to learn afterwards why a failed execution failed. So the stack creates a log group and sends to it at the `ERROR` level. `includeExecutionData` is `false` because the inputs and outputs contain note titles.

Only the permissions for sending logs have `*` as their resource. The documentation's example does, and explains that these actions accept no resource. This is the only `*` in the stack. Log delivery is best effort, with no guarantee that every execution's logs arrive. For a record that must not go missing, the documentation recommends writing it to something like DynamoDB as a step of the workflow.

### What the tests look at

<<< @/examples/47-step-functions/infra/test/step-functions-stack.test.ts{deployed-definition}

<<< @/examples/47-step-functions/infra/test/step-functions-stack.test.ts{same-definition}

The stack's tests take the definition out of the synthesized template, replace each reference to a resource with its logical ID, and parse the result back into JSON. They check that this JSON equals the definition the function produces when given the same names, and then walk the extracted definition itself with the interpreter. The point is to make sure the definition tested locally and the definition deployed have not become two different things.

<<< @/examples/47-step-functions/infra/test/step-functions-stack.test.ts{least-privilege}

The permission tests pin both the list of actions the role holds and the list of `Resource` values the definition calls. Add a `Task` to the definition and forget the role, or add a permission the definition does not use, and one of the two tests fails.

The template contains 11 resource types (`AWS::DynamoDB::Table`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::SQS::Queue`, `AWS::SQS::QueuePolicy`, `AWS::StepFunctions::StateMachine`), and the pinned cdkd has a dedicated provider for every one. This was checked in the installed package.

```bash
vp run sfn:infra:synth
```

## Deploy and check

<!-- section: 47.deploy -->

Nothing from here on was run. What is ready is the steps and the tasks.

```bash
vp run sfn:infra:diff
vp run sfn:infra:deploy
vp run sfn:start --note-id note-1
vp run sfn:status
```

`sfn:start` puts a small file under `inbox/` and starts one import. `sfn:status` should show the execution as `RUNNING`, with `WaitForScan` as the last state entered. There is no scanner, so the execution waits there until someone returns the token.

```bash
vp run sfn:callback --verdict clean
vp run sfn:status
vp run sfn:digest --ids note-1,nope
```

`sfn:callback` is a task for a person to play the scanner. It takes one message from the queue and calls `SendTaskSuccess` with the token inside. The execution should go on through `Verdict`, `Publish`, and `Notify` and end, and `sfn:digest` should show `note-1` as `found` and `nope` as `missing`. `sfn:digest` calls the Express workflow with `StartSyncExecution` and also prints the billed duration and memory.

`StartSyncExecution` answers HTTP 200 even when the execution failed. Whether it succeeded is in the `status` of the response. The script checks that first and then reads the output with Valibot.

The undoing is checked with another note ID.

```bash
vp run sfn:start --note-id note-2
vp run sfn:callback --verdict infected
vp run sfn:status
```

The execution should end as `FAILED` with `ImportRolledBack`, with no `note-2` left in the table or under `attachments/`. `--fail` reports a failure of the scan itself with `SendTaskFailure`, and `--heartbeat` sends `SendTaskHeartbeat`. Return nothing for five minutes and you see what a missed heartbeat does, and the second message the retry sends. That is also where you learn whether the error is named `States.Timeout` or `States.HeartbeatTimeout`.

The notice topic has no subscriber. `Notify` succeeds and reaches nobody. To see a notice arrive, add a subscription to the topic the way [chapter 15](/en/chapters/15-email.md) or chapter 25 does.

Drift is checked as in the earlier chapters.

```bash
vp run sfn:infra:drift
```

## Changing a definition: versions, aliases, redrive

<!-- section: 47.versions -->

When a state machine's definition is updated, running executions go on to their end with the definition and the role they started with. The new definition applies to executions started after the update. The API reference adds that an execution started right after the update may still use the old definition.

This matters for a workflow with long waits. Change the condition in `Verdict` while 100 imports are waiting for their scan, and those 100 are judged by the old condition. If you assume a new definition reaches old executions, the fault you believe you fixed keeps happening in them.

Redrive is the same. Redriving a failed execution runs the failed state again with the input it had and **the definition the execution started with**. An execution that failed because the definition was wrong is not cured by fixing the definition and redriving. It needs a new execution. What a redrive can cure is a failure whose cause lies outside the definition: a permission, an outage of the service being called, throttling. This chapter's "redrive when a compensation fails" stays within that.

```bash
vp run sfn:status --redrive <execution ARN>
```

A redrive is possible for an execution of a Standard workflow that did not succeed, within 14 days of its end. The retry counts start from 0 again, and the redrive itself is billed as state transitions. Express has no redrive.

When you want to be explicit about which definition is running, use versions and aliases. A version is an immutable, numbered snapshot of the definition and the role at one moment. An alias is a name that points to one or two versions, and when it points to two, you set what share of the starts goes to each. If the callers start executions through the alias's ARN, a new definition can be given to a part of the executions first and its share raised once it holds up. The idea is the same as the Lambda aliases of [chapter 31](/en/chapters/31-progressive-delivery.md).

This chapter's stack creates neither versions nor aliases. The pinned cdkd has no dedicated provider for `AWS::StepFunctions::StateMachineVersion` or `AWS::StepFunctions::StateMachineAlias` that could be found, and whether they can be created through Cloud Control API was not checked.

## Making it visible

<!-- section: 47.observability -->

Step Functions keeps the executions of a Standard workflow as history. Which state was entered with what input, how often it was retried, and what output it left with are recorded per execution, and can be read through the API and the console for 90 days after the end. `sfn:status` reads the last state entered from the tail of this history.

The history contains note titles and bodies too, because the inputs and outputs of the states are recorded as they are. Treat the permission to read history (`states:GetExecutionHistory`) as you would the permission to read the table. Large data, and data that should not be seen, goes to S3 with only the key passed along, as in chapter 16.

How you notice a failure differs by type.

- Standard sends an event to EventBridge's default bus whenever an execution's status changes. A rule that picks up `FAILED` and `TIMED_OUT` and leads to a notification lets a person notice an import that stopped in the middle of its compensations. This chapter's invariant guarantees no more than that a stopped execution can be redriven from where it stopped, so without a way of telling someone, the unpublished note stays. Express does not send this event
- Both types publish metrics in CloudWatch's `AWS/States` namespace, among them `ExecutionsFailed`, `ExecutionsTimedOut`, and `ExecutionThrottled`. The alarms of [chapter 19](/en/chapters/19-observability.md) can be put on them
- For Express, the `ERROR` logs sent to the log group are the only record of what a failure was. The billed memory and duration can also be seen in the `ExpressExecutionBilledMemory` and `ExpressExecutionBilledDuration` metrics

This stack creates no EventBridge rule and no alarm, to keep the example small. They are listed on [the next page](/en/chapters/47-step-functions/wrap.md) among the things to add for production.
