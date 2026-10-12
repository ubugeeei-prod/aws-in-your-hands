---
title: "41 Fargate: 手元で動かす"
---

# 41 Fargate: 手元で動かす

## 手元で確かめる

<!-- section: 41.local -->

この章のうち、Docker も AWS も使わずに確かめられるものは、次のコマンドで実行できます。

```bash
vp run test:unit
vp run fargate:size --cpu 180 --memory 410
vp run fargate:simulate
vp run dev:fargate:job
vp run fargate:bundle:check
vp run fargate:infra:synth
vp run fargate:infra:synth -c imageTag=f1
vp run fargate:infra:synth -c imageTag=f1 -c exec=true
```

`dev:fargate:job` は、ジョブを手元の Node.js でそのまま動かします。途中で Ctrl-C を押すと、Spot の中断と同じ経路を通って、次に処理するはずだった番号をログに出し、終了コード 75 で終わります。続きは、環境変数で渡します。

```bash
JOB_START_AT=12 vp run dev:fargate:job
```

`fargate:bundle:check` は、イメージに入れる 2 つのファイル（`server.mjs` と `job.mjs`）を作り、`node_modules` の無い場所で起動します。サーバーが応答して SIGTERM で終了コード 0 になること、ジョブが完走して 0 になること、中断されて 75 になることを確かめます。

テストが見ているものと、見ていないものは次のとおりです。

| 対象 | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| 大きさ | `test/sizes.test.ts` | 表の行数と境目、計った最大値が余裕つきで収まるいちばん安い組み合わせ | 表が今日も同じであること、実際のタスクの使用量 |
| 置き場所 | `test/strategy.test.ts` | strategy の決まり、最低限のタスクが必ずオンデマンドに置かれること | ECS が実際にどう丸めて配置するか、Spot に空きがあるか |
| 増減 | `test/scaling.test.ts` | モデルの中での遅れ、cooldown、上限、止められるタスクが抱えるリクエストの行方 | Application Auto Scaling の実際の判断、アラームが動くまでの時間 |
| 中断 | `test/spot.test.ts`、`test/job.test.ts` | SIGTERM を受けたサーバーとジョブの振る舞い、秒数が 2 分に収まること | Spot の中断のときに ALB からの登録解除と SIGTERM のどちらが先か |
| コマンド | `test/commands.test.ts` | `run-task` と `execute-command` の引数の組み立て | そのコマンドが AWS で通ること |
| 料金 | `test/pricing.test.ts` | 本文の金額が、料金データからの計算と一致すること | Spot の単価、請求書 |
| インフラ | `infra/test/fargate-stack.test.ts` | strategy の base、2 つのポリシー、権限に `*` が増えていないこと、ECS Exec が既定で切れていること、リソースの種類 | AWS がテンプレートどおりに動くこと |

増減のテストについては、もう一度断っておきます。`src/scaling.ts` は、ドキュメントに書かれた動きをこの章が写したモデルです。テストが確かめているのは、モデルがモデル自身の決まりを守っていることで、Application Auto Scaling がそのとおりに動くことではありません。モデルの価値は、起動の時間や目標値を変えたときに、何がどちらへ動くかを先に考えられることにあります。

次のものは、手元では再現できません。

- イメージのビルドと、コンテナとしての起動。この本の devShell には Docker のデーモンがありません
- capacity provider strategy による実際の配置、Spot の中断、タスクのリタイア
- target tracking の実際の増減と、スケールインのときの ALB の動き
- Scheduler からの RunTask と、その再試行
- ECS Exec のセッション
- cdkd がテンプレートのとおりにリソースを作れること

cdkd については、固定した版（0.296.28）のソースを読みました。このスタックが使う 16 種類のリソースのうち 13 種類には、cdkd が専用の実装を持っています。ECS のクラスター、タスク定義、サービスの実装は、クラスターの `CapacityProviders`、サービスの `CapacityProviderStrategy` と `EnableExecuteCommand` を扱います。`AWS::Scheduler::Schedule` の実装は、`Target` の中の `EcsParameters` とタイムゾーンを扱います。残りの 3 種類、`AWS::ApplicationAutoScaling::ScalableTarget`、`AWS::ApplicationAutoScaling::ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は、12章と同じく Cloud Control API を経由します。テストは、リソースの種類の一覧と、専用の実装が扱うプロパティだけを使っていることを固定しています。
