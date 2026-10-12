---
title: "02 Toolchain: Costs, Pitfalls, and Cleanup"
---

# 02 Toolchain: Costs, Pitfalls, and Cleanup

To close the chapter, this page covers what the things you created cost, how to clean them up, and where you might get stuck.

## What it costs

This chapter creates an empty S3 bucket and cdkd's storage.

While idle, the charge is for the amount stored in S3. For an empty bucket that is 0. cdkd's state and templates are small JSON files, though their size has not been measured.

When you operate on them, S3 request charges apply. The number of requests per deploy has not been measured.

After you delete the stack, cdkd's three storage locations remain. The next section explains how to clean them up.

S3 Standard storage in the Tokyo Region costs USD 0.025 per GB per month for the first 50 TB (AWS Price List, checked 2026-10-11). The list of unit prices is in [Pricing Worksheets](/en/reference/pricing.md).

## Cleanup

<!-- section: 02.cleanup -->

```bash
vp run hello:infra:destroy
```

cdkd asks for confirmation when you run it. The practice bucket is empty, so it is deleted as it is.

Deleting the stack leaves the three things bootstrap created. Chapter 03 and later chapters use them, so keep them if you are reading on.

When you have finished the book and want to delete those three as well, work in the console in the following order. There is no task for this procedure. The state bucket holds the records of every stack you created with cdkd, and we do not want it to be something a script deletes mechanically.

1. Delete every stack you created with cdkd, using `vp run hello:infra:destroy` and the like
2. On the S3 pages, empty `cdkd-assets-...` and delete it
3. On the S3 pages, empty `cdkd-state-...` and delete it. Versioning is enabled, so use "Empty" to delete every version
4. On the ECR pages, delete `cdkd-container-assets-...`

If you delete the state bucket while a stack still exists, cdkd can no longer delete that stack.

## Where you might get stuck

| Symptom | What to check |
| --- | --- |
| `nix develop` says it doesn't know flakes | Whether `nix-command` and `flakes` are enabled in your Nix configuration |
| `vp run` says `Task "..." not found` | Whether you are running it at the repository root |
| synth stops on a configuration error | The message names the field, so review the `-c` values |
| A deploy stops and says the state bucket doesn't exist | Whether you have run `vp run infra:bootstrap`, and whether the Region is right |
| A deploy stops with a permissions error | cdkd creates resources directly with your credentials. Whether the identity from chapter 01 has the permissions it needs |
| Resources were created in a different Region | If you run cdkd directly instead of through this book's tasks, it uses `us-east-1` when `AWS_REGION` is missing |

## If you take this to production

- Make the AWS CDK CLI and CloudFormation the deployment path. cdkd itself recommends this. You can use the same CDK code as it is
- Use `RemovalPolicy.RETAIN` for resources that hold data. The sample's `prod` stage is an example
- Don't deploy with a person's credentials. Run from CI with short-lived credentials ([chapter 20](/en/chapters/20-shipping.md))
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
| Construct, stack, app | `examples/02-toolchain/lib/hello-stack.ts`, `examples/02-toolchain/bin/app.ts` | `hello:infra:synth` |
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
