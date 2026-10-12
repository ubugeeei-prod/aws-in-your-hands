---
title: "20 CI/CD: Deploy"
---

# 20 CI/CD: Deploy

The [previous page](/en/chapters/20-shipping/build.md) built the path to CloudFormation and the workflows. This page covers what happens when a deploy fails, and how to check after a deploy that what exists has not moved away from the template.

## What comes back, and what does not

<!-- section: 20.rollback -->

"A failed deploy rolls back" is true of some things and not of others, and it helps to separate them.

What can be put back is what the template describes: the function's code, its environment variables, its memory setting, IAM policies, and routes. Whether CloudFormation puts things back automatically or you run `git revert` and deploy again, this is the range that comes back.

What cannot be put back is what happened while the new code was running.

- Data that was written. Rows and objects the new code stored remain after the code is reverted
- A schema that was changed. After a column is dropped, the code from before the drop no longer works
- The contents of a deleted bucket or table. Unless it was `RemovalPolicy.RETAIN`, there is nothing to go back to
- Things that left the system, such as mail that was sent (chapter 15) and external APIs that were called

The same holds for Cloudflare Workers. Its documentation warns that a rollback does not change resources connected to the Worker, and that errors can follow if the structure of data changed between versions.

### Versions and aliases

Lambda has a mechanism for putting code back quickly.

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{version}

A Lambda version is a numbered copy of the function's code and configuration, and it cannot change once published. An alias is a named pointer to a version. In this stack, API Gateway calls an alias named `live`, not the function itself. When a deploy changes the function, a new version is published and `live` moves to it.

Old versions are kept, not deleted (`RemovalPolicy.RETAIN`), so that CloudFormation can point `live` back to the previous version when it rolls an update back. The cost is that versions pile up with every deploy and stay until the stack is deleted and the function goes with it.

An alias can also split requests between two versions by weight, so that you send 10% to the new version and watch. According to AWS's documentation the split is probabilistic, so with few requests the actual share can differ widely from the configured one. CodeDeploy has configurations that advance the split automatically over time. This chapter implements neither, because shifting gradually with nothing wired to an error-rate alarm ([chapter 19](/en/chapters/19-observability.md)) to stop it only means you notice a problem later.

In a hurry, you may want to move `live` back to the previous version in the console. That does put it back, but it is a change made outside CloudFormation, so it is drift. The template still points at the new version, and the next deploy moves `live` forward again. To go back, revert the code and deploy. If you did go back by hand in an emergency, always bring the code in line afterwards. The drift detection later on this page is also there to find manual changes like this one.

### Change the schema in an order old code survives

Code and a database schema never change at the same moment, and a rollback puts back only the code.

So you split a schema change into steps, ordered so that the previous version of the code still works on the new schema.

1. Add. Only add the new column or table. The old code works without knowing about it
2. Ship the new code. If this rolls back, the old code runs on the schema from step 1
3. Fill in the old rows
4. Drop the old column after confirming nobody reads it any more. Do it in a separate deploy

If step 4 goes into the same deploy as step 2, that deploy can no longer be rolled back. [Chapter 13](/en/chapters/13-sql.md) tells the same story for DSQL, where it changes the schema of a running database. For DynamoDB, which has no schema ([chapter 05](/en/chapters/05-dynamodb.md)), the same goes for the shape of items. [Chapter 12](/en/chapters/12-containers.md) covers the time when old and new versions run side by side in containers.

## A deploy stops half-way

<!-- section: 20.partial -->

So far this chapter has described a deploy as one event. In fact it is a sequence of dozens of API calls, and it can stop anywhere along it.

```figure
caption: Before the stack finishes rolling back, there is a stretch where the new code answers the API's callers
type: sequence
actor cfn: CloudFormation stack
actor caller: API caller
note cfn: t1: UPDATE_IN_PROGRESS
note caller: old code (alias live -> version 7)
step cfn -> cfn: t2: AWS::Lambda::Version 8 created
note caller: old code
step cfn -> cfn: t3: alias live moved to version 8
note caller: new code
step cfn -x cfn: t4: another resource fails to update
note caller: new code
note cfn: t5: UPDATE_ROLLBACK_IN_PROGRESS
note caller: new code, then old once the alias is back
note cfn: t6: UPDATE_ROLLBACK_COMPLETE
note caller: old code; writes from t3..t5 stay written
```

The figure is one example, because the order in which resources are updated follows from the dependencies in the template. Look at t3 to t5. During that time the new code answers production requests. Afterwards the stack reports that it is back to its previous state, but the data written between t3 and t5 has not gone back.

The rollback itself can fail, for example when a resource it should return to has been deleted by hand. The stack then becomes `UPDATE_ROLLBACK_FAILED` and stops with some parts new and some old. A stack in this state cannot be updated.

This chapter holds one invariant. **No deploy is started on a stack that another operation is working on, or that a person has to repair before it can move on.**

<<< @/examples/20-shipping/src/stack-status.ts{next-step}

For every status CloudFormation can return, the code decides what may be done next. The `switch` has no `default`, so when the SDK's type gains a status, the type check fails.

```bash
vp run ship:cfn:status
```

This task shows the stack's status and the next step to take. Its exit code is 1 only when a person has to fix something before going on. It is the task that the [deploy workflow](/en/chapters/20-shipping/build.md) called before deploying.

The tests look for ways the invariant could break. They check that no status ending in `_IN_PROGRESS` is marked deployable. They line up the statuses of an update that fails and rolls back, and check that none of them answers "deployable" along the way. They also check that a stack whose rollback failed as well is not called deployable.

`ROLLBACK_COMPLETE`, the status of a stack whose first creation failed, is handled a little differently. In CloudFormation, a stack in this status can only be deleted. The pinned CDK CLI, however, deletes such a stack itself on the next `cdk deploy` and then creates it again (checked in the CLI's code). So the status is marked deployable, while the message printed says that all CloudFormation can do is delete the stack.

Here is a rule of thumb for when a deploy has failed and you are unsure whether to go forward or back. If the stack is at `UPDATE_ROLLBACK_COMPLETE`, it has already gone back. Find the first failure in the events, fix the cause, and deploy again. If it is at `UPDATE_ROLLBACK_FAILED`, finish the rollback first with `cdk rollback`. Do not pile more changes on top of a half-new state.

## CloudFormation drift through the same gate

<!-- section: 20.drift -->

Chapter 02 built a drift gate that tells "no difference was found" apart from "everything was compared and matches", and passes only the second. That gate was for cdkd. A stack created by CloudFormation has no cdkd state, so cdkd's drift detection cannot be used on it. In the other direction, a stack created by cdkd does not exist as a CloudFormation stack, so CloudFormation's drift detection cannot examine it.

This chapter therefore calls CloudFormation's drift detection, turns the result into a report of the same shape as chapter 02's, and puts it through the same gate.

CloudFormation's drift detection is asynchronous, and you call its APIs in this order.

1. `DetectStackDrift` starts a detection. All it returns is the detection's ID
2. `DescribeStackDriftDetectionStatus` is called repeatedly until the detection finishes
3. `DescribeStackResourceDrifts` reads the result for each resource

This chapter adds a fourth call, `ListStackResources`, to count every resource in the stack. The next section explains why.

<<< @/tools/src/drift/cloudformation.ts{api}

The code in `tools/` does not use the SDK directly. It depends only on a small interface with four calls. The next few lines connect the real client to that interface.

<<< @/examples/20-shipping/src/drift-client.ts{adapter}

In tests, the implementation of the interface is swapped for one that returns fixed responses in order.

<<< @/tools/src/drift/cloudformation.ts{detect}

The wait interval and the attempt limit are passed as arguments. So is `sleep`, which means the tests do not actually wait. If the detection has not finished by the limit, the function returns `timeout` and stops there, without making the third call, `DescribeStackResourceDrifts`. That API remembers the results of the previous detection and returns them when called. Stopping without calling it prevents the mistake of reading last time's "in sync" and passing while this time's detection has not finished.

Responses go through a Valibot schema before they are used, because the SDK's types only say what shape a response should have. The schema drops the fields that are not used, so the resources' actual configuration values (`ActualProperties`) never enter the report. The report keeps only the names of the properties that drifted.

The result is one of the same seven statuses as in chapter 02.

| What CloudFormation says | Status in this book | Gate exit code |
| --- | --- | --- |
| Every resource in the stack has an `IN_SYNC` from this detection | `clean` | 0 |
| A resource is `MODIFIED` | `drifted` | 10 |
| A resource is `DELETED` | `deleted` | 10 |
| A resource has no result (a type that is not supported, for example) | `unsupported` | 11 |
| There is a nested stack, a result is older than this detection, or `UNKNOWN` | `incomplete` | 11 |
| `DETECTION_FAILED`, not finished by the limit, an API error, or the stack status and resource results disagree | `failed` | 12 |
| There is no such stack | `missing-target` | 12 |

<<< @/tools/src/drift/cloudformation.ts{classify}

The tests are in `tools/src/drift/cloudformation.test.ts`, and their input is the 12 files in `tools/src/drift/fixtures/cloudformation/`. Those files were written from the API reference and the SDK's types. They are not responses captured from AWS. For example, the name and message of the error for a stack that does not exist are what is expected to come back. If the expectation is wrong, the status still becomes `failed` and the gate's exit code is the same 12. The gate cannot pass by mistake.

Next is the scheduled workflow.

<<< @/examples/20-shipping/workflows/drift.yml

The report matters most when the gate fails, so `if: always()` saves it after a failure too.

A schedule has weaknesses. According to GitHub's documentation, scheduled runs can be delayed or dropped at busy times, and in a public repository they are disabled automatically after 60 days without activity. No notification does not mean no drift. Check now and then that the date on the report is recent.

The pinned CDK CLI also has a `cdk drift` command, which calls the same CloudFormation detection and prints the result. For a quick look from your machine, `cdk drift` is enough. This chapter calls the API itself in order to count the resources that were not checked.

## `IN_SYNC` is not "everything matches"

<!-- section: 20.drift-coverage -->

When CloudFormation reports a stack as `IN_SYNC`, not everything necessarily matches. The documentation shows that the check is limited in the following ways (checked 2026-10-12).

- Only resources of supported types are checked. Unsupported ones are skipped without a word. A stack with no supported resource at all is `IN_SYNC` too
- Only properties set explicitly in the template are compared. If someone changes a setting you left at its default, that is not drift
- It does not look inside nested stacks. Detecting on the parent leaves the child to be detected separately
- Some properties cannot be compared: Lambda function code, `KMSKeyId`, and values a service never returns, such as passwords
- Results can be old. Each resource's result carries the time it was checked

This chapter's gate picks these up one by one. The `ListStackResources` call from the previous section is there for the first. `DescribeStackResourceDrifts` returns only the resources that were checked, so the gate compares them with the list of resources in the stack and counts those without a result as unchecked. It handles the fifth by not counting a resource as checked when the time on its result is before the start of this detection.

Only the second cannot be caught by a gate. `clean` in the report means that every property written in the template matches, and no more than that. A setting you want watched for drift is therefore worth writing explicitly in the CDK code even when it equals the default.

cdkd differs here. According to cdkd's documentation, at deploy time it copies every property AWS returned into its state, so cdkd's drift detection also finds changes to properties you never wrote in code. Neither is better. They compare different things.

### For this chapter's stack

The resource types `AihShipApi` uses were checked against the official support table.

<<< @/examples/20-shipping/src/drift-coverage.ts{coverage}

The API Gateway integration is the setting that connects a route to Lambda. For this type, the table's drift column says "No". So this stack never becomes `clean`, even with nothing out of place. It becomes `unsupported`, and the gate returns 11.

A check that fails with 11 every day is one nobody looks at after three days. Reading 11 as a pass, on the other hand, would throw away the distinction chapter 02 made. So the code holds a list of the types that are known to be uncheckable and are accepted as such.

<<< @/tools/src/drift/cloudformation.ts{acknowledge}

The task ends with 0 only when every unchecked resource is of a type on this list. Even then the report's status stays `unsupported` and the gate stays failed, and the output says "not compared". Only the task's exit code changes. If there is drift, or a type that is not on the list went unchecked, the task fails as before.

Adding a type to the list means changing code, so it is reviewed in a pull request along with its reason. And when a resource of a new type is added to the stack, a test fails until the type is placed in one list or the other, "checked" or "knowingly not checked".

Design can reduce the unchecked resources as well. This stack writes the function role's permissions inline, inside the role, and not as a separate `AWS::IAM::Policy` resource.

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{role}

Chapter 04's way (`grants.write`) makes the permissions a separate `AWS::IAM::Policy` resource, and that type is not in the support table. Written inside the role, the permissions become a property of the role, and the role is checked. For the same reason, the stack does not emit the `AWS::CDK::Metadata` resource. Each unchecked resource removed widens what the report can vouch for.

All of this, however, comes from reading the support table. Whether the integration really goes unchecked, and whether changing the role's permissions by hand is detected as drift, will not be known until the procedure in the next section has been run.

## Break it on purpose

<!-- section: 20.drift-lab -->

With the dev stack (`AihShipApi`) deployed, you can try the following in order.

1. Run `vp run ship:cfn:drift`. The integration should be shown as unchecked, the status should be `unsupported`, and the task should end with 0
2. In the Lambda console, change the function's memory from 256 MB to 512 MB
3. Run `vp run ship:cfn:diff`. It should report no changes, since neither the template you just synthesized nor the one CloudFormation remembers has changed
4. Run `vp run ship:cfn:drift`. It should become `drifted`, show `/MemorySize`, and exit with 10
5. Put it back. The code still says 256, so set it back to 256 in the console, or try `vp run ship:cfn:deploy --revert-drift`
6. Run `vp run ship:cfn:drift` once more and confirm the result is the same as in step 1

Every step says "should" because this procedure has not yet been run in a real account. `--revert-drift` in step 5 is a flag listed in the pinned CLI's help, and its behavior has not been checked. Also, when the template has not changed, an ordinary `cdk deploy` decides there is nothing to do, so deploying again does not always fix drift.

Chapter 02's cdkd had tasks to resolve drift (revert and accept). This chapter provides none, because with CloudFormation the proper way to treat what exists as correct is to change the code to match it and then deploy.
