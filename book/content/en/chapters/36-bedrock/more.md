---
title: "36 Bedrock: Build, Continued"
---

# 36 Bedrock: Build, Continued

On the [previous page](/en/chapters/36-bedrock/build.md) you implemented the loop and the way JSON is received. This page covers what goes around a call: a guardrail, prompt caching, usage and budgets, and batch inference.

## Guardrails

<!-- section: 36.guardrails -->

Amazon Bedrock Guardrails checks the input to a model and the model's output with filters you choose. One unit of configuration is called a guardrail. There are six kinds of filter.

- Content filters detect hate, insults, sexual content, violence, misconduct, and prompt attacks
- Denied topics detect subjects you decided not to handle
- Word filters react when a word or phrase you listed matches as a whole word
- Sensitive information filters detect personal data and credentials and either block them or mask them. Regular expressions work too
- Contextual grounding checks test whether an answer is based on the material you supplied
- Automated Reasoning checks compare an answer with logical rules

### What works in Japanese

Each filter supports a different set of languages. The documentation states plainly that a guardrail is ineffective in a language it does not support.

Content filters and denied topics come in two tiers, Classic and Standard. Classic supports English, French, and Spanish only. Japanese is "Optimized and supported" in Standard. Prompt attack detection is a kind of content filter, so using it on Japanese notes takes Standard.

Sensitive information filters have no tiers and support Japanese. Word filters and contextual grounding checks list English, French, and Spanish.

Standard comes with a condition. A Standard guardrail runs through a cross-Region mechanism. The idea is the same as a model's inference profile, but the destinations are set separately.

<<< @/examples/36-bedrock/infra/lib/guardrail.ts{profile}

The profile usable from Tokyo is `apac.guardrail.v1:0`, and its destinations include Mumbai, Seoul, Singapore, and Sydney. Even when you call the model through a `jp.` profile and keep inference inside Japan, a Standard guardrail means the text of the question and the answer may leave Japan to be checked.

By default this chapter's stack does not attach that filter. The default guardrail has sensitive information filters only, and it blocks AWS access keys and secret keys in both the question and the answer, so that the assistant does not repeat a key someone pasted into a note. The prompt attack filter is turned on only when you deploy with `-c promptAttackFilter=standard`. The [deploy page](/en/chapters/36-bedrock/deploy.md) shows the stack.

### Attaching it to a call

A guardrail takes effect when its ID and version are written in the request's `guardrailConfig`.

<<< @/examples/36-bedrock/src/prompt.ts{guardrail}

The version passed is a number. A guardrail has a working draft (`DRAFT`) and numbered versions. You can name the draft, but then behaviour changes every time the configuration is edited, so the application pins a number.

`streamProcessingMode` says how a stream is checked. With `sync`, a piece is checked before it is sent on, which makes it that much slower. With `async`, pieces are sent at once and the check runs behind them. Once a problem is found the later pieces stop, but what was sent before has reached the caller. Masking is not available with `async`. This chapter uses `sync`.

### What a blocked answer looks like

When a guardrail blocks, there is no error. `stopReason` becomes `guardrail_intervened`, and the message you configured on the guardrail arrives in place of the model's text. In a stream, that message comes through as pieces of text. In the documentation's example, the token counts for an input that was blocked are 0.

So if you do nothing, a blocked answer shows up on the screen looking like any other answer. The loop turns it into a different event. It puts the guardrail's message into `blocked` and sets `complete` to `false` on `done`.

When `blocked` arrives, the client throws away the text it has shown and replaces it with the message.

<<< @/examples/36-bedrock/src/client.ts{collect}

How much of the earlier text has arrived when an answer is blocked partway through its output has not been checked in this chapter. The description of `sync` reads as if pieces that passed the check do arrive. For that reason the client keeps chapter 17's rule as it is: text that arrived is not an answer until `done` says it is complete.

### What it does not look at

A guardrail has places it does not check, and in a chapter with tools they matter. The documentation says it does not evaluate these three.

- The content of a tool result the application returns
- The tool definitions the application sends
- The tool input the model writes

What it evaluates is the input sent as text and the model's output as text. A note's body reaches the model as a tool result, so neither instructions written in a note nor personal data written in a note pass through the check on input. Only when the model writes them into the text of its answer does the check on output see them.

The system prompt is not checked by default either. To have it checked, wrap it in `guardContent`. But once a single `guardContent` is placed anywhere in the messages, whatever is not wrapped stops being checked. This chapter uses no `guardContent` and has the whole question and answer checked. Blocks of the model's reasoning are not evaluated either.

A guardrail does not replace the design on the [previous page](/en/chapters/36-bedrock/build.md). That the tools only read, and that they reach only the caller's notes, is held by code and IAM with or without a guardrail. A guardrail is a check laid on top. It works by probability, so it both lets things through and blocks too much.

The price depends on the filter and on the amount of text checked. The unit is the text unit, and up to 1,000 characters is one unit. The amounts are on the [costs page](/en/chapters/36-bedrock/wrap.md).

## Prompt caching

<!-- section: 36.caching -->

The loop sends the whole conversation again on every round. Prompt caching lets the model's side reuse the part that starts the same way every time. What is reused is billed at a rate below the input rate.

Bedrock has two kinds of prompt caching. With implicit caching, Bedrock looks for a reusable start without being told. A hit is not guaranteed. With explicit caching, you put a mark in the request, a cache checkpoint, that says everything up to here may be reused. A hit is not guaranteed then either.

The marks follow rules that differ by model.

- There is a minimum number of tokens in front of a mark. It is 1,000 for Nova 2 Lite and 4,096 for Claude Haiku 4.5. A mark below the minimum is not an error. It is simply ignored
- A request may carry up to 4 marks
- Where a mark may go differs. Nova 2 Lite takes them in `system` and `messages`, and Claude Haiku 4.5 in `tools` as well
- A cache lives for 5 minutes, extended on every hit. Claude Haiku 4.5 can also choose 1 hour. Naming a lifetime on a model that has only 5 minutes can cause a `ValidationException`
- Nova models cache at most 20,000 tokens

The minimum is judged on the total up to the mark, counted in the order `tools`, `system`, `messages`. The order matters in the same way: change something earlier, and the cache for what comes later is lost. Put what does not change first and what changes last.

This chapter's loop places marks in two kinds of place.

<<< @/examples/36-bedrock/src/prompt.ts{cache-points}

They are the end of the system prompt and the end of each message that returned tool results. The next call starts with the same content up to there. When there would be more than 4 marks, the oldest are dropped.

This assistant's system prompt and tool definitions together are a few hundred tokens, below the minimum. Where a mark can take effect is the calls after a note has been read. One long note puts the conversation above Nova 2 Lite's minimum. Whether it actually hits has not been checked, because no model was called.

### Reading the usage

With a cache, the meaning of the usage numbers changes.

<<< @/examples/36-bedrock/src/usage.ts{usage}

`inputTokens` includes neither what was read from the cache nor what was written to it. The total input sent is the three added together. Watching `inputTokens` alone, input seems to shrink the moment a cache takes effect. This chapter's token limit counts all four.

### When it pays

What is written to a cache and what is read from it have rates of their own.

<<< @/examples/36-bedrock/src/usage.ts{cache-math}

For Claude Haiku 4.5 (Tokyo, AWS Price List, checked 2026-10-13), ordinary input is USD 1.10 per million tokens, a write is USD 1.375, and a read is USD 0.11. A write costs 25% more than ordinary input, and a read a tenth. A mark on a start you send only once loses money. It pays when the second call comes within 5 minutes and hits the cache. With 1,000 conversations a month that each send the same 5,000-token start four times, the start alone costs USD 22.00 without a cache and USD 8.53 with one.

For Nova 2 Lite, the Price List has a write at USD 0 and a read at USD 0.000099 per 1,000 tokens, a quarter of ordinary input (USD 0.000396). With 1,000 conversations a month that send a 2,000-token start four times, that is USD 3.17 without a cache and USD 0.59 with one. How a line priced at 0 for writes is counted on a real bill has not been checked.

Both calculations assume that every call after the first hits. If they miss, what remains for Claude Haiku 4.5 is the surcharge on writes. The documentation also says that with a cross-Region profile, writes may increase at busy times. Judge whether it pays by the `cacheReadInputTokens` in your logs.

## Usage, budgets, and quotas

<!-- section: 36.budget -->

Chapter 17's notes for production said that there was no limit per user. This chapter has the caller's ID, so a limit can be built.

### Turning usage into money

The loop adds up the usage in each answer's `metadata` event. The model's unit prices turn the sum into an amount.

<<< @/examples/36-bedrock/src/usage.ts{cost}

The unit is a millionth of a dollar. The prices are in the table on the first page, copied from the Price List. This is an estimate, not the basis of a bill. Prices change, and how much of a failed call is billed could not be confirmed, as in chapter 17.

### Reserving before the call

<<< @/examples/36-bedrock/src/budget.ts{ledger}

The budget is checked before the model is called. Checked afterwards, you would learn that it was exceeded once the money was already spent.

Before the call, what this request will cost is not known. So the worst case is set aside first and replaced by the real amount at the end. The worst case is what it would cost if every token up to the token limit were billed at the dearest rate. For Nova 2 Lite with a limit of 20,000 tokens, that is USD 0.066.

<<< @/examples/36-bedrock/src/app.ts{budget}

If the reservation fails, the answer is a 429 and the model is not called. That answer costs nothing.

If the function dies between reserving and settling, the worst case stays counted. The budget shows more spent than really was, and the rest of that day leans towards refusing. Built to lean the other way, every crash would create a free call.

In production the ledger is in DynamoDB.

<<< @/examples/36-bedrock/src/dynamodb-ledger.ts{ledger}

Split "read what is left, and add if there is room" into two operations, and two requests arriving together both see the last of the budget and both pass. As with the conditional write in chapter 05, checking and adding are made one update.

The reservation is derived from the token limit, and that limit itself stops only after it has been passed. So spending can exceed the reservation by the last call's share. Settling uses the real amount, so the ledger adds up, but this does not go as far as "the daily budget is never exceeded by a cent".

### Leaving it in the log

Each call writes one line of JSON in the shape of chapter 19.

<<< @/examples/36-bedrock/src/log-shape.ts{shape}

One line says whose call it was, which model, how many rounds, how many tokens, and how much. The question, the notes, and the answer are not in it. The schema is `v.strictObject` for the same reason as in chapter 19: if someone adds the text to the log, a test fails.

Bedrock has its own record of calls too, model invocation logging. It is off by default. Turned on, it stores the full text of requests and responses in CloudWatch Logs or S3. That includes the bodies of notes, so decide who may read the destination and how long it is kept before turning it on.

### Quotas and throttling

Bedrock limits requests per minute and tokens per minute, per account and per model. The published defaults for cross-Region calls are 2,000 requests and 8 million tokens per minute for Nova 2 Lite, and 10,000 requests and 5 million tokens for Claude Haiku 4.5 (AWS General Reference, checked 2026-10-13). The values applied to your account may be lower. Check your own in Service Quotas.

The token quota is not counted the way the bill is.

- When a request starts, its input tokens plus `maxTokens` are taken out of the quota. Even if the output is short, the share of `maxTokens` is held until the request ends. A `maxTokens` larger than needed lets fewer requests through at once
- Output tokens are multiplied by a rate that depends on the model, the burndown rate. For Claude Haiku 4.5 it is 5, so one output token takes 5 tokens of quota. For Nova 2 Lite it is 1. Only the real number of tokens is billed
- Tokens read from the cache do not count towards the quota

Over the quota, the answer is a 429 `ThrottlingException`. A 503 has a different cause: the service lacks capacity, and it has nothing to do with your account's quota. In both cases this chapter's loop waits and tries again.

In a loop, throttling weighs more. If one question makes three calls, a refusal at any of them makes the whole question wait. The budget per user helps here too: it stops one person from making so many calls that everyone else's quota is used up.

### Timeouts

The function in chapter 17 gave up on inference after 30 seconds and stopped after 40. This chapter puts one deadline of 60 seconds on the whole loop and sets the function's timeout to 70 seconds. The deadline is shared by every round and every retry. Giving each round 30 seconds would make four rounds two minutes, and the caller would spend them not knowing whether an answer is coming.

When the deadline comes, the loop sends one `timeout` error and ends. The function's timeout is longer than the deadline to leave time to write that error and settle the budget.

## Batch for work that can wait

<!-- section: 36.batch -->

Work such as redoing the summaries of everyone's notes does not need its answer now. Batch inference takes requests gathered into a file in S3 and delivers the results to S3 later. It costs half of on demand. In the Price List too, Nova 2 Lite's batch rates are exactly half, for input and for output. For 10,000 summaries at 2,000 input tokens and 150 output tokens each, that is USD 12.89 on demand and USD 6.44 as a batch.

The input is JSON Lines, one line per request.

<<< @/examples/36-bedrock/src/batch.ts{record}

`modelInput` follows the format chosen when the job is created. Choose `Converse`, and it is the body of a `Converse` API request as it is. The default is `InvokeModel`, in which case the format depends on the model. This chapter reuses chapter 17's summary request, so it is `Converse`. A job names one model, so there is no model ID in a line.

A job has rules about size.

<<< @/examples/36-bedrock/src/batch.ts{limits}

<<< @/examples/36-bedrock/src/batch.ts{plan}

The minimum is 100 records. A job below it is not accepted, so the records are counted on your machine before a file is put anywhere. The check also makes sure no `recordId` repeats. The lines of the output are not guaranteed to be in the input's order, and `recordId` is the only way to take a result back to its note.

The next task builds the first line of an input file from the fixture notes and shows whether the file passes the checks above. It sends nothing to S3.

```bash
vp run bedrock:batch:plan
```

The output is the input line with `modelOutput` added. A line that failed has `error` in place of `modelOutput`.

<<< @/examples/36-bedrock/src/batch.ts{output}

Lines that succeeded and lines that failed are mixed within one job. `manifest.json.out` carries the totals of records and tokens, so look first at whether the failures are 0.

Some things do not work in a batch.

- In Tokyo, both Nova 2 Lite and Claude Haiku 4.5 can be used for batch only through a cross-Region profile
- Prompt caching is not available
- Tool use is not available. A line is one call, and there are no rounds
- On structured outputs, the documentation disagrees with itself. The batch inference page says they are not supported, and the structured outputs page says they are. Which one is right has not been checked in this chapter

This chapter does not go as far as creating a job. A job needs S3 buckets for input and output and a service role that Bedrock assumes. The role's trust policy names `bedrock.amazonaws.com` and narrows it, by condition, to your own account's jobs. With a profile, the role also needs `bedrock:InvokeModel` on the profile and on the model in each destination Region. All of that was checked in the documentation, but none of it was made into a stack or a script.

There is one more choice for work that can wait. Flex is a service tier you name per request, and it halves the price in exchange for slower processing. It needs no file and no S3, and works with `Converse` as it is. Nova 2 Lite supports it, and the model card of Claude Haiku 4.5 lists it as not supported. This chapter does not use it.

In the other direction, capacity can be bought ahead. Provisioned Throughput reserves a model's capacity by the hour and is billed until you delete it. It cannot be combined with an inference profile. The Reserved service tier books tokens per minute for 1 or 3 months. Both are for when the on-demand quota no longer suffices, and neither is needed at this chapter's size.
