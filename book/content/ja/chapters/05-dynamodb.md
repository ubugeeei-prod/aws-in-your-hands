---
title: "05 KV Store: DynamoDB"
revision: 5
---

# 05 KV Store: DynamoDB

04章の API はノートをメモリに置いていたので、リクエストを受ける実行環境が変わると答えが変わり、しばらくするとノートが消えました。この章では、ノートを DynamoDB のテーブルに保存して、どの実行環境から読んでも同じ答えが返るようにします。

データを保存するようになると、避けられない問題がいくつか出てきます。2 人が同じノートを同時に編集したときに、あとから保存したほうが先の保存を黙って上書きしないようにします。レスポンスが届かずに再試行した保存が、二重に適用されないようにします。件数が増えても、一覧が取りこぼさずにページを送れるようにします。関数に渡す権限は、このテーブルへの 5 つの操作だけにします。

前提は [04章](/ja/chapters/04-http-api.md)です。コードは `examples/05-dynamodb/` にあります。04章の API を引き継いで広げたもので、このディレクトリだけで独立して動きます。

この章にも、まだ認証はありません。URL を知っていれば誰でもノートを読み書きでき、消すこともできます（認証は [06章](/ja/chapters/06-auth.md)で足します）。量は絞ってあり、受けるリクエストは 1 秒に 10 件まで、ノートは 100 件まで、一覧の 1 ページは要約 20 件までです。他人に見られて困るデータや、消されて困るデータは入れないでください。

SQL で扱いたいデータなら、この章を飛ばして [13章](/ja/chapters/13-sql.md)へ進んでもかまいません。判断の目安は、[費用、注意点、片付け](/ja/chapters/05-dynamodb/wrap.md)のページの「DynamoDB が合わないとき」に書きました。

## 全体像

<!-- section: 05.architecture -->

```figure
caption: リクエストは API Gateway と Lambda を通り、ノートは DynamoDB のテーブルに保存されます。
node client: Client
node api: API Gateway HTTP API
node fn: Lambda 関数 (AWS SDK for JavaScript v3) | 実行環境はいくつでも。ノートは持たない
node table: DynamoDB テーブル (ap-northeast-1, on-demand) | pk = OWNER#<owner>, sk = NOTE#<note id>, version, title, body, ...
edge client -> api: HTTPS
edge api -> fn: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> table: 実行ロール: GetItem, PutItem, UpdateItem, DeleteItem, Query
mark table
```

04章の構成と違うのは、図で強調してある DynamoDB のテーブルです。ノートの持ち主が、ひとつひとつの実行環境からテーブルに変わりました。実行環境がいくつあっても、いつ破棄されても、ノートは失われません。

### DynamoDB を選ぶ理由

DynamoDB は、キーを指定してアイテム（item）を読み書きするデータベースです。この章で選ぶ理由は 3 つあります。

- 接続を管理しなくて済みます。HTTPS の API を呼ぶだけなので、Lambda の実行環境が増えても、接続数の上限や接続プールを気にする必要がありません
- ネットワークを設計しなくて済みます。VPC の中に置く必要がないので、04章の構成にテーブルを 1 つ足すだけです
- 使っていない間にかかる料金は、保存量のぶんだけです。オンデマンド（on-demand）のテーブルは、リクエストがなければリクエスト料金が 0 です

そのかわり、**どう読むかを先に決める**必要があります。SQL のように、あとから思いついた条件で自由に絞り込むことはできません。この制約が合わない場合については、[費用、注意点、片付け](/ja/chapters/05-dynamodb/wrap.md)のページで扱います。

## 読み方からキーを決める

<!-- section: 05.model -->

DynamoDB のテーブルは、どんなデータがあるかではなく、どう読み書きするかから設計します。この API の読み書きは 2 種類です。

1. ある持ち主のノートを、新しい順に一覧する
2. 持ち主とノートの ID を指定して、1 件を読む、更新する、消す

DynamoDB のアイテムは、パーティションキー（partition key）とソートキー（sort key）の組で一意に決まります。パーティションキーが同じアイテムはひとまとまりに保存され、その中でソートキーの順に並びます。この性質に、上の 2 種類の読み書きを当てはめます。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{keys}

パーティションキーを持ち主にすると、ある持ち主のノートすべてを 1 回の `Query` で読めます。ソートキーをノートの ID にすると、1 件のノートをキーの完全一致で読めます。

残る要件は「新しい順」です。ソートキーの順がそのまま作成順になるように、ID の先頭に作成時刻を入れます。

<<< @/examples/05-dynamodb/src/id.ts{id}

ID をこの形にしておくと、一覧はソートキーの逆順に読むだけで済み、並べ替えのためのインデックスが要りません。同じミリ秒に作られたノート同士の順序は、ID の乱数の部分で決まります。

まだ認証がないので、持ち主は全員に共通の固定値です。06章でサインインした利用者に置き換えますが、キーの形は変わりません。

<<< @/examples/05-dynamodb/src/notes.ts{service}

## 契約に version を足す

<!-- section: 05.contract -->

<<< @/examples/05-dynamodb/src/contract.ts{note}

ノートに `version` が増えました。作ったときは 1 で、保存に成功するたびに 1 だけ増えます。更新するときは、呼ぶ側が自分の見ていた `version` を `expectedVersion` として送ります。

`expectedVersion` は必須にしました。省略を許すと、どの版を見て書いたのかを言わない更新が通ってしまい、上書きを防げなくなるからです。

エラーの種類には `conflict` が増えました。このエラーは、いま保存されているノートを `current` として返します。

<<< @/examples/05-dynamodb/src/contract.ts{error}
