---
title: "12 Containers: デプロイ"
---

# 12 Containers: デプロイ

## デプロイする

<!-- section: 12.deploy -->

このページの途中から、時間課金が始まります。手順は順番に意味があるので、1 つずつ進めてください。

最初に、11章の VPC をデプロイします。既定の構成なら料金はかかりません。

```bash
vp run net:infra:deploy
```

次に、タグなしでデプロイします。リポジトリだけができます。

```bash
vp run ecs:infra:deploy
```

イメージを作ってプッシュします。Docker のデーモンが必要なのは、この手順です。

```bash
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

`ecs:image:push` は、スタックの output からリポジトリの URI を読み、`aws ecr get-login-password` の出力を標準入力で `docker login` に渡してから、タグを付けてプッシュします。ログインの有効期間は 12 時間です。

最後に、タグを付けてデプロイします。**このデプロイから課金されます。**

```bash
vp run ecs:infra:diff -c imageTag=v1
vp run ecs:infra:deploy -c imageTag=v1
```

この本のデプロイ用のコマンドは cdkd に `--full-wait` を渡しているので、サービスが安定するまで待ちます。cdkd のドキュメントによると、ALB が使えるようになるまでに 90〜180 秒かかり、サービスの待ち時間の上限は 600 秒です。終わると、`ServiceUrl` に `http://xxxx.ap-northeast-1.elb.amazonaws.com` の形の URL が表示されます。

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
vp run ecs:watch
vp run ecs:logs
```

`x-app-version: v1` が返ってくれば、リクエストはイメージの中のサーバーまで届いています。

続けて、サービスを止めずに v2 へ入れ替えます。`ecs:watch` を別のターミナルで動かしたまま、次のコマンドを実行してください。

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run ecs:infra:deploy -c imageTag=v2
```

11章と同じく、`-c` はその 1 回のコマンドにしか効きません。`-c imageTag=...` を付け忘れてデプロイすると、ALB とタスクが削除されます。時間課金を止める方法としては便利ですが、意図せず実行するとサービスが止まります。`diff` にも同じ `-c` を付けて、変更を先に確認してください。

ドリフトの検査は、02章と同じです。

```bash
vp run ecs:infra:drift
```

この節のコマンドは、まだ実際の AWS で通せていません。11章が「12章を書くときに最初に通す場所」と書いた、別のアプリのスタックから `Fn::ImportValue` で VPC を読む経路も、未確認のままです。

cdkd の動きにも、わかっていない点が 1 つあります。タスク定義が変わると、cdkd は新しいリビジョンを登録し、サービスを更新して、古いリビジョンを登録解除します。circuit breaker がロールバックしたときに、`--full-wait` の待ちが成功と失敗のどちらを報告するのかは、ソースからは読み取れませんでした。ロールバック先のリビジョンは、cdkd の手順の中で登録解除される側です。壊れたイメージをデプロイしたあとは、cdkd の表示だけで判断せず、`aws ecs describe-services` で `rolloutState` を確認してください。
