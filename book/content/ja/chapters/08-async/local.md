---
title: "08 Queue: 手元で動かす"
---

# 08 Queue: 手元で動かす

## 手元で動かす

<!-- section: 08.local -->

[前のページ](/ja/chapters/08-async.md)で作ったワーカーと掃除を、AWS を使わずに手元で動かします。キューとバケットの代わりになる小さな実装を用意し、その上で同じワーカーの関数を動かします。

まず、`examples/08-async/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/08-async/.env.example

ターミナルを 2 つ使います。画面は 07章のものです。

```bash
vp run dev:async
vp run dev:uploads:web
```

<http://localhost:5173> を開いてサインインし、ノートに画像を付けてください。API のターミナルにワーカーのログが 1 行流れ、その中に `"status":"recorded"` と `"verdict":"ok"` が入っているはずです。キューと記録の様子は、次のコマンドで見られます。

```bash
curl -s http://localhost:8787/local/queue
curl -s -X POST http://localhost:8787/local/queue/redrive
curl -s -X POST http://localhost:8787/local/housekeeping
```

`.env` の `LOCAL_QUEUE_DUPLICATE` を `true` にすると、すべてのイベントが 2 つのメッセージとして届きます。ログには `recorded` と `duplicate` が 1 行ずつ出て、記録は 1 つのままです。

Docker も、AWS の認証情報も要りません。

### キューの代わり

<<< @/examples/08-async/src/local-queue.ts{queue}

SQS の代わりは、小さな class です。ワーカーが耐えなければならない規則を 3 つだけ持っています。受け取ったメッセージは消えずに隠されること、時間内に削除されなければ戻ってくること、決めた回数を超えて受け取られたらよけられることです。

<<< @/examples/08-async/src/local-queue.ts{deliver}

`deliverOnce` は、イベントソースマッピングの代わりです。メッセージをまとめて受け取ってワーカーを呼び、失敗として ID が返されなかったメッセージだけを削除します。

### バケットの代わり

<<< @/examples/08-async/src/local-bucket.ts{local-bucket}

07章のメモリ上の実装を継承して、機能を 2 つ足しました。オブジェクトが置かれたときと消されたときに S3 のイベントと同じ形の JSON を作ることと、ETag を指定した読み取りに答えることです。

<<< @/examples/08-async/src/local.ts{local}

<<< @/examples/08-async/src/dev.ts{dev}

ワーカーは、Lambda で動くものと同じ関数です。違うのは、ワーカーのまわりに置いた部品だけです。

この 2 つの実装は、SQS や S3 の模擬ではありません。再現しないものを挙げておきます。

- SQS の配送そのもの。重複や順序の入れ替わりは、テストがわざと起こすもので、勝手には起きない
- S3 の通知の遅れと、`sequencer` の実際の形
- イベントソースマッピングの動き。同時実行、バッチの作られ方、スロットリングされたときの再試行
- IAM。queue policy、関数のロール、Scheduler のロール
- EventBridge Scheduler。手元では、掃除は `curl` で呼んだときだけ動く
- ライフサイクルルール。手元では、pending のオブジェクトはいつまでも残る

### テスト

```bash
vp run test:unit
```

テストは、開発サーバーと同じ部品を、時計と ID を固定して組み立てています。キューを通す必要がないテストは、メッセージをワーカーの関数に直接渡します。
