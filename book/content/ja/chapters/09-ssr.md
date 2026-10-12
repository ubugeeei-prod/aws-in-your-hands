---
title: "09 SSR: BFF、Nuxt をリージョンの Lambda で動かす"
revision: 2
---

# 09 SSR: BFF、Nuxt をリージョンの Lambda で動かす

03章では、できあがった HTML と JavaScript を S3 に置いて配りました。04章では、リクエストのたびに動く関数を Lambda にのせました。この章はその 2 つを合わせます。Nuxt のアプリを Lambda で動かして、リクエストごとに HTML を組み立てて返します。server-side rendering（SSR）です。

動かすだけなら、そこまで難しくありません。難しいのは cache です。CloudFront は 1 つの応答を保存して、次に来た人にも同じものを返します。公開ページならそれで速くなる。でも、ログイン中の人のページでそれをやると、他人のページが届きます。この章の半分は、その事故を起こさない作りの話です。

前提は [03章](/ja/chapters/03-spa.md)と [04章](/ja/chapters/04-http-api.md)です。コードは `examples/09-ssr/` にあります。時間で課金されるリソースは作りません。

## 全体像

<!-- section: 09.architecture -->

```figure
caption: CloudFront が path で行き先を 3 つに分け、/_nuxt/* は S3 が、それ以外は Lambda が答える
node browser: Browser
node cf: CloudFront distribution | edge locations
node nuxt: /_nuxt/*
node me: /me, /me/* | cache しない、cookie を転送
node other: それ以外 | 応答が許すときだけ cache、cookie は落とす
node s3: S3 bucket | private, OAC
node furl: Lambda function URL | OAC
node nitro: Nitro handler | Nuxt が page を描画、server route が /api/* と /me/* に答える
node logs: CloudWatch Logs | 7 日保持
edge browser -> cf: HTTPS
edge cf -> nuxt
edge cf -> me
edge cf -> other
edge nuxt -> s3: hash 付きの JS と CSS
edge me -> furl
edge other -> furl
edge furl -> nitro
edge nitro -> logs
group fn: Lambda function (ap-northeast-1, Node.js 24, arm64, 512 MB, timeout 10 s) = furl, nitro
mark nitro
```

入口は CloudFront の distribution が 1 つ。path を見て、行き先を 3 つに分けます。

`/_nuxt/*` は、Nuxt がビルドで書き出す JavaScript と CSS です。ファイル名に内容の hash が入っているので、03章と同じく S3 に置いて、長く cache させます。Lambda は起動しません。

それ以外は Lambda に届きます。Lambda の中では Nuxt が HTML を組み立てて返します。そのうち `/me` から下だけは別扱いで、ここが「誰が見ているかで中身が変わるかもしれない場所」です。cache は一切しません。

作るアプリは小さなものです。公開ノートの一覧（`/`）と詳細（`/notes/:id`）、そして自分のページ（`/me`）。

### これは edge rendering ではありません

HTML を組み立てているのは、東京リージョンの Lambda です。CloudFront の edge location ではありません。

CloudFront が前に立っているので、cache に当たった応答は読者の近くから返ります。当たらなければ、リクエストは東京まで行って、Lambda が動いて、戻ってきます。ロンドンの読者が cache にないページを開けば、東京との往復ぶんだけ待ちます。

「CDN の後ろにあるから edge で動いている」とは言えないんです。この本では、これを regional SSR と呼びます。edge で動かせるコードとその制約は [10章](/ja/chapters/10-edge.md)で扱います。

### SSR にしなくていいとき

SSR は、常に SPA より良いわけではありません。Lambda が 1 つ増え、cache の設計が要り、落ちる場所も増えます。

- ログインしないと何も見えないアプリ。検索エンジンに読ませる HTML がないなら、03章と 06章の SPA で足ります
- 内容がビルド時に決まるサイト。HTML を先に全部作って S3 に置けば、Lambda は要りません。この本のサイトがそうです

SSR が効くのは、公開されていて、内容がリクエスト時に決まり、最初の表示や検索エンジン向けの HTML が大事なページです。

## Nuxt を Lambda の形にする

<!-- section: 09.nitro -->

Nuxt のサーバー側は Nitro という別のパッケージが担当しています。Nitro には、出力先に合わせてビルド結果の形を変える preset があって、その 1 つが AWS Lambda 向けです。

版は固定しました。Nuxt は 4.6.1。その Nuxt が使う Nitro は `nitropack` 2.13.4 です。npm には `nitro` という名前で 3 系の beta も出ていますが、Nuxt 4.6.1 が依存しているのは 2 系なので、そちらを読みます。以下は、ドキュメントではなく、固定した版の `nitropack` のソース（`dist/presets/aws-lambda/`）と、実際にビルドした結果で確かめた内容です。

<<< @/examples/09-ssr/nuxt.config.ts{config}

preset の名前は `aws-lambda`。option は `awsLambda.streaming` の 1 つだけです。`nuxt dev` はこの preset を使わず、`nuxt build` のときだけ効きます。

冒頭の `import type {} from "@nuxt/nitro-server"` は、型のための 1 行です。これがないと、Nuxt 4.6.1 の型は `nitro` の中身を「どの版の Nitro かわからない」ものとして扱い、`preset` と書いただけで型エラーになります。入れると、固定した `nitropack` の型で検査されるので、option の名前を打ち間違えれば気づけます。

ビルドするとこうなります。

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

`server/` が、そのまま Lambda に上げるディレクトリです。必要な `node_modules` も Nitro がここへ集めてくれるので、04章のように CDK に bundle させる必要はありません。`public/_nuxt/` が S3 に置くファイルです。

`index.mjs` が export する `handler` には、形が 2 種類あります。

- `streaming: false`（既定）。`handler(event, context)` が、`statusCode`、`headers`、`cookies`、`body` を持つオブジェクトを返します。応答を全部作ってから返す形です
- `streaming: true`。Lambda の Node.js runtime が用意する `awslambda.streamifyResponse` で包まれた handler になり、応答を stream に書き込みます

どちらの形でビルドしたかは、`nitro.json` に残ります。あとで出てくる CDK の stack は、このファイルを読んで Lambda 側の設定を決めます。

<<< @/examples/09-ssr/scripts/lambda-harness.ts{nitro-json}

ビルドの出力は、型の外から来る値です。なので、ここでも schema に通しています。

### Vize はそのまま使えました

`.vue` の compile、型検査、lint は、03章と 06章と同じく Vize です。Nuxt 向けの `@vizejs/nuxt` 0.443.0 を `modules` に足すと、`nuxt dev` と `nuxt build` が Vize で `.vue` を compile します。手元で両方とも動きました。

型検査と lint は、Nuxt の外から `vize check` と `vize lint` を実行します（`typecheck:ssr` と `lint:ssr`）。そのために、`.vue` の中では Nuxt の auto-import に頼らず、`useFetch` などを `nuxt/app` から明示的に import しています。auto-import を使った場合に Vize がどこまで型を追えるかは、確かめていません。

細かい話を 1 つ。`@vizejs/nuxt` 0.443.0 は古い `@nuxt/kit`（3.11.2）に依存していて、install のときに peer dependency の警告が 1 件出ます。ビルドと開発サーバーには影響しませんでした。

## アプリは小さく

<!-- section: 09.app -->

ノートの形は、04章と同じやり方で schema にします。

<<< @/examples/09-ssr/core/notes.ts{note}

一覧のページがこちら。

<<< @/examples/09-ssr/app/pages/index.vue

`useFetch("/api/notes")` は、サーバーで HTML を組み立てているときは、同じプロセスの中の route を直接呼びます。HTTP は通りません。同じコードがブラウザで動くとき（リンクを押して画面を切り替えたとき）は、本物の HTTP リクエストになります。どちらの場合も、返ってきた値を schema に通してから使います。

`/api/notes` の中身は、コードと一緒に配るノートを返すだけです。

<<< @/examples/09-ssr/server/context.ts{context}

ノートを DynamoDB から読まないのは、わざとです。この章の前提は 03章と 04章だけにしたかったのと、04章で見たとおり、Lambda のメモリに書き込むデータは持ち主になれないから。読み取り専用で、コードと一緒に配るものなら、どの実行環境も同じ答えを返します。05章の table から読むように変えるなら、差し替えるのは `notes` の 1 行です。

`core/` には、Nuxt も AWS も知らない TypeScript だけを置いています。判断はここに書いて、ここをテストします。`server/` と `app/` は、それを Nuxt につなぐ薄い層です。
