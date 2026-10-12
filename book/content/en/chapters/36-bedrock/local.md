---
title: "36 Bedrock: Run It Locally"
---

# 36 Bedrock: Run It Locally

Here you run the loop built on the [previous two pages](/en/chapters/36-bedrock/build.md) on your own machine. No model is called. In the model's place stands something that replays sequences of answers written by hand.

## Running it locally

<!-- section: 36.local -->

Copy `examples/36-bedrock/.env.example` to a file named `.env` in the same directory.

<<< @/examples/36-bedrock/.env.example

```bash
vp run dev:bedrock
```

The development server starts on <http://localhost:8836> and prints one token for a user named `local-alice`. It is built like the local sign-in of chapter 06: a token signed with `LOCAL_AUTH_SECRET` says who is calling. Put the printed token into `TOKEN` and call from another terminal.

```bash
curl -s http://localhost:8836/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8836/assistant -d '{"question":"q"}'
curl -sN -X POST http://localhost:8836/assistant -H "authorization: Bearer $TOKEN" -d '{"question":"金曜のリリースまでに残っている作業は？"}'
curl -s -X POST http://localhost:8836/notes/n1release/action-items -H "authorization: Bearer $TOKEN"
```

The second has no token, so it answers 401. In the third, two tools run and the answer arrives piece by piece.

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

A model did not write this answer. It is text written by hand in `fixtures/transcripts/tool-then-answer.json`, and the token counts are numbers written by hand too. What you can check here is how your own code behaves: the loop runs the tools, puts the results into the next request, adds up the usage, and sends the events in order.

<<< @/examples/36-bedrock/src/dev.ts{dev}

Change to `AI_BACKEND=bedrock`, and the same server calls the real Bedrock with your credentials. The notes are still the local fixtures, but inference runs inside AWS and is billed. At the time of writing, the server has never been started with this setting.

### Replaying a sequence of answers

<<< @/examples/36-bedrock/src/scripted-model.ts{transcript}

A fixture lists, for each call to the model, the events that arrive, in order. Chapter 17's fixtures held one call. The loop calls many times, so here a fixture is a sequence of calls.

<<< @/examples/36-bedrock/src/scripted-model.ts{scripted}

This stand-in for the model does not read the request. It answers the first call with the first entry and the second call with the second. It is not made to look clever. In exchange it remembers every request it received, so a test can see what the loop sent.

This is the fixture for a stream cut in the middle of a tool request.

<<< @/examples/36-bedrock/fixtures/transcripts/cut-mid-tool-use.json

The first call ends after `contentBlockStart` and the first half of the input, with no `messageStop`. The second is the same request in full, and the third is the answer.

`AI_TRANSCRIPT` chooses the fixture.

| Name | What it plays |
| --- | --- |
| `answer-direct` | An answer without tools |
| `tool-then-answer` | List, read one, answer |
| `invented-tool` | Asks for a tool that was not given, is refused, then answers |
| `malformed-input` | Sends input that is not JSON, is refused, then asks correctly |
| `guardrail-blocked` | A guardrail's message and `guardrail_intervened` |
| `cut-mid-tool-use` | Cut in the middle of a tool request, complete when tried again |
| `cut-mid-answer` | Cut in the middle of the answer |
| `throttled-then-answer` | The first call is a `ThrottlingException` |
| `always-throttled` | Every call is a `ThrottlingException` |
| `runaway-tools` | Goes on asking for tools forever |
| `injected` | Follows the instructions written in a note |

```bash
AI_TRANSCRIPT=runaway-tools vp run dev:bedrock
```

Run the third `curl` in this state, and after three `tool` events the stream ends with a `done` whose `stopReason` is `turn_limit` and whose `complete` is `false`.

Every fixture was written by hand after the event shapes in the official documentation, and none was recorded from real inference. The `source` of each file names the pages it is based on. That a real model returns events in this order and this shape has not been checked.

## What the tests hold

<!-- section: 36.tests -->

```bash
vp run test:unit
```

This chapter has 110 tests, and they call neither a model nor AWS. Here is what they hold, starting with what would do the most harm.

**No reaching someone else's notes.** The last two tests in `test/loop.test.ts` are the tests of the invariant. The first faces a model that follows a note's instructions (`injected`) and checks that the content of another person's note appears neither in a request to the model nor in an event to the caller. The second goes the other way: it shows that a tool written to take `owner` from its input lets the same input read another person's note. That is why this chapter's tools are not written that way.

**A tool request that was cut is not run.** With `cut-mid-tool-use`, the tool of the cut call does not run, and the request of the repeated call runs exactly once. The test also checks that the repeated request is identical to the first.

**No trying again after text was sent.** With `cut-mid-answer`, the model is called once only, and the stream ends with an `interrupted` error.

**It stops.** `runaway-tools` stops after 4 calls, and after 2 when the token limit is lowered. `always-throttled` gives up after 3 attempts, with waits of under 200 milliseconds and then under 400. Once the deadline has passed there is no retry.

**The budget acts before the call.** When nothing can be reserved the answer is 429, and the test checks that the stand-in model was never called. It also checks that a crash between reserving and settling leans towards refusing.

**Only JSON that passed the boundary.** JSON whose due date is not a date, that has an unknown key, or that has too many items is rejected. There is one correction, and if the second answer fails too, the model is not called a third time.

**No text in the log.** The log line is run through a `v.strictObject` schema, and the test checks that it contains neither the question nor any of the note.

**The stack's permissions.** `infra/test/bedrock-stack.test.ts` pins the list of actions the execution role is allowed: one profile for the model, reading only on the notes table, and its own guardrail.

There are things the tests do not check. The stand-in model answers only what is written down. When a real model calls a tool, how it behaves after a refusal, and whether it follows a note's instructions cannot be learned from these tests at all. For the conditional update in DynamoDB, only the shape of the command is examined. It is not run against DynamoDB.

## Evaluation as a regression test

<!-- section: 36.eval -->

Changing one line of the prompt, changing the model, rewriting a tool's description: each of these changes the answers while the type check and the unit tests go on passing. You need something that asks the same questions on every change and looks at whether the answers meet conditions you set.

<<< @/examples/36-bedrock/src/eval.ts{case}

A case is a question and the conditions its answer has to meet. There are two kinds of condition. Conditions on structure are whether the answer completed, how many rounds it took, and which tools ran. Conditions on facts are the words that must be in the answer and the words that must not.

<<< @/examples/36-bedrock/fixtures/eval/cases.json

"決済", "負荷試験", "佐藤", and "鈴木" are facts written in the note, words that should stay in the answer however the summary is phrased. "720" is a number found only in another person's note.

<<< @/examples/36-bedrock/src/eval.ts{check}

Locally, each case runs against the fixture chosen for it.

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

The token counts and the amount in the last line are only the numbers written in the fixtures, added up.

A separate task runs the suite against the real model.

```bash
vp run bedrock:eval:live
```

This task is billed. It sends the same 4 questions to the model in `BEDROCK_MODEL_ID`, over the local fixture notes. It is not part of `check:all`, so that no change is billed automatically: a person runs it on purpose after changing the model or the prompt. At the time of writing this task has not been run. Whether the 4 cases pass with a real model is not known.

### What this cannot tell you

What the local run checks is the code of the loop and of the checks. The answers in the fixtures were written by the same person, so of course they pass. The run says nothing about the model.

The run against the real model has limits too.

- It asks each question once. A model's answers are not the same every time, so passing once does not mean passing next time. Knowing the rate of passing takes running the same case many times, which costs that much more
- The conditions are whether words are present. "佐藤" may be in the answer in some other context than being responsible. Whether the answer is correct, or readable, is not examined
- There are 4 cases, covering only failures the author thought of. They do not reach the spread of questions real users ask
- A passing injection case means only that the model did not follow that one wording

Bedrock has an evaluation feature too, model evaluation, with ways to have another model score the answers or to have people score them. The model card of Nova 2 Lite lists model evaluation on the not supported side. This chapter does not use it.

Even a small suite is better than none. When a model reaches its end date and you replace it, a record of the same questions asked before and after lets you say what changed.
