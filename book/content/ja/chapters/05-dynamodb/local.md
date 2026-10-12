---
title: "05 KV Store: 手元で動かす"
---

# 05 KV Store: 手元で動かす

## 手元で動かす

<!-- section: 05.local -->

動かしてみましょう。`examples/05-dynamodb/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/05-dynamodb/.env.example

環境変数の検証は、保存先によって必要な変数が変わることを、schema で表しています。

<<< @/examples/05-dynamodb/src/env.ts{env}

### まずはメモリで

既定の `NOTES_STORE=memory` のまま起動します。Docker も AWS も要りません。

```bash
vp run dev:notes
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"draft"}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"final","body":"","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","body":"","expectedVersion":1}'
curl -s 'http://localhost:8787/notes?limit=1'
```

`<id>` は、1 つ目の応答の `id` に置き換えてください。2 つ目は version 2 のノートを返して、3 つ目は 409 と、保存されているノートを返します。

メモリの実装は、API の形と規則を確かめるには十分です。ただ、DynamoDB そのものについては何も教えてくれません。

### DynamoDB Local で動かす

DynamoDB Local は、AWS が配っている DynamoDB の模擬実装です。コンテナとして動かします。Docker の daemon が動いていることが前提で、devShell には付いてきません。

```bash
vp run db:local:start
vp run db:migrate:local
vp run db:seed:local
```

`db:migrate:local` が table を作って、`db:seed:local` が `test/fixtures/seed-notes.json` のノートを入れます。`.env` の `NOTES_STORE` を `dynamodb` に変えて `vp run dev:notes` を起動すれば、API がこの table を使います。やり直すときは `vp run db:reset:local`、コンテナを止めて消すときは `vp run db:local:stop` です。

これらのタスクは、接続先が `localhost` でないかぎり実行を拒否します。うっかり実際の AWS の table を消すことはありません。

D1 のローカル開発と比べると、違いが 2 つあります。D1 は `wrangler dev` を起動するだけでローカルのデータベースが用意されますが、こちらは模擬実装を自分で起動します。もう 1 つ、D1 の migration は SQL ファイルを順に適用しますが、DynamoDB には列の定義がなく、table に対して決めるのは key だけです。手元の table は `scripts/local-db.ts` が、AWS 上の table は CDK が作ります。この 2 つの定義は、手で揃えています。

DynamoDB Local はあくまで模擬実装です。式が受け付けられること、1 台の上で意図どおりに動くことは確かめられます。IAM、流量の制限、実際のサービスの複製や遅延は再現しません。

正直に言うと、この節の DynamoDB Local のタスクは、まだ実行できていません。書いたときに Docker の daemon が使えなかったためです。

## テスト

<!-- section: 05.tests -->

```bash
vp run test:unit
vp run test:local:dynamodb
```

テストは 5 つの層に分かれています。それぞれ、見ているものが違います。

| 層 | ファイル | 見ているもの | 見られないもの |
| --- | --- | --- | --- |
| contract（メモリ） | `test/repository-contract.ts`、`test/memory-repository.test.ts` | repository の規則。上書きの禁止、version、ページ送り、持ち主の分離、件数の上限 | DynamoDB の挙動 |
| リクエストの検査 | `test/dynamodb-repository.test.ts` | DynamoDB に送る条件式、key の形、整合性の指定。失敗した条件の扱い | DynamoDB がその依頼どおりに動くこと |
| contract（DynamoDB Local） | `test/dynamodb-local.test.ts` | 同じ規則が、模擬実装の上で成り立つこと | IAM、流量の制限、実サービスの分散した挙動 |
| アプリと client | `test/app.test.ts` | 409、ページ送り、偽の cursor の拒否、一覧の大きさの上限、応答を失った後の再試行、101 件目の拒否 | Lambda と API Gateway を通ったときの挙動 |
| インフラ | `infra/test/notes-stack.test.ts` | 権限が 5 つの操作と 1 つの table に限られること、table の削除方針、table と stage の流量の上限 | AWS がその template どおりに動くこと |

contract test は、規則を 1 回だけ書いて、実装ごとに実行します。

DynamoDB の実装のほうは、SDK の client の代用品を渡して、送られるリクエストを調べます。保証を担っている部分（`ConditionExpression`、`ConsistentRead`、key の形）を誰かが消すと、このテストが落ちます。ただ、これは「正しい依頼を送っている」ことの確認です。DynamoDB がその依頼をどう扱うかは、DynamoDB Local か実際の AWS で確かめます。

`test:local:dynamodb` は、`DYNAMODB_ENDPOINT` が無いと失敗します。テストファイル自体は、接続先が無いとき自分を skip します。skip されたテストはぱっと見、成功に見えてしまうので、専用のタスクでは失敗にしています。`vp run test:unit` の出力に `1 skipped` と出るのは、このテストです。

同時の書き込みについては、contract test に「同じ version を持つ 2 つの書き込みのうち、通るのはちょうど 1 つ」という検査があります。メモリの実装では、これは常に成り立ちます。1 つのプロセスの中で順に実行されるからです。

件数の上限にも同じ検査があります。席が 3 つのところへ作成を 6 件同時に送って、通るのがちょうど 3 件であること。

ここは正直に書いておきます。本当に確かめたいのは DynamoDB の上でなのですが、実際の DynamoDB では、まだ一度も実行できていません。DynamoDB Local（3.3.1）の上では、contract test の 15 件が通りました。ただ、模擬実装は 1 台で動くものです。つまり、この章の中心である「条件付き書き込みが同時の書き込みを決まった数だけ通す」ことは、実物の上では未確認です。DynamoDB の挙動についての記述は、公式ドキュメントに基づいています。
