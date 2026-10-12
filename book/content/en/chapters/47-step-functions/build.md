---
title: "47 Step Functions: Design and Build"
---

# 47 Step Functions: Design and Build

[The previous page](/en/chapters/47-step-functions.md) showed the shape of the two state machines, the import and the lookup. This page reads their definitions from the top and explains, in turn, the state language, how a service is called, `Retry` and `Catch`, and how the saga is put together.

## The state language

<!-- section: 47.language -->

A state machine is defined in Amazon States Language (ASL), which is JSON. This chapter writes the JSON as a TypeScript object, and the stack turns it into a string. The types cover only what this chapter uses, and were written for it.

<<< @/examples/47-step-functions/src/saga.ts{definition}

`QueryLanguage` at the top of a definition chooses the expression language that selects and reshapes data inside a state. The choices are JSONPath and JSONata, and JSONPath is what you get when the field is left out. Chapter 16's definition was JSONPath. The AWS documentation recommends JSONata for a workflow newly created in the console, and this chapter is written in it.

In a JSONata state, a string that starts with `{%` and ends with `%}` is evaluated as an expression. Any other string is the string you wrote. Two fields decide what goes in and out: `Arguments` is what the call is given, and `Output` is what the next state is given. The five fields JSONPath had (`InputPath`, `Parameters`, `ResultSelector`, `ResultPath`, `OutputPath`) are not used.

Everything an expression can see is gathered in one variable, `$states`.

| Expression | What it holds | Where it can be used |
| --- | --- | --- |
| `$states.input` | The value the state was entered with | Anywhere |
| `$states.result` | The result of the call | `Output` and `Assign` of a `Task`, `Map`, or `Parallel` |
| `$states.errorOutput` | An object with `Error` and `Cause` | `Output` and `Assign` of a `Catch` |
| `$states.context` | The execution's name, its start time, the task token, and more | Anywhere |

<<< @/examples/47-step-functions/src/saga.ts{shared}

The import's definition uses these five expressions over and over. Every state returns `$states.input` unchanged as its `Output`, so the import's input (owner, note ID, title, body, where the upload is) reaches the last state in the same shape. That way a compensation state can work out which note and which file to remove from its input, wherever it was entered from.

What goes to the next state when `Output` is left out is described differently in two places of the specification. The section on `Arguments` and `Output` says "the result" for a `Task`, and the section on the `Task` state says the input is copied through. Which is right was not checked, so this chapter's definitions write `Output` in every `Task` and `Map`.

JSONata has two things to watch. The first is that an expression with no value is an error. Reading a field the input does not have, as in `{% $states.input.missing %}`, fails the state with `States.QueryEvaluationError`, because JSON has no way to say "no value". The second is that `&`, which joins strings, treats a side with no value as an empty string. That one is not an error. The key becomes something like `attachments//` and quietly points at something else. The saga section of this page comes back to it.

The JSONata that Step Functions implements is based on the 2.0.6 specification, with only `$eval` missing. `$parse` stands in for it, and `$uuid`, `$hash`, `$partition`, `$range`, and `$random` are added. This chapter's definitions use none of the added functions.

Besides `Output` there is one more way to carry a value across states. A value stored under a name with `Assign` can be read as `$name` from any later state. One variable may be up to 256 KiB, and all of them together up to 10 MiB per execution. The import needs nothing beyond passing its input along, so it uses no variables.

### The input is checked by whoever starts it

<<< @/examples/47-step-functions/src/saga.ts{input}

A state machine has nowhere to declare a schema for its input. Started with an input of the wrong shape, it fails with `States.QueryEvaluationError` in the first state that reads the field, or, thanks to `&`, does not fail and goes on. So the side that starts it checks the input with Valibot before calling `StartExecution`. The owner and the note ID are limited to letters, digits, `_`, and `-` because both become part of a DynamoDB key and an S3 key. `upload` is limited to what lies under `inbox/`. Without that, whoever can start an import could copy any object in the bucket as their own attachment.

The execution's name is made from the owner and the note ID. In a Standard workflow, calling `StartExecution` with the name and input of a running execution starts nothing new and returns an answer that points at the same execution. After the execution has ended, or with a different input, the answer is `ExecutionAlreadyExists`. A name cannot be reused for 90 days after its execution ended. If the request to start arrives twice, only one import starts.

## Calling a service

<!-- section: 47.integrations -->

What a `Task` calls is decided by the string in `Resource`. It has the form of an ARN, but it does not point at a resource that exists. It is a name from which Step Functions reads which API of which service to call, and how.

<<< @/examples/47-step-functions/src/saga.ts{steps}

`arn:aws:states:::dynamodb:putItem` in `CreateNote` calls DynamoDB's PutItem, and `Arguments` becomes the API request as it stands. Unlike chapter 16, where a Lambda function made the call through the SDK, there is no code, no bundle, and no function role. It is enough for the Step Functions role to hold `dynamodb:PutItem`.

There are two kinds of thing to call. DynamoDB, SQS, SNS, Lambda, and some others have an integration Step Functions built for them (an optimized integration). More than two hundred other services are called in the form `aws-sdk:serviceName:apiAction`, as `arn:aws:states:::aws-sdk:s3:copyObject` in `AttachFile` is. In both, parameter names are written in PascalCase.

Leaving the function out also leaves some things out of reach. Computation beyond what JSONata can express, several APIs combined under conditions, and an involved exchange with an outside HTTP API all read better and test better inside a function. In this chapter's import every step is one API call, so no function was needed.

The name of an error depends on how the service was called. The optimized DynamoDB integration reports names that begin with `DynamoDB.`, such as `DynamoDB.ConditionalCheckFailedException`. An SDK integration reports `ServiceName.ErrorName`, and adds `Exception` even where the service's own error name has none. A name in `Retry` or `Catch` that is one character off does not match, so this is something to check on the real service. This chapter did not.

### How the state waits after the call

The end of `Resource` changes how the state waits after the call.

| Ending | Pattern | When the next state starts |
| --- | --- | --- |
| None | Wait for the response (request response) | When the API has answered |
| `.sync` | Wait for the job (run a job) | When the job that was started has finished |
| `.waitForTaskToken` | Wait for a callback | When someone returns the token |

With no ending, the next state starts as soon as the API has answered. All but one of the import's `Task` states work this way.

`.sync` goes on things that take a while between the call and the end: an ECS task, an AWS Batch job, a Glue job, an execution of another state machine. Step Functions watches for completion and moves on afterwards. It is how the last section of chapter 16 would make a step that does not fit in Lambda into an ECS task. Only certain services support it, and SDK integrations do not. It does not appear in this chapter's code.

`.waitForTaskToken` is for waiting on something Step Functions cannot watch: a person's approval, an outside service, a worker of your own.

<<< @/examples/47-step-functions/src/saga.ts{scan}

```figure
caption: WaitForScan sends a message carrying a token and stops, and goes on when the token comes back
type: sequence
actor sfn: Step Functions
actor queue: SQS queue
actor scanner: Scanner
step sfn -> queue: SendMessage {taskToken, key}
note sfn: stops in WaitForScan
step queue -> scanner: ReceiveMessage
step scanner --> sfn: SendTaskHeartbeat
step scanner --> sfn: SendTaskSuccess {verdict}
note sfn: goes on to Verdict
```

`WaitForScan` sends one message to SQS, with the task token taken from `$states.context.Task.Token` inside it. When SQS answers, the state does not move on. When someone calls `SendTaskSuccess` with that token, the value passed there becomes the state's result, and when someone calls `SendTaskFailure`, the state fails with the error name passed there. `$states.result` is what the scanner returned, not the answer from SQS.

<<< @/examples/47-step-functions/src/saga.ts{scan-message}

The message and the answer each have a schema. The scanner's part is played by a function that reads the queue, like the worker in chapter 08. This chapter's stack has no scanner, and the deploy page provides a task with which a person returns the token by hand.

What a wait must always settle is how long it may last. `TimeoutSeconds` and `HeartbeatSeconds` both default to 99,999,999 seconds. Left out, a task whose token never comes back waits until the execution's own limit of one year. `WaitForScan` asks for the work to end within 30 minutes and for a `SendTaskHeartbeat` every 5 minutes to say it is still going. If one long timeout is the only limit on a long piece of work, a scanner that dies in the first minute goes unnoticed for 30. With a separate heartbeat it is noticed in 5.

The error name of a missed heartbeat is `States.Timeout` on some pages of the documentation and `States.HeartbeatTimeout` on another. Which is right was not checked, so the `Retry` names both.

When a task that timed out is retried, a new token is made and one more message is sent. Calling `SendTaskSuccess` with the old token returns an error named `TaskTimedOut`, which the API reference describes as the token having expired or its task being closed already. Seen from the scanner, two requests for the same file can arrive. A scan gives the same result however often it runs, so that does no harm here. For a wait that mails a person for approval, you need to decide beforehand what happens when the second mail arrives.

Express workflows can use neither `.sync` nor `.waitForTaskToken`.

## Retry and Catch

<!-- section: 47.retry -->

Chapter 16 wrote one `Retry`: whatever happens, run the same step again. Here, what is retried and what is not are kept apart.

<<< @/examples/47-step-functions/src/asl.ts{retry}

<<< @/examples/47-step-functions/src/saga.ts{retry}

`Retry` is an array of retriers, and Step Functions goes down it and uses the first one whose `ErrorEquals` matches the error name. The wait starts at `IntervalSeconds` (default 1) and is multiplied by `BackoffRate` (default 2.0) at each retry. `MaxAttempts` (default 3) is the number of retries and does not include the first try. With the settings of `transient`, the first try is followed by waits of 2, 4, and 8 seconds, four tries in all.

`MaxDelaySeconds` caps a wait that would otherwise keep doubling. Whenever you raise `MaxAttempts`, write it too. Take the cap away from `transient` and the tenth retry is preceded by a wait of 17 minutes.

With `JitterStrategy` set to `FULL`, each wait is picked at random between 0 and the computed value. The default is `NONE`. As [chapter 32](/en/chapters/32-limits.md) covers, executions that failed together for the same reason and retry at the same interval hit the other side together once more. In a workflow where many executions write the same table, set it to `FULL`.

Two error names match in bulk. `States.TaskFailed` matches every error except `States.Timeout`. `States.ALL` matches almost every error, but not `States.Runtime` or `States.DataLimitExceeded`, and it is written alone, last in the array. `transient` lists `States.Timeout` and `States.TaskFailed` because together they amount to everything that can happen in a call to a service.

An error that a retry will not cure is taken out of the retries by a retrier with `MaxAttempts: 0` placed first. In `CreateNote` that is `DynamoDB.ConditionalCheckFailedException`, which says the condition did not hold. It will not hold on another try either. Leave it in, and a failure whose outcome is known takes up to 14 seconds and costs three more state transitions, because a retry is billed as a state transition too.

`Catch` says where to go once the retries have run out. It is also read from the top, and the first catcher that matches is taken. In a JSONata state a catcher can have an `Output`. Without one, the next state is handed an object with only `Error` and `Cause`, and the state's input is dropped. That is why the import's catchers put the input and the error back together in `Output`.

Only `Task`, `Map`, and `Parallel` can have a `Catch`. A definition has no last resort that is called when the execution itself fails. For that, use the event that reaches EventBridge when an execution's status changes ([the deploy page](/en/chapters/47-step-functions/deploy.md)).

## The saga

<!-- section: 47.saga -->

The import changes both DynamoDB and S3. No transaction spans two services, so one operation cannot guarantee "both written, or neither". Instead the steps are committed one at a time, and when a later step fails, operations that cancel the earlier ones are run. This way of working is called a saga, and the cancelling operations are compensations.

What it protects, in one sentence:

**An import that has ended left the published note together with its attachment, or left neither. The only exception is an execution in which the step that cannot be undone, or a compensation itself, failed: it ends as failed in that state, and a redrive continues it from there.**

The second sentence is there because some things Step Functions cannot guarantee either. If a compensation keeps failing, all a workflow can do is stop there and record exactly where it stopped.

### The step that failed is undone too

The `Catch` of `CreateNote` goes to `RemoveNote`. The reasoning is not "writing the note failed, so there is nothing to remove". Arriving at `Catch` means the retries ran out, and that includes the case where the write went through and only its answer never arrived. From the fact that a step failed, you cannot conclude that nothing was written.

So a compensation is written to be safe to run whether or not its step ran. `RemoveAttachment` is S3's DeleteObject, which succeeds on a key that is not there. `RemoveNote` is a conditional DeleteItem, which does nothing and succeeds when the item is absent.

<<< @/examples/47-step-functions/src/saga.ts{compensations}

### Write only what is yours, remove only what is yours

<<< @/examples/47-step-functions/src/saga.ts{conditions}

Every write carries a condition. The condition of `CreateNote` and `RemoveNote` reads: the item is absent, or it is one this import wrote and has not published yet. "This import" is recognized by the execution's name, which was written into the item.

`CreateNote` has this condition for the sake of running twice. With the condition "the item is absent" alone, a first write that went through with its answer lost would make the second run collide with its own item and fail. That would look just like another import using the same note ID. Adding "let it through if it is mine" turns the second run into writing the same item once more, and leaves a failure only for a collision with someone else's item. That case goes to `NoteIdTaken` and undoes nothing, because nothing was written that needs undoing.

`RemoveNote` has the same condition so that it does not remove too much. Without it, a compensation would delete someone else's note that was imported earlier under the same note ID.

### The step that cannot be undone

The note that `CreateNote` writes has an attribute named `phase`, which starts as `pending`. The lookup shows only notes that are `ready`. A saga commits step by step, so the states in between are visible from outside: the note is written, the attachment is not there yet, the scan has not happened. To keep readers from seeing a note in between, a separate mark says whether it is published, and it is switched last.

<<< @/examples/47-step-functions/src/saga.ts{commit}

`Publish` is that switch, and it has no `Catch`. When the retries of `Publish` run out, the note may have been published and may not. If it was, someone may already have read it. Going on to the compensations here would remove a note readers could see, or keep the note and remove only its attachment. Either is worse than standing still.

So the definition is split. Before `Publish`, a failure is undone. From `Publish` on, a failure is tried again. `Publish` gives the same result however often it runs, so when its retries run out the execution fails, and after the cause is fixed a redrive runs `Publish` again. Until then the note is either still `pending` and invisible to readers, or already `ready` with its attachment in place.

`Notify` comes after `Publish`. A notice that has been sent cannot be taken back, so it does not go before any step that might be undone. When the notice cannot be sent, publishing is not undone, and the import ends as a success with `notified: false`. SNS's Publish is not idempotent, so when its answer is lost and it is retried, two notices arrive. The execution's name is in the message attributes so that whoever receives them can tell a duplicate.

The two compensations have no `Catch` either. The reason is the same as for `Publish`, and lies in how a redrive works. A redrive runs the failed state again with the input it had. If a failed compensation were caught and sent on to a `Fail` state, a redrive would re-enter the `Fail` state and fail again at once. With no `Catch`, the execution fails in the compensation state itself, and once the cause, such as a permission, is fixed, a redrive runs the rest of the undoing.

### When the scan says no

`Verdict` is a `Choice` that goes to `RemoveAttachment` unless the scan's verdict is `clean`. Nobody threw an error, and it is a reason to undo all the same. `Catch` is the way out when something failed, and `Choice` is the way out when everything worked and the import still cannot go on. The input is kept in one shape so that the compensations can be entered from either.

## Choice, Map, Parallel, and Wait

<!-- section: 47.flow -->

So far there were `Task`, `Choice`, `Succeed`, and `Fail`. The remaining control states are looked at here, together with the lookup's definition.

<<< @/examples/47-step-functions/src/digest.ts{definition}

A `Map` runs the small state machine written in `ItemProcessor` once for each element of an array. `Items` selects the array, and `ItemSelector` builds the input of one iteration. The element itself is read as `$states.context.Map.Item.Value` and its position as `.Index`. The result is an array of the iterations' outputs, in the order of the input.

`MaxConcurrency` caps how many iterations run at once. 0 means no cap, so if you forget it, a lookup of 25 notes sends 25 GetItem calls at the same moment. Always write a number, chosen with the other side's throttling in mind.

This `Map` runs in what is called inline mode, where the iterations run inside the parent execution. At most 40 run at once, and their history is added to the parent's. When one iteration fails, the whole `Map` fails and the other iterations stop. The lookup failing as a whole when one read fails is exactly this behaviour.

The other mode is distributed. Each iteration is started as a child execution of its own, so up to 10,000 run at once and each has its own history. The input can be read straight from S3: a JSON or CSV file, or a listing of objects. It is meant for work large enough to hit the 256 KiB that can travel between states or the 25,000 events of a history, and it is available only in Standard workflows. Rebuilding chapter 16's export to work with millions of notes would use it. A distributed `Map` has `ToleratedFailurePercentage` and `ToleratedFailureCount`, and does not fail as a whole until the failed items exceed that share or that number. That is for when a few broken rows in a million should not stop everything. Which items were the tolerated failures, you only learn by examining the results. This chapter has no code for the distributed mode.

`Parallel` runs state machines that differ from one another, listed in `Branches`, at the same time. `Map` repeats one piece of work per element, and `Parallel` sets different pieces of work side by side. The result is an array of the branches' outputs in the order of the branches. When one branch fails, the whole state fails.

`Wait` waits for the number of seconds in `Seconds`, or until the time in `Timestamp`. The longest wait is one year in Standard and five minutes in Express. As the previous page worked out, Standard does not charge for the time spent waiting.

`Parallel`, `Wait`, and `Pass`, which does nothing but produce a value, do not appear in this chapter's code, and the local interpreter does not handle them.
