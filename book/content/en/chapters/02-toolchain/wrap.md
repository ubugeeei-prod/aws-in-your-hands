---
title: "02 Toolchain: Costs, Pitfalls, and Cleanup"
---

# 02 Toolchain: Costs, Pitfalls, and Cleanup

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
- Don't deploy with a person's credentials. Run from CI with short-lived credentials ([Chapter 20](/en/chapters/20-shipping.md))
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
