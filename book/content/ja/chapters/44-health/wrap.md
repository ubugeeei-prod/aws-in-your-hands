---
title: "44 Health: 費用、注意点、片付け"
---

# 44 Health: 費用、注意点、片付け

[前のページ](/ja/chapters/44-health/build.md)までで、Health イベントを通知にするスタックと、そのテストができました。このページでは、デプロイの手順、料金、Cloudflare や Vercel との違い、注意点、片付けを扱います。

## デプロイして確かめる

<!-- section: 44.deploy -->

この節の手順は、実際の AWS では実行していません。

```bash
vp run health:infra:diff
vp run health:infra:deploy -c alarmEmail=you@example.com
vp run health:global:infra:deploy -c alarmEmail=you@example.com
```

1 つ目のデプロイが東京の `AihHealth`、2 つ目が us-east-1 の `AihHealthGlobal` です。us-east-1 にデプロイするには、cdkd の保存場所がそのリージョンにも要ります（[10章](/ja/chapters/10-edge.md)で us-east-1 にスタックを置いたときと同じです）。メールアドレスは、テンプレートと cdkd の state に入ります。確認メールがトピックごとに 1 通届くので、両方のリンクを押します。

19章のトピックに流す場合は、`alarmEmail` の代わりに `-c alarmTopicArn=<19章の AlarmTopicArn>` を渡します。

デプロイしても、すぐには何も起きません。Health イベントは自分では起こせないからです。ドキュメントによると、ルールを作ってから public イベントが届き始めるまでに、最大で 1 時間かかることがあります。待たずに確かめられることは 2 つあります。

1 つは、パターンです。EventBridge のコンソールでルールを開くと、パターンを試す欄で「Use sample events provided」から Health のサンプルを選べます。一致するかどうかが表示されるだけで、イベントは送られません。

もう 1 つは、関数から先です。Lambda のコンソールのテスト実行に、`fixtures/documented.json` の `event` を 1 つ貼って呼ぶと、台帳への書き込みと SNS への publish までが動き、メールが届きます。同じ内容でもう一度呼ぶと、ログに `skipped` と `duplicate` が出て、メールは届かないはずです。テスト実行は同期の呼び出しなので、非同期の呼び直しとデッドレターキューは、この方法では確かめられません。

ドリフトの検査は、ほかの章と同じです。

```bash
vp run health:infra:drift
vp run health:global:infra:drift
```

## 料金

<!-- section: 44.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**イベントが届かない月は、0 です。** このスタックには、置いてあるだけで料金がかかるものがありません。関数は呼ばれたぶんだけ、台帳は読み書きしたぶんと保存した量だけ、SNS と SQS はリクエストのぶんだけ、ログは書いた量だけの課金です。アラーム、スケジュール、プロビジョニングした同時実行数、KMS のキーは使っていません。スタックのテストは、時間や月で課金されるリソースの種類がテンプレートに無いことを確かめています。

Health の側の料金は次のとおりです。

- ダッシュボードは、すべての利用者が追加料金なしで使えます
- Health イベントを EventBridge で受け取ることにも、追加料金はかかりません。EventBridge の料金ページは、AWS のサービスが出すイベントは無料で bus に取り込まれるとしています。ルールの料金は、このページには載っていません
- AWS User Notifications は無料です
- Health API にはサポートプランが要ります。API の呼び出しそのものの料金ではなく、プランの月額がかかります。いちばん安い Business Support+ で、アカウントごとに月 29 USD か、利用料の 9%（1 万 USD までの部分）の大きいほうです

イベントが届いた月の計算もしておきます。2 つのスタックを合わせて関数が 40 回呼ばれ、そのうち 30 回が通知になる月を仮定しました。数時間続く障害が 1 件と、予定された変更や通知が数件という想定で、実測ではありません。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| Lambda のリクエスト | 40 回 | 0.000008 | 0 |
| Lambda の実行時間 | 10 GB 秒 | 0.000133 | 0 |
| 台帳の読み取り | 40 RRU | 0.0000057 | 0.0000057 |
| 台帳の書き込み | 60 WRU | 0.0000429 | 0.0000429 |
| SNS の publish | 30 回 | 0 | 0 |
| SNS のメール配送 | 30 通 | 0 | 0 |
| ログの取り込み | 0.0000763 GB | 0.000058 | 0 |
| 小計 | | **0.00** | **0.00** |

小計は、セント未満を丸めた値です。丸める前の定価は、およそ 0.00025 です。関数の実行時間（1 回 1 秒）とログの量（1 回 2 KB）は仮定で、計測していません。us-east-1 のスタックのぶんも東京の単価で数えていて、us-east-1 の単価は調べていません。SNS は、リクエストが月 100 万回まで、メールの配送が月 1,000 通まで無料です。

消したあとに残るものと、その料金は「片付け」に書きます。

## Cloudflare や Vercel から来た人へ

<!-- section: 44.platforms -->

プラットフォーム側の障害とメンテナンスを知らせる仕組みは、Cloudflare にも Vercel にもあります。以下は 2026-10-13 時点の公式ドキュメントとステータスページの内容です。

Cloudflare には、アカウントの Notifications に「Incident Alerts」があります。Cloudflare のインシデントが作られたとき、更新されたとき、解決したときに知らせるもので、影響の大きさ（minor、major、critical）と、影響を受けるコンポーネントで絞れます。「Maintenance Notification」は、データセンター（point of presence）のメンテナンスが予定、変更、中止されたときに知らせるもので、拠点を選べます。どちらもすべてのプランで使えます。届け先は、メールと webhook がすべてのプラン、PagerDuty が Business 以上です。

Vercel は、ステータスページ（`vercel-status.com`）で購読を受け付けています。メール、SMS、Slack、webhook、Atom と RSS のフィードがあり、インシデントの作成、更新、解決が届きます。購読の画面には、コンポーネントやリージョンを選ぶ欄は見当たりませんでした。Vercel の Alerts は、自分のプロジェクトの使用量やエラー率の異常を知らせる機能で、プラットフォームの障害の通知ではありません。

考え方は同じです。プラットフォームが公表した障害を、見にいくのではなく届けてもらい、自分たちの監視とは別の意見として使います。AWS で違うのは次の点です。

- 設定なしで届くのは、自分のリソースに関わるイベントのメールだけです。公表された障害（public イベント）を届けてもらうには、ルールか通知の設定を自分で作ります。Cloudflare と Vercel では、公表された障害の購読が、画面の操作だけで済みます
- AWS のイベントには、自分のリソースの ID と、リソースごとの状態が付きます。「あなたのこのインスタンスが、この日に止まる」という粒度の知らせは、インスタンスを自分で持つ AWS ならではのものです。Workers や Vercel の関数には、利用者が退役に備えるべきインスタンスがありません
- リージョンを自分で選ぶぶん、どのリージョンのイベントをどこで受け取るかも自分で決めます。この章でいちばん手間がかかったのはそこでした

公表された障害の通知がほしいだけなら、Cloudflare や Vercel のやり方のほうが手間がかかりません。AWS でも、User Notifications の設定だけで済ませる方法があります（[最初のページ](/ja/chapters/44-health.md)の最後の節）。

## つまずきやすいところ

| 症状 | 見るところ |
| --- | --- |
| 障害が公表されているのに、通知が来ない | ルールがそのリージョンにあるかを確かめます。東京のルールには、ほかのリージョンのイベントは届きません。ルールを作った直後なら、public イベントは最大 1 時間届かないことがあります |
| IAM や CloudFront のイベントが来ない | グローバルなイベントは us-east-1 にしか届きません。`AihHealthGlobal` をデプロイしたかを確かめます |
| 件名が UNREADABLE の通知が来た | イベントがスキーマに合っていません。本文の「What did not fit」が、合わなかった項目です。ダッシュボードでイベントを読んでから、`src/event.ts` を直します |
| INFO の通知が来たが、使っているサービスだった | サービスのコードが一覧にありません。件名に出ているコードを `src/watch.ts` の `SERVICES` に足します |
| 同じ通知が 2 通来た | publish のあと、台帳に書く前に関数が落ちた可能性があります。関数のログでエラーを探します。この重複は、欠落を避けるために受け入れているものです |
| 終わった障害の更新が来ない | 終了より前の更新が、終了のあとに届いたので捨てています。ログに `skipped` と `stale` が残ります |
| Health API を呼ぶと `SubscriptionRequiredException` | サポートプランが要ります。この章のスタックは API を使いません |
| `"source": ["aws.health*"]` のようなパターンで何も届かない | ドキュメントに、ワイルドカードを付けた `source` は一致しないとあります。`aws.health` と書きます |
| メールが来ない | 確認メールのリンクを押したかを確かめます。トピックはリージョンごとに別なので、確認メールは 2 通です |

## 本番にするなら

- デッドレターキューにアラームを付ける。メッセージが 1 件でも入ったら鳴らします。ここに入ったイベントは、誰にも知らされていません。アラームの作り方は [19章](/ja/chapters/19-observability.md)にあります
- 届け先を、人が実際に見る場所にする。メールで足りなければ、トピックの先をチャットやオンコールの仕組みにつなぎます。「障害」と「期日までに対応」で届け先を分けるなら、SNS のメッセージ属性と購読のフィルターが使えます（[25章](/ja/chapters/25-events.md)）
- アカウントの連絡先を、共有のアドレスにする。Health のメールは、既定ではアカウントの連絡先に届きます。退職した人の個人アドレスのままになっていないかを確かめます
- サービスの一覧を埋める。EventBridge のコンソールでルールを作る画面には、Health のサービスのコードを選ぶ欄があります。使っているサービスのコードをそこで確かめて、`SERVICES` に足します
- 控えのリージョンをどうするか決める。東京の EventBridge が止まっているときにも東京のイベントを受け取りたいなら、us-west-2 にも同じスタックを置きます。そのままでは、東京と us-west-2 の両方が同じイベントを通知します。台帳がリージョンごとに別だからです。重複を避けるには、us-west-2 の側だけ通知を遅らせて東京の台帳を見にいくか、台帳をリージョンをまたいで共有します。どちらも、この章では作っていません
- アカウントが複数あるなら、organizational view を有効にして、委任された管理者のアカウントにこのスタックを置く
- 障害のときにどう動くかを、前もって書いておく。手順書と訓練は [33章](/ja/chapters/33-production-readiness.md)と [40章](/ja/chapters/40-disaster-recovery.md)が扱います

## 片付け

<!-- section: 44.cleanup -->

```bash
vp run health:infra:destroy
vp run health:global:infra:destroy
```

ルール、関数、台帳、トピックと購読、デッドレターキュー、ロググループが消えます。台帳の記録、キューに残っていたメッセージ、ログも一緒に消えます。練習用なので、どのリソースもスタックと一緒に消える設定にしてあります。本番では、少なくともデッドレターキューとロググループは残す設定にします。

スタックを消しても、Health のイベントそのものは消えません。ダッシュボードには残り、メールもこれまでどおり届きます。消えるのは、自分で作った通知の経路だけです。

ほかに残るのは、cdkd の bootstrap で作った保存場所だけです（02章）。us-east-1 で bootstrap したなら、us-east-1 にも残ります。

## 分散システムとして見ると

- 状態の持ち主: イベントの本当の状態を持っているのは AWS Health です。台帳が持っているのは「最後に知らせた状態」で、Health の状態の写しではありません。台帳を消しても失われるのは通知の履歴だけで、次に届いたイベントは新しいものとして知らされます
- 不変条件: 1 つのイベントの意味のある状態の変化 1 つにつき、通知は 1 通。開いている障害について、通知が 0 通になることはない
- 不変条件を壊そうとするテスト: 重複、順序の入れ替わり、終了、publish の失敗、publish と記録のあいだでの中断、同時に届いた 2 つの配送を、決まった順序で再現しています
- 保証していないこと: 「ちょうど 1 通」。publish のあとで落ちれば 2 通になります。順序も、通知が届く順序までは保証していません。SNS からメールまでの経路は、この章の外です
- 遅れ: Health イベントは、AWS が障害に気づき、文章を書いて、公表してから届きます。通知が届いた時点で、障害はすでに始まっています。アラームより先に Health が知らせてくれることは、期待しないでください
- 観測できない失敗: ルールのパターンが間違っていても、エラーは出ません。何も届かないだけです。この章が、値の決まっている項目だけで絞り、パターンをテストで fixture と照合し、テンプレートのパターンがそれと同じであることまで確かめているのは、そのためです

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 89 件（ドキュメントのサンプル 5 件の読み取り、時刻の解釈、ルールのパターンと fixture の照合、分類、台帳の判定、重複・順序の入れ替わり・終了・publish の失敗・途中での中断・同時実行の再現、通知の文面、スタックの assertion）。型検査。`health:replay` の出力。`health:infra:synth` で、2 つのスタックのテンプレートが AWS に問い合わせずに生成されること（esbuild のバンドル込み）。`vp check --fix` を自分のファイルにかけ、awscdk-lint を含めて警告が出ないこと。

**まだ確かめていないこと。** AWS では何も実行していません。とくに次の点は、ドキュメントから読み取っただけです。

- 実際の Health イベントの形。1 件も受け取っていません。表とサンプルが食い違う項目、`AWS Health Abuse Event` の `detail`、グローバルなイベントの `eventRegion` の値は分かっていません
- ルールが実際のイベントに一致すること。`page` と `backupEvent` が、サンプルどおり文字列で届くことに依存しています
- `detail.service` のコード。確かめられたのは、ドキュメントの例にある `EC2`、`LAMBDA`、`ELASTICLOADBALANCING`、`VPC`、`AUTOSCALING`、`RDS`、イベントタイプコードから読み取った `EBS` と `S3`、Service health のページのデータで見た `MULTIPLE_SERVICES` だけです。最後の 1 つは、ページが読み込む JSON（`https://health.aws.amazon.com/public/currentevents`）で見たもので、この JSON はドキュメントに載っていません
- cdkd でのデプロイ。us-east-1 へのデプロイ、ルールから関数への権限、TTL、デッドレターキュー、メールでの件名と本文の見え方
- `-c alarmTopicArn` で 19章のトピックを渡したとき、関数のロールの許可だけで publish できること。19章のトピックのポリシーが許可しているのは CloudWatch だけで、同じアカウントの IAM の許可で足りるという理解は、実機で確かめていません
- 同じアカウントの別リージョンの event bus へ転送するときに要る権限。読み切れなかったので、その構成は作っていません
- Health API に要るサポートプラン。ユーザーガイドと API リファレンスの記述が揃っていません。以前のプランがいつまで有効かも、読んだページからは分かりませんでした。サポートプランの比較ページはテキストとして読んだため、Health API の行のチェックがどのプランの列に付いているかは読み取れていません
- 料金の仮定。関数の実行時間、ログの量、月あたりのイベントの数は、どれも計測していません
- organizational view と、複数アカウントでの動作

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| イベントの種類ごとの動き方 | `examples/44-health/src/message.ts`、`src/classify.ts` | `test:unit` |
| ルールを置くリージョン | `examples/44-health/src/watch.ts`、`src/pattern.ts`、`test/pattern.test.ts` | `test:unit` |
| イベントの形 | `examples/44-health/src/event.ts`、`fixtures/`、`test/event.test.ts` | `test:unit` |
| 分類 | `examples/44-health/src/classify.ts`、`test/classify.test.ts` | `test:unit` |
| 1 つの状態に 1 通 | `examples/44-health/src/ledger.ts`、`src/notify.ts`、`src/dynamodb-ledger.ts`、`test/ledger.test.ts`、`test/notify.test.ts` | `test:unit` |
| スタック | `examples/44-health/infra/lib/health-stack.ts`、`infra/bin/app.ts`、`src/lambda.ts`、`infra/test/health-stack.test.ts` | `test:unit`、`health:infra:synth` |
| 手元で動かす | `examples/44-health/scripts/replay.ts`、`fixtures/` | `health:replay` |
| デプロイして確かめる | `examples/44-health/infra/bin/app.ts` | `health:infra:diff`、`health:infra:deploy`、`health:global:infra:deploy`、`health:infra:drift` |
| 料金 | `data/pricing/` | |
| 片付け | `tools/src/infra/` | `health:infra:destroy`、`health:global:infra:destroy` |

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::Events::Rule`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::DynamoDB::Table`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SNS::Subscription`、`AWS::SQS::Queue`、`AWS::SQS::QueuePolicy`、`AWS::Logs::LogGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy`。このスタックに、Cloud Control API 経由になる種類はありません。

**一次情報**（確認日はすべて 2026-10-13）

- AWS Health ユーザーガイド: [What is AWS Health?](https://docs.aws.amazon.com/health/latest/ug/what-is-aws-health.html)、[Concepts for AWS Health](https://docs.aws.amazon.com/health/latest/ug/aws-health-concepts-and-terms.html)、[Viewing your account events](https://docs.aws.amazon.com/health/latest/ug/aws-health-account-views.html)、[AWS Health Dashboard（Service health）](https://docs.aws.amazon.com/health/latest/ug/aws-health-dashboard-status.html)、[Planned lifecycle events](https://docs.aws.amazon.com/health/latest/ug/aws-health-planned-lifecycle-events.html)、[Manage AWS Health notifications in AWS User Notifications](https://docs.aws.amazon.com/health/latest/ug/manage-user-notifications.html)
- EventBridge での受け取り: [Monitoring events in AWS Health with Amazon EventBridge](https://docs.aws.amazon.com/health/latest/ug/cloudwatch-events-health.html)、[Creating EventBridge rules for AWS Region coverage](https://docs.aws.amazon.com/health/latest/ug/choosing-a-region.html)、[Monitoring account-specific and public events](https://docs.aws.amazon.com/health/latest/ug/about-public-events.html)、[Viewing paginated lists of AWS Health events](https://docs.aws.amazon.com/health/latest/ug/pagnation-of-health-events.html)、[Configuring an EventBridge rule](https://docs.aws.amazon.com/health/latest/ug/creating-event-bridge-events-rule-for-aws-health.html)、[Reference: AWS Health events Amazon EventBridge schema](https://docs.aws.amazon.com/health/latest/ug/aws-health-events-eventbridge-schema.html)、[Running operations on EC2 instances automatically](https://docs.aws.amazon.com/health/latest/ug/automating-instance-actions.html)
- 複数アカウント: [Aggregating AWS Health events across accounts](https://docs.aws.amazon.com/health/latest/ug/aggregate-events.html)、[Enabling organizational view](https://docs.aws.amazon.com/health/latest/ug/enable-organizational-view.html)、[Registering a delegated administrator](https://docs.aws.amazon.com/health/latest/ug/register-a-delegated-administrator.html)、[Aggregating AWS Health events using organizational view（EventBridge）](https://docs.aws.amazon.com/health/latest/ug/aggregating-health-events.html)
- Health API: [Integrating AWS Health with other systems using the AWS Health API](https://docs.aws.amazon.com/health/latest/ug/health-api.html)、[API Reference: Welcome](https://docs.aws.amazon.com/health/latest/APIReference/Welcome.html)
- サポートプラン: [Compare AWS Support Plans](https://aws.amazon.com/premiumsupport/plans/)、[AWS Support Plan Pricing](https://aws.amazon.com/premiumsupport/pricing/)
- EC2 と Lambda: [Scheduled events for Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-instances-status-check_sched.html)、[Instance retirement](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-retirement.html)、[Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)、[How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- AWS User Notifications: [What is AWS User Notifications?](https://docs.aws.amazon.com/notifications/latest/userguide/what-is-service.html)、[FAQs](https://aws.amazon.com/notifications/faqs/)
- EventBridge と SNS: [Amazon EventBridge Pricing](https://aws.amazon.com/eventbridge/pricing/)、[Sending events between event buses](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-bus-to-bus.html)、[SNS API: Publish](https://docs.aws.amazon.com/sns/latest/api/API_Publish.html)
- AWS Price List bulk API: [SNS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json)（メールの配送の単価。Lambda、DynamoDB、ログの単価は、04章、05章、19章で確認したものを使っています）
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- Cloudflare: [Notifications](https://developers.cloudflare.com/notifications/)、[Available Notifications](https://developers.cloudflare.com/notifications/notification-available/)
- Vercel: [Vercel Status](https://www.vercel-status.com/)、[Alerts](https://vercel.com/docs/alerts)

:::
