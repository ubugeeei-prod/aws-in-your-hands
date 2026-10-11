---
title: "20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift"
sourceRevision: 1
---

# 20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift

So far, every chapter has deployed from your machine, with your credentials, using cdkd. That is a fast way to learn. But we kept saying "the production path is in chapter 20" and "not deploying with a person's credentials is in chapter 20", didn't we?

This chapter keeps those promises. We put the chapter 04 API on the standard path: the AWS CDK CLI and CloudFormation. We let GitHub Actions into AWS without an access key stored anywhere. And we connect CloudFormation's drift detection to the drift gate from chapter 02.

One honest note up front. The AWS side of this chapter and the GitHub Actions workflows have never actually been run. What was checked locally is tests, type checks, and synthesis. The end of the chapter lists what is unconfirmed.

You need [chapter 02](/en/chapters/02-toolchain.md) and [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/20-shipping/` and `tools/src/drift/`.

## The big picture

<!-- section: 20.architecture -->

```text
developer laptop                 GitHub Actions                      AWS account (ap-northeast-1)

vp run check:all                 pr.yml      check: check:all        (no AWS)
vp run ship:cfn:synth                        plan:  ship:cfn:diff --> PlanRole    -> cdk lookup role (read only)
git push ----------------------> deploy.yml  check:all, status,
                                             ship:cfn:deploy     --> DeployRole  -> cdk deploy role -> CloudFormation
                                             ship:smoke                             cfn-exec role creates AihShipApiProd
                                 drift.yml   ship:cfn:drift      --> DriftRole   -> DetectStackDrift (read only)
                                 preview.yml deploy / destroy    --> PreviewRole -> AihShipApiPr<number>

same flake.lock, same pnpm-lock.yaml, same `vp run` tasks on both sides
no AWS access key is stored anywhere: each job trades a GitHub OIDC token for one-hour credentials
```

There are three places, left to right.

On your machine you keep running tests and synth with `vp run`. GitHub Actions enters the same devShell from the same `flake.lock` and calls the same `vp run` tasks. There are no CI-only scripts. The aim is to leave no room for "it passes in CI but not locally".

Four kinds of job touch AWS, each with its own IAM role. A pull request only reads. A push to main deploys. The daily schedule detects drift. A per-pull-request preview creates and deletes a stack of its own.

The subject is the chapter 04 API, but the stack is a different one. We do not touch `AihHttpApi`, which cdkd created in chapter 04. This chapter has CloudFormation create a stack with another name, `AihShipApi`.

## The two paths, once more

<!-- section: 20.two-paths -->

Chapter 02 said there are two ways to get a template into AWS. Let's recap, and this time look closely at the CloudFormation side.

cdkd calls each AWS service's API itself to create resources, and records what it created as JSON in S3. The AWS CDK CLI (`cdk deploy`) only hands the template to CloudFormation. Creating, recording, and undoing after a failure are all done by CloudFormation, an AWS service.

cdkd's own documentation recommends that you keep using the AWS CDK CLI for production. The reason it gives is the tooling CloudFormation has, such as change sets and stack policies (checked 2026-10-12). Here is what this chapter uses.

- Stack: the record of what was created. It lives inside CloudFormation, not in an S3 bucket of yours
- Change set: a list of what an update would add, change, replace, or delete, made before the update
- Automatic rollback: if even one resource fails part-way through an update, the default is to put the previous configuration back
- Drift detection: comparing the template with what exists. Its coverage is limited (it stars in the second half)
- Termination protection and stack policies: guards against deleting or replacing something by accident

### Bootstrap is a different thing here

`cdk deploy` needs a CDK bootstrap, once per account and Region. It shares a name with cdkd's bootstrap from chapter 02 and nothing else.

```bash
vp run ship:cfn:bootstrap
```

This changes AWS. Reading the template that the pinned CLI (2.1145.0) carries, printed with `cdk bootstrap --show-template`, what it creates is a CloudFormation stack named `CDKToolkit` with these contents.

| | cdkd bootstrap (chapter 02) | CDK bootstrap (this chapter) |
| --- | --- | --- |
| Created by | cdkd calling APIs directly | The CloudFormation stack `CDKToolkit` |
| S3 buckets | `cdkd-state-<account>`, `cdkd-assets-<account>-<region>` | `cdk-hnb659fds-assets-<account>-<region>` |
| ECR repository | `cdkd-container-assets-<account>-<region>` | `cdk-hnb659fds-container-assets-<account>-<region>` |
| IAM roles | None. It creates resources with your own permissions | Five (explained below) |
| Record of what was created | JSON in the state bucket | Kept by CloudFormation, not in a bucket |
| Other | | An SSM parameter recording the version, `/cdk-bootstrap/hnb659fds/version` |

`hnb659fds` is the default string called the qualifier. The value itself means nothing.

There are five roles. A file-publishing role for the CLI to put templates and zips into the bucket, an image-publishing role for container images, a deploy role that gives CloudFormation its instructions, and a lookup role for reading information about the account. And a cfn-exec role, which CloudFormation itself uses to create resources.

Watch that last one. Unless you say otherwise, the cfn-exec role gets `AdministratorAccess`. So anyone who can use the deploy role can create anything through CloudFormation, simply by writing it in a template. To narrow it, pass policies with `--cloudformation-execution-policies` when bootstrapping; this chapter's task keeps the default. In a production account, review this first.

The asset bucket is set to remain even when the `CDKToolkit` stack is deleted.

### Never take turns on the same stack

Once more, from chapter 02: we do not update a cdkd stack with `cdk deploy`, or the other way round. There would be two records, each acting as if it knew everything.

That is why this chapter uses a different stack name. cdkd's documentation also describes deploying one CDK app with cdkd to a development environment and with the AWS CDK CLI to production. The unit you split tools by is the stack (the environment).

You may one day want to move a stack that runs under cdkd into CloudFormation's care. The pinned cdkd has `export` for that, and `import --migrate-from-cloudformation` for the opposite direction. According to its help, `export` hands the resources over as they are through a CloudFormation import change set and deletes cdkd's state on success. It aborts if even one resource is of a type that cannot be imported. This is a one-time migration, separate from everyday deploys. This book has not run it, so if you try it, use a practice stack and read the `--dry-run` plan first.

### One place calls the CDK CLI

As with cdkd, the arguments for the CLI are gathered in one function.

<<< @/examples/20-shipping/src/cdk-args.ts{invocation}

`--no-rollback`, `--hotswap`, and `--express` appear nowhere. Each is faster, and each means CloudFormation no longer puts things back when something fails. A test pins that this function never adds them on its own.

## An environment is a separate stack

<!-- section: 20.stages -->

dev and prod are not "modes" of one stack. They are different stacks.

<<< @/examples/20-shipping/infra/lib/config.ts{stage}

With `-c stage=prod`, the stack is `AihShipApiProd`. With `-c stage=pr-12`, it is `AihShipApiPr12`. With nothing, it is `AihShipApi` (dev). It is arranged so that "I gave no option and hit production" cannot happen. An unknown stage name stops at synth.

<<< @/examples/20-shipping/infra/bin/app.ts{app}

Production differs in two ways.

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{protection}

One is termination protection, which refuses to delete the stack until someone turns it off. The other is that the log group is not deleted with the stack. Practice and preview stacks leave nothing behind when deleted.

Here is the limit of separating by name. Separate stacks in one account have no permission wall between them. As we just saw, the deploy role can update any stack, and the cfn-exec role is an administrator. A job that can deploy a preview can, as far as permissions go, also break prod. If you really want them apart, use separate accounts. This book stays in one account, so that is not implemented.

## Handing it to CloudFormation

<!-- section: 20.cfn-deploy -->

Let's walk through it from your machine, with the dev stack.

```bash
vp run ship:cfn:synth
vp run ship:cfn:diff
vp run ship:cfn:deploy
vp run ship:smoke
```

`synth` needs nothing but your machine. It writes two templates, `AihShipApi` and `AihShipCi`, to `examples/20-shipping/cdk.out/`.

What does `diff` compare? cdkd's diff in chapter 02 compared the template with cdkd's state. `cdk diff` compares the template you just synthesized with the template CloudFormation remembers from the last deploy. Neither looks at the live resources. So the same rule holds here: an empty diff does not mean there is no drift.

`cdk diff` has two ways of comparing. This task's default is `--method template`. It only compares the two templates, and it runs with the read-only lookup role. The other, `--method change-set`, has CloudFormation actually create a change set and asks it whether the change replaces a resource. It is more accurate, and it needs the deploy role. We do not want to give a diff that runs on pull requests the permission to deploy, so the default is the first.

`deploy` creates a change set and executes it. If even one resource fails to be created or updated on the way, CloudFormation by default puts back what it changed so far. For a newly created stack, it deletes what it created. That is the automatic rollback. What comes back and what does not is the subject of a later section.

A change set is a forecast, not a guarantee. The documentation says plainly that a change set that was created does not guarantee the update will succeed.

When a person runs it locally, the CLI asks before a change that widens permissions (`--require-approval broadening`). In CI nobody can answer, so it is `never`. What stands in for the question is the diff on the pull request and the GitHub environment that appears below.

`ship:smoke` calls the deployed API with chapter 04's typed client. It also checks that the stage `/health` reports is the one that was deployed.

There is one more guard, the stack policy: a JSON document that declares "this resource must not be replaced" for stack updates. `StackProps` in the pinned `aws-cdk-lib` has no property to set one. This chapter does not use it.

## Getting into AWS without a stored key

<!-- section: 20.oidc -->

The plainest way into AWS from CI is to put an IAM user's access key in a GitHub secret. It works. But that key never expires, and if it leaks, it stays usable until someone notices and deletes it. Nor can you tell from the key which job of which workflow used it.

With OIDC (OpenID Connect) there is no key to store.

```text
GitHub Actions job             GitHub OIDC issuer            AWS STS                 IAM role (trust policy)
  | permissions: id-token: write     |                          |                           |
  |--- request a token (aud=sts) --->|                          |                           |
  |<-- signed JWT: iss, aud, sub ----|                          |                           |
  |--- AssumeRoleWithWebIdentity(role ARN, JWT) --------------->|                           |
  |                                  |                          |--- signature valid?       |
  |                                  |                          |--- aud == sts.amazonaws.com?
  |                                  |                          |--- sub == exactly this? ->|
  |<-- access key, secret key, session token (valid for 1 hour) |                           |
```

The job asks GitHub for a signed token that says who it is, and shows that to AWS STS. STS checks the signature, compares the token with the role's trust policy, and if they match, returns credentials that work for one hour. All GitHub stores is the role's ARN and the account ID. Neither is a secret.

There are two things to prepare. First, register with the account that it trusts tokens issued by GitHub.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{provider}

An account can hold only one OIDC provider for a given URL. In an account that already has it, pass `-c existingOidcProviderArn=...` to use the existing one.

Next is the role's trust policy: who may use this role. With only the provider registered, every repository on GitHub would be a candidate. What narrows it is the `sub` field in the token, and GitHub puts a different string there for each kind of job.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{subjects}

The second one is easy to miss. When a job names an environment, `sub` carries the environment's name and not the branch's. You can write a branch condition meaning "only main may deploy", and if the job has `environment: production`, that condition never matches at all. Conversely, if you trust an environment's name, the restriction "only main may use this environment" has to live in the environment's settings on GitHub. AWS's documentation strongly recommends protection rules there too.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{trust}

The only condition operator is `StringEquals`. With `StringLike` and `*` you could write "any branch of this repository", which means "someone's work-in-progress branch can deploy to production". Each role allows exactly one string.

The repository's name arrives through CDK context. It comes from outside the types, and it goes straight into a trust policy.

<<< @/examples/20-shipping/infra/lib/config.ts{ci-config}

A value containing `*` or `?` stops at synth. The tests include `octo-org/*` and a `*` passed as the branch.

There is also a recent change. According to GitHub's documentation, repositories created after July 15, 2026 use a `sub` that includes IDs, such as `repo:owner@123456/repo@456789:...`, so that a reused name can never produce the same `sub`. Repositories that existed before keep the old form until they opt in or are renamed. Which one yours is decides what you pass as `githubRepository`. This schema accepts both forms.

A person deploys this stack, once. CI should not be able to rewrite its own roles.

```bash
vp run ship:ci:deploy -c githubRepository=<owner>/<repo>
```

Put the four role ARNs it outputs, and the account ID, into the GitHub repository's variables (`AIH_PLAN_ROLE_ARN`, `AIH_DEPLOY_ROLE_ARN`, `AIH_PREVIEW_ROLE_ARN`, `AIH_DRIFT_ROLE_ARN`, `AIH_AWS_ACCOUNT_ID`). Variables, not secrets, are fine.

## What each role may do

<!-- section: 20.roles -->

The trust policy says who may use the role. Now for what they can do with it. There are two approaches.

One is to have the role assume the roles that the CDK bootstrap created. Those are built so that they can be assumed from inside the same account. The GitHub role holds only `sts:AssumeRole`, and the bootstrap roles do the actual work.

The other is to write the needed actions directly on the GitHub role.

This chapter uses both, each where it fits. Jobs that run the CDK CLI use the first. The CLI is built to assume the bootstrap roles to begin with, so we go along with it.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{bootstrap-roles}

The PlanRole for pull requests can assume the lookup role and nothing else. The deploying roles get the deploy role and the file-publishing role. A test checks that the combinations are exactly these.

Drift detection does not go through the CDK CLI. It calls CloudFormation with the SDK, so it takes the second approach.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{drift-role}

It is long for a reason. CloudFormation's drift detection reads the stack's resources one by one with the caller's permissions. Permission for the CloudFormation actions is not enough; you also need permission to read Lambda, IAM, and API Gateway. The actions come from the "permissions needed to read" that each resource type publishes in its schema. To be honest, whether these are enough has not been confirmed by running it. If they are not, detection ends with "could not read", and the gate does not pass. The reason in the report then says what to add here.

Only the last statement has `*` as its resource. Those five actions have no way to be narrowed by ARN. A test pins that these five are the only ones using `*`.

And one more honest point. In the pull request's `plan` job, unreviewed code runs with the lookup role's permissions. The lookup role is read-only, but underneath it is the AWS managed `ReadOnlyAccess` (with only KMS decryption denied). It can read a lot of what is in the account. That is why this job is limited to pull requests from branches of the same repository. Whether an OIDC token is issued for a pull request from a fork has not been checked. The job stops such runs itself, so it does not matter either way.

## The workflows

<!-- section: 20.workflows -->

The actual workflows are in `examples/20-shipping/workflows/`. They are not in `.github/workflows/`, because GitHub would start running them the moment they were. To use them, copy them into `.github/workflows/` of your own repository.

First, pull requests.

<<< @/examples/20-shipping/workflows/pr.yml

The `check` job has no way into AWS. It has neither `id-token: write` nor a credentials step. This is the job that runs for every pull request, forks included.

The `plan` job prints `cdk diff` against the production stack. "What changes in production if this pull request is merged" becomes something to review.

Next, a push to main.

<<< @/examples/20-shipping/workflows/deploy.yml

The order matters. No credentials are requested until `check:all` passes. Before deploying, `ship:cfn:status` checks that the stack is in a state where an update may start. After deploying, the API is called. If anything fails, the last step shows the state the stack stopped in.

`cancel-in-progress: false` under `concurrency` matters too. Stopping a deploying job because a newer push arrived kills only the CLI, while CloudFormation's update keeps running, half-way.

Tests pin what all the workflows have in common.

- Actions are pinned by commit SHA, not by tag. Tags can be moved, and GitHub's documentation says a SHA is the only way to make an action immutable
- There is no access key, no reference to a secret, and no hard-coded account ID or ARN
- Only jobs that assume a role have `id-token: write`
- Every `run` is `nix develop --command vp ...`, and the task it calls exists in `vite.config.ts`
- Each role is used by the kind of job its trust policy expects (a job using the DeployRole has `environment: production`, and so on)
- Values from outside, such as the pull request number, are never embedded directly in a shell command

On the day this was checked (2026-10-12), the latest `aws-actions/configure-aws-credentials` was v6.3.0. The examples in `docs/examples/` from chapter 02 still use v4. Three inputs are used: `role-to-assume`, `aws-region`, and `allowed-account-ids`. The last one stops the job on the spot if the credentials it received belong to an account other than the expected one. It is the same idea as `AIH_AWS_ACCOUNT_ID` in chapter 01.

## A preview per pull request

<!-- section: 20.preview -->

One stack per pull request, so that a running API can be reviewed.

<<< @/examples/20-shipping/workflows/preview.yml

It deploys `AihShipApiPr<number>` when the pull request is opened or pushed to, and deletes it when the pull request closes.

It is convenient, and the limit described earlier shows up in full. This job runs unreviewed code with permission to deploy. The deploy role that the PreviewRole assumes can update any stack in the account. The workflow names `environment: preview` so that GitHub can require an approval for that environment. But according to GitHub's documentation, on the Free, Pro, and Team plans required reviewers are available only for public repositories. If you cannot require approval, the safe choices are a separate account for previews, or no previews.

The other problem is forgetting to clean up. The "delete on close" job can fail. The workflow was disabled, it sat waiting for an approval, the delete failed half-way. AWS does not know the pull request was closed. The stack stays until someone deletes it.

<<< @/examples/20-shipping/src/previews.ts{previews}

```bash
vp run ship:preview:list
vp run ship:preview:list --open 12,15
```

It lists the preview stacks with their age in days. Pass the numbers of the pull requests that are open now to `--open`, and the rest are shown as `leftover`. This task deletes nothing. Deleting is `vp run ship:cfn:destroy -c stage=pr-<number>`.

This chapter's previews cost nothing while they sit there, because they are an HTTP API and Lambda. But that is an accident of the subject. Do the same with a stack that has chapter 11's NAT Gateway or chapter 13's always-on database, and you get hourly charges multiplied by the number of pull requests. Before building previews, work out what one costs to leave in place.

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

An alias can also split traffic between two versions by weight: send 10% to the new one and watch. According to AWS's documentation the split is probabilistic, so with few requests the actual share can differ widely from the configured one. CodeDeploy has configurations that advance this automatically over time. Neither is implemented in this chapter. Shifting gradually without something that stops on error rate (planned for chapter 19) only means noticing a problem later.

In a hurry, you may want to move `live` back to the previous version in the console. That does put it back, but it is a change outside CloudFormation, which is drift. The template still points at the new version, so the next deploy moves it forward again. To go back, revert the code and deploy. If you did go back by hand in an emergency, always bring the code in line afterwards. The drift detection in the second half exists to find this too.

### Change the schema in an order old code survives

Code and a database schema never change at the same instant. And a rollback puts back only the code.

So a schema change is split into an order in which the previous version of the code still works on the new schema.

1. Add. Only add the new column or table. The old code works without knowing about it
2. Ship the new code. If this rolls back, the old code runs on the schema from step 1
3. Fill in the old rows
4. Drop the old column, after confirming nobody reads it any more, and in a separate deploy

Put step 4 in the same deploy as step 2, and that deploy can no longer be rolled back. "Changing the schema of a running database" in [chapter 13](/en/chapters/13-sql.md) is the DSQL version of this. For DynamoDB, which has no schema ([chapter 05](/en/chapters/05-dynamodb.md)), the same goes for the shape of items. How to handle the time when old and new versions run side by side in containers is planned for chapter 12.

## A deploy stops half-way

<!-- section: 20.partial -->

We have been talking about a deploy as one event. In fact it is a sequence of dozens of API calls, and it can stop anywhere along it.

```text
time  CloudFormation stack status              what a caller of the API gets
t1    UPDATE_IN_PROGRESS                       old code (alias `live` -> version 7)
t2    (new AWS::Lambda::Version 8 created)     old code
t3    (alias `live` moved to version 8)        new code
t4    (another resource fails to update)       new code
t5    UPDATE_ROLLBACK_IN_PROGRESS              new code, then old code once the alias is put back
t6    UPDATE_ROLLBACK_COMPLETE                 old code; whatever was written during t3..t5 stays written
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

## If you come from Workers

<!-- section: 20.workers -->

Compared with deploying Cloudflare Workers, the differences are roughly these.

| | Cloudflare Workers | This chapter |
| --- | --- | --- |
| Deploy | `wrangler deploy` creates a version and switches to 100% at once | Synth, then CloudFormation applies the template's differences one by one |
| Versions and switching | Versions and deployments. Traffic can be split between two versions by percentage | Lambda versions and an alias. Weights are possible but not implemented here |
| Going back | `wrangler rollback`, to one of the 100 most recent versions | CloudFormation puts things back on failure. Later, revert the code and deploy |
| CI authentication | The documented setup stores an API token as a CI secret | OIDC, receiving credentials valid for one hour. No secret is stored |
| What does not come back | The contents of KV, R2, D1, and so on are not part of a version | Data, schema, and whatever left the system |

Workers gets there in far fewer steps. A Worker is one unit, and switching versions is instant. This chapter is long because it updates separate resources in sequence: API Gateway, Lambda, a role, a log group. The "stops half-way" story comes from that as well.

On what does not come back, the two were the same.

## Money

Amounts are in USD, for the Tokyo Region, on demand, before tax. The calculations are in [Pricing calculations](/en/reference/pricing.md).

What this chapter adds costs almost nothing in itself. CloudFormation adds no charge for resource types beginning with `AWS::`. IAM roles and the OIDC provider are part of IAM, at no additional charge. The contents of the stack (an HTTP API and Lambda) are as in chapter 04: 0 when nobody calls. Drift detection incurs no CloudFormation charge either.

What grows is the CDK asset bucket. Each deploy adds one zip of the function's code. Deploying once a day for a year and never cleaning up, the monthly storage charge came to less than one cent (USD 0.001192, assuming 137 KB per zip and S3 Standard at USD 0.025 per GB-month). The 137 KB is this chapter's bundle compressed locally, not a measurement of the zip the CLI actually makes. For a stack that uses container images, the order of magnitude changes.

GitHub Actions charges are not an AWS bill. According to GitHub's documentation, standard runners are free in public repositories, and private repositories get free minutes each month by plan (2,000 on GitHub Free). How many minutes one run of this chapter's workflows takes is unknown, since they have not been run.

What a preview stack costs depends on what is in it, as the section above said.

## Where you get stuck

These were not met by running anything. They are the places the documentation and the code say you are likely to get stuck.

| If this happens | Look here |
| --- | --- |
| `cdk deploy` says the environment is not bootstrapped, or it cannot assume a role | Has `vp run ship:cfn:bootstrap` been run for this account and Region? cdkd's bootstrap is no substitute |
| `AssumeRoleWithWebIdentity` is refused in GitHub Actions | The token's `sub` and the string in the trust policy must match to the character. Does the job have an `environment`? Does the repository use the form with IDs (`owner@123/repo@456`)? |
| Deploying `AihShipCi` fails because the OIDC provider already exists | The account already has it. Add `-c existingOidcProviderArn=...` |
| The first deploy failed and the stack remains in `ROLLBACK_COMPLETE` | CloudFormation cannot update this stack. On the next `ship:cfn:deploy` the CLI deletes it and creates it again. Find the cause of the failure in the events first |
| `ship:cfn:drift` is `failed` and the reason says `not authorized` | The DriftRole lacks permission to read that resource type. Add it in `ci-stack.ts` |
| `ship:cfn:drift` ends with 11 every time | An unchecked type is not on the list in `drift-coverage.ts`. Check the support table to see whether it really cannot be checked, then add it |
| `ship:cfn:diff` is empty but the behavior differs | The diff compares templates. Run `vp run ship:cfn:drift` |
| The prod stack cannot be deleted | That is termination protection. If you really mean to delete it, turn it off in the console first |

## Taking it to production

- **Narrow the cfn-exec role.** The default is `AdministratorAccess`. Pass only the policies you need when bootstrapping
- **Separate the accounts.** As long as dev, preview, and prod share an account, only names keep them apart
- **Protect the `production` environment.** Limit the branches that may deploy to main, and require approval. What the trust policy trusts is this environment's name
- **Add something that stops on error rate, then shift gradually.** Alias weights and CodeDeploy go together with alarms (planned for chapter 19)
- **Send the drift report somewhere people look.** Do not rely only on the notification of a failed job. Schedules can stop
- **Clean up assets.** The pinned CLI has `cdk gc`. This chapter has not tried it
- **Watch the OIDC provider and the CI roles for drift too.** This chapter's DriftRole can read only stacks whose names begin with `AihShipApi`. If someone rewrites `AihShipCi`, it goes unnoticed

## Cleaning up

<!-- section: 20.cleanup -->

```bash
vp run ship:preview:list
vp run ship:cfn:destroy
vp run ship:ci:destroy
```

If preview stacks remain, delete them one at a time with `vp run ship:cfn:destroy -c stage=pr-<number>`. If you created prod, turn off termination protection, then use `-c stage=prod`. The prod log group remains after the stack is deleted.

`ship:ci:destroy` removes the OIDC provider and the four roles. Delete the variables in the GitHub repository and the workflows you copied to `.github/workflows/` yourself. If the workflows stay, they will try to assume roles that no longer exist and fail every day.

What remains last is the CDK bootstrap. The `CDKToolkit` stack can be deleted from the CloudFormation console, but the asset bucket is set to remain, so empty it and delete it separately. If other CDK apps use `cdk deploy` in the same account, do not delete it. There is no task for this cleanup.

This chapter changed nothing in cdkd's bootstrap (chapter 02) or in chapter 04's `AihHttpApi`.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (drift polling, classification, and gate; the call order through a substituted SDK client; trust policies and role permissions; a stack per stage; CDK CLI arguments; the next step for each stack status; preview listing; the workflow YAML). Type checks. Synthesis with the pinned CDK CLI (`ship:cfn:synth`, also with other stages). That an unknown stage, and a deploy of the CI roles without a repository, stop before any AWS call. All on macOS (Apple silicon).

**Not checked yet.** Everything that touches AWS or GitHub is unrun: `ship:cfn:bootstrap`, `ship:cfn:diff`, `ship:cfn:deploy`, `ship:smoke`, `ship:cfn:status`, `ship:cfn:drift`, `ship:preview:list`, `ship:cfn:destroy`, `ship:ci:diff`, `ship:ci:deploy`, `ship:ci:destroy`, the four workflows, the "Break it on purpose" procedure, and `cdkd export` and `cdkd import --migrate-from-cloudformation`. In particular, these wait for a real environment.

- That IAM accepts the trust policies and only the intended jobs can assume the roles. Whether a token is issued for a pull request from a fork
- That `cdk diff` and `cdk deploy` work by assuming the bootstrap roles from the GitHub roles
- That the DriftRole's read permissions suffice for a real detection
- The actual shape of CloudFormation's drift responses. The fixtures were written from the API reference and the SDK's types. The name and message of the error for a missing stack are also an expectation
- That the integration goes unchecked, that a change to the inline policy shows as drift on the role, and that result times are at or after the detection's start time
- What the rollback of a failed deploy looks like, and that old versions remain
- That the Nix devShell works on an x86_64-linux runner

**Relation to cdkd.** This chapter's two stacks are not deployed with cdkd, but the rule says to check, so we did. The pinned cdkd (0.296.28) registers no dedicated implementation for `AWS::Lambda::Alias`, `AWS::Lambda::Version`, or `AWS::IAM::OIDCProvider`. The other types (`AWS::ApiGatewayV2::*`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`) have one.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The two paths, once more | `examples/20-shipping/src/cdk-args.ts`, `scripts/cdk.ts`, `cdk.json` | `ship:cfn:bootstrap`, `ship:cfn:synth` |
| An environment is a separate stack | `examples/20-shipping/infra/lib/config.ts`, `infra/lib/ship-api-stack.ts`, `infra/bin/app.ts`, `infra/test/ship-api-stack.test.ts` | `ship:cfn:synth`, `test:unit` |
| Handing it to CloudFormation | `examples/20-shipping/src/cdk-args.ts`, `test/cdk-args.test.ts`, `scripts/smoke.ts`, `src/stack-info.ts` | `ship:cfn:diff`, `ship:cfn:deploy`, `ship:smoke` |
| Getting into AWS without a stored key | `examples/20-shipping/infra/lib/ci-stack.ts`, `infra/lib/config.ts`, `infra/test/ci-stack.test.ts` | `ship:ci:diff`, `ship:ci:deploy`, `test:unit` |
| What each role may do | `examples/20-shipping/infra/lib/ci-stack.ts`, `infra/test/ci-stack.test.ts` | `test:unit` |
| The workflows | `examples/20-shipping/workflows/`, `test/workflows.test.ts` | `test:unit` |
| A preview per pull request | `examples/20-shipping/workflows/preview.yml`, `src/previews.ts`, `scripts/previews.ts`, `test/previews.test.ts` | `ship:preview:list` |
| What comes back, and what does not | `examples/20-shipping/infra/lib/ship-api-stack.ts` | `test:unit` |
| A deploy stops half-way | `examples/20-shipping/src/stack-status.ts`, `test/stack-status.test.ts`, `scripts/status.ts` | `ship:cfn:status` |
| CloudFormation drift through the same gate | `tools/src/drift/cloudformation.ts`, `cloudformation-schema.ts`, `cloudformation.test.ts`, `fixtures/cloudformation/`, `examples/20-shipping/src/drift-client.ts`, `test/drift-client.test.ts`, `scripts/drift.ts` | `ship:cfn:drift`, `test:unit` |
| `IN_SYNC` is not "everything matches" | `examples/20-shipping/src/drift-coverage.ts`, `infra/test/ship-api-stack.test.ts` | `ship:cfn:drift`, `test:unit` |
| Cleaning up | `examples/20-shipping/scripts/cdk.ts` | `ship:cfn:destroy`, `ship:ci:destroy` |
| Money | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-12)

- CloudFormation: [drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html), [detecting drift on a whole stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html), [resource type support](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html), [failure options](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html), [stack statuses](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html), [continuing a rollback](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html), [change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html), [stack policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html), [termination protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html), [pricing](https://aws.amazon.com/cloudformation/pricing/)
- CloudFormation API reference: [DetectStackDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DetectStackDrift.html), [DescribeStackDriftDetectionStatus](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackDriftDetectionStatus.html), [DescribeStackResourceDrifts](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackResourceDrifts.html), [StackResourceDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_StackResourceDrift.html), [ListStackResources](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListStackResources.html), [CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)
- AWS CDK: [bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html), [bootstrapping an environment](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html), [cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html), [cdk drift](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-drift.html), [aws-cdk 2.1145.0](https://www.npmjs.com/package/aws-cdk/v/2.1145.0) (help output, README, `cdk bootstrap --show-template`)
- IAM: [roles for OIDC](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html), [creating an OIDC provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html), [IAM FAQs](https://aws.amazon.com/iam/faqs/)
- Sources for permissions: [CloudFormation resource type schemas](https://schema.cloudformation.ap-northeast-1.amazonaws.com/CloudformationSchema.zip), AWS service reference ([CloudFormation](https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json), [CloudWatch Logs](https://servicereference.us-east-1.amazonaws.com/v1/logs/logs.json))
- GitHub: [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc), [configuring OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use), [events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Actions: [aws-actions/configure-aws-credentials v6.3.0](https://github.com/aws-actions/configure-aws-credentials/tree/e1253824e5c10ff9df46874f81ed3ec929e19cfd). For `actions/checkout` v7.0.1, `cachix/install-nix-action` v31.11.1, and `actions/upload-artifact` v7.0.2, the latest release and its commit were read from GitHub's API
- Lambda: [versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html), [weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html), [CodeDeploy deployment configurations](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html)
- cdkd: [Introduction](https://cdkd.dev/introduction/), [Drift](https://cdkd.dev/drift/index.html), [drift CLI reference](https://cdkd.dev/cli-drift/index.html), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (help for `export` and `import`, provider registration)
- Cloudflare Workers: [Versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/), [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [@aws-sdk/client-cloudformation 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-cloudformation/v/3.1149.0), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (type definitions)

:::
