---
title: "43 Glue: 手元で動かす"
---

# 43 Glue: 手元で動かす

## 手元で動かす

<!-- section: 43.local -->

[前のページ](/ja/chapters/43-glue/build.md)で書いたもののうち、手元で動くのは TypeScript の側です。仕様の関数、フォルダーの置き方、ルールの評価、実行のモデルが動きます。Spark は動きません。Nix の shell に Spark も Python も入れていないので、`glue/curate.py` は手元では実行できません。

サンプルの生のファイルに仕様を当てて、ジョブが何を書くべきかを表示します。

```bash
vp run glue:spec
```

```text
raw: 11 objects
  requests_json/dt=2026-10-10/local-1-2026-10-10-00-00-02-000001.gz  5328 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-05-02-26-000002.gz  5238 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-10-04-50-000003.gz  5261 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-15-07-14-000004.gz  5198 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-20-09-38-000005.gz  5179 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-01-12-02-000006.gz  5239 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-06-14-26-000007.gz  5323 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-11-16-50-000008.gz  5258 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-16-19-14-000009.gz  5213 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-21-21-38-000010.gz  2841 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-00-20-00-000011.gz  195 bytes

2026-10-10: 817 records read from dt=2026-10-10, dt=2026-10-11
  401 rows to requests_curated/dt=2026-10-10/
  Passed  IsComplete "event_id"
  Passed  IsUnique "event_id"
  Passed  IsComplete "at"
  Passed  ColumnValues "v" = 1
  Passed  ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"]
  Passed  ColumnValues "status" between 99 and 600
  Passed  ColumnValues "duration_ms" >= 0

2026-10-11: 817 records read from dt=2026-10-10, dt=2026-10-11
  400 rows to requests_curated/dt=2026-10-11/
  Passed  IsComplete "event_id"
  Passed  IsUnique "event_id"
  Passed  IsComplete "at"
  Passed  ColumnValues "v" = 1
  Passed  ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"]
  Passed  ColumnValues "status" between 99 and 600
  Passed  ColumnValues "duration_ms" >= 0

the ruleset, as the job is given it:
Rules = [
    IsComplete "event_id",
    IsUnique "event_id",
    IsComplete "at",
    ColumnValues "v" = 1,
    ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"],
    ColumnValues "status" between 99 and 600,
    ColumnValues "duration_ms" >= 0
]
```

読み方は次のとおりです。生のファイルは 11 個で、5 番目のオブジェクトは 10 日の 20 時に開いて 11 日の 1 時に閉じたものです。10 日のフォルダーにありますが、11 日のリクエストも入っています。最後の 195 バイトのオブジェクトは、遅れて届いた 1 件です。

どちらの日も、前後 1 日のフォルダーから 817 件を読んでいます。800 件のリクエストに、2 回送られた 16 件と、遅れた 1 件を足した数です。前の日と次の日のフォルダーにはサンプルが無いので、2 つの日が読むファイルは同じになります。そこから 10 日には 401 行、11 日には 400 行が残ります。

`Passed` と表示しているのは、この章の関数です。AWS Glue Data Quality が同じ結果を出すことは、デプロイして確かめます。

列かルールを変えたときは、スクリプトの生成ブロックを書き直します。

```bash
vp run glue:contract
```

変更が無ければ `glue/curate.py was up to date` と表示され、ファイルは変わりません。

テストは、これまでの章と同じです。

```bash
vp run test:unit
```

この章のテストが確かめているのは、仕様の関数、読むフォルダーと書くフォルダー、作り直せる日の範囲、実行のモデルでの不変条件、DQDL の文字列とルールの評価、スクリプトに写した列とルール、料金の数量、Parquet から読み戻した行の比較、スタックの設定です。

手元で再現しないものを挙げます。Spark が JSON と Parquet をどう読み書きするか、Glue がジョブをどう起動するか、ロールの権限で足りるか、Data Quality の実物の評価、イベントとアラームは、どれも手元では動きません。Parquet の読み戻しのテストは、JavaScript のライブラリが書いたファイルを読んでいます。Spark が書いたファイルは、まだ読んだことがありません。
