---
title: "56 Nova: Design and Build"
---

# 56 Nova: Design and Build

The [first page](/en/chapters/56-nova.md) listed the Nova models that can be called today. On this page you hand an image to one of them and build an API that stores the description it returns exactly once. The page ends with how to switch to a cheaper model, and with the speech model.

## Passing an image to a model

<!-- section: 56.image -->

In chapter 17 a Converse request was made of text blocks only. To pass an image, you add an image block to the same message.

<<< @/examples/56-nova/src/image.ts{request}

An image block says two things: the format, and where the image is. Where it is can be `bytes`, the image inside the request, or `s3Location`, an object in S3. The Nova guide says the image must always come before the text that asks about it, so the blocks are in that order.

The last sentence of the system prompt is there for the reason chapter 17 wrote "the note is data, not instructions". Images carry text. If the text in a picture reads "ignore your previous instructions", it is something to describe, not something to obey. Saying so in a prompt does not guarantee it, so the output side is guarded too, under "What is stored" below.

There are limits on how much you can pass.

<<< @/examples/56-nova/src/image.ts{limits}

The table in the Nova 2 guide allows 5 images and 25 MB in total inside the request, and 1,000 images and 2 GB in total by S3 URI. The guide does not say which kind of MB and GB it means, so the code counts the smaller, decimal kind. Resolution is limited to 8,000 by 8,000 pixels, which this code does not check. Chapter 07 limits an upload to 5 MB, and chapter 08's worker records each image's width and height, so chapter 07's limit is used here as it is.

The formats are PNG, JPEG, GIF and WebP, the same four chapter 07 accepts. Chapter 07 refuses SVG because it can carry script. Converse does not take SVG either.

This chapter's API passes the image by S3 URI. The upload is already in S3, so the function has no need to read it and send it again. Bedrock is what reads the image then, and the Converse guide says the role used for the request must have `s3:GetObject` on that URI. In other words, Bedrock reads the image with the function's role. If the bucket belongs to another account, `bucketOwner` must name that account, and it can be left out when the account is the same.

One thing could not be confirmed from the documentation. The `jp.` profile handles a request in either Tokyo or Osaka. No page says whether an image in a Tokyo bucket is read without trouble when the request is handled in Osaka.

Images are billed in tokens too. According to the Nova 2 guide, a Nova 2 model bills an image at a flat 230 tokens whatever its size, and the response's `inputTokens` shows that number. Nova Lite and Nova Pro of the first version count differently: an image comes to roughly 800 to 2,600 tokens depending on its resolution.

The guide also states limits of the models themselves. Nova 2 models do not say who a person in an image is. Their understanding of images with text in languages other than English is limited, and they can get even simple questions wrong. Read a description of a Japanese document or screenshot with that in mind.

Before the API, there is a script that calls the model with a single image. This one puts a local file into the request as bytes.

<<< @/examples/56-nova/scripts/hello.ts{hello}

```bash
vp run nova:hello /path/to/photo.jpg
```

This task is billed for one image and a few dozen tokens. Without a file it sends the 1 by 1 pixel PNG the tests use. It has not been run at the time of writing. No check against a real model has passed yet. What has not been confirmed is listed in the [verification notes for this chapter](/en/chapters/56-nova/wrap.md).

## Generating once

<!-- section: 56.job -->

Each description costs money to make, and what is made is stored. What must hold, in one sentence: **one attachment has one stored description, and it lives only under its owner's prefix**. That is this chapter's invariant.

It can break in several ways. A user who presses a button twice sends the same request twice at once. A client that will not wait for the answer retries. A function stops while it waits for the model. In none of these may two descriptions appear, or a half-written one stay behind.

Three prefixes separate what is kept where.

<<< @/examples/56-nova/src/media.ts{keys}

`u/` is where chapter 07 puts uploads. `g/` is for what a model generated, and `c/` holds a record that says "somebody is generating this now". This chapter calls that record a claim. Under every prefix, the second part is the owner.

What the code asks of the place it stores things in comes to these five operations.

<<< @/examples/56-nova/src/media.ts{port}

`putIfAbsent` and `replaceIfMatch` are the ones that matter. In both, the store checks the condition and writes as a single step. In S3 that is a header on `PutObject`.

<<< @/examples/56-nova/src/s3-media.ts{conditional}

A write with `If-None-Match: *` succeeds only when nothing is stored under the key yet. If two writes to the same key arrive together, the one that finishes first succeeds and the other is refused with 412. `If-Match` overwrites when the object's ETag is still the one that was read, and refuses with 412 when it has changed. The documentation adds that a 409 can come back when a delete and a conditional write overlap. This code reads both 412 and 409 as "the condition did not hold".

When two requests arrive at the same moment, this is what happens.

```figure
caption: Of two requests that arrive together, only the one that wrote the claim calls the model
type: sequence
actor a: Request A
actor s3: S3
actor model: Bedrock
actor b: Request B
step a -> s3: look for a description
step b -> s3: look for a description
step a -> s3: write the claim
step b -x s3: write the claim, 412
step b -> b: answer 202
step a -> model: Converse
step model --> a: the description
step a -> s3: write the description
step a -> s3: delete the claim
step b -> s3: read with GET
note s3: one under g/
```

The work has five steps. The first two are checks that write nothing.

<<< @/examples/56-nova/src/describe.ts{check}

If a description is already there, it is returned and that is all. Only the first request ever costs money. If there is none, the upload itself is checked. The key read here is built from the caller's prefix, so another person's upload can only look like "nothing there".

Next, the work is claimed.

<<< @/examples/56-nova/src/describe.ts{claim}

A claim carries an expiry. This chapter calls the time until then the lease. A request that could not write the claim reads the one that exists, and if it has time left, answers `in_progress` and stops. If it has expired, the earlier run is taken to have died and its claim is taken over. Taking over is an overwrite with `If-Match`, so of two requests that find the same expired claim, only one can take it.

The lease is longer than the longest the model is waited for. If it were shorter, a second run would start while the first was still waiting. In this chapter's settings the model is waited for at most 30 seconds, the function times out at 40, and the lease is 60. A function that Lambda has stopped is no longer running by the time its claim is taken over.

The fourth step calls the model.

<<< @/examples/56-nova/src/describe.ts{call}

If the model fails, the claim is deleted and the failure is returned. Nothing retries here. For a passing failure such as throttling, the caller sends the request again and a new run takes the claim afresh. Failures are classified by chapter 17's function, unchanged.

The claim is deleted only while the run's own lease still has time left. After that, the claim may be one that another run has taken over.

The last step stores the result.

<<< @/examples/56-nova/src/describe.ts{store}

The description is written with `If-None-Match` too. This one line is what keeps the invariant. The claim only saves the cost of calling the model twice, and correctness does not rest on it. Say one run takes longer than its lease, another takes over, and both receive an answer from the model. The description written first is stored. The one that tries to write second is refused with 412, reads the stored one, and returns that. The model is paid for twice, but there is one description, and both callers receive the same one.

The tokens a call paid the model for come back in `billed`, also when its own answer was thrown away. The app writes this to the log, so when the number of stored descriptions and the number of model calls drift apart, the log shows why.

The function behind GET writes nothing and calls no model.

<<< @/examples/56-nova/src/describe.ts{read}

## What is stored

<!-- section: 56.stored -->

What is stored is the description and a record of where it came from.

<<< @/examples/56-nova/src/describe.ts{document}

Nova Canvas put a watermark in the images it generated. Text gets no such mark. Once stored, text a model wrote cannot be told from text a person wrote, so if the difference matters, the app has to record it itself. This chapter puts the model ID, the prompt's version, the key and ETag of the image that was described, the tokens used and the time of creation in the same object as the description. With that record, a job such as "regenerate only the descriptions an old model wrote" becomes possible after you change models.

A model's answer is treated as data from outside, like an HTTP request. An answer that does not fit the schema, an empty text, and a text over 1,000 characters are not stored. Neither is an answer cut off at `maxTokens`. Whatever lands under this key is served as the description from then on, so a failure is returned in preference to keeping a broken sentence. A failed call was still billed by the model, and `billed` says how much.

A refusal, on the other hand, is stored. Converse's `stopReason` has the value `content_filtered`, which says the model did not answer because of the content. Handing over the same image again is not expected to change that, so a result called `refused` is put where a description would go, and the model is not called a second time. What a Nova model actually answers when it declines an image could not be confirmed from the documentation, however. `content_filtered` is a value listed in the API reference, and this chapter's fixture was written by hand with it.

The Nova guide says a model's output may be inaccurate or inappropriate and should be evaluated before it is shown to end users. All this chapter does to the output is limit its length and store it as text. Whatever displays it must treat it as characters. Put in an `alt` attribute or a text node, words from inside an image that pass through the model into the output are never run by a browser. To inspect input and output with a separate mechanism, chapter 36's guardrails are available: according to its model card, Nova 2 Lite supports them.

As in chapter 17, the call to the model sits behind an interface.

<<< @/examples/56-nova/src/model.ts{gateway}

<<< @/examples/56-nova/src/bedrock.ts{bedrock}

Unlike chapter 17's `ConverseStream`, this uses `Converse`. The whole answer comes back in one response, so there is no stream to read. The SDK is held to one attempt, to keep a single path: a failure gives the claim back and ends.

## The owner's place

<!-- section: 56.owner -->

The second half of the invariant was about place. What is generated is put only under its owner's prefix, and nobody else can read it. How the keys are built is what makes that so.

The owner is not decided from anything in the request. It is decided from the signature the function URL checked.

<<< @/examples/56-nova/src/identity.ts{owner}

As in chapter 17, the function URL's authentication is `AWS_IAM`. Lambda checks the signature before it runs the function and writes the signer's ID into the event. An IAM ID can contain a colon and a session name, which cannot be part of a key as they are, so it is hashed. When this goes into the notes app, the owner becomes the user's ID from chapter 06's sign-in. A Cognito `sub` can be part of a key as it is, so no hash is needed.

Only the note's ID and the attachment's ID are read from the path.

<<< @/examples/56-nova/src/app.ts{parts}

Both IDs are checked with chapter 07's `isKeySegment`. With `..` or `/` in them, or `%2F` standing for it, the key would point outside the owner's prefix. The refusal is the same 404 as for a missing attachment, so that someone who knows another person's attachment ID cannot learn from the answer whether it exists.

There are three routes.

<<< @/examples/56-nova/src/app.ts{routes}

PUT means "make sure a description exists", and it is the only route that can call the model. Calling it any number of times gives the same result, which is why it is PUT. GET only reads what is stored, and DELETE removes the description alone. Deleting the upload is the job of chapter 07's API.

A result becomes an HTTP response like this.

<<< @/examples/56-nova/src/app.ts{answer}

While another request is generating, the answer is 202 with `Retry-After`. The caller waits a little and asks again with GET. What goes back to the caller has a schema.

<<< @/examples/56-nova/src/contract.ts{answers}

`reused` is `true` when this request did not call the model. The key and the ETag of the stored image are not returned to the caller.

## Switching to a cheaper model

<!-- section: 56.cheaper -->

Chapter 17 used Nova 2 Lite for its summaries. The family has cheaper models. Here are the unit prices in the Tokyo Region, in USD per 1,000 tokens, as checked in the AWS Price List on 2026-10-13.

| Model | Input | Output |
| --- | --- | --- |
| Nova 2 Lite | 0.000396 | 0.003311 |
| Nova Pro | 0.00096 | 0.00384 |
| Nova Lite | 0.000072 | 0.000288 |
| Nova Micro | 0.000042 | 0.000168 |

The calculation is multiplication and nothing more.

<<< @/examples/56-nova/src/cost.ts{cost}

Under the same assumptions as chapter 17's table, 1,000 summaries a month at 2,000 input tokens and 150 output tokens each, inference costs USD 1.29 on Nova 2 Lite, USD 0.19 on Nova Lite and USD 0.11 on Nova Micro. Nova Lite comes to about a seventh of Nova 2 Lite. The unit prices differ by 5.5 times for input and 11.5 times for output, so the gap widens the more the model writes. Tokenizers differ by model, so the same text does not always come to the same number of tokens. Read this as a comparison of unit prices.

Choosing the cheaper one gives something up. According to the model cards, Nova Lite has a context of 300K tokens, a maximum output of 10K tokens, and training data up to October 2024. For Nova 2 Lite those are 1M, 64K and October 2025. None of that matters to a short summary. What does matter is the earliest end of life in the table on the first page: Nova Lite is already past the date before which it was promised not to end. And the quality of the output cannot be read from a unit price. This chapter does not compare it. Before you switch, compare the results on your own notes. Chapter 36 shows how to build an evaluation that checks output for fixed input.

Switching also changes what IAM has to name.

<<< @/examples/56-nova/src/catalog.ts{arns}

Nova Lite can be called In-Region in Tokyo, so no inference profile is involved. The policy names one ARN, the model in the Tokyo Region, and inference is never handled outside Tokyo. With the `jp.` profile the policy has to name the model in Tokyo and Osaka, and with the `apac.` profile in six Regions that include Seoul, Mumbai, Singapore and Sydney, and data is handled across the same range. If there are rules about where data may be processed, check this before the price.

For describing images the difference works out otherwise. Nova 2 Lite bills an image at a flat 230 tokens, while on Nova Lite it comes to about 800 to 2,600 tokens depending on resolution. At 1,300 tokens an image, the input costs USD 0.000094 on Nova Lite and USD 0.000091 on Nova 2 Lite, which is almost the same. The difference is in the output.

This chapter's stack takes another model for descriptions with `-c describeModel=amazon.nova-lite-v1:0`. For summaries, pass `BEDROCK_MODEL_ID=amazon.nova-lite-v1:0` to chapter 17's development server and the same code runs unchanged. Chapter 17's stack refuses an ID that is not in its own list, so trying it deployed means adding the ID there first. Both call a real model and are billed, and neither has been run at the time of writing.

Nova Micro is the cheapest model, but no ID for calling it from Tokyo has been confirmed. If `vp run nova:models` finds a profile, add it to the list before you use it.

## The model that talks

<!-- section: 56.speech -->

Nova 2 Sonic takes speech and answers in speech. Such a model is called speech-to-speech. This chapter does not call it, so what follows is only what the documentation states.

The one API it speaks is `InvokeModelWithBidirectionalStream`. It cannot be called with Converse. The client and the model keep one stream open and send audio both ways. According to the API reference, the stream stays open for 8 minutes, and a user can cut into the model's speech with a new prompt. The model card has it In-Region in the Tokyo Region. The default is 20 sessions open at once per account and Region, and the card says that quota cannot be raised.

In the Tokyo Region, speech input costs USD 0.00363 per 1,000 tokens and speech output USD 0.01452. Text passed to it costs the same as on Nova 2 Lite.

It was left out of the notes app for two reasons. One is language. The guide's table of voices has English, French, Italian, German, Spanish, Portuguese and Hindi, and Japanese is not in it. The other is shape. This chapter's function takes a request, returns a response, and ends. A bidirectional stream that stays open for minutes does not fit that shape. It needs a server in between, running somewhere that keeps running, such as chapter 12's containers. That second reason is not a statement from the documentation. It is a conclusion from the shape of the API.

If all you want is to have a note read aloud, Polly in [chapter 57](/en/chapters/57-polly.md), which makes speech from text, fits better. Calls between people are in [chapter 51](/en/chapters/51-chime-sdk.md).
