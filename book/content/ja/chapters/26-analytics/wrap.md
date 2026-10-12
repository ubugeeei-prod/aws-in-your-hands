---
title: "26 Analytics: 費用、注意点、片付け"
---

# 26 Analytics: 費用、注意点、片付け

## 料金

<!-- section: 26.cost -->

このページでは、ここまでに作った記録の経路とクエリにいくらかかるかを計算します。金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。API、Lambda、DynamoDB そのものの料金は 04章と 05章で計算したので、ここでは記録とクエリのぶんだけを見ます。

**誰も呼ばず、クエリも実行しない月は、0 です。** Firehose のストリームにも Athena のワークグループにも、置いてあるだけでかかる料金はありません。Glue Data Catalog はオブジェクト 100 万個まで無料で、このスタックが置くのはデータベースとテーブルの 2 個です。バケットに記録が残っていれば、その保存料だけがかかります。

月 100 万リクエストで、月に 100 回クエリを実行すると、次のようになります。

| 対象 | 数量 | gzip の JSON | Parquet |
| --- | --- | --- | --- |
| Firehose の取り込み | 4.77 GB | 0.172 | 0.172 |
| Parquet への変換 | 4.77 GB | | 0.105 |
| S3 への書き込み | 43,800 個 / 8,760 個 | 0.206 | 0.041 |
| S3 の保存（90 日） | 0.164 GB 月 / 0.236 GB 月 | 0.004 | 0.006 |
| Athena が読んだ量 | 100 回、どれも最低の 10 MB | 0.005 | 0.005 |
| Athena による S3 の読み取り | 432,000 回 / 86,400 回 | 0.160 | 0.032 |
| 合計 | | **0.55** | **0.36** |

この表から読み取れることが 3 つあります。

1 つ目は、Firehose の取り込みの量です。レコードは 1 件 242 バイトで、100 万件でも 0.23 GB しかありません。それが 4.77 GB になるのは、Firehose が Direct PUT のレコードを 5 KB 単位に切り上げて課金するからです。242 バイトのレコードも、5 KB として数えられます。

<<< @/examples/26-analytics/src/cost-inputs.ts{firehose}

小さなレコードを 1 件ずつ送るのは割高ということです。複数の行を 1 つのレコードにまとめて送れば、取り込みの料金は下がります。この章ではリクエストごとに 1 件を送っているので、まとめていません。

2 つ目は、オブジェクトの数が料金の半分以上を占めていることです。60 秒ごとに 1 つ書くと、月に 43,800 個になります。書くときに 1 回、Athena が読むときにも 1 回ずつ、S3 へのリクエストが発生します。Parquet の列が安く見えるのは、形式の違いよりも、バッファーを 300 秒にしてオブジェクトの数を 5 分の 1 にしたことによるものです。JSON のままでも間隔は延ばせます。延ばすと、記録がクエリに現れるまでの時間が長くなります。

Athena がオブジェクト 1 つにつき S3 へ何回リクエストするかは、確かめていません。表は 1 回と仮定しています。

3 つ目は、Athena の料金が最低額に張り付いていることです。

<<< @/examples/26-analytics/src/cost-inputs.ts{athena}

1 日ぶんの記録は gzip で 2 MB ほどなので、3 日ぶんを読んでも 10 MB に届きません。この規模では、Parquet にしても Athena の料金は変わりません。

無料枠は、Glue Data Catalog のオブジェクト 100 万個と、月 100 万リクエストを Price List で確認しました。Firehose と Athena には、Price List にも料金ページにも、毎月の無料枠が見当たりませんでした。

### dynamic partitioning を使った場合

使わなかった dynamic partitioning を、同じ月 100 万件に足した場合の追加ぶんは **0.36** です。内訳は、届けたデータ 0.225 GB に対する 0.007 と、オブジェクト 43,800 個に対する 0.350 です。レコードから値を取り出す処理の時間は見積もれなかったので、含めていません（1 時間あたり 0.112）。

ここでも金額を決めているのはオブジェクトの数です。dynamic partitioning は、パーティションごとに別のオブジェクトを書きます。利用者の ID のような値の種類が多いキーで分けると、オブジェクトの数は種類の数だけ増えます。同時に持てるパーティションの数にも、ストリームあたり 500 という上限があります（2026 年 10 月 13 日に確認）。

### 叩かれたら

この API には認証がないので、19章と同じ歯止めを付けてあります。ステージのスロットリングは毎秒 10 件で、関数まで届くのは 30 日で最大 2,592 万件です。その数だけ記録ができます。

上限に 30 日張り付いたときの記録のぶんは、定価で **4.76** です。Firehose の取り込みが 123.6 GB で 4.45、S3 への書き込みが 0.20、保存が 0.11 です。API、Lambda、DynamoDB のぶんは、19章の「叩かれたら」の表のとおりです。

クエリの側は、ワークグループの上限で 1 回あたり 0.005 ほどに止まります。回数には上限がないので、クエリを自動で繰り返す仕組みを作るときは、回数を自分で数えます。

スタックを消せば、取り込みとクエリの料金は止まります。バケットを空にするまでは、保存料が残ります。

## Cloudflare や Vercel から来た人へ

<!-- section: 26.compare -->

どちらのプラットフォームにも、記録を集めて集計する仕組みがあります。2026 年 10 月 12 日の時点で、公式ドキュメントから読み取れた範囲を並べます。

Cloudflare でこの章にいちばん近い体験は、Workers Analytics Engine です。Worker から `writeDataPoint()` でデータ点を書き、SQL の API で集計します。書き込みを待つ必要はなく、バケットもテーブルの定義もフォルダーの設計も要りません。違いは次のとおりです。

| | Workers Analytics Engine | この章（Firehose、S3、Athena） |
| --- | --- | --- |
| 書き込み | `writeDataPoint()`。待たなくてよい | `PutRecord` を待つ。失敗したら捨てる |
| 1 件の形 | blob 20 個、double 20 個、index 1 個まで | 自分で決めた JSON。列はテーブルに定義する |
| 保持 | 3 か月 | ライフサイクルルールで自分が決める |
| クエリ | SQL の API。1 つのテーブルだけで、`JOIN` と `UNION` は使えない | Athena の SQL。ほかのテーブルと結合できる |
| 正確さ | 書き込みが多いと標本化される。件数は `sum(_sample_interval)` で数える | 届いた記録は全件残る。重複は自分で取り除く |
| 料金 | Workers Paid に月 1,000 万データ点と 100 万クエリが含まれる。料金ページには、現在は課金していないとある | 取り込み、保存、読んだ量にそれぞれ課金 |

Cloudflare には、この章と同じ「ファイルをためて SQL で読む」構成もあります。Basin Pipelines が HTTP か Worker の binding でイベントを受け取り、R2 に Iceberg のテーブルか Parquet、JSON のファイルとして書きます。Basin SQL が、そのテーブルに SQL を実行します。ドキュメントによると、どちらも一般提供で、以前は Cloudflare Pipelines、R2 SQL と呼ばれていました。Basin SQL の料金は読んだ量で決まり、月 10 GB まで含まれ、それ以降は 1 TB あたり 2.50、1 回の最低は 10 MB です。課金の単位は Athena とよく似ています。1 回のクエリが読む量に利用者が上限を付ける設定は、確認した範囲では見当たりませんでした。

Logpush は、Cloudflare が持っているログを R2 や S3 などへ送る機能で、保存や検索の機能は持ちません。この章で言えば、Firehose に近い位置です。

Vercel では、置き場所と問いの種類が違います。Web Analytics は、ページビューと、Pro 以上で使えるカスタムイベントを集めます。料金は Pro で 1,000 イベントあたり 0.03、見られる期間は 12 か月です。集計は画面と、集計済みの値を返す API で行い、SQL は使えません。Observability Plus の Query は、リクエストや関数の呼び出しを、フォームで条件を選んで集計する機能です。こちらのドキュメントにも、SQL のインターフェースは見当たりませんでした。生のイベントが要るときは、Drains で外の HTTP エンドポイントへ送ります。

まとめると、アプリのイベントを数えたいだけなら、Workers Analytics Engine や Vercel の Web Analytics のほうが、ずっと少ない手間で始められます。この章の構成が要るのは、記録を自分の形で全件残したいとき、3 か月や 12 か月より長く持ちたいとき、ほかのデータと結合して集計したいときです。その代わり、ファイルの置き方、重複、日付の境目、読みすぎの上限を、すべて自分で決めることになります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| クエリが 0 件を返す | バケットの `requests_json/dt=<日付>/` にオブジェクトがあるかを見ます。バッファーの間隔（60 秒、Parquet は 300 秒）が過ぎていないと、まだありません。日付は UTC です |
| オブジェクトはあるのに 0 件 | テーブルの `storage.location.template` と、実際のキーが同じフォルダーを指しているかを確かめます。`2026-10-01` より前の日付は、範囲の外です |
| 昨日の深夜の記録が、昨日の集計に入らない | フォルダーの日付だけで絞っていないかを確かめます。記録は前後の日のフォルダーに入ることがあります。この章のクエリは前後 1 日を読みます |
| 件数が実際より多い | `count(*)` で数えていないかを確かめます。送り直しで同じ記録が 2 回入ります。`count(DISTINCT event_id)` で数えます |
| ログに `analytics record dropped` が出る | Firehose への送信が失敗したか、500 ミリ秒を超えました。`error` の内容を見ます。権限、ストリームの名前、スロットリングの順に疑います |
| クエリが取り消される | ワークグループの上限（1 GiB）を超えました。日付の範囲を狭めます。取り消されても、読んだぶんは課金されます |
| `HIVE_CURSOR_ERROR` が出る | JSON として読めない行があります。行の途中に改行が入っていないか、レコードの末尾に改行が付いているかを確かめます |
| `errors/format-conversion-failed/` にオブジェクトがある | Parquet への変換に失敗したレコードです。レコードの項目と、テーブルの列の型が合っているかを確かめます |
| Parquet に切り替えたら、それまでの記録が見えない | 正常です。テーブルは `requests_parquet/` を指しています。JSON の記録は `requests_json/` に残っています |
| スタックを消せない | バケットが空ではありません。`vp run analytics:empty --yes` を先に実行します |

## 本番にするなら

- 記録の保持期間を決めます。90 日は練習用の値です。記録にはノートの ID が入っているので、利用者がノートを消したあと、その ID をいつまで残してよいかを決めておきます
- バケットの `removalPolicy` を `RETAIN` にします。スタックを消しても記録が残るようにするためです
- Athena を使える人を IAM で決めます。使えるワークグループをこの 1 つに限り、バケットを直接読める人も限ります。ワークグループの上限は、ほかのワークグループを使えば避けられます
- ワークグループ全体の読んだ量に、通知を付けます。1 回ごとの上限は、回数の多さを止めません
- Firehose の配送の失敗に気づけるようにします。エラーのロググループと `errors/` は、見にいかないかぎり何も知らせません。19章のやり方で、Firehose のメトリクスにアラームを付けます。どのメトリクスを使うかは、この章では確かめていません
- 記録の欠けを数えます。`analytics record dropped` の行に 19章のメトリクスフィルターを付けると、どのくらい欠けているかがわかります
- 記録の形を変えるときの手順を決めます。列を足すなら、先にテーブルに足してからアプリを変えます。`v` を上げ、古い行で新しい列が `NULL` になることを、クエリの側で扱います
- 日本時間で集計するなら、クエリの範囲を 9 時間ずらします。フォルダーの日付は UTC のままにしておきます
- 関数まで届かないリクエストも数えたいなら、API Gateway のアクセスログを別のストリームで流します
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 26.cleanup -->

```bash
vp run analytics:empty
vp run analytics:empty --yes
vp run analytics:infra:destroy
```

1 つ目は、バケットにあるオブジェクトの数を表示するだけです。`--yes` を付けると、記録、変換に失敗したレコード、クエリの結果をすべて消します。固定している版の cdkd は空でないバケットを消さないので、スタックを消す前に実行します。

スタックを消すと、ストリーム、テーブルの定義、ワークグループ、バケット、ノートのテーブル、関数、API、ロググループが消えます。ワークグループには `recursiveDeleteOption` を付けてあるので、クエリの履歴が残っていても消せるはずです。実際の AWS では確かめていません。

ほかに残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

## 分散システムとして見ると

記録の経路は、アプリの本体とは別の信頼性で動きます。

- 状態の持ち主: ノートの正本は DynamoDB のテーブルです。バケットの記録は、起きたことの写しで、欠けることも重複することもあります
- 不変条件（invariant）: 記録が書けても書けなくても、API のレスポンスとノートの状態は変わらない
- 不変条件を壊そうとするテスト: 送信先が失敗する、例外を投げる、応答しない、の 3 通りで、レスポンスが変わらないことと、待つ時間に上限があることを確かめています
- 重複: 送る側のやり直しで、同じ記録が 2 回入ります。本物の SDK で応答を失わせて再現し、`event_id` で 1 回と数えることを確かめています
- 欠損: 送信が失敗した記録は捨てます。再送の仕組みは持っていません。正確な件数が要る問いは、テーブルを数えます
- 順序と時刻: フォルダーの日付は到着の時刻から、`at` はアプリの時計から来ます。2 つは一致しないので、フォルダーは広めに読み、`at` で絞ります
- 遅れ: 記録がクエリに現れるのは、バッファーの間隔が過ぎてからです。直前の 1 分は、まだ見えません

::: details この章の検証メモ

**手元で確かめたこと。** アプリ、記録の形、Firehose への送信（本物の SDK とネットワークの差し替え）、フォルダーの日付、クエリの生成と手元での評価、Parquet の列ごとの大きさ、料金計算の入力、インフラのユニットテスト（62 件）。型検査。synth（esbuild のバンドル込み。`-c format=parquet` を付けた場合も）。`dev:analytics` を起動して本文の `curl` を実行し、`dist/lake` にできたオブジェクトの中身と、`analytics:query:local` の出力を確認。`analytics:query:print` と `analytics:sizes` の出力。AWS CLI の `athena start-query-execution`、`get-query-execution`、`get-query-results` のヘルプで、スクリプトが使う引数と項目の名前。

**まだ確かめていないこと。** `analytics:infra:deploy`、`analytics:smoke`、`analytics:query`、`analytics:infra:drift`、`analytics:empty`、`analytics:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントから読み取っただけです。

- 生成した SQL を Athena が受け付けること。`substr`、`count(DISTINCT …)`、`approx_percentile`、文字列の列 `dt` に対する `BETWEEN` でフォルダーが絞られること。手元の評価は SQL のエンジンではありません。ワークグループのエンジンの版は指定しておらず、既定のままです
- Hive JSON SerDe が、このレコードの `null`、整数、文字列を列として読めること
- Firehose のフォーマット変換のすべて。バッファーの大きさの下限（64 MB を指定していますが、読んだページには下限の記述がありませんでした）、OpenX のデシリアライザーの動き、Firehose が書く Parquet の大きさ、Athena が報告するバイト数
- 記録のフォルダーと `errors/` だけに絞ったロールで、Firehose が配送できること
- cdkd が、ワークグループとログストリームを Cloud Control API 経由で作成・更新・削除できること。この 2 つの種類が Cloud Control API の対応一覧にあるかも、今回は確かめていません。Firehose の専用の実装が、このストリームの設定で作成に成功すること。形式を切り替えたときの更新が反映されること
- `PutRecord` を待つことによるレスポンスの遅れ。500 ミリ秒の上限は測定にもとづきません
- Athena のクエリ 1 回が S3 に行うリクエストの数。料金の表はオブジェクトごとに 1 回と仮定しています
- 料金のうち、Firehose の「5 KB」が 5,000 バイトか 5,120 バイトか（5,120 で計算）、Athena の「10 MB」と 1 TB の数え方、クエリの結果の保存料、Glue へのリクエストの数、Firehose のエラーログの量
- Cloudflare と Vercel の記述は、公式ドキュメントを要約して読んだものです。どちらのサービスも動かしていません

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、この構成を選んだ理由 | `examples/26-analytics/infra/lib/analytics-stack.ts`、`infra/test/analytics-stack.test.ts` | `test:unit` |
| 記録の形 | `examples/26-analytics/src/record.ts`、`src/describe.ts`、`test/record.test.ts`、`test/app.test.ts` | `test:unit` |
| アプリから Firehose へ | `examples/26-analytics/src/app.ts`、`src/sink.ts`、`src/lambda.ts`、`src/compose.ts`、`test/app.test.ts`、`test/sink.test.ts` | `test:unit` |
| 日付で分けて S3 に書く | `examples/26-analytics/src/partition.ts`、`src/lake.ts`、`test/partition.test.ts`、`infra/lib/analytics-stack.ts` | `test:unit`、`analytics:infra:synth` |
| テーブルの定義と partition projection | `examples/26-analytics/src/partition.ts`、`src/names.ts`、`infra/lib/analytics-stack.ts`、`infra/test/analytics-stack.test.ts` | `test:unit`、`analytics:infra:synth` |
| クエリ | `examples/26-analytics/src/queries.ts`、`test/queries.test.ts`、`scripts/query.ts` | `test:unit`、`analytics:query:print` |
| JSON と Parquet | `examples/26-analytics/src/columnar.ts`、`src/sample.ts`、`test/columnar.test.ts`、`scripts/sizes.ts` | `test:unit`、`analytics:sizes` |
| 読みすぎと置きっぱなしを防ぐ | `examples/26-analytics/infra/lib/analytics-stack.ts`、`infra/test/analytics-stack.test.ts` | `test:unit`、`analytics:infra:synth` |
| 手元で動かす | `examples/26-analytics/src/dev.ts`、`src/lake.ts`、`src/local-files.ts`、`scripts/query.ts`、`.env.example` | `dev:analytics`、`analytics:query:local`、`test:unit` |
| デプロイして確かめる | `examples/26-analytics/infra/bin/app.ts`、`scripts/smoke.ts`、`scripts/query.ts` | `analytics:infra:diff`、`analytics:infra:deploy`、`analytics:smoke`、`analytics:query`、`analytics:infra:drift` |
| 料金 | `examples/26-analytics/src/cost-inputs.ts`、`test/cost-inputs.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `examples/26-analytics/scripts/empty-lake.ts`、`tools/src/infra/` | `analytics:empty`、`analytics:infra:destroy` |

**cdkd（0.296.28）での扱い。** インストールした版の `dist/` を読んで確かめました。専用の実装があるもの: `AWS::KinesisFirehose::DeliveryStream`、`AWS::Glue::Database`、`AWS::Glue::Table`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::Logs::LogGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::DynamoDB::Table`、`AWS::ApiGatewayV2::*`。専用の実装が無く Cloud Control API 経由になるもの: `AWS::Athena::WorkGroup`、`AWS::Logs::LogStream`。Firehose の実装が S3 の宛先について Firehose に渡すのは、`Prefix`、`ErrorOutputPrefix`、`CompressionFormat`、`BufferingHints`、`EncryptionConfiguration`、`CloudWatchLoggingOptions`、`ProcessingConfiguration`、`S3BackupMode`、`S3BackupConfiguration`、`DataFormatConversionConfiguration` です。`DynamicPartitioningConfiguration`、`CustomTimeZone`、`FileExtension` は渡しません。

**一次情報**（確認日は 2026-10-12 と 2026-10-13。出典ごとの日付は[出典の一覧](/ja/reference/sources.md)にあります）

- Firehose: [Understand custom prefixes for Amazon S3 objects](https://docs.aws.amazon.com/firehose/latest/dev/s3-prefixes.html)、[Configure Amazon S3 object name format](https://docs.aws.amazon.com/firehose/latest/dev/s3-object-name.html)、[Understand data delivery](https://docs.aws.amazon.com/firehose/latest/dev/basic-deliver.html)、[Handle data delivery failures](https://docs.aws.amazon.com/firehose/latest/dev/retry.html)、[Configure backup settings](https://docs.aws.amazon.com/firehose/latest/dev/create-configure-backup.html)（バッファーの範囲）、[Convert input data format](https://docs.aws.amazon.com/firehose/latest/dev/record-format-conversion.html)、[Controlling access](https://docs.aws.amazon.com/firehose/latest/dev/controlling-access.html)
- Firehose の dynamic partitioning: [Partition streaming data](https://docs.aws.amazon.com/firehose/latest/dev/dynamic-partitioning.html)、[Enable dynamic partitioning](https://docs.aws.amazon.com/firehose/latest/dev/dynamic-partitioning-enable.html)、[Buffer data for dynamic partitioning](https://docs.aws.amazon.com/firehose/latest/dev/buffering.html)
- Firehose の API: [PutRecord](https://docs.aws.amazon.com/firehose/latest/APIReference/API_PutRecord.html)、[BufferingHints](https://docs.aws.amazon.com/firehose/latest/APIReference/API_BufferingHints.html)、[Processor](https://docs.aws.amazon.com/firehose/latest/APIReference/API_Processor.html)
- CloudWatch Logs からの経路: [Send CloudWatch Logs to Firehose](https://docs.aws.amazon.com/firehose/latest/dev/writing-with-cloudwatch-logs.html)、[Log group-level subscription filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html)、[Configure logging for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)
- Athena の partition projection: [Use partition projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html)、[Supported types](https://docs.aws.amazon.com/athena/latest/ug/partition-projection-supported-types.html)、[Set up partition projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection-setting-up.html)、[Amazon Data Firehose example](https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html)
- Athena のファイルの読み方: [Hive JSON SerDe](https://docs.aws.amazon.com/athena/latest/ug/hive-json-serde.html)、[OpenX JSON SerDe](https://docs.aws.amazon.com/athena/latest/ug/openx-json-serde.html)、[Parquet SerDe](https://docs.aws.amazon.com/athena/latest/ug/parquet-serde.html)、[Use columnar storage formats](https://docs.aws.amazon.com/athena/latest/ug/columnar-storage.html)、[Create a table for AWS WAF S3 logs using partition projection](https://docs.aws.amazon.com/athena/latest/ug/create-waf-table-partition-projection.html)（JSON のテーブルの input format と output format）
- Athena のクエリ: [Configure per-query and per-workgroup data usage controls](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html)、[Athena engine version 3 functions](https://docs.aws.amazon.com/athena/latest/ug/functions-env3.html)、[Trino: Aggregate functions](https://trino.io/docs/current/functions/aggregate.html)
- 料金: [Amazon Data Firehose Pricing](https://aws.amazon.com/firehose/pricing/)、[Amazon Athena Pricing](https://aws.amazon.com/athena/pricing/)（どちらも課金の考え方だけをここから読みました。単価は Price List のものです）
- AWS Price List bulk API: [Firehose](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonKinesisFirehose/current/ap-northeast-1/index.json)、[Athena](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonAthena/current/ap-northeast-1/index.json)、[Glue](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSGlue/current/ap-northeast-1/index.json)、[S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)（このページは今回は読み直していません）、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義
- [hyparquet-writer 0.16.11](https://www.npmjs.com/package/hyparquet-writer/v/0.16.11)（手元で Parquet を書いて測るためだけに使用）
- Cloudflare: [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)、[Basin SQL](https://developers.cloudflare.com/r2-sql/)、[Basin Pipelines](https://developers.cloudflare.com/pipelines/)、[Logpush](https://developers.cloudflare.com/logs/logpush/)
- Vercel: [Pricing for Web Analytics](https://vercel.com/docs/analytics/limits-and-pricing)、[Query](https://vercel.com/docs/query)、[Drains](https://vercel.com/docs/drains)

:::
