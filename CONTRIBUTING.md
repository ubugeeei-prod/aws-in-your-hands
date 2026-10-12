# 執筆規約（人と agent 共通） / Rules for contributors and agents

編集方針は [`docs/EDITORIAL.md`](docs/EDITORIAL.md) にあります。ここは、作業するときに守る手順です。

## 始める前に

1. `nix develop` の中で作業する。Node.js、pnpm、`vp`、AWS CLI を別の経路で入れない
2. `vp install --frozen-lockfile` を実行する
3. `vp run check:all` が通ることを確かめてから変更を始める

## やってはいけないこと

- **依頼なしに AWS を変更しない。** `infra:bootstrap`、`*:infra:deploy`、`*:infra:destroy`、`*:publish`、`*:unpublish`、`*:invalidate`、`*:infra:drift:revert`、`*:infra:drift:accept`、`account:budget:*`、`api:smoke` は、明示的に依頼されたときだけ実行する
- **実行していない結果を書かない。** 架空の実行結果、料金、URL、仕様で空白を埋めない。確かめられなければ「未確認」と書き、`data/validation.json` の `open` に再開手順を残す
- **API、flag、設定キーを想像しない。** 固定した版の型定義、ヘルプ出力、ソースで確かめる。ドキュメントとソースが食い違ったら固定した版のソースを優先し、差を `data/sources.json` の `note` に書く
- **Ox Content、cdkd、Nix、`vp` を別のツールに置き換えない。** 必要な機能を確認できないときは、止めて記録する
- **タスクの入口を増やさない。** Makefile、justfile、`package.json` の `scripts` を足さない。タスクは `vite.config.ts` の `run.tasks` にだけ定義する
- **AWS を読む・変えるタスクをキャッシュさせない。** `live(...)` で定義する（`cache: false` になる）
- **`vp run check:all` から AWS に触れさせない。**
- **秘密、認証情報、実在の個人のデータをコミットしない。** 例は `.env.example` と安全な fixture にする

## 章を書く順序

1. `data/chapters.json` のアウトラインと前提を読む
2. 一次情報を読み直し、`data/sources.json` に、確認日と支える主張を記録する
3. `examples/NN-name/` にサンプルとテストを書く。CDK の stack には「使うリソースの種類が、固定した版の cdkd で確認済みのものだけ」であることを確かめるテストを入れる
4. `vite.config.ts` にタスクを足す
5. 日本語の本文を書く。コードは `<<< @/path{region}` で取り込む。各節に `<!-- section: NN.name -->` を置く
6. `data/section-map.json` に節を足す
7. 料金があれば `data/pricing/` に単価とシナリオを足し、`vp run book:generate` を実行する
8. 英語にする。frontmatter は `sourceRevision`。節の目印、`<<<` の行、```text の図、見出しとコードブロックの数を日本語版と一致させる
9. `data/chapters.json` の `writing`、`sourceRevision`、`translatedRevision`、`checkedAt` を更新する
10. `vp run check:all` を通す
11. 実行した検証と、していない検証を `data/validation.json` に記録し、`vp run book:generate` を実行する

## 既存の章を直すとき

- 日本語の意味を変えたら、frontmatter の `revision` と `data/chapters.json` の `sourceRevision` を 1 上げる。英語を直したら、英語側の `sourceRevision` と `translatedRevision.en` を同じ値にする。ずれていると `content:check` が落ちる
- 英語側だけで技術的な誤りを直さない。日本語を先に直す
- 章 ID、サンプルのパス、`#region` の名前を変えるときは、参照している本文と `data/section-map.json` を同時に直す

## コードの書き方

- TypeScript は Node.js が型を取り除くだけで実行できる構文に限る（`enum`、parameter property、`namespace` を使わない）。import には `.ts` の拡張子を書く
- 外から来る値は Valibot で検証する（`import * as v from "valibot"`）。型はスキーマから `v.InferOutput` で導く
- HTTP のアプリにフレームワークを使わない。アプリは `Request` を受けて `Response` を返す関数で、ルーティング、Lambda のイベントとの変換、Node.js のサーバーは `examples/04-http-api/src/http/` の部品を使う。部品に足りないものは、その章の `src/` に小さく書く
- 純粋な判断（計画、判定、引数の組み立て）と、AWS を呼ぶ処理を別のファイルに分ける。前者にテストを書く
- CDK の service は namespace で import する（`import * as s3 from "aws-cdk-lib/aws-s3"` と書いて `s3.Bucket`）。別名は module 名から `aws-` を取ったもの。例外は `apigwv2`、`integrations`、`authorizers`、`origins`、`nodejs`、`targets`、`subscriptions`、`sfn`、`elbv2`、`cwActions`。`aws-cdk-lib` 本体（`Stack`、`Duration` など）と `aws-cdk-lib/assertions` は名前で import する
- import の並びと行幅（100 桁）は `vp fmt` が決める。手で並べない。ファイル先頭のコメントと最初の import のあいだは 1 行空ける
- テストは `vite-plus/test` から import する。テスト名は「何を守っているか」を書く
- CloudFront Functions の `.js` は、デプロイするファイルそのものをテストで読み込む
- コメントは「なぜ」だけを 1〜2 行で。背景の説明は本文に書く。文体の基準は `docs/EDITORIAL.md` の「文体: やわらかく、シュッと」

## 生成されるファイル

次は `vp run book:generate` が `data/` から生成します。手で編集しません。

- `book/content/{ja,en}/chapters/NN-*.md` のうち、`planned` の章
- `book/content/{ja,en}/reference/{sources,glossary,pricing,validation,toolchain}.md`
