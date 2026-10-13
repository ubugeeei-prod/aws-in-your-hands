# AWS in Your Hands

**Practical AWS for TypeScript Developers**

> [!IMPORTANT]
> **Status: under review (査読中).** The text and the examples are being reviewed and may change. Nothing here has been deployed to or run against AWS yet, so treat it as a draft, not as a finished reference.

An online book for developers who know TypeScript, HTTP, Git, and web development but are new to AWS. This repository holds the prose (Japanese and English), the book site and its infrastructure, and every example the prose explains.

## Current state

| | State |
| --- | --- |
| The book as a whole | **Under review.** Subject to change until the review is finished |
| Chapters 00–68 (68 in all; there is no 65) | Prose and examples in both languages. **No chapter has ever been deployed to, or run against, AWS** |
| Chapters 00–24 | Meant to be read in order. The local checks (`vp run check:all`) pass |
| Chapters 25–68 | Standalone chapters grouped by subject. Tests and other checks were run locally chapter by chapter. `check:all` also passes with all 68 chapters in place (2026-10-13, [`data/validation.json`](data/validation.json)) |
| Book site | Builds locally. **Not deployed; no public URL** |

Written does not mean run and checked. What was checked locally differs by chapter and is listed in "Verification notes for this chapter" at the end of each one. What was run, and what is still open, is recorded in [`data/validation.json`](data/validation.json), the source of the book's Validation Record page.

## Setup

You need only [Nix](https://nixos.org/) with `nix-command` and `flakes` enabled. Nix supplies Node.js, pnpm, the AWS CLI, kubectl, OpenSSL, and `vp` at pinned versions.

```bash
nix develop                      # enter the pinned shell
vp install --frozen-lockfile     # install exactly what the lockfile says
vp run check:all                 # every check that needs no AWS
vp run dev:book                  # read the book locally
```

Only macOS on Apple silicon has been verified. Nix expressions for Intel Macs and Linux exist but are unverified. The first `nix develop` and the first `vp` run use the network.

## Tasks

Everything runs as `vp run <task>` from the repository root. All tasks are defined in one place, [`vite.config.ts`](vite.config.ts). `vp run` with no name lists them.

| Purpose | Task | AWS |
| --- | --- | --- |
| All local checks | `check:all` | none |
| Format, lint (CDK code with [awscdk-lint](https://awscdk-lint.dev/) by ren-yamanashi) | `check` | none |
| Type checks | `typecheck`, `typecheck:vue` (Vize) | none |
| Vue lint | `lint:vue` (Vize) | none |
| Tests | `test:unit` | none |
| Locale, snippet, and source-map consistency | `content:check`, `book:generate:check`, `links:check` | none |
| CDK synth | `infra:synth` (all of them), `<name>:infra:synth` | none |
| Load every synthesized Lambda bundle in plain Node | `bundles:check` | none |
| Lint IAM policies in synthesized templates; chapter 21's by default, and it accepts other chapters' `cdk.out` directories | `sec:iam:lint` | none |
| Book | `dev:book`, `build:book`, `preview:book`, `book:generate` | none |
| Run locally | `dev:*` and others (see the table below) | none |
| Local stores that need Docker | `db:local:*`, `test:local:dynamodb` (ch. 05), `kv:local:*`, `kv:test:local` (ch. 14) | none |
| Source archive | `sources:pack` | none |
| Identify credentials | `account:whoami` | reads |
| Diff, drift | `<name>:infra:diff`, `<name>:infra:drift` | reads |
| Smoke tests, logs | `<name>:smoke`, `<name>:logs`, and similar | reads (some write; see below) |
| Refresh prices | `pricing:refresh` | reads a public API |
| Bootstrap, deploy, destroy | `infra:bootstrap`, `<name>:infra:deploy`, `<name>:infra:destroy` | **changes** |
| Publish, unpublish | `<name>:publish`, `<name>:unpublish`, `book:invalidate`, `spa:invalidate` | **changes** |
| Drift remediation | `<name>:infra:drift:revert`, `<name>:infra:drift:accept` | **changes** |

`check:all` runs the checks from the top of the table down to `sec:iam:lint`, plus the builds of the book and of each chapter's web app. `bundles:check` exists because a bundle that cannot load still passes every unit test: the test runner supplies its own `require`.

`<name>` is a per-chapter prefix. `<name>:infra:*` is the cdkd lifecycle (synth, diff, deploy, destroy, drift). Chapter 20 alone uses the AWS CDK CLI and CloudFormation, so its tasks are shaped differently.

| Chapter | `<name>` | Run locally |
| --- | --- | --- |
| Book site | `book` | `dev:book` |
| 01 | `account:*` (no cdkd stack) | - |
| 02 | `hello` | - |
| 03 | `spa` | `dev:spa` |
| 04 | `api` | `dev:api`, `dev:api:cdkd` (Docker) |
| 05 | `notes` | `dev:notes` |
| 06 | `app` | `dev:app:api`, `dev:app:web` |
| 07 | `uploads` | `dev:uploads:api`, `dev:uploads:web` |
| 08 | `async` | `dev:async` |
| 09 | `ssr` | `dev:ssr` |
| 10 | `edge`, `edge:body` (Lambda@Edge, us-east-1) | `dev:edge`, `dev:edge:cdkd` |
| 11 | `net` | `net:plan` |
| 12 | `ecs` | `dev:ecs` |
| 13 | `sql` | `dev:sql` |
| 14 | `kv` | `dev:kv` |
| 15 | `mail` | `dev:mail` |
| 16 | `export` | `export:local` |
| 17 | `ai` | `dev:ai` |
| 18 | `stream` | `dev:stream:web` |
| 19 | `obs` | `dev:obs` |
| 20 | `ship:cfn`, `ship:ci` (`ship:cfn:synth`, `ship:cfn:deploy`, and so on; no `:infra:` segment) | - |
| 21 | `sec`, `sec:waf` (us-east-1) | `dev:sec` |
| 22 | `recovery` | `recovery:demo` |
| 23 | `ec2` | `dev:ec2` |
| 24 | `celld` | `celld:plan` |

The table stops at chapter 24. For the chapters from 25 on, see the list that `vp run` prints with no name, and each chapter's verification notes. Not every task of the earlier chapters is listed here either (`async:queue` in chapter 08, `recovery:restore:table` in chapter 22, `celld:rollout` in chapter 24, and so on). `vp run` with no name lists them all, and each chapter's verification notes have a table of tasks by section.

Every task that reads or changes AWS has `cache: false` and prints the target account and Region first. Tasks that change AWS refuse to run unless `AIH_AWS_ACCOUNT_ID` in `.env` matches the account of the credentials in use ([`.env.example`](.env.example)). Some tasks named smoke or seed do write to the resources (`api:smoke` creates and deletes a note). Some are billed (`ai:hello` and `ai:test:live` in chapter 17 call a model, and `mail:send` in chapter 15 sends a real email). The comments in `vite.config.ts` carry the warnings for each task.

## Layout

```text
flake.nix, flake.lock, nix/     pinned development environment
package.json, pnpm-*.yaml       pinned npm dependencies (pnpm 10 workspace)
vite.config.ts                  every vp task; lint, format, and test settings
book/                           the book: Ox Content config and content/{ja,en}
book/infra/                     the book site's CDK app (S3 + CloudFront), managed with cdkd
examples/NN-name/               one directory per chapter, complete and runnable
tools/                          task implementations: cdkd wrapper, drift gate, publish, smoke, checks, pricing
data/                           chapter manifest, source registry, glossary, prices, section-to-source map, validation record
data/fragments/NN.json          one chapter's additions to the shared files, applied with tools/src/fragments/apply.ts
docs/                           editorial policy, chapter and prose briefs, continuation prompts, CI examples
```

## Contributing

- Editorial policy: [`docs/EDITORIAL.md`](docs/EDITORIAL.md)
- Rules for contributors and agents: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Entry point for coding agents: [`AGENTS.md`](AGENTS.md). Where a global gitignore excludes `AGENTS.md`, it needs `git add -f`
- Prompts for carrying out the cloud validation: [`docs/CONTINUATION.md`](docs/CONTINUATION.md)

## Source distribution

`vp run sources:pack` writes `artifacts/aws-in-your-hands-<revision>.tar.gz` and its SHA-256 from the committed tree. Where this repository and its archives will be published is not decided yet, and neither is the license.
