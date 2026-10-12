---
title: "12 Containers: 手元で動かす"
---

# 12 Containers: 手元で動かす

## 手元で確かめる

<!-- section: 12.local -->

前の 2 ページに出てきたもののうち、Docker も AWS も使わずに確かめられるものは、次の 4 つのコマンドで実行できます。

```bash
vp run test:unit
vp run ecs:bundle:check
vp run ecs:infra:synth
vp run ecs:infra:synth -c imageTag=v1
```

テストは、次の 4 つの対象を見ています。

| 対象 | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| プロセス | `test/shutdown.test.ts` | SIGTERM で進行中のリクエストを終えてから終了すること | コンテナの中でのシグナルの届き方、ECS が送る順序 |
| 新旧の版 | `test/versions.test.ts` | 新旧が同じレコードを読めること、壊れる 2 つの書き方 | 実際のデータストア、ALB の振り分け |
| 設定と時間 | `test/timing.test.ts`、`test/config.test.ts`、`test/compose.test.ts` | 秒数どうしの関係、タグの検証、`docker` コマンドの組み立て | その値で実際に 502 が出ないこと |
| インフラ | `infra/test/containers-stack.test.ts` | 権限、入口、入れ替えの設定、タグなしなら時間課金のリソースが無いこと | AWS がテンプレートどおりに動くこと |

次のものは、手元では再現できません。

- イメージのビルドと、コンテナとしての起動
- Fargate がイメージを取得できるかどうか（経路と権限）
- ALB の振り分けとヘルスチェック
- ローリングアップデート、circuit breaker、auto scaling の実際の動き
- cdkd がテンプレートのとおりにリソースを作れること

cdkd については、固定した版（0.296.28）のソースを読みました。このスタックが使う 15 種類のリソースのうち 12 種類（ECS のクラスター、タスク定義、サービス、ALB、リスナー、ターゲットグループ、ECR のリポジトリ、セキュリティグループとその ingress、IAM のロールとポリシー、ロググループ）には、cdkd が専用の実装を持っています。残りの 3 種類、`AWS::ApplicationAutoScaling::ScalableTarget`、`AWS::ApplicationAutoScaling::ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は、Cloud Control API を経由します。テストは、リソースの種類の一覧と、専用の実装が扱うプロパティだけを使っていることを固定しています。
