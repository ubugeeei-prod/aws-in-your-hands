---
title: "49 Athena: デプロイ"
---

# 49 Athena: デプロイ

## デプロイして確かめる

<!-- section: 49.deploy -->

ここからは AWS にデプロイして、[手元で表示した文](/ja/chapters/49-athena/local.md)を Athena で実行します。ただし、このページの手順は、まだ実際の AWS で通せていません。SQL が受け付けられるかどうかも含めて、ここで初めて確かめることになります。

先に、26章のスタックをデプロイして、記録を何件か入れておきます。この章のスタックには、26章のバケットの名前を渡します。名前は 26章のスタックの出力 `LakeBucketName` です。

```bash
vp run analytics:infra:deploy
vp run analytics:smoke
vp run athena:infra:diff -c lakeBucketName=<LakeBucketName>
vp run athena:infra:deploy -c lakeBucketName=<LakeBucketName>
```

ワークグループの名前 `aih-athena` は、スタックに固定で書いてあります。同じアカウントの同じリージョンに同じ名前のワークグループがあると、作成に失敗します。

26章のバッファーの間隔（60 秒）が過ぎたら、パラメーター付きのクエリを実行します。日付は UTC です。

```bash
vp run athena:run --name route --from 2026-10-13 --to 2026-10-13 --route /notes
```

`athena:run` は、文とパラメーターを表示してから Athena に渡し、最長で 2 分待って、行と読んだバイト数を表示します。2 分で終わらなければ、クエリを止めてから終了します。smoke の直後なら、`/notes` には 201 が 1 件あるはずです。読んだバイト数は数百バイトでも、課金は最低の 10 MB ぶんになります。

同じクエリを、結果の再利用を許してもう一度実行します。

```bash
vp run athena:run --name route --from 2026-10-13 --to 2026-10-13 --route /notes --reuse 60
```

前の結果が使われれば、`A stored result was reused` と表示されるはずです。

次に、派生テーブルを作ります。DDL は 1 回だけ実行します。

```bash
vp run athena:run --name create-compact
vp run athena:run --name compact --from 2026-10-13 --to 2026-10-13
vp run athena:run --name create-iceberg
vp run athena:run --name merge --from 2026-10-13 --to 2026-10-13
vp run athena:run --name merge --from 2026-10-13 --to 2026-10-13
```

`merge` を 2 回実行しているのは、2 回目で行が増えないことを確かめるためです。`compact` は、2 回実行すると行が 2 倍になります。試すなら、そうなることを見るために実行してください。

上限が効くことは、記録が 1 GiB を超えるまで確かめられません。練習の規模では届かないので、確かめるなら、ワークグループの上限を一時的に 10 MB に下げて、数日ぶんを読むクエリを実行します。

保存したクエリは、Athena のコンソールでワークグループを `aih-athena` に切り替えると見えるはずです。コンソールの画面は確認していません。

デプロイしたものと定義が食い違っていないかは、ほかの章と同じように確かめます。

```bash
vp run athena:infra:drift
```
