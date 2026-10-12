---
title: "56 Nova: 手元で動かす"
---

# 56 Nova: 手元で動かす

[しくみと実装](/ja/chapters/56-nova/build.md)で作った API を手元で起動し、2 つのリクエストが重なったときの動きを確かめます。そのあとでテストを実行します。このページの操作は AWS に触れず、料金もかかりません。

## 手元で動かす

<!-- section: 56.local -->

`examples/56-nova/.env.example` を `.env` にコピーして、開発サーバーを起動します。

```bash
vp run dev:nova
```

```text
inference: none. Playing fixtures/converse/described.json. No AWS call, no charge
one upload is in place: /notes/note-1/attachments/image-1
description API on http://localhost:8856
```

1 行目が、モデルを呼んでいないことの表示です。既定の設定では、S3 の代わりにメモリ上の入れ物を使い、モデルの代わりに、手で書いた応答を再生します。

<<< @/examples/56-nova/src/dev.ts{dev}

起動すると、アップロードが 1 つ置かれた状態になります。07章の API を通っていない、テスト用の 1 × 1 ピクセルの PNG です。サインインはなく、どのリクエストも `local` という 1 人の持ち主として扱います。再生するモデルは、答える前に 3 秒待ちます。2 つ目のリクエストを割り込ませる時間を作るためです。

ターミナルを 2 つ使います。1 つ目で PUT を送り、返ってくる前に、2 つ目で同じ PUT を送ります。

```bash
curl -i -X PUT http://localhost:8856/notes/note-1/attachments/image-1/description
```

あとから送ったほうは、すぐに返ってきます。次は応答の 1 行目、`Retry-After` ヘッダー、本文です。

```text
HTTP/1.1 202 Accepted
retry-after: 2
{"status":"in_progress","retryAfterSeconds":2}
```

先に送ったほうは、3 秒後に説明文を受け取ります。

```text
HTTP/1.1 200 OK
{"status":"ready","outcome":"described","text":"木の机の上に、開いたノートと青いペンが置かれている。","modelId":"jp.amazon.nova-2-lite-v1:0","createdAt":"2026-10-12T16:15:15.977Z","reused":false}
```

もう一度 PUT を送ると、今度は待たされません。`createdAt` が同じで、`reused` が `true` になっています。

```text
{"status":"ready","outcome":"described","text":"木の机の上に、開いたノートと青いペンが置かれている。","modelId":"jp.amazon.nova-2-lite-v1:0","createdAt":"2026-10-12T16:15:15.977Z","reused":true}
```

サーバーのログには、3 つのリクエストが 1 行ずつ出ます。`billed` にトークン数が入っているのは、モデルを呼んだ 1 件だけです。

```text
{"level":"info","message":"describe","requestId":"63e941b1-8039-4987-b804-d016d03d542d","modelId":"jp.amazon.nova-2-lite-v1:0","outcome":"in_progress","billed":null,"durationMs":0}
{"level":"info","message":"describe","requestId":"3e60d930-a7db-475a-9907-52673e8cd4cd","modelId":"jp.amazon.nova-2-lite-v1:0","outcome":"ready","billed":{"inputTokens":318,"outputTokens":27},"durationMs":3004}
{"level":"info","message":"describe","requestId":"6610b6d9-37ec-4f17-99fa-f104764f3cba","modelId":"jp.amazon.nova-2-lite-v1:0","outcome":"ready","billed":null,"durationMs":0}
```

説明文もトークン数も、再生している応答に書いてある値です。実際のモデルの出力ではありません。

再生する応答は、次の形のファイルです。

<<< @/examples/56-nova/src/scripted-model.ts{script}

ファイルは `fixtures/converse/` に 4 つあり、`.env` の `NOVA_SCRIPT` で選びます。`refused` はモデルが断った場合、`max-tokens` は途中で切れた場合、`throttled-then-described` は 1 回目がスロットリングで失敗する場合です。どれも Converse の API リファレンスを見て手で書いたもので、実際の推論から採取したものではありません。

設定は、起動のときにまとめて検査します。

<<< @/examples/56-nova/src/env.ts{env}

`NOVA_BACKEND` には、17章と同じ理由で既定値を置いていません。課金される設定で動いているかどうかを、推測に任せないためです。`DESCRIBE_MODEL_ID` は、最初のページの一覧と照らします。終了したモデルの ID を書くと、サーバーは起動しません。

```text
Error: Invalid environment:
  DESCRIBE_MODEL_ID: Nova Canvas (amazon.nova-canvas-v1:0) reached end of life on 2026-09-30: requests to it fail
```

リースが推論の待ち時間の上限より短い設定も、ここで断ります。

部品を組み立てる場所は 1 か所です。開発サーバーも Lambda の関数も、保存先、モデル、持ち主の決め方の 3 つを渡して、同じアプリを作ります。

<<< @/examples/56-nova/src/compose.ts{compose}

`.env` で `NOVA_BACKEND=bedrock` にして `MEDIA_BUCKET` を書くと、開発サーバーは実際の S3 と Bedrock を使います。サーバーは手元で動いていても、推論は Bedrock で動き、新しい説明文を作るたびに課金されます。バケットは、[デプロイ](/ja/chapters/56-nova/deploy.md)で作るものを使います。この組み合わせは、この章を書いている時点では試していません。

一覧を表示するタスクも、手元だけで動きます。

```bash
vp run nova:catalog
```

```text
Amazon Nova on Bedrock as read on 2026-10-13. Today (UTC) is 2026-10-12.

Nova 2 Lite  text+image+video -> text  (Converse, InvokeModel)
  from ap-northeast-1: jp.amazon.nova-2-lite-v1:0 [2 Regions], global.amazon.nova-2-lite-v1:0
  USD per 1K tokens: 0.000396 in, 0.003311 out
  no end of life before 2026-12-02 (50 days away)
Nova Lite  text+image+video -> text  (Converse, InvokeModel)
  from ap-northeast-1: amazon.nova-lite-v1:0, apac.amazon.nova-lite-v1:0 [6 Regions]
  USD per 1K tokens: 0.000072 in, 0.000288 out
  the promise of no end of life ran out on 2025-12-05 (312 days ago)
Nova Pro  text+image+video -> text  (Converse, InvokeModel)
  from ap-northeast-1: apac.amazon.nova-pro-v1:0 [6 Regions]
  USD per 1K tokens: 0.00096 in, 0.00384 out
  the promise of no end of life ran out on 2025-12-05 (312 days ago)
Nova Micro  text -> text  (Converse, InvokeModel)
  from ap-northeast-1: (none confirmed)
  USD per 1K tokens: 0.000042 in, 0.000168 out
  the promise of no end of life ran out on 2025-12-05 (312 days ago)
Nova 2 Sonic  speech+text -> speech+text  (InvokeModelWithBidirectionalStream)
  from ap-northeast-1: amazon.nova-2-sonic-v1:0
  no end of life before 2026-12-02 (50 days away)
Nova Multimodal Embeddings  text+image+video+audio -> embedding  (StartAsyncInvoke)
  from ap-northeast-1: (none confirmed)
  no end of life before 2026-10-28 (15 days away)

Reached end of life: requests fail
  Nova Canvas  amazon.nova-canvas-v1:0  legacy 2026-03-30, end of life 2026-09-30
  Nova Reel  amazon.nova-reel-v1:0  legacy 2026-03-30, end of life 2026-09-30
  Nova Reel  amazon.nova-reel-v1:1  legacy 2026-03-30, end of life 2026-09-30
  Nova Sonic  amazon.nova-sonic-v1:0  legacy 2026-03-13, end of life 2026-09-14

Routes that can describe an image (-c describeModel=...):
  jp.amazon.nova-2-lite-v1:0  (geo)
  global.amazon.nova-2-lite-v1:0  (global)
  amazon.nova-lite-v1:0  (in-region)
  apac.amazon.nova-lite-v1:0  (geo)
  apac.amazon.nova-pro-v1:0  (geo)

1,000 summaries (2,000 tokens in, 150 out each), inference only:
  Nova 2 Lite  USD 1.29
  Nova Lite    USD 0.19
  Nova Pro     USD 2.50
  Nova Micro   USD 0.11
```

日付は UTC で数えているので、日本時間の 2026-10-13 の未明に実行したこの出力では、今日が 10-12 になっています。

## テスト

<!-- section: 56.tests -->

```bash
vp test run examples/56-nova
```

テストは、モデルも S3 も使いません。時計は、テストが進めたときにだけ進みます。モデルの代役は、テストが合図するまで答えません。この 2 つがあるので、2 つの実行が重なる順序を、テストの中で 1 手ずつ決められます。

不変条件を壊そうとするテストは、次の順序を再現します。

- 2 つのリクエストが同時に届く。モデルが呼ばれるのは 1 回で、あとから来たほうは `in_progress` を受け取る
- 最初の実行がリースより長くかかり、2 つ目が引き継いで、両方がモデルの答えを受け取る。モデルは 2 回呼ばれるが、保存される説明文は 1 つで、2 つの実行は同じものを返す。遅れた実行は、引き継いだ側の claim を消さない
- claim を書いた実行が、そのまま消えてしまう。リースが切れるまではほかの実行は待ち、切れたあとの実行が引き継ぐ
- モデルがスロットリングで失敗する。claim は返され、次のリクエストがそのまま実行できる
- 途中で切れた答え、空の答え、形の違う答えが返る。どれも保存されず、失敗として返る
- ほかの利用者が、同じノートと添付の ID で PUT、GET、DELETE を送る。モデルは呼ばれず、相手のオブジェクトには触れず、PUT と GET の応答は添付が無いときと同じ 404 になる
- パスに `..%2F` を混ぜたリクエストが届く。404 で、claim も書かれない

S3 の代役は、次のクラスです。

<<< @/examples/56-nova/src/memory-media.ts{memory}

この代役が写しているのは、コメントに書いた 3 つの性質だけです。実際の S3 が条件付きの書き込みをどういうタイミングで断るか、削除と重なったときに 409 がいつ返るかは、写していません。S3 に送るリクエストの形は、別のテストで確かめています。`If-None-Match` と `If-Match` のヘッダーが付くことと、412 と 409 を失敗ではなく「条件が成り立たなかった」と読むことです。

スタックのテストは、[デプロイ](/ja/chapters/56-nova/deploy.md)のページで説明します。

手元のテストでわからないことは、はっきりしています。実際のモデルが画像を見てどう答えるか、実際の応答がフィクスチャと同じ形か、S3 と Bedrock の権限がこの章のロールで足りるか、の 3 つです。どれも、デプロイして `nova:smoke` を通すまで確かめられません。
