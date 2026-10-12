---
title: "36 Bedrock: Design and Build"
---

# 36 Bedrock: Design and Build

The [first page](/en/chapters/36-bedrock.md) showed the loop as a whole and what differs from model to model. On this page you implement the tools, the reading of the stream, the loop, and the way JSON is received.

## Defining the tools

<!-- section: 36.tools -->

Tool use is not the model running a function. The model only answers "run the tool with this name, with this input", and the application is what runs it. The application puts the result into the next request, and the model reads it and writes on.

A tool is made of a description, a schema for its input, and a function to run.

<<< @/examples/36-bedrock/src/tools.ts{tool}

There are two schemas. `jsonSchema` is the JSON Schema that tells the model what the input looks like. `input` is the Valibot schema that checks the input the model actually wrote. A model does not always write what it was told to, so the input is checked every time before anything runs.

This assistant has two tools, and both only read notes.

<<< @/examples/36-bedrock/src/tools.ts{note-tools}

This chapter's invariant is: **the model never reaches a note that does not belong to the caller**.

It is kept by the arguments of `createNoteTools`. `owner` is the caller's ID as the entry point verified it, passed once, when the tools are made. No tool has an `owner` in its input. Whatever the model writes, there is simply no way for it to name someone else.

That is also why the input schemas are `v.strictObject`. `v.object` silently drops a key it does not know, and `v.strictObject` refuses it. If the model adds `{"owner": "bob"}`, the request is returned as a failure and not carried out with the key removed.

Given the ID of someone else's note, `read_note` answers exactly as it does for an ID that does not exist. The key of chapter 05's table starts with the owner, so a note with a different owner is not found. Answering "it exists but you may not read it" would tell the model that a note with that ID exists.

A note's body can be 10,000 characters long. A tool result becomes input to the next request, and input is billed, so only the first 4,000 characters go back, and `truncated` says that the body was cut.

### Carrying out a request the model wrote

<<< @/examples/36-bedrock/src/tools.ts{call}

A request from the model is treated as input from outside. It can go wrong in three ways, and none of them is an exception.

- The model asked for a tool by a name it was never given. The lookup uses `Object.hasOwn` so that names every object has, such as `constructor` and `toString`, are not found as tools
- The input cannot be read as JSON
- The input is JSON but does not fit the schema

In each case the answer is a tool result with `status` set to `error` and the reason written in it. The model can read it and ask again, for a tool that exists, with input that fits. According to the API reference, `status` is supported only by Amazon Nova models and Anthropic Claude 3 and 4 models.

The tool definitions handed to the model are made from the same table.

<<< @/examples/36-bedrock/src/tools.ts{spec}

## Reading a tool request from the stream

<!-- section: 36.turn -->

Chapter 17's `ModelGateway` carried only the request for a summary. This chapter widens the same interface to a request that can carry tools, a guardrail, and a JSON Schema.

<<< @/examples/36-bedrock/src/converse.ts{request}

<<< @/examples/36-bedrock/src/gateway.ts{gateway}

<<< @/examples/36-bedrock/src/bedrock.ts{bedrock}

`ConverseStream` sends a tool request in pieces too. The order is as follows.

```text
order  event              carries
1      messageStart       role
2      contentBlockStart  toolUse: toolUseId, name      (tool use only)
3      contentBlockDelta  text, or toolUse.input: a piece of JSON text (repeats)
4      contentBlockStop
       2 to 4 repeat for each content block, tied together by contentBlockIndex
5      messageStop        stopReason: end_turn, tool_use, guardrail_intervened, ...
6      metadata           usage: inputTokens, outputTokens, cacheReadInputTokens, ...
```

The tool's name and ID arrive in `contentBlockStart`, and the input arrives as a string of JSON split over several events. A piece on its own cannot be read as JSON, so the pieces are kept as text until all of them are there.

<<< @/examples/36-bedrock/src/converse.ts{events}

`readTurn` is the function that reads one answer to its end.

<<< @/examples/36-bedrock/src/turn.ts{turn}

Pieces of text are yielded in the order they arrive, but a tool request is not handed out until `messageStop` has arrived. When a stream is cut in the middle of a tool request, what you hold is a name and the first half of an input. That must not be run. An answer whose `messageStop` never arrived is `interrupted`, as in chapter 17, and nothing in it is used.

The documentation carries a caution about `toolUseId`. Bedrock generates the ID for tools defined in `toolConfig`, but with some models the ID returned by the model's provider is passed through unchanged. This chapter's code uses the ID only as a string that ties a result to its request, and assumes nothing about its form.

## The loop as a state machine

<!-- section: 36.loop -->

After reading one answer there are only five things the loop can do: finish, pass on the guardrail's message and finish, end as a failure, send the same request again, or run the tools and go on. That becomes a type.

<<< @/examples/36-bedrock/src/loop.ts{state}

Which one it is gets decided by a single pure function.

<<< @/examples/36-bedrock/src/loop.ts{decide}

The API reference lists nine values for `stopReason`. Only `end_turn` means the answer is whole. A value the code does not know is treated as an unfinished answer too.

On `tool_use`, the limits are checked.

<<< @/examples/36-bedrock/src/loop.ts{limits}

As long as the model says it wants to look further, the loop does not end. These numbers are what stop it.

The limit on turns is the number of times the model is called for one question, and it is 4. An answer that hits the limit ends as `turn_limit`, which is not a finished answer.

The limit on tokens has a weak spot. All that can be checked is the sum of the usage the model has reported, so the loop stops after the limit has been passed, just before the next call. An API named `CountTokens` counts input tokens before a call, but the model card of Nova 2 Lite lists it as not supported.

Counting tokens in a loop has a twist of its own. `Converse` does not remember the conversation, so every round sends all of it again. The input of the third call holds the question, the first request and its result, and the second request and its result. Each further round bills everything before it once more. Keeping tool results small and keeping the number of rounds down both act directly on cost.

Here is the body of the loop.

<<< @/examples/36-bedrock/src/loop.ts{loop}

### When it is safe to try again

Chapter 17 had a rule: retry only before the first event arrives, because text already sent to the caller cannot be taken back.

The loop applies that rule to each answer. When an answer fails and not one character of that answer's text has reached the caller yet, the same request can be sent again. An answer cut in the middle of a tool request meets this condition. Tool requests are not handed out before `messageStop`, so trying again makes nothing happen twice.

Once text has started to go out, a cut answer is not tried again. The first half is already on the caller's screen.

Throttling is handled in the same place. When Bedrock refuses with a 429 `ThrottlingException`, chapter 17's function decides how long to wait, and the request is sent again. The wait grows exponentially and is random over its whole range. There are at most 3 attempts per answer, and every answer and every attempt share one deadline of 60 seconds. The SDK's automatic retries are switched off, because if both the SDK and the application retry, the attempts multiply. [Chapter 32](/en/chapters/32-limits.md) covers how to think about retries.

### What goes into the next request

<<< @/examples/36-bedrock/src/loop.ts{echo}

The next request repeats the model's answer as it was and puts the tool results after it. When one answer holds several tool requests, all their results go into one message.

When a request whose input could not be read as JSON is repeated, its `input` is an empty object. `input` has to be JSON, so the original string cannot go there. Whether a real model carries on correctly after this has not been checked. The API may also return such a case with the `stopReason` `malformed_tool_use` in the first place, and then the loop ends as a failure.

## Instructions written in a note

<!-- section: 36.injection -->

Chapter 17 said that a note reading "forget your instructions…" does limited harm, because the output is only a string. With tools that changes. If the model obeys, a tool gets called.

There are also more ways for instructions to come in. The model reads not only the user's question but also the body of every note a tool returns, word for word. A note was not necessarily written by its owner. It may be a shared note, or the body of an email that was imported.

The AWS documentation calls prompt injection the application's responsibility, in the same way as SQL injection.

The system prompt says that a note is data.

<<< @/examples/36-bedrock/src/prompt.ts{system}

That is only a request, and nothing guarantees it is honoured. What this chapter relies on is the other thing: that nothing happens even when the model does obey.

- The tools only read. No tool writes, deletes, or sends a note, and the execution role has no permission to write to the notes table
- The tools read only the caller's notes. `owner` does not come from the model's input
- There is no way out. No tool fetches a URL and no tool sends mail
- Turns and tokens are bounded

The tests use a model that does whatever a note tells it. The fixture `injected` reads a note and then, as the note instructs, asks for someone else's note by ID and asks for a list with an `owner` added. Even so, the content of the other person's note appears in no request to the model and in no event to the caller.

Some danger remains. The model can read only the caller's notes, but within that range it can write an answer that follows the instructions: a twisted summary, or a false contact detail slipped into the answer. If the answer is displayed as HTML or Markdown, there is also the trick of having an image URL carry a note's content to another server. This chapter's API returns only text, but on the side that displays it, do not treat the answer as HTML you can trust.

## Receiving JSON

<!-- section: 36.structured -->

The next task is to take the things to do out of a note. This is a case where you want JSON a program can use, not prose.

<<< @/examples/36-bedrock/src/contract.ts{action-items}

Bedrock has a feature named structured outputs that makes the output fit a JSON Schema, and there are two ways to ask. Give `outputConfig.textFormat` a JSON Schema, and the model's text is JSON that fits it. Put `strict: true` on a tool definition, and the tool's input fits its schema.

Support, however, is per model. The model card of Nova 2 Lite lists structured outputs on the not supported side. Claude Haiku 4.5 supports them, with a note that they do not work through the India profile.

So the same request is written in two forms.

<<< @/examples/36-bedrock/src/structured.ts{request}

A model that has structured outputs gets the schema. A model that does not gets a single tool, named in `toolChoice`. The model then always asks for that tool, and its input is read as the answer. In this form nothing guarantees that the input fits the schema: you depend on the model fitting it. According to the API reference, naming a tool in `toolChoice` is supported only by Anthropic Claude 3 models and Amazon Nova models.

The JSON Schema that is sent is looser than the Valibot schema.

<<< @/examples/36-bedrock/src/structured.ts{json-schema}

Structured outputs accept only part of JSON Schema. String lengths and numeric ranges cannot be written, and `additionalProperties` can be nothing but `false`. Conditions such as "the due date is YYYY-MM-DD", "a task is at most 200 characters", and "at most 20 items" cannot be said in the schema.

So whichever form the answer comes in, it goes through Valibot at the boundary.

<<< @/examples/36-bedrock/src/structured.ts{validate}

What structured outputs guarantee ends at the JSON having the schema's shape. Whether the values are right for the business is for the application to check.

When validation fails, the model is asked to correct it, once.

<<< @/examples/36-bedrock/src/structured.ts{extract}

For the correction, the model's answer stays in the conversation as it was, and the request is made again with a note of which field failed and why. If that fails too, the result is `bad_output`. The limit is one correction because each correction lengthens the conversation and raises the bill for input. An answer cut off by `max_tokens` is not corrected. It was cut because of its length, and asking again would cut it at the same place.

The documentation carries a caution about delay with structured outputs. A new schema is compiled the first time it is used, which can take a few minutes, and the compiled result is cached for 24 hours. Treat the first call after changing a schema as a slow one.
