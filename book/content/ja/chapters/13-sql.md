---
title: "13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2"
revision: 5
---

# 13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2

D1 では、`CREATE TABLE` を書き、`wrangler d1 migrations apply` で適用し、Worker から SQL を投げます。この章では、同じ流れを AWS でたどります。

題材は [04章](/ja/chapters/04-http-api.md)のノートの API で、今度はノートを SQL のデータベースに保存します。スキーマを書き、マイグレーションを流し、型のついたクエリを書いて手元で動かし、最後に Lambda からつなぎます。データベースには Aurora DSQL を使い、RDS for PostgreSQL と Aurora Serverless v2 は、どこが違うかを表で比べるだけにします。

Aurora DSQL は PostgreSQL と互換ですが、PostgreSQL そのものではなく、D1 を分散させたものでもありません。この章は、D1 と似ているところから入り、違うところはそのつど理由を説明しながら進めます。

前提は 04章だけです。[05章](/ja/chapters/05-dynamodb.md)（DynamoDB）を読んでいなくても読めます。コードは `examples/13-sql/` にあります。

## 全体像

<!-- section: 13.architecture -->

```figure
caption: リクエストは API Gateway と Lambda 関数を通り、PostgreSQL の接続で Aurora DSQL のクラスターに届く
node client: Client | curl, あとで SPA
node api: API Gateway HTTP API | ap-northeast-1
node fn: Lambda function | Node.js 24, arm64, VPC の外
node db: Aurora DSQL クラスター | single-Region, ap-northeast-1
edge client -> api: HTTPS
edge api -> fn: GET /health, GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> db: PostgreSQL wire protocol over TLS, port 5432
mark db
```

```figure
caption: Lambda 関数は自分でクラスターに接続する。データベースロールは notes_api で、関数の中で作った IAM 署名付きのトークンをパスワードにする
node role: 実行ロール | このクラスターへの dsql:DbConnect, 自分のロググループ
node app: アプリ | src/app.ts
node svc: NoteService
node repo: SqlNoteRepository
node tx: transaction runner | SQLSTATE 40001 でやり直す
node db: database postgres | app: owners, notes / public: aih_migrations
edge app -> svc
edge svc -> repo
edge repo -> tx
edge tx -> db: user notes_api, パスワードはトークン
group fn: Lambda function = role, app, svc, repo, tx
group cl: Aurora DSQL cluster: データベースはこれ 1 つだけ = db
```

```figure
caption: 手元のマシンでは、同じアプリを PGlite の上で動かすか、admin としてクラスターにつないでマイグレーションを流す
node dev: vp run dev:sql | 同じアプリを動かす
node mig: vp run sql:db:migrate
node pglite: PGlite | Node プロセスの中の PostgreSQL
node db: Aurora DSQL クラスター
edge dev -> pglite
edge mig -> db: admin, 自分の IAM 認証情報
group laptop: 手元のマシン = dev, mig
```

04章の構成に足したのは、Lambda 関数の先のデータベース 1 つだけです。ノートは Lambda 関数のメモリではなくクラスターに置かれるので、どの実行環境が応答しても同じノートが返ります。

D1 に慣れていると、この構成には勝手の違うところが 3 つあります。

1 つ目は、bindingが無いことです。Worker では `env.DB` にデータベースが現れますが、ここでは 1 枚目の図の右端の矢印のとおり、Lambda 関数が自分で TCP の接続を張ります。接続先は環境変数で渡し、つないでよいかは IAM が決め、つないだあとに何ができるかはデータベースの中の権限が決めるので、設定は 3 か所に分かれます。

2 つ目は、パスワードが無いことです。Aurora DSQL には保存しておくパスワードがなく、接続するたびに、IAM の認証情報で署名した期限つきのトークンを作ってパスワードの欄に入れます。2 枚目の図で transaction runner からデータベースへ伸びる矢印が、この接続です。

3 つ目は、VPC が無いことです。クラスターのエンドポイントは公開の DNS 名で、TLS とトークンで守られているため、Lambda 関数を VPC に入れなくても届きます。RDS と Aurora はここが違い、次の節の表で比べます。

## 3 つの選択肢

<!-- section: 13.choices -->

AWS で PostgreSQL 系の SQL を使う方法は、大きく分けて 3 つあります。

| | Aurora DSQL | RDS for PostgreSQL | Aurora Serverless v2（PostgreSQL） |
| --- | --- | --- | --- |
| SQL | PostgreSQL 16 互換の一部。使えないものがある（次の節） | PostgreSQL そのもの | PostgreSQL 互換 |
| 最初に決めること | ほぼ無い。クラスターを作るだけ | インスタンスの大きさ、ストレージ、VPC とサブネット、パスワードの置き場所 | 容量の範囲（ACU）、VPC とサブネット、パスワードの置き場所 |
| 認証 | IAM のトークンだけ | パスワード。IAM のトークンも選べる | パスワード。IAM のトークンも選べる |
| つなぎ方 | 公開のエンドポイントへ TLS で。VPC は要らない | VPC の中から。Lambda 関数も VPC に入れる | VPC の中から。Data API なら VPC なしで HTTP |
| トランザクション | REPEATABLE READ に固定。ロックで待たず、コミットのときに競合を調べる | 既定は READ COMMITTED。ロックで待つ | 同左 |
| 1 トランザクションの上限 | 3,000 行、10 MiB、5 分 | この種の上限は無い | 同左 |
| 使っていないとき | DPU は 0。ストレージだけ | インスタンスが動いている間はずっと課金 | 最小 0 ACU なら止まる。ストレージは残る |

この章が Aurora DSQL を中心に据えたのは、D1 から来た人にとっていちばん入りやすいからです。置いてあるだけでかかる料金がほとんど無く、ネットワークを設計する必要もないので、04章の Lambda 関数にそのままつなげます。

一方で、DSQL が合わない場面もはっきりしています。

- PostgreSQL の機能がそのまま要る場合。トリガー、PL/pgSQL、拡張、一時テーブルを使うときや、手持ちの PostgreSQL のアプリや ORM を書き換えずに動かしたいときは、PostgreSQL そのものである RDS を選ぶのが素直です（Aurora がどこまで同じかは、この章では確かめていません）
- 1 つのトランザクションで大量の行を書く場合。3,000 行を超える一括更新や 5 分を超える処理は、分割できないかぎり DSQL には載りません
- 同じ行に書き込みが集中する場合。カウンターや在庫のような行を多くのトランザクションが同時に更新すると、DSQL は待たせる代わりに失敗させるので、再試行ばかりになります

RDS と Aurora を選ぶと、VPC が付いてきます。データベースのインスタンスは VPC の中に置くものなので、Lambda 関数も VPC に入れ、サブネットとセキュリティグループを用意することになります。VPC は [11章](/ja/chapters/11-network.md)で扱ったので、この章では作りません。

Aurora Serverless v2 が止まるのには条件があります。最小容量を 0 ACU にすると、利用者の接続が無い状態が一定時間（既定は 5 分、最長 1 日）続いたときにインスタンスが止まり、インスタンスの料金が 0 になります。ただし、接続が 1 本でも開いていれば止まりません。RDS Proxy を付けた場合も、proxy が接続を持ち続けるので止まりません。論理レプリケーションや zero-ETL を使っている場合も同じです。止まったあとの最初の接続は再開に 15 秒ほどかかり、24 時間を超えて止まっていた場合は 30 秒以上かかることがあります。止まっている間も、ストレージの料金は残ります。

Aurora には、HTTP で SQL を投げる Data API もあります。Data API を使えば Lambda 関数を VPC に入れずに済みますが、データベースの認証情報は Secrets Manager に置く作りになります。Data API を使えるリージョンとエンジンの版は、この章では確かめていません。

## Aurora DSQL と PostgreSQL の違い

<!-- section: 13.compat -->

DSQL は機能が増え続けているので、未対応の機能を並べた記事はすぐ古くなります。たとえば外部キーは 2026 年 8 月に、シーケンスと identity 列は 2026 年 2 月に入りました。以下は、この章を書いた日（2026-10-11）に公式ドキュメントを読んだ結果で、読む時期によっては変わっている可能性があります。

PostgreSQL と同じように使えるのは、`SELECT` の join、CTE、window 関数、`INSERT ... ON CONFLICT`、`CHECK`、`UNIQUE`、外部キー、ビュー、SQL で書いた関数、JSON と JSONB です。

次のものは、使えますが形が違います。

- インデックスは `CREATE INDEX ASYNC` で作ります。インデックスの作成は常に非同期で、`ASYNC` を付けない文は通りません。文はすぐにジョブの ID を返し、インデックスは裏で作られます
- 1 つのトランザクションに入れられる DDL は 1 文だけです。DDL と DML を同じトランザクションに入れることもできないので、テーブルを作って同じトランザクションで行を入れる、という書き方はできません
- テーブルを作ったあとで主キーを変えることも、足すこともできません
- `ALTER TABLE ... ADD COLUMN` で指定できるのは、列名と型だけです。対応している構文の一覧には、この形に制約や既定値を付ける書き方がありません。`SET NOT NULL` や列の型の変更も、一覧にありません
- シーケンスは `CACHE` の指定が必須で、値は 1 か、65536 以上です。公式ドキュメントは、ID には UUID を既定にするよう勧めています
- 分離レベルは REPEATABLE READ に固定で、変えられません

一時テーブル、トリガー、PL/pgSQL、`TRUNCATE` はありません。`TRUNCATE` の代わりには `DELETE FROM` を使います。データベースはクラスターに 1 つで、名前は `postgres` です。

手元の PostgreSQL では通った SQL が DSQL では通らないことを、デプロイしてから知るのは避けたいので、マイグレーションのファイルを文字列として調べる小さな検査を用意しました。

<<< @/examples/13-sql/src/migrate.ts{lint}

この検査が見ているのは、この章のマイグレーションが踏みそうな制約だけで、DSQL の制約すべてではありません。それでも、`ASYNC` を忘れたインデックスは `vp run test:unit` で落ちます。

### ORM とマイグレーションツール

この章は、素の SQL ファイルと、小さなマイグレーションのランナー、node-postgres（`pg`）で書いていて、重い ORM は使いません。

ORM を使わない理由の 1 つは、DDL は 1 文ずつ、インデックスは `ASYNC`、という上の制約に、一般的なマイグレーションツールの既定の動きが合わないことがあるからです。もう 1 つは、データベースに何が送られるかを、この章ではすべて見えるようにしておきたいからです。

node-postgres が DSQL で動く根拠は、公式ドキュメントにあります。AWS は node-postgres 用と Postgres.js 用の認証の connector を配っていて、Lambda から node-postgres でつなぐサンプルも載せています。この章のつなぎ方は、そのサンプルと同じ形です。ORM については、Drizzle 用の adapter と、Prisma、Sequelize、TypeORM のサンプルが一覧にあります。この章では、どれも動かしていません。
