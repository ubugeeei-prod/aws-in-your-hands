---
title: "10 Edge: CloudFront Functions、KeyValueStore、Lambda@Edge"
revision: 1
---

# 10 Edge: CloudFront Functions、KeyValueStore、Lambda@Edge

[03章](/ja/chapters/03-spa.md)で、十数行の関数を CloudFront に付けましたよね。path に `.` が無ければ `index.html` に書き換える、あれです。この章では、あの「edge で動く小さなコード」をもう少し働かせます。

作るのは 3 つ。古い URL を新しい URL へ飛ばす redirect の表、トップページを新しい版に切り替える feature flag、そしてサイト全体をメンテナンス表示にするスイッチです。どれもデプロイし直さずに切り替えたいので、データは CloudFront KeyValueStore に置いて、関数から読みます。

そのうえで、「この処理はどこに置くのがいいのか」を考えます。CloudFront Functions でできないことは、思っているより多いんです。足りないときの選択肢として Lambda@Edge も 1 つだけ動かして、最後に Cloudflare Workers と並べてみます。

前提は 03章です。コードは `examples/10-edge/` にあります。

## 全体像

<!-- section: 10.architecture -->

```figure
caption: 読者のリクエストは cache より先に CloudFront Function を通り、関数が KeyValueStore を読んで、その場で応答するか先へ流すかを決める
node reader: Reader
node fn: CloudFront Function "edge-router" | viewer-request, runtime 2.0
node cache: CloudFront cache
node kvs: KeyValueStore
node digest: Lambda@Edge "body-digest" | origin-request, 任意, /digest だけ
node resp: response
node s3: S3 bucket | private, ap-northeast-1
edge reader -> fn: HTTPS
edge fn --> reader: 503 か 301/302: ここで応答、先は動かない
edge fn -> cache: それ以外: URI を書き換えて渡す
edge fn -> kvs: 読むだけ
edge cache -> digest: miss
edge cache --> resp: hit
edge digest -> s3
group edge: CloudFront edge location = fn, cache, kvs
mark fn
```

```figure
caption: 値を書き換える道は関数の外にあり、書いた値が edge location に届くまでには遅れがある
node op: Operator | edge-data.json
node api: KeyValueStore API | global endpoint, SigV4A, If-Match: ETag
node kvs: CloudFront KeyValueStore | flag:maintenance, redirect:<path>, flag:new-home
edge op -> api: vp run edge:kvs:sync
edge api --> kvs: edge location への伝播: すぐではない
mark kvs
```

上半分は、読者のリクエストが通る道です。CloudFront はリクエストを受け取ると、cache を調べる前に関数を呼びます。このタイミングを viewer request と言います。関数は KeyValueStore（以下 KVS）を読んで、その場で応答を返すか、URL を書き換えて先へ流すかを決めます。

下半分は、あなたが表やスイッチを書き換える道です。関数は KVS を読むだけで、書けません。書くのは外から、専用の API でやります。そして、書いた内容が世界中の edge location に届くまでには、時間がかかります。この「読む道」と「書く道」が別々で、あいだに遅れがある、というのがこの章の背骨です。

### なぜ表を関数に書かないのか

redirect が 3 件なら、関数のコードに直接書けば済みます。そうしない理由は 2 つ。

関数のコードは 10 KB までで、この上限は引き上げられません。表が育つと入らなくなります。もう 1 つは、表を 1 行直すたびに関数をデプロイし直すことになる点です。KVS に出しておけば、コードとデータを別々に更新できます。

逆に、表が小さくて滅多に変わらないなら、コードに書いてしまうほうが単純です。KVS の読み取りには料金もかかります（後で計算します）。03章の関数や、この本のサイトの関数（`book/infra/functions/url-rewrite.js`）が KVS を使っていないのは、切り替えるデータが無いからです。

## CloudFront Functions にできないこと

<!-- section: 10.limits -->

コードを書く前に、制約を見ておきましょう。ここを知らずに書き始めると、だいたい途中で引き返すことになります。公式ドキュメントから拾ったものを並べます。

- **ネットワークに出られない。** `fetch` も XHR もソケットもありません。外部の API を呼ぶ、DB を引く、はできません
- **ファイルシステム、`process`、環境変数が無い。** 設定を渡したければ、コードに書くか KVS に置きます
- **タイマーが無い。** `setTimeout`、`setImmediate` はありません。待つことも、後回しにすることもできず、関数は最後まで一気に走ります
- **時計が進まない。** `Date` は、1 回の実行のあいだずっと「関数が始まった時刻」を返します。処理時間は測れません
- **リクエストの body を読めない。** 見えるのは method、URI、query string、ヘッダー、cookie まで
- **`eval` と `Function` コンストラクタが使えない**
- **コードは 10 KB まで、メモリは 2 MB まで**
- **動くのは viewer request と viewer response だけ。** origin の手前や直後には置けません
- **1 つの関数に付けられる KVS は 1 つ**

実行時間にも上限がありますが、ドキュメントに「何ミリ秒」という数字はありません。比較表には「1 ミリ秒未満（submillisecond）」とあり、実際の消費は compute utilization という 0〜100 の値で報告されます。上限に対して何 % 使ったか、という数字です。

言語は JavaScript ですが、Node.js ではありません。runtime 2.0 は「ES 5.1 に準拠し、ES 6〜12 の一部に対応」と説明されていて、対応する機能が一覧になっています。`const`、`let`、`async`/`await`、アロー関数、テンプレートリテラルは載っています。optional chaining（`?.`）、spread、分割代入、`class`、`for...of` は載っていません。この章のコードは、載っているものだけで書きます。載っていないものが本当に動かないのかは、正直に言うと試せていません。

`console.log` も少し変わっていて、引数は 1 つだけ。`console.log("a", b)` とは書けません。

## 関数を読む

<!-- section: 10.router -->

では中身です。ファイルは `examples/10-edge/infra/functions/edge-router.js`。まず KVS の読み方から。

<<< @/examples/10-edge/infra/functions/edge-router.js{kvs}

`cloudfront` というモジュールを import して、`cf.kvs()` で関数に付いている KVS を取ります。読む方法は `get`、`exists`、`meta` の 3 つで、ここでは `get` だけを使います。

`get` は、キーが無いと reject します。なので `try`/`catch` で包んで、無ければ `null` を返すようにしました。ここに設計上の選択が 1 つ隠れています。キーが無いのと、読み取りそのものが失敗したのとを、この関数は区別しません。どちらも「ルール無し」として、サイトの配信を続けます。KVS が読めないときにサイトごと落ちるより、redirect が効かないほうがまし、という判断です。裏返すと、KVS が読めないあいだはメンテナンスのスイッチも効きません。

読み取りは `await` で 1 つずつ並べます。`Promise.all` でまとめたくなりますが、ドキュメントはこれを勧めていません。メモリを余計に使ううえ、今のところ速くもならないそうです。

次に本体です。

<<< @/examples/10-edge/infra/functions/edge-router.js{handler}

上から順に 3 段です。

メンテナンス中なら、ここで 503 を返して終わり。cache も origin も通りません。

そうでなければ redirect の表を引きます。ただし、最後の部分に `.` がある path（`/assets/app.css` のようなファイル）は引きません。ファイルを redirect することは無いので、asset のたびに 1 回の読み取りを節約できます。

どちらでもなければ URL を書き換えます。`/` は flag を見て `/index.html` か `/home-v2.html` に、`/pricing/` のような path は `/pricing/index.html` に。書き換えは cache を調べる前に起きるので、2 つのトップページは別々の URL として cache されます。flag を切り替えた瞬間に cache を消す必要はありません。

### redirect の値は、関数でもう一度疑う

<<< @/examples/10-edge/infra/functions/edge-router.js{redirect}

KVS の値は、この後で作る更新 script が検査してから書き込みます。それでも関数の側でもう一度確かめているのは、KVS がコンソールからも書けるからです。script を通らない値が入る道がある以上、最後に読む側で守ります。

守っているのは「サイトの外へ飛ばさない」こと。`https://...` や `//example.org` を値に書かれると、あなたのドメインの URL が、よそのサイトへの入口になってしまいます（open redirect と呼ばれる問題です）。`/` で始まり、`//` で始まらず、バックスラッシュを含まない path だけを受け付けます。

`cache-control` に 5 分を指定しているのも理由があります。寿命の指定が無い 301 を、ブラウザはずっと覚えます。表を間違えたとき、直しても読者の手元では直りません。

### メンテナンスの応答

<<< @/examples/10-edge/infra/functions/edge-router.js{maintenance}

関数は、リクエストを返すかわりに応答を返すことができます。`no-store` を付けて、この 503 がどこにも cache されないようにしています。ちなみに、関数が返した 400 以上の応答は、distribution のカスタムエラーページでは差し替えられません。

## Node.js で、同じファイルを動かす

<!-- section: 10.tests -->

03章と同じく、テストはデプロイするファイルそのものを読み込みます。写しを作ると、写しだけ直して本物を直し忘れますからね。ただ、今回は 1 つ問題があります。`import cf from "cloudfront"` です。このモジュールは edge にしかありません。

<<< @/examples/10-edge/src/local/load-function.ts{load}

やっていることは、import の 1 行を取り除いて、かわりに `cf` という名前の代用品を渡すこと。それ以外は 1 文字も変えません。import の行が想定と違えば、黙って進まずにエラーにします。

`node:vm` の新しい context には `fetch` も `setTimeout` も `process` も `require` もありません。関数がうっかりこれらを使えば、テストは `ReferenceError` で落ちます。本物の runtime の制約に、少しだけ似ています。

KVS の代用品はこれです。

<<< @/examples/10-edge/src/local/load-function.ts{stand-in}

本物と同じく、無いキーには reject します。もう 1 つ、読まれたキーを記録しています。読み取りは 1 回ごとに課金されるので、「asset のリクエストでは 1 回しか読まない」をテストで固定しておきたいからです。

```bash
vp run test:unit
```

`examples/10-edge/infra/test/edge-router.test.ts` が見ているのは、こんなことです。

- 書き換えと redirect が表のとおりに動く。query string が引き継がれる
- KVS に外部サイトへの redirect を直接書かれても、従わない
- メンテナンス中は、どの path も 503 で、origin へ行かない
- KVS が空でも、全部の読み取りが失敗しても、配信が続く
- 読み取りの回数が、ファイルで 1 回、ページで 2 回、トップページで 3 回
- ファイルが 10 KB に収まっている
- ドキュメントの一覧に無い構文（`?.`、spread、分割代入など）が紛れ込んでいない

最後のは parser ではなく、ただの文字列検索です。Node.js から来た手がつい書いてしまうものを拾う程度、と思ってください。

そして、ここが限界でもあります。動かしているのは Node.js です。runtime 2.0 が本当にこの構文を受け付けるか、2 MB のメモリに収まるか、実行時間の上限に収まるかは、このテストではわかりません。CloudFront には、公開前の関数にイベントを渡して実行し、結果と compute utilization を返してくれる test の機能があります。本物の runtime で確かめるのは、そちらの仕事です。
