---
title: 03 Static Hosting: private S3 origin と CloudFront
revision: 2
---

# 03 Static Hosting: private S3 origin と CloudFront

道具がそろったので、最初のアプリを公開します。ブラウザだけで動くノートアプリです。

この章では、Vue、Vite、Vize で作った SPA を手元で動かしてテストし、S3 バケットに置いて、CloudFront 経由の HTTPS で公開します。バケットは、インターネットから直接は読めないままにします。`/notes/abc` のようなクライアント側の URL を直接開いてもアプリが表示され、存在しないファイルには 404 が返るようにします。最後に、公開した URL を実際に取得して、内容が読者に届いたことを確かめます。

前提は [02章](/ja/chapters/02-toolchain.md)です。コードは `examples/03-spa/` にあります。独自ドメインは使わず、CloudFront が発行する `https://dxxxxxxxxxxxx.cloudfront.net` の URL で公開します。

## 全体像

<!-- section: 03.architecture -->

```figure
caption: ブラウザが通信する相手は CloudFront だけで、CloudFront が署名付きのリクエストで S3 バケットのファイルを読みます。
node browser: Browser
node fn: CloudFront Function | viewer-request, "spa-fallback"
node cache: キャッシュ
node index: index.html
node js: assets/index-<hash>.js
node css: assets/index-<hash>.css
edge browser -> fn: HTTPS
edge fn -> cache
edge cache -> index: SigV4 (origin access control)
edge cache -> js
edge cache -> css
group cf: CloudFront ディストリビューション (エッジロケーション) = fn, cache
group s3: S3 バケット (ap-northeast-1, Block Public Access on) = index, js, css
```

```figure
caption: spa-fallback の関数は /notes/abc を /index.html に書き換え、/assets/app-1a.js はそのままにします。
direction: right
node screen: /notes/abc
node file: /assets/app-1a.js
node rewritten: /index.html
node same: そのまま
edge screen -> rewritten: spa-fallback
edge file -> same: spa-fallback
```

アプリのコードが動くのは**ブラウザ**です。AWS の上で動く自分のコードは、十数行の CloudFront Function だけです。S3 はファイルの保存場所として使い、Web サーバーとしては使いません。CloudFront は CDN で、世界各地の拠点であるエッジロケーション（edge location）がレスポンスをキャッシュし、読者に近い場所から返します。HTTPS の終端も CloudFront が受け持ちます。

用語を 2 つ覚えておいてください。CloudFront の設定 1 つ分をディストリビューション（distribution）、CloudFront が元のファイルを取りに行く先をオリジン（origin）と呼びます。この章のオリジンは S3 バケットです。

### バケットをそのまま公開しない理由

S3 には「静的 Web サイトホスティング」という機能があり、バケットを公開するだけでサイトになります。この本がその機能を使わない理由は 2 つあります。1 つは、その機能の URL が HTTP だけで、HTTPS にするにはどのみち CloudFront が要ることです。もう 1 つは、バケットを公開する設定が事故のもとになることです。そこでこの章では、バケットを非公開のままにして、CloudFront だけに読ませます。

ただし、別の選択肢のほうが合う場面もあります。

- Git に push するだけで公開したい、プレビュー環境が欲しい、といった要求が中心なら、Cloudflare Pages や Vercel のほうが手数は少ないでしょう。この章の構成では、そうした仕組みを自分で用意することになりますが、その代わりに、あとで API や認証を同じアカウントの中でつなげられます
- サーバーサイドレンダリングが必要なら [09章](/ja/chapters/09-ssr.md)へ進んでください。この章の構成は、静的なファイルしか返しません
