---
title: "14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定"
revision: 1
---

# 14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定

Cloudflare で KV を使ってきた人が AWS に来ると、まずこう聞きます。「AWS の KV はどれ？」

答えは「1 つではない」です。DynamoDB、ElastiCache、CloudFront KeyValueStore。どれも key で値を引けますが、同じものの代替品ではありません。この章では、rate limit と一覧の cache という 2 つの題材を同じ interface の裏で DynamoDB と Valkey の両方に実装して、どこが違うのかをテストで見ていきます。

先にお金の話を 1 つだけ。この章の stack は、何も指定しなければ**置いてあるだけでは料金がかかりません**。`-c store=valkey` を付けたときだけ ElastiCache Serverless の cache を作り、こちらは 1 回も呼ばなくても月 USD 7.37 かかります。試したら、その日のうちに消してください。消し方は章末の「片付け」にあります。

前提は [05章](/ja/chapters/05-dynamodb.md)（DynamoDB）、[10章](/ja/chapters/10-edge.md)（CloudFront KeyValueStore）、[11章](/ja/chapters/11-network.md)（VPC）です。コードは `examples/14-kv-cache/` にあります。

## 「AWS の KV はどれ？」に、先に答える

<!-- section: 14.three -->

```text
                 where it runs          who may write          a value lives until
DynamoDB         one Region, on disk    your code (IAM)        you delete it (TTL: days late)
Valkey           one Region, in memory  your code (IAM/ACL)    its expiry, eviction, or a failover
  (ElastiCache)
CloudFront       every edge location    an API call from       you change it
  KeyValueStore                         outside the function   (functions only read)
Lambda memory    one execution          that environment       the environment is discarded
                 environment            only
```

4 行目は KV の製品ではありませんが、いちばん手軽な cache なので並べました。

ざっくり言うと、こうです。

- **DynamoDB** は、データの持ち主になれる保存先です。書き込みが成功したら、ディスクに残っています。条件付きの更新ができるので、数を数えるのにも使えます。使っていない間の料金は、保存量のぶんだけ
- **Valkey** は、メモリの上のサーバーです。速くて、期限切れを自分で片付けてくれて、数える・並べるといった操作が最初から揃っています。そのかわり、サーバーが置いてあるだけで料金がかかり、中身は消えることがあります
- **CloudFront KeyValueStore** は、edge の関数が読むための小さな設定表です。関数からは書けません
- **Lambda のメモリ**は、その実行環境だけのものです。共有できません

Workers KV に慣れた人が「KV」と聞いて思い浮かべるのは、「どこからでも読めて、書くのも簡単で、少し遅れて世界中に届くもの」でしょう。それにぴったり重なるものは、この 4 つにはありません。だから「どれが KV か」ではなく、「いま置きたいデータは何か」から選びます。この章の最後に、その表を作ります。

## 題材は 2 つ、裏側は差し替え式

<!-- section: 14.interface -->

作るのは、小さな API が 1 本です。`GET /items` が商品の一覧を返します。これに 2 つの仕掛けを付けます。

- **rate limit。** 利用者ごとに 1 分あたり 5 回まで。超えたら 429
- **一覧の cache。** 一覧の元データは遅い（という設定な）ので、30 秒だけ写しを持つ

この 2 つは、性質が正反対です。rate limit の数は**正確でないと意味がない**。cache の写しは**無くなっても困らない**。同じ「KV に置くもの」でも、store に求めることが違います。

それぞれに interface を 1 つずつ用意しました。まず、数える側。

<<< @/examples/14-kv-cache/src/stores.ts{counter}

操作は 2 つだけです。大事なのは `incrementBelow` の約束で、「`cap` 未満なら 1 足す」を**store の中の 1 ステップとして**やってもらいます。なぜそこにこだわるのかは、すぐあとで見ます。

次に、cache の側。

<<< @/examples/14-kv-cache/src/stores.ts{cache}

`get` に `now` を渡しているのが、ちょっと変わって見えるかもしれません。これは DynamoDB のためです。理由は TTL の節で。

この 2 つの interface に、メモリ、DynamoDB、Valkey の 3 通りの実装があります。「どの実装でも同じように振る舞うこと」は、contract test（`test/store-contracts.ts`）で確かめます。同じテストを、実装を差し替えながら流す、というやり方です。05章の repository と同じですね。

## rate limit を数える

<!-- section: 14.rate-limit -->

いちばん単純な数え方は、時間を 1 分ごとの区間に切って、区間ごとに数えることです。固定窓（fixed window）と呼びます。

<<< @/examples/14-kv-cache/src/rate-limit.ts{window}

区間の始まりは、時刻を窓の長さで割った余りを引くだけ。どの Lambda の実行環境で計算しても、時計がまともなら同じ区間になります。

<<< @/examples/14-kv-cache/src/rate-limit.ts{limiter}

`hit` は時刻を引数でもらいます。中で `Date.now()` を呼んでいません。おかげで、テストでは「区間の最後の 1 ミリ秒」や「次の区間のちょうど最初」を、待たずに試せます。

テスト（`test/rate-limit.test.ts`）が固定しているのは、こういう境界です。

- 上限が 3 なら、3 回目までは通って、4 回目は通らない
- 区間の最後の 1 ミリ秒ではまだ拒否され、次の区間の最初のミリ秒で通る
- 同時に 20 件来ても、通るのはちょうど 5 件

### 固定窓の弱点と、滑る窓

固定窓には、知られた弱点があります。

```figure
caption: 上限が 1 分に 5 件のとき、境目をはさんだ 10 件を固定窓はすべて通し、滑る窓は後ろの 5 件を断る
type: sequence
actor fixed: 固定窓
actor req: リクエスト
actor sliding: 滑る窓
step req -> fixed: 0:59 に 5 件 (window 1)
step req -> sliding: 0:59 に 5 件
step req -> fixed: 1:01 にもう 5 件 (window 2)
note fixed: 10 件すべて通る
note fixed: どの window も 5 件しか見ていない
step req -x sliding: 1:01 にもう 5 件: 断る
note sliding: 直前の 60 秒にもう 5 件ある
```

区間の境目をはさむと、2 秒のあいだに上限の 2 倍が通ります。テストにもそのまま書いてあります（「lets 2 x limit through in two seconds around a boundary」）。バグではなく、固定窓というのはそういうものです。

これが困るなら、滑る窓（sliding window）にします。直前の区間の回数を、「いまから 1 分前まで」にまだ入っている割合だけ、数に入れる方式です。いまの区間が 25% 進んだところなら、直前の区間の 75% を数えます。`slidingCap` がその計算で、`RATE_ALGORITHM=sliding` で切り替わります。

滑る窓は、リクエストごとに直前の区間を 1 回読むぶん、store への操作が 1 つ増えます。それと、これは近似です。直前の区間の中でリクエストが均等に来たと仮定しています。どちらを選ぶかは、「境目で 2 倍通ること」が実害になるかどうかで決めてください。ログインの試行回数なら滑る窓、API の使いすぎを大まかに抑えたいだけなら固定窓で足ります。

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

**拒否されたリクエストにも料金がかかります。** 条件が成り立たなかった書き込みも、書き込み 1 単位を消費します。上限を超えて叩き続ける相手は、叩いたぶんだけ DynamoDB の料金を発生させます。大量の攻撃を受け止める場所は、ここではなく、もっと手前（API Gateway の throttling など）です。

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

## 手元で動かす

<!-- section: 14.local -->

まずはメモリで。`examples/14-kv-cache/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/14-kv-cache/.env.example

```bash
vp run dev:kv
```

別のターミナルから、同じ利用者として 6 回呼んでみてください。

```bash
curl -s -i -H 'x-client-id: alice' http://localhost:8794/items
```

1 回目は `x-cache: miss` で、300 ミリ秒ほどかかります。2 回目からは `x-cache: hit` で、すぐ返ります。`ratelimit-remaining` が 4、3、2 と減っていき、6 回目は 429 と `retry-after` が返ります。`x-client-id` を付けないと 400 です。

この `x-client-id` は、呼ぶ側が自分で名乗っているだけです。別の名前を名乗れば、上限は別に数えられます。つまり、これは防御になっていません。本物の API では、[06章](/ja/chapters/06-auth.md)の検証済みの token から利用者の ID を取ります。認証の前に付ける rate limit なら、IP アドレスなど、呼ぶ側が自由に選べないものを使います。

アプリの中では、rate limit が cache より先に走ります。

<<< @/examples/14-kv-cache/src/app.ts{limit}

`catch` の中を見てください。数える store が落ちたとき、通すのか、断るのか。これは技術ではなく、プロダクトの判断です。一覧の API なら、通したほうがいい（store の障害で API まで止めたくない）。ログインの試行なら、断ったほうがいい（守りが外れた状態で通したくない）。だから `RATE_ON_ERROR` という設定にして、`catch` の奥に埋めていません。

どの store を使うかは、起動時に環境変数で決まります。

<<< @/examples/14-kv-cache/src/env.ts{env}

<<< @/examples/14-kv-cache/src/compose.ts{stores}

### Valkey と DynamoDB Local で動かす

本物のサーバーに対して動かすには、コンテナを 2 つ立てます。

```bash
vp run kv:local:start
vp run kv:local:migrate
vp run kv:test:local
```

`kv:local:start` は Docker の daemon が動いている必要があります。devShell に入っても Docker は付いてこないので、Docker Desktop などを別に起動しておいてください。立ち上がるのは `valkey/valkey:9.0.6-alpine`（ポート 6390）と `amazon/dynamodb-local:3.3.1`（ポート 8001）です。

`kv:test:local` は、さっきの contract test を、この 2 つに対して流します。どちらかが動いていなければ、skip ではなく失敗します。skip は、ぱっと見では成功に見えるので。

`.env` の `KV_STORE` を `valkey` か `dynamodb` に変えれば、`vp run dev:kv` もそちらを使います。

1 つ、正直に書いておきます。この章を書いたマシンには Docker の daemon が無く、`kv:local:start` は実行できていません。かわりに、Valkey 9.1.2 と DynamoDB Local 3.3.1 をコンテナではなくプロセスとして立てて、contract test の 22 件と `dev:kv` を通しました。テストとアプリは本物のサーバーで確かめてあり、コンテナを立てるタスクだけが未確認、という状態です。

手元で再現しないものも、書いておきます。

- **IAM と TLS。** 手元の Valkey は、パスワードも TLS もありません。token の署名と TLS 1.3 の接続は、ElastiCache でしか確かめられません
- **cluster mode。** 手元の Valkey は 1 台です。ElastiCache Serverless は cluster mode で、client の動きが変わります
- **TTL による削除。** 手元では、期限切れの item が消えるかどうかに頼っていません
- **実行環境が複数あること。** 開発サーバーはプロセスが 1 つなので、メモリの rate limit も正しく動いて見えます

最後のは、とくに気をつけてください。`KV_STORE=memory` は、手元では完璧に見えて、Lambda にのせた瞬間に上限が緩みます。

## AWS にのせる準備

<!-- section: 14.infra -->

stack は、既定では DynamoDB の table と、Lambda と、HTTP API だけを作ります。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{table}

`timeToLiveAttribute` が、TTL の設定です。table の設定は「どの属性を見るか」だけで、いつ消すかは item ごとに書きます。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{role}

許しているのは、store が呼ぶ 4 つの操作だけです。`Query` も `Scan` もありません。

Valkey は、明示したときだけ作ります。

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

順に見ていきます。

`connectionType: "public"` と `userGroupId` は、必ず一緒に見てください。`default.iam-user-group` は、ElastiCache がアカウントに用意している、IAM 認証の利用者だけの group です。public な cache に、パスワードの利用者がいる group を付ける、という事故を、テストで防いでいます。

`cacheUsageLimits` は、保存量と ECPU の上限です。これを超えると、ElastiCache は key を追い出し、リクエストを絞ります。性能を落としてでも、請求を青天井にしないための設定です。

`elasticache:Connect` の許可は、cache と利用者の 2 つの ARN に対してだけ。`*` はありません。

cdkd との関係も確かめました。固定した版（0.296.28）は、table、関数、role、log group、HTTP API には専用の実装を持っています。`AWS::ElastiCache::ServerlessCache` には専用の実装がなく、Cloud Control API 経由で扱われます。また、この種類は cdkd の「状態を持つリソース」の一覧に入っているので、作り直しを伴う変更（接続の種類の変更など）には `--force-stateful-recreation` が要ります。テストが、stack が使うリソースの種類を一覧で固定しています。

## デプロイして確かめる

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` は、新しい利用者 ID で `GET /items` を続けて呼び、何回目で 429 になるかと、`x-cache` の移り変わりを表示します。DynamoDB 版なら、どの実行環境が応答しても、6 回目で断られるはずです。

Valkey 版を試すなら、同じタスクに context を付けます。

```bash
vp run kv:infra:deploy -c store=valkey
vp run kv:smoke
vp run kv:infra:destroy -c store=valkey
```

繰り返しになりますが、cache は作った瞬間から消すまで課金されます。3 行目まで、続けて実行してください。

うまくつながらないときは、ログを見ます。

```bash
vp run kv:logs
```

`valkey connection error`、`cache store failed`、`rate limiter failed` のどれかが出ているはずです。cache が落ちていても API は 200 を返し続けるので、応答だけを見ていると気づけません。`x-cache` がずっと `miss` のままなら、cache に届いていない合図です。

drift の検査は、02章と同じです。

```bash
vp run kv:infra:drift
```

正直に言うと、この節のコマンドは、どれも実際の AWS では動かしていません。とくに Valkey 版は、未確認の点が多くあります。CloudFormation がこの設定の組み合わせを受け付けるか、自作の token が通るか、iovalkey が public endpoint の cluster 構成を読めるか。章末の検証メモに、内訳と再開の手順をまとめました。

## Workers KV や Durable Objects から来た人へ

<!-- section: 14.cloudflare -->

Cloudflare の側も、KV は 1 種類ではありません。確かめた範囲で並べます。

**Workers KV** は、ドキュメントの言葉で「結果整合の、edge の key-value store」です。書いた場所ではたいていすぐ見え、ほかの拠点では 60 秒以上かかることがある。読み取りが多くて cache しやすいデータ向けで、「atomic な操作が要るなら向かない。Durable Objects を検討して」とも書かれています。

これを AWS の 3 つのどれかに対応づけたくなりますが、やめておきます。重なり方が、それぞれ違うからです。

- DynamoDB は、Worker にあたるコードから読み書きできる点は同じ。ただし 1 つのリージョンにあり、強い整合性の読み取りと条件付きの更新ができる。性質は KV よりずっと「データベース」です
- CloudFront KeyValueStore は、edge で読める点と、遅れて届く点が似ています。でも関数からは書けず、桁違いに小さい（値は 1 KB、KV は 25 MiB）
- Valkey は、どちらにも似ていません。メモリの上の、1 つのリージョンのサーバーです

rate limit のような「正確に数える」仕事は、Cloudflare でも Workers KV の仕事ではありません。**Durable Objects** は、名前で一意に決まる、single-thread の小さな実体で、それぞれが強い整合性の保存領域を持ちます。「同時に来ても 1 つずつ処理される」ことで、この章が DynamoDB の条件式や Valkey の script で得た保証を、別の形で得ています。AWS には、これに直接あたる部品はありません。

Workers には、rate limit 専用の binding もあります。ドキュメントによると、数えるのは Cloudflare の拠点ごとで、「寛容で、結果整合で、正確な計数のためのものではない」。この章の DynamoDB 版は、その逆を選んでいます。1 つのリージョンで、リクエストごとに 1 回書き込んで、正確に数える。速さと手軽さでは binding が上で、厳密さではこちらが上です。どちらが要るかは、何を守りたいかで決まります。

料金の形も違います。Workers KV は、Free プランで 1 日あたり読み取り 10 万回・書き込み 1,000 回、Paid プランで月に読み取り 1,000 万回・書き込み 100 万回を含み、その先は読み取り 100 万回あたり USD 0.50、書き込み 100 万回あたり USD 5.00 です。置いてあるだけの料金は、保存量が 1 GB を超えるまでありません。「置いてあるだけで料金がかかる KV」は、Cloudflare から来ると、いちばん違和感のあるところだと思います。Durable Objects の料金は、この章では確かめていません。

## どれを選ぶか

<!-- section: 14.choose -->

ここまでを、1 枚にまとめます。

| | DynamoDB | ElastiCache Serverless（Valkey） | CloudFront KeyValueStore | Lambda のメモリ |
| --- | --- | --- | --- | --- |
| 向いている目的 | 持ち主になるデータ。正確な数。消えては困る期限つきの記録 | 高頻度の読み書き。消えてもよい数と写し。ランキングなどの専用の操作 | edge で読む小さな設定 | 自分の実行環境だけの写し |
| 一貫性 | 強い整合性の読み取りを選べる。条件付き更新が 1 ステップ | 1 コマンド、1 script が 1 ステップ。AZ への複製は非同期 | 更新は遅れて届く。数字は未確認 | 共有されない |
| データの寿命 | 消すまで。TTL の削除は数日遅れうる | 期限まで（誤差 0〜1 ミリ秒）。追い出しと障害で消えうる | 書き換えるまで | 実行環境が捨てられるまで |
| 置き場所 | 1 リージョン。VPC 不要 | 1 リージョン。VPC の中か public endpoint | 全 edge location | 実行環境の中 |
| 使っていないときの料金 | 保存量ぶんだけ（この章の構成で USD 0.00） | 月 USD 7.37 から | この章では 0（10章） | 0 |
| Lambda から書けるか | はい | はい | いいえ | その実行環境だけ |

この表から、だいたいの判断はこうなります。

**迷ったら DynamoDB。** 置いてあるだけの料金がほぼ無く、VPC も要らず、Lambda と同じ権限の仕組みで守れます。rate limit も cache も、この章で見たとおり作れます。弱点は 2 つ。1 回の操作が数ミリ秒から十数ミリ秒かかること（手元の DynamoDB Local では 10 ミリ秒前後でしたが、これは実物の数字ではありません）と、書き込みのたびに料金がかかることです。

**Valkey にするのは、理由が言えるとき。** 1 リクエストで何度も読み書きする。1 ミリ秒を争う。sorted set や pub/sub のような、DynamoDB に無い操作が要る。あるいは、書き込みが多すぎて DynamoDB の従量課金が月 USD 7.37 を大きく超える。どれかが当てはまるなら、Valkey の出番です。当てはまらないなら、常時かかる料金と、消えうるデータと、もう 1 つの運用対象を、理由なく抱えることになります。

**KeyValueStore は、edge の関数が読む設定にだけ。**

**メモリは、ただで付いてくる 1 段目の cache。** 正しさを預けない。

## お金の話

<!-- section: 14.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**置いてあるだけの月。**

| 構成 | 月額（730 時間） |
| --- | --- |
| 既定の stack（DynamoDB） | 0.00 |
| `-c store=valkey`（ElastiCache Serverless、Valkey） | 7.37 |
| 比較: node ベースの Valkey、`cache.t4g.micro` 1 台 | 14.60 |

Serverless の 7.37 は、最小課金のぶんです。Valkey の Serverless は、保存量が 100 MB 未満でも 100 MB として課金されます。単価は 1 GB 時間あたり USD 0.101 なので、0.1 GB × 730 時間 × 0.101 で 7.37。ちなみに Redis OSS と Memcached の最小は 1 GB で、単価も USD 0.151 と高くなります。Valkey を選んでいるのは、そのためでもあります。

node ベースの 14.60 は、この章の stack が作る構成ではありません。比べるために計算しました。replica なしの 1 台なので、その 1 台が落ちたら cache は空になります。

無料枠について。ElastiCache の料金ページによると、2025 年 7 月 15 日より前に作ったアカウントには `cache.t3.micro` の 750 時間が 12 か月付きますが、Serverless は対象外です。それ以降のアカウントは credits の形になります。この表では、どちらも引いていません。

**月 100 万リクエスト呼ばれた月。** Lambda は arm64、256 MB、平均 30 ミリ秒、ログは 1 リクエスト 0.5 KB という仮定です。

| 対象 | DynamoDB 版の定価 | Valkey 版の定価 |
| --- | --- | --- |
| API Gateway HTTP API のリクエスト（100 万件） | 1.29 | 1.29 |
| Lambda のリクエストと実行時間 | 0.30 | 0.30 |
| CloudWatch Logs | 0.36 | 0.36 |
| DynamoDB の書き込み（1,262,800 単位） | 0.90 | - |
| DynamoDB の読み取り（543,800 単位） | 0.08 | - |
| ElastiCache の保存量（最小の 73 GB 時間） | - | 7.37 |
| ElastiCache の ECPU（1,000 万、仮定） | - | 0.03 |
| 小計（定価） | **2.94** | **9.36** |
| 小計（毎月の無料枠の適用後） | **2.27** | **8.69** |

無料枠は、Lambda と CloudWatch Logs のものだけを引いています（アカウント全体で共有）。HTTP API の無料枠は確認できていないので、引いていません。

DynamoDB の書き込みの内訳は、rate limit の加算が 100 万回と、cache の詰め直しが 87,600 回 × 3 回（lock を取る、写しを書く、lock を外す）。詰め直しの回数は、「TTL の 30 秒が切れるたびに必ず 1 回起きる」という、多めの仮定です。滑る窓にすると、リクエストごとに強い整合性の読み取りが 1 回増えて、読み取りが 100 万単位（USD 0.14）増えます。

Valkey 版の ECPU は、1 リクエストあたり 10 ECPU と多めに置きました。単純な読み書きは 1 KB あたり 1 ECPU ですが、script がいくつ消費するかは計っていません。それでも USD 0.03 なので、この規模では保存量の最小課金がほぼすべてです。

2 つの小計を見比べてください。月 100 万リクエストでは、DynamoDB 版のほうがずっと安い。DynamoDB の書き込みが月 USD 7.37 に届くのは、およそ 1,000 万回の書き込みからです。「cache といえば Valkey」と決めてかかる前に、一度この計算をしてみる価値があります。

表に入れていないものもあります（0 という意味ではなく、未算入です）。応答をインターネットへ送るデータ転送。それと、public endpoint へのデータ転送で、料金ページによると、同じリージョンの中ではアプリの側に 1 GB あたり USD 0.01 がかかります。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:kv` が `Invalid environment` で止まる | `examples/14-kv-cache/.env` はありますか。`KV_STORE` ごとに必要な変数が違います |
| 手元では 6 回目で 429 なのに、デプロイ後はもっと通る | `KV_STORE=memory` のままデプロイしていませんか。実行環境ごとに数えています |
| 期限を過ぎた item が、DynamoDB のコンソールに残っている | それで正常です。TTL の削除は数日遅れることがあります。読む側が期限を見ています |
| `x-cache` がずっと `miss` | cache に書けていません。`vp run kv:logs` で `cache store failed` を探す |
| ログに `WRONGPASS` | 公式の Troubleshooting によると、token の期限切れ、利用者名の違い、`elasticache:Connect` の不足、cache 名が小文字でない、のどれか |
| ログに `NOAUTH` | client が認証の前にコマンドを送っています。iovalkey は、ソースを読むかぎり最初に `AUTH` を送りますが、実機では未確認です |
| TLS の握手に失敗する | public endpoint は TLS 1.3 だけ。client の設定で古い版に固定していませんか |
| `Valkey did not answer within 1000 ms` | cache に届いていないか、応答が遅い。API は元データから答え続けます |
| 滑る窓で、思ったより 1 回少なく断られる | 小数の計算を切り捨てています。上限ちょうどを保証する方式ではなく、近似です |

## 本番にするなら

- **利用者の ID を、検証済みのものにする。** `x-client-id` は自己申告です（06章）
- **rate limit の手前にも守りを置く。** まずは HTTP API の stage の throttling。AWS WAF は HTTP API には付けられないので、要るなら構成から選び直しです（[04章](/ja/chapters/04-http-api.md)）。アプリの rate limit は、公平に配るためのもので、攻撃を受け止めるためのものではありません
- **table の `removalPolicy` を見直す。** この章の table は消えていいものしか入っていませんが、持ち主のデータと同じ table に置くなら `RETAIN` です
- **TTL を、言葉で説明できる長さにする。** 「一覧は最大 36 秒古い」と言えますか（30 秒 + 揺らぎ 20%）
- **cache の hit 率を見る。** `x-cache` をログに出してあります。ログから数えてアラームにする方法は [19章](/ja/chapters/19-observability.md)
- **Valkey を使うなら、public endpoint でよいかを決める。** IAM で守られてはいますが、組織によっては「インターネットから届くデータストアは不可」です。その場合は接続の種類を VPC にして、11章の VPC に関数ごと入れます。`elasticache:ConnectionType` という条件キーで、public な cache を作れなくすることもできます
- **Valkey の利用者を、用途ごとに分ける。** この章は、何でもできる `default.iam-user` を使っています。本番では、使えるコマンドと key を絞った利用者を作ります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 14.cleanup -->

```bash
vp run kv:infra:destroy
```

Valkey 版をデプロイしたなら、同じ context を付けます。

```bash
vp run kv:infra:destroy -c store=valkey
```

table、関数、role、API、log group、そして ElastiCache の cache が消えます。最終 snapshot の名前を指定していないので、snapshot は残らない設定です。消えたかどうかは、ElastiCache のコンソールで cache の一覧が空になっていることを見てください。ここが残っていると、料金が続きます。

手元のコンテナも止めておきましょう。

```bash
vp run kv:local:stop
```

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

## 分散システムとして見ると

この章の状態の持ち主は、2 人います。rate limit の数の持ち主は、共有の store（DynamoDB か Valkey）。一覧の持ち主は、元データ。cache は誰の持ち主でもありません。

守りたいことを、1 文ずつにしておきます。

- **1 つの区間で通るリクエストは、同時に何件来ても上限まで。** 壊そうとするテスト: 「読んでから書く」store で 2 件を同時に通す。50 件を同時に本物の store へ送る
- **期限を過ぎた写しは、store に残っていても返さない。** 壊そうとするテスト: 期限切れの item を返す DynamoDB
- **cache が無くても、遅くても、壊れていても、応答は元データと同じ。** 壊そうとするテスト: 読み書きが必ず失敗する store、読めない値が入った store、帰ってこない lock の持ち主
- **写しの古さは、TTL を超えない。** 壊そうとするテスト: 更新と削除をまたぐ遅い読み取り

4 つ目は、「古い値を返さない」ではないことに注意してください。返します。上限があるだけです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（rate limiter の境界と同時実行、store の contract、DynamoDB と Valkey へ送るリクエストの形、TTL の読み取り側の判定、stale read、stampede、揺らぎ、token の署名、アプリ、stack の assertion）。型検査。synth（既定と `-c store=valkey`、esbuild の bundle 込み）。bundle した handler を Node.js で読み込み、API Gateway の形のイベントで呼び出し。store の contract 22 件を、Valkey 9.1.2 と DynamoDB Local 3.3.1 に対して実行。`dev:kv` を memory、valkey、dynamodb の 3 通りで起動して、本文の `curl` を実行。

**まだ確かめていないこと。** `kv:infra:deploy`、`kv:smoke`、`kv:logs`、`kv:infra:drift`、`kv:infra:destroy` は、実際の AWS では動かしていません。`kv:local:start` と `kv:local:stop` は、Docker の daemon が無く実行していません（Valkey と DynamoDB Local は、nixpkgs の `valkey-server` と AWS が配布する jar を、プロセスとして起動しました）。ElastiCache については、何も実機で確かめていません。内訳は、CloudFormation と Cloud Control API が `ConnectionType: public` と `UserGroupId: default.iam-user-group` を受け付けること、`CacheUsageLimits` の ECPU の上限 1,000 が有効な値であること（上限の最小値はドキュメントに見つからず、1,000 は公式の例が下限に使っている値です）、自作の SigV4 token が通ること、iovalkey の `Cluster` が public endpoint で cluster の構成を読めること、TLS 1.3 での接続、script の ECPU 消費、cache の作成と削除にかかる時間。DynamoDB については、TTL で item が消えるまでの実際の時間と、実物での応答時間。`@valkey/valkey-glide` は npm の情報を読んだだけで、インストールも実行もしていません。Durable Objects の料金は確かめていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 題材は 2 つ、裏側は差し替え式 | `examples/14-kv-cache/src/stores.ts`、`test/store-contracts.ts` | `test:unit` |
| rate limit を数える | `examples/14-kv-cache/src/rate-limit.ts`、`test/rate-limit.test.ts` | `test:unit` |
| 「読んでから書く」と、数え間違える | `examples/14-kv-cache/src/dynamodb-store.ts`、`test/dynamodb-store.test.ts`、`test/rate-limit.test.ts` | `test:unit`、`kv:test:local` |
| TTL は「すぐ消す」ではない | `examples/14-kv-cache/src/dynamodb-store.ts`、`test/dynamodb-store.test.ts` | `test:unit` |
| 同じことを Valkey で | `examples/14-kv-cache/src/valkey-store.ts`、`test/valkey-store.test.ts`、`test/local-stores.test.ts` | `test:unit`、`kv:test:local` |
| ElastiCache に置くと何が増えるか | `examples/14-kv-cache/src/elasticache-token.ts`、`src/valkey-client.ts`、`test/elasticache-token.test.ts` | `test:unit` |
| cache は、消えても困らないものだけ | `examples/14-kv-cache/src/read-through.ts`、`src/catalog.ts`、`src/contract.ts`、`test/read-through.test.ts` | `test:unit` |
| 期限切れの瞬間に、全員が殺到する | `examples/14-kv-cache/src/read-through.ts`、`test/read-through.test.ts` | `test:unit` |
| Lambda のメモリも cache になる | `examples/14-kv-cache/src/memory-store.ts`、`src/lambda.ts`、`test/memory-store.test.ts` | `test:unit` |
| edge の設定は、10章の KeyValueStore | `examples/10-edge/` | - |
| 手元で動かす | `examples/14-kv-cache/src/app.ts`、`src/compose.ts`、`src/env.ts`、`src/dev.ts`、`scripts/local-stores.ts`、`scripts/test-local.ts`、`.env.example` | `dev:kv`、`kv:local:start`、`kv:local:migrate`、`kv:test:local`、`kv:local:stop` |
| AWS にのせる準備 | `examples/14-kv-cache/infra/lib/kv-cache-stack.ts`、`infra/bin/app.ts`、`infra/test/kv-cache-stack.test.ts`、`cdk.json` | `kv:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/14-kv-cache/scripts/smoke.ts`、`scripts/logs.ts` | `kv:infra:diff`、`kv:infra:deploy`、`kv:smoke`、`kv:logs`、`kv:infra:drift` |
| お金の話 | `data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `kv:infra:destroy`、`kv:local:stop` |

**一次情報**（確認日は、とくに書いていなければ 2026-10-12）

- DynamoDB: [Using time to live (TTL)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)、[Working with expired items and TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html)、[Working with items and attributes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)、[Update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html)、[Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- ElastiCache: [What is Amazon ElastiCache?](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)、[Choosing between deployment options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html)、[Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html)、[Create a Valkey serverless cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/serverless-public-endpoints-chapter.html)、[Connect to a cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connecting-public-endpoint.html)、[Authenticating with IAM](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html)、[Role-Based Access Control](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Clusters.RBAC.html)、[In-transit encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html)、[Supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html)、[Scaling ElastiCache Serverless](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html)、[Engine versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html)、[Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/)、[AWS::ElastiCache::ServerlessCache](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-serverlesscache.html)
- AWS Price List bulk API: [ElastiCache](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-1/index.json)、[DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)（DynamoDB、Lambda、API Gateway、CloudWatch の単価は 2026-10-11 に記録されたもの。DynamoDB の読み書きの単価は 2026-10-12 に同じ値であることを確かめた）
- Lambda: [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)、[Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- Valkey: [README](https://github.com/valkey-io/valkey/blob/unstable/README.md)、[Scripting with Lua](https://valkey.io/topics/eval-intro/)、[SET](https://valkey.io/commands/set/)、[EXPIRE](https://valkey.io/commands/expire/)、[INCR](https://valkey.io/commands/incr/)、[valkey/valkey の image の tag](https://hub.docker.com/r/valkey/valkey/tags)
- client: [iovalkey 0.4.0](https://www.npmjs.com/package/iovalkey/v/0.4.0)、[@valkey/valkey-glide 2.5.3](https://www.npmjs.com/package/@valkey/valkey-glide/v/2.5.3)
- CloudFront KeyValueStore: 10章の出典（確認日 2026-10-11。この章では読み直していません）
- Cloudflare: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[KV limits](https://developers.cloudflare.com/kv/platform/limits/)、[KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)、[What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)、[Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- cdkd: [v0.296.28 の `register-providers.ts`](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) と、同じ版の npm の tarball

:::
