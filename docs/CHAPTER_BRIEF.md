# 1 章を書き切るための手順 / How to write one chapter to completion

章を書く、または書き直す担当者（人でも agent でも）のための、作業の決まりです。編集方針は [`EDITORIAL.md`](EDITORIAL.md)、共通の規約は [`../CONTRIBUTING.md`](../CONTRIBUTING.md) にあります。先にその 2 つと、基準の章 `book/content/ja/chapters/04-http-api.md`、基準のコード `examples/04-http-api/` を読んでください。

## 絶対に守ること

- **AWS を変更しない。** deploy、destroy、bootstrap、publish、その他リソースを作る・変える・消す操作は実行しない。手順とタスクを用意するだけ。読み取りも、認証情報が要るものは実行しない
- **実行していないことを、実行したように書かない。** 架空の実行結果、料金、URL、仕様で埋めない。確かめられなければ「確認していません」と書き、検証メモと断片の `validation.open` に再開手順を残す
- **API、flag、設定キー、リソースの property を想像しない。** 一次情報（公式ドキュメント、API リファレンス、公式の料金ページ、AWS Price List、固定した版の型定義・ソース）で確かめる。確かめた URL と、それが支える主張を断片の `sources` に書く
- **固定している道具を替えない。** Nix、`vp`、pnpm、TypeScript の CDK、cdkd、Ox Content、Vue と Vize、Valibot。Amplify は使わない。HTTP のフレームワークも使わない（`Request` を受けて `Response` を返す関数と、`examples/04-http-api/src/http/` の部品で書く。`docs/WINTERTC_BRIEF.md`）
- **共有ファイルを手で編集しない。** `vite.config.ts`、`data/*.json`、`data/pricing/*.json`、`tools/src/checks/typecheck-projects.json` は、断片を書いて `node tools/src/fragments/apply.ts <章 ID>` で反映する。他の章のファイル、`tools/`、`book/infra/`、`README.md`、`docs/` には触らない

## 作るもの

章 ID を `NN`、slug を `data/chapters.json` のものとします。

### 1. サンプル: `examples/NN-slug/`

- `package.json` は `@aih/example-NN-slug`、`"private": true`、`"type": "module"`。依存は**完全一致の版**で書く（`^` を使わない）。既存のサンプルと同じパッケージは同じ版にする。新しいパッケージは npm レジストリで現行版を確かめる
- 既存のサンプルのコードは、workspace 依存（`"@aih/example-05-dynamodb": "workspace:*"`）で import して再利用してよい。export を変える必要があれば、変えずに自分の側で包む
- TypeScript は Node.js が型を取り除くだけで動く構文に限る（`enum`、parameter property、`namespace` を使わない）。import に `.ts` を書く。`tsconfig.json` は `../../tsconfig.base.json` を継承
- 外から来る値（環境変数、HTTP、イベント、DB の行、キューのメッセージ、外部 API の応答）は Valibot で検証し、型は `v.InferOutput` で導く。Valibot の組み込みの検査が緩いところ（`docs/WINTERTC_BRIEF.md` の一覧）は、明示の検査で補う
- 判断（純粋関数）と、AWS を呼ぶ処理（adapter）を分ける。時刻、乱数、外部の応答は引数で渡す
- CDK の service は namespace で import する（`import * as s3 from "aws-cdk-lib/aws-s3"`、`s3.Bucket`）。別名の一覧は `CONTRIBUTING.md`。本文で CDK の API を呼ぶときも `ecs.ContainerImage.fromAsset` のように namespace を付ける
- テストは `vite-plus/test` から import。件数は目的にしない。権限、公開設定、保持と削除、認可、冪等性、競合、再試行、部分的な失敗など、実害に結びつく条件を選ぶ。失敗を**決まった順序で再現する**テスト（重複配送、応答の喪失、途中での中断など）を、その章の invariant に対して書く
- CDK の stack には assertion のテストを付ける。最小権限（`*` を使わない）、公開されていないこと、`removalPolicy`、そして「使っているリソースの種類の一覧」を固定するテスト。種類ごとに、固定した版の cdkd（0.296.28）が専用の実装を持つか、Cloud Control API 経由かを、npm の tarball か GitHub の `v0.296.28` タグの `src/provisioning/register-providers.ts` で確かめ、検証メモに書く
- stack の `env` はリージョンだけ（`ap-northeast-1`）。アカウントは書かない。synth が AWS に問い合わせないこと
- 練習用のリソースは stack と一緒に消える設定（`RemovalPolicy.DESTROY`）にし、本番で変えるべき点を本文に書く
- 時間課金のリソース（NAT Gateway、ALB、常時稼働のコンテナや DB、public IPv4 など）を作る章では、本文の目立つ場所に「置いてあるだけで料金がかかる」ことと片付け方を書く
- コメントは「なぜ」だけを 1〜2 行。本文から取り込む範囲には `// #region name` と `// #endregion name` を付ける
- Docker が要る手順は、Docker の daemon が Nix の shell には含まれないことを書く。daemon が無ければ実行せず、未検証と記録する

### 2. 本文: `book/content/ja/chapters/NN-slug.md` と `book/content/en/chapters/NN-slug.md`

新しい章では、この 2 つのファイルはアウトラインから自動生成された planned のページになっています。丸ごと書き換えます（frontmatter の `generated: true` を消す）。いまある 00〜24章はすべて書き上がっているので、書き直すときは既存の本文を土台にします。

- 日本語を先に書き、同じ調子で英語にする
- frontmatter: 日本語は `title: "NN <data/chapters.json の title.ja>"` と `revision: 1`。英語は `title: "NN <title.en>"` と `sourceRevision: 1`
- 文体は `EDITORIAL.md` の「文体: やわらかく、シュッと」。短い導入から入り、見出しは内容で付け、太字と表は少なく
- コードは `<<< @/examples/NN-slug/path/to/file.ts{region}` で実ファイルから取り込む。本文に手で写さない
- 構成図や時系列は ```text で書き、**日英で同じ内容**にする（英語の識別子だけで書く）
- 節の頭に `<!-- section: NN.name -->`（`name` は `[a-z0-9-]+`）を置き、断片の `sections` に対応を書く。少なくとも 5 つ
- 章に入れる内容: 何を作るかと前提 / 何がどこで動くか / なぜこの構成か、別の選択肢にする条件 / 手元での起動・テスト・再現しないもの / デプロイと動作確認の手順（実行はしない） / 料金（使っていないとき、使ったとき、消した後。単価の出典と使用量の仮定つき） / 失敗例と調べ方 / 本番にするなら / 片付けと残るもの / 分散システムとしての見方（状態の持ち主、invariant、それを壊すテスト）。当てはまらないものは省く
- Cloudflare（D1、Workers、Workers AI）に対応する体験がある章は、違いを率直に書く。Cloudflare 側の記述も一次情報で確かめる。確かめていなければ、そう書く
- 章末に `::: details この章の検証メモ` … `:::`。中に太字の小見出しで「手元で確かめたこと。」「まだ確かめていないこと。」「コードの場所。」（節・ファイル・タスクの表）「一次情報」（確認日つき）。英語は `::: details Verification notes for this chapter` と "Checked locally." "Not checked yet." "Where the code is." "Primary sources"
- 日英で、section 行、`<<<` 行、```text の中身、見出しの数、コードブロックの数を一致させる。内部リンクは `/ja/...md` と `/en/...md`

### 3. 断片: `data/fragments/NN.json`

共有ファイルへの追加を 1 つにまとめたものです。形は `tools/src/fragments/apply.ts` の `fragmentSchema` と、そこから参照している `tools/src/data/schemas.ts`、`tools/src/pricing/schema.ts` を読んでください。

```json
{
  "chapterId": "NN",
  "manifest": {
    "id": "NN", "slug": "...", "title": { "ja": "...", "en": "..." },
    "prerequisites": ["04"], "services": ["..."], "samplePath": "examples/NN-slug",
    "writing": { "ja": "complete", "en": "complete" },
    "sourceRevision": 1, "translatedRevision": { "en": 1 },
    "checkedAt": "2026-10-11", "sourceIds": ["..."]
  },
  "sources": [{ "id": "...", "url": "https://...", "title": "...", "checkedAt": "2026-10-11", "supports": ["..."], "note": "..." }],
  "glossary": [{ "id": "...", "ja": "...", "en": "...", "firstUse": "NN", "definition": { "ja": "...", "en": "..." } }],
  "sections": [{ "id": "NN.name", "sources": ["examples/NN-slug/src/x.ts"], "tasks": ["test:unit"], "boundary": "local", "criteria": ["type", "test"], "verification": "local" }],
  "unitPrices": [], "allowances": [], "unknownAllowances": [], "scenarios": [],
  "validation": {
    "records": [{ "scope": "NN", "command": "vp run test:unit (examples/NN-slug)", "kind": "local", "status": "passed", "ranAt": "2026-10-11", "note": { "ja": "...", "en": "..." } }],
    "open": [{ "id": "...", "summary": { "ja": "...", "en": "..." }, "resume": { "ja": "...", "en": "..." } }]
  },
  "toolchain": [],
  "tasks": {
    "snippet": "      \"dev:foo\": fresh(\"node --watch src/dev.ts\", { cwd: \"examples/NN-slug\" }),\n      ...infra(\"foo\", \"examples/NN-slug\", \"AihFoo\"),",
    "synth": ["foo:infra:synth"],
    "checkAll": [],
    "typecheck": ["examples/NN-slug"]
  }
}
```

- `manifest.title`、`slug`、`prerequisites` は `data/chapters.json` のいまの値を引き継ぐ。`checkedAt` などの日付は、作業した日（`date +%F`）
- `sources` の `checkedAt` は、実際にそのページを読んだ日。読んでいない出典は載せない
- `sections[].verification` は `local`（手元で実行した）か `unverified`。`aws` は使わない。`boundary` は `none`、`local`、`cloud`、`local+cloud`。`sources` は実在するファイルかディレクトリ、`tasks` は実在するタスク名
- 料金: 単価は AWS Price List の bulk API（`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<OfferCode>/current/ap-northeast-1/index.json`、CloudFront などリージョンを持たないものは `.../current/index.json`）から SKU を探し、`unitPrices` に `usd` を公開されている 10 進の文字列のまま入れる。使用量の仮定は `scenarios` に、確認できた無料枠は `allowances` に、確認できなかったものは `unknownAllowances` に書く。本文の金額は、`tools/src/pricing/calc.ts` が計算した値と一致させる。確認できない料金は「不明」と書き、0 にしない
- `validation.records` には、実際に実行して通ったローカルの検証と、実行していない検証（`status: "not-run"`、`ranAt: null`、AWS を使うものは `kind: "aws"`）の両方を書く
- `tasks.snippet`: `vite.config.ts` の `run.tasks` に入る行。6 つの空白で字下げ。使えるのは `fresh(command, { cwd, dependsOn })`（手元だけ・キャッシュしない）、`live(command, { cwd, dependsOn })`（AWS や外部を読む・変える。キャッシュしない）、`infra(name, appDir, stack)`（cdkd の一式）、`site(name, appDir, stack, buildDir, buildTask)`、キャッシュしてよいビルドは `{ command, cwd }`、そして `node`（`.env` を読む `node` の起動）。タスク名は既存と重ならないこと
- `tasks.synth` に入れた synth タスクは `infra:synth` に、`tasks.checkAll` に入れた手元だけのタスクは `check:all` に加わる。`tasks.typecheck` は `vp run typecheck` の対象

## 手順

Nix のコマンドは、sandbox の中では daemon に届かず失敗します。Bash は sandbox を無効にして実行してください。コマンドは `nix develop -c sh -c '...'` の形で。

1. `data/chapters.json` の自分の章のアウトラインを読む。前提の章の本文とサンプルを読む
2. 一次情報を読み、使う機能と制約、料金を確かめる
3. サンプルとテストを書く。`nix develop -c sh -c 'vp install'` で依存を入れる（lockfile が更新される）
4. 断片を書き、`nix develop -c sh -c 'node tools/src/fragments/apply.ts NN'` で反映する
5. 日本語の本文、続いて英語の本文を書く
6. `nix develop -c sh -c 'vp run book:generate && vp check --fix && vp run check:all'` が通るまで直す。`vp check --fix` の後は、本文から取り込む `#region` が残っていることを確かめる
7. 手元で動かせるもの（開発サーバー、テスト、synth、ビルド）は実際に動かし、動かした事実だけを検証メモと断片に書く
8. 断片を直したら、もう一度 `apply.ts` を実行する（同じ ID の項目は置き換わる）

## 終わったら

自分の worktree のブランチに、conventional commit で 1 つ commit します（メッセージの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`）。

```text
feat(book): write chapter NN on <topic> with its example
```

報告に含めるもの: worktree のパスとブランチ名、commit の hash、`check:all` の結果、手元で確かめたこと、確かめていないこと、一次情報で確認できなかった点、前提の章や共通コードについて気づいた問題。
