---
title: "56 Nova: Run It Locally"
---

# 56 Nova: Run It Locally

Here you start the API from [Design and Build](/en/chapters/56-nova/build.md) on your own machine and watch what happens when two requests overlap. Then you run the tests. Nothing on this page touches AWS, and nothing is billed.

## Running it locally

<!-- section: 56.local -->

Copy `examples/56-nova/.env.example` to `.env` and start the development server.

```bash
vp run dev:nova
```

```text
inference: none. Playing fixtures/converse/described.json. No AWS call, no charge
one upload is in place: /notes/note-1/attachments/image-1
description API on http://localhost:8856
```

The first line says that no model is being called. With the default settings, an in-memory container stands in for S3, and answers written by hand are replayed in place of the model.

<<< @/examples/56-nova/src/dev.ts{dev}

On start there is one upload in place. It did not come through chapter 07's API: it is a 1 by 1 pixel PNG for testing. There is no sign-in, and every request is treated as one owner called `local`. The replayed model waits 3 seconds before it answers, to leave time for a second request to cut in.

Use two terminals. Send a PUT from the first, and before it returns, send the same PUT from the second.

```bash
curl -i -X PUT http://localhost:8856/notes/note-1/attachments/image-1/description
```

The one sent second comes back at once. This is the first line of the response, the `Retry-After` header, and the body.

```text
HTTP/1.1 202 Accepted
retry-after: 2
{"status":"in_progress","retryAfterSeconds":2}
```

The one sent first receives the description after 3 seconds.

```text
HTTP/1.1 200 OK
{"status":"ready","outcome":"described","text":"木の机の上に、開いたノートと青いペンが置かれている。","modelId":"jp.amazon.nova-2-lite-v1:0","createdAt":"2026-10-12T16:15:15.977Z","reused":false}
```

Send the PUT once more and this time there is no wait. `createdAt` is the same, and `reused` is `true`.

```text
{"status":"ready","outcome":"described","text":"木の机の上に、開いたノートと青いペンが置かれている。","modelId":"jp.amazon.nova-2-lite-v1:0","createdAt":"2026-10-12T16:15:15.977Z","reused":true}
```

The server's log has one line for each of the three requests. Only the one that called the model has token counts in `billed`.

```text
{"level":"info","message":"describe","requestId":"63e941b1-8039-4987-b804-d016d03d542d","modelId":"jp.amazon.nova-2-lite-v1:0","outcome":"in_progress","billed":null,"durationMs":0}
{"level":"info","message":"describe","requestId":"3e60d930-a7db-475a-9907-52673e8cd4cd","modelId":"jp.amazon.nova-2-lite-v1:0","outcome":"ready","billed":{"inputTokens":318,"outputTokens":27},"durationMs":3004}
{"level":"info","message":"describe","requestId":"6610b6d9-37ec-4f17-99fa-f104764f3cba","modelId":"jp.amazon.nova-2-lite-v1:0","outcome":"ready","billed":null,"durationMs":0}
```

The description and the token counts are the values written in the answer being replayed. They are not the output of a real model.

The answer that is replayed is a file of this shape.

<<< @/examples/56-nova/src/scripted-model.ts{script}

There are four files in `fixtures/converse/`, chosen with `NOVA_SCRIPT` in `.env`. `refused` is the model declining, `max-tokens` is an answer cut off partway, and `throttled-then-described` fails the first call with throttling. All were written by hand from the Converse API reference. None was recorded from real inference.

The settings are checked together at start-up.

<<< @/examples/56-nova/src/env.ts{env}

`NOVA_BACKEND` has no default, for the same reason as in chapter 17: whether the process runs in a setting that is billed is not left to a guess. `DESCRIBE_MODEL_ID` is checked against the list from the first page. With the ID of a retired model, the server does not start.

```text
Error: Invalid environment:
  DESCRIBE_MODEL_ID: Nova Canvas (amazon.nova-canvas-v1:0) reached end of life on 2026-09-30: requests to it fail
```

A lease shorter than the longest wait for inference is refused here too.

The parts are put together in one place. The development server and the Lambda function both hand over three things, the store, the model, and how the owner is decided, and get the same app.

<<< @/examples/56-nova/src/compose.ts{compose}

With `NOVA_BACKEND=bedrock` and a `MEDIA_BUCKET` in `.env`, the development server uses real S3 and real Bedrock. The server runs on your machine, but inference runs on Bedrock, and every new description is billed. The bucket is the one made in [Deploy](/en/chapters/56-nova/deploy.md). This combination has not been tried at the time of writing.

The task that prints the list also runs on your machine only.

```bash
vp run nova:catalog
```

```text
Amazon Nova on Bedrock as read on 2026-10-13. Today (UTC) is 2026-10-12.

Nova 2 Lite  text+image+video -> text  (Converse, InvokeModel)
  from ap-northeast-1: jp.amazon.nova-2-lite-v1:0 [2 Regions], global.amazon.nova-2-lite-v1:0
  USD per 1K tokens: 0.000396 in, 0.003311 out
  no end of life before 2026-12-02 (50 days away)
Nova Lite  text+image+video -> text  (Converse, InvokeModel)
  from ap-northeast-1: amazon.nova-lite-v1:0, apac.amazon.nova-lite-v1:0 [6 Regions]
  USD per 1K tokens: 0.000072 in, 0.000288 out
  the promise of no end of life ran out on 2025-12-05 (312 days ago)
Nova Pro  text+image+video -> text  (Converse, InvokeModel)
  from ap-northeast-1: apac.amazon.nova-pro-v1:0 [6 Regions]
  USD per 1K tokens: 0.00096 in, 0.00384 out
  the promise of no end of life ran out on 2025-12-05 (312 days ago)
Nova Micro  text -> text  (Converse, InvokeModel)
  from ap-northeast-1: (none confirmed)
  USD per 1K tokens: 0.000042 in, 0.000168 out
  the promise of no end of life ran out on 2025-12-05 (312 days ago)
Nova 2 Sonic  speech+text -> speech+text  (InvokeModelWithBidirectionalStream)
  from ap-northeast-1: amazon.nova-2-sonic-v1:0
  no end of life before 2026-12-02 (50 days away)
Nova Multimodal Embeddings  text+image+video+audio -> embedding  (StartAsyncInvoke)
  from ap-northeast-1: (none confirmed)
  no end of life before 2026-10-28 (15 days away)

Reached end of life: requests fail
  Nova Canvas  amazon.nova-canvas-v1:0  legacy 2026-03-30, end of life 2026-09-30
  Nova Reel  amazon.nova-reel-v1:0  legacy 2026-03-30, end of life 2026-09-30
  Nova Reel  amazon.nova-reel-v1:1  legacy 2026-03-30, end of life 2026-09-30
  Nova Sonic  amazon.nova-sonic-v1:0  legacy 2026-03-13, end of life 2026-09-14

Routes that can describe an image (-c describeModel=...):
  jp.amazon.nova-2-lite-v1:0  (geo)
  global.amazon.nova-2-lite-v1:0  (global)
  amazon.nova-lite-v1:0  (in-region)
  apac.amazon.nova-lite-v1:0  (geo)
  apac.amazon.nova-pro-v1:0  (geo)

1,000 summaries (2,000 tokens in, 150 out each), inference only:
  Nova 2 Lite  USD 1.29
  Nova Lite    USD 0.19
  Nova Pro     USD 2.50
  Nova Micro   USD 0.11
```

Dates are counted in UTC, so this output, taken in the small hours of 2026-10-13 in Japan, has today as 10-12.

## Tests

<!-- section: 56.tests -->

```bash
vp test run examples/56-nova
```

The tests use neither a model nor S3. The clock moves only when a test moves it. The stand-in for the model answers only when a test tells it to. With those two, a test can set the order in which two runs overlap, one move at a time.

The tests that try to break the invariant reproduce these orders.

- Two requests arrive together. The model is called once, and the later request receives `in_progress`
- The first run takes longer than its lease, a second takes over, and both receive the model's answer. The model is called twice, but one description is stored and both runs return it. The late run does not delete the claim of the run that took over
- A run writes its claim and is never heard from again. Other runs wait until the lease is over, and a run after that takes over
- The model fails with throttling. The claim is given back, and the next request runs straight away
- An answer comes back cut off, empty, or in the wrong shape. None is stored, and each is returned as a failure
- Another user sends PUT, GET and DELETE with the same note and attachment IDs. The model is not called, the other person's objects are not touched, and PUT and GET answer the same 404 as for a missing attachment
- A request arrives with `..%2F` in its path. The answer is 404, and no claim is written

The stand-in for S3 is this class.

<<< @/examples/56-nova/src/memory-media.ts{memory}

It copies the three behaviours named in its comment and no others. When real S3 refuses a conditional write, and when a 409 comes back for one that overlaps a delete, are not copied. The shape of the requests sent to S3 is checked by a separate test: that the `If-None-Match` and `If-Match` headers are sent, and that 412 and 409 are read as "the condition did not hold" and not as failures.

The stack's tests are described on the [Deploy](/en/chapters/56-nova/deploy.md) page.

What the local tests cannot tell is plain. How a real model answers when it looks at an image, whether a real response has the shape of the fixtures, and whether this chapter's role has enough permission on S3 and Bedrock. None of the three can be confirmed until the stack is deployed and `nova:smoke` passes.
