---
title: "30 Data Modeling: 手元で動かす"
---

# 30 Data Modeling: 手元で動かす

[しくみと実装](/ja/chapters/30-data-modeling/build.md)と[実装のつづき](/ja/chapters/30-data-modeling/more.md)で書いたコードを、手元で動かします。この章には開発サーバーがありません。動かすのは、すべての読み方を順に実行するスクリプトと、テストです。

## 手元で動かす

<!-- section: 30.local -->

```bash
vp run modeling:demo
```

`modeling:demo` は、メモリ上のモデルに対して、作成、添付、取得、編集、一覧、件数を 1 回ずつ実行します。AWS も、模擬実装も、ファイルも使いません。操作ごとに、送ったリクエストと、書き込みの数と、結果を表示します。

<<< @/examples/30-data-modeling/scripts/demo.ts{step}

```text
create a note with two tags and a slug
  sent    TransactWriteItems of 5
  writes  table 10, index 1
  result  created

attach an image
  sent    TransactWriteItems of 2
  writes  table 4, index 0
  result  created

read the note with its attachments
  sent    Query table between NOTE#kyoto and NOTE#kyoto#~
  writes  table 0, index 0
  result  kyoto, 1 attachment

edit the body
  sent    GetItem NOTE#kyoto, update NOTE#kyoto
  writes  table 1, index 2
  result  updated

rename it
  sent    GetItem NOTE#kyoto, TransactWriteItems of 3
  writes  table 6, index 2
  result  updated

list by tag
  sent    Query table begins_with TAG#food#NOTE#
  writes  table 0, index 0
  result  ramen | Kyoto in autumn

list the most recently updated
  sent    Query gsi1 begins_with UPDATED#
  writes  table 0, index 0
  result  Kyoto in autumn | ramen

the same list, with the index held back and one more note created
  sent    Query gsi1 begins_with UPDATED#
  writes  table 0, index 0
  result  Kyoto in autumn | ramen   (no diary yet)

count the notes
  sent    GetItem QUOTA
  writes  table 0, index 0
  result  3

count a tag before the stream consumer has run
  sent    GetItem TAGCOUNT#food
  writes  table 0, index 0
  result  0

feed the stream consumer 15 records, then the same 15 again
  sent    TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2, TransactWriteItems of 2
  writes  table 24, index 0
  result  first 3 applied, second 0 applied and 3 recognized

count the tag again
  sent    GetItem TAGCOUNT#food
  writes  table 0, index 0
  result  2
```

`writes` の行は、アイテムへの書き込みの回数です。トランザクションの中のアイテムは 2 回ぶんとして数えてあります。アイテムがどれも 1 KB 以下なら、この数が write request unit と一致します。大きなアイテムでは、1 KB ごとに 1 つずつ増えます。条件だけを確かめる `ConditionCheck` も 2 回ぶんに数えましたが、DynamoDB がこれを書き込みと読み取りのどちらとして課金するかは、確認していません。

出力から読み取れることを、3 つ挙げます。

本文の編集（`edit the body`）は、テーブルへの書き込みが 1 回で、インデックスへの書き込みが 2 回です。題名の変更（`rename it`）は、タグ 2 つのアイテムを書き直すので、トランザクションになります。

インデックスを止めてからノートを作ると（`the same list, with the index held back`）、一覧にそのノートは出ません。テーブルには書かれています。

ストリームのレコードを関数に 2 回渡しても、2 回目は 3 件とも重複として見分けられ、`food` の件数は 2 のままです。15 件のレコードのうち、件数を動かすのはタグのアイテムの 3 件だけで、残りは無視されます。2 回目の実行も、重複を見分けるためにトランザクションを送るので、書き込みの料金はかかります。

### メモリ上のモデルが再現するもの

テストとこのスクリプトが使う `MemoryTable` は、DynamoDB の代わりではなく、この章が頼っている決まりだけを写したモデルです。

写してあるのは、条件付き書き込み、トランザクション（すべてか無しか、100 アイテムまで、同じアイテムを 2 回指定できない）、ソートキーの範囲と順序、ページ送り、sparse index とプロジェクション、インデックスへの書き込みの回数、変更 1 件につき 1 レコードのストリームです。

<<< @/examples/30-data-modeling/src/memory-table.ts{transact}

実物に無くて、モデルにだけあるものが 2 つあります。インデックスの反映を止める `pauseIndex` と、次のトランザクションを衝突として失敗させる `conflictOnce` です。実物ではいつ起きるか選べない場面を、テストの中で決まった順序で起こすために足しました。

写していないものは、容量とスロットリング、1 MB のページの上限、パーティション、遅延、IAM、アイテムの大きさの上限です。文字列の比較も違います。DynamoDB は UTF-8 のバイト列で比べ、モデルは JavaScript の文字列として比べます。この章のキーは ASCII の文字だけなので、順序は一致します。

### DynamoDB Local で動かす

同じコードを、05章の DynamoDB Local にも向けられます。`examples/30-data-modeling/.env.example` を `.env` という名前でコピーします。

<<< @/examples/30-data-modeling/.env.example

```bash
vp run db:local:start
vp run modeling:db:migrate:local
```

`db:local:start` は 05章のタスクで、Docker のデーモンが要ります。Docker は devShell には含まれていません。`modeling:db:migrate:local` は、05章のテーブルと同じ模擬実装の中に、この章のテーブルを別の名前で作ります。

<<< @/examples/30-data-modeling/scripts/local-db.ts{create-table}

`AttributeDefinitions` に書くのは、テーブルとインデックスのキーにする 4 つの属性だけです。ほかの属性は、どこにも宣言しません。この定義と、CDK のスタックの定義は、手でそろえています。

## テスト

<!-- section: 30.tests -->

```bash
vp run test:unit
vp run modeling:test:local
```

| 層 | ファイル | 見ているもの | 見られないもの |
| --- | --- | --- | --- |
| キーと計画 | `test/keys.test.ts`、`test/plan.test.ts`、`test/page-token.test.ts` | 範囲に隣のノートが入らないこと、時刻の並び、区切り文字の拒否、トランザクションの中身と上限、トークンの検証 | DynamoDB の挙動 |
| テーブルの規則 | `test/table-contract.ts` | 条件、トランザクション、範囲の `Query`、ページ送り、インデックス。メモリ上のモデルと DynamoDB Local の両方で実行する | 実際のサービスの分散した挙動 |
| ノートブックの規則 | `test/notebook-contract.ts` | 6 つの読み方と、書き込みの決まり。同じく両方で実行する | 同上 |
| モデルだけで見えるもの | `test/memory-table.test.ts`、`test/notebook.test.ts` | インデックスの遅れ、インデックスへの書き込みの回数、トランザクションの衝突と再試行、途中で止まった削除 | 実物でそれがいつ、どれだけ起きるか |
| リクエストの検査 | `test/dynamodb-table.test.ts` | DynamoDB に送る式、キー、整合性の指定、取り消しの理由の対応 | DynamoDB がそのリクエストどおりに動くこと |
| ストリーム | `test/projector.test.ts`、`test/stream-lambda.test.ts` | 重複して届いたバッチ、自分の書き込み、途中の失敗と再開、レコードの形 | Lambda が実際にどう配送するか |
| 移行 | `test/migration.test.ts` | 隣り合う段階の互換、再実行、再開、アプリの書き込みとの割り込み | 実際のテーブルでの時間と料金 |
| インフラ | `infra/test/modeling-stack.test.ts` | キーとプロジェクション、上限、権限、フィルター、再試行の回数、削除の方針 | AWS がそのテンプレートどおりに動くこと |

テーブルの規則とノートブックの規則は、1 回だけ書いて、メモリ上のモデルと DynamoDB Local の両方に対して実行します。モデルが DynamoDB と違う動きをしていれば、DynamoDB Local のほうで落ちます。モデルを信用してよい範囲は、この 2 つのテストが通る範囲までです。

`modeling:test:local` は、`DYNAMODB_ENDPOINT` が無いと失敗します。テストファイル自体は、接続先が無いときに自分をスキップするので、`vp run test:unit` の出力には `1 skipped` と出ます。

DynamoDB Local（3.3.1）に対しては、テーブルの規則 16 件とノートブックの規則 19 件が通りました。このときは Docker を使わず、AWS が配布する jar を Java で直接起動しています。DynamoDB Local で確かめられたのは、式が受け付けられることと、条件、トランザクション、範囲、インデックスが、1 台の上でモデルと同じ結果を返すことです。

DynamoDB Local では確かめられないことがあります。公式ドキュメントによると、DynamoDB Local はトランザクションの衝突（`TransactionConflict`）を報告しません。衝突して再試行する経路は、モデルの `conflictOnce` でしか通していません。インデックスがどれだけ遅れるかも、模擬実装からは分かりません。ストリームを読む関数と移行は、DynamoDB Local では実行していません。

したがって、この章の中心である 3 つのこと、つまりトランザクションが同時の書き込みを正しくさばくこと、インデックスがあとから追いつくこと、ストリームの関数が重複を見分けることは、実際の DynamoDB と Lambda の上では一度も確かめていません。確かめたのは、正しいリクエストを送っていることと、公式ドキュメントの決まりを写したモデルの上で、コードが意図どおりに動くことです。
