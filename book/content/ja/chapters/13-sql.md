---
title: "13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2"
revision: 1
---

# 13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2

D1 で `CREATE TABLE` を書いて、`wrangler d1 migrations apply` して、Worker から SQL を投げる。あの流れを AWS でやるとどうなるか、がこの章です。

[04章](/ja/chapters/04-http-api.md)のノートの API を、今度は SQL で保存します。schema を書いて、migration を流して、型のついた query を書いて、手元で動かして、Lambda からつなぐところまで。相手は Aurora DSQL です。RDS for PostgreSQL と Aurora Serverless v2 は、どこが違うかを横に並べて見ます。

先に 1 つだけ。Aurora DSQL は PostgreSQL と互換ですが、PostgreSQL そのものではありません。そして「分散した D1」でもありません。似ているところから入って、違うところで立ち止まる、という順で進めますね。

前提は 04章だけです。[05章](/ja/chapters/05-dynamodb.md)（DynamoDB）は読んでいなくても大丈夫。コードは `examples/13-sql/` にあります。

## 全体像

<!-- section: 13.architecture -->

```figure
caption: リクエストは API Gateway と Lambda function を通って、PostgreSQL の接続で Aurora DSQL cluster に届く
node client: Client | curl, あとで SPA
node api: API Gateway HTTP API | ap-northeast-1
node fn: Lambda function | Node.js 24, arm64, VPC の外
node db: Aurora DSQL cluster | single-Region, ap-northeast-1
edge client -> api: HTTPS
edge api -> fn: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> db: PostgreSQL wire protocol over TLS, port 5432
mark db
```

```figure
caption: Lambda function は自分で cluster に接続し、database role の notes_api として、関数の中で作った IAM 署名つきの token を password にする
node role: execution role | この cluster への dsql:DbConnect, 自分の log group
node app: Hono app
node svc: NoteService
node repo: SqlNoteRepository
node tx: transaction runner | SQLSTATE 40001 で retry
node db: database postgres | app: owners, notes / public: aih_migrations
edge app -> svc
edge svc -> repo
edge repo -> tx
edge tx -> db: user notes_api, password は token
group fn: Lambda function = role, app, svc, repo, tx
group cl: Aurora DSQL cluster: database はこれ 1 つだけ = db
```

```figure
caption: 手元のマシンからは、同じ app を PGlite の上で動かすか、admin として cluster につないで migration を流す
node dev: vp run dev:sql | 同じ app を動かす
node mig: vp run sql:db:migrate
node pglite: PGlite | Node プロセスの中の PostgreSQL
node db: Aurora DSQL cluster
edge dev -> pglite
edge mig -> db: admin, 自分の IAM 認証情報
group laptop: 手元のマシン = dev, mig
```

04章との違いは、Lambda の下に DB が 1 つ増えただけです。ノートの持ち主は、もう Lambda のメモリではなく cluster。どの実行環境が応答しても、同じノートが見えます。

図の中で、D1 と感覚が違うところが 3 つあります。

**binding がない。** Worker なら `env.DB` に DB が現れますが、ここでは Lambda が自分で TCP の接続を張ります。接続先は環境変数、つないでいいかは IAM、つないだあと何ができるかは DB の中の権限。3 か所に分かれています。

**パスワードがない。** Aurora DSQL には、保存しておくパスワードがありません。接続するたびに、IAM の認証情報で署名した期限つきの token を作って、パスワードの欄に入れます。

**VPC がない。** cluster の endpoint は公開の DNS 名で、TLS と token で守られています。だから Lambda を VPC に入れなくても届きます。RDS と Aurora は、ここが違います（すぐ下で）。

## どれを選ぶ？

<!-- section: 13.choices -->

AWS で PostgreSQL 系の SQL を使う道は、大きく 3 つあります。

| | Aurora DSQL | RDS for PostgreSQL | Aurora Serverless v2（PostgreSQL） |
| --- | --- | --- | --- |
| SQL | PostgreSQL 16 互換の一部。使えないものがある（次の節） | PostgreSQL そのもの | PostgreSQL 互換 |
| 最初に決めること | ほぼ無い。cluster を作るだけ | instance の大きさ、storage、VPC と subnet、パスワードの置き場所 | 容量の範囲（ACU）、VPC と subnet、パスワードの置き場所 |
| 認証 | IAM の token だけ | パスワード。IAM の token も選べる | パスワード。IAM の token も選べる |
| つなぎ方 | 公開の endpoint へ TLS で。VPC は要らない | VPC の中から。Lambda も VPC に入れる | VPC の中から。Data API なら VPC なしで HTTP |
| transaction | REPEATABLE READ に固定。ロックで待たず、commit のときに競合を調べる | 既定は READ COMMITTED。ロックで待つ | 同左 |
| 1 transaction の上限 | 3,000 行、10 MiB、5 分 | この種の上限は無い | 同左 |
| 使っていないとき | DPU は 0。storage だけ | instance が動いている間はずっと課金 | 最小 0 ACU なら止まる。storage は残る |

この章が Aurora DSQL を主役にしたのは、D1 から来た人にいちばん近い入り口だからです。置いてあるだけの料金がほとんど無くて、ネットワークを設計しなくていい。04章の Lambda に、そのままつなげます。

でも、DSQL が合わない場面ははっきりあります。

- **PostgreSQL の機能がそのまま要る。** trigger、PL/pgSQL、extension、一時 table。手持ちの PostgreSQL のアプリや ORM を、書き換えずに動かしたい。それなら PostgreSQL そのものである RDS が素直です（Aurora がどこまで同じかは、この章では確かめていません）
- **1 つの transaction で大量の行を書く。** 3,000 行を超える一括更新や、5 分を超える処理。分割できないなら DSQL には載りません
- **同じ行に書き込みが集中する。** カウンターや在庫のような行を、たくさんの transaction が同時に更新する。DSQL は待たせる代わりに失敗させるので、再試行ばかりになります

RDS と Aurora を選ぶと、VPC が付いてきます。DB の instance は VPC の中に置くものなので、Lambda も VPC に入れて、subnet と security group を用意します。その話は [11章](/ja/chapters/11-network.md)でしました。この章では作りません。

Aurora Serverless v2 の「止まる」には条件があります。最小容量を 0 ACU にすると、利用者の接続が無い状態が一定時間（既定は 5 分、最長 1 日）続いたときに instance が止まって、instance の料金が 0 になります。ただし、接続が 1 本でも開いていれば止まりません。RDS Proxy を付けると、proxy が接続を持ち続けるので止まりません。論理レプリケーションや zero-ETL を使っていても止まりません。止まったあとの最初の接続は、再開に 15 秒ほど。24 時間を超えて止まっていたら、30 秒以上かかることがあります。そして、止まっている間も storage の料金は残ります。

Aurora には Data API という、HTTP で SQL を投げる口もあります。これを使うと Lambda を VPC に入れずに済みますが、DB の認証情報を Secrets Manager に置く作りです。使えるリージョンと engine の版は、この章では確かめていません。

## Aurora DSQL は PostgreSQL そのものではない

<!-- section: 13.compat -->

ここは、古い記事を信じると間違えるところです。DSQL は機能が増え続けていて、「未対応の一覧」はすぐ古くなります。たとえば外部キーは 2026 年 8 月に、sequence と identity column は 2026 年 2 月に入りました。以下は、この章を書いた日（2026-10-11）に公式ドキュメントを読んだ結果です。あなたが読む日には、また変わっているかもしれません。

まず、ふつうに使えるもの。`SELECT` の join、CTE、window 関数。`INSERT ... ON CONFLICT`。`CHECK`、`UNIQUE`、外部キー。view、SQL で書いた関数、JSON と JSONB。

次に、形が違うもの。

- **index は `CREATE INDEX ASYNC`。** index の作成はいつも非同期で、`ASYNC` を付けないと通りません。文はすぐに job の ID を返して、index は裏で作られます
- **1 つの transaction に DDL は 1 文だけ。** しかも DDL と DML は同じ transaction に入れられません。table を作って、同じ transaction で行を入れる、ができないんです
- **table を作ったあとで主キーは変えられない。** 足すこともできません
- **`ALTER TABLE ... ADD COLUMN` は、列名と型だけ。** 対応している構文の一覧には、その形に制約や既定値を付ける書き方がありません。`SET NOT NULL` や列の型の変更も、一覧にありません
- **sequence は `CACHE` の指定が必須。** 1 か、65536 以上です。公式ドキュメントは、ID には UUID を既定にすることを勧めています
- **分離レベルは REPEATABLE READ に固定。** 変えられません

そして、無いもの。一時 table、trigger、PL/pgSQL、`TRUNCATE`（代わりに `DELETE FROM`）。database は cluster に 1 つで、名前は `postgres` です。

「手元の PostgreSQL では通ったのに、DSQL では通らない」を、デプロイしてから知るのはつらいですよね。なので、migration のファイルを文字として調べる小さな検査を置きました。

<<< @/examples/13-sql/src/migrate.ts{lint}

全部は見ていません。この章の migration が踏みそうなものだけです。それでも、`ASYNC` を忘れた index は `vp run test:unit` で落ちます。

### ORM と migration ツールは？

この章は、素の SQL ファイルと、小さな migration runner、node-postgres（`pg`）で書いています。重い ORM は使いません。

理由は 2 つ。1 つは、上の制約（DDL は 1 文ずつ、index は `ASYNC`）に、一般的な migration ツールの既定の動きが合わないことがあるから。もう 1 つは、何が DB に送られるかを、この章では全部見えるようにしておきたいからです。

node-postgres が DSQL で動く根拠は、公式ドキュメントにあります。AWS は node-postgres 用と Postgres.js 用の認証の connector を配っていて、Lambda から node-postgres でつなぐサンプルも載せています。この章のつなぎ方は、そのサンプルと同じ形です。ORM については、Drizzle 用の adapter と、Prisma、Sequelize、TypeORM のサンプルが一覧にあります。この章では、どれも動かしていません。

## schema と migration

<!-- section: 13.migrations -->

table は 2 つです。

<<< @/examples/13-sql/migrations/0002_create_owners.sql

<<< @/examples/13-sql/migrations/0003_create_notes.sql

ノートの ID は、アプリが作るランダムな UUID にしました。D1 だと `INTEGER PRIMARY KEY` の連番にしたくなるところですが、DSQL のドキュメントは、書き込みの多い table で単調に増える主キーを避けるよう勧めています。新しい行がみんな同じ場所に集まってしまうからです。

`owners` の `note_count` は、あとで主役になります。いまは「1 人が持てるノートは 100 件まで」を数えるための列、とだけ覚えておいてください。この上限があるので、一覧はいつも 1 ページに収まります。04章と同じく、ページ送りは付けていません。

index はこうです。

<<< @/examples/13-sql/migrations/0004_index_notes_by_owner.sql

### 1 ファイルに 1 文

D1 の migration は、1 つのファイルに SQL を何文でも書けます。この章では、1 ファイルに 1 文だけにしました。

DSQL は 1 つの transaction に DDL を 1 文しか入れられないので、何文か書いたファイルは、どうやっても「全部通るか、全部戻るか」にできません。だったら最初から 1 文にしておけば、ファイル 1 つが transaction 1 つに、そのまま対応します。

runner の本体です。

<<< @/examples/13-sql/src/migrate.ts{migrate}

やっていることは D1 と同じで、ファイルを名前の順に流して、どこまで流したかを table（`public.aih_migrations`）に書くだけ。違いは真ん中のコメントのところです。

schema の変更と、「変更した」という記録は、同じ transaction に入れられません。DDL と DML を混ぜられないので。ということは、変更が終わって、記録を書く前にプロセスが落ちると、「適用済みなのに記録が無い」状態が残ります。

次に実行すると、同じ文がもう一度流れます。だから、どの文も 2 回流して大丈夫な形（`IF NOT EXISTS`）にしてあって、さっきの lint がそれを強制しています。migration の invariant はこうです。**記録があるなら、その文は適用されている。記録が無い文は、もう一度流しても結果が変わらない。**

これも、わざと壊して確かめています。

<<< @/examples/13-sql/test/migrate.test.ts{interrupted}

もう 1 つ。適用済みのファイルをあとから書き換えると、runner は checksum の違いに気づいて止まります。直したいときは、新しい番号のファイルを足してください。

手元の PostgreSQL は `ASYNC` という語を知りません。そこだけ、runner が送る直前に取り除きます。

<<< @/examples/13-sql/src/migrate.ts{dialect}

ファイルに書いてあるのは DSQL の SQL で、手元のほうを合わせている、という向きです。逆にはしていません。

## 行を型にする

<!-- section: 13.queries -->

API の契約は 04章とほぼ同じで、更新（`PUT`）と `version` を足しました。

<<< @/examples/13-sql/src/contract.ts{note}

DB との間には、薄い interface を 1 枚だけ挟みます。

<<< @/examples/13-sql/src/db.ts{db}

`query` は SQL の文字列と、`$1` のような番号つきの値を受け取ります。値を SQL の文字列に埋め込むことは、この章のアプリではしません。SQL injection の入り口を、最初から作らないためです。

さて、`query` が返す `rows` の型は `unknown[]` にしてあります。node-postgres は好きな型を付けさせてくれますが、それは「こういう形のはず」という宣言でしかありません。migration で列の名前を変えたら、型はそのまま、実行時の値だけが変わります。

DB の行は、HTTP のリクエストと同じで、型の外から来る値です。だから同じように扱います。

<<< @/examples/13-sql/src/db.ts{rows}

<<< @/examples/13-sql/src/notes-repository.ts{row}

行の schema が、そのまま snake_case の列から API の `Note` への変換も兼ねています。`timestamptz` は node-postgres でも PGlite でも `Date` で返ってくるので、ISO 8601 の文字列に直します。

更新はこうです。

<<< @/examples/13-sql/src/notes-repository.ts{update}

`WHERE ... AND version = $6` がポイント。読み込んだときの `version` のままなら更新して 1 つ進める。違っていたら 1 行も更新されないので、いまの行を読んで 409 と一緒に返します。確認と書き込みが 1 つの文なので、間に別の書き込みが割り込む隙間がありません。

D1 でも同じ SQL が書けます。ここは SQL のいいところですね。

## transaction は丸ごとやり直す

<!-- section: 13.transactions -->

ここからが、この章でいちばん D1 と違うところです。

ノートを作るとき、「この owner は、まだ 100 件に達していないか」を確かめてから書きます。素直に書くなら、件数を数えて、少なければ `INSERT`。でも、それを同時に 2 つ実行するとどうなるでしょう。上限を 2 件、いま 1 件、として追ってみます。

```figure
caption: 上限が 2 件で、owner がすでに 1 件持っているとき、同時に走った 2 つの transaction のうち B は commit で負け、やり直して上限に当たる
type: sequence
actor a: transaction A | POST /notes
actor db: Aurora DSQL
actor b: transaction B | POST /notes
step a -> db: t1 BEGIN (note_count = 1 を見る)
step b -> db: t2 BEGIN (note_count = 1 を見る)
step a -> db: t3 UPDATE owners SET note_count = 2
step a -> db: t4 INSERT INTO notes ...
step b -> db: t4 UPDATE owners SET note_count = 2
step a -> db: t5 COMMIT: ok
step b -> db: t5 INSERT INTO notes ...
step b -x db: t6 COMMIT: SQLSTATE 40001 (OC000)
note b: B が書いたものは何も適用されない
step b -> db: t7 再び BEGIN (note_count = 2 を見る)
step b -> db: t8 UPDATE ... WHERE note_count < 2
note b: t8 0 行
step b -> db: t9 COMMIT
note b: API は quota_exceeded を返す
```

Aurora DSQL の transaction は、始まった時点のデータを最後まで読み続けます（snapshot isolation）。B は t2 の時点の `note_count = 1` を見ているので、t4 の `UPDATE` は何事もなく通ります。A がもう書いたことを、B は知りません。

ふつうの PostgreSQL なら、t4 で B は A のロックが外れるのを待ちます。DSQL は待たせません。ロックを取らずに進めさせて、commit のときに「同じ行を、先に commit した transaction がいないか」を調べます。これが楽観的同時実行制御（OCC）です。B は t6 で負けて、SQLSTATE `40001`（serialization failure）が返ります。B が書いたものは、何も残りません。

負けた側がやることは 1 つ。**transaction を最初からやり直す**ことです。

<<< @/examples/13-sql/src/transaction.ts{run}

`COMMIT` だけをもう一度送る、ではダメなんです。t7 を見てください。やり直した B は `note_count = 2` を読んで、今度は「もう入らない」と判断します。1 回目とは答えが違う。前回の判断を覚えておいて `INSERT` だけ流し直したら、3 件目ができてしまいます。

この章の invariant はこうです。**transaction は、全体が commit されるか、全体がやり直されるかのどちらか。やり直しで結果が変わるのは、DB から読み直した値によってだけ。**

後半を守るために、作成の処理はこう書いてあります。

<<< @/examples/13-sql/src/notes-repository.ts{create}

決まりごとは 3 つです。

**transaction の中では、DB 以外に触らない。** メールを送る、別の API を呼ぶ、といった処理を中に書くと、やり直しのたびに 2 回、3 回と実行されます。

**ID と時刻は、外で決めて渡す。** ノートの ID を transaction の中で作ると、やり直すたびに別のノートになります。

<<< @/examples/13-sql/src/notes.ts{service}

**同じ ID がもうあれば、何もしない。** 先頭の `selectNote` がそれです。なぜ要るかというと、commit の応答が届かないことがあるからです。接続が切れたとき、commit は成功していたかもしれないし、していなかったかもしれない。同じ ID でもう一度呼んでも 1 件にしかならない、という作りにしておけば、どちらでも困りません。

### なぜ件数を数えずに、行を 1 つ更新するのか

`SELECT count(*) FROM app.notes` で数えて `INSERT` する書き方は、A も B も「1 件だな」と読んで、それぞれ別の行を `INSERT` します。同じ行には書いていないので、DSQL は競合と見なしません。両方 commit されて、3 件になります。write skew と呼ばれる現象です。

`owners` の `note_count` を必ず更新するようにしたのは、2 つの transaction を、わざと同じ行でぶつけるためです。これで、DB が片方を止めてくれます。

そのかわり、同じ owner の作成と削除は、同時には 1 つしか通りません。1 人のノートならそれで十分ですが、全員が同じ 1 行を更新するような設計にすると、やり直しだらけになります。「どの行でぶつけるか」は、DSQL での設計の中心です。

### どこまでやり直すか

<<< @/examples/13-sql/src/transaction.ts{policy}

やり直すのは `40001` のときだけ。回数は 4 回までで、間隔はだんだん長く、乱数でばらけさせます。同時に負けた transaction が、また同時に戻ってきてぶつかるのを避けるためです。

4 回とも負けたら、あきらめて 503 を返します。

<<< @/examples/13-sql/src/app.ts{errors}

どの回も rollback されているので、何も書かれていません。呼んだ側は、そのまま送り直せます。

読み取りも、同じ runner を通しています。schema を変えた直後は、古い schema を覚えている接続が `40001`（OC001）を受け取ることがあるからです。そのぶん、1 回の読み取りで `BEGIN` と `COMMIT` の往復が増えます。

ちなみに、`version` の確認と、この再試行は、別の話です。`version` は「画面を開いてから保存するまでの間に、誰かが書き換えた」を見つけるもの。数秒から数分の話です。OCC は「同じ瞬間に commit しようとした」を見つけるもの。ミリ秒の話です。両方要ります。

## 競合をわざと起こす

<!-- section: 13.conflicts -->

困ったことに、手元ではこの競合が起きません。PGlite は接続が 1 本きりで、transaction は順番に 1 つずつ実行されるからです。

起きないものは、起こします。

<<< @/examples/13-sql/test/support.ts{inject}

`COMMIT` が来たら、本物の commit の代わりに rollback して、「勝った側」の書き込みを先に commit して、それから `40001` を投げる。DSQL で負けたときに起きることを、同じ順番で再現しています。SQL そのものは、本物の PostgreSQL（PGlite）で実行されます。

これで、さっきの時系列をそのままテストにできます。

<<< @/examples/13-sql/test/notes-repository.test.ts{conflicts}

2 つ目のテストが、この章の中心です。最後の 1 枠を取り合って負けた側は、やり直して `quota_exceeded` になる。そして `owners` の件数と `notes` の行数が、どちらも上限ちょうどで一致する。

正直に言うと、これは「DSQL が実際にこう振る舞う」ことの証明ではありません。「DSQL がドキュメントどおりに `40001` を返したとき、このコードが正しく動く」ことの確認です。本物の cluster で競合を起こして確かめるのは、まだできていません。

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

## Lambda からつなぐ

<!-- section: 13.connect -->

### 接続

<<< @/examples/13-sql/src/dsql.ts{dsql}

`password` に関数を渡しているのが、DSQL らしいところです。node-postgres は、新しい接続を張るたびにこの関数を呼びます。関数は、その場で token を署名して返します。

token の署名は、手元の計算だけで終わります。AWS に問い合わせません。だから速いのですが、認証情報が間違っていても、token は作れてしまいます。失敗がわかるのは、つなぎに行ったときです。

token の期限は既定で 15 分。ただし、期限を見られるのは接続するときだけで、つながった接続は token が切れたあとも使えます。接続のほうには別の上限があって、DSQL は 60 分で切ります。なので `maxLifetimeSeconds` で、50 分たった接続は自分から捨てるようにしています。

`max: 1` は、Lambda の実行環境が一度に 1 つのリクエストしか処理しないからです。接続の数は、だいたい同時に動いている実行環境の数になります。cluster の上限は既定で 10,000 接続、新しい接続は毎秒 100 本までです。

TLS は `rejectUnauthorized: true`。証明書の連鎖とホスト名を、Node.js が持っている認証局の一覧で確かめます。

<<< @/examples/13-sql/src/lambda.ts{handler}

04章と同じで、ファイルのいちばん外側は実行環境ごとに 1 回だけ動きます。pool もそこで 1 つ。2 回目からの呼び出しは、開いたままの接続を使い回します。

設定は起動時に確かめます。

<<< @/examples/13-sql/src/env.ts{env}

### cluster と権限

<<< @/examples/13-sql/infra/lib/sql-stack.ts{cluster}

拍子抜けするくらい、何もありません。instance の大きさも、subnet も、パスワードも選びません。固定している版の CDK（aws-cdk-lib 2.273.0）には、DSQL 用の高水準の construct がまだ無いので、CloudFormation の `AWS::DSQL::Cluster` をそのまま表す `CfnCluster` を使っています。

練習用なので、削除保護は切って、stack と一緒に消えるようにしました。本番では逆にします。

<<< @/examples/13-sql/infra/lib/sql-stack.ts{role}

権限は 2 段になっています。

1 段目が IAM。`dsql:DbConnect` は「この cluster に、admin 以外の database role でつないでいい」という許可です。似た名前の `dsql:DbConnectAdmin` は、`admin` としてつなぐ許可。関数には渡していません。`admin` になれると、table を消せてしまうので。

2 段目が DB の中。つないだあと、どの table に何ができるかは、database role への `GRANT` で決まります。

<<< @/examples/13-sql/src/grant.ts{grant}

`AWS IAM GRANT` は DSQL 独自の文で、「この IAM role は、この database role としてログインしていい」を登録します。`GRANT` で渡しているのは行の読み書きだけ。関数は schema を変えられません。migration は、あなたが `admin` として手元から流します。

この 2 つの文は `$1` を受け付けないので、名前を文字列に埋め込むしかありません。さっき「値は埋め込まない」と言ったばかりですが、ここは例外です。だから、埋め込む前に形を厳しく確かめて、テストも付けました。

<<< @/examples/13-sql/infra/lib/sql-stack.ts{function}

bundle の形式を CommonJS にしたのは、node-postgres が CommonJS で、Node.js の標準モジュールを `require()` で読むからです。synth でできた bundle を手元の Node.js 24 で読み込んで、DB に触らない route が応答するところまでは確かめました。

## デプロイして、migration を流す

<!-- section: 13.deploy -->

ここからは AWS を変更します。正直に言うと、この節の手順は、まだ一度も実際の AWS で通せていません。

```bash
vp run sql:infra:diff
vp run sql:infra:deploy
```

cluster、関数、API ができます。でも、まだ動きません。cluster は空っぽで、関数の role も DB に入れないからです。D1 でも、database を作っただけでは table は無いですよね。

```bash
vp run sql:db:migrate
vp run sql:db:grant
```

`sql:db:migrate` は、手元と同じ migration を、今度は `ASYNC` を付けたまま流します。index の文が返す job の ID を使って、`sys.jobs` を見ながら完了を待ちます。`sql:db:grant` は、さっきの `GRANT` を流して、関数の role を `notes_api` に結びつけます。

どちらも、`admin` としてつなぎます。あなた自身の認証情報に `dsql:DbConnectAdmin` が要ります。

順番は、migration が先です。`GRANT ... ON ALL TABLES` が効くのは、その時点で存在する table だけ。あとで table を足す migration を流したら、`sql:db:grant` ももう一度流してください。

```bash
vp run sql:smoke
```

作成、読み戻し、更新、古い `version` での更新（409 を期待）、削除を順に確かめます。04章の smoke と違って、読み戻しは必ず成功するはずです。

seed を入れたければ `vp run sql:db:seed`。ログは `vp run sql:logs` で、競合でやり直した回数は `transaction retry` の行でわかります。drift の検査は `vp run sql:infra:drift` です。

1 つ、気にしておきたいことがあります。固定している版の cdkd（0.296.28）は、`AWS::DSQL::Cluster` に専用の実装を持っていません。Cloud Control API 経由で扱います。作成、endpoint の組み立てに使っている identifier の取得、drift の読み戻し、削除が実際に通るかは、未確認です。

### reset を cloud 用に作らなかった理由

`sql:db:reset:local` はありますが、`sql:db:reset` はありません。わざとです。

cloud の reset は、table を全部消す、という意味になります。それをコマンド 1 つで打てるようにしておくと、いつか本番に向けて打ちます。練習用の cluster をまっさらにしたいときは、stack ごと消して作り直してください。

### 動いている DB の schema を変えるとき

D1 でも同じですが、migration とコードのデプロイは、同時には起きません。古いコードが新しい schema で動く時間が、必ずあります。

DSQL だと、ここに制約が重なります。`ADD COLUMN` で足せるのは、制約も既定値もない列。なので、列を足す、新しいコードを出す、古い行を埋める（1 回の transaction は 3,000 行まで）、という段階に分けることになります。この章では、そこまでは実装していません。

## backup と restore

<!-- section: 13.backup -->

D1 には Time Travel があって、何も設定しなくても、過去 30 日の好きな分に戻せます。あれに慣れていると、ここは手間が増えます。

Aurora DSQL の backup は、AWS Backup という別のサービスを通します。取れるのは cluster 全体の backup で、その場で 1 回取るか、スケジュールと保持期間を決めて自動で取るか。restore は、いつも**新しい cluster** を作ります。元の cluster を巻き戻すわけではありません。

つまり restore のあとには、アプリの向き先を新しい endpoint に変える作業が残ります。この章の stack なら、cluster の identifier から endpoint を組み立てているので、そこを差し替えることになります。database role と `AWS IAM GRANT` が新しい cluster に引き継がれるかは、確かめていません。

DSQL のドキュメントの backup のページには、「何時何分の状態に戻す」という機能の説明はありませんでした。失ってもいい時間の長さは、backup を取る間隔で決まる、と考えておくのが安全です。

もう 1 つ。使われていない cluster は Idle、さらに Inactive という状態に移って、計算資源が 0 になります。backup は Active の cluster でないと取れません。夜中のスケジュールで、誰も使っていない cluster の backup が失敗する、ということが起きえます。

RDS と Aurora は、自動 backup を持っています。Aurora は連続的に取っていて、保持期間（1〜35 日）の中の好きな時点に戻せます。こちらも、戻すと新しい instance や cluster ができます。

この章では、backup を取るリソースは作っていません。練習用のデータなので。手順として試せてもいません。

## D1 から来た人へ

<!-- section: 13.d1 -->

| | Cloudflare D1 | この章（Aurora DSQL） |
| --- | --- | --- |
| SQL | SQLite | PostgreSQL 16 互換の一部 |
| 手元 | `wrangler dev` がローカルの D1 を用意する。本番と同じ D1 | PGlite で代用。DSQL ではない |
| migration | 番号つきの `.sql` を Wrangler が順に流す。失敗した migration は rollback される | 番号つきの `.sql` を、この章の runner が順に流す。1 ファイル 1 文。途中で止まっても流し直せる形にする |
| つなぎ方 | binding（`env.DB`） | TCP の接続。IAM の token がパスワード |
| transaction | `batch()` に並べた文が 1 つの transaction | `BEGIN` から `COMMIT` まで。途中で読んだ値を見て、次の文を決められる |
| 同時に書いたとき | 書き込みは primary の 1 か所に集まる | commit のときに競合を調べて、負けた側は `40001`。やり直す |
| 読み取りの置き場所 | read replica を世界中に置ける。非同期 | 1 リージョンの中の 3 つの AZ。同期 |
| backup | Time Travel。過去 30 日の好きな分へ | AWS Backup。cluster 全体。restore は新しい cluster |
| 料金の単位 | 読んだ行、書いた行、storage | DPU、storage |

違いがいちばん大きいのは、整合性の話です。

D1 の read replica は、primary から非同期に写しを受け取ります。だから replica は、いくらでも古くなりえます。それを補うのが Sessions API で、1 つの session の中では、読み取りが前に戻らないこと、自分が書いたものが読めることを保証します（sequential consistency）。保証の範囲は session です。別の session が何を見ているかは、bookmark を渡さないかぎり別の話。そして Sessions API を使わなければ、query は全部 primary に行きます。

Aurora DSQL の single-Region の cluster は、3 つの AZ に同期で書きます。commit されたものは、次のどの transaction からも見えます。session や bookmark を気にする場面がありません。そのかわり、東京の cluster は東京にあります。遠くの読者の近くに写しを置く、という D1 の read replica のような仕組みは、この構成にはありません。

だから DSQL は、「D1 を分散させたもの」ではないんです。D1 は、1 か所で書いて、遠くで読めるようにした DB。DSQL は、1 つのリージョンの中で、どこに書いても同じものが見えるようにした DB。目指している場所が違います。multi-Region の cluster もありますが、同じ地域の組（東京なら大阪やソウルなど）の中に限られます。この章では扱いません。

transaction の書き方も違います。D1 の `batch()` は、文を先に全部並べて渡します。途中で結果を見て分岐することはできません。DSQL は `BEGIN` と `COMMIT` の間で、読んで、判断して、書けます。さっきの quota の処理がそれです。その自由のかわりに、やり直しを自分で書くことになりました。

D1 のほうが楽な場面は、たくさんあります。binding、ローカルの本物、Time Travel。この本は、D1 をやめようとは言いません。SQLite では足りない、PostgreSQL の SQL が要る、AWS のほかのサービスのすぐ隣に置きたい、というときの選択肢として読んでください。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

Aurora DSQL の課金は 2 つだけ。DPU（SQL の実行にかかった計算、読み取り、書き込みをまとめた単位）が 100 万あたり 10.00、storage が 1 GB 月あたり 0.40 です。毎月、最初の 10 万 DPU と 1 GB が無料になります。料金ページには、この枠に期限があるかどうかは書かれていません。

**誰も問い合わせない月は、storage だけです。** 1 GB 置いていたとして、定価で 0.40、無料枠の中なので 0。

置いてあるだけの月を、3 つで比べます。

| 構成 | 仮定 | 定価 / 月 |
| --- | --- | --- |
| Aurora DSQL | 問い合わせなし、1 GB | 0.40（無料枠の適用後は 0） |
| RDS for PostgreSQL | db.t4g.micro、Single-AZ、gp3 を 20 GB（最小）、730 時間 | **21.01** |
| Aurora Serverless v2（auto-pause なし） | 最小 0.5 ACU のまま 730 時間、1 GB | **54.87** |
| Aurora Serverless v2（1 か月ずっと停止） | 最小 0 ACU、一度も再開せず、1 GB | 0.12 |

RDS の内訳は、instance が 18.25、storage が 2.76。Aurora は、容量が 54.75、storage が 0.12 です。RDS の無料枠は、この章では確かめていないので、引いていません。0 という意味ではなく、不明です。

最後の行は、いちばん都合のいい場合です。Aurora は保守のために instance を再開することがあって、その時間は課金されます。RDS と Aurora には、ここに VPC まわりの料金（11章）も乗ります。

使ったときの DSQL は、こうなります。月 100 万リクエストで、読み取り 90 万、書き込み 10 万、という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| DPU | 24,600 | 0.25 | 0 |
| storage | 1 GB 月 | 0.40 | 0 |
| 小計 | | **0.65** | **0** |

ここは強く断っておきます。24,600 DPU は、測った値ではありません。公式ドキュメントの計算例（主キーでの読み取りが 0.00675 DPU、1 行の `INSERT` が 0.06175 DPU）を借りて、読み取り 1 件を 0.00675、書き込み 1 件をその `INSERT` の 3 倍、と置いただけです。あなたの query の実際の値は、`EXPLAIN ANALYZE VERBOSE` か、CloudWatch の DPU のメトリクスでわかります。

この表は DB の分だけです。Lambda、API Gateway、ログは 04章と同じようにかかります。backup を取れば AWS Backup の料金が、やり直しが増えればそのぶんの DPU が乗ります。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:sql` が `Not applied yet` で止まる | `vp run sql:db:migrate:local` を先に |
| `The local database ... is open in process` | `dev:sql` が動いています。止めてからもう一度 |
| デプロイ後、`/health` は 200 なのに `/notes` が 500 | `sql:db:migrate` と `sql:db:grant` は流しましたか。ログに `relation "app.notes" does not exist` や `permission denied` があるはず |
| ログに `Wrong user to action mapping` | token の種類と database role が合っていません。`admin` には admin 用の token、それ以外にはふつうの token |
| ログに `IAM authentication failed` や access denied | 実行 role に `dsql:DbConnect` がありますか。`sql:db:grant` は、いまの role の ARN で流しましたか（stack を作り直すと ARN が変わります） |
| 503 と `busy` が返る | 4 回やり直して、全部負けました。同じ行に書き込みが集中しています。`transaction retry` の行を数えて、どの行でぶつかっているかを見直す |
| migration の直後だけ `40001` が出る | schema の変更で、古い schema を覚えていた接続が負けています（OC001）。やり直しで通るはず |
| `use CREATE INDEX ASYNC instead` | index の文に `ASYNC` がありません。lint が通っているなら、runner の `dialect` を確認 |
| `transaction row limit exceeded` | 1 つの transaction で 3,000 行を超えました。分けてください |
| しばらくぶりの最初の呼び出しだけ遅い、または失敗する | cluster が Idle や Inactive から戻っているか、凍っていた実行環境の接続が切れています。呼ぶ側でもう一度 |

最後の行は、想像で書いています。凍結から戻った実行環境で、切れた接続がどういうエラーになるかは、実機で見ていません。

## 本番にするなら

- **削除保護を入れて、stack を消しても cluster が残るようにする。** いまは逆です
- **backup の計画を作って、restore を一度は練習する。** 新しい cluster への切り替えまで含めて
- **認証を足す。** いまは owner が全員 `anonymous` です（[06章](/ja/chapters/06-auth.md)）
- **競合の回数を見張る。** `transaction retry` の行と 503 の数にアラームを付けます（ログの行を数えてアラームにする方法は [19章](/ja/chapters/19-observability.md)）
- **migration を、手元からではなく決まった経路で流す。** `dsql:DbConnectAdmin` を持つ人と場所を絞ります（CI の経路の作り方は [20章](/ja/chapters/20-shipping.md)）
- **作成を、呼ぶ側からも安全に送り直せるようにする。** いまは ID をサーバーが決めるので、応答が届かなかった `POST` を送り直すと、2 件目ができます。呼ぶ側が決めた key を受け取る作りに変えます
- **接続が切れたときの再試行を決める。** この章がやり直すのは `40001` だけです。接続のエラーでは、commit されたかどうかがわかりません。やり直していいのは、何度実行しても同じ結果になる処理だけです
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 13.cleanup -->

```bash
vp run sql:infra:destroy
```

cluster、関数、role、API、log group が消えます。ノートも、database role も、cluster と一緒です。backup は取っていないので、戻せません。

手元の DB は、`examples/13-sql/.pglite/` を消せば無くなります。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（transaction の再試行、PGlite の上での repository、`COMMIT` の競合の注入、migration の lint と中断からの再開、grant の文、API、インフラ）。型検査。synth と、できた bundle を Node.js 24 で読み込んで `GET /health` と UUID でない ID の 404 が返ること。`sql:db:reset:local`、`sql:db:migrate:local`、`sql:db:seed:local` と、2 回目の実行で何も変わらないこと。`dev:sql` を起動して、本文の `curl`（作成、更新、古い `version` の 409）と削除。`dev:sql` の起動中に reset が拒否されること、サーバーを止めたあとは古い lock が引き継がれること。

**まだ確かめていないこと。** 実際の Aurora DSQL には、一度もつないでいません。`sql:infra:deploy`、`sql:db:migrate`、`sql:db:grant`、`sql:db:seed`、`sql:smoke`、`sql:logs`、`sql:infra:drift`、`sql:infra:destroy`、`NOTES_DB=dsql` での `dev:sql` は未実行です。とくに次が確認待ちです。4 つの migration が DSQL に受け付けられること。`CREATE INDEX ASYNC` の応答から job の ID を読めて、`sys.jobs` で完了を待てること。`AWS IAM GRANT` と `GRANT` で `notes_api` が読み書きできること。`password` の関数で token が通ること。競合が node-postgres のエラーの `code` に `40001` として現れること。cdkd が Cloud Control API 経由で cluster を作り、`Ref` が identifier を返すこと。backup と restore。料金の DPU は仮定で、測っていません。RDS for PostgreSQL と Aurora Serverless v2 は、ドキュメントと Price List を読んだだけで、作っていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、どれを選ぶ？ | `examples/13-sql/infra/lib/sql-stack.ts` | `sql:infra:synth` |
| Aurora DSQL は PostgreSQL そのものではない | `examples/13-sql/src/migrate.ts`、`test/migrate.test.ts` | `test:unit` |
| schema と migration | `examples/13-sql/migrations/`、`src/migrate.ts`、`test/migrate.test.ts` | `test:unit`、`sql:db:migrate:local` |
| 行を型にする | `examples/13-sql/src/contract.ts`、`src/db.ts`、`src/notes-repository.ts`、`src/notes.ts`、`src/app.ts` | `test:unit` |
| transaction は丸ごとやり直す | `examples/13-sql/src/transaction.ts`、`src/notes-repository.ts`、`test/transaction.test.ts` | `test:unit` |
| 競合をわざと起こす | `examples/13-sql/test/support.ts`、`test/notes-repository.test.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/13-sql/src/pglite.ts`、`src/dev.ts`、`src/compose.ts`、`scripts/local-db.ts`、`scripts/db-tasks.ts`、`test/fixtures/seed-notes.json`、`.env.example` | `dev:sql`、`sql:db:migrate:local`、`sql:db:seed:local`、`sql:db:reset:local` |
| Lambda からつなぐ | `examples/13-sql/src/dsql.ts`、`src/lambda.ts`、`src/env.ts`、`src/grant.ts`、`infra/lib/sql-stack.ts`、`infra/bin/app.ts`、`infra/test/sql-stack.test.ts`、`cdk.json` | `sql:infra:synth`、`test:unit` |
| デプロイして、migration を流す | `examples/13-sql/scripts/cloud-db.ts`、`scripts/db-tasks.ts`、`scripts/smoke.ts`、`scripts/logs.ts`、`test/grant.test.ts` | `sql:infra:diff`、`sql:infra:deploy`、`sql:db:migrate`、`sql:db:grant`、`sql:db:seed`、`sql:smoke`、`sql:logs`、`sql:infra:drift` |
| 片付け | `tools/src/infra/`、`examples/13-sql/scripts/local-db.ts` | `sql:infra:destroy`、`sql:db:reset:local` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**cdkd が扱うリソースの種類。** 固定した版（0.296.28）の `src/provisioning/register-providers.ts` を見ると、`AWS::ApiGatewayV2::Api`、`Integration`、`Route`、`Stage`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::DSQL::Cluster` にはありません。Cloud Control API 経由です。同じ tag の `cc-protection-properties.ts` に、削除保護の property として `DeletionProtectionEnabled` が登録されています。

**一次情報**（確認日はすべて 2026-10-11）

- Aurora DSQL のユーザーガイド: [What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html)、[Migrating from PostgreSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html)、[Supported SQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html)、[CREATE TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html)、[ALTER TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html)、[CREATE INDEX](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-index-syntax-support.html)、[Asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html)、[DDL and distributed transactions](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html)、[Concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html)、[Foreign key constraints](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html)、[Primary keys](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-primary-keys.html)、[Sequences and identity columns](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-working-with.html)、[Quotas and limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html)、[Considerations](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/considerations.html)、[Release notes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/release-notes.html)
- 認証と接続: [Authentication and authorization](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/authentication-authorization.html)、[Generating an authentication token](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_authentication-token.html)、[Database roles and IAM authentication](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html)、[Connectors for Node.js](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html)、[Connector for node-postgres](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html)、[Cluster connectivity tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/aws-sdks.html)、[AWS PrivateLink](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/privatelink-managing-clusters.html)、[SSL/TLS certificates](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/configure-root-certificates.html)、[Troubleshooting](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/troubleshooting.html)、[aws-samples: Using AWS Lambda with Amazon Aurora DSQL](https://github.com/aws-samples/aurora-dsql-samples/blob/main/lambda/README.md)
- 運用と料金: [Cluster lifecycle](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/cluster-lifecycle.html)、[Backup and restore](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html)、[How billing works](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html)、[Aurora DSQL pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/)、AWS Price List bulk API: [Aurora DSQL](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AuroraDSQL/current/ap-northeast-1/index.json)、[RDS と Aurora](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json)
- インフラ: [AWS::DSQL::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義、[cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- RDS と Aurora: [Aurora Serverless の auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)、[How Aurora serverless works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html)、[RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html)、[Aurora の backup](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html)、[DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)、[RDS の storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)、[IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)、[RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)、[Point-in-time restore](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- PostgreSQL と npm: [PostgreSQL 16: Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html)、[pg 8.23.1](https://www.npmjs.com/package/pg/v/8.23.1)、[@aws-sdk/dsql-signer 3.1149.0](https://www.npmjs.com/package/@aws-sdk/dsql-signer/v/3.1149.0)、[@electric-sql/pglite 0.5.8](https://www.npmjs.com/package/@electric-sql/pglite/v/0.5.8)（PGlite はドキュメントを読んでおらず、動かして確かめたことだけを書いています）
- Cloudflare D1: [Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)、[Migrations](https://developers.cloudflare.com/d1/reference/migrations/)、[Global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)、[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)、[Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[Wrangler の d1 コマンド](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

:::
