---
title: "12 Containers: 手元で動かす"
---

# 12 Containers: 手元で動かす

## 手元で確かめる

<!-- section: 12.local -->

ここまで出てきたもののうち、Docker も AWS も要らないものをまとめます。

```bash
vp run test:unit
vp run ecs:bundle:check
vp run ecs:infra:synth
vp run ecs:infra:synth -c imageTag=v1
```

テストは 4 か所を見ています。

| どこ | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| プロセス | `test/shutdown.test.ts` | SIGTERM で進行中のリクエストを終えてから終了すること | コンテナの中での signal の届き方、ECS が送る順序 |
| 版の同居 | `test/versions.test.ts` | 新旧が同じ record を読めること、壊れる 2 つの書き方 | 本物のデータストア、ALB の振り分け |
| 設定と時間 | `test/timing.test.ts`、`test/config.test.ts`、`test/compose.test.ts` | 秒数どうしの関係、tag の検証、`docker` コマンドの組み立て | その値で実際に 502 が出ないこと |
| インフラ | `infra/test/containers-stack.test.ts` | 権限、入口、入れ替えの設定、tag なしなら時間課金のリソースが無いこと | AWS が template どおりに動くこと |

手元で再現しないものも、はっきりさせておきます。

- image の build と、コンテナとしての起動
- Fargate が image を取得できるかどうか（経路と権限）
- ALB の振り分けと health check
- rolling update、circuit breaker、auto scaling の実際の動き
- cdkd が template のとおりにリソースを作れること

cdkd については、固定した版（0.296.28）のソースを読みました。この stack が使う 15 種類のうち 12 種類（ECS の cluster、task definition、service、ALB、listener、target group、ECR の repository、security group とその ingress、IAM の role と policy、log group）は、cdkd が専用の実装を持っています。残りの 3 種類、`AWS::ApplicationAutoScaling::ScalableTarget`、`AWS::ApplicationAutoScaling::ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は、Cloud Control API 経由です。テストは、種類の一覧と、専用の実装が扱う property だけを使っていることを固定しています。
