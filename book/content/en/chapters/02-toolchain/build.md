---
title: "02 Toolchain: Design and Build"
---

# 02 Toolchain: Design and Build

## Every command is `vp run`

<!-- section: 02.vp -->

Every command in this book is `vp run <task name>`. No Make, no other task runner. Tasks are defined in `vite.config.ts` at the root, and you run them from the root. Type `vp run` with no name and you get the list.

Here's a confusing part: `vp` also has built-in commands, `vp dev`, `vp build`, `vp test`, and `vp check`. Those are Vite+ features. Anything with `run` in it, such as `vp run build:book`, is a task this book defines. Keep the two apart.

Tasks come in two kinds.

<<< @/vite.config.ts{kinds}

A `live` task reads or changes something outside your machine, such as AWS. It always has `cache: false`.

Why is caching a problem? `vp run` may skip a task whose input files haven't changed and replay its previous output. For a build, that saves time. But what if it happens to a deploy or to drift detection? The "succeeded" you see is from the previous run and says nothing about the account as it is now. So caching is disabled for tasks that read or change anything external. When the cache is used, `vp run` prints `cache hit, replaying`, so you can tell a replay from a fresh run.

One more thing. A task with `cache: false` receives the caller's environment variables as they are. That's why `AWS_PROFILE` reaches the task.

The operations on one CDK app are defined together by the following function.

<<< @/vite.config.ts{infra}

This chapter's sample is named `hello`, which gives you `hello:infra:synth`, `hello:infra:deploy`, and so on. Chapter 03 uses `spa`, Chapter 04 uses `api`, and the book site uses `book`.

The checks that complete entirely on your machine are gathered into one task.

```bash
vp run check:all
```

It runs format, lint, type checking, tests, synth for every CDK app, and the book build and link check. It doesn't touch AWS. Drift detection isn't in it either.

Type checking is done by `vp run typecheck`, not by `vp check`. The task runs `tsc` once per project and nothing more. There is a small detective story behind it. While this book was being written, type checks on unchanged sources would occasionally fail with an `aws-cdk-lib` import mistaken for a different module: 2 runs out of 5 on identical input. The culprit was pnpm and TypeScript 7 together. pnpm places files with identical content as hard links to one underlying file. `aws-cdk-lib` has 3,501 `index.d.ts` files that contain nothing but `export * from './lib';`, and all of them pointed at the same inode. TypeScript 7 tells files apart by inode, so it could no longer tell which was which. Setting `packageImportMethod: clone-or-copy` in `pnpm-workspace.yaml` makes pnpm copy instead of hard-link, and the failures stopped. A check that fails now and then tends to get rerun until it passes and then forgotten, but there is usually a real cause somewhere.

## What types protect, and what they don't

<!-- section: 02.types -->

The sample only creates one bucket, but it takes two settings: the name of the environment (`stage`) and how many days to keep old versions of an object (`noncurrentVersionDays`).

In CDK you can pass settings like these as context. You write them in `cdk.json` or give them on the command line as `-c stage=prod`. The trouble is that context arrives as an untyped value. Write `-c noncurrentVersionDays=30`, and what arrives is the string `"30"`, not the number `30`.

A TypeScript type annotation won't check this value for you. Writing `as HelloConfig` only silences the compiler. The value at run time doesn't change at all. Values that come from outside are checked against a schema at run time. This is called runtime validation.

<<< @/examples/02-toolchain/lib/config.ts{schema}

The type (`HelloConfig`) is derived from the schema. The type and the check aren't written separately, so you can't update one and forget the other.

<<< @/examples/02-toolchain/lib/config.ts{parse}

An invalid value fails at synth, with a message that says which field is wrong. That's before anything reaches AWS.

Later chapters work the same way. Environment variables, HTTP requests and responses, browser storage, queue messages: they all come from outside the type system. Validate once at the entry point, and trust the types inside.

Let's also be clear about what types don't protect. Code that type-checks may still lack the IAM permissions it needs. It may not fit within service limits, and it may not be correct when several operations run at the same time. Those are checked with tests and by confirming in a real environment.

## construct, stack, app

<!-- section: 02.cdk -->

AWS CDK lets you write AWS resources as TypeScript classes. It has three units.

- construct: a class that represents one or more resources. `s3.Bucket` is one
- stack: a unit of resources that are created together and deleted together
- app: the whole program, a collection of stacks

<<< @/examples/02-toolchain/lib/hello-stack.ts{stack}

The single `s3.Bucket` line in fact creates, besides the bucket, a bucket policy that denies connections that aren't HTTPS. A construct bundles defaults like this.

`removalPolicy` decides what happens to the bucket when the stack is deleted. The practice stage deletes the bucket with the stack, and `prod` keeps it. For a resource that holds data, you end up deciding resource by resource which is worse: forgetting to delete it and paying for it, or deleting something that must not be deleted. A test pins this decision.

<<< @/examples/02-toolchain/bin/app.ts{app}

Look at `env`. It sets only the Region, not the account. Written this way, synth runs without credentials and asks AWS nothing. Which account the resources go to is decided by the credentials used at deploy time. Printing that account and comparing it every time was the job of `AIH_AWS_ACCOUNT_ID` in Chapter 01.

## synth: turning code into a template

<!-- section: 02.synth -->

synth (synthesis) runs the CDK code and outputs JSON called a CloudFormation template. The output goes to `cdk.out/`. Nothing in AWS changes.

```bash
vp run hello:infra:synth
```

Open `examples/02-toolchain/cdk.out/AihHello.template.json`. You'll find two resources, `AWS::S3::Bucket` and `AWS::S3::BucketPolicy`. CDK code ends up as this declarative document.

Tests are written against this template.

```bash
vp run test:unit
```

`examples/02-toolchain/test/hello-stack.test.ts` looks at three things: the bucket is private, in `prod` it is retained on both deletion and replacement, and the configured number of days appears in the lifecycle rule. This checks that the intended template is produced. Whether AWS accepts that template, and whether the bucket it creates behaves as expected, are outside this check.

You can also change a setting and synth again. `vp run` passes the arguments after the task name through to the command unchanged.

```bash
vp run hello:infra:synth -c stage=prod
```

## cdkd: applying the template to AWS

<!-- section: 02.cdkd -->

There are two paths for applying a template to AWS.

One is the AWS CDK CLI (`cdk deploy`). It hands the template to CloudFormation. CloudFormation is an AWS service that takes a template, creates the resources, keeps its own record of what it created, and rolls back on failure. This is the standard path.

The other is cdkd. It reads the same template but, without going through CloudFormation, creates the resources by calling each AWS service's API directly (and the Cloud Control API for some). Its record of what it created (the state) is saved as JSON in an S3 bucket in your account.

cdkd is not a faster alias for `cdk deploy`. The creation path is different, and so is the place the record is kept. Three things follow from this.

1. cdkd's official documentation describes cdkd as intended for development and testing, and recommends the AWS CDK CLI for production (checked 2026-10-11; the pinned version is 0.296.28). This book uses cdkd for short iterations while learning. The production path is covered in [Chapter 20](/en/chapters/20-shipping.md).
2. Don't manage the same resource through both paths in turn. If you update a stack created with cdkd using `cdk deploy`, or the reverse, the two records disagree.
3. If the state is lost, cdkd no longer knows what it created. The state bucket has versioning enabled, and `cdkd import` exists as a means of recovery. This book has not run a recovery to confirm it, though.

As preparation, run bootstrap once per account and Region.

```bash
vp run infra:bootstrap
```

This changes AWS. According to the source of the pinned version, it creates the following three things.

| What is created | Name | Purpose |
| --- | --- | --- |
| S3 bucket | `cdkd-state-<account ID>` | Stores the state. One per account |
| S3 bucket | `cdkd-assets-<account ID>-<Region>` | Holds files for deployment |
| ECR repository | `cdkd-container-assets-<account ID>-<Region>` | Holds container images |

The name is similar, but this is not `cdk bootstrap`. `cdk bootstrap` creates a CloudFormation stack (`CDKToolkit`) that also contains IAM roles for deployment. cdkd's bootstrap creates no IAM role. cdkd creates resources directly with the permissions of the credentials you signed in with.

The code that calls cdkd is gathered in the following function. Look here to see which task becomes which arguments.

<<< @/tools/src/infra/cdkd-args.ts{invocation}

cdkd uses `us-east-1` when `AWS_REGION` is not set. So that nothing lands in a Region you didn't intend, this book's tasks always start cdkd with `AWS_REGION` set explicitly.
