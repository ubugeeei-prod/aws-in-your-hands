---
title: "69 Web Functions: しくみと実装"
---

# 69 Web Functions: しくみと実装

[最初のページ](/ja/chapters/69-web-functions.md)で、04章のノート API がアダプターなしで Web Function になることを見ました。このページでは、Event Function やコンテナとの違い、サーバーの起動と停止、同時に処理中のリクエストの扱い、HTTP の細かい決まり、スタックの順に読みます。

## Event Function、Web Function、コンテナ

<!-- section: 69.model -->

HTTP の API を AWS で動かす形は、この本ですでに 2 つ出てきました。[04章](/ja/chapters/04-http-api.md)の Event Function と HTTP API、[12章](/ja/chapters/12-containers.md)の Fargate のコンテナと ALB です。Web Function は、コードの形ではコンテナに近く、料金と運用の形では Event Function に近い位置にあります。

| | Event Function と HTTP API | Web Function | Fargate のコンテナ |
| --- | --- | --- | --- |
| コードの形 | イベントを受けるハンドラー | ポートで待ち受けるサーバー | ポートで待ち受けるサーバー |
| HTTP の入口 | API Gateway | エンドポイント | ALB |
| 1 つの実行環境が同時に受けるリクエスト | 1 | 既定 64、上限 128 | アプリが決める |
| リクエストが無いとき | 実行環境は 0 | 実行環境は 0 | タスクが動き続ける |
| 料金の軸 | リクエストと実行時間 | リクエスト、CPU 時間、環境が存在するあいだのメモリ | タスクが動いている時間 |
| デプロイの単位 | バージョンとエイリアス | リビジョンとエンドポイントの重み | タスク定義とサービス |

04章から消えるのは、API Gateway と、`src/http/api-gateway.ts` のアダプターです。API Gateway がしていた仕事のうち、スロットリングはエンドポイントの `rateLimit` が引き受けます。CORS のプリフライトに答える仕事は、Lambda が何も足さないのでアプリに残ります。04章のアプリはもともと自分でも答えていたので、コードは変わりません。独自ドメイン、WAF、キャッシュは、エンドポイントの前に CloudFront を置いて足します。

かわりに増えるのが、リビジョンとエンドポイントです。Event Function では、関数の設定を書き換えるとその場で反映され、戻せるようにするにはバージョンとエイリアスを自分で用意しました（[31章](/ja/chapters/31-progressive-delivery.md)）。Web Function では、コードと設定のどちらを変えるにも新しいリビジョンを作り、どのリビジョンにリクエストを流すかはエンドポイントが持ちます。戻す先が最初から残るかわりに、「設定を 1 つだけ変える」という操作がありません。新しいリビジョンは前のリビジョンから何も引き継がないので、環境変数もタイムアウトも、毎回すべて書きます。

プログラムの書き方で変わるのは 1 点です。ハンドラーは呼ばれるたびに 1 つのイベントを処理して終わりましたが、サーバーは起動したら動き続け、複数のリクエストを同時に処理します。

## サーバーを起動して、止める

<!-- section: 69.server -->

Lambda とサーバーのあいだの決まりは、アドレス、起動の期限、停止の合図の 3 つです。

```figure
caption: 実行環境の一生。Lambda は接続を受け付けたことで起動を知り、SIGTERM で終わりを伝える
type: sequence
actor lambda: Lambda
actor server: サーバーのプロセス
step lambda -> server: 起動、アドレスを渡す
step server -> server: listen
step lambda -> server: 接続できるか（10 秒以内）
note server: Ready
step lambda -> server: リクエスト（同時に複数）
step lambda -> server: SIGTERM
step server -> server: 1 秒以内に終了
```

待ち受けるアドレスは Lambda が決め、`AWS_LAMBDA_HTTP_ENDPOINT` に `host:port` の形で入れます。この変数はリビジョンの環境変数には書けません。サーバーがほかのホストやポートで待ち受けると、リクエストは届かず、最初のリクエストが 502 になります。

<<< @/examples/69-web-functions/src/listen.ts{listen}

変数が無いときだけ `127.0.0.1:8787` を使うのは、手元で動かすためです。値があるのに読めないときは、既定のアドレスに逃げずに止まります。読めない値のまま起動すると、Lambda から見て起動に失敗したのと同じ結果になり、原因が見えにくくなるからです。

起動の期限は 10 秒です。Lambda はコードを読み込み、プロセスを起動し、このアドレスに接続できるようになった時点で実行環境を Ready にします。`serve` は、ソケットが接続を受け付けるようになってから結果を返します。

<<< @/examples/69-web-functions/src/serve.ts{serve}

ここで覚えておくことが 1 つあります。Lambda は、リビジョンを作るときにも、エンドポイントを更新するときにも、サーバーが起動するかどうかを確かめません。リビジョンとエンドポイントが Active でも、エントリファイルの名前が違えば、最初のリクエストで初めて失敗します。デプロイのたびにリクエストを 1 つ送って確かめる、という手順が要るのはこのためです。

停止は SIGTERM で始まります。Lambda は実行環境を減らすとき、まずその環境にリクエストを送るのをやめ、処理中のリクエストが終わるのをできる範囲で待ってから、SIGTERM を送ります。プロセスに残された時間は 1 秒です。

<<< @/examples/69-web-functions/src/serve.ts{budget}

`stop` は、新しい接続を断り、開いているリクエストが終わるのを 800 ミリ秒まで待ち、過ぎたら接続を切ります。待つ場合と切る場合を、時計を手で進めるテストで確かめています。

<<< @/examples/69-web-functions/test/shutdown.test.ts{drained}

<<< @/examples/69-web-functions/test/shutdown.test.ts{cut}

公式ドキュメントは、停止の処理に頼らないように書いています。ハードウェアの故障のように、SIGTERM が届かない終わり方があるからです。残さなければならないデータは、リクエストの処理のなかで外のストアに書きます。このアプリの SIGTERM の処理がしているのは、答えかけの応答を最後まで送ることだけです。

## 1 つの実行環境で、複数のリクエスト

<!-- section: 69.concurrency -->

この章の不変条件は次の 1 文です。

> あるリクエストの処理が読むリクエスト単位の値は、同じ実行環境で同時に処理中の、ほかのリクエストの値にならない。

Event Function では、この条件は実行環境が守ってくれました。1 つの実行環境に同時に入るリクエストは 1 つなので、リクエスト ID をモジュールの変数に置いても、次のリクエストが来るまで誰も書き換えません。Web Function では、あるリクエストが `await` で待っているあいだに、同じプロセスが次のリクエストを処理し始めます。

04章のアプリは、リクエスト単位の値を `context` という引数で渡しているので、そのままで条件を満たします。壊れるのは、ハンドラーから遠いコードが、引数ではなく共有の置き場所から値を読むときです。35章では、ノートの変更を 1 行ずつログに残す `audited` と、値の置き場所を 2 通り用意しました。モジュールの変数に置く `moduleScope` と、`AsyncLocalStorage` に置く `asyncScope` です。この章のアプリは、その 2 つを 35章から import して組み立てます。

<<< @/examples/69-web-functions/src/app.ts{app}

35章と違うのは、リクエスト ID の出どころです。Web Function では、Lambda が転送するリクエストに `lambda-web-request-id` というヘッダーを付け、同じ値をレスポンスにも付けます。アプリはこの値をそのまま自分のリクエスト ID にするので、呼び出した側が受け取った ID で、アプリのログも Lambda のログも探せます。

<<< @/examples/69-web-functions/src/app.ts{headers}

呼び出す側が自分で付けた `lambda-web-` で始まるヘッダーは、Lambda が転送の前に取り除きます。手元ではその保証がないので、値が英数字とハイフン、下線だけでできた短い文字列のときに限って採用し、それ以外は自分で ID を作ります。

テストは、実際に待ち受けているサーバーに、ソケットを 2 本つないで行います。リクエスト A が書き込みの途中で止まっているあいだにリクエスト B を処理させ、そのあとで A を進めます。

<<< @/examples/69-web-functions/test/server.test.ts{overlap}

<<< @/examples/69-web-functions/test/server.test.ts{invariant}

2 つ目のテストが、わざと間違えた版です。値の置き場所を `moduleScope` に替えると、A のノートを保存したのは B だとログに残ります。どちらのリクエストも正しい応答を受け取り、レスポンスの ID も合っているので、外からは気づけません。Event Function から移すコードに `let currentRequestId` のような変数があれば、同じことが起きます。

リクエスト単位の値のほかにも、プロセスを共有することで変わる点があります。

モジュールの変数に置いたキャッシュや SDK のクライアントは、リクエストをまたいで残り、同時に処理中のリクエストすべてが使います。これは望ましい性質で、接続を使い回せます。ただし、`await` をはさんで「読んで、変えて、書く」処理は、あいだに別のリクエストが割り込みます。このアプリのノートは 04章と同じくメモリ上の `Map` で、上限の検査と書き込みのあいだに `await` が無いので割り込まれませんが、[05章](/ja/chapters/05-dynamodb.md)のようにストアを外に出すと、条件付き書き込みが必要になります。

データベースへの接続の数は、実行環境の数とプールの大きさの積になります。Event Function では実行環境 1 つにつき接続は 1 本で足りましたが、Web Function では 1 つの実行環境が最大で 64 のリクエストを同時に処理するので、プールを持つ意味があります。ファイルディスクリプターは実行環境ごとに 1,024 までです。

CPU を使う処理は、同じ実行環境のすべてのリクエストを待たせます。Node.js は JavaScript を 1 本のスレッドで実行するので、大きな JSON の解析や同期のファイル読み込みが続くあいだ、ほかのリクエストは進みません。実行環境には vCPU が 2 つありますが、2 つ目を使うには `worker_threads` が要ります。もう 1 つの手段は、リビジョンの `maxConcurrencyPerEnvironment` を下げて、1 つの実行環境に入るリクエストを減らすことです。

`/tmp` は 512 MB で、これも同時に処理中のリクエストが共有します。一時ファイルの名前は、リクエストごとに変えます。

## HTTP の決まり

<!-- section: 69.http -->

エンドポイントが受け付けるのは HTTP/1.1 で、メソッドは GET、HEAD、POST、PUT、PATCH、OPTIONS、DELETE です。Lambda は TLS を終端し、メソッド、パス、クエリ文字列、ボディ、ほとんどのヘッダーをそのまま転送します。`Host` はエンドポイントのドメイン名のまま届き、`X-Forwarded-For` の最後の値が、Lambda に接続してきた相手のアドレスです。それより前の値は呼び出す側が書いたもので、検証されていません。

リクエストヘッダーは、リクエスト行と合わせて 128 KiB までで、超えると Lambda が 431 を返します。ボディの大きさの上限は、読んだ範囲の公式ドキュメントには書かれていませんでした。WebSocket への切り替えはできません。

レスポンスは、サーバーが書いた分から呼び出す側に届きます。[17章](/ja/chapters/17-ai.md)では、できた分から返すために function URL とレスポンスストリーミングの設定を使いましたが、Web Function に設定はありません。04章の `nodeServer` はボディをためずに流すので、`ReadableStream` を返すルートを足せば、そのままストリーミングになります。

リクエストの向きには、気をつける決まりが 1 つあります。Lambda は、リクエストのボディをすべて渡し終えてから、レスポンスを呼び出す側に届けます。ボディを読み終える前に書いたレスポンスは、誰も読まないボディを待って止まります。公式ドキュメントによると、1 MB ほどまでのボディはソケットのバッファーに収まるので、この問題は小さなリクエストでは表に出ません。

04章のアプリには、これに当たる場所があります。64 KiB を超えるボディを、`content-length` ヘッダーを見ただけで、1 バイトも読まずに 413 で断るところです。この章のアプリは、応答を返す前に、残りのボディを読み捨てます。

<<< @/examples/69-web-functions/src/app.ts{half-duplex}

手元の Node.js では、読み捨てなくても 413 は届きます。そのため、テストは「届くかどうか」ではなく、「ボディを最後まで受け取ってから届くか」を見ています。

<<< @/examples/69-web-functions/test/server.test.ts{upload}

長さを書かずにチャンクで送られたボディが途中で上限を超えた場合は、04章の部品がその場で読むのをやめるので、この読み捨ては効きません。Lambda の経路でそのとき何が起きるかは、確かめていません。

タイムアウトは、リビジョンの `timeoutSeconds` で 3 秒から 900 秒のあいだに決めます。既定は 30 秒で、このスタックは 04章と同じ 10 秒にしています。過ぎると Lambda が 504 を返しますが、ストリーミングの途中だった場合は、すでに送った状態コードのまま、ボディが途中で切れます。

Lambda が自分で返すエラーには、`lambda-web-error-type` というレスポンスヘッダーが付きます。値は `Platform.EndpointRequestThrottle` や `Runtime.RequestTimeout` のような形で、アプリが返した 429 と、Lambda が返した 429 を、このヘッダーの有無で見分けられます。

ログは、標準出力と標準エラー出力に書いたものがすべて CloudWatch Logs に送られます。Lambda は `console` の出力を JSON のログイベントに包み、`requestId`、`endpointName`、`region` を足します。ここに 04章のロガーとの相性の問題があります。04章のロガーは `JSON.stringify` した文字列を `console.log` に渡しますが、文字列は `message` の欄にエスケープされた 1 つの文字列として入り、中の欄で検索できません。オブジェクトのまま渡せば、`message` の下に JSON として入ります。

<<< @/examples/69-web-functions/src/log.ts{logger}

`release` という欄を足しているのは、Web Function のメトリクスにリビジョンの次元が無いからです。2 つのリビジョンに振り分けているあいだ、どちらが 5xx を出したのかは、メトリクスからはわかりません。アプリは、自分がどのアップロードから作られたかを環境変数 `RELEASE` で受け取り、ログの欄と `x-aih-release` というレスポンスヘッダーに出します。

<<< @/examples/69-web-functions/src/app.ts{compose}

## スタック

<!-- section: 69.stack -->

コードは、バージョニングを有効にした S3 バケットに zip で置きます。Web Function にコードを渡す方法はこれだけで、リビジョンは「このオブジェクトの、このバージョン」を指します。

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{code}

バケットポリシーが許可している相手は、Lambda のサービスそのものです。Lambda は、実行ロールとしてではなく、サービスとしてパッケージを読みに来ます。`aws:SourceArn` の条件で、読めるのをこの Web Function のリビジョンに限っています。条件を付けないと、Lambda がどの Web Function のために読みに来たのかを、バケットの側で区別できません。

リビジョンが指しているオブジェクトのバージョンは、そのリビジョンを使っているあいだ消してはいけません。消すとリビジョンは Failed になり、オブジェクトを置き直しても戻りません。

ロググループは 2 つ作ります。Lambda は、リクエストを処理したリージョンの `.local` という名前のロググループにまず書き、それをホームリージョンのロググループに集めます。リージョンが 1 つでも、ロググループは 2 つです。

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{logs}

実行ロールは、サーバーのコードが AWS を呼ぶときのロールです。このアプリが呼ぶのはログの書き込みだけなので、2 つのロググループへの書き込みしか許可していません。

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{role}

Web Function そのものは、名前を持つだけのリソースです。

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{function}

リビジョンには、設定をすべて書きます。省いた設定は、前のリビジョンの値ではなく既定値になります。

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{revision}

エンドポイントが、誰に、どれだけ答えるかを決めます。

<<< @/examples/69-web-functions/infra/lib/web-functions-stack.ts{endpoint}

`authType` は 2 つから選びます。`ApplicationManaged` では、Lambda は何も確かめずにすべてのリクエストをサーバーに渡します。04章の HTTP API と同じ、誰でも呼べる入口です。`IamAuth` では、Lambda が SigV4 の署名を確かめ、`lambda:InvokeWebFunctionEndpoint` を許可されたプリンシパルのリクエストだけを通します。このスタックは `IamAuth` にしています。練習用のエンドポイントを、開いたままインターネットに置かないためです。

ただし、`IamAuth` でもエンドポイントのドメイン名はインターネットから届きます。変わるのは、署名のないリクエストを Lambda が 403 で断ることで、ネットワークの上で閉じるわけではありません。同じアカウントのプリンシパルは、自分のポリシーに許可があれば呼べます。ほかのアカウントや CloudFront に呼ばせるときは、Web Function にリソースベースのポリシーを付けます。このスタックは付けていません。

`rateLimit` と `maxEnvironments` は、このスタックのブレーキです。

<<< @/examples/69-web-functions/src/names.ts{limits}

`rateLimit` は 1 秒あたりに受け付けるリクエスト数で、超えた分に Lambda が 429 を返します。[14章](/ja/chapters/14-kv-cache.md)で自分で数えたレート制限と違って、呼び出す側ごとではなく、エンドポイント全体の数です。`maxEnvironments` は実行環境の数の上限で、すべての実行環境が埋まると、やはり 429 になります。Lambda は待たせずにすぐ断ります。[32章](/ja/chapters/32-limits.md)で扱った API Gateway のスロットリングと予約済み同時実行数に当たるものが、エンドポイントの 2 つの設定になった形です。

どちらも、選べる値が決まっています。`rateLimit` は 0 か、100 から 1,000 までの 100 刻みか、2,000 から 10,000 までの 1,000 刻みで、04章の「1 秒に 10 件」のような細かい値は書けません。`maxEnvironments` は 2 以上です。範囲の外の値は、synth の段階で止めています。

<<< @/examples/69-web-functions/src/release.ts{limits}

暗号化は、何もしなくても有効です。コードと環境変数は、AWS が持つ鍵で保存時に暗号化されます。自分の KMS の鍵を使いたいときは、リビジョンに `kmsKeyArn` を書きます。環境変数に秘密を置かない、という原則は Event Function と変わりません。

VPC は使っていません。Web Function は Lambda の側のネットワークで動き、何も設定しなければ、インターネットの IPv4 の宛先にそのまま出ていけます。VPC の中のデータベースに届かせるには、egress network connector というリソースを作ってリビジョンから参照します。これは入口には関係がなく、エンドポイントを VPC の中に閉じる手段にはなりません。

スタックが作るリソースの種類は、テストで固定しています。

<<< @/examples/69-web-functions/infra/test/web-functions-stack.test.ts{types}

下の 3 つが、cdkd で作れない種類です。次は[手元で動かす](/ja/chapters/69-web-functions/local.md)に進みます。
