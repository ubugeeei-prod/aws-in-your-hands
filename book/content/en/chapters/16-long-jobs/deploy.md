---
title: "16 Workflow: Deploy"
---

# 16 Workflow: Deploy

This page covers the stack that puts the locally tested workflow on AWS, and the steps to deploy it. The second half rewrites the same export with Lambda durable functions and looks at how to run steps that do not fit in Lambda.

## Getting ready for AWS

<!-- section: 16.infra -->

### The bucket

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{bucket}

Everyone's notes go into this bucket. All four public access settings are closed and connections over HTTP are refused, so only principals that IAM allows can read it. This chapter does not build the part that hands an export to a user. If you add it, the presigned URLs of [chapter 07](/en/chapters/07-uploads.md) will do.

### Three functions, three roles

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{steps}

The three could be one function that branches on its input. They are separate so that their permissions can be separate.

- `ExportPages` can `Scan` the table and write parts. It cannot delete
- `Finish` can list and write the manifest. It cannot read the table
- `Discard` can list and delete. It cannot write, and cannot read the table either

Only one function can read notes, and only one can delete objects. The S3 documentation states that `s3:PutObject` alone covers the `If-None-Match` check. `ExportPages` has `s3:GetObject` for the `HeadObject` that reads the metadata after a 412.

### The state machine

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{state-machine}

A state machine has an execution role too. It is the role Step Functions uses to call functions on your behalf, and all it can do is invoke the three functions. Only a state machine in this account and this Region may assume it, and the conditions that say so have the same form as the example in the documentation.

The definition is passed as one string made with `toJsonString`. The function ARNs are not known until deployment, so in the template the string becomes an `Fn::Join`.

CloudFormation also has a property, `DefinitionSubstitutions`, that replaces `${Name}` inside a definition, but this chapter does not use it. The source of the pinned cdkd (0.296.28) shows that cdkd applies this substitution only to a definition fetched from S3, so it has no effect on a definition written in the template. A test pins down that the property is absent from the template.

### The schedule

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{schedule}

Chapter 08's schedule called a Lambda function, and this one targets a state machine. Scheduler calls Step Functions' `StartExecution`, so its role needs `states:StartExecution`, limited to this one state machine.

The `<aws.scheduler.scheduled-time>` in `input` is a marker that Scheduler replaces with the time that firing was due, in a form like `2026-10-12T03:00:00Z`. The export's ID is made from that time.

Starting an execution with a name lets Step Functions refuse a duplicate start, because `StartExecution` with the same name and the same input returns the running execution. This chapter does not do that, because this kind of target has no place to give Scheduler a name for the execution. Another kind of target, a universal target, looks as if it could carry one, but the `:` in the time is not allowed in an execution name. That was not tried, so this chapter says no more about it. A duplicate start is handled by the steps.

### What the tests look at

- The stack uses exactly nine resource types, and none begins with `Custom::`
- There is no durable function by default: three functions, none with `DurableConfig`, no version, no alias
- All four public access settings of the bucket are closed, and everything under `exports/` expires after 7 days
- The actions of the three functions' roles are exactly the ones listed above
- Object operations are limited to `exports/`, the listing carries a prefix condition, and there is no bare `*` anywhere
- The state machine's role can invoke the three functions and nothing else
- The deployed definition has the same states as the one run locally, and its `Task` states point at the three functions
- Every `Task`'s timeout is longer than the timeout of the function it points at
- The schedule's input, interval, and role

The pinned cdkd has a dedicated provider for all nine types (`AWS::DynamoDB::Table`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::Scheduler::Schedule`, `AWS::StepFunctions::StateMachine`). That was checked in the installed package.

## Deploying and checking

<!-- section: 16.deploy -->

Nothing from here on has been run. Only the steps and the tasks are prepared.

```bash
vp run export:infra:diff
vp run export:infra:deploy
vp run export:seed --notes 250
vp run export:start --id check-1 --wait
vp run export:status
```

`export:seed` writes notes to the table through chapter 05's repository. `export:start` starts one export without waiting for the schedule, and with `--wait` it checks the status every 5 seconds until the execution ends. `export:status` lists recent executions and the exports in the bucket. For each export it shows whether there is a manifest, how many parts there are, and how many history events the execution has.

Running `export:start` again with the same ID should be refused with `ExecutionAlreadyExists`. Unlike the schedule, `export:start` starts the execution with a name.

To resume a failed execution, pass the ARN that `export:status` prints.

```bash
vp run export:status --redrive <execution ARN>
vp run export:logs --function pages
```

The schedule fires for the first time as soon as it is created. As in chapter 08, the documentation says a rate schedule without a start date behaves that way. So right after a deploy there is one export you did not ask for.

The drift check is the same as in earlier chapters.

```bash
vp run export:infra:drift
```

## The same thing as a durable function

<!-- section: 16.durable -->

The workflow so far was written in JSON. The loop was a `Choice`, the variables were state input and output, and try and catch were `Retry` and `Catch`. It is the kind of thing you would rather write as ordinary code.

Lambda durable functions are a feature for writing a workflow as the code of a function. This section rewrites the same export with it, as far as the documentation could confirm.

<<< @/examples/16-long-jobs/src/durable-export.ts{durable}

The `while` is the loop, and the `try` and `catch` are the compensation. The step functions (`exportPages`, `finishExport`, `discardExport`) are the ones the Step Functions version uses, without a character changed.

### From the top, again

This code has a `while` inside a function that Lambda stops after 15 minutes. It still appears to resume where it left off, and the next figure shows why.

```figure
caption: The second invocation runs from the first line again, and a step that has a checkpoint is not run but returns its stored result
type: sequence
actor lambda: Lambda | checkpoint
actor handler: handler
actor s3: S3
note lambda: invocation 1
step lambda -> handler: the handler starts
step handler -> handler: pages-from-1 runs
step handler -> lambda: its result is checkpointed
step handler -> handler: pages-from-21 runs
step handler -x lambda: the sandbox dies before the checkpoint
note lambda: invocation 2
step lambda -> handler: starts again from its first line
step lambda --> handler: pages-from-1 does not run: stored result
step handler -> handler: pages-from-21 runs again
step handler -x s3: parts already in S3, nothing written twice
step handler -> handler: pages-from-41 … finish run
step handler -> lambda: each result is checkpointed
```

In fact the function does not resume. It runs again from its first line. But work wrapped in `context.step` is not run if its result has been saved, and the saved result is returned instead. This behaviour is called replay. The code runs from the top, and only the finished steps are fast-forwarded.

Two rules follow from replay.

The first is that code outside the steps must give the same result every time it runs. On every replay, all the code outside the steps runs again. If it reads the clock or draws a random number there, the second run takes a different path from the first. In this code, what is outside the steps is the validation of the input, the `while` condition, and the building of the step names, and all of them follow from saved results.

The second is that the inside of a step must be idempotent in a durable function too. The documentation describes a step's default as at-least-once. A step that is interrupted before it completes runs again on replay, and `pages-from-21` in the figure above is an example. This chapter's steps, as built on [the first page](/en/chapters/16-long-jobs.md), leave the same parts however often they run. Moving to a durable function does not let you skip the work of making steps idempotent.

The SDK also has a setting that makes a step "at most once". The documentation is careful about it, though, and says "at most once per retry". Unless retries are turned off, that is not once for the step as a whole. It is an example of why you should not read a guarantee off a name.

### How it differs from Step Functions

| | Step Functions (Standard) | Lambda durable functions |
| --- | --- | --- |
| Where the workflow is written | ASL (JSON) | The function's code |
| Who holds the progress | Step Functions | Lambda |
| Limit on one step | Depends on what is called; 15 minutes for Lambda | 15 minutes per invocation |
| Limit on the whole | One year, 25,000 history events | One year, 3,000 durable operations, 100 MB stored |
| Separating permissions | A function and a role per step, if you like | One function, one role |
| Calling things other than Lambda | Many services directly from the definition | Through the SDK, from code |
| Billing | State transitions | Durable operations, data written, data retained |

For this chapter's job, the difference that mattered most was row five, the separation of permissions. In the Step Functions version, the function that can read notes and the function that can delete objects were separate. In the durable-function version, one role holds both permissions.

AWS itself recommends durable functions when the logic is mostly inside Lambda and you want to write it as code, and Step Functions when the work spans many services or the flow should be shown as a diagram. It also recommends combining the two.

### If you deploy it

<<< @/examples/16-long-jobs/infra/bin/app.ts{context}

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{durable}

The durable-function version is not in the default stack. The stack gains one more function only when you pass `-c durable=true`.

```bash
vp run export:infra:deploy -c durable=true
vp run export:durable:start --id check-1
```

Three things differ from an ordinary function.

First, `durableConfig` turns durable execution on. `executionTimeout` limits the whole execution and `timeout` limits one invocation, and they are separate settings. Adding `durableConfig` to a function that already exists replaces the function, and CDK tells you so at synth.

Second, the execution role needs two permissions for reading and writing checkpoints. The way to write their resource has a quirk. Lambda checks both permissions against the ARN of the execution, and an execution's ARN continues on from a function ARN that includes a version. The bare function ARN therefore does not match, and you specify the function ARN with `:*` appended.

Third, you invoke it with a version or an alias. The bare function name is refused. An execution is pinned to the version that started it. An execution started on `$LATEST` is replayed with the new code if the code is replaced partway through, and if the names or the order of the steps have changed, they no longer match the saved results.

The pinned cdkd has no dedicated provider for `Lambda::Version` and `Lambda::Alias`, so they go through Cloud Control API, as in [chapter 20](/en/chapters/20-shipping.md).

Less of the durable-function version is confirmed than of the Step Functions version. Locally, the code ran on the runner that comes with the SDK (`LocalDurableTestRunner`), which showed that a step redone after a failure adds no parts. That it is available in the Tokyo Region is only inferred from the Price List carrying Tokyo prices. No list of supported Regions was found in the documentation.

### Not the same thing as Durable Objects

Lambda durable functions and Cloudflare's Durable Objects have similar names and are different things. If you come from Cloudflare, the names may confuse you.

A Durable Object is an object of which exactly one exists per ID. Each has storage of its own and runs on a single thread. It is a building block for handling the state of one ID, such as "this room" or "this user", in one place and in order. [Chapter 14](/en/chapters/14-kv-cache.md) used it as a place to keep a rate limit.

Lambda durable functions are a mechanism that saves how far one piece of work has got, and they do not hold state per ID over time. When an execution ends, only its history is left, and the history goes too once the retention period is over.

The closest thing on Cloudflare's side is Workflows. You wrap steps in `step.do`, their results are saved, and failures are retried. The cautions in its documentation are much the same. A step may be retried several times, so it should be idempotent. A workflow can hibernate and lose its in-memory state, so state should be built from what steps return. Random numbers and the clock belong inside steps.

There are differences too. One step of a Workflow has no limit on elapsed time (it does have one on CPU time). On Lambda, even a durable function gets 15 minutes per invocation. The limit on the number of steps is 10,000 by default on Workflows' paid plan and 3,000 for durable functions. Workflows' delivery guarantee, and what happens on an attempt to create an instance with an ID that already exists, could not be confirmed from the pages read.

## Steps that do not fit in Lambda

<!-- section: 16.containers -->

Everything so far assumed that the work splits into pieces shorter than 15 minutes. Work that starts over when stopped halfway, such as transcoding one video or compressing one large file, does not split. Some work also needs more than 10 GB of memory, or a tool that does not fit in Lambda.

Steps like these run in a container. This section only describes them, and no code was written.

The first option is an ECS task. Chapter 12's service kept "always N" tasks running, but a task can also run once and disappear when it is done. To call one from Step Functions, set the `Resource` of a `Task` to `arn:aws:states:::ecs:runTask.sync`. With `.sync`, Step Functions waits for the task to end before moving to the next state. Lambda's 15-minute limit does not apply to an ECS task. On Fargate, you are billed for vCPU and memory for the seconds it ran.

Three things change compared with a Lambda function. A task returns no value, so it writes its progress to S3 or DynamoDB itself and the next state reads it. Input is passed as the container's environment variables or arguments. And you need an image. Chapter 12's rules (immutable tags, no `fromAsset`, nothing billed by the hour without an image tag) apply unchanged.

Nothing changes about idempotency. Tasks are retried too, and can keep running after Step Functions has given up. The documentation says that when a `.sync` task is aborted, it may not be possible to stop it, and charges can continue.

The second option is AWS Batch. It is a service that puts container jobs on a queue, provisions as much compute as they need, and runs them in order. ECS (or EKS) runs underneath, and Fargate can be used. For one long step, an ECS task is enough. Batch is useful when there are thousands of jobs and you want to prioritize them or run them cheaply on Spot instances. From Step Functions it is called with `arn:aws:states:::batch:submitJob.sync`.

The table matches each kind of work to a tool.

| The work | The tool |
| --- | --- |
| Splits into pieces under 15 minutes, with steps that can be Lambda functions | Step Functions and Lambda (this chapter), or durable functions |
| Does not split, but can run one at a time | An ECS task from Step Functions |
| Jobs that do not split, in large numbers, needing a queue and managed compute | AWS Batch |
| Always done within five minutes, in very large numbers | An Express workflow |
