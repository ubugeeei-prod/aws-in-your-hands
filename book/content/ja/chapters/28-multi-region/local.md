---
title: "28 Multi-Region: 手元で動かす"
---

# 28 Multi-Region: 手元で動かす

## 手元で動かす

<!-- section: 28.local -->

[前のページ](/ja/chapters/28-multi-region/build.md)で読んだ場面は、AWS のアカウントがなくても、手元で順に見られます。

```bash
vp run mr:demo
```

このタスクは、メモリ上の 2 つのリージョンに、05章の API を 1 つずつ置いて動かします。

<<< @/examples/28-multi-region/src/local.ts{world}

編集は、本物の API と同じ `PUT` のリクエストとして送っています。

<<< @/examples/28-multi-region/scripts/demo.ts{edit}

出力は次のとおりです。

```text
1. Eventual mode (MREC). Two people edit version 1, one in each Region.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 200 from ap-northeast-3
  ap-northeast-1 holds: "bread", version 2
  ap-northeast-3 holds: "bread", version 2
  Both were told 200. One edit is gone, and no response said so.

2. Eventual mode, every write sent to Tokyo.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 409 from ap-northeast-1
  Chapter 05's check works again, because one copy sees both writes.

3. Eventual mode. Tokyo acknowledges an edit and is cut off before it replicates.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 200 from ap-northeast-3
  writes waiting for the two Regions to reconnect: 2
  ap-northeast-1 holds: "bread", version 2
  ap-northeast-3 holds: "bread", version 2
  Tokyo's edit arrived an hour late and lost to the newer one.

4. Strong mode (MRSC), three Regions. The same two edits.
  PUT "milk, eggs" (expects version 1) -> 200 from ap-northeast-1
  PUT "bread" (expects version 1) -> 409 from ap-northeast-3
  PUT "butter" (expects version 1) -> 500 from ap-northeast-1
  The second edit gets its 409. Alone, Tokyo fails the request instead of guessing.

5. The bucket. An image is deleted in Tokyo; another is uploaded 2 s before an outage.
  in Osaka: deleted image present, new image missing
  waiting in Tokyo: 1 object

6. The targets, and what they are made of.
  RTO 300 s: detect 90 s + DNS 60 s + client 60 s = 210 s (within)
  RPO notes 60 s, images 900 s. Assumed, not measured.
```

1 と 2 を見比べてください。同じ 2 つの編集で、違うのは 2 つ目をどちらのリージョンに送ったかだけです。大阪に送ると `200` が返って編集が 1 つ消え、東京に送ると `409` が返ります。4 では、大阪に送っても `409` が返ります。整合性モードが、条件を確かめる場所を 1 つにしているからです。

4 の最後の `500` は、孤立した東京が、推測で答える代わりにリクエストを失敗させたものです。MRSC では、使えないリージョンは、使えないことを隠しません。MREC の 3 では、切り離された東京も大阪も `200` を返し続けています。障害の最中に動き続けることと、あとで食い違わないことは、同時には手に入りません。

テストは、ほかの章と同じタスクで実行します。

```bash
vp run test:unit
```

モデルとテストが再現しないものを挙げておきます。複製にかかる実際の時間と、そのばらつき。同じ時刻の 2 つの書き込みを DynamoDB がどう扱うか。MRSC で、ほかのリージョンが変更している最中のアイテムに書いたときのエラー。リージョンが半分だけ壊れている状態、たとえば DynamoDB は動いているのに API Gateway が動いていない場合。Route 53 のチェッカーの実際の数と配置、DNS の TTL、クライアントのキャッシュ。S3 の複製が失敗した場合（`FAILED`）。そして IAM です。どれも、実物でしか確かめられません。
