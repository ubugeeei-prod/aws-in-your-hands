---
title: "49 Athena: 手元で動かす"
---

# 49 Athena: 手元で動かす

## 手元で確かめられること

<!-- section: 49.local -->

Athena は手元では動きません。26章と同じ理由で、別の SQL エンジンで代用することもしていません。このページで動かすのは、[前のページ](/ja/chapters/49-athena/build.md)で書いた文の組み立て、クライアント、料金の計算、スタックのテストです。この章の SQL は、1 つも実行していません。

```bash
vp test run examples/49-athena
```

テストが確かめているのは、次のことです。

- 文の本文が、利用者の値で変わらないこと。同じ攻撃の値を、文字列で組み立てる関数とパラメーターを使う関数の両方に渡します
- 文字列のパラメーターが、どんな値でも 1 つの引用符の組に収まること。DDL と `MERGE` に入れる値が、検査を通ったものだけであること
- クライアントが、上限ちょうどまでしか待たず、待つのをやめるときにクエリを止めること。開始の応答が失われても、同じ `attempt` ならクエリが 1 つしかできないこと。結果のページ送りと、行数の打ち切り
- 読む量と料金の計算。料金のシナリオに書いた数量は、このテストの値と同じです
- スタックのアサーション。上限、エンジンの版、結果の保存先、ロールの権限に `*` がないこと、使っているリソースの種類

クライアントのテストが相手にしているのは、この章が API リファレンスを読んで書いた代役です。本物の Athena が同じように振る舞うことの証拠にはなりません。

文は、実行せずに表示できます。

```bash
vp run athena:sql --name merge --from 2026-10-12 --to 2026-10-12
```

```text
MERGE INTO aih_analytics.requests_iceberg AS t
USING (
  SELECT v, event_id, at, request_id, method, route, status, duration_ms, action, note_id, min(dt) AS dt
  FROM aih_analytics.requests
  WHERE dt BETWEEN '2026-10-12' AND '2026-10-12'
  GROUP BY v, event_id, at, request_id, method, route, status, duration_ms, action, note_id
) AS s
ON t.event_id = s.event_id
WHEN NOT MATCHED
  THEN INSERT (v, event_id, at, request_id, method, route, status, duration_ms, action, note_id, dt) VALUES (s.v, s.event_id, s.at, s.request_id, s.method, s.route, s.status, s.duration_ms, s.action, s.note_id, s.dt)

parameters: []
```

`--name` に渡せるのは、`route`、`create-compact`、`compact`、`scratch`、`unload`、`create-iceberg`、`merge`、`optimize`、`vacuum`、`yesterday` の 10 個です。場所を含む文では、バケットの名前が AWS のドキュメントの例と同じ `amzn-s3-demo-bucket` になります。実際の名前は、デプロイしたスタックの出力から読みます。

スタックの synth も、AWS に問い合わせずに通ります。

```bash
vp run athena:infra:synth
```
