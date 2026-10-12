---
title: "02 Toolchain: Design and Build"
---

# 02 Toolchain: Design and Build

This page picks up after you have entered the environment and installed the dependencies. It goes through the sample in this order: how tasks work, validating settings, the CDK code, synth, and cdkd.

## Every command is `vp run`

<!-- section: 02.vp -->

You run every command in this book as `vp run <task name>`. The book uses no Make and no other task runner. Tasks are defined in `vite.config.ts` at the root, and you run them from the root. Typing `vp run` with no task name prints the list of tasks.

`vp` also has built-in commands such as `vp dev`, `vp build`, `vp test`, and `vp check`, which are features of Vite+. A command with `run` in it, such as `vp run build:book`, is a task this book defines. The names look alike, so take care not to mix them up.

Tasks come in two kinds.

<<< @/vite.config.ts{kinds}

A `live` task reads or changes something outside your machine, such as AWS, and always has `cache: false`.

Caching is disabled because `vp run` may skip a task whose input files have not changed and replay its previous output. For a build that saves time. If the same thing happened to a deploy or to drift detection, the "succeeded" on your screen would be from the previous run and would say nothing about the account as it is now. When the cache is used, `vp run` prints `cache hit, replaying`, so you can tell a replay from a fresh run.

`cache: false` has one more effect: the task receives the caller's environment variables unchanged. That is why `AWS_PROFILE` reaches the task.

The operations on one CDK app are defined together by the following function.

<<< @/vite.config.ts{infra}

This chapter's sample is named `hello`, which gives you tasks such as `hello:infra:synth` and `hello:infra:deploy`. Chapter 03 uses `spa`, chapter 04 uses `api`, and the book's site uses `book`.

The checks that run entirely on your machine are gathered into one task.

```bash
vp run check:all
```

`check:all` runs format, lint, type checking, tests, synth for every CDK app, and the book build and link check. It does not touch AWS, and it does not include drift detection.

Type checking uses `vp run typecheck`, not `vp check`. The task only runs `tsc` once per project. While this book was being written, this task failed in a way that was hard to explain. On unchanged sources, a type error that mistook an `aws-cdk-lib` import for a different module appeared in 2 runs out of 5 on identical input. The cause was pnpm and TypeScript 7 together. pnpm places files with identical content as hard links to one underlying file. `aws-cdk-lib` has 3,501 `index.d.ts` files that contain nothing but `export * from './lib';`, and all of them pointed at the same inode. TypeScript 7 tells files apart by inode, so it could no longer distinguish them. After `packageImportMethod: clone-or-copy` in `pnpm-workspace.yaml` made pnpm copy instead of hard-link, the error stopped appearing. A check that fails now and then tends to be left alone because a rerun passes, but there is usually a cause somewhere.

## What types protect, and what they don't

<!-- section: 02.types -->

The sample creates only one bucket, but it takes two settings: the name of the environment (`stage`) and the number of days to keep old versions of an object (`noncurrentVersionDays`).

In CDK you can pass settings like these as context. You write them in `cdk.json` or give them on the command line, as in `-c stage=prod`. Context arrives as an untyped value, however. When you write `-c noncurrentVersionDays=30`, what arrives is the string `"30"`, not the number `30`.

A TypeScript type annotation does not check this value. Writing `as HelloConfig` only silences the compiler, and the value at run time stays the same. So a value that comes from outside is checked against a schema at run time. This check is called runtime validation.

<<< @/examples/02-toolchain/lib/config.ts{schema}

The type (`HelloConfig`) is derived from the schema. Because the type and the check are not written separately, you can't update one and forget the other.

<<< @/examples/02-toolchain/lib/config.ts{parse}

An invalid value fails at synth with a message that names the bad field, so it never reaches AWS.

Later chapters work the same way. Environment variables, HTTP requests and responses, browser storage, and queue messages all arrive from outside the type system. The code validates them once at the entry point and trusts the types inside it.

There are also things types do not protect. Code that type-checks may still lack the IAM permissions it needs, may not fit within service limits, and may not behave correctly when several operations run at the same time. Tests and checks in a real environment cover those.

## Construct, stack, app

<!-- section: 02.cdk -->

AWS CDK lets you write AWS resources as TypeScript classes. It has three units.

- construct: a class that represents one or more resources. `s3.Bucket` is a construct
- stack: a unit of resources that are created together and deleted together
- app: the whole program, a collection of stacks

<<< @/examples/02-toolchain/lib/hello-stack.ts{stack}

The single `s3.Bucket` line creates, besides the bucket, a bucket policy that denies connections that are not HTTPS. A construct bundles default settings like this one.

`removalPolicy` decides what happens to the bucket when the stack is deleted. The practice stage deletes the bucket with the stack, and `prod` keeps it. For a resource that holds data, you have to decide, resource by resource, which is worse: forgetting to delete it and paying for it, or deleting something that must not be deleted. The sample pins this decision with a test.

<<< @/examples/02-toolchain/bin/app.ts{app}

`env` sets only the Region, not the account. Written this way, synth runs without credentials and asks AWS nothing. The account the resources go to is decided by the credentials used at deploy time. `AIH_AWS_ACCOUNT_ID`, which you set in chapter 01, is what that account is printed and compared against every time.

## synth: turning code into a template

<!-- section: 02.synth -->

synth (synthesis) runs the CDK code and writes JSON called a CloudFormation template to `cdk.out/`. Nothing in AWS changes.

```bash
vp run hello:infra:synth
```

If you open `examples/02-toolchain/cdk.out/AihHello.template.json`, you find two resources, `AWS::S3::Bucket` and `AWS::S3::BucketPolicy`. CDK code ends up as this declarative document.

Tests are written against this template.

```bash
vp run test:unit
```

`examples/02-toolchain/test/hello-stack.test.ts` checks that the bucket is private, that in `prod` the bucket is retained on both deletion and replacement, and that the configured number of days appears in the lifecycle rule. What the test establishes is that the intended template is produced. Whether AWS accepts that template, and whether the bucket it creates behaves as expected, are outside the test.

You can also change a setting and synth again. `vp run` passes the arguments after the task name through to the command unchanged.

```bash
vp run hello:infra:synth -c stage=prod
```

## cdkd: applying the template to AWS

<!-- section: 02.cdkd -->

There are two paths for applying a template to AWS.

One is the AWS CDK CLI (`cdk deploy`), which hands the template to CloudFormation. CloudFormation is an AWS service that takes a template, creates the resources, keeps its own record of what it created, and rolls back on failure. This is the standard path.

The other is cdkd. It reads the same template, but it does not go through CloudFormation. It creates the resources by calling each AWS service's API directly, and the Cloud Control API for some. Its record of what it created is called the state, and it is saved as JSON in an S3 bucket in your account.

cdkd is not a faster alias for `cdk deploy`. It is a different tool, with a different creation path and a different place for its record. Keep these three points in mind.

1. cdkd's official documentation describes cdkd as intended for development and testing, and recommends the AWS CDK CLI for production (checked 2026-10-11; the pinned version is 0.296.28). This book uses cdkd for the short cycles of change and check that you go through while learning. The production path is covered in [chapter 20](/en/chapters/20-shipping.md).
2. Do not manage the same resource through both paths in turn. If you update a stack created with cdkd using `cdk deploy`, or the reverse, the two records disagree.
3. If the state is lost, cdkd no longer knows what it created. The state bucket has versioning enabled, and `cdkd import` exists as a means of recovery. This book has not run a recovery to confirm it, though.

As preparation, run bootstrap once for each pair of account and Region.

```bash
vp run infra:bootstrap
```

This task changes AWS. According to the source of the pinned version, it creates these three things.

| What is created | Name | Purpose |
| --- | --- | --- |
| S3 bucket | `cdkd-state-<account ID>` | Stores the state. One per account |
| S3 bucket | `cdkd-assets-<account ID>-<Region>` | Holds files for deployment |
| ECR repository | `cdkd-container-assets-<account ID>-<Region>` | Holds container images |

cdkd's bootstrap has a similar name to `cdk bootstrap`, but it is a different thing. `cdk bootstrap` creates a CloudFormation stack (`CDKToolkit`) that also contains IAM roles for deployment. cdkd's bootstrap creates no IAM role, and cdkd creates resources directly with the permissions of the credentials you signed in with.

The code that calls cdkd is gathered in the following function, which shows which task becomes which arguments.

<<< @/tools/src/infra/cdkd-args.ts{invocation}

cdkd uses `us-east-1` when `AWS_REGION` is not set. So that no resource lands in a Region you did not intend, this book's tasks always start cdkd with `AWS_REGION` set explicitly.
