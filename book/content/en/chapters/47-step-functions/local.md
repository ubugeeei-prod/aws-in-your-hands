---
title: "47 Step Functions: Run It Locally"
---

# 47 Step Functions: Run It Locally

The definitions from [the previous page](/en/chapters/47-step-functions/build.md) are walked on a laptop before they go to AWS. Chapter 16's runner handled `Task` and `Choice` in JSONPath. This chapter's definitions are JSONata and have a `Map` and a callback, so the interpreter was written anew.

## Run it locally

<!-- section: 47.local -->

```bash
vp run sfn:local
vp run sfn:local --infected --refuse RemoveAttachment --times 4 --redrive
vp run sfn:local --lose CreateNote
```

The first line takes an import to its end.

```text
  CreateNote
  AttachFile
  WaitForScan
  Verdict
  Publish
  Notify
  Imported
SUCCEEDED {"owner":"user-1","noteId":"note-1","title":"Minutes","body":"What was said","upload":"inbox/user-1/minutes.pdf","verdict":"clean","notified":true}
left behind: ready note, an attachment
notices sent: 1, retries waited up to 0 s
invariant: holds
```

The second has the scan refuse the file and then makes `RemoveAttachment` fail four times in a row. The first try and the three retries all fail, so the execution stops in the middle of the compensations. With `--redrive`, the cause of the failure is taken away and the run continues from the state it stopped in.

```text
  CreateNote
  AttachFile
  WaitForScan
  Verdict
  RemoveAttachment  ! Injected.Refused
  RemoveAttachment (attempt 2)  ! Injected.Refused
  RemoveAttachment (attempt 3)  ! Injected.Refused
  RemoveAttachment (attempt 4)  ! Injected.Refused
FAILED Injected.Refused: injected: RemoveAttachment was refused
left behind: pending note, an attachment
notices sent: 0, retries waited up to 14 s
invariant: holds

redrive from RemoveAttachment, with the fault gone:
  RemoveAttachment
  RemoveNote
  RolledBack
FAILED ImportRolledBack: A step failed or the scan refused the file. The note and its attachment are gone.
left behind: absent note, no attachment
notices sent: 0, retries waited up to 0 s
invariant: holds
```

At the moment it stops, an unpublished note and an attachment are still there. The invariant says `holds` all the same, because the execution ended as failed in a compensation state and can be continued from it. That is the exception in the second sentence on the previous page.

`--lose` in the third line lets a step do its work and then throws the answer away. `CreateNote` writes the note, and all the workflow sees is a timeout. When that happens four times, the `Catch` goes to `RemoveNote`, which removes the note that had been written.

```text
  CreateNote  ! States.Timeout
  CreateNote (attempt 2)  ! States.Timeout
  CreateNote (attempt 3)  ! States.Timeout
  CreateNote (attempt 4)  ! States.Timeout
  RemoveNote
  RolledBack
FAILED ImportRolledBack: A step failed or the scan refused the file. The note and its attachment are gone.
left behind: absent note, no attachment
notices sent: 0, retries waited up to 14 s
invariant: holds
```

None of them needs AWS credentials or Docker. `retries waited` is the sum of the waits between retries, and nothing actually waits.

### The interpreter that walks a definition

<<< @/examples/47-step-functions/src/interpreter.ts{run}

The interpreter takes the definition that is deployed and follows it one state at a time from `StartAt`. It handles five kinds of state, all in JSONata: `Task`, `Choice`, inline `Map`, `Succeed`, and `Fail`. It does not handle `Pass`, `Wait`, `Parallel`, a distributed `Map`, or the JSONPath fields. Only what this chapter's two definitions use was implemented.

<<< @/examples/47-step-functions/src/interpreter.ts{evaluate}

Expressions are evaluated with `jsonata` from npm, the reference implementation of JSONata, pinned to 2.0.6. That is the version Step Functions says its own is "based on". The interpreter binds `$states` and the variables, evaluates, and turns a missing value into `States.QueryEvaluationError`. The functions Step Functions adds, such as `$uuid`, are not bound.

Whether the interpreter evaluates an expression to what Step Functions would has not been checked. Only the version of the reference implementation was matched, and nothing here shows that the implementation inside Step Functions is the same one.

<<< @/examples/47-step-functions/src/interpreter.ts{retry-catch}

The `Retry` and `Catch` part follows the documentation line by line. A retrier counts its own retries, and that count covers every error the retrier took within the same state. On success, `Output` and `Assign` are both evaluated with the values the state was entered with. On an error, only the catcher's `Assign` is evaluated, and the state's is not.

<<< @/examples/47-step-functions/src/interpreter.ts{task}

A `Task` that waits for a callback makes a new token for each attempt, calls the service, drops that answer, and waits for the answer to the token.

<<< @/examples/47-step-functions/src/interpreter.ts{map}

`Map` runs its iterations one at a time, in order. The real service runs up to `MaxConcurrency` at once, so a definition whose iterations compete with each other cannot be checked with this interpreter. The lookup's iterations only read, so running them in order gives the same result.

There is more the interpreter does not have. It has no clock, so `TimeoutSeconds` and `HeartbeatSeconds` can only be expressed by a stand-in that throws `States.Timeout`. It knows nothing of the 256 KiB limit, the 25,000-event history limit, throttling, or IAM. It saves no state either, so if the process stops in the middle of an execution, nothing is left.

### Stand-ins for the services

<<< @/examples/47-step-functions/src/interpreter.ts{world}

<<< @/examples/47-step-functions/src/local-world.ts{world}

Everything outside the state machine is a `World`. The local `LocalWorld` keeps a table, a bucket, a queue, and a topic in maps and arrays, and answers only the eight `Resource` values the definitions call. `fail` makes the call of a given state fail. `refused` declines without doing anything, and `lost` does the work and then drops the answer. Those are the two cases a distributed system has to tell apart.

<<< @/examples/47-step-functions/src/local-world.ts{conditions}

The stand-in table does not interpret DynamoDB condition expressions. It knows the two the import uses as strings, and holds the meaning of each as a TypeScript function. Given a condition it does not know, it throws. So these tests cannot show that the condition expressions behave as intended. What they show is that, if the conditions mean what the functions say, the wiring of the definition keeps the invariant. The expressions themselves are on the list of things to check after a deploy.

## Tests that try to break it

<!-- section: 47.tests -->

<<< @/examples/47-step-functions/src/invariant.ts{invariant}

The invariant is a function. It looks at the table and the bucket after an execution has ended, and when the invariant is broken it returns a sentence saying how. Each test puts one failure in one fixed place, runs the import, and checks that this function returns an empty array.

<<< @/examples/47-step-functions/test/saga.test.ts{each-step}

For the two steps that can be undone and for the wait, both cases are tried: refused every time, and done with the answer never arriving. In either case the execution ends with `ImportRolledBack` and neither the note nor the attachment is left. The second case is the check on "the step that failed is undone too" from the previous page.

<<< @/examples/47-step-functions/test/saga.test.ts{twice}

When an answer is lost just once, the step runs twice. For `CreateNote`, `AttachFile`, and `Publish`, the second run changes nothing. `Notify` sends two notices, and the test checks that both carry the same execution name. That does not remove the duplicate. It only shows that the receiver can recognize it.

<<< @/examples/47-step-functions/test/saga.test.ts{no-way-back}

When the answer of `Publish` is lost all four times, the execution fails in `Publish`. The note is already published, so the compensations are not entered. A redrive runs `Publish` once more and goes on to `Notify`.

<<< @/examples/47-step-functions/test/saga.test.ts{compensation-fails}

<<< @/examples/47-step-functions/test/saga.test.ts{two-imports}

When another import has already used the same note ID, the later import stops at `NoteIdTaken` and does not touch the earlier note. Running the compensation directly fails on its condition as well, and the other import's note stays.

### Breaking the definition on purpose

<<< @/examples/47-step-functions/test/saga.test.ts{broken}

To show that the invariant check is not decoration, the definition is broken in two places. The first sends the `Catch` of `CreateNote` straight to `RolledBack`. This is the plausible mistake of "it failed, so there is nothing to remove". When the answer keeps getting lost, an import that claims to be rolled back leaves an unpublished note behind. The second gives `Publish` a `Catch` that goes to the compensations. If publishing had gone through, only the attachment is removed and a published note stays. In both cases the check function reports it in a sentence.

When this test was first written, the second breakage broke in a way that was not intended. The catcher had no `Output`, so the compensation was handed nothing but the error, `'attachments/' & $states.input.owner` joined empty strings, and a key that did not exist was "deleted" successfully. No error appeared anywhere. That is where the warning about `&` on the previous page comes from.

## TestState

<!-- section: 47.test-state -->

The interpreter is a model written for this chapter, so there has to be a way to compare it with the real thing. Step Functions has an API named TestState that runs a single state. Since November 2025 the answer of the service being called can be mocked. With a mock, Step Functions runs only the expression evaluation, `Retry`, and `Catch`, and calls no service. No role is needed either.

<<< @/examples/47-step-functions/src/test-state-cases.ts{cases}

This table lists, for a state, an input, and an answer, which state comes next. `retries` is how many retries are taken as already used, and is passed to TestState as `retrierRetryCount`. TestState answers for a single attempt, so it returns `RETRIABLE` while retries remain, `CAUGHT_ERROR` when they have run out and a catcher takes over, and `FAILED` when no catcher matches.

The unit tests check that the local interpreter behaves as the table says. Sending the same table to the real service is the next task.

```bash
vp run sfn:test-state
```

This task was not run, because it needs AWS credentials. It needs no stack, and with mocks neither DynamoDB nor S3 is called. A line marked `DIFFERENT` in its output is a place where the model or the table is wrong.

TestState can only check what happens inside one state. Used on a `Map`, it does not run what is inside `ItemProcessor` and tests only the `Map`'s own input and output processing. The flow across states, which is where this chapter's invariant lives, is beyond it. That part is checked with the model, and then by deploying.

For running Step Functions on your own machine there was Step Functions Local, which AWS distributed. The documentation now calls Step Functions Local unsupported and without feature parity, and recommends TestState in its place. This chapter does not use it.
