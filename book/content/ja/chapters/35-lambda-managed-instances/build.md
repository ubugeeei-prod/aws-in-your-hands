---
title: "35 Lambda Managed Instances: しくみと実装"
---

# 35 Lambda Managed Instances: しくみと実装

このページでは、先に実行モデルの違いと、その違いで壊れるコードを扱います。スタックの中身は後半です。[最初のページ](/ja/chapters/35-lambda-managed-instances.md)で全体の構成と料金を見てから読んでください。

## 1 つの実行環境が、同時に複数のリクエストを処理する

<!-- section: 35.concurrency -->

04章のハンドラーには、「実行環境ごとに 1 回動く。リクエストごとではない」というコメントが付いていました。標準の Lambda では、1 つの実行環境が処理するリクエストは一度に 1 つです。同時に 10 件来れば実行環境が 10 個になり、それぞれが 1 件ずつ処理します。だから、モジュールスコープに置いた変数を、処理中のリクエストが 2 つ同時に触ることはありませんでした。

Lambda Managed Instances では、1 つの実行環境が複数のリクエストを同時に処理します。Node.js のランタイムでは、ガイドによると次のようになります。

- 実行環境の中でワーカースレッド（worker thread）が起動し、関数の初期化は**ワーカースレッドごとに 1 回**実行される。スレッドの数は、既定では vCPU の数で決まる
- 1 つのワーカースレッドは、`async` のハンドラーなら、複数のリクエストを並行して処理する。あるリクエストが `await` で待っている間に、同じスレッドで別のリクエストが進む
- 1 つの実行環境に同時に送られるリクエストの上限は、Node.js では既定で 1 vCPU あたり 64 件

この章のハンドラーは、04章とほとんど同じです。

<<< @/examples/35-lambda-managed-instances/src/lambda.ts{handler}

`app` は、ワーカースレッドごとに 1 つ作られ、そのスレッドに来るすべてのリクエストに使い回されます。04章のアプリは、リクエストごとの値を `context` というオブジェクトに入れて引数で渡していたので、このままで問題ありません。問題になるのは、リクエストごとの値をモジュールスコープに置いているコードです。

04章の手元のサーバーは、最初から 1 つのプロセスで複数のリクエストを同時に処理していました。Node.js のサーバーとして見れば、同時実行はふつうのことです。標準の Lambda だけが、それを起こさない環境でした。

## モジュールスコープに置いたリクエスト ID

<!-- section: 35.leak -->

この章の不変条件は、「あるリクエストの処理が読む値は、そのリクエストのものである」です。これを壊すコードを、わざと書きます。

ノートを保存したり削除したりしたときに、どのリクエストがそうしたかをログに残したいとします。保存するのはリポジトリで、リクエスト ID を知っているのはアプリの入口です。引数で渡していくのが面倒なので、「いま処理中のリクエスト」を 1 つの変数に入れておき、必要な場所で読むことにします。

<<< @/examples/35-lambda-managed-instances/src/scope.ts{module-scope}

リポジトリを包んで、変更のたびにログを 1 行書きます。

<<< @/examples/35-lambda-managed-instances/src/audit.ts{audit}

アプリは 04章の `createApp` をそのまま使い、入口でリクエスト ID を決めて、その中でアプリを呼びます。

<<< @/examples/35-lambda-managed-instances/src/app.ts{app}

標準の Lambda なら、このコードは正しく動きます。リクエストが 1 つずつ来るかぎり、変数は常に処理中のリクエストを指しているからです。

2 つのリクエストが重なると、次のことが起きます。

```figure
caption: リクエスト A が書き込みを待っている間に B が来ると、変数は B を指し、A のログに B の ID が付く
type: sequence
actor a: Request A
actor env: 実行環境 | 1 つのスレッド
actor b: Request B
step a -> env: POST /notes
note env: current = req-A
step env -> env: await put(note)
step b -> env: GET /health
note env: current = req-B
step env --> b: 200, x-request-id: req-B
step env -> env: log "note stored" + current
step env --> a: 201, x-request-id: req-A
```

テストは、この順序をそのまま再現します。最初の書き込みを途中で止められるリポジトリを使い、A を書き込みの途中で待たせ、B を最後まで処理してから、A を再開します。

<<< @/examples/35-lambda-managed-instances/test/scope.test.ts{interleave}

<<< @/examples/35-lambda-managed-instances/test/scope.test.ts{leak}

A にも B にも、正しいリクエスト ID の付いたレスポンスが返ります。呼び出した側からは、何も壊れていないように見えます。壊れているのはログで、A が作ったノートが、B の仕事として記録されています。

この例で漏れるのはリクエスト ID だけですが、同じ形の変数に[06章](/ja/chapters/06-auth.md)のユーザーの identity を入れていれば、A のノートが B の持ち物として保存されます。データベースのトランザクション、リクエストごとのキャッシュ、言語やタイムゾーンの設定でも、同じことが起きます。負荷が低いうちはリクエストが重ならないので、テスト環境では再現せず、本番で負荷が上がったときにだけ起きる不具合になります。

## リクエストごとの値の置き場所

<!-- section: 35.fix -->

直し方は 2 つあります。

1 つは、04章のアプリがしているように、値を引数で渡すことです。関数の引数は呼び出しごとに別のものなので、混ざりようがありません。新しく書くコードなら、これがいちばん確かです。

もう 1 つは、`AsyncLocalStorage` を使うことです。Node.js に最初からある仕組みで、`run` の中で始まった処理は、`await` を何度またいでも、同じ値を読めます。Lambda のガイドも、書き換えのある値はグローバルに置かないか、`AsyncLocalStorage` を使うように書いています。引数を通す道がすでに無い、深い場所のコードには、こちらが向いています。

<<< @/examples/35-lambda-managed-instances/src/scope.ts{async-scope}

2 つの実装は同じ型を持っているので、アプリの側は 1 行も変わりません。同じ順序のテストが、今度は通ります。

<<< @/examples/35-lambda-managed-instances/test/scope.test.ts{fixed}

同じ 2 つの場合を、関数の呼び出しではなく本物のソケットでも確かめています。04章の `nodeServer` を 1 つ起動し、2 つの接続を同時に開きます。

<<< @/examples/35-lambda-managed-instances/test/server.test.ts

ここで確かめているのは、1 つの Node.js プロセスの中での振る舞いです。Lambda のランタイムがワーカースレッドにリクエストをどう配るかは、このテストには含まれていません。

## ワーカースレッドごとに別のモジュール

<!-- section: 35.threads -->

同時実行にはもう 1 つの軸があります。ワーカースレッドは、それぞれが自分のモジュールを読み込みます。モジュールスコープの変数は、スレッドの数だけ存在します。

04章のノート API は、ノートをメモリの中の `Map` に置いていました。04章では「実行環境ごとに 1 つの `Map`」でしたが、Lambda Managed Instances では「ワーカースレッドごとに 1 つの `Map`」になります。

<<< @/examples/35-lambda-managed-instances/src/app.ts{compose}

テストでは、Node.js の `worker_threads` で 2 本のスレッドを起こし、それぞれにアプリを読み込ませます。

<<< @/examples/35-lambda-managed-instances/test/threads.test.ts

1 本目のスレッドで作ったノートは、2 本目のスレッドからは見えません。これは、自分で起こしたスレッドでの確認で、Lambda のランタイムそのものではありません。ただ、ガイドの「初期化はワーカースレッドごとに 1 回」という記述から導かれる結果は、これと同じです。

ここから言えるのは、メモリの中の状態が、リクエストをまたいで使えるものではないことです。04章でもそうでしたが、Lambda Managed Instances では、実行環境が 1 つしかなくても成り立ちません。ノートを本当に保存するには、[05章](/ja/chapters/05-dynamodb.md)の DynamoDB のような、プロセスの外の置き場所が要ります。この章のスタックは、04章と同じメモリの中のリポジトリのままにしてあります。作ったノートが次のリクエストで見つからないことがあるのは、設計どおりの振る舞いです。

キャッシュのように、スレッドごとに別々でも困らないものは、モジュールスコープに置いてかまいません。AWS SDK のクライアントも、ガイドによると同時に使って安全です。データベースの接続は、1 本を共有すると問い合わせがぶつかるので、接続プールを使うように書かれています。

## タイムアウト、/tmp、ログ

<!-- section: 35.runtime -->

同時実行のほかにも、実行環境の振る舞いが標準の Lambda と違う点があります。この節の内容はガイドの記述で、実機では確かめていません。

**タイムアウトしても、コードは止まらない。** 設定したタイムアウトは、リクエスト 1 件ごとに適用されます。時間を超えると、Lambda は呼び出した側にタイムアウトのエラーを返しますが、コードの実行は打ち切りません。同じ実行環境で、ほかのリクエストがまだ動いているからです。タイムアウトしたリクエストは、ワーカーを 1 つ占めたまま裏で動き続けます。DynamoDB に書いた直後にタイムアウトし、呼び出した側が再試行すれば、同じ書き込みが 2 回起きます。[08章](/ja/chapters/08-async.md)で扱った冪等性が、ここでも要ります。長い処理では、`context.getRemainingTimeInMillis()` で残り時間を見て、自分で打ち切ります。

**`/tmp` は共有される。** 同じ実行環境のすべてのリクエストが、同じ `/tmp` を見ます。ファイル名にリクエスト ID を入れるなどして、ぶつからないようにします。

**ログは必ず JSON になる。** Lambda Managed Instances の関数は、常に構造化された JSON のログ形式を使い、`console` で書いた行にはリクエスト ID が付きます。複数のリクエストのログが混ざって出るのは、正常です。04章のロガーは最初から 1 行 1 つの JSON を書いているので、変更は要りません。

**使えないものがある。** Node.js 22 では、コールバック形式のハンドラーは使えません。X-Ray のトレース ID は、環境変数 `_X_AMZN_TRACE_ID` ではなく `context.xRayTraceId` から読みます。`process.on()` はワーカースレッドでは使えないので、関数のコードで SIGTERM を受けることはできません。

**実行環境は凍結されない。** 標準の Lambda は、リクエストの合間に実行環境を止めていました。Lambda Managed Instances の実行環境は、止まらずに動き続けます。

## スケーリングと、コールドスタートの代わりに起きること

<!-- section: 35.scaling -->

標準の Lambda は、空いている実行環境が無いときにリクエストが来ると、その場で新しい実行環境を作りました。これがコールドスタートです。リクエストは待たされますが、断られはしません。

Lambda Managed Instances は、リクエストが来たときには実行環境を増やしません。CPU の使用率と、実行環境がどれだけ同時実行の上限に近いかを見て、あとから非同期に増やします。コールドスタートが無いかわりに、増やすのが間に合わなければ、リクエストはスロットリングされて 429 が返ります。ガイドは、既定の設定で「5 分以内に負荷が 2 倍になる」ところまでは余裕を持たせてあり、それを超えるとスロットリングが起きうる、と書いています。発表の記事には、スケーリングなしで 50% の増加を吸収でき、新しいインスタンスは数十秒で起動する、とあります。どちらも AWS の記述で、この章では計測していません。

調整できる場所は、関数の側とキャパシティプロバイダーの側にあります。

- 関数の実行環境の最小と最大（`MinExecutionEnvironments`、`MaxExecutionEnvironments`）。既定の最小は 3 で、最大は決まっていません。このスタックは 3 と 6 にしています
- 1 つの実行環境が同時に受けるリクエストの上限（`PerExecutionEnvironmentMaxConcurrency`）。このスタックは指定していません
- キャパシティプロバイダーの vCPU の上限（`MaxVCpuCount`）。既定は 400 で、このスタックは 12 です
- スケーリングの目標にする CPU 使用率。既定は Lambda が決め、自分で決めることもできます

実行環境の最小と最大を両方 0 にすると、関数を消さずに止められます。止めた関数は、リクエストが来ても自動では戻りません。もう一度 0 でない値を設定するまで、止まったままです。

呼び出す側から見ると、コールドスタートの遅れがスロットリングの 429 に置き換わります。API Gateway の先にあるこのスタックでは、利用者に届くのはエラーのレスポンスです。再試行をどう設計するかは、[32章](/ja/chapters/32-limits.md)が扱います。

## キャパシティプロバイダーとネットワーク

<!-- section: 35.capacity-provider -->

ここからはスタックです。インスタンスは 11章の VPC のプライベートサブネットに置きます。

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{network}

セキュリティグループには、インバウンドの規則がありません。リクエストは Lambda のルーターからインスタンスに届きますが、ガイドの手順は、インバウンドの規則を足さないセキュリティグループをそのまま使っています。アウトバウンドは HTTPS だけです。

インスタンスが VPC の外に届く必要があるのは、ログを送るためです。ガイドは、関数が VPC の外のリソースを使うためと、CloudWatch Logs と X-Ray にテレメトリーを送るために、接続の設定が要ると書いています。11章のプライベートサブネットには、既定ではインターネットへの経路がありません。そこで、11章のスタックに CloudWatch Logs のインターフェースエンドポイントを足します。

<<< @/examples/35-lambda-managed-instances/src/network.ts{network}

経路が通っているかは、11章の経路のモデルで手元で確かめられます。確かめているのはモデルで、デプロイされた実物ではありません。ログのほかにインスタンスが届く必要のある宛先があるかどうかは、ドキュメントからは確認できませんでした。エンドポイントが 1 つだけのプライベートサブネットで関数が動き出すかは、デプロイして確かめるまでわかりません。

次に、オペレーターロールです。

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{operator-role}

Lambda は、このロールを引き受けてインスタンスを起動し、タグを付け、ネットワークインターフェースを作ります。付けているのは AWS が管理するポリシーの `AWSLambdaManagedEC2ResourceOperator` で、ガイドが「少なくともこれが要る」としているものです。中身は `ec2:RunInstances` や `ec2:CreateTags` などで、Lambda が管理するインスタンスに限る条件が付いています。インスタンスの終了は、このロールではなく、最初のキャパシティプロバイダーを作るときに自動でできるサービスリンクロールが行います。

もう 1 つ、スタックに現れない権限があります。関数をキャパシティプロバイダーに載せるには、デプロイする IAM identity に `lambda:PassCapacityProvider` が要ります。同じキャパシティプロバイダーに載った関数は互いに信頼できるものとして扱われるので、誰がどの関数を載せられるかを、この権限で絞ります。

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{capacity-provider}

インスタンスの種類は 1 つに絞ってあります。請求を前もって計算できるようにするためです。ガイドは、種類を絞ると空きが無いときに起動できなくなるので、Lambda に選ばせることを勧めています。本番では、この行を外すか、候補を増やします。

## 関数をキャパシティプロバイダーに載せる

<!-- section: 35.function -->

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{function}

関数の定義は、04章とほとんど同じです。違いは 3 つあります。

メモリは 2048 MB です。Lambda Managed Instances のいちばん小さい設定で、1 vCPU が付きます。04章は同じコードを 256 MB で動かしていました。

関数に `VpcConfig` はありません。VPC の中に置くのはキャパシティプロバイダーの仕事で、関数はキャパシティプロバイダーを指すだけです。

最後の `addFunction` が、関数に `CapacityProviderConfig` と `FunctionScalingConfig` を書き込みます。Lambda Managed Instances の関数は、バージョンを公開するまで動きません。`$LATEST.PUBLISHED` という特別なバージョンがあり、CloudFormation で作った関数では自動で公開されます。修飾子なしの ARN で関数を呼ぶと、`$LATEST` ではなく `$LATEST.PUBLISHED` が呼ばれます。

API Gateway の側は、04章と同じです。

<<< @/examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts{api}

## cdkd が作れるリソースか

<!-- section: 35.cdkd -->

固定している `aws-cdk-lib` 2.273.0 には、`lambda.CapacityProvider` という L2 のコンストラクトがあり、このスタックはそれを使っています。L1 に降りる必要はありませんでした。

cdkd 0.296.28 のほうは、インストールされたパッケージの中身を読んで確かめました。

- `AWS::Lambda::CapacityProvider` には専用の実装が無く、Cloud Control API 経由になります
- `AWS::Lambda::Function` には専用の実装がありますが、その実装は `CapacityProviderConfig` と `FunctionScalingConfig` を「未実装」として持っています。cdkd は、専用の実装が書けないプロパティを持つリソースを、自動で Cloud Control API 経由に切り替えます。つまり、この章の関数は、ほかの章の関数とは違う経路で作られます
- そのほかの種類（API Gateway、IAM、セキュリティグループ、ロググループ、`AWS::Lambda::Permission`）には専用の実装があります

スタックのテストは、使っているリソースの種類の一覧を固定しています。

<<< @/examples/35-lambda-managed-instances/infra/test/managed-instances-stack.test.ts{resource-types}

確かめたのは「cdkd がこの種類を扱う経路を持っている」ところまでです。Cloud Control API 経由で実際にキャパシティプロバイダーと関数ができるか、`$LATEST.PUBLISHED` が公開されるかは、デプロイしていないので未確認です。
