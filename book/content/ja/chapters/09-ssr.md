---
title: "09 SSR: BFF、Nuxt をリージョンの Lambda で動かす"
revision: 4
---

# 09 SSR: BFF、Nuxt をリージョンの Lambda で動かす

03章では、ビルド済みの HTML と JavaScript を S3 に置いて配りました。04章では、リクエストのたびに動く関数を Lambda に載せました。この章ではその 2 つを組み合わせ、Nuxt のアプリを Lambda で動かして、リクエストごとに HTML を組み立てて返します。server-side rendering（SSR）と呼ばれる構成です。

動かすこと自体は難しくありません。難しいのはキャッシュです。CloudFront は 1 つのレスポンスを保存し、次に来た人にも同じものを返します。公開ページならそのおかげで速くなりますが、ログイン中の人のページを保存してしまうと、他人のページが別の人に届きます。この章の半分は、その事故が起きない作りにあてています。

前提は [03章](/ja/chapters/03-spa.md)と [04章](/ja/chapters/04-http-api.md)です。コードは `examples/09-ssr/` にあります。時間単位で課金されるリソースは作りません。

## 全体像

<!-- section: 09.architecture -->

```figure
caption: CloudFront がパスで行き先を 3 つに分け、/_nuxt/* は S3 が、それ以外は Lambda が答える
node browser: Browser
node cf: CloudFront ディストリビューション | edge locations
node nuxt: /_nuxt/*
node me: /me, /me/* | キャッシュしない、cookie を転送
node other: それ以外 | レスポンスが許すときだけキャッシュ、cookie は落とす
node s3: S3 バケット | private, OAC
node furl: Lambda function URL | OAC
node nitro: Nitro handler | Nuxt がページを描画、サーバールートが /api/* と /me/* に答える
node logs: CloudWatch Logs | 7 日保持
edge browser -> cf: HTTPS
edge cf -> nuxt
edge cf -> me
edge cf -> other
edge nuxt -> s3: ハッシュ付きの JS と CSS
edge me -> furl
edge other -> furl
edge furl -> nitro
edge nitro -> logs
group fn: Lambda function (ap-northeast-1, Node.js 24, arm64, 512 MB, timeout 10 s) = furl, nitro
mark nitro
```

入口は CloudFront のディストリビューション（distribution）1 つで、リクエストのパスを見て行き先を 3 つに分けます。

`/_nuxt/*` は、Nuxt がビルドで書き出す JavaScript と CSS です。ファイル名に内容のハッシュが入っているので、03章と同じく S3 に置いて長くキャッシュさせます。このパスでは Lambda は起動しません。

残りのリクエストは Lambda に届き、Lambda の中で Nuxt が HTML を組み立てて返します。ただし `/me` とその下は、見ている人によって中身が変わりうる場所として別に扱い、一切キャッシュしません。

作るアプリは小さく、公開ノートの一覧（`/`）と詳細（`/notes/:id`）、それに自分のページ（`/me`）だけです。

### edge rendering との違い

HTML を組み立てるのは東京リージョンの Lambda で、CloudFront のエッジロケーションではありません。

CloudFront が前に立っているので、キャッシュに当たったレスポンスは読者の近くから返ります。当たらなかったリクエストは東京まで行き、Lambda が動いてから戻ってきます。ロンドンの読者がキャッシュにないページを開けば、東京との往復のぶんだけ待つことになります。

CDN の後ろにあるからといって、エッジで動いているわけではありません。この本ではこの構成を regional SSR と呼びます。エッジで動かせるコードとその制約は [10章](/ja/chapters/10-edge.md)で扱います。

### SSR にしなくていいとき

SSR が SPA より常に良いわけではありません。Lambda が 1 つ増え、キャッシュの設計が必要になり、壊れうる場所も増えます。

- ログインしないと何も見えないアプリは、検索エンジンに読ませる HTML がないので、03章と 06章の SPA で足ります
- 内容がビルド時に決まるサイトは、HTML を先にすべて作って S3 に置けば Lambda が要りません。この本のサイトもそうしています

SSR が役に立つのは、公開されていて、内容がリクエスト時に決まり、最初の表示や検索エンジン向けの HTML が大事なページです。

## Nuxt を Lambda の形にする

<!-- section: 09.nitro -->

Nuxt のサーバー側は、Nitro という別のパッケージが担当しています。Nitro には、動かす先に合わせてビルド結果の形を変えるプリセット（preset）があり、その 1 つが AWS Lambda 向けです。

版は固定しています。Nuxt は 4.6.1 で、この Nuxt が使う Nitro は `nitropack` 2.13.4 です。npm には `nitro` という名前で 3 系の beta も公開されていますが、Nuxt 4.6.1 が依存しているのは 2 系なので、2 系を読みました。以下の内容は、ドキュメントからではなく、固定した版の `nitropack` のソース（`dist/presets/aws-lambda/`）と実際のビルド結果から確かめたものです。

<<< @/examples/09-ssr/nuxt.config.ts{config}

プリセットの名前は `aws-lambda` で、オプションは `awsLambda.streaming` の 1 つしかありません。このプリセットが効くのは `nuxt build` のときだけで、`nuxt dev` は使いません。

冒頭の `import type {} from "@nuxt/nitro-server"` は、型のために置いた 1 行です。この行がないと、Nuxt 4.6.1 の型は `nitro` の中身をどの版の Nitro のものか特定できず、`preset` と書いただけで型エラーになります。この行があれば固定した `nitropack` の型で検査されるので、オプションの名前を打ち間違えたときに気づけます。

ビルドすると、次のディレクトリができます。

```text
examples/09-ssr/.output/
  nitro.json            preset, Nitro version, awsLambda.streaming
  server/
    index.mjs           exports `handler`
    chunks/             the bundled application
    node_modules/       only the packages the server imports
    package.json
  public/
    _nuxt/              content-hashed JS and CSS
    _nuxt/builds/       latest.json: which build is current
```

`server/` は、そのまま Lambda に上げるディレクトリです。必要な `node_modules` も Nitro がこの中に集めるので、04章のように CDK にバンドルさせる必要はありません。`public/_nuxt/` が S3 に置くファイルです。

`index.mjs` が export する `handler` には、形が 2 種類あります。

- `streaming: false`（既定）では、`handler(event, context)` が `statusCode`、`headers`、`cookies`、`body` を持つオブジェクトを返します。レスポンスをすべて作り終えてから返す形です
- `streaming: true` では、Lambda の Node.js ランタイムが用意する `awslambda.streamifyResponse` で包まれたハンドラーになり、レスポンスをストリームに書き込みます

どちらの形でビルドしたかは `nitro.json` に残ります。[次のページ](/ja/chapters/09-ssr/build.md)で書く CDK のスタックは、このファイルを読んで Lambda 側の設定を決めます。

<<< @/examples/09-ssr/scripts/lambda-harness.ts{nitro-json}

ビルドの出力も型の外から来る値なので、スキーマと照合してから使います。

### Vize との組み合わせ

`.vue` のコンパイル、型検査、lint には、03章や 06章と同じく Vize を使います。Nuxt 向けの `@vizejs/nuxt` 0.443.0 を `modules` に足すと、`nuxt dev` と `nuxt build` が Vize で `.vue` をコンパイルします。手元ではどちらも動きました。

型検査と lint は、Nuxt の外から `vize check` と `vize lint` で実行します（タスクは `typecheck:ssr` と `lint:ssr`）。そのため `.vue` の中では Nuxt の auto-import に頼らず、`useFetch` などを `nuxt/app` から明示的に import しています。auto-import を使った場合に Vize がどこまで型を追えるかは、確かめていません。

`@vizejs/nuxt` 0.443.0 は古い `@nuxt/kit`（3.11.2）に依存しているため、インストール時に peer dependency の警告が 1 件出ます。ビルドと開発サーバーには影響しませんでした。

## 小さなアプリ

<!-- section: 09.app -->

ノートの形は、04章と同じやり方でスキーマにします。

<<< @/examples/09-ssr/core/notes.ts{note}

一覧のページは次のとおりです。

<<< @/examples/09-ssr/app/pages/index.vue

`useFetch("/api/notes")` は、サーバーで HTML を組み立てているあいだは同じプロセスの中のルートを直接呼ぶので、HTTP を通りません。リンクを押して画面を切り替えたときのように同じコードがブラウザで動くと、本物の HTTP リクエストになります。どちらの場合も、返ってきた値はスキーマと照合してから使います。

`/api/notes` は、コードと一緒に配るノートを返すだけです。

<<< @/examples/09-ssr/server/context.ts{context}

ノートを DynamoDB から読まないのは意図したことです。この章の前提を 03章と 04章だけにしたかったことに加えて、04章で見たとおり、Lambda のメモリに書き込んだデータはデータの持ち主になれません。コードと一緒に配る読み取り専用のデータなら、どの実行環境も同じ答えを返します。05章のテーブルから読むように変える場合、差し替えるのは `notes` の 1 行です。

`core/` には、Nuxt も AWS も知らない TypeScript だけを置いています。判断は `core/` に書き、テストも `core/` に対して書きます。`server/` と `app/` は、その判断を Nuxt につなぐ薄い層です。
