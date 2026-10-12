---
title: "50 AgentCore: Run It Locally"
---

# 50 AgentCore: Run It Locally

What runs locally is the agent's code. AgentCore Runtime and Memory are not here. Chapter 36's transcripts stand in for the model, and a Map in the process stands in for Memory. What you can check here is your own code's decisions, not the Runtime's behaviour.

## Run It Locally

<!-- section: 50.local -->

The tests and the bundle check. They need no AWS credentials and cost nothing.

```bash
vp test run examples/50-agentcore
vp run agentcore:bundle:check
```

`agentcore:bundle:check` bundles the agent into one `app.js` with the stack's own settings, puts it in an empty directory outside the package, starts it, and checks that `GET /ping` answers `Healthy` and that a `POST /invocations` with no token gets a 401. It confirms that the file loads as a single file with no `package.json` beside it, as inside the ZIP. Node.js in the Nix shell is 24, not the Runtime's Node.js 22 itself.

Start the server. Copy `.env.example` to `.env` first.

```bash
cp examples/50-agentcore/.env.example examples/50-agentcore/.env
vp run dev:agentcore
```

<<< @/examples/50-agentcore/src/dev.ts{dev}

On start it prints tokens for `local-alice` and `local-bob`, and a session ID made for each. What the Runtime would do (check the token, and add the session header) is done by curl here.

```bash
curl -N -X POST http://localhost:8850/invocations \
  -H "authorization: Bearer $ALICE_TOKEN" \
  -H "x-amzn-bedrock-agentcore-runtime-session-id: $ALICE_SESSION" \
  -d '{"prompt":"金曜までに何が残っている？"}'
```

This is the output from a run on 2026-10-13. As the transcript `tool-then-answer` has it, the agent lists the notes, reads one, and answers.

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

The numbers in `usage` are written in the transcript. No model counted them.

Use the same session ID with Bob's token and it is refused. Add `owner` to the body and that is refused too.

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

The transcripts are chapter 36's. A transcript does not read the request to decide what to say, so locally the same answer comes back whatever you ask. So that one session can take several questions, a thin wrapper plays the transcript from the top each time a new question arrives.

<<< @/examples/50-agentcore/src/local-model.ts{replaying}

The tests look at the requests this wrapper recorded to see what went to the model: that the second question's request starts with the first exchange, for example, or that no request of Bob's session contains the title of one of Alice's notes.

These are not reproduced locally: the Runtime's JWT check, routing to a microVM by session ID, ending on idle, getting credentials inside the microVM, AgentCore Memory's responses, delays and throttling, the replacement by 424, and what a model would actually answer. In the tests, "the process is replaced" means creating a new agent and handing it the same store. Whether the same thing happens when the Runtime really replaces a microVM is for a deployment to show.
