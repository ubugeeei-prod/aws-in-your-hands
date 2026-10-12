---
title: "36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch"
sourceRevision: 1
---

# 36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch

In [chapter 17](/en/chapters/17-ai.md) you handed over one note and received a summary. The model was called once, and what came back was text.

This chapter covers what you need after that. Tool use lets the model look for notes. Structured output gets you JSON in a shape you chose. A guardrail checks what goes in and what comes out. Prompt caching reuses a prompt's unchanging start. Then come a budget per user, batch inference for work that can wait, and an evaluation you run on every change. The running example is an assistant you can ask about your own notes.

Finding notes by words or by meaning, embeddings, and Knowledge Bases belong to [chapter 27](/en/chapters/27-search.md). The tools in this chapter only list notes and read them one at a time.

As in chapter 17, no model is called on your machine. The tests and the default development server in this chapter replay sequences of answers written by hand, and they do not touch AWS. Each task that is billed is marked as billed where it appears.

Which models and Regions support a Bedrock feature changes from month to month. Everything this chapter calls supported or not supported was checked against the official documentation on 2026-10-13. When you read this, check the model card again.

The prerequisite is chapter 17. Notes are stored as in [chapter 05](/en/chapters/05-dynamodb.md), the caller is identified as in [chapter 06](/en/chapters/06-auth.md), and the log lines have the shape of [chapter 19](/en/chapters/19-observability.md). The code is in `examples/36-bedrock/`.

## The whole picture

<!-- section: 36.overview -->

```figure
caption: The function calls the model and runs the tools the model asks for, in the caller's name
node caller: Caller | a signed request
node url: Lambda function URL | AWS_IAM, RESPONSE_STREAM
node fn: Lambda function | loop, tools, budget
node bedrock: Amazon Bedrock ConverseStream | inference profile and guardrail
node notes: DynamoDB Notes | read only
node usage: DynamoDB Usage | each user's spending for the day
edge caller -> url: HTTPS, SigV4
edge url -> fn: the signer's ID
edge fn -> bedrock: question, tool definitions, results
edge fn -> notes: that user's notes only
edge fn -> usage: reserve before, settle after
mark fn
```

```figure
caption: Tool requests and results go back and forth until the model answers in text
type: sequence
actor caller: Caller
actor fn: Lambda | loop
actor bedrock: Bedrock
actor notes: Notes
step caller -> fn: question
step fn -> fn: reserve budget
step fn -> bedrock: question, tools
step bedrock --> fn: tool_use: read_note
step fn -> notes: caller's note
step fn -> bedrock: conversation, tool result
step bedrock --> fn: text…, end_turn
step fn --> caller: delta…, done
step fn -> fn: settle
```

The function in chapter 17 only relayed the events from Bedrock to its caller. The function in this chapter carries on an exchange with the model over several rounds. The model may answer "I want to read this note", and when it does, the function is what reads the note. The function calls the model again with the result attached, and the model thinks further. This chapter calls that exchange the loop.

The loop brings worries chapter 17 did not have. The code does what the model asks, so you have to decide what the model cannot ask for. Every round sends the whole conversation again, so cost grows faster than the number of rounds. And the model decides how many rounds it takes, so the condition for stopping has to live in your code.

If one call that returns text is enough, keep the shape of chapter 17. More rounds mean more cost, more delay, and more kinds of failure.

## What differs from model to model

<!-- section: 36.models -->

In chapter 17 you saw that you pass the ID of an inference profile in place of a model ID, and that a profile starting with `jp.` runs the inference in Tokyo or Osaka. This chapter uses the same profiles. What is new is the number of features, and each feature is supported by a different set of models.

Here are this chapter's features for the two models checked in chapter 17. Every entry was checked on 2026-10-13, against each model's model card and the page for each feature.

| | Nova 2 Lite | Claude Haiku 4.5 |
| --- | --- | --- |
| Paths from Tokyo | Geo (`jp.`) and Global. No In-Region | Geo (`jp.`) and Global. No In-Region |
| Tools (client-side tool calling) | Supported | Supported |
| Structured outputs | Not supported | Supported |
| Guardrails | Supported | Supported |
| Prompt caching: minimum and placement | 1,000 tokens. `system` and `messages`. 5 minutes | 4,096 tokens. `system`, `messages`, `tools`. 5 minutes or 1 hour |
| CountTokens | Not supported | Supported |
| Batch inference (Tokyo) | Supported through a cross-Region profile | Supported through a cross-Region profile |
| Earliest end of life (EOL no sooner than) | 2026-12-02 | 2026-10-16 |

In the code, the table looks like this.

<<< @/examples/36-bedrock/src/models.ts{profile}

<<< @/examples/36-bedrock/src/models.ts{profiles}

You need this table because the same `Converse` API accepts different fields depending on the model. A model without structured outputs cannot be asked with a JSON Schema. Changing models changes more than the ID, so what the model can do is written down in one place next to its ID.

### What leaves the Region

With a `jp.` profile, a request is processed in Tokyo or Osaka. The official documentation says the following about geographic profiles. By default your data stays stored only in the Region you called from, but the input and the output may move outside that Region during inference. Where data is stored for abuse detection, it is stored in the Region that processed it. Traffic between Regions stays on the AWS network and is encrypted. Which Region processed a request is recorded in CloudTrail, in `additionalEventData.inferenceRegion`.

A `global.` profile processes the request in any commercial Region in the world, and costs about 10% less than a geographic one. Decide first whether your data may leave Japan.

Where data goes is not a question about the model alone. Guardrails have the same mechanism, and their destination Regions are not the model profile's. The [next build page](/en/chapters/36-bedrock/more.md) covers this.

### Keeping the model ID out of the code

A model has a lifecycle. Its states are Active, Legacy, and End-of-Life. Once a model is Legacy, new customers cannot start using it, and existing customers may lose access after 15 days without use. After the end-of-life date, requests to the model fail. Nothing moves you to another model automatically.

A model card carries an "EOL no sooner than" date: a promise that the model will not end before that day. For Claude Haiku 4.5 that date is 2026-10-16, three days after this chapter was written. Its end has not been announced, but the promised period is over.

For that reason the application code does not know the model's name. A model ID enters in one place, an environment variable.

<<< @/examples/36-bedrock/src/env.ts{env}

Give `BEDROCK_MODEL_ID` an ID that is not in the table above, and the application does not start. For a model whose abilities and prices are not written down, neither the way to ask for JSON nor the budget arithmetic can be decided. Changing models is therefore done in this order: add a row to the table, run the evaluation, change the environment variable.

The days left until the earliest end of life come out of the table.

<<< @/examples/36-bedrock/src/models.ts{lifecycle}

Bedrock also has inference profiles you create yourself, called application inference profiles. One is a name that points at a model or at an existing cross-Region profile, and you can tag it to split costs. This chapter does not use one. It would add kinds of ARN to write in IAM, and the thing this chapter wants, one place for the ID, is covered by an environment variable. Consider one when you want costs split by team or by feature.

Besides `bedrock-runtime`, which this chapter uses, Bedrock has an endpoint called `bedrock-mantle`, and besides Converse it has a Responses API and a Chat Completions API. This chapter uses `bedrock-runtime` and Converse only, because guardrails are not supported on `bedrock-mantle` and because the code continues from chapter 17.

## Why this chapter does not use an agent service

<!-- section: 36.agents -->

AWS also has services that save you from writing the loop yourself.

Amazon Bedrock Agents has not accepted new customers since 2026-07-30. It is now named Agents Classic and is only maintained. The official documentation names Amazon Bedrock AgentCore as the place to move to.

AgentCore is not one service but a set of parts. Harness runs the loop for you when you give it a model and tools as configuration. Runtime runs your agent's code. Gateway presents APIs and Lambda functions as MCP tools. Memory remembers across conversations, Identity connects user authentication, and there are a sandbox for running code, a browser, and more. The pinned cdkd (0.296.28) has its own implementation for some of these resources, Runtime among them.

Even so, this chapter writes the loop itself.

The body of the loop is about a hundred lines, and the most important rule of this chapter is inside it: a tool can read only the caller's notes. When the rule is in your own code, a test can try to break it. Hand it to a service, and the rule moves into configuration and another service's permissions, and the way you check it changes.

Writing it yourself also lets you reproduce failures in a fixed order on your machine. A stream cut in the middle of a tool request, or a model asking for a tool that does not exist, can be tried as often as you like without calling a model.

And there are no more moving parts. This chapter's stack is chapter 17's with two tables and a guardrail added.

AgentCore is worth considering when you need what lies outside the loop: work that runs for tens of minutes, running code the model wrote, driving a browser, managing many tools, memory across conversations. This chapter has not run AgentCore, so it can say nothing about what it is like to use.
