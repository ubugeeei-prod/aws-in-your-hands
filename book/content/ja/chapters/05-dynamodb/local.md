---
title: "05 KV Store: 手元で動かす"
---

# 05 KV Store: 手元で動かす

[しくみと実装](/ja/chapters/05-dynamodb/build.md)のページで書いた API を、手元で動かします。まずメモリの実装で、次に DynamoDB Local で動かし、そのあとテストが何を確かめているかを見ます。

## 手元で動かす

<!-- section: 05.local -->

`examples/05-dynamodb/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/05-dynamodb/.env.example

必要な環境変数は、保存先によって変わります。環境変数を検証するスキーマは、その違いも表しています。

<<< @/examples/05-dynamodb/src/env.ts{env}

### メモリで動かす

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

`<id>` は、1 つ目のレスポンスの `id` に置き換えてください。2 つ目のコマンドは `version` が 2 のノートを返し、3 つ目は 409 と、保存されているノートを返します。

メモリの実装は、API の形と規則を確かめるには十分です。ただし、DynamoDB そのものの挙動は何も確かめられません。

### DynamoDB Local で動かす

DynamoDB Local は、AWS が配布している DynamoDB の模擬実装で、コンテナとして動かします。Docker のデーモンが動いている必要があり、Docker は devShell には含まれていません。

```bash
vp run db:local:start
vp run db:migrate:local
vp run db:seed:local
```

`db:migrate:local` がテーブルを作り、`db:seed:local` が `test/fixtures/seed-notes.json` のノートを入れます。`.env` の `NOTES_STORE` を `dynamodb` に変えて `vp run dev:notes` を起動すると、API がこのテーブルを使います。テーブルを作り直すときは `vp run db:reset:local` を、コンテナを止めて消すときは `vp run db:local:stop` を実行します。

これらのタスクは、接続先が `localhost` でないかぎり実行を拒否するので、誤って実際の AWS のテーブルを消すことはありません。

D1 のローカル開発と比べると、違いが 2 つあります。D1 は `wrangler dev` を起動するだけでローカルのデータベースが用意されますが、DynamoDB では模擬実装を自分で起動します。また、D1 のマイグレーションは SQL ファイルを順に適用しますが、DynamoDB には列の定義がなく、テーブルに対して決めるのはキーだけです。手元のテーブルは `scripts/local-db.ts` が、AWS 上のテーブルは CDK が作ります。この 2 つの定義は、手で揃えています。

DynamoDB Local は模擬実装なので、確かめられるのは、式が受け付けられることと、1 台の上で意図どおりに動くことまでです。IAM、スロットリング、実際のサービスの複製や遅延は再現しません。

この節のタスクのうち、Docker でコンテナを起動する `db:local:start` と `db:local:stop` は、まだ実行できていません。書いた時点で Docker のデーモンが使えなかったためです。`db:migrate:local`、`db:seed:local`、`db:reset:local` も、タスクとしては実行していません。DynamoDB Local に対するテストの結果は、次の「テスト」の節に書きます。

## テスト

<!-- section: 05.tests -->

```bash
vp run test:unit
vp run test:local:dynamodb
```

テストは 5 つの層に分かれていて、層ごとに確かめるものが違います。

| 層 | ファイル | 見ているもの | 見られないもの |
| --- | --- | --- | --- |
| コントラクト（メモリ） | `test/repository-contract.ts`、`test/memory-repository.test.ts` | リポジトリの規則。上書きの禁止、version、ページ送り、持ち主の分離、件数の上限 | DynamoDB の挙動 |
| リクエストの検査 | `test/dynamodb-repository.test.ts` | DynamoDB に送る条件式、キーの形、整合性の指定。失敗した条件の扱い | DynamoDB がそのリクエストどおりに動くこと |
| コントラクト（DynamoDB Local） | `test/dynamodb-local.test.ts` | 同じ規則が、模擬実装の上で成り立つこと | IAM、スロットリング、実際のサービスの分散した挙動 |
| アプリとクライアント | `test/app.test.ts` | 409、ページ送り、偽のカーソルの拒否、一覧の大きさの上限、レスポンスを失った後の再試行、101 件目の拒否 | Lambda と API Gateway を通ったときの挙動 |
| インフラ | `infra/test/notes-stack.test.ts` | 権限が 5 つの操作と 1 つのテーブルに限られること、テーブルの削除方針、テーブルの上限とステージのスロットリング | AWS がそのテンプレートどおりに動くこと |

コントラクトテストは、規則を 1 回だけ書いて、実装ごとに実行します。

DynamoDB の実装のテストでは、SDK のクライアントの代用品を渡して、送られるリクエストを調べます。保証を担っている `ConditionExpression`、`ConsistentRead`、キーの形のどれかを誰かが消すと、このテストが落ちます。ただし、このテストが確かめるのは、正しいリクエストを送っていることまでです。DynamoDB がそのリクエストをどう扱うかは、DynamoDB Local か実際の AWS で確かめます。

`test:local:dynamodb` は、`DYNAMODB_ENDPOINT` が無いと失敗します。テストファイル自体は、接続先が無いときに自分をスキップします。スキップされたテストは一見すると成功に見えるので、専用のタスクでは失敗にしています。`vp run test:unit` の出力に `1 skipped` と出るのは、このテストです。

同時の書き込みについては、同じ `version` を持つ 2 つの書き込みのうち、通るのはちょうど 1 つであることを確かめる検査が、コントラクトテストにあります。メモリの実装では、書き込みが 1 つのプロセスの中で順に実行されるので、この検査は常に成り立ちます。

件数の上限にも同じ種類の検査があります。枠が 3 つのところへ作成を 6 件同時に送り、通るのがちょうど 3 件であることを確かめます。

これらの検査を本当に実行したいのは実際の DynamoDB の上ですが、そこではまだ一度も実行できていません。DynamoDB Local（3.3.1）の上では、コントラクトテストの 15 件が通りました。このときの DynamoDB Local は、Docker のタスクではなく、AWS が配布する jar から直接起動したものです。ただし、模擬実装は 1 台で動くものです。つまり、この章の中心である「条件付き書き込みが同時の書き込みを決まった数だけ通す」ことは、実物の上では未確認です。DynamoDB の挙動についての記述は、公式ドキュメントに基づいています。
