---
title: "19 Observability: しくみと実装"
---

# 19 Observability: しくみと実装

## ログで 1 件まで絞る

<!-- section: 19.logs -->

「5xx が増えている」とわかったら、次はどのリクエストかです。CloudWatch Logs Insights は、log group に対して query を書いて調べる機能です。

query を書く前に、ログの形を固定します。05章のアプリが実際に書く行は、この 2 種類です。

<<< @/examples/19-observability/src/log-shape.ts{shape}

`strictObject` にしてあるのがポイントで、ここに無い項目が 1 つでもログに混ざると、テストが落ちます。これは後で、個人情報の話につながります。

query は、文字列で直接書かずに、いったん構造として持ちます。

<<< @/examples/19-observability/src/queries.ts{model}

回りくどく見えますが、理由があります。Logs Insights の query は、手元では実行できません。でも「どの行を選ぶか」という条件は、手元でも評価できます。同じ構造から、AWS に送る文字列と、手元で動く絞り込みの両方を作っておけば、「query が実際のログの形に合っているか」をテストで確かめられます。

用意した query は 4 つです。

<<< @/examples/19-observability/src/queries.ts{queries}

`byRequestId` が、04章からの約束の回収です。利用者が「エラーになった」と言ってきたら、応答の `x-request-id` を聞いて、この query に渡します。そのリクエストが書いた行（リクエストの行と、あればスタックトレースの行）だけが出てきます。

ID は Zod で UUID かどうかを確かめています。query の文字列に外から来た値を埋め込むので、SQL と同じ種類の注意が要ります。

テストは、本物のアプリを動かして書かせたログ行に、この query を当てます。

<<< @/examples/19-observability/src/queries.ts{run}

確かめているのは、「ID で絞ると、そのリクエストの行だけが出る」「5xx の集計に 4xx が混ざらない」「query が参照する項目名が、ログの schema に全部ある」です。最後のは、05章のログの項目名を誰かが変えたときに、ここで落ちるようにするためです。

確かめていないのは、Logs Insights がこの文字列を受け付けて、同じ結果を返すことです。構文は公式ドキュメントの例に合わせましたが、実行はしていません。

文字列だけ見たいときは、AWS なしで出せます。

```bash
vp run obs:query:print --name errors
```

```text
filter message = "request" and status >= 500
| stats count(*) as requests by method, path
| sort requests desc
| limit 20
```

### request ID が 2 つある

Logs Insights は、Lambda のログに `@requestId` という項目を自動で付けます。これは Lambda が呼び出しごとに振る ID で、アプリの `requestId` とは別物です。利用者に返しているのはアプリのほうなので、query では `@` の付かない `requestId` を使います。名前が似ているので、最初は必ず間違えます。

### ログの形式を JSON に変えた

04章と 05章の関数は、Lambda の既定のログ形式（テキスト）のままです。その場合、Node.js の runtime は、`console.log` の出力の前に時刻、Lambda の request ID、ログレベルを付け足します。つまり CloudWatch Logs に入る 1 件は、純粋な JSON ではなく、「前置き + JSON」です。

Logs Insights は、Lambda のログなら最初の JSON の断片から項目を見つけてくれるので、04章の調べ方はそのままでも成り立ちます。でも、次の節の metric filter は、JSON の pattern を「JSON のログ」に対して使うものです。前置きのある行に合うかどうかは、ドキュメントからは読み取れませんでした。

なので、この章の関数はログ形式を JSON にしています。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

公式ドキュメントによると、JSON 形式のとき、すでに JSON になっている行を Lambda は二重に包みません。アプリの行がそのまま 1 件になるはずです。正直に言うと、ここは実機で確かめられていません。違っていた場合の直し方は、章末の検証メモに書きました。

## ログから数える: metric filter と EMF

<!-- section: 19.log-metrics -->

05章で、古い版をもとにした更新は 409 で断るようにしました。この 409 がどのくらい起きているかは、API Gateway のメトリクスではわかりません。`4xx` は 400 も 404 も 409 もまとめて数えるからです。

でも、ログには `status: 409` の行がもうあります。それを数えればいい。

<<< @/examples/19-observability/src/queries.ts{conflicts}

<<< @/examples/19-observability/infra/lib/monitoring.ts{metric-filter}

**metric filter** は、log group に届く行を pattern で数えて、メトリクスにする設定です。条件は、さっきの query と同じ構造から作っています。

<<< @/examples/19-observability/src/conditions.ts{render}

知っておくことが 3 つあります。作る前のログには遡りません。配送は「少なくとも 1 回」で、まれに重複して数えられます。そして dimension を付けると、値の種類ごとに別のメトリクスになって、その数だけ課金されます。

ログからメトリクスを作る方法は、もう 1 つあります。**embedded metric format（EMF）** は、決まった形の JSON をログに書くと、CloudWatch がそこから値を取り出す仕組みです。違いはこうです。

| | metric filter | EMF |
| --- | --- | --- |
| 定義する場所 | インフラ（log group の設定） | アプリのコード（ログの行そのもの） |
| 向いているもの | すでにある行を数える | 値と dimension をコードから出す（処理時間、件数など） |
| コードの変更 | 不要 | 必要 |
| 料金 | custom metric の料金。ログは増えない | custom metric の料金と、増えたログの取り込み |

どちらも `PutMetricData` を呼ばないので、リクエストの処理は待たされません。この章は「すでにある行を数える」だけなので、metric filter にしました。処理時間を dimension つきで出したくなったら EMF です。

EMF を選ぶときの注意を 2 つ。dimension に request ID のような種類の多い値を入れると、値の数だけメトリクスができます。それから、EMF の行は「前後に何も付かない JSON」でなければいけません。Lambda の公式ドキュメントは、ログ形式が JSON のときは `console.log` ではなく `process.stdout` に直接書くよう案内しています。

## trace: どこで時間を使ったか

<!-- section: 19.tracing -->

ログは「何が起きたか」を教えてくれますが、「1 件のリクエストの中で、どこに時間がかかったか」は苦手です。それを記録するのが trace です。1 件のリクエストに 1 つの trace ID が振られ、その中の区間が span になります。

計装には OpenTelemetry を使います。理由は次の節で話すとして、先にコードを見ましょう。

<<< @/examples/19-observability/src/telemetry.ts{span}

このファイルが読み込んでいるのは `@opentelemetry/api` だけです。これは「span を始める」「いまの span を取る」といった呼び出しの窓口で、中身（SDK）は別です。SDK が登録されていなければ、全部の呼び出しが何もしません。手元ではコンソールに出す SDK を、Lambda では layer の SDK を、起動する側が選びます。アプリのコードはどちらなのかを知りません。

05章の repository を包んで、table への呼び出し 1 回ごとに span を作ります。

<<< @/examples/19-observability/src/traced-repository.ts{repository}

05章で repository を interface にしておいたのが、ここで効きます。DynamoDB の実装にもメモリの実装にも触らず、外から包むだけです。

アプリ全体も同じやり方で包みます。

<<< @/examples/19-observability/src/app.ts{app}

span の名前は `GET` や `POST` だけにしています。ノートの ID が入った path を名前にすると、名前の種類が際限なく増えるからです。path は属性に入れます。

組み立てはここです。

<<< @/examples/19-observability/src/compose.ts{compose}

## Lambda で trace を取る

<!-- section: 19.lambda-tracing -->

AWS の trace のサービスは X-Ray です。ここで、よく混同される話を整理しておきます。

X-Ray には、アプリに組み込む **X-Ray SDK** と、trace を中継する **X-Ray daemon** がありました。この 2 つは 2026 年 2 月 25 日に保守モードに入っていて、今後はセキュリティの修正しか出ません。AWS は、計装を OpenTelemetry に移すよう勧めています。

一方で、**X-Ray というサービス**が終わるという記述は、support timeline のページにはありません。OpenTelemetry で作った trace の送り先は、いまも X-Ray です。終わりに向かっているのは「X-Ray 専用の計装の道具」で、「trace を受け取って見せるサービス」ではない。だから、新しく書くコードは OpenTelemetry にします。

Lambda での入れ方は、段階が 2 つあります。

### 段階 1: active tracing（コードなし）

<<< @/examples/19-observability/infra/lib/observability-stack.ts{function}

`tracing: lambda.Tracing.ACTIVE` を付けると、Lambda 自身が呼び出しごとの記録（Lambda のサービスの区間と、関数の区間）を X-Ray に送ります。SDK も layer も要りません。cold start にどれだけかかったかは、これだけでわかります。

実行 role には X-Ray へ書く 2 つの操作が足されます。この 2 つは対象を絞れない操作なので、リソースは `*` になります。これまでの章のテストは「`*` を使っていない」ことを見ていましたが、この章のテストは「`*` はこの 2 つの操作だけ」に変えてあります。

この段階では、関数の中の span（table への呼び出しなど）は記録されません。SDK が無いので、さっきの `withSpan` は何もしないからです。

### 段階 2: OpenTelemetry の layer を足す

関数の中まで見るには、SDK が要ります。AWS の移行ガイドが Lambda 向けに勧めているのは、**AWS Lambda Layer for OpenTelemetry** です。関数に layer を足して、環境変数を 1 つ設定すると、関数のコードが読み込まれる前に SDK が起動します。

<<< @/examples/19-observability/infra/lib/observability-stack.ts{otel-layer}

layer の ARN はコードに書いていません。リージョンと版で変わるので、デプロイのときに渡します。

<<< @/examples/19-observability/infra/bin/app.ts{context}

ARN は ADOT（AWS Distro for OpenTelemetry）のドキュメントの「Lambda Layer ARNs」の表の、Node.js のタブにあります。2026 年 10 月 12 日の時点で、東京リージョンの値は `arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16` でした。版は上がっていくので、使うときに表を見てください。

`OTEL_AWS_APPLICATION_SIGNALS_ENABLED=false` は、trace だけを使う設定です。この layer は既定で Application Signals という別の機能（サービスごとの指標を自動で作る）も有効にします。そちらは料金も別なので、ここでは切っています。

関数のコードは、段階 1 でも 2 でも同じです。

<<< @/examples/19-observability/src/lambda.ts{handler}

ここからは、確かめられていないことを正直に並べます。

- **Node.js 24 が、この layer の対応 runtime の一覧にありません。** ドキュメントの一覧は 18、20、22 までです。この本の関数は 24 で動かしています。動くかもしれませんし、動かないかもしれません
- **bundle した関数で自動計装が効くか。** layer は AWS SDK の呼び出しを自動で span にしますが、これはライブラリの読み込みに割り込む方式です。この本は esbuild で AWS SDK ごと 1 ファイルにまとめているので、効かない可能性があります。だから table への span は、自動計装に頼らず手で書きました
- **API の版。** 関数に bundle された `@opentelemetry/api`（1.9.1）は、layer が登録した SDK と、グローバルな変数を通してつながります。API のソースを読むと、layer 側の API の minor 版がこちらより古い場合、こちらの呼び出しは黙って何もしなくなります。span が出ないときは、ここを疑ってください
- **権限。** ドキュメントの手順は管理ポリシー `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` を付けます。この章は Application Signals を切っているので付けていませんが、それで足りるかは未確認です

どれも、デプロイすれば 1 回でわかることです。段階 1 だけでも章の残りは成り立つので、layer は既定では付けていません。

layer を使わない方法もあります。移行ガイドは、SDK を自分で組み立てて X-Ray 用の exporter を使う方法も挙げています。runtime の対応を待たなくていいかわりに、初期化のコードを自分で持つことになります。この章では扱いません。
