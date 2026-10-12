---
title: "19 Observability: 費用、注意点、片付け"
---

# 19 Observability: 費用、注意点、片付け

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

### 叩かれたとき

この API には認証がありません。URL を知っていれば、誰でも、bot でも呼べます。では、1 か月ずっと叩かれ続けたら、いくらになるでしょう。

まず、どこで止まるか。stage の流量制限が毎秒 10 件（burst 20）なので、関数まで届くのは 30 日で最大 2,592 万件です。それを超えたぶんは API Gateway が 429 で返し、関数は呼ばれません。table は毎秒 150 read request unit、40 write request unit まで。ノートは 100 件で頭打ちなので、保存量は増え続けません。

その上限に 1 か月張り付いたときの定価です。

| 項目 | 数量 | 定価 |
| --- | --- | --- |
| API Gateway | 2,592 万リクエスト | 33.44 |
| Lambda（60 ms、256 MB の仮定） | 2,592 万回 | 10.37 |
| DynamoDB の書き込み | 上限の毎秒 40 unit | 74.13 |
| DynamoDB の読み取り | 上限の毎秒 150 unit | 55.40 |
| ログの取り込みと保存 | 24.7 GB | 18.98 |
| trace の記録 | 376 万件 | 18.79 |
| 合計 | | **211.11** |

観測のぶんは、ログと trace を合わせて 37.77 です。trace が意外と増えないのは sampling のおかげで、毎秒 10 件なら記録されるのは「最初の 1 件と、残り 9 件の 5%」で毎秒 1.45 件。流量が増えるほど、trace の割合は下がります。ログは下がりません。届いたリクエストの数だけ、行が増えます。

429 で断ったリクエストに API Gateway の料金がかかるかどうかは、ここでは確かめていません。かかるなら、上の表の 1 行目だけは 2,592 万件で止まりません。

もう 1 つ、表に入れていないのがレスポンスのデータ転送です。レスポンスの大きさは 05章の契約が決めていて、一覧は 1 ページ 20 件の要約で 20 KiB まで、ノート 1 件は 64 KiB までです。毎秒 10 件が 30 日続くと、すべてが一覧なら約 494 GB で、インターネットへの転送の単価（1 GB あたり 0.114）を当てはめると 56 ほどです。すべてが 64 KiB のノート 1 件だったとしても、約 1,582 GB で 180 ほどに収まります。この単価が API Gateway のレスポンスにそのまま当てはまるかは、確かめていません。

では、この章で作ったもので、フラッドはどう見えるか。

- **ダッシュボードの左上。** `4xx` の線が跳ね上がります。429 はここに入るので、線の名前を `4xx (429 when throttled)` にしてあります
- **アラームは鳴りません。** 429 は 5xx ではなく、返事も速いからです。症状にだけ付けたアラームとしては正しい動きですが、同じ毎秒 10 件を分け合っている本物の利用者も 429 を受け取ります
- **table の上限に当たると、鳴ります。** DynamoDB が throttle して、SDK の再試行でも通らなければ、アプリは 500 を返します。`DynamoDB: throttled requests` が増えて、5xx の率のアラームが鳴る。上限の付いた table では、「流量が多すぎる」が障害として見える、ということです
- **ログと trace には、429 が残りません。** 関数まで届いていないからです。「本番にするなら」に書いた access log が要るのは、このためです

本物の利用者を迎える前に足すものは、認証（06章）と、入口での IP ごとの制限です。AWS WAF は HTTP API には直接付けられないので、前に CloudFront を置くことになります（21章。web ACL は、置いてあるだけで月 8.00）。

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
| アラームは `ALARM` で購読も確認済みなのに、メールが来ない | topic の policy に、CloudWatch からの publish を許す statement が残っていますか。`enforceSSL` を付けた topic は、既定の policy を使いません |
| 429 が返る | stage の流量制限（毎秒 10 件、burst 20）です。ダッシュボードの `4xx` を見る。アプリのログには残りません |
| ノートを作ると 409 `quota_exceeded` | 100 件の上限です。1 件消すと作れます |
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
- **流量制限と上限を、自分のサービスの数字に直す。** 毎秒 10 件、table の 150 と 40、ノート 100 件は、練習用の歯止めです。利用者が増えたら、本物の利用者が 429 を受け取る前に見直します。`4xx` にアラームを付けるなら、閾値は普段の値を見てから
- **ログの保持期間を決める。** 7 日は練習用の値です
- **アラームに対応手順を書く。** `alarmDescription` に、最初に開くダッシュボードと query を書いておくと、鳴ったときに迷いません
- **topic を暗号化する、通知に載る内容を確かめる。** アラームの通知には、メトリクスの名前と閾値が入ります。この章の topic は、通信の暗号化（`enforceSSL`）までで、保存時の鍵は指定していません
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
- 歯止めが実際に効くこと。stage の `DefaultRouteSettings`（毎秒 10 件、burst 20）と、table の `OnDemandThroughput`（150 と 40）を、cdkd 0.296.28 が反映するかどうか。固定した版のソースには、どちらの property も扱うコードがありますが、動かしてはいません。429 が `4xx` に数えられること、429 に API Gateway の料金がかかるかどうか、table の上限に当たったときに 500 になるまでの SDK の再試行の様子も未確認です
- `enforceSSL` を付けた topic に、CloudWatch アラームが publish できること。許可の statement は template にあることをテストで見ていますが、通知は 1 通も送っていません
- 料金のうち、ダッシュボードの 4 つ目からの単価、Lambda が JSON 形式で書くシステムのログの大きさ（1 リクエスト 1 KB は仮定）、layer 経由の span の課金のされ方

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/19-observability/infra/lib/observability-stack.ts`、`src/compose.ts`、`test/compose.test.ts`、`infra/test/observability-stack.test.ts` | `test:unit` |
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

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::CloudWatch::Alarm`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SNS::Subscription`、`AWS::Logs::LogGroup`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::DynamoDB::Table`、`AWS::ApiGatewayV2::*`。専用の実装が無く Cloud Control API 経由になるもの: `AWS::CloudWatch::Dashboard`、`AWS::Logs::MetricFilter`（この章の stack にある）、`AWS::RUM::AppMonitor`、`AWS::Synthetics::Canary`（この章の stack には無い）。

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
