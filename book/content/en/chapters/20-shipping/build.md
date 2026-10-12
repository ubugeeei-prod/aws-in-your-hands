---
title: "20 CI/CD: Design and Build"
---

# 20 CI/CD: Design and Build

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

```figure
caption: The job shows STS a token signed by GitHub and gets back credentials that work for one hour
type: sequence
actor job: GitHub Actions job | id-token: write
actor issuer: GitHub OIDC issuer
actor sts: AWS STS
actor role: IAM role | trust policy
step job -> issuer: request a token (aud=sts)
step issuer --> job: signed JWT: iss, aud, sub
step job -> sts: AssumeRoleWithWebIdentity
note job: sends role ARN and JWT
step sts -> sts: signature valid?
step sts -> sts: aud == sts.amazonaws.com?
step sts -> role: sub == exactly this?
step sts --> job: credentials, valid 1 hour
note job: access key, secret key
note job: session token
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

On the day this was checked (2026-10-12), the latest `aws-actions/configure-aws-credentials` was v6.3.0. The examples in `docs/examples/` are pinned to the same version. Three inputs are used: `role-to-assume`, `aws-region`, and `allowed-account-ids`. The last one stops the job on the spot if the credentials it received belong to an account other than the expected one. It is the same idea as `AIH_AWS_ACCOUNT_ID` in chapter 01.

## A preview per pull request

<!-- section: 20.preview -->

One stack per pull request, so that a running API can be reviewed.

<<< @/examples/20-shipping/workflows/preview.yml

It deploys `AihShipApiPr<number>` when the pull request is opened or pushed to, and deletes it when the pull request closes.

It is convenient. But before you enable it, be clear about what it allows.

**Anyone who can push a branch to this repository can run their own code with close to administrator rights over the AWS account, just by opening a pull request.** No review and no merge are needed. Here is the path. The contents of the pull request (the CDK code, and the workflow file itself) run inside the job. The job becomes the PreviewRole. The PreviewRole can assume the deploy role. The deploy role can ask CloudFormation for anything, and CloudFormation carries it out as the cfn-exec role, which by default is `AdministratorAccess`. Write one IAM user into the template and it gets created. The stack may be named `AihShipApiPr12`, and its template can still rewrite prod.

The job's `if` stops pull requests from forks. That is all it stops. The workflow file that runs is the pull request's own, so a pull request that rewrites the `if` or the steps runs as rewritten. What the AWS side trusts is only the name `environment:preview`, so there are two places a wall can stand: the GitHub environment's settings, and the AWS permissions.

The ways to narrow it, most effective first.

- **Put previews in a separate account.** The only way to make "the worst case is a broken preview" true
- **Narrow the cfn-exec role and give it a permissions boundary.** That is `--cloudformation-execution-policies` and `--custom-permissions-boundary` at bootstrap. Both exist in the pinned CLI; this chapter has tried neither. A preview needs to create an API, a function, and a log group, and nothing more
- **Protect the `preview` environment.** Require an approval, or limit the branches that may deploy to ones you trust. That is why the workflow names `environment: preview`. But according to GitHub's documentation, on the Free, Pro, and Team plans required reviewers are available only for public repositories. Which plans offer the branch limit has not been checked

If you can add none of these, do not enable previews. This chapter's workflows sit under `examples/` and not `.github/workflows/`, so nothing runs until you move them yourself.

The other thing a preview adds is a public URL. One unauthenticated API per pull request. The throttle is per stack, so the ceiling on what each one can cost is as in the Money section, once for every open pull request.

The other problem is forgetting to clean up. The "delete on close" job can fail. The workflow was disabled, it sat waiting for an approval, the delete failed half-way. AWS does not know the pull request was closed. The stack stays until someone deletes it.

<<< @/examples/20-shipping/src/previews.ts{previews}

```bash
vp run ship:preview:list
vp run ship:preview:list --open 12,15
```

It lists the preview stacks with their age in days. Pass the numbers of the pull requests that are open now to `--open`, and the rest are shown as `leftover`. This task deletes nothing. Deleting is `vp run ship:cfn:destroy -c stage=pr-<number>`.

This chapter's previews cost nothing while they sit there, because they are an HTTP API and Lambda. But that is an accident of the subject. Do the same with a stack that has chapter 11's NAT Gateway or chapter 13's always-on database, and you get hourly charges multiplied by the number of pull requests. Before building previews, work out what one costs to leave in place.
