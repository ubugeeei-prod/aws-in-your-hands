---
title: "10 Edge: CloudFront Functions、KeyValueStore、Lambda@Edge"
revision: 4
---

# 10 Edge: CloudFront Functions、KeyValueStore、Lambda@Edge

[03章](/ja/chapters/03-spa.md)では、十数行の関数を CloudFront に付けました。パスに `.` が無ければ `index.html` に書き換える関数です。この章では、エッジで動くこの小さなコードに、もう少し仕事をさせます。

作るものは、古い URL を新しい URL へ送るリダイレクトの表、トップページを新しい版に切り替える機能フラグ（feature flag）、サイト全体をメンテナンス表示にするスイッチの 3 つです。どれもデプロイし直さずに切り替えたいので、データは CloudFront KeyValueStore に置き、関数から読みます。

そのうえで、ある処理をどこに置くのがよいかを考えます。CloudFront Functions にできないことは意外に多いので、足りないときの選択肢として Lambda@Edge も 1 つだけ動かし、最後に Cloudflare Workers と並べて比べます。

前提は 03章です。コードは `examples/10-edge/` にあります。

## 全体像

<!-- section: 10.architecture -->

```figure
caption: 読者のリクエストはキャッシュより先に CloudFront Function を通り、関数が KeyValueStore を読んで、その場で応答するか先へ流すかを決める
node reader: 読者
node fn: CloudFront Function "edge-router" | viewer-request, ランタイム 2.0
node cache: CloudFront のキャッシュ
node kvs: KeyValueStore
node digest: Lambda@Edge "body-digest" | origin-request, 任意, /digest だけ
node resp: 応答
node s3: S3 バケット | 非公開, ap-northeast-1
edge reader -> fn: HTTPS
edge fn --> reader: 503 か 301/302: ここで応答、先は動かない
edge fn -> cache: それ以外: URI を書き換えて渡す
edge fn -> kvs: 読むだけ
edge cache -> digest: miss
edge cache --> resp: hit
edge digest -> s3
group edge: CloudFront のエッジロケーション = fn, cache, kvs
mark fn
```

```figure
caption: 値を書き換える道は関数の外にあり、書いた値がエッジロケーションに届くまでには遅れがある
node op: 運用者 | edge-data.json
node api: KeyValueStore API | グローバルなエンドポイント, SigV4A, If-Match: ETag
node kvs: CloudFront KeyValueStore | flag:maintenance, redirect:<path>, flag:new-home
edge op -> api: vp run edge:kvs:sync
edge api --> kvs: エッジロケーションへの伝播: すぐではない
mark kvs
```

1 つ目の図は、読者のリクエストが通る道です。CloudFront はリクエストを受け取ると、キャッシュを調べる前に関数を呼びます。このタイミングを viewer request と呼びます。関数は KeyValueStore（以下 KVS）を読み、その場で応答を返すか、URL を書き換えて先へ流すかを決めます。

2 つ目の図は、表やスイッチを書き換える道です。関数は KVS を読めるだけで、書けません。値は関数の外から専用の API で書き、書いた値が世界中のエッジロケーションに届くまでには時間がかかります。読む道と書く道が分かれていて、そのあいだに遅れがあることが、この章全体の前提になります。

### 表を関数に書かない理由

リダイレクトが 3 件なら、関数のコードに直接書いても済みます。そうしなかった理由は 2 つあります。1 つは、関数のコードが 10 KB までで、この上限を引き上げられないことです。表が大きくなると入らなくなります。もう 1 つは、表を 1 行直すたびに関数をデプロイし直すことになる点です。表を KVS に出しておけば、コードとデータを別々に更新できます。

反対に、表が小さくて滅多に変わらないなら、コードに書いてしまうほうが単純です。KVS の読み取りには料金もかかり、金額は[費用のページ](/ja/chapters/10-edge/wrap.md)で計算します。03章の関数や、この本のサイトの関数（`book/infra/functions/url-rewrite.js`）が KVS を使っていないのは、切り替えるデータが無いからです。

## CloudFront Functions にできないこと

<!-- section: 10.limits -->

コードを書く前に、制約を確認しておきます。制約を知らずに書き始めると、途中で設計からやり直すことになりがちです。公式ドキュメントに書かれている制約は次のとおりです。

- ネットワークに出られません。`fetch` も XHR もソケットも無いので、外部の API を呼ぶことも、データベースを引くこともできません
- ファイルシステム、`process`、環境変数がありません。設定を渡すには、コードに書くか KVS に置きます
- タイマーがありません。`setTimeout` も `setImmediate` も無いので、待つことも後回しにすることもできず、関数は最後まで一気に走ります
- 時計が進みません。`Date` は 1 回の実行のあいだ、関数が始まった時刻を返し続けるので、処理時間は測れません
- リクエストボディを読めません。見えるのはメソッド、URI、クエリ文字列、ヘッダー、cookie までです
- `eval` と `Function` コンストラクタが使えません
- コードは 10 KB まで、メモリは 2 MB までです
- 動くのは viewer request と viewer response だけです。オリジンの手前や直後には置けません
- 1 つの関数に付けられる KVS は 1 つです

実行時間にも上限がありますが、ドキュメントにミリ秒単位の数字はありません。比較表には「1 ミリ秒未満（submillisecond）」とあり、実際に使った量は compute utilization として報告されます。compute utilization は、上限に対して何 % 使ったかを表す 0〜100 の値です。

言語は JavaScript ですが、Node.js ではありません。JavaScript runtime 2.0（以下、ランタイム 2.0）は「ES 5.1 に準拠し、ES 6〜12 の一部に対応」と説明されていて、対応する機能が一覧になっています。`const`、`let`、`async`/`await`、アロー関数、テンプレートリテラルは一覧にあり、optional chaining（`?.`）、スプレッド構文、分割代入、`class`、`for...of` はありません。この章のコードは、一覧にあるものだけで書きます。一覧に無いものが実際に動かないのかどうかは、試せていません。

`console.log` にも違いがあり、引数は 1 つしか取れません。`console.log("a", b)` とは書けません。

## 関数を読む

<!-- section: 10.router -->

関数のファイルは `examples/10-edge/infra/functions/edge-router.js` です。KVS を読む部分から見ていきます。

<<< @/examples/10-edge/infra/functions/edge-router.js{kvs}

`cloudfront` モジュールを import し、`cf.kvs()` で関数に付いている KVS を取ります。読む方法は `get`、`exists`、`meta` の 3 つがあり、ここでは `get` だけを使います。

`get` はキーが無いと reject するので、`try`/`catch` で包み、失敗したら `null` を返すようにしました。この書き方には設計上の選択が 1 つ含まれています。`read` は、キーが無い場合と、読み取りそのものが失敗した場合を区別しません。どちらも「ルール無し」として扱い、サイトの配信を続けます。KVS が読めないときにサイトごと落ちるより、リダイレクトが効かないほうがましだと判断したからです。その代わり、KVS が読めないあいだはメンテナンスのスイッチも効きません。

読み取りは `await` で 1 つずつ順に書きます。`Promise.all` でまとめたくなりますが、ドキュメントはこれを勧めていません。メモリを余計に使ううえ、今のところ速くもならないと書かれています。

次は本体です。

<<< @/examples/10-edge/infra/functions/edge-router.js{handler}

先頭にある `/digest` の 3 行は、あとで足す Lambda@Edge のためのもので、[デプロイのページ](/ja/chapters/10-edge/deploy.md)で説明します。この 3 行を除くと、処理は上から順に 3 段です。

1 段目では、メンテナンス中なら 503 を返して終わります。キャッシュもオリジンも通りません。

2 段目では、リダイレクトの表を引きます。ただし、最後の部分に `.` があるパス（`/assets/app.css` のようなファイル）と、256 文字を超えるパスでは引きません。ファイルをリダイレクトすることは無いので、ファイルへのリクエストのたびに読み取りを 1 回節約できます。

どちらにも当たらなければ、3 段目で URL を書き換えます。`/` はフラグを見て `/index.html` か `/home-v2.html` に、`/pricing/` のようなパスは `/pricing/index.html` にします。書き換えはキャッシュを調べる前に起きるので、2 つのトップページは別々の URL としてキャッシュされます。そのため、フラグを切り替えたときにキャッシュを消す必要はありません。

### リダイレクトの値を関数でもう一度確かめる

<<< @/examples/10-edge/infra/functions/edge-router.js{redirect}

KVS の値は、[次のページ](/ja/chapters/10-edge/local.md)で作る更新用のスクリプトが検査してから書き込みます。それでも関数の側でもう一度確かめるのは、KVS がコンソールからも書けるからです。スクリプトを通らない値が入る経路がある以上、最後に読む側で守る必要があります。

守っているのは、読者をサイトの外へ送らないことです。値に `https://...` や `//example.org` を書かれると、自分のドメインの URL が、よそのサイトへの入口になってしまいます。オープンリダイレクト（open redirect）と呼ばれる問題です。そこで、`/` で始まり、`//` で始まらず、バックスラッシュを含まないパスだけを受け付けます。

`cache-control` に 5 分を指定しているのは、寿命の指定が無い 301 をブラウザがずっと覚えているからです。指定しないままだと、表を間違えたときに、表を直しても読者の手元では直りません。

### メンテナンスの応答

<<< @/examples/10-edge/infra/functions/edge-router.js{maintenance}

関数は、リクエストを返す代わりに、応答そのものを返せます。この 503 には `no-store` を付けて、どこにもキャッシュされないようにしています。なお、関数が返した 400 以上の応答は、ディストリビューションのカスタムエラーページでは差し替えられません。

## 同じファイルを Node.js で動かす

<!-- section: 10.tests -->

03章と同じく、テストはデプロイするファイルそのものを読み込みます。写しを作ると、写しだけを直して本物を直し忘れるからです。ただし今回は、`import cf from "cloudfront"` が問題になります。`cloudfront` モジュールはエッジにしかありません。

<<< @/examples/10-edge/src/local/load-function.ts{load}

この関数は import の 1 行を取り除き、代わりに `cf` という名前の代用品を渡します。ほかは 1 文字も変えません。import の行が想定と違っていれば、そのまま進まずにエラーにします。

`node:vm` の新しいコンテキストには、`fetch` も `setTimeout` も `process` も `require` もありません。関数がうっかりこれらを使うと、テストは `ReferenceError` で落ちます。本物のランタイムの制約を、一部だけ再現していることになります。

KVS の代用品は次のとおりです。

<<< @/examples/10-edge/src/local/load-function.ts{stand-in}

代用品も本物と同じく、無いキーには reject します。加えて、読まれたキーを記録しています。読み取りは 1 回ごとに課金されるので、ファイルへのリクエストでは 1 回しか読まないことを、テストで固定しておくためです。

```bash
vp run test:unit
```

`examples/10-edge/infra/test/edge-router.test.ts` は、次のことを確かめます。

- 書き換えとリダイレクトが表のとおりに動き、クエリ文字列が引き継がれる
- KVS に外部サイトへのリダイレクトを直接書かれても、従わない
- メンテナンス中は、どのパスも 503 で、オリジンへ行かない
- KVS が空でも、すべての読み取りが失敗しても、配信が続く
- 読み取りの回数が、ファイルで 1 回、ページで 2 回、トップページで 3 回である
- ファイルが 10 KB に収まっている
- ドキュメントの一覧に無い構文（`?.`、スプレッド構文、分割代入など）が紛れ込んでいない

最後の項目は構文解析ではなく、単純な文字列検索です。Node.js に慣れた人がつい書いてしまうものを拾う程度の検査です。

このテストでわかるのはここまでです。動かしているのは Node.js なので、ランタイム 2.0 が実際にこの構文を受け付けるか、2 MB のメモリに収まるか、実行時間の上限に収まるかはわかりません。CloudFront には、公開前の関数にイベントを渡して実行し、結果と compute utilization を返す test の機能があります。本物のランタイムでの確認には、この機能を使います。
