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
