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

## 手元で動かす

<!-- section: 10.local -->

テストだけでなく、ブラウザや `curl` でも触ってみましょう。

```bash
vp run dev:edge
```

<http://localhost:8790> で、関数と `site/` の中身がつながったサーバーが立ち上がります。Docker も AWS のアカウントも要りません。

```bash
curl -si http://localhost:8790/plans | head -n 3
curl -s http://localhost:8790/ | grep '<h1>'
curl -si 'http://localhost:8790/sale?ref=mail' | grep -i location
```

`/plans` は 301 で `/pricing/` へ。データは `examples/10-edge/edge-data.json` です。

<<< @/examples/10-edge/edge-data.json

サーバーを動かしたまま、`maintenance` を `true` に書き換えて保存してみてください。次のリクエストから 503 になります。`newHome` を `true` にすると、`/` の中身が入れ替わります。サーバー側のターミナルには、リクエストごとに KVS を何回読んだかが出ます。

<<< @/examples/10-edge/src/local/dev.ts{dev}

このサーバーが再現しないものを挙げておきます。

- **反映の遅れ。** ここでは、ファイルを保存した次のリクエストで値が変わります。本物の KVS はそうなりません。次の節で扱います
- **CloudFront の cache。** 毎回、関数と「origin」を通ります
- **runtime の制約。** 構文、サイズ、メモリ、実行時間
- **S3 の応答の細部。** 無いファイルには、ただの 404 を返しています

### cdkd の emulator でも動かせる

cdkd には、synth した distribution を手元で動かす機能があります。関数は cdkd が用意した実行環境で動き、KVS は JSON ファイルで代用できます。

```bash
vp run dev:edge:cdkd
```

こちらは <http://localhost:8791> です。上と同じ `curl` を試したところ、同じ応答が返ってきました。`import cf from "cloudfront"` も、ID なしの `cf.kvs()` も、そのまま動いています。S3 の origin と CloudFront Function だけなら Docker は要りませんでした。

ただ、これも CloudFront そのものではありません。cdkd の emulator が runtime 2.0 の制約をどこまで再現しているかは、調べていません。「2 つの別々の代用品で同じ結果になった」以上のことは言えない、と思っておいてください。Lambda@Edge は、この emulator では実行されず、警告だけ出して飛ばされます。

## KVS は何を約束してくれるのか

<!-- section: 10.kvs -->

KVS は名前のとおりキーと値の入れ物ですが、DynamoDB（[05章](/ja/chapters/05-dynamodb.md)）とは性格がかなり違います。

まず、大きさ。

<<< @/examples/10-edge/src/kvs/config.ts{limits}

キーは 512 バイト、値は 1 KB、1 つの KVS 全体で 5 MB まで。1 回の更新リクエストで触れるのは 50 キー（または 3 MB）までです。値に入れられるのは文字列、バイト列、JSON。設定の表を置く場所であって、アプリのデータを置く場所ではありません。

次に、誰が書けるか。関数は読むだけです。訪問回数を数える、のような「リクエストのたびに書く」使い方は、そもそもできません。

そして、いちばん大事な点。書いた値は、すぐには読めません。

```figure
caption: UpdateKeys が成功したあと、値は edge location ごとに別々の時刻に届き、t1 では 2 人の読者が別々の答えを受け取る
type: sequence
actor op: Operator
actor a: edge location A
actor b: edge location B
step op -> op: t0 UpdateKeys が成功
note a: t0 maintenance = off
note b: t0 maintenance = off
step op --> a: t1 届く
note a: t1 maintenance = on
note b: t1 maintenance = off
step op --> b: t2 届く
note a: t2 maintenance = on
note b: t2 maintenance = on
```

更新の API が成功を返した t0 の時点では、どの edge も古い値を読んでいるかもしれません。t1 では、東京の読者には 503 が、別の場所の読者には普通のページが返る、ということが起こりえます。t2 でようやく揃います。

t0 から t2 までがどれくらいか。Developer Guide には、数字も保証も見つけられませんでした。手がかりは 2 つだけです。`meta()` が返す最終更新時刻について「edge への伝播時間は含まない」と書かれていること。そして、提供開始時の AWS の公式ブログが「数秒で全 edge location に伝播する」と説明していることです。ブログは仕様書ではないので、この本では「たいていは数秒らしい。ただし上限は約束されていない」として扱います。実際に計ってもいません。

設計に落とすと、こうなります。

- **書いた直後に全拠点で読める、と仮定しない。** 「sync が終わった＝切り替わった」ではありません
- **途中の状態で困らないデータだけを置く。** redirect が数秒のあいだ古くても、誰も困りません。逆に「この瞬間から全員を確実に締め出す」が必要なら、KVS のスイッチは向いていません
- **順番に依存しない。** 「A を書いてから B を書いたので、B が見える edge では必ず A も見える」とは、ドキュメントのどこにも書かれていません

なお、1 回の関数の実行の途中で値が変わることはありません。ドキュメントによれば、更新は実行と実行のあいだに処理されます。

### データの形を決める

`edge-data.json` を、KVS のキーと値に変換します。その前に schema で検査します。

<<< @/examples/10-edge/src/kvs/config.ts{schema}

関数が守っていた「サイトの外へ飛ばさない」を、書く側でも守ります。加えて、ここでしか見つけられない間違いを拾います。同じ `from` が 2 回ある。redirect の先がさらに redirect されている（1 行直したら loop になる、の一歩手前です）。関数が絶対に引かない path（拡張子つき、長すぎる）が `from` に書かれている。

<<< @/examples/10-edge/src/kvs/config.ts{entries}

flag は、off のときもキーを消さずに `"off"` と書きます。こうしておくと、関数の `get` は例外の道を通らずに済みます。

## 表を安全に書き換える

<!-- section: 10.sync -->

KVS の中身を `edge-data.json` に合わせる script を書きます。「全部消して全部入れ直す」のがいちばん簡単ですが、それをやると、消してから入れ直すまでのあいだ redirect が全部止まります。差分だけを送りましょう。

<<< @/examples/10-edge/src/kvs/plan.ts{plan}

入れるもの、消すもの、そのままのもの。純粋な関数なので、AWS なしでテストできます。

1 つ、線を引いています。この script が消すのは、`flag:` と `redirect:` で始まるキーだけ。それ以外のキーが KVS にあっても、見つけたと報告するだけで触りません。同じ KVS を別の用途と共有していたときに、他人のデータを「desired に無いから」と消さないためです。

### ETag で、見ていない変更を踏まない

2 人が同時に表を書き換えたら、どうなるでしょう。あなたが KVS を読んで差分を計算しているあいだに、同僚がコンソールで 1 行直した。あなたの差分は古い中身をもとにしているので、そのまま書くと、同僚の変更を知らないうちに上書きするかもしれません。

KVS の API は、これを防ぐ仕組みを持っています。KVS には版を表す ETag があって、書き込みには「私が読んだのはこの版です」という `If-Match` を必ず添えます。版が進んでいれば、書き込みは拒否されます。05章の条件付き書き込みと同じ考え方で、楽観的な更新と呼ばれるものです。

<<< @/examples/10-edge/src/kvs/sync.ts{port}

script から見た KVS は、この 2 つの操作だけです。本物（AWS SDK を呼ぶもの）とテスト用の代用品が、同じ形を実装します。

<<< @/examples/10-edge/src/kvs/sync.ts{sync}

ポイントは、やり直しのたびに読み直して、計画を立て直すことです。古い計画をもう一度送ることは、決してしません。

これで、失敗の種類ごとに何が起きるかが決まります。

- **誰かが先に書いた。** 拒否されるので、読み直します。新しい計画は、相手の変更を見たうえで立てられます
- **書き込みは届いたのに、応答が届かなかった。** タイムアウトや切断です。書けたのかどうか、こちらからはわかりません。読み直せばわかります。書けていれば差分は空になり、二重には送られません
- **複数のリクエストの途中で止まった。** 50 キーを超える変更は、複数のリクエストに分かれます。1 つのリクエストは全部成功か全部失敗かのどちらかですが、リクエストの列全体はそうではありません。途中で止まると、KVS は半分だけ新しい状態で残ります。もう一度実行すれば、残りだけが送られます
- **何度やっても競合する。** 5 回であきらめて、エラーにします。永遠には回りません
- **権限が無い、値が不正。** やり直しても結果は同じなので、すぐ止まります

守りたいことを 1 文にすると、「sync は、自分が読んでいない変更を上書きしない。そして、どこで失敗しても、もう一度実行すれば `edge-data.json` に収束する」。`examples/10-edge/test/sync.test.ts` は、ETag を持つ代用品の KVS に対して、上の失敗を 1 つずつ決まった順序で起こして、この文が壊れないことを確かめます。

### AWS を呼ぶところ

<<< @/examples/10-edge/src/kvs/store.ts{adapter}

読む順番に注意してください。先に ETag、後で中身です。逆にすると、「新しい ETag」と「古い中身」の組ができることがあります。その組で書き込むと、ETag は合っているので通ってしまい、見ていない変更を上書きします。先に ETag を取っておけば、ずれたときは必ず「古い ETag」の側に倒れて、拒否されます。

ここで、KVS の API の変わったところが 2 つ出てきます。

1 つは、API が 2 つあること。KVS という入れ物を作ったり消したりするのは、普通の CloudFront の API。中のキーと値を読み書きするのは、CloudFront KeyValueStore という別の API です。どちらにも `DescribeKeyValueStore` があり、返す ETag は別物で、入れ替えて使えません。

もう 1 つは署名です。キーと値の API はリージョンを持たない global な endpoint で、SigV4A という署名方式を使います。AWS SDK for JavaScript は、そのための署名の実装を別パッケージにしています。公式ドキュメントの例は CRT（ネイティブのバイナリ）を使う `@aws-sdk/signature-v4-crt` を読み込んでいますが、この章では JavaScript だけで動く `@aws-sdk/signature-v4a` を使いました。SDK のソースを読むと、どちらかが読み込まれていれば使われます。手元のテストでは、署名のヘッダーが SigV4A の形式（`AWS4-ECDSA-P256-SHA256`）になることまで確かめています。AWS がその署名を受け付けることは、まだ確かめていません。

エラーの振り分けはこうです。

<<< @/examples/10-edge/src/kvs/store.ts{errors}

正直に言うと、ここには確かめられていない点があります。API リファレンスには `ConflictException`（409）が載っていますが、「古い ETag を送ったときに返るのはこれだ」とは書かれていません。この adapter は `ConflictException` だけを競合として扱います。もし実際には別のエラーが返るなら、sync はやり直さずにエラーで止まります。上書きはしないので安全な側ですが、直すべき点です。

## AWS にのせる準備

<!-- section: 10.infra -->

CDK の stack は、03章のものに KVS を足した形です。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{store}

KVS は空で作ります。CDK には、作成時にファイルからキーと値を取り込む指定（import source）もあるのですが、使いませんでした。取り込みができるのは、KVS を最初に作るときだけです。あとから `edge-data.json` を直しても反映されず、反映させようとすると KVS の作り直しになります。「入れ物は stack のもの、中身は `edge-data.json` と sync のもの」と、持ち主を分けました。

作りたての KVS は空っぽですが、それで構いません。関数は、キーが無ければ何もせずに通すように書いてあります。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{router}

`keyValueStore` を渡すと、CDK は関数と KVS を関連付けます。runtime は 2.0 を明示しています。

テスト（`infra/test/edge-stack.test.ts`）が見ているのは、bucket が非公開で、読めるのがこの distribution だけであること。関数が runtime 2.0 で、KVS がちょうど 1 つ付いていること。KVS が空で作られ、stack と一緒に消えること。そして、使っているリソースの種類の一覧です。

### cdkd はこのリソースをどう扱うか

固定した版の cdkd（0.296.28）のソースを読みました。

| リソースの種類 | cdkd での扱い |
| --- | --- |
| `AWS::S3::Bucket`、`AWS::S3::BucketPolicy` | 専用の実装 |
| `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl` | 専用の実装 |
| `AWS::CloudFront::Function` | Cloud Control API 経由 |
| `AWS::CloudFront::KeyValueStore` | Cloud Control API 経由。stateful 扱い |

「stateful 扱い」というのは、cdkd が「消えるとデータが失われる種類」の一覧に KVS を入れている、という意味です。KVS の置き換えが必要な変更（名前を変える、など）をしようとすると、cdkd は止まって、`--force-stateful-recreation` を付けて実行し直すよう求めます。中身は sync でいつでも入れ直せるので、この章の KVS なら付けて構いません。ただし、作り直した直後の KVS は空です。関数は空でも動きますが、redirect と flag は、もう一度 sync するまで効きません。

ここまではソースから読み取ったことで、実際の AWS で cdkd がこれらを作れるかは、まだ確かめていません。

## デプロイして、切り替えてみる

<!-- section: 10.deploy -->

```bash
vp run edge:infra:diff
vp run edge:infra:deploy
vp run edge:publish
```

`site/` の 3 つの HTML を bucket に置くところまでです。この時点で KVS は空なので、`/` は `index.html` を返し、`/plans` は 404 になります。

次に、表を入れます。まず差分を見て、それから書きます。

```bash
vp run edge:kvs:plan
vp run edge:kvs:sync
```

`edge:kvs:plan` は KVS を読むだけで、何も変えません。`edge:kvs:sync` は、送った計画と、新しい ETag を表示します。

```bash
curl -sI https://dxxxxxxxxxxxx.cloudfront.net/plans | head -n 3
```

301 と `location: /pricing/` が返れば、表が届いています。sync の直後に試して 404 だったら、少し待ってもう一度。さっきの t0 と t2 のあいだにいるだけかもしれません。

メンテナンスのスイッチも試しましょう。`edge-data.json` の `maintenance` を `true` にして sync し、状態コードを何度か見ます。

```bash
vp run edge:kvs:sync
curl -s -o /dev/null -w '%{http_code}\n' https://dxxxxxxxxxxxx.cloudfront.net/
```

200 と 503 が混ざる時間があるかもしれません。それが結果整合です。終わったら `false` に戻して、もう一度 sync してください。

drift の検査は、これまでの章と同じです。

```bash
vp run edge:infra:drift
```

KVS の中身（キーと値）は template に無いので、drift の検査の対象外です。中身のずれは `edge:kvs:plan` で見ます。sync 以外の手段（コンソールなど）で誰かが書き換えていれば、ここに差分として出ます。

正直に言うと、この節の手順は、まだ実際の AWS で通せていません。

## body を読みたくなったら: Lambda@Edge

<!-- section: 10.lambda-edge -->

CloudFront Functions で足りなくなる場面は、はっきりしています。外部の API や DB を呼びたい。リクエストの body を見たい。ミリ秒では終わらない処理をしたい。origin の手前や直後で動かしたい。npm のライブラリを使いたい。

そのときの選択肢の 1 つが Lambda@Edge です。ふつうの Lambda 関数（[04章](/ja/chapters/04-http-api.md)）を CloudFront が各地に複製して、リクエストの途中で呼んでくれます。ネットワークにも出られるし、body も読めます。そのかわり、Lambda としては窮屈な決まりがたくさんあります。

- **関数は `us-east-1` に作る。** 東京ではだめです
- **番号つきの version を指定する。** `$LATEST` も alias も使えません。コードを直すたびに新しい version を作って、distribution を更新します
- **環境変数が使えない。** 予約済みのものを除きます。設定はコードに焼き込むか、実行時にどこかから取ってきます
- **VPC に入れない。** layer、X-Ray、dead letter queue、provisioned concurrency、コンテナイメージも使えません
- **arm64 が使えない。** x86_64 だけです
- **実行 role は、`lambda.amazonaws.com` と `edgelambda.amazonaws.com` の両方が引き受けられること**
- **timeout は 30 秒まで**
- **関数が作る応答の大きさ**: viewer 側のイベントで 40 KB、origin 側で 1 MB まで
- **body を読むときの切り詰め**: viewer request で 40 KB、origin request で 1 MB。それより長い body は、頭の部分だけが渡されます

もう 1 つ、組み合わせの決まりがあります。1 つの cache behavior の、1 つのイベントに付けられる関数は 1 つだけ。そして viewer 側のイベント（viewer request と viewer response）では、CloudFront Functions と Lambda@Edge を混ぜられません。viewer request に CloudFront Function、origin request に Lambda@Edge、という組み合わせは許されています。この章の構成がそれです。

### 最小の例: body の digest を返す

CloudFront Functions に絶対できないことを 1 つ、小さくやってみます。POST された body の大きさと SHA-256 を返す関数です。

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{digest}

origin request で動いて、origin には聞かずに自分で応答を返します。`truncated` を応答に入れているのは、1 MB を超えた body では、関数が見ているのが頭の部分だけだからです。頭だけの digest を、全体の digest のような顔で返すわけにはいきません。

これ自体は、動くことを見るための例です。現実の使い道で近いのは、webhook の署名の検証でしょう。body 全体の HMAC を計算して、合わなければ origin に届く前に断る。ただ、それには秘密の鍵が要ります。環境変数は使えないので、Secrets Manager などへネットワーク越しに取りに行くことになり、今度は遅延と料金と権限の話が始まります。「edge でやる」ことの値段は、たいていこういう形で出てきます。

イベントは、型の外から来る値です。使う部分だけを schema で確かめます。

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{event}

### 東京の外にある stack

<<< @/examples/10-edge/infra/bin/app.ts{stacks}

Lambda@Edge の関数は `us-east-1` に作るしかないので、この stack だけリージョンが違います。distribution のある stack とは別にして、つなぎは version の ARN を手で渡す形にしました。CDK には、リージョンをまたいで自動でつないでくれる仕組み（`EdgeFunction`）もあります。ただ、裏で custom resource と別の stack が増えて、cdkd がそれをどう扱うかを追いきれませんでした。ここでは、何が作られるかが全部見える形を選んでいます。

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{role}

ログの権限に、リージョンの `*` が入っています。この本では「`*` を使わない」を守ってきましたが、ここは避けられません。Lambda@Edge の関数は、実行された場所に近いリージョンにログを書きます。log group の名前はどのリージョンでも `/aws/lambda/us-east-1.<関数名>` で、どのリージョンで動くかは読者の居場所で決まるからです。log group の名前のほうは固定してあります。

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{function}

`awsSdkConnectionReuse: false` は見落としやすいところです。CDK の `NodejsFunction` は、何も言わなければ環境変数を 1 つ足します。Lambda@Edge は環境変数を持つ関数を受け付けないので、止めておきます。テストは、template に環境変数、VPC、layer の設定が無いことを見ています。

distribution の側は、version の ARN をもらったときだけ behavior を足します。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{digest}

ARN の形は、stack に渡す時点で検査しています。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{props}

`$LATEST`、alias、別のリージョンの ARN は、synth の段階でエラーになります。デプロイの途中で CloudFront に断られるより、ずっと早く気づけます。

### デプロイの手順

```bash
AIH_AWS_REGION=us-east-1 vp run infra:bootstrap
vp run edge:body:infra:deploy
vp run edge:infra:deploy -c bodyDigestVersionArn=arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:1
curl -s -X POST --data 'hello edge' https://dxxxxxxxxxxxx.cloudfront.net/digest
```

2 行目の出力に `BodyDigestVersionArn` が出るので、3 行目に渡します。

ここは、この章でいちばん確かめられていない部分です。cdkd のソースを読むかぎり、stack にリージョンが書いてあれば、cdkd はそのリージョンを使います。ビルドした関数のコードを置く場所も `us-east-1` に要りそうなので、1 行目で用意しています。ただ、どれも実行していません。cdkd は `AWS::Lambda::Version` を Cloud Control API 経由で扱います（`AWS::Lambda::Function`、`AWS::IAM::Role`、`AWS::IAM::Policy` は専用の実装）。Node.js 24 が Lambda@Edge で使えることも、個別には確認していません。ドキュメントは「最新の Node.js に対応」としか書いていないからです。

## どこに置くか

<!-- section: 10.placement -->

ここまでの材料を、1 枚の表にします。

| | 静的な配信 | CloudFront Functions | Lambda@Edge | リージョンの Lambda |
| --- | --- | --- | --- | --- |
| 動く場所 | edge の cache | edge location | 読者に近いリージョン（複製） | 1 つのリージョン（この本では東京） |
| 動くタイミング | - | viewer request、viewer response | 4 つのイベントすべて | 呼ばれたとき（04章） |
| ネットワーク | - | 出られない | 出られる | 出られる |
| body | - | 読めない | 読める（切り詰めあり） | 読める |
| 状態 | cache だけ | KVS を読むだけ | 自分では持たない。外へ取りに行く | DynamoDB などへ（05章） |
| 実行時間 | - | 1 ミリ秒未満 | 30 秒まで | Lambda の上限まで（HTTP API 経由なら 30 秒） |
| コードの大きさ | - | 10 KB | 50 MB（圧縮後） | Lambda の上限まで |
| 設定の渡し方 | - | コードか KVS | コードか、実行時に取得 | 環境変数など |
| 100 万回あたりの定価 | リクエスト料金だけ | USD 0.10 | USD 0.60 と実行時間 | USD 0.20 と実行時間 |

迷ったときの順番は、左からです。

**静的に配れるなら、配る。** cache された応答は、コードを 1 行も動かしません。いちばん速くて、いちばん安くて、壊れる部品がいちばん少ない。

**リクエストとヘッダーだけで決まるなら、CloudFront Functions。** URL の書き換え、redirect、ヘッダーの追加、署名済みトークンの検査。全リクエストで動かしても気にならない単価です。

**ほかのサービスを呼ぶなら、まずリージョンの Lambda を考える。** データが東京にあるなら、コードも東京に置くのが素直です。読者に近い場所でコードを動かしても、そこから東京の DB まで往復するなら、近さの意味は薄れます。

**Lambda@Edge は、「cache の手前か直後で、どうしてもコードが要る」とき。** origin を選び分ける、origin の応答を加工して cache に入れる、body を見て origin に届く前に断る。そういう、CloudFront の流れの途中でしかできない仕事のためのものです。version の管理、`us-east-1`、環境変数なし、各リージョンに散らばるログ。運用の手間は 4 つの中でいちばん重いので、最後の選択肢にしておくのがいいと思います。

## Workers から来た人へ

<!-- section: 10.workers -->

Cloudflare Workers を使ってきた人は、この章を読みながら「それ、Worker 1 つで全部できるのでは」と思ったはずです。そのとおりです。率直に並べます。

| | Cloudflare Workers | CloudFront Functions | Lambda@Edge |
| --- | --- | --- | --- |
| ネットワーク（`fetch`） | できる。1 回の呼び出しで subrequest は Free 50、Paid は既定 10,000 | できない | できる |
| CPU 時間 | Free 10 ミリ秒、Paid は既定 30 秒（最大 5 分）。`fetch` や KV を待つ時間は数えない | 1 ミリ秒未満 | 実行時間で 30 秒まで |
| メモリ | isolate あたり 128 MB | 2 MB | viewer 側 128 MB、origin 側は Lambda の上限まで |
| コードの大きさ | 64 MiB（非圧縮） | 10 KB | 50 MB（圧縮後） |
| KV への書き込み | Worker から書ける | 関数からは書けない | KVS は使えない |
| KV の値の大きさ | 25 MiB | 1 KB（全体で 5 MB） | - |
| KV の整合性 | 結果整合。他の拠点では 60 秒以上かかることがある、と明記 | 遅れがある。数字は Developer Guide に見つからず | - |

CloudFront Functions は、Workers の対応物ではありません。名前と「edge で JavaScript が動く」という見た目は似ていますが、できることの桁が違います。Workers はアプリを書く場所で、CloudFront Functions は CDN の設定をコードで書く場所、くらいに思っておくと混ざりません。

AWS で Workers に近いことをしようとすると、部品を組み合わせることになります。入口の小さな判断は CloudFront Functions、アプリは東京の Lambda、データは DynamoDB。この本がここまでやってきた構成です。部品が多いのは事実で、「1 つの Worker に binding を足していく」あの手軽さは、AWS にはありません。

かわりに何があるかというと、部品ごとの境界です。CloudFront Functions は、ネットワークに出られないので、どう書いても外部の障害に巻き込まれません。全リクエストで動かしても 100 万回で USD 0.10 です。この絞り方が合う仕事なら、よくできた道具だと思います。

KV どうしの比較も 1 つだけ。Workers KV は「最大 60 秒以上」と、遅れの目安をドキュメントに書いています。CloudFront KVS は、Developer Guide に数字を見つけられませんでした。どちらも「書いた直後に全拠点で読める」とは言っていない、という点は同じです。

料金は、Workers の Standard プランが月 1,000 万リクエストと 3,000 万 CPU ミリ秒を含み、以降は 100 万リクエストあたり USD 0.30、100 万 CPU ミリ秒あたり USD 0.02。月額そのものは、この章では確認していません。

## お金の話

<!-- section: 10.cost -->

金額は USD、日本の edge、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

置いてあるだけでかかる料金は、この章の構成にはありません。distribution も、関数も、呼ばれなければ 0 です。S3 の保存量は 3 つの HTML で数 KB。KVS については、Price List に載っている項目は「関数からの読み取り」と「API 操作」の 2 つだけで、保存量に対する項目は見つかりませんでした。

使うと、こうなります。月 100 万リクエスト、うちトップページ 10%、その他のページ 20%、ファイル 70%、sync を月 20 回という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| CloudFront の HTTPS リクエスト | 100 万件 | 1.20 | 0 |
| CloudFront から読者への転送 | 19.07 GB | 2.17 | 0 |
| CloudFront Functions の実行 | 100 万回 | 0 | 0 |
| KVS の読み取り | 140 万回 | 0 | 0 |
| KVS の API 操作 | 80 回 | 0.08 | 0.08（無料枠は確認できず、引いていない） |
| Lambda@Edge のリクエスト | 1 万件 | 0.01 | 0.01 |
| Lambda@Edge の実行時間 | 62.5 GB 秒 | 0.00 | 0.00 |
| S3 への GET | 333,333 件 | 0.12 | 0.12 |
| 小計 | | **3.59** | **0.21** |

関数の実行と KVS の読み取りは、Price List の最初の段階（月 200 万回まで）がもともと USD 0 なので、定価の列も 0 です。それを超えると、実行は 100 万回あたり USD 0.10、読み取りは 100 万回あたり USD 0.03 になります。

読み取りの回数は、関数の書き方で変わります。この章の関数は、ファイルなら 1 回、ページなら 2 回。もし全リクエストで 3 回読んでいたら、300 万回になって無料の段階を超えます。「ファイルは redirect の表を引かない」という 1 行は、こういうところに効いてきます。

KVS の API 操作は、1,000 回あたり USD 1。関数の中の読み取りより、桁がずっと高い単価です。1 回の sync は 3 回の呼び出し（版の確認、一覧、更新）なので USD 0.003 ほどですが、キーが増えると一覧のページ数（50 件ごと）だけ増えます。CI から頻繁に `edge:kvs:plan` を回す、のような使い方をするなら、数えておいてください。

Lambda@Edge は、100 万リクエストあたり USD 0.60 と、1 GB 秒あたり USD 0.00005001。料金ページによると無料枠はありません。東京の Lambda（arm64）の 1 GB 秒あたり USD 0.0000133334 と比べると、実行時間の単価はおよそ 3.75 倍です。この表に入れていないものとして、Lambda@Edge が各リージョンに書くログ（CloudWatch Logs）の料金があります。

無料枠は従量課金の場合のもので、アカウント全体で共有です。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| sync したのに、古い値が返る | まず待つ。edge への伝播には時間がかかります。`edge:kvs:plan` で差分が空なら、KVS には入っています |
| sync が認証のエラーで止まる | KVS の API は SigV4A で署名します。一時的な認証情報は version 2 の session token が必要で、STS の global endpoint（`sts.amazonaws.com`）が出すものは使えません。リージョンの STS endpoint を使う設定になっているか確認 |
| sync が「store is PROVISIONING」で止まる | KVS を作った直後です。`READY` になるまで待つ |
| デプロイ後、redirect が全部効かない | KVS が空ではありませんか。作り直した直後の KVS は空です。`edge:kvs:sync` をもう一度 |
| 手元のテストは通るのに、関数の作成が構文エラーになる | ドキュメントの一覧に無い構文を使っていませんか。Node.js は受け付けても、runtime 2.0 が受け付けないものがあります |
| `/digest` が 502 を返す | Lambda@Edge の応答が CloudFront の検査に通っていません。ログは `us-east-1` ではなく、実行されたリージョンの `/aws/lambda/us-east-1.aih-edge-body-digest` にあります |
| Lambda@Edge の関数を消せない | 複製が残っています。distribution から外してから、消えるまで数時間かかります |
| メンテナンスにしたのに、一部のページが見える | 伝播の途中か、ブラウザが前の応答を持っているかです。503 には `no-store` を付けているので、CloudFront の cache ではありません |

## 本番にするなら

- **KVS を書ける人を絞る。** `edge-data.json` を review して merge し、CI だけが sync する。コンソールからの直接の編集は、緊急時だけにします。この章の script は、直接の編集を次の `edge:kvs:plan` で差分として見せてくれます
- **メンテナンスのスイッチを、唯一の防御にしない。** 伝播には遅れがあり、KVS が読めないあいだは効きません。データを守るための締め出しは、origin の側でも行います
- **関数の指標を見る。** エラーと compute utilization です（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）。utilization が上限に近いなら、読み取りの回数や JSON の大きさを見直します
- **表の大きさを見積もる。** 5 MB、値は 1 KB。数万件の redirect を入れるつもりなら、先に計算を
- **Lambda@Edge の log group に保持期間を付ける。** 実行されたリージョンごとに自動で作られます。stack の外にあるので、自分で設定します
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 10.cleanup -->

```bash
vp run edge:unpublish --yes
vp run edge:infra:destroy
```

bucket、distribution、関数、KVS が消えます。KVS の中身も一緒です（`edge-data.json` があれば、いつでも入れ直せます）。

Lambda@Edge を試した場合は、順番があります。先に上の `edge:infra:destroy`（または、`-c bodyDigestVersionArn` なしの `edge:infra:deploy`）で distribution から外します。それから数時間待ちます。CloudFront が各地の複製を消し終わるまで、関数は消せません。

```bash
vp run edge:body:infra:destroy
```

これで残るものが 3 つあります。

- **Lambda@Edge の log group。** 実行されたリージョンごとの `/aws/lambda/us-east-1.aih-edge-body-digest` です。stack の外で自動的に作られたものなので、stack を消しても残ります。保存料金がかかり続けるので、CloudWatch のコンソールで、リージョンを切り替えながら消してください
- **service-linked role。** `AWSServiceRoleForLambdaReplicator` と `AWSServiceRoleForCloudFrontLogger` です。Lambda@Edge を初めて使ったときに自動で作られます。料金はかかりません
- **cdkd の保存場所。** `us-east-1` で bootstrap したなら、そちらにも残ります（02章）

::: details この章の検証メモ

**手元で確かめたこと。** 関数（デプロイするファイルを `node:vm` で実行）、KVS の計画と同期、SDK の adapter、Lambda@Edge の handler、2 つの stack のユニットテスト。型検査。synth（esbuild の bundle 込み、`-c bodyDigestVersionArn` あり・なし）。`dev:edge` を起動して、本文の `curl` と、`edge-data.json` の flag の切り替えを実行。`dev:edge:cdkd`（cdkd の emulator、Docker なし）を起動して、同じ `curl` で同じ応答を確認。SDK の client が SigV4A の形式で署名すること（ネットワークには出ていません）。

**まだ確かめていないこと。** AWS では何も実行していません。とくに、次の点は実環境での確認待ちです。`edge-router.js` が runtime 2.0 で動くこと（構文、10 KB、2 MB、compute utilization、ID なしの `cf.kvs()`、無いキーで `get()` が reject すること）。KVS の更新が edge に届くまでの時間。古い `If-Match` に KVS の API が返すエラーの種類。`@aws-sdk/signature-v4a` の署名を AWS が受け付けること。cdkd が `AWS::CloudFront::KeyValueStore` と `AWS::CloudFront::Function`、`us-east-1` の stack の `AWS::Lambda::Version` を実際に扱えること、`us-east-1` での bootstrap が必要かどうか。Node.js 24 が Lambda@Edge で使えること。Lambda@Edge の複製の削除にかかる時間、log group が作られる場所。「ハマりどころ」の表の症状は、ドキュメントから組み立てたもので、実際に起こして確かめたものではありません。runtime 2.0 の一覧に無い構文が実際に拒否されるかも、試していません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/10-edge/infra/lib/edge-stack.ts`、`infra/bin/app.ts` | - |
| 関数を読む | `examples/10-edge/infra/functions/edge-router.js`、`edge-data.json` | `test:unit` |
| Node.js で、同じファイルを動かす | `examples/10-edge/src/local/load-function.ts`、`infra/test/edge-router.test.ts` | `test:unit`、`typecheck` |
| 手元で動かす | `examples/10-edge/src/local/dev.ts`、`site/`、`scripts/kvs-file.ts` | `dev:edge`、`dev:edge:cdkd` |
| KVS は何を約束してくれるのか | `examples/10-edge/src/kvs/config.ts`、`test/kvs.test.ts` | `test:unit` |
| 表を安全に書き換える | `examples/10-edge/src/kvs/plan.ts`、`src/kvs/sync.ts`、`src/kvs/store.ts`、`scripts/kvs-sync.ts`、`test/sync.test.ts`、`test/store.test.ts` | `edge:kvs:plan`、`edge:kvs:sync`、`test:unit` |
| AWS にのせる準備 | `examples/10-edge/infra/lib/edge-stack.ts`、`infra/test/edge-stack.test.ts`、`cdk.json` | `edge:infra:synth`、`test:unit` |
| デプロイして、切り替えてみる | `tools/src/infra/`、`tools/src/site/publish.ts`、`examples/10-edge/scripts/kvs-sync.ts` | `edge:infra:diff`、`edge:infra:deploy`、`edge:publish`、`edge:kvs:plan`、`edge:kvs:sync`、`edge:infra:drift` |
| body を読みたくなったら: Lambda@Edge | `examples/10-edge/src/lambda-edge/body-digest.ts`、`infra/lib/body-digest-stack.ts`、`infra/test/body-digest-stack.test.ts`、`test/body-digest.test.ts` | `edge:body:infra:synth`、`edge:body:infra:deploy`、`edge:body:infra:destroy`、`test:unit` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
| 片付け | `tools/src/site/unpublish.ts`、`tools/src/infra/` | `edge:unpublish`、`edge:infra:destroy`、`edge:body:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-11）

- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [JavaScript runtime 2.0 features for CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html)
- [CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html)、[Test functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/test-function.html)
- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html)、[Helper methods for key value stores](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html)、[Work with key value data](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html)、[Create a key value store](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create.html)、[File format for key-value pairs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create-s3-kvp.html)
- CloudFront KeyValueStore API: [UpdateKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html)、[ListKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_ListKeys.html)
- [CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
- [Differences between CloudFront Functions and Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html)、[Restrictions on all edge functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html)、[Edge function logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-logs.html)
- [Restrictions on Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html)、[Set up IAM permissions and roles for Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-permissions.html)、[Delete Lambda@Edge functions and replicas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html)
- [AWS News Blog: Introducing Amazon CloudFront KeyValueStore](https://aws.amazon.com/blogs/aws/introducing-amazon-cloudfront-keyvaluestore-a-low-latency-datastore-for-cloudfront-functions/)（仕様書ではなく、提供開始時の紹介記事）
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)、AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json)
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[KV Limits](https://developers.cloudflare.com/kv/platform/limits/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[`src/provisioning/register-providers.ts`（v0.296.28）](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/src/provisioning/register-providers.ts)
- [@aws-sdk/signature-v4a 3.1138.0](https://registry.npmjs.org/@aws-sdk/signature-v4a)（導入したパッケージのソースも参照）

:::
