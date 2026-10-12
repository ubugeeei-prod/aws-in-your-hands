---
title: "14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定"
revision: 3
---

# 14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定

Cloudflare で Workers KV を使ってきた人が AWS に来ると、まず「AWS の KV はどれか」を探します。ところが、AWS には KV にあたるものが 1 つに決まっていません。DynamoDB も、ElastiCache も、CloudFront KeyValueStore も、キーで値を引けますが、互いの代わりにはなりません。

この章では、レート制限と一覧のキャッシュという 2 つの題材を、同じインターフェースの裏で DynamoDB と Valkey の両方に実装し、どこが違うのかをテストで確かめます。

料金について、先に 1 つだけ書いておきます。この章のスタックは、何も指定しなければ、置いてあるだけでは料金がかかりません。`-c store=valkey` を付けたときだけ ElastiCache Serverless のキャッシュを作り、こちらは 1 回も呼ばなくても月 USD 7.37 かかります。試したら、その日のうちに[片付け](/ja/chapters/14-kv-cache/wrap.md)の手順で消してください。

前提は [05章](/ja/chapters/05-dynamodb.md)（DynamoDB）、[10章](/ja/chapters/10-edge.md)（CloudFront KeyValueStore）、[11章](/ja/chapters/11-network.md)（VPC）です。コードは `examples/14-kv-cache/` にあります。

## AWS で KV にあたるもの

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

4 行目の Lambda のメモリは KV の製品ではありませんが、いちばん手軽なキャッシュなので並べました。4 つの性質は、おおよそ次のとおりです。

- DynamoDB は、データの持ち主になれる保存先です。書き込みが成功した値はディスクに残り、条件付きの更新ができるので、数を数える用途にも使えます。使っていない間にかかるのは、保存量ぶんの料金だけです
- Valkey は、メモリの上で動くサーバーです。速く、期限切れの値を自分で片付け、数える操作や並べる操作を最初から備えています。そのかわり、サーバーを置いてあるだけで料金がかかり、中身は消えることがあります
- CloudFront KeyValueStore は、エッジの関数が読むための小さな設定表で、関数からは書けません
- Lambda のメモリは、その実行環境だけのもので、ほかの実行環境とは共有できません

Workers KV に慣れた人が「KV」と聞いて思い浮かべるのは、どこからでも読めて、手軽に書けて、少し遅れて世界中に届くものでしょう。この 4 つに、それとぴったり重なるものはありません。そのため、「どれが KV か」ではなく「いま置きたいデータは何か」から選ぶことになります。選ぶための表は、[最後のページ](/ja/chapters/14-kv-cache/wrap.md)の「どれを選ぶか」にまとめました。

## 2 つの題材と、差し替えられるストア

<!-- section: 14.interface -->

作るのは小さな API が 1 本で、`GET /items` が商品の一覧を返します。この API に、次の 2 つを付けます。

- レート制限。呼び出し元の IP アドレスごとに 1 分あたり 5 回までとし、超えたら 429 を返します
- 一覧のキャッシュ。一覧の元データは遅い、という設定にしてあるので、写しを 30 秒だけ持ちます

2 つは性質が正反対です。レート制限の数は正確でなければ意味がなく、キャッシュの写しは無くなっても困りません。どちらも「KV に置くもの」ですが、ストアに求めることが違います。

そこで、インターフェースを 1 つずつ用意しました。まず、数える側です。

<<< @/examples/14-kv-cache/src/stores.ts{counter}

操作は 2 つしかありません。大事なのは `incrementBelow` の約束で、「`cap` 未満なら 1 足す」を、ストアの中の 1 ステップとして実行してもらいます。1 ステップでなければならない理由は、次のページの[「読んでから書くと数え間違える」](/ja/chapters/14-kv-cache/build.md)で扱います。

次に、キャッシュの側です。

<<< @/examples/14-kv-cache/src/stores.ts{cache}

`get` に `now` を渡しているのは DynamoDB のためです。DynamoDB は期限の切れた項目をすぐには消さないので、読む側が期限を確かめます。詳しくは、同じく次のページの TTL の節で説明します。

この 2 つのインターフェースに、メモリ、DynamoDB、Valkey の 3 通りの実装があります。どの実装でも同じように振る舞うことは、コントラクトテスト（`test/store-contracts.ts`）で確かめます。05章のリポジトリと同じく、1 組のテストを、実装を差し替えながら流すやり方です。

## レート制限の数え方

<!-- section: 14.rate-limit -->

いちばん単純な数え方は、時間を 1 分ごとの区間に切り、区間ごとに数える方法で、固定窓（fixed window）と呼びます。

<<< @/examples/14-kv-cache/src/rate-limit.ts{window}

区間の始まりは、時刻を窓の長さで割った余りを、時刻から引けば求まります。どの Lambda の実行環境で計算しても、時計がまともなら同じ区間になります。

<<< @/examples/14-kv-cache/src/rate-limit.ts{limiter}

`hit` は時刻を引数で受け取り、中で `Date.now()` を呼びません。そのため、テストでは「区間の最後の 1 ミリ秒」や「次の区間の最初の 1 ミリ秒」を、待たずに試せます。

テスト（`test/rate-limit.test.ts`）が固定しているのは、次のような境界です。

- 上限が 3 なら、3 回目までは通り、4 回目は通らない
- 区間の最後の 1 ミリ秒ではまだ拒否され、次の区間の最初の 1 ミリ秒で通る
- 同時に 20 件来ても、通るのはちょうど 5 件

### 固定窓の弱点と、滑る窓

固定窓には、区間の境目で上限の 2 倍が通るという、よく知られた弱点があります。

```figure
caption: 上限が 1 分に 5 件のとき、境目をはさんだ 10 件を固定窓はすべて通し、滑る窓は後ろの 5 件を断る
type: sequence
actor fixed: 固定窓
actor req: リクエスト
actor sliding: 滑る窓
step req -> fixed: 0:59 に 5 件 (区間 1)
step req -> sliding: 0:59 に 5 件
step req -> fixed: 1:01 にもう 5 件 (区間 2)
note fixed: 10 件すべて通る
note fixed: どの区間も 5 件しか見ていない
step req -x sliding: 1:01 にもう 5 件: 断る
note sliding: 直前の 60 秒にもう 5 件ある
```

区間の終わりぎわに 5 件、次の区間の始めに 5 件が来ると、2 秒のあいだに 10 件が通ります。テストにも、そのまま書いてあります（「lets 2 x limit through in two seconds around a boundary」）。これはバグではなく、固定窓がもともと持っている性質です。

この性質が困るなら、滑る窓（sliding window）にします。滑る窓は、直前の区間の回数のうち、いまから 1 分前までにまだ入っている割合を、いまの区間の数に加えます。いまの区間が 25% 進んだところなら、直前の区間の 75% を数えます。`slidingCap` がその計算で、`RATE_ALGORITHM=sliding` にすると切り替わります。

滑る窓は、リクエストごとに直前の区間を 1 回読むので、ストアへの操作が 1 つ増えます。また、直前の区間の中でリクエストが均等に来たと仮定した近似でもあります。どちらを選ぶかは、境目で上限の 2 倍が通ることが実害になるかどうかで決めてください。ログインの試行回数を数えるなら滑る窓が向いていて、API の使いすぎを大まかに抑えたいだけなら固定窓で足ります。
