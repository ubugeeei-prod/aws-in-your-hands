---
title: "19 Observability: 実装のつづき"
---

# 19 Observability: 実装のつづき

[前のページ](/ja/chapters/19-observability/build.md)で、ログのクエリとトレースの計装を作りました。このページでは、ログとトレースを ID でつなぎ、トレースが残らない場合と、ログやトレースに書いてはいけないものを扱います。

## 1 つの ID で辿る

<!-- section: 19.ids -->

ここまでに出てきた ID は 4 種類あります。

| ID | 誰が振るか | どこで見えるか |
| --- | --- | --- |
| `requestId`（アプリ） | アプリ。リクエストごとに UUID | レスポンスの `x-request-id`、エラー本文、ログの行、スパンの属性 `app.request_id` |
| `@requestId`（Lambda） | Lambda。呼び出しごと | Logs Insights、`REPORT` 行 |
| trace ID | トレースを始めた最初の処理 | ログの行の `traceId`、X-Ray |
| span ID | スパンを作った処理 | ログの行の `spanId`、X-Ray |

利用者に見えるのは request ID で、処理をまたいで共有されるのは trace ID です。そこで、この 2 つをどちらからでも引けるようにしておきます。

<<< @/examples/19-observability/src/telemetry.ts{fields}

ログのすべての行に `traceId` を足し、スパンには request ID を属性として付けます。利用者から request ID を聞けば、ログから trace ID がわかります。トレースの画面で遅いスパンを見つけたら、属性の request ID でログに戻れます。テストは、この行き来を両方向で確かめています。

### X-Ray の書き方との変換

OpenTelemetry の trace ID は 32 文字の 16 進数です。X-Ray は、同じ値の先頭に `1-` を付け、ハイフンを 2 つ入れて書きます。

<<< @/examples/19-observability/src/trace-context.ts{xray}

ログにあるのは 32 文字の書き方で、X-Ray の画面や `REPORT` 行にあるのはハイフンつきの書き方です。検索するときは、探す先の書き方に変換します。

### 処理をまたいで渡す

trace ID を次の処理に渡す方法は、W3C の Trace Context という仕様で決まっていて、HTTP では `traceparent` ヘッダーを使います。

<<< @/examples/19-observability/src/trace-context.ts{traceparent}

`traceparent` の値は、版、trace ID、呼び出し元の span ID、flags の 4 つをハイフンでつないだものです。flags の最下位のビットは、呼び出し元がこのトレースを記録していることを表します。

この章のコードが自分で `traceparent` を解釈しているのは、テストと `obs:smoke` だけです。実際の受け渡しは、OpenTelemetry の propagator に任せています。

<<< @/examples/19-observability/src/telemetry.ts{propagation}

```figure
caption: トレースはブラウザからワーカーまで運ばれ、同じメッセージが 2 回届くと、同じ親を持つスパンが 2 つできる
type: sequence
actor browser: Browser
actor api: API | Lambda
actor queue: Queue
actor worker: Worker | Lambda
note browser: traceparent
step browser -> api: 00-<trace>-<a>-01
note api: span b, parent a
note api: log: traceId=<trace>
step api -> queue: message + trace header
note queue: traceparent / AWSTraceHeader
step queue -> worker: deliver
note worker: span c, parent b
step queue -> worker: deliver again
note worker: span c', parent b
note worker: log: traceId=<trace>
```

ブラウザが `traceparent` を付けて呼ぶと、API はそのトレースを引き継ぎます。API は、キューにメッセージを入れるときに同じ情報をメッセージに載せ、ワーカーはそこから続きを始めます。どの処理のログにも同じ `traceId` が残るので、1 つのクエリですべての行を取り出せます。

キューとワーカーは [08章](/ja/chapters/08-async.md)で作りました。X-Ray のドキュメントによると、SQS は X-Ray のトレースヘッダーを `AWSTraceHeader` というメッセージの属性で運び、受け手が Lambda なら自動で引き継ぎます。この章では SQS を使わず、メッセージに載せて受け手が続けるところだけをテストで再現しています。同じメッセージが 2 回配送されると、図のとおり、同じ親を持つスパンが 2 つできます。重複配送がトレースの上で見えるわけです。

実際の関数で確かめていないことが 1 つあります。Lambda の中では、レイヤーがすでに呼び出しのスパンを開いています。その場合、この章のコードは `traceparent` を自分では読まず、レイヤーのスパンの下に入ります。ブラウザの `traceparent` と Lambda のトレースがつながるかどうかは、レイヤーと Lambda の振る舞いで決まります。つながらなかった場合でも、ログの `traceId` と request ID で辿れます。

## トレースは一部しか残らない

<!-- section: 19.sampling -->

この章でいちばん誤解されやすいのが、この節の内容です。

トレースはサンプリング（sampling）されます。すべてのリクエストを記録すると高くつくので、一部だけを残します。Lambda の active tracing は、毎秒最初の 1 件と、残りの 5% を記録します。この割合は、関数ごとには変えられません。

記録するかどうかを決めるのは、最初の 1 回だけです。トレースを始めた処理が決め、下流はその決定に従います。途中のサービスが自分の規則で決め直すと、トレースが途中で途切れてしまうからです。

<<< @/examples/19-observability/src/local-tracing.ts{local}

この仕組みから、次のことが言えます。**スパンが無いことは、処理が無かったことの証拠になりません。**

- サンプリングされなかったリクエストは、成功していてもスパンがありません
- 記録されたトレースでも、送信に失敗したスパンは欠けます。処理は終わっているのに、スパンだけが届きません
- X-Ray のトレースは 30 日で消えます

テストは、この 3 つのうち最初の 2 つを、決まった順序で再現します。サンプリングを切った状態でノートを作ると、レスポンスは 201 で、ログの行は残り、`sampled` は `false` になり、スパンは 0 個です。エクスポーターを落とした状態でワーカーを動かすと、仕事は 1 回済んでいるのに、スパンだけがありません。

そのため、処理が起きたかどうかはログとデータで確かめます。ログはサンプリングされませんし、ノートが作られたかどうかはテーブルを見ればわかります。トレースは、どこが遅いかを見るための道具であり、何が起きたかの記録としては使えません。

ログの行に `sampled` を入れたのも、このためです。`sampled` が `false` の行の trace ID で X-Ray を検索しても、何も出てきません。これは障害ではなく、仕様どおりの動きです。

## ログとトレースに入れないもの

<!-- section: 19.privacy -->

[06章](/ja/chapters/06-auth.md)で、トークンをログに書かないと決めました。観測の道具を増やすと、漏れる先も増えます。ログは 7 日、トレースは 30 日残り、どちらもアプリのテーブルより広い範囲の人が読めることの多い場所です。

この章では、禁止する項目の一覧ではなく、許可する項目の一覧を使います。password という名前の項目を消す、という方式では、別の名前の項目が増えたときに漏れます。書いてよい項目を先に決めておき、それ以外の項目があればテストを落とすほうが確実です。

- ログの項目は、[前のページ](/ja/chapters/19-observability/build.md)の `strictObject` で固定しています。項目を増やすにはスキーマに足すことになり、そのときに人の目が入ります
- スパンの属性は、テストが名前の一覧を固定しています。`http.request.method`、`url.path`、`http.response.status_code`、`app.request_id`、`app.repository.operation`、`app.repository.outcome`、`error.type` の 7 つだけです
- パスには query string を含めません。query string にはトークンが入ることがあり、06章の認可コードがその例でした
- 例外は種類だけを残します。スパンに例外を記録する標準の方法は、メッセージとスタックトレースを丸ごと写します。メッセージには入力がそのまま入ることがあるので、この章では例外の型の名前だけを残します。詳しい内容は、ログの `error` に 1 回だけ書きます

テストは、ノートの本文、query string のトークン、`Authorization` ヘッダー、cookie、例外メッセージに入ったメールアドレスを流して、ログにもスパンにも出てこないことを確かめています。

この方法でも防げない穴が 1 つ残っています。ログの `error` にはスタックトレースが入るので、例外のメッセージに個人情報を入れるライブラリを使うと、そこから漏れます。許可する項目の一覧では、これは防げません。
