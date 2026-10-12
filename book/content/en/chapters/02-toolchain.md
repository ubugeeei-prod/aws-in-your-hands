---
title: 02 Toolchain: Nix, vp, CDK, cdkd, and Drift
sourceRevision: 3
---

# 02 Toolchain: Nix, vp, CDK, cdkd, and Drift

Your account is ready, so the next step is the tools.

This chapter first makes every command in the book run with the same tool versions on anyone's machine. You then define one S3 bucket in TypeScript, create it in AWS, change it, and delete it. Finally you learn to run two separate checks: diff, which shows what is about to change, and drift, which is a difference between the record and the real resource.

This chapter builds on [chapter 01](/en/chapters/01-account.md). The code is in `examples/02-toolchain/`.

## The big picture

```figure
caption: The CDK app runs on your machine, and cdkd creates the buckets and the stack in the AWS account from the template.
node nix: nix develop | node, pnpm, aws, vp
node task: vp run <task>
node app: CDK app | TypeScript
node out: cdk.out/ | template
node state: cdkd-state-<account> | S3, state.json per stack
node assets: cdkd-assets-<account>-<region>
node stack: AihHello stack | Notes bucket (S3)
edge nix -> task
edge task -> app
edge app -> out: synth
edge out -> state: cdkd: SDK / CC API
edge out -> assets
edge out -> stack
group machine: your machine = nix, task, app, out
group aws: AWS account (ap-northeast-1) = state, assets, stack
```

Code runs only on your machine. All this chapter creates in AWS is one bucket and the storage that cdkd uses.

## Entering the environment

<!-- section: 02.nix -->

This book pins tool versions with Nix, which fetches packages pinned by version and hash. You list the tools you need in `flake.nix`, and `flake.lock` records their exact versions. Because the repository has these two files, you don't have to install Node.js by hand.

Nix itself is yours to install. Use the official installer, then enable two features, `nix-command` and `flakes`. This book was verified with Nix 2.25.3. You need no more knowledge of Nix than this.

Run this command at the repository root.

```bash
nix develop
```

It puts you in a shell that contains the tools at their pinned versions. This shell is called the devShell. The first run downloads the tools, so you wait a little.

<<< @/flake.nix

The devShell provides Node.js 24.21.0, pnpm 10.34.5, AWS CLI 2.35.11, git, and `vp` 1.1.0. The exact list of versions is in [Toolchain](/en/reference/toolchain.md).

`vp` is not in nixpkgs, so this repository carries a Nix expression for it. The expression fetches the per-platform binary that the publisher releases on npm, with the hash pinned.

<<< @/nix/vp.nix

The `shellHook` in `flake.nix` does two things.

It points `vp`'s configuration directory (`VP_HOME`) at `.vp-home/` inside the repository instead of your home directory, so `vp` neither reads nor writes `~/.vite-plus`.

It also sets `VP_SELF_SETUP_NO_MODIFY_PATH`. On its first run with a new `VP_HOME`, `vp` 1.1.0 installs itself there and, unless told otherwise, appends a line to shell configuration files such as `~/.zshrc`. Entering a devShell should not rewrite files in your home directory, so this variable stops the append. This first run uses the network.

The configuration placed in `.vp-home/` is the one file below. It tells `vp` not to download Node.js and pnpm itself, and to use the ones on PATH, which are the ones Nix installed.

<<< @/nix/vp-home.json

You can check that the intended Node.js is in use with this command.

```bash
vp env which node
```

A path that starts with `/nix/store/` means it is the Node.js that Nix installed.

The only combination that has been checked is macOS (Apple silicon, `aarch64-darwin`). `nix/vp.nix` also has definitions for Intel Mac and Linux, but they have not been run and confirmed.

Nix does not provide three things: AWS credentials, the Docker daemon, and the network. Part of chapter 04 uses Docker, and entering the devShell does not start the daemon.

## Installing dependencies

<!-- section: 02.install -->

```bash
vp install --frozen-lockfile
```

`vp install` calls the package manager named in the `packageManager` field of `package.json`, which in this book is pnpm 10.34.5. With `--frozen-lockfile`, it installs only the versions written in `pnpm-lock.yaml` and does not rewrite the lockfile.

You still need a lockfile when you use `vp`. `vp` has no lockfile of its own, and pnpm's `pnpm-lock.yaml` does that job.

The CDK CLI and cdkd are also installed by this `vp install`. So that no tool is managed in two places, Nix installs up to Node.js and pnpm manages the npm packages.
