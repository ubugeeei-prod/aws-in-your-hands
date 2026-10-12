---
title: 02 Toolchain: Nix, vp, CDK, cdkd, and Drift
sourceRevision: 3
---

# 02 Toolchain: Nix, vp, CDK, cdkd, and Drift

Your account is ready. Next come the tools.

In this chapter you'll get every command in this book running with the same tool versions on anyone's machine. Then you'll define one S3 bucket in TypeScript, create it in AWS, change it, and delete it. By the end you'll be able to check "what is about to change" (diff) and "do the record and the real resource still agree" (drift) as two separate things.

This chapter builds on [Chapter 01](/en/chapters/01-account.md). The code is in `examples/02-toolchain/`.

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
