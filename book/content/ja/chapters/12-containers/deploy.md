---
title: "12 Containers: デプロイ"
---

# 12 Containers: デプロイ

## デプロイする

<!-- section: 12.deploy -->

ここからは時間課金が始まります。順番が大事なので、1 つずつ。

まず 11章の VPC。既定の構成で、これは無料です。

```bash
vp run net:infra:deploy
```

次に、tag なしで deploy します。repository だけができます。

```bash
vp run ecs:infra:deploy
```

image を作って、push します。Docker の daemon が要るのはここです。

```bash
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

`ecs:image:push` は、stack の output から repository の URI を読み、`aws ecr get-login-password` の出力を `docker login` に標準入力で渡してから、tag を付けて push します。login の有効期間は 12 時間です。

そして、tag を付けて deploy。**ここから課金されます。**

```bash
vp run ecs:infra:diff -c imageTag=v1
vp run ecs:infra:deploy -c imageTag=v1
```

この本の deploy タスクは cdkd に `--full-wait` を渡しているので、service が安定するまで待ちます。cdkd のドキュメントによると、ALB が使えるようになるまでに 90〜180 秒、service の待ち時間は上限 600 秒です。終わると `ServiceUrl` に `http://xxxx.ap-northeast-1.elb.amazonaws.com` の形の URL が出ます。

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
vp run ecs:watch
vp run ecs:logs
```

`x-app-version: v1` が返ってくれば、image の中のサーバーまで届いています。

次は、止めずに入れ替えます。`ecs:watch` を別のターミナルで動かしたまま、どうぞ。

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run ecs:infra:deploy -c imageTag=v2
```

気をつけたいのは、11章と同じで、`-c` はその 1 回のコマンドにしか効かないことです。`-c imageTag=...` を付け忘れて deploy すると、ALB と task は消える変更として現れます。止め方としては便利ですが、うっかりやると止まります。`diff` にも同じ `-c` を付けて、先に見てください。

drift の検査は、02章と同じです。

```bash
vp run ecs:infra:drift
```

正直に言うと、この節のコマンドは、まだ実際の AWS で通せていません。11章が「12章を書くときに最初に通す場所」と書いた、別のアプリの stack から `Fn::ImportValue` で VPC を読む経路も、未確認のままです。もう 1 つ、わかっていないことがあります。task definition が変わると、cdkd は新しい revision を登録し、service を更新して、古い revision を登録解除します。circuit breaker が rollback したとき、`--full-wait` の待ちが成功と失敗のどちらを報告するのかは、ソースからは読み取れませんでした。rollback 先の revision は、cdkd の手順の中で登録解除される側です。壊れた image を deploy したあとは、cdkd の表示だけで判断せず、`aws ecs describe-services` で `rolloutState` を見てください。
