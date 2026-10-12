---
title: "03 Static Hosting: デプロイ"
---

# 03 Static Hosting: デプロイ

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
