---
title: "17 AI: デプロイ"
---

# 17 AI: デプロイ

[手元で動かした](/ja/chapters/17-ai/local.md) API を Lambda にのせて、function URL から呼びます。権限、関数、URL の順に定義を見てから、デプロイします。

## AWS にのせる準備

<!-- section: 17.infra -->

Lambda のハンドラーは次のとおりです。

<<< @/examples/17-ai/src/lambda.ts{handler}

04章の `handleApiGateway` が、この章の `streamFunctionUrl` に変わっています。04章のアダプターは、`Response` の本文を最後まで読み、1 つのオブジェクトにして返します。これでは、できた分から順には送れません。

レスポンスストリーミングでは、Lambda が関数に、書き込み先のストリームを渡します。そのための関数は `awslambda` というグローバルにあります。Lambda の Node.js ランタイムが用意するもので、import するものはなく、Lambda の外には存在しません。この章が使うのは、次の 2 つです。

<<< @/examples/17-ai/src/function-url.ts{awslambda}

`streamifyResponse` は、結果を返す代わりにストリームへ書くハンドラーであることを、ランタイムに伝えます。`HttpResponseStream.from` は、ステータスコードとヘッダーを本文より先に渡すためのものです。`awslambda` の型は `@types/aws-lambda` にもありますが、先に渡すオブジェクトの中身までは書かれていないので、使う部分の型をここに書いています。

アダプターは次のとおりです。

<<< @/examples/17-ai/src/function-url.ts{stream-function-url}

function URL が関数に渡すイベントは、04章の HTTP API と同じ形（payload format 2.0）です。そのため、`Request` への変換には 04章の `toRequest` をそのまま使っています。違うのは返し方です。ステータスコードとヘッダーを先に渡し、本文は `pipeline` でレスポンスストリームへ流します。`pipeline` は Lambda のドキュメントが勧めている書き方で、書き込み先が詰まっていれば待ち、最後にストリームを閉じます。

このアダプターのテスト（`test/function-url.test.ts`）は、`awslambda` の代わりになるオブジェクトを渡して実行しています。確かめているのは、アダプターが何を渡し、何を書き込むかまでです。本物のランタイムがそれをどう送るかは、デプロイしていないので確かめていません。

### 権限

<<< @/examples/17-ai/infra/lib/ai-stack.ts{role}

`ConverseStream` を呼ぶのに必要なアクションは `bedrock:InvokeModelWithResponseStream` です。API の名前とアクションの名前が違うので、最初は戸惑うところです。`Converse` に必要なアクションは `bedrock:InvokeModel` ですが、この関数は `Converse` を呼ばないので、付けていません。

対象は、[実行ロールに書く ARN](/ja/chapters/17-ai.md) で求めた profile と、行き先のモデルだけです。モデルには条件を付けて、この profile を通した呼び出しだけを許可しています。テストは、アクションがこの 1 つだけであることと、対象に `*` がないことを確かめています。

### 関数

<<< @/examples/17-ai/infra/lib/ai-stack.ts{function}

`timeout` は、手元の開発サーバーと動作が最も違うところに関わります。

Lambda のドキュメントには、ストリーミングのレスポンスは呼び出した側の接続が切れても中断されず、関数の実行時間のすべてに課金される、と書かれています。

手元の開発サーバーでは、切断すると `cancelled` になりました。Lambda の上で同じことが起こるとは限りません。この章のアダプターは、レスポンスストリームへの書き込みが失敗すると本文を中止し、アプリはそれを受けてモデルへのリクエストを中止します。テストでは、書き込みを失敗させてこの流れを確かめています。しかし、呼び出し元が切断したときに Lambda の上で書き込みが失敗するかどうかは、確かめられていません。ドキュメントが「中断されない」と書いている以上、Lambda の上では、呼び出し元がいなくなっても、モデルは最後まで書き続けるものと考えておきます。

モデルを止めるものは 3 つあります。`maxTokens`（出力の上限）、アプリの締め切り（30 秒）、関数の `timeout`（40 秒）です。関数の `timeout` を締め切りより長くしてあるのは、アプリが `error` イベントを送って終わる時間を残すためで、この大小関係はテストが見張っています。

3 つとも、1 回の呼び出しに対する歯止めです。同時に何件動くか、月に何回呼ばれるかは、止めていません。署名を通ったスクリプトがループに入った場合、頼れるのはアカウントの Bedrock のクォータだけで、その値はこの本ではわかりません。

そこで、同時に動く数の上限を、指定したときだけ付けられるようにしてあります。

<<< @/examples/17-ai/infra/lib/ai-stack.ts{reserved}

```bash
vp run ai:infra:deploy -c reservedConcurrency=2
```

`reservedConcurrency` は、Lambda の予約済み同時実行数を設定します。2 にすると、要約が同時に動くのは 2 件までになり、3 件目は、Lambda が関数を動かさずに断ります。

既定で付けていないのは、付けただけでデプロイが失敗する場合があるからです。予約済み同時実行数を付けることは、アカウント全体の同時実行数から N を取り分ける操作です。新しいアカウントは全体の上限が低いことがあり、予約しただけでデプロイが失敗しえます。予約できるのは、アカウントの同時実行数のクォータから 100 を引いた数までです（[32章](/ja/chapters/32-limits.md)）。あなたのアカウントのクォータはこの本からはわからないので、指定されたときだけ付けることにしました。自分 1 人が手で試している間は、付けなくて構いません。別のバックエンド、定期実行、CI など、自分以外のものに呼ばせる前に付けてください。

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
