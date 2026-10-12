---
title: "17 AI: Design and Build"
---

# 17 AI: Design and Build

On the [first page](/en/chapters/17-ai.md) you called a model once and chose the ID of the model to use. On this page you implement the API that summarizes a note and returns the summary piece by piece.

## The input limit and the events you return

<!-- section: 17.contract -->

As in chapter 04, start by deciding the API's contract. The request comes first.

<<< @/examples/17-ai/src/contract.ts{request}

The body may be up to 10,000 characters, the same limit as a note in chapter 04. The limit validates the input, and it is also a ceiling on cost. Input tokens are billed, so an API that accepts any length is an API that pays any amount.

Characters and tokens are not the same, though. A token is the unit in which a model reads and writes text, and each model counts tokens differently. You cannot know exactly how many tokens 10,000 characters become until you make the call. The character limit holds down only the rough size of the input cost.

The output can be held down more precisely than the input.

<<< @/examples/17-ai/src/prompt.ts{request}

`maxTokens` is the limit on the number of tokens one call may generate. For a summary, 400 is enough, and once the value is fixed you can state how far the output of one call can go.

The third line of the system prompt guards against instructions written in the body of a note. A user writes the body, so a note that says "forget your instructions and..." may arrive. The instructions therefore go in `system`, the note goes in `messages`, and the model is told that the note is data. That one line does not prevent everything. The real safeguard is that the output of this API is a plain string with no permission to do anything.

Next are the events this API returns.

<<< @/examples/17-ai/src/contract.ts{events}

The response is sent as server-sent events (SSE). SSE is a format in which a server keeps sending events, one after another, inside a single HTTP response. Several `delta` events arrive, and at the end exactly one `done` or `error` arrives. The rule that exactly one of the two always arrives last is what the client relies on [when the stream is cut](/en/chapters/17-ai/local.md).

## Reading the stream

<!-- section: 17.stream -->

`ConverseStream` is the streaming version of `Converse`, and it returns the following events in order.

```text
order  event              carries
1      messageStart       role
2      contentBlockDelta  a piece of text (repeats)
3      contentBlockStop
4      messageStop        stopReason: end_turn, max_tokens, ...
5      metadata           usage: inputTokens, outputTokens
```

This sequence of events is not SSE. It arrives in AWS's own format, and the SDK hands it to you as an async iterable.

First, put the part that calls the model behind one interface.

<<< @/examples/17-ai/src/summarize.ts{gateway}

The real implementation, which calls Bedrock, is only the following code.

<<< @/examples/17-ai/src/bedrock.ts{bedrock}

This is the same idea as `NoteRepository` in chapter 04, and the tests replace the implementation of this interface.

The shape of the events becomes a schema too.

<<< @/examples/17-ai/src/converse-stream.ts{schema}

Events of a kind the schema does not know pass through and are ignored, so that the code does not break when Bedrock adds a new event. An event the schema does know, arriving in the wrong shape, stops the relay, so that a `delta` whose `text` is not a string is never passed on to the caller.

Next is the relay.

<<< @/examples/17-ai/src/summarize.ts{relay}

The last few lines matter most. If the stream ends without a `messageStop`, the relay returns `error`, not `done`. However plausible the text that arrived, it cannot be called finished when the model never signalled the end.

The relay also checks `stopReason`. A summary that stopped for any reason other than `end_turn`, such as `max_tokens`, is cut in the middle of a sentence. The relay still returns `done` in that case, with `complete` set to `false`.

`MAX_SUMMARY_CHARS` is a backstop. `maxTokens` is passed, so the output does not normally reach this limit. Even so, the code does not keep passing on a string from outside with no limit at all.

## Stopping, waiting, retrying

<!-- section: 17.failures -->

A model call can fail in several ways: the service is busy, a limit was exceeded, a permission is missing, the stream was cut. If the code treats them all as the same error, it cannot tell a failure worth retrying from one where a retry changes nothing.

<<< @/examples/17-ai/src/failure.ts{classify}

There is a single test for sorting them, which is whether the same request could pass if you sent it again.

`ThrottlingException` is returned when you exceed your account's quota. A quota is a limit on token usage set for each model, and the request may pass after a short wait. `ServiceUnavailableException` is a capacity problem on Bedrock's side, so it is also worth waiting for. `AccessDeniedException` and `ValidationException`, on the other hand, mean that the role, the model ID, or the request is wrong, so the result is the same however often you send the request.

For an error whose name it does not know, the code returns no classification (`undefined`), so that it never decides on its own that an unknown error can be retried.

The wait is decided as follows.

<<< @/examples/17-ai/src/failure.ts{backoff}

The upper bound of the wait doubles with each attempt, and the actual wait is picked at random from the range up to that bound. The randomness keeps callers that failed at the same time from retrying at the same time and failing together again. The random number comes in as an argument, so in tests the waits are fixed values.

The following code uses this wait.

<<< @/examples/17-ai/src/summarize.ts{start}

This code settles three things.

The first is how far retries go. The code retries only while nothing has been sent to the caller. A failure before the stream opens is invisible to the caller, so the code can retry without saying anything. Once even one `delta` has been sent, though, a retry would send the start of the same text a second time. What has been sent cannot be taken back, so from that point the code returns `error` and leaves the decision to retry with the caller.

The second is the deadline. There is one deadline for all attempts together, because a 30-second deadline for each attempt would keep the caller waiting 90 seconds over three attempts. One `AbortSignal.timeout` is created at the start and shared by every attempt.

The third is aborting. Whatever the reason for stopping, the code aborts the request to the model. Three signals, for the caller going away, the deadline passing, and the relay ending, are combined with `AbortSignal.any` and passed to the SDK. A model that keeps writing text nobody will read is still billed.

Left at its defaults, the SDK retries too, up to 3 attempts. This chapter turns the SDK's retries off (`maxAttempts: 1`) and keeps retries in its own code, where they are managed together with the deadline and can be tested.

## Making it an API

<!-- section: 17.app -->

The parts built so far now go into an app shaped like the one in chapter 04: a function that takes a `Request` and returns a `Response`. The difference from chapter 04 is that the body of a successful `Response` is a stream, sent piece by piece as it is produced. The code below is the part that runs after the input has been validated.

<<< @/examples/17-ai/src/app.ts{route}

The body is a `ReadableStream`. Returning the `Response` sends only the status code and the headers. The body grows by one `enqueue` each time the relay produces an event. When the reader goes away, `cancel` is called, and that is where the request to the model is aborted.

The next function decides what string one event becomes on the wire.

<<< @/examples/17-ai/src/sse.ts{frame}

This is the SSE format: a line with the event's name, the `data:` lines, and then a blank line. The blank line marks the end of one event. The `text/event-stream` in `content-type` tells the reader that the body is in this format.

A failure before the stream starts is returned as an ordinary HTTP error: 429 for throttling, 504 for the deadline. Nothing has been sent yet, so the status code can report the failure.

After the stream starts, the status code has already been sent as 200, so a failure is reported by an `error` event inside the stream. With this API, then, a 200 does not mean success, and the caller cannot judge the result before it has seen the last event.

At the end, the handler writes one log line named `summary`. It holds the outcome, the number of attempts, and the token counts the model reported, which makes it the record of what one summary cost.

As in chapter 04, the settings are checked against a schema at startup.

<<< @/examples/17-ai/src/env.ts{env}

`AI_BACKEND` has no default on purpose, so that whether the app is running with the billed setting is never left to a guess.

The parts are assembled in the following one place.

<<< @/examples/17-ai/src/compose.ts{compose}
