---
title: "05 ノートを保存する: DynamoDB"
revision: 1
---

# 05 ノートを保存する: DynamoDB

## この章の成果

- ノートが DynamoDB の table に保存され、どの実行環境から読んでも同じ答えが返る
- 2 人が同じノートを同時に編集しても、後から保存したほうが黙って上書きすることがない
- 応答が届かずに再試行した保存が、二重に適用されない
- 一覧が、件数が増えても取りこぼしなくページ送りできる
- 関数に与えた権限が、この table への 5 つの操作だけである

前提は [04章](/ja/chapters/04-http-api.md)です。サンプルは `examples/05-dynamodb/` にあり、04章の API を引き継いで拡張した、独立して動く一式です。

この章でも認証はありません。URL を知っていれば誰でも読み書きできます。06章（planned）で足します。**他人に見られて困るデータを入れないでください。**

SQL で書きたいデータなら、この章を飛ばして 13章（planned）へ進めます。判断の目安は、章の後半の「DynamoDB が合わないとき」に書きました。

## 構成

<!-- section: 05.architecture -->

```text
Client
  |  HTTPS
  v
API Gateway HTTP API
  |  routes: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
  v
Lambda function (any number of execution environments; they hold no notes)
  |  execution role: GetItem, PutItem, UpdateItem, DeleteItem, Query on one table
  |  AWS SDK for JavaScript v3
  v
DynamoDB table (ap-northeast-1, on-demand)
  pk = OWNER#<owner>    sk = NOTE#<note id>    version, title, body, ...
```

04章との違いは最下段です。状態の持ち主が、個々の実行環境から table に変わりました。実行環境はいくつあっても、いつ消えても構いません。

### なぜ DynamoDB か

DynamoDB は、key を指定して item を読み書きするデータベースです。この章で選ぶ理由は 3 つあります。

- **接続を管理しなくてよい。** HTTPS の API を呼ぶだけです。Lambda の実行環境が増えても、接続数の上限やプールを気にする必要がありません。
- **ネットワークの設計が要らない。** VPC の中に置く必要がなく、04章の構成に table を 1 つ足すだけで済みます。
- **使っていない間の料金が、保存量の分だけである。** on-demand の table は、リクエストがなければリクエスト料金が 0 です。

その代わり、**どう読むかを先に決める**必要があります。SQL のように、あとから思いついた条件で自由に絞り込むことはできません。これが合わない場合の話は後半でします。

## 読み方から key を決める

<!-- section: 05.model -->

DynamoDB の table 設計は、「どんなデータがあるか」ではなく「どう読み書きするか」から始めます。この API の読み書きは 2 種類です。

1. ある持ち主のノートを、新しい順に一覧する
2. 持ち主とノートの ID を指定して、1 件を読む、更新する、消す

DynamoDB の item は、partition key と sort key の組で一意に決まります。partition key が同じ item はひとまとまりに保存され、その中で sort key の順に並びます。この性質に、上の 2 つを当てはめます。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{keys}

- partition key を持ち主にすると、「ある持ち主のノートすべて」が 1 回の Query で読めます
- sort key をノートの ID にすると、「1 件」が key の完全一致で読めます

残るのは「新しい順」です。sort key の順がそのまま作成順になるように、ID の先頭に作成時刻を入れます。

<<< @/examples/05-dynamodb/src/id.ts{id}

こうすると、一覧は「sort key の逆順に読む」だけになり、並べ替え用の index が要りません。同じミリ秒に作られたノート同士の順序は、乱数の部分で決まります。

まだ認証がないので、持ち主は全員共通の固定値です。06章でサインインした利用者に置き換えますが、key の形は変わりません。

<<< @/examples/05-dynamodb/src/notes.ts{service}

## 契約に version を足す

<!-- section: 05.contract -->

<<< @/examples/05-dynamodb/src/contract.ts{note}

ノートに `version` が加わりました。作成時に 1 で、保存に成功するたびに 1 だけ増えます。更新するときは、呼び出す側が「自分が見ていた version」を `expectedVersion` として送ります。

`expectedVersion` は必須です。省略を許すと、「何を見て書いたのか」を言わない更新が通ることになり、上書きを防げません。

エラーの種類に `conflict` が加わり、いま保存されているノートを `current` として返します。

<<< @/examples/05-dynamodb/src/contract.ts{error}

## 保存先を差し替える

<!-- section: 05.repository -->

04章で `NoteRepository` を interface にしておいたので、アプリの大半は保存先を知りません。この章では、その interface を「起こり得る結果」まで表すように直します。

<<< @/examples/05-dynamodb/src/repository.ts{interface}

「誰かが先に保存していた」は例外ではなく、ふつうに起きる結果です。そこで例外を投げず、戻り値の型にします。呼び出す側が `conflict` の場合を書き忘れると、型検査が通りません。

実装は 2 つあります。

| 実装 | 使う場面 | 再現しないもの |
| --- | --- | --- |
| `InMemoryNoteRepository` | 手元の開発とテスト。Docker も AWS も要らない | DynamoDB の一切。プロセスを再起動すると消える |
| `DynamoDbNoteRepository` | デプロイ後。手元では DynamoDB Local にも向けられる | （本物） |

2 つが同じ規則に従うことは、1 組の contract test を両方に対して実行して確かめます。これは後の節で説明します。

DynamoDB への接続は、次の箇所で組み立てます。

<<< @/examples/05-dynamodb/src/compose.ts{repository}

Cloudflare Workers なら、D1 や KV は binding として `env` に現れます。AWS では、3 つの別々のものを自分でつなぎます。table の名前（設定）、SDK の client（コード）、table を使う権限（AWS 上では実行 role、手元ではあなた自身の認証情報）です。

## 条件付き書き込みで上書きを防ぐ

<!-- section: 05.conditional -->

2 つのタブで同じノートを開き、両方で編集して保存する場面を考えます。

```text
time  tab A                          tab B                          stored
t1    GET  -> version 1              GET  -> version 1              v1 "draft"
t2    PUT expectedVersion=1 -> 200                                  v2 "from A"
t3                                   PUT expectedVersion=1 -> 409   v2 "from A"
t4                                   shows A's text next to its own
```

t3 で B の保存を通してしまうと、A の変更は誰にも知られずに消えます。これを防ぐのが楽観ロック（optimistic locking）です。先に鍵をかけるのではなく、書き込む瞬間に「自分が見ていた版のままか」を確かめます。

「読んで version を比べ、同じなら書く」をアプリのコードで 2 回に分けて行うと、その間に別の書き込みが入り込めます。比較と書き込みを、データベースの中で 1 つの操作として行う必要があります。DynamoDB では、条件式（condition expression）がそれです。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{update}

`ConditionExpression: "version = :expected"` の 1 行が、楽観ロックのすべてです。DynamoDB は条件の評価と更新を 1 つの操作として行うので、同じ version を持った 2 つの書き込みが両方通ることはありません。条件が成り立たないと、DynamoDB は `ConditionalCheckFailedException` を返します。

そのあとの読み取りは、別の操作です。条件が外れた理由（ノートが無いのか、version が進んだのか）を知り、いまの内容を呼び出し側に渡すために読みます。この読み取りと元の更新の間に、ノートがもう一度変わることはあり得ます。`current` は「409 を返した時点に近い内容」であって、「いまも正しい内容」とは限りません。

作成にも同じ仕組みを使います。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{create}

`PutItem` は、同じ key の item があれば黙って置き換えます。`attribute_not_exists(pk)` を付けると、key がすでに使われている場合に失敗するようになります。

アプリは、`conflict` を HTTP の 409 にして返します。

<<< @/examples/05-dynamodb/src/app.ts{update}

守っている invariant は次の 1 文です。

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

1 件の取得は強整合にします。保存した直後に同じノートを読み直して、保存前の内容が返ってきたら、利用者は保存に失敗したと思うからです。

<<< @/examples/05-dynamodb/src/dynamodb-repository.ts{list}

一覧は結果整合のままにします。料金が半分で、一覧が一瞬古くても困らないからです。その結果、**作成した直後のノートが、次の一覧に出ないことがあり得ます**。画面を作るとき（06章）は、作成の応答で受け取ったノートを一覧に足して表示すれば、この隙間を利用者に見せずに済みます。

この選択が成り立つのは、条件付き書き込みが読み取りの整合性に依存していないからです。古い一覧を見て更新を送っても、`version` の条件は DynamoDB の中で最新の値に対して評価されます。古い読み取りは、409 を増やすことはあっても、上書きを起こすことはありません。

なお、強整合の読み取りが使えるのは table 本体と local secondary index だけで、global secondary index では使えません。この章は index を使いません。

## 取りこぼさずにページを送る

<!-- section: 05.pagination -->

`Query` が 1 回で返す結果は最大 1 MB です。それを超える分は返ってきません。エラーにもなりません。この API はそれに加えて、`Limit` で 1 ページの件数も絞っています。どちらの理由で途中で止まっても、DynamoDB が出す合図は同じです。「全部取れた」と思い込んで一覧を返すと、ノートが増えたある日から、古いノートが黙って表示されなくなります。

DynamoDB は、続きがあるかもしれないとき、応答に `LastEvaluatedKey` を付けます。これを次の `Query` の `ExclusiveStartKey` に渡すと、続きから読めます。この API は、それを cursor として呼び出し側に渡します。

<<< @/examples/05-dynamodb/src/contract.ts{list}

<<< @/examples/05-dynamodb/src/app.ts{list}

cursor は呼び出し側に渡って戻ってくるので、戻ってきた時点では、ほかの入力と同じく信用できない値です。そのまま DynamoDB に渡さず、復号して形を確かめます。

<<< @/examples/05-dynamodb/src/repository.ts{cursor}

公式ドキュメントが注意しているとおり、`LastEvaluatedKey` があることは「まだ item がある」ことを意味しません。ちょうどページの境目で終わった場合にも付きます。そのとき次のページは空で、cursor は `null` になります。呼び出し側は、「`nextCursor` が `null` になるまで」を終わりの条件にします。件数が `limit` より少ないことを終わりの合図にしてはいけません。

## 届かなかった応答と再試行

<!-- section: 05.lost-response -->

ネットワーク越しの書き込みには、成功と失敗のほかに、3 つ目の結果があります。「分からない」です。

```text
time  client                               server                 stored
t1    PUT expectedVersion=1  ----------->  applies the update     v2 "final"
t2    (response is lost; timeout)  <--x--  200 OK
t3    was it saved? unknown. retry:
      PUT expectedVersion=1  ----------->  version is 2, not 1    v2 "final"
t4    409 conflict, current = v2 "final"
```

t2 の時点で、呼び出し側は保存が済んだかどうかを知りません。再試行しないと、保存されていない場合に変更を失います。そこで再試行すると、t4 で 409 が返ります。原因は他人の書き込みではなく、**自分の 1 回目の書き込み**です。

ここで楽観ロックが 2 つの役に立っています。1 つは、再試行が二重に適用されなかったことです。version は 2 のままで、3 にはなっていません。もう 1 つは、409 に `current` が付いているので、呼び出し側が判断できることです。

<<< @/examples/05-dynamodb/src/client.ts{outcome}

保存されているノートが、ちょうど 1 つ先の version で、送ったとおりの内容なら、望んだ書き込みは済んでいます。型付きの client は、この場合を成功として返します。

<<< @/examples/05-dynamodb/src/client.ts{update}

この判断には限界があります。別の誰かが、まったく同じ内容を同じ version で保存していた場合と区別できません。ただ、その場合も保存されている内容は望んだとおりなので、成功として扱って困ることはありません。逆に、自分の書き込みが済んだあと、再試行までに別の誰かがさらに保存していた場合は、conflict として返ります。自分の保存は 1 回済んでいますが、いま保存されているのは他人の内容なので、それを見せるのが安全な側の結果です。

**作成には、この守りがありません。** `POST /notes` は、再試行と新しいノートの作成を区別する手がかりを持たないので、応答を失って再試行すると、同じ内容のノートが 2 件できます。テストは、この挙動を仕様として記録しています。直すには、呼び出し側が「同じ依頼である」ことを示す値を送る必要があります（08章の冪等性の予定）。

## 手元で動かす

<!-- section: 05.local -->

`examples/05-dynamodb/.env.example` を、同じディレクトリに `.env` としてコピーします。

<<< @/examples/05-dynamodb/.env.example

環境変数の検証は、保存先によって必要な変数が変わることを schema で表しています。

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

`<id>` は、1 つ目の応答の `id` に置き換えます。2 つ目は version 2 のノートを返し、3 つ目は 409 と、保存されているノートを返します。

メモリの実装は、API の形と規則を確かめるのには十分です。DynamoDB そのものについては何も教えてくれません。

### DynamoDB Local で動かす

DynamoDB Local は、AWS が配布している DynamoDB の模擬実装です。コンテナとして動かします。**Docker の daemon が動いていることが前提**で、devShell には含まれません。

```bash
vp run db:local:start
vp run db:migrate:local
vp run db:seed:local
```

`db:migrate:local` が table を作り、`db:seed:local` が `test/fixtures/seed-notes.json` のノートを入れます。`.env` の `NOTES_STORE` を `dynamodb` に変えて `vp run dev:notes` を起動すると、API がこの table を使います。やり直すときは `vp run db:reset:local`、コンテナを止めて消すときは `vp run db:local:stop` です。

これらのタスクは、接続先が `localhost` でない限り実行を拒否します。誤って実際の AWS の table を消すことはありません。

D1 のローカル開発と比べると、違いが 2 つあります。D1 は `wrangler dev` を起動するだけでローカルのデータベースが用意されますが、こちらは模擬実装を自分で起動します。また、D1 の migration は SQL ファイルを順に適用しますが、DynamoDB には列の定義がなく、table に対して決めるのは key だけです。手元の table は `scripts/local-db.ts` が、AWS 上の table は CDK が作ります。この 2 つの定義は、手で揃えています。

DynamoDB Local は模擬実装です。式が受け付けられ、1 台の上で意図どおりに動くことは確かめられます。IAM、流量の制限、実際のサービスの複製や遅延は再現しません。

この節の DynamoDB Local のタスクは、執筆時に Docker の daemon が使えなかったため、実行していません。**未検証**です。

## テストする

<!-- section: 05.tests -->

```bash
vp run test:unit
vp run test:local:dynamodb
```

| 層 | ファイル | 確かめること | 確かめられないこと |
| --- | --- | --- | --- |
| contract（メモリ） | `test/repository-contract.ts`、`test/memory-repository.test.ts` | repository の規則。上書きの禁止、version、ページ送り、持ち主の分離 | DynamoDB の挙動 |
| リクエストの検査 | `test/dynamodb-repository.test.ts` | DynamoDB に送る条件式、key の形、整合性の指定。失敗した条件の扱い | DynamoDB がその依頼どおりに動くこと |
| contract（DynamoDB Local） | `test/dynamodb-local.test.ts` | 同じ規則が、模擬実装の上で成り立つこと | IAM、流量の制限、実サービスの分散した挙動 |
| アプリと client | `test/app.test.ts` | 409、ページ送り、偽の cursor の拒否、応答を失った後の再試行 | Lambda と API Gateway を通ったときの挙動 |
| インフラ | `infra/test/notes-stack.test.ts` | 権限が 5 つの操作と 1 つの table に限られること、table の削除方針 | AWS がその template どおりに動くこと |

contract test は、規則を 1 回だけ書き、実装ごとに実行します。

DynamoDB の実装は、SDK の client の代用品を渡して、送られるリクエストを調べます。保証を担っている部分（`ConditionExpression`、`ConsistentRead`、key の形）を誰かが消すと、このテストが落ちます。ただし、これは「正しい依頼を送っている」ことの確認です。DynamoDB がその依頼をどう扱うかは、DynamoDB Local か実際の AWS で確かめます。

`test:local:dynamodb` は、`DYNAMODB_ENDPOINT` が無いと失敗します。テストファイル自体は、接続先が無いとき自分を skip します。skip されたテストは一見成功に見えるので、専用のタスクでは失敗にしています。`vp run test:unit` の出力に `1 skipped` と出るのは、このテストです。

同時の書き込みについては、contract test に「同じ version を持つ 2 つの書き込みのうち、通るのはちょうど 1 つ」という検査があります。メモリの実装では、これは常に成り立ちます。1 つのプロセスの中で順に実行されるからです。本当に確かめたいのは DynamoDB の上でですが、それはこの章では実行していません。

## インフラを定義する

<!-- section: 05.infra -->

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{table}

`billingMode` は on-demand です。読み書きの回数に対して料金がかかり、容量を前もって決める必要がありません。もう 1 つの選択肢は provisioned で、1 秒あたりの読み書きの容量を決めて、その時間分を払います。流量が安定していて予測できるなら provisioned のほうが安くなることがありますが、使わない時間にも料金がかかります。学習用と、流量の読めない新しいアプリには on-demand が向いています。

`removalPolicy` は `DESTROY` です。stack を消すと、table とその中のノートがすべて消えます。練習用だからです。テストは、この設定を明示的に確かめています。守るべきデータを入れるようになったら、最初に変えるべき場所だからです。

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{role}

`table.grantReadWriteData(role)` と書けば 1 行で済みます。ただしその権限には、table 全体を読む `Scan` や、まとめて読み書きする操作も含まれます。このアプリはどれも使いません。使わない権限は、コードに欠陥があったときに悪用できる範囲を広げるだけなので、5 つの操作を列挙します。テストは、操作がこの 5 つであること、対象がこの table の ARN だけであることを確かめます。

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{function}

`TABLE_NAME` は、デプロイのときに決まる table の名前を、関数に環境変数で渡します。コードに名前を書きません。

`externalModules: []` は、AWS SDK を bundle に含める指定です。何も指定しないと、SDK は bundle から外され、Lambda の runtime に入っている版が使われます。その版はこのリポジトリの lockfile とは無関係です。含めておけば、テストしたのと同じ版が動きます。bundle は大きくなります。

## デプロイして確かめる

<!-- section: 05.deploy -->

```bash
vp run notes:infra:diff
vp run notes:infra:deploy
vp run notes:smoke
```

`notes:smoke` は、型付きの client でノートを 1 件作り、読み戻し、更新し、わざと古い version で更新して拒否されることを確かめ、最後に消します。04章の smoke と違い、読み戻しはどの実行環境が応答しても成功しなければなりません。

table の中身は、コンソールの DynamoDB の画面で「項目を探索」から見られます。

drift の検査は、これまでの章と同じです。

```bash
vp run notes:infra:drift
```

`AWS::DynamoDB::Table` は、固定した版の cdkd が専用の実装で扱う種類です。実際の AWS での結果は確かめていません。

## DynamoDB が合わないとき

<!-- section: 05.fit -->

この章の設計がうまくいったのは、読み方が 2 つしかなかったからです。次のような要求が出てきたら、DynamoDB では苦しくなります。

- **あとから増える、決まっていない検索。** 「本文に特定の語を含むノート」「先月更新されたノートを全員分」のような条件は、key に入っていないので、table を全部読むことになります。
- **複数の種類のデータをまたぐ集計や結合。**
- **複数の item にまたがる制約。** 「この利用者のノートは 100 件まで」のような決まりは、1 件の条件付き書き込みでは守れません。transaction の機能はありますが、1 回に扱える item 数や大きさに上限があります。

1 件の item は 400 KB までという上限もあります。画像のような大きなデータは item に入れず、S3 に置きます（07章の予定）。

こうした要求が中心なら、SQL のデータベースのほうが素直です。13章（planned）で、Aurora DSQL、RDS for PostgreSQL、Aurora Serverless v2 を比べます。D1 に慣れている人には、そちらのほうが近い体験になるはずです。DynamoDB は「SQL が書けない D1」ではなく、別の種類の道具です。

### 複数のリージョンに置く（発展）

DynamoDB には、複数のリージョンに table の複製を置く global tables という機能があります。この本では実装しませんが、選ぶときに確かめることを挙げておきます。

公式ドキュメント（読み取りの整合性のページ）によると、global tables には 2 つの整合性のモードがあります。既定のモードでは、変更は通常 1 秒以内にほかのリージョンへ複製され、リージョン間では結果整合です。もう 1 つのモードでは、書き込みが応答を返す前に別のリージョンへ同期的に複製されます。

この章の楽観ロックがそのまま成り立つかどうかは、モードによって変わるはずです。既定のモードでは変更が非同期に複製されるので、あるリージョンでの条件の評価が、別のリージョンで行われたばかりの書き込みをまだ見ていない可能性があります。これは複製の説明からの推論で、公式ドキュメントで直接は確認していません。いずれにせよ、「global」という名前から、条件付き書き込みがリージョンをまたいで効くと推測してはいけません。使う前に、モード、対応するリージョン、transaction の範囲を、その時点の公式ドキュメントで確かめてください。

## 料金

金額は USD、東京リージョン、on-demand、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

**使われていないとき。** table の保存量だけです。東京リージョンでは最初の 25 GB が無料で、それを超えた分が 1 GB あたり月 USD 0.285 です。この無料分は、公開されている価格表の段階として載っているものです。ノートが 10 MB なら 0 です。

**使われたとき。** 読み書きの単位で数えます。

| 対象 | 単価 | 数え方 |
| --- | --- | --- |
| 書き込み（write request unit） | 100 万あたり USD 0.715 | 1 KB までの item 1 件の書き込みで 1 |
| 読み取り（read request unit） | 100 万あたり USD 0.1425 | 4 KB までの item 1 件で、強整合なら 1、結果整合なら 0.5 |

月 100 万リクエストを仮定した計算です。内訳は一覧 70%、1 件の取得 20%、作成と更新 8%、削除 2% とし、一覧は 1 回で 20 KB を結果整合で読むとします。Lambda は 256 MB、arm64 で、平均実行時間は DynamoDB を呼ぶ分だけ 04章より長い 60 ミリ秒と仮定します。計測値ではありません。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエストと実行時間 | 100 万件、15,000 GB 秒 | 0.40 | 0 |
| CloudWatch Logs | 0.477 GB | 0.37 | 0 |
| DynamoDB の読み取り | 195 万 unit | 0.28 | 0.28 |
| DynamoDB の書き込み | 10 万 unit | 0.07 | 0.07 |
| DynamoDB の保存 | 1 GB | 0.00 | 0.00 |
| 小計 | | **2.41** | **1.64** |

この計算で動かしやすいのは、一覧の読み取りです。全体の 100 万リクエストのうち、DynamoDB の read request unit の 9 割を一覧が使っています。1 ページの件数を減らすか、一覧に本文を含めないようにすると減ります。一覧を強整合にすると、この行が 2 倍になります。

競合で拒否された更新も、write request unit を消費します。この計算は競合ゼロを仮定しています。

**この計算に入っていないもの。** 応答のデータ転送料金。point-in-time recovery（有効にすると、1 GB あたり月 USD 0.228 の保存料金がかかります。この章では無効です）。

**消した後。** table は stack と一緒に消えます。残りません。

## うまくいかないとき

| 症状 | 確かめること |
| --- | --- |
| `dev:notes` が `Invalid environment` で止まり、`NOTES_STORE` と出る | `examples/05-dynamodb/.env` があるか |
| `NOTES_STORE=dynamodb` で起動し、最初のリクエストが 500 になる | DynamoDB Local が動いているか（`db:local:start`）。table を作ったか（`db:migrate:local`）。ログの `ResourceNotFoundException` |
| デプロイ後、500 でログに `AccessDeniedException` | 実行 role に無い操作を呼んでいる。メッセージに操作名（`dynamodb:Scan` など）と table の ARN が出る |
| デプロイ後、500 でログに `ResourceNotFoundException` | `TABLE_NAME` が指す table が無い。別のリージョンを見ていないか |
| 更新が必ず 409 になる | 送っている `expectedVersion` が、直前に受け取ったノートの `version` か。作成の応答ではなく、最後の更新の応答の値を使う |
| 作ったノートが直後の一覧に出ない | 結果整合の読み取りでは起こり得る。「読み取りの整合性を選ぶ」の節のとおり |
| 一覧が途中で終わる | `nextCursor` が `null` になるまで読んでいるか |
| ログに throttling を示すエラーが出る | 新しい on-demand の table が受けられる流量には初期の上限がある。急に大量の流量をかけていないか |

## 本番に進めるなら

- **認証と、持ち主ごとの分離を足す。** いまは全員が同じノートを読み書きします（06章の予定）。
- **table を守る。** `removalPolicy` を `RETAIN` にし、削除保護と point-in-time recovery を有効にします。誤って消したデータを戻す手順は 22章で扱う予定です。
- **流量の上限を決める。** on-demand の table には、1 秒あたりの読み書きの最大値を設定できます。上限のない公開 API は、料金の上限もありません。
- **作成を冪等にする。** 再試行で重複する問題を直します（08章の予定）。
- **throttling と失敗を監視する。** DynamoDB のエラーと、409 の割合を見ます（19章の予定）。409 が多いなら、画面の作りか、ノートの分け方を見直す合図です。
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で述べたとおりです。

## 片付け

<!-- section: 05.cleanup -->

```bash
vp run notes:infra:destroy
vp run db:local:stop
```

`notes:infra:destroy` で、table、関数、role、API、log group が消えます。**table の中のノートもすべて消え、戻せません。** この stack は backup を取っていません。

`db:local:stop` は、手元の DynamoDB Local のコンテナを消します。メモリに置く設定で起動しているので、中身も消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

## この章の検証状況

- contract test（メモリ）、DynamoDB へのリクエストの検査、アプリと client のテスト、インフラの assertion、型検査、synth（AWS SDK を含む bundle）、`dev:notes` をメモリで起動しての上記の `curl` は、**ローカル検証済み**です。
- DynamoDB Local を使うタスク（`db:local:start`、`db:migrate:local`、`db:seed:local`、`db:reset:local`、`db:local:stop`、`test:local:dynamodb`）は、執筆時に Docker の daemon が使えなかったため実行していません。**未検証**です。
- `notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift`、`notes:infra:destroy` は実行していません。**未検証**です。
- したがって、この章の中心である「条件付き書き込みが同時の更新を 1 つだけ通す」ことは、DynamoDB の上では一度も確かめていません。確かめたのは、正しい条件式を送っていることと、メモリの実装が同じ規則に従うことです。DynamoDB の挙動についての記述は、公式ドキュメントに基づきます。

## この章のソース対応

| 節 | 対応するファイル | タスク |
| --- | --- | --- |
| 読み方から key を決める | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/id.ts`、`src/notes.ts` | `test:unit` |
| 契約に version を足す | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| 保存先を差し替える | `examples/05-dynamodb/src/repository.ts`、`src/memory-repository.ts`、`src/dynamodb-repository.ts`、`src/compose.ts` | `test:unit` |
| 条件付き書き込みで上書きを防ぐ | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/app.ts`、`test/repository-contract.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
| 読み取りの整合性を選ぶ | `examples/05-dynamodb/src/dynamodb-repository.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
| 取りこぼさずにページを送る | `examples/05-dynamodb/src/repository.ts`、`src/app.ts`、`src/contract.ts`、`test/app.test.ts` | `test:unit` |
| 届かなかった応答と再試行 | `examples/05-dynamodb/src/client.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/05-dynamodb/src/dev.ts`、`src/env.ts`、`test/env.test.ts`、`scripts/local-db.ts`、`test/fixtures/seed-notes.json`、`.env.example` | `dev:notes`、`db:local:start`、`db:migrate:local`、`db:seed:local`、`db:reset:local`、`db:local:stop` |
| テストする | `examples/05-dynamodb/test/`、`scripts/test-local.ts` | `test:unit`、`test:local:dynamodb` |
| インフラを定義する | `examples/05-dynamodb/infra/lib/notes-stack.ts`、`infra/bin/app.ts`、`infra/test/notes-stack.test.ts`、`cdk.json` | `notes:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/05-dynamodb/src/lambda.ts`、`scripts/smoke.ts`、`tools/src/infra/` | `notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift` |
| 片付け | `tools/src/infra/` | `notes:infra:destroy`、`db:local:stop` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

## 一次情報

- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)（確認日 2026-10-11）
- [DynamoDB condition expression CLI example](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)（確認日 2026-10-11）
- [Paginating table query results in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)（確認日 2026-10-11）
- [DynamoDB on-demand capacity mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)（確認日 2026-10-11）
- [Constraints in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)（確認日 2026-10-11）
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)（確認日 2026-10-11）
- [Cloudflare D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)（確認日 2026-10-11）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（確認日 2026-10-11）
