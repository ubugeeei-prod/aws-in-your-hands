---
title: "19 Observability: 実装のつづき"
---

# 19 Observability: 実装のつづき

## 1 つの ID で辿る

<!-- section: 19.ids -->

ここまでで、ID が何種類も出てきました。整理します。

| ID | 誰が振るか | どこで見えるか |
| --- | --- | --- |
| `requestId`（アプリ） | アプリ。リクエストごとに UUID | 応答の `x-request-id`、エラー本文、ログの行、span の属性 `app.request_id` |
| `@requestId`（Lambda） | Lambda。呼び出しごと | Logs Insights、`REPORT` 行 |
| trace ID | trace を始めた最初の処理 | ログの行の `traceId`、X-Ray |
| span ID | span を作った処理 | ログの行の `spanId`、X-Ray |

利用者に見えるのは request ID、処理をまたいで共有されるのは trace ID です。なので、この 2 つを相互に引けるようにしておきます。

<<< @/examples/19-observability/src/telemetry.ts{fields}

ログの全部の行に `traceId` を足し、span には request ID を属性として付けます。利用者から request ID を聞けば、ログから trace ID がわかる。trace の画面で遅い span を見つけたら、属性の request ID でログに戻れる。テストは、この行き来を両方向で確かめています。

### X-Ray の書き方との変換

OpenTelemetry の trace ID は 32 文字の 16 進数です。X-Ray は、同じ値を `1-` と 2 つのハイフンを付けて書きます。

<<< @/examples/19-observability/src/trace-context.ts{xray}

ログにあるのは 32 文字のほう、X-Ray の画面や `REPORT` 行にあるのはハイフンつきのほうです。検索するときは、相手に合わせて変換します。

### 処理をまたいで渡す

trace ID を次の処理に渡す方法は、W3C の Trace Context という仕様で決まっています。HTTP なら `traceparent` というヘッダーです。

<<< @/examples/19-observability/src/trace-context.ts{traceparent}

中身は、版、trace ID、呼び出し元の span ID、flags の 4 つをハイフンでつないだものです。flags の最下位のビットが「呼び出し元はこの trace を記録している」を表します。

この章のコードが自分で `traceparent` を解釈しているのは、テストと `obs:smoke` だけです。実際の受け渡しは OpenTelemetry の propagator に任せています。

<<< @/examples/19-observability/src/telemetry.ts{propagation}

```figure
caption: trace は browser から worker まで運ばれ、同じ message が 2 回届くと、同じ親を持つ span が 2 つできる
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

ブラウザが `traceparent` を付けて呼ぶと、API はその trace を引き継ぎます。API が queue にメッセージを入れるとき、同じ情報をメッセージに載せます。worker はそこから続きを始めます。全員のログに同じ `traceId` が残るので、1 つの query で全部の行が出てきます。

[08章](/ja/chapters/08-async.md)で queue と worker を作りました。SQS は、X-Ray の trace ヘッダーを `AWSTraceHeader` というメッセージの属性で運び、受け手が Lambda なら自動で引き継ぐ、と X-Ray のドキュメントにあります。この章では SQS を使わず、「メッセージに載せて、受け手が続ける」ところだけをテストで再現しています。同じメッセージが 2 回配送されると、同じ親を持つ span が 2 つできます。重複配送が trace の上で見える、ということです。

1 つ、実機で確かめていないことがあります。Lambda の中では、layer がすでに呼び出しの span を開いています。この章のコードは、その場合 `traceparent` を自分では読まず、layer の span の下に入ります。ブラウザの `traceparent` と Lambda の trace がつながるかどうかは、layer と Lambda の振る舞い次第です。つながらなかった場合でも、ログの `traceId` と request ID で辿ることはできます。

## trace は全部は残らない

<!-- section: 19.sampling -->

ここが、この章でいちばん誤解されやすいところです。

trace は sampling されます。全部のリクエストを記録すると高くつくので、一部だけを残します。Lambda の active tracing は、毎秒最初の 1 件と、残りの 5% を記録します。この割合は、関数ごとには変えられません。

そして、決めるのは最初の 1 回だけです。trace を始めた処理が「記録する」「しない」を決めて、下流はそれに従います。途中のサービスが自分の規則で決め直すことはありません。そうしないと、trace が途中で途切れるからです。

<<< @/examples/19-observability/src/local-tracing.ts{local}

これが意味することを、1 文で書きます。**span が無いことは、処理が無かったことの証拠になりません。**

- sampling されなかったリクエストは、成功していても span がありません
- 記録された trace でも、送信に失敗した span は欠けます。処理は終わっているのに、span だけが届かない
- X-Ray の trace は 30 日で消えます

テストは、この 3 つのうち最初の 2 つを、決まった順序で再現します。sampling を切った状態でノートを作ると、応答は 201、ログの行は残り、`sampled` は `false`、span は 0 個。exporter を落とした状態で worker を動かすと、仕事は 1 回済んでいて、span だけがありません。

だから、「起きたかどうか」はログとデータで確かめます。ログは sampling されません。ノートが作られたかどうかは table が知っています。trace は「どこが遅いか」を見るための道具で、「何が起きたか」の記録ではない、と割り切るのがコツです。

ログの行に `sampled` を入れたのも、そのためです。`false` の行の trace ID で X-Ray を検索しても、何も出てきません。それは障害ではなく、仕様です。

## ログと trace に入れないもの

<!-- section: 19.privacy -->

[06章](/ja/chapters/06-auth.md)で「token をログに書かない」と決めました。観測の道具を増やすと、漏れる先も増えます。ログは 7 日、trace は 30 日、どちらもアプリの table より広い範囲の人が読めることが多い場所です。

この章のやり方は、禁止リストではなく許可リストです。「password という名前の項目を消す」方式は、名前の違う項目が増えたときに漏れます。そうではなく、書いてよい項目を決めて、それ以外があればテストを落とします。

- **ログ**は、さっきの `strictObject` です。項目が増えたら schema に足すことになり、そのとき人の目が入ります
- **span の属性**は、テストが名前の一覧を固定しています。`http.request.method`、`url.path`、`http.response.status_code`、`app.request_id`、`app.repository.operation`、`app.repository.outcome`、`error.type` の 7 つだけです
- **path は query string なし。** query string には token が入ることがあります（06章の認可コードがそうでした）
- **例外は、種類だけ。** span に例外を記録する標準の方法は、メッセージとスタックトレースを丸ごと写します。メッセージには入力がそのまま入ることがあるので、この章は例外の型の名前だけを残します。詳しい内容は、ログの `error` に 1 回だけ書きます

テストは、ノートの本文、query string の token、`Authorization` ヘッダー、cookie、例外メッセージに入ったメールアドレスを流して、ログにも span にも出てこないことを確かめています。

1 つ、残っている穴を書いておきます。ログの `error` にはスタックトレースが入ります。例外のメッセージに個人情報が入るライブラリを使うと、そこから漏れます。これは許可リストでは防げません。
