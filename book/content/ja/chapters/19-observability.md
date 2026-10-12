---
title: "19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics"
revision: 2
---

# 19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics

04章から、API は 1 リクエストにつき 1 行の JSON をログに書いて、応答に `x-request-id` を付けてきました。でも、誰かがログを見にいかないかぎり、何も起きません。

この章の問いは 2 つです。何かおかしい、と気づけるか。気づいたら、原因まで辿れるか。[05章](/ja/chapters/05-dynamodb.md)のノート API を題材に、アラーム、ログの調べ方、trace を足していきます。アプリのコードは 05章のものを 1 行も変えずに、外側から包みます。

もう 1 つ、この章の主題は料金です。観測のための道具は、黙っていると本体より高くなります。「ログを 1 行増やすといくらか」を、最後に計算します。

前提は [04章](/ja/chapters/04-http-api.md)です。コードは `examples/19-observability/` にあります。

## 全体像

<!-- section: 19.overview -->

```figure
caption: リクエストの通り道から metric が出て、alarm は SNS を通して email で知らせる
node client: Browser / curl
node api: API Gateway HTTP API
node fn: Lambda | 05章で作った Hono app
node metrics: CloudWatch Metrics | Count, 4xx, 5xx, Latency
node table: DynamoDB table
node alarms: Alarms | 5xx rate, p95 latency
node dashboard: dashboard | 原因: throttles, server errors
node sns: SNS topic
node email: email
edge client -> api: HTTPS（traceparent header、任意）
edge api -> fn
edge api --> metrics: metrics
edge fn -> table
edge metrics -> alarms
edge table --> dashboard: metrics
edge alarms -> sns: ALARM / OK
edge sns -> email
```

```figure
caption: Lambda は log を CloudWatch Logs へ、trace を X-Ray へ送る
node fn: Lambda | Node.js 24, active tracing
node logs: CloudWatch Logs | JSON の event、7 日保存
node xray: X-Ray | sampling: 毎秒最初の 1 件 + 5%
node insights: Logs Insights の query | requestId, traceId, errors, slow
node filter: metric filter | status = 409
node conflicts: NoteConflicts metric
edge fn --> logs: logs: どの行にも traceId
edge fn --> xray: traces: request ごと、table 呼び出しごとに span
edge logs -> insights
edge logs -> filter
edge filter -> conflicts
```

道具は 3 種類で、答える問いが違います。

**メトリクス**は時刻ごとの数値です。リクエスト数、エラー数、応答時間。「いま、おかしいか」に答えます。安くて、ずっと残ります。そのかわり、どのリクエストがおかしいのかは教えてくれません。

**ログ**は 1 件ごとの記録です。「どのリクエストが、どう失敗したか」に答えます。詳しいぶん、量に比例してお金がかかります。

**trace** は 1 件のリクエストが通った道筋と、区間ごとの時間です。「どこで時間を使ったか」に答えます。全部は残りません。これは後で大事になります。

順番は、気づく（アラーム）、絞る（メトリクスとログ）、辿る（trace）です。

### stack を 05章から分けた理由

05章の `NotesStack` は、関数や API を外から触れる形で公開していません。アラームを付けるには関数の設定（trace と、ログの形式）も変えたいので、この章は同じ形の table と API を自分の stack に持ちます。インフラの定義は 60 行ほど重複しますが、アプリのコードは workspace の依存として 05章のものをそのまま読み込んでいます。監視の部分は `Monitoring` という construct に切り出してあるので、あなたの stack に持っていけます。

同じ形なので、同じ歯止めも持たせています。この API も、URL を知っていれば誰でも呼べるからです。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{bounds}

<<< @/examples/19-observability/infra/lib/observability-stack.ts{throttle}

API は毎秒 10 件まで、table は毎秒の request unit に上限つき、ノートは 05章と同じく 100 件まで。超えたぶんは、請求ではなく 429 や 409 になります。これがダッシュボードでどう見えるか、いくらまでで止まるかは、「お金の話」の「叩かれたとき」で。

## まず、症状にアラームを付ける

<!-- section: 19.alarms -->

アラームは「原因」ではなく「症状」に付けます。利用者が困るのは、エラーが返ることと、遅いことです。DynamoDB が throttle したかどうかは原因の 1 つで、利用者から見えるのは結局その 2 つのどちらかです。原因ごとにアラームを作ると、数が増えて、鳴っても誰も見なくなります。

なので、アラームは 2 つだけにしました。

<<< @/examples/19-observability/src/alarm-math.ts{rules}

1 つ目は 5xx の割合です。数ではなく割合にしたのは、リクエストが増えれば失敗の数も自然に増えるからです。ただ、割合には落とし穴があります。深夜に 2 件来て 1 件が失敗すると「50%」です。これで起こされたくはないですよね。なので、1 分あたり 20 件に満たないときは、割合を 0 として扱います。

この条件を、CloudWatch の式と同じ意味の関数として書いておきます。

<<< @/examples/19-observability/src/alarm-math.ts{point}

stack はこの定数と式をそのまま使います。

<<< @/examples/19-observability/infra/lib/monitoring.ts{error-rate}

ここに設定が 2 つ隠れています。

**5 分のうち 3 分。** `evaluationPeriods: 5` と `datapointsToAlarm: 3` で、直近 5 つのデータ点のうち 3 つが閾値を超えたら鳴ります。連続している必要はありません。1 分だけの跳ねでは鳴らず、続いていれば 3 分ほどで鳴ります。

**データが無い分をどう数えるか。** リクエストが 1 件も無い 1 分には、データ点そのものがありません。CloudWatch はこれを「欠損」として扱い、どう数えるかを `treatMissingData` で選ばせます。既定の `missing` だと、全部が欠損のときアラームは `INSUFFICIENT_DATA` になります。`breaching` にすると、誰も使っていない夜に毎晩鳴ります。ここでは `notBreaching`（問題なし）です。公式ドキュメントも、エラーのときだけ値が出るメトリクスには `notBreaching` を勧めています。

テストは、この判断を壊そうとします。

<<< @/examples/19-observability/src/alarm-math.ts{state}

`alarmState` は、考えるための模型です。CloudWatch 自身は、データが欠けているとき、5 点より前まで遡って評価します。模型はそこを再現していません。それでも、「静かな夜に鳴らない」「`breaching` にしたら毎晩鳴る」「1 分の跳ねでは鳴らない」は、この模型で確かめられます。

そして、この模型が正直に示していることが 1 つあります。**静かな夜と、誰も到達できない障害は、このアラームからは同じに見えます。** どちらもリクエストが届かず、データ点がありません。これを見分けるには、外から定期的に呼ぶ仕組みが要ります（後で出てくる Synthetics です）。

2 つ目は遅さです。

<<< @/examples/19-observability/infra/lib/monitoring.ts{latency}

平均ではなく p95（95 パーセンタイル）を見ます。平均は、速い大多数に遅い少数が埋もれます。測るのは Lambda の `Duration` ではなく API Gateway の `Latency` です。`Duration` には cold start の時間が入りません。利用者が待った時間に近いのは、入口で測ったほうです。

### 通知先

<<< @/examples/19-observability/infra/lib/monitoring.ts{topic}

<<< @/examples/19-observability/infra/lib/monitoring.ts{actions}

アラームは SNS の topic に通知し、topic がメールに配ります。メールアドレスは、デプロイのときに渡したときだけ購読されます。購読は、届いた確認メールのリンクを押すまで保留のままです。押し忘れると、アラームは鳴っているのに何も届きません。

`enforceSSL` は、暗号化されていない経路での publish を断る設定です。これを付けると topic に policy が 1 つできます。そして policy を自分で持った topic は、既定の policy を使わなくなります。なので、「このアカウントの CloudWatch アラームは publish してよい」を、こちらで書き足しています。書き忘れると、アラームは鳴るのに通知が出ません。正直に言うと、この組み合わせはまだ実機で確かめられていません。

復旧（OK に戻ったとき）も通知しています。障害がいつ終わったかも、知りたい情報だからです。

## 最初に見る数字

<!-- section: 19.metrics -->

アラームが鳴ったら、ダッシュボードを開きます。上の段が症状、下の段が原因の候補です。

<<< @/examples/19-observability/infra/lib/monitoring.ts{dashboard}

サービスごとに、最初に見るものを並べます。

**API Gateway HTTP API。** `Count`、`4xx`、`5xx`、`Latency`、`IntegrationLatency`。`Latency` は受け取ってから返すまで、`IntegrationLatency` はそのうち Lambda を待っていた時間です。2 つの差が大きければ、API Gateway の側で時間を使っています。route ごとの数字は、詳細メトリクスを有効にしないと出ません。stage の流量制限で断ったリクエストは 429 なので、`4xx` に入ります。ダッシュボードの線にも、そう書いておきました。

**Lambda。** `Errors`、`Throttles`、`Duration`、`ConcurrentExecutions`。ここに罠があります。`Errors` が数えるのは、関数が例外で終わった呼び出しと、timeout です。このアプリは例外を捕まえて 500 の応答を返すので、利用者に 500 が返っていても、Lambda の `Errors` は 0 のままです。だから症状のアラームは API Gateway の `5xx` に付けました。逆に `Errors` が増えていたら、アプリの外（timeout、初期化の失敗、メモリ不足）を疑います。`Throttles` は `Invocations` にも `Errors` にも数えられないので、別に見ます。

**DynamoDB。** `ThrottledRequests`、`SystemErrors`、それと `ConditionalCheckFailedRequests`。最後のは 05章の楽観ロックが働いた回数です。`ThrottledRequests` は、table に付けた上限に当たったときにも増えます。

ダッシュボードは 1 つで、参照するメトリクスは 50 個以内に収めています。無料枠がそこまでだからです。テストがこの上限を見張っています。
