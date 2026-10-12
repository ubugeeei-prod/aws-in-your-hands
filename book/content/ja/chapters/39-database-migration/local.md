---
title: "39 Database Migration: 手元で動かす"
---

# 39 Database Migration: 手元で動かす

[前のページ](/ja/chapters/39-database-migration/build.md)で書いた切り替えの手順を、AWS につながずに手元で確かめます。認証情報は要らず、料金もかかりません。ただし、手元で動くのは DMS ではありません。

## この章のモデル

<!-- section: 39.local -->

DMS を手元で動かす方法はありません。代わりに、ドキュメントに書かれている動きを小さなコードにしたモデルを用意しました。モデルはこの章が書いたもので、DMS の実装とは関係がありません。モデルで通ったテストは、DMS がそう動く証拠にはなりません。確かめられるのは、ドキュメントの規則がなぜあるのかと、この章の手順とスクリプトが、その規則の下で正しく働くかです。

データベースは、13章と同じ PGlite を 2 つ、ソースとターゲットとして同じプロセスの中に立てます。PGlite は PostgreSQL そのものなので、外部キー、シーケンス、`session_replication_role`、読み取り専用のトランザクションは本物の動きをします。

変更の取り出しは、本物ではありません。PGlite は `wal_level` が `replica` で動いていて、ロジカルレプリケーションのスロットを作ろうとすると SQLSTATE 55000 で断られます。そこで、行ごとのトリガーで変更を表に書き出します。

<<< @/examples/39-database-migration/src/model/capture.ts{install}

トリガーは、主キーのあるテーブルでは変更前の行の主キーを記録し、主キーのないテーブルでは何も記録しません。PostgreSQL の既定の replica identity と同じ情報量にしてあります。WAL の量、スロットがディスクを埋める様子、トランザクションの境界は、このモデルにはありません。

full load は、テーブルを 1 つずつ丸ごと読んで書きます。

<<< @/examples/39-database-migration/src/model/replicate.ts{full-load}

テーブルの変更の取り込みは、そのテーブルを読み始める直前に始まります。「テーブルの full load が始まるまで、そのテーブルの変更は取り込まない」というドキュメントの記述に合わせました。取り込みの開始と読み取りの間に起きた変更は、写しにも変更の記録にも入ります。テストは、`beforeRead` と `afterRead` の 2 つのフックで、決まった位置に書き込みを差し込みます。

<<< @/examples/39-database-migration/src/model/replicate.ts{apply-one}

変更の適用は、DMS の既定のエラーの扱いに合わせてあります。すでにある行への `INSERT` は数えて先へ進み、主キーのないテーブルの `UPDATE` と `DELETE` は、探す手がかりがないので無視します。

<<< @/examples/39-database-migration/src/model/replicate.ts{apply}

どこまで適用したかの記録（チェックポイント）は、決まった件数ごとに進みます。テストは `crashAfter` で、適用はしたが記録する前に止まった状態を作ります。

## テスト

```bash
vp run test:unit
```

リポジトリ全体のテストが走ります。この章の分だけなら `vp test run examples/39-database-migration` です。

テストが見ているのは、移行で実際に困ることです。

- テーブルを写している間に変更された行と、削除された行。写しだけでは古いままで、変更を適用して初めてソースと一致する
- 写しと変更の記録の両方に入った変更。`INSERT` は重複として退けられ、`DELETE` は消す行が見つからないが、最後は一致する
- 再開による二重適用。5 件を適用した直後に止め、チェックポイントが進んでいない状態から再開しても、結果は同じになる
- 主キーのないテーブル。同じ再開で行が増え（ソース 3 行に対してターゲット 5 行）、`UPDATE` と `DELETE` は運ばれない
- 外部キー。子のテーブルを親より先に写しても、`session_replication_role = replica` の間は通り、戻した後は同じ `INSERT` が 23503 で断られる
- シーケンス。すべてのテーブルが一致していても、ターゲットへの最初の `INSERT` は 23505 でぶつかる。進めた後は、ソースの続きの番号になる。消された行の番号を出し直さない
- 比較が見るものと見ないもの。切り詰められた本文は見つける。インデックスと制約がないことは見つけない。書き込みが続いている間は、届いていないだけの変更を不一致と報告する
- 切り替えの後の 2 つの事故。ソースへの遅れた書き込みと、レプリケーションの再開による上書き
- テーブルマッピング、事前の検査、切り替えの判定、スタックのアサーション

## 通して動かす

```bash
vp run dbmig:demo
```

準備から切り替えまでを、2 つの PGlite の上で順に実行して表示します。次は、2026-10-13 に実行したときの出力です。

```text
1. preflight, on the source as found
   blocker public.owners: lob-primary-key
   note    public.notes: lob-column
   note    public.note_revisions: lob-column
   note    public.note_revisions: sequence
   blocker public.audit_log: no-primary-key
   note    public.audit_log: lob-column
2. sql/source/0002_prepare.sql, then preflight again
   blockers: 0
3. full load, while the application keeps writing (model, not AWS DMS)
   app.owners         source 1  target 1  match
   app.notes          source 1  target 2  DIFFER
   app.note_revisions source 2  target 2  match
   app.audit_log      source 1  target 1  match
   changes not applied yet: 2
4. apply the recorded changes
   applied 2, insert conflicts 0, missing rows 0
5. stop writes on the source, then compare
   a late write to the source: SQLSTATE 25006
   app.owners         source 1  target 1  match
   app.notes          source 1  target 1  match
   app.note_revisions source 2  target 2  match
   app.audit_log      source 1  target 1  match
6. the first insert on the target, before and after the sequences are advanced
   before: SQLSTATE 23505
   app.note_revisions_id_seq: source handed out 2, target holds 2, set to 2
   app.audit_log_id_seq: source handed out 1, target holds 1, set to 1
7. may we switch?
   yes
   after:  id 3
```

3 の時点で、ターゲットの `app.notes` は 2 行、ソースは 1 行です。写している間に、ソースで 1 行が更新され、1 行が削除されたからです。4 で変更を適用すると一致します。6 では、すべてが一致しているのに最初の `INSERT` が失敗し、シーケンスを進めた後の同じ `INSERT` が 3 番を受け取ります。

## 手元では確かめられないこと

手元のモデルにないものを挙げておきます。DMS の型の対応と LOB の扱い、データ検証と premigration assessment、スロットと WAL、ネットワークと IAM、遅れのメトリクス、Serverless の容量の増減、そして所要時間です。full load に何時間かかるか、切り替えの停止が何分になるかは、同じ大きさのデータで DMS を動かさないかぎりわかりません。

次は[デプロイ](/ja/chapters/39-database-migration/deploy.md)です。
