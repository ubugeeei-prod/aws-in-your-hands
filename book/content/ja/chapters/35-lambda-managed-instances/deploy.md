---
title: "35 Lambda Managed Instances: デプロイ"
---

# 35 Lambda Managed Instances: デプロイ

このページのコマンドは、実機ではまだ一度も実行していません。手順は、Lambda のガイドと、固定した版の CDK と cdkd の中身から組み立てたものです。

## デプロイと動作確認

<!-- section: 35.deploy -->

デプロイする前に、IAM の権限を確かめます。デプロイする identity には、いつもの権限のほかに 2 つが要ります。関数をキャパシティプロバイダーに載せるための `lambda:PassCapacityProvider` と、アカウントで最初のキャパシティプロバイダーを作るときにサービスリンクロールを作るための `iam:CreateServiceLinkedRole` です。

順番は、先に 11章の VPC、次にこの章のスタックです。

```bash
vp run lmi:plan
vp run net:infra:deploy -c interfaceEndpoints=logs
vp run lmi:infra:diff
vp run lmi:infra:deploy
```

2 行目から、時間単位の課金が始まります。11章のネットワークをほかの章のためにすでにデプロイしているなら、そのときのエンドポイントに `logs` を足して指定してください。23章と一緒に使うなら `-c interfaceEndpoints=ssm,ssmmessages,ec2messages,logs` です。

4 行目には時間がかかります。ガイドによると、Lambda はインスタンスを 3 台起動し、実行環境を 3 つ立ち上げてから、関数のバージョンを ACTIVE にします。これにふつう数分かかると書かれています。cdkd がこの待ち時間をどう扱うかは確かめていません。

デプロイが終わったら、動作を確かめます。

```bash
vp run lmi:smoke
```

<<< @/examples/35-lambda-managed-instances/scripts/smoke.ts

04章のクライアントで `/health` を呼び、ノートを 1 つ作って読み返し、最後に 10 件のリクエストを同時に送ります。作ったノートの読み返しは 404 になることがあります。別のワーカースレッドか、別の実行環境が答えたときです。スクリプトはこれを失敗として扱いません。

同時に送った 10 件は、すべて 200 で返り、リクエスト ID がすべて違うことを確かめます。これが通っても、同じ実行環境で重なったことの証明にはなりません。重なりを見るには、CloudWatch のメトリクスを使います。名前空間は `AWS/Lambda` で、ディメンションに `CapacityProviderName` を指定します。メトリクスは 1 分ごとに出るので、デプロイの直後には見えません。

ログは 2 か所に出ます。関数のログは、スタックの出力 `HandlerLogGroupName` のロググループです。インスタンスの起動や終了といったキャパシティプロバイダーのシステムログは、`CapacityProviderLogGroupName` のロググループです。関数は動いているのにログが 1 行も出ないなら、インスタンスから CloudWatch Logs への経路がありません。

インスタンスそのものは、EC2 のコンソールにも `describe-instances` の結果にも、既定では出てきません。Lambda が管理するインスタンスは、managed resource visibility の設定を変えるまで隠れています。見えなくても動いていて、課金もされています。

ドリフトは、ほかの章と同じように調べます。

```bash
vp run lmi:infra:drift
```

Cloud Control API 経由で作ったリソースを cdkd がどこまで比べられるかは、この章では確かめていません。

設定を変えるときは、何が作り直しになるかを先に見ます。CloudFormation のリファレンスによると、キャパシティプロバイダーのサブネット、セキュリティグループ、オペレーターロール、インスタンスの条件、名前は、変更すると置き換えになります。置き換えの間、関数がどうなるかは確かめていません。vCPU の上限とスケーリングの設定は、置き換えなしで変えられます。

関数を消さずに止めるには、実行環境を 0 にしてデプロイします。

```bash
vp run lmi:infra:deploy -c minExecutionEnvironments=0 -c maxExecutionEnvironments=0
```

止めた関数は、リクエストが来ても自動では戻りません。戻すには、`-c` を外してもう一度デプロイします。
