---
title: "61 SQS: 費用、注意点、片付け"
---

# 61 SQS: 費用、注意点、片付け

[最初のページ](/ja/chapters/61-sqs.md)から[デプロイのページ](/ja/chapters/61-sqs/deploy.md)までで作った構成について、費用、つまずきやすい点、本番で足すこと、片付けの手順をまとめます。

## 料金

<!-- section: 61.cost -->

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。単価は、2026-10-13 に AWS Price List から読みました。

SQS の料金は、リクエストの数で決まります。FIFO キューは 100 万リクエストあたり USD 0.50、標準キューは USD 0.40 です。送信も、受信も、削除も、可視性タイムアウトの変更も、それぞれ 1 リクエストです。毎月 100 万リクエストまでは無料で、この枠は標準キューと FIFO キューを合わせたアカウント全体のものです。Price List にあるのはリクエストの単価だけで、キューを置いておくことや、溜まっているメッセージに対する単価はありません。

リクエストの数え方には、決まりが 2 つあります。

<<< @/examples/61-sqs/src/cost.ts{cost}

1 つ目は大きさです。64 KB ごとに 1 リクエストと数えるので、1 MiB のメッセージを 1 件送ると 16 リクエストになります。バッチで 10 件まとめても、合計が 64 KB を超えれば、そのぶん増えます。

2 つ目は、空の受信です。メッセージが無くても、`ReceiveMessage` は 1 リクエストです。1 つのコンシューマーが空のキューを 20 秒のロングポーリングで読み続けると、月に 131,400 回になります。

### 置いてあるだけの月

| 対象 | 定価 |
| --- | --- |
| アラーム（2 つ） | 0.20 |
| SQS のリクエスト（空の受信 657,000 回と仮定） | 0.33 |
| 小計 | **0.53** |

毎月の無料枠（アラーム 10 個、SQS 100 万リクエスト）に収まれば、0 です。

空の受信の回数は、仮定です。Lambda が空のキューをどのくらいの頻度で読むかは、公式ドキュメントに数字がありません。書かれているのは、トラフィックが少ないときに同時実行を 5 つまで戻すことと、maximum concurrency を設定していると 2 つまで減らす最適化が使えないことです。そこで、20 秒のロングポーリングが常に 5 本動いているものとして数えました。実際の回数は、キューの `NumberOfEmptyReceives` というメトリクスで見られます。デプロイしたら、1 日ぶんを見て、この仮定と比べてください。

### 月 100,000 件のコマンド

| 対象 | 定価 |
| --- | --- |
| アラーム（2 つ） | 0.20 |
| SQS のリクエスト（957,000 件） | 0.48 |
| ワーカー（Lambda 100,000 回、1 回 100 ミリ秒と仮定） | 0.05 |
| DynamoDB の書き込み（400,000 ユニット） | 0.29 |
| ログ | 0.02 |
| 小計 | **1.04** |

無料枠を引くと 0.29 で、残るのは DynamoDB の書き込みです。コマンド 1 件につき、目印とノートの 2 つをトランザクションで書くので、4 ユニットかかります。1 回分だけ効かせるための費用は、SQS ではなくここに出ます。

SQS のリクエストは、空の受信の 657,000 回に、コマンド 1 件あたり 3 回（送信、受信、削除）を足したものです。バッチを一切使わない場合の数字なので、上限に近い見積もりです。送る側が 10 件ずつまとめれば、送信は 100,000 回から 10,000 回に減ります。ワーカーの実行時間は計測していません。

### KMS の鍵にした場合

| 対象 | 定価 |
| --- | --- |
| 自分で管理する鍵（1 つ） | 1.00 |
| KMS のリクエスト（26,280 件） | 0.08 |
| 小計 | **1.08** |

この章のスタックは SQS が管理する鍵を使うので、この費用はかかりません。自分で管理する KMS の鍵に替えた場合の、コマンドのキュー 1 本ぶんの見積もりです。KMS のリクエストの無料枠（月 20,000 件）を引くと 1.02 です。

回数は、SQS のガイドの式で出しました。SQS は、KMS から受け取ったデータキーを一定の時間だけ使い回します。その時間（data key reuse period）は既定で 5 分で、60 秒から 24 時間まで変えられます。1 か月を 5 分で割った 8,760 回に、送る主体 1 つにつき 2、受け取る主体 1 つにつき 1 を掛けます。主体が 1 つずつなら 26,280 回です。使い回す時間を長くすれば回数は減りますが、ガイドは、短いほうが安全だと書いています。実際の回数がこの式より多くなることがある、とも書いています。

### 叩かれたら

この章のキューには、インターネットから直接届く入口がありません。送れるのは、IAM で `sqs:SendMessage` を許された主体だけです。

処理の側には、上限が 2 つあります。同時に動くワーカーは 2 つまでで、テーブルが受ける書き込みは 1 秒 100 ユニットまでです。コマンドがどれだけ届いても、ワーカーと DynamoDB の費用は、この 2 つより速くは増えません。溜まったぶんはキューで待ち、4 日たつと消えます。

送信そのものの数を絞るものは、この構成にはありません。送る権限を持つ主体が大量に送れば、SQS のリクエストの料金は、送った数に比例して増えます。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| 送信が、message group ID が無いと言って失敗する | FIFO キューでは必須です。`toEntry` を通さずに送っていないかを確かめます |
| 送信が、重複排除 ID が無いと言って失敗する | このキューは content-based deduplication を切っています。`MessageDeduplicationId` を付けます |
| 送信が `InvalidMessageContents` で失敗する | 本文に、SQS が受け付けない文字が入っています。[しくみと実装のページ](/ja/chapters/61-sqs/build.md)の「コマンドと、その名前」を見てください |
| 送ったのに、キューに入らない | 同じ重複排除 ID を 5 分以内に使っています。`NumberOfDeduplicatedSentMessages` が増えていれば、それです |
| デプロイで、キューの名前がすでに使われていると言われる | `aih-sqs-commands.fifo` と `aih-sqs-dead-letters.fifo` が、同じリージョンに残っていないかを確かめます。名前を固定している理由は、[デプロイのページ](/ja/chapters/61-sqs/deploy.md)にあります |
| イベントソースマッピングが作れない | 関数のタイムアウトが、キューの可視性タイムアウトを超えていないかを確かめます |
| 1 つのノートだけ、コマンドが進まない | そのグループの先頭のメッセージが失敗し続けています。ワーカーのログで `message failed` を探します。5 分で、デッドレターキューに移ります |
| 同じ行が 2 つ入った | 台帳を通さずに書いている経路がないか、目印の期限（30 日）を過ぎてから送り直していないかを確かめます |
| 題が古いものに戻った | ワーカーが、失敗の後も処理を続けていないかを確かめます。返す `batchItemFailures` には、失敗したものより後ろがすべて入っているはずです |
| デッドレターキューに、正しいコマンドがまとまって入った | 待てば直る失敗が 5 回続いたか、読めないメッセージを失敗として返しています。前者なら、原因を直してから `vp run sqs:status --redrive` で戻します |
| redrive で戻したコマンドが、すぐまたデッドレターキューに入る | 読めないメッセージです。ワーカーを直すまで、戻しても同じことが起きます |
| アラームが鳴っても、誰にも届かない | `alarmTopicArn` を渡してデプロイしていません。[デプロイのページ](/ja/chapters/61-sqs/deploy.md)を見てください |
| デプロイの後、キューが空なのに SQS の請求がある | Lambda の空の受信です。このページの「置いてあるだけの月」を見てください |

## 本番にするなら

- **アラームを人に届ける。** 既定では、アラームは状態が変わるだけです。19章のトピックにつなぎます
- **デッドレターキューを見る手順を決める。** 誰が、いつ見て、何を戻し、何を捨てるかです。読めないメッセージは、戻しても直りません
- **順序を崩してよいかを、コマンドごとに決める。** この章は、1 件をよけて後ろを進めることを選びました。前のコマンドを前提にするコマンドを足すなら、デッドレターキューを外して、グループを止める側に倒します
- **送る側の再試行の期限を決める。** 目印は 30 日で消えます。それより後に同じコマンドを送り直す送り手がいるなら、期限を延ばすか、送り手の側で止めます
- **05章のノートのテーブルに書く。** この章の `Edits` は練習用です。05章のバージョンによる楽観ロックと、どう両立させるかを決めます
- **空の受信を計測する。** `NumberOfEmptyReceives` を見て、置いてあるだけの月の見積もりを実測に置き換えます
- **グループの切り方を見直す。** ノートごとのグループは、1 つのノートに編集が集中すると 1 件ずつしか進みません。利用者ごとにすれば列は減りますが、1 人の利用者のノートどうしが待ち合うことになります
- **スループットが足りなくなったら high throughput mode を検討する。** この章では試していません。上限の数字はドキュメントのページによって違うので、Service Quotas で確かめてください
- **暗号化の鍵を決める。** 要件があれば SSE-KMS にし、送る側と受け取る側、サービスに必要な権限を鍵のポリシーに足します

## 片付け

<!-- section: 61.cleanup -->

```bash
vp run sqs:infra:destroy
```

2 本のキュー、関数、ロール、テーブル、ロググループ、アラームが消えます。キューに残っていたメッセージと、テーブルのノートと目印も消えます。元には戻せません。空にしておく必要のあるバケットは、この章にはありません。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。`alarmTopicArn` で渡したトピックは、このスタックのものではないので、消えません。

::: details この章の検証メモ

**手元で確かめたこと。** テスト 75 件。キューの模型の決まり（message group ID と重複排除 ID の必須、5 分の重複排除と、削除後も ID を覚えていること、グループの中の順序、受け取られたままのグループから返さないこと、古い receipt handle、可視性タイムアウトの延長と 0 と 12 時間の限度、デッドレターキューへの移動、同じバッチのメッセージの巻き添え、redrive）。ワーカーと台帳の不変条件（5 分以内と 5 分後の送り直し、可視性タイムアウトを過ぎたワーカーとの競争、遅れたワーカーが後のコマンドを打ち消さないこと、バッチの途中の失敗で止まること、読めないメッセージをよけること、よけられないときに残すこと、適用できないコマンドを 1 回で答えること、長い障害の後の redrive、適用済みのコマンドを戻した場合）。可視性タイムアウトの検査とハートビートの計算。コマンドとメッセージの対応、SQS が断る文字、バッチの組み立て（10 件、1 MiB、1 グループ 1 件）、一部だけ失敗したバッチの扱い。大きなメッセージの出し入れ。料金の数え方（64 KB、空の受信、KMS の式）。DynamoDB と SQS へのリクエストの形。スタックのアサーション（FIFO の設定、暗号化、キューポリシー、ロールの権限、イベントソースマッピング、アラーム、リソースの種類の一覧）。型検査。`sqs:infra:synth` で、既定の構成のテンプレートが AWS に問い合わせずに生成されること。`sqs:demo` の出力。コードを 4 か所わざと壊して、テストがそれぞれ 3 件、4 件、2 件、3 件落ちること。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`sqs:infra:diff`、`sqs:infra:deploy`、`sqs:send`、`sqs:status`、`sqs:infra:drift`、`sqs:infra:destroy` のどれもです。したがって、次は実物で確かめていません。名前を固定した 2 本の FIFO キューが、cdkd で作れること。FIFO キューの重複排除とグループの順序が、模型のとおりに動くこと。FIFO キューのイベントソースマッピングで、maximum concurrency と partial batch response が期待どおりに働くこと。同じバッチで渡されたメッセージの受信の回数が、読めないメッセージと一緒に増えること（ドキュメントの決まりから導いたもので、Lambda のポーラーが 1 回に何件受け取るかは書かれていません）。ワーカーが FIFO のデッドレターキューに直接送れること、そのメッセージを、行き先を名指しした redrive で戻せること。DynamoDB 用の台帳のトランザクション（式が受け付けられること、断られた理由の並び）。DynamoDB Local は Docker が要り、Nix の shell には含まれないので、エミュレーターでも実行していません。TTL で目印が消えること。アラームが鳴ること。別のアカウントからの送信。Lambda が空のキューを読む回数と、ワーカーの実行時間は計測していません。料金の表は、単価と仮定からの計算です。high throughput mode、provisioned mode、fair queues、SSE-KMS、SNS の FIFO のトピック、delay queue は、ドキュメントを読んだだけで、使っていません。5 分以内に同じ重複排除 ID で送り直したときに 5 分が延びるのかどうかは、ドキュメントから読み取れませんでした。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、標準キューと FIFO キュー | `examples/61-sqs/infra/lib/sqs-stack.ts`、`src/fifo-queue.ts`、`test/fifo-queue.test.ts` | `test:unit` |
| コマンドと、その名前 | `examples/61-sqs/src/command.ts`、`src/producer.ts`、`test/producer.test.ts` | `test:unit` |
| 1 回分だけ効かせる | `examples/61-sqs/src/ledger.ts`、`src/dynamodb-ledger.ts`、`src/naive.ts`、`test/worker.test.ts`、`test/adapters.test.ts`、`test/harness.ts` | `test:unit` |
| 可視性タイムアウトは貸し出しの期間 | `examples/61-sqs/src/lease.ts`、`test/lease.test.ts`、`test/fifo-queue.test.ts` | `test:unit` |
| Lambda がキューを読む | `examples/61-sqs/src/worker.ts`、`src/poller.ts`、`src/sqs-sender.ts`、`test/worker.test.ts` | `test:unit` |
| 送る側の細部 | `examples/61-sqs/src/producer.ts`、`src/sqs-sender.ts`、`src/large-message.ts`、`test/producer.test.ts`、`test/large-message.test.ts` | `test:unit` |
| 手元で動かす | `examples/61-sqs/scripts/demo.ts`、`src/fifo-queue.ts`、`src/poller.ts` | `sqs:demo`、`test:unit` |
| スタックを読む、誰がキューを使えるか | `examples/61-sqs/infra/lib/sqs-stack.ts`、`infra/bin/app.ts`、`infra/test/sqs-stack.test.ts`、`src/worker-lambda.ts`、`src/env.ts`、`src/settings.ts`、`cdk.json` | `sqs:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/61-sqs/scripts/send.ts`、`scripts/status.ts` | `sqs:infra:diff`、`sqs:infra:deploy`、`sqs:send`、`sqs:status`、`sqs:infra:drift` |
| 料金 | `examples/61-sqs/src/cost.ts`、`test/cost.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `examples/61-sqs/infra/lib/sqs-stack.ts` | `sqs:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- [Amazon SQS queue types](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)、[Amazon SQS FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html)、[FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html)、[Exactly-once processing](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html)、[Using the message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagededuplicationid-property.html)、[When to provide a message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/providing-message-deduplication-id.html)、[Using the message group ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html)、[FIFO queue and message identifiers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queue-message-identifiers.html)、[Moving from a standard queue to a FIFO queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-moving.html)、[FIFO queue and Lambda concurrency behavior](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/fifo-queue-lambda-behavior.html)
- [High throughput for FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html)、[Enabling high throughput for FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/enable-high-throughput-fifo.html)、[Amazon SQS message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)、[Amazon SQS FIFO queue quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-fifo.html)、[Amazon SQS fair queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html)
- [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)、[Processing messages in a timely manner](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-processing-messages-timely-manner.html)、[Configuring visibility timeouts](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/working-with-visibility-timeouts.html)、[Amazon SQS short and long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html)、[Amazon SQS batch actions](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-batch-api-actions.html)、[Managing large Amazon SQS messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-managing-large-messages.html)、[Amazon SQS delay queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)、[Amazon SQS message timers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-timers.html)、[Message metadata for Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-metadata.html)
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)、[Learn how to configure a dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)、[Creating alarms for dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html)、[Available CloudWatch metrics for Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Encryption at rest in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html)、[Amazon SQS Key management](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-key-management.html)、[Basic examples of Amazon SQS policies](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-examples-of-sqs-policies.html)、[Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)、[Cross-account policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html)
- API リファレンス: [SendMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html)、[SendMessageBatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html)、[ReceiveMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html)、[ChangeMessageVisibility](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ChangeMessageVisibility.html)、[DeleteMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html)、[CreateQueue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html)、[StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)、[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)、[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)、[Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)、[Lambda parameters for Amazon SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html)
- [Subscribing an Amazon SQS queue to an Amazon SNS topic](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html)、[Amazon SNS message delivery for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-delivery.html)
- [Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)、[TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)、[Using time to live (TTL) in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/)、AWS Price List bulk API: [SQS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json)、[KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json)
- Cloudflare: [Queues: How Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/)、[Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[Queues: Limits](https://developers.cloudflare.com/queues/platform/limits/)、[Queues: Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)。Vercel: [Vercel Queues](https://vercel.com/docs/queues)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（導入済みのパッケージの `dist` で、使っている 9 種類のリソースに専用の実装が登録されていることと、SQS のキューの名前の付け方を確かめました）

:::
