---
title: 本のサイトを再現する
revision: 2
---

# 本のサイトを再現する

いま読んでいるこのサイトは、本が説明しているのと同じ部品でできています。Ox Content が静的な HTML を生成し、その HTML を非公開の S3 バケットに置いて、CloudFront が配信します。インフラは TypeScript の CDK で定義し、cdkd で作ります。

このページでは、同じサイトを自分のアカウントに作り直す手順と、サイトの中身を説明します。[02章](/ja/chapters/02-toolchain.md)と[03章](/ja/chapters/03-spa.md)を読んでいることを前提にしています。

手元で確かめられたのは、ビルド、リンク検査、CDK の synth とアサーションまでです。AWS へのデプロイ、公開、smoke test はまだ実行していません。このサイトの公開 URL も、まだありません。

## 全体像

<!-- section: book.architecture -->

```figure
caption: 本文、データ、サンプルから取り込むコードを book/dist/ にビルドし、publish が S3 に置きます。
node content: book/content/{ja,en}/**/*.md
node data: data/*.json
node examples: examples/** | snippets
node build: vp run build:book | Ox Content, static site generation
node pages: index.html, 404.html | {ja,en}/.../index.html
node assets: search-index.json | assets/<name>-<hash>.{css,js}
node publish: vp run book:publish | S3 PutObject, インフラには触らない
node s3: S3 バケット | 非公開
edge content -> build
edge data -> build
edge examples -> build
edge build -> pages
edge build -> assets
edge pages -> publish
edge assets -> publish
edge publish -> s3
group dist: book/dist/ = pages, assets
```

```figure
caption: 読者のリクエストは CloudFront を通って非公開の S3 バケットに届き、S3 の 403 と 404 は /404.html として返ります。
direction: right
node reader: Reader
node cf: CloudFront ディストリビューション | viewer-request: url-rewrite 関数
node s3: S3 バケット | 非公開
edge reader -> cf
edge cf -> s3
edge s3 --x cf: 403/404
edge cf --> reader: /404.html, status 404
```

本のサイトと 03章の SPA は別のもので、スタックもバケットも URL も分かれています。

- 本のサイトは `AihBookSite` というスタックで、定義は `book/infra/` にあります。配信するのはページごとの HTML（SSG）で、`vp run build:book` でビルドします
- 03章の SPA は `AihSpa` というスタックで、定義は `examples/03-spa/infra/` にあります。配信するのは 1 つの `index.html`（SPA）で、`vp run build:spa` でビルドします

## 本文とビルド

<!-- section: book.build -->

```bash
vp run dev:book
vp run build:book
vp run preview:book
```

`dev:book` は、ファイルを保存するたびに再読み込みする開発サーバーです。`build:book` は、`book/dist/` に静的なファイルを書き出します。どのタスクも AWS には触りません。

設定は次の 1 ファイルだけです。

<<< @/book/vite.config.ts

使っている Ox Content の機能は次のとおりです。どれも固定した版（3.2.14）の型定義にあるもので、実際にビルドして確かめています。

| 機能 | 設定 |
| --- | --- |
| 日英のルートと言語の切り替え | `i18n` と `ssg.localeSwitcher`。`content/ja/` と `content/en/` が、そのまま `/ja/` と `/en/` になる |
| 検索 | 既定で有効。`search-index.json` が出力される |
| 前後のページへの移動 | `ssg.pagination` |
| コードのコピー | `ssg.readerChrome` |
| 右側の目次 | `theme.aside` |
| ダークモード、モバイル用のメニュー | 既定のテーマに含まれる |
| 実ファイルからのコードの取り込み | `codeImports`。`<<< @/path{region}` と書く |

本文中のコードは、すべて最後の機能で実ファイルから取り込んでいます。そのため、日本語版と英語版は、同じファイルの同じ範囲を指します。

サイドバーは、章の一覧（`data/chapters.json`）から作ります。

<<< @/book/site.ts

### 手で書いていないページ

料金、出典、用語集、検証記録、ツールチェインのページは、手で書いていません。`data/` の JSON から、日英の両方を生成します。

```bash
vp run book:generate
vp run book:generate:check
```

`book:generate:check` は、生成済みのファイルが古くなっていると失敗します。`build:book` は、ビルドの前にこの検査を実行します。

### 日英とコードのずれの検査

```bash
vp run content:check
```

手元だけで完結する検査で、次のことを確かめます。

- すべてのページが日英の両方にある
- 節の目印、コードの取り込み、図、見出しの数、コードブロックの数が、日英で一致する
- 取り込んでいるファイルと範囲が存在し、git で配布される
- 章の日本語版の改訂番号と、英語版が翻訳元にした改訂番号が一致する
- 節ごとのソース対応（`data/section-map.json`）が、本文の目印と過不足なく対応し、挙げたファイルとタスクが実在する

## URL の扱い

<!-- section: book.routing -->

Ox Content は、`ja/chapters/03-spa.md` を `ja/chapters/03-spa/index.html` として出力し、ページ内のリンクを `/ja/chapters/03-spa/index.html` の形で書き出します。一方で、読者が入力する URL や、ほかのサイトからのリンクは、`/ja/chapters/03-spa/` の形になるでしょう。

非公開の S3 オリジンは、ディレクトリを `index.html` に読み替えません。読み替えは S3 の Web サイトホスティングの機能で、その機能を使うとバケットを OAC で守れないからです。そこで、CloudFront Function が読み替えます。

<<< @/book/infra/functions/url-rewrite.js

読者が要求する URL ごとに、関数は次のように動きます。

- `/ja/chapters/03-spa/` は、`/ja/chapters/03-spa/index.html` に書き換える
- `/ja/chapters/03-spa` は、`/ja/chapters/03-spa/` へ 301 で転送する。1 つのページに URL を 2 つ持たせないためです
- `/assets/...css` や `/search-index.json` には、何もしない
- 存在しないページは、書き換えた結果のオブジェクトが S3 に無いので、404 になる

03章の SPA とは違って、存在しない URL に **`index.html` を返しません**。本のサイトで `index.html` を返すと、リンク切れがすべてトップページに見えてしまうからです。

404 はディストリビューションの側で扱います。

<<< @/book/infra/lib/book-site-stack.ts{distribution}

このバケットポリシーは `s3:GetObject` しか許可していないので、S3 は存在しないオブジェクトに 403 を返します。そこで、403 と 404 の両方を、生成した `404.html` と状態コード 404 に置き換えます。

関数のテストは、デプロイするファイルそのものを読み込んで実行します。ビルドのあとには、すべての内部リンクの先が実在することも確かめます。

```bash
vp run links:check
```

## インフラ

<!-- section: book.infra -->

<<< @/book/infra/lib/book-site-stack.ts{bucket}

<<< @/book/infra/lib/book-site-stack.ts{rewrite}

<<< @/book/infra/lib/book-site-stack.ts{outputs}

キャッシュとレスポンスヘッダーには、AWS の管理ポリシーを使っています。自分で定義する `CachePolicy` や `ResponseHeadersPolicy` は、固定した版の cdkd では Cloud Control API 経由の扱いになります。使うリソースの種類が少ないほうが、確かめる範囲は狭くて済みます。

使っているリソースの種類は 5 つです。テストがこの一覧を固定していて、種類を増やすとテストが失敗します。種類を増やす前に、固定した版の cdkd がその種類を作成し、読み戻せるかを確かめる手順を、飛ばせないようにするためです。

cdkd 0.296.28 での扱いは、ソースで確認しました。

- `AWS::S3::Bucket`、`AWS::S3::BucketPolicy` は専用の実装
- `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl` も専用の実装
- `AWS::CloudFront::Function` は Cloud Control API 経由。こちらは、実際のデプロイをまだ確認できていません

デプロイのときにバケットへファイルを置く CDK のコンストラクトである `BucketDeployment` は、使っていません。内容の公開を、インフラの更新から切り離しておきたいからです。

### cdkd を使ううえで守ること

cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（確認日 2026-10-11）。この本のサイトは、著者の選択として cdkd で管理します。そのうえで、次の 3 つを守ります。

- このスタックを CloudFormation と交互に管理しない。作成、更新、diff、ドリフトの検出、削除を、すべて cdkd の経路で実行します
- state のバケット（`cdkd-state-<アカウント ID>`）を消さない。バージョニングが有効なので、誤って上書きした state は S3 の旧バージョンから戻せます
- デプロイに失敗したときの動きを知っておく。cdkd は既定で、作成したものを消し、更新したものを元の設定に戻します（固定した版のソースによる。実際の挙動は未確認）

## 公開する

<!-- section: book.publish -->

初回だけ、インフラを作ります。`.env` の設定と `vp run infra:bootstrap` は 02章のとおりです。

```bash
vp run book:infra:diff
vp run book:infra:deploy
```

インフラができたら、内容を公開します。

```bash
vp run book:publish:plan
vp run book:publish
vp run book:smoke
```

関係するタスクを、AWS に触るかどうかと合わせて表にまとめます。

| タスク | すること | AWS |
| --- | --- | --- |
| `build:book` | `book:generate:check` のあと Ox Content でビルドする | 触らない |
| `book:infra:synth` | CDK をテンプレートにする | 触らない |
| `book:infra:diff` | テンプレートと cdkd の state を比べる | 読む |
| `book:infra:deploy` | バケット、ディストリビューション、関数を作る・変える | 変える |
| `book:publish:plan` | `build:book` のあと、公開の計画を表示する | 読む |
| `book:publish` | `build:book` のあと、`book/dist/` をバケットに置く | 変える（バケットの中身だけ） |
| `book:smoke` | 公開 URL を取得して確かめる | 読む |
| `book:infra:drift` | state と実物を比べる | 読む |
| `book:invalidate` | エッジのキャッシュを捨てさせる（復旧用） | 変える |
| `book:unpublish` | バケットを空にする | 変える |
| `book:infra:destroy` | スタックを消す | 変える |

AWS を読むか変えるタスクは、すべて `cache: false` です。ふだんの執筆で使う `dev:book` や `check:all` からは呼ばれません。対象のアカウントは `AIH_AWS_ACCOUNT_ID`、リージョンは `AIH_AWS_REGION`（既定は `ap-northeast-1`）、スタックは `AihBookSite` です。

`book:infra:deploy` だけでは本文は更新されず、`book:publish` だけではバケットやディストリビューションの設定は変わりません。公開のスクリプトは、バケットやディストリビューションを作ることも、その設定を変えることもしません。

キャッシュの方針、アップロードの順序、途中で失敗したときの扱いは、[03章の「公開する」](/ja/chapters/03-spa/deploy.md)と同じ実装（`tools/src/site/`）です。HTML と `search-index.json` は毎回オリジンに確かめさせ、`assets/` 以下は 1 年間キャッシュさせます。通常の公開に invalidation は要りません。

`book:smoke` は次のことを確かめます。CLI が成功して終わったことではなく、この検査に通ったことをもって、公開の完了とします。

- `/`、`/ja/`、`/en/` と、日英それぞれの章のページが 200 で返り、`<html lang>` が正しい
- 末尾の `/` が無い URL が 301 で転送される
- 存在しないページが 404 で返る
- ハッシュ付きのアセットに 1 年間の `Cache-Control` が付いている
- HTTP が HTTPS へ転送される
- `aih-revision.json` が、手元の commit のリビジョンと一致する

### 公開した版を戻す

バケットのバージョニングは有効にしていません。前の版へ戻したいときは、前の commit をビルドして公開し直します。

```bash
git switch --detach <戻したい commit>
nix develop --command vp install --frozen-lockfile
nix develop --command vp run book:publish
nix develop --command vp run book:smoke
```

`flake.lock` と `pnpm-lock.yaml` がその commit のものになるので、ツールも当時の版でビルドされます。終わったら、`git switch -` で元のブランチに戻ります。

### 独自ドメイン

独自ドメインには、まだ対応していません。追加するときは、Route 53 の hosted zone と、`us-east-1` の ACM の証明書を、同じ `book/infra/` の中に定義します。その際、ビルド時に `AIH_BOOK_SITE_URL` を設定すると、Ox Content が canonical と hreflang のリンクを出力します。実在する URL が無い間は、設定しません。

## 料金

計算は 03章と同じです。[料金の計算](/ja/reference/pricing.md)に、計算例が 2 つあります。

- 公開したまま誰も読まない月: 定価で USD 0.00（S3 の保存 50 MB 分は 0.01 未満）
- 月 2 万ページビューを仮定した月: 定価で USD 0.50、CloudFront の毎月の無料枠を引くと USD 0.03

アクセスログ、AWS WAF、独自ドメインは使っていません。

## 片付け

<!-- section: book.cleanup -->

```bash
vp run book:unpublish --yes
vp run book:infra:destroy
```

残るのは、02章の bootstrap で作った state のバケット、アセットのバケット、ECR リポジトリです。この 3 つは、ほかのスタックが無くなってから、02章の手順で消します。このスタックはログを作らないので、ほかには何も残りません。

## CI から公開するなら

人の端末からではなく CI から公開するときも、同じ Nix の lock と同じ `vp run` タスクを使います。例を `docs/examples/book-publish.yml` に置いています。AWS の認証には、長期のアクセスキーではなく、OIDC による期限の短い認証情報を使います。GitHub の OIDC プロバイダーと、ジョブの種類ごとに `sub` を 1 つだけ信頼するロールの書き方は、[20章](/ja/chapters/20-shipping/build.md)が `examples/20-shipping/infra/lib/ci-stack.ts` で扱っています。ただし、20章が定義しているのは 20章の API をデプロイするための 4 つのロール（`PlanRole`、`DeployRole`、`PreviewRole`、`DriftRole`）です。本のサイトを公開するためのロールは、このリポジトリにはありません。

::: details このページの検証メモ

**手元で確かめたこと。** ビルド、リンク検査、CDK の synth とアサーション。

**まだ確かめていないこと。** AWS へのデプロイ、公開、smoke test は実行していません。`AWS::CloudFront::Function` の実際のデプロイ、デプロイに失敗したときの cdkd の実際の挙動も未確認です。このサイトの公開 URL は、まだありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 本文とビルド | `book/vite.config.ts`、`book/site.ts`、`book/content/`、`tools/src/book/generate.ts`、`tools/src/checks/content.ts`、`data/` | `dev:book`、`build:book`、`preview:book`、`book:generate`、`book:generate:check`、`content:check` |
| URL の扱い | `book/infra/functions/url-rewrite.js`、`book/infra/test/url-rewrite.test.ts`、`tools/src/checks/links.ts` | `test:unit`、`links:check` |
| インフラ | `book/infra/lib/book-site-stack.ts`、`book/infra/bin/app.ts`、`book/infra/cdk.json`、`book/infra/test/book-site-stack.test.ts` | `book:infra:synth`、`book:infra:diff`、`book:infra:deploy`、`book:infra:drift` |
| 公開する | `tools/src/site/` | `book:publish:plan`、`book:publish`、`book:smoke`、`book:invalidate` |
| 片付け | `tools/src/site/unpublish.ts` | `book:unpublish`、`book:infra:destroy` |

:::
