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

## デプロイする

<!-- section: 03.deploy -->

`.env` の設定と `vp run infra:bootstrap` は、02章で済んでいる前提です。

```bash
vp run spa:infra:diff
vp run spa:infra:deploy
```

distribution の作成は、API が応答したあとも、各地の edge location への反映が続きます。この本の deploy タスクは cdkd に `--full-wait` を渡して、反映が終わるまで待ちます。どれだけかかるかは計測していません。

終わると、`DistributionDomainName` に `dxxxxxxxxxxxx.cloudfront.net` の形のドメイン名が出ます。この時点では bucket は空っぽです。開いても何も表示されません。

正直に言うと、ここから先の AWS に触るタスクは、まだ実際のアカウントで通せていません。内訳は章末のメモにまとめてあります。

### インフラを作るのと、中身を公開するのは別の作業

ここが、Cloudflare Pages や Vercel と手触りの違うところです。

- インフラの作成・変更は `spa:infra:deploy`。変えるのは bucket、distribution、関数で、やるのはまれです
- 内容の公開は `spa:publish`。変えるのは bucket の中の object で、変更のたびにやります

`spa:infra:deploy` を実行しても、アプリの新しい版は公開されません。逆に `spa:publish` は、bucket や distribution の設定には触れません。分けておくと、内容だけを素早く更新できて、インフラの管理者は cdkd だけになります。

## 公開する

<!-- section: 03.publish -->

```bash
vp run spa:publish:plan
vp run spa:publish
```

`spa:publish:plan` は、何をアップロードして何を消すかを表示するだけで、何も変えません。実行するのは `spa:publish` です。どちらも先に `vp run build:spa` を行います。

公開の処理は、「何をするか決める部分」と「実行する部分」に分けてあります。前者は純粋な関数なので、AWS なしでテストできます。

### cache の方針

<<< @/tools/src/site/plan.ts{cache}

Vite は、`assets/` 以下のファイル名に内容のハッシュを入れます。内容が変われば名前が変わるので、同じ URL の内容は永久に変わりません。だから 1 年間 cache させて、再確認もさせません。

`index.html` は名前が変わりません。これを長く cache させると、新しい版を公開しても、読者には古い `index.html` が届き続けます。そこで「cache してよいが、使う前に必ず origin に確かめよ」と指示します。CloudFront はこの確認を S3 への条件付きリクエストとして行い、変わっていなければ本体を転送しません。

この方針のおかげで、通常の公開では **cache の無効化（invalidation）が要りません**。invalidation は、edge の cache を期限前に捨てさせる操作です。誤ったヘッダーで公開してしまったときの復旧用に `vp run spa:invalidate` を用意していますが、ふだんは使いません。

### 順番には意味がある

公開は次の順で行います。

1. ハッシュ付きの asset をアップロードする
2. `index.html` などをアップロードする
3. ビルドに含まれなくなったページを消す
4. いまのビルドに含まれず、アップロードから 30 日以上経った asset を消す
5. どのリビジョンを公開したかを記録した `aih-revision.json` を置く

1 と 2 が逆だとどうなるでしょう。新しい `index.html` が、まだ存在しない JavaScript を指す瞬間ができてしまいます。

古い asset をすぐ消さないのも、同じ理由です。公開の直前にページを開いた読者は、古い `index.html` を持っています。その読者があとで画面を切り替えると、古い asset が要求されます。

途中で失敗しても、もう一度実行すれば続きから進みます。内容が同じファイルはアップロードを省くからです。1 の途中で止まった場合、bucket には誰からも参照されないファイルが増えるだけで、公開中のサイトは変わりません。

これ、小さな分散システムなんです。bucket、各地の edge の cache、読者のブラウザは、それぞれ別の時点の内容を持っています。全員が同時に新しい版へ切り替わる瞬間はありません。守っている invariant は「読者が手にしている `index.html` が指すファイルは、必ず取得できる」です。

## 届いたことを確かめる

<!-- section: 03.smoke -->

```bash
vp run spa:smoke
```

コマンドが成功で終わったことは、読者に届いたことの証明にはなりません。このタスクは、公開した URL を実際に取得して確かめます。

- `/` が HTML を返し、再確認を求める `Cache-Control` が付いている
- `/notes/aih-smoke-deep-link` が、アプリの `index.html` を返す
- `/assets/aih-smoke-missing.js` が 404 になる（HTML と 200 ではない）
- ハッシュ付きの asset に、1 年間の `Cache-Control` が付いている
- HTTP で開くと HTTPS に転送される
- `aih-revision.json` のリビジョンが、手元の commit と一致する

最後の検査が、「CloudFront に反映された」ことの確認です。一致するまで 15 秒おきに再試行して、10 分で打ち切ります。

## drift を確かめる

```bash
vp run spa:infra:drift
```

02章と同じ gate です。1 つだけ気にしておきたいことがあります。この stack には `AWS::CloudFront::Function` が含まれていて、固定した版の cdkd は、この種類のリソースを専用の実装ではなく Cloud Control API 経由で扱います。読み戻しの結果がどうなるかは、実際の AWS で確かめていません。`unsupported` や `incomplete` が出た場合、gate は不合格（終了コード 11）にします。それは「drift がある」ではなく、「確かめられなかった」という意味です。

## お金の話

料金は 3 つの状態に分けて考えます。金額は USD、東京リージョンの S3 と日本の edge の CloudFront、従量課金、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

まず、使われていないとき。distribution には、存在するだけでかかる料金はありません。かかるのは S3 の保存量だけです。ビルド出力は 1 MB に満たないので、定価でも月 USD 0.01 未満です。

使われると、次のものに比例してかかります。

| 対象 | 単価（定価） | 毎月の無料枠 |
| --- | --- | --- |
| CloudFront から読者への転送量 | 1 GB あたり USD 0.114（最初の 10 TB） | 1 TB |
| CloudFront への HTTPS リクエスト | 1 万件あたり USD 0.012 | 1,000 万件 |
| CloudFront Functions の実行 | 100 万回あたり USD 0.10 | 200 万回 |
| S3 への GET（cache に無かったとき） | 1 万件あたり USD 0.0037 | 確認できず。0 として扱わない |

CloudFront の無料枠は従量課金の場合のもので、アカウント全体で共有されます。S3 から CloudFront への転送には料金がかかりません。

同じ構成の「本のサイト」について、月 2 万ページビューを仮定した計算例が[料金の計算](/ja/reference/pricing.md)にあります。定価で月 USD 0.50 前後、CloudFront の無料枠を引くと USD 0.03 前後です。これは仮定を置いた例で、あなたのアプリの見積もりではありません。

公開するときにも少しかかります。S3 への PUT は 1,000 件あたり USD 0.0047。invalidation は月 1,000 path まで無料で、以降は 1 path あたり USD 0.005 です。

この計算に入っていないものもあります。アクセスログ、AWS WAF、独自ドメイン（Route 53）は使っていないので 0 です。足せば料金が発生します。

ちなみに CloudFront には、従量課金のほかに月額固定のプランもあります（確認日の時点で Free、Pro、Business、Premium）。プランごとに使える機能が違い、CDK からの指定方法も確認していないので、この本のサンプルは従量課金のままです。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| 開くと `AccessDenied` の XML が出る | bucket が空ではないですか（`spa:publish` をしましたか）。distribution の反映は終わっていますか |
| 新しい版を公開したのに古い画面が出る | `spa:smoke` のリビジョンは一致しますか。一致するなら、ブラウザ側の cache です。`index.html` に `max-age=0` が付いているかも確認 |
| `/notes/abc` を直接開くとエラーになる | distribution に fallback の関数が付いていますか（`spa:infra:diff` で差が無いか） |
| 画面が真っ白で、コンソールに JavaScript の構文エラーが出る | asset の要求に HTML が返っていませんか。`spa:smoke` の「missing asset」の検査を見る |
| `spa:publish` が bucket 名を取得できない | `spa:infra:deploy` は成功していますか。別のアカウントやリージョンを見ていませんか |

## 本番にするなら

- **独自ドメインと証明書を付ける。** Route 53 と ACM を使います。証明書は `us-east-1` に作る必要があります。この本ではまだ扱っていません
- **アクセスログを残す。** 誰がいつ何を要求したかの記録です。保存量に料金がかかります（ログの料金と保持期間の考え方は [19章](/ja/chapters/19-observability.md)）
- **AWS WAF を検討する。** 料金がかかるので、守るものができてからで構いません（[21章](/ja/chapters/21-security.md)）
- **Content-Security-Policy を設定する。** 管理ポリシーの `SECURITY_HEADERS` には含まれません。アプリに合わせた応答ヘッダーポリシーを自分で定義します
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです
- **公開を CI から行う。** 人の端末からではなく、期限の短い認証情報で実行します（鍵を置かずに CI から AWS に入る方法は [20章](/ja/chapters/20-shipping.md)）

## 片付け

<!-- section: 03.cleanup -->

```bash
vp run spa:unpublish --yes
vp run spa:infra:destroy
```

先に bucket を空にします。固定した版の cdkd は、空でない bucket を消せずに失敗するからです。`--yes` を付けずに実行すると、消す対象の数を表示するだけで、何も消しません。

distribution の削除には時間がかかります。削除の前に、すべての edge で配信を止める必要があるからです。

消したあとに残るのは、cdkd の bootstrap で作った 3 つの保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。それ以外には残りません。この章の stack はログを作りません。

## 本のサイトとはここが違う

<!-- section: 03.book-site -->

実は、この本のサイトも、同じ「非公開の S3 と CloudFront」で配信しています。ただ、URL の扱いが違います。

| | この章の SPA | 本のサイト |
| --- | --- | --- |
| HTML の数 | 1 つ（`index.html`） | ページごとに 1 つ |
| ファイルに対応しない URL | `index.html` を返す | 404 のページを 404 として返す |
| 関数がすること | client 側の URL を `/index.html` に書き換える | `/ja/chapters/03-spa/` を `/ja/chapters/03-spa/index.html` に書き換える |

本のサイトに SPA fallback を使うと、リンク切れがすべてトップページとして表示されて、壊れていることに気づけなくなります。同じ部品でも、何を配るかで正しい設定が変わるんですね。本のサイトの実装は[本のサイトを再現する](/ja/reference/book-site.md)にあります。

::: details この章の検証メモ

**手元で確かめたこと。** SPA の起動、型検査、ユニットテスト、ビルド、CDK の synth と assertion、公開計画と smoke の検査定義のテスト。

**まだ確かめていないこと。** `spa:infra:deploy`、`spa:publish`、`spa:smoke`、`spa:infra:drift`、`spa:unpublish`、`spa:infra:destroy` は、実際の AWS アカウントでは実行していません。とくに、cdkd が `AWS::CloudFront::Function` を作成・読み戻しできること、`cdkd state show` の出力から stack の output を読む処理が実際の出力の形に合っていることは、実環境での確認待ちです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 手元で動かす | `examples/03-spa/src/`、`examples/03-spa/index.html`、`examples/03-spa/vite.config.ts` | `dev:spa`、`lint:vue`、`typecheck:vue`、`test:unit`、`build:spa`、`preview:spa` |
| bucket は非公開のまま、distribution を定義する | `examples/03-spa/infra/lib/spa-stack.ts`、`examples/03-spa/infra/bin/app.ts`、`examples/03-spa/infra/test/spa-stack.test.ts`、`examples/03-spa/cdk.json` | `spa:infra:synth`、`test:unit` |
| /notes/abc を直接開かれたら | `examples/03-spa/infra/functions/spa-fallback.js`、`examples/03-spa/infra/test/spa-fallback.test.ts` | `test:unit` |
| デプロイする | `tools/src/infra/` | `spa:infra:diff`、`spa:infra:deploy`、`spa:infra:drift` |
| 公開する | `tools/src/site/plan.ts`、`tools/src/site/plan.test.ts`、`tools/src/site/publish.ts`、`tools/src/site/bucket.ts`、`tools/src/site/revision.ts`、`tools/src/site/invalidate.ts`、`tools/src/infra/outputs.ts` | `spa:publish:plan`、`spa:publish`、`spa:invalidate` |
| 届いたことを確かめる | `tools/src/site/smoke-spec.ts`、`tools/src/site/smoke-spec.test.ts`、`tools/src/site/smoke.ts` | `spa:smoke` |
| 片付け | `tools/src/site/unpublish.ts` | `spa:unpublish`、`spa:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Restrict access to an Amazon S3 origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Amazon S3 API: GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)、[Amazon CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/)
- AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json)、[S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
