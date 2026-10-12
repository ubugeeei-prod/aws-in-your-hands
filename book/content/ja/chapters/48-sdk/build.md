---
title: "48 SDK: しくみと実装"
---

# 48 SDK: しくみと実装

[前のページ](/ja/chapters/48-sdk.md)で、1 回の `send` が通る順と、手元のエンドポイントを見ました。このページでは、その順に沿って、ミドルウェア、認証情報、リージョンとエンドポイント、再試行、タイムアウト、エラーを 1 つずつ読み、確かめます。

## ミドルウェア

<!-- section: 48.middleware -->

ミドルウェアスタックには 5 つのステップがあります。SDK の README の説明をまとめると、次のとおりです。

| ステップ | すること |
| --- | --- |
| `initialize` | 呼び出しを始める。HTTP リクエストはまだない |
| `serialize` | 入力から HTTP リクエストを作る |
| `build` | リクエストに、再試行しても変わらないヘッダーを足す。`Content-Length` など |
| `finalizeRequest` | 送る直前の仕上げ。再試行と署名はここにある |
| `deserialize` | 応答を、出力のオブジェクトか例外にする |

同じステップの中の順序は、優先度（`high`、`normal`、`low`）で決まります。導入済みの `DynamoDBClient` に `middlewareStack.identify()` で並びを尋ねると、次が返ります。テストはこの並びを固定しています。

```text
loggerMiddleware - initialize
serializerMiddleware - serialize
contentLengthMiddleware - build
getUserAgentMiddleware - build
hostHeaderMiddleware - build
recursionDetectionMiddleware - build
retryMiddleware - finalizeRequest
httpSigningMiddleware (a.k.a. apiKeyMiddleware,tokenMiddleware,awsAuthMiddleware) - finalizeRequest
deserializerMiddleware - deserialize
```

ミドルウェアは、次の処理（`next`）を受け取って、それを包んだ関数を返す関数です。`next` を呼ぶ前がリクエストの側、`next` から戻ったあとが応答の側になります。

この章では、試行のたびに 1 行のログを書くミドルウェアを足します。SDK が何回送ったかは、最後の結果の `$metadata.attempts` でもわかりますが、どの試行が何ミリ秒かかり、サービスがそれぞれにどのリクエスト ID を振ったかは、試行ごとに記録しないと残りません。サービスの側で 1 件のリクエストを指す名前は、このリクエスト ID だけです。

ログの形は [19章](/ja/chapters/19-observability.md)のものに合わせます。共通のフィールドはそのスキーマから取り、この章のぶんを足します。19章と同じく、書いていないフィールドは受け付けません。

<<< @/examples/48-sdk/src/attempt-log.ts{shape}

`error` に入れるのは例外の `name` だけです。`message` には、サービスが返した文がそのまま入り、テーブルの名前やキーを含むことがあるからです。

置く場所は `finalizeRequest` の優先度 `low` です。再試行のミドルウェアは同じステップの `high` なので、その下に入り、再試行のループが回るたびに呼ばれます。`deserialize` はさらに下にあるので、`next` から戻った時点で、応答はもう出力か例外になっています。

<<< @/examples/48-sdk/src/attempt-log.ts{plugin}

何回目の試行かは、自分で数えません。再試行のミドルウェアが、送るリクエストに `amz-sdk-request: attempt=2; max=3` というヘッダーを付けているので、それを読みます。サービスに届くのと同じ値です。

<<< @/examples/48-sdk/src/attempt-log.ts{parse}

クライアントはリクエストをまたいで使い回すので、アプリのリクエスト ID をミドルウェアに閉じ込めておくことはできません。行を書くときに尋ねる関数を渡します。次の例は、`AsyncLocalStorage` に置いた値を返しています。

<<< @/examples/48-sdk/scripts/tour.ts{wiring}

`vp run sdk:tour` は、2 回スロットリングしてから答える台本に対して、このクライアントで 1 回呼びます。出力は次のとおりでした。`awsRequestId` は手元のサーバーが振った番号で、`durationMs` はこの端末での値です。

```text
{"level":"warn","message":"aws attempt","requestId":"req-1","client":"DynamoDBClient","command":"GetItemCommand","attempt":1,"maxAttempts":3,"status":400,"awsRequestId":"LOCAL00000001","error":"ProvisionedThroughputExceededException","durationMs":15}
{"level":"warn","message":"aws attempt","requestId":"req-1","client":"DynamoDBClient","command":"GetItemCommand","attempt":2,"maxAttempts":3,"status":400,"awsRequestId":"LOCAL00000002","error":"ProvisionedThroughputExceededException","durationMs":3}
{"level":"info","message":"aws attempt","requestId":"req-1","client":"DynamoDBClient","command":"GetItemCommand","attempt":3,"maxAttempts":3,"status":200,"awsRequestId":"LOCAL00000003","durationMs":3}
{"attempts":3}
```

トレースの ID も載せたいときは、19章の `withTraceFields` で `log` を包みます。

## 認証情報

<!-- section: 48.credentials -->

クライアントに `credentials` を渡さなければ、SDK は決まった順に取得元を試し、最初に認証情報を返したところで止まります。この並びを、認証情報プロバイダーチェーン（credential provider chain）と呼びます。導入済みの `@aws-sdk/credential-provider-node` のソースでは、順序は次のとおりです。

<<< @/examples/48-sdk/src/credentials.ts{chain}

この本のコードがどこで認証情報を得ているかは、この並びで説明がつきます。

Lambda では、最初の `fromEnv` で決まります。Lambda は実行ロールの一時的な認証情報を `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` に入れて関数を起動するからです。この 3 つは Lambda が予約している環境変数で、ドキュメントに載っています。04章からコードに認証情報が 1 行も出てこないのは、このためです。

手元では、01章で `aws login` を実行しました。このコマンドは、プロファイルに `login_session` を書き、短い期限の認証情報を `~/.aws/login/cache` に置きます。SDK は `fromIni` でプロファイルを読み、`login_session` があれば、そのキャッシュから認証情報を取ります。リファレンスによると、この認証情報の期限は 15 分で、CLI と SDK が最長 12 時間まで自動で更新します。

ECS のタスクと EC2 のインスタンスでは、最後の段で決まります。コンテナには認証情報のエンドポイントを指す環境変数があり、インスタンスにはメタデータサービスがあります。

順序について、知っておくとよいことが 2 つあります。

1 つは、`AWS_PROFILE` があると `fromEnv` が飛ばされることです。環境変数にキーがあっても、プロファイルのほうが使われます。両方あるときは、SDK が警告を 1 度出します。警告の文面は、将来の版でこの優先順位が逆になるかもしれないと断っています。どちらか一方だけを設定しておくのが安全です。

もう 1 つは、開発者ガイドの表と、導入済みのソースが少し違うことです。ガイドの表は `fromIni` のあとに `fromLoginCredentials` を独立した段として載せていますが、固定している版のチェーンにその段はなく、`aws login` の認証情報にはプロファイルを通してだけ届きます。食い違うときは、固定した版のソースを正とします。

取り出した認証情報は、クライアントの中で覚えておかれます。期限のある認証情報は、残りが 5 分を切ると取り直されます。これもソースで読んだ値です。前のページで見たとおり、取り出すのは 1 回の `send` につき 1 度で、再試行のあいだは同じ認証情報が使われます。

### どの取得元が使われたか

「思っていたのと違うロールで動いていた」は、権限のエラーの原因としてよくあります。SDK は、取得元を 2 つの形で残しています。チェーンに `logger` を渡すと、試した段を `debug` で 1 行ずつ出します。また、返ってきた認証情報の `$source` に、関わったプロバイダーの印を付けます。`$source` は、SDK が自分の利用統計のために付けている内部の値で、公開の API として文書化されたものではありません。版を上げるときは、テストで確かめ直します。

<<< @/examples/48-sdk/src/credentials.ts{source}

この関数は、キー ID の末尾 4 文字しか返しません。残りと、シークレットキー、セッショントークンは、どこにも出しません。

```bash
vp run sdk:credentials
```

環境変数に偽のキーを入れて実行すると、次が出ました。

```text
{
  "accessKeyIdEnd": "0001",
  "temporary": false,
  "sources": [
    "environment variables"
  ],
  "tried": [
    "fromEnv"
  ]
}
```

このタスクは、この端末の設定をそのまま使います。プロファイルがロールを引き受ける形なら STS を呼び、IAM Identity Center や `aws login` ならトークンの更新で AWS に届きます。そのため `live` のタスクにしてあります。この章では、偽のキーと、テストが書いた一時ファイルのプロファイルに対してだけ実行しました。

## リージョンとエンドポイント

<!-- section: 48.region-endpoint -->

リージョンは、コードで渡した値、環境変数 `AWS_REGION`、使っているプロファイルの `region` の順に決まります。どれもなければ、最初の呼び出しが `Region is missing` で失敗します。既定のリージョンはありません。

`AWS_DEFAULT_REGION` という名前の変数もありますが、固定している版の SDK は、リージョンを決めるときにこの変数を読みません。テストで、`AWS_DEFAULT_REGION` だけを設定したクライアントが `Region is missing` になることを確かめました。Lambda は `AWS_REGION` を設定するので、関数の中では気にする必要がありません。

エンドポイントは、ふつうリージョンとサービスから SDK が決めます。変える方法は 3 つあり、コードの `endpoint`、環境変数、共有設定ファイルの `endpoint_url` です。環境変数は、サービスごとの `AWS_ENDPOINT_URL_DYNAMODB` のような名前と、全サービスに効く `AWS_ENDPOINT_URL` があります。

環境変数だけでクライアントの行き先が変わることは、テストで確かめました。コードに `endpoint` を書かなくても、`AWS_ENDPOINT_URL_DYNAMODB` を設定すれば、クライアントは手元のサーバーに届きます。DynamoDB Local のような代役につなぐには便利ですが、本番の環境にこの変数が紛れ込むと、アプリは黙って別の場所と話します。環境変数を一覧で管理している場合は、`AWS_` で始まるものに、意図しないものがないかを見ておきます。

S3 を手元のサーバーにつなぐときは、`forcePathStyle: true` を付けます。付けないと、SDK はバケットの名前をホスト名の先頭に置こうとし、`127.0.0.1` ではそれができません。

FIPS のエンドポイントと、IPv6 でも届く dual-stack のエンドポイントは、`useFipsEndpoint` と `useDualstackEndpoint`（または `AWS_USE_FIPS_ENDPOINT` と `AWS_USE_DUALSTACK_ENDPOINT`）で選びます。既定はどちらも無効で、この章では使いません。

## 再試行

<!-- section: 48.retries -->

再試行をなぜ間隔をあけて行うのか、なぜ総量に予算を付けるのかは、[32章](/ja/chapters/32-limits.md)に書きました。32章は、SDK のリファレンスが 2026 年の新しい再試行の動作を載せていて、導入済みのパッケージの数字はそれと違う、というところまで確かめています。ここでは、固定している版が既定で何をするか、新しい動作はどう有効になるかを、導入済みのパッケージそのものに尋ねて確定します。

```figure
type: sequence
caption: スロットリングされた呼び出し。待つのも数えるのも、再試行のミドルウェアがする
actor app: アプリ
actor retry: retryMiddleware
actor endpoint: エンドポイント
step app -> retry: send(GetItem)
step retry -> endpoint: attempt=1; max=3
step endpoint --x retry: 400 スロットリング
note retry: 予算から 5 を引き、0〜500 ms 待つ
step retry -> endpoint: attempt=2; max=3
step endpoint --> retry: 200
note retry: 予算に 5 を戻す
step retry --> app: 出力、attempts = 2
```

### 固定している版の既定値

次の 2 つの定数が、この章の結論です。1 つ目は何も設定しないときの値、2 つ目は `AWS_NEW_RETRIES_2026=true` で起動したプロセスでの値です。

<<< @/examples/48-sdk/src/defaults.ts{pinned}

この定数は、ソースを読んで書き写したものですが、テストが導入済みの SDK に尋ねた結果と比べています。尋ねるのは次の関数です。試行回数は、クライアントの設定を読むのではなく、手元のエンドポイントに 1 回送って、届いた `amz-sdk-request` ヘッダーの `max=` を読みます。設定の解決には段がいくつもあり、通信に載った値がいちばん確かだからです。

<<< @/examples/48-sdk/src/defaults.ts{read}

```bash
vp run sdk:defaults
AWS_NEW_RETRIES_2026=true vp run sdk:defaults
```

2 つの動作を並べます。左の列は、導入済みのパッケージで確かめた値です。右の列は、導入済みのパッケージを `AWS_NEW_RETRIES_2026=true` で動かして確かめた値で、SDK のリファレンスの記述とも一致しています。

| | 何も設定しないとき | `AWS_NEW_RETRIES_2026=true` |
| --- | --- | --- |
| モード | `standard` | `standard` |
| 試行回数（最初の 1 回を含む） | 3 | 3、DynamoDB は 4 |
| 待ち時間の基準、スロットリング以外 | 100 ms | 50 ms、DynamoDB は 25 ms |
| 待ち時間の基準、スロットリング | 500 ms | 1,000 ms |
| 待ち時間の上限 | 20 秒 | 20 秒 |
| 再試行の予算 | 500 | 500 |
| 再試行 1 回の費用、スロットリング以外 | 10 | 14 |
| 再試行 1 回の費用、スロットリング | 5 | 5 |

待ち時間は、どちらの動作でも、基準を 2 倍ずつ伸ばした値に 0 以上 1 未満の乱数を掛けたものです。乱数を 0.5 に固定したテストで、スロットリングのあとの 2 回の待ちが合わせて 750 ミリ秒（250 と 500）、500 番台のあとが 150 ミリ秒（50 と 100）になることを確かめました。この合計は、結果の `$metadata.totalRetryDelay` に入っています。

### 新しい動作の有効化

新しい動作のスイッチは 1 つの静的な値で、パッケージが読み込まれるときに 1 度だけ決まります。読む場所は 2 つあります。`@smithy/core` は `SMITHY_NEW_RETRIES_2026` を、`@aws-sdk/core` は `AWS_NEW_RETRIES_2026` を見て、どちらかが文字列の `true` ならオンになります。`1` や `TRUE` ではオンになりません。

読み込みのときに決まるので、プロセスの途中で環境変数を変えても切り替わりません。テストも、条件ごとに別のプロセスを起動して確かめています。Lambda なら、関数の環境変数に設定します。

オンにすると変わるのは、表のとおり、待ち時間の基準、スロットリング以外の再試行の費用、そして DynamoDB のクライアントの既定の試行回数です。S3 のクライアントの試行回数は 3 のままでした。リファレンスは DynamoDB Streams も 4 回になると書いていますが、この章では確かめていません。`AWS_MAX_ATTEMPTS` や、コードの `maxAttempts` は、どちらの動作でも既定より優先されます。

リファレンスは、この動作が「既定になるまで」オプトインが必要だと書いています。いつ既定になるかは、読んだページには書かれていませんでした。既定が変わる日に、DynamoDB を呼ぶ関数の最悪の所要時間は黙って伸びます。そこで、この本のクライアントには試行回数とモードを書いておきます。32章がそうした理由も同じです。

### 再試行されるもの

SDK は、失敗を 3 つに分けます。スロットリング、一時的な失敗、それ以外です。再試行するのは前の 2 つだけです。

スロットリングと見なすのは、ステータスが 429 の応答と、エラーのコードが決まった一覧に入っている応答です。一覧には `ThrottlingException`、`ProvisionedThroughputExceededException`、`RequestLimitExceeded`、`SlowDown` など 14 個があります。DynamoDB のスロットリングは、ステータス 400 で返るので、コードで見分けています。

一時的な失敗と見なすのは、ステータス 500、502、503、504 の応答、タイムアウト、そして接続の失敗です。接続の失敗には、接続の拒否やリセット、名前解決の失敗が入ります。

それ以外、つまり入力の誤りや権限の不足、条件付き書き込みの失敗は、1 回で呼び出し元に返ります。次の表は、手元のエンドポイントにその答えを返させて、届いたリクエストを数えた結果です。

| 答え | 届いたリクエスト |
| --- | --- |
| 400 `ProvisionedThroughputExceededException`、`ThrottlingException`、`RequestLimitExceeded` | 3 |
| 429、コードは一覧にないもの | 3 |
| 500、503 | 3 |
| 接続の拒否 | 3 回試行（届いてはいない） |
| 400 `ValidationException`、`ConditionalCheckFailedException`、`ResourceNotFoundException`、`TransactionConflictException`、`AccessDeniedException` | 1 |

1 つ注意があります。送る本文がストリームのときは、どんな失敗でも再試行されません。ストリームは 2 度読めないからです。S3 の `PutObject` に Node.js のストリームを渡して 500 を返させると、届いたリクエストは 1 件でした。同じ内容をバイト列で渡すと 3 件です。

サービスが `x-amz-retry-after` ヘッダーで待ち時間（ミリ秒）を指定してきたときは、SDK はそれに従います。ただし、自分で計算した待ち時間より短くはならず、それに 5 秒を足した値より長くもなりません。リファレンスは、この扱いを新しい動作の説明の中に書いていますが、導入済みの版は、オプトインしなくても従います。テストで確かめました。

### 再試行の予算

再試行のたびに、クライアントは 500 の予算から費用を引きます。足りなければ、試行回数が残っていても再試行しません。成功すれば戻します。再試行のあとの成功なら引いたぶんを、最初の試行での成功なら 1 を戻します。

テストでは、スロットリングだけを返すエンドポイントに、乱数を 0 に固定して呼び続けました。3 回試行して失敗する呼び出しは、再試行 2 回ぶんの 10 を使います。50 回で予算は空になり、51 回目の呼び出しは 1 回送っただけで返ってきました。そのあと 5 回成功させると、次の失敗では再試行が 1 回だけ戻りました。

予算はクライアントごとです。同じエンドポイントに向いた別のクライアントは、満額から始まります。プロセスをまたいで共有されることもありません。Lambda なら、実行環境ごとに別の予算を持ちます。アカウント全体の再試行の量を抑える仕組みではない、ということです。

`retryStrategy` を自分で渡すと、`retryMode` と `maxAttempts` は無視されます。SDK のドキュメントにそうあります。モードには `adaptive` もありますが、32章に書いたとおり一般の既定には向かないので、この章では動かしていません。

## タイムアウトと中断

<!-- section: 48.timeouts -->

固定している版のクライアントには、**既定のタイムアウトが 1 つもありません。** 接続にも、応答を待つ時間にも、ソケットの無通信にも、上限がありません。`defaults.ts` の `http` の 3 つが `null` なのは、その意味です。リクエストを受け取ったきり答えないエンドポイントにつなぐと、既定のクライアントは、呼んだ側が諦めるまで待ち続けました。Lambda の中では、関数のタイムアウトまで待つことになります。

設定はリクエストハンドラーにあります。

| 設定 | 計るもの |
| --- | --- |
| `connectionTimeout` | TCP の接続ができるまで |
| `requestTimeout` | リクエストを送り始めてから、応答のヘッダーが届くまで |
| `socketTimeout` | ソケットに何も流れない時間 |

`requestTimeout` には落とし穴があります。固定している版では、この値を過ぎても警告を 1 行出すだけで、呼び出しは続きます。エラーにするには `throwOnRequestTimeout: true` を一緒に指定します。型定義のコメントによると、`requestTimeout` が長いあいだ誤ってソケットの無通信の時間として扱われていたため、互換性のために、エラーにするほうをオプトインにしたそうです。テストで、`requestTimeout` だけを 50 ミリ秒にしたクライアントが、300 ミリ秒たっても待ち続けていること、警告が出ていることを確かめました。

`throwOnRequestTimeout` を付けると、時間切れは `TimeoutError` になります。これは一時的な失敗なので、再試行されます。答えないエンドポイントに対しては、3 回の試行がそれぞれ時間切れになり、3 本の接続が使い捨てられました。

`requestTimeout` が計るのは応答のヘッダーまでです。本文をストリームで受け取るときの、読み終わるまでの時間は含みません。

この章のクライアントは、試行回数とタイムアウトを 1 つの方針として持ちます。

<<< @/examples/48-sdk/src/call-policy.ts{policy}

<<< @/examples/48-sdk/src/call-policy.ts{config}

`defaultsMode` を `standard` などにすると、SDK が接続のタイムアウトを自分で選びます。ソースでは `standard` が 3,100 ミリ秒、`in-region` が 1,100 ミリ秒でした。応答を待つ時間は、どのモードでも設定されません。この章では、モードに任せず、数字を書きます。

方針を数字で持っておくと、1 回の `send` が最悪でどれだけかかるかを計算できます。すべての試行が時間切れになり、あいだの待ちがすべて最長だった場合です。待ち時間は 32章の関数で出します。

<<< @/examples/48-sdk/src/call-policy.ts{worst-case}

上の方針では、いまの動作で 7.5 秒（2 秒が 3 回と、待ちが最長 1.5 秒）、2026 年の動作で 9 秒です。32章の関数のタイムアウトは 10 秒なので、どちらでも収まります。試行を 4 回にすると、2026 年の動作では 15 秒になり、収まりません。DynamoDB のクライアントに試行回数を書いておくのは、既定が 4 回に変わった日に、この計算が黙って崩れないようにするためです。

`connectionTimeout` の挙動は、この章では確かめていません。手元では接続がすぐに成立するか、すぐに拒否されるかのどちらかで、接続だけが長くかかる状況を作れなかったからです。

### AbortSignal

`send` の 2 つ目の引数に `abortSignal` を渡すと、呼ぶ側から打ち切れます。`AbortSignal.timeout(ms)` を渡せば、試行をまたいだ全体の期限になります。タイムアウトの設定が試行 1 回ごとの上限なのに対して、こちらは `send` 1 回の上限です。

打ち切られた呼び出しは `AbortError` で終わり、再試行されません。答えないエンドポイントに 50 ミリ秒の期限で呼ぶと、届いたリクエストは 1 件で、すぐに返ってきました。

ただし、再試行の前の待ち時間は、打ち切りでは短くなりません。スロットリングを返すエンドポイントに、最初の待ちが 400 ミリ秒になるよう乱数を固定し、100 ミリ秒の期限で呼んだところ、`AbortError` が返ったのは約 400 ミリ秒後でした。打ち切りに気づくのは、待ちが明けて次の試行を始めるときです。期限をきっちり守りたいなら、待ち時間の上限まで見込んでおく必要があります。新しい動作ではスロットリングのあとの待ちが最長 1 秒、2 秒と伸びるので、この差も大きくなります。

打ち切った時点で、サービスがその操作を実行したかどうかはわかりません。リクエストが届いたあとで応答を待っているあいだに打ち切れば、書き込みは済んでいるかもしれません。05章の条件付き書き込みのように、同じ操作をもう一度送っても結果が変わらない形にしておくことが、ここでも効きます。

### 接続の再利用

リクエストハンドラーは、接続を開いたままにして使い回します。既定で keep-alive が有効で、同時に開く接続は 1 つの行き先につき 50 本までです。それを超えた呼び出しは、空くまで待ちます。

テストで、続けて 3 回呼ぶと接続が 1 本で済むこと、上限を 2 本にして 6 回同時に呼ぶと 2 本で順に運ばれること、クライアントを 2 つ作ると接続も 2 本になることを確かめました。クライアントを呼び出しのたびに作ると、そのたびに接続と TLS のやり直しになります。関数の外で 1 つだけ作る理由の半分は、ここにあります。Lambda での効き方は [29章](/ja/chapters/29-lambda-tuning.md)にあります。

## エラー

<!-- section: 48.errors -->

サービスが 2xx 以外を返すと、SDK は例外を投げます。例外はクラスで、サービスごとの基底クラス（`DynamoDBServiceException`）を継承しています。モデルに載っているエラーには、それぞれのクラスがあります（`ConditionalCheckFailedException`）。載っていないコードが返ってきたときは、基底クラスのインスタンスになり、`name` にそのコードが入ります。これをサービス例外（service exception）と呼びます。

例外が持っているのは、次のフィールドです。

| フィールド | 中身 |
| --- | --- |
| `name` | エラーのコード |
| `$fault` | `client` か `server`。リクエストとサービスのどちらに原因があるか |
| `$metadata.httpStatusCode` | ステータス |
| `$metadata.requestId` | サービスが振ったリクエスト ID |
| `$metadata.attempts`、`totalRetryDelay` | 試行回数と、再試行の前に待った合計 |
| `$retryable` | モデルが「再試行できる」と宣言しているエラーにだけある |

`$retryable` は当てにできません。固定している版の DynamoDB のクライアントで、このフィールドを宣言しているクラスは `ReplicatedWriteConflictException` だけでした。`ThrottlingException` にも `ProvisionedThroughputExceededException` にもありません。SDK 自身も、スロットリングかどうかは、前の節で見たとおりコードの一覧とステータスで判断しています。

エラーを見分けるときに読むのは、クラス、`name`、`$fault`、`$metadata` です。`message` は読みません。人が読むための文で、いつ変わってもおかしくないからです。

見分け方は 2 段にします。1 段目は、そのアプリにとって意味のあるエラーで、クラスで受けます。05章のリポジトリが `ConditionalCheckFailedException` を `instanceof` で受けて「上限に達した」「誰かが先に更新した」に読み替えているのが、これです。SDK のドキュメントによると、基底クラスは `Symbol.hasInstance` を上書きしていて、パッケージが二重に入っていても `instanceof` が効くようになっています。

2 段目は、残りすべてです。アプリにとっての意味はなく、知りたいのは「待てば通るのか」だけです。ここは、SDK が再試行のために使っているのと同じ関数に尋ねます。自分でコードの一覧を持つと、SDK の一覧とずれるからです。

<<< @/examples/48-sdk/src/errors.ts{classify}

`isThrottlingError` と `isTransientError` は `@smithy/core/retry` が export している関数です。クライアントのパッケージ自身が使っている入口ですが、アプリから呼ぶことを案内したドキュメントは見つけていません。版を固定し、テストで結果を確かめたうえで使っています。

この分類が要る理由は、32章の最後に書いた問題です。SDK の再試行が尽きると例外はアプリまで上がり、05章のアプリはそれを 500 にします。呼び出し元からは、不具合なのか、待てば通るのかがわかりません。分類があれば、待てば通る失敗を 503 と `Retry-After` で返せます。

<<< @/examples/48-sdk/src/errors.ts{answer}

`Retry-After` の 1 秒は、この章が決めた値です。サービスの側が指定した待ち時間を読んで伝えることは、していません。
