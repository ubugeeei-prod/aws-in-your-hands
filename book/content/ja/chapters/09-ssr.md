---
title: "09 SSR と BFF: Nuxt をリージョンの Lambda で動かす"
revision: 1
---

# 09 SSR と BFF: Nuxt をリージョンの Lambda で動かす

03章では、できあがった HTML と JavaScript を S3 に置いて配りました。04章では、リクエストのたびに動く関数を Lambda にのせました。この章はその 2 つを合わせます。Nuxt のアプリを Lambda で動かして、リクエストごとに HTML を組み立てて返します。server-side rendering（SSR）です。

動かすだけなら、そこまで難しくありません。難しいのは cache です。CloudFront は 1 つの応答を保存して、次に来た人にも同じものを返します。公開ページならそれで速くなる。でも、ログイン中の人のページでそれをやると、他人のページが届きます。この章の半分は、その事故を起こさない作りの話です。

前提は [03章](/ja/chapters/03-spa.md)と [04章](/ja/chapters/04-http-api.md)です。コードは `examples/09-ssr/` にあります。時間で課金されるリソースは作りません。

## 全体像

<!-- section: 09.architecture -->

```text
Browser
  |  HTTPS
  v
CloudFront distribution (edge locations)
  |- /_nuxt/*        -> S3 bucket (private, OAC)      hashed JS and CSS
  |- /me, /me/*      -> Lambda function URL (OAC)     never cached, cookies forwarded
  `- everything else -> Lambda function URL (OAC)     cached only if the response allows it, cookies dropped
                          |
                          v
                 Lambda function (ap-northeast-1, Node.js 24, arm64, 512 MB, timeout 10 s)
                   Nitro handler: Nuxt renders pages, server routes answer /api/* and /me/*
                          |
                          v
                 CloudWatch Logs (kept 7 days)
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

## CloudFront から Lambda へ

<!-- section: 09.connect -->

04章では、Lambda の前に API Gateway の HTTP API を置きました。今回は CloudFront が前にいます。CloudFront から Lambda へ、どうつなぎましょう。候補は 2 つあります。

| | Lambda function URL | API Gateway HTTP API |
| --- | --- | --- |
| 追加料金 | なし（Lambda の料金だけ） | リクエストごと（04章） |
| CloudFront 以外からの呼び出しを断る | origin access control で署名を必須にできる | 標準の仕組みはない。自前の header などで工夫する |
| response streaming | あり | なし（04章の表のとおり。REST API にはある） |
| JWT authorizer、throttling、route ごとの設定 | なし | あり |
| ブラウザからの POST | origin access control と組むと、そのままでは通らない（後述） | 通る |

function URL は、Lambda の関数 1 つに付く専用の HTTPS endpoint です。この章はこちらを選びました。理由は、公開ページを返すだけなら API Gateway の機能が要らないこと、そして「CloudFront を通らないリクエストは Lambda が断る」を IAM で書けることです。

逆に、ブラウザから POST を受けたい、JWT を入口で検証したい、流量を route ごとに絞りたい、となったら API Gateway を選び直す場面です。

### 関数

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{function}

04章との違いは `code` です。`NodejsFunction` ではなく、Nitro が作った `.output/server` をそのまま渡します。実行 role は 04章と同じで、自分の log group に書く権限だけ。

`timeout` は 10 秒にしました。CloudFront が origin の応答を待つのは、既定で 30 秒です。それより長く動かしても、受け取る相手がいません。

### function URL を公開のままにしない

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{url}

function URL には `AuthType` があって、`NONE` にすると、URL を知っている人は誰でも関数を呼べます。CloudFront を迂回できてしまうので、cache の設定も、あとで足す WAF も意味がなくなります。

ここでは `AWS_IAM` にしています。署名のないリクエストは、関数が動く前に Lambda が 403 で断ります。そして CloudFront の origin access control（OAC）が、origin へ送るリクエストに署名を付けます。03章で S3 に使った仕組みの Lambda 版です。

CDK の `FunctionUrlOrigin.withOriginAccessControl` は、関数の resource policy に 2 つの許可を足します。`lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` で、どちらも相手は `cloudfront.amazonaws.com`、条件はこの distribution の ARN です。2025年10月以降に作る function URL は、この両方が要ります。テストは、許可がこの 2 つだけであること、`Principal` が `*` の許可が 1 つもないことを見ています。

ここで 1 つ、あとに響く制約があります。OAC を使う場合、POST や PUT のリクエストは、送る側が本文の SHA-256 を `x-amz-content-sha256` ヘッダーに入れておく必要があります。ふつうの HTML の form はそんなヘッダーを付けません。なので、この stack は GET と HEAD だけを通す設定にして、POST は CloudFront の手前で断ります。

### ビルドの形と合わせる

<<< @/examples/09-ssr/infra/bin/app.ts{app}

function URL の `InvokeMode` は、handler の形と対になる設定です。`BUFFERED` は応答を全部受け取ってから返す呼び方、`RESPONSE_STREAM` は stream で受け取る呼び方。ここを人が 2 か所で合わせるのはやめて、stack が `nitro.json` を読むことにしました。ビルドした形が、そのまま設定になります。

食い違ったときに何が起きるかは、AWS のドキュメントには書かれておらず、実機でも確かめていません。だからこそ、食い違えない作りにしています。

## cache の境界

<!-- section: 09.cache -->

ここからが本題です。まず、起こしたくない事故を具体的に。

1. Alice がログインして `/me` を開く。Lambda が「Alice さんのページ」を組み立てて返す
2. CloudFront が、その応答を `/me` の答えとして保存する
3. Bob が `/me` を開く。CloudFront は Lambda に聞かずに、保存してあった Alice のページを返す

CloudFront は、何も設定しなければ cookie を見ません。cookie だけが違う 2 つのリクエストを、同じものとして扱います。だから 3 が起きます。

守りたいことを 1 文にします。

**誰かの cookie や `Authorization` を見て作った応答は、共有 cache に入らない。**

これを 1 か所で守ろうとすると、そこを間違えた瞬間に漏れます。なので 3 層にしました。

### 1 層目: path で分ける

<<< @/examples/09-ssr/core/routes.ts{routes}

個人ごとに変わるものは、全部 `/me` の下に置きます。ルールはこれだけです。この定義を、アプリも CDK の stack も import します。「アプリは `/account` も個人用だと思っているのに、CloudFront は知らない」が起きないように。

### 2 層目: 公開側には cookie を届けない

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{public-policy}

`/me` 以外に使う cache policy です。`cookieBehavior` と `headerBehavior` が `none`。CloudFront では、cache key に入れなかった値は origin にも送られません。つまり公開ページを組み立てる Lambda には、cookie がそもそも届きません。

これが効きます。cookie が届かなければ、Lambda は誰が見ているのか知りようがない。知らないものは、HTML に書けません。将来だれかが公開ページに「こんにちは、Alice さん」と出すコードを足しても、動くのは手元だけで、CloudFront を通すと名前が出ない。事故が「漏れる」ではなく「表示されない」の側に倒れます。

TTL の 3 つの数字にも意味があります。

- `minTtl` は 0。これが 1 以上だと、origin が `Cache-Control: private, no-store` を返しても、CloudFront はその秒数だけ cache します。ドキュメントに警告として書かれている動きです
- `defaultTtl` も 0。`Cache-Control` が付いていない応答は cache されません
- `maxTtl` は 60 秒。アプリが間違って長い時間を指定しても、ここで頭打ちになります

もう 1 つ、`Set-Cookie` です。CloudFront は、origin が返した `Set-Cookie` を応答と一緒に cache して、cache に当たった全員に同じ cookie を配ることがあります。session の cookie でそれが起きたら、全員が同じ人としてログインします。公開側の response headers policy で `Set-Cookie` を取り除いているのは、そのためです。

そして `/me` の側。

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{personal}

`CACHING_DISABLED` は、cache を無効にする managed policy です。アプリがどんなヘッダーを返しても、`/me` の下は保存されません。cookie を Lambda へ届けるのは、ここだけです。

この 2 種類の behavior を distribution に並べます。

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{distribution}

### 3 層目: アプリも自分で言う

CloudFront の設定だけに頼りません。アプリも、応答ごとに「これは共有していい」「これはだめ」をヘッダーで言います。手元の開発サーバーや、将来 CloudFront の前後に入る別の cache にも通じるのは、このヘッダーだけだからです。

<<< @/examples/09-ssr/core/cache-control.ts{values}

共有していいときの値は `public, max-age=0, s-maxage=60`。ブラウザは毎回 CloudFront に聞き直し（`max-age=0`）、CloudFront は 60 秒まで自分で答えてよい（`s-maxage=60`）、という意味です。

<<< @/examples/09-ssr/core/cache-control.ts{decide}

共有を許すのは、最後の 1 行に届いた応答だけ。GET か HEAD で、`/me` の外で、リクエストに cookie も `Authorization` もなく、応答が cookie を設定せず、status が 200 のもの。どれか 1 つでも外れたら `private, no-store` です。

cookie は、名前を見ていません。何の cookie でも、付いていたら共有しません。「session の cookie のときだけ」と書くと、cookie の名前を変えた日に穴が開くので。

これを Nitro の plugin で全部の応答に付けます。

<<< @/examples/09-ssr/server/plugins/cache-control.ts{plugin}

hook が 2 つあるのがポイントです。リクエストが来た時点で、まず `private, no-store` を付けてしまう。handler が終わったあとで、条件を満たしたものだけ `public` に書き換える。途中で例外が出て 2 つ目の hook が動かなくても、残るのは「共有しない」のほうです。

### 実際にひっかかったこと

`isInternalPath` という、ちょっと不思議な条件があります。これは、テストに教えてもらいました。

存在しないノートを開くと、Nuxt は 404 のエラーページを返します。そのとき Nuxt は、サーバーの中で `/__nuxt_error` という path をもう一度呼んでエラーページを組み立て、その内側の応答のヘッダーを、外側の本物の応答に写します。内側のリクエストは「cookie のない GET で、status は 200」。最初に書いたコードは、これを公開ページだと判定して、404 の応答に `public, s-maxage=60` を付けていました。

ビルドした handler を実際に呼ぶ検査（あとで出てくる `ssr:check:output`）が、これを見つけました。判断を純粋関数に切り出してテストしていても、フレームワークがその関数をいつ、何回呼ぶかは、動かしてみないとわからない。その例です。

### 漏れを、決まった順序で再現する

`test/support/shared-cache.ts` に、わざと雑な共有 cache を書きました。path だけを key にして、cookie は全部 origin に流し、`Cache-Control` が許すものは `Set-Cookie` ごと保存します。いちばん悪い設定の CDN のつもりです。

テストは、この cache 越しに「Alice、次に Bob」の順でリクエストを送ります。

- 全部の応答に `public` を付ける origin だと、Bob に Alice のページが届く。このテストは、漏れが起きることを確かめています。検査の仕組みが漏れを検出できない作りなら、通っても意味がないので
- この章の判定を使う origin だと、`/me` でも `/` でも、Bob には Alice のページが届かない。順番を逆にしても同じ
- cache に残るのは、cookie なしで作った応答だけ

同じ手順を、ビルドした本物の handler にも流します。そちらは次の BFF の節のあとで。

## BFF: token はサーバーに置く

<!-- section: 09.bff -->

06章の SPA は、access token をブラウザのメモリに持っていました。[「token はどこに置く？」](/ja/chapters/06-auth.md)の表には、3 つ目の選択肢として「サーバー側の session と cookie（09章）」と書いてあります。その続きです。

サーバーで HTML を組み立てるなら、サーバーが API を呼ぶことになります。それなら token もサーバーに持たせればいい。ブラウザに渡すのは、それ自体には意味のない session ID だけ。画面のために置かれて、ブラウザの代わりに token を持つサーバーを、backend for frontend（BFF）と呼びます。

```text
Browser                     BFF (the Nuxt server)                  API behind it
   |  Cookie: session id         |                                      |
   |---------------------------->|  session id -> access token          |
   |                             |------------------------------------->|
   |                             |  Authorization: Bearer <token>       |
   |                             |<-------------------------------------|
   |<----------------------------|  profile                             |
   |  HTML or JSON, no token     |                                      |
```

先に正直に言っておくと、この章の BFF は手元でしか動きません。理由はあとでまとめます。まずコードを。

### cookie

<<< @/examples/09-ssr/core/session.ts{cookie}

`HttpOnly` を付けた cookie は、JavaScript から読めません。ページに悪意のあるスクリプトが入り込んでも、session ID を持ち出せなくなります。06章で書いたとおり、XSS そのものの対策の代わりにはなりません。入り込んだスクリプトは、そのページから利用者として操作できます。ただ、持ち出して別の場所で使う、はできなくなります。

`path` は `/me` です。ブラウザは、`/me` の下へのリクエストにしかこの cookie を付けません。cache の 1 層目と同じ境界を、ブラウザにも引いています。

### session と token

<<< @/examples/09-ssr/core/session.ts{store}

session の中に `accessToken` があります。これがサーバーから出ていかないことが、BFF の約束です。

サインインの route がこちら。

<<< @/examples/09-ssr/server/routes/me/sign-in.post.ts{sign-in}

練習用なので、名前を打てば誰にでもなれます。本物の BFF なら、ここで 06章の認可コードを token endpoint に送って token を受け取ります。そのあとは同じで、token を session に入れ、ブラウザには session ID だけを返します。

`isSameOrigin` は、よそのサイトに置かれた form からの POST を断るための検査です。cookie で認証するようになると、この種のリクエスト（CSRF）を気にする必要が出てきます。06章の `Authorization` ヘッダー方式にはなかった宿題です。

そして、ブラウザに返すものの形。

<<< @/examples/09-ssr/core/profile.ts{viewer}

token を入れる場所が、型にありません。

<<< @/examples/09-ssr/server/routes/me/api/viewer.get.ts{viewer}

cookie から session を引いて、session の token で裏の API を呼び、返ってきた profile だけを返します。裏の API は、この章では同じプロセスの中にある練習用の実装です。

### 手元でしか動かない理由

理由は 2 つあって、どちらもこの章で見てきたものです。

1 つ目。session を Lambda のメモリに置いています。04章のとおり、実行環境は 1 つとは限らず、いつ消えるかも選べません。サインインした次のリクエストが別の箱に届けば、もうサインインしていないことになります。本物にするなら、session は 05章の DynamoDB のような、どの箱からも読める場所に置きます。

2 つ目。サインインは POST です。function URL と OAC の組み合わせは、ブラウザの form からの POST をそのままでは通しません。

なので、デプロイする stack は練習用のサインインを無効にしています（`AIH_SSR_SIGN_IN=off`）。うっかり有効のまま Lambda にのせても、起動時に止まります。

<<< @/examples/09-ssr/core/env.ts{env}

デプロイした環境で確かめられるのは、「`/me` は cookie があってもなくても cache されない」ところまで。cookie を持った人に本当にその人のページが返ることは、手元とビルドした handler でだけ確かめています。

## streaming は経路ぜんぶの話

<!-- section: 09.streaming -->

response streaming は、応答を全部作り終える前に、できた分から送ることです。最初の 1 byte が早く届き、Lambda の 6 MB という応答サイズの上限（buffered の場合）も、200 MB まで広がります。

ただし、途中のどこか 1 か所でも「全部たまるまで待つ」と、読者には一度に届きます。なので、経路を順に見ます。

| 経路 | streaming | どう確かめたか |
| --- | --- | --- |
| Nuxt の HTML | しない。1 回で書き出す | ビルドした handler を呼んで、書き込みの回数を数えた（1 回） |
| Nitro の handler | `streaming: true` なら、`ReadableStream` を返す route を少しずつ書く | 同上。`/feed` は 3 行を 3 回に分けて、約 300 ミリ秒おきに書いた |
| Lambda | Node.js の managed runtime が対応 | AWS のドキュメント。実機では未確認 |
| function URL | `InvokeMode: RESPONSE_STREAM` で対応。VPC の中の関数では不可 | AWS のドキュメント。実機では未確認 |
| CloudFront | 未確認 | 確かめられていません |
| 受け取る側 | Node.js の `fetch` は、届いた分から読めた | 手元の開発サーバーで確認。ブラウザでは未確認 |

表のいちばん上が、まず大事です。固定した版の Nuxt は、ページを 1 つの文字列にしてから渡します。handler を streaming にしても、HTML は 1 回で書き出されました。Nuxt のページに関しては、streaming にしても最初の 1 byte は早くなりません。

少しずつ届くのを見るために、`/feed` という route を足してあります。

<<< @/examples/09-ssr/server/routes/feed.get.ts{feed}

手元の検査は、Lambda の runtime が用意する `awslambda` を、記録するだけの偽物に差し替えて handler を呼びます。

<<< @/examples/09-ssr/scripts/lambda-harness.ts{fake-runtime}

これで確かめられるのは、「Nitro の handler が、いつ、何を書き込もうとするか」まで。その先、Lambda、function URL、CloudFront が実際に 1 つずつ流してくれるかは、デプロイして `curl -N` で見るしかありません。正直に言うと、そこはまだ見られていません。

### この章が buffered を既定にした理由

streaming には、払うものもあります。

CloudFront は、origin の応答に `Content-Length` があるときだけ、自分で圧縮します。Nitro の streaming 用の handler は、応答に `Transfer-Encoding: chunked` を付けます。長さがわからない応答なので、CloudFront は圧縮しない、と読めます（実機では未確認です）。HTML が圧縮されずに配られれば、転送量が増えます。

料金も少し変わります。stream した応答は、1 リクエストあたり最初の 6 MB を超えた分に、1 GB あたり USD 0.008 がかかります。それから、stream の途中で読者が接続を切っても、関数は止まりません。最後まで動いた時間が請求されます。

Nuxt のページは 1 回で書き出されるので、streaming にして得るものがありません。だから既定は buffered です。streaming が欲しくなるのは、応答が 6 MB を超えるときや、AI の出力のように、少しずつ届くこと自体に意味がある route を足すとき。そのときは、こうします。

```bash
vp run ssr:check:output:stream
vp run ssr:infra:deploy
```

1 つ目がビルドを streaming の形に作り直して検査し、2 つ目が、その `.output` と、それに合った `InvokeMode` をデプロイします。buffered に戻すときは `vp run build:ssr` です。

## 手元で動かす

<!-- section: 09.local -->

`examples/09-ssr/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/09-ssr/.env.example

```bash
vp run dev:ssr
```

<http://localhost:3000> で Nuxt の開発サーバーが立ち上がります。別のターミナルから、ヘッダーを見てみましょう。

```bash
curl -s -o /dev/null -D - http://localhost:3000/
curl -s -o /dev/null -D - http://localhost:3000/me
curl -s -o /dev/null -D - -H 'cookie: theme=dark' http://localhost:3000/
```

1 つ目は `cache-control: public, max-age=0, s-maxage=60`。2 つ目と 3 つ目は `private, no-store` です。3 つ目は公開ページですが、cookie が付いているので共有しません。

ブラウザで `/me` を開くと、名前を入れる form が出ます。サインインすると `/me` に名前が出て、開発者ツールで cookie を見ると、`HttpOnly` で `Path` が `/me` になっています。

`/feed` は、少しずつ届きます。

```bash
curl -sN http://localhost:3000/feed
```

### テスト

```bash
vp run test:unit
vp run typecheck
vp run typecheck:ssr
vp run lint:ssr
```

`test:unit` が見ているのは、判定の関数、共有 cache 越しの漏れの再現、session の期限、publish の計画、そして CDK の stack です。`typecheck` は `core/`、`server/`、`infra/`、`scripts/` を TypeScript で、`typecheck:ssr` と `lint:ssr` は `app/` の `.vue` を Vize で検査します。この章の `tsconfig.json` だけ、module の解決を `Bundler` にしています。他のサンプルと同じ `NodeNext` では、`nitropack/runtime` の型定義から `defineNitroPlugin` を解決できなかったためです。

もう 1 つ、この章だけの検査があります。

```bash
vp run ssr:check:output
```

`nuxt build` を実行して、できあがった `.output/server/index.mjs` を、function URL と同じ形の event で呼びます。AWS もネットワークも使いません。

<<< @/examples/09-ssr/scripts/check-output.ts{replay}

Alice としてサインインし、その cookie で `/me` を開き、続けて cookie なしで同じ path を開く。さっきの雑な共有 cache を挟んで、です。本物の Nuxt アプリが返すヘッダーで、Alice のページが次の人に届かないことを確かめています。404 のヘッダーの間違いを見つけたのも、この検査でした。

手元で再現しないものも、はっきりさせておきます。

- CloudFront。cache policy、behavior の振り分け、OAC の署名、`Set-Cookie` の除去は、template の assertion で設定を見ているだけです。CloudFront がそのとおりに動くことは、デプロイしないと見えません
- function URL と Lambda の runtime。`ssr:check:output` は event の形をまねていますが、Lambda そのものではありません
- 複数の実行環境。手元の開発サーバーは 1 プロセスなので、サインインがたまたま動きます

## デプロイして確かめる

<!-- section: 09.deploy -->

ここから先は、まだ実際の AWS で通せていません。手順とタスクは用意してあります。

初回はこの順です。

```bash
vp run build:ssr
vp run ssr:infra:diff
vp run ssr:infra:deploy
vp run ssr:assets:plan
vp run ssr:assets:publish
```

`ssr:infra:deploy` は、いま `.output` にあるビルドをデプロイします。先に stack を作るのは、asset を置く bucket がまだないからです。この数十秒だけ、HTML が指す JavaScript が S3 にない状態になります。

2 回目からは、順番を逆にします。

```bash
vp run build:ssr
vp run ssr:assets:publish
vp run ssr:infra:deploy
```

先に新しい asset を置いて、そのあとで関数を入れ替えます。新しい HTML が配られ始めたときには、それが指すファイルはもう S3 にあります。

<<< @/examples/09-ssr/scripts/asset-plan.ts{plan}

hash 入りのファイルは、足すだけで上書きしません。古いビルドのファイルは、すぐには消さずに 7 日残します。なぜ残すのかは、次の節で。

置けたら、確かめます。

```bash
vp run ssr:smoke
```

<<< @/examples/09-ssr/scripts/smoke-spec.ts{spec}

見ているのは 5 つです。

1. `/` を何度か開くと、応答のヘッダーが `public, max-age=0, s-maxage=60` で、2 回目以降のどれかが CloudFront の cache から返る
2. `/me` と `/me/api/viewer` を、でたらめな session cookie 付きと cookie なしで交互に何度開いても、`private, no-store` で、一度も cache から返らない
3. HTML が指す `/_nuxt/` のファイルが、`immutable` 付きで返る
4. function URL を直接開くと 403 が返る
5. POST は CloudFront が断る

2 が、この章の invariant を実環境で見る検査です。cache から返ったかどうかは、応答の `x-cache` ヘッダーと `age` ヘッダーで判定しています。CloudFront が実際にこの 2 つをどう返すかは、まだ自分の目で見ていません。

drift の検査は、02章と同じです。

```bash
vp run ssr:infra:drift
```

## 誰に、どれだけ古いものを見せるか

<!-- section: 09.stale -->

cache は、古い内容を返す仕組みでもあります。速さと引き換えに、誰に、どれだけ古いものを見せることを許すのか。決めておきましょう。

この章の答えはこうです。

- 公開ページ（`/`、`/notes/:id`、`/api/notes`）は、最大 60 秒古いものが、全員に届くことがある
- `/me` の下は、古いものを返さない。毎回 Lambda が答える

60 秒という数字は 1 か所（`SHARED_SECONDS`）にあって、アプリのヘッダーと、CloudFront の `maxTtl` の両方がそこから作られます。

```text
time   event                               reader in Tokyo         reader in London
t0     note "A" is published (deploy)
t0+5   Tokyo reader opens /                Lambda renders; cached
t0+20  London reader opens /                                       Lambda renders; cached at another edge
t0+30  note "B" is published (deploy)
t0+40  both reload                         still without B         still without B
t0+65  Tokyo reader reloads                Lambda renders; has B
t0+80  London reader reloads                                       Lambda renders; has B
```

cache は edge location ごとに別々です。同じ瞬間に、東京の読者は新しい一覧を、ロンドンの読者は古い一覧を見ていることがあります。全員が同時に切り替わる、とは言えません。言えるのは、「どの読者も、60 秒を超えて古いものは見ない」までです。

古い HTML が 60 秒残るということは、古い HTML が指す JavaScript も、少なくとも 60 秒は要るということです。タブを開きっぱなしの人は、もっと長く古いファイルを取りに来ます。`ssr:assets:publish` が古いビルドのファイルを 7 日残すのは、そのためです。HTML と asset を別々の場所から配る構成では、この 2 つの寿命をそろえて考える必要があります。

待てないときは、03章と同じ invalidation が使えます。ただし、それは「次のリクエストから origin に聞き直す」であって、全部の edge で同時に効く保証ではありません。

エラーにも cache があります。CloudFront は、origin が返した 404 や 5xx を、既定で 10 秒保存します。アプリは 200 以外に `no-store` を付けていますが、その場合に 10 秒がどうなるのかは、ドキュメントからは読み切れませんでした。公開側には cookie が届かないので、保存されるとしても、誰のものでもないエラーページです。

## Workers から来た人へ

<!-- section: 09.workers -->

Nuxt を Cloudflare Workers に出したことがあるなら、この章は遠回りに見えたはずです。違いを並べます。

| | Cloudflare Workers | この章（CloudFront と Lambda） |
| --- | --- | --- |
| ビルド | Nitro の Cloudflare 向け preset | Nitro の `aws-lambda` preset |
| デプロイ | `wrangler deploy` が Nuxt を検出して、`.output/server/index.mjs` と `.output/public` を設定する | asset を S3 に置くタスクと、関数と distribution を作る stack を、自分で用意する |
| HTML を作る場所 | Cloudflare のネットワーク上の Worker | 東京リージョンの Lambda。edge ではない |
| 静的 asset との振り分け | 設定の `assets` に directory を書く | distribution の behavior を path ごとに自分で書く |
| 他のサービスとの接続 | binding | AWS SDK と実行 role |

AWS のほうが、自分で決めることが多いです。この章で書いた cache policy、behavior、OAC、publish の順番は、Workers なら大部分をプラットフォームが決めてくれます。

そのかわり、決めたことは全部コードに残っています。どの path に cookie が届くのか、何秒 cache されるのか、関数を直接呼べるのは誰か。stack とテストを読めばわかります。

1 つ、同じことがあります。「ログイン中のページを共有 cache に載せない」は、どのプラットフォームでも、アプリを書く人の仕事です。Workers の静的 asset がどう cache されて、どう課金されるかは、この章のためには読んでいません。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も来ない月は、ほぼ 0 です。** かかるのは S3 に置いた asset の保存料金だけで、5 MB なら USD 0.000125。四捨五入すると USD 0.00 です。function URL に追加料金はなく、Lambda も CloudFront も、リクエストがなければ請求されません。

月 10 万ページビューだと、こうなります。1 ページビューあたり CloudFront へ 4 リクエストで合計 100 KB、HTML と API のリクエストの半分が cache に当たって残りの 5 万件が Lambda に届く、Lambda は平均 200 ミリ秒・512 MB・arm64、という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| CloudFront の HTTPS リクエスト | 40 万件 | 0.48 | 0 |
| CloudFront のデータ転送 | 9.537 GB | 1.09 | 0 |
| Lambda のリクエスト | 5 万件 | 0.01 | 0 |
| Lambda の実行時間 | 5,000 GB 秒 | 0.07 | 0 |
| CloudWatch Logs の取り込みと保存 | 0.014 GB | 0.01 | 0 |
| S3 の GET、PUT、保存 | 3 万件、200 件、0.005 GB 月 | 0.01 | 0.01（無料枠は確認できず、引いていない） |
| 小計 | | **1.67** | **0.01** |

この表でいちばん効いているのは、cache に当たる割合です。半分というのは仮定で、根拠のある数字ではありません。0 なら Lambda の行が 2 倍になり、ほとんど当たるなら 0 に近づきます。実際の値は、デプロイして計るしかありません。

200 ミリ秒という実行時間も仮定で、計測していません。あなたの関数の値は、04章と同じく、ログの `REPORT` 行でわかります。

Lambda から CloudFront へのデータ転送は、この表に入れていません（0 という意味ではなく、未算入です）。streaming を使う場合の料金は、「streaming は経路ぜんぶの話」に書いたとおりで、buffered のままなら発生しません。

## ハマりどころ

ここに書くのは、設定と一次情報から「こうなるはず」と読めるものです。実機で踏んで確かめたものではありません。

| こうなったら | ここを見る |
| --- | --- |
| `ssr:infra:synth` が `.output is missing` で止まる | `vp run build:ssr` を先に。stack はビルドの出力をデプロイします |
| デプロイ後、全部のページが 403 | function URL の resource policy に、distribution からの 2 つの許可がありますか。`ssr:infra:drift` で差を確認 |
| HTML は出るのに、画面が動かない。`/_nuxt/` のファイルが 404 | `ssr:assets:publish` を実行しましたか。関数だけ新しくなっています |
| `/me` にいつ行ってもサインインしていない | デプロイした環境では、それが正しい動きです。練習用のサインインは手元だけ |
| 公開ページに足した「ログイン中の名前」が、デプロイすると出ない | 公開側の behavior は cookie を Lambda に届けません。個人ごとの表示は `/me` の下か、ブラウザから `/me/` の API を呼んで出します |
| form を足したら、送信が 403 | distribution は GET と HEAD だけを通します。OAC と POST の制約は「function URL を公開のままにしない」に |
| 直したのに、古いページが出る | 60 秒待つか、invalidation を。edge ごとに切り替わる時刻は違います |
| streaming に切り替えたのに、少しずつ届かない | `.output/nitro.json` の `streaming` と、template の `InvokeMode` を見比べる。合っていれば、次に疑うのは CloudFront です（まだ確かめられていない区間） |

## 本番にするなら

- **本物のサインインを足す。** session を DynamoDB に置き、06章の認可コードを BFF で token に交換します。POST の入口は、API Gateway を挟むか、ブラウザ側で本文の hash を付けるか、どちらかを選びます
- **session cookie に `Secure` を必ず付ける。** 練習用のコードは、手元の `http://localhost` で動かすために、プロトコルを見て切り替えています
- **cache する時間を、ページごとに決める。** 全部 60 秒は学習用の値です。ほとんど変わらないページはもっと長く、在庫のように古いと困るものは cache しない
- **WAF を CloudFront に付ける。** function URL を直接呼べなくしてあるので、CloudFront に付けた WAF を迂回されません
- **同時実行数を見る。** function URL は、関数の同時実行数の上限に達すると 429 を返します。cache に当たらないページへのアクセスが急に増えると、ここに届きます
- **エラーページを用意する。** Lambda が落ちているときに CloudFront が返すページを、custom error response で決められます
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 09.cleanup -->

```bash
vp run ssr:unpublish --yes
vp run ssr:infra:destroy
```

cdkd は中身のある bucket を消せないので、先に asset を空にします。そのあと、関数、function URL、role、log group、bucket、distribution、cache policy、response headers policy が消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。手元の `.output`、`.nuxt`、`cdk.out` は git の管理外なので、消してかまいません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテストと CDK の assertion（`test:unit`）。TypeScript の型検査（`typecheck`）と、Vize による `.vue` の型検査と lint（`typecheck:ssr`、`lint:ssr`）。わざと型エラーを入れて、`vize check` が失敗することも確認。`build:ssr` と `build:ssr:stream`（Nuxt 4.6.1、nitropack 2.13.4、`@vizejs/nuxt` 0.443.0）。ビルドした handler を呼ぶ検査（`ssr:check:output` と `ssr:check:output:stream`）。buffered では `/feed` が 1 回、streaming では 3 回（約 300 ミリ秒おき）に分けて書かれ、どちらでも HTML は 1 回で書かれた。`ssr:infra:synth`。`dev:ssr` を起動して、公開ページ、404、`/me`、サインイン、サインアウト、よそからの POST の拒否、`/feed` が少しずつ届くことを HTTP で確認。

**まだ確かめていないこと。** AWS には何もデプロイしていません。`ssr:infra:diff`、`ssr:infra:deploy`、`ssr:assets:plan`、`ssr:assets:publish`、`ssr:smoke`、`ssr:infra:drift`、`ssr:unpublish`、`ssr:infra:destroy` は未実行です。とくに次の点は、実環境での確認待ちです。

- Nitro の handler が、Node.js 24 の Lambda runtime と function URL で動くこと
- OAC の署名付きリクエストを function URL が受け入れ、直接のリクエストを 403 で断ること
- cache policy が意図どおりに働くこと（公開ページが cache され、`/me` がされないこと）。`x-cache` と `age` ヘッダーでそれを判定できること
- `minTtl` と `defaultTtl` が 0、`maxTtl` が 60 の cache policy で、圧縮の設定を有効にできること
- response headers policy による `Set-Cookie` の除去
- CloudFront が許可していない method（POST）に返す status
- streaming の経路全体。function URL の `RESPONSE_STREAM`、CloudFront が stream を少しずつ流すこと、stream した応答が圧縮されないこと
- handler の形と `InvokeMode` が食い違ったときの応答
- 404 に `no-store` を付けたときの、CloudFront の error caching の動き
- cdkd 0.296.28 が、`AWS::CloudFront::CachePolicy` と `AWS::CloudFront::ResponseHeadersPolicy` を Cloud Control API 経由で作成・更新・削除できること

**cdkd が扱うリソースの種類。** npm の tarball（0.296.28）で、専用の実装が登録されていることを確かめたもの: `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`。専用の実装がなく、Cloud Control API 経由になるもの: `AWS::CloudFront::CachePolicy`、`AWS::CloudFront::ResponseHeadersPolicy`。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Nuxt を Lambda の形にする | `examples/09-ssr/nuxt.config.ts`、`scripts/lambda-harness.ts` | `build:ssr`、`ssr:check:output` |
| アプリは小さく | `examples/09-ssr/app/`、`server/api/`、`server/context.ts`、`core/notes.ts`、`core/seed.ts` | `dev:ssr`、`typecheck:ssr`、`lint:ssr` |
| CloudFront から Lambda へ | `examples/09-ssr/infra/lib/ssr-stack.ts`、`infra/bin/app.ts`、`infra/test/ssr-stack.test.ts`、`cdk.json` | `ssr:infra:synth`、`test:unit` |
| cache の境界 | `examples/09-ssr/core/routes.ts`、`core/cache-control.ts`、`server/plugins/cache-control.ts`、`test/cache-control.test.ts`、`test/support/shared-cache.ts` | `test:unit`、`ssr:check:output` |
| BFF: token はサーバーに置く | `examples/09-ssr/core/session.ts`、`core/profile.ts`、`core/env.ts`、`server/routes/me/`、`test/session.test.ts` | `dev:ssr`、`test:unit` |
| streaming は経路ぜんぶの話 | `examples/09-ssr/server/routes/feed.get.ts`、`scripts/lambda-harness.ts` | `build:ssr:stream`、`ssr:check:output:stream` |
| 手元で動かす | `examples/09-ssr/scripts/check-output.ts`、`test/`、`.env.example` | `dev:ssr`、`test:unit`、`typecheck`、`ssr:check:output` |
| デプロイして確かめる | `examples/09-ssr/scripts/publish-assets.ts`、`scripts/asset-plan.ts`、`scripts/smoke.ts`、`scripts/smoke-spec.ts` | `ssr:infra:deploy`、`ssr:assets:publish`、`ssr:smoke`、`ssr:infra:drift` |
| 誰に、どれだけ古いものを見せるか | `examples/09-ssr/core/cache-control.ts`、`scripts/asset-plan.ts` | `test:unit` |
| 片付け | `tools/src/site/unpublish.ts`、`tools/src/infra/` | `ssr:unpublish`、`ssr:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)、[Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)、[Invoking a response streaming enabled function using Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html)
- [Select a method to invoke your Lambda function using an HTTP request](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html)
- [Manage how long content stays in the cache (expiration)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)、[Understand cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html)
- [Cache content based on cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Cookies.html)、[Understand response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html)
- [Serve compressed files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html)、[How CloudFront processes HTTP 4xx and 5xx status codes from your origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html)、[Origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)、AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- [nuxt 4.6.1](https://www.npmjs.com/package/nuxt/v/4.6.1)、[nitropack 2.13.4](https://www.npmjs.com/package/nitropack/v/2.13.4)、[@vizejs/nuxt 0.443.0](https://www.npmjs.com/package/@vizejs/nuxt/v/0.443.0)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Cloudflare Workers: Nuxt](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/)

:::
