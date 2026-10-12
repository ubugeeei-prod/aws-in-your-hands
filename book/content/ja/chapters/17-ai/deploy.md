---
title: "17 AI: デプロイ"
---

# 17 AI: デプロイ

## AWS にのせる準備

<!-- section: 17.infra -->

Lambda の handler です。

<<< @/examples/17-ai/src/lambda.ts{handler}

04章の `handle` が `streamHandle` に変わりました。Hono の Lambda 用の adapter で、応答の body を、Lambda の response stream へ書き出してくれます。この本が固定している hono 4.13.13 に入っていることは、型定義とソースで確かめました。ソースには「`hono/aws-lambda` は v5 でなくなる。`@hono/aws-lambda` へ」という非推奨の印も付いています。版を上げるときに思い出してください。

### 権限

<<< @/examples/17-ai/infra/lib/ai-stack.ts{role}

`ConverseStream` を呼ぶのに要る action は `bedrock:InvokeModelWithResponseStream` です。API の名前と action の名前が違うので、最初は戸惑います。`Converse` のほうは `bedrock:InvokeModel`。この関数は `Converse` を呼ばないので、付けていません。

対象は、さっきの profile と、行き先のモデルだけ。モデルのほうには条件を付けて、「この profile を通したときだけ」に絞っています。テストは、action がこの 1 つだけであること、対象に `*` がないことを見ています。

### 関数

<<< @/examples/17-ai/infra/lib/ai-stack.ts{function}

`timeout` の話をします。ここが、手元と一番違うところです。

Lambda のドキュメントには、こう書いてあります。streaming の応答は、呼び出した側の接続が切れても中断されない。課金は関数の実行時間ぶんすべて。

手元の開発サーバーでは、切断すると `cancelled` になりましたよね。Lambda ではそうならない、ということです。Hono の `streamHandle` のソースを読んでも、書き込みの失敗を応答の body の中止につなぐ処理はありませんでした。なので Lambda の上では、呼び出し元がいなくなっても、モデルは最後まで書き続けると考えておきます。

止めてくれるのは 3 つ。`maxTokens`（出力の上限）、アプリの締め切り（30 秒）、そして関数の `timeout`（40 秒）です。関数の `timeout` を締め切りより長くしてあるのは、アプリが `error` イベントを送って終わる時間を残すため。テストがこの大小関係を見張っています。

この 3 つは、どれも「1 回の呼び出し」の歯止めです。同時に何件動くか、月に何回呼ばれるかは、止めていません。署名を通った script が loop に入ったら、頼れるのはアカウントの Bedrock の quota だけで、その値はこの本ではわかりません。

そこで、同時に動く数の上限を、頼んだときだけ付けられるようにしてあります。

<<< @/examples/17-ai/infra/lib/ai-stack.ts{reserved}

```bash
vp run ai:infra:deploy -c reservedConcurrency=2
```

Lambda の reserved concurrency です。2 にすると、要約が同時に動くのは 2 件まで。3 件目は、Lambda が関数を動かさずに断ります。

既定で付けていないのには、理由があります。予約は、アカウント全体の同時実行数から N を取り分ける操作です。新しいアカウントは、その全体の上限が低いことがあり、予約しただけでデプロイが失敗しえます。ここではそれを確かめられないので、頼まれたときだけにしました。自分 1 人が手で試すあいだは、付けなくて構いません。自分以外の何か（別のバックエンド、定期実行、CI）に呼ばせる前に、付けてください。

### URL

<<< @/examples/17-ai/infra/lib/ai-stack.ts{url}

`AWS_IAM` と `RESPONSE_STREAM`。stack には `AWS::Lambda::Permission` が 1 つもありません。誰かに呼ぶ権利を渡す resource-based policy を作っていない、という意味です。これもテストで固定しています。

## デプロイして呼ぶ

<!-- section: 17.deploy -->

```bash
vp run ai:infra:diff
vp run ai:infra:deploy
```

終わると、`FunctionUrl` に `https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/` の形の URL が出ます。

この URL は `curl` では呼べません。署名が要るからです。

<<< @/examples/17-ai/scripts/sign.ts{sign}

```bash
vp run ai:smoke
vp run ai:logs
```

`ai:smoke` は課金されます。まず署名なしで呼んで、拒否されることを確かめます。次に署名付きで呼んで、要約を受け取ります。`delta` が届いた時刻も表示します。最初の `delta` と最後の `delta` が同じ時刻なら、経路のどこかが応答を溜め込んでいます。streaming は、サーバーが少しずつ書くだけでは成立しません。間にいる全員が、溜めずに流してくれて初めて成立します。

アウトラインにあった「CDN とブラウザを通した確認」は、この章の構成には CDN もブラウザもないので、やっていません。

モデルを替えるなら、こうです。

```bash
vp run ai:infra:deploy -c modelId=global.amazon.nova-2-lite-v1:0
```

drift の検査は 02章と同じです。

```bash
vp run ai:infra:drift
```
