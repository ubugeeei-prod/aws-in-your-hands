---
title: "17 AI: Run It Locally"
---

# 17 AI: Run It Locally

## Running it locally

<!-- section: 17.local -->

Copy `examples/17-ai/.env.example` to a file named `.env` next to it.

<<< @/examples/17-ai/.env.example

```bash
vp run dev:ai
```

It starts on <http://localhost:8788>. From another terminal:

```bash
curl -s http://localhost:8788/health
curl -sN -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"release","body":"Finish the payment tests before Friday."}'
curl -s -X POST http://localhost:8788/summaries -H 'content-type: application/json' -d '{"title":"","body":"x"}'
```

On the second one, `delta` events trickle in and a `done` arrives last. `-N` tells curl to print without buffering.

Here is the important part. **An API server running on your machine and inference running on your machine are two different things.**

<<< @/examples/17-ai/src/dev.ts{dev}

With `AI_BACKEND=fixture`, the server replays a prepared sequence of events. It does not call AWS. Nothing is billed. It needs no credentials.

Change it to `AI_BACKEND=bedrock` and the same server calls real Bedrock with your credentials. The server is on `localhost`, but the model runs inside AWS and bills by the token. Nothing that imitates Bedrock locally comes with the SDK.

Workers AI is the same. Cloudflare's documentation says that Workers AI always connects to your account to run models, even in local development, and incurs usage charges. That sets it apart from the bindings mentioned in chapter 04, which connect to a local simulation.

It is also why the development server listens only on `127.0.0.1`. With `bedrock`, anyone who can reach that port can run inference on your bill.

There are five fixtures, selected with `AI_FIXTURE`. You can watch a failing stream locally as often as you like.

```bash
AI_FIXTURE=truncated vp run dev:ai
```

Send the same `curl` now and three `delta` events arrive, followed not by `done` but by `error` (`interrupted`).

One more thing to try. With the `complete` fixture, send the `curl` and press Ctrl+C while it is still flowing. The server's log shows a line whose `outcome` is `cancelled`. That is the record of the server learning that the connection was gone and aborting its request to the model.

That is the local story, though. On Lambda things are different. More on that below.

## Tests

<!-- section: 17.tests -->

```bash
vp run test:unit
```

A model's output changes with every call. Use it as test material and you get tests that sometimes pass and sometimes fail. So the tests feed in a fixed sequence of events.

<<< @/examples/17-ai/src/fixture-gateway.ts{fixture}

A fixture is JSON like this one, a stream that is cut midway.

<<< @/examples/17-ai/fixtures/converse-stream/truncated.json

To be clear, this was not recorded from a real inference call. I wrote it by hand from the response shapes in the official documentation, and the file's `source` field says so. So what these tests establish goes as far as "given events as documented, this code behaves correctly". They do not establish that Bedrock really answers in that shape.

Here is what each set of tests looks at.

| Where | File | What it checks | What it does not |
| --- | --- | --- | --- |
| Relay | `test/summarize.test.ts` | Completion, `maxTokens`, a cut stream, throttling midway, retries, cancellation, the deadline | The shape of the events a real model returns |
| App | `test/app.test.ts` | How failures are reported before and after the stream starts, the input limit, aborting on disconnect | Behavior through Lambda and a function URL |
| Client | `test/client.test.ts` | That no cut, wherever it falls, is mistaken for completion | A real network |
| Infrastructure | `infra/test/ai-stack.test.ts` | Permissions, the URL's authentication, the timeout | That AWS behaves as the template says |

No clock and no random numbers are involved, so a scenario like "throttled twice, then succeeds" replays in the same order every time. The waits are 199 and 399 milliseconds. Fixed values.

Checking against a real model is split off into a separate task.

```bash
vp run ai:test:live
```

This is billed, and `check:all` never calls it. It exists for what fixtures cannot establish: whether the model ID is accepted, whether the permissions are enough, whether real events fit the schema. As I said above, it has not been run yet.

## When the stream is cut

<!-- section: 17.partial -->

Streams get cut. The model may stop, Lambda may time out, the Wi-Fi may drop.

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

At t4, Lambda can send an `error`. But if, as at t4', the link between Lambda and the caller is cut, nothing arrives at all. You cannot validate what never arrives, so the client treats "the last event never came" as a failure in itself.

<<< @/examples/17-ai/src/client.ts{events}

If the server ends without sending `done` or `error`, the client adds an `error` of its own. Seen from the reader's side, then, a stream always ends in `done` or `error`.

The part that reads SSE is short, so it is written here.

<<< @/examples/17-ai/src/client.ts{sse}

An event counts only once its closing blank line has arrived. A `data:` line that arrived halfway is not used.

Now, what do you do with the text left in your hands when the stream is cut? You have to decide. This chapter's answer is this.

<<< @/examples/17-ai/src/client.ts{collect}

**Partial output may be shown, but it is not stored as the summary.** The result is `complete` only when a `done` was received and its `complete` is `true`. Everything else is `incomplete`, and whatever arrived goes into `partial`. Showing it on screen marked as unfinished is fine. Store it as the note's summary, though, and the next time the note is opened, a summary cut in mid-sentence appears as the finished article. Nobody can tell any more where it was cut.

The invariant in one sentence: **output for which no `done` was received is never treated as a completed summary.**

A test tries to break it. It takes the bytes of a response that completes and cuts them one byte at a time, from zero bytes up to one byte short of the end, and has the client read each cut, both when the connection closes quietly and when it fails with an error. Wherever the cut falls, the result is `incomplete`, and `partial` is always a leading part of the real text.

The sample in this chapter does not store summaries (storage starts in chapter 05). When you add it, write only results whose `status` is `complete`.
