---
title: "04 HTTP API: デプロイ"
---

# 04 HTTP API: デプロイ

[手元で動かした](/ja/chapters/04-http-api/local.md)アプリを、このページで AWS にのせます。CDK でインフラを定義し、デプロイして呼び、ログを読むところまで進みます。

## AWS にのせる準備

<!-- section: 04.infra -->

インフラは CDK で定義します。スタックの中身を、上から順に見ていきます。

### ログの置き場所

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

ロググループ（log group）を自分で作るのには理由があります。作らずにおくと、Lambda が最初の実行のときに自動で作りますが、自動で作られたロググループは保持期間が無期限で、スタックを消しても残ります。保存料金がかかり続けるうえ、どのスタックのものだったかもわからなくなります。

### 関数の権限

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

実行ロール（execution role）は、関数が AWS の中で動くときに使う権限です。**あなた自身の権限とは別**なので、手元の `aws` コマンドでは通る操作が Lambda の中では拒否される、ということがふつうに起きます。

何も指定しなければ、CDK は `AWSLambdaBasicExecutionRole` という管理ポリシーを付けます。この管理ポリシーは、アカウント内のどのロググループにも書ける権限です。ここではロールを自分で作り、上で作ったロググループに書くことだけを許しています。テストも、許可している操作が 2 つだけであることと、対象が `*` でないことを確かめています。

05章で DynamoDB を足すときは、このロールにテーブルの権限を足します。この関数に何ができるのかが、この数行を読めばわかる状態を保つためです。

### 関数

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

`NodejsFunction` は、synth のときに esbuild で TypeScript を 1 つの JavaScript にまとめます。Docker は使いません。

`timeout` は 10 秒にしました。HTTP API は Lambda のレスポンスを最大 30 秒しか待たず、この上限は引き上げられません。それより長く動かしても、もう誰も待っていない処理に料金を払うだけです。

`architecture` は arm64 です。東京リージョンでは、x86 より実行時間の単価が安くなります（1 GB 秒あたり USD 0.0000133334 と USD 0.0000166667）。

### API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

ルートは 1 つずつ並べています。すべてのパスを Lambda に渡す書き方もありますが、そうすると存在しないパスへのリクエストでも関数が起動し、料金がかかります。並べておけば、それ以外のパスには API Gateway が 404 を返します。

そのかわり、ルートをアプリの `createApp` とこのスタックの 2 か所に書くことになります。2 つがずれないように、スタックのルートがこの 5 つちょうどであることをテストで確かめています。

CORS は、ブラウザが別のオリジンから API を呼ぶことを許す設定です。preflight には API Gateway が答えるので、アプリの `cors` に渡したのと同じメソッドとヘッダーを、ここにも書いています。許すオリジンは 1 つだけで、既定では SPA の開発サーバーにしてあります。

### 受けるリクエストを絞る

この API は誰でも呼べて、呼ばれたぶんだけ料金がかかります。何もしなければ、bot が送ってきたリクエストのぶんがそのまま請求になります。

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{throttle}

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{stage}

これはステージ（stage）のスロットリング（throttling）の設定です。受けるのは 1 秒に 10 件までで、瞬間的には 20 件まで受けます。超えたぶんは API Gateway が 429 で断り、関数は呼ばれません。`HttpApi` のコンストラクトにはこの設定を渡す場所がないので、コンストラクトが作ったステージを取り出して、直接書いています。

この 10 件は API 全体で 1 つの値で、呼ぶ人ごとの値ではありません。誰かが 1 秒 10 件を使い切っていれば、あなたのリクエストも 429 になります。スロットリングが守っているのは請求額で、使い勝手ではありません。10 件は練習用の値なので、本物の利用者を迎えるときは選び直してください。

## デプロイして呼ぶ

<!-- section: 04.deploy -->

```bash
vp run api:infra:diff
vp run api:infra:deploy
```

デプロイが終わると、`ApiUrl` に `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` の形の URL が出ます。

```bash
curl -s https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/health
vp run api:smoke
```

03章の SPA から呼べるようにするには、SPA の URL を渡してデプロイし直します。

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

SPA の画面をこの API につなぐのは、もう少し先です。メモリのノートを画面に出しても、[ノートの置き場所](/ja/chapters/04-http-api/local.md)で見たとおり、再読み込みのたびに結果が変わるだけだからです。05章で保存先を作り、誰のノートかを区別できるようになる 06章でつなぎます。

## ログを見る

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

`api:logs` は、スタックの出力からロググループの名前を取り、`aws logs tail` を実行するタスクです。

アプリは、1 リクエストにつき 1 行の JSON を書きます。Lambda の既定のログ形式では、その前に時刻と Lambda の request ID が付くので、CloudWatch Logs に入る 1 件は、この前置きと JSON をつなげたものになります（[19章](/ja/chapters/19-observability.md)でもう一度見ます）。

<<< @/examples/04-http-api/src/log.ts{logger}

1 件のリクエストを追うときは、レスポンスの `x-request-id` ヘッダー（エラーなら本文の `requestId`）を控えて、その値でログを探します。ログには `status` と `durationMs` があり、エラーなら `error` にスタックトレースが入っています。同じ ID がレスポンスのヘッダー、エラーの本文、ログの 3 か所に出ることは、テストで確かめてあります。

Lambda 自身も、呼び出しごとに `START`、`END`、`REPORT` の行を書きます。`REPORT` には実行時間、課金対象の時間、使ったメモリの最大値が入り、コールドスタートのときは `Init Duration` も付きます。メトリクスとアラームは [19章](/ja/chapters/19-observability.md)で扱います。

ドリフトの検査は、02章と同じです。

```bash
vp run api:infra:drift
```
