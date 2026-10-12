---
title: "09 SSR: しくみと実装"
---

# 09 SSR: しくみと実装

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

CDK の `origins.FunctionUrlOrigin.withOriginAccessControl` は、関数の resource policy に 2 つの許可を足します。`lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` で、どちらも相手は `cloudfront.amazonaws.com`、条件はこの distribution の ARN です。2025年10月以降に作る function URL は、この両方が要ります。テストは、許可がこの 2 つだけであること、`Principal` が `*` の許可が 1 つもないことを見ています。

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

```figure
caption: ブラウザが持つのは session ID だけで、access token は BFF が持って API を呼ぶ
type: sequence
actor browser: Browser
actor bff: BFF | Nuxt のサーバー
actor api: 後ろの API
step browser -> bff: Cookie: session id
step bff -> bff: session id -> access token
step bff -> api: Authorization: Bearer <token>
step api --> bff: profile
step bff --> browser: HTML か JSON。token なし
mark bff
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
