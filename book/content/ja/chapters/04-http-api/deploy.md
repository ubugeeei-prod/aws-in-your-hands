---
title: "04 HTTP API: デプロイ"
---

# 04 HTTP API: デプロイ

## AWS にのせる準備

<!-- section: 04.infra -->

ここからは CDK です。順に見ていきます。

### ログの置き場所

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

わざわざ自分で作っているのには理由があります。作らずにおくと、Lambda が最初の実行のときに自動で作ってくれるのですが、その log group は保持期間が無期限で、stack を消しても残ります。保存料金がかかり続けるうえ、どの stack のものか迷子になります。

### 関数の権限

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

実行 role（execution role）は、関数が AWS の中で動くときに使う権限です。**あなた自身の権限とは別物**なので、「手元の `aws` コマンドでは通るのに、Lambda の中では拒否される」が普通に起きます。

CDK は、何も言わなければ `AWSLambdaBasicExecutionRole` という管理ポリシーを付けます。これ、アカウント内のどの log group にも書ける権限なんです。ここでは role を自分で作って、さっきの log group に書くことだけを許しています。テストも、許可が 2 つの操作だけであること、対象が `*` でないことを見ています。

05章で DynamoDB を足すときは、この role に table の権限を足します。「この関数は何ができるのか」が、この数行を見ればわかる。そういう状態を保ちたいわけです。

### 関数

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

`NodejsFunction` は、synth のときに esbuild で TypeScript を 1 つの JavaScript にまとめてくれます。Docker は使いません。

`timeout` は 10 秒にしました。HTTP API は Lambda の応答を最大 30 秒しか待たず、この上限は引き上げられません。それより長く動かしても、もう誰も待っていない処理にお金を払うだけです。

`architecture` は arm64。東京リージョンでは、x86 より実行時間の単価が安くなります（1 GB 秒あたり USD 0.0000133334 と USD 0.0000166667）。

### API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

route を 1 つずつ並べています。「全部の path を Lambda に渡す」と書くこともできますが、そうすると存在しない path へのアクセスでも関数が起動して、料金がかかります。並べておけば、それ以外は API Gateway が 404 で返してくれます。

そのかわり、route が Hono のアプリとこの stack の 2 か所に書かれることになります。ずれると困るので、テストが「stack の route はこの 5 つちょうど」を見張っています。

CORS は、ブラウザが別の origin から API を呼ぶのを許す設定です。許す origin は 1 つだけ。既定は SPA の開発サーバーにしてあります。

## デプロイして呼ぶ

<!-- section: 04.deploy -->

```bash
vp run api:infra:diff
vp run api:infra:deploy
```

終わると、`ApiUrl` に `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` の形の URL が出ます。

```bash
curl -s https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/health
vp run api:smoke
```

03章の SPA から呼べるようにするなら、SPA の URL を渡してデプロイし直します。

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

SPA の画面をこの API につなぐのは、もう少し先です。メモリのノートを画面に出しても、さっき見たとおり、再読み込みのたびに結果が変わるだけなので。05章で保存先を作って、誰のノートかを区別できる 06章でつなぎます。

## ログを見る

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

stack の output から log group の名前を取ってきて、`aws logs tail` を実行するタスクです。

アプリは、1 リクエストにつき 1 行の JSON を書きます。Lambda の既定のログ形式では、その前に時刻や Lambda の request ID が付くので、CloudWatch Logs に入る 1 件は「前置き + JSON」です（[19章](/ja/chapters/19-observability.md)で、もう一度見ます）。

<<< @/examples/04-http-api/src/log.ts{logger}

1 件のリクエストを追いかけたいときは、応答の `x-request-id` ヘッダー（エラーなら本文の `requestId`）を控えて、その値でログを探します。`status`、`durationMs`、エラーなら `error` にスタックトレースが入っています。同じ ID が、応答ヘッダー、エラー本文、ログの 3 か所に出ることは、テストで確かめてあります。

Lambda 自身も、呼び出しごとに `START`、`END`、`REPORT` の行を書きます。`REPORT` には実行時間、課金対象の時間、使ったメモリの最大値。cold start のときは `Init Duration` も付きます。メトリクスやアラームは [19章](/ja/chapters/19-observability.md)で扱います。

drift の検査は、02章と同じです。

```bash
vp run api:infra:drift
```
