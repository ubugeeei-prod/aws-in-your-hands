---
title: 本のサイトを再現する
revision: 2
---

# 本のサイトを再現する

いま読んでいるこのサイトは、本が説明しているのと同じ部品でできています。Ox Content が静的な HTML を生成して、非公開の S3 bucket に置き、CloudFront が配信する。インフラは TypeScript の CDK で定義して、cdkd で作ります。

このページでは、同じサイトを自分のアカウントに作り直す手順と、その中身を見ていきます。[02章](/ja/chapters/02-toolchain.md)と[03章](/ja/chapters/03-spa.md)を読んでいる前提です。

先に正直に言っておくと、手元で確かめられたのはビルド、リンク検査、CDK の synth と assertion までです。AWS へのデプロイ、公開、smoke test はまだ実行していません。このサイトの公開 URL も、まだありません。

## 全体像

<!-- section: book.architecture -->

```text
book/content/{ja,en}/**/*.md  +  data/*.json  +  examples/** (snippets)
  |  vp run build:book  (Ox Content, static site generation)
  v
book/dist/
  index.html  404.html  search-index.json
  ja/.../index.html  en/.../index.html
  assets/<name>-<hash>.{css,js}
  |  vp run book:publish  (S3 PutObject; does not touch infrastructure)
  v
S3 bucket (private)  <--  CloudFront distribution  <--  Reader
                            viewer-request: url-rewrite function
                            403/404 from S3 -> /404.html with status 404
```

本のサイトと、03章の SPA は別のものです。stack も bucket も URL も別々です。

- 本のサイトは `AihBookSite` という stack で、定義は `book/infra/`。配るのはページごとの HTML（SSG）で、`vp run build:book` でビルドします
- 03章の SPA は `AihSpa` という stack で、定義は `examples/03-spa/infra/`。配るのは 1 つの `index.html`（SPA）で、`vp run build:spa` でビルドします

## 本文とビルド

<!-- section: book.build -->

```bash
vp run dev:book
vp run build:book
vp run preview:book
```

`dev:book` は、保存するたびに再読み込みされる開発サーバーです。`build:book` が `book/dist/` に静的なファイルを書き出します。どれも AWS には触りません。

設定は、この 1 ファイルだけです。

<<< @/book/vite.config.ts

使っている Ox Content の機能を並べておきます。どれも固定した版（3.2.14）の型定義にあるもので、実際にビルドして確かめています。

| 機能 | 設定 |
| --- | --- |
| 日英の route と言語の切り替え | `i18n` と `ssg.localeSwitcher`。`content/ja/` と `content/en/` が、そのまま `/ja/` と `/en/` になる |
| 検索 | 既定で有効。`search-index.json` が出力される |
| 前後のページへの移動 | `ssg.pagination` |
| コードのコピー | `ssg.readerChrome` |
| 右側の目次 | `theme.aside` |
| dark mode、モバイル用のメニュー | 既定のテーマに含まれる |
| 実ファイルからのコードの取り込み | `codeImports`。`<<< @/path{region}` と書く |

本文中のコードは、すべて最後の機能で実ファイルから取り込んでいます。日本語版と英語版が、同じファイルの同じ範囲を指すわけです。

サイドバーは、章の一覧（`data/chapters.json`）から作ります。

<<< @/book/site.ts

### 手で書いていないページ

料金、出典、用語集、検証記録、ツールチェイン、そして未執筆の章のアウトライン。これらは手で書いていません。`data/` の JSON から、日英の両方を生成します。

```bash
vp run book:generate
vp run book:generate:check
```

`book:generate:check` は、生成済みのファイルが古くなっていたら失敗します。`build:book` はこれを先に実行します。

### 日英とコードがずれていないか

```bash
vp run content:check
```

手元だけで完結する検査です。確かめているのは次のことです。

- すべてのページが日英の両方にある
- 節の目印、コードの取り込み、図、見出しの数、コードブロックの数が、日英で一致する
- 取り込んでいるファイルと範囲が存在し、git で配布される
- 章の日本語版の改訂番号と、英語版が翻訳元にした改訂番号が一致する
- 節ごとのソース対応（`data/section-map.json`）が、本文の目印と過不足なく対応し、挙げたファイルとタスクが実在する

## URL の扱い

<!-- section: book.routing -->

Ox Content は、`ja/chapters/03-spa.md` を `ja/chapters/03-spa/index.html` として出力します。ページ内のリンクは `/ja/chapters/03-spa/index.html` の形です。でも、読者が打つ URL や、他のサイトからのリンクは `/ja/chapters/03-spa/` でしょう。

非公開の S3 origin は、ディレクトリを `index.html` に読み替えてくれません。その機能は S3 の Web サイトホスティングのもので、それを使うと bucket を OAC で守れないからです。そこで、CloudFront Function が読み替えます。

<<< @/book/infra/functions/url-rewrite.js

読者が要求する URL ごとに、関数がすることはこうです。

- `/ja/chapters/03-spa/` は、`/ja/chapters/03-spa/index.html` に書き換える
- `/ja/chapters/03-spa` は、`/ja/chapters/03-spa/` へ 301 で転送する。1 つのページに URL を 2 つ持たせないためです
- `/assets/...css` や `/search-index.json` には、何もしない
- 存在しないページは、書き換えた結果の object が S3 に無いので、404 になる

03章の SPA と違って、存在しない URL に **`index.html` を返しません**。本でそれをやると、リンク切れがすべてトップページに見えてしまいます。

404 は distribution の側で扱います。

<<< @/book/infra/lib/book-site-stack.ts{distribution}

この bucket policy は `s3:GetObject` しか許可していないので、S3 は存在しない object に 403 を返します。403 と 404 の両方を、生成した `404.html` と、状態コード 404 に置き換えます。

関数のテストは、デプロイするファイルそのものを読み込んで実行します。ビルド後には、すべての内部リンクの先が実在することも確かめます。

```bash
vp run links:check
```

## インフラ

<!-- section: book.infra -->

<<< @/book/infra/lib/book-site-stack.ts{bucket}

<<< @/book/infra/lib/book-site-stack.ts{rewrite}

<<< @/book/infra/lib/book-site-stack.ts{outputs}

cache と応答ヘッダーには、AWS の管理ポリシーを使っています。自分で定義する `CachePolicy` や `ResponseHeadersPolicy` は、固定した版の cdkd では Cloud Control API 経由の扱いになります。使うリソースの種類は少ないほうが、確かめる範囲が狭くて済みます。

使っているリソースの種類は 5 つです。テストがこの一覧を固定していて、種類を増やすとテストが落ちます。増やす前に、固定した版の cdkd がその種類を作成・読み戻しできるかを確かめる。その手順を飛ばせないようにするためです。

cdkd 0.296.28 での扱いは、ソースで確認しました。

- `AWS::S3::Bucket`、`AWS::S3::BucketPolicy` は専用の実装
- `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl` も専用の実装
- `AWS::CloudFront::Function` は Cloud Control API 経由。こちらは、実際のデプロイをまだ確認できていません

CDK の `BucketDeployment`（デプロイ時に bucket へファイルを置く construct）は使っていません。内容の公開を、インフラの更新から切り離しておきたいからです。

### cdkd と付き合うときの約束

cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（確認日 2026-10-11）。この本のサイトは、著者の選択として cdkd で管理します。そのうえで、次を守ります。

- **この stack を CloudFormation と交互に管理しない。** 作成、更新、diff、drift、削除を、すべて cdkd の経路で行います
- **state の bucket（`cdkd-state-<アカウント ID>`）を消さない。** versioning が有効で、誤って上書きした state は S3 の旧 version から戻せます
- **デプロイに失敗したときの動きを知っておく。** cdkd は既定で、作成したものを消し、更新したものを元の設定に戻します（固定した版のソースによる。実際の挙動は未確認）

## 公開する

<!-- section: book.publish -->

初回だけ、インフラを作ります。`.env` の設定と `vp run infra:bootstrap` は 02章のとおりです。

```bash
vp run book:infra:diff
vp run book:infra:deploy
```

そして、内容を公開します。

```bash
vp run book:publish:plan
vp run book:publish
vp run book:smoke
```

タスクが多いので、ここは表で並べますね。

| タスク | すること | AWS |
| --- | --- | --- |
| `build:book` | `book:generate:check` のあと Ox Content でビルドする | 触らない |
| `book:infra:synth` | CDK を template にする | 触らない |
| `book:infra:diff` | template と cdkd の state を比べる | 読む |
| `book:infra:deploy` | bucket、distribution、関数を作る・変える | 変える |
| `book:publish:plan` | `build:book` のあと、公開の計画を表示する | 読む |
| `book:publish` | `build:book` のあと、`book/dist/` を bucket に置く | 変える（bucket の中身だけ） |
| `book:smoke` | 公開 URL を取得して確かめる | 読む |
| `book:infra:drift` | state と実物を比べる | 読む |
| `book:invalidate` | edge の cache を捨てさせる（復旧用） | 変える |
| `book:unpublish` | bucket を空にする | 変える |
| `book:infra:destroy` | stack を消す | 変える |

AWS を読む、または変えるタスクは、すべて `cache: false` です。ふだんの執筆（`dev:book`、`check:all`）からは呼ばれません。対象のアカウントは `AIH_AWS_ACCOUNT_ID`、リージョンは `AIH_AWS_REGION`（既定は `ap-northeast-1`）、stack は `AihBookSite` です。

`book:infra:deploy` だけでは、本文は更新されません。`book:publish` だけでは、bucket や distribution の設定は変わりません。公開の script は、bucket や distribution を作ることも、その設定を変えることもしません。

cache の方針、アップロードの順序、途中で失敗したときの扱いは、03章の「公開する」と同じ実装（`tools/src/site/`）です。HTML と `search-index.json` は毎回 origin に確かめさせて、`assets/` 以下は 1 年間 cache させます。通常の公開に invalidation は要りません。

`book:smoke` が確かめるのは次のことです。CLI が成功で終わったことではなく、これが通ったことをもって公開の完了とします。

- `/`、`/ja/`、`/en/` と、日英それぞれの章のページが 200 で返り、`<html lang>` が正しい
- 末尾の `/` が無い URL が 301 で転送される
- 存在しないページが 404 で返る
- ハッシュ付きの asset に 1 年間の `Cache-Control` が付いている
- HTTP が HTTPS へ転送される
- `aih-revision.json` が、手元の commit のリビジョンと一致する

### 公開した版を戻す

bucket の versioning は有効にしていません。前の版へ戻したいときは、前の commit をビルドして公開し直します。

```bash
git switch --detach <戻したい commit>
nix develop --command vp install --frozen-lockfile
nix develop --command vp run book:publish
nix develop --command vp run book:smoke
```

`flake.lock` と `pnpm-lock.yaml` がその commit のものになるので、ツールも当時の版でビルドされます。終わったら `git switch -` で元の branch に戻ります。

### 独自ドメイン

まだ対応していません。追加するときは、Route 53 の hosted zone と、`us-east-1` の ACM の証明書を、同じ `book/infra/` の中に定義します。そのとき、ビルド時に `AIH_BOOK_SITE_URL` を設定すると、Ox Content が canonical と hreflang のリンクを出力します。実在する URL が無い間は、設定しません。

## お金の話

03章と同じ計算です。[料金の計算](/ja/reference/pricing.md)に、計算例が 2 つあります。

- 公開したまま誰も読まない月: 定価で USD 0.00（S3 の保存 50 MB 分は 0.01 未満）
- 月 2 万ページビューを仮定した月: 定価で USD 0.50、CloudFront の毎月の無料枠を引くと USD 0.03

アクセスログ、AWS WAF、独自ドメインは使っていません。

## 片付け

<!-- section: book.cleanup -->

```bash
vp run book:unpublish --yes
vp run book:infra:destroy
```

残るのは、cdkd の bootstrap で作った state の bucket、asset の bucket、ECR repository（02章）です。こちらは、他の stack が無くなってから、02章の手順で消します。それ以外には残りません。この stack はログを作りません。

## CI から公開するなら

人の端末からではなく CI から公開するときも、同じ Nix の lock と同じ `vp run` タスクを使います。例を `docs/examples/book-publish.yml` に置いています。AWS の認証には、長期のアクセスキーではなく、OIDC による短い期限の認証情報を使います。その role の定義は 20章（planned）で扱う予定で、まだこのリポジトリにはありません。

::: details このページの検証メモ

**手元で確かめたこと。** ビルド、リンク検査、CDK の synth と assertion。

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
