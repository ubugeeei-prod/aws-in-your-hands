---
title: "16 Workflow: 手元で動かす"
---

# 16 Workflow: 手元で動かす

## 手元で動かす

<!-- section: 16.local -->

```bash
vp run export:local
vp run export:local --notes 450 --lose 2 --break 4
```

1 行目は、メモリ上の 250 件のノートを、デプロイするのと同じ定義で export します。2 行目は、わざと 2 つ壊します。`--lose 2` は、`ExportPages` の 2 回目の応答を捨てます。仕事は済んでいるのに、workflow には timeout に見える、という状況です。`--break 4` は、4 つ目の part の書き込みを 4 回続けて断ります。再試行が尽きて、実行が失敗します。そのあと、失敗した state から再開して、manifest の行数と、重複のないノートの件数が合っていることを確かめて終わります。

Docker も、AWS の認証情報も要りません。

### 定義を、そのまま歩く

<<< @/examples/16-long-jobs/src/local-workflow.ts{run}

<<< @/examples/16-long-jobs/src/local-workflow.ts{task}

Step Functions の代わりは、100 行ほどの関数です。ASL のうち、この章が使うものだけを知っています。`Task` の `Retry` と `Catch`、boolean を 1 つ見る `Choice`、`Succeed`、`Fail`。それだけです。

これを書いた理由は、定義の配線をテストしたかったからです。`Retry` の順番を間違えて `ExportCorrupt` が 3 回再試行される。`Catch` の行き先が違う。そういう誤りは、step の関数をいくら丁寧にテストしても見つかりません。

<<< @/examples/16-long-jobs/src/local.ts{local}

呼ばれる側は、Lambda の handler がやることから Lambda を抜いたものです。入力を schema に通して、step の関数を呼びます。

テストは、この実行器の上で、次を確かめています。

- 応答が失われた step が再試行されて、part が 2 重に書かれないこと
- 再試行が尽きると実行が失敗し、part が残り、失敗した state から再開できること
- 失敗した後で、最初から起動し直しても、同じ export ができること
- part が欠けていると、`Finish` は 1 回だけ試されて、`Discard` が走り、実行が `ExportDiscarded` で終わること
- `Discard` も、失敗すれば再試行されること

これは Step Functions の模擬ではありません。再現しないものを挙げておきます。

- 待つこと。再試行の間隔、`TimeoutSeconds`、実行全体の timeout は、どれも無視する。timeout は、テストが「timeout という名前のエラー」を投げて表している
- 状態の保存。実行器は 1 つの process の中の loop で、落ちれば全部消える
- ASL の残り。JSONPath、`Parameters`、`Map`、`Parallel`、`Wait`、JSONata。定義にそれらを書いても、ここでは動かない
- 入出力の 256 KiB の上限と、25,000 イベントの履歴の上限
- 関数の ARN を `Resource` に書いたときの、実際の入出力の形
- IAM、Scheduler、S3、DynamoDB

### テスト

```bash
vp run test:unit
```

durable function 版のテストも、ここで一緒に走ります。そちらは、SDK に付いてくる実行器を使っています。
