# AWS in Your Hands

**TypeScript でつくる、身近な AWS / Practical AWS for TypeScript Developers**

TypeScript、HTTP、Git、Web アプリ開発には慣れているが AWS は初めて、という開発者のためのオンラインブックです。本文（日本語・英語）、本のサイトの実装とインフラ、本文が説明するすべてのサンプルが、このリポジトリに入っています。

An online book for developers who know TypeScript, HTTP, Git, and web development but are new to AWS. This repository holds the prose (Japanese and English), the book site and its infrastructure, and every example the prose explains.

## 現在の完成範囲 / Current state

| | 状態 / State |
| --- | --- |
| 00〜24章（全 25 章） / Chapters 00–24 (all 25) | 日英の本文とサンプルあり。手元の検査（`vp run check:all`）は通過。**AWS に対しては、どの章も一度も deploy も実行もしていない** / Prose and examples in both languages. The local checks (`vp run check:all`) pass. **No chapter has ever been deployed to, or run against, AWS** |
| 本のサイト / Book site | ローカルでビルドできる。**未デプロイ、公開 URL なし** / Builds locally. **Not deployed; no public URL** |

「書き上がった」は「動かして確かめた」ではありません。手元で何を確かめたかは章ごとに違い、各章の末尾の「この章の検証メモ」にあります。実行した検証と未解決事項は [`data/validation.json`](data/validation.json)（本の「検証記録」ページの生成元）にあります。

Written does not mean run and checked. What was checked locally differs by chapter and is listed in "Verification notes for this chapter" at the end of each one. What was run, and what is still open, is recorded in [`data/validation.json`](data/validation.json), the source of the book's Validation Record page.

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
| format・lint（CDK のコードには [awscdk-lint](https://awscdk-lint.dev/)、ren-yamanashi さん作） / format, lint (CDK code with [awscdk-lint](https://awscdk-lint.dev/) by ren-yamanashi) | `check` | none |
| 型検査 / type checks | `typecheck`, `typecheck:vue` (Vize) | none |
| Vue の lint / Vue lint | `lint:vue` (Vize) | none |
| テスト / tests | `test:unit` | none |
| 日英・コード参照・source map の整合 / locale, snippet, and source-map consistency | `content:check`, `book:generate:check`, `links:check` | none |
| CDK の synth / synth | `infra:synth`（全部 / all of them）, `<name>:infra:synth` | none |
| synth した Lambda bundle を素の Node で読み込む / load every synthesized Lambda bundle in plain Node | `bundles:check` | none |
| synth した template の IAM policy の lint。既定は 21章の template で、ほかの章の `cdk.out` も渡せる / lint IAM policies in synthesized templates; chapter 21's by default, and it accepts other chapters' `cdk.out` directories | `sec:iam:lint` | none |
| 本 / book | `dev:book`, `build:book`, `preview:book`, `book:generate` | none |
| 手元で動かす / run locally | `dev:*` など（下の表 / see the table below） | none |
| Docker が要るローカルの store / local stores that need Docker | `db:local:*`, `test:local:dynamodb`（05章 / ch. 05）, `kv:local:*`, `kv:test:local`（14章 / ch. 14） | none |
| 配布用 archive / source archive | `sources:pack` | none |
| 認証情報の確認 / identify credentials | `account:whoami` | 読む / reads |
| diff・drift / diff, drift | `<name>:infra:diff`, `<name>:infra:drift` | reads |
| smoke test・ログ / smoke tests, logs | `<name>:smoke`, `<name>:logs` など / and similar | reads（一部は書く。下記 / some write; see below） |
| 料金データの再取得 / refresh prices | `pricing:refresh` | 公開 API を読む / reads a public API |
| bootstrap・deploy・destroy | `infra:bootstrap`, `<name>:infra:deploy`, `<name>:infra:destroy` | **変える / changes** |
| 公開・削除 / publish, unpublish | `<name>:publish`, `<name>:unpublish`, `book:invalidate`, `spa:invalidate` | **changes** |
| drift の解消 / drift remediation | `<name>:infra:drift:revert`, `<name>:infra:drift:accept` | **changes** |

`check:all` は、上から `sec:iam:lint` までの検査と、本と各章の web のビルドをまとめて実行します。`bundles:check` が要るのは、読み込めない bundle がユニットテストを全部通ってしまうからです（テストランナーが自分の `require` を用意するため）。

`check:all` runs the checks from the top of the table down to `sec:iam:lint`, plus the builds of the book and of each chapter's web app. `bundles:check` exists because a bundle that cannot load still passes every unit test: the test runner supplies its own `require`.

`<name>` は章ごとの prefix です。`<name>:infra:*` は cdkd の一式（synth、diff、deploy、destroy、drift）で、20章だけは AWS CDK CLI と CloudFormation を使うので形が違います。

`<name>` is a per-chapter prefix. `<name>:infra:*` is the cdkd lifecycle (synth, diff, deploy, destroy, drift). Chapter 20 alone uses the AWS CDK CLI and CloudFormation, so its tasks are shaped differently.

| 章 / Chapter | `<name>` | 手元で動かす / run locally |
| --- | --- | --- |
| 本のサイト / book site | `book` | `dev:book` |
| 01 | `account:*`（cdkd の stack なし / no cdkd stack） | - |
| 02 | `hello` | - |
| 03 | `spa` | `dev:spa` |
| 04 | `api` | `dev:api`, `dev:api:cdkd` (Docker) |
| 05 | `notes` | `dev:notes` |
| 06 | `app` | `dev:app:api`, `dev:app:web` |
| 07 | `uploads` | `dev:uploads:api`, `dev:uploads:web` |
| 08 | `async` | `dev:async` |
| 09 | `ssr` | `dev:ssr` |
| 10 | `edge`, `edge:body`（Lambda@Edge、us-east-1） | `dev:edge`, `dev:edge:cdkd` |
| 11 | `net` | `net:plan` |
| 12 | `ecs` | `dev:ecs` |
| 13 | `sql` | `dev:sql` |
| 14 | `kv` | `dev:kv` |
| 15 | `mail` | `dev:mail` |
| 16 | `export` | `export:local` |
| 17 | `ai` | `dev:ai` |
| 18 | `stream` | `dev:stream:web` |
| 19 | `obs` | `dev:obs` |
| 20 | `ship:cfn`, `ship:ci`（`ship:cfn:synth`、`ship:cfn:deploy` など。`:infra:` は付かない / no `:infra:` segment） | - |
| 21 | `sec`, `sec:waf`（us-east-1） | `dev:sec` |
| 22 | `recovery` | `recovery:demo` |
| 23 | `ec2` | `dev:ec2` |
| 24 | `celld` | `celld:plan` |

章ごとのタスクは、ここには全部は書いていません（08章の `async:queue`、22章の `recovery:restore:table`、24章の `celld:rollout` など）。名前なしの `vp run` で一覧が出ます。各章の「この章の検証メモ」にも、節ごとのタスクの表があります。

Not every per-chapter task is listed here (`async:queue` in chapter 08, `recovery:restore:table` in chapter 22, `celld:rollout` in chapter 24, and so on). `vp run` with no name lists them all, and each chapter's verification notes have a table of tasks by section.

AWS を読む・変えるタスクはすべて `cache: false` で、実行前に対象のアカウントとリージョンを表示します。AWS を変えるタスクは、`.env` の `AIH_AWS_ACCOUNT_ID` が認証情報のアカウントと一致しない限り実行を拒否します（[`.env.example`](.env.example)）。名前が smoke や seed でも、リソースの中身を書き換えるものがあります（`api:smoke` はノートを作って消します）。課金されるものもあります（17章の `ai:hello` と `ai:test:live` はモデルを呼び、15章の `mail:send` は実際にメールを送ります）。`vite.config.ts` のコメントに、タスクごとの注意が書いてあります。

Every task that reads or changes AWS has `cache: false` and prints the target account and Region first. Tasks that change AWS refuse to run unless `AIH_AWS_ACCOUNT_ID` in `.env` matches the account of the credentials in use ([`.env.example`](.env.example)). Some tasks named smoke or seed do write to the resources (`api:smoke` creates and deletes a note). Some are billed (`ai:hello` and `ai:test:live` in chapter 17 call a model, and `mail:send` in chapter 15 sends a real email). The comments in `vite.config.ts` carry the warnings for each task.

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
- 実環境の検証を進めるための指示 / Prompts for carrying out the cloud validation: [`docs/CONTINUATION.md`](docs/CONTINUATION.md)

## ソースの配布 / Source distribution

`vp run sources:pack` が、commit 済みの tree から `artifacts/aws-in-your-hands-<revision>.tar.gz` と SHA-256 を作ります。このリポジトリの公開 URL と、配布物の公開先は、まだ決まっていません。ライセンスも未定です。

`vp run sources:pack` writes `artifacts/aws-in-your-hands-<revision>.tar.gz` and its SHA-256 from the committed tree. Where this repository and its archives will be published is not decided yet, and neither is the license.
