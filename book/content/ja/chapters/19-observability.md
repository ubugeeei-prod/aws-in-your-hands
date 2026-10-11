---
title: "19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics"
revision: 1
---

# 19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics

04章から、API は 1 リクエストにつき 1 行の JSON をログに書いて、応答に `x-request-id` を付けてきました。でも、誰かがログを見にいかないかぎり、何も起きません。

この章の問いは 2 つです。何かおかしい、と気づけるか。気づいたら、原因まで辿れるか。[05章](/ja/chapters/05-dynamodb.md)のノート API を題材に、アラーム、ログの調べ方、trace を足していきます。アプリのコードは 05章のものを 1 行も変えずに、外側から包みます。

もう 1 つ、この章の主題は料金です。観測のための道具は、黙っていると本体より高くなります。「ログを 1 行増やすといくらか」を、最後に計算します。

前提は [04章](/ja/chapters/04-http-api.md)です。コードは `examples/19-observability/` にあります。

## 全体像

<!-- section: 19.overview -->

```text
Browser / curl
  |  HTTPS  (traceparent header, optional)
  v
API Gateway HTTP API  --metrics-->  CloudWatch Metrics: Count, 4xx, 5xx, Latency
  |                                        |
  v                                        v
Lambda (Node.js 24, active tracing)     Alarms: 5xx rate, p95 latency
  |  Hono app from chapter 05              |  ALARM / OK
  |  + span per request                    v
  |  + span per table call               SNS topic --> email
  |  + traceId on every log line
  |
  +--logs---> CloudWatch Logs (JSON events, kept 7 days)
  |             |-- Logs Insights queries (by requestId, by traceId, errors, slow)
  |             `-- metric filter: status = 409 --> NoteConflicts metric
  +--traces-> X-Ray (sampled: first request each second + 5%)
  v
DynamoDB table  --metrics-->  dashboard (causes: throttles, server errors)
```

道具は 3 種類で、答える問いが違います。

**メトリクス**は時刻ごとの数値です。リクエスト数、エラー数、応答時間。「いま、おかしいか」に答えます。安くて、ずっと残ります。そのかわり、どのリクエストがおかしいのかは教えてくれません。

**ログ**は 1 件ごとの記録です。「どのリクエストが、どう失敗したか」に答えます。詳しいぶん、量に比例してお金がかかります。

**trace** は 1 件のリクエストが通った道筋と、区間ごとの時間です。「どこで時間を使ったか」に答えます。全部は残りません。これは後で大事になります。

順番は、気づく（アラーム）、絞る（メトリクスとログ）、辿る（trace）です。

### stack を 05章から分けた理由

05章の `NotesStack` は、関数や API を外から触れる形で公開していません。アラームを付けるには関数の設定（trace と、ログの形式）も変えたいので、この章は同じ形の table と API を自分の stack に持ちます。インフラの定義は 60 行ほど重複しますが、アプリのコードは workspace の依存として 05章のものをそのまま読み込んでいます。監視の部分は `Monitoring` という construct に切り出してあるので、あなたの stack に持っていけます。

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

復旧（OK に戻ったとき）も通知しています。障害がいつ終わったかも、知りたい情報だからです。

## 最初に見る数字

<!-- section: 19.metrics -->

アラームが鳴ったら、ダッシュボードを開きます。上の段が症状、下の段が原因の候補です。

<<< @/examples/19-observability/infra/lib/monitoring.ts{dashboard}

サービスごとに、最初に見るものを並べます。

**API Gateway HTTP API。** `Count`、`4xx`、`5xx`、`Latency`、`IntegrationLatency`。`Latency` は受け取ってから返すまで、`IntegrationLatency` はそのうち Lambda を待っていた時間です。2 つの差が大きければ、API Gateway の側で時間を使っています。route ごとの数字は、詳細メトリクスを有効にしないと出ません。

**Lambda。** `Errors`、`Throttles`、`Duration`、`ConcurrentExecutions`。ここに罠があります。`Errors` が数えるのは、関数が例外で終わった呼び出しと、timeout です。このアプリは例外を捕まえて 500 の応答を返すので、利用者に 500 が返っていても、Lambda の `Errors` は 0 のままです。だから症状のアラームは API Gateway の `5xx` に付けました。逆に `Errors` が増えていたら、アプリの外（timeout、初期化の失敗、メモリ不足）を疑います。`Throttles` は `Invocations` にも `Errors` にも数えられないので、別に見ます。

**DynamoDB。** `ThrottledRequests`、`SystemErrors`、それと `ConditionalCheckFailedRequests`。最後のは 05章の楽観ロックが働いた回数です。

ダッシュボードは 1 つで、参照するメトリクスは 50 個以内に収めています。無料枠がそこまでだからです。テストがこの上限を見張っています。

## ログで 1 件まで絞る

<!-- section: 19.logs -->

「5xx が増えている」とわかったら、次はどのリクエストかです。CloudWatch Logs Insights は、log group に対して query を書いて調べる機能です。

query を書く前に、ログの形を固定します。05章のアプリが実際に書く行は、この 2 種類です。

<<< @/examples/19-observability/src/log-shape.ts{shape}

`strictObject` にしてあるのがポイントで、ここに無い項目が 1 つでもログに混ざると、テストが落ちます。これは後で、個人情報の話につながります。

query は、文字列で直接書かずに、いったん構造として持ちます。

<<< @/examples/19-observability/src/queries.ts{model}

回りくどく見えますが、理由があります。Logs Insights の query は、手元では実行できません。でも「どの行を選ぶか」という条件は、手元でも評価できます。同じ構造から、AWS に送る文字列と、手元で動く絞り込みの両方を作っておけば、「query が実際のログの形に合っているか」をテストで確かめられます。

用意した query は 4 つです。

<<< @/examples/19-observability/src/queries.ts{queries}

`byRequestId` が、04章からの約束の回収です。利用者が「エラーになった」と言ってきたら、応答の `x-request-id` を聞いて、この query に渡します。そのリクエストが書いた行（リクエストの行と、あればスタックトレースの行）だけが出てきます。

ID は Zod で UUID かどうかを確かめています。query の文字列に外から来た値を埋め込むので、SQL と同じ種類の注意が要ります。

テストは、本物のアプリを動かして書かせたログ行に、この query を当てます。

<<< @/examples/19-observability/src/queries.ts{run}

確かめているのは、「ID で絞ると、そのリクエストの行だけが出る」「5xx の集計に 4xx が混ざらない」「query が参照する項目名が、ログの schema に全部ある」です。最後のは、05章のログの項目名を誰かが変えたときに、ここで落ちるようにするためです。

確かめていないのは、Logs Insights がこの文字列を受け付けて、同じ結果を返すことです。構文は公式ドキュメントの例に合わせましたが、実行はしていません。

文字列だけ見たいときは、AWS なしで出せます。

```bash
vp run obs:query:print --name errors
```

```text
filter message = "request" and status >= 500
| stats count(*) as requests by method, path
| sort requests desc
| limit 20
```

### request ID が 2 つある

Logs Insights は、Lambda のログに `@requestId` という項目を自動で付けます。これは Lambda が呼び出しごとに振る ID で、アプリの `requestId` とは別物です。利用者に返しているのはアプリのほうなので、query では `@` の付かない `requestId` を使います。名前が似ているので、最初は必ず間違えます。

### ログの形式を JSON に変えた

04章と 05章の関数は、Lambda の既定のログ形式（テキスト）のままです。その場合、Node.js の runtime は、`console.log` の出力の前に時刻、Lambda の request ID、ログレベルを付け足します。つまり CloudWatch Logs に入る 1 件は、純粋な JSON ではなく、「前置き + JSON」です。

Logs Insights は、Lambda のログなら最初の JSON の断片から項目を見つけてくれるので、04章の調べ方はそのままでも成り立ちます。でも、次の節の metric filter は、JSON の pattern を「JSON のログ」に対して使うものです。前置きのある行に合うかどうかは、ドキュメントからは読み取れませんでした。

なので、この章の関数はログ形式を JSON にしています。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

公式ドキュメントによると、JSON 形式のとき、すでに JSON になっている行を Lambda は二重に包みません。アプリの行がそのまま 1 件になるはずです。正直に言うと、ここは実機で確かめられていません。違っていた場合の直し方は、章末の検証メモに書きました。

## ログから数える: metric filter と EMF

<!-- section: 19.log-metrics -->

05章で、古い版をもとにした更新は 409 で断るようにしました。この 409 がどのくらい起きているかは、API Gateway のメトリクスではわかりません。`4xx` は 400 も 404 も 409 もまとめて数えるからです。

でも、ログには `status: 409` の行がもうあります。それを数えればいい。

<<< @/examples/19-observability/src/queries.ts{conflicts}

<<< @/examples/19-observability/infra/lib/monitoring.ts{metric-filter}

**metric filter** は、log group に届く行を pattern で数えて、メトリクスにする設定です。条件は、さっきの query と同じ構造から作っています。

<<< @/examples/19-observability/src/conditions.ts{render}

知っておくことが 3 つあります。作る前のログには遡りません。配送は「少なくとも 1 回」で、まれに重複して数えられます。そして dimension を付けると、値の種類ごとに別のメトリクスになって、その数だけ課金されます。

ログからメトリクスを作る方法は、もう 1 つあります。**embedded metric format（EMF）** は、決まった形の JSON をログに書くと、CloudWatch がそこから値を取り出す仕組みです。違いはこうです。

| | metric filter | EMF |
| --- | --- | --- |
| 定義する場所 | インフラ（log group の設定） | アプリのコード（ログの行そのもの） |
| 向いているもの | すでにある行を数える | 値と dimension をコードから出す（処理時間、件数など） |
| コードの変更 | 不要 | 必要 |
| 料金 | custom metric の料金。ログは増えない | custom metric の料金と、増えたログの取り込み |

どちらも `PutMetricData` を呼ばないので、リクエストの処理は待たされません。この章は「すでにある行を数える」だけなので、metric filter にしました。処理時間を dimension つきで出したくなったら EMF です。

EMF を選ぶときの注意を 2 つ。dimension に request ID のような種類の多い値を入れると、値の数だけメトリクスができます。それから、EMF の行は「前後に何も付かない JSON」でなければいけません。Lambda の公式ドキュメントは、ログ形式が JSON のときは `console.log` ではなく `process.stdout` に直接書くよう案内しています。

## trace: どこで時間を使ったか

<!-- section: 19.tracing -->

ログは「何が起きたか」を教えてくれますが、「1 件のリクエストの中で、どこに時間がかかったか」は苦手です。それを記録するのが trace です。1 件のリクエストに 1 つの trace ID が振られ、その中の区間が span になります。

計装には OpenTelemetry を使います。理由は次の節で話すとして、先にコードを見ましょう。

<<< @/examples/19-observability/src/telemetry.ts{span}

このファイルが読み込んでいるのは `@opentelemetry/api` だけです。これは「span を始める」「いまの span を取る」といった呼び出しの窓口で、中身（SDK）は別です。SDK が登録されていなければ、全部の呼び出しが何もしません。手元ではコンソールに出す SDK を、Lambda では layer の SDK を、起動する側が選びます。アプリのコードはどちらなのかを知りません。

05章の repository を包んで、table への呼び出し 1 回ごとに span を作ります。

<<< @/examples/19-observability/src/traced-repository.ts{repository}

05章で repository を interface にしておいたのが、ここで効きます。DynamoDB の実装にもメモリの実装にも触らず、外から包むだけです。

アプリ全体も同じやり方で包みます。

<<< @/examples/19-observability/src/app.ts{app}

span の名前は `GET` や `POST` だけにしています。ノートの ID が入った path を名前にすると、名前の種類が際限なく増えるからです。path は属性に入れます。

組み立てはここです。

<<< @/examples/19-observability/src/compose.ts{compose}

## Lambda で trace を取る

<!-- section: 19.lambda-tracing -->

AWS の trace のサービスは X-Ray です。ここで、よく混同される話を整理しておきます。

X-Ray には、アプリに組み込む **X-Ray SDK** と、trace を中継する **X-Ray daemon** がありました。この 2 つは 2026 年 2 月 25 日に保守モードに入っていて、今後はセキュリティの修正しか出ません。AWS は、計装を OpenTelemetry に移すよう勧めています。

一方で、**X-Ray というサービス**が終わるという記述は、support timeline のページにはありません。OpenTelemetry で作った trace の送り先は、いまも X-Ray です。終わりに向かっているのは「X-Ray 専用の計装の道具」で、「trace を受け取って見せるサービス」ではない。だから、新しく書くコードは OpenTelemetry にします。

Lambda での入れ方は、段階が 2 つあります。

### 段階 1: active tracing（コードなし）

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

`tracing: Tracing.ACTIVE` を付けると、Lambda 自身が呼び出しごとの記録（Lambda のサービスの区間と、関数の区間）を X-Ray に送ります。SDK も layer も要りません。cold start にどれだけかかったかは、これだけでわかります。

実行 role には X-Ray へ書く 2 つの操作が足されます。この 2 つは対象を絞れない操作なので、リソースは `*` になります。これまでの章のテストは「`*` を使っていない」ことを見ていましたが、この章のテストは「`*` はこの 2 つの操作だけ」に変えてあります。

この段階では、関数の中の span（table への呼び出しなど）は記録されません。SDK が無いので、さっきの `withSpan` は何もしないからです。

### 段階 2: OpenTelemetry の layer を足す

関数の中まで見るには、SDK が要ります。AWS の移行ガイドが Lambda 向けに勧めているのは、**AWS Lambda Layer for OpenTelemetry** です。関数に layer を足して、環境変数を 1 つ設定すると、関数のコードが読み込まれる前に SDK が起動します。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{otel-layer}

layer の ARN はコードに書いていません。リージョンと版で変わるので、デプロイのときに渡します。

<<< @/examples/19-observability/infra/bin/app.ts{context}

ARN は ADOT（AWS Distro for OpenTelemetry）のドキュメントの「Lambda Layer ARNs」の表の、Node.js のタブにあります。2026 年 10 月 12 日の時点で、東京リージョンの値は `arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16` でした。版は上がっていくので、使うときに表を見てください。

`OTEL_AWS_APPLICATION_SIGNALS_ENABLED=false` は、trace だけを使う設定です。この layer は既定で Application Signals という別の機能（サービスごとの指標を自動で作る）も有効にします。そちらは料金も別なので、ここでは切っています。

関数のコードは、段階 1 でも 2 でも同じです。

<<< @/examples/19-observability/src/lambda.ts{handler}

ここからは、確かめられていないことを正直に並べます。

- **Node.js 24 が、この layer の対応 runtime の一覧にありません。** ドキュメントの一覧は 18、20、22 までです。この本の関数は 24 で動かしています。動くかもしれませんし、動かないかもしれません
- **bundle した関数で自動計装が効くか。** layer は AWS SDK の呼び出しを自動で span にしますが、これはライブラリの読み込みに割り込む方式です。この本は esbuild で AWS SDK ごと 1 ファイルにまとめているので、効かない可能性があります。だから table への span は、自動計装に頼らず手で書きました
- **API の版。** 関数に bundle された `@opentelemetry/api`（1.9.1）は、layer が登録した SDK と、グローバルな変数を通してつながります。API のソースを読むと、layer 側の API の minor 版がこちらより古い場合、こちらの呼び出しは黙って何もしなくなります。span が出ないときは、ここを疑ってください
- **権限。** ドキュメントの手順は管理ポリシー `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` を付けます。この章は Application Signals を切っているので付けていませんが、それで足りるかは未確認です

どれも、デプロイすれば 1 回でわかることです。段階 1 だけでも章の残りは成り立つので、layer は既定では付けていません。

layer を使わない方法もあります。移行ガイドは、SDK を自分で組み立てて X-Ray 用の exporter を使う方法も挙げています。runtime の対応を待たなくていいかわりに、初期化のコードを自分で持つことになります。この章では扱いません。

## 1 つの ID で辿る

<!-- section: 19.ids -->

ここまでで、ID が何種類も出てきました。整理します。

| ID | 誰が振るか | どこで見えるか |
| --- | --- | --- |
| `requestId`（アプリ） | アプリ。リクエストごとに UUID | 応答の `x-request-id`、エラー本文、ログの行、span の属性 `app.request_id` |
| `@requestId`（Lambda） | Lambda。呼び出しごと | Logs Insights、`REPORT` 行 |
| trace ID | trace を始めた最初の処理 | ログの行の `traceId`、X-Ray |
| span ID | span を作った処理 | ログの行の `spanId`、X-Ray |

利用者に見えるのは request ID、処理をまたいで共有されるのは trace ID です。なので、この 2 つを相互に引けるようにしておきます。

<<< @/examples/19-observability/src/telemetry.ts{fields}

ログの全部の行に `traceId` を足し、span には request ID を属性として付けます。利用者から request ID を聞けば、ログから trace ID がわかる。trace の画面で遅い span を見つけたら、属性の request ID でログに戻れる。テストは、この行き来を両方向で確かめています。

### X-Ray の書き方との変換

OpenTelemetry の trace ID は 32 文字の 16 進数です。X-Ray は、同じ値を `1-` と 2 つのハイフンを付けて書きます。

<<< @/examples/19-observability/src/trace-context.ts{xray}

ログにあるのは 32 文字のほう、X-Ray の画面や `REPORT` 行にあるのはハイフンつきのほうです。検索するときは、相手に合わせて変換します。

### 処理をまたいで渡す

trace ID を次の処理に渡す方法は、W3C の Trace Context という仕様で決まっています。HTTP なら `traceparent` というヘッダーです。

<<< @/examples/19-observability/src/trace-context.ts{traceparent}

中身は、版、trace ID、呼び出し元の span ID、flags の 4 つをハイフンでつないだものです。flags の最下位のビットが「呼び出し元はこの trace を記録している」を表します。

この章のコードが自分で `traceparent` を解釈しているのは、テストと `obs:smoke` だけです。実際の受け渡しは OpenTelemetry の propagator に任せています。

<<< @/examples/19-observability/src/telemetry.ts{propagation}

```text
Browser                    API (Lambda)                 Queue              Worker (Lambda)
  | traceparent:             |                            |                   |
  |  00-<trace>-<a>-01       |                            |                   |
  |------------------------->| span b, parent a           |                   |
  |                          | log: traceId=<trace>       |                   |
  |                          |-- message + trace header ->|                   |
  |                          |   (traceparent / AWSTraceHeader)               |
  |                          |                            |-- deliver ------->| span c, parent b
  |                          |                            |-- deliver again ->| span c', parent b
  |                          |                            |                   | log: traceId=<trace>
```

ブラウザが `traceparent` を付けて呼ぶと、API はその trace を引き継ぎます。API が queue にメッセージを入れるとき、同じ情報をメッセージに載せます。worker はそこから続きを始めます。全員のログに同じ `traceId` が残るので、1 つの query で全部の行が出てきます。

[08章](/ja/chapters/08-async.md)で queue と worker を作りました。SQS は、X-Ray の trace ヘッダーを `AWSTraceHeader` というメッセージの属性で運び、受け手が Lambda なら自動で引き継ぐ、と X-Ray のドキュメントにあります。この章では SQS を使わず、「メッセージに載せて、受け手が続ける」ところだけをテストで再現しています。同じメッセージが 2 回配送されると、同じ親を持つ span が 2 つできます。重複配送が trace の上で見える、ということです。

1 つ、実機で確かめていないことがあります。Lambda の中では、layer がすでに呼び出しの span を開いています。この章のコードは、その場合 `traceparent` を自分では読まず、layer の span の下に入ります。ブラウザの `traceparent` と Lambda の trace がつながるかどうかは、layer と Lambda の振る舞い次第です。つながらなかった場合でも、ログの `traceId` と request ID で辿ることはできます。

## trace は全部は残らない

<!-- section: 19.sampling -->

ここが、この章でいちばん誤解されやすいところです。

trace は sampling されます。全部のリクエストを記録すると高くつくので、一部だけを残します。Lambda の active tracing は、毎秒最初の 1 件と、残りの 5% を記録します。この割合は、関数ごとには変えられません。

そして、決めるのは最初の 1 回だけです。trace を始めた処理が「記録する」「しない」を決めて、下流はそれに従います。途中のサービスが自分の規則で決め直すことはありません。そうしないと、trace が途中で途切れるからです。

<<< @/examples/19-observability/src/local-tracing.ts{local}

これが意味することを、1 文で書きます。**span が無いことは、処理が無かったことの証拠になりません。**

- sampling されなかったリクエストは、成功していても span がありません
- 記録された trace でも、送信に失敗した span は欠けます。処理は終わっているのに、span だけが届かない
- X-Ray の trace は 30 日で消えます

テストは、この 3 つのうち最初の 2 つを、決まった順序で再現します。sampling を切った状態でノートを作ると、応答は 201、ログの行は残り、`sampled` は `false`、span は 0 個。exporter を落とした状態で worker を動かすと、仕事は 1 回済んでいて、span だけがありません。

だから、「起きたかどうか」はログとデータで確かめます。ログは sampling されません。ノートが作られたかどうかは table が知っています。trace は「どこが遅いか」を見るための道具で、「何が起きたか」の記録ではない、と割り切るのがコツです。

ログの行に `sampled` を入れたのも、そのためです。`false` の行の trace ID で X-Ray を検索しても、何も出てきません。それは障害ではなく、仕様です。

## ログと trace に入れないもの

<!-- section: 19.privacy -->

[06章](/ja/chapters/06-auth.md)で「token をログに書かない」と決めました。観測の道具を増やすと、漏れる先も増えます。ログは 7 日、trace は 30 日、どちらもアプリの table より広い範囲の人が読めることが多い場所です。

この章のやり方は、禁止リストではなく許可リストです。「password という名前の項目を消す」方式は、名前の違う項目が増えたときに漏れます。そうではなく、書いてよい項目を決めて、それ以外があればテストを落とします。

- **ログ**は、さっきの `strictObject` です。項目が増えたら schema に足すことになり、そのとき人の目が入ります
- **span の属性**は、テストが名前の一覧を固定しています。`http.request.method`、`url.path`、`http.response.status_code`、`app.request_id`、`app.repository.operation`、`app.repository.outcome`、`error.type` の 7 つだけです
- **path は query string なし。** query string には token が入ることがあります（06章の認可コードがそうでした）
- **例外は、種類だけ。** span に例外を記録する標準の方法は、メッセージとスタックトレースを丸ごと写します。メッセージには入力がそのまま入ることがあるので、この章は例外の型の名前だけを残します。詳しい内容は、ログの `error` に 1 回だけ書きます

テストは、ノートの本文、query string の token、`Authorization` ヘッダー、cookie、例外メッセージに入ったメールアドレスを流して、ログにも span にも出てこないことを確かめています。

1 つ、残っている穴を書いておきます。ログの `error` にはスタックトレースが入ります。例外のメッセージに個人情報が入るライブラリを使うと、そこから漏れます。これは許可リストでは防げません。

## 手元で見る

<!-- section: 19.local -->

`examples/19-observability/.env.example` を `.env` にコピーして、起動します。

<<< @/examples/19-observability/.env.example

```bash
vp run dev:obs
```

<<< @/examples/19-observability/src/dev.ts{dev}

手元では、span をコンソールに出す exporter を使います。別のターミナルから呼んでみてください。

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-01'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-00'
```

1 つ目では、`notes.create` と `POST` の 2 つの span と、`traceId` の付いたログの行が出ます。span は終わったときに出るので、内側の `notes.create` が先です。

2 つ目は、`traceparent` で trace ID を指定しています。ログの `traceId` が `4efaaf4d…` になり、span の親が `00f067aa0ba902b7` になります。

3 つ目は、最後の 2 文字が `00` です。「呼び出し元は記録していない」という意味なので、span は出ません。ログの行だけが `"sampled":false` で残ります。

`.env` の `TRACE_SAMPLE_RATIO` を `0` にして起動し直すと、全部のリクエストがこの状態になります。

テストはこうです。

```bash
vp run test:unit
```

手元で再現しないものも書いておきます。

- **CloudWatch と X-Ray そのもの。** アラームの状態遷移、Logs Insights の実行、metric filter、X-Ray の画面
- **Lambda の sampling。** 手元の sampler は割合だけで、「毎秒最初の 1 件」はありません
- **layer。** 手元の SDK は、Lambda の layer とは別の構成です
- **Lambda が書くシステムのログ。** JSON 形式での `platform.report` などの行

## デプロイして確かめる

<!-- section: 19.deploy -->

ここからは AWS です。この節の手順は、まだ実機で通せていません。

```bash
vp run obs:infra:diff
vp run obs:infra:deploy -c alarmEmail=you@example.com
```

メールアドレスは template と cdkd の state に入ります。共有のアドレスにするか、省略して後から購読を足してください。確認メールが届いたら、リンクを押します。

リクエストを送ります。

```bash
vp run obs:smoke
```

ノートを 1 件作って、古い版で更新して 409 を起こし、存在しないノートを読んで 404 を起こし、消します。応答ごとに `x-request-id` を表示します。

```bash
vp run obs:query --name request --id <x-request-id>
vp run obs:query --name errors --minutes 60
vp run obs:alarms
```

`obs:query` は、指定した時間の範囲にあるログを全部読んで、読んだ量に課金されます。範囲は狭くします。`obs:alarms` は 2 つのアラームの状態を表示します。デプロイの直後は `INSUFFICIENT_DATA` で、これは正常です。

layer を足すなら、ADOT のドキュメントの表から ARN を取って渡します。

```bash
vp run obs:infra:deploy -c otelLayerArn=arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
```

cdkd の話を 1 つ。固定している版（0.296.28）のソースを読むと、アラーム、SNS の topic と購読、log group には専用の実装があります。ダッシュボードと metric filter には無く、Cloud Control API 経由になります。どちらの種類も Cloud Control API の対応一覧にはありますが、cdkd から実際に作れるかは未確認です。

drift の検査は、これまでの章と同じです。

```bash
vp run obs:infra:drift
```

## ブラウザの側と、外からの監視

<!-- section: 19.browser-and-probes -->

ここまでは、全部サーバーの側の話でした。見えていないものが 2 つあります。

**利用者のブラウザで何が起きているか。** API が 50 ミリ秒で返していても、ページの表示に 5 秒かかっているかもしれません。JavaScript のエラーは、サーバーには届きません。**CloudWatch RUM** は、ページに小さなスクリプトを入れて、実際の利用者の表示時間やエラーを集める機能です。集める session の割合を選べます。データは 30 日で消えます。

**誰も来ていないときに壊れていないか。** さっき見たとおり、リクエストが無ければアラームは黙っています。**CloudWatch Synthetics** は、canary と呼ぶスクリプトを決まった間隔（最短で 1 分ごと）で動かして、外から API やページを呼びます。利用者がいない深夜でも、壊れていれば気づけます。

この章は、どちらも実装しませんでした。理由はこうです。

- RUM は、ブラウザのアプリと、ブラウザから AWS にデータを送るための認可の設定が要ります。この章の題材は API だけです
- Synthetics の canary は、Lambda の関数、成果物を置く S3 の bucket、専用の runtime の版を伴います。runtime の版は頻繁に入れ替わるので、確かめずに書くと、すぐ古くなります
- どちらも、置いてあるだけで料金が発生し続けます。次の節で計算します

足す順番の目安を書いておきます。利用者がいない時間帯があるサービスなら、先に Synthetics です。アラームの「データが無い」を「壊れている」と区別できるようになります。SPA の体感が問題になってきたら RUM です。どちらも、サーバー側のアラームとログが整ってからで遅くありません。

cdkd の固定した版には、`AWS::RUM::AppMonitor` にも `AWS::Synthetics::Canary` にも専用の実装がありません。Cloud Control API 経由になります。

## お金の話

<!-- section: 19.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。API、Lambda、DynamoDB そのものの料金は 04章と 05章で計算したので、ここでは観測のぶんだけを見ます。

**誰も呼ばない月は、定価で 0.30、無料枠の適用後は 0 です。** かかるのはアラームだけで、アラームが参照するメトリクス 1 つにつき月 0.10。2 つのアラームが 3 つのメトリクスを参照しています（5xx の割合は `Count` と `5xx` の 2 つを使うので、2 つぶん）。ログも trace も、リクエストが無ければ発生しません。

月 100 万リクエストだと、こうなります。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| ログの取り込み | 0.954 GB | 0.72 | 0 |
| ログの保存（7 日） | 0.223 GB 月 | 0.01 | 0 |
| Logs Insights で読んだ量 | 1 GB | 0.01 | 0 |
| custom metric | 1 個 | 0.30 | 0 |
| アラーム | メトリクス 3 個ぶん | 0.30 | 0 |
| trace の記録 | 100 万件 | 5.00 | 4.50 |
| trace の取得 | 1 万件 | 0.005 | 0 |
| 小計 | | **6.34** | **4.50** |

仮定は、1 リクエストあたりログ 1 KB、保持 7 日、リクエストが一定の間隔で届く、です。

いちばん高いのは trace でした。月 100 万件は、ならすと毎秒 0.38 件です。Lambda の sampling は「毎秒最初の 1 件」を必ず記録するので、この流量だと全件が trace になります。

<<< @/examples/19-observability/src/cost-inputs.ts{traces}

これは上限です。実際のリクエストは偏って届くので、同じ 1 秒に重なったぶんは 5% しか記録されず、件数は減ります。逆に言うと、流量が少ないサービスほど、trace の割合は 100% に近づきます。04章で計算した API と Lambda の料金（定価で 2.02）より、観測のほうが高くなりうる、ということです。

無料枠は、ログが取り込み・保存・query それぞれ 5 GB、custom metric が 10 個、アラームがメトリクス 10 個ぶん、ダッシュボードが 3 つ、trace の記録が月 10 万件、取得が月 100 万件です。どれもアカウント全体で共有です。

ダッシュボードは、無料枠の 3 つに収まる前提で、金額に入れていません。4 つ目からの単価は、Price List の東京の一覧に見当たらず、料金ページでも読み取れなかったので、不明としておきます。

### ログを 1 行増やすといくらか

リクエストの行は、測ると 167 バイトでした（テストがこの数字を固定しています）。同じ大きさの行をリクエストごとにもう 1 行書くと、月 100 万リクエストで 0.156 GB、**月 0.12** です。

<<< @/examples/19-observability/src/cost-inputs.ts{logs}

小さく見えますが、リクエスト数に比例します。月 1 億リクエストなら 100 倍です。そして、デバッグ用に入力を丸ごと書くような行は、167 バイトでは済みません。

この章で足した trace の 3 項目（`traceId`、`spanId`、`sampled`）は、1 行あたり 88 バイトです。これも同じ計算で、月 100 万リクエストあたり 0.082 GB ぶんの取り込みになります。相互に引けることの値段です。

### メトリクスを 1 つ増やすといくらか

custom metric は、1 つにつき**月 0.30**（最初の 1 万個まで）です。データ点が届いた時間だけ、時間割りで課金されます。

気をつけるのは dimension です。CloudWatch は、dimension の値の組み合わせ 1 つを 1 メトリクスと数えます。`NoteConflicts` に route の dimension を付ければ route の数だけ、利用者の ID を付ければ利用者の数だけ、0.30 が増えます。「誰が」「どのノートで」を知りたいときは、メトリクスではなくログの query で調べます。

### 保持期間をどう決めるか

ログの料金の大半は取り込み（1 GB あたり 0.76）で、保存（1 GB 月あたり 0.033）はその 20 分の 1 以下です。同じ流量で、7 日の保持なら置き続ける量は 0.22 GB、1 年なら 11.6 GB になります。

なので、保持期間は料金よりも「どこまで遡って調べたいか」と「どこまで残してよいか」で決めます。障害の調査なら、気づくまでの時間と調べる時間を足して 2〜4 週間。監査や法令で決まっているなら、その期間。個人情報を含みうるなら、短いほうが安全です。何も設定しない log group は無期限に残るので、必ず何かを設定します。

削減したいときに効くのは、保持を短くすることより、書く量を減らすことです。

### RUM と Synthetics

どちらも、この章の stack には入っていません。足したときの目安です。

- **Synthetics**: canary の実行 1 回につき 0.0019。5 分ごとに 1 つ動かすと月 8,760 回で、定価で **16.64**、無料枠（月 100 回）の適用後で 16.45。canary が使う Lambda、S3、ログの料金は別です
- **RUM**: 10 万イベントにつき 1。1 回の訪問で 20 イベント（料金ページの計算例の数）とすると、月 1 万回の訪問を全部集めて **2.00**。初回に 100 万イベントの無料トライアルがありますが、毎月の枠ではないので引いていません

1 分ごとの canary は、5 分ごとの 5 倍です。間隔は、何分の停止までなら許せるかで決めます。

stack を消せば、この章のぶんの料金は止まります。

## Workers から来た人へ

<!-- section: 19.workers -->

Cloudflare Workers の観測は、設定の数がずっと少ないです。違いを並べます。

| | Cloudflare Workers | この章（CloudWatch と X-Ray） |
| --- | --- | --- |
| ログ | Workers Logs。新しい Worker は既定で有効。JSON で書くと項目が自動で索引される | CloudWatch Logs。log group、保持期間、ログ形式を自分で決める |
| ログの保持 | 最長 7 日 | 1 日から無期限まで選べる |
| ログの料金 | Paid プランに月 2,000 万件まで含まれ、超過は 100 万件あたり USD 0.60（件数で課金） | 取り込んだバイト数と保存量で課金 |
| trace | 設定で有効にすると、コードの変更なしで自動計装（beta）。既定は全件記録 | active tracing は設定だけ。関数の中は OpenTelemetry の layer かコードが必要。既定は毎秒 1 件と 5% |
| trace の保持 | 7 日 | 30 日 |
| アラーム | この章では確認していません | CloudWatch のアラームと SNS |
| 外への送信 | OpenTelemetry の endpoint へ export できる | OpenTelemetry で計装すれば、送り先は X-Ray 以外にもできる |

Workers のほうが、始めるまでが短いです。AWS は、保持期間、sampling、ログの形式、アラームの条件を全部自分で決めます。そのぶん、長く残す、条件を細かく作る、といった調整ができます。

Workers の料金には注意書きがあります。Workers Logs と trace は、2026 年 12 月 1 日から Cloudflare Observability という新しい料金体系に移る、と公式ドキュメントにあります。上の表の金額はそれまでのものです。新しい体系の中身は、この章では確認していません。

どちらでも、OpenTelemetry で計装しておけば、アプリのコードは観測の基盤に縛られません。この章の `telemetry.ts` は AWS のことを何も知りません。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| アラームがずっと `INSUFFICIENT_DATA` | デプロイ直後は正常。リクエストが来ているのに続くなら、メトリクスの dimension（`ApiId`）が実際の API と合っているか |
| アラームは `ALARM` なのにメールが来ない | SNS の購読が保留のままです。確認メールのリンクを押しましたか |
| 500 が返っているのに Lambda の `Errors` が 0 | 正常です。アプリが例外を捕まえて 500 を返しています。API Gateway の `5xx` を見る |
| `obs:query` で行が見つからない | 時間の範囲（`--minutes`）は足りていますか。ログは数秒遅れて届きます。それでも無ければ、ログの形が想定と違う可能性（検証メモの `obs-lambda-json-log-shape`） |
| `NoteConflicts` にデータが出ない | metric filter は作成後のログにしか効きません。JSON 形式のログになっているかも確認 |
| ログに `traceId` が無い | SDK が登録されていません。layer を付けていない段階 1 では、これが正常です |
| ログに `traceId` はあるのに X-Ray で見つからない | その行の `sampled` を見る。`false` なら記録されていません。`true` なら、ID をハイフンつきの書き方に変換して検索 |
| layer を付けたら関数が起動しない | 関数のログで layer のエラーを探す。runtime が layer の対応一覧にあるか |
| trace が途中で切れている | sampling の決定が引き継がれていないか、span の送信が失敗しています。ログの `traceId` で前後をつなぐ |

## 本番にするなら

- **アラームの閾値を、自分のサービスの数字で決める。** 5% と 1 秒は練習用の値です。まず 1〜2 週間メトリクスを眺めて、普段の値を知ってから決めます
- **外からの監視を足す。** 利用者がいない時間帯があるなら Synthetics。アラームが「静かな夜」と「到達できない障害」を区別できるようになります
- **通知先を人の当番につなぐ。** メール 1 通は、深夜には読まれません。SNS の先を、チャットや当番の仕組みにします
- **API Gateway の access log を有効にする。** 関数が呼ばれなかったリクエスト（throttle、timeout）は、アプリのログに何も残りません。access log には残ります
- **ログの保持期間を決める。** 7 日は練習用の値です
- **アラームに対応手順を書く。** `alarmDescription` に、最初に開くダッシュボードと query を書いておくと、鳴ったときに迷いません
- **topic を暗号化する、通知に載る内容を確かめる。** アラームの通知には、メトリクスの名前と閾値が入ります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 19.cleanup -->

```bash
vp run obs:infra:destroy
```

table、関数、API、log group、アラーム、ダッシュボード、topic、metric filter が消えます。ノートもログも一緒です。

stack と一緒に消えないものが 2 つあります。X-Ray に記録された trace は、30 日経つまで残ります（料金は記録した件数に対するものです）。`NoteConflicts` のメトリクスのデータ点も、stack のリソースではないので CloudWatch に残ります。どちらも、消す手順はこの章では確かめていません。

ほかに残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

## 分散システムとして見ると

観測の道具そのものが、分散システムです。アプリとは別の経路で、別の信頼性で届きます。

- **状態の持ち主**: 何が起きたかの持ち主は、table（データ）とログ（リクエストの記録）です。メトリクスは集計で、trace は標本です
- **invariant**: sampling されたかどうかに関係なく、すべてのリクエストは、request ID の付いたログの行を 1 行残す。trace の有無は、処理の成否を意味しない
- **それを壊すテスト**: sampling を切る、呼び出し元が「記録しない」と伝えてくる、exporter が落ちる、の 3 通りで、応答とログが変わらないことを確かめています
- **重複**: metric filter と EMF の配送は「少なくとも 1 回」です。メトリクスの値は、まれに多く数えられます。正確な件数が要るなら、ログか table を数えます
- **遅れ**: ログもメトリクスも、数秒から数分遅れて届きます。アラームが鳴ったとき、障害はもう数分続いています

::: details この章の検証メモ

**手元で確かめたこと。** アプリ、ログの query、trace、アラームの条件、料金計算の入力、インフラのユニットテスト。型検査。synth（esbuild の bundle 込み。`-c otelLayerArn` を付けた場合も）。`dev:obs` を起動して、本文の `curl` を実行し、span とログの行の対応、`traceparent` の引き継ぎ、`TRACE_SAMPLE_RATIO=0` で span が出ないことを確認。`obs:query:print` の出力。AWS CLI の `logs start-query` のヘルプで、スクリプトが使う引数の名前。

**まだ確かめていないこと。** `obs:infra:deploy`、`obs:smoke`、`obs:query`、`obs:alarms`、`obs:infra:drift`、`obs:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントからの読み取りです。

- Lambda の JSON ログ形式で、アプリの JSON の行がそのまま 1 件のログになること。違っていたら、`src/compose.ts` で logger の出力先を `process.stdout` に替えるか、query の項目名を直します
- Logs Insights が、生成した query の文字列を受け付けること
- metric math の `IF` の式が受け付けられること、リクエストが無い間に `Count` と `5xx` が欠損になること、アラームの実際の状態遷移と SNS の通知
- AWS Lambda Layer for OpenTelemetry を Node.js 24 の関数に付けた構成の全部（起動するか、手書きの span が届くか、自動計装が効くか、権限が足りるか、ブラウザの `traceparent` とつながるか）
- cdkd が、ダッシュボードと metric filter を Cloud Control API 経由で作成・更新・読み戻しできること
- 料金のうち、ダッシュボードの 4 つ目からの単価、Lambda が JSON 形式で書くシステムのログの大きさ（1 リクエスト 1 KB は仮定）、layer 経由の span の課金のされ方

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/19-observability/infra/lib/observability-stack.ts` | |
| まず、症状にアラームを付ける | `examples/19-observability/src/alarm-math.ts`、`test/alarm-math.test.ts`、`infra/lib/monitoring.ts` | `test:unit` |
| 最初に見る数字 | `examples/19-observability/infra/lib/monitoring.ts`、`infra/test/observability-stack.test.ts` | `test:unit`、`obs:infra:synth` |
| ログで 1 件まで絞る | `examples/19-observability/src/log-shape.ts`、`src/conditions.ts`、`src/queries.ts`、`test/log-shape.test.ts`、`test/queries.test.ts`、`scripts/query.ts` | `test:unit`、`obs:query:print` |
| ログから数える | `examples/19-observability/src/conditions.ts`、`src/queries.ts`、`infra/lib/monitoring.ts` | `test:unit` |
| trace: どこで時間を使ったか | `examples/19-observability/src/telemetry.ts`、`src/traced-repository.ts`、`src/app.ts`、`src/compose.ts`、`test/tracing.test.ts` | `test:unit` |
| Lambda で trace を取る | `examples/19-observability/src/lambda.ts`、`infra/lib/observability-stack.ts`、`infra/bin/app.ts` | `obs:infra:synth`、`test:unit` |
| 1 つの ID で辿る | `examples/19-observability/src/trace-context.ts`、`src/telemetry.ts`、`test/trace-context.test.ts`、`test/tracing.test.ts` | `test:unit` |
| trace は全部は残らない | `examples/19-observability/src/local-tracing.ts`、`src/cost-inputs.ts`、`test/tracing.test.ts` | `test:unit` |
| ログと trace に入れないもの | `examples/19-observability/src/log-shape.ts`、`src/telemetry.ts`、`test/log-shape.test.ts`、`test/tracing.test.ts` | `test:unit` |
| 手元で見る | `examples/19-observability/src/dev.ts`、`src/local-tracing.ts`、`.env.example` | `dev:obs`、`test:unit` |
| デプロイして確かめる | `examples/19-observability/infra/bin/app.ts`、`scripts/smoke.ts`、`scripts/query.ts`、`scripts/alarms.ts` | `obs:infra:diff`、`obs:infra:deploy`、`obs:smoke`、`obs:query`、`obs:alarms`、`obs:infra:drift` |
| お金の話 | `examples/19-observability/src/cost-inputs.ts`、`test/cost-inputs.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `obs:infra:destroy` |

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::CloudWatch::Alarm`、`AWS::SNS::Topic`、`AWS::SNS::Subscription`、`AWS::Logs::LogGroup`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::DynamoDB::Table`、`AWS::ApiGatewayV2::*`。専用の実装が無く Cloud Control API 経由になるもの: `AWS::CloudWatch::Dashboard`、`AWS::Logs::MetricFilter`（この章の stack にある）、`AWS::RUM::AppMonitor`、`AWS::Synthetics::Canary`（この章の stack には無い）。

**一次情報**（確認日はすべて 2026-10-12）

- [X-Ray SDK and Daemon Support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html)、[Migrating from X-Ray instrumentation to OpenTelemetry instrumentation](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html)、[Migrate to OpenTelemetry Node.js](https://docs.aws.amazon.com/xray/latest/devguide/migrate-xray-to-opentelemetry-nodejs.html)
- [AWS Distro for OpenTelemetry: Lambda](https://aws-otel.github.io/docs/getting-started/lambda)（layer の ARN と対応 runtime の表は、ページの生成元である `aws-otel/aws-otel.github.io` の `src/config/` で読みました）、[Enable your applications on Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html)
- [Visualize Lambda function invocations using AWS X-Ray](https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html)、[Instrumenting Node.js code in AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-tracing.html)、[Log and monitor Node.js Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)、[Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)、[Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)
- [Monitor CloudWatch metrics for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html)、[Configure logging for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)、[DynamoDB metrics and dimensions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html)
- [Configuring how CloudWatch alarms treat missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html)、[Alarm evaluation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html)、[Using math expressions with CloudWatch metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/using-metric-math.html)、[Notifying users on alarm changes](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)
- [Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)、[filter](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Filter.html)、[stats](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Stats.html)、[Supported logs and discovered fields](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html)、[Working with log groups and log streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)
- [Creating metrics from log events using filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html)、[Filter pattern syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html)、[Embedding metrics within logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html)、[Embedded metric format specification](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)
- [AWS X-Ray concepts](https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html)、[Sending trace data to AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-api-sendingdata.html)、[Configuring sampling rules](https://docs.aws.amazon.com/xray/latest/devguide/xray-console-sampling.html)、[Amazon SQS and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html)、[OTLP Endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)、[Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Transaction-Search.html)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html)、[Synthetic monitoring (canaries)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)
- [Amazon CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/)（単価の多くはスクリプトで表示されるため、無料枠と課金の考え方だけをここから読みました。`aws.amazon.com/xray/pricing/` は CloudWatch のページへ転送されます）
- AWS Price List bulk API: [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)、[X-Ray](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSXRay/current/ap-northeast-1/index.json)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- [@opentelemetry/api 1.9.1](https://www.npmjs.com/package/@opentelemetry/api/v/1.9.1)（版の互換性の判定は、tarball の `build/src/internal/semver.js`）
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Cloudflare Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)

:::
