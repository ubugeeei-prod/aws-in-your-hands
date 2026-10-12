---
title: "41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec"
revision: 1
---

# 41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec

[12章](/ja/chapters/12-containers.md)は、ノート API のコンテナを Fargate で 2 つ動かし、止めずに入れ替えるところまで進みました。この章は、その続きです。サービスが動き始めたあとでチームが決めることを、順に扱います。タスクの大きさ、割引された容量（Fargate Spot）をどこまで使うか、タスクの数を何で増減させるか、サービスではないタスクをどう動かすか、動いているコンテナの中をどうやって見るか、の 5 つです。

12章と同じく、この章のスタックは置いてあるだけで料金がかかります。**イメージのタグを付けてデプロイしている間は、誰も呼ばなくても 1 時間におよそ USD 0.069、1 日で USD 1.65、1 か月置くと USD 50.35 かかります**（東京、既定の構成。内訳は[料金](/ja/chapters/41-fargate/wrap.md)にあります）。ALB と、オンデマンドのタスク 2 つと、パブリック IPv4 アドレス 4 つの料金で、12章の既定の構成とほぼ同じ額です。auto scaling が上限の 6 つまで増やしたまま 1 か月たつと、USD 100.93 を上限として増えます。試し終わったら、その日のうちに[片付け](/ja/chapters/41-fargate/wrap.md)まで進めてください。12章のスタックをまだ動かしているなら、2 つぶんの料金がかかります。先に 12章の側をタグなしに戻してください。

前提は [11章](/ja/chapters/11-network.md)の VPC、[12章](/ja/chapters/12-containers.md)のサーバー、[16章](/ja/chapters/16-long-jobs.md)の長い処理の考え方です。コードは `examples/41-fargate/` にあります。12章のコードは複製せず、workspace の依存として読み込んでいます。

## サービスが動いたあとに決めること

<!-- section: 41.when -->

12章のスタックは、決めるべきことの多くを既定値のままにしていました。タスクは Fargate で選べるいちばん小さい大きさで、すべてオンデマンドで、数は CPU 使用率だけを見て 2 から 4 のあいだを動きます。練習にはそれで足りますが、実際の負荷を受けるサービスでは、どれも根拠を持って決め直すことになります。

この章で扱う判断と、その材料は次のとおりです。

- **タスクの大きさ。** CPU とメモリの組み合わせは、決まった表の中からしか選べません。計った最大値と、残しておく余裕から、表の中でいちばん安い組み合わせを選ぶ関数を書きます
- **どの容量で動かすか。** Fargate Spot は安いかわりに、AWS の都合で 2 分前の予告だけで止められます。サービスの最低限のタスクはオンデマンドに置き、増えたぶんの一部を Spot に回します
- **数を何で増減させるか。** target tracking の動きを手元のモデルで追い、増えるのが間に合わない時間と、減らすときに処理中のリクエストを切らないための条件を確かめます
- **サービスではないタスク。** 夜間に 1 回動いて終わるジョブを、EventBridge Scheduler から同じイメージで起動します
- **動いているコンテナの中を見る手段。** ECS Exec は、コンテキストのフラグを付けたときだけ有効になるようにし、既定では切っておきます

この章で扱わないものもあります。新しい版を一部のリクエストにだけ出す blue/green や canary と circuit breaker は [31章](/ja/chapters/31-progressive-delivery.md)、同じコンテナを Kubernetes で動かす話（EKS の Fargate profile を含む）は [34章](/ja/chapters/34-eks.md)、Lambda の側の調整は [29章](/ja/chapters/29-lambda-tuning.md)と [35章](/ja/chapters/35-lambda-managed-instances.md)が扱います。

サービスがまだ無いなら、この章より先に 12章を読んでください。そして、Lambda で足りているアプリなら、この章の判断はどれも要りません。[料金](/ja/chapters/41-fargate/wrap.md)の節で、どのくらいの負荷から Fargate のほうが安くなるかを計算しています。

## 全体像

<!-- section: 41.architecture -->

```figure
caption: サービスのタスクは 2 つの capacity provider に分かれる。最低限の 2 つはオンデマンドの Fargate に、auto scaling が足したぶんは 1 対 3 で Fargate Spot に置かれる
node client: クライアント
node alb: Application Load Balancer | deregistration delay 30 秒
node od: タスク 2 つ | FARGATE, base 2
node spot: 足されたタスク | FARGATE と FARGATE_SPOT を 1 対 3
node aas: Application Auto Scaling | CPU 60 %, 1 タスク 600 リクエスト/分
node cw: CloudWatch | 1 分ごとのメトリクス
edge client -> alb: HTTP :80
edge alb -> od
edge alb -> spot
edge od --> cw
edge alb --> cw: RequestCountPerTarget
edge cw --> aas: アラーム
edge aas -> spot: desired count 2..6
group svc: ECS service = od, spot
mark aas
```

```figure
caption: 夜間のジョブは、サービスと同じイメージを別のコマンドで動かす単発のタスク。EventBridge Scheduler が RunTask を呼び、タスクは終わると消える
node sch: EventBridge Scheduler | 毎日 03:00 Asia/Tokyo
node role: スケジュール用のロール | ecs:RunTask と iam:PassRole
node job: タスク "job" | node job.mjs, FARGATE_SPOT
node ecr: ECR のリポジトリ | server.mjs と job.mjs
node logs: CloudWatch Logs | 7 日保持
edge sch -> role: AssumeRole
edge sch -> job: RunTask
edge job -> ecr: イメージの取得
edge job -> logs: 進み具合と終了コード
```

12章から変わっていないものを先に確認しておきます。タスクの大きさ（0.25 vCPU、512 MiB、arm64）、ALB とターゲットグループの設定、ヘルスチェックや停止までの秒数は、12章の `TASK` と `timing` をそのまま読み込んでいます。サーバーのコードも 12章のファイルで、この章にあるのは、それを動かす条件を変えるコードだけです。

変わったのは次の値です。

<<< @/examples/41-fargate/src/config.ts{scaling}

タスクの数は 2 から 6 のあいだで動きます。`STRATEGY` は、タスクを置く容量の指定です。`base` を最小の数と同じ 2 にしてあるので、サービスが下回らない 2 つのタスクは、いつでもオンデマンドの Fargate で動きます。この対応は、テストで固定しています。

イメージは、12章のものとは別のリポジトリに置きます。この章のイメージには、12章のサーバー（`server.mjs`）に加えて、夜間のジョブ（`job.mjs`）が入っているからです。12章と同じく、タグを付けずにデプロイするとリポジトリだけができ、時間課金のリソースは作られません。

ノートは、この章でもタスクのメモリの中にあります。タスクが増えれば、ノートが見えたり見えなかったりする度合いも増えます。データをタスクの外に置く話は [05章](/ja/chapters/05-dynamodb.md)と [13章](/ja/chapters/13-sql.md)にあり、この章では扱いません。

## タスクの下にあるもの

<!-- section: 41.underneath -->

Fargate では、タスクを動かすサーバーが見えません。見えないままで構わないのですが、3 つのことは知っておく必要があります。どれも、ある日タスクが止まる理由になるからです。

1 つ目は、タスクごとに環境が分かれていることです。ECS のドキュメントは、Fargate のタスクはそれぞれ独立した境界を持ち、カーネル、CPU、メモリ、ネットワークインターフェースをほかのタスクと共有しないと書いています。イメージの取得についてのページには、タスクは 1 つずつ、使い切りで、ほかの利用者と共有しないインスタンスで動くとあります。この作りには、料金以外の代償があります。前のタスクが取得したイメージを次のタスクが使い回せないので、タスクは起動のたびにイメージ全体を取得します。起動の遅さについては[実装のつづき](/ja/chapters/41-fargate/more.md)で扱います。

2 つ目は、**プラットフォームバージョン**（platform version）です。タスクを動かすカーネルやコンテナランタイムの版を指し、2026-10-13 時点で Linux で選べるのは 1.4.0 だけで、`LATEST` もこの版を指します（1.3.0 は 2026-06-15 に廃止されています）。同じ 1.4.0 の中にも、修正のたびに新しいリビジョンが出ます。動いているタスクが新しいリビジョンに移されることはなく、新しく起動したタスクから新しいリビジョンで動きます。

3 つ目は、そのリビジョンの入れ替えです。新しいリビジョンが出ると、AWS は古いリビジョンで動いているタスクを止めます。これを**タスクのリタイア**（task retirement）と呼びます。予告は AWS Health Dashboard とメールで届き、既定では 7 日後から止め始めます。待つ日数はアカウントの設定 `fargateTaskRetirementWaitPeriod` で 0、7、14 のどれかにでき、断る方法はありません。

リタイアのときに起きることは、タスクの種類で分かれます。

- サービスのタスクは、スケジューラーが置き換えます。12章とこの章の設定（`minimumHealthyPercent` 100、`maximumPercent` 200）なら、新しいタスクを起動して動き出すのを待ってから、古いタスクを止めます。置き換えのタスクを起動できなかった場合は、古いタスクが置き換えなしで止められます
- サービスに属さない単発のタスクは、止められるだけです。代わりは起動されません

サーバーの側に障害があった場合は別で、予告なしに置き換えられます。

つまり、Fargate のタスクは、デプロイも Spot も関係なく、いつか必ず外から止められます。12章で書いた、SIGTERM を受けたら処理中のリクエストを終えてから止まるサーバーは、入れ替えのためだけのものではありません。この章の Spot とスケールインも、同じ仕組みに頼ります。長く動く単発のタスクを作るなら、途中で止められても続きから再開できるようにしておく必要があります。この章のジョブは、その形で書いてあります。
