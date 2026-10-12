---
title: "38 Data Movement: 手元で動かす"
---

# 38 Data Movement: 手元で動かす

## 手元で動かす

<!-- section: 38.local -->

このページのコマンドは、AWS のアカウントがなくても動きます。DataSync は呼びません。動くのは、[前のページ](/ja/chapters/38-data-movement/build.md)で書いた計画と実行のモデル、イベントの判断、スタックのテンプレートの検査です。

```bash
vp test run examples/38-data-movement
vp run move:demo
vp run move:infra:synth
```

1 行目はテストです。2 行目は、メモリ上の 2 つのバケットに対して、タスクを 4 回実行します。出力は次のとおりです。

```text
1. Four attachments, an empty archive. The execution stops after two copies.
  plan: transfer 4 (32 bytes), skip 0, delete 0
    new     u/alice/n1/a1
    new     u/alice/n1/a2
    new     u/alice/n1/a3
    new     u/alice/n1/a4
  run:  INTERRUPTED, copied 2, archive now holds 2

2. The next execution picks up where the first one stopped.
  plan: transfer 2 (16 bytes), skip 2, delete 0
    new     u/alice/n1/a3
    new     u/alice/n1/a4
  run:  SUCCESS, copied 2, archive now holds 4

3. One object replaced and one deleted in the source, one edited in the archive.
  plan: transfer 2 (26 bytes), skip 1, delete 0
    changed u/alice/n1/a1
    changed u/alice/n1/a2  <- the archive's copy is newer
  run:  SUCCESS, copied 2, archive now holds 4

4. Nothing has changed since.
  plan: transfer 0 (0 bytes), skip 3, delete 0
  run:  SUCCESS, copied 0, archive now holds 4

The archive still holds u/alice/n1/a4: the task keeps what the source deleted.
```

1 回目の実行は、2 つコピーしたところで止めています。2 回目の計画に出てくるのは、残りの 2 つだけです。3 回目では、ソースで 1 つを差し替え、1 つを消し、アーカイブ側で 1 つを直接書き換えました。差し替えた `a1` はコピーされ、アーカイブで書き換えた `a2` は、ソースの中身で上書きされます。消した `a4` は、アーカイブに残ります。4 回目は、することがありません。

`INTERRUPTED` は、このモデルが付けた名前です。DataSync のタスク実行の状態に、その名前はありません。

3 行目は、2 つのスタックのテンプレートを `examples/38-data-movement/cdk.out/` に書き出します。AWS には問い合わせません。タスクとルールと関数が入ったテンプレートを見たいときは、ロケーションの ARN の形をした値を渡します。

```bash
vp run move:infra:synth -c sourceLocation=arn:aws:datasync:ap-northeast-1:111122223333:location/loc-0b3017fc4ba4a2d8d
```

ARN の形をしていない値は、synth の段階で断られます。

### 手元では再現しないもの

再現しないものは、多くあります。DataSync が何を「違い」と判定するか、実行にかかる時間、転送の速さ、S3 に送られるリクエストの数、検証の実際の判定、ログの中身、EventBridge に届くイベントの実物は、どれもこのページのコマンドではわかりません。モデルが教えてくれるのは、ドキュメントに書かれた設定の意味を組み合わせると何が起きるか、までです。

テストが固定している不変条件は、次の 1 文です。**アーカイブにあるオブジェクトは、どれも、ソースがある時点で持っていた中身と 1 バイトも違わず、ソースが静かなあいだに 1 回の実行が成功すれば、コピーすべきものは残らない。** テストは、実行の途中でソースを書き換え、実行を途中で止め、アーカイブに直接書き込んで、この文を破ろうとします。

破れる場合が 1 つあります。アーカイブに直接書き込んだオブジェクトは、ソースが持っていた中身ではありません。次の実行が上書きするまで、不変条件の前半は成り立っていません。アーカイブに書いてよいのは DataSync のロールだけ、という決まりは、コードではなく権限で守ります。
