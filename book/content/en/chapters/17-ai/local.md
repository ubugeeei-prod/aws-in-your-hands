---
title: "17 AI: Run It Locally"
---

# 17 AI: Run It Locally

On this page you start the API from [Design and Build](/en/chapters/17-ai/build.md) on your own machine and run the tests. After that you decide what the client does when the stream is cut.

## Running it locally

<!-- section: 17.local -->

Copy `examples/17-ai/.env.example` to a file named `.env` in the same directory.

<<< @/examples/17-ai/.env.example

```bash
vp run dev:ai
```

The development server starts on <http://localhost:8788>. Run the following three commands from another terminal.

```bash
curl -s http://localhost:8788/health
curl -sN -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"release","body":"Finish the payment tests before Friday."}'
curl -s -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"","body":"x"}'
```

With the second `curl`, `delta` events arrive a few at a time and a `done` arrives last. `-N` is the curl option that prints output at once without buffering it.

The distinction to keep in mind here is that **an API server running on your machine does not mean inference is running on your machine**.

<<< @/examples/17-ai/src/dev.ts{dev}

With `AI_BACKEND=fixture`, the server replays a prepared sequence of events, called a fixture. It does not call AWS, so nothing is billed and no credentials are needed.

Change it to `AI_BACKEND=bedrock` and the same server calls the real Bedrock with your credentials. The server runs on `localhost`, but the model runs inside AWS and is billed by the token. Nothing that imitates Bedrock locally is included.

Workers AI is the same in this respect. Cloudflare's documentation says that Workers AI always connects to your account to run models, even in local development, and incurs usage charges. That is where it differs from the bindings mentioned in chapter 04, which connect to a local simulation.

The development server listens only on `127.0.0.1` for the same reason. With `AI_BACKEND=bedrock`, anyone who can reach that port can run inference on your bill.

There are five fixtures, and `AI_FIXTURE` selects one. A failing stream can be replayed on your machine as many times as you like.

```bash
AI_FIXTURE=truncated vp run dev:ai
```

Run the same `curl` in this state and three `delta` events arrive, after which the stream ends with `error` (`interrupted`), not `done`.

You can try disconnecting too. With the `complete` fixture, run the `curl` and press Ctrl+C while the events are still arriving. The server's log shows a line whose `outcome` is `cancelled`. It records that the `nodeServer` from chapter 04 noticed the closed connection and stopped reading the body, and that the app answered by aborting its request to the model.

Aborting the request on a disconnect is how the local development server behaves, though. Lambda behaves differently, and [the Deploy page](/en/chapters/17-ai/deploy.md) explains how.

## Tests

<!-- section: 17.tests -->

```bash
vp run test:unit
```

A model's output changes with every call, so tests built on it would sometimes pass and sometimes fail. The tests feed in a fixed sequence of events instead.

<<< @/examples/17-ai/src/fixture-gateway.ts{fixture}

A fixture is JSON like the following. This one is a stream that is cut partway.

<<< @/examples/17-ai/fixtures/converse-stream/truncated.json

This fixture was not recorded from a real inference call. It was written by hand from the response shapes in the official documentation, and the file's `source` field says so. The tests therefore confirm only that this code behaves correctly when events arrive as documented. They do not confirm that Bedrock really returns events in that shape.

The table shows what each set of tests checks and what it does not.

| Where | File | What it checks | What it does not |
| --- | --- | --- | --- |
| Relay | `test/summarize.test.ts` | Completion, `maxTokens`, a stream cut partway, throttling partway, retries, cancellation, the deadline | The shape of the events a real model returns |
| App | `test/app.test.ts` | How failures are returned before and after the stream starts, the input limit, aborting on disconnect | Behavior through Lambda and a function URL |
| Client | `test/client.test.ts` | That a cut, wherever it falls, is never mistaken for completion | A real network |
| Infrastructure | `infra/test/ai-stack.test.ts` | Permissions, the URL's authentication, `timeout` | That AWS behaves as the template says |

The tests use no clock and no random numbers, so a scenario such as "throttled twice, then succeeds" replays in the same order every time. The waits in that scenario are 199 and 399 milliseconds, the same values on every run.

The check that calls a real model is split off into a separate task.

```bash
vp run ai:test:live
```

This task is billed, and `check:all` does not call it. It exists to check what fixtures cannot: whether the model ID is accepted, whether the permissions are enough, and whether real events fit the schema. This task has not been run yet either.

## When the stream is cut

<!-- section: 17.partial -->

A stream can be cut partway. The model may stop, Lambda may time out, or the Wi-Fi may drop.

```figure
caption: When the stream is cut Lambda can send an error, but when the caller's own connection drops no terminal event arrives
type: sequence
actor bedrock: Bedrock
actor fn: Lambda
actor caller: caller
step bedrock --> fn: t1 messageStart
step fn -> fn: opens the SSE stream
step bedrock --> fn: t2 delta "金曜の"
step fn --> caller: delta
note caller: shows "金曜の"
step bedrock --> fn: t3 delta "リリース…"
step fn --> caller: delta
note caller: shows "金曜のリリース…"
step bedrock --x fn: t4 connection drops
step fn --> caller: error: interrupted
note caller: partial text + "incomplete"
step fn --x caller: t4' or: the caller's connection drops
note caller: no terminal event at all
```

When the connection between Bedrock and Lambda is cut, as at t4, Lambda can send an `error`. When the connection between Lambda and the caller is cut, as at t4', nothing arrives. What never arrives cannot be validated, so the client treats the absence of a last event as a failure in itself.

<<< @/examples/17-ai/src/client.ts{events}

When the server ends without sending `done` or `error`, the client adds an `error` of its own. That way, the stream seen by the code that uses this client always ends with `done` or `error`.

The part that reads SSE is short, so it is written by hand.

<<< @/examples/17-ai/src/client.ts{sse}

An event counts only once its closing blank line has arrived. A `data:` line that arrived only in part is not used.

What remains is what to do with the text that is left when the stream is cut. This chapter decides it as follows.

<<< @/examples/17-ai/src/client.ts{collect}

**Partial output may be shown, but it is not stored as the summary.** The result is `complete` only when a `done` was received and its `complete` is `true`. Every other result is `incomplete`, and whatever arrived goes into `partial`. Showing it on screen marked as unfinished is fine. If it is stored as the note's summary, though, the next time the note is opened a summary cut in mid-sentence is shown as the finished one, and nobody can tell any longer where it was cut.

Written as one sentence, the invariant is that **output for which no `done` was received is never treated as a completed summary**.

One test tries to break this invariant. It takes the bytes of a response that completes, truncates them to every length from zero bytes up to one byte short of the end, and has the client read each one. It tries both a connection that closes quietly and one that fails with an error. Wherever the cut falls, the result is `incomplete`, and `partial` is always the leading part of the real text.

The sample in this chapter does not store summaries, because storage is not covered until chapter 05. When you add storage, write only results whose `status` is `complete`.
