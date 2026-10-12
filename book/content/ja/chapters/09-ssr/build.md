---
title: "09 SSR: しくみと実装"
---

# 09 SSR: しくみと実装

[前のページ](/ja/chapters/09-ssr.md)で、Nuxt を Lambda に上げられる形にビルドしました。このページでは、そのビルドを CloudFront の後ろに置き、キャッシュの境界、BFF、ストリーミングの順に実装を見ていきます。

## CloudFront から Lambda へ

<!-- section: 09.connect -->

04章では Lambda の前に API Gateway の HTTP API を置きましたが、今回は CloudFront が前に立ちます。CloudFront から Lambda につなぐ方法には、候補が 2 つあります。

| | Lambda function URL | API Gateway HTTP API |
| --- | --- | --- |
| 追加料金 | なし（Lambda の料金だけ） | リクエストごと（04章） |
| CloudFront 以外からの呼び出しを断る | origin access control で署名を必須にできる | 標準の仕組みはない。独自のヘッダーなどで工夫する |
| レスポンスストリーミング | あり | なし（04章の表のとおり。REST API にはある） |
| JWT authorizer、スロットリング、ルートごとの設定 | なし | あり |
| ブラウザからの POST | origin access control と組むと、そのままでは通らない（このページの「function URL を公開のままにしない」） | 通る |

function URL は、Lambda の関数 1 つに付く専用の HTTPS エンドポイントです。この章では function URL を選びました。公開ページを返すだけなら API Gateway の機能は要らず、「CloudFront を通らないリクエストは Lambda が断る」という条件を IAM で書けるからです。

ブラウザから POST を受けたい、JWT を入口で検証したい、流量をルートごとに絞りたい、といった要件が出てきたら、API Gateway を選び直します。

### 関数

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{function}

04章と違うのは `code` です。`NodejsFunction` を使わず、Nitro が作った `.output/server` をそのまま渡しています。実行ロールは 04章と同じで、自分のロググループに書く権限しか持ちません。

`timeout` は 10 秒にしました。CloudFront がオリジンのレスポンスを待つ時間は既定で 30 秒なので、それより長く動かしても受け取る相手がいないからです。

最後の数行は、同時に動く数の上限（reserved concurrency）です。既定では付けず、デプロイのときに `-c reservedConcurrency=5` のように渡すと付きます。

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{reserved}

04章の API Gateway には、秒あたりのリクエスト数の上限を付けました。function URL と CloudFront には、それに当たる無料の設定がなく、キャッシュに当たらないリクエストは来た数だけ関数を動かします。reserved concurrency を付けると、その数に上限ができます。上限を超えたリクエストは、関数を動かさずに断られます。

既定にしなかったのは、デプロイが失敗する可能性があるからです。reserved concurrency は、アカウント全体の同時実行数の枠から N を取り分けます。作ったばかりのアカウントは枠が小さいことがあり、その場合は取り分けること自体を断られます。あなたのアカウントでどうなるかは、この本では確かめられません。付ける時期の目安は、[費用のページ](/ja/chapters/09-ssr/wrap.md)の「叩かれたら」で金額と合わせて説明します。

### function URL を公開のままにしない

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{url}

function URL には `AuthType` という設定があり、`NONE` にすると、URL を知っている人なら誰でも関数を呼べます。CloudFront を迂回して呼べるので、キャッシュの設定も、あとで足す WAF も効かなくなります。

そこで `AuthType` を `AWS_IAM` にしています。署名のないリクエストは、関数が動く前に Lambda が 403 で断ります。オリジンへ送るリクエストには、CloudFront の origin access control（OAC）が署名を付けます。03章で S3 に使った仕組みの Lambda 版です。

CDK の `origins.FunctionUrlOrigin.withOriginAccessControl` は、関数のリソースポリシーに `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` の 2 つの許可を足します。どちらも相手は `cloudfront.amazonaws.com` で、条件はこのディストリビューションの ARN です。2025年10月以降に作る function URL には、この両方が必要です。テストでは、許可がこの 2 つだけであることと、`Principal` が `*` の許可が 1 つもないことを確かめています。

OAC には、あとの節に影響する制約が 1 つあります。POST や PUT のリクエストでは、送る側が本文の SHA-256 を `x-amz-content-sha256` ヘッダーに入れておかなければなりません。ふつうの HTML のフォームはこのヘッダーを付けないので、このスタックは GET と HEAD だけを通す設定にして、POST は CloudFront で断っています。

### ビルドの形と合わせる

<<< @/examples/09-ssr/infra/bin/app.ts{app}

function URL の `InvokeMode` は、ハンドラーの形と対になる設定です。`BUFFERED` はレスポンスをすべて受け取ってから返す呼び方で、`RESPONSE_STREAM` はストリームで受け取る呼び方です。この 2 か所を人が手で合わせるのをやめて、スタックが `nitro.json` を読むようにしました。ビルドした形が、そのまま `InvokeMode` になります。

ハンドラーの形と `InvokeMode` が食い違ったときに何が起きるかは、AWS のドキュメントに書かれておらず、実機でも確かめていません。わからないので、食い違いが起きない作りにしています。

## キャッシュの境界

<!-- section: 09.cache -->

この章でいちばん大事な節です。防ぎたい事故は、次の順で起きます。

1. Alice がログインして `/me` を開く。Lambda が Alice のページを組み立てて返す
2. CloudFront が、そのレスポンスを `/me` の答えとして保存する
3. Bob が `/me` を開く。CloudFront は Lambda に聞かず、保存してあった Alice のページを返す

CloudFront は、設定しなければ cookie を見ません。cookie だけが違う 2 つのリクエストを同じものとして扱うので、3 が起きます。

守りたいことは、次の 1 文です。

**誰かの cookie や `Authorization` を見て作ったレスポンスは、共有キャッシュに入らない。**

1 か所だけで守ると、そこを間違えたときにそのまま漏れます。そのため、守る場所を 3 層に分けました。

### 1 層目: パスで分ける

<<< @/examples/09-ssr/core/routes.ts{routes}

人によって変わるものは、すべて `/me` の下に置きます。ルールはこの 1 つだけです。この定義はアプリと CDK のスタックの両方が import するので、アプリは `/account` も個人用だと考えているのに CloudFront の設定には入っていない、という食い違いが起きません。

### 2 層目: 公開側には cookie を届けない

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{public-policy}

`/me` 以外に使うキャッシュポリシー（cache policy）です。`cookieBehavior` と `headerBehavior` を `none` にしています。CloudFront は、キャッシュキーに入れなかった値をオリジンにも送りません。そのため、公開ページを組み立てる Lambda には cookie がそもそも届きません。

`queryStringBehavior` も `none` です。この章のページはクエリ文字列を読みません。クエリ文字列をキャッシュキーに入れると、`/?x=1` と `/?x=2` が別々のキャッシュになります。そうなると、乱数を付けてリクエストするだけで毎回キャッシュを外せて、そのたびに 512 MB の関数が動きます。キーに入れなければ、何を付けても同じパスは同じキャッシュに当たります。クエリ文字列を読むページを足すときは、`cloudfront.CacheQueryStringBehavior.allowList("page")` のように、読む名前だけをキーに入れます。

cookie を届けないことには、もう 1 つ効果があります。cookie が届かなければ、Lambda は誰が見ているのかを知る手段がなく、知らない名前は HTML に書けません。将来だれかが公開ページに「こんにちは、Alice さん」と出すコードを足しても、名前が出るのは手元だけで、CloudFront を通すと出ません。間違えたときの結果が、他人に漏れるのではなく、表示されないほうに倒れます。

TTL の 3 つの値にも、それぞれ理由があります。

- `minTtl` は 0 です。1 以上にすると、オリジンが `Cache-Control: private, no-store` を返しても、CloudFront はその秒数だけキャッシュします。ドキュメントに警告として書かれている動きです
- `defaultTtl` も 0 です。`Cache-Control` が付いていないレスポンスはキャッシュされません
- `maxTtl` は 60 秒です。アプリが間違って長い時間を指定しても、60 秒が上限になります

`Set-Cookie` にも注意が要ります。CloudFront は、オリジンが返した `Set-Cookie` をレスポンスと一緒にキャッシュし、キャッシュに当たった全員に同じ cookie を配ることがあります。セッションの cookie でそうなると、全員が同じ人としてログインした状態になります。公開側のレスポンスヘッダーポリシー（response headers policy）で `Set-Cookie` を取り除いているのは、そのためです。

`/me` の側は次のとおりです。

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{personal}

`CACHING_DISABLED` は、キャッシュを無効にするマネージドポリシーです。アプリがどんなヘッダーを返しても、`/me` の下のレスポンスは保存されません。cookie を Lambda へ届けるのは、このビヘイビア（behavior）だけです。

ディストリビューションには、この 2 種類のビヘイビアを並べます。

<<< @/examples/09-ssr/infra/lib/ssr-stack.ts{distribution}

### 3 層目: アプリも自分で言う

CloudFront の設定だけには頼らず、アプリもレスポンスごとに、共有してよいかどうかをヘッダーで伝えます。手元の開発サーバーや、将来 CloudFront の前後に入るかもしれない別のキャッシュに通じるのは、このヘッダーだけだからです。

<<< @/examples/09-ssr/core/cache-control.ts{values}

共有してよいときの値は `public, max-age=0, s-maxage=60` です。`max-age=0` はブラウザが毎回 CloudFront に聞き直すこと、`s-maxage=60` は CloudFront が 60 秒まで自分で答えてよいことを表します。

<<< @/examples/09-ssr/core/cache-control.ts{decide}

共有を許すのは、関数の最後の 1 行まで届いたレスポンスだけです。GET か HEAD で、`/me` の外にあり、リクエストに cookie も `Authorization` もなく、レスポンスが cookie を設定せず、ステータスが 200 であることが条件です。1 つでも外れれば `private, no-store` になります。

cookie は名前を見ず、何の cookie でも付いていれば共有しません。セッションの cookie のときだけ、という条件にすると、cookie の名前を変えた日に穴が開くからです。

この判定を、Nitro のプラグインですべてのレスポンスに適用します。

<<< @/examples/09-ssr/server/plugins/cache-control.ts{plugin}

フックを 2 つに分けたのには理由があります。リクエストが来た時点で、先に `private, no-store` を付けておきます。ハンドラーが終わったあとで、条件を満たしたレスポンスだけを `public` に書き換えます。途中で例外が出て 2 つ目のフックが動かなくても、残るのは共有しないほうの値です。

### 実際にひっかかったこと

判定の中にある `isInternalPath` は、読んだだけでは理由がわかりにくい条件です。この条件は、テストが失敗して初めて必要だとわかりました。

存在しないノートを開くと、Nuxt は 404 のエラーページを返します。このとき Nuxt は、サーバーの中で `/__nuxt_error` というパスをもう一度呼んでエラーページを組み立て、その内側のレスポンスのヘッダーを、外側の本物のレスポンスに写します。内側のリクエストは cookie のない GET で、ステータスは 200 です。最初に書いたコードはこのリクエストを公開ページと判定し、404 のレスポンスに `public, s-maxage=60` を付けていました。

この間違いを見つけたのは、ビルドしたハンドラーを実際に呼ぶ検査（[手元で動かす](/ja/chapters/09-ssr/local.md)の `ssr:check:output`）です。判断を純粋関数に切り出してテストしていても、フレームワークがその関数をいつ、何回呼ぶかは、動かしてみるまでわかりません。

### 漏れを、決まった順序で再現する

`test/support/shared-cache.ts` に、わざと雑に作った共有キャッシュがあります。パスだけをキーにして、cookie はすべてオリジンに流し、`Cache-Control` が許すレスポンスは `Set-Cookie` ごと保存します。設定がいちばん悪い CDN を想定したものです。

テストは、このキャッシュを通して、Alice、Bob の順にリクエストを送ります。

- すべてのレスポンスに `public` を付けるオリジンでは、Bob に Alice のページが届く。このテストは、漏れが実際に起きることを確かめています。漏れを検出できない仕組みなら、ほかのテストが通っても意味がないからです
- この章の判定を使うオリジンでは、`/me` でも `/` でも、Bob に Alice のページが届かない。順番を逆にしても同じ
- キャッシュに残るのは、cookie なしで作ったレスポンスだけ

同じ手順を、ビルドした本物のハンドラーにも流します。その検査は[手元で動かす](/ja/chapters/09-ssr/local.md)で実行します。

## BFF: トークンはサーバーに置く

<!-- section: 09.bff -->

06章の SPA は、アクセストークンをブラウザのメモリに持っていました。[06章](/ja/chapters/06-auth.md)でトークンの置き場所を比べた表には、3 つ目の選択肢としてサーバー側のセッションと cookie があり、09章で扱うとしていました。この節がその続きです。

サーバーで HTML を組み立てるなら、API を呼ぶのもサーバーです。それならトークンもサーバーに持たせ、ブラウザには、それだけでは意味を持たないセッション ID だけを渡せます。画面のために置かれ、ブラウザの代わりにトークンを持つサーバーを、backend for frontend（BFF）と呼びます。

```figure
caption: ブラウザが持つのはセッション ID だけで、アクセストークンは BFF が持って API を呼ぶ
type: sequence
actor browser: Browser
actor bff: BFF | Nuxt のサーバー
actor api: 後ろの API
step browser -> bff: Cookie: session id
step bff -> bff: session id -> access token
step bff -> api: Authorization: Bearer <token>
step api --> bff: profile
step bff --> browser: HTML か JSON。トークンなし
mark bff
```

この章の BFF は、手元でしか動きません。理由は、コードを見たあとに「手元でしか動かない理由」でまとめます。

### cookie

<<< @/examples/09-ssr/core/session.ts{cookie}

`HttpOnly` を付けた cookie は JavaScript から読めないので、ページに悪意のあるスクリプトが入り込んでも、セッション ID を持ち出せません。ただし 06章で書いたとおり、XSS そのものの対策の代わりにはなりません。入り込んだスクリプトは、そのページから利用者として操作できます。防げるのは、セッション ID を持ち出して別の場所で使うことです。

`path` は `/me` にしています。ブラウザは、`/me` の下へのリクエストにしかこの cookie を付けません。キャッシュの 1 層目と同じ境界を、ブラウザの側にも引いたことになります。

### セッションとトークン

<<< @/examples/09-ssr/core/session.ts{store}

セッションの中には `accessToken` があります。この値がサーバーの外に出ないことが、BFF の約束です。

サインインのルートは次のとおりです。

<<< @/examples/09-ssr/server/routes/me/sign-in.post.ts{sign-in}

練習用なので、名前を入力すれば誰にでもなれます。本物の BFF なら、この場所で 06章の認可コードをトークンエンドポイントに送ってトークンを受け取ります。そのあとの処理は同じで、トークンをセッションに入れ、ブラウザにはセッション ID だけを返します。

`isSameOrigin` は、別のサイトに置かれたフォームからの POST を断るための検査です。cookie で認証する場合は、この種のリクエスト（CSRF）への対策が必要になります。06章の `Authorization` ヘッダーを使う方式では要らなかった対策です。

ブラウザに返す値の型は次のとおりです。

<<< @/examples/09-ssr/core/profile.ts{viewer}

この型には、トークンを入れるフィールドがありません。

<<< @/examples/09-ssr/server/routes/me/api/viewer.get.ts{viewer}

cookie からセッションを引き、セッションのトークンで後ろの API を呼び、返ってきたプロフィールだけをブラウザに返します。後ろの API は、この章では同じプロセスの中にある練習用の実装です。

### 手元でしか動かない理由

理由は 2 つあり、どちらもこの章ですでに出てきたものです。

1 つ目は、セッションを Lambda のメモリに置いていることです。04章のとおり、実行環境は 1 つとは限らず、いつ消えるかも選べません。サインインした次のリクエストが別の実行環境に届けば、サインインしていない扱いになります。本物にするなら、セッションは 05章の DynamoDB のように、どの実行環境からも読める場所に置きます。

2 つ目は、サインインが POST であることです。function URL と OAC の組み合わせは、ブラウザのフォームからの POST をそのままでは通しません。

そのため、デプロイするスタックでは練習用のサインインを無効にしています（`AIH_SSR_SIGN_IN=off`）。誤って有効のまま Lambda に載せても、起動時にエラーで止まります。

<<< @/examples/09-ssr/core/env.ts{env}

デプロイした環境で確かめられるのは、`/me` が cookie の有無にかかわらずキャッシュされないことまでです。cookie を持った人に本当にその人のページが返ることは、手元とビルドしたハンドラーでだけ確かめています。

## ストリーミングは経路全体で決まる

<!-- section: 09.streaming -->

レスポンスストリーミング（response streaming）は、レスポンスをすべて作り終える前に、できた分から送る仕組みです。最初の 1 byte が早く届き、Lambda のレスポンスサイズの上限も、buffered の場合の 6 MB から 200 MB まで広がります。

ただし、経路のどこか 1 か所でも全部たまるまで待つと、読者には一度に届きます。そこで、経路を順に確かめます。

| 経路 | ストリーミング | どう確かめたか |
| --- | --- | --- |
| Nuxt の HTML | しない。1 回で書き出す | ビルドしたハンドラーを呼んで、書き込みの回数を数えた（1 回） |
| Nitro のハンドラー | `streaming: true` なら、`ReadableStream` を返すルートを少しずつ書く | 同上。`/feed` は 3 行を 3 回に分けて、約 300 ミリ秒おきに書いた |
| Lambda | Node.js の managed runtime が対応 | AWS のドキュメント。実機では未確認 |
| function URL | `InvokeMode: RESPONSE_STREAM` で対応。VPC の中の関数では不可 | AWS のドキュメント。実機では未確認 |
| CloudFront | 未確認 | 確かめられていません |
| 受け取る側 | Node.js の `fetch` は、届いた分から読めた | 手元の開発サーバーで確認。ブラウザでは未確認 |

まず見てほしいのは、表のいちばん上の行です。固定した版の Nuxt は、ページを 1 つの文字列にしてから渡します。ハンドラーをストリーミングの形にしても、HTML は 1 回で書き出されました。Nuxt のページについては、ストリーミングにしても最初の 1 byte は早くなりません。

少しずつ届く様子を見られるように、`/feed` というルートを足してあります。

<<< @/examples/09-ssr/server/routes/feed.get.ts{feed}

手元の検査では、Lambda のランタイムが用意する `awslambda` を、書き込みを記録するだけの偽物に差し替えてからハンドラーを呼びます。

<<< @/examples/09-ssr/scripts/lambda-harness.ts{fake-runtime}

この検査で確かめられるのは、Nitro のハンドラーがいつ、何を書き込もうとするかまでです。その先の Lambda、function URL、CloudFront が実際に 1 つずつ流すかどうかは、デプロイして `curl -N` で見るしかなく、まだ見られていません。

### buffered を既定にした理由

ストリーミングには、引き換えになるものもあります。

CloudFront が自分で圧縮するのは、オリジンのレスポンスに `Content-Length` があるときだけです。Nitro のストリーミング用のハンドラーは、レスポンスに `Transfer-Encoding: chunked` を付けます。長さがわからないレスポンスなので CloudFront は圧縮しない、とドキュメントからは読めます（実機では未確認です）。HTML が圧縮されずに配られれば、転送量が増えます。

料金も少し変わります。ストリームしたレスポンスは、1 リクエストあたり最初の 6 MB を超えた分に、1 GB あたり USD 0.008 がかかります。また、ストリームの途中で読者が接続を切っても関数は止まらず、最後まで動いた時間が請求されます。

Nuxt のページは 1 回で書き出されるので、ストリーミングにしても得るものがありません。既定を buffered にしたのはそのためです。ストリーミングが必要になるのは、レスポンスが 6 MB を超えるときや、AI の出力のように少しずつ届くこと自体に意味があるルートを足すときです。そのときは、次の 2 つを実行します。

```bash
vp run ssr:check:output:stream
vp run ssr:infra:deploy
```

1 つ目のタスクが、ビルドをストリーミングの形に作り直して検査します。2 つ目が、その `.output` と、それに合った `InvokeMode` をデプロイします。buffered に戻すときは `vp run build:ssr` を実行します。
