---
title: "20 CI/CD: OIDC, Environments, Previews, Rollback, and Drift"
sourceRevision: 4
---

# 20 CI/CD: OIDC, Environments, Previews, Rollback, and Drift

Every chapter so far has deployed from your machine, with your credentials, using cdkd. That is a fast way to learn, but each time the production path or deploying without a person's credentials came up, the book put it off until chapter 20.

This chapter covers both. It deploys the chapter 04 API along the standard path, the AWS CDK CLI and CloudFormation, and it lets GitHub Actions into AWS without an access key stored anywhere. It also connects CloudFormation's drift detection to the drift gate from chapter 02.

The AWS side of this chapter and the GitHub Actions workflows have never been run. What was checked locally is the tests, the type check, and synthesis. The [verification notes at the end of the chapter](/en/chapters/20-shipping/wrap.md) list what is unconfirmed.

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

As the first figure shows, three places are involved: your machine, GitHub Actions, and the AWS account.

On your machine you keep running the tests and synth with `vp run`. GitHub Actions enters the same devShell from the same `flake.lock` and calls the same `vp run` tasks. There are no CI-only scripts, because when your machine and CI run the same thing there is no room for "it passes in CI but not locally".

Four kinds of job touch AWS, and as the second figure shows, each uses its own IAM role. The pull request job only reads, a push to main deploys, and a daily schedule detects drift. The per-pull-request preview creates a stack of its own and deletes it when the pull request closes. The third figure shows what each role reaches inside AWS.

The subject is the chapter 04 API, but the stack is a new one. This chapter leaves `AihHttpApi`, which cdkd created in chapter 04, alone and has CloudFormation create a stack with another name, `AihShipApi`.

## The two paths, once more

<!-- section: 20.two-paths -->

Chapter 02 explained that there are two paths for getting a template into AWS. This section goes over both and then looks closely at the CloudFormation side.

cdkd calls each AWS service's API itself to create resources, and records what it created as JSON in S3. The AWS CDK CLI (`cdk deploy`) only hands the template to CloudFormation, which then creates the resources, keeps the record, and puts things back after a failure.

cdkd's own documentation recommends that you keep using the AWS CDK CLI for production. The reason it gives is what CloudFormation has built in, such as change sets and stack policies (checked 2026-10-12). This chapter uses the following.

- Stack: the record of what was created. It lives inside CloudFormation, not in an S3 bucket of yours
- Change set: a list, made before an update, of what the update would add, change, replace, or delete
- Automatic rollback: if even one resource fails part-way through an update, the default is to put the previous configuration back
- Drift detection: a comparison of the template with what exists. Its coverage is limited, and the second half of the [deploy page](/en/chapters/20-shipping/deploy.md) covers it in detail
- Termination protection and stack policies: guards against deleting or replacing something by mistake

### The CDK bootstrap is not cdkd's bootstrap

`cdk deploy` needs the CDK bootstrap to have been run once per account and Region. It shares a name with cdkd's bootstrap from chapter 02, but it creates different things.

```bash
vp run ship:cfn:bootstrap
```

This task changes AWS. The template that the pinned CLI (2.1145.0) carries, printed with `cdk bootstrap --show-template`, shows that it creates a CloudFormation stack named `CDKToolkit` with these contents.

| | cdkd bootstrap (chapter 02) | CDK bootstrap (this chapter) |
| --- | --- | --- |
| Created by | cdkd calling APIs directly | The CloudFormation stack `CDKToolkit` |
| S3 buckets | `cdkd-state-<account>`, `cdkd-assets-<account>-<region>` | `cdk-hnb659fds-assets-<account>-<region>` |
| ECR repository | `cdkd-container-assets-<account>-<region>` | `cdk-hnb659fds-container-assets-<account>-<region>` |
| IAM roles | None. It creates resources with the permissions of whoever runs it | Five (explained below the table) |
| Record of what was created | JSON in the state bucket | Kept by CloudFormation, not in a bucket |
| Other | | An SSM parameter recording the version, `/cdk-bootstrap/hnb659fds/version` |

`hnb659fds` is the default string called the qualifier. The value itself means nothing.

It creates five roles. The CLI uses the file-publishing role to put templates and zips into the bucket, and the image-publishing role to store container images. The deploy role gives CloudFormation its instructions, and the lookup role reads information about the account. The fifth, the cfn-exec role, is the one CloudFormation itself uses to create resources.

The cfn-exec role needs your attention. Unless you say otherwise, it gets `AdministratorAccess`, so anyone who can use the deploy role can create anything through CloudFormation simply by writing it in a template. To narrow it, pass policies with `--cloudformation-execution-policies` when you bootstrap. This chapter's task keeps the default, so in a production account review this first.

The asset bucket is configured to remain even when the `CDKToolkit` stack is deleted.

### Never manage one stack with both tools

As chapter 02 said, this book never updates a stack that cdkd created with `cdk deploy`, or the other way round. There would be two records, and each tool acts as if its own record were complete.

That is why this chapter gives its stack a different name. cdkd's documentation also describes deploying one CDK app with cdkd to a development environment and with the AWS CDK CLI to production. The unit you split the tools by is the stack, which is to say the environment.

You may one day want to move a stack that runs under cdkd into CloudFormation's management. The pinned cdkd has `export` for that, and `import --migrate-from-cloudformation` for the opposite direction. According to its help, `export` hands the resources over as they are through a CloudFormation import change set and deletes cdkd's state on success. It aborts if even one resource is of a type that cannot be imported. This is a one-time migration, separate from everyday deploys. This book has not run it, so if you try it, use a practice stack and read the plan that `--dry-run` prints first.

### One place calls the CDK CLI

As with cdkd, the arguments passed to the CLI are gathered in one function.

<<< @/examples/20-shipping/src/cdk-args.ts{invocation}

`--no-rollback`, `--hotswap`, and `--express` appear nowhere. Each makes a deploy faster, and with each CloudFormation no longer puts things back when something fails. A test pins that this function never adds them on its own.

## A separate stack for each environment

<!-- section: 20.stages -->

dev and prod are separate stacks, not one stack switched between two settings.

<<< @/examples/20-shipping/infra/lib/config.ts{stage}

`-c stage=prod` creates `AihShipApiProd`, and `-c stage=pr-12` creates `AihShipApiPr12`. With no option you get `AihShipApi`, the dev stack. The default is chosen so that forgetting the option lands on dev and not on production. An unknown stage name stops at synth.

<<< @/examples/20-shipping/infra/bin/app.ts{app}

Two settings differ for production only.

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{protection}

One is termination protection, which refuses to delete the stack until someone turns it off. The other is the log group, which production keeps when the stack is deleted. Practice and preview stacks leave nothing behind when deleted.

One setting is the same for every stage. Every stack's API has one URL that anyone can call, so dev, prod, and previews all get the same throttle as chapter 04.

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{throttle}

Separating by name only goes so far. Separate stacks in one account have no permission wall between them. As the bootstrap section showed, the deploy role can update any stack, and the cfn-exec role has administrator rights. A job that can deploy a preview can therefore, as far as permissions go, also break prod. To separate them for certain, use separate accounts. This book stays in one account, so that is not implemented.
