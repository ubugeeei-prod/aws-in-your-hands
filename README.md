# AWS in Your Hands

**TypeScript でつくる、身近な AWS / Practical AWS for TypeScript Developers**

TypeScript、HTTP、Git、Web アプリ開発には慣れているが AWS は初めて、という開発者のためのオンラインブックです。本文（日本語・英語）、本のサイトの実装とインフラ、本文が説明するすべてのサンプルが、このリポジトリに入っています。

An online book for developers who know TypeScript, HTTP, Git, and web development but are new to AWS. This repository holds the prose (Japanese and English), the book site and its infrastructure, and every example the prose explains.

## 現在の完成範囲 / Current state

| | 状態 / State |
| --- | --- |
| 00〜06章 / Chapters 00–06 | 日英の本文とサンプルあり。ローカル検証済み。**AWS 上では未検証** / Prose and examples in both languages. Verified locally. **Not verified in AWS** |
| 07〜24章 / Chapters 07–24 | planned。`data/chapters.json` のアウトラインのみ / Planned. Outline only |
| 本のサイト / Book site | ローカルでビルドできる。**未デプロイ、公開 URL なし** / Builds locally. **Not deployed; no public URL** |

実行した検証と未解決事項は [`data/validation.json`](data/validation.json)（本の「検証記録」ページの生成元）にあります。
What was run, and what is still open, is recorded in [`data/validation.json`](data/validation.json).

## セットアップ / Setup

必要なのは [Nix](https://nixos.org/)（`nix-command` と `flakes` を有効にしたもの）だけです。Node.js、pnpm、AWS CLI、`vp` は Nix が固定した版で用意します。

You need only [Nix](https://nixos.org/) with `nix-command` and `flakes` enabled. Nix supplies Node.js, pnpm, the AWS CLI, and `vp` at pinned versions.

```bash
nix develop                      # 固定した版のツールが入った shell に入る / enter the pinned shell
vp install --frozen-lockfile     # pnpm-lock.yaml どおりに依存を入れる / install exactly what the lockfile says
vp run check:all                 # 手元だけで完結する全検査 / every check that needs no AWS
vp run dev:book                  # 本を手元で読む / read the book locally
```

検証した組み合わせは macOS（Apple silicon）だけです。Intel Mac と Linux の Nix 式はありますが未検証です。初回の `nix develop` と `vp` の初回起動はネットワークを使います。

Only macOS on Apple silicon has been verified. Nix expressions for Intel Macs and Linux exist but are unverified. The first `nix develop` and the first `vp` run use the network.

## タスク / Tasks

すべて `vp run <task>` で、リポジトリのルートから実行します。定義は [`vite.config.ts`](vite.config.ts) の 1 か所です。名前なしの `vp run` で一覧が出ます。

Everything runs as `vp run <task>` from the repository root. All tasks are defined in one place, [`vite.config.ts`](vite.config.ts). `vp run` with no name lists them.

| 目的 / Purpose | タスク / Task | AWS |
| --- | --- | --- |
| 全ローカル検査 / all local checks | `check:all` | 触らない / none |
| format・lint / format, lint | `check` | none |
| 型検査 / type checks | `typecheck`, `typecheck:vue` (Vize) | none |
| Vue の lint / Vue lint | `lint:vue` (Vize) | none |
| テスト / tests | `test:unit` | none |
| 日英・コード参照・source map の整合 / locale, snippet, and source-map consistency | `content:check`, `book:generate:check`, `links:check` | none |
| 本 / book | `dev:book`, `build:book`, `preview:book`, `book:generate` | none |
| サンプル / examples | `dev:spa`, `build:spa`, `dev:api`, `dev:api:cdkd` (Docker), `dev:notes`, `dev:app:api`, `dev:app:web` | none |
| ローカルの DynamoDB / local DynamoDB (Docker) | `db:local:start`, `db:migrate:local`, `db:seed:local`, `db:reset:local`, `db:local:stop`, `test:local:dynamodb` | none |
| CDK の synth / synth | `infra:synth`, `<name>:infra:synth` | none |
| 配布用 archive / source archive | `sources:pack` | none |
| 認証情報の確認 / identify credentials | `account:whoami` | 読む / reads |
| diff・drift / diff, drift | `<name>:infra:diff`, `<name>:infra:drift` | reads |
| smoke test | `book:smoke`, `spa:smoke`, `api:logs` | reads |
| 料金データの再取得 / refresh prices | `pricing:refresh` | 公開 API を読む / reads a public API |
| bootstrap・deploy・destroy | `infra:bootstrap`, `<name>:infra:deploy`, `<name>:infra:destroy` | **変える / changes** |
| 公開・削除 / publish, unpublish | `<name>:publish`, `<name>:unpublish`, `<name>:invalidate`, `api:smoke` | **changes** |
| drift の解消 / drift remediation | `<name>:infra:drift:revert`, `<name>:infra:drift:accept` | **changes** |

`<name>` は `book`、`hello`（02章）、`spa`（03章）、`api`（04章）、`notes`（05章）、`app`（06章）です。AWS を読む・変えるタスクはすべて `cache: false` で、実行前に対象のアカウントとリージョンを表示します。AWS を変えるタスクは、`.env` の `AIH_AWS_ACCOUNT_ID` が認証情報のアカウントと一致しない限り実行を拒否します（[`.env.example`](.env.example)）。

`<name>` is `book`, `hello` (chapter 02), `spa` (chapter 03), `api` (chapter 04), `notes` (chapter 05), or `app` (chapter 06). Every task that reads or changes AWS has `cache: false` and prints the target account and Region first. Tasks that change AWS refuse to run unless `AIH_AWS_ACCOUNT_ID` in `.env` matches the account of the credentials in use ([`.env.example`](.env.example)).

## 構成 / Layout

```text
flake.nix, flake.lock, nix/     pinned development environment
package.json, pnpm-*.yaml       pinned npm dependencies (pnpm 10 workspace)
vite.config.ts                  every vp task; lint, format, and test settings
book/                           the book: Ox Content config and content/{ja,en}
book/infra/                     the book site's CDK app (S3 + CloudFront), managed with cdkd
examples/NN-name/               one directory per chapter, complete and runnable
tools/                          task implementations: cdkd wrapper, drift gate, publish, smoke, checks, pricing
data/                           chapter manifest, source registry, glossary, prices, section-to-source map, validation record
docs/                           editorial policy, continuation prompts, CI examples
```

## 執筆に参加する / Contributing

- 編集方針 / Editorial policy: [`docs/EDITORIAL.md`](docs/EDITORIAL.md)
- 人と agent 向けの執筆規約 / Rules for contributors and agents: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- agent の入口 / Entry point for coding agents: [`AGENTS.md`](AGENTS.md)。global の gitignore で `AGENTS.md` を除外している環境では `git add -f` が要ります / where a global gitignore excludes `AGENTS.md`, it needs `git add -f`
- 次の章を書くための指示 / Prompts for the next chapter: [`docs/CONTINUATION.md`](docs/CONTINUATION.md)

## ソースの配布 / Source distribution

`vp run sources:pack` が、commit 済みの tree から `artifacts/aws-in-your-hands-<revision>.tar.gz` と SHA-256 を作ります。このリポジトリの公開 URL と、配布物の公開先は、まだ決まっていません。ライセンスも未定です。

`vp run sources:pack` writes `artifacts/aws-in-your-hands-<revision>.tar.gz` and its SHA-256 from the committed tree. Where this repository and its archives will be published is not decided yet, and neither is the license.
