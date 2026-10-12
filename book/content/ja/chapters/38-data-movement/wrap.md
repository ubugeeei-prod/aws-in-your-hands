---
title: "38 Data Movement: 費用、注意点、片付け"
---

# 38 Data Movement: 費用、注意点、片付け

章の最後のページです。Cloudflare R2 とのあいだで運ぶ話、料金、つまずきやすいところ、本番で足すもの、片付けの順に書きます。

## R2 と S3 のあいだで運ぶ

<!-- section: 38.cloudflare -->

Cloudflare から来た人が運びたいのは、たいてい R2 と S3 のあいだです。両方の向きを、それぞれのドキュメントで確かめました（2026-10-13）。

**S3 から R2 へ。** Cloudflare には、道具が 2 つあります。Super Slurper は、S3 などのバケットの中身を、1 回のジョブで R2 のバケットにまとめてコピーします。R2 に同じキーがすでにあるときに上書きするか飛ばすかを選べて、既定は上書きです。1 TB を超えるオブジェクトと、Glacier Instant Retrieval 以外の Glacier のクラスにあるオブジェクトは、飛ばされます。Sippy は、オブジェクトが最初にリクエストされたときに、ソースから読んで応答を返しながら、R2 にコピーします。まとめて運ばずに、使われたものから少しずつ移す道具です。一度コピーされたあとは、ソース側で変更しても R2 には反映されないと書かれています。どちらのページにも、移したあとの ETag が元と同じとは限らない、という注意があります。

料金は両側でかかります。R2 の料金ページによると、Super Slurper が R2 のバケットに対して行う Class A の操作は課金されます。AWS の側では、S3 から AWS の外へ出るデータに、データ転送の料金がかかります。Price List の東京リージョンの単価は、最初の 10 TB まで 1 GB あたり USD 0.114 です。Super Slurper と Sippy のページには、この料金についての金額の記述はありませんでした。Sippy のページは、アプリのリクエストの流れの中でコピーすることで、移行のための転送料が減ると説明しています。

**R2 から S3 へ。** Cloudflare のドキュメントで読んだ 2 つのページは、どちらも R2 に入れる向きの道具でした。反対の向きには、DataSync が使えます。DataSync のドキュメントは、対応するほかのクラウドのストレージに Cloudflare R2 を挙げています。R2 は、DataSync の object storage ロケーションとして登録します。エンドポイントは `<アカウント ID>.r2.cloudflarestorage.com` で、アクセスキーとシークレットキーを渡します。

エージェントが要るかどうかは、モードで変わります。Enhanced モードなら、ほかのクラウドのオブジェクトストレージと S3 のあいだは、エージェントなしで動きます。Basic モードでは、エージェントを EC2 のインスタンスとして動かす必要があります。Enhanced モードの料金は、大阪と東京のどちらでも、実行 1 回あたり USD 0.55 と、1 GB あたり USD 0.015 です。R2 の側は、料金ページによると、外へ出るデータの転送料がかかりません。読み出しは Class B の操作として数えられます。AWS が受け取る側のデータ転送料は、調べていません。

気をつける点が 1 つあります。DataSync のドキュメントは、オブジェクトのタグに対応していないクラウドではタグのコピーで実行が失敗することがある、と書いています。その場合は `ObjectTags` を `NONE` にします。R2 がタグに対応しているかは、確かめていません。この向きのコピーも、著者は実行していません。

どちらが良いかは、データを誰が読むかで決まります。読むのが Cloudflare の上のアプリと、インターネットの利用者だけなら、外へ出る転送料がかからない R2 に置いたままにする理由は十分にあります。AWS の上で処理したいデータ（[26章](/ja/chapters/26-analytics.md)の分析や、[17章](/ja/chapters/17-ai.md)のモデルへの入力など）があるときに、その部分だけを S3 に運ぶ、という使い方が現実的です。

## 料金

<!-- section: 38.cost -->

金額は USD、従量課金、税別です。DataSync と S3 の単価は、東京と大阪の AWS Price List から取りました。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

まず、何も動いていないときです。DataSync の料金ページには、前払いも最低料金もないと書かれています。ロケーションとタスクは、置いてあるだけでは課金されません。`sourceLocation` を付けずにデプロイした 2 つのスタックにかかるのは、バケットに入っているものの保存料だけです。

次に、スケジュールを有効にした場合です。タスクは、コピーするものがない日にも動いて、両側のバケットを調べます。添付が 10,000 個、合計 10 GB あるバケットで、1 か月のあいだ何も変わらなかった場合を計算します。

| 対象 | 月額 |
| --- | --- |
| DataSync（Basic モード、コピー 0 GB） | 0.00 |
| S3 のリクエスト（東京と大阪、30 回の実行） | 0.64 |
| 小計 | **0.64** |

0.64 は、リクエストの数を仮定して出した数字です。実行 1 回につき、両側でプレフィックスごとに LIST を 1 回、オブジェクトごとに HEAD を 1 回、ソース側でオブジェクトごとにタグの読み出しを 1 回、と数えました。ドキュメントは、DataSync が実行のたびに LIST と HEAD を送ること、何も運ばなくても HEAD の料金がかかることを書いていますが、回数は示していません。実際の数は、請求を見るまでわかりません。確かなのは、この料金が**運んだ量ではなく、置いてあるオブジェクトの数に比例する**ことです。

最初の 1 回は、全部を運びます。

| 対象 | 定価 |
| --- | --- |
| DataSync（Basic モード、10 GB） | 0.13 |
| リージョン間のデータ転送（東京から大阪、10 GB） | 0.90 |
| S3 のリクエスト | 0.08 |
| アーカイブの保存料（10 GB、1 か月） | 0.25 |
| 小計 | **1.35** |

いちばん大きいのは、DataSync の料金ではなく、リージョンをまたぐデータ転送の料金です。1 GB あたり USD 0.09 で、DataSync の USD 0.0125 の約 7 倍です。同じリージョンの中の 2 つ目のバケットに運ぶなら、この行はなくなります。

同じ 1 か月を Enhanced モードで動かすと、実行料が加わります。

| 対象 | 月額 |
| --- | --- |
| Enhanced モードの実行料（30 回） | 16.50 |

16.50 は、何もコピーしない実行にも実行料がかかると仮定した数字です。料金ページは、Enhanced モードのタスクには実行ごとの料金がかかると書いていますが、何も運ばなかった実行や、失敗した実行をどう扱うかは書いていません。

ここに入れていないものがあります。関数の呼び出し、SNS の通知、ロググループの保存料は、1 日に数回のイベントでは、合わせても 1 セントに届かないと見ています。計算はしていません。アーカイブの古いバージョンは、30 日のあいだ、1 つずつ丸ごと保存料がかかります。無料枠は、どの表でも引いていません。DataSync に無料枠があるという記述は、料金ページには見つかりませんでした。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| ロケーションの作成が失敗する | ロールのポリシーと信頼ポリシーを確かめます。CloudFormation のリファレンスは、そのリージョンで AWS STS が有効になっている必要があるとも書いています |
| 実行が、ネットワークの接続エラーで始まらない | Basic モードで、タスクがデスティネーションと別のリージョンにあります。タスクはデスティネーションのロケーションと同じリージョンに作ります |
| 毎晩 `ERROR` の通知が届く | `VerifyMode` が全体の検証になっていないかを見ます。動いているバケットでは、コピーしたものだけを検証します |
| 通知が、ある日から来なくなった | 成功が続いているのか、スケジュールが止まったのかを区別します。`aws datasync describe-task` の `Schedule` を見ます |
| `unreadable_event` の通知が届く | 実物のイベントの形が、この章のスキーマと違っています。関数のログにあるフィールド名を見て、スキーマを直します |
| ロググループに何も出ない | エラーがなければ、`BASIC` では出ません。エラーがあるのに出ないなら、リソースポリシーを確かめます |
| 一部のオブジェクトが運ばれない | キーが `/` で始まるもの、`//`、`/./`、`/../` を含むものは、Basic モードでは運べません。Glacier Flexible Retrieval と Deep Archive のものは、復元するまで読めません |
| S3 のリクエストの料金が増えた | オブジェクトの数が増えています。フィルターで範囲を絞るか、スケジュールの間隔を広げます |
| アーカイブが、ソースより大きい | `PRESERVE` は、ソースで消したものを残します。古いバージョンも 30 日残ります |
| `AccessDenied` で、KMS の名前が出る | バケットが SSE-KMS です。鍵のポリシーに、DataSync のロールを書きます。SSE-C のバケットは、DataSync では扱えません |
| `move:archive:infra:destroy` が、バケットを消せない | バージョンが残っています。先に `move:empty --yes` を実行します |

## 本番にするなら

- **アーカイブを、別のアカウントに置く。** 同じアカウントにある写しは、アカウントの認証情報が漏れたときに、一緒に消されます。[しくみと実装のページ](/ja/chapters/38-data-movement/build.md)の「別のアカウントのバケットへ」が、その形です
- **消したものをどうするかを、先に決める。** `PRESERVE` は事故に強く、利用者との約束に弱い設定です。`REMOVE` はその逆です。どちらにするかは、技術ではなく、アプリが利用者に何を約束しているかで決まります
- **成功していないことを知らせる。** 失敗の通知だけでは、通知そのものが届かない場合を拾えません。最後の成功からの時間を見張ります
- **遅れの上限を、数字で書く。** この章の設定では、ふだんは 26 時間、1 回の失敗を許すと 50 時間です。それより短くしたいなら、スケジュールを詰めるより、[28章](/ja/chapters/28-multi-region.md)の S3 Replication を選びます
- **戻す手順を、一度は試す。** アーカイブから戻すには、向きを逆にしたタスクか、`aws s3 sync` が要ります。この章は、戻す側を作っていません。22章で書いたとおり、戻したことのない写しは、まだ写しとは呼べません
- **アーカイブのバケットを、スタックと一緒に消えない設定にする。** この章は練習用に `RemovalPolicy.DESTROY` にしています
- **タスクレポートを残す。** 何を運び、何を飛ばしたかを、実行ごとに記録として残せます。監査が要るデータなら、有効にします
- **数が増えたら、モードを見直す。** オブジェクトとプレフィックスの合計が 2,500 万に近づく前に、Enhanced モードに作り直します。そのとき、毎日の実行料が加わります

## 片付け

<!-- section: 38.cleanup -->

```bash
vp run move:empty
vp run move:empty --yes
vp run move:archive:infra:destroy
vp run move:infra:destroy
```

1 行目は、2 つのバケットにあるバージョンの数を数えるだけです。2 行目が、すべてのバージョンと削除マーカーを消します。固定した版の cdkd は、空でないバケットを消さないので、スタックより先にバケットを空にします。

<<< @/examples/38-data-movement/scripts/empty.ts{empty}

大阪のスタックを先に消します。タスクが東京のロケーションを参照しているので、東京を先に消すと、参照先のないタスクが残ります。大阪のスタックを消すと、スケジュールも一緒に消えて、実行は始まらなくなります。実行の最中にスタックを消した場合に何が起きるかは、確かめていません。

残るものが 1 つあります。大阪リージョンに用意した cdkd の保存場所は、スタックを消しても残ります（02章）。

片付けの手順は、どれも AWS で実行していません。

## 分散システムとして見ると

状態の置き場所は 2 つで、そのあいだを 1 本のコピーが流れています。

本物を持っているのは、ソースのバケットです。アーカイブは、ソースから導かれたもので、ソースと食い違ったときに正しいのは、いつもソースです。だから、アーカイブに書いてよいのは DataSync のロールだけで、アプリも人も、アーカイブには書きません。テストは、アーカイブに直接書いたものが次の実行で上書きされることを固定しています。

アーカイブは、ソースより遅れています。遅れの上限は、スケジュールの間隔と、実行にかかる時間と、何回の失敗までを我慢するかの和です。この章は、26 時間と 50 時間という数字を選びました。この数字が、アーカイブから戻したときに失うデータの上限になります。

実行の最中にアーカイブを読む人が見るのは、ソースの一部です。1 つ 1 つのオブジェクトは、完全です。S3 のドキュメントによると、1 つのキーへの書き込みは原子的で、読む側に見えるのは古い中身か新しい中身のどちらかです。ただし、キーをまたぐ原子性はありません。ノートが 3 枚の添付を持っていても、アーカイブにはそのうちの 2 枚だけがある、という瞬間があります。DataSync は、ノートという単位を知りません。

もう 1 つ、アーカイブが持っていないものがあります。添付の記録は DynamoDB にあり、この章のコピーは DynamoDB を運びません。アーカイブのバケットだけを戻しても、どの添付がどのノートのものかは、キーの形からわかる範囲でしか戻りません。テーブルとバケットを別々に戻したときの食い違いは、22章がそのまま当てはまります。

不変条件は、[手元で動かすページ](/ja/chapters/38-data-movement/local.md)に書いた 1 文です。再実行しても安全だという性質は、DataSync が約束しているものではなく、`TransferMode` を `CHANGED` にしたときに、実行が毎回「いま足りないもの」を計算し直すことから出てきます。同じ性質を、08章のワーカーは条件付きの書き込みで、この章は差分の計算で手に入れています。

::: details この章の検証メモ

**手元で確かめたこと。** 計画のモデル（新規・変更・同じの分類、`PRESERVE` と `REMOVE`、ソースの一覧が空のときの全削除、フィルターで外したものを消さないこと、アーカイブ側が新しいオブジェクトの上書きと目印、`OverwriteMode` `NEVER` が守るものと止めるもの、`TransferMode` `ALL`、include と exclude の組み合わせ、`ALL` と `REMOVE` の拒否、一覧のスキーマ）。フィルターのモデル（`|` での分割とエスケープ、フォルダーの一致、ワイルドカード、include の制約）。実行のモデル（静かなソースでの収束と再実行、途中で止まった実行の続きと書き込みの回数、コピー後の差し替え、一覧後の差し替え・アップロード・削除、全体の検証での `ERROR`、`REMOVE` での削除の遅れ、アーカイブへの直接の書き込み）。イベントのスキーマと判断（`ERROR`、`SUCCESS`、ほかの状態、ほかのタスク、読めないイベント）、通知の送信と失敗、遅れの上限、関数の環境変数。2 つのスタックのアサーション（種類の一覧、ロールごとのアクションの一覧、信頼ポリシーの条件、`aws:ResourceAccount`、ロケーションとポリシーの順序、バケットの公開設定とライフサイクル、タスクのオプションとスケジュール、ロググループのリソースポリシー、ルールのパターン、`deletes`・`excludes`・`writerRole` の各構成、設定の拒否）。型検査、synth、`move:demo`。加えて、コードを 8 か所わざと壊して、テストが落ちることを確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`move:infra:diff`、`deploy`、`drift`、`destroy`、`move:archive:infra:*`、`move:empty`、`aws datasync` と `aws sns` のコマンドのどれもです。次は、実物では確かめていません。cdkd が DataSync の 2 つの種類と `AWS::Logs::ResourcePolicy` を Cloud Control API 経由で作れること。大阪リージョンへのデプロイに要る準備。ロケーションの作成時にロールが検査されること。別のリージョンのロケーションを持つ Basic モードのタスクが動くこと。DataSync が何を「違い」と判定するか（タグだけの変更、マルチパートで書かれたオブジェクトを含む）。実行中にソースが変わったときの結果と、検証の判定。フィルターで外したオブジェクトが `REMOVE` で消えるかどうか。バージョニングを有効にしたアーカイブで、DataSync の削除が削除マーカーになること。EventBridge のイベントの実物の形（見本では `resources` の ARN が `arn:aws:sync:` で始まっていて、同じ記事のパターンは `arn:aws:datasync:` です。スキーマは後者に合わせました）と、`SUCCESS`・`ERROR` 以外の状態の綴り。何もコピーしない実行の S3 のリクエストの数と、Enhanced モードの実行料の扱い。アカウントをまたぐコピー。R2 とのあいだのコピー。計画と実行のモデルは、ドキュメントの記述から著者が書いたもので、DataSync と突き合わせてはいません。AWS Data Pipeline は、新規に使えないので、何も動かしていません。サポートの終了日は、見つけられませんでした。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| DataSync の部品、タスクの設定 | `examples/38-data-movement/src/task.ts`、`infra/lib/archive-stack.ts`、`infra/test/stacks.test.ts` | `test:unit`、`move:infra:synth` |
| ロールとバケットポリシー | `examples/38-data-movement/infra/lib/datasync-access.ts`、`infra/lib/source-stack.ts`、`infra/lib/archive-stack.ts`、`infra/test/stacks.test.ts` | `test:unit`、`move:infra:synth` |
| 計画を手元で読む | `examples/38-data-movement/src/plan.ts`、`src/filters.ts`、`test/plan.test.ts`、`test/filters.test.ts` | `test:unit` |
| 途中で変わるソース | `examples/38-data-movement/src/execution.ts`、`src/memory-bucket.ts`、`test/execution.test.ts`、`test/world.ts` | `test:unit`、`move:demo` |
| 終わった実行を知る | `examples/38-data-movement/src/execution-event.ts`、`src/alert.ts`、`src/alert-lambda.ts`、`src/notifier.ts`、`src/env.ts`、`src/lag.ts`、`test/execution-event.test.ts` | `test:unit` |
| 手元で動かす | `examples/38-data-movement/scripts/demo.ts` | `move:demo`、`test:unit` |
| AWS にのせる | `examples/38-data-movement/infra/bin/app.ts`、`infra/lib/regions.ts`、`cdk.json` | `move:infra:synth`、`move:infra:diff`、`move:infra:deploy`、`move:archive:infra:diff`、`move:archive:infra:deploy`、`move:infra:drift` |
| 片付け | `examples/38-data-movement/scripts/empty.ts` | `move:empty`、`move:archive:infra:destroy`、`move:infra:destroy` |
| 料金 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-13）

- AWS Data Pipeline: [What is AWS Data Pipeline?](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/what-is-datapipeline.html)、[Migrating workloads from AWS Data Pipeline](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/migration.html)、[Pipeline Definition](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/dp-how-pipeline-definition.html)、[Migrate workloads from AWS Data Pipeline](https://aws.amazon.com/blogs/big-data/migrate-workloads-from-aws-data-pipeline/)（抜粋で読みました）
- DataSync のユーザーガイド: [What is AWS DataSync?](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)、[How AWS DataSync transfers work](https://docs.aws.amazon.com/datasync/latest/userguide/how-datasync-transfer-works.html)、[Choosing a task mode](https://docs.aws.amazon.com/datasync/latest/userguide/choosing-task-mode.html)、[Where can I transfer my data](https://docs.aws.amazon.com/datasync/latest/userguide/working-with-locations.html)、[Do I need an agent?](https://docs.aws.amazon.com/datasync/latest/userguide/do-i-need-datasync-agent.html)、[Configuring transfers with Amazon S3](https://docs.aws.amazon.com/datasync/latest/userguide/create-s3-location.html)、[Transferring between S3 buckets across accounts](https://docs.aws.amazon.com/datasync/latest/userguide/tutorial_s3-s3-cross-account-transfer.html)、[Handling files, objects, and metadata](https://docs.aws.amazon.com/datasync/latest/userguide/configure-metadata.html)、[How DataSync handles metadata](https://docs.aws.amazon.com/datasync/latest/userguide/metadata-copied.html)、[Verifying data integrity](https://docs.aws.amazon.com/datasync/latest/userguide/configure-data-verification-options.html)、[Filters](https://docs.aws.amazon.com/datasync/latest/userguide/filtering.html)、[Manifests](https://docs.aws.amazon.com/datasync/latest/userguide/transferring-with-manifest.html)、[Scheduling](https://docs.aws.amazon.com/datasync/latest/userguide/task-scheduling.html)、[Starting a task](https://docs.aws.amazon.com/datasync/latest/userguide/run-task.html)、[Task reports](https://docs.aws.amazon.com/datasync/latest/userguide/task-reports.html)、[CloudWatch Logs](https://docs.aws.amazon.com/datasync/latest/userguide/configure-logging.html)、[EventBridge events](https://docs.aws.amazon.com/datasync/latest/userguide/events.html)、[Quotas](https://docs.aws.amazon.com/datasync/latest/userguide/datasync-limits.html)、[Confused deputy prevention](https://docs.aws.amazon.com/datasync/latest/userguide/cross-service-confused-deputy-prevention.html)、[Other cloud object storage](https://docs.aws.amazon.com/datasync/latest/userguide/creating-other-cloud-object-location.html)、[API: Options](https://docs.aws.amazon.com/datasync/latest/userguide/API_Options.html)
- イベント: [EventBridge events reference: AWS DataSync](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-datasync.html)、[AWS Knowledge Center の記事](https://repost.aws/knowledge-center/datasync-task-execution-notification)（イベントの見本）、[Lambda の非同期呼び出しの再試行](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- 料金: [AWS DataSync pricing](https://aws.amazon.com/datasync/pricing/)（抜粋で読みました）。AWS Price List bulk API: [DataSync（大阪）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataSync/current/ap-northeast-3/index.json)、[S3（大阪）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-3/index.json)、[Data Transfer（東京）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)
- CloudFormation と cdkd: [AWS::DataSync::Task](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-datasync-task.html)、[Cloud Control API の対応一覧](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)、[AWS DataSync endpoints](https://docs.aws.amazon.com/general/latest/gr/datasync.html)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの `dist`）
- S3: [Replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)、[Replication の要件](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-requirements.html)、[Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html)、[API: Object](https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html)（ETag）、[データの整合性モデル](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[aws s3 sync](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/sync.html)
- ほかの手段: [AWS Transfer Family](https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html)、[Snowball Edge](https://docs.aws.amazon.com/snowball/latest/developer-guide/whatisedge.html)（冒頭の告知）、[AWS DMS](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)、[Amazon Data Firehose](https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html)
- Cloudflare: [R2 Super Slurper](https://developers.cloudflare.com/r2/data-migration/super-slurper/)、[R2 Sippy](https://developers.cloudflare.com/r2/data-migration/sippy/)、[R2 Pricing](https://developers.cloudflare.com/r2/pricing/)（いずれも抜粋で読みました）

:::
