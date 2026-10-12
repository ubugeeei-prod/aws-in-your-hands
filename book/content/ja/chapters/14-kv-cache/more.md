---
title: "14 Cache: 実装のつづき"
---

# 14 Cache: 実装のつづき

## cache は、消えても困らないものだけ

<!-- section: 14.cache -->

ここからは、もう 1 つの題材、一覧の cache です。

cache の原則は 1 つです。**正しいのは元データで、cache はその写し。** 写しは、いつ消えてもいい。消えたら、元データからもう一度作れる。この関係が成り立たないデータを、cache に置いてはいけません。

元データは、こういう interface にしてあります。

<<< @/examples/14-kv-cache/src/catalog.ts{source}

正直に言うと、この元データは作りものです。固定の一覧を、わざと 300 ミリ秒遅らせて返しています。本物のシステムなら、[13章](/ja/chapters/13-sql.md)の SQL の集計や、ほかのチームの API にあたる場所です。cache が効くのは「元が遅いか、呼ぶたびにお金がかかるとき」なので、その代役を置きました。

読み方は read-through です。まず cache を読み、無ければ元データを読んで、写しを cache に入れます。

<<< @/examples/14-kv-cache/src/read-through.ts{optional}

`try` で囲んでいるのが要点です。cache が落ちていても、遅くても、読めない値が入っていても、リクエストは元データから答えます。遅くはなりますが、間違えません。「cache の障害で API が 500 を返す」は、cache を持ち主のように扱ってしまったときに起きます。

応答には、その一覧がいつ元データから出てきたかを載せています。

<<< @/examples/14-kv-cache/src/contract.ts{list}

`x-cache` ヘッダーが `hit` か `miss` か、`age` ヘッダーが何秒前の写しか。呼ぶ側が「これはどれくらい古いかもしれないのか」を知る手段を、最初から付けておきます。

### 古い値を読む、を再現する

cache を持つと、元データと食い違う時間が必ず生まれます。stale read です。まず、いちばん単純な形から。

<<< @/examples/14-kv-cache/test/read-through.test.ts{stale}

1 つ目のテストは、元データを `v2` に変えても、TTL が切れるまでは `v1` が返ることを見ています。これは不具合ではなく、TTL を 30 秒にした時点で受け入れた仕様です。

2 つ目は、書いた側が cache を消せば、次の読み取りで新しい値になること。「元データを変えたら、cache を消す」は、よくある対策です。

3 つ目が面白いところです。**消しても、古い値が残ることがあります。**

```figure
caption: 読む側が元データに聞いている最中に、書く側が更新と削除を済ませると、古い値が cache に入り、TTL が切れるまでどの reader にも返る
type: sequence
actor reader: reader
actor cache: cache
actor source: source
actor writer: writer
note cache: (empty)
note source: v1
step reader -> cache: t1 miss
step reader -> source: t1 source に聞く
step writer -> source: t2 source を更新する
note source: v2
step writer -> cache: t3 invalidate
note cache: (empty): 消すものが無い
step source --> reader: t4 "v1" を受け取る
step reader -> cache: t4 "v1" を保存する
note cache: v1 (source は v2)
note cache: t5 TTL まで "v1" を返す
```

読む側が元データに聞いている最中に、書く側が更新と削除を済ませてしまう。そのあとで、読む側が持っていた古い答えが cache に入ります。もう誰も消しに来ません。

これを防ぎきる方法は、この章のコードにはありません。version を比べてから書く、などの手はありますが、複雑になります。この章の立場はこうです。**cache の削除は、古い時間を短くするためのもの。古さの上限を決めているのは TTL。** だから TTL は、「最悪この時間だけ古くてもいい」と言える長さにします。それが言えないデータ（残高、在庫、権限）は、cache せずに元データを読みます。

## 期限切れの瞬間に、全員が殺到する

<!-- section: 14.stampede -->

cache がうまく効いている API ほど、危ない瞬間があります。写しの期限が切れたときです。

そのとき 100 件のリクエストが来ていたら、100 件とも miss します。そして 100 件とも、遅い元データへ取りに行きます。cache が守っていたはずの元データに、いちばん負荷がかかる。これが cache stampede です。

テストでは、10 個の実行環境が同時に miss する場面を作って、元データが 10 回呼ばれることを確かめています（「sends every caller to the source when nothing coordinates them」）。まず、起きることを固定するわけです。

対策は 3 つ入れました。

### 1 つのプロセスの中では、相乗りする

同じ key の読み込みが進行中なら、新しく始めずに、その結果を待ちます。single flight と呼ばれるやり方です。

<<< @/examples/14-kv-cache/src/read-through.ts{single-flight}

<<< @/examples/14-kv-cache/test/read-through.test.ts{single-flight-test}

ただし、これが効くのは 1 つのプロセスの中だけです。そして Lambda は、同時に来たリクエストごとに別の実行環境を用意します。1 つの実行環境が同時にさばくリクエストは 1 件なので、**Lambda では single flight は、ほぼ出番がありません。** コンテナや常駐のサーバー（[12章](/ja/chapters/12-containers.md)）で動かすときに効く対策です。コードを共通にしておきたいので、入れてあります。

### 実行環境をまたぐなら、store に lock を置く

Lambda で効かせるには、全員から見える場所に「いま詰め直しています」の札を立てます。

<<< @/examples/14-kv-cache/src/read-through.ts{lock}

札を取れた 1 件だけが元データを読み、ほかは少し待ってから cache を読み直します。

<<< @/examples/14-kv-cache/test/read-through.test.ts{lock-test}

この lock について、大事なことが 1 つあります。**これは正しさを守る lock ではありません。** 期限があって、持ち主が固まったり落ちたりすれば、勝手に外れます。そのとき 2 件が同時に詰め直すかもしれません。それで構わないんです。2 件が同じ元データを読んで、同じ写しを書くだけなので。この lock が減らしているのは負荷で、間違いではありません。

だから、待つのにも上限があります。札の持ち主が帰ってこなくても、決めた回数だけ待ったら、自分で元データを読みに行きます。テストの「does not wait forever for a lock holder that died」と「goes to the source after waiting as long as it was told to」が、それです。

### 期限をばらす

もう 1 つ、単純で効く手があります。TTL に揺らぎ（jitter）を足すことです。

<<< @/examples/14-kv-cache/src/read-through.ts{jitter}

デプロイの直後や、cache が空になった直後は、たくさんの key が同じ瞬間に書かれます。TTL が全部同じなら、30 秒後に全部同時に切れます。0〜20% の揺らぎを足すと、切れる瞬間がばらけます。

<<< @/examples/14-kv-cache/test/read-through.test.ts{jitter-test}

乱数は引数でもらっているので、テストでは決まった値を渡して、「5 つのうち、ちょうど 1 つだけが切れている」と言い切れます。

この章の API は key が 1 つしかないので、揺らぎの出番は実はありません。key が増えたとき（利用者ごとの一覧、ページごとの一覧）に効いてきます。

## Lambda のメモリも cache になる

<!-- section: 14.memory -->

04章の「ノートはどこにある？」を覚えていますか。Lambda のメモリに置いたものは、実行環境ごとに別々で、いつ消えるかも選べない、という話でした。あのときは「データの持ち主にはなれない」が結論でしたが、「cache としては使える」とも書きました。その続きです。

<<< @/examples/14-kv-cache/src/lambda.ts{handler}

`KV_STORE=memory` にすると、数も写しも、この実行環境の中の `Map` に入ります。

<<< @/examples/14-kv-cache/src/memory-store.ts{memory}

通信が無いので、いちばん速くて、料金は 0 です。cache としては、十分に使えます。写しが実行環境ごとにばらばらでも、それぞれが元データから作った写しなら、古さの上限は TTL のままです。ほかより miss が多くなるだけ。

rate limit は、そうはいきません。テストに、そのまま書いてあります。

- 実行環境が 2 つあると、上限 3 の利用者が合計 6 回通る
- 片方の実行環境に入れた写しは、もう片方からは見えない

上限が「実行環境の数 × N」になってしまうんです。実行環境がいくつあるかは、こちらでは決められません。さらに、Lambda は実行環境を数時間ごとに終了させます（ドキュメントによると、呼ばれ続けている関数でも）。そのたびに数は 0 に戻ります。**数える仕事は、共有の store に置く。** メモリに置けるのは、ずれても誰も困らない写しだけです。

メモリの cache を、DynamoDB や Valkey の手前に 1 段足す構成もよく使われます。まずメモリ、無ければ共有の cache、それも無ければ元データ。この章のコードには入れていませんが、`CacheStore` を 2 つ重ねるだけで作れます。そのとき、古さの上限は 2 段の TTL の合計になることだけ、忘れないでください。

## edge の設定は、10章の KeyValueStore

<!-- section: 14.edge -->

3 つ目の「KV」、CloudFront KeyValueStore は、この章では実装しません。[10章](/ja/chapters/10-edge.md)で、redirect の表とメンテナンスのスイッチに使いました。ここでは、ほかの 2 つとの違いだけ整理します。

- **関数からは読むだけ。** 書くのは外から、専用の API で。だから「リクエストのたびに数える」rate limit には使えません
- **小さい。** 値は 1 KB まで、store 全体で 5 MB まで
- **更新は遅れて届く。** どれくらい遅れるかの数字は、Developer Guide に見つかっていません（10章）
- **読めるのは CloudFront Functions だけ。** 東京の Lambda から読む用途のものではありません

向いているのは、「人やデプロイが、たまに書き換える」「全リクエストで、edge で読みたい」「数秒古くても困らない」ものです。feature flag、redirect の表、メンテナンスのスイッチ。DynamoDB や Valkey とは、競合しません。置くデータが違います。

feature flag を東京の Lambda で読みたいなら、DynamoDB に置いて、この章の read-through でメモリに短く写すのが素直です。
