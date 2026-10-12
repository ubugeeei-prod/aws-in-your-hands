---
title: "54 Kinesis: 手元で動かす"
---

# 54 Kinesis: 手元で動かす

[しくみと実装のページ](/ja/chapters/54-kinesis/build.md)で読んだ書く側と読む側を、AWS を使わずに動かします。Kinesis と Lambda の代わりに、メモリの上のモデルを 2 つ用意しました。stream のモデルと、event source mapping のモデルです。どちらも公式ドキュメントに書いてある規則だけを実装したもので、実物ではありません。

## 手元のモデル

<!-- section: 54.local -->

### stream のモデル

<<< @/examples/54-kinesis/src/local-stream.ts{types}

stream のモデルが実装しているのは、次の規則です。

- shard はハッシュの範囲を受け持ち、partition key の MD5 でレコードの入る shard が決まる
- レコードは shard の中に届いた順に並び、shard の中で増えていく sequence number が付く
- 読んでも消えない。保持期間（24 時間）を過ぎたレコードは読めなくなる
- 読む位置は `TRIM_HORIZON`、`LATEST`、`AT_TIMESTAMP`、`AT_SEQUENCE_NUMBER`、`AFTER_SEQUENCE_NUMBER` で指定する
- shard は、1 秒に 1,000 件または 1 MiB までしか書き込みを受け付けない
- PutRecords は 1 件ごとに受け付けるか断るかを決め、断った 1 件の後ろも処理する
- shard を split すると親は閉じられ、中のレコードは残り、新しいレコードは子に入る

<<< @/examples/54-kinesis/src/local-stream.ts{put}

モデルが自分で決めたところもあります。書き込みの上限を、時計の 1 秒ごとに区切って数えること。sequence number の増え方。どちらも、ドキュメントには書かれていません。

実装していないものもあります。merge、GetRecords の回数と帯域の上限、iterator の有効期限（5 分）、レコードの大きさの上限、暗号化です。

<<< @/examples/54-kinesis/src/local-stream.ts{read}

読む操作は、位置と件数を受け取り、レコードと次の位置を返します。読んだことを stream は覚えません。閉じた shard を最後まで読むと、次の位置は返りません。

### event source mapping のモデル

<<< @/examples/54-kinesis/src/local-poller.ts{settings}

mapping のモデルは、Lambda のドキュメントに書かれている動きをなぞります。

- shard ごとに batch を 1 つずつ読み、関数を呼ぶ
- 関数が失敗したら、同じ batch をもう一度渡す。成功するまで、その shard の続きは読まない
- `reportBatchItemFailures` が有効なら、返された sequence number のうちいちばん小さいものの手前までを済んだものとして扱う。無効なら、返された失敗を見ずに成功として扱う
- `bisectBatchOnFunctionError` が有効なら、失敗した batch を 2 つに割る。割ることは再試行に数えない
- 再試行が尽きるか、レコードが古くなりすぎたら、その batch を諦め、ドキュメントの例と同じ形の記録を残す

<<< @/examples/54-kinesis/src/local-poller.ts{poll}

ドキュメントから読み取れず、モデルが自分で決めたことが 2 つあります。1 つは、partial batch response で batch の前半が済んだとき、残りの再試行を 0 回から数え直すこと。もう 1 つは、split のあと、親の shard を読み切ってから子を読むことです。実物がそう動くかどうかは確かめていません。コードのその場所にも、同じ断り書きを入れてあります。

時計は引数で渡します。テストは時間を自分で進めるので、「6 時間経った」も「1 秒に 1,200 件書いた」も、待たずに再現できます。

<<< @/examples/54-kinesis/src/local.ts{local}

`createLocal` は、stream と時計と、コンシューマーを作る関数を返します。コンシューマーが使うハンドラーは、スタックがデプロイするのと同じコードです。差し替えているのは、履歴の保存先（メモリ）と、関数を呼ぶ側（モデル）だけです。

### デモ

```bash
vp run kinesis:demo
```

この章で扱う失敗を、4 つの場面にして順に流します。次は、2026-10-13 に実行したときの出力です。

```text
1. Five revisions of a note, and a function that fails after doing its work
   compares versions before it writes                version 5, from 5 revisions
   applies whatever arrives                          version 5, from 10 revisions

2. a@1 a@2 <poison> b@1 b@2 in one shard
   Lambda's defaults, after 500 tries                nothing applied for b: the shard is stuck
   the stack's settings                              version 2, from 2 revisions for b; given up on: 1 batch of 1 record

3. Two revisions in one PutRecords request, and the first is refused once
   refused entries sent again                        version 2, from 1 revisions
   one revision of a note per request                version 2, from 2 revisions

4. A second consumer, added an hour later, reads from the oldest record
   the first consumer                                version 3, from 3 revisions
   the second consumer                               version 3, from 3 revisions
```

`version` と `revisions` が同じなら、そのノートのリビジョンは順に 1 回ずつ適用されています。1 つ目の場面の 2 行目は 5 版なのに 10 件、3 つ目の場面の 1 行目は 2 版なのに 1 件で、どちらも不変条件が壊れています。

## 不変条件を壊すテスト

<!-- section: 54.failures -->

```bash
vp test run examples/54-kinesis
```

不変条件は、「ノートごとに、すべてのリビジョンが順に 1 回ずつ適用される」です。テストは、これを壊す出来事を決まった順序で起こし、守れる作りと守れない作りを並べて確かめます。

### 失敗した batch の再配送

<<< @/examples/54-kinesis/test/poller.test.ts{duplicates}

関数が 5 件を適用し終えたあとで、応答が Lambda に届かなかった場合です。タイムアウトがこれに当たります。Lambda から見れば失敗なので、同じ 5 件がもう一度届きます。

版を比べるコンシューマーは、2 回目の 5 件をすべて「古い」として通しません。履歴は 5 版、5 件のままです。届いたものをそのまま適用するコンシューマーは、同じノートを 10 件から作ったことになります。

1 つ目のテストで最初の結果が `split` になっているのは、スタックの設定では、失敗した batch が 2 つに割られるからです。割られた 3 件と 2 件が、それぞれもう一度届いています。

### poison record

同じ並び（a の 2 件、poison record、b の 2 件）を、設定を変えた 4 つの mapping に読ませます。

Lambda の既定値では、shard が止まります。テストは 1 時間ぶん時計を進めながら読ませ、後ろのレコードが 1 件も適用されないこと、別の shard は進むこと、iterator age がアラームのしきい値を超えることを確かめます。

再試行の回数だけを決めた mapping は、4 回試したあと、batch を丸ごと諦めます。poison record と同じ batch にいた b の 2 件も、一緒に捨てられます。

関数が失敗を返しているのに `reportBatchItemFailures` を有効にしていない mapping は、何も起きなかったかのように先へ進みます。b は適用されず、失敗の記録も残りません。4 つの中で、これがいちばん見つけにくい壊れ方です。

<<< @/examples/54-kinesis/test/poller.test.ts{poison}

スタックの設定では、諦められるのは poison record の 1 件だけです。a も b も 2 件ずつ適用され、失敗の記録は、最初と最後の sequence number が同じ、1 件の範囲を指します。

### 順序を入れ替える書き方

<<< @/examples/54-kinesis/test/producer.test.ts{reorder}

stream のモデルに、次の PutRecords の 1 件目だけを断らせます。断られたものを送り直す書き方では、stream に版 2、版 1 の順で入ります。読む側は巻き戻らないので、版 1 は捨てられ、履歴は「2 版、1 件」になります。ノートごとに 1 件ずつ送る書き方では、同じ断られ方をしても順序が保たれます。

### hot key

<<< @/examples/54-kinesis/test/stream.test.ts{hot-key}

shard が 2 つある stream で、1 つのノートに 1 秒で 1,200 件を書きます。1,000 件を超えた 200 件が断られます。そのあいだ、もう一方の shard は 1 件も受け取っていません。stream 全体では容量の半分しか使っていないのに断られる、というのが hot key です。

### shard の split

<<< @/examples/54-kinesis/test/poller.test.ts{split}

版 1〜3 を書いてから shard を split し、版 4 と 5 を書きます。親を読み切ってから子を読めば、5 件が順に適用されます。子を先に読むと、履歴は版 5 まで進んだあと、親の 3 件をすべて「古い」として捨てます。巻き戻りはしませんが、3 件が欠けます。

### 手元では分からないこと

テストが確かめているのは、ハンドラー、書く側、履歴の条件が、ドキュメントどおりに動く stream と mapping の上で不変条件を守ることです。実物の Kinesis と Lambda がドキュメントどおりに動くことは、確かめていません。遅延、スループット、iterator age のメトリクスの出方、実際に SQS に届く記録の形も、手元では分かりません。
