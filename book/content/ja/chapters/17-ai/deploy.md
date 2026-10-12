---
title: "17 AI: デプロイ"
---

# 17 AI: デプロイ

[手元で動かした](/ja/chapters/17-ai/local.md) API を Lambda にのせて、function URL から呼びます。権限、関数、URL の順に定義を見てから、デプロイします。

## AWS にのせる準備

<!-- section: 17.infra -->

Lambda のハンドラーは次のとおりです。

<<< @/examples/17-ai/src/lambda.ts{handler}

04章の `handle` が `streamHandle` に変わっています。`streamHandle` は Hono の Lambda 用アダプターで、レスポンスの本文を Lambda のレスポンスストリームへ書き出します。この本が固定している hono 4.13.13 に `streamHandle` が入っていることは、型定義とソースで確かめました。ソースには、`hono/aws-lambda` は v5 でなくなり `@hono/aws-lambda` へ移る、という非推奨の印も付いています。版を上げるときに確認してください。

### 権限

<<< @/examples/17-ai/infra/lib/ai-stack.ts{role}

`ConverseStream` を呼ぶのに必要な action は `bedrock:InvokeModelWithResponseStream` です。API の名前と action の名前が違うので、最初は戸惑うところです。`Converse` に必要な action は `bedrock:InvokeModel` ですが、この関数は `Converse` を呼ばないので、付けていません。

対象は、[実行ロールに書く ARN](/ja/chapters/17-ai.md) で求めた profile と、行き先のモデルだけです。モデルには条件を付けて、この profile を通した呼び出しだけを許可しています。テストは、action がこの 1 つだけであることと、対象に `*` がないことを確かめています。

### 関数

<<< @/examples/17-ai/infra/lib/ai-stack.ts{function}

`timeout` は、手元の開発サーバーと動作が最も違うところに関わります。

Lambda のドキュメントには、ストリーミングのレスポンスは呼び出した側の接続が切れても中断されず、関数の実行時間のすべてに課金される、と書かれています。

手元の開発サーバーでは、切断すると `cancelled` になりました。Lambda ではそうならないことになります。Hono の `streamHandle` のソースを読んでも、書き込みの失敗をレスポンス本文の中止につなげる処理はありませんでした。そのため、Lambda の上では、呼び出し元がいなくなっても、モデルは最後まで書き続けるものと考えておきます。

モデルを止めるものは 3 つあります。`maxTokens`（出力の上限）、アプリの締め切り（30 秒）、関数の `timeout`（40 秒）です。関数の `timeout` を締め切りより長くしてあるのは、アプリが `error` イベントを送って終わる時間を残すためで、この大小関係はテストが見張っています。

3 つとも、1 回の呼び出しに対する歯止めです。同時に何件動くか、月に何回呼ばれるかは、止めていません。署名を通ったスクリプトがループに入った場合、頼れるのはアカウントの Bedrock のクォータだけで、その値はこの本ではわかりません。

そこで、同時に動く数の上限を、指定したときだけ付けられるようにしてあります。

<<< @/examples/17-ai/infra/lib/ai-stack.ts{reserved}

```bash
vp run ai:infra:deploy -c reservedConcurrency=2
```

`reservedConcurrency` は、Lambda の reserved concurrency を設定します。2 にすると、要約が同時に動くのは 2 件までになり、3 件目は、Lambda が関数を動かさずに断ります。

既定で付けていないのは、付けただけでデプロイが失敗する場合があるからです。reserved concurrency の予約は、アカウント全体の同時実行数から N を取り分ける操作です。新しいアカウントは全体の上限が低いことがあり、予約しただけでデプロイが失敗しえます。ここではそれを確かめられないので、指定されたときだけ付けることにしました。自分 1 人が手で試している間は、付けなくて構いません。別のバックエンド、定期実行、CI など、自分以外のものに呼ばせる前に付けてください。

### URL

<<< @/examples/17-ai/infra/lib/ai-stack.ts{url}

認証は `AWS_IAM`、呼び出しのモードは `RESPONSE_STREAM` です。スタックには `AWS::Lambda::Permission` が 1 つもありません。呼ぶ権利を誰かに渡すリソースベースのポリシーを作っていない、ということです。この点もテストで固定しています。

## デプロイして呼ぶ

<!-- section: 17.deploy -->

```bash
vp run ai:infra:diff
vp run ai:infra:deploy
```

デプロイが終わると、出力の `FunctionUrl` に、`https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/` の形の URL が表示されます。

この URL は署名が必要なので、`curl` では呼べません。署名は次のコードで付けます。

<<< @/examples/17-ai/scripts/sign.ts{sign}

```bash
vp run ai:smoke
vp run ai:logs
```

`ai:smoke` は課金されます。最初に署名なしで呼んで拒否されることを確かめ、次に署名付きで呼んで要約を受け取ります。`delta` が届いた時刻も表示するので、最初の `delta` と最後の `delta` が同じ時刻なら、経路のどこかがレスポンスを溜め込んでいるとわかります。ストリーミングは、サーバーが少しずつ書くだけでは成り立ちません。途中にあるものすべてが、溜めずに流して初めて成り立ちます。

執筆前のアウトラインにあった「CDN とブラウザを通した確認」は、この章の構成に CDN もブラウザもないので、していません。

モデルを替えるときは、`modelId` を指定してデプロイします。

```bash
vp run ai:infra:deploy -c modelId=global.amazon.nova-2-lite-v1:0
```

ドリフトの検査は 02章と同じです。

```bash
vp run ai:infra:drift
```
