---
title: "43 Glue: デプロイ"
---

# 43 Glue: デプロイ

## デプロイして確かめる

<!-- section: 43.deploy -->

ここからは AWS にデプロイして、ジョブを実際に動かします。このページの手順は、まだ実際の AWS で通せていません。Spark のスクリプトが初めて動くのは、ここです。

```bash
vp run glue:infra:diff
vp run glue:infra:deploy
```

データベースの名前 `aih_glue`、ジョブの名前 `aih-glue-curate`、トリガーの名前 `aih-glue-curate-daily`、ロググループの名前 `/aih/glue/curate/error` と `/aih/glue/curate/output` は、スタックに固定で書いてあります。同じアカウントの同じリージョンに同じ名前のものがあると、作成に失敗します。

デプロイしただけでは、何も動きません。バケットは空で、トリガーは有効になっていません。

サンプルの生のファイルをアップロードします。[前のページ](/ja/chapters/43-glue/local.md)の `glue:spec` が読んだのと同じ 11 個です。

```bash
vp run glue:seed
```

ジョブを、サンプルの 2 日を指定して実行します。ここから料金がかかります。1 回の実行で、最低 USD 0.0147 です。

```bash
vp run glue:run --days 2026-10-10,2026-10-11
```

`glue:run` は、実行を始めて 15 秒ごとに状態を見にいき、終わったら状態と実行時間を表示します。`SUCCEEDED` なら、`requests_curated/dt=2026-10-10/` と `requests_curated/dt=2026-10-11/` に Parquet のファイルができているはずです。

失敗したときは、表示されたエラーのほかに、ロググループ `/aih/glue/curate/error` を見ます。権限のエラーなら、拒否されたアクションをロールに足します。

次が、この章でいちばん大事な確認です。ジョブが書いた行を、仕様の関数の結果と比べます。

```bash
vp run glue:verify
```

`glue:verify` は、2 日ぶんの Parquet をダウンロードして読み、同じサンプルに `curate` を当てた結果と、`event_id` で突き合わせます。足りない行、余分な行、2 回ある行、値の違う行を数えます。どれも 0 件なら、その日について、スクリプトは仕様どおりに書いたことになります。

<<< @/examples/43-glue/src/compare.ts{compare}

読み戻した行は、26章のスキーマにも通します。列が 10 個あるだけでなく、1 行ずつがリクエストの記録として正しい形であることを確かめるためです。

<<< @/examples/43-glue/src/parquet.ts{read}

不変条件も、実物で確かめられます。同じ `glue:run` をもう一度実行し、`glue:verify` の結果が変わらないことを見ます。フォルダーの中のファイル名は変わりますが、行は同じはずです。

Athena から読むには、26章のワークグループか、自分のワークグループで、次のようなクエリを実行します。重複を除くための `DISTINCT` も、前後 1 日を読む条件も要りません。

```sql
SELECT action, count(*) AS events
FROM "aih_glue"."requests_curated"
WHERE dt = '2026-10-10' AND action IS NOT NULL
GROUP BY action
```

毎日の実行を有効にするなら、トリガーを始めます。有効にしているあいだ、毎日 1 回ぶんの料金がかかります。

```bash
aws glue start-trigger --name aih-glue-curate-daily
aws glue stop-trigger --name aih-glue-curate-daily
```

スタックをこれから作るなら、`vp run glue:infra:deploy -c schedule=on` でも有効になります。すでにあるトリガーには効きません。理由は[実装のページ](/ja/chapters/43-glue/build.md)に書きました。毎日の実行が読むのは昨日とおとといなので、サンプルの 2 日は対象になりません。実際の記録を流すには、26章のストリームの宛先をこのバケットにするか、26章のバケットをこのジョブの入力にします。どちらも、この章のスタックには入れていません。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run glue:infra:drift
```

固定している版の cdkd（0.296.28）には、このスタックが使う 13 種類のリソースすべてに専用の実装があります。インストールした版のソースを読んで確かめました。スクリプトのアセットは cdkd のアセット用のバケットに置かれ、テンプレートの中のバケット名は cdkd が書き換えます。これもソースから読み取ったことで、実際のデプロイでは確かめていません。
