---
title: "26 Analytics: デプロイ"
---

# 26 Analytics: デプロイ

## デプロイして確かめる

<!-- section: 26.deploy -->

ここからは AWS にデプロイして、記録が S3 に届くことと、Athena で集計できることを実物で確かめます。ただし、この節の手順は、まだ実際の AWS で通せていません。

```bash
vp run analytics:infra:diff
vp run analytics:infra:deploy
```

データベースの名前 `aih_analytics` と、ワークグループの名前 `aih-analytics` は、スタックに固定で書いてあります。同じアカウントの同じリージョンに、同じ名前のものがすでにあると、作成に失敗します。

次に、リクエストを送ります。

```bash
vp run analytics:smoke
```

`analytics:smoke` は、ノートを 1 件作り、読み、更新し、古い版でもう一度更新して 409 を起こし、存在しないノートを読んで 404 を起こしてから、ノートを消します。

記録がバケットに現れるのは、バッファーの間隔が過ぎてからです。JSON のストリームでは 60 秒待ちます。そのあとでクエリを実行します。日付は UTC で指定します。

```bash
vp run analytics:query --name actions --from 2026-10-12 --to 2026-10-12
vp run analytics:query --name routes --from 2026-10-12 --to 2026-10-12
```

`analytics:query` は、SQL を表示してから Athena に渡し、終わるまで待って、結果の行と読んだバイト数を表示します。smoke の直後なら、`note_created`、`note_updated`、`update_conflicted`、`note_deleted` が 1 件ずつ返るはずです。読んだバイト数は数百バイトでも、課金は最低の 10 MB ぶんになります。

行が返らないときは、まずバケットの `requests_json/` にオブジェクトがあるかを見ます。オブジェクトがあるのに 0 件なら、テーブルの `storage.location.template` とオブジェクトのキーを見比べます。オブジェクトが無ければ、`errors/` と、Firehose のエラーのロググループを見ます。

Parquet で試すなら、形式を指定してデプロイし直します。

```bash
vp run analytics:infra:deploy -c format=parquet
```

ストリームとテーブルの設定が変わり、これ以降の記録は `requests_parquet/` に入ります。cdkd がこの変更をその場の更新として反映できるかは確かめていません。できなければ、スタックを消して作り直します。バッファーの間隔が 300 秒になるので、smoke のあと 5 分待ちます。それまでの JSON の記録は、新しいテーブルからは見えません。同じクエリを両方の形式で実行して、読んだバイト数を比べると、[前のページ](/ja/chapters/26-analytics/build.md)の手元での測定と突き合わせられます。

cdkd については、固定している版（0.296.28）のソースを読んで、リソースの種類ごとの扱いを確かめました。Firehose のストリーム、Glue のデータベースとテーブル、バケット、ロール、関数、API には専用の実装があります。Athena のワークグループと、Firehose のエラーを書くログストリームには専用の実装が無く、Cloud Control API 経由になります。この 2 つの種類が Cloud Control API の対応一覧にあるか、cdkd から実際に作れるかは未確認です。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run analytics:infra:drift
```
