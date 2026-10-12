---
title: "54 Kinesis: 費用、注意点、片付け"
---

# 54 Kinesis: 費用、注意点、片付け

この章のスタックは、時間で課金されるリソースを持っています。最初に料金、次につまずきやすいところ、最後に片付けを書きます。

## 料金

<!-- section: 54.cost -->

単価は、2026-10-13 に AWS Price List の bulk API で読んだ東京リージョンの値です。金額はどれも見積もりで、請求書では確かめていません。計算の入力と結果は[料金の一覧](/ja/reference/pricing.md)にあります。

### 使っていないとき

**デプロイして 1 件も書かない 1 か月で、定価の小計が 14.85 ドル、無料枠を引いた後が 14.49 ドルです。**

| 項目 | 数量 | 定価 | 無料枠の後 |
| --- | ---: | ---: | ---: |
| stream の shard（provisioned） | 1 つ × 730 時間 | 14.23 | 14.23 |
| CloudWatch のアラーム | 3 つ | 0.30 | 0 |
| KMS のリクエスト | 105,120 回 | 0.32 | 0.26 |

shard の料金は、存在している時間にかかります。書いても書かなくても、関数が動いていてもいなくても同じです。Kinesis Data Streams は AWS の無料枠に含まれない、と料金ページに書かれています。

KMS のリクエストは、Kinesis のガイドにある目安をそのまま使いました。暗号化した stream を、1 つの認証情報で先頭から読み続けると、Kinesis は 5 分に約 12 回 KMS を呼ぶ、というものです。AWS 管理のキーでこの回数が実際に請求されるか、関数が動いていないあいだも同じ頻度かは、確かめていません。

関数、履歴のテーブル、失敗のキューは、レコードが流れなければ 0 です。Lambda が shard を読みにいくこと自体には、provisioned の stream では料金がかかりません。

同じスタックの stream を on-demand の Standard にすると、使っていない月が 38.22 ドルになります。stream 1 本の時間料金（37.96 ドル）が、shard 1 つの料金の 2.7 倍あるからです。

### 使ったとき

月に 100 万件のリビジョンを書く場合です。1 件 0.2 KB、関数は平均 10 件ずつ受け取って 100,000 回起動し、1 回 200 ミリ秒かかると仮定しました。

| 項目 | 数量 | 定価 | 無料枠の後 |
| --- | ---: | ---: | ---: |
| stream の shard | 730 時間 | 14.23 | 14.23 |
| PUT payload unit | 1,000,000 | 0.02 | 0.02 |
| Lambda のリクエスト | 100,000 | 0.02 | 0 |
| Lambda の実行時間 | 5,000 GB 秒 | 0.07 | 0 |
| DynamoDB の書き込み | 1,000,000 unit | 0.71 | 0.71 |
| ログの取り込み | 0.02 GB | 0.02 | 0 |
| アラーム | 3 つ | 0.30 | 0 |
| KMS のリクエスト | 105,120 回 | 0.32 | 0.26 |

定価の小計は 15.69 ドル、無料枠を引いた後は 15.23 ドルです。使っていない月との差は 1 ドルに届きません。この規模では、料金のほとんどが「stream があること」に対して払うものです。

同じ使い方を on-demand の Standard にすると、39.04 ドルです。on-demand の書き込みは 1 件を 1 KB に切り上げて数えるので、0.2 KB のレコードは 5 倍の量として請求されます。それでも 100 万件で 0.10 ドルにしかならず、差を作っているのは時間料金です。

shard 1 つが受け付けるのは 1 秒に 1,000 件までなので、1 か月に書ける上限は約 26 億件です。provisioned の料金が shard の数で決まる以上、流量が shard 1 つに収まるあいだは、金額はほとんど変わりません。

### 料金が増える設定

- shard を増やすと、1 つにつき月 14.23 ドル
- 保持期間を 24 時間より長くすると、7 日までは shard 1 つにつき 1 時間 0.026 ドルの上乗せ
- enhanced fan-out のコンシューマーを登録すると、コンシューマーと shard の組ごとに 1 時間 0.0195 ドルと、読んだ量 1 GB につき 0.0169 ドル
- on-demand の Advantage を有効にすると、アカウントの最低料金が月 4,003.59 ドル

### 消した後

`vp run kinesis:infra:destroy` で、stream、関数、テーブル、キュー、ロググループ、アラーム、トピックが消えます。その後にかかる料金はありません。

## つまずきやすいところ

<!-- section: 54.pitfalls -->

**何も起きない。** mapping を `LATEST` で作ると、作っているあいだに書いたレコードは読まれません。この章は `TRIM_HORIZON` です。それでも、作った直後は読み始めるまで数分かかることがあります。

**関数が失敗を返しているのに、再試行されない。** mapping の `FunctionResponseTypes` に `ReportBatchItemFailures` が入っていません。入っていなければ、Lambda は返り値を見ずに成功として扱います。

**shard が止まっている。** `IteratorAge` が増え続けていれば、同じ batch が繰り返し失敗しています。関数のログで `poison record` か `record not applied` を探します。再試行の回数を決めていない mapping では、レコードが stream から消えるまで止まります。

**失敗の記録はあるのに、レコードが読めない。** 記録が指しているレコードは、書かれてから 24 時間で stream から消えます。キューは記録を 14 日持っていますが、中身を読み戻せるのは最初の 1 日だけです。

**書き込みが断られる。** `ProvisionedThroughputExceededException` は、shard の上限（1 秒に 1,000 件または 1 MB）を超えたときに返ります。stream 全体の容量が余っていても、1 つの partition key に集中していれば起きます。

**sequence number を数値として扱ってしまう。** 56 桁の整数は number に収まりません。`Number` に直すと、隣り合う番号が同じ値になります。比べるときは `BigInt` を使います。

**shard の数を変えたら、順序が乱れた。** split や merge のあとは、親の shard を読み切ってから子を読む必要があります。Lambda の mapping がそうするかは、この章では確かめられていません。履歴の `missing` が 0 でなくなったら、これを疑います。

## 本番にするなら

<!-- section: 54.production -->

- **リソースを残す設定にする。** stream と履歴のテーブルは、練習用に `RemovalPolicy.DESTROY` にしてあります。stream を消すと、まだ読まれていないレコードも消えます
- **保持期間を、止まっていられる時間から決める。** 24 時間は、週末に関数が止まったら月曜には何も残っていない長さです。コンシューマーを直すのにかかる時間に、気づくまでの時間を足して決めます。延ばしたぶんは料金になります
- **shard の数を見積もる。** ドキュメントの式は、書き込みの帯域を 1,024 KiB/秒で割った値と、読み取りの帯域（書き込み × 読み手の数）を 2,048 KiB/秒で割った値の、大きいほうの切り上げです。流量が読めないなら on-demand にします
- **アラームを人に届ける。** `alarmEmail` か `alarmTopicArn` を渡さなければ、アラームはトピックに publish されるだけで、誰にも届きません
- **諦められた batch の扱いを決めておく。** 誰が、何時間以内に見て、どうするかを決めます。読み戻して直してから書き直すのか、捨ててよいのかは、データによります。S3 を送り先にすれば、保持期間が切れたあとも中身が残ります
- **書く側の権限を分ける。** この章では、自分の認証情報でスクリプトから書きました。アプリケーションから書くなら、そのロールに `kinesis:PutRecords` を、この stream の ARN に限って渡します
- **自分で管理するキーにするかを決める。** 誰が復号できるかをキーのポリシーで決めたいなら、21章のように自分のキーを使います。その場合は、書く側に `kms:GenerateDataKey`、読む側に `kms:Decrypt` が要る、とドキュメントにあります。キーの月額も加わります
- **レコードの形を変えるときは、読む側を先に出す。** stream には古い形のレコードが保持期間のあいだ残り、読み直せば何度でも出てきます。25章のイベントの版と同じ考え方が要ります

## 片付け

<!-- section: 54.cleanup -->

```bash
vp run kinesis:infra:destroy
```

これで、スタックが作ったものはすべて消えます。stream に残っていたレコードも、履歴のテーブルも消えます。置いておくと 1 時間ごとに料金がかかるので、試し終えたらその日のうちに消してください。

メールの購読もスタックのリソースなので、一緒に消えます。残るのは、cdkd の bootstrap で作った保存場所だけです（02章）。

## 分散システムとして見ると

<!-- section: 54.distributed -->

- 状態の持ち主: 出来事の記録を持っているのは stream で、24 時間で消えます。履歴のテーブルは、stream から導いた写しです。stream より長く残るので、24 時間を過ぎたあとは、テーブルが唯一の記録になります。作り直せるのは、stream が持っているあいだだけです
- 不変条件: ノートごとに、すべてのリビジョンが順に 1 回ずつ適用される。弱い形では、履歴の版は下がらず、同じリビジョンは 2 回数えられない
- 誰が何を守るか: 「1 回ずつ」と「下がらない」は、読む側の条件付き更新が守ります。stream と書く側が何をしても破れません。「順に」「すべて」は、書く側がノートごとに順に書くこと、shard が順序を保つこと、mapping が batch を諦めないことの 3 つが揃って成り立ちます。どれかが欠けると、`version` と `revisions` の差として見えます
- 不変条件を壊そうとするテスト: 応答を失った batch の再配送、応答を失った書き込みの送り直し、PutRecords の部分的な失敗、poison record、親より先に子の shard を読むこと。どれも決まった順序で再現しています
- 保証していないこと: 関数の副作用が 1 回であること。履歴の更新は 1 回だけ効きますが、関数がメールを送るなら、メールは 2 通になりえます。別々のノートのあいだの順序も保証しません
- 順序の代価: 順序を守る読み手は、1 件の失敗で止まります。止めないために諦めると、欠けが生まれます。この章は「4 回試して諦め、場所を記録し、欠けを数える」を選びました。どこで折り合うかは、データが決めます

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 76 件（partition key から shard への割り当て、shard の中の順序、2 つの読み手、位置を指定した読み直し、保持期間、shard ごとの書き込み上限と hot key、split、PutRecords の部分的な失敗と順序、送り直しによる重複、ハンドラーの適用と poison record の報告、再配送で二重に数えないこと、poison record と設定ごとの違い、partial batch response が読み飛ばされる設定、親と子の shard の順序、あとから足した読み手、DynamoDB と Kinesis へのリクエストの形、ドキュメントの例にある失敗の記録の読み取り、スタックの assertion）。条件を 6 か所わざと壊して、テストが落ちること。型検査。`kinesis:demo` の出力。`kinesis:infra:synth` で、テンプレートが AWS に問い合わせずに生成されること（関数のバンドル込み）。`vp check --fix` を自分のファイルにかけ、awscdk-lint を含めて警告が出ないこと。

**まだ確かめていないこと。** AWS では何も実行していません。stream と event source mapping の動きは、ドキュメントから作ったモデルで確かめただけです。とくに次の点は、実物で見ていません。

- partial batch response と bisect を両方有効にしたとき、失敗した 1 件だけが諦められること。分割された batch で再試行の回数がどう数えられるか
- 失敗の記録が、ドキュメントの例どおりの形で SQS に届くこと
- split や merge のあと、Lambda の mapping が親の shard を読み切ってから子を読むかどうか。読んだ Lambda のドキュメントには、記述が見つかりませんでした
- `IteratorAge` が、詰まっているあいだ増え続け、アラームが鳴ること
- 使っていない月の KMS のリクエストの回数と、その請求
- `-c alarmTopicArn` で 19章のトピックを渡したとき、アラームが publish できること
- cdkd でのデプロイと削除。`scripts/` の 4 つのスクリプトは、型検査を通しただけです
- 遅延とスループット。計測していません
- 料金の仮定。関数の実行時間、batch の平均件数、ログの量は、どれも計測していません

ドキュメントの中で食い違っていた点もあります。レコードの大きさの上限は、用語のページでは 1 MB、クォータのページと API リファレンスでは既定 1 MiB で設定により 10 MiB まで、となっています。shard の書き込みの上限は、クォータのページの PutRecord の行だけが 1 秒 10 MiB と書いています。この章は、用語のページと料金ページにある 1 MB を使いました。保持期間の上限を 7 日と書いているページもありますが、保持期間のページの 365 日に従いました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| レコードの形 | `examples/54-kinesis/src/revision.ts` | `test:unit` |
| shard と順序 | `examples/54-kinesis/src/local-stream.ts`、`test/stream.test.ts` | `test:unit` |
| 書く側 | `examples/54-kinesis/src/producer.ts`、`src/kinesis-writer.ts`、`test/producer.test.ts` | `test:unit` |
| 読む側 | `examples/54-kinesis/src/history.ts`、`src/dynamodb-history.ts`、`src/consumer.ts`、`src/consumer-lambda.ts`、`test/consumer.test.ts` | `test:unit` |
| event source mapping の設定 | `examples/54-kinesis/src/settings.ts`、`src/failure-record.ts`、`test/poller.test.ts` | `test:unit` |
| 読み手を増やす | `examples/54-kinesis/src/shard-order.ts`、`scripts/replay.ts` | `test:unit`、`kinesis:replay` |
| スタック | `examples/54-kinesis/infra/lib/kinesis-stack.ts`、`infra/bin/app.ts`、`infra/test/kinesis-stack.test.ts` | `test:unit`、`kinesis:infra:synth` |
| 手元のモデル | `examples/54-kinesis/src/local-stream.ts`、`src/local-poller.ts`、`src/local.ts`、`scripts/demo.ts` | `kinesis:demo` |
| デプロイして確かめる | `examples/54-kinesis/scripts/put.ts`、`scripts/history.ts` | `kinesis:infra:diff`、`kinesis:infra:deploy`、`kinesis:put`、`kinesis:history`、`kinesis:infra:drift` |
| 読み直しと、諦められた batch | `examples/54-kinesis/scripts/replay.ts`、`scripts/failures.ts` | `kinesis:replay`、`kinesis:failures` |
| 料金 | `data/pricing/` | |
| 片付け | `tools/src/infra/` | `kinesis:infra:destroy` |

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::Kinesis::Stream`、`AWS::Lambda::EventSourceMapping`、`AWS::Lambda::Function`、`AWS::DynamoDB::Table`、`AWS::SQS::Queue`、`AWS::SQS::QueuePolicy`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::CloudWatch::Alarm`、`AWS::Logs::LogGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy`。このスタックに、Cloud Control API 経由になる種類はありません。

**一次情報**（確認日はすべて 2026-10-13）

- Kinesis Data Streams 開発者ガイド: [Terminology and concepts](https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html)、[Quotas and limits](https://docs.aws.amazon.com/streams/latest/dev/service-sizes-and-limits.html)、[Choose the right mode to stream in](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html)、[Change the data retention period](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html)、[Develop producers using the API](https://docs.aws.amazon.com/streams/latest/dev/developing-producers-with-sdk.html)、[Large records](https://docs.aws.amazon.com/streams/latest/dev/large-records.html)、[Enhanced fan-out consumers](https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html)、[Complete the resharding action](https://docs.aws.amazon.com/streams/latest/dev/kinesis-using-sdk-java-after-resharding.html)、[Use Kinesis Client Library](https://docs.aws.amazon.com/streams/latest/dev/kcl.html)、[Handle duplicate records](https://docs.aws.amazon.com/streams/latest/dev/kinesis-record-processor-duplicates.html)、[Costs, Regions, and performance considerations](https://docs.aws.amazon.com/streams/latest/dev/costs-performance.html)、[Permissions to use user-generated KMS keys](https://docs.aws.amazon.com/streams/latest/dev/permissions-user-key-KMS.html)、[Monitoring with CloudWatch](https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html)
- Kinesis API リファレンス: [PutRecords](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html)、[PutRecord](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecord.html)、[GetShardIterator](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetShardIterator.html)、[GetRecords](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetRecords.html)
- Lambda 開発者ガイド: [Using Lambda to process records from Kinesis Data Streams](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html)、[Process Kinesis Data Streams records with Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-create.html)、[Parameters for Kinesis event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html)、[Partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-batchfailurereporting.html)、[Retain discarded batch records](https://docs.aws.amazon.com/lambda/latest/dg/kinesis-on-failure-destination.html)、[Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)、[Event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html)
- CloudFormation: [AWS::Kinesis::Stream](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kinesis-stream.html)
- 料金: [Amazon Kinesis Data Streams pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)、[AWS Price List bulk API: AmazonKinesis](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonKinesis/current/ap-northeast-1/index.json)（Lambda、DynamoDB、ログ、アラーム、KMS の単価は、04章、05章、19章、21章で確認したものを使っています）
- ほかの選択肢: [Change data capture with Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/streamsmain.html)、[What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)、[What Is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)、[What is the EventBridge Custom Event Bus?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-what-is.html)、[Amazon MSK Developer Guide](https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html)、[What is Amazon Managed Service for Apache Flink?](https://docs.aws.amazon.com/managed-flink/latest/java/what-is.html)、[Firehose: source settings for Kinesis Data Streams](https://docs.aws.amazon.com/firehose/latest/dev/writing-with-kinesis-streams.html)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- Cloudflare: [Basin Pipelines](https://developers.cloudflare.com/pipelines/)、[Basin Pipelines: Streams](https://developers.cloudflare.com/pipelines/streams/)、[How Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/)、[Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

:::
