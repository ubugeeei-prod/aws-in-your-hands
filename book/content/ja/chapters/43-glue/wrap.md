---
title: "43 Glue: 費用、注意点、片付け"
---

# 43 Glue: 費用、注意点、片付け

## 料金

<!-- section: 43.cost -->

このページでは、ここまでに作ったジョブにいくらかかるかを計算します。金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**ジョブを 1 回も実行しない月は、定価で 0.10 です。** アラーム 1 つの料金で、アカウントのアラームが合わせて 10 個までなら無料枠に入り、0 になります。ジョブ、トリガー、ルール、購読のないトピックには、置いてあるだけでかかる料金はありません。カタログのオブジェクトはデータベース 1 つとテーブル 2 つで、100 万個の無料枠に収まります。バケットにファイルが残っていれば、その保存料がかかります。

ジョブの料金は、DPU の数と時間の掛け算です。東京リージョンでは 1 DPU 時間あたり 0.44 で、秒単位で課金され、1 回の実行は 1 分より短く数えられることがありません。

<<< @/examples/43-glue/src/cost.ts{dpu}

このジョブは 2 DPU なので、1 回の実行の最低額は 2 × 60 ÷ 3600 × 0.44 で、0.0147 です。

毎日 1 回、月に 30 回実行した場合を並べます。実行にかかる時間は測っていないので、3 通りを計算しました。

| 1 回の実行に課金される時間 | DPU 時間 | 月額 |
| --- | --- | --- |
| 1 分（最低） | 1 | **0.44** |
| 3 分（仮定） | 3 | **1.32** |
| 10 分（このジョブのタイムアウト） | 10 | **4.40** |

1 行目は下限で、これより安くはなりません。3 行目は上限で、毎回タイムアウトまで動き続けても、これより高くはなりません。実際の金額は、そのあいだのどこかです。タイムアウトを書かなかった場合の上限は、1 回の実行で 7.04 です。

S3 のリクエストと保存、ログの料金は、この表に入れていません。Spark が 1 回の実行で S3 に何回リクエストするかは、測っていません。

無料枠は、ジョブの DPU 時間については、Price List にも料金ページにも見当たりませんでした。

### 同じ量をもっと安く

同じ 1 DPU 時間が、実行クラスを Flex にすると 0.29、Glue 6.0 では 0.308 です。Flex は急がないジョブのためのクラスで、始まる時刻と終わる時刻が一定しないとドキュメントにあります。毎日の集計なら、候補になります。どちらもこのスタックでは試していません。

それでも、[最初のページ](/ja/chapters/43-glue.md)で比べたように、この量なら Athena の `INSERT INTO` のほうが 2 桁安くなります。ジョブの料金は、処理するデータの量ではなく、最低 2 DPU の 1 分から始まるからです。

### crawler を毎日動かした場合

このスタックには crawler がありません。もし毎日 1 回動かしていたら、月に **4.40** かかります。crawler の料金も 1 DPU 時間あたり 0.44 ですが、1 回の crawl は最低 10 分ぶんが課金されます。この金額は、料金ページの例と同じ 2 DPU を仮定しています。crawler が実際に使う DPU の数は、確かめていません。

## Cloudflare や Vercel から来た人へ

<!-- section: 43.compare -->

2026 年 10 月 13 日の時点で、公式ドキュメントから読み取れた範囲を書きます。どちらのサービスも動かしていません。

Cloudflare には、Glue の Data Catalog に当たるものがあります。Basin Catalog（以前の R2 Data Catalog）は、R2 のバケットに組み込まれた Apache Iceberg のカタログです。標準の Iceberg REST のインターフェースを持ち、Spark、Snowflake、PyIceberg、DuckDB のようなエンジンをつなぎます。料金は、カタログへの操作が月 100 万回まで含まれ、その先は 100 万回あたり 9.00 です。ファイルのまとめ直しを有効にすると、処理した量に 1 GB あたり 0.005、オブジェクト 100 万個あたり 2.00 がかかります。

この章のテーブルとの違いは、テーブルの形式です。Basin Catalog が扱うのは Iceberg のテーブルだけです。Cloudflare のページは、Iceberg の特長として ACID のトランザクションを挙げています。この章のテーブルは、フォルダーにあるファイルがそのままテーブルの中身になる形で、置き換えは「日のフォルダーを消してから書く」しかありませんでした。Glue のカタログにも Iceberg のテーブルは置けます。それは 49章が扱います。

変換については、Basin Pipelines（以前の Cloudflare Pipelines）が、取り込みのときに SQL で形を変え、R2 に Iceberg のテーブルか Parquet、JSON のファイルとして書きます。最初から整った形で書けるなら、後から書き直すジョブは要りません。すでに書かれたファイルを後からまとめて書き直す、Glue のジョブのような実行環境は、読んだページの範囲では Cloudflare に見当たりませんでした。Spark を自分で用意して、カタログにつなぐことになります。

Vercel のドキュメントの索引には、データのカタログも、バッチで変換を動かす製品も見当たりませんでした。索引の 1 ページを見ただけなので、無いと言い切ることはできません。

まとめると、イベントが Cloudflare を通っているなら、Pipelines で取り込みのときに形を整え、Iceberg のテーブルに書くほうが、部品が少なく済みます。Glue のジョブが要るのは、すでに S3 にたまったファイルを書き直すとき、取り込みのあとで別のデータと突き合わせるとき、Spark で書いた処理をそのまま動かしたいときです。そのかわり、スクリプトの言語、ワーカーの数、タイムアウト、ロール、出力の置き換え方を、自分で決めることになります。

## つまずきやすいところ

この表は、ドキュメントとコードから予想したものです。実際に起こして確かめたものはありません。

| こうなったら | ここを見る |
| --- | --- |
| 実行が権限のエラーで失敗する | ロググループ `/aih/glue/curate/error` と CloudTrail で、拒否されたアクションとリソースを調べます。そのアクションだけをロールに足します |
| 実行は成功したのに、日のフォルダーができない | その日の行が 0 件でした。`--days` は UTC の日付です。`requests_json/` に、その日と前後 1 日のフォルダーがあるかを見ます |
| 実行が、ルールの名前を含むエラーで失敗する | Data Quality のルールが落ちました。その日のフォルダーは前のままです。生のファイルのどの行が原因かを、26章のクエリか `gunzip -c` で調べます |
| 実行が、読めない行のエラーで失敗する | `FAILFAST` が、JSON として読めない行か、型の合わない項目に当たりました。`requests_json/` にアプリ以外が書いたファイルが無いかを見ます |
| `glue:verify` が missing を報告する | 前後のフォルダーを読めていないか、`glue:seed` のあとで生のファイルが変わっています |
| `glue:verify` が doubled を報告する | 日のフォルダーに、前の実行のファイルが残っています。置き換えが、フォルダーを消していません |
| 2 つ目の実行が始まらない | 同時に動かせる実行は 1 つです。前の実行が終わるのを待ちます |
| Athena で 0 件になる | フォルダーにファイルがあるかを見ます。`2026-10-01` より前の日付は、partition projection の範囲の外です |
| Athena で列が `NULL` になる、または型のエラーになる | テーブルの列と、ジョブが書いたファイルの列が食い違っています。`vp run glue:contract` を実行し、デプロイし直して、その日を作り直します |
| `-c schedule=on` を付けたのに、毎日動かない | すでにあるトリガーは、デプロイでは有効になりません。`aws glue start-trigger` を実行します |
| 失敗したのに、通知が来ない | トピックに購読があるかを見ます。イベントの配送はベストエフォートです |
| スクリプトを直したのに、古いまま動く | スクリプトはデプロイのときに S3 に置かれます。`vp run glue:infra:deploy` をやり直します |
| スタックを消せない | バケットが空ではありません。`vp run glue:empty --yes` を先に実行します |

## 本番にするなら

- 生のファイルを、26章のストリームから受け取ります。ストリームの宛先をこのバケットにするか、ジョブの `--source` を 26章のバケットにして、ロールの読み取りをそちらに向けます
- 生のファイルと整えたファイルの保持期間を決めます。整えたファイルを作り直せるのは、生のファイルが残っているあいだだけです。作り直す必要がなくなる時期より長く、生のファイルを持ちます
- バケットの `removalPolicy` を `RETAIN` にします
- トピックに購読を足し、アラームのアクションもトピックに向けます。スケジュールで動かすなら、成功のイベントが 26 時間来ないことを見るアラームを足します
- 置き換えの途中の、フォルダーが空になる時間を許せるかを決めます。許せないなら、Iceberg のテーブルにします
- 1 日ぶんが大きくなったら、`coalesce(1)` を外し、ワーカーを増やします。ワーカーを増やす前に、実行時間と DPU 時間を数回ぶん記録します
- ジョブを動かせる人を IAM で決めます。`glue:StartJobRun` を持つ人は、引数で `--target` を変えられます。変えさせたくない引数は、ジョブの `NonOverridableArguments` に置きます
- スクリプトを変える手順を決めます。仕様の関数とテストを先に変え、スクリプトを合わせ、`glue:seed`、`glue:run`、`glue:verify` を練習用のスタックで通してから、本番に出します
- Lake Formation を使うアカウントでは、ジョブのロールにテーブルと場所への権限を与えます
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 43.cleanup -->

```bash
vp run glue:empty
vp run glue:empty --yes
vp run glue:infra:destroy
```

1 つ目は、バケットにあるオブジェクトの数を表示するだけです。`--yes` を付けると、生のファイルと整えたファイルをすべて消します。固定している版の cdkd は空でないバケットを消さないので、スタックを消す前に実行します。

スタックを消すと、ジョブ、トリガー、テーブルの定義、バケット、ロール、ロググループ、ルール、トピック、アラームが消えます。トリガーを有効にしていても、トリガーごと消えるので、それ以降は実行されません。

残るものは 2 つです。1 つは、cdkd の bootstrap で作った保存場所（02章）で、スクリプトのファイルはそこに残ります。もう 1 つは、あるかもしれないものです。ジョブが `--custom-logGroup-prefix` の指定にかかわらず `/aws-glue/` で始まるロググループに何かを書いていた場合、そのロググループはスタックの外にあります。デプロイして実行したあとで、`/aws-glue/` で始まるロググループが増えていないかを見てください。

## 分散システムとして見ると

- 状態の持ち主: 正本は生のファイルです。整えたファイルは、生のファイルから計算した写しで、生のファイルが残っているあいだは何度でも作り直せます。生のファイルが消えた日からは、整えたファイルがただ 1 つの記録になります
- 不変条件: 実行が成功したあと、日のフォルダーには、その日に答えたリクエストが 1 件ずつ入っている
- 不変条件を壊そうとするテスト: 同じ日を 2 回実行する、書いたあとで失敗させてやり直す、消したあと書く前に失敗させてやり直す、遅れたファイルを後から足す、生のファイルを空にして実行する、ルールを落とす、の 6 通りです。どれも実行のモデルの上のテストで、Spark は動いていません
- 重複: 入力の重複は、日を丸ごと読んで `event_id` で取り除きます。実行の重複は、出力を置き換えにして吸収します。bookmark と追記の組み合わせでは、どちらも残ることをテストで見ました
- 部分的な失敗: 複数の日を指定した実行が途中で失敗すると、前の日は新しく、後の日は古いままです。日ごとに独立しているので、もう一度実行すればそろいます
- 見えてしまう途中の状態: 置き換えの最中は、日のフォルダーが空か、書きかけです。読む側には、欠けた日に見えます
- 時刻: 日の境目は UTC で、記録の `at` はアプリの時計です。ジョブが「昨日」を決めるのは Glue の側の時計です。01:00 UTC に実行するのは、境目の前後の記録を待つためで、遅れた記録は次の日の実行が拾います

::: details この章の検証メモ

**手元で確かめたこと。** 仕様の関数、フォルダーの置き方と作り直せる日の範囲、実行のモデル、DQDL の文字列とルールの評価、スクリプトに写した列とルール、料金の数量、Parquet から読み戻した行の比較、スタックのアサーション（ユニットテスト 62 件）。型検査。synth（`-c schedule=on` を付けた場合も）。`glue:spec` と `glue:contract` の出力。AWS CLI の `glue start-job-run`、`get-job-run`、`start-trigger`、`stop-trigger` のヘルプで、スクリプトと本文が使う引数と項目の名前。`glue/curate.py` は、構文の検査だけを、Nix の外にある手元の Python 3.12.2 で通しました。

**まだ確かめていないこと。** `glue:infra:deploy`、`glue:seed`、`glue:run`、`glue:verify`、`glue:infra:drift`、`glue:empty`、`glue:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントとソースから読み取っただけです。

- `glue/curate.py` が動くこと、仕様どおりに書くこと。Spark でも Glue でも、一度も実行していません。`dt STRING` を足したスキーマでのパーティションの読み取り、`FAILFAST` が止まる条件、`DataFrame.isEmpty`、`awsgluedq` の `process_rows` が Glue 5.1 で返す結果の形、上書きが日のフォルダーだけを置き換えること、`requests_json/` に何も無いときの挙動
- ジョブの引数。実行のときに渡した `--days` が、既定の引数のうち同じ名前のものだけを置き換えること。ジョブに `PythonVersion` を指定していないこと（型定義は Python shell のためのプロパティと説明しています）
- ロールが足りること。`glue:` と `cloudwatch:` のアクションが無くても動くか、すでにあるロググループに `logs:CreateLogGroup` を求めないか、S3 のコネクターが `requests_curated/` の外にオブジェクトを書かないか
- Data Quality の実物の評価。この章の `evaluate` はモデルです。`IsUnique` での `NULL` の扱い、行が 0 件のときの結果、数値の `=` の比べ方
- 失敗の通知。イベントの `detail` の項目名、`MatchedEvents` がこのルールで記録されること、アラームの動き
- cdkd でのデプロイ。スクリプトのアセットの置き場所と、テンプレートの中のバケット名の書き換え。トリガーの更新
- 実行にかかる時間と、起動の時間が課金に入るか。料金の表の 3 分は仮定です
- Athena が、Spark の書いた Parquet を `requests_curated` の定義で読めること
- `glue:verify` が、Spark の書いた Parquet を読めること。テストで読んだのは、JavaScript のライブラリが書いたファイルです
- Cloudflare と Vercel の記述は、公式ドキュメントを読んだだけです

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、ジョブにする場合、しない場合 | `examples/43-glue/infra/lib/glue-stack.ts` | `glue:infra:synth` |
| カタログは約束で、検査ではない | `examples/43-glue/src/names.ts`、`infra/lib/glue-stack.ts`、`infra/test/glue-stack.test.ts` | `test:unit`、`glue:infra:synth` |
| パーティションの知らせ方 | `examples/43-glue/infra/lib/glue-stack.ts`、`infra/test/glue-stack.test.ts`、`src/cost.ts` | `test:unit` |
| ジョブの仕様 | `examples/43-glue/src/curate.ts`、`src/layout.ts`、`src/sample.ts`、`test/curate.test.ts`、`test/layout.test.ts` | `test:unit`、`glue:spec` |
| Spark のスクリプト | `examples/43-glue/glue/curate.py`、`src/contract.ts`、`scripts/contract.ts`、`test/contract.test.ts` | `test:unit`、`glue:contract` |
| job bookmark が保証すること、しないこと | `examples/43-glue/src/model.ts`、`test/model.test.ts` | `test:unit` |
| Data Quality のルール | `examples/43-glue/src/quality.ts`、`test/quality.test.ts` | `test:unit`、`glue:spec` |
| ジョブの設定とロール、失敗を知る | `examples/43-glue/src/job.ts`、`infra/lib/glue-stack.ts`、`infra/test/glue-stack.test.ts` | `test:unit`、`glue:infra:synth` |
| 手元で動かす | `examples/43-glue/scripts/spec.ts`、`scripts/contract.ts`、`src/sample.ts` | `glue:spec`、`glue:contract`、`test:unit` |
| デプロイして確かめる | `examples/43-glue/infra/bin/app.ts`、`scripts/seed.ts`、`scripts/run.ts`、`scripts/verify.ts`、`src/compare.ts`、`src/parquet.ts` | `glue:infra:diff`、`glue:infra:deploy`、`glue:seed`、`glue:run`、`glue:verify`、`glue:infra:drift` |
| 料金 | `examples/43-glue/src/cost.ts`、`test/cost.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `examples/43-glue/scripts/empty.ts`、`tools/src/infra/` | `glue:empty`、`glue:infra:destroy` |

**cdkd（0.296.28）での扱い。** インストールした版の `dist/` を読んで確かめました。このスタックが使う 13 種類には、すべて専用の実装があります。`AWS::Glue::Database`、`AWS::Glue::Table`、`AWS::Glue::Job`、`AWS::Glue::Trigger`、`AWS::Events::Rule`、`AWS::CloudWatch::Alarm`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::Logs::LogGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy` です。Glue のジョブの実装は、このスタックが使うプロパティ（`Command`、`Role`、`GlueVersion`、`WorkerType`、`NumberOfWorkers`、`Timeout`、`MaxRetries`、`ExecutionProperty`、`DefaultArguments`）をすべて `CreateJob` に渡します。トリガーの実装は、`StartOnCreation` を作成のときだけ渡します。

**一次情報**（確認日はすべて 2026-10-13。出典ごとの内容は[出典の一覧](/ja/reference/sources.md)にあります）

- Glue の全体: [What is AWS Glue?](https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html)、[AWS Glue versions](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html)、[AWS Glue for Ray end of support](https://docs.aws.amazon.com/glue/latest/dg/awsglue-ray-jobs-availability-change.html)、[Python shell jobs](https://docs.aws.amazon.com/glue/latest/dg/add-job-python.html)、[Migrate from AWS Glue Python shell jobs](https://docs.aws.amazon.com/glue/latest/dg/pyshell-migration.html)、[AWS Glue Schema registry](https://docs.aws.amazon.com/glue/latest/dg/schema-registry.html)
- ジョブ: [Configuring job properties for Spark jobs](https://docs.aws.amazon.com/glue/latest/dg/add-job.html)、[Using job parameters](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-glue-arguments.html)、[getResolvedOptions](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-api-crawler-pyspark-extensions-get-resolved-options.html)、[Logging for AWS Glue jobs](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuous-logging.html)、[Create an IAM role for AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/create-an-iam-role.html)、[AWSGlueServiceRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSGlueServiceRole.html)
- job bookmark: [Tracking processed data using job bookmarks](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html)、[Using job bookmarks](https://docs.aws.amazon.com/glue/latest/dg/programming-etl-connect-bookmarks.html)
- crawler とパーティション: [Using crawlers to populate the Data Catalog](https://docs.aws.amazon.com/glue/latest/dg/add-crawler.html)、[Preventing a crawler from changing an existing schema](https://docs.aws.amazon.com/glue/latest/dg/crawler-schema-changes-prevent.html)、[Updating the schema and adding new partitions using AWS Glue ETL jobs](https://docs.aws.amazon.com/glue/latest/dg/update-from-job.html)、[Use partition projection with Amazon Athena](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html)、[Partition your data](https://docs.aws.amazon.com/athena/latest/ug/partitions.html)
- トリガーとワークフロー: [AWS Glue triggers](https://docs.aws.amazon.com/glue/latest/dg/about-triggers.html)、[Time-based schedules](https://docs.aws.amazon.com/glue/latest/dg/monitor-data-warehouse-schedule.html)、[Overview of workflows](https://docs.aws.amazon.com/glue/latest/dg/workflows_overview.html)
- Data Quality: [AWS Glue Data Quality](https://docs.aws.amazon.com/glue/latest/dg/glue-data-quality.html)、[DQDL reference](https://docs.aws.amazon.com/glue/latest/dg/dqdl.html)、[ColumnValues](https://docs.aws.amazon.com/glue/latest/dg/dqdl-rule-types-ColumnValues.html)、[IsComplete](https://docs.aws.amazon.com/glue/latest/dg/dqdl-rule-types-IsComplete.html)、[IsUnique](https://docs.aws.amazon.com/glue/latest/dg/dqdl-rule-types-IsUnique.html)、[Data Quality for ETL jobs in AWS Glue Studio notebooks](https://docs.aws.amazon.com/glue/latest/dg/data-quality-gs-studio-notebooks.html)
- イベント: [Automating AWS Glue with EventBridge](https://docs.aws.amazon.com/glue/latest/dg/automating-awsglue-with-cloudwatch-events.html)、[AWS Glue events](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-glue.html)、[Monitoring Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring.html)、[aws-cdk v2.273.0 の aws-glue-alpha job.ts](https://github.com/aws/aws-cdk/blob/v2.273.0/packages/@aws-cdk/aws-glue-alpha/lib/jobs/job.ts)
- ほかの方法: [Considerations and limitations for CTAS queries](https://docs.aws.amazon.com/athena/latest/ug/ctas-considerations-limitations.html)、[INSERT INTO](https://docs.aws.amazon.com/athena/latest/ug/insert-into.html)、[Configure Amazon S3 object name format](https://docs.aws.amazon.com/firehose/latest/dev/s3-object-name.html)
- Lake Formation: [What is AWS Lake Formation?](https://docs.aws.amazon.com/lake-formation/latest/dg/what-is-lake-formation.html)、[Changing the default settings for your data lake](https://docs.aws.amazon.com/lake-formation/latest/dg/change-settings.html)
- Spark 3.5.6: [JSON Files](https://spark.apache.org/docs/3.5.6/sql-data-sources-json.html)、[Generic Load/Save Functions](https://spark.apache.org/docs/3.5.6/sql-data-sources-load-save-functions.html)、[Parquet Files](https://spark.apache.org/docs/3.5.6/sql-data-sources-parquet.html)（Partition Discovery の節）
- 料金: [AWS Glue Pricing](https://aws.amazon.com/glue/pricing/)（課金の考え方だけをここから読みました。単価は Price List のものです）、[AWS Price List bulk API: Glue](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSGlue/current/ap-northeast-1/index.json)（2026-10-06 公開の版）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) の `dist/`、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義
- Cloudflare: [Basin Catalog](https://developers.cloudflare.com/r2/data-catalog/)、[Basin Catalog pricing](https://developers.cloudflare.com/r2/data-catalog/platform/pricing/)、[Basin Pipelines](https://developers.cloudflare.com/pipelines/)
- Vercel: [ドキュメントの索引](https://vercel.com/docs/llms.txt)

:::
