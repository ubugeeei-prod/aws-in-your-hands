---
title: "13 SQL: しくみと実装"
---

# 13 SQL: しくみと実装

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
