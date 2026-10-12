---
title: "50 AgentCore: 手元で動かす"
---

# 50 AgentCore: 手元で動かす

手元で動くのは、エージェントのコードです。AgentCore Runtime も Memory も手元にはありません。モデルは 36章の台本（transcript）が、Memory はプロセスの中の Map が代わりをします。ここで確かめられるのは自分のコードの判断で、Runtime の動きではありません。

## 手元で動かす

<!-- section: 50.local -->

テストと、バンドルの確認です。AWS の認証情報は要らず、料金もかかりません。

```bash
vp test run examples/50-agentcore
vp run agentcore:bundle:check
```

`agentcore:bundle:check` は、スタックと同じ設定でエージェントを 1 つの `app.js` にまとめ、パッケージの外の空のディレクトリに置いて起動し、`GET /ping` が `Healthy` を返すことと、トークンの無い `POST /invocations` が 401 になることを確かめます。ZIP の中と同じく `package.json` が隣に無い状態で、1 つのファイルとして読み込めることの確認です。Nix の shell の Node.js は 24 で、Runtime の Node.js 22 そのものではありません。

サーバーを起動します。`.env.example` を `.env` にコピーしてから実行します。

```bash
cp examples/50-agentcore/.env.example examples/50-agentcore/.env
vp run dev:agentcore
```

<<< @/examples/50-agentcore/src/dev.ts{dev}

起動すると、`local-alice` と `local-bob` のトークンと、それぞれのためのセッション ID が表示されます。Runtime がするはずのこと（トークンの検査と、セッションのヘッダーを付けること）を、手元では curl が代わりにします。

```bash
curl -N -X POST http://localhost:8850/invocations \
  -H "authorization: Bearer $ALICE_TOKEN" \
  -H "x-amzn-bedrock-agentcore-runtime-session-id: $ALICE_SESSION" \
  -d '{"prompt":"金曜までに何が残っている？"}'
```

2026-10-13 に実行したときの出力です。台本 `tool-then-answer` のとおり、ノートの一覧を取り、1 つ読み、答えています。

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

`usage` の数字は台本に書いてある値で、モデルが数えたものではありません。

同じセッション ID を、Bob のトークンで使うと断られます。ボディに `owner` を足しても断られます。

```bash
curl -s -X POST http://localhost:8850/invocations \
  -H "authorization: Bearer $BOB_TOKEN" \
  -H "x-amzn-bedrock-agentcore-runtime-session-id: $ALICE_SESSION" \
  -d '{"prompt":"続きを"}'
curl -s -X POST http://localhost:8850/invocations \
  -H "authorization: Bearer $ALICE_TOKEN" \
  -H "x-amzn-bedrock-agentcore-runtime-session-id: $ALICE_SESSION" \
  -d '{"prompt":"x","owner":"local-bob"}'
```

```text
{"error":{"code":"session_owner_mismatch","message":"This session belongs to someone else.","requestId":"fcc232bd-8d01-4f6a-84e1-4478e4965e59"}}
{"error":{"code":"invalid_request","message":"The body must be { \"prompt\": string } and nothing else.","requestId":"96de2bab-98bb-4ba5-8b95-fb2857ec21ec"}}
```

台本は 36章のものを使います。台本はリクエストを読んで答えを変えるわけではないので、手元では、何を聞いても同じ答えが返ります。1 つのセッションで続けて質問できるように、新しい質問が来るたびに台本を頭から再生する薄い包みを足しました。

<<< @/examples/50-agentcore/src/local-model.ts{replaying}

テストは、この包みが記録したリクエストを見て、モデルに何が渡ったかを確かめます。たとえば「2 問目のリクエストの先頭に 1 問目のやりとりがある」「Bob のセッションのリクエストに Alice のノートの題が無い」といった確認です。

手元で再現しないものを挙げておきます。Runtime の JWT の検査、セッション ID による microVM の振り分け、アイドルでの終了、microVM の中での認証情報の取得、AgentCore Memory の応答と遅れとスロットリング、424 への置き換え、そしてモデルの実際の答えです。テストの中の「プロセスが入れ替わる」は、同じストアを渡して新しいエージェントを作ることで表しています。Runtime が実際に microVM を入れ替えたときに同じことが起きるかは、デプロイして確かめることです。
