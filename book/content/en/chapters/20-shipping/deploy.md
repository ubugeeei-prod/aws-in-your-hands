---
title: "20 CI/CD: Deploy"
---

# 20 CI/CD: Deploy

## What comes back, and what does not

<!-- section: 20.rollback -->

When we say "it rolls back if it fails, so it's fine", let's separate what actually comes back.

What can be put back is what the template describes. The function's code, environment variables, memory setting, IAM policies, routes. This is what CloudFormation puts back automatically, and what you put back with `git revert` and another deploy.

What cannot be put back is what happened in the meantime.

- Data that was written. Rows and objects the new code stored remain after the code is reverted
- A schema that was changed. After dropping a column you cannot return to the code from before the drop
- The contents of a deleted bucket or table. Unless it was `RemovalPolicy.RETAIN`, there is nothing to go back to
- Things that left the system. Mail that was sent (chapter 15), external APIs that were called

The same holds for Cloudflare Workers. Its documentation warns that a rollback does not change resources connected to the Worker, and that errors can follow if the structure of data changed between versions.

### Versions and aliases

Lambda has a mechanism for putting code back quickly.

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{version}

A Lambda version is a numbered copy of the function's code and configuration. It cannot change once published. An alias is a named pointer to a version. In this stack, API Gateway calls an alias named `live`, not the function itself. When a deploy changes the function, a new version is published and `live` moves to it.

Old versions are kept, not deleted (`RemovalPolicy.RETAIN`), so that CloudFormation can point `live` back to the previous version when it rolls an update back. In exchange, versions pile up with every deploy. They stay until the stack is deleted and the function goes with it.

An alias can also split traffic between two versions by weight: send 10% to the new one and watch. According to AWS's documentation the split is probabilistic, so with few requests the actual share can differ widely from the configured one. CodeDeploy has configurations that advance this automatically over time. Neither is implemented in this chapter. Shifting gradually without something wired to an error-rate alarm ([chapter 19](/en/chapters/19-observability.md)) to stop it only means noticing a problem later.

In a hurry, you may want to move `live` back to the previous version in the console. That does put it back, but it is a change outside CloudFormation, which is drift. The template still points at the new version, so the next deploy moves it forward again. To go back, revert the code and deploy. If you did go back by hand in an emergency, always bring the code in line afterwards. The drift detection in the second half exists to find this too.

### Change the schema in an order old code survives

Code and a database schema never change at the same instant. And a rollback puts back only the code.

So a schema change is split into an order in which the previous version of the code still works on the new schema.

1. Add. Only add the new column or table. The old code works without knowing about it
2. Ship the new code. If this rolls back, the old code runs on the schema from step 1
3. Fill in the old rows
4. Drop the old column, after confirming nobody reads it any more, and in a separate deploy

Put step 4 in the same deploy as step 2, and that deploy can no longer be rolled back. "Changing the schema of a running database" in [chapter 13](/en/chapters/13-sql.md) is the DSQL version of this. For DynamoDB, which has no schema ([chapter 05](/en/chapters/05-dynamodb.md)), the same goes for the shape of items. How to handle the time when old and new versions run side by side in containers is covered in [chapter 12](/en/chapters/12-containers.md).

## A deploy stops half-way

<!-- section: 20.partial -->

We have been talking about a deploy as one event. In fact it is a sequence of dozens of API calls, and it can stop anywhere along it.

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

This is one example (which resource is updated in which order follows from the dependencies in the template). What matters is t3 to t5. During that time the new code answers production requests. Afterwards the stack says "back to the way it was", but the data written in between has not gone back.

The rollback itself can fail, for example when a resource it should return to was deleted by hand. Then the stack becomes `UPDATE_ROLLBACK_FAILED` and stops with some parts new and some old. A stack in this state cannot be updated.

There is one invariant this chapter wants to hold. **No deploy is started on a stack that another operation is touching, or that a person has to repair before it can move on.**

<<< @/examples/20-shipping/src/stack-status.ts{next-step}

Every status CloudFormation can return has a decision about what may be done next. The `switch` has no `default`, so when the SDK's type gains a status, the type check fails.

```bash
vp run ship:cfn:status
```

It shows the stack's status and the next step. The exit code is 1 only when a person has to fix something before going on. Remember that the deploy workflow called this before deploying.

The tests try to break the invariant. Is any status ending in `_IN_PROGRESS` marked deployable? Lined up in order, do the statuses of an update that fails and rolls back ever answer "deployable" on the way? Is a stack whose rollback also failed called deployable?

`ROLLBACK_COMPLETE` (a stack whose first creation failed) is a little special. As far as CloudFormation is concerned, this stack can only be deleted. But the pinned CDK CLI deletes such a stack itself on the next `cdk deploy` and then creates it again (checked in the CLI's code). So it is marked deployable, while the message it prints says that all CloudFormation can do is delete it.

Forward or back? A rule of thumb for when you are unsure: if the stack has returned to `UPDATE_ROLLBACK_COMPLETE`, it is already back. Find the first failure in the events, fix it, and deploy again. If it is `UPDATE_ROLLBACK_FAILED`, finishing the rollback comes first (`cdk rollback`). Do not pile more changes on top of a half-new state.

## CloudFormation drift through the same gate

<!-- section: 20.drift -->

Chapter 02 built a drift gate. It told "no difference was found" apart from "everything was compared and matches", and passed only the latter. That one is for cdkd. A stack created by CloudFormation has no cdkd state. And CloudFormation's drift detection cannot examine a stack created by cdkd, because there is no stack for it to examine.

So we call CloudFormation's detection, turn the result into a report of the same shape, and put it through the same gate.

CloudFormation's drift detection is asynchronous.

1. `DetectStackDrift` starts a detection. All it returns is the detection's ID
2. `DescribeStackDriftDetectionStatus` is called repeatedly until it finishes
3. `DescribeStackResourceDrifts` reads the result for each resource

We added a fourth. `ListStackResources` counts every resource in the stack. The next section says why.

<<< @/tools/src/drift/cloudformation.ts{api}

The code in `tools/` does not know the SDK directly. It sees only a small interface with four calls. These few lines connect the real client.

<<< @/examples/20-shipping/src/drift-client.ts{adapter}

In tests, that interface is replaced with one that returns fixed responses in order.

<<< @/tools/src/drift/cloudformation.ts{detect}

The wait interval and the attempt limit are arguments. So is `sleep`, so tests do not actually wait. If it has not finished by the limit, it returns `timeout` and stops there. The point is that it does not call the third API then. `DescribeStackResourceDrifts` remembers the results of the previous detection and returns them when asked. Reading last time's "in sync" and passing, while this time's detection has not finished: that is what this prevents.

Responses go through a Zod schema before they are used, because the SDK's types only say what shape they should have. Fields that are not used are dropped. As a result, the resources' actual configuration values (`ActualProperties`) do not enter the report. What stays in the report is only the names of the properties that drifted.

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

The tests are in `tools/src/drift/cloudformation.test.ts`, and their input is the 12 files in `tools/src/drift/fixtures/cloudformation/`. Those were written from the API reference and the SDK's types. They are not responses captured from AWS. For example, the name and message of the error for a stack that does not exist are what we expect to come back. If they turn out different, the status becomes `failed` and the gate's exit code is the same 12. It never errs toward passing.

Here is the scheduled workflow.

<<< @/examples/20-shipping/workflows/drift.yml

The report is most worth reading when the gate fails, so it is kept with `if: always()`.

A schedule has a weakness too. According to GitHub's documentation, scheduled runs can be delayed or dropped at busy times, and in a public repository they are disabled automatically after 60 days without activity. "No notification arrived" does not mean "no drift". Look at the date on the report yourself now and then.

By the way, the pinned CDK CLI also has a `cdk drift` command. It calls the same CloudFormation detection and prints the result. For a quick look from your machine, that is enough. This chapter calls the API itself because it wants to count the resources that were not checked.

## `IN_SYNC` is not "everything matches"

<!-- section: 20.drift-coverage -->

When CloudFormation calls a stack `IN_SYNC`, what is it saying? Reading the documentation shows how limited the scope is (checked 2026-10-12).

- **Only resources of supported types are checked.** Unsupported ones are skipped without a word. A stack with no supported resource at all is `IN_SYNC` too
- **Only properties set explicitly in the template are compared.** If someone changes a setting you left at its default, that is not drift
- **It does not look inside nested stacks.** Detecting on the parent leaves the child to be detected separately
- **Some properties cannot be compared.** Lambda function code, `KMSKeyId`, and values a service never returns (passwords, for example)
- **Results can be old.** Each resource's result carries the time it was checked

This chapter's gate picks these up one by one. `ListStackResources` was added for the first. `DescribeStackResourceDrifts` returns only resources that were checked. We compare with the list of resources in the stack and count those without a result as unchecked. The last point is covered by not counting a resource as checked when its result's time is before the start of this detection.

Only the second cannot be caught by a gate. `clean` in the report means "every property written in the template matches". No more than that. Put the other way round, a setting you want watched for drift is worth writing explicitly in the CDK code even when it equals the default.

This is also where cdkd differs. According to cdkd's documentation, at deploy time it copies every property AWS returned into its state. So cdkd's drift finds changes to properties you never wrote in code. Neither is better; they compare different things.

### For this stack

We checked the resource types `AihShipApi` uses against the official support table.

<<< @/examples/20-shipping/src/drift-coverage.ts{coverage}

For the API Gateway integration (the setting that connects a route to Lambda), the table's drift column says "No". So this stack never becomes `clean`, even with nothing out of place. It becomes `unsupported`, and the gate returns 11.

A check that fails with 11 every day is one nobody looks at after three days. And reading 11 as "passed" would throw away the distinction from chapter 02. So a list of "types we know cannot be checked, and accept as such" lives in code.

<<< @/tools/src/drift/cloudformation.ts{acknowledge}

Only when every unchecked resource is of a type on this list does the task end with 0. The report's status stays `unsupported`, and the gate stays failed. The output also says "not compared". Only the task's exit code changes. If there is drift, or a type not on the list went unchecked, nothing changes and it fails.

Adding a type to the list is a code change. It is reviewed in a pull request, with its reason. When a resource of a new type is added to the stack, a test fails until the type is placed in one list or the other: "checked", or "knowingly not checked".

Design can help as well. This stack writes the function role's permissions inline, inside the role, and not as a separate resource (`AWS::IAM::Policy`).

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{role}

Chapter 04's way (`grantWrite`) makes the permissions a separate `AWS::IAM::Policy` resource. That type is not in the support table. Written inside the role, the permissions become a property of the role, and the role is checked. For the same reason, the `AWS::CDK::Metadata` resource is not emitted. Each "unchecked" removed is one more thing the report can say.

That said, all of this comes from reading the support table. Whether the integration really goes unchecked, and whether changing the role's permissions by hand shows up as drift, will not be known until the following procedure has actually been run.

## Break it on purpose

<!-- section: 20.drift-lab -->

With the dev stack (`AihShipApi`) deployed, you can try this in order.

1. Run `vp run ship:cfn:drift`. The integration should be shown as unchecked, the status should be `unsupported`, and the task should end with 0
2. In the Lambda console, change the function's memory from 256 MB to 512 MB
3. Run `vp run ship:cfn:diff`. It should report no changes, since neither the template nor the template CloudFormation remembers has changed
4. Run `vp run ship:cfn:drift`. It should become `drifted`, show `/MemorySize`, and exit with 10
5. Put it back. The code still says 256, so set it back to 256 in the console, or try `vp run ship:cfn:deploy --revert-drift`
6. Run `vp run ship:cfn:drift` once more and confirm the result is the same as in step 1

"Should", because this procedure has not yet been run in a real account. `--revert-drift` in step 5 is a flag in the pinned CLI's help; its behavior has not been checked. Note that when the template has not changed, an ordinary `cdk deploy` decides there is nothing to do. Drift is sometimes not fixed just by deploying again.

Chapter 02's cdkd had tasks to resolve drift (revert and accept). This chapter provides none. With CloudFormation, "treat what exists as correct" is properly done by changing the code to match and deploying.
