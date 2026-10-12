---
title: "17 AI: Design and Build"
---

# 17 AI: Design and Build

## The input limit and the events you return

<!-- section: 17.contract -->

As in chapter 04, we start from the contract. The request first.

<<< @/examples/17-ai/src/contract.ts{request}

The body may be up to 10,000 characters, the same limit as a note in chapter 04. This is validation, and it is also a cost ceiling. Input tokens are billed, so "accepts any length" means the same as "pays any amount".

Characters and tokens are different things, though. A token is the unit in which a model reads and writes text, and each model counts differently. How many tokens 10,000 characters turn into is not known exactly until you make the call. Think of the character limit as holding the input cost down roughly.

The output can be held down much more precisely.

<<< @/examples/17-ai/src/prompt.ts{request}

`maxTokens` is the limit on the tokens one call may generate. For a summary, 400 is plenty. Fixing this value lets you say flatly that one call's output goes no further.

Look at the third line of the system prompt too. The body of the note is written by a user. A note that says "forget your instructions and..." may arrive. The instructions go in `system`, the note goes in `messages`, and the model is told that the note is data. That does not make it safe. The output of this API is a plain string with no authority to do anything, and that is the real safeguard.

Next, the events this API returns.

<<< @/examples/17-ai/src/contract.ts{events}

The response is server-sent events (SSE), a format in which a server keeps sending events inside one HTTP response. Some `delta` events arrive, and then exactly one `done` or `error` at the end. That "always exactly one of the two at the end" pays off later in the chapter.

## Reading the stream

<!-- section: 17.stream -->

`ConverseStream` is the streaming version of `Converse`. What comes back is a sequence of events.

```text
order  event              carries
1      messageStart       role
2      contentBlockDelta  a piece of text (repeats)
3      contentBlockStop
4      messageStop        stopReason: end_turn, max_tokens, ...
5      metadata           usage: inputTokens, outputTokens
```

It is not SSE. It arrives in AWS's own format, and the SDK turns it into an async iterable.

First, the part that calls the model is closed off behind one interface.

<<< @/examples/17-ai/src/summarize.ts{gateway}

The real one is only this.

<<< @/examples/17-ai/src/bedrock.ts{bedrock}

It's the same idea as `NoteRepository` in chapter 04. Tests swap this interface for something else.

The event shapes become a schema as well.

<<< @/examples/17-ai/src/converse-stream.ts{schema}

Event kinds it does not know pass through and are ignored, so that nothing breaks when Bedrock adds a new one. An event it does know, with the wrong shape, stops everything. A `delta` whose `text` is not a string should not flow on to the caller.

And now the relay.

<<< @/examples/17-ai/src/summarize.ts{relay}

The lines to look at are the last few. If the stream ends without a `messageStop`, the relay answers `error`, not `done`. However plausible the text that arrived, if the model never said "that's all", you cannot call it finished.

It checks `stopReason` too. A summary that stopped for anything other than `end_turn`, say `max_tokens`, is cut in the middle of a sentence. It still gets a `done`, but `complete` is `false`.

`MAX_SUMMARY_CHARS` is a backstop. `maxTokens` is passed, so normally it is never reached. Even so, you don't want to write code that keeps forwarding a string from outside with no limit at all.

## Stop, wait, try again

<!-- section: 17.failures -->

A model call fails in many ways. It's busy, you went over a limit, you lack permission, it was cut midway. Fold them all into one "error" and you can no longer tell what is worth retrying from what is not.

<<< @/examples/17-ai/src/failure.ts{classify}

There is one criterion: if you sent the same request again, could it pass?

`ThrottlingException` comes back when you exceed your account's quota (a limit on token usage, set per model). It may pass after a short wait. `ServiceUnavailableException` is a capacity problem on Bedrock's side, also worth waiting for. `AccessDeniedException` and `ValidationException`, on the other hand, will be the same however often you send them. The role, the model ID, or the request is wrong.

About an error whose name it does not know, the code says nothing (`undefined`). It will not decide on its own that the unknown is retryable.

Here is how it waits.

<<< @/examples/17-ai/src/failure.ts{backoff}

The ceiling of the wait doubles each time, and the actual wait is picked at random below it. The randomness keeps callers who failed together from retrying together and failing together again. The random number comes in as an argument, so in tests the waits are fixed values.

And here is the code that uses it.

<<< @/examples/17-ai/src/summarize.ts{start}

Three points.

**It retries only while nothing has been sent yet.** A failure before the stream opens is invisible to the caller, so it can be retried silently. Once even one `delta` has gone out, a retry would send the start of the same text a second time. What was sent cannot be taken back, so from there on it answers `error` and leaves the decision to retry with the caller.

**There is one deadline for all attempts together.** Give each attempt its own 30 seconds and three attempts keep the caller waiting 90. One `AbortSignal.timeout` is created at the start and shared by every attempt.

**Whatever the reason for stopping, the request to the model is aborted.** The caller left, the deadline passed, the relay ended: three signals are combined with `AbortSignal.any` and handed to the SDK. A model bills for text nobody will read just the same.

Left alone, the SDK also retries, up to 3 attempts. This chapter turns that off (`maxAttempts: 1`) and keeps retries in its own code, where they share the deadline and can be tested.

## Making it an API

<!-- section: 17.app -->

Now the pieces go onto Hono.

<<< @/examples/17-ai/src/app.ts{route}

A failure before the stream starts gets an ordinary HTTP error: 429 for throttling, 504 for the deadline. Nothing has been sent yet, so the status code can carry it.

After it starts, the status code has already gone out as 200. So a failure is reported by an `error` event inside the stream. In other words, this is an API where "it answered 200" does not mean "it worked". A caller cannot decide the outcome before it has seen the last event.

At the end it writes one log line called `summary`: the outcome, the number of attempts, and the token counts the model reported. That line is the record of what one summary cost.

Settings are checked at startup, as in chapter 04.

<<< @/examples/17-ai/src/env.ts{env}

`AI_BACKEND` has no default on purpose. Whether you are running with the billed setting should never be a "probably".

Everything is assembled in this one place.

<<< @/examples/17-ai/src/compose.ts{compose}
