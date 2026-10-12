---
title: "66 Distributed SQL: 手元で動かす"
---

# 66 Distributed SQL: 手元で動かす

[前のページ](/ja/chapters/66-distributed-sql/build.md)で実装を見ました。このページでは、AWS に何も作らずに確かめられることを、軽いものから順に実行します。最後は、手元の Mac で 3 ノードのクラスターを動かし、ノードを落とします。認証情報は要らず、AWS の料金もかかりません。

## バイナリなしで確かめられること

<!-- section: 66.local-tests -->

次の 4 つは、YugabyteDB を取得しなくても動きます。

```bash
vp test run examples/66-distributed-sql
vp run distsql:render
vp run distsql:infra:synth
vp run distsql:infra:synth -c nodes=3
```

テストが見ているのは、クラスターの定義からフラグファイルが正しく作られること、接続先の切り替え、過半数のモデル、13章の再試行ループに YugabyteDB のエラーを渡したときの動き、ノードに置くファイル、料金の計算、スタックの中身です。

このテストが見ていないことも、はっきりさせておきます。repository のテストが使うのは PGlite で、セッションは 1 つしかなく、本物の競合は起きません。YugabyteDB のエラーは、手元のクラスターが返したものを写して差し込んでいます。過半数のテストが動かすのはこの章のモデルで、データベースではありません。本物がどう振る舞ったかは、このページの残りで確かめます。

## バイナリを取得する

<!-- section: 66.local-fetch -->

```bash
vp run distsql:fetch
```

このタスクは、固定した版のアーカイブを配布元（`software.yugabyte.com`）から取得し、大きさと SHA-256 が `src/yugabyte.ts` の値と一致したときだけ、`examples/66-distributed-sql/.yugabyte/` に展開します。このディレクトリは git に入りません。何も起動しません。

<<< @/examples/66-distributed-sql/scripts/fetch.ts{verify}

アーカイブは 130 MB で、展開すると 410 MB ほどになります。対応しているのは、Apple シリコンの macOS と、arm64 の Linux です。Nix の flake にパッケージを足していないので、ほかの章の環境には影響しません。

YugabyteDB の文書は、手元で動かす道具として `yugabyted` を勧めています。`yugabyted` は Python 3.11 を必要とし、Nix の shell には Python がないので、この章では使いません。代わりに、`yb-master` と `yb-tserver` を直接起動します。EC2 の上でも同じ 2 つを直接起動するので、手元と本番で、起動のしかたが揃います。

## 3 ノードを起動する

<!-- section: 66.local-cluster -->

```bash
vp run distsql:local:start
vp run distsql:local:status
```

`start` は、3 台分の `yb-master` と `yb-tserver` を、切り離したプロセスとして起動します。待ち受けるのは `127.0.0.1` だけで、ポートは 23001 から 29103 の範囲です。最初の起動は、SQL を受け付けるまでに時間がかかります。この章の検証では、40 秒から 50 秒待ってから次へ進みました。

<<< @/examples/66-distributed-sql/scripts/local-nodes.ts{start}

起動に使うフラグファイルは、EC2 用と同じ関数が作ります。`.yugabyte/run/node-a/tserver.conf` を開くと、中身を読めます。

1 つ注意があります。`yb-tserver` は内部で PostgreSQL を起動し、PostgreSQL は System V の共有メモリを使います。共有メモリを使わせないサンドボックスの中では、`initdb` が失敗して `yb-tserver` が終了しました。ふつうの端末では起きません。

TLS を有効にしたクラスターも作れます。証明書は `openssl` で作るので、PATH に `openssl` が要ります。Nix の shell には入っていないので、macOS に付属のものか、自分で入れたものが使われます。

```bash
vp run distsql:local:destroy
vp run distsql:local:certs
vp run distsql:local:start --tls
```

TLS の有無は、クラスターを作るときに決まります。途中で切り替えることはできないので、先に `destroy` で消しています。

## 落として確かめる

<!-- section: 66.local-verify -->

```bash
vp run distsql:local:verify
```

このタスクは、起動しているクラスターに対して、この章の主張を順に試します。途中でノードのプロセスを SIGKILL で落とし、起こし直します。次は、TLS なしのクラスターで実行したときの出力です（2026-10-13、macOS 26.6、Apple シリコン）。

```text
-- chapter 13's migrations and repository, unchanged
    PostgreSQL 15.12-YB-2025.2.7.0-b0 on aarch64-apple-darwin24.6.0, compiled by Apple clang version 17.0.0 (clang-1700.6.4.2), 64-bit
ok    three tablet servers, one per zone
    applied now: 4 of 4
ok    create
ok    create again with the same id leaves one note
ok    update moves the version from 1 to 2
ok    an update from a stale version is a conflict, not a write

-- a quota of 3, and 12 creates at once through three nodes
    created 3, quota_exceeded 9, gave up after 4 attempts 0, retries after SQLSTATE 40001: 4
ok    the quota held: note_count and the rows agree, and neither passed 3  (note_count 3, rows 3)
ok    every acknowledged create is stored
ok    at least one transaction lost a commit and was retried

-- one node lost
node b: yb-tserver (pid 67615) got SIGKILL
node b: yb-master (pid 67612) got SIGKILL
    20 more creates took 948 ms; errors that were retried with the same id: 0; connections refused by the dead node: 1
ok    node a serves all 40 acknowledged notes with b down
ok    node c serves all 40 acknowledged notes with b down
node b: yb-master started, pid 70699
node b: yb-tserver started, pid 70700
    node b accepted SQL again after 2155 ms
ok    node b, back, answers with the notes written while it was down
    the masters reported no dead node and no under-replicated tablet after 26 ms

-- two nodes lost
node b: yb-tserver (pid 70700) got SIGKILL
node b: yb-master (pid 70699) got SIGKILL
node c: yb-tserver (pid 67616) got SIGKILL
node c: yb-master (pid 67613) got SIGKILL
    a create through the one node left: error: No node accepted a connection: 127.0.0.1:25431 (timeout expired)
ok    one node of three does not acknowledge a write
node b: yb-master started, pid 72197
node b: yb-tserver started, pid 72198
node c: yb-master started, pid 72199
node c: yb-tserver started, pid 72200
ok    with the majority back, every acknowledged note is still there  (40 acknowledged, 40 stored)
    the create that was never acknowledged is not stored

-- a logical backup, restored into a second database
ok    the restored copy holds every acknowledged note  (40 rows of this owner)

all checks passed
```

最初の段は、13章のコードがそのまま動くことの確認です。マイグレーションの 4 つのファイルは、PGlite のときと同じ `postgres` の方言で流しました。Aurora DSQL だけの `CREATE INDEX ASYNC` から `ASYNC` を外す処理は、13章のランナーがもともと持っています。

<<< @/examples/66-distributed-sql/scripts/verify.ts{same-code}

2 つ目の段が、競合の確認です。ノートの上限を 3 件にして、同じ持ち主の作成を 12 件、3 つのノードへ同時に送ります。13章の repository は、作成のたびに持ち主の行の `note_count` を更新するので、同時の作成は必ず同じ行でぶつかります。

<<< @/examples/66-distributed-sql/scripts/verify.ts{conflict}

作成できたのは 3 件で、`note_count` と実際の行数は 3 で一致しました。その間に、`40001` を受けて最初からやり直したトランザクションが 4 回ありました。この回数は実行のたびに違い、7 回の実行で 4 回から 29 回でした。4 回の試行で諦めたトランザクションは、どの回にもありませんでした。

3 つ目の段で、ノード b を落とします。`yb-tserver` と `yb-master` の両方に SIGKILL を送るので、ノードには後始末をする機会がありません。

<<< @/examples/66-distributed-sql/scripts/verify.ts{one-node}

落とす前に確認が返っていた 20 件に続けて、さらに 20 件を作成します。この回は 948 ミリ秒で終わり、エラーは 1 つも呼び出し元に届きませんでした。死んだノードへの接続が 1 回断られ、クライアントは次のノードへ進んでいます。別の回では、同じ 20 件に 4.3 秒かかりました。落としたノードがリーダーだった tablet で、新しいリーダーが選ばれるのを待った時間だと考えていますが、内訳は調べていません。

ノード a と c は、それぞれ単独で、確認済みの 40 件をすべて返しました。b を起こし直すと、2 秒ほどで SQL を受け付け、b に接続しても 40 件が返りました。ただし、どのノードも tablet のリーダーに聞いて答えるので、この結果だけでは b 自身の写しが追いついたとは言えません。`yb-master` の `/api/v1/health-check` は、死んだノードも写しの足りない tablet も無いと答えました。b が止まっていた数秒のあいだに、この応答が「足りない」と変わっていたかどうかは、見ていません。

4 つ目の段で、b と c の 2 台を落とします。

<<< @/examples/66-distributed-sql/scripts/verify.ts{two-nodes}

残った 1 台は、書き込みを確認しませんでした。この回は接続の段階でタイムアウトし、別の回では、接続はできたものの 20 秒たっても応答がありませんでした。間違った答えを返すのではなく、答えないという動きです。2 台を起こし直すと、確認済みの 40 件はすべて残っていました。

確認されなかった 1 件は、この回は入っていませんでした。7 回の実行のうち 3 回は、戻したあとに入っていました。応答を受け取っていない書き込みについて、クライアントは何も仮定できません。同じ ID で送り直せば 1 件になる、という 13章の作りが、ここで効きます。

最後の段は、バックアップです。

<<< @/examples/66-distributed-sql/scripts/verify.ts{dump}

`ysql_dump` でデータベース全体を SQL のファイルに書き出し、新しいデータベースに `ysqlsh` で流し込んで、確認済みのノートが揃っていることを見ます。この段には再試行が入っています。TLS ありの実行のうち 1 回で、2 台を起こし直した直後の `CREATE DATABASE` が `current transaction is expired or aborted` で失敗したからです。過半数が戻った直後は、まだ落ち着いていない時間があります。書き出しは読むだけで、流し込みは毎回新しいデータベースに入れるので、この段はやり直しても安全です。

TLS を有効にしたクラスターでも、同じ検証を実行しました。違いは 2 つで、TLS を使わないクライアントの接続が断られることと、`yb-admin` が `--certs_dir_name` なしではリーダーを見つけられないことです。

終わったら、クラスターを止めて消します。

```bash
vp run distsql:local:destroy
```

`.yugabyte/run/` が消え、プロセスが残っていないことを `vp run distsql:local:status` で確かめられます。取得したアーカイブとバイナリ（540 MB ほど）は `.yugabyte/` に残ります。要らなくなったら、ディレクトリごと消してください。

手元で確かめられないことも残ります。3 つのプロセスは同じマシンの同じ時計で動いているので、時計のずれは起きません。ノードのあいだのネットワークは loopback で、遅延も、片方向だけ切れる障害もありません。ディスクは 1 つで、ノードごとに壊れることもありません。Linux 用のバイナリは、一度も動かしていません。
