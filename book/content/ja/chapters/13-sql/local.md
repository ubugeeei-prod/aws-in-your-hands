---
title: "13 SQL: 手元で動かす"
---

# 13 SQL: 手元で動かす

## 手元で動かす

<!-- section: 13.local -->

`examples/13-sql/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/13-sql/.env.example

```bash
vp run sql:db:migrate:local
vp run sql:db:seed:local
vp run dev:sql
```

<http://localhost:8787> で API が立ち上がります。

```bash
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"edited","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","expectedVersion":1}'
```

`<id>` は、作成の応答に入っている `id` に置き換えてください。最後のは、古い `version` での更新です。`code` が `conflict` の 409 と、いまのノートが返ってきます。

最初からやり直したいときは、これ。

```bash
vp run sql:db:reset:local
```

DB のディレクトリを消して、migration と seed を流し直します。

### 手元の DB の正体

Docker は使っていません。使っているのは PGlite という、PostgreSQL を WebAssembly にして Node.js のプロセスの中で動かす npm パッケージです。データは `examples/13-sql/.pglite/` に置かれます。

<<< @/examples/13-sql/src/pglite.ts{pglite}

`wrangler dev` がローカルの D1 を用意してくれるのに、いちばん近い体験だと思います。ただ、D1 のローカルは本番と同じ D1 が動くのに対して、こちらは**代用**です。Aurora DSQL ではありません。再現しないものを並べます。

- **競合。** 接続が 1 本なので、`40001` は一度も起きません。前の節のとおりです
- **認証。** token も IAM も database role もありません。権限が足りなくて拒否される、は手元では起きません
- **DSQL の制約。** 3,000 行の上限、5 分の上限、DDL は 1 文、`ASYNC` 必須。PGlite はどれも気にしません。lint が一部を代わりに見ています
- **版。** 手元で動かしたところ、PGlite 0.5.8 は PostgreSQL 18.3 と名乗りました。DSQL は PostgreSQL 16 互換です。新しい版にしかない SQL を書くと、手元でだけ通ります
- **ネットワーク。** 接続の確立、切断、遅延がありません

もう 1 つ、手元で試してわかったことがあります。PGlite は、同じディレクトリを 2 つのプロセスが開くのを止めてくれません。そのままだと壊れるので、lock ファイルで自分で止めています。`dev:sql` を動かしたまま `sql:db:reset:local` を実行すると、「開発サーバーを止めてから」と言われて終わります。

そして `dev:sql` は、migration を勝手には流しません。まだ流していないものがあれば、名前を出して止まります。`wrangler dev` と同じ流儀です。

<<< @/examples/13-sql/src/dev.ts{dev}

`.env` の `NOTES_DB` を `dsql` にすると、同じ開発サーバーが、デプロイ済みの cluster にあなた自身の認証情報でつなぎます。これは課金されますし、まだ実際には試せていません。
