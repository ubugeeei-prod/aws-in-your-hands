---
title: 02 Reproducible TypeScript Development: Nix, vp, CDK, cdkd, and Drift
sourceRevision: 3
---

# 02 Reproducible TypeScript Development: Nix, vp, CDK, cdkd, and Drift

Your account is ready. Next come the tools.

In this chapter you'll get every command in this book running with the same tool versions on anyone's machine. Then you'll define one S3 bucket in TypeScript, create it in AWS, change it, and delete it. By the end you'll be able to check "what is about to change" (diff) and "do the record and the real resource still agree" (drift) as two separate things.

This chapter builds on [Chapter 01](/en/chapters/01-account.md). The code is in `examples/02-toolchain/`.

## The big picture

```text
your machine                                  AWS account (ap-northeast-1)
+----------------------------------+          +---------------------------------+
| nix develop                      |          | cdkd-state-<account>  (S3)      |
|   node, pnpm, aws, vp            |  cdkd    |   state.json per stack          |
| vp run <task>                    | -------> | cdkd-assets-<account>-<region>  |
|   CDK app (TypeScript) -> synth  |  SDK /   | AihHello stack                  |
|   cdk.out/ (template)            |  CC API  |   Notes bucket (S3)             |
+----------------------------------+          +---------------------------------+
```

Code runs only on your machine. What this chapter creates in AWS is a bucket and the storage that cdkd uses. That's all.

## Entering the environment

<!-- section: 02.nix -->

This book pins tool versions with Nix. Nix fetches packages pinned by version and hash. `flake.nix` says which tools are needed, and `flake.lock` records exactly which versions. With these two files, you don't have to install Node.js by hand.

Nix itself is yours to install. Use the official installer and enable two features, `nix-command` and `flakes`. This book was verified with Nix 2.25.3. That's all the Nix you need to know.

Run this at the repository root.

```bash
nix develop
```

You're now in a shell that contains the tools at their pinned versions. This shell is called the devShell. The first run has downloads to do, so it takes a little while.

<<< @/flake.nix

It provides Node.js 24.21.0, pnpm 10.34.5, AWS CLI 2.35.11, git, and `vp` 1.1.0. The exact list of versions is in [Toolchain](/en/reference/toolchain.md).

`vp` is not in nixpkgs, so this book carries its own Nix expression for it. It fetches the per-platform binary that the publisher releases on npm, with the hash pinned.

<<< @/nix/vp.nix

The `shellHook` does two things.

First, it points `vp`'s configuration directory (`VP_HOME`) at `.vp-home/` inside the repository instead of your home directory. Your `~/.vite-plus` is neither read nor written.

Second, it sets `VP_SELF_SETUP_NO_MODIFY_PATH`. On its first run with a new `VP_HOME`, `vp` 1.1.0 installs itself there and, unless told otherwise, appends a line to shell configuration files such as `~/.zshrc`. This variable stops that. You wouldn't want entering a devShell to rewrite files in your home directory, would you? Note that this first run uses the network.

The configuration placed in `.vp-home/` is the one file below. It tells `vp` not to download Node.js and pnpm itself, and to use the ones on PATH (the ones Nix installed).

<<< @/nix/vp-home.json

Let's check that the intended Node.js is in use.

```bash
vp env which node
```

If it prints a path that starts with `/nix/store/`, it's the Node.js from Nix.

To be honest, the only combination that has been checked is macOS (Apple silicon, `aarch64-darwin`). `nix/vp.nix` also has definitions for Intel Mac and Linux, but they haven't been run and confirmed.

There are also things Nix does not provide: AWS credentials, the Docker daemon, and the network. Part of Chapter 04 uses Docker, but entering the devShell doesn't start the daemon.

## Installing dependencies

<!-- section: 02.install -->

```bash
vp install --frozen-lockfile
```

`vp install` calls the package manager named in the `packageManager` field of `package.json`. In this book that's pnpm 10.34.5. `--frozen-lockfile` means "install only the versions written in `pnpm-lock.yaml`, and don't rewrite the lockfile."

You still need a lockfile when you use `vp`. `vp` has no lockfile of its own. pnpm's `pnpm-lock.yaml` is the lockfile.

Both the CDK CLI and cdkd are installed by this `vp install`. The split is that Nix installs up to Node.js, and pnpm manages the npm packages. That way no tool is managed in two places.

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

1. cdkd's official documentation describes cdkd as intended for development and testing, and recommends the AWS CDK CLI for production (checked 2026-10-11; the pinned version is 0.296.28). This book uses cdkd for short iterations while learning. The production path is planned for Chapter 20.
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

## Deploying

<!-- section: 02.deploy -->

```bash
vp run hello:infra:diff
vp run hello:infra:deploy
```

`diff` shows what is about to be created. On the first run it should list two creations: the bucket and the bucket policy. `deploy` is what creates them. Both print the account and Region before they run, and stop if the account doesn't match `AIH_AWS_ACCOUNT_ID`.

When the deploy finishes, it prints the bucket name. You can also confirm it on the S3 page of the console.

Change a setting and take the diff again, and only the change appears.

```bash
vp run hello:infra:diff -c noncurrentVersionDays=30
```

## diff and drift are different things

<!-- section: 02.diff-drift -->

So far, four things have appeared that each describe "the bucket's configuration."

| | What it is | Where it lives |
| --- | --- | --- |
| Source | The CDK code | The repository |
| template | The output of synth | `cdk.out/` |
| state | What cdkd recorded as "created like this" | The `cdkd-state-...` bucket |
| Actual resource | The configuration in AWS right now | AWS |

diff compares the template with the state. It's a preview: "what will change if I deploy this code?" It doesn't look at the actual resource.

drift compares the state with the actual resource. It's a confirmation: "is the recorded configuration still what is in AWS?" If someone changes a setting in the console, the difference shows up here.

So **an empty diff doesn't mean there is no drift**. If you suspend the bucket's versioning in the console, neither the code nor the state changes, so diff reports no changes.

The CloudFormation path has the same distinction. `cdk diff` compares one template with another, and comparison with the actual resources is a separate feature, CloudFormation drift detection. That is planned for Chapter 20.

## Finding drift

<!-- section: 02.drift-gate -->

```bash
vp run hello:infra:drift
```

This task runs `cdkd drift AihHello --json`, writes the result to `reports/drift/AihHello.json`, and ends with a pass or fail. It reads AWS but doesn't change it.

The pass/fail decision isn't left to cdkd's exit code alone. That's because cdkd, in the pinned version, also returns exit code 0 in these cases.

- A resource is of a type that has no way to be read back, so it was not compared
- A resource was skipped in the comparison

"No difference was found" and "everything was compared and matched" aren't the same, are they? This book's gate passes only when every resource was compared and matched.

<<< @/tools/src/drift/report.ts{gate}

There are seven statuses.

| Status | Meaning | Gate exit code |
| --- | --- | --- |
| `clean` | Everything was compared and matched | 0 |
| `drifted` | Some configuration differs from the record | 10 |
| `deleted` | A recorded resource is not in AWS | 10 |
| `incomplete` | Something could not be compared, for example because a read failed | 11 |
| `unsupported` | A resource is of a type that cannot be read back, and was not compared | 11 |
| `failed` | The detection itself produced no result | 12 |
| `missing-target` | There is no record for the specified stack | 12 |

The exit codes are separate so that CI can tell "there is a difference" from "unknown." The report keeps the time of the run, the account, the Region, and the number of resources compared and not compared.

The report is read only after cdkd's output has been validated against a schema. Seen from this book's code, cdkd's output is also data that comes from outside. The output was empty, it didn't include the specified stack, its contents contradict the exit code: in cases like these the gate doesn't read it charitably and reports `failed` or `missing-target`. These cases are tested against nine inputs in `tools/src/drift/fixtures/`. Note, though, that the fixtures were written by hand from cdkd's type definitions. They are not output captured from real AWS.

### When drift is found

You have three options. A person decides which one to take.

- Return the actual resource to the record. Check the contents with `vp run hello:infra:drift:revert:preview`, then run `vp run hello:infra:drift:revert`. For a change that requires replacement, a resource that holds data may be recreated. Always read the preview
- Accept the actual configuration as correct. Run `vp run hello:infra:drift:accept`. Only the state is rewritten. The CDK code doesn't change, so the next deploy puts it back. Change the code to the same value too
- Fix the code and deploy again. Change the code and run `vp run hello:infra:deploy`. If the change was intended, this is the proper procedure

Whichever you choose, run `vp run hello:infra:drift` once more at the end. A resolving command that succeeded is not proof that the stack matches.

### Try it

With the deployed bucket, you can try the following in order.

1. In the console, change the bucket's "Versioning" to "Suspend"
2. Run `vp run hello:infra:diff`. It should report no changes
3. Run `vp run hello:infra:drift`. It should report `drifted` and exit with code 10
4. Look at what will be reverted with `vp run hello:infra:drift:revert:preview`, then revert with `vp run hello:infra:drift:revert`
5. Run `vp run hello:infra:drift` once more and confirm `clean`

These steps say "should" because they haven't been run against a real AWS account yet.

## What it costs

This chapter creates an empty S3 bucket and the storage for cdkd.

When idle, what you pay for is the amount stored in S3. That's 0 if the bucket is empty. cdkd's state and templates are small JSON files (their size was not measured).

When you run an operation, S3 request charges apply. The number of requests per deploy has not been measured.

After you delete the stack, cdkd's three storage locations remain (the next section cleans them up).

S3 Standard storage in the Tokyo Region costs USD 0.025 per GB per month for the first 50 TB (AWS Price List, checked 2026-10-11). The list of unit prices is in [Pricing Worksheets](/en/reference/pricing.md).

## Cleanup

<!-- section: 02.cleanup -->

```bash
vp run hello:infra:destroy
```

cdkd asks for confirmation. The practice bucket is empty, so it is deleted as is.

Deleting the stack leaves the three things bootstrap created. If you plan to continue with this book, keep them. Chapter 03 onward uses them too.

When you're completely done and want to delete them, do it in the console in the following order. There is no task for this procedure. The state bucket holds the records of every stack you created with cdkd, and that's not something we want deleted mechanically.

1. Delete every stack you created with cdkd, with `vp run hello:infra:destroy` and the like
2. On the S3 page, empty `cdkd-assets-...` and delete it
3. On the S3 page, empty `cdkd-state-...` and delete it. Versioning is enabled, so use "Empty" to delete all versions
4. On the ECR page, delete `cdkd-container-assets-...`

If you delete the state bucket while a stack still exists, cdkd can no longer delete that stack.

## Where you might get stuck

| If this happens | Look here |
| --- | --- |
| `nix develop` says it does not know flakes | Are `nix-command` and `flakes` enabled in your Nix configuration? |
| `vp run` says `Task "..." not found` | Are you running it from the repository root? |
| synth stops on a configuration error | The message names the field. Review the `-c` value |
| Deploy stops and says the state bucket does not exist | Have you run `vp run infra:bootstrap`? Does the Region match? |
| Deploy stops on a permissions error | cdkd creates resources directly with your credentials. Does the identity from Chapter 01 have the permissions it needs? |
| Resources were created in a different Region | Running cdkd directly, not through this book's tasks, uses `us-east-1` when `AWS_REGION` is not set |

## If you take this to production

- Make the AWS CDK CLI and CloudFormation the deployment path. cdkd itself recommends this. The same CDK code works unchanged
- Set `RemovalPolicy.RETAIN` on resources that hold data. The sample's `prod` is an example
- Don't deploy with a person's credentials. Run from CI with short-lived credentials (planned for Chapter 20)
- Run drift detection on a schedule. An example is in `docs/examples/drift-schedule.yml`

::: details Verification notes for this chapter

**Checked locally.** The environment (`nix develop`, `vp install --frozen-lockfile`), synth, the unit tests, and the tests for the drift gate. All on macOS (Apple silicon).

**Not checked yet.** `infra:bootstrap`, `hello:infra:diff`, `hello:infra:deploy`, `hello:infra:drift`, the resolving tasks, and `hello:infra:destroy` have not been run against a real AWS account. Statements about cdkd's behavior are based on the source of the pinned version, its help output, and the official documentation.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Entering the environment | `flake.nix`, `flake.lock`, `nix/vp.nix`, `nix/vp-home.json` | (`nix develop`) |
| Installing dependencies | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | (`vp install`) |
| Every command is `vp run` | `vite.config.ts` | `check:all` |
| What types protect, and what they don't | `examples/02-toolchain/lib/config.ts`, `examples/02-toolchain/test/config.test.ts` | `test:unit` |
| construct, stack, app | `examples/02-toolchain/lib/hello-stack.ts`, `examples/02-toolchain/bin/app.ts` | `hello:infra:synth` |
| synth | `examples/02-toolchain/cdk.json`, `examples/02-toolchain/test/hello-stack.test.ts` | `hello:infra:synth`, `hello:infra:synth:cdk`, `test:unit` |
| cdkd | `tools/src/infra/cdkd-args.ts`, `tools/src/infra/cdkd.ts`, `tools/src/infra/run-cdkd.ts` | `infra:bootstrap` |
| Deploying | Same as above | `hello:infra:diff`, `hello:infra:deploy` |
| Finding drift | `tools/src/drift/schema.ts`, `tools/src/drift/report.ts`, `tools/src/drift/cli.ts`, `tools/src/drift/fixtures/`, `tools/src/drift/report.test.ts` | `hello:infra:drift`, `hello:infra:drift:revert:preview`, `hello:infra:drift:revert`, `hello:infra:drift:accept` |
| Cleanup | Same as above | `hello:infra:destroy` |

**Primary sources**

- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the npm tarball and the source of the same version; checked 2026-10-11)
- [cdkd: Introduction](https://cdkd.dev/introduction/) (checked 2026-10-11)
- [vite-plus 1.1.0](https://www.npmjs.com/package/vite-plus/v/1.1.0) (the bundled documentation and local runs; checked 2026-10-11)
- [nixpkgs (the revision in flake.lock)](https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30) (checked 2026-10-11)
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html), [cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html), [CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html) (not rechecked at the time of writing)

:::
