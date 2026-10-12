---
title: "08 Queue: 費用、注意点、片付け"
---

# 08 Queue: 費用、注意点、片付け

[最初のページ](/ja/chapters/08-async.md)で作り、[デプロイのページ](/ja/chapters/08-async/deploy.md)で AWS にのせる準備をした構成について、Cloudflare の Queues との違い、費用、つまずきやすい点、片付けの手順をまとめます。

## Queues から来た人へ

Cloudflare にも、同じ役割の部品があります。公式ドキュメントで確かめた範囲で並べます。

| | Cloudflare | この章 |
| --- | --- | --- |
| 配送の保証 | Queues は既定で at-least-once。まれに 2 回以上届く | SQS の標準キューも at-least-once |
| バッチ | 既定で最大 10 件、または 5 秒 | 最大 10 件。待ち時間は既定で 0 |
| 一部だけ失敗 | メッセージごとに `ack()` と `retry()` を呼ぶ | 失敗した ID を `batchItemFailures` で返す |
| 再試行の上限 | `max_retries`、既定で 3 | キューの `maxReceiveCount`。この章は 5 |
| DLQ | コンシューマーの設定に書く。無ければ、上限に達したメッセージは消える | キューの redrive policy に書く。無ければ、保持期間まで戻り続ける |
| バケットのイベント | R2 の event notification が Queues に送る | S3 の event notification が SQS に送る |
| 定期実行 | Workers の Cron Triggers | EventBridge Scheduler |

いちばん違うのは、コンシューマーの書き方です。Queues では、Worker の `queue()` ハンドラーがメッセージを受け取って、`ack()` か `retry()` を呼びます。この章では、Lambda がキューを読んで関数を呼び、関数は失敗した ID の一覧を返します。キューと関数の間にはイベントソースマッピングという設定が挟まっていて、バッチの大きさや同時実行の上限はそこに書きます。

冪等性の考え方は、どちらでも同じです。Cloudflare のドキュメントも、重複が困るなら一意な ID を鍵にするよう書いています。

R2 の通知のメッセージの例には、オブジェクトのキー、大きさ、ETag、時刻はありますが、S3 の `sequencer` に当たる欄は見当たりませんでした。同じキーへの操作の順序を R2 でどう決めるかは、確認していません。Cron Triggers の配送の保証も、読んだページには書かれていませんでした。

## お金の話

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

新しく出てくる単価は 2 つです。SQS の標準キューは、リクエスト 100 万件あたり USD 0.40 です。送るのも、受け取るのも、消すのも、それぞれ 1 リクエストと数えます。毎月 100 万件までは無料で、この枠はアカウントのすべてのキューで共有します。EventBridge Scheduler は、月 1,400 万回の起動までが USD 0 で、その先が 100 万回あたり USD 1.25 です。1 時間に 1 回なら、月 730 回です。

例は 2 つに分けます。どちらも、07章の例（月 10,000 枚のアップロード）に上乗せされる分です。

1 つ目は、イベントで動く部分です。月に作成が 10,000 回、削除が 1,000 回あったとします。

| 対象 | 定価 |
| --- | --- |
| SQS のリクエスト（33,000 件） | 0.01 |
| ワーカー（Lambda 11,000 回、平均 200 ミリ秒） | 0.01 |
| S3 の GetObject（10,000 件） | 0.00 |
| DynamoDB（書き込み 11,000、読み取り 10,000） | 0.01 |
| ログ | 0.01 |
| 小計 | **0.04** |

4 セントで、毎月の無料枠を引くと 0.01 になります。アップロード 1 枚あたりの費用は、07章のデータ転送と比べると誤差の範囲です。

2 つ目は、時計で動く部分です。バケットに 10,000 枚の画像が置いてあり、掃除が 1 時間ごとに動く場合を考えます。

| 対象 | 定価 |
| --- | --- |
| Scheduler の起動（730 回） | 0.00 |
| 掃除の関数（730 回、1 回 200 秒と仮定） | 0.49 |
| S3 の LIST（14,600 件） | 0.07 |
| DynamoDB の読み取り（2,920 万 unit） | 4.16 |
| 小計 | **4.72** |

こちらは 4 ドル 72 セントで、ほとんどが DynamoDB の読み取りです。掃除は、動くたびに 10,000 枚すべてについてテーブルを 4 回ずつ読み、それを月に 730 回繰り返します。無料枠を引いた後は 4.23 です。

**イベントで動く処理の費用は、起きたことの数に比例します。突き合わせの費用は、置いてあるものの数と、動かす回数の積に比例します。** 画像が 10 倍になれば、掃除の費用も 10 倍です。しかも、1 回 200 秒という実行時間は仮定で、計測していません。枚数が増えれば、関数のタイムアウト（15 分）にも当たります。間隔を 6 時間にすれば費用は 6 分の 1 になりますが、そのかわり、「だめ」な画像が消えるまでの時間が延びます。

誰も使わない月は、バケットが空なら掃除は一覧を読んで終わるので、月 USD 0.01 です。ただし、この金額に入っていないものが 1 つあります。Lambda は、空のキューも読みにいきます（ロングポーリング）。その `ReceiveMessage` は、SQS のリクエストとして数えられます。どれくらいの頻度で読みにいくのかは、公式ドキュメントに数字がなく、見積もれませんでした。0 ではありません。月 100 万件の無料枠に収まるかどうかも、確かめていません。

スタックを消すと、キューも、関数も、スケジュールも消えて、この章のぶんの料金は止まります。

### 叩かれたら

この章が足した部品には、外から直接呼べる入口がありません。キューに送れるのは S3 だけで、ワーカーを呼ぶのは Lambda だけ、掃除を呼ぶのはスケジュールだけです。外から届くのは、07章の API へのリクエストと、07章の許可証を通ったアップロードです。API の側の上限は、[07章の「叩かれたら」](/ja/chapters/07-uploads/wrap.md)に書いたとおりです。

この章が足したぶんの上限は、次のとおりです。

- ワーカーの実行時間。同時に動くのは 2 つまでなので、1 か月ずっと動き続けても 129.6 万 GB 秒、USD 17.28 です。イベントがどれだけ届いても、これより上には行きません
- 掃除の実行時間。1 時間に 1 回、最長 15 分です。毎回タイムアウトまで動いても、月 164,250 GB 秒で USD 2.19 です
- DynamoDB。ワーカーも掃除も、07章と同じテーブルを読み書きします。テーブルの上限（1 秒あたり読み取り 150 unit、書き込み 40 unit）は、API と合わせた全体の上限です。[06章の表](/ja/chapters/06-auth/wrap.md)の 2 行（月 USD 129.53）より上には行きません
- イベント 1 件ごとの料金。これには上限がありません。上の例と同じ数え方で、100 万件あたり USD 3.89 です（SQS 1.20、ワーカー 0.87、`GetObject` 0.37、DynamoDB 0.86、ログ 0.59）。そのイベントを起こすアップロードの POST には、100 万回あたり USD 4.70 かかります

最後の項目が、[デプロイのページの「キューが伸びる」](/ja/chapters/08-async/deploy.md)で説明した、同じフォームの送り直しです。送り直しはサインインした利用者にしかできませんが、その回数を絞るものは、この構成にはありません。ワーカーの実行時間は 17.28 で止まるので、増え続けるのは SQS と S3 のリクエストと、ワーカーが追いついたぶんのログです。

テーブルの上限には、気をつけることが 1 つあります。API、ワーカー、掃除は、同じ上限を分け合います。掃除が大量に読んでいる最中は、API の読み取りが DynamoDB に断られることがあります。ワーカーの書き込みが断られると、そのメッセージはキューに戻って、5 回目で DLQ に入ります。実際にどのくらいの枚数で起きるかは、計測していません。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:async` が `LOCAL_AUTH_SECRET` や `NOTES_STORE` と言って止まる | `examples/08-async/.env` があるかを確かめます。無ければ `.env.example` をコピーしてください |
| デプロイで、バケットの作成が `Unable to validate the following destination configurations` で失敗する | queue policy がバケットより先に作られているか、policy の `aws:SourceArn` がバケットの ARN と一致しているかを確かめます |
| デプロイで、バケットの名前がすでに使われていると言われる | `aih-async-uploads-<アカウント ID>` というバケットが、どこかに残っていないかを確かめます |
| デプロイ直後に、DLQ に 1 件ある | S3 のテスト用のイベントを失敗にしていないかを確かめます。この章のワーカーは、受け取って何もしません |
| 画像を置いても、記録ができない | `vp run async:queue` で、メッセージがキューに入っているかを見ます。入っていなければ S3 の通知、入ったままならイベントソースマッピングかワーカーです |
| ワーカーのログに `carries no eTag or no sequencer` | 作成のイベントに `sequencer` がありません。このページの末尾にある検証メモの「まだ確かめていないこと」を見てください |
| ワーカーのログに 403 があり、メッセージが DLQ に入る | ワーカーのロールに `s3:ListBucket` がないと、消えたオブジェクトの `GetObject` は 404 ではなく 403 になります |
| 成功したはずのメッセージが、何度も処理される | ワーカーが返す `batchItemFailures` の形を確かめます。バッチにない ID や空の ID があると、全部が失敗の扱いになります |
| 失敗したはずのメッセージが、消えている | イベントソースマッピングに `ReportBatchItemFailures` があるかを確かめます。無ければ、関数が返した一覧は使われないはずです |
| DLQ に、中身の正しいメッセージが溜まる | ワーカーが「もう済んでいる」を失敗として返していないかを確かめます |
| ワーカーや掃除のログに、DynamoDB のスロットリングのエラーが出る | テーブルの request unit の上限（読み取り 150、書き込み 40）を、API、ワーカー、掃除が分け合っています。掃除が読む量を減らすか、上限を上げます |
| キューが伸び続けて、同じキーのイベントばかり届く | 同じフォームが送り直されています。[デプロイのページの「キューが伸びる」](/ja/chapters/08-async/deploy.md)と、このページの「叩かれたら」を見てください |
| 掃除の関数がタイムアウトする | オブジェクトが多すぎます。このページの「お金の話」と「本番にするなら」を見てください |

## 本番にするなら

- **DLQ にアラームを付ける。** DLQ は、誰も見なければメッセージが溜まるだけの場所です。`ApproximateNumberOfMessagesVisible` が 0 でなくなったら知らせます。元のキューには、いちばん古いメッセージの年齢のアラームを付けます（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）
- **入口で絞る。** キューは、届いたものを全部受け取ります。同じフォームの送り直しを 07章の側で閉じて、アップロードの回数を数えます
- **検査が済むまで、画像を見せない。** この章の API は、検査の結果を見ていません。「だめ」な画像も、掃除が消すまでは一覧に出ます。添付の一覧で検査の記録を見て、`ok` のものだけに URL を付けます
- **掃除を、枚数に比例させない。** すべてを見るのをやめて新しいオブジェクトだけを見るか、S3 Inventory（バケットの中身の一覧を、S3 が定期的にファイルに書き出す機能）を入力にします。この章では、どちらも試していません
- **`sequencer` を確かめる。** POST のイベントとライフサイクルのイベントの形を実機で見てから、ワーカーの前提を決め直します
- **検査の記録の残り方を閉じる。** [最初のページの「残っている穴」](/ja/chapters/08-async.md)に書いた tombstone と TTL です
- **キューを KMS の鍵で暗号化するか決める。** この章は SQS が管理する鍵を使っています。自分で管理する鍵にするなら、S3 がその鍵を使えるように、鍵の policy に S3 を足す必要があります
- **バケットの名前の付け方を決める。** 固定した名前は、この章の都合で選んだものです。カスタムリソースを受け入れるか、EventBridge を挟むか、名前の規則を組織で決めるかを選びます
- **作成の API を冪等にする。** 05章から残っている宿題です

## 片付け

<!-- section: 08.cleanup -->

```bash
vp run async:empty --yes
vp run async:unpublish --yes
vp run async:infra:destroy
```

07章と同じで、2 つのバケットを先に空にします。`async:empty` で画像を消すと、消した数だけ削除のイベントがキューに入り、ワーカーが検査の記録を消していきます。スタックをすぐ消すなら、それを待つ必要はありません。記録はテーブルごと消えます。

`async:infra:destroy` で、キュー、DLQ、2 つの関数、スケジュール、そして 07章の一式（バケット、テーブル、ユーザープール、API、ディストリビューション）が消えます。キューに残っていたメッセージも消えます。元には戻せません。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** ワーカーのテスト（同じメッセージの再配送、別の ID の同じイベント、2 つのワーカーの同時実行、古い作成イベント、先に届いた削除、遅れてきた削除、記録の前と後での中断、フォームの再送の修復、画像でないものの判定）。キューのまわりのテスト（バッチの一部の失敗、DLQ への移動、関数が例外を投げた場合、S3 のテスト用のイベント、この章のものでないキー、DLQ からの戻し）。掃除のテスト（「だめ」な添付の削除、古い判定を使わないこと、タグの外し直し、ドライラン、2 回の実行、同時の実行、途中での中断）。画像の種類と大きさの読み取り（`sips` と `cwebp` が書いた実ファイル）。イベントの JSON の解釈と `sequencer` の比較。DynamoDB と S3 へのリクエストの形。インフラのアサーション。型検査と synth。それから、ワーカーの条件を 2 か所わざと壊して、テストが 4 つ落ちることを確かめました。`dev:async` を起動して、スクリプトから HTTP で次を確かめました。サインイン、ノートの作成、フォームでのアップロード、ワーカーの記録（`ok`、1×1）、完了、同じフォームで HTML を送り直すと記録が `rejected` に変わること、掃除のドライラン、削除で記録が消えること。今回は、07章から受け継いだスロットリングとテーブルの上限がテンプレートにあることを、アサーションで確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`async:infra:diff`、`async:infra:deploy`、`async:smoke`、`async:queue`、`async:logs`、`async:housekeeping`、`async:publish`、`async:smoke:web`、`async:user:create`、`async:infra:drift`、`async:empty`、`async:unpublish`、`async:infra:destroy` のどれもです。したがって、次は実物で確かめていません。フォーム（POST Object）で作られたオブジェクトのイベントと、ライフサイクルルールによる削除のイベントに `sequencer` が入ること（ドキュメントは「PUT と DELETE のリクエストでだけ使われる」と書いています）。バケットの名前を固定して循環を避けたテンプレートが、cdkd で通ること。S3 が通知の設定時にキューを検証すること。SQS が管理する鍵で暗号化したキューに S3 が送れること（S3 のドキュメントは、自分で管理する KMS の鍵の場合だけを説明しています）。`If-Match` に引用符つきの ETag を渡して、置き換えられたオブジェクトに 412 が返ること。イベントソースマッピングと partial batch response の実際の動き。Scheduler が関数を起動すること。DynamoDB 用と S3 用の実装は、リクエストの形をテストで固定しただけで、実物には送っていません。Lambda が空のキューを読みにいく頻度と、掃除の実行時間は、計測していません。「キューが伸びる」と「叩かれたら」の数字も、単価と仮定（1 件 200 ミリ秒）からの計算です。ワーカーが 1 秒に何件さばけるか、テーブルの上限に当たったときにワーカーと掃除がどう動くか、S3 が同じキーへの POST を 1 秒に何回受け付けるかは、確かめていません。画像の形式のうち、JPEG の仕様書（ITU-T T.81）は読み直していません。実際のエンコーダーが書いたファイルで動作を確かめただけです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 画像の中身を見る | `examples/08-async/src/inspect.ts`、`src/inspection.ts`、`test/inspect.test.ts`、`test/fixtures.ts` | `test:unit` |
| 配送の保証は「少なくとも 1 回」 | `examples/08-async/src/events.ts`、`src/worker.ts`、`test/events.test.ts`、`test/queue.test.ts` | `test:unit` |
| 2 回届いても、結果は 1 つ | `examples/08-async/src/worker.ts`、`src/sequencer.ts`、`src/object-reader.ts`、`src/s3-object-reader.ts`、`src/dynamodb-inspection-repository.ts`、`test/worker.test.ts`、`test/adapters.test.ts`、`test/harness.ts` | `test:unit` |
| 時計で動かす掃除 | `examples/08-async/src/housekeeping.ts`、`src/housekeeping-lambda.ts`、`test/housekeeping.test.ts`、`scripts/housekeeping.ts` | `test:unit`、`async:housekeeping` |
| 手元で動かす | `examples/08-async/src/dev.ts`、`src/local.ts`、`src/local-queue.ts`、`src/local-bucket.ts`、`.env.example` | `dev:async`、`dev:uploads:web`、`test:unit` |
| AWS にのせる準備 | `examples/08-async/infra/lib/async-stack.ts`、`infra/bin/app.ts`、`infra/test/async-stack.test.ts`、`src/worker-lambda.ts`、`src/env.ts`、`cdk.json` | `async:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/08-async/scripts/smoke.ts`、`scripts/user.ts`、`scripts/write-config.ts`、`tools/src/site/`、`tools/src/infra/` | `async:infra:diff`、`async:infra:deploy`、`async:smoke`、`async:user:create`、`async:publish`、`async:smoke:web`、`async:infra:drift` |
| 溜まったとき、落ちたとき | `examples/08-async/scripts/queue.ts`、`scripts/logs.ts` | `async:queue`、`async:logs` |
| 片付け | `examples/08-async/scripts/empty-uploads.ts`、`scripts/user.ts`、`tools/src/site/unpublish.ts` | `async:empty`、`async:unpublish`、`async:infra:destroy`、`async:user:delete` |
| お金の話 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)、[Amazon SQS standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)、[Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)、[Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)、[Amazon SQS message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)、[Learn how to configure a dead-letter queue redrive in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)、[StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html)、[Creating alarms for dead-letter queues using Amazon CloudWatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)、[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)、[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)、[Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)、[Lambda parameters for Amazon SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html)、[AWSLambdaSQSQueueExecutionRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaSQSQueueExecutionRole.html)
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)、[Event notification types and destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)、[Event message structure](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html)、[Granting permissions to publish event notification messages to a destination](https://docs.aws.amazon.com/AmazonS3/latest/userguide/grant-destinations-permissions-to-s3.html)、[Using Amazon SQS, Amazon SNS, and Lambda](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-enable-disable-notification-intro.html)
- [AWS::S3::Bucket NotificationConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-notificationconfiguration.html)
- [How to retrieve or copy objects based on metadata with conditional reads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html)、[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Manage event ordering and duplicate events with Amazon S3 Event Notifications](https://aws.amazon.com/blogs/storage/manage-event-ordering-and-duplicate-events-with-amazon-s3-event-notifications/)（AWS Storage Blog。S3 のユーザーガイドが参照している記事）
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)、[Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html)、[Setting up Amazon EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html)、[Confused deputy prevention](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html)、[RetryPolicy](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_RetryPolicy.html)、[Schedule types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html)、[Invoke a Lambda function on a schedule](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html)
- [Supported data types and naming rules in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/)、[Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/)、AWS Price List bulk API: [SQS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json)、[EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json)
- [WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container)、[GIF89a Specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)
- Cloudflare: [Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[Queues: Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)、[Queues: Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)、[R2: Event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)、[Workers: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
