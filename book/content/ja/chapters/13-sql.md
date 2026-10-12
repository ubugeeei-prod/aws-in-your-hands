---
title: "13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2"
revision: 3
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
