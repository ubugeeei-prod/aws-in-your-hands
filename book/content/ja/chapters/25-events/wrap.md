---
title: "25 Events: 費用、注意点、片付け"
---

# 25 Events: 費用、注意点、片付け

[最初のページ](/ja/chapters/25-events.md)から[デプロイのページ](/ja/chapters/25-events/deploy.md)までで作った構成について、Cloudflare と Vercel にある近い部品との違い、費用、つまずきやすい点、片付けの手順をまとめます。

## Cloudflare と Vercel から来た人へ

どちらにも、メッセージを運ぶ部品があります。2026-10-13 に公式ドキュメントで確かめた範囲で並べます。

Cloudflare Queues は、08章で比べたとおり、SQS に近い部品です。配送は少なくとも 1 回で、載せた順に届く保証はありません。この章に関わる違いは、ドキュメントに「1 つのキューが持てるアクティブなコンシューマーは 1 つだけ」とあることです。同じ出来事を 3 つの相手に渡したいなら、載せる側の Worker が 3 つのキューに 1 回ずつ送ることになります。つまり、載せる側が受け取る相手を知っている形です。相手が 3 つで、同じチームが全部を書いているなら、それで足ります。部品も、この章よりずっと少なく済みます。

Queues の event subscriptions は、名前は近いのですが、別のものです。Cloudflare の製品が自分のアカウントの中で起こした出来事（R2、Workers KV、Workers AI、Workers Builds、Workflows など 11 種類の出どころ）を、キューで受け取る仕組みです。AWS でいえば、AWS のサービスが既定のイベントバスに載せるイベントに当たります。自分のアプリケーションのイベントを載せて、中身で配り分ける部品ではありません。イベントの例には `eventSchemaVersion` が入っていて、版を欄として持つ考え方は、この章と同じです。

中身を見て行き先を決めるルール、input transformer、archive とリプレイに当たるものは、読んだページの範囲では Cloudflare に見当たりませんでした。自分で作るなら、ルールは Worker の中の `if` で、リプレイは R2 に書いておいたイベントを読み直すコードで書くことになります。

Vercel Queues は、この章にいちばん近い部品です。ベータ版で、すべてのプランで使えます。トピックは追記だけのログで、メッセージは、トピックを購読しているすべての consumer group に配られます。consumer group は互いに独立していて、後から加わった group は、期限の切れていない過去のメッセージを読み直せます。配送は少なくとも 1 回で、ドキュメントはコンシューマーを冪等に作るよう書いています。載せるときに冪等性の鍵を付けて、重複を落とすこともできます。

違いは保持期間と、配り分け方です。Vercel Queues のメッセージの保持は 60 秒から 7 日で、既定は 24 時間です。メッセージの中身で行き先を決めるルールに当たるものと、順序の保証については、読んだページには書かれていませんでした。確認していません。

Vercel か Cloudflare の上でアプリケーションが完結していて、受け取る相手が数個なら、そこにいるのが素直です。この章の構成は、部品が 10 個以上増えます。それに見合うのは、受け取る相手がチームやアカウントをまたいで増えていくとき、相手ごとに再試行と退避を変えたいとき、届け先に AWS のサービスや人（メール）が混ざるとき、過去のイベントを流し直す手段を持っておきたいときです。

## 料金

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

新しく出てくる単価は 5 つです。custom event は、バスに載せたイベント 100 万件あたり USD 1.00 で、64 KB ごとに 1 件と数えます。同じアカウントのターゲットへの配送には、料金がかかりません。Pipes は、filter を通ったリクエスト 100 万件あたり USD 0.50 です。archive は、取り込みが 1 GB あたり USD 0.13、保存が 1 GB・月あたり USD 0.025 です。DynamoDB Streams の読み取りは、月 250 万回までが USD 0 で、その先が 1 回あたり USD 0.000000228 です。SNS は、月 100 万リクエストまでが USD 0 で、キューへの配送には 1 件ごとの料金がありません。

先に、使っていない月の話をします。この構成には時間で課金されるリソースがありませんが、何も起きていなくても動いているものが 1 つあります。pipe です。pipe は stream の shard を 1 秒に 4 回読みにいきます。1 か月で 10,512,000 回です。DynamoDB の料金ページは、stream の `GetRecords` を 1 回ずつ課金するとしたうえで、Lambda のトリガーと global tables からの呼び出しは無料だと書いています。Pipes は、その例外に挙がっていません。

請求されると仮定すると、使っていない月の料金は **USD 1.83** です。shard が 1 つで、読みにいく頻度が 1 か月変わらない、という仮定も置いています。請求書では確かめていません。実際には請求されないのかもしれませんし、shard が複数あれば、そのぶん増えます。

次に、使った月です。ノートの変更が 10,000 件（作成 6,000、更新 3,000、削除 1,000）、検査が 10,000 件でうち 100 件が rejected だったとします。08章の例に上乗せされる分です。

| 対象 | 定価 |
| --- | --- |
| stream の読み取り（10,512,000 回） | 1.83 |
| Pipes のリクエスト（20,000 件） | 0.01 |
| custom event（20,000 件） | 0.02 |
| archive の取り込みと保存 | 0.00 |
| 関数 3 つ（37,000 回、1 回 100 ミリ秒と仮定） | 0.02 |
| DynamoDB の書き込み（38,000 ユニット） | 0.03 |
| SQS のリクエスト（21,100 件） | 0.01 |
| SNS の publish（100 件） | 0.00 |
| ログ | 0.01 |
| 小計 | **1.93** |

1 ドル 93 セントで、毎月の無料枠を引くと 1.89 です。stream の読み取りを除けば、20,000 件のイベントを 3 つのコンシューマーに配って約 10 セントです。counter の書き込みが件数のわりに多いのは、トランザクションの書き込みが 1 KB あたり 2 ユニットで、それを 2 つのアイテムに対して行うからです。

**イベントの数に比例する料金は小さく、置いてあるだけでかかる料金のほうが大きい。** この規模では、そうなります。イベントが 100 倍になれば、比例する部分のほうが大きくなります。

リプレイにも料金がかかります。上の例の 7 日ぶん、4,667 件をすべてのルールにリプレイすると、定価で USD 0.02 です。リプレイされたイベントは custom event としてもう一度課金され、コンシューマーももう一度動きます。弾かれた書き込みも、書き込みとして数えました。

スタックを消すと、pipe も、バスも、archive も、キューも消えて、この章のぶんの料金は止まります。

### 叩かれたら

この章が足した部品には、外から直接呼べる入口がありません。stream に書けるのはテーブルへの書き込みだけで、バスにイベントを載せられるのは pipe のロールだけです。外から届くのは、07章と 08章の入口を通ったリクエストです。

この章が足したぶんの上限を書きます。

- pipe は、shard ごとに 1 件ずつ流します。ノートの API のスロットリング（1 秒 10 リクエスト）より速くイベントが作られることは、ふつうはありません
- counter の関数は、同時に 2 つまでです。Timeline の関数には、この章では同時実行の上限を付けていません。アカウントの同時実行数を他の関数と分け合います
- projections のテーブルには、1 秒あたり読み取り 20 ユニット、書き込み 20 ユニットの上限があります。counter は 1 件で 4 ユニットを使うので、1 秒に 5 件を超えると、DynamoDB に断られます。断られたメッセージはキューに戻り、5 回目でデッドレターキューに入ります
- イベント 1 件ごとの料金には、上限がありません

気をつけるのは輪です。コンシューマーがノートのテーブルに書き戻すように変えると、その書き込みが stream に現れ、pipe を通り、またコンシューマーに届きます。止めるものは pipe の filter だけです。この章のコンシューマーは、別のテーブルにしか書きません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| デプロイで archive の作成が失敗する | `AWS::Events::Archive` は Cloud Control API 経由です。このページの末尾の検証メモにある再開手順を見てください |
| デプロイで、バケットの名前がすでに使われていると言われる | `aih-events-uploads-<アカウント ID>` というバケットが残っていないかを確かめます |
| ノートを書いても、何も起きない | pipe の状態を見ます。権限などの 4xx のエラーが続くと、Pipes は pipe を自動で止める、とドキュメントにあります |
| Shape のログに `shaped` があるのに、どのコンシューマーも動かない | pipe のターゲットの設定（`$.type`）と、ルールのパターンの `source` を確かめます |
| Timeline は動くのに、counter だけ動かない | `vp run events:status` で counter のキューを見ます。溜まっていればイベントソースマッピングか関数、空ならルールかキューポリシーです |
| デッドレターキューに `ERROR_CODE` が `NO_PERMISSIONS` のメッセージがある | ターゲットのリソースポリシー（関数の permission、キューポリシー、トピックポリシー）に、そのルールの ARN があるかを確かめます |
| 関数が失敗しているのに、ルールの DLQ に何も入らない | 関数の中の失敗は Lambda がやり直し、on-failure の送り先に入ります。ルールの DLQ に入るのは、呼び出せなかったイベントだけです |
| stream の後ろのほうの変更がイベントにならない | 前のレコードで関数が失敗し続けていないかを見ます。この章の pipe は 3 回でよけますが、既定は無制限です |
| リプレイしたら件数が増えた | 冪等でないコンシューマーにリプレイが届いています。件数は、ノートを数え直して作り直します |
| リプレイしても、直近のイベントが流れてこない | イベントが archive に入るまでに遅れがあります。10 分待ってください |
| トピックに届いたメッセージが JSON として読めない | input transformer のパスが、イベントに無い欄を指していないかを確かめます。無い変数は、出力から消えます |
| stream を無効にしてから、pipe が動かない | 有効にし直した stream は別の ARN になります。pipe を作り直します |

## 本番にするなら

- **デッドレターキューにアラームを付ける。** 4 種類の送り手が 1 つのキューを使っています。0 でなくなったら知らせます。pipe の遅れは、Pipes のドキュメントが触れている `IteratorAge` で見ることになりますが、メトリクスの名前と場所は、この章では確かめていません。アラームの組み立て方は [19章](/ja/chapters/19-observability.md)です
- **archive の保持日数を、決めて書く。** 7 日は、練習用に選んだ値です。障害に気づいて直すまでにかかる日数より長く、印の期限より短くします。保持するのは利用者のデータでもあるので、消す約束（[22章](/ja/chapters/22-recovery.md)）と突き合わせます
- **新しい Custom Event Bus を検討する。** 道具が対応していれば、保持、順序、開始位置を持つ新しいバスのほうが、この章の archive とリプレイより扱いやすい場面があります
- **pipe のロールの信頼ポリシーを絞る。** `aws:SourceArn` と `aws:SourceAccount` の条件を、実物で通ることを確かめてから付けます
- **トピックポリシーに条件を付けられるか確かめる。** いまは、EventBridge を経由すれば誰のルールからでも publish できる形です
- **キューとトピックを自分の KMS の鍵で暗号化するか決める。** その場合は、EventBridge、SNS、Pipes、Lambda のそれぞれに、鍵を使う権限が要ります
- **Timeline の関数に同時実行の上限を付ける。** または、counter と同じようにキューを挟みます
- **イベントのスキーマを置く場所を決める。** 受け取る側が別のリポジトリになったら、1 つのファイルを import する方法は使えません
- **pipe の束を大きくする。** イベントが増えたら、1 件ずつでは追いつきません。束にするなら、一部だけが失敗したときの扱いを先に決めます

## 片付け

<!-- section: 25.cleanup -->

```bash
vp run events:empty --yes
vp run events:infra:destroy
```

`events:smoke` は、置いたオブジェクトとノートを自分で消します。アプリからアップロードした画像が残っているなら、`events:empty` でバケットを空にしてから、スタックを消します。07章の画面をこのスタックに公開した場合は、配信用のバケットも空にする必要があります。この章では、そのタスクを用意していません。

`events:infra:destroy` で、バス、ルール、archive、pipe、トピック、3 つのキュー、3 つの関数、projections のテーブル、そして 08章までの一式が消えます。archive に入っていたイベントも、デッドレターキューに残っていたメッセージも消えます。元には戻せません。

`events:smoke` が使った `smoke-` で始まる持ち主の timeline と件数は、projections のテーブルに残りますが、テーブルごと消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** テストは 7 ファイル、97 件です。ルールのパターンの一致と不一致（スタックに入れるのと同じオブジェクトを、手元の評価器で評価）。評価器が、実装していない演算子を断ること。stream のレコードからイベントへの変換と、`id` が stream のレコードによらないこと。契約と版（増えた欄は読める、次の版と欠けた欄は断る）。同じ配送の 2 回の実行、同じ変更の 2 回の publish、逆順の配送、先に届いた削除。失敗するターゲットの再試行と退避。archive からのリプレイを、冪等なコンシューマー、冪等でないコンシューマー、後から足したコンシューマーに届けた結果と、rejections のルールがリプレイに一致しないこと。counter のキューの束の一部の失敗。リプレイの計画と、dead letter の読み分け。DynamoDB へのリクエストの形。インフラのアサーション（最小権限、リソースポリシー、保持、削除、08章と並べるための付け替え、リソースの種類の一覧）。型検査と synth。`events:demo` を実行して、[手元で動かすページ](/ja/chapters/25-events/local.md)に載せた出力を得ました。条件を 4 か所わざと壊して、テストが 5 件、3 件、2 件、11 件落ちることも確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`events:infra:diff`、`events:infra:deploy`、`events:smoke`、`events:status`、`events:replay`、`events:infra:drift`、`events:empty`、`events:infra:destroy` のどれもです。したがって、次は実物で確かめていません。pipe が stream を読み、関数の返した配列の要素をイベントの `detail` にし、`$.type` を `detail-type` にすること。束を 1 件にしても関数に配列で渡ること。信頼ポリシーに条件のないロールで pipe が作れること。cdkd が archive を Cloud Control API 経由で作って消せること。ルールのパターンが EventBridge で手元の評価器と同じ答えになること。SQS が管理する鍵で暗号化したキューに、ルール、pipe、Lambda の on-failure、SNS が送れること。条件のないトピックポリシーで EventBridge が publish できること。input transformer の出力が、raw message delivery でそのままキューに入ること。リプレイされたイベントの形と、rejections のルールがそれを通さないこと。デッドレターキューに入るメッセージの形。pipe の読み取りが請求されるかどうか。「料金」の数字は、単価と仮定（関数 1 回 100 ミリ秒、shard 1 つ）からの計算です。書き込みからイベントが届くまでの遅れ、pipe が 1 秒に何件流せるかは、計測していません。新しい Custom Event Bus は使っておらず、動かしてもいません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、使い分け | `examples/25-events/infra/lib/events-stack.ts` | `events:infra:synth` |
| イベントの契約 | `examples/25-events/src/contract.ts`、`test/shape.test.ts` | `test:unit` |
| stream からイベントへ | `examples/25-events/src/shape.ts`、`src/shape-lambda.ts`、`src/routes.ts`、`test/shape.test.ts`、`test/fixtures.ts` | `test:unit` |
| ルールとイベントパターン | `examples/25-events/src/routes.ts`、`src/pattern.ts`、`test/pattern.test.ts` | `test:unit` |
| コンシューマー | `examples/25-events/src/timeline.ts`、`src/counter.ts`、`src/counter-queue.ts`、`src/dynamodb-projections.ts`、`test/bus.test.ts`、`test/queue.test.ts`、`test/adapters.test.ts` | `test:unit` |
| archive とリプレイ | `examples/25-events/src/local-bus.ts`、`src/replay-plan.ts`、`test/bus.test.ts`、`test/operations.test.ts` | `test:unit`、`events:replay` |
| 手元で動かす | `examples/25-events/src/local.ts`、`src/local-bus.ts`、`scripts/demo.ts`、`test/harness.ts` | `events:demo`、`test:unit` |
| スタックを読む | `examples/25-events/infra/lib/events-stack.ts`、`infra/bin/app.ts`、`infra/test/events-stack.test.ts`、`src/timeline-lambda.ts`、`src/counter-lambda.ts`、`src/env.ts`、`cdk.json` | `events:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/25-events/scripts/smoke.ts` | `events:infra:diff`、`events:infra:deploy`、`events:smoke`、`events:infra:drift` |
| 届かなかったとき、流し直すとき | `examples/25-events/scripts/status.ts`、`scripts/replay.ts`、`src/dead-letter.ts`、`src/replay-plan.ts` | `events:status`、`events:replay` |
| 片付け | `examples/25-events/scripts/empty-uploads.ts` | `events:empty`、`events:infra:destroy` |
| 料金 | `data/pricing/` | `test:unit` |

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::Events::EventBus`、`AWS::Events::Rule`、`AWS::Pipes::Pipe`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SNS::Subscription`、それに 08章までの種類。専用の実装が無く Cloud Control API 経由になるもの: `AWS::Events::Archive`。`AWS::EventsV2` の種類は、実装も無く、Cloud Control API の対応一覧にもありませんでした。

**一次情報**（確認日はすべて 2026-10-13）

- [What Is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)、[Amazon EventBridge event bus (default and Classic)](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html)、[Amazon EventBridge quotas](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-quota.html)、[Troubleshooting Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-troubleshooting.html)
- [What is the EventBridge Custom Event Bus?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-what-is.html)、[Creating Custom Event Bus resources with CloudFormation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-cloudformation.html)、[Ordering and deduplicating events on a Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-ordering.html)、[Migrating from Custom Event Bus - Classic to the Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-migrate.html)
- [Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)、[Creating Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern.html)、[Comparison operators for use in event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern-operators.html)
- [How EventBridge retries delivering events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)、[Using dead-letter queues to process undelivered events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)、[Amazon EventBridge input transformation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html)、[Using resource-based policies for Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html)
- [Archiving and replaying events in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html)、[Creating replays of archived events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-replay-archived-event.html)、[StartReplay](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_StartReplay.html)、[AWS::Events::Archive](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-events-archive.html)
- [Sending events with PutEvents](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html)、[PutEventsRequestEntry](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEventsRequestEntry.html)
- [Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html)、[Amazon DynamoDB stream as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-dynamodb.html)、[Event filtering in Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-filtering.html)、[Event enrichment in Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/pipes-enrichment.html)、[Amazon EventBridge Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)、[Pipes batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)、[Pipes error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)、[Pipes permissions](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-permissions.html)、[AWS::Pipes::Pipe PipeSourceDynamoDBStreamParameters](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-pipes-pipe-pipesourcedynamodbstreamparameters.html)
- [Invoking Lambda with events from other AWS services](https://docs.aws.amazon.com/lambda/latest/dg/lambda-services.html)、[How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)、[Capturing records of Lambda asynchronous invocations](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html)
- [What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)、[Amazon SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)、[Amazon SNS raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html)、[Amazon SNS message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)、[Message archiving and replay for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html)、[Amazon SNS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html)、[Amazon SNS FAQs](https://aws.amazon.com/sns/faqs/)
- [Change data capture for DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)、[Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)、[TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)、[DynamoDB Time to Live](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html)、[Service Authorization Reference のデータ（DynamoDB）](https://servicereference.us-east-1.amazonaws.com/v1/dynamodb/dynamodb.json)
- [Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/)、[Amazon DynamoDB pricing for on-demand capacity](https://aws.amazon.com/dynamodb/pricing/on-demand/)、[Amazon SNS pricing](https://aws.amazon.com/sns/pricing/)、AWS Price List bulk API: [EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json)、[DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)、[SNS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json)
- Cloudflare: [Queues: How Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/)、[Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[Queues: Event subscriptions](https://developers.cloudflare.com/queues/event-subscriptions/)、[Queues: Events & schemas](https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/)、[Queues: Limits](https://developers.cloudflare.com/queues/platform/limits/)、[Queues: Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- Vercel: [Vercel Queues](https://vercel.com/docs/queues)、[Vercel Queues: Concepts](https://vercel.com/docs/queues/concepts)
- [cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)

:::
