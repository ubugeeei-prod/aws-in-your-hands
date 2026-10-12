---
title: "20 CI/CD: Design and Build"
---

# 20 CI/CD: Design and Build

This page builds the path that the [previous page](/en/chapters/20-shipping.md) laid out, in this order: a deploy from your machine, OIDC, the roles, the workflows, and previews.

## Handing it to CloudFormation

<!-- section: 20.cfn-deploy -->

Start by deploying the dev stack from your machine to see how the steps fit together.

```bash
vp run ship:cfn:synth
vp run ship:cfn:diff
vp run ship:cfn:deploy
vp run ship:smoke
```

`synth` needs nothing but your machine. It writes two templates, `AihShipApi` and `AihShipCi`, to `examples/20-shipping/cdk.out/`.

`diff` does not compare the same things as cdkd's diff in chapter 02, which compared the template with cdkd's state. `cdk diff` compares the template you just synthesized with the template CloudFormation remembers from the last deploy. Neither diff looks at the live resources, so the same rule holds: an empty diff does not mean there is no drift.

`cdk diff` can compare in two ways. This task's default is `--method template`, which only compares the two templates and so runs with the read-only lookup role. The other, `--method change-set`, has CloudFormation create a real change set and finds out whether the change replaces a resource. It is more accurate, but it needs the deploy role. A diff that runs on pull requests should not hold permission to deploy, so the default is `--method template`.

`deploy` creates a change set and executes it. If even one resource fails to be created or updated on the way, CloudFormation by default puts back what it has changed so far. For a newly created stack, it deletes what it created. That is the automatic rollback. The [deploy page](/en/chapters/20-shipping/deploy.md) looks closely at what comes back and what does not.

A change set is a forecast, not a guarantee. The documentation says plainly that being able to create a change set does not mean the update will succeed.

When a person runs the deploy locally, the CLI asks before a change that widens permissions (`--require-approval broadening`). In CI nobody can answer, so the setting is `never`, and the check is made by the diff on the pull request and by the GitHub environment that appears later on this page.

`ship:smoke` calls the deployed API with chapter 04's typed client and also checks that the stage `/health` reports is the one that was deployed.

Another guard is the stack policy, a JSON document that declares "this resource must not be replaced" for stack updates. `StackProps` in the pinned `aws-cdk-lib` has no property for setting one, so this chapter does not use it.

## Getting into AWS without a stored key

<!-- section: 20.oidc -->

The simplest way into AWS from CI is to put an IAM user's access key in a GitHub secret. It works, but an access key never expires, so a leaked key stays usable until someone notices and deletes it. Nor can you tell from the key which job of which workflow used it.

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

The job asks GitHub for a signed token that states who it is, and shows the token to AWS STS. STS checks the signature, compares the token's contents with the role's trust policy, and if they match, returns credentials that work for one hour. All GitHub stores is the role's ARN and the account ID, and neither is a secret.

You prepare two things. The first is to register with the account that it trusts tokens issued by GitHub.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{provider}

An account can hold only one OIDC provider for a given URL. In an account that already has one, pass `-c existingOidcProviderArn=...` to use it.

The second is the role's trust policy, which decides who may use the role. With only the provider registered, every repository on GitHub would be a candidate. You narrow the candidates with the `sub` field in the token, where GitHub puts a different string for each kind of job.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{subjects}

The second line is easy to miss. When a job names an environment, `sub` carries the environment's name and not the branch's. If you write a branch condition so that only main can deploy, and the job has `environment: production`, the condition never matches at all. In the other direction, if you trust an environment's name, the restriction "only main may use this environment" has to be set in the environment's settings on GitHub. AWS's documentation also strongly recommends adding protection rules to the environment.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{trust}

The only condition operator used is `StringEquals`. With `StringLike` and `*` you could write "any branch of this repository", and that would let someone's work-in-progress branch deploy to production. Each role therefore allows exactly one string.

The repository's name arrives through CDK context. It comes from outside the types and goes straight into a trust policy, so a schema validates it.

<<< @/examples/20-shipping/infra/lib/config.ts{ci-config}

A value containing `*` or `?` stops at synth. The tests include passing `octo-org/*` and passing `*` as the branch.

The form of `sub` changed recently. According to GitHub's documentation, repositories created after July 15, 2026 use a `sub` that includes IDs, such as `repo:owner@123456/repo@456789:...`, so that a reused repository name can never produce the same `sub`. Repositories that existed before then keep the old form until they switch or are renamed. Which form your repository uses decides what you pass as `githubRepository`. This schema accepts both.

A person deploys this stack, once, so that CI cannot rewrite its own roles.

```bash
vp run ship:ci:deploy -c githubRepository=<owner>/<repo>
```

Put the four role ARNs it outputs, and the account ID, into the GitHub repository's variables (`AIH_PLAN_ROLE_ARN`, `AIH_DEPLOY_ROLE_ARN`, `AIH_PREVIEW_ROLE_ARN`, `AIH_DRIFT_ROLE_ARN`, `AIH_AWS_ACCOUNT_ID`). They can be variables; they do not need to be secrets.

## What each role may do

<!-- section: 20.roles -->

The trust policy decides who may use a role. This section decides what they can do with it. There are two ways to grant the permissions.

One is to have the role assume the roles that the CDK bootstrap created. The bootstrap roles are built so that they can be assumed from inside the same account. The GitHub role then holds only `sts:AssumeRole`, and the bootstrap roles do the actual work.

The other is to write the needed actions directly on the GitHub role.

This chapter uses each where it fits. Jobs that run the CDK CLI use the first, because the CLI is built to assume the bootstrap roles in the first place.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{bootstrap-roles}

The PlanRole for pull requests can assume the lookup role and nothing else. The roles that deploy can assume the deploy role and the file-publishing role. A test checks that these are exactly the combinations that can be assumed.

Drift detection does not go through the CDK CLI. It calls CloudFormation with the SDK, so it uses the second way.

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{drift-role}

The policy is long because CloudFormation's drift detection reads the stack's resources one by one with the caller's permissions. Permission for the CloudFormation actions is not enough, and the role also needs permission to read Lambda, IAM, and API Gateway. The actions come from the "permissions needed to read" that each resource type publishes in its schema. Whether these permissions are enough has not been confirmed by running the detection. If they are not, detection ends with a "could not read" result and the gate does not pass. In that case, read the reason in the report and add the action to this policy.

Only the last statement has `*` as its resource. Those five actions cannot be narrowed by ARN. A test pins that these five are the only ones that use `*`.

There is one thing to know about the pull request's `plan` job. It runs unreviewed code with the lookup role's permissions. The lookup role is read-only, but underneath it is the AWS managed `ReadOnlyAccess` with only KMS decryption denied, so it can read much of what is in the account. That is why the `plan` job is limited to pull requests from branches of the same repository. Whether an OIDC token is issued for a pull request from a fork has not been checked. The job stops such runs itself, so that it does not matter either way.

## The workflows

<!-- section: 20.workflows -->

The workflow files are in `examples/20-shipping/workflows/`. They are not in `.github/workflows/`, because GitHub would start running them as soon as they were there. To use them, copy them into `.github/workflows/` of your own repository.

The first workflow runs on pull requests.

<<< @/examples/20-shipping/workflows/pr.yml

The `check` job has no way into AWS, because it has neither `id-token: write` nor a step that fetches credentials. It is the job that runs for every pull request, including those from forks.

The `plan` job prints `cdk diff` against the production stack, so a reviewer can see what would change in production if the pull request were merged.

The second workflow runs on a push to main.

<<< @/examples/20-shipping/workflows/deploy.yml

The order of the steps matters. No credentials are requested until `check:all` passes. Before deploying, `ship:cfn:status` checks that the stack is in a state where an update may start. After deploying, the workflow calls the API. If anything fails along the way, the last step shows the state the stack stopped in.

`cancel-in-progress: false` under `concurrency` matters too. If a newer push cancelled a job in the middle of a deploy, only the CLI would stop, and CloudFormation's update would carry on, half-way through.

Tests pin the following points, which hold for every workflow.

- Actions are pinned by commit SHA, not by tag. Tags can be moved, and GitHub's documentation says a SHA is the only way to make an action immutable
- There is no access key, no reference to a secret, and no hard-coded account ID or ARN
- Only jobs that assume a role have `id-token: write`
- Every `run` is `nix develop --command vp ...`, and the task it calls exists in `vite.config.ts`
- Each role is used by the kind of job its trust policy expects (for example, a job using the DeployRole has `environment: production`)
- Values from outside, such as the pull request number, are never embedded directly in a shell command

On the day this was checked (2026-10-12), the latest `aws-actions/configure-aws-credentials` was v6.3.0. The examples in `docs/examples/` are pinned to the same version. The workflows use three inputs, `role-to-assume`, `aws-region`, and `allowed-account-ids`. With `allowed-account-ids` set, the job stops on the spot if the credentials it received belong to an account other than the expected one. It is the same idea as `AIH_AWS_ACCOUNT_ID` in chapter 01.

## A preview per pull request

<!-- section: 20.preview -->

With one stack per pull request, a reviewer can try the running API.

<<< @/examples/20-shipping/workflows/preview.yml

This workflow deploys `AihShipApiPr<number>` when a pull request is opened or pushed to, and deletes it when the pull request is closed.

It is convenient, but know what it allows before you enable it.

**Anyone who can push a branch to this repository can run their own code with close to administrator rights over the AWS account, just by opening a pull request.** No review and no merge are needed. This is how it happens. The contents of the pull request, both the CDK code and the workflow file itself, run inside the job. The job becomes the PreviewRole, and the PreviewRole can assume the deploy role. The deploy role can ask CloudFormation for anything, and CloudFormation carries it out as the cfn-exec role, which by default has `AdministratorAccess`. Write one IAM user into the template and that user gets created. Even though the stack is named `AihShipApiPr12`, its template can rewrite prod.

The job's `if` stops pull requests from forks, and that is all it stops. The workflow file that runs is the pull request's own, so a pull request that rewrites the `if` or the steps runs as rewritten. The AWS side trusts nothing but the name `environment:preview`, so the only two places a wall can stand are the GitHub environment's settings and the AWS permissions.

These are the ways to narrow it, most effective first.

- Put previews in a separate account. It is the only way to limit the damage to the previews themselves
- Narrow the cfn-exec role and give it a permissions boundary, with `--cloudformation-execution-policies` and `--custom-permissions-boundary` at bootstrap. Both exist in the pinned CLI, and this chapter has tried neither. A preview only needs to create an API, a Lambda function, and a log group
- Protect the `preview` environment. Require an approval, or limit the branches that may deploy to ones you trust. That is why the workflow names `environment: preview`. According to GitHub's documentation, though, on the Free, Pro, and Team plans required reviewers are available only for public repositories. Which plans offer the branch limit has not been checked

**If you can add none of these, do not enable previews.** This chapter's workflows sit under `examples/` and not `.github/workflows/`, so nothing runs until you move them yourself.

Enabling previews also adds public URLs, one unauthenticated API per pull request. The throttle applies per stack, so the ceiling on what each one can cost is the one given under [Money](/en/chapters/20-shipping/wrap.md), and you get that ceiling once for every open pull request.

Previews can also be left behind. The job that deletes a stack when its pull request closes can fail: the workflow was disabled, the job sat waiting for an approval, or the delete failed half-way. AWS does not know that the pull request was closed, so the stack stays until someone deletes it.

<<< @/examples/20-shipping/src/previews.ts{previews}

```bash
vp run ship:preview:list
vp run ship:preview:list --open 12,15
```

This task lists the preview stacks with their age in days. Pass the numbers of the pull requests that are open now to `--open`, and it marks every other stack as `leftover`. The task itself deletes nothing. To delete a stack, use `vp run ship:cfn:destroy -c stage=pr-<number>`.

This chapter's previews are only an HTTP API and Lambda, so they cost nothing while they sit there. That is true of this subject and not of previews in general. Do the same with a stack that has chapter 11's NAT Gateway or chapter 13's always-on database, and you pay hourly charges for every open pull request. Before you build previews, work out what one costs to leave in place.
