---
title: "25 Events: 手元で動かす"
---

# 25 Events: 手元で動かす

## 手元で動かす

<!-- section: 25.local -->

[前のページ](/ja/chapters/25-events/build.md)で読んだコンシューマーを、AWS を使わずに動かします。EventBridge の代わりに、ルール、再試行、退避、archive、リプレイを持つ小さなバスをメモリの上に用意し、スタックと同じパターンをそこに載せます。

この章には、開発サーバーがありません。API は 08章のものをそのまま使っていて、手元の API にはイベントを作る stream が無いからです。かわりに、stream のレコードを順に流すスクリプトを用意しました。

```bash
vp run events:demo
```

次の出力は、2026-10-13 に手元で実行したものです。

```text
two notes created, one updated, each once    counter=2  naive=2  n1=NoteUpdated  dead letters=0
the creation of n2 published a second time   counter=2  naive=3  n1=NoteUpdated  dead letters=0
n2 deleted, delivered twice, in reverse      counter=1  naive=1  n1=NoteUpdated  dead letters=0
replay of 6 archived events                  counter=1  naive=3  n1=NoteUpdated  dead letters=0
rejection notices sent: 1, for one rejected attachment
One note exists (n1). The counter that remembers event IDs says 1.
```

`counter` がイベントの `id` を覚える実装で、`naive` が届いたら足すだけの実装です。1 行目では、どちらも 2 で合っています。2 行目で同じ作成が 2 回バスに載ると、`naive` だけが 3 になります。3 行目は、削除のイベントを逆順に 2 回ずつ届けたところです。`naive` が 1 に戻って正しく見えますが、余計に足した 1 と余計に引いた 1 が打ち消しただけです。4 行目でリプレイを流すと、`naive` は 3 になります。残っているノートは 1 件です。

Docker も、AWS の認証情報も要りません。

### バスの代わり

<<< @/examples/25-events/src/local-bus.ts{types}

<<< @/examples/25-events/src/local-bus.ts{rules}

ルールを足すときに、パターンを評価器に通します。評価器が実装していない演算子を使ったパターンは、ここで断られます。

<<< @/examples/25-events/src/local-bus.ts{put}

イベントを受け取ると、バスは自分の `id` と時刻を付け、archive のパターンに一致すれば保存し、一致したルールの数だけ配送を並べます。この時点では、何も届けません。

<<< @/examples/25-events/src/local-bus.ts{deliver}

届けるのは、呼び出した側です。`take` で待っている配送を受け取り、好きな順に `deliver` に渡します。同じ配送を 2 回渡せば、それが重複です。ターゲットが例外を投げた配送は、試した回数を 1 つ増やして並び直し、上限に達したら理由と一緒によけられます。

<<< @/examples/25-events/src/local-bus.ts{replay}

リプレイは、archive の中から時刻が幅に入るイベントを選び、`replay-name` を付けて、もう一度ルールと照合します。archive には入れ直しません。

<<< @/examples/25-events/src/local.ts{local}

コンシューマーは、Lambda で動くものと同じ関数です。違うのは、保存先がメモリの上にあることと、関数の前にあるのが EventBridge ではないことです。

このバスは、EventBridge の模擬ではありません。再現しないものを挙げておきます。

- EventBridge の配送そのもの。重複も順序の入れ替わりも、テストがわざと起こすもので、勝手には起きない
- イベントパターンの評価。手元の評価器は一部の演算子しか持たず、数値の比べ方が EventBridge と違う
- 再試行の間隔と、エラーの種類による扱いの違い。EventBridge は、権限が無いといったエラーを再試行せずによける
- input transformer。テンプレートの中身はスタックのテストで確かめているが、EventBridge が埋めた結果は見ていない
- Pipes。filter の評価、関数への渡し方、shard ごとの順序、再試行
- SNS。トピックから先の配送と、その再試行
- リプレイの速さと、1 分ごとの区切り。手元では、選んだイベントがすぐに全部並ぶ
- IAM。どのリソースポリシーも、ロールも

### テスト

```bash
vp run test:unit
```

テストは、同じ部品を、時計と ID を固定して組み立てています。stream のレコードは、手で書いた JSON ではなく、05章のノートと 08章の検査の記録の型から作る関数（`test/fixtures.ts`）で用意しました。形の出どころは Pipes のドキュメントにある例で、実際の stream から取ったものではありません。
