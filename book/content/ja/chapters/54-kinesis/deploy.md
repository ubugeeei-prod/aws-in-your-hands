---
title: "54 Kinesis: デプロイ"
---

# 54 Kinesis: デプロイ

このページの手順は、どれも実行していません。タスクとスクリプトは用意してあり、型検査とテンプレートの生成までは通っています。出力の説明は、スクリプトのコードから書いたものです。

デプロイした時点から、stream の料金が 1 時間ごとにかかります。試し終えたら、[費用のページ](/ja/chapters/54-kinesis/wrap.md)の手順で消してください。

## デプロイして確かめる

<!-- section: 54.deploy -->

```bash
vp run kinesis:infra:synth
vp run kinesis:infra:diff
vp run kinesis:infra:deploy -c alarmEmail=you@example.com
```

`synth` は手元でテンプレートを作るだけで、AWS には触りません。`diff` と `deploy` は、自分の認証情報と、`.env` の `AIH_AWS_ACCOUNT_ID` を使います。`alarmEmail` を渡すと、SNS から確認のメールが届きます。メールの中のリンクを開くまで、通知は届きません。

```bash
vp run kinesis:put
vp run kinesis:history
```

`kinesis:put` は、ノート `demo` の版 1〜5 を、自分の認証情報で stream に書きます。同じノートのリビジョンは 1 回のリクエストに 1 件なので、リクエストは 5 回です。

`kinesis:history` は、関数が履歴のテーブルに作ったアイテムを読みます。mapping が読み始めるまでに数分かかることがあるので、最初は何も出ないかもしれません。関数まで届いていれば、`version 5, from 5 revisions, missing 0` を含む行が出ます。

```bash
vp run kinesis:put
vp run kinesis:history
```

同じコマンドをもう一度実行すると、同じ版 1〜5 が、もう一度 stream に入ります。stream には 10 件のレコードがありますが、履歴は `version 5, from 5 revisions` のままになるはずです。関数のログには、`applied: 0` と `stale` の件数が出ます。

```bash
vp run kinesis:put -- --from 6 --count 3
vp run kinesis:history
vp run kinesis:infra:drift
```

続きの版を書くと、履歴は版 8 に進みます。最後の `drift` は、デプロイした実物と cdkd の state を比べます（20章）。

## 読み直しと、諦められた batch

<!-- section: 54.operate -->

### 2 つ目の読み手

```bash
vp run kinesis:replay
vp run kinesis:replay -- --since 2026-10-13T09:00:00Z
```

`kinesis:replay` は、stream に残っているレコードを最初から読み、関数と同じコードで、履歴を手元のメモリの上に作ります。AWS には何も書きません。関数の mapping が覚えている位置も動きません。読み手が位置を持つ、というのはこのことです。

出力は、読んだ件数、すでに適用済みだった件数、poison record の件数と、ノートごとの履歴です。先ほどの手順のあとなら、13 件を読み、5 件が適用済みで、`demo` は版 8、8 件になります。関数が作った履歴（`kinesis:history`）と同じになるはずです。

`--since` を付けると、その時刻より後のレコードだけを読みます。途中から読むので、ノートの版が 1 から始まらず、`missing` が 0 になりません。読み直しで履歴を作り直すなら、最初から読みます。

読み直せるのは、保持期間（24 時間）のあいだだけです。

### poison record を入れてみる

```bash
vp run kinesis:put -- --poison
vp run kinesis:put -- --note after --count 2
vp run kinesis:history -- --note after
vp run kinesis:failures
```

`--poison` は、JSON ではないレコードを 1 件書きます。続けて別のノートを書き、poison record の後ろに並んだレコードがどうなるかを見ます。

モデルのとおりに動けば、関数は poison record で 4 回失敗し、Lambda はその 1 件を諦めて先へ進みます。`after` の履歴は 2 版、2 件になります。諦めるまでにかかる時間は、計測していません。

`kinesis:failures` は、失敗のキューのメッセージを読み、そこに書かれた範囲のレコードを stream から読み戻して、何だったのかを表示します。範囲が 1 件で、中身が `the record's data is not JSON` なら、モデルと同じ動きです。

キューにメッセージがあるあいだ、`RecordsGivenUp` のアラームは鳴り続けます。中身を確かめたら、消します。

```bash
vp run kinesis:failures -- --delete
```

### 遅れを見る

コンシューマーの遅れは、CloudWatch の `AWS/Lambda` 名前空間にある `IteratorAge` に出ます。単位はミリ秒で、関数の名前ごとです。`ConsumerBehind` のアラームが見ているのは、この値の 5 分ごとの最大値です。

関数が呼ばれていないあいだ、このメトリクスにデータはありません。stream が空なのか、mapping が止まっているのかは、これだけでは区別できません。区別するには、stream の側の `GetRecords.IteratorAgeMilliseconds` と、mapping の状態（`aws lambda get-event-source-mapping`）を見ます。
