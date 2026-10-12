---
title: "59 RDS: 手元で動かす"
---

# 59 RDS: 手元で動かす

[前のページ](/ja/chapters/59-rds/more.md)の、プライマリと遅れるレプリカを、AWS につながずに手元で動かします。認証情報は要らず、料金もかかりません。

## 遅れるレプリカを手元で見る

<!-- section: 59.local -->

```bash
vp run dev:rds
```

API が <http://localhost:8787> で起動します。裏にあるのは前のページのモデルで、プライマリとレプリカの 2 つの PGlite です。レプリカは、プライマリのコミットを 5 秒遅れで受け取ります。データベースはメモリの上にあり、起動するたびに空から始まるので、13章のマイグレーションは起動のときに自動で流れます。

<<< @/examples/59-rds/src/dev.ts{dev}

ノートを 1 件作り、応答のヘッダーを見ます。

```bash
curl -si -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
```

応答に `x-notes-seen: 0/173C858` のようなヘッダーが付いています。値は、プライマリがそのとき書き終えていた位置です。5 秒たたないうちに、同じノートを 2 通りの方法で読みます。`<id>` は作成の応答の `id`、`<seen>` はいまのヘッダーの値に置き換えてください。

```bash
curl -si http://localhost:8787/notes/<id>
curl -si http://localhost:8787/notes/<id> -H 'x-notes-seen: <seen>'
```

1 つ目は 404 で、`x-notes-read-from: replica` が付きます。位置を渡していないので、レプリカが答え、レプリカはまだこのノートを知りません。2 つ目は 200 で、`x-notes-read-from: primary` です。5 秒待ってから 1 つ目をもう一度送ると、今度はレプリカが 200 を返します。

遅れの長さは、`examples/59-rds/.env.example` を `.env` にコピーして変えられます。

<<< @/examples/59-rds/.env.example

テストは、ほかの章と同じく `vp run test:unit` で動きます。

### 手元で再現しないもの

PGlite は代用で、RDS ではありません。13章で挙げた点（接続が 1 本、認証なし、ネットワークなし）に加えて、この章では次のものが手元にありません。

- レプリケーションそのもの。モデルは文を流し直しているだけで、write-ahead log は送っていません。本物のラグの大きさも、ラグが伸びる条件も、手元ではわかりません
- IAM のトークンと TLS。`rds_iam`、`rds.force_ssl`、認証局の検証は、どれも RDS に固有です
- 接続の数の上限。PGlite の接続は 1 本なので、`too many connections` は起きません
- フェイルオーバー。接続が切れることも、名前の指す先が変わることもありません
- パラメーターグループ、バックアップ、メンテナンス。インスタンスのまわりの仕組みは、すべて RDS の側にあります

版は近くなっています。手元で動かしたところ、PGlite 0.5.8 は PostgreSQL 18.3 と名乗り、スタックの既定も 18.3 です。RDS がその版をいまも新しいインスタンスに出しているかは、次のページで触れます。
