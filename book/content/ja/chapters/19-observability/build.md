---
title: "19 Observability: しくみと実装"
---

# 19 Observability: しくみと実装

[前のページ](/ja/chapters/19-observability.md)では、症状にアラームを付け、鳴ったときに開くダッシュボードを作りました。このページでは、ログでリクエスト 1 件まで絞り込む方法と、トレースで時間の内訳を見る方法を実装します。

## ログで 1 件まで絞る

<!-- section: 19.logs -->

5xx が増えているとわかったら、次に知りたいのは、どのリクエストが失敗しているかです。CloudWatch Logs Insights を使うと、ロググループ（log group）に対してクエリを書いて調べられます。

クエリを書く前に、ログの形を固定します。05章のアプリが実際に書く行は、次の 2 種類です。

<<< @/examples/19-observability/src/log-shape.ts{shape}

`strictObject` にしてあるので、ここに無い項目が 1 つでもログに混ざるとテストが落ちます。この性質は、[ログとトレースに入れないもの](/ja/chapters/19-observability/more.md)で個人情報を扱うときにも使います。

クエリは文字列で直接書かず、いったん構造として持ちます。

<<< @/examples/19-observability/src/queries.ts{model}

構造を挟むのは、Logs Insights のクエリが手元では実行できないからです。ただし、どの行を選ぶかの条件だけなら手元でも評価できます。同じ構造から、AWS に送る文字列と手元で動く絞り込みの両方を作っておけば、クエリが実際のログの形に合っているかをテストで確かめられます。

用意したクエリは 4 つです。

<<< @/examples/19-observability/src/queries.ts{queries}

04章でレスポンスに `x-request-id` を付けたのは、`byRequestId` のためでした。利用者からエラーの報告を受けたら、レスポンスの `x-request-id` を聞いて、このクエリに渡します。返ってくるのは、そのリクエストが書いた行だけです。リクエストの行と、あればスタックトレースの行が出ます。

ID は Valibot で UUID の形かどうかを確かめています。外から来た値をクエリの文字列に埋め込むので、SQL と同じ注意が要るからです。

テストでは、本物のアプリを動かして書かせたログの行に、クエリを当てます。

<<< @/examples/19-observability/src/queries.ts{run}

テストが確かめているのは、ID で絞るとそのリクエストの行だけが出ること、5xx の集計に 4xx が混ざらないこと、クエリが参照する項目名がすべてログのスキーマにあることです。項目名の検査があるので、誰かが 05章のログの項目名を変えると、ここでテストが落ちます。

Logs Insights がこの文字列を受け付けて同じ結果を返すことは、確かめていません。構文は公式ドキュメントの例に合わせましたが、実行はしていません。

クエリの文字列を見るだけなら、AWS は要りません。

```bash
vp run obs:query:print --name errors
```

```text
filter message = "request" and status >= 500
| stats count(*) as requests by method, path
| sort requests desc
| limit 20
```

### 2 つの request ID

Logs Insights は、Lambda のログに `@requestId` という項目を自動で付けます。`@requestId` は Lambda が呼び出しごとに振る ID で、アプリの `requestId` とは別のものです。利用者に返しているのはアプリの ID なので、クエリでは `@` の付かない `requestId` を使います。名前が似ていて取り違えやすいので、注意してください。

### ログ形式を JSON にした理由

04章と 05章の関数は、Lambda の既定のログ形式であるテキストのままです。テキスト形式では、Node.js のランタイムが `console.log` の出力の前に、時刻、Lambda の request ID、ログレベルを付け足します。そのため、CloudWatch Logs に入る 1 件は純粋な JSON ではなく、前置きのあとに JSON が続く形になります。

Logs Insights は、Lambda のログであれば最初の JSON の断片から項目を見つけるので、04章の調べ方はテキスト形式でも成り立ちます。一方、次の節で使うメトリクスフィルターの JSON のパターンは、JSON のログに対して使うものです。前置きのある行に合うかどうかは、ドキュメントからは読み取れませんでした。

そこで、この章の関数はログ形式を JSON にしています。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

公式ドキュメントによると、JSON 形式では、すでに JSON になっている行を Lambda が二重に包むことはありません。そのとおりなら、アプリの行がそのまま 1 件のログになります。ただし、実際の関数では確かめられていません。違っていた場合の直し方は、[検証メモ](/ja/chapters/19-observability/wrap.md)に書きました。

## ログから数える: メトリクスフィルターと EMF

<!-- section: 19.log-metrics -->

05章で、古い版をもとにした更新を 409 で断るようにしました。この 409 がどのくらい起きているかは、API Gateway のメトリクスではわかりません。`4xx` は 400 も 404 も 409 もまとめて数えるからです。

ただ、ログにはすでに `status: 409` の行があるので、その行を数えれば済みます。

<<< @/examples/19-observability/src/queries.ts{conflicts}

<<< @/examples/19-observability/infra/lib/monitoring.ts{metric-filter}

メトリクスフィルター（metric filter）は、ロググループに届く行のうちパターンに合うものを数えて、メトリクスにする設定です。条件は、先ほどのクエリと同じ構造から作っています。

<<< @/examples/19-observability/src/conditions.ts{render}

メトリクスフィルターには、知っておくべき性質が 3 つあります。まず、フィルターを作る前のログには遡りません。次に、配送は「少なくとも 1 回」なので、まれに重複して数えられます。そして、ディメンション（dimension）を付けると値の種類ごとに別のメトリクスになり、その数だけ課金されます。

ログからメトリクスを作る方法はもう 1 つあります。embedded metric format（EMF）は、決まった形の JSON をログに書くと、CloudWatch がそこから値を取り出す仕組みです。2 つを比べると次のようになります。

| | メトリクスフィルター | EMF |
| --- | --- | --- |
| 定義する場所 | インフラ（ロググループの設定） | アプリのコード（ログの行そのもの） |
| 向いているもの | すでにある行を数える | 値とディメンションをコードから出す（処理時間、件数など） |
| コードの変更 | 不要 | 必要 |
| 料金 | カスタムメトリクスの料金。ログは増えない | カスタムメトリクスの料金と、増えたログの取り込み |

どちらも `PutMetricData` を呼ばないので、リクエストの処理は待たされません。この章はすでにある行を数えるだけなので、メトリクスフィルターにしました。処理時間をディメンションつきで出したくなったら、EMF を使います。

EMF を選ぶときの注意が 2 つあります。ディメンションに request ID のような種類の多い値を入れると、値の数だけメトリクスができます。また、EMF の行は、前後に何も付かない JSON でなければなりません。Lambda の公式ドキュメントは、ログ形式が JSON のときは `console.log` ではなく `process.stdout` に直接書くよう案内しています。

## トレース: 時間を使った場所

<!-- section: 19.tracing -->

ログからは何が起きたかがわかりますが、1 件のリクエストの中でどこに時間がかかったかは読み取りにくいものです。その内訳を記録するのがトレースです。1 件のリクエストに 1 つの trace ID が振られ、その中の区間 1 つひとつがスパン（span）になります。

計装には OpenTelemetry を使います。OpenTelemetry を選ぶ理由は次の節に回し、先にコードを見ます。

<<< @/examples/19-observability/src/telemetry.ts{span}

このファイルが読み込んでいるのは `@opentelemetry/api` だけです。`@opentelemetry/api` は、スパンを始める、いまのスパンを取る、といった呼び出しの窓口で、実際に記録する SDK は別にあります。SDK が登録されていなければ、どの呼び出しも何もしません。どの SDK を使うかは起動する側が選び、手元ではコンソールに出す SDK を、Lambda ではレイヤーの SDK を使います。アプリのコードは、どちらが動いているかを知りません。

05章のリポジトリを包んで、テーブルへの呼び出し 1 回ごとにスパンを作ります。

<<< @/examples/19-observability/src/traced-repository.ts{repository}

05章でリポジトリをインターフェースにしておいたので、DynamoDB の実装にもメモリの実装にも手を入れず、外から包むだけで済みます。

アプリ全体も同じやり方で包みます。05章のアプリは `Request` を受け取って `Response` を返す関数なので、包む側も同じ形の関数を 1 つ書くだけです。

<<< @/examples/19-observability/src/app.ts{app}

スパンの名前は `GET` や `POST` だけにしています。ノートの ID が入ったパスを名前にすると、名前の種類が際限なく増えるからです。パスは属性に入れます。

これらを次の関数で組み立てます。

<<< @/examples/19-observability/src/compose.ts{compose}

## Lambda でトレースを取る

<!-- section: 19.lambda-tracing -->

AWS のトレースのサービスは X-Ray です。X-Ray については、道具の終了とサービスの終了が混同されやすいので、先に整理しておきます。

X-Ray には、アプリに組み込む X-Ray SDK と、トレースを中継する X-Ray daemon がありました。この 2 つは 2026 年 2 月 25 日に保守モードに入り、今後はセキュリティの修正しか出ません。AWS は、計装を OpenTelemetry に移すよう勧めています。

一方、X-Ray というサービスが終わるという記述は、support timeline のページにはありません。OpenTelemetry で作ったトレースの送り先は、いまも X-Ray です。終わりに向かっているのは X-Ray 専用の計装の道具で、トレースを受け取って見せるサービスではありません。新しく書くコードを OpenTelemetry にするのは、このためです。

Lambda にトレースを入れる方法は、2 段階に分かれます。

### 段階 1: active tracing（コードなし）

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

`tracing: lambda.Tracing.ACTIVE` を付けると、Lambda 自身が呼び出しごとの記録を X-Ray に送ります。記録されるのは、Lambda のサービスの区間と、関数の区間です。SDK もレイヤーも要りません。コールドスタートにどれだけかかったかは、これだけでわかります。

実行ロールには、X-Ray へ書く操作が 2 つ足されます。この 2 つは対象を絞れない操作なので、リソースは `*` になります。これまでの章のテストは `*` を使っていないことを確かめていましたが、この章のテストは、`*` が付くのはこの 2 つの操作だけであることを確かめます。

この段階では、テーブルへの呼び出しのような関数の中のスパンは記録されません。SDK が無いので、先ほどの `withSpan` が何もしないからです。

### 段階 2: OpenTelemetry のレイヤーを足す

関数の中まで見るには SDK が要ります。AWS の移行ガイドが Lambda 向けに勧めているのは、AWS Lambda Layer for OpenTelemetry です。関数にこのレイヤー（layer）を足して環境変数を 1 つ設定すると、関数のコードが読み込まれる前に SDK が起動します。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{otel-layer}

レイヤーの ARN はリージョンと版で変わるので、コードには書かず、デプロイのときに渡します。

<<< @/examples/19-observability/infra/bin/app.ts{context}

ARN は、ADOT（AWS Distro for OpenTelemetry）のドキュメントにある「Lambda Layer ARNs」の表の、Node.js のタブに載っています。2026 年 10 月 12 日の時点で、東京リージョンの値は `arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16` でした。版は上がっていくので、使うときに表を確かめてください。

`OTEL_AWS_APPLICATION_SIGNALS_ENABLED=false` は、トレースだけを使うための設定です。このレイヤーは既定で、サービスごとの指標を自動で作る Application Signals という別の機能も有効にします。Application Signals は料金も別なので、ここでは切っています。

関数のコードは、段階 1 でも段階 2 でも同じです。

<<< @/examples/19-observability/src/lambda.ts{handler}

段階 2 には、確かめられていないことが 4 つあります。

- Node.js 24 が、このレイヤーの対応ランタイムの一覧にありません。ドキュメントの一覧は 18、20、22 までで、この本の関数は 24 で動かしています。動くかもしれませんし、動かないかもしれません
- バンドルした関数で自動計装が効くかどうか。レイヤーは AWS SDK の呼び出しを自動でスパンにしますが、その方法はライブラリの読み込みに割り込むものです。この本は esbuild で AWS SDK ごと 1 ファイルにまとめているので、効かない可能性があります。テーブルへのスパンを自動計装に頼らず手で書いたのは、このためです
- API の版。関数にバンドルされた `@opentelemetry/api`（1.9.1）は、レイヤーが登録した SDK とグローバルな変数を通してつながります。API のソースを読むと、レイヤー側の API の minor 版がこちらより古い場合、こちらの呼び出しは黙って何もしなくなります。スパンが出ないときは、ここを疑ってください
- 権限。ドキュメントの手順は、管理ポリシー `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` を付けます。この章は Application Signals を切っているので付けていませんが、それで足りるかは未確認です

どれも、一度デプロイすればわかることです。段階 1 だけでも章の残りは成り立つので、レイヤーは既定では付けていません。

レイヤーを使わない方法もあります。移行ガイドは、SDK を自分で組み立てて X-Ray 用のエクスポーターを使う方法も挙げています。ランタイムの対応を待たなくてよい代わりに、初期化のコードを自分で持つことになります。この章では扱いません。
