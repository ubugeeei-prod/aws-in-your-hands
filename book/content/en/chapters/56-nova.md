---
title: "56 Nova: Text, Images, Video, and Speech with Amazon's Models"
sourceRevision: 1
---

# 56 Nova: Text, Images, Video, and Speech with Amazon's Models

Nova is not the name of one model. It is a family of models that Amazon offers on Bedrock, and each one differs in what it takes as input, which API you call it with, and which ID you use from Tokyo. The family also changes. In this chapter you keep the models that can be called today as a dated list in code, pick one from it, and use it to write a description of an image attached to a note.

One thing has to be said first. The chapter's title mentions images and video, but Nova Canvas, which generated images, and Nova Reel, which generated video, left Bedrock on 2026-09-30. The first Nova Sonic, which held a conversation in speech, ended on 2026-09-14. As of 2026-10-13, when this chapter was written, no model in the Nova family generates an image or a video. Images and video remain only as input that a model reads. So this chapter has no walkthrough for generating either. It says briefly what the retired models were, so that you can read an existing account or old code that still names them.

How a model is called at all, meaning Converse, inference profiles and retries, was the subject of [chapter 17](/en/chapters/17-ai.md). Tool use and guardrails are in [chapter 36](/en/chapters/36-bedrock.md). What this chapter adds is passing an image as input, choosing a different model, and generating something once and storing it where its owner's data lives.

As in chapter 17, nothing on your machine calls a model. The tests and the default development server replay answers written by hand and do not touch AWS. Every task that is billed says so where it appears.

You need chapter 17 and [chapter 07](/en/chapters/07-uploads.md), which built the image upload. The code is in `examples/56-nova/`.

## The Nova family

<!-- section: 56.family -->

The table below is what the Bedrock model cards said on 2026-10-13. A model card is the page the user guide has for each model: what it takes and returns, which APIs it speaks, its IDs, the Regions it can be called from, and its earliest end of life.

| Model | Input to output | API | How to call it from the Tokyo Region | Context and maximum output | No end of life before |
| --- | --- | --- | --- | --- | --- |
| Nova 2 Lite | Text, images, video to text | Converse, InvokeModel | The `jp.` profile (Tokyo or Osaka) or the `global.` profile. Not In-Region | 1M and 64K tokens | 2026-12-02 |
| Nova Lite | Text, images, video to text | Converse, InvokeModel | In-Region (the model ID as it is) or the `apac.` profile (6 Regions) | 300K and 10K tokens | 2025-12-05 |
| Nova Pro | Text, images, video to text | Converse, InvokeModel | The `apac.` profile only | 300K and 10K tokens | 2025-12-05 |
| Nova Micro | Text to text | Converse, InvokeModel | No ID confirmed | 128K and 10K tokens | 2025-12-05 |
| Nova 2 Sonic | Speech, text to speech, text | InvokeModelWithBidirectionalStream | In-Region | 1M and 64K tokens | 2026-12-02 |
| Nova Multimodal Embeddings | Text, images, video, audio to embeddings | StartAsyncInvoke | Cannot be called (us-east-1 and GovCloud only) | Not stated | 2026-10-28 |

The last column is the card's "EOL no sooner than". It is a promise that the model will not end before that date, not the date it ends. Nova Lite, Nova Pro and Nova Micro are already past theirs. They are still Active, which means only that a retirement can be announced any day. When it is, the model becomes Legacy, and at least six months remain from then to the end. Once a model is Legacy, though, new customers cannot start using it.

Three things in the table are unclear.

Nova Micro is marked Geo for Tokyo in the Region table of its card. Yet the profile IDs listed on the same page start only with `us.` and `eu.`, and none is given for calling it from Tokyo. This chapter does not count a model as callable when its ID cannot be confirmed.

Nova Multimodal Embeddings has only StartAsyncInvoke marked in the API column of its card, while the Nova 2 guide shows the same model called synchronously with InvokeModel. Either way it cannot be called from Tokyo, so this chapter does not use it. Embeddings and search are in [chapter 27](/en/chapters/27-search.md), with a model that Tokyo can call.

Nova 2 Lite can also read documents such as PDFs, according to the guide. The card's list of inputs has no entry for documents, so the table leaves them out.

The documentation also disagrees with itself in one more place. The landing page of the Nova documentation names Omni and Pro in its description of Nova 2.0. The AWS Price List has rows for Nova 2.0 Pro, Nova 2.0 Omni and Nova 2.5 Sonic. The user guide for the first version of Nova still lists Nova Premier. None of them has a model card, and the Nova 2 guide lists three models only: Nova 2 Lite, Nova 2 Sonic and Nova Multimodal Embeddings. This chapter treats a model as callable only when it has a model card. A row in a price list is not evidence that a model can be called.

## The models that ended

<!-- section: 56.retired -->

A model on Bedrock moves from Active to Legacy to End-of-Life. The lifecycle page has a table of models that have passed their end date, and on 2026-10-13 it carries four Nova IDs.

<<< @/examples/56-nova/src/catalog.ts{retired}

The same page says these models have been removed from the Regions listed, and that requests to them fail. Nothing migrates you to a newer model. Changing the model ID is the job of whoever uses it.

Here is what each one was, for when you meet it in old code or an old article.

Nova Canvas took text or an image and returned an image. You called it synchronously with InvokeModel, and the image came back inside the response. According to its guide, it put an invisible watermark in every image it generated and supported Content Credentials for provenance.

Nova Reel made video from text or an image. Generating video takes time, so it was called asynchronously with StartAsyncInvoke. The call returned at once, and Bedrock later created a folder per invocation at the S3 location you named and put `output.mp4`, `manifest.json` and a status file in it. The guide gives about 90 seconds for a 6-second video.

Nova Sonic took speech and answered in speech. Its successor, Nova 2 Sonic, can be called in Tokyo as the table shows, and the end of [Design and Build](/en/chapters/56-nova/build.md) comes back to it.

To generate images or video on Bedrock today, you would look for a model from another provider in the list of model cards. Which of them can be called from Tokyo was not checked for this chapter.

The StartAsyncInvoke API itself is still there. Within Nova, Multimodal Embeddings uses it to embed long video and audio in segments. According to the API reference, a call takes a `clientRequestToken` to prevent duplicates, and an invocation's status is `InProgress`, `Completed` or `Failed`. Generating something slow asynchronously and leaving the result in S3 did not disappear with Reel. Two questions always come with that shape, and they are what the second half of this chapter is about. What happens to the output when the same work finishes twice? Whose place is the output put in, and who can read it?

The code in this chapter refuses the ID of a retired model when the process starts, not at the first request. Write `amazon.nova-canvas-v1:0` in the environment, for example, and the process prints that the model ended on 2026-09-30 and stops.

## The whole picture

<!-- section: 56.architecture -->

```figure
caption: The function has the model read an upload under the caller's prefix, and stores exactly one description under the same person's prefix
node caller: Caller | a signed request
node url: Lambda function URL | ap-northeast-1, AuthType: AWS_IAM
node fn: Lambda function | Node.js 24, arm64, 256 MB, 40 s timeout
node bedrock: Amazon Bedrock Converse | inference profile jp.amazon.nova-2-lite-v1:0
node s3: S3 bucket | u/ uploads, g/ descriptions, c/ claims
edge caller -> url: HTTPS, signed with SigV4
edge url -> fn: the signer's ID
edge fn -> bedrock: the image's S3 URI, a question
edge fn -> s3: conditional writes
edge bedrock -> s3: reads with the function's role
mark fn
```

What you build is an API that gives alternative text to an image uploaded in chapter 07. Alternative text is a description of an image in words for a reader who cannot see it, and in HTML it goes in the `alt` attribute of an `img` element.

The way in is a function URL, as in chapter 17. Two things differ: the model's answer is not sent back piece by piece, and there is an S3 bucket. A description is a sentence or two, so it is returned whole once it exists. And a description that was made once is stored in S3, so that a second question about the same image is answered from the stored copy without calling the model. An image that has not changed gives no reason to change its description, so the same answer is not paid for twice.

No queue and no table were added. Both "somebody is generating this now" and the finished description are objects in S3. That few parts are enough because S3 accepts conditional writes, which Design and Build explains.

You may want the description to be made automatically right after an upload. In that case the worker behind the queue of [chapter 08](/en/chapters/08-async.md) can call this chapter's `ensureDescription`. It is written to give the same result however many times it is called, so a message the queue delivers twice does no harm. This chapter does not wire that up.

## Keeping the list in code

<!-- section: 56.catalog -->

A model ID written straight into configuration as a string leaves what that ID accepts, whether Tokyo can call it, and how long it will last in the memory of whoever wrote it. This chapter puts what the model cards said in one typed file, and both the app and the CDK stack choose a model from it.

<<< @/examples/56-nova/src/catalog.ts{types}

A `Route` is a way to call the model from the Tokyo Region. There are the three kinds chapter 17 explained, In-Region, Geo and Global, and `id` is the value passed as `modelId`. A model with no route cannot be called from Tokyo.

The routes that fit a use are found from the inputs, the output and the API.

<<< @/examples/56-nova/src/catalog.ts{lookup}

Describing an image needs a model that takes an image and text, returns text, and can be called with Converse. In the list of 2026-10-13 that finds five routes: `jp.` and `global.` for Nova 2 Lite, In-Region and `apac.` for Nova Lite, and `apac.` for Nova Pro. The default is `jp.amazon.nova-2-lite-v1:0`, the same as chapter 17.

The earliest end of life is a function that compares against a date.

<<< @/examples/56-nova/src/catalog.ts{lifecycle}

One task prints the list against today's date. It runs on your machine only and does not call AWS.

```bash
vp run nova:catalog
```

The list was written from documentation, though, and is not what your account answered. Another task asks the account.

```bash
vp run nova:models
```

`nova:models` calls Bedrock's `ListFoundationModels` and `ListInferenceProfiles` in the Tokyo Region, prints the Nova models and profiles, and compares them with the list. It ends in failure when a route in the list is missing on the account's side. It calls no model, so no inference is billed, but it needs AWS credentials. It has not been run at the time of writing. Where the documentation alone could not settle a point, such as the ID for Nova Micro, let the output of this task settle it.
