---
title: "20 CI/CD: OIDC, Environments, Previews, Rollback, and Drift"
sourceRevision: 1
---

# 20 CI/CD: OIDC, Environments, Previews, Rollback, and Drift

So far, every chapter has deployed from your machine, with your credentials, using cdkd. That is a fast way to learn. But we kept saying "the production path is in chapter 20" and "not deploying with a person's credentials is in chapter 20", didn't we?

This chapter keeps those promises. We put the chapter 04 API on the standard path: the AWS CDK CLI and CloudFormation. We let GitHub Actions into AWS without an access key stored anywhere. And we connect CloudFormation's drift detection to the drift gate from chapter 02.

One honest note up front. The AWS side of this chapter and the GitHub Actions workflows have never actually been run. What was checked locally is tests, type checks, and synthesis. The end of the chapter lists what is unconfirmed.

You need [chapter 02](/en/chapters/02-toolchain.md) and [chapter 04](/en/chapters/04-http-api.md). The code is in `examples/20-shipping/` and `tools/src/drift/`.

## The big picture

<!-- section: 20.architecture -->

```figure
caption: The laptop and GitHub Actions use the same flake.lock, the same pnpm-lock.yaml, and the same vp run tasks, and no AWS access key is stored anywhere because each job trades a GitHub OIDC token for one-hour credentials
direction: right
node laptop: Developer laptop | check:all, ship:cfn:synth
node gha: GitHub Actions | pr, deploy, drift, preview
node aws: AWS account | ap-northeast-1
edge laptop -> gha: git push
edge gha -> aws: OIDC token
edge aws --> gha: one-hour credentials
```

```figure
caption: Each of the four workflows that touch AWS uses its own IAM role
direction: right
node pr: pr.yml | check: check:all (no AWS)
node deploy: deploy.yml | check:all, status, ship:smoke
node drift: drift.yml
node preview: preview.yml
node plan: PlanRole
node deployrole: DeployRole
node driftrole: DriftRole
node previewrole: PreviewRole
edge pr -> plan: plan: ship:cfn:diff
edge deploy -> deployrole: ship:cfn:deploy
edge drift -> driftrole: ship:cfn:drift
edge preview -> previewrole: deploy / destroy
group gha: GitHub Actions = pr, deploy, drift, preview
group aws: AWS account (ap-northeast-1) = plan, deployrole, driftrole, previewrole
```

```figure
caption: Each of the four roles reaches something different, and only DeployRole and PreviewRole can create a stack
direction: right
node plan: PlanRole | pr.yml
node deployrole: DeployRole | deploy.yml
node driftrole: DriftRole | drift.yml
node previewrole: PreviewRole | preview.yml
node lookup: cdk lookup role | read only
node cdkdeploy: cdk deploy role | to CloudFormation
node detect: DetectStackDrift | read only
node prstack: AihShipApiPr<number> | preview stack
node cfn: CloudFormation | cfn-exec role creates AihShipApiProd
edge plan -> lookup
edge deployrole -> cdkdeploy
edge driftrole -> detect
edge previewrole -> prstack
edge cdkdeploy -> cfn
group aws: AWS account (ap-northeast-1) = plan, deployrole, driftrole, previewrole, lookup, cdkdeploy, detect, prstack, cfn
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
