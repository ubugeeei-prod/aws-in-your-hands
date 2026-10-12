---
title: "41 Fargate: デプロイ"
---

# 41 Fargate: デプロイ

## デプロイする

<!-- section: 41.deploy -->

このページの手順は、実際の AWS では一度も通していません。コマンドと順序は、12章の手順と、固定した版の cdkd のソースから組み立てたものです。途中から時間課金が始まるので、1 つずつ進めてください。

12章のスタックにサービスが残っているなら、先にタグなしへ戻します。同じ形のサービスを 2 つ動かす理由はありません。

```bash
vp run ecs:infra:deploy
```

11章の VPC が無ければ、デプロイします。既定の構成なら料金はかかりません。

```bash
vp run net:infra:deploy
```

この章のスタックを、タグなしでデプロイします。リポジトリだけができます。

```bash
vp run fargate:infra:deploy
```

イメージを作ってプッシュします。Docker のデーモンが必要なのは、この手順です。タグは、12章のイメージ（`v1`、`v2`）と手元で重ならないように、`f1` のような別の名前にします。

```bash
vp run fargate:bundle
vp run fargate:image:build f1
vp run fargate:image:push f1
```

タグを付けてデプロイします。**このデプロイから課金されます。**

```bash
vp run fargate:infra:diff -c imageTag=f1
vp run fargate:infra:deploy -c imageTag=f1
```

終わると、`ServiceUrl` に ALB の URL が表示されます。12章と同じ確認ができます。

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
```

タスクがどの容量で動いているかは、タスクの `capacityProviderName` に出ます。既定の 2 つは、どちらも `FARGATE` のはずです。auto scaling の設定と、Application Auto Scaling が作ったアラームも確かめておきます。アラームの名前はポリシーの `Alarms` に出ます。そのアラームの `EvaluationPeriods` と `Period` が、モデルで仮定にしていた「何分で動くか」の実際の値です。

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
aws ecs describe-tasks --cluster <ClusterName> --tasks <task id> --region ap-northeast-1 --query "tasks[].capacityProviderName"
aws application-autoscaling describe-scaling-policies --service-namespace ecs --region ap-northeast-1
aws cloudwatch describe-alarms --alarm-names <AlarmName> --region ap-northeast-1
```

ジョブは、毎日 03:00（日本時間）に起動されます。待たずに確かめるなら、単発で動かします。この 1 回にも、最低 1 分ぶんの料金がかかります。

```bash
vp run fargate:job:run
vp run fargate:job:run --start-at 12 --on-demand
```

表示された ARN のタスクが止まったら、終了コードを確かめます。0 なら完走、75 なら途中で止められています。

```bash
aws ecs describe-tasks --cluster <ClusterName> --tasks <task id> --region ap-northeast-1 --query "tasks[].{stopCode: stopCode, reason: stoppedReason, exit: containers[0].exitCode}"
```

ECS Exec を試すなら、フラグを付けてデプロイし直します。タスクはすべて入れ替わり、コンテナのルートファイルシステムは書き込めるようになります。確かめ終わったら、フラグなしでデプロイし直して元に戻してください。

```bash
vp run fargate:infra:diff -c imageTag=f1 -c exec=true
vp run fargate:infra:deploy -c imageTag=f1 -c exec=true
vp run fargate:exec <task id>
vp run fargate:infra:deploy -c imageTag=f1
```

`-c` は、その 1 回のコマンドにしか効きません。12章と同じく、`-c imageTag=...` を付け忘れてデプロイすると、ALB とタスクが削除されます。`-c exec=true` を付け忘れると、ECS Exec が切れた状態に戻ります。こちらは安全な側への戻り方です。

ドリフトの検査は、02章と同じです。

```bash
vp run fargate:infra:drift
```

auto scaling が動いているサービスでは、ドリフトの見え方に注意が要ります。Application Auto Scaling はサービスの desired count を書き換えるので、テンプレートの 2 と実際の数が食い違います。この食い違いは、意図どおりの動きです。デプロイし直したときに数が 2 に戻されるかどうかは、12章でも確かめられていない点で、この章でも未確認のままです。
