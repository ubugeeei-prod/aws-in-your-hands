---
title: "16 Workflow: Deploy"
---

# 16 Workflow: Deploy

## Getting ready for AWS

<!-- section: 16.infra -->

### The bucket

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{bucket}

Everyone's notes go into this bucket. All four public access settings are closed, and connections over HTTP are refused. Only what IAM allows can read it. This chapter does not build the part that hands an export to a user. For that, the presigned URLs of [chapter 07](/en/chapters/07-uploads.md) would do.

### Three functions, three roles

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{steps}

The three could be one function that branches on its input. They are separate so that the permissions are separate.

- `ExportPages` can `Scan` the table and write parts. It cannot delete
- `Finish` can list and write the manifest. It cannot read the table
- `Discard` can list and delete. It cannot write, and cannot read the table either

Only one function can read notes, and only one can delete objects. That `s3:PutObject` alone covers the `If-None-Match` check is stated in the S3 documentation. The `s3:GetObject` on `ExportPages` is for the `HeadObject` that reads the metadata after a 412.

### The state machine

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{state-machine}

A state machine has an execution role too: the role Step Functions uses to call functions on your behalf. All it can do is invoke the three functions. The conditions that narrow who may assume it (a state machine in this account and Region) have the same form as the example in the documentation.

The definition is passed as one string made with `toJsonString`. The function ARNs are not known until deployment, so in the template it becomes an `Fn::Join`.

CloudFormation also has a property, `DefinitionSubstitutions`, that replaces `${Name}` inside a definition. This chapter does not use it. Reading the source of the pinned cdkd (0.296.28) shows that this substitution is applied only to a definition fetched from S3. It has no effect on a definition written in the template. A test fixes that the property is absent from the template.

### The schedule

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{schedule}

Chapter 08's schedule called a Lambda function. This one targets a state machine: Scheduler calls Step Functions' `StartExecution`. The role needs `states:StartExecution`, on this one state machine.

The `<aws.scheduler.scheduled-time>` in `input` is a marker that Scheduler replaces with the time that firing was due, in a form like `2026-10-12T03:00:00Z`. That is where the export's ID comes from.

Starting an execution with a name would let Step Functions refuse a duplicate start: `StartExecution` with the same name and the same input returns the running execution. This chapter does not use that, because this kind of target has no place to give Scheduler a name for the execution. Another kind (a universal target) looks as if it could carry one, but the `:` in the time is not allowed in an execution name. That was not tried, so it stops here. That a duplicate start does no harm is handled on the steps' side.

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

From here on, nothing was run. The steps and the tasks are prepared, and that is all.

```bash
vp run export:infra:diff
vp run export:infra:deploy
vp run export:seed --notes 250
vp run export:start --id check-1 --wait
vp run export:status
```

`export:seed` writes notes to the table through chapter 05's repository. `export:start` starts one export without waiting for the schedule; with `--wait` it looks at the status every 5 seconds until the end. `export:status` lists recent executions and the exports in the bucket: whether there is a manifest, how many parts, how many history events.

Running `export:start` again with the same ID should be refused with `ExecutionAlreadyExists`, because this task does start the execution with a name.

To resume a failed execution, pass the ARN that `export:status` prints.

```bash
vp run export:status --redrive <execution ARN>
vp run export:logs --function pages
```

The schedule fires for the first time as soon as it is created. As in chapter 08, the documentation says a rate schedule without a start date behaves that way. Right after a deploy there is one export you did not ask for.

The drift check is the same as before.

```bash
vp run export:infra:drift
```

## The same thing as a durable function

<!-- section: 16.durable -->

The workflow so far was JSON. The loop was a `Choice`, the variables were state input and output, and try and catch were `Retry` and `Catch`. Many readers will have thought: if only this were ordinary code.

Lambda durable functions are the feature for that. Within what the documentation confirms, let's rewrite the same export.

<<< @/examples/16-long-jobs/src/durable-export.ts{durable}

The `while` is the loop, and the `try` and `catch` are the compensation. The step functions (`exportPages`, `finishExport`, `discardExport`) are the ones the Step Functions version uses, without a character changed.

### From the top, again

The first thing that catches the eye is this: how can a `while` inside a function that is stopped after 15 minutes resume where it left off?

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

The answer is that it does not. The function runs again from its first line. But work wrapped in `context.step` is not run if its result has been saved; the saved result is returned. This is replay: the code runs from the top, and only the finished steps are fast-forwarded.

Two rules follow.

**Outside the steps, the code must do the same thing every time.** On every replay, all the code outside the steps runs again. Reading the clock or drawing a random number there sends the second run down a different path from the first. In this code, what is outside the steps is the validation of the input, the `while` condition, and the building of the step names. All of them follow from saved results.

**Inside the steps, the code must still be idempotent.** The documentation describes a step's default as at-least-once: a step that is interrupted before it completes runs again on replay. That is `pages-from-21` in the diagram. This chapter's steps, as built in the first half, leave the same parts however often they run. Making it a durable function does not make that work unnecessary.

The SDK also has a setting that makes a step "at most once". The documentation is careful about it, though: it is "at most once per retry". Unless retries are turned off, it is not once for the step as a whole. A good example of why not to read a guarantee off a name.

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

For this chapter's job, the difference that mattered most was row five. In the Step Functions version, the function that can read notes and the function that can delete objects were separate. In the durable-function version, one role holds both.

AWS's own guidance goes like this: durable functions when the logic is mostly inside Lambda and you want to write it as code; Step Functions when it spans many services or the flow should be shown as a diagram. It also recommends using both together.

### If you deploy it

<<< @/examples/16-long-jobs/infra/bin/app.ts{context}

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{durable}

The durable-function variant is not in the default stack. Only with `-c durable=true` does one more function appear.

```bash
vp run export:infra:deploy -c durable=true
vp run export:durable:start --id check-1
```

Three things differ from an ordinary function.

`durableConfig` turns durable execution on. `executionTimeout` limits the whole execution and `timeout` limits one invocation; they are separate settings. Adding it to a function that already exists means the function is created anew. CDK tells you so at synth.

The execution role needs two permissions for reading and writing checkpoints. The way to write their resource has a quirk. Lambda checks both against the ARN of the execution, and an execution's ARN continues on from a function ARN with a version in it. So the bare function ARN does not match. Add `:*`.

When invoking, add a version or an alias. The bare function name is refused. An execution is pinned to the version that started it. An execution started on `$LATEST` is replayed with new code if the code is replaced on the way. If the steps' names or order have changed, they no longer match the saved results.

The pinned cdkd has no dedicated provider for `Lambda::Version` and `Lambda::Alias`, so they go through Cloud Control API, as in [chapter 20](/en/chapters/20-shipping.md).

To be honest, less of this is confirmed than of the Step Functions version. Locally, the code ran on the runner that comes with the SDK (`LocalDurableTestRunner`), as far as seeing that a step redone after a failure adds no parts. That it is available in the Tokyo Region is only inferred from the Price List carrying Tokyo prices. No list of supported Regions was found in the documentation.

### Not the same thing as Durable Objects

If you come from Cloudflare, the names will confuse you. Lambda durable functions and Cloudflare's Durable Objects have similar names and are different things.

A Durable Object is an object of which exactly one exists per ID. Each has storage of its own and runs on a single thread. It is a building block for handling the state of one ID, "this room" or "this user", in one place and in order. [Chapter 14](/en/chapters/14-kv-cache.md) met it as a place to keep a rate limit.

Lambda durable functions are a mechanism that saves how far one piece of work has got. They do not hold state per ID over time. When an execution ends, what is left is its history, and that goes too once the retention period is over.

What is close on Cloudflare's side is Workflows. You wrap steps in `step.do`, their results are saved, and failures are retried. The cautions in the documentation are much alike as well: a step may be retried several times, so make it idempotent; a workflow can hibernate and lose in-memory state, so build state from what steps return; random numbers and the clock belong inside steps.

There are differences. One step of a Workflow has no limit on elapsed time (it does on CPU time). On Lambda, even a durable function gets 15 minutes per invocation. The limit on the number of steps is 10,000 by default on Workflows' paid plan and 3,000 for durable functions. Workflows' delivery guarantee, and what happens on an attempt to create an instance with an ID that already exists, could not be confirmed from the pages read.

## Steps that do not fit in Lambda

<!-- section: 16.containers -->

So far the work could be split into pieces shorter than 15 minutes. Some work cannot: transcoding one video, compressing one large file. Stop it halfway and it starts over. Some work needs more than 10 GB of memory, or a tool that does not fit in Lambda.

Steps like that run in a container. This chapter only describes them. No code was written.

**An ECS task.** Chapter 12's service kept "always N" tasks running. A task can also be run once, to disappear when it is done. From Step Functions, the `Resource` of a `Task` becomes `arn:aws:states:::ecs:runTask.sync`. With `.sync`, Step Functions waits for the task to end before moving to the next state. Lambda's 15 minutes do not apply here. On Fargate, you are billed for vCPU and memory for the seconds it ran.

Three things change. A task returns no value: it writes its progress to S3 or DynamoDB itself, and the next state reads it. Input is passed as the container's environment variables or arguments. And an image is needed. Chapter 12's rules (immutable tags, no `fromAsset`, nothing billed by the hour without an image tag) apply as they are.

The idempotency story does not change. Tasks are retried too, and can keep running after Step Functions has given up. The documentation says that when a `.sync` task is aborted, it may not be possible to stop it, and charges can continue.

**AWS Batch.** A service that puts container jobs on a queue and runs them in order, provisioning as much compute as they need. Underneath is ECS (or EKS), and Fargate can be used. For one long step, an ECS task is enough. Batch pays off when there are thousands of jobs and you want priorities, or to run them cheaply on Spot instances. From Step Functions it is called with `arn:aws:states:::batch:submitJob.sync`.

One line each on how to choose:

| The work | The tool |
| --- | --- |
| Splits into pieces under 15 minutes, with steps that can be Lambda functions | Step Functions and Lambda (this chapter), or durable functions |
| Does not split, but can run one at a time | An ECS task from Step Functions |
| Jobs that do not split, in large numbers, needing a queue and managed compute | AWS Batch |
| Always done within five minutes, in very large numbers | An Express workflow |
