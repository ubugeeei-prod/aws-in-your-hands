---
title: "19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics"
revision: 5
---

# 19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics

04章から、API はリクエスト 1 件につき 1 行の JSON をログに書き、レスポンスに `x-request-id` を付けてきました。ただ、ログは誰かが見にいかないかぎり何も知らせてくれません。

この章では、異常に気づけるようにすることと、気づいたあとに原因まで辿れるようにすることの 2 つを扱います。[05章](/ja/chapters/05-dynamodb.md)のノート API を題材に、アラーム、ログの調べ方、トレースを足していきます。05章のアプリのコードは 1 行も変えず、外側から包みます。

料金もこの章の主題です。観測のための道具は、何も考えずに足していくと、観測される本体より高くつきます。ログを 1 行増やすといくらかかるかまで、[最後のページ](/ja/chapters/19-observability/wrap.md)で計算します。

前提は [04章](/ja/chapters/04-http-api.md)です。コードは `examples/19-observability/` にあります。

## 全体像

<!-- section: 19.overview -->

```figure
caption: リクエストの通り道からメトリクスが出て、アラームは SNS を通してメールで知らせる
node client: Browser / curl
node api: API Gateway HTTP API
node fn: Lambda | 05章で作ったアプリ
node metrics: CloudWatch Metrics | Count, 4xx, 5xx, Latency
node table: DynamoDB テーブル
node alarms: Alarms | 5xx rate, p95 latency
node dashboard: ダッシュボード | 原因: throttles, server errors
node sns: SNS topic
node email: email
edge client -> api: HTTPS（traceparent ヘッダー、任意）
edge api -> fn
edge api --> metrics: メトリクス
edge fn -> table
edge metrics -> alarms
edge table --> dashboard: メトリクス
edge alarms -> sns: ALARM / OK
edge sns -> email
```

```figure
caption: Lambda はログを CloudWatch Logs へ、トレースを X-Ray へ送る
node fn: Lambda | Node.js 24, active tracing
node logs: CloudWatch Logs | JSON のイベント、7 日保存
node xray: X-Ray | サンプリング: 毎秒最初の 1 件 + 5%
node insights: Logs Insights のクエリ | requestId, traceId, errors, slow
node filter: メトリクスフィルター | status = 409
node conflicts: NoteConflicts metric
edge fn --> logs: ログ: どの行にも traceId
edge fn --> xray: トレース: リクエストごと、テーブルの呼び出しごとにスパン
edge logs -> insights
edge logs -> filter
edge filter -> conflicts
```

使う道具はメトリクス、ログ、トレースの 3 種類で、それぞれ答えられる問いが違います。

メトリクスは、リクエスト数、エラー数、応答時間のような、時刻ごとの数値です。いま異常が起きているかどうかがわかります。安く、長く残りますが、どのリクエストがおかしいのかまではわかりません。

ログは 1 件ごとの記録で、どのリクエストがどう失敗したかがわかります。詳しいぶん、書いた量に比例して料金がかかります。

トレース（trace）は、1 件のリクエストが通った道筋と、区間ごとにかかった時間の記録です。どこで時間を使ったかがわかります。ただし全件が残るわけではなく、この点は[トレースは一部しか残らない](/ja/chapters/19-observability/more.md)で詳しく扱います。

使う順番は、アラームで気づき、メトリクスとログで絞り込み、トレースで辿る、です。

### スタックを 05章から分けた理由

05章の `NotesStack` は、関数や API を外から触れる形では公開していません。アラームを付けるには関数の設定（トレースとログの形式）も変えたいので、この章では同じ形のテーブルと API を自前のスタックに持たせました。インフラの定義は 60 行ほど重複しますが、アプリのコードは 05章のものをワークスペースの依存としてそのまま読み込んでいます。監視の部分は `Monitoring` というコンストラクトに切り出してあるので、自分のスタックへ持っていけます。

この API も URL を知っていれば誰でも呼べるので、05章と同じ歯止めを付けています。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{bounds}

<<< @/examples/19-observability/infra/lib/observability-stack.ts{throttle}

API が受け付けるのは毎秒 10 件までで、テーブルには毎秒の request unit に上限があり、ノートは 05章と同じく 100 件までです。超えたぶんは請求にはならず、429 か 409 のレスポンスになります。上限に当たったときにダッシュボードでどう見えるか、料金がいくらで止まるかは、料金の節の[叩かれたら](/ja/chapters/19-observability/wrap.md)に書きました。

## 症状に付けるアラーム

<!-- section: 19.alarms -->

アラームは原因ではなく症状に付けます。利用者が困るのは、エラーが返ることと、応答が遅いことの 2 つです。DynamoDB のスロットリングは原因の 1 つにすぎず、利用者から見えるのは結局このどちらかです。原因ごとにアラームを作ると数が増え、鳴っても誰も見なくなります。

そこで、アラームは 2 つだけにしました。

<<< @/examples/19-observability/src/alarm-math.ts{rules}

1 つ目は 5xx の割合です。リクエストが増えれば失敗の数も増えるので、数ではなく割合を見ます。ただし割合だけで判断すると、深夜に 2 件届いて 1 件が失敗しただけで 50% になり、それで起こされることになります。これを避けるため、1 分あたり 20 件に満たないときは割合を 0 として扱います。

この条件を、CloudWatch の式と同じ意味の関数としても書いておきます。

<<< @/examples/19-observability/src/alarm-math.ts{point}

スタックは、この定数と式をそのまま使います。

<<< @/examples/19-observability/infra/lib/monitoring.ts{error-rate}

このコードには、見落としやすい設定が 2 つあります。

1 つは、5 分のうち 3 分という数え方です。`evaluationPeriods: 5` と `datapointsToAlarm: 3` を指定すると、直近 5 つのデータ点のうち 3 つが閾値を超えたときに鳴ります。3 つが連続している必要はありません。1 分だけ跳ねても鳴らず、異常が続いていれば 3 分ほどで鳴ります。

もう 1 つは、データが無い 1 分の数え方です。リクエストが 1 件も無い 1 分には、データ点そのものがありません。CloudWatch はこれを欠損として扱い、どう数えるかを `treatMissingData` で選ばせます。既定の `missing` では、すべてが欠損のときアラームは `INSUFFICIENT_DATA` になります。`breaching` にすると、誰も使っていない夜に毎晩鳴ります。ここでは、欠損を問題なしと数える `notBreaching` にしました。公式ドキュメントも、エラーのときだけ値が出るメトリクスには `notBreaching` を勧めています。

テストでは、この判断が崩れる入力を与えて確かめます。

<<< @/examples/19-observability/src/alarm-math.ts{state}

`alarmState` は、条件を考えるための模型です。CloudWatch 自身は、データが欠けているときに 5 点より前まで遡って評価しますが、模型はそこを再現していません。それでも、静かな夜に鳴らないこと、`breaching` にすると毎晩鳴ること、1 分の跳ねでは鳴らないことは、この模型で確かめられます。

模型からわかる限界も 1 つあります。**静かな夜と、誰も到達できない障害は、このアラームからは同じに見えます。** どちらもリクエストが届かず、データ点がないからです。この 2 つを見分けるには、外から定期的に API を呼ぶ仕組みが要ります。[デプロイのページ](/ja/chapters/19-observability/deploy.md)で紹介する Synthetics がそれです。

2 つ目のアラームは遅さに付けます。

<<< @/examples/19-observability/infra/lib/monitoring.ts{latency}

平均は、速い大多数に遅い少数が埋もれてしまうので、p95（95 パーセンタイル）を見ます。測る対象は Lambda の `Duration` ではなく、API Gateway の `Latency` です。`Duration` にはコールドスタートの時間が入らないので、利用者が待った時間に近いのは入口で測った値のほうです。

### 通知先

<<< @/examples/19-observability/infra/lib/monitoring.ts{topic}

<<< @/examples/19-observability/infra/lib/monitoring.ts{actions}

アラームは SNS のトピックに通知し、トピックがメールに配ります。メールアドレスが購読されるのは、デプロイのときにアドレスを渡した場合だけです。購読は、届いた確認メールのリンクを押すまで保留のままなので、押し忘れると、アラームが鳴っても何も届きません。

`enforceSSL` は、暗号化されていない経路からの publish を断る設定です。これを付けるとトピックにポリシーが 1 つでき、自分のポリシーを持ったトピックは既定のポリシーを使わなくなります。そのため、このアカウントの CloudWatch アラームに publish を許すステートメントを、こちらで書き足しています。書き忘れると、アラームは鳴るのに通知が出ません。この組み合わせは、まだ実際の AWS で確かめられていません。

アラームが OK に戻ったときも通知します。障害がいつ終わったかも知りたいからです。

## 最初に見る数字

<!-- section: 19.metrics -->

アラームが鳴ったら、ダッシュボードを開きます。上の段に症状を、下の段に原因の候補を並べてあります。

<<< @/examples/19-observability/infra/lib/monitoring.ts{dashboard}

サービスごとに、最初に見るメトリクスを挙げます。

API Gateway HTTP API では、`Count`、`4xx`、`5xx`、`Latency`、`IntegrationLatency` を見ます。`Latency` はリクエストを受け取ってからレスポンスを返すまでの時間で、`IntegrationLatency` はそのうち Lambda を待っていた時間です。2 つの差が大きければ、API Gateway の側で時間を使っています。ルートごとの数字は、詳細メトリクスを有効にしないと出ません。ステージのスロットリングで断られたリクエストは 429 なので、`4xx` に入ります。ダッシュボードの線の名前にも、そう書いてあります。

Lambda では、`Errors`、`Throttles`、`Duration`、`ConcurrentExecutions` を見ます。注意が要るのは `Errors` です。`Errors` が数えるのは、関数が例外で終わった呼び出しとタイムアウトだけです。このアプリは例外を捕まえて 500 のレスポンスを返すので、利用者に 500 が返っていても、Lambda の `Errors` は 0 のままです。症状のアラームを API Gateway の `5xx` に付けたのはこのためです。反対に `Errors` が増えていたら、タイムアウト、初期化の失敗、メモリ不足のような、アプリの外の原因を疑います。`Throttles` は `Invocations` にも `Errors` にも数えられないので、別に見ます。

DynamoDB では、`ThrottledRequests`、`SystemErrors`、`ConditionalCheckFailedRequests` を見ます。`ConditionalCheckFailedRequests` は、05章の楽観ロックが働いた回数です。`ThrottledRequests` は、テーブルに付けた上限に当たったときにも増えます。

ダッシュボードは 1 つで、参照するメトリクスは 50 個以内に収めています。無料枠に入るのがそこまでだからで、この上限はテストで見張っています。
