---
title: "05 KV Store: しくみと実装"
---

# 05 KV Store: しくみと実装

## 保存先を差し替える

<!-- section: 05.repository -->

04章で `NoteRepository` を interface にしておいたおかげで、アプリの大半は保存先を知りません。この章では、その interface を「起こり得る結果」まで表すように直します。

<<< @/examples/05-dynamodb/src/repository.ts{interface}

「誰かが先に保存していた」は例外的な事故ではなく、ふつうに起きる結果です。だから例外を投げずに、戻り値の型にしました。呼ぶ側が `conflict` の場合を書き忘れると、型検査が通りません。

実装は 2 つあります。

`InMemoryNoteRepository` は、手元の開発とテストで使います。Docker も AWS も要りません。そのかわり DynamoDB のことは一切再現しませんし、プロセスを再起動すると消えます。

`DynamoDbNoteRepository` は、デプロイ後に使う本物です。手元では DynamoDB Local にも向けられます。

2 つが同じ規則に従っていることは、1 組の contract test を両方に対して実行して確かめます。これはテストの節で。

DynamoDB への接続を組み立てているのは、ここです。

<<< @/examples/05-dynamodb/src/compose.ts{repository}

Cloudflare Workers なら、D1 や KV は binding として `env` に現れますよね。AWS では、3 つの別々のものを自分でつなぎます。table の名前（設定）、SDK の client（コード）、table を使う権限（AWS 上では実行 role、手元ではあなた自身の認証情報）です。

## 上書きを防ぐ: 条件付き書き込み

<!-- section: 05.conditional -->

2 つのタブで同じノートを開いて、両方で編集して保存する。さて、何が起きるでしょう。

```figure
caption: 2 つのタブが同じ version から保存すると、先の保存だけが通り、後の保存は 409 になる
type: sequence
actor a: tab A
actor store: 保存されているノート
actor b: tab B
note store: v1 "draft"
step a -> store: t1 GET
step store --> a: version 1
step b -> store: t1 GET
step store --> b: version 1
step a -> store: t2 PUT expectedVersion=1
step store --> a: 200
note store: v2 "from A"
step b -> store: t3 PUT expectedVersion=1
step store --x b: 409
note store: v2 "from A"
note b: t4 A の文面を自分のと並べて表示
```

t3 で B の保存を通してしまうと、A の変更は誰にも知られないまま消えます。これを防ぐのが楽観ロック（optimistic locking）です。先に鍵をかけるのではなく、書き込む瞬間に「自分が見ていた版のままか」を確かめます。

ここで、「読んで version を比べて、同じなら書く」をアプリのコードで 2 回に分けてやると、その間に別の書き込みが割り込めてしまいます。比較と書き込みを、データベースの中で 1 つの操作としてやってもらう必要があるんです。DynamoDB では、条件式（condition expression）がそれにあたります。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{update}

`ConditionExpression: "version = :expected"` の 1 行が、楽観ロックのすべてです。DynamoDB は条件の評価と更新を 1 つの操作として行うので、同じ version を持った 2 つの書き込みが両方通ることはありません。条件が成り立たなければ、DynamoDB は `ConditionalCheckFailedException` を返します。

そのあとの読み取りは、別の操作です。条件が外れた理由（ノートが無いのか、version が進んだのか）を知って、いまの内容を呼び出し側に渡すために読んでいます。この読み取りと元の更新の間に、ノートがもう一度変わることはあり得ます。なので `current` は「409 を返した時点に近い内容」であって、「いまも正しい内容」とは限りません。

作成にも同じ仕組みを使います。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{create}

`PutItem` は、同じ key の item があると黙って置き換えます。`attribute_not_exists(pk)` を付けておくと、key がすでに使われているときに失敗してくれます。

アプリは、`conflict` を HTTP の 409 にして返します。

<<< @/examples/05-dynamodb/src/app.ts{update}

守っている invariant を 1 文で書くと、こうです。

**保存に成功するたびに version はちょうど 1 増え、古い version に基づく更新は拒否される。**

## 読み取りの整合性を選ぶ

<!-- section: 05.consistency -->

DynamoDB の読み取りには 2 種類あります。

| | 結果整合（eventually consistent） | 強整合（strongly consistent） |
| --- | --- | --- |
| 直前の書き込みが見えるか | 見えないことがある。少し待って読み直せば見える | 成功した書き込みはすべて反映されている |
| 料金 | 強整合の半分 | 4 KB までの item 1 件で 1 read request unit |
| 既定 | こちら | `ConsistentRead: true` を指定する |

公式ドキュメントによると、書き込みが成功の応答を返した時点で、その書き込みは永続化されています。結果整合の読み取りで見えないことがあるのは、消えたからではなく、読みに行った先にまだ届いていないからです。

この章では、操作ごとに選びます。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{get}

1 件の取得は強整合にしました。保存した直後に同じノートを読み直して、保存前の内容が返ってきたら、「あれ、保存に失敗した？」と思いますよね。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{list}

一覧は結果整合のままです。料金が半分で、一覧が一瞬古くても困らないので。そのかわり、作成した直後のノートが、次の一覧に出ないことがあり得ます。画面を作るとき（06章）は、作成の応答で受け取ったノートを一覧に足して表示すれば、この隙間を利用者に見せずに済みます。

この選び方が成り立つのは、条件付き書き込みが読み取りの整合性に頼っていないからです。古い一覧を見て更新を送っても、`version` の条件は DynamoDB の中で最新の値に対して評価されます。古い読み取りは 409 を増やすことはあっても、上書きを起こすことはありません。

ちなみに、強整合の読み取りが使えるのは table 本体と local secondary index だけで、global secondary index では使えません。この章は index を使いません。

## 取りこぼさずにページを送る

<!-- section: 05.pagination -->

`Query` が 1 回で返す結果は、最大 1 MB です。それを超えたぶんは返ってきません。しかも、エラーにもなりません。この API はそれに加えて、`Limit` で 1 ページの件数も絞っています。どちらの理由で途中で止まっても、DynamoDB が出す合図は同じです。「全部取れた」と思い込んで一覧を返していると、ノートが増えたある日から、古いノートが黙って表示されなくなります。こわいですね。

DynamoDB は、続きがあるかもしれないとき、応答に `LastEvaluatedKey` を付けます。これを次の `Query` の `ExclusiveStartKey` に渡すと、続きから読めます。この API は、それを cursor として呼び出し側に渡します。

<<< @/examples/05-dynamodb/src/contract.ts{list}

<<< @/examples/05-dynamodb/src/app.ts{list}

cursor は呼び出し側に渡って、また戻ってきます。戻ってきた時点では、ほかの入力と同じく信用できない値です。そのまま DynamoDB に渡さず、復号して形を確かめます。

<<< @/examples/05-dynamodb/src/repository.ts{cursor}

公式ドキュメントも注意しているのですが、`LastEvaluatedKey` があることは「まだ item がある」ことを意味しません。ちょうどページの境目で終わった場合にも付きます。そのとき次のページは空で、cursor は `null` になります。なので呼び出し側は、「`nextCursor` が `null` になるまで」を終わりの条件にします。件数が `limit` より少ないことを、終わりの合図にしてはいけません。

## 応答が届かなかったら

<!-- section: 05.lost-response -->

ネットワーク越しの書き込みには、成功と失敗のほかに、3 つ目の結果があります。「分からない」です。

```figure
caption: 応答が失われた保存を再試行すると、自分の 1 回目の書き込みが原因で 409 が返る
type: sequence
actor client: client
actor server: server
step client -> server: t1 PUT expectedVersion=1
step server -> server: 更新を適用する
note server: v2 "final"
step server --x client: t2 200 OK（応答が失われる。timeout）
step client -> client: t3 保存された？ 分からない。再試行
step client -> server: t3 PUT expectedVersion=1
step server -> server: version は 1 ではなく 2
note server: v2 "final"
step server --> client: t4 409 conflict, current = v2 "final"
```

t2 の時点で、呼び出し側は保存が済んだかどうかを知りません。再試行しなければ、保存されていなかった場合に変更を失います。そこで再試行すると、t4 で 409 が返ってきます。原因は他人の書き込みではなく、**自分の 1 回目の書き込み**です。

ここで楽観ロックが 2 つの役に立っています。1 つは、再試行が二重に適用されなかったこと。version は 2 のままで、3 にはなっていません。もう 1 つは、409 に `current` が付いているので、呼び出し側が判断できることです。

<<< @/examples/05-dynamodb/src/client.ts{outcome}

保存されているノートが、ちょうど 1 つ先の version で、送ったとおりの内容なら、望んだ書き込みは済んでいます。型付きの client は、この場合を成功として返します。

<<< @/examples/05-dynamodb/src/client.ts{update}

この判断には限界があります。別の誰かが、まったく同じ内容を同じ version で保存していた場合と区別できません。ただ、その場合も保存されている内容は望んだとおりなので、成功として扱って困ることはありません。逆に、自分の書き込みが済んだあと、再試行までに別の誰かがさらに保存していた場合は、conflict として返ります。自分の保存は 1 回済んでいますが、いま保存されているのは他人の内容なので、それを見せるのが安全な側の結果です。

ところで、作成にはこの守りがありません。`POST /notes` は、再試行と新しいノートの作成を見分ける手がかりを持っていないので、応答を失って再試行すると、同じ内容のノートが 2 件できます。テストは、この挙動を仕様として記録しています。直すには、呼び出し側が「同じ依頼である」ことを示す値を送る必要があります。この本では、そこまでは直していません（考え方は、[08章](/ja/chapters/08-async.md)で worker を冪等にするときと同じです）。
