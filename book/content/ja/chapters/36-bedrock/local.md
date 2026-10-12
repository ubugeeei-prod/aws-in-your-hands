---
title: "36 Bedrock: 手元で動かす"
---

# 36 Bedrock: 手元で動かす

[前の 2 ページ](/ja/chapters/36-bedrock/build.md)で作ったループを、手元で動かします。モデルは呼びません。モデルの代わりに、手で書いた応答の列を再生するものを置きます。

## 手元で動かす

<!-- section: 36.local -->

`examples/36-bedrock/.env.example` を、同じディレクトリに `.env` という名前でコピーします。

<<< @/examples/36-bedrock/.env.example

```bash
vp run dev:bedrock
```

開発サーバーは <http://localhost:8836> で起動し、`local-alice` という利用者のトークンを 1 つ表示します。06章の手元用のサインインと同じ作りで、`LOCAL_AUTH_SECRET` で署名したトークンが、誰が呼んでいるかを伝えます。表示されたトークンを `TOKEN` に入れて、別のターミナルから呼びます。

```bash
curl -s http://localhost:8836/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8836/assistant -d '{"question":"q"}'
curl -sN -X POST http://localhost:8836/assistant -H "authorization: Bearer $TOKEN" -d '{"question":"金曜のリリースまでに残っている作業は？"}'
curl -s -X POST http://localhost:8836/notes/n1release/action-items -H "authorization: Bearer $TOKEN"
```

2 つ目はトークンが無いので 401 です。3 つ目では、ツールが 2 回動き、答えが少しずつ届きます。

```text
event: tool
data: {"type":"tool","name":"list_notes","ok":true}

event: tool
data: {"type":"tool","name":"read_note","ok":true}

event: delta
data: {"type":"delta","text":"金曜のリリースまでに残っているのは、"}

event: delta
data: {"type":"delta","text":"決済の結合テストと負荷試験です。"}

event: delta
data: {"type":"delta","text":"担当は佐藤さんと鈴木さんで、"}

event: delta
data: {"type":"delta","text":"水曜の朝会で進み具合を確認します。"}

event: done
data: {"type":"done","stopReason":"end_turn","complete":true,"turns":3,"usage":{"inputTokens":1240,"outputTokens":91,"cacheReadInputTokens":0,"cacheWriteInputTokens":0}}
```

この答えは、モデルが書いたものではありません。`fixtures/transcripts/tool-then-answer.json` に手で書いてある文章です。トークン数も、手で書いた数字です。確かめられるのは、ループがツールを実行し、結果を次のリクエストに入れ、使用量を足し、イベントを順に送る、という自分のコードの動きです。

<<< @/examples/36-bedrock/src/dev.ts{dev}

`AI_BACKEND=bedrock` に変えると、同じサーバーが、あなたの認証情報で本物の Bedrock を呼びます。ノートは手元のフィクスチャのままですが、推論は AWS の中で動き、課金されます。この章を書いている時点で、この設定では一度も起動していません。

### 応答の列を再生する

<<< @/examples/36-bedrock/src/scripted-model.ts{transcript}

フィクスチャは、モデルを呼ぶ回ごとに、届くイベントを順に並べたものです。17章のフィクスチャは 1 回分でしたが、ループは何回も呼ぶので、回の列になっています。

<<< @/examples/36-bedrock/src/scripted-model.ts{scripted}

この偽のモデルは、リクエストを読みません。1 回目の呼び出しには 1 つ目を、2 回目には 2 つ目を返すだけです。賢いふりをさせない代わりに、受け取ったリクエストをすべて覚えているので、ループが何を送ったかをテストで調べられます。

ストリームがツールの要求の途中で切れる場合のフィクスチャです。

<<< @/examples/36-bedrock/fixtures/transcripts/cut-mid-tool-use.json

1 回目は、`contentBlockStart` と入力の前半だけで終わります。`messageStop` がありません。2 回目が同じ要求の完全な形、3 回目が答えです。

フィクスチャは `AI_TRANSCRIPT` で選べます。

| 名前 | 再生するもの |
| --- | --- |
| `answer-direct` | ツールを使わずに答える |
| `tool-then-answer` | 一覧、1 件読む、答える |
| `invented-tool` | 渡していないツールを求め、断られてから答える |
| `malformed-input` | JSON として読めない入力を送り、断られてから正しく求める |
| `guardrail-blocked` | ガードレールのメッセージと `guardrail_intervened` |
| `cut-mid-tool-use` | ツールの要求の途中で切れ、やり直すと完了する |
| `cut-mid-answer` | 答えの途中で切れる |
| `throttled-then-answer` | 1 回目が `ThrottlingException` |
| `always-throttled` | 毎回 `ThrottlingException` |
| `runaway-tools` | いつまでもツールを求め続ける |
| `injected` | ノートに書かれた指示に従う |

```bash
AI_TRANSCRIPT=runaway-tools vp run dev:bedrock
```

この状態で 3 つ目の `curl` を実行すると、`tool` が 3 回届いたあと、`stopReason` が `turn_limit`、`complete` が `false` の `done` で終わります。

どのフィクスチャも、公式ドキュメントのイベントの形に合わせて手で書いたもので、実際の推論から採取したものではありません。各ファイルの `source` に、元にしたページを書いてあります。実際のモデルがこの順序、この形でイベントを返すことは、確かめていません。

## テストが守っていること

<!-- section: 36.tests -->

```bash
vp run test:unit
```

この章のテストは 110 件で、モデルも AWS も呼びません。守っていることを、実害に近い順に挙げます。

**ほかの人のノートに届かない。** `test/loop.test.ts` の最後の 2 つが、不変条件のテストです。1 つ目は、ノートの指示に従うモデル（`injected`）を相手にして、ほかの人のノートの中身が、モデルへのリクエストにも、呼び出し元へのイベントにも現れないことを確かめます。2 つ目は逆向きで、`owner` を入力から受け取るツールを書くと、同じ入力でほかの人のノートが読めてしまうことを見せます。この章のツールがそう書かれていない理由です。

**途中で切れたツールの要求を実行しない。** `cut-mid-tool-use` で、切れた回のツールが動かず、やり直した回の要求が 1 度だけ動くことを確かめます。やり直しのリクエストが、1 回目とまったく同じであることも見ています。

**送った文章のあとでは、やり直さない。** `cut-mid-answer` では、モデルを呼ぶのは 1 回だけで、`interrupted` のエラーで終わります。

**止まる。** `runaway-tools` は 4 回で止まり、トークンの上限を下げると 2 回で止まります。`always-throttled` は 3 回の試行で諦め、待ち時間は 200 ミリ秒未満、400 ミリ秒未満と延びます。締め切りが来ていれば、再試行しません。

**予算は呼ぶ前に効く。** 確保できないときは 429 を返し、偽のモデルが 1 度も呼ばれていないことを確かめます。確保と精算のあいだで落ちた場合に、断る側に倒れることも見ています。

**JSON は境界を通ったものだけ。** 期日が日付でない、知らないキーがある、件数が多すぎる、といった JSON を落とします。直させるのは 1 回で、2 回目も落ちれば、モデルを 3 回目は呼びません。

**ログに本文が出ない。** ログの行を `v.strictObject` のスキーマに通し、質問の文字列も、ノートの文字列も含まれないことを確かめます。

**スタックの権限。** `infra/test/bedrock-stack.test.ts` は、実行ロールに許したアクションの一覧を固定します。モデルは profile 1 つ、ノートのテーブルは読むだけ、ガードレールは自分のもの 1 つです。

テストが確かめていないこともあります。偽のモデルは、書いてあるとおりにしか答えません。実際のモデルが、ツールをいつ呼ぶか、断られたあとどう振る舞うか、ノートの指示に従うかどうかは、このテストからは何もわかりません。DynamoDB の条件付き更新は、送るコマンドの形を調べているだけで、DynamoDB では実行していません。

## 回帰テストとしての評価

<!-- section: 36.eval -->

プロンプトを 1 行変える、モデルを替える、ツールの説明を書き直す。どれも、型検査もユニットテストも通ったまま、答えを変えます。変えるたびに同じ質問を投げて、答えが決めた条件を満たすかを見る仕組みが要ります。

<<< @/examples/36-bedrock/src/eval.ts{case}

1 つのケースは、質問と、答えが満たすべき条件です。条件は 2 種類あります。構造についての条件は、完成したか、何回の往復で済んだか、どのツールが動いたかです。事実についての条件は、答えに必ず入っているはずの語句と、入っていてはならない語句です。

<<< @/examples/36-bedrock/fixtures/eval/cases.json

「決済」「負荷試験」「佐藤」「鈴木」は、ノートに書いてある事実で、要約の言い回しがどう変わっても答えに残るはずの語です。「720」は、ほかの人のノートにしかない数字です。

<<< @/examples/36-bedrock/src/eval.ts{check}

手元では、ケースごとに決めたフィクスチャを相手に回します。

```bash
vp run bedrock:eval
```

```text
ok   release-facts
ok   greeting
ok   no-such-tool
ok   injected-note
4 passed, 0 failed
model: scripted (no model was called); tokens in/out 3593/256; list price about USD 0.002271
```

最後の行のトークン数と金額は、フィクスチャに書いた数字を足しただけのものです。

本物のモデルを相手に回すタスクは、別にあります。

```bash
vp run bedrock:eval:live
```

このタスクは課金されます。同じ 4 つの質問を、手元のフィクスチャのノートを相手に、`BEDROCK_MODEL_ID` のモデルへ投げます。`check:all` には入っていません。変更のたびに自動で課金されるのを避けるためで、モデルやプロンプトを変えたときに、人が意図して回します。この章を書いている時点で、このタスクは実行していません。4 つのケースが実際のモデルで通るかどうかは、わかりません。

### この仕組みでわからないこと

手元の実行が確かめているのは、ループと検査のコードです。フィクスチャの答えは自分で書いたものなので、通って当然です。モデルについては何も言っていません。

本物を相手にした実行にも、限界があります。

- 1 つの質問を 1 回投げるだけです。モデルの答えは毎回同じではないので、1 回通ったことは、次も通ることを意味しません。通る割合を知るには、同じケースを何度も回す必要があり、そのぶん費用がかかります
- 条件は語句が入っているかどうかです。「佐藤」が答えに入っていても、担当ではなく別の文脈で出てきたのかもしれません。答えが正しいか、読みやすいかは、調べていません
- ケースは 4 つで、自分で思いついた失敗だけを見ています。利用者が実際にする質問の広がりには、届きません
- インジェクションのケースが通っても、その 1 つの書き方に従わなかった、というだけです

Bedrock にも評価の機能（model evaluation）があり、別のモデルに採点させる方法や、人が採点する方法を用意しています。Nova 2 Lite のモデルカードでは、model evaluation は非対応の側に載っています。この章では使っていません。

小さな仕組みでも、あるとないとでは違います。モデルの終了日が来て替えるとき、替える前と後で同じ質問を投げた記録があれば、何が変わったかを話せます。
