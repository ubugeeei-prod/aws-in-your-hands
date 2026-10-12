---
title: "41 Fargate: 費用、注意点、片付け"
---

# 41 Fargate: 費用、注意点、片付け

## 料金

<!-- section: 41.cost -->

金額は USD、東京リージョン、従量課金、税別で、1 か月を 730 時間として計算しています。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

最初の表は、既定の構成で、置いてあるだけでかかる料金です。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| Fargate の vCPU（arm64） | タスク 2 × 0.25 vCPU × 730 時間 | 0.04045／vCPU 時 | 14.76 |
| Fargate のメモリ（arm64） | タスク 2 × 0.5 GB × 730 時間 | 0.00442／GB 時 | 3.23 |
| ALB | 730 時間 | 0.0243／時 | 17.74 |
| パブリック IPv4 アドレス | （ALB 2 + タスク 2）× 730 時間 | 0.005／時 | 14.60 |
| 夜間のジョブ | 30 回 × 60 秒（最低課金） | 上と同じ単価 | 0.01 |
| イメージの保存 | 0.1 GB（仮定） | 0.10／GB 月 | 0.01 |
| 小計 | | | **50.35** |

12章の既定の構成（USD 50.34）との差は、夜間のジョブの 1 セントだけです。capacity provider strategy、auto scaling のポリシー、Scheduler のスケジュール、ECS Exec の設定そのものには、料金がかかりません。かかるのは、その結果として動いたタスクの時間です。1 日あたりでは USD 1.65 です。

Fargate は、タスクが要求した vCPU とメモリに対して、イメージの取得を始めた時点からタスクが止まるまで、1 秒単位で課金します。最低課金は 1 分です。ジョブが 5 秒で終わっても、60 秒ぶんがかかります。

**上限。** auto scaling が 6 つまで増やしたまま 1 か月動いたとすると、USD 100.93 です。タスクが 1 つ増えるごとに、およそ USD 12.65 増えます（Fargate の 9.00 と、パブリック IPv4 アドレスの 3.65）。この上限は、6 つすべてをオンデマンドの単価で数えたものです。実際には、増えた 4 つのうち 3 つが Spot で動き、そのぶん安くなります。どれだけ安くなるかは、Spot の東京の単価を取得できていないので、計算していません。料金のページは「最大 70%」と書いています。

リクエストに比例する料金（ALB の LCU、ログ、データ転送）と、叩かれたときの上限の考え方は、12章の[料金](/ja/chapters/12-containers/wrap.md)と同じです。ここでは繰り返しません。

置いてあるだけでかかる料金の数え方は、コードにしてあります。サービスのぶんは、12章の関数にこの章のタスクの数を渡しているだけです。

<<< @/examples/41-fargate/src/cost.ts{billable}

**Compute Savings Plans。** Savings Plans は、1 時間あたりいくら使うかを 1 年か 3 年ぶん約束するかわりに、単価が下がる仕組みです。Compute Savings Plans は、EC2 のほか、Fargate と Lambda の利用にも効きます。料金のページは、Fargate で最大 50% と書いています。約束した額は、使っても使わなくても払います。向いているのは、この章の `base` の 2 つのように、1 年先も動いていると言い切れる部分だけです。auto scaling で増えるぶんや、まだ大きさが決まっていないサービスには向きません。順序としては、まず大きさを決め、arm64 に寄せ、Spot に回せるぶんを回し、最後まで残ったオンデマンドの底のぶんに対して考えます。Spot の利用が Savings Plans の対象になるかどうかは、読んだページでは確認できませんでした。割引後の単価は、この本では計算していません。

**Lambda、EC2 と比べる。** 04章の構成（HTTP API と Lambda）と、この章の構成（ALB と Fargate）を、2 つの負荷で比べます。1 つは、1 秒に 20 件が 1 か月続く負荷です。もう 1 つは、同じ 1 秒 20 件が 1 日 2 時間だけ来て、残りの 22 時間は 0 件の負荷です。Lambda はメモリ 512 MB、1 リクエスト平均 50 ms としました。

| 負荷 | Lambda と HTTP API | Fargate と ALB | t4g.small 2 台と ALB |
| --- | --- | --- | --- |
| 1 秒 20 件が 1 か月（5,184 万件） | 94.52 | 54.94 | 70.02 |
| 1 秒 20 件が 1 日 2 時間（432 万件） | 7.88 | 52.79 | 計算していません |

Lambda の毎月の無料枠を引くと、それぞれ USD 88.99 と USD 6.24 です。Fargate の列は、0.25 vCPU のタスク 2 つを 1 か月動かし、2 行目では忙しい 2 時間だけ auto scaling がさらに 2 つ足すとしています。

この表には、大きな仮定が 1 つ入っています。**0.25 vCPU のタスク 2 つが 1 秒 20 件に答えられるかどうかは、計っていません。** 答えられなければ、タスクを増やすか大きくすることになり、Fargate の列はそのぶん高くなります。Lambda の列は、リクエストが増えれば台数の心配なしに料金だけが増えます。ログ、データ転送、データベースは、どの列にも入っていません。

そのうえで、表から読み取れることを書きます。負荷が途切れないなら、Fargate の固定費は Lambda のリクエストごとの料金より安くなります。負荷が 1 日のうち短い時間に集中するなら、Lambda がはるかに安く済みます。Fargate の料金は、忙しい 2 時間でも暇な 22 時間でも、ほとんど変わらないからです。

境目も計算できます。Lambda と HTTP API は、この仮定で 100 万件あたり USD 1.82 です。この章のスタックで時間に対してかかる料金（USD 50.34）をその単価で割ると、月におよそ 2,766 万件、1 秒あたり 10.7 件です。1 か月を通した平均がこれより少ないなら、料金だけを見れば Lambda のほうが安くなります。

<<< @/examples/41-fargate/src/breakeven.ts{even}

EC2 の列は、[23章](/ja/chapters/23-ec2.md)の t4g.small を 2 台、同じ ALB の後ろに置いた場合です。インスタンス 1 台は、8 GB のボリュームを含めて月 USD 16.54 です。Fargate のタスク 1 つは、0.25 vCPU と 0.5 GB なら USD 9.00、1 vCPU と 2 GB なら USD 35.98 です。同じくらいの大きさを常に動かすなら、EC2 のほうが安くなる場合があります。そのかわり、OS の更新、コンテナの入れ替え、台数の調整を自分で持ちます。その手間は、表の金額には入っていません。

無料枠は、Lambda 以外には引いていません。Fargate の料金のページには、無料枠の記述が見つかりませんでした。

## Cloudflare や Vercel から来た人へ

<!-- section: 41.platforms -->

どちらのドキュメントも、2026-10-13 に読みました。使って確かめてはいません。

Cloudflare Containers は、この章で決めたことの多くを、決めなくて済む形にしています。

| | Cloudflare Containers | この章（ECS on Fargate） |
| --- | --- | --- |
| 大きさ | `lite`（1/16 vCPU、256 MiB）から `standard-4`（4 vCPU、12 GiB）までの 6 種類と、4 vCPU、12 GiB までのカスタム | 表にある組み合わせ。32 vCPU、244 GB まで |
| 使われていないとき | 既定で 10 分使われないと sleep し、課金が止まる。止まった状態からの起動は多くの場合 1〜3 秒 | 最小の数のタスクが動き続け、料金がかかる |
| 数の増減 | 決めた数のインスタンスに `getRandom` で振り分ける。stateless なアプリ向けの組み込みの autoscaling は、いまは無い（予定はあると書かれている） | target tracking などに任せられる |
| 割引された容量 | 該当するものは見つからなかった | Fargate Spot。2 分の予告で止められる |
| 定期実行 | Workers の Cron Trigger から Worker がコンテナを起動する例がある | EventBridge Scheduler から RunTask |
| ネットワーク | 設計するものが無い | サブネット、出口、エンドポイントを選ぶ |

同じ考え方も、いくつかあります。コンテナは外から止められるものとして作ること、止める合図が SIGTERM であること、イメージが大きいと起動が遅くなることは、どちらでも変わりません。この章のジョブの書き方（項目のあいだで止まり、続きの番号を残す）は、Cloudflare のコンテナでもそのまま使えます。

Vercel は、ナレッジベースの記事によると、OCI 互換のコンテナイメージを Vercel Functions として動かせます。プロジェクトのルートに `Dockerfile.vercel` を置くと、Vercel がイメージをビルドして自分のレジストリに置き、自動でスケールする関数として配信します。定期実行は、Cron Jobs が本番のデプロイの決まったパスへ HTTP の GET を送る形です。Vercel Functions の実行時間には上限があり、Fluid compute では Hobby が 300 秒、Pro と Enterprise が 800 秒（ベータで 1,800 秒まで）です。コンテナとして動かす関数にも同じ上限がかかるのかどうかは、確かめていません。

どちらのプラットフォームでも、タスクの大きさの表、capacity provider、スケールインの秒数、VPC エンドポイントは、利用者が考える対象になっていません。リクエストを受けて返すアプリで、それぞれの上限に収まり、VPC の中のリソース（[13章](/ja/chapters/13-sql.md)のデータベースなど）に直接つなぐ必要が無いなら、そこに留まるほうが単純です。使われない時間が長いアプリなら、料金の面でも有利です。

Fargate を選ぶ理由になるのは、次のような場合です。VPC の中のものと同じネットワークで話す必要がある。大きなタスクが要る。負荷が途切れず、置いてある時間で払うほうが安い。何時間も動くジョブを、止められても続けられる形で流したい。増減の決まりを自分で調整したい。そのかわり、この章に書いた判断を、すべて自分で持つことになります。

## 分散システムとして見る

この章で状態を持っているものは 3 つあります。サービスの望ましいタスクの数は、ECS が持ち、Application Auto Scaling が書き換えます。ターゲットの登録と draining の状態は、ALB が持ちます。処理中のリクエストとジョブの進み具合は、タスクのプロセスが持ちます。3 つは別々の速さで変わり、互いの状態をすぐには知りません。

不変条件は、次の 3 つです。

- 想定する時間内のリクエストは、タスクが減らされても中断されても、最後まで答えられる。守っているのは 12章の秒数の関係で、`test/scaling.test.ts` と `test/spot.test.ts` が、秒数を短くしたときに切れることを含めて確かめています
- サービスが下回らない数のタスクは、取り戻されうる容量には置かれない。`test/strategy.test.ts` と、スタックのアサーションが確かめています
- ジョブは、何度止められても、再開の番号から続ければ、すべての項目をちょうど 1 回ずつ処理する。`test/job.test.ts` が、実際に SIGTERM を送って確かめています。番号を渡さずにやり直すと重複することも、同じテストが示しています

部分的な障害として残るものもあります。Spot の中断で、登録解除より先に SIGTERM が届く場合のリクエスト。メモリの上限で強制終了されたタスクが処理していたリクエスト。Scheduler が同じ時刻のぶんを 2 回起動した場合。どれも、この章のコードでは防げません。呼ぶ側の再試行（[32章](/ja/chapters/32-limits.md)）と、処理の冪等性で受け止めます。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| タスク定義の登録が、CPU とメモリの組み合わせで拒否される | 表に無い組み合わせです。`vp run fargate:size` で、表にある組み合わせを確かめる |
| サービスの作成が、capacity provider の指定で失敗する | クラスターに provider が関連付けられているかを `aws ecs describe-clusters` の `capacityProviders` で確かめる。launch type と strategy を両方指定していないかも見る |
| 増えたはずのタスクが、いつまでも起動しない | Spot に空きが無い可能性があります。Fargate は、Spot のぶんをオンデマンドで埋め合わせません。サービスのイベントを確かめる |
| タスクが `SpotInterruption` で止まる | Spot の中断です。仕様どおりの動きです。最低限のタスクが止まっていないことを確かめる |
| 負荷が上がっても、数分のあいだタスクが増えない | target tracking は、数分ぶんのメトリクスを見てから動きます。`vp run fargate:simulate` で、起動の時間を変えて影響を見る |
| 負荷が下がったあと、タスクがなかなか減らない | スケールインは、目標よりじゅうぶん低い状態が続き、cooldown が明けてから動きます。デプロイの途中も止まります |
| スケールインのたびに、数件のリクエストが失敗する | deregistration delay が、長いリクエストより短くなっていないか。サーバーが SIGTERM を受けているか（12章） |
| ジョブが毎晩動いているのか、わからない | Scheduler は結果を知りません。ロググループの `job` で始まるストリームと、`describe-tasks` の終了コードを見る |
| ジョブの終了コードが 75 | 途中で止められています。ログの `next` の値を `--start-at` に渡して、続きを動かす |
| `fargate:exec` が失敗する | `-c exec=true` でデプロイしたか。デプロイのあとに起動したタスクか。手元に Session Manager plugin があるか。プライベートサブネットなら `ssmmessages` のエンドポイントがあるか |
| シークレットを更新したのに、アプリが古い値を使う | 値は起動時にしか渡されません。新しいデプロイを強制する |
| 使っていないのに請求がある | サービスが動いています。タグなしでデプロイし直すか、destroy する |

この表の内容は、ドキュメントの記述から組み立てたもので、実際に起こして確かめてはいません。

## 本番にするなら

12章の[本番にするなら](/ja/chapters/12-containers/wrap.md)は、この章のスタックにもそのまま当てはまります。HTTPS、認証、入口のスロットリング、データの置き場所などです。この章のぶんとして足すのは、次のことです。

- **大きさと目標値を、計って決める。** 512 MiB も、1 タスク 600 件も、計った値ではありません。Container Insights を期間を区切って有効にし、負荷試験をして決めます（19章、32章）
- **AZ を 3 つにして、`base` も 3 以上にする。** オンデマンドの底が 2 つの AZ に 1 つずつでは、片方の AZ が止まった時点で 1 つになります。そのとき Spot に空きがあるとは限りません
- **Spot の中断を数える。** `stopCode` が `SpotInterruption` のタスク状態変化イベントを EventBridge のルールで受けて（[25章](/ja/chapters/25-events.md)）、頻度を見ます。多いなら、`weight` を下げます
- **ジョブの失敗を通知にする。** 終了コードが 0 でも 75 でもないタスクの停止を、アラームにつなぎます（19章）。ジョブが起動しなかった夜に気づく仕組みも要ります
- **ジョブの再開の番号を、ログではなくストレージに置く。** 16章の形にします
- **ECS Exec を、組織のポリシーで禁止する。** 有効にする必要が出たときにだけ、期限を決めて例外を作ります。記録先のロググループを明示します
- **ログの `mode` を、欠けてよいかどうかで決める。**
- **クォータを、auto scaling の上限より先に確かめる。** 上限を上げても、vCPU のクォータに当たれば増えません（32章）
- **入れ替えの方法を選び直す。** この章はローリングアップデートのままです。blue/green や canary は [31章](/ja/chapters/31-progressive-delivery.md)にあります。`ALBRequestCountPerTarget` のポリシーは、blue/green のデプロイでは使えません
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）

## 片付け

<!-- section: 41.cleanup -->

時間課金だけを止めてイメージを残すなら、タグなしでデプロイし直します。サービス、ALB、スケジュールが消え、リポジトリが残ります。

```bash
vp run fargate:infra:diff
vp run fargate:infra:deploy
```

すべて消すなら、次の順に実行します。11章の VPC は、それを使っているスタックが残っていると消せません。

```bash
vp run fargate:infra:destroy
vp run ecs:infra:destroy
vp run net:infra:destroy
```

リポジトリは、中のイメージごと消えます。ロググループも一緒に消えます。スタックの外に残るリソースが無いようにしてあり、テストも、残す設定がどのリソースにも付いていないことを確かめています。

消す前に、止まっていない単発のタスクが無いことを確かめてください。`fargate:job:run` で起動したタスクは、スタックのリソースではないので、destroy では止まりません。ふつうは数秒で終わりますが、`JOB_ITEMS` を大きくして起動したものが残っていると、料金がかかり続けます。動いているタスクがあるときにクラスターを削除できるかどうかは、確かめていません。

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws scheduler list-schedules --region ap-northeast-1
```

2 つ目にこの章のロードバランサーが無く、3 つ目にクラスターが無く、4 つ目にこの章のスケジュールが無ければ、この章の課金は止まっています。Application Auto Scaling が作ったアラームは、ポリシーが消えるときに一緒に消されるとドキュメントにあります。

手元のデーモンには、ビルドしたイメージが残ります。`docker image rm aih-notes:f1` で消せます。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 89 件（大きさの表と選び方、strategy の決まりと分け方、target tracking のモデル、止められるタスクのリクエストの行方、12章のサーバーに SIGTERM を送るテスト、ジョブを子プロセスとして中断して再開するテスト、AWS CLI のコマンドの組み立て、料金、スタックのアサーション）。型検査。`fargate:infra:synth`（タグなし、`-c imageTag=f1`、`-c exec=true` つき、`-c taskSubnets=private` つき。`-c exec=yes` が拒否されることも）。`fargate:bundle` と `fargate:bundle:check`。`fargate:simulate`（本文の出力は、このコマンドの実際の出力です）。`fargate:size`。`fargate:job:run`、`fargate:exec`、`fargate:image:push` の `--dry-run`。AWS CLI のフラグ（`run-task` の `--capacity-provider-strategy`、`--overrides`、`--client-token`、`--started-by`、`execute-command` の `--interactive`、`--command`、`--container`）は、devShell の AWS CLI 2.35.11 の help で確かめました。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/41-fargate/test/pricing.test.ts` が照合しています。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。Docker のデーモンが無かったので、イメージも一度もビルドしていません（`Dockerfile` と `.dockerignore` は未検証です）。したがって、次のことは実物で確かめていません。cdkd 0.296.28 がこのスタックを作って消せること。クラスターの `CapacityProviders` と、strategy 付きのサービスが作れること。タスクが strategy のとおりに分かれること。Spot の中断と、そのときの ALB の登録解除と SIGTERM の順序。target tracking のアラームが動くまでの時間と、スケールインで一度に減る数（モデルの 3 分、15 分、起動の 2 分、1 タスク 900 件は、すべて仮定です）。スケールインでリクエストが切れないこと。Scheduler が RunTask を呼べること、Spot に空きが無いときの動き、再試行。`fargate:job:run` と上書きした環境変数。ECS Exec のセッション、そのログ、Session Manager plugin。クォータに達したときの見え方。「つまずきやすいところ」の症状。

一次情報で確かめられなかったこと。Fargate Spot の東京の単価（Price List に無く、料金のページの表はスクリプトで埋められます）。Spot の利用が Savings Plans の対象かどうか。Spot の中断での登録解除と SIGTERM の順序。メモリの上限で止められたときの `stoppedReason` の正確な文面と終了コード。エフェメラルストレージがいっぱいになったときの動き。target tracking のアラームの評価期間。Scheduler の ECS 用テンプレートターゲットで `Input` が何として渡るか。タスクのリタイアで置き換えを先に起動する根拠が、同じページの中で `maximumPercent` と書かれた箇所と minimum healthy percent と書かれた箇所があること。Container Insights のメトリクスが、カスタムメトリクスの無料枠（10 個）に数えられるかどうか。東京の Price List の `APN1-CW:MetricsUsage`（USD 0.07）が enhanced observability の単価であることは、料金のページの計算例の単価と一致することからの推定です。Vercel で、コンテナとして動かす関数にかかる実行時間の上限。Cloudflare Containers と Vercel は、ドキュメントを読んだだけです。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::ECS::Cluster`、`TaskDefinition`、`Service`、`AWS::ElasticLoadBalancingV2::LoadBalancer`、`TargetGroup`、`Listener`、`AWS::ECR::Repository`、`AWS::EC2::SecurityGroup`、`SecurityGroupIngress`、`AWS::IAM::Role`、`Policy`、`AWS::Logs::LogGroup`、`AWS::Scheduler::Schedule` が専用の実装に登録されています。ECS の実装の `handledProperties` には、クラスターの `CapacityProviders`、サービスの `CapacityProviderStrategy` と `EnableExecuteCommand` があります。Scheduler の実装は、`Target` の `EcsParameters` を変換する処理を持っています。`AWS::ApplicationAutoScaling::ScalableTarget`、`ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は登録が無く、未対応の一覧にも無いので、Cloud Control API を経由します。`AWS::ECS::ClusterCapacityProviderAssociations` も同じ扱いになるはずですが、このスタックは使っていません。

aws-cdk-lib 2.273.0 について、synth して観察したこと。`enableFargateCapacityProviders` は関連付けを別のリソースとして作り、サービスはそれに依存しない。`FargateService` の `enableExecuteCommand` は、`ssmmessages` の 4 つのアクションに加えて、`logs:DescribeLogGroups`、`logs:CreateLogStream`、`logs:DescribeLogStreams`、`logs:PutLogEvents` を `Resource: "*"` でタスクロールに足す。`grantRun` は、タスク定義への `ecs:RunTask` と、2 つのロールへの `iam:PassRole`（`iam:PassedToService` の条件つき）を付ける。

**コードの場所。**

| 節 | ファイル | `vp run` のタスク |
| --- | --- | --- |
| 全体像 | `examples/41-fargate/infra/lib/fargate-stack.ts`、`src/config.ts` | `fargate:infra:synth` |
| タスクの大きさ | `examples/41-fargate/src/sizes.ts`、`src/sizing.ts`、`scripts/size.ts`、`test/sizes.test.ts` | `fargate:size`、`test:unit` |
| Fargate Spot と capacity provider strategy | `examples/41-fargate/src/strategy.ts`、`src/spot.ts`、`test/strategy.test.ts`、`test/spot.test.ts`、`infra/lib/fargate-stack.ts` | `test:unit`、`fargate:infra:synth` |
| タスクの数を増減させる | `examples/41-fargate/src/scaling.ts`、`src/drain.ts`、`src/model-defaults.ts`、`scripts/simulate.ts`、`test/scaling.test.ts` | `fargate:simulate`、`test:unit` |
| サービスではないタスク | `examples/41-fargate/src/job.ts`、`src/job-main.ts`、`src/commands.ts`、`scripts/task.ts`、`test/job.test.ts`、`test/commands.test.ts` | `dev:fargate:job`、`fargate:job:run`、`test:unit` |
| ネットワークの選択と料金 | `examples/41-fargate/infra/lib/fargate-stack.ts`、`infra/test/fargate-stack.test.ts`、`examples/11-network/src/config.ts` | `test:unit`、`net:plan` |
| ECS Exec | `examples/41-fargate/infra/lib/fargate-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`src/commands.ts`、`infra/test/fargate-stack.test.ts` | `fargate:exec`、`test:unit` |
| 手元で確かめる | `examples/41-fargate/test/`、`scripts/bundle.ts`、`scripts/check-bundle.ts`、`Dockerfile` | `test:unit`、`fargate:bundle:check`、`fargate:infra:synth` |
| デプロイする | `examples/41-fargate/infra/bin/app.ts`、`scripts/image.ts`、`scripts/task.ts`、`tools/src/infra/` | `fargate:infra:diff`、`fargate:infra:deploy`、`fargate:image:build`、`fargate:image:push`、`fargate:infra:drift` |
| 料金 | `examples/41-fargate/src/cost.ts`、`src/breakeven.ts`、`test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `fargate:infra:deploy`、`fargate:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13。12章と 08章で確認した出典は、それぞれの章に確認日があります）

- Fargate の土台: [Architect for AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)、[Fargate platform versions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform-fargate.html)、[Linux platform version change log](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform-versions-changelog.html)、[Task retirement and maintenance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-maintenance.html)、[Prepare for task retirement](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/prepare-task-retirement.html)
- 大きさ: [Task definition differences for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)（表と SOCI）、[Fargate task ephemeral storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)、[EphemeralStorage](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_EphemeralStorage.html)、[Task definition parameters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)、[Troubleshooting OutOfMemoryError](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/out-of-memory.html)
- メトリクス: [Amazon ECS CloudWatch metrics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/available-metrics.html)、[Container Insights metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-metrics-ECS.html)、[enhanced observability metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-enhanced-observability-metrics-ECS.html)、[Container Insights for ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-container-insights.html)、[Amazon CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/)
- Spot と strategy: [Amazon ECS clusters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)、[CapacityProviderStrategyItem](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CapacityProviderStrategyItem.html)、[AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)
- auto scaling: [Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)、[Use a target metric](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)、[scheduled actions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-schedulescaling.html)、[Optimizing service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-autoscaling-best-practice.html)、[task scale-in protection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html)、[How target tracking scaling works](https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html)、[PredefinedMetricSpecification](https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html)
- サービスではないタスク: [standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)、[Using EventBridge Scheduler to schedule Amazon ECS tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html)、[EcsParameters](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_EcsParameters.html)、[RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html)、[task state change events](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_task_events.html)
- ネットワーク: [Amazon ECS interface VPC endpoints](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/vpc-endpoints.html)、[Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)、[image pull behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-pull-behavior.html)
- 運用: [ECS Exec](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html)、[task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)、[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)、[Secrets Manager secrets through environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[HealthCheck](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_HealthCheck.html)、[LogConfiguration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_LogConfiguration.html)、[FireLens](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html)
- 上限: [Amazon ECS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ecs-service.html)、[AWS Fargate throttling quotas](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/throttling.html)
- 料金: [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)、[What are Savings Plans?](https://docs.aws.amazon.com/savingsplans/latest/userguide/what-is-savings-plans.html)、AWS Price List bulk API の [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json)（エフェメラルストレージ。Spot の単価は無い）と [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)。Fargate、ALB、Lambda、HTTP API、EC2、NAT Gateway、エンドポイント、パブリック IPv4 アドレスの単価は、それぞれの章で取得したもの
- Cloudflare Containers: [Limits and Instance Types](https://developers.cloudflare.com/containers/platform-details/limits/)、[Scaling and Routing](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing/)、[FAQ](https://developers.cloudflare.com/containers/faq/)、[Cron container](https://developers.cloudflare.com/containers/examples/cron/)
- Vercel: [Does Vercel support Docker deployments?](https://vercel.com/kb/guide/does-vercel-support-docker-deployments)、[Vercel Functions Limits](https://vercel.com/docs/functions/limitations)、[Cron Jobs](https://vercel.com/docs/cron-jobs)
- cdkd v0.296.28: [src/provisioning/register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、`providers/ecs-provider.ts`、`providers/scheduler-schedule-provider.ts`、`unsupported-types.generated.ts`
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（synth を実行して観察）

:::
