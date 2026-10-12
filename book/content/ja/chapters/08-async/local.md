---
title: "08 Queue: 手元で動かす"
---

# 08 Queue: 手元で動かす

## 手元で動かす

<!-- section: 08.local -->

`examples/08-async/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/08-async/.env.example

ターミナルを 2 つ使います。画面は 07章のものです。

```bash
vp run dev:async
vp run dev:uploads:web
```

<http://localhost:5173> を開いて、サインインして、ノートに画像を付けてください。API のターミナルに、worker のログが 1 行流れます。`"status":"recorded"` と `"verdict":"ok"` が入っているはずです。queue と記録の様子は、ここで見られます。

```bash
curl -s http://localhost:8787/local/queue
curl -s -X POST http://localhost:8787/local/queue/redrive
curl -s -X POST http://localhost:8787/local/housekeeping
```

`.env` の `LOCAL_QUEUE_DUPLICATE` を `true` にすると、すべてのイベントが 2 つのメッセージとして届きます。ログには `recorded` と `duplicate` が 1 行ずつ出て、記録は 1 つのままです。

Docker も、AWS の認証情報も要りません。

### queue の代わり

<<< @/examples/08-async/src/local-queue.ts{queue}

SQS の代わりは、小さな class です。worker が生き延びなければならない規則を 3 つだけ持っています。受け取ったメッセージは消えずに隠される。時間内に削除されなければ戻ってくる。決めた回数を超えたら、よけられる。

<<< @/examples/08-async/src/local-queue.ts{deliver}

こちらは event source mapping の代わりです。まとめて受け取って、worker を呼んで、失敗として名前の挙がらなかったメッセージだけを削除します。

### bucket の代わり

<<< @/examples/08-async/src/local-bucket.ts{local-bucket}

07章のメモリ上の実装を継承して、2 つ足しました。object が置かれたとき、消されたときに、S3 のイベントと同じ形の JSON を作ること。そして、ETag を指定した読み取りに答えること。

<<< @/examples/08-async/src/local.ts{local}

<<< @/examples/08-async/src/dev.ts{dev}

worker は、Lambda で動くのと同じ関数です。違うのは、まわりに立っているものだけです。

これは SQS や S3 の模擬ではありません。再現しないものを挙げておきます。

- SQS の配送そのもの。重複や順序の入れ替わりは、テストがわざと起こすもので、勝手には起きない
- S3 の通知の遅れと、sequencer の実際の形
- event source mapping の動き。同時実行、batch の作られ方、throttle されたときの再試行
- IAM。queue policy、関数の role、Scheduler の role
- EventBridge Scheduler。手元では、掃除は `curl` で呼んだときだけ動く
- lifecycle rule。手元では、pending の object はいつまでも残る

### テスト

```bash
vp run test:unit
```

テストは、開発サーバーと同じ部品を、時計と ID を固定して組み立てています。queue を通す必要がないテストは、メッセージを worker の関数に直接渡します。
