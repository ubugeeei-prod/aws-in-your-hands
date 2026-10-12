---
title: "03 Static Hosting: しくみと実装"
---

# 03 Static Hosting: しくみと実装

このページでは、まず SPA を手元で動かし、そのあとで AWS 側のバケット、URL を書き換える関数、ディストリビューションの定義を順に見ていきます。

## 手元で動かす

<!-- section: 03.app -->

```bash
vp run dev:spa
```

<http://localhost:5173> が開きます。ノートを書いて保存すると一覧に表示され、ソースを変えると画面がすぐに更新されます。AWS の認証情報は要らず、料金もかかりません。

この時点では、ノートはブラウザの localStorage に保存されるので、別のブラウザからは見えません。サーバーに保存するようにするのは 04章と 05章です。

ノートの形はスキーマで定義し、型はスキーマから導いています。

<<< @/examples/03-spa/src/notes/note.ts{schema}

保存先は、あとで API に差し替えられるように、インターフェースの後ろに隠してあります。

<<< @/examples/03-spa/src/notes/store.ts{interface}

localStorage の中身は、型で守られていません。別のタブ、このアプリの古い版、開発者ツールを開いた利用者が、何を書き込んでいるかわからないからです。そのため、読み出した値はスキーマと照合し、合わないものは捨てます。

<<< @/examples/03-spa/src/notes/store.ts{read}

ルーターは 20 行ほどの関数で、URL のパスを 3 つの画面のどれかに対応させます。

<<< @/examples/03-spa/src/router/route.ts{route}

ここで大事なのは、`/notes/abc` というパスを知っているのが、**ブラウザの中のこのコードだけ**だという点です。サーバー側にあるのは、`index.html` と `assets/` 以下のファイルだけです。この食い違いは、このページの後半で説明する SPA フォールバックで埋めます。

### 型検査とテスト

```bash
vp run check
vp run lint:vue
vp run typecheck
vp run typecheck:vue
vp run test:unit
```

`check` は format と lint、`typecheck` は `.ts` ファイルの型検査です。Vue の単一ファイルコンポーネント（`.vue`）は Vize が受け持ちます。Vize は Rust で書かれた Vue のツールチェーンで、この SPA では 3 つの役割を担っています。ビルド時に `.vue` をコンパイルする Vite プラグイン、`<template>` の中まで調べる型検査（`typecheck:vue`）、`<template>` の lint（`lint:vue`）です。`vp run check:all` を実行すると、これらがまとめて走ります。

`lint:vue` は、ノートへのリンクの `:href` について警告を 1 件出します。動的な URL には `javascript:` で始まる値が入り得る、という指摘です。このアプリでは値が必ず `/notes/` で始まるので、そのままにしています。

テストでは、時刻と ID の生成を外から渡して、結果が実行のたびに変わらないようにしています。ストレージも `Map` で作った代用品です。テストが確かめているのは次のことです。

- 新しく保存したノートが一覧の先頭に来る
- タイトルのないノートは保存されない
- ストレージに入っていた不正な値は、ノートとして扱われない
- 未知のパスは、一覧画面ではなく「見つからない」画面になる

## バケットは非公開のまま

<!-- section: 03.bucket -->

ここからは AWS 側の定義です。最初はバケットです。

<<< @/examples/03-spa/infra/lib/spa-stack.ts{bucket}

`BLOCK_ALL` は、Block Public Access の 4 つの設定をすべて有効にします。有効にしておくと、あとで誰かが誤って公開用のバケットポリシーを付けようとしても、S3 が拒否します。

`removalPolicy` を `DESTROY` にしたのは、中身をリポジトリからいつでもビルドし直せるからです。利用者がアップロードした画像のように、作り直せないものを入れるバケットでは `RETAIN` にします。`RETAIN` は、[07章](/ja/chapters/07-uploads/wrap.md)で本番向けの変更としてもう一度取り上げます。

## /notes/abc を直接開いたとき

<!-- section: 03.fallback -->

読者が `https://.../notes/abc` を直接開いたり、その画面で再読み込みしたりすると、ブラウザは CloudFront に `/notes/abc` を要求します。しかし、S3 に `notes/abc` というオブジェクトはないので、何もしなければエラーになります。

そこで、ファイルに対応しない URL には `index.html` を返し、その先の処理をブラウザの中のルーターに任せます。この仕組みを SPA フォールバック（SPA fallback）と呼びます。

よく紹介されるのは、CloudFront の「エラー応答のカスタマイズ」で、403 や 404 を `index.html` と 200 に置き換える方法です。この本がその方法を使わないのは、**すべての**エラーが置き換わってしまうからです。たとえば、デプロイで消えた古い JavaScript ファイルを要求したブラウザにも、200 と HTML が返ります。ブラウザはその HTML を JavaScript として実行しようとして失敗し、ファイルが無いという本当の原因は見えなくなります。

この本では代わりに、リクエストがオリジンに届く前に URL を書き換えます。

<<< @/examples/03-spa/infra/functions/spa-fallback.js

この関数は CloudFront Functions という仕組みで動き、エッジロケーションでリクエストごとに実行されます。規則は 1 つだけです。パスの最後の部分に `.` が無ければ `/index.html` に書き換え、`.` があればファイルの要求とみなして何もしません。存在しないファイルへの要求は、そのまま S3 まで届いて 404 になります。

CloudFront Functions は、できることを意図的に絞った実行環境です。公式ドキュメントによると、ネットワーク、ファイルシステム、環境変数、タイマーは使えず、リクエストのボディは読めず、実行時間にも上限があります。Node.js でもありません。この関数のように、ヘッダーや URL を少し書き換えるための仕組みであり、Cloudflare Workers の代わりになるものではありません。

テストは、デプロイするファイルそのものを読み込んで実行します。

```bash
vp run test:unit
```

`examples/03-spa/infra/test/spa-fallback.test.ts` は、クライアント側の URL が `index.html` になること、ファイルの URL が変わらないこと、存在しないアセットへの要求が `index.html` に書き換わらないことを確かめます。ただし、テストを実行しているのは Node.js です。使える構文、サイズ、実行時間といった CloudFront Functions の実行環境の制限は、このテストでは確かめられません。

## ディストリビューションを定義する

<!-- section: 03.distribution -->

<<< @/examples/03-spa/infra/lib/spa-stack.ts{distribution}

この定義の中心は `origins.S3BucketOrigin.withOriginAccessControl` です。origin access control（OAC）は、CloudFront が S3 へのリクエストに署名し、バケットがそのディストリビューションからのリクエストだけを許可する仕組みです。CDK はこの 1 行から、OAC のリソースと、次の内容のバケットポリシーを作ります。

- 許可する相手は CloudFront というサービス（`cloudfront.amazonaws.com`）
- ただし、リクエストの送り元がこのディストリビューションであるときに限る（`AWS:SourceArn` の条件）

他人のディストリビューションが自分のバケットをオリジンに指定しても、この条件に合わないので読めません。

`originAccessLevels` に `LIST` を足しているのは、存在しないファイルに 404 を返すためです。S3 は、オブジェクトが存在しないとき、要求した側にバケットの一覧を取る権限（`s3:ListBucket`）があれば 404 を、無ければ 403 を返します。権限の無い相手に、その名前のファイルが無いことを教えないためです。`LIST` を許可すると、存在しないファイルが 404 になります。一覧を取る権限を与えても、フォールバックの関数がファイル以外の URL をすべて `/index.html` に書き換えるので、読者が一覧そのものを取得できる URL はありません。

`viewerProtocolPolicy` は、HTTP で来た読者を HTTPS へ転送します。

`cachePolicy` と `responseHeadersPolicy` には、AWS が用意している管理ポリシーを指定しています。`cachePolicy` はキャッシュの動作を、`responseHeadersPolicy` はセキュリティ関連のレスポンスヘッダーを決めます。個々のファイルをどれだけキャッシュさせるかは、公開時に付ける `Cache-Control` ヘッダーで決めます。このヘッダーは[デプロイのページ](/ja/chapters/03-spa/deploy.md)の「キャッシュの方針」で説明します。

テストは、テンプレートに対して次のことを確かめます。

- バケットが非公開で、Web サイトホスティングが無効である
- バケットを読めるのはこのディストリビューションだけである
- HTTPS のみで、フォールバックの関数が付いている
- エラー応答の置き換えを使っていない

最後の検査は、将来だれかが、よく紹介される方法に戻してしまうのを防ぐためのものです。
