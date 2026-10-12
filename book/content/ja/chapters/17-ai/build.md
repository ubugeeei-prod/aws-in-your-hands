---
title: "17 AI: しくみと実装"
---

# 17 AI: しくみと実装

## 入力の上限と、返すイベントの形

<!-- section: 17.contract -->

04章と同じく、契約から決めます。まずリクエスト。

<<< @/examples/17-ai/src/contract.ts{request}

本文は 10,000 文字まで。04章のノートと同じ上限です。これは検証であると同時に、費用の上限でもあります。入力の token は課金されるので、「どんな長さでも受け付ける」は「いくらでも払う」と同じ意味になるんです。

ただ、文字数と token 数は別物です。token はモデルが文章を読み書きする単位で、数え方はモデルごとに違います。10,000 文字が何 token になるかは、呼んでみるまで正確にはわかりません。文字数の上限は、入力の費用を「だいたい」抑えるものだと思ってください。

出力のほうは、もっときっちり抑えられます。

<<< @/examples/17-ai/src/prompt.ts{request}

`maxTokens` が、1 回の呼び出しで生成される token の上限です。要約なら 400 もあれば足ります。この値を決めておくと、「1 回の出力はここまで」と言い切れます。

system prompt の 3 行目も見てください。ノートの本文はユーザーが書いたものです。「これまでの指示を忘れて…」と書かれたノートが来るかもしれません。指示は `system` に、ノートは `messages` に、と分けて、ノートはデータだとモデルに伝えています。これで防ぎ切れるわけではありません。この API の出力はただの文字列で、何かを実行する権限はない。それが本当の歯止めです。

次に、この API が返すイベントです。

<<< @/examples/17-ai/src/contract.ts{events}

応答は server-sent events（SSE）にします。1 つの HTTP 応答の中で、サーバーがイベントを順に送り続ける形式です。`delta` が何回か来て、最後に `done` か `error` が 1 回だけ来る。この「最後に必ずどちらか 1 回」が、この章の後半で効いてきます。

## stream を読む

<!-- section: 17.stream -->

`ConverseStream` は、`Converse` の streaming 版です。返ってくるのは、イベントの列。

```text
order  event              carries
1      messageStart       role
2      contentBlockDelta  a piece of text (repeats)
3      contentBlockStop
4      messageStop        stopReason: end_turn, max_tokens, ...
5      metadata           usage: inputTokens, outputTokens
```

SSE ではありません。AWS 独自の形式で届いて、SDK が async iterable にしてくれます。

まず、モデルを呼ぶ部分を 1 つの interface に閉じ込めます。

<<< @/examples/17-ai/src/summarize.ts{gateway}

本物はこれだけです。

<<< @/examples/17-ai/src/bedrock.ts{bedrock}

04章の `NoteRepository` と同じ考え方ですね。テストでは、この interface を別のものに差し替えます。

イベントの形も schema にします。

<<< @/examples/17-ai/src/converse-stream.ts{schema}

知らない種類のイベントは通して、無視します。Bedrock が新しいイベントを足しても壊れないように。逆に、知っているイベントの形が違っていたら止めます。`text` が文字列でない `delta` を、そのまま呼び出し元へ流したくないので。

そして中継です。

<<< @/examples/17-ai/src/summarize.ts{relay}

見てほしいのは最後の数行です。`messageStop` を受け取らずに stream が終わったら、`done` ではなく `error` を返します。届いた文章がどれだけもっともらしくても、モデルが「ここまで」と言っていないなら、完成したとは言えません。

`stopReason` も確かめます。`end_turn` 以外、たとえば `max_tokens` で止まった要約は、文の途中で切れています。`done` は返しますが、`complete` は `false` です。

`MAX_SUMMARY_CHARS` は、念のための歯止めです。`maxTokens` を渡しているので、ふつうはここまで来ません。それでも、外から来る文字列を上限なしで流し続けるコードは書きたくないですよね。

## 止める、待つ、やり直す

<!-- section: 17.failures -->

モデルの呼び出しは、失敗の種類が多いです。混んでいる、上限を超えた、権限がない、途中で切れた。全部を同じ「エラー」にすると、やり直すべきものと、やり直しても無駄なものの区別がつきません。

<<< @/examples/17-ai/src/failure.ts{classify}

分け方の基準は 1 つ。同じリクエストをもう一度送ったら、通る可能性があるか。

`ThrottlingException` は、アカウントの quota（モデルごとに決まっている、token の使用量の上限）を超えたときに返ります。少し待てば通るかもしれません。`ServiceUnavailableException` は Bedrock 側の容量の問題で、これも待つ価値があります。一方、`AccessDeniedException` や `ValidationException` は、何度送っても同じです。role かモデル ID かリクエストが間違っています。

名前を知らないエラーには、何も言いません（`undefined`）。知らないものを勝手に「やり直せる」と決めないためです。

待ち方はこうです。

<<< @/examples/17-ai/src/failure.ts{backoff}

待ち時間の上限を 2 倍ずつ伸ばして、その中からランダムに選びます。ランダムにするのは、同時に失敗した人たちが同時にやり直して、また同時に失敗するのを避けるため。乱数は引数でもらうので、テストでは待ち時間が決まった値になります。

これを使う側がこちら。

<<< @/examples/17-ai/src/summarize.ts{start}

ポイントが 3 つあります。

**やり直すのは、まだ何も送っていない間だけ。** stream が開く前の失敗は、呼び出し元から見えません。だから黙ってやり直せます。でも `delta` を 1 つでも送ったあとは、やり直すと同じ文章の頭がもう一度流れます。送ったものは取り消せないので、そこからは `error` を返して、やり直すかどうかは呼び出し元に任せます。

**締め切りは、全部の試行をまとめて 1 つ。** 30 秒の締め切りを試行ごとに持つと、3 回で 90 秒待たせることになります。`AbortSignal.timeout` を最初に 1 つ作って、全部の試行で共有します。

**止める理由が何であれ、モデルへのリクエストを中止する。** 呼び出し元がいなくなった、締め切りが来た、中継が終わった。3 つの signal を `AbortSignal.any` でまとめて SDK に渡しています。モデルは、誰も読まない文章を書き続けても課金するので。

SDK 自身も、何もしなければ最大 3 回まで再試行します。この章ではそれを切って（`maxAttempts: 1`）、再試行を自分のコードに置きました。締め切りと一緒に管理できて、テストもできるからです。

## API にする

<!-- section: 17.app -->

ここまでの部品を Hono にのせます。

<<< @/examples/17-ai/src/app.ts{route}

stream を始める前に失敗したら、ふつうの HTTP のエラーを返します。throttling なら 429、締め切りなら 504。まだ何も送っていないので、状態コードで伝えられます。

始まったあとは、状態コードはもう 200 で送ってしまっています。だから失敗は、stream の中の `error` イベントで伝えます。「200 が返ったから成功」とは言えない API だ、ということです。呼ぶ側は、最後のイベントを見るまで結果を決められません。

最後に `summary` という log を 1 行書いています。結果、試行回数、そしてモデルが報告した token 数。これが、1 回の要約にいくらかかったかの記録になります。

設定は 04章と同じく、起動時に確かめます。

<<< @/examples/17-ai/src/env.ts{env}

`AI_BACKEND` に既定値がないのは、わざとです。課金される設定で動いているのかどうかを、「たぶん」にしたくないので。

組み立てはここ 1 か所です。

<<< @/examples/17-ai/src/compose.ts{compose}
