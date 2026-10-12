---
title: "ツールチェイン"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/toolchain.json (tools/src/book/generate.ts) -->

# ツールチェイン

この本のコードを検証した版の組み合わせです（記録日 2026-10-11）。版は下表の「固定している場所」で固定されており、`latest` には依存しません。

| ツール | 版 | 供給元 | 固定している場所 |
| --- | --- | --- | --- |
| Nix | 2.25.3 (host) | host installation, flakes enabled | `not pinned by this repository` |
| nixpkgs | 8edc0c72e3a3 (nixpkgs-unstable, 2026-10-08) | flake input | `flake.lock` |
| Node.js | 24.21.0 | nixpkgs nodejs_24 | `flake.lock` |
| pnpm | 10.34.5 | nixpkgs pnpm_10 | `flake.lock, package.json packageManager` |
| AWS CLI | 2.35.11 | nixpkgs awscli2 | `flake.lock` |
| vp (Vite+ global CLI) | 1.1.0 | nix/vp.nix, fixed-hash npm tarball | `nix/vp.nix` |
| vite-plus (project-local) | 1.1.0 | pnpm | `package.json, pnpm-lock.yaml` |
| Vite / Vitest (bundled by vite-plus) | 8.3.3 / 5.0.3 | vite-plus | `pnpm-workspace.yaml overrides, pnpm-lock.yaml` |
| TypeScript | 7.0.2 | pnpm | `package.json, pnpm-lock.yaml` |
| aws-cdk-lib | 2.273.0 | pnpm | `each CDK app's package.json, pnpm-lock.yaml` |
| constructs | 10.8.1 | pnpm | `each CDK app's package.json, pnpm-lock.yaml` |
| cdkd (@go-to-k/cdkd) | 0.296.28 | pnpm | `each CDK app's package.json, pnpm-lock.yaml` |
| AWS CDK CLI (aws-cdk) | 2.1145.0 | pnpm | `package.json, pnpm-lock.yaml` |
| AWS SDK for JavaScript v3 | 3.1149.0 | pnpm | `tools/package.json, pnpm-lock.yaml` |
| Ox Content (@ox-content/vite-plugin) | 3.2.14 | pnpm | `book/package.json, pnpm-lock.yaml` |
| Vue | 3.5.43 | pnpm | `examples/03-spa/package.json, pnpm-lock.yaml` |
| Valibot | 1.5.0 | pnpm | `package.json files, pnpm-lock.yaml` |
| esbuild | 0.28.2 | pnpm | `package.json, pnpm-lock.yaml` |
| Vize (vize, @vizejs/vite-plugin) | 0.443.0 | pnpm | `examples/03-spa/package.json, pnpm-lock.yaml` |
| DynamoDB Local (container image, not run yet) | amazon/dynamodb-local:3.3.1 | Docker, outside the Nix shell | `examples/05-dynamodb/scripts/local-db.ts` |
| Nuxt (nuxt, @nuxt/nitro-server) | 4.6.1 | pnpm | `examples/09-ssr/package.json, pnpm-lock.yaml` |
| Nitro (nitropack) and h3 | 2.13.4 and 1.15.11 | pnpm | `examples/09-ssr/package.json, pnpm-lock.yaml` |
| Vize Nuxt module (@vizejs/nuxt) | 0.443.0 | pnpm | `examples/09-ssr/package.json, pnpm-lock.yaml` |
| AWS Durable Execution SDK for JavaScript (@aws/durable-execution-sdk-js, -testing) | 2.6.0 and 1.3.0 | pnpm | `examples/16-long-jobs/package.json, pnpm-lock.yaml` |
| awscdk-lint for Oxlint (oxlint-plugin-awscdk), by ren-yamanashi | 1.0.3 | pnpm | `package.json, pnpm-lock.yaml` |

- 検証済みの OS/CPU: aarch64-darwin (macOS 26, Darwin 25.6.0)
- Nix 式はあるが未検証の OS/CPU: x86_64-darwin, aarch64-linux, x86_64-linux
