---
title: "03 Static Hosting: しくみと実装"
---

# 03 Static Hosting: しくみと実装

## 手元で動かす

<!-- section: 03.app -->

まずは動かしてみましょう。

```bash
vp run dev:spa
```

<http://localhost:5173> が開きます。ノートを書いて保存すると一覧に出ます。ソースを変えれば、画面がすぐ更新されます。AWS の認証情報も課金も要りません。

いまの時点では、ノートはブラウザの localStorage に保存されます。別のブラウザからは見えません。サーバーに保存するのは 04章と 05章です。

ノートの形は schema で定義して、型はそこから導きます。

<<< @/examples/03-spa/src/notes/note.ts{schema}

保存先は interface の後ろに隠してあります。あとで API に差し替えるためです。

<<< @/examples/03-spa/src/notes/store.ts{interface}

localStorage は、型の外にあります。別のタブ、このアプリの古い版、あるいは開発者ツールを開いた利用者が、何を書き込んでいるかわかりません。だから読み出した値は schema に通して、合わないものは捨てます。

<<< @/examples/03-spa/src/notes/store.ts{read}

router は 20 行ほどの関数です。URL の path を、3 つの画面のどれかに対応させます。

<<< @/examples/03-spa/src/router/route.ts{route}

ここで覚えておいてほしいことが 1 つ。`/notes/abc` という path を知っているのは、**ブラウザの中のこのコードだけ**なんです。サーバー側にあるのは `index.html` と `assets/` 以下のファイルだけ。この食い違いを埋めるのが、あとで出てくる SPA fallback です。

### 型検査とテスト

```bash
vp run check
vp run lint:vue
vp run typecheck
vp run typecheck:vue
vp run test:unit
```

`check` は format と lint、`typecheck` は `.ts` ファイルの型検査です。Vue の単一ファイルコンポーネント（`.vue`）は、Vize が受け持ちます。Vize は Rust で書かれた Vue の toolchain で、この SPA では 3 つの役をしています。ビルド時に `.vue` をコンパイルする Vite plugin、`<template>` の中まで見る型検査（`typecheck:vue`）、`<template>` の lint（`lint:vue`）です。`vp run check:all` で全部まとめて走ります。

`lint:vue` は、ノートへのリンクの `:href` について警告を 1 件出します。動的な URL には `javascript:` で始まる値が入り得る、という指摘です。ここでは値が必ず `/notes/` で始まるので、そのままにしています。

テストでは、時刻と ID の生成を外から渡して、結果が実行のたびに変わらないようにしています。storage も `Map` で作った代用品です。確かめているのはこんなことです。

- 新しく保存したノートが一覧の先頭に来る
- タイトルのないノートは保存されない
- storage に入っていた不正な値は、ノートとして扱われない
- 未知の path は一覧画面ではなく「見つからない」になる

## bucket は非公開のまま

<!-- section: 03.bucket -->

ここからは AWS の側です。まず bucket から。

<<< @/examples/03-spa/infra/lib/spa-stack.ts{bucket}

`BLOCK_ALL` は、Block Public Access の 4 つの設定をすべて有効にします。これがあると、あとで誰かがうっかり公開用の bucket policy を付けようとしても、S3 が拒否してくれます。

`removalPolicy` は `DESTROY` にしました。中身はリポジトリからいつでもビルドし直せるからです。利用者がアップロードした画像のように、作り直せないものを入れる bucket では `RETAIN` にします（[07章](/ja/chapters/07-uploads.md)の「本番にするなら」で、もう一度出てきます）。

## /notes/abc を直接開かれたら

<!-- section: 03.fallback -->

読者が `https://.../notes/abc` を直接開く、あるいはその画面で再読み込みする。するとブラウザは、CloudFront に `/notes/abc` を要求します。でも S3 に `notes/abc` という object はありません。何もしなければエラーです。

そこで、ファイルに対応しない URL には `index.html` を返して、あとはブラウザの中の router に任せます。これが SPA fallback です。

よく紹介されるのは、CloudFront の「エラー応答のカスタマイズ」で、403 や 404 を `index.html` と 200 に置き換える方法です。この本は使いません。その設定は**すべての**エラーを置き換えてしまうからです。デプロイで消えた古い JavaScript ファイルを要求したブラウザにも、200 と HTML が返ります。ブラウザはその HTML を JavaScript として実行しようとして失敗し、本当の原因（ファイルが無い）は見えなくなります。

代わりに、リクエストが origin に届く前に URL を書き換えます。

<<< @/examples/03-spa/infra/functions/spa-fallback.js

これは CloudFront Functions という仕組みで動く関数です。edge location で、リクエストごとに実行されます。規則は 1 つだけ。path の最後の部分に `.` が無ければ `/index.html` に書き換える。`.` があればファイルの要求とみなして、何もしない。存在しないファイルは、そのまま S3 まで届いて 404 になります。

CloudFront Functions は、できることをわざと絞った実行環境です。公式ドキュメントによれば、ネットワーク、ファイルシステム、環境変数、タイマーは使えず、リクエストの body は読めず、実行時間にも上限があります。Node.js ではありません。この関数のような、ヘッダーや URL の小さな書き換えのためのものです。Cloudflare Workers の代わりになるものではないので、そこは混ぜないでくださいね。

テストは、デプロイするファイルそのものを読み込んで実行します。

```bash
vp run test:unit
```

`examples/03-spa/infra/test/spa-fallback.test.ts` が、client 側の URL が `index.html` になること、ファイルの URL が変わらないこと、存在しない asset が `index.html` に化けないことを確かめます。ただ、実行しているのは Node.js です。CloudFront Functions の実行環境の制限（使える構文、サイズ、実行時間）までは、このテストでは確かめられません。

## distribution を定義する

<!-- section: 03.distribution -->

<<< @/examples/03-spa/infra/lib/spa-stack.ts{distribution}

この章の主役は `origins.S3BucketOrigin.withOriginAccessControl` です。origin access control（OAC）は、CloudFront が S3 へのリクエストに署名して、bucket がその distribution からの要求だけを許可する仕組み。CDK はこの 1 行から、OAC のリソースと、次のような bucket policy を作ります。

- 許可する相手は CloudFront というサービス（`cloudfront.amazonaws.com`）
- ただし、要求元がこの distribution であるときに限る（`AWS:SourceArn` の条件）

他人の distribution があなたの bucket を origin に指定しても、この条件に合わないので読めません。

`originAccessLevels` に `LIST` を足しているのは、エラーの種類のためです。S3 は、object が存在しないとき、要求した側に bucket の一覧を取る権限（`s3:ListBucket`）があれば 404 を、無ければ 403 を返します。権限が無い相手に「その名前のファイルは無い」と教えないためです。`LIST` を許可すると、存在しないファイルが正しく 404 になります。「一覧を取られてしまうのでは？」と思うかもしれませんが、fallback の関数がファイル以外の URL をすべて `/index.html` に書き換えるので、読者が一覧そのものを取得できる URL はありません。

`viewerProtocolPolicy` は、HTTP で来た読者を HTTPS へ転送します。

`cachePolicy` と `responseHeadersPolicy` は、AWS が用意している管理ポリシーです。前者は cache の動作を、後者はセキュリティ関連の応答ヘッダーを決めます。個々のファイルをどれだけ cache するかは、公開時に付ける `Cache-Control` ヘッダーで決めます（このあと出てきます）。

テストは、template に対して次を確かめます。

- bucket が非公開で、Web サイトホスティングが無効である
- bucket を読めるのはこの distribution だけである
- HTTPS のみで、fallback の関数が付いている
- エラー応答の置き換えを使っていない

最後の検査は、将来だれかが「よくある方法」に戻すのを防ぐためのものです。
