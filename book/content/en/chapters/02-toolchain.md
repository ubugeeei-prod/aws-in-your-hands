---
title: 02 Reproducible TypeScript Development: Nix, vp, CDK, cdkd, and Drift
sourceRevision: 1
---

# 02 Reproducible TypeScript Development: Nix, vp, CDK, cdkd, and Drift

## What you will have at the end

- Every command in this book runs with the same tool versions on anyone's machine
- You can define one S3 bucket in TypeScript, then create it in AWS, change it, and delete it
- You can check "what is about to change" (diff) and "whether the record and the real resource still agree" (drift) as two separate things

This chapter builds on [Chapter 01](/en/chapters/01-account.md). The sample is in `examples/02-toolchain/`.

## Architecture

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

Code runs only on your machine. What this chapter creates in AWS is a bucket and the storage that cdkd uses.

## Entering the environment

<!-- section: 02.nix -->

This book pins tool versions with Nix. Nix fetches packages pinned by version and hash. `flake.nix` says which tools are needed, and `flake.lock` records exactly which versions. With these two files, you do not need to install Node.js by hand.

You install Nix itself. Use the official installer and enable two features, `nix-command` and `flakes`. This book was verified with Nix 2.25.3. You need no further knowledge of Nix.

Run this at the repository root.

```bash
nix develop
```

This puts you in a shell that contains the tools at their pinned versions. This shell is called the devShell. The first run takes a while because of the downloads.

<<< @/flake.nix

It provides Node.js 24.21.0, pnpm 10.34.5, AWS CLI 2.35.11, git, and `vp` 1.1.0. The exact list of versions is in [Toolchain](/en/reference/toolchain.md).

`vp` is not in nixpkgs, so this book carries its own Nix expression for it. The expression fetches the per-platform binary that the publisher releases on npm, with the hash pinned.

<<< @/nix/vp.nix

The `shellHook` does two things. First, it points `vp`'s configuration directory (`VP_HOME`) at `.vp-home/` inside the repository instead of your home directory. Your `~/.vite-plus` is neither read nor written. Second, it sets `VP_SELF_SETUP_NO_MODIFY_PATH`. On its first run with a new `VP_HOME`, `vp` 1.1.0 installs itself there and, unless told otherwise, appends a line to shell configuration files such as `~/.zshrc`. This variable stops that, because entering a devShell should not rewrite files in your home directory. The first run uses the network. The configuration placed there is the one file below, which tells `vp` not to download Node.js and pnpm itself and to use the ones on PATH (the ones Nix installed).

<<< @/nix/vp-home.json

To check that the intended Node.js is in use, run this.

```bash
vp env which node
```

If it prints a path that starts with `/nix/store/`, it is the Node.js from Nix.

**Verified combination.** Only macOS (Apple silicon, `aarch64-darwin`). `nix/vp.nix` also has definitions for Intel Mac and Linux, but they have not been run and confirmed.

**What Nix does not provide.** AWS credentials, the Docker daemon, and the network. Part of Chapter 04 uses Docker, but entering the devShell does not start the daemon.

## Installing dependencies

<!-- section: 02.install -->

```bash
vp install --frozen-lockfile
```

`vp install` calls the package manager named in the `packageManager` field of `package.json`. In this book that is pnpm 10.34.5. `--frozen-lockfile` means "install only the versions written in `pnpm-lock.yaml`, and do not rewrite the lockfile."

You still need a lockfile when you use `vp`. `vp` has no lockfile of its own; pnpm's `pnpm-lock.yaml` is the lockfile.

Both the CDK CLI and cdkd are installed by this `vp install`. Nix installs up to Node.js, and pnpm manages the npm packages. This keeps any one tool from being managed in two places.

## Running tasks

<!-- section: 02.vp -->

Every command in this book is `vp run <task name>`. The book does not use Make or any other task runner. Tasks are defined in `vite.config.ts` at the root, and you run them from the root. Typing `vp run` with no name prints the list.

`vp` also has built-in commands: `vp dev`, `vp build`, `vp test`, and `vp check`. Those are Vite+ features. Anything with `run` in it, such as `vp run build:book`, is a task this book defines. Do not confuse the two.

Tasks are divided into two kinds.

<<< @/vite.config.ts{kinds}

A `live` task reads or changes something outside your machine, such as AWS. It always has `cache: false`.

Why is caching a problem? `vp run` may skip a task whose input files have not changed and replay its previous output. For a build, that saves time. For a deploy or drift detection, it means the "succeeded" you see is from the previous run and says nothing about the account as it is now. So caching is disabled for tasks that read or change anything external. When the cache is used, `vp run` prints `cache hit, replaying`, so you can tell a replay from a fresh run.

One more point: a task with `cache: false` receives the caller's environment variables as they are. This is why `AWS_PROFILE` reaches the task.

The operations on one CDK app are defined together by the following function.

<<< @/vite.config.ts{infra}

This chapter's sample is named `hello`, which gives you `hello:infra:synth`, `hello:infra:deploy`, and so on. Chapter 03 uses `spa`, Chapter 04 uses `api`, and the book site uses `book`.

The checks that complete entirely on your machine are gathered into one task.

```bash
vp run check:all
```

It runs format, lint, type checking, tests, synth for every CDK app, and the book build and link check. It does not touch AWS. It does not include drift detection either.

Type checking is done by `vp run typecheck`, not by `vp check`. `vp check` can type-check too, but with the versions this book pins (TypeScript 7.0.2) it intermittently reported errors on unchanged sources, in which an `aws-cdk-lib` import was mistaken for a different module. That happened in 2 of 5 runs on identical input. It stopped reproducing once `tsc` was told to run single-threaded, so that is what `typecheck` does. A check that sometimes fails on correct code builds the habit of rerunning until it passes, and that habit hides real failures too.

## Types, and what types do not protect

<!-- section: 02.types -->

The sample only creates one bucket, but it takes two settings: the name of the environment (`stage`) and how many days to keep old versions of an object (`noncurrentVersionDays`).

In CDK you can pass settings like these as context. You write them in `cdk.json` or give them on the command line as `-c stage=prod`. The problem is that context arrives as an **untyped value**. If you write `-c noncurrentVersionDays=30`, what arrives is the string `"30"`, not the number `30`.

A TypeScript type annotation does not check this value. Writing `as HelloConfig` only silences the compiler; the value at run time does not change. Values that come from outside are checked against a schema at run time. This is called runtime validation.

<<< @/examples/02-toolchain/lib/config.ts{schema}

The type (`HelloConfig`) is derived from the schema. Because the type and the check are not written separately, you cannot update one and forget the other.

<<< @/examples/02-toolchain/lib/config.ts{parse}

An invalid value fails at synth, with a message that says which field is wrong. That is before anything reaches AWS.

Later chapters follow the same policy. Environment variables, HTTP requests and responses, browser storage, and queue messages all come from outside the type system. Validate once at the entry point, and trust the types inside.

It is also worth being clear about what types do not protect. Code that type-checks may still lack the IAM permissions it needs. It may not fit within service limits, and it may not be correct when several operations run at the same time. Those are checked with tests and by confirming in a real environment.

## construct, stack, app

<!-- section: 02.cdk -->

AWS CDK lets you write AWS resources as TypeScript classes. It has three units.

- **construct**: a class that represents one or more resources. `s3.Bucket` is one
- **stack**: a unit of resources that are created together and deleted together
- **app**: the whole program, a collection of stacks

<<< @/examples/02-toolchain/lib/hello-stack.ts{stack}

The single `s3.Bucket` line in fact creates, in addition to the bucket, a bucket policy that denies connections that are not HTTPS. A construct bundles defaults like this.

`removalPolicy` decides what happens to the bucket when the stack is deleted. The practice stage deletes the bucket with the stack, and `prod` keeps it. For a resource that holds data, you have to decide resource by resource which is worse: forgetting to delete it and paying for it, or deleting something that must not be deleted. A test pins this decision.

<<< @/examples/02-toolchain/bin/app.ts{app}

Note that `env` sets only the Region and not the account. Written this way, synth runs without credentials and asks AWS nothing. Which account the resources go to is decided by the credentials used at deploy time. Printing that account and comparing it every time is the job of `AIH_AWS_ACCOUNT_ID` from Chapter 01.

## synth: turning code into a template

<!-- section: 02.synth -->

synth (synthesis) runs the CDK code and outputs JSON called a CloudFormation template. The output goes to `cdk.out/`. Nothing in AWS changes.

```bash
vp run hello:infra:synth
```

Open `examples/02-toolchain/cdk.out/AihHello.template.json` and you will find two resources, `AWS::S3::Bucket` and `AWS::S3::BucketPolicy`. CDK code ends up as this declarative document.

Tests are written against this template.

```bash
vp run test:unit
```

`examples/02-toolchain/test/hello-stack.test.ts` checks that the bucket is private, that in `prod` it is retained on both deletion and replacement, and that the configured number of days appears in the lifecycle rule. This checks that the intended template is produced. Whether AWS accepts that template, and whether the bucket it creates behaves as expected, are outside this check.

You can also change a setting and synth again. `vp run` passes the arguments after the task name through to the command unchanged.

```bash
vp run hello:infra:synth -c stage=prod
```

## cdkd: applying the template to AWS

<!-- section: 02.cdkd -->

There are two paths for applying a template to AWS.

**AWS CDK CLI (`cdk deploy`).** It hands the template to CloudFormation. CloudFormation is an AWS service that takes a template, creates the resources, keeps its own record of what it created, and rolls back on failure. This is the standard path.

**cdkd.** It reads the same template and, without going through CloudFormation, creates the resources by calling each AWS service's API directly (and the Cloud Control API for some). Its record of what it created (the state) is saved as JSON in an S3 bucket in your account.

cdkd is not a faster alias for `cdk deploy`. The creation path is different, and so is the place the record is kept. Three things follow from this.

1. **cdkd's official documentation describes cdkd as intended for development and testing, and recommends the AWS CDK CLI for production** (checked 2026-10-11; the pinned version is 0.296.28). This book uses cdkd for short iterations while learning. The production path is planned for Chapter 20.
2. **Do not manage the same resource through both paths in turn.** If you update a stack created with cdkd using `cdk deploy`, or the reverse, the two records disagree.
3. **If the state is lost, cdkd no longer knows what it created.** The state bucket has versioning enabled, and `cdkd import` exists as a means of recovery. This book has not run a recovery to confirm it.

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

This is not the same thing as `cdk bootstrap`. `cdk bootstrap` creates a CloudFormation stack (`CDKToolkit`) that also contains IAM roles for deployment. cdkd's bootstrap creates no IAM role. cdkd creates resources directly with the permissions of the credentials you signed in with.

The code that calls cdkd is gathered in the following function. Look here to see which task becomes which arguments.

<<< @/tools/src/infra/cdkd-args.ts{invocation}

cdkd uses `us-east-1` when `AWS_REGION` is not set. To avoid creating resources in an unintended Region, this book's tasks always start cdkd with `AWS_REGION` set explicitly.

## Deploying

<!-- section: 02.deploy -->

```bash
vp run hello:infra:diff
vp run hello:infra:deploy
```

`diff` shows what is about to be created. On the first run it should list two creations: the bucket and the bucket policy. `deploy` creates them. Both print the account and Region before they run, and stop if the account does not match `AIH_AWS_ACCOUNT_ID`.

When the deploy finishes, it prints the bucket name. You can also confirm it on the S3 page of the console.

Change a setting and take the diff again, and only the change appears.

```bash
vp run hello:infra:diff -c noncurrentVersionDays=30
```

## diff and drift are different checks

<!-- section: 02.diff-drift -->

So far, four things have appeared that each describe "the bucket's configuration."

| | What it is | Where it lives |
| --- | --- | --- |
| Source | The CDK code | The repository |
| template | The output of synth | `cdk.out/` |
| state | What cdkd recorded as "created like this" | The `cdkd-state-...` bucket |
| Actual resource | The configuration in AWS right now | AWS |

**diff** compares the template with the state. It is a preview: "what will change if I deploy this code?" It does not look at the actual resource.

**drift** compares the state with the actual resource. It is a confirmation: "is the recorded configuration still what is in AWS?" If someone changes a setting in the console, the difference shows up here.

An empty diff does not mean there is no drift. If you suspend the bucket's versioning in the console, neither the code nor the state changes, so diff reports no changes.

The CloudFormation path has the same distinction. `cdk diff` compares one template with another, and comparison with the actual resources is a separate feature, CloudFormation drift detection. That is planned for Chapter 20.

## Detecting drift

<!-- section: 02.drift-gate -->

```bash
vp run hello:infra:drift
```

This task runs `cdkd drift AihHello --json`, writes the result to `reports/drift/AihHello.json`, and ends with a pass or fail. It reads AWS but does not change it.

The pass/fail decision is not left to cdkd's exit code alone. In the pinned version, cdkd also returns exit code 0 in these cases.

- A resource is of a type that has no way to be read back, so it was not compared
- A resource was skipped in the comparison

"No difference was found" and "everything was compared and matched" are not the same. This book's gate passes only when every resource was compared and matched.

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

The report is read only after cdkd's output has been validated against a schema. To this book's code, cdkd's output is also data that comes from outside. If the output was empty, did not include the specified stack, or had contents that contradict the exit code, the gate does not read it charitably and reports `failed` or `missing-target`. These cases are tested against nine inputs in `tools/src/drift/fixtures/`. The fixtures were written by hand from cdkd's type definitions; they are not output captured from real AWS.

### Resolving drift

When drift is found, there are three options. A person decides which one to take.

| Option | What to do | Caution |
| --- | --- | --- |
| Return the actual resource to the record | Check the contents with `vp run hello:infra:drift:revert:preview`, then run `vp run hello:infra:drift:revert` | For a change that requires replacement, a resource that holds data may be recreated. Always read the preview |
| Accept the actual configuration as correct | `vp run hello:infra:drift:accept` | Only the state is rewritten. The CDK code does not change, so the next deploy puts it back. **Change the code to the same value too** |
| Fix the code and deploy again | Change the code and run `vp run hello:infra:deploy` | If the change was intended, this is the proper procedure |

Whichever you choose, run `vp run hello:infra:drift` once more at the end. A resolving command that succeeded is not proof that the stack matches.

### Try it

With the deployed bucket, you can try the following in order.

1. In the console, change the bucket's "Versioning" to "Suspend"
2. Run `vp run hello:infra:diff`. It should report no changes
3. Run `vp run hello:infra:drift`. It should report `drifted` and exit with code 10
4. Look at what will be reverted with `vp run hello:infra:drift:revert:preview`, then revert with `vp run hello:infra:drift:revert`
5. Run `vp run hello:infra:drift` once more and confirm `clean`

These steps say "should" because they have not been run against a real AWS account.

## Cost

This chapter creates an empty S3 bucket and the storage for cdkd.

| State | What is charged |
| --- | --- |
| When idle | S3 charges for the amount stored. 0 if the bucket is empty. cdkd's state and templates are small JSON files (their size was not measured) |
| When you run an operation | S3 request charges. The number of requests per deploy has not been measured |
| After deleting the stack | cdkd's three storage locations remain (next section) |

S3 Standard storage in the Tokyo Region costs USD 0.025 per GB per month for the first 50 TB (AWS Price List, checked 2026-10-11). The list of unit prices is in [Pricing Worksheets](/en/reference/pricing.md).

## Cleanup

<!-- section: 02.cleanup -->

```bash
vp run hello:infra:destroy
```

cdkd asks for confirmation. The practice bucket is empty, so it is deleted as is.

Deleting the stack leaves the three things bootstrap created. If you plan to continue with this book, keep them. Chapter 03 onward uses them too.

When you are completely done and want to delete them, do it in the console in the following order. There is no task for this procedure. The state bucket holds the records of **every stack** you created with cdkd, so it should not be something that gets deleted mechanically.

1. Delete every stack you created with cdkd, with `vp run hello:infra:destroy` and the like
2. On the S3 page, empty `cdkd-assets-...` and delete it
3. On the S3 page, empty `cdkd-state-...` and delete it. Versioning is enabled, so use "Empty" to delete all versions
4. On the ECR page, delete `cdkd-container-assets-...`

If you delete the state bucket while a stack still exists, cdkd can no longer delete that stack.

## When something goes wrong

| Symptom | What to check |
| --- | --- |
| `nix develop` says it does not know flakes | Whether `nix-command` and `flakes` are enabled in your Nix configuration |
| `vp run` says `Task "..." not found` | Whether you are running it from the repository root |
| synth stops on a configuration error | The message names the field. Review the `-c` value |
| Deploy stops and says the state bucket does not exist | Whether you have run `vp run infra:bootstrap`. Whether the Region matches |
| Deploy stops on a permissions error | cdkd creates resources directly with your credentials. Whether the identity from Chapter 01 has the permissions it needs |
| Resources were created in a different Region | Running cdkd directly, not through this book's tasks, uses `us-east-1` when `AWS_REGION` is not set |

## If you take this to production

- **Make the AWS CDK CLI and CloudFormation the deployment path.** cdkd itself recommends this. The same CDK code works unchanged.
- **Set `RemovalPolicy.RETAIN` on resources that hold data.** The sample's `prod` is an example.
- **Do not deploy with a person's credentials.** Run from CI with short-lived credentials (planned for Chapter 20).
- **Run drift detection on a schedule.** An example is in `docs/examples/drift-schedule.yml`.

## Verification status of this chapter

- The environment (`nix develop`, `vp install --frozen-lockfile`), synth, the unit tests, and the tests for the drift gate are **verified locally** on macOS (Apple silicon).
- `infra:bootstrap`, `hello:infra:diff`, `hello:infra:deploy`, `hello:infra:drift`, the resolving tasks, and `hello:infra:destroy` have not been run against a real AWS account. They are **unverified**. Statements about cdkd's behavior are based on the source of the pinned version, its help output, and the official documentation.

## Source map for this chapter

| Section | Files | Tasks |
| --- | --- | --- |
| Entering the environment | `flake.nix`, `flake.lock`, `nix/vp.nix`, `nix/vp-home.json` | (`nix develop`) |
| Installing dependencies | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | (`vp install`) |
| Running tasks | `vite.config.ts` | `check:all` |
| Types, and what types do not protect | `examples/02-toolchain/lib/config.ts`, `examples/02-toolchain/test/config.test.ts` | `test:unit` |
| construct, stack, app | `examples/02-toolchain/lib/hello-stack.ts`, `examples/02-toolchain/bin/app.ts` | `hello:infra:synth` |
| synth | `examples/02-toolchain/cdk.json`, `examples/02-toolchain/test/hello-stack.test.ts` | `hello:infra:synth`, `hello:infra:synth:cdk`, `test:unit` |
| cdkd | `tools/src/infra/cdkd-args.ts`, `tools/src/infra/cdkd.ts`, `tools/src/infra/run-cdkd.ts` | `infra:bootstrap` |
| Deploying | Same as above | `hello:infra:diff`, `hello:infra:deploy` |
| Detecting drift | `tools/src/drift/schema.ts`, `tools/src/drift/report.ts`, `tools/src/drift/cli.ts`, `tools/src/drift/fixtures/`, `tools/src/drift/report.test.ts` | `hello:infra:drift`, `hello:infra:drift:revert:preview`, `hello:infra:drift:revert`, `hello:infra:drift:accept` |
| Cleanup | Same as above | `hello:infra:destroy` |

## Primary sources

- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the npm tarball and the source of the same version; checked 2026-10-11)
- [cdkd: Introduction](https://cdkd.dev/introduction/) (checked 2026-10-11)
- [vite-plus 1.1.0](https://www.npmjs.com/package/vite-plus/v/1.1.0) (the bundled documentation and local runs; checked 2026-10-11)
- [nixpkgs (the revision in flake.lock)](https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30) (checked 2026-10-11)
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html), [cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html), [CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html) (not rechecked at the time of writing)
