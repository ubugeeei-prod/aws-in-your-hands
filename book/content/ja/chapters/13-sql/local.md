---
title: "13 SQL: 手元で動かす"
---

# 13 SQL: 手元で動かす

[前のページ](/ja/chapters/13-sql/build.md)で実装した API を、AWS につながずに手元で動かします。認証情報は要らず、料金もかかりません。

## 手元で動かす

<!-- section: 13.local -->

`examples/13-sql/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/13-sql/.env.example

```bash
vp run sql:db:migrate:local
vp run sql:db:seed:local
vp run dev:sql
```

API は <http://localhost:8787> で起動します。

```bash
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"edited","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","expectedVersion":1}'
```

`<id>` は、作成の応答に入っている `id` に置き換えてください。最後の `curl` は古い `version` での更新なので、`code` が `conflict` の 409 と、いまのノートが返ってきます。

データベースを最初の状態に戻すには、次のタスクを使います。

```bash
vp run sql:db:reset:local
```

このタスクは、データベースのディレクトリを消して、マイグレーションとシードを流し直します。

### 手元のデータベース

Docker は使っていません。使っているのは PGlite で、PostgreSQL を WebAssembly にして Node.js のプロセスの中で動かす npm パッケージです。データは `examples/13-sql/.pglite/` に置かれます。

<<< @/examples/13-sql/src/pglite.ts{pglite}

`wrangler dev` がローカルの D1 を用意してくれるのに近い使い心地ですが、D1 のローカルでは本番と同じ D1 が動くのに対して、PGlite は**代用**であり、Aurora DSQL ではありません。次のものは手元では再現しません。

- 競合。接続が 1 本なので、`40001` は一度も起きません。テストでわざと起こしている理由は、[前のページの「競合をわざと起こす」](/ja/chapters/13-sql/build.md)に書きました
- 認証。トークンも IAM もデータベースロールもないので、権限が足りずに拒否されることは手元では起きません
- DSQL の制約。3,000 行の上限、5 分の上限、DDL は 1 文、`ASYNC` 必須のどれも、PGlite は気にしません。lint が一部を代わりに見ています
- 版。手元で動かしたところ、PGlite 0.5.8 は PostgreSQL 18.3 と名乗りました。DSQL は PostgreSQL 16 互換なので、新しい版にしかない SQL を書くと、手元でだけ通ります
- ネットワーク。接続の確立、切断、遅延がありません

手元で試してわかったこともあります。PGlite は、同じディレクトリを 2 つのプロセスが開くのを止めません。そのままではデータが壊れるので、この章のコードがロックファイルを使って 2 つ目のプロセスを止めています。`dev:sql` を動かしたまま `sql:db:reset:local` を実行すると、開発サーバーを止めるよう促すメッセージを出して終わります。

`dev:sql` は、マイグレーションを自動では流しません。まだ流していないものがあれば、その名前を出して止まります。`wrangler dev` と同じ方針です。

<<< @/examples/13-sql/src/dev.ts{dev}

`.env` の `NOTES_DB` を `dsql` にすると、同じ開発サーバーが、デプロイ済みのクラスターにあなた自身の認証情報でつなぎます。この使い方は課金され、まだ実際には試せていません。
