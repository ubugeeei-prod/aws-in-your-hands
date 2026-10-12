---
title: 03 Static Hosting: private S3 origin と CloudFront
revision: 2
---

# 03 Static Hosting: private S3 origin と CloudFront

道具はそろいました。最初に公開するのは、ブラウザだけで動くノートアプリです。

この章では、Vue、Vite、Vize で作った SPA を手元で動かしてテストし、それを S3 bucket に置いて、CloudFront 経由で HTTPS で公開します。bucket はインターネットから直接は読めないままにします。`/notes/abc` のような client 側の URL を直接開いても動いて、存在しないファイルはちゃんと 404 になる。そして最後に、公開したものが本当に読者へ届いたかを、URL を叩いて確かめます。

前提は [02章](/ja/chapters/02-toolchain.md)です。コードは `examples/03-spa/` にあります。独自ドメインは使いません。CloudFront が発行する `https://dxxxxxxxxxxxx.cloudfront.net` の URL で公開します。

## 全体像

<!-- section: 03.architecture -->

```figure
caption: ブラウザが話す相手は CloudFront だけで、CloudFront が署名付きの要求で S3 bucket のファイルを読みます。
node browser: Browser
node fn: CloudFront Function | viewer-request, "spa-fallback"
node cache: cache
node index: index.html
node js: assets/index-<hash>.js
node css: assets/index-<hash>.css
edge browser -> fn: HTTPS
edge fn -> cache
edge cache -> index: SigV4 (origin access control)
edge cache -> js
edge cache -> css
group cf: CloudFront distribution (edge locations) = fn, cache
group s3: S3 bucket (ap-northeast-1, Block Public Access on) = index, js, css
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

何がどこで動くのか、先に整理しておきましょう。

アプリのコードが動くのは**ブラウザ**です。AWS の上で動くあなたのコードは、十数行の CloudFront Function だけ。S3 はただの保存場所で、Web サーバーとしては使いません。CloudFront は CDN です。世界各地の拠点（edge location）が応答を cache して、読者に近い場所から返します。HTTPS の終端もここです。

言葉を 2 つだけ。CloudFront の設定 1 つ分を distribution、CloudFront が元のファイルを取りに行く先を origin と呼びます。この章の origin は S3 bucket です。

### bucket をそのまま公開しないのはなぜ？

S3 には「静的 Web サイトホスティング」という機能があって、bucket を公開すればそれだけでサイトになります。でも、この本は使いません。理由は 2 つです。その機能の URL は HTTP だけで、HTTPS にはどのみち CloudFront が要ること。そして、bucket を公開する設定は事故のもとだからです。この章では bucket を非公開のままにして、CloudFront だけに読ませます。

とはいえ、別の選択肢のほうが合う場面もあります。

- Git に push するだけで公開したい、preview 環境が欲しい、という要求が中心なら、Cloudflare Pages や Vercel のほうが手数が少ないでしょう。この章の構成は、そうした仕組みを自分で持つ代わりに、あとで API や認証を同じアカウントの中でつなげられます
- server rendering が要るなら [09章](/ja/chapters/09-ssr.md)です。この章の構成は、静的なファイルしか返しません
