---
title: "14 Cache: しくみと実装"
---

# 14 Cache: しくみと実装

## 「読んでから書く」と、数え間違える

<!-- section: 14.atomic -->

rate limit を素直に書くと、こうなります。「いまの回数を読む。上限より小さければ、1 足した値を書く」。

これは、同時に 2 件来ると壊れます。

```figure
caption: 上限が 1 のとき、2 件が同時に「読んでから書く」と、どちらも通り、増やした 1 回ぶんが消える
type: sequence
actor a: request A
actor store: 保存された回数
actor b: request B
note store: 0
step a -> store: t1 回数を読む: 0
step b -> store: t2 回数を読む: 0
step a -> store: t3 0 < 1 なので 1 を書く
note store: 1
step b -> store: t4 0 < 1 なので 1 を書く
note store: 1 (1 回ぶんが消えた)
note a: allowed
note b: allowed
```

2 件とも「まだ 0 回」と読んで、2 件とも通ります。しかも保存された回数は 1 のまま。上限を破ったうえに、破った記録も残りません。

これを、決まった順序で再現するテストがあります。わざと「読んでから書く」store を作って、2 件が読み終わるまで書き込みを止めています。

<<< @/examples/14-kv-cache/test/rate-limit.test.ts{lost-update}

直し方は 1 つです。読むことと書くことを、store の中の 1 ステップにする。DynamoDB なら、こう書きます。

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{increment}

`ADD #hits :one` は、「いまの値に 1 を足す」という命令です。こちらは値を読みません。足し算をするのは DynamoDB です。そこに 05章でも使った条件式を付けて、「上限未満のときだけ」にしています。条件の判定と加算は、DynamoDB の中で 1 つの操作として行われます。2 件が同時に来ても、片方が先に適用され、もう片方はその結果を見て判定されます。

この「読まずに足す」ことは、ユニットテストで形を固定しています。送るコマンドは `UpdateItem` が 1 つだけで、その前に読み取りがないこと。そして「50 件同時に来ても、通るのはちょうど 20 件で、数も 20」という contract test を、DynamoDB Local に対して流して通しています。

2 つ、知っておいてほしいことがあります。

**拒否されたリクエストにも料金がかかります。** 条件が成り立たなかった書き込みも、書き込み 1 単位を消費します。上限を超えて叩き続ける相手は、叩いたぶんだけ DynamoDB の料金を発生させます。大量の攻撃を受け止める場所は、ここではなく、もっと手前です。この章の stack は、HTTP API の stage に throttling を付け、table が 1 秒に受け付ける書き込みにも上限を置いています。数字は「AWS にのせる準備」と「お金の話」で。

**加算は冪等ではありません。** DynamoDB への書き込みが成功したのに、応答が届かなかったとします。SDK は再試行して、もう 1 回足します。1 回のリクエストが 2 回と数えられるわけです。rate limit なら「利用者が 1 回ぶん損をする」で済むので、そのままにしています。お金や在庫のように数え間違いが許されないものには、この方式を使わないでください。05章の「応答が届かなかったら」のやり方（同じ操作に同じ ID を付ける）が要ります。

## TTL は「すぐ消す」ではない

<!-- section: 14.ttl -->

rate limit の item は、区間が過ぎたらもう要りません。cache の写しも、期限が来たら要りません。放っておくと table に溜まり続けるので、DynamoDB の TTL（time to live）を使います。item に「この時刻を過ぎたら消してよい」を Unix 秒で書いておくと、DynamoDB が消してくれる機能です。削除に書き込みの料金はかかりません。

ただし、ここが落とし穴です。**期限が来た瞬間には消えません。** 公式ドキュメントの言い方は「期限から数日以内に削除する」。そして、消えるまでのあいだ、その item は普通に読めます。

Valkey や Workers KV の期限に慣れていると、「期限を付けたんだから、過ぎたら返ってこないだろう」と思ってしまいます。DynamoDB では返ってきます。だから、読む側で期限を確かめます。

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{cache-get}

`get` に `now` を渡していた理由が、これです。期限が切れているかどうかを決めるのは DynamoDB ではなく、読んだ側の時計です。TTL の役目は掃除だけ、と割り切ります。

このことは、テストで固定してあります。

<<< @/examples/14-kv-cache/test/dynamodb-store.test.ts{ttl-test}

item には期限を 2 つ書いています。`expiresAtMs` はミリ秒で、読む側の判定に使います。`expiresAt` は秒で、DynamoDB の掃除のためのものです。TTL の属性は秒でなければならないので、分けました。

同じ話が、あとで出てくる lock にもあります。期限切れの lock が table に残っているので、「lock が無い」だけでなく「あるけれど期限切れ」も、取ってよい条件に入れています。

<<< @/examples/14-kv-cache/src/dynamodb-store.ts{lock}

ちなみに rate limit のほうは、TTL の遅れの影響を受けません。key に区間の開始時刻が入っているので、古い区間の item が残っていても、新しい区間からは見えないからです。正しさを TTL に頼らない作りにしておくと、「数日」という幅を気にしなくて済みます。

正直に言うと、実際の DynamoDB で item が消えるまでの時間は、計っていません。

## 同じことを Valkey で

<!-- section: 14.valkey -->

Valkey は、メモリの上で動く key-value のサーバーです。Redis がライセンスを変える直前のオープンソース版から分かれたプロジェクトで、コマンドは Redis のものがそのまま通ります。ElastiCache が動かせるエンジンの 1 つです（ほかに Redis OSS と Memcached）。

Valkey にも「1 足す」コマンド（`INCR`）があります。ただ、「上限未満のときだけ足す」を 1 つのコマンドではできません。そこで、小さな script にします。

<<< @/examples/14-kv-cache/src/valkey-store.ts{scripts}

Valkey は、script を最初から最後まで、ほかのコマンドを挟まずに実行します。DynamoDB の「条件と更新が 1 ステップ」と同じ保証を、別のやり方で得ているわけです。

cache のほうは、もっと素直です。

<<< @/examples/14-kv-cache/src/valkey-store.ts{valkey-cache}

`get` は `now` を使っていません。Valkey は、期限が切れた key を自分で返さなくなります（公式ドキュメントによると、期限の誤差は 0〜1 ミリ秒）。読む側で確かめる必要がないんです。DynamoDB との違いが、いちばんはっきり出る場所です。

そのかわり、時計の持ち主が変わります。期限を判定するのは Valkey のサーバーの時計で、テストから差し替えられません。contract test も、Valkey に対しては本当に時間を待っています（`test/local-stores.test.ts`）。メモリと DynamoDB には偽の時計を渡せるのに、Valkey には渡せない。この差が、そのままテストに現れています。

もう 1 つの大きな違いは、**Valkey の中身は消えることがある**、です。ElastiCache Serverless は、データを複数の Availability Zone に非同期で複製します。非同期ということは、書き込みに成功の返事をもらった直後に障害が起きると、その書き込みが失われることがある、ということです。保存量の上限に達したら、期限つきの key が追い出されます。rate limit の数が消えると、その利用者はもう一度上限まで呼べるようになります。それを許せるかどうかが、Valkey に数を置くかどうかの分かれ目です。

## ElastiCache に置くと何が増えるか

<!-- section: 14.elasticache -->

手元の Valkey は、コンテナを 1 つ立てれば動きます。AWS で動かすと、決めることが増えます。

### node ベースか、Serverless か

ElastiCache には、置き方が 2 つあります。

| | node ベース | Serverless |
| --- | --- | --- |
| 決めること | node の種類、台数、どの AZ に置くか | 名前だけ（上限は設定できる） |
| 料金 | node の時間課金。東京の `cache.t4g.micro`（Valkey）1 台で月 USD 14.60 | 保存量（GB 時間）と ECPU。Valkey は最小 100 MB ぶんで月 USD 7.37 |
| ネットワーク | VPC の中だけ | VPC の中、または public endpoint |
| TLS | 有効にするか選ぶ | 常に有効 |
| cluster mode | 選べる | 有効のみ。client が対応している必要がある |

どちらも、**呼ばれなくても料金がかかります**。DynamoDB や Lambda のような「使わなければ 0」ではありません。Serverless という名前から「使ったぶんだけ」を想像すると、ここで外れます。料金ページははっきり書いています。課金は cache が使えるようになったときに始まり、消すまで続きます。

### VPC が要らなくなった

11章で書いたとおり、node ベースの cluster は VPC の中にしか置けません。Lambda からつなぐには、関数を VPC に入れることになり、インターネットへの経路を失います。この章のアウトラインも、もともと「Valkey は VPC を伴う」としていました。

ところが、いまのドキュメントを読み直すと、ElastiCache Serverless には接続の種類が 2 つあります。VPC と public です。public endpoint は、VPC なしで、インターネット越しにつなげます。使えるのは Valkey 9.0 以降の Serverless だけです。

この章の stack は、public endpoint を使います。理由は、Lambda を VPC に入れずに済むからです。関数はこれまでの章と同じ場所で動き、DynamoDB も同じように呼べます。VPC に入れる構成（接続の種類を `vpc` にして、subnet と security group を渡し、関数を 11章の VPC につなぐ）は、この章のコードにはありません。

「インターネットから届く cache」と聞くと、身構えますよね。当然です。public endpoint には、条件が 2 つ付いています。

- **すべての接続に IAM 認証が要る。** パスワードの利用者は使えません。cache に付ける user group は、全員が IAM 認証の利用者でなければなりません
- **TLS 1.3 が要る。** それより古い TLS では握手が通りません

つまり、守っているのはネットワークの壁ではなく、IAM です。04章からずっと「role に何を許すか」を見てきたのと、同じ考え方になります。

### パスワードの代わりに、署名を送る

IAM 認証では、パスワードの代わりに、有効期限 15 分の token を送ります。token の正体は、SigV4 で署名した URL です。

<<< @/examples/14-kv-cache/src/elasticache-token.ts{token}

この関数は、どこにも通信しません。手元にある認証情報で署名するだけです。受け取った ElastiCache が、署名を検証します。Lambda の中では、実行 role の認証情報で署名することになります。role には、`elasticache:Connect` を、cache と ElastiCache の利用者の両方に対して許しておきます。

AWS のドキュメントが参考実装として載せているのは Java のコードで、Node.js 用の公式の部品は見当たりませんでした（Valkey の公式 client である GLIDE は、token の生成と更新を自分でやってくれます）。上のコードは、その Java の実装を写したものです。テストでは、SigV4 の計算を別に手で書いて、署名が一致することを確かめています。ただ、**この token を本物の ElastiCache に渡したことは、まだありません。**

### client は iovalkey にした

Node.js の Valkey client は、npm で 2 つ確かめました。

- `@valkey/valkey-glide` 2.5.3: Valkey の公式 client。IAM 認証を内蔵。中身は Rust で、OS と CPU ごとの native のパッケージを使う
- `iovalkey` 0.4.0: ioredis から分かれた client。JavaScript だけで書かれている

この本は、Lambda のコードを synth のときに esbuild で 1 つのファイルにまとめています。Docker は使いません。native のパッケージは、まとめるマシン（たとえば macOS）と動かす場所（Linux の arm64）で別のものが要るので、このやり方に素直にのりません。そこで、JavaScript だけの iovalkey を選びました。GLIDE のほうが、認証まわりで書くコードは少なくなるはずです。コンテナで動かす（[12章](/ja/chapters/12-containers.md)）なら、選び直していいと思います。

<<< @/examples/14-kv-cache/src/valkey-client.ts{elasticache}

iovalkey を選んだ代償が 1 つあります。パスワードを固定の文字列として受け取るので、15 分後に再接続が起きると、古い token を送ってしまいます。そこで、接続を 10 分ごとに作り直しています。

<<< @/examples/14-kv-cache/src/valkey-client.ts{rotating}

もう 1 つ。cache が返事をしないときに、リクエストを道連れにしないための仕掛けです。

<<< @/examples/14-kv-cache/src/valkey-client.ts{deadline}

待つのは 1 秒まで。それを過ぎたら、cache は無かったことにして先へ進みます。これが無いと、cache の障害が、Lambda の timeout（10 秒）いっぱいの待ち時間になって利用者に届きます。
