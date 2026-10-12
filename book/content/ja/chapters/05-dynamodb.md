---
title: "05 KV Store: DynamoDB"
revision: 4
---

# 05 KV Store: DynamoDB

04章の API は、ノートをメモリに置いていました。箱が変われば答えが変わるし、しばらくすると消えます。この章で、ちゃんと保存しましょう。

保存先は DynamoDB の table です。どの実行環境から読んでも同じ答えが返るようになります。ついでに、保存するなら避けて通れない話も片付けます。2 人が同じノートを同時に編集しても、あとから保存したほうが黙って上書きしないこと。応答が届かずに再試行した保存が、二重に適用されないこと。件数が増えても、一覧が取りこぼしなくページ送りできること。そして関数に渡す権限は、この table への 5 つの操作だけにします。

前提は [04章](/ja/chapters/04-http-api.md)です。コードは `examples/05-dynamodb/` にあります。04章の API を引き継いで広げたもので、これだけで独立して動きます。

この章でも、まだ認証はありません。URL を知っていれば誰でも読み書きできます。消すこともできます（認証は [06章](/ja/chapters/06-auth.md)）。量には蓋をしてあって、受けるリクエストは 1 秒に 10 件まで、ノートは 100 件まで、一覧の 1 ページは要約 20 件までです。他人に見られて困るデータ、消されて困るデータは入れないでくださいね。

SQL で書きたいデータなら、この章を飛ばして [13章](/ja/chapters/13-sql.md)へ進んでもかまいません。判断の目安は、後半の「DynamoDB が合わないとき」に書きました。

## 全体像

<!-- section: 05.architecture -->

```figure
caption: リクエストは API Gateway と Lambda を通り、ノートは DynamoDB の table に保存される
node client: Client
node api: API Gateway HTTP API
node fn: Lambda function (AWS SDK for JavaScript v3) | 実行環境はいくつでも。ノートは持たない
node table: DynamoDB table (ap-northeast-1, on-demand) | pk = OWNER#<owner>, sk = NOTE#<note id>, version, title, body, ...
edge client -> api: HTTPS
edge api -> fn: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> table: execution role: GetItem, PutItem, UpdateItem, DeleteItem, Query
mark table
```

04章と違うのは、いちばん下です。状態の持ち主が、ひとつひとつの実行環境から table に変わりました。実行環境がいくつあっても、いつ消えても、もう困りません。

### なぜ DynamoDB？

DynamoDB は、key を指定して item を読み書きするデータベースです。この章で選ぶ理由は 3 つあります。

- 接続を管理しなくていい。HTTPS の API を呼ぶだけです。Lambda の実行環境が増えても、接続数の上限やプールを気にしなくて済みます
- ネットワークの設計が要らない。VPC の中に置く必要がないので、04章の構成に table を 1 つ足すだけです
- 使っていない間の料金が、保存量のぶんだけ。on-demand の table は、リクエストがなければリクエスト料金が 0 です

そのかわり、**どう読むかを先に決める**必要があります。SQL みたいに、あとから思いついた条件で自由に絞り込む、はできません。これが合わない場合の話は後半でします。

## 読み方から key を決める

<!-- section: 05.model -->

DynamoDB の table 設計は、「どんなデータがあるか」ではなく「どう読み書きするか」から始めます。この API の読み書きは 2 種類です。

1. ある持ち主のノートを、新しい順に一覧する
2. 持ち主とノートの ID を指定して、1 件を読む、更新する、消す

DynamoDB の item は、partition key と sort key の組で一意に決まります。partition key が同じ item はひとまとまりに保存されて、その中で sort key の順に並びます。この性質に、上の 2 つを当てはめていきます。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{keys}

partition key を持ち主にすると、「ある持ち主のノートすべて」が 1 回の Query で読めます。sort key をノートの ID にすると、「1 件」が key の完全一致で読めます。

残るは「新しい順」ですね。sort key の順がそのまま作成順になるように、ID の先頭に作成時刻を入れます。

<<< @/examples/05-dynamodb/src/id.ts{id}

こうしておくと、一覧は「sort key の逆順に読む」だけ。並べ替え用の index が要りません。同じミリ秒に作られたノート同士の順序は、乱数の部分で決まります。

まだ認証がないので、持ち主は全員共通の固定値です。06章でサインインした利用者に置き換えますが、key の形は変わりません。

<<< @/examples/05-dynamodb/src/notes.ts{service}

## 契約に version を足す

<!-- section: 05.contract -->

<<< @/examples/05-dynamodb/src/contract.ts{note}

ノートに `version` が増えました。作ったときは 1 で、保存に成功するたびに 1 だけ増えます。更新するときは、呼ぶ側が「自分が見ていた version」を `expectedVersion` として送ります。

`expectedVersion` は必須にしました。省略を許すと、「何を見て書いたのか」を言わない更新が通ってしまって、上書きを防げないんです。

エラーの種類には `conflict` が増えて、いま保存されているノートを `current` として返します。

<<< @/examples/05-dynamodb/src/contract.ts{error}
