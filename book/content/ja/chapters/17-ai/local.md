---
title: "17 AI: 手元で動かす"
---

# 17 AI: 手元で動かす

[しくみと実装](/ja/chapters/17-ai/build.md)で作った API を手元で起動し、テストを実行します。そのあとで、ストリームが途中で切れたときにクライアントがどうするかを決めます。

## 手元で動かす

<!-- section: 17.local -->

`examples/17-ai/.env.example` を、同じディレクトリに `.env` という名前でコピーします。

<<< @/examples/17-ai/.env.example

```bash
vp run dev:ai
```

開発サーバーは <http://localhost:8788> で起動します。別のターミナルから、次の 3 つを実行します。

```bash
curl -s http://localhost:8788/health
curl -sN -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"release","body":"Finish the payment tests before Friday."}'
curl -s -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"","body":"x"}'
```

2 つ目の `curl` では、`delta` が少しずつ届き、最後に `done` が届きます。`-N` は、出力を溜めずにすぐ表示させる curl のオプションです。

ここで区別しておきたいのは、**API サーバーが手元で動いていることと、推論が手元で動いていることは別だ**という点です。

<<< @/examples/17-ai/src/dev.ts{dev}

`AI_BACKEND=fixture` のとき、サーバーは、用意してあるイベントの列（フィクスチャ）を再生します。AWS は呼ばないので、課金はなく、認証情報も要りません。

`AI_BACKEND=bedrock` に変えると、同じサーバーが、あなたの認証情報で本物の Bedrock を呼びます。サーバーは `localhost` で動いていても、モデルは AWS の中で動き、トークンの数に応じて課金されます。Bedrock を手元で模擬するものは、付属していません。

この点は Workers AI も同じです。Cloudflare のドキュメントには、Workers AI は手元の開発でも常にあなたのアカウントに接続してモデルを動かし、利用料がかかると書かれています。04章で触れた、手元の模擬につながる binding とは、ここが違います。

開発サーバーが `127.0.0.1` だけで待ち受けるのも、同じ理由からです。`AI_BACKEND=bedrock` のときにこのポートへ届く人は、あなたの料金で推論できてしまいます。

フィクスチャは 5 種類あり、`AI_FIXTURE` で選べます。失敗するストリームも、手元で何度でも再生できます。

```bash
AI_FIXTURE=truncated vp run dev:ai
```

この状態で同じ `curl` を実行すると、`delta` が 3 つ届いたあと、`done` ではなく `error`（`interrupted`）で終わります。

切断も試せます。`complete` のフィクスチャで `curl` を実行し、流れている途中で Ctrl+C を押すと、サーバーのログに、`outcome` が `cancelled` の行が出ます。04章の `nodeServer` が接続の切れたことに気づいて本文を読むのをやめ、アプリがそれを受けてモデルへのリクエストを中止した記録です。

ただし、切断でリクエストが中止されるのは、手元の開発サーバーでの動作です。Lambda の上では動作が違い、[デプロイのページ](/ja/chapters/17-ai/deploy.md)で説明します。

## テスト

<!-- section: 17.tests -->

```bash
vp run test:unit
```

モデルの出力は呼ぶたびに変わるので、テストの材料にすると、通ったり落ちたりするテストになります。そこでテストでは、決まったイベントの列を流します。

<<< @/examples/17-ai/src/fixture-gateway.ts{fixture}

フィクスチャは次のような JSON です。これは、途中で切れるストリームの例です。

<<< @/examples/17-ai/fixtures/converse-stream/truncated.json

このフィクスチャは、実際の推論から記録したものではありません。公式ドキュメントに載っているレスポンスの形を見て手で書いたもので、ファイルの `source` にもそう書いてあります。したがって、テストが確かめているのは、ドキュメントどおりのイベントが届いたときにこのコードが正しく動くことまでで、Bedrock が実際にその形で返すことは確かめていません。

それぞれのテストが見ているものと、見ていないものは次のとおりです。

| どこ | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| 中継 | `test/summarize.test.ts` | 完了、`maxTokens`、途中での切断、途中のスロットリング、再試行、キャンセル、締め切り | 実際のモデルが返すイベントの形 |
| アプリ | `test/app.test.ts` | ストリームが始まる前と後の失敗の返し方、入力の上限、切断したときの中止 | Lambda と function URL を通したときの動作 |
| クライアント | `test/client.test.ts` | どこで切れても、完了と誤解しないこと | 本物のネットワーク |
| インフラ | `infra/test/ai-stack.test.ts` | 権限、URL の認証、`timeout` | AWS がテンプレートどおりに動くこと |

テストは時計も乱数も使わないので、「2 回スロットリングされてから成功する」といった筋書きを、毎回同じ順序で再現できます。このときの待ち時間は 199 ミリ秒と 399 ミリ秒で、毎回同じ値です。

実際のモデルを呼ぶ確認は、別のタスクに分けてあります。

```bash
vp run ai:test:live
```

このタスクは課金され、`check:all` からは呼ばれません。モデル ID が通るか、権限が足りるか、本物のイベントがスキーマに合うか、といった、フィクスチャでは確かめられないことを見るためのタスクです。このタスクも、まだ実行できていません。

## 途中で切れたとき

<!-- section: 17.partial -->

ストリームは途中で切れることがあります。モデルが止まる場合も、Lambda がタイムアウトする場合も、Wi-Fi が切れる場合もあります。

```figure
caption: ストリームが途中で切れると Lambda は error を送れるが、呼び出し元との間が切れると最後のイベントは届かない
type: sequence
actor bedrock: Bedrock
actor fn: Lambda
actor caller: caller
step bedrock --> fn: t1 messageStart
step fn -> fn: SSE のストリームを開く
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
note caller: 最後のイベントは何も届かない
```

t4 のように Bedrock と Lambda の間が切れた場合は、Lambda が `error` を送れます。しかし、t4' のように Lambda と呼び出し元の間が切れた場合は、何も届きません。届かないものは検証できないので、クライアントは、最後のイベントが届かなかったこと自体を失敗として扱います。

<<< @/examples/17-ai/src/client.ts{events}

サーバーが `done` も `error` も送らずに終わったときは、クライアントが自分で `error` を足します。こうしておくと、このクライアントを使う側から見たストリームは、必ず `done` か `error` で終わります。

SSE を読む部分は短いので、自前で書いています。

<<< @/examples/17-ai/src/client.ts{sse}

イベントとして数えるのは、区切りの空行まで届いたものだけです。`data:` の行が途中まで届いていても、使いません。

残る問題は、切れたときに手元に残った文章の扱いです。この章では、次のように決めました。

<<< @/examples/17-ai/src/client.ts{collect}

**部分的な出力は、見せてもよいが、要約として保存しない。** 結果が `complete` になるのは、`done` を受け取り、その `complete` が `true` のときだけです。それ以外はすべて `incomplete` になり、届いた分は `partial` に入ります。画面に「途中まで」と添えて表示するのは構いません。しかし、ノートの要約として保存すると、次に開いたとき、文の途中で切れた要約が完成したものとして表示され、どこで切れたのかは誰にもわからなくなります。

不変条件（invariant）を 1 文で書くと、**`done` を受け取っていない出力は、完了した要約として扱われない**、となります。

この不変条件を壊そうとするテストがあります。完了するレスポンスのバイト列を、0 バイトから最後の 1 バイト手前まで、1 バイトずつ長さを変えて切り詰め、クライアントに読ませます。接続が静かに閉じた場合と、エラーで切れた場合の両方を試します。どこで切っても結果は `incomplete` で、`partial` は必ず本物の文章の先頭部分になります。

この章のサンプルは、要約を保存しません。保存先を扱うのは 05章からだからです。保存を足すときは、`status` が `complete` の結果だけを書き込んでください。
