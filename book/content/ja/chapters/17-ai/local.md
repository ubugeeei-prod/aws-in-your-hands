---
title: "17 AI: 手元で動かす"
---

# 17 AI: 手元で動かす

## 手元で動かす

<!-- section: 17.local -->

`examples/17-ai/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/17-ai/.env.example

```bash
vp run dev:ai
```

<http://localhost:8788> で立ち上がります。別のターミナルから。

```bash
curl -s http://localhost:8788/health
curl -sN -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"release","body":"Finish the payment tests before Friday."}'
curl -s -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"","body":"x"}'
```

2 つ目で、`delta` が少しずつ流れて、最後に `done` が来ます。`-N` は、curl に溜め込まずに表示させるオプションです。

ここで大事な話をします。**API サーバーが手元で動いていることと、推論が手元で動いていることは、別の話です。**

<<< @/examples/17-ai/src/dev.ts{dev}

`AI_BACKEND=fixture` のとき、サーバーは用意しておいたイベントの列を再生します。AWS は呼びません。課金もされません。認証情報も要りません。

`AI_BACKEND=bedrock` に変えると、同じサーバーが、あなたの認証情報で本物の Bedrock を呼びます。サーバーは `localhost` にいますが、モデルは AWS の中で動いて、token の数だけ課金されます。Bedrock を手元で模擬するものは、付いてきません。

これは Workers AI も同じです。Cloudflare のドキュメントは、Workers AI は手元の開発でも常にあなたのアカウントにつないでモデルを動かし、利用料がかかる、と書いています。04章で触れた、手元の模擬につながる binding とは、ここが違います。

開発サーバーが `127.0.0.1` だけで待ち受けているのも、そのためです。`bedrock` のときにこのポートへ届く人は、あなたの料金で推論できてしまうので。

fixture は 5 種類あって、`AI_FIXTURE` で選べます。失敗する stream を、手元で好きなだけ眺められます。

```bash
AI_FIXTURE=truncated vp run dev:ai
```

これで同じ `curl` を打つと、`delta` が 3 つ来たあと、`done` ではなく `error`（`interrupted`）で終わります。

もう 1 つ、試してほしいことがあります。`complete` の fixture で `curl` を打って、流れている途中で Ctrl+C してみてください。サーバーの log に、`outcome` が `cancelled` の行が出ます。接続が切れたことをサーバーが知って、モデルへのリクエストを中止した、という記録です。

ただし、これは手元の話です。Lambda にのせると事情が変わります。あとで話しますね。

## テスト

<!-- section: 17.tests -->

```bash
vp run test:unit
```

モデルの出力は、呼ぶたびに変わります。それをテストの材料にすると、通ったり落ちたりするテストができあがります。なのでテストは、決まったイベントの列を流します。

<<< @/examples/17-ai/src/fixture-gateway.ts{fixture}

fixture はこういう JSON です。途中で切れる stream の例。

<<< @/examples/17-ai/fixtures/converse-stream/truncated.json

断っておくと、これは実際の推論から録ったものではありません。公式ドキュメントに載っている応答の形を見て、手で書きました。ファイルの `source` にもそう書いてあります。つまりこのテストが確かめているのは「ドキュメントどおりのイベントが来たら、このコードは正しく動く」まで。「Bedrock が本当にその形で返す」は確かめていません。

テストが見ているものを並べます。

| どこ | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| 中継 | `test/summarize.test.ts` | 完了、`maxTokens`、途中で切断、途中の throttling、再試行、cancel、締め切り | 実際のモデルが返すイベントの形 |
| アプリ | `test/app.test.ts` | 始まる前と後の失敗の返し方、入力の上限、切断したときの中止 | Lambda と function URL を通したときの動き |
| client | `test/client.test.ts` | どこで切れても「完了」と誤解しないこと | 本物のネットワーク |
| インフラ | `infra/test/ai-stack.test.ts` | 権限、URL の認証、timeout | AWS が template どおりに動くこと |

時計も乱数も使っていないので、「2 回 throttling されてから成功する」のような筋書きが、毎回同じ順序で再現できます。待ち時間は 199 ミリ秒と 399 ミリ秒。決まった値です。

実際のモデルを呼ぶ確認は、別のタスクに分けてあります。

```bash
vp run ai:test:live
```

これは課金されます。`check:all` からは呼ばれません。fixture では確かめられないこと、つまりモデル ID が通るか、権限が足りるか、本物のイベントが schema に合うか、を見るためのものです。さっき書いたとおり、まだ実行できていません。

## 途中で切れたら

<!-- section: 17.partial -->

stream は途中で切れます。モデルが止まることもあれば、Lambda が timeout することも、Wi-Fi が切れることもあります。

```figure
caption: stream が途中で切れると Lambda は error を送れるが、呼び出し元との間が切れると最後の event は届かない
type: sequence
actor bedrock: Bedrock
actor fn: Lambda
actor caller: caller
step bedrock --> fn: t1 messageStart
step fn -> fn: SSE の stream を開く
step bedrock --> fn: t2 delta "金曜の"
step fn --> caller: delta
note caller: "金曜の" を表示
step bedrock --> fn: t3 delta "リリース…"
step fn --> caller: delta
note caller: "金曜のリリース…" を表示
step bedrock --x fn: t4 接続が切れる
step fn --> caller: error: interrupted
note caller: 途中までの文 + "incomplete"
step fn --x caller: t4' または、呼び出し元の接続がここで切れる
note caller: 最後の event は何も届かない
```

t4 では、Lambda が `error` を送れます。でも t4' のように、Lambda と呼び出し元の間が切れたら、何も届きません。届かないものは検証できないので、client は「最後のイベントが来なかった」こと自体を失敗として扱います。

<<< @/examples/17-ai/src/client.ts{events}

サーバーが `done` も `error` も送らずに終わったら、client が自分で `error` を足します。これで、読む側から見た stream は、必ず `done` か `error` で終わります。

SSE を読む部分は短いので、自前です。

<<< @/examples/17-ai/src/client.ts{sse}

イベントとして数えるのは、区切りの空行まで届いたものだけ。`data:` の行が途中まで届いていても、使いません。

さて、切れたときに手元に残った文章をどうするか。決めないといけません。この章の答えはこうです。

<<< @/examples/17-ai/src/client.ts{collect}

**部分的な出力は、見せてもいいが、要約として保存しない。** `complete` になるのは、`done` を受け取って、しかも `complete` が `true` のときだけ。それ以外は全部 `incomplete` で、届いた分は `partial` に入ります。画面に「途中まで」と添えて出すのは構いません。でも、それをノートの要約として保存すると、次に開いたとき、文の途中で切れた要約が「完成品」として出てきます。どこで切れたのかは、もう誰にもわかりません。

invariant を 1 文で書くと、**`done` を受け取っていない出力は、完了した要約として扱われない**、です。

これを壊そうとするテストがあります。完了する応答のバイト列を、0 バイト目から最後の 1 バイト手前まで、1 バイトずつ切り詰めて client に読ませます。接続が静かに閉じた場合と、エラーで切れた場合の両方で。どこで切っても、結果は `incomplete`。そして `partial` は、必ず本物の文章の頭の部分になっています。

この章のサンプルは、要約を保存しません（保存先が 05章からなので）。保存を足すときは、`status` が `complete` の結果だけを書き込んでください。
