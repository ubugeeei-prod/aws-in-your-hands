---
title: "56 Nova: Costs, Pitfalls, and Cleanup"
---

# 56 Nova: Costs, Pitfalls, and Cleanup

With the [deploy](/en/chapters/56-nova/deploy.md) done, this page sets out how this differs from doing the same thing on Cloudflare or Vercel and what the chapter costs, and then cleans up what you built.

## If you're coming from Workers AI or Vercel

<!-- section: 56.compare -->

As of 2026-10-13, the model catalog of Cloudflare's Workers AI has categories for models that make text from an image, models that make an image from text, text to speech, and speech recognition, and it lists text generation models that accept images. No category for generating video was found. The way to call them is as chapter 17 compared it: one line of binding, and you call a model without thinking about permissions or Regions.

Vercel does not run models itself. Its AI Gateway passes requests on to model providers. The documentation lists what it handles as text, image generation, video generation, speech, transcription, realtime and embeddings.

If generating images is all you want, there is no reason to pick Nova on Bedrock today. Nova has no model that generates, and the Workers AI catalog does. An app that already runs there should simply use it.

What gives a reason to pick Nova on Bedrock is the rules around the call. You can narrow the models a function may call down to one, by ARN. You can choose to have inference handled in Tokyo only, or inside Japan only. You can have a model read an image in S3 with the function's role, without the image passing through the function. The place where the output goes accepts conditional writes, so "store exactly one" can be written without a queue or a table. In exchange, you keep track yourself of which ID can be called, where it is processed, and how long it will last. Half of this chapter's code was for that.

## Costs

<!-- section: 56.cost -->

Amounts are in USD, for the Tokyo Region, on-demand, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which nobody calls it costs 0.** Neither the function URL, nor Lambda, nor Bedrock's on-demand pricing charges for merely existing. The bucket is billed for the objects in it. A description is under 1 KB, so 1,000 of them are about 1 MB, and their S3 storage comes to less than USD 0.0001 a month. Logs are gone after 7 days.

For a month with calls, assume 1,000 images, each described once, at 320 input tokens and 60 output tokens per image. Of the input, 230 is the flat rate for one image and the other 90 are an estimate for the two prompts. Check the real numbers in `billed` on the `describe` lines of the log.

| Item | Quantity | List price | After the monthly free tier |
| --- | --- | --- | --- |
| Nova 2 Lite input | 320,000 tokens | 0.13 | 0.13 (no free tier could be confirmed; none deducted) |
| Nova 2 Lite output | 60,000 tokens | 0.20 | 0.20 (same) |
| Lambda requests | 1,000 | 0.00 | 0 |
| Lambda duration | 750 GB-seconds | 0.01 | 0 |
| S3 writes | 2,000 | 0.01 | 0.01 |
| S3 reads | 3,000 | 0.00 | 0.00 |
| CloudWatch Logs ingestion | 0.001 GB | 0.00 | 0 |
| Subtotal | | **0.35** | **0.34** |

Lambda's duration assumes 3 seconds per image on average. The function is running, and billed, while it waits for the model. S3 requests are counted as 2 writes per image (the claim and the description) and 3 reads. One of the reads stands for Bedrock fetching the image, assumed to be a single request. How many requests that really is, and who is billed for them, has not been confirmed. Data transfer is not in this table. That means not included, not zero.

A second or later PUT for the same image does not call the model. It costs one Lambda invocation and one S3 read.

A ceiling can be calculated too. Output is at most 300 tokens per image, so even if all 1,000 wrote up to the limit, inference would cost USD 1.12. A single call costs at worst USD 0.0011 for inference and USD 0.00013 for a Lambda function that stops at 40 seconds.

**There is no limit on how many.** Only someone who can sign may call this URL, but if that someone uploads different images one after another and has each described, every one is paid for. Deleting a description and making it again, over and over, does the same. Stopping that takes a limit per user. Chapter 36 shows how to build one.

The comparison for a different model is under "Switching to a cheaper model" in Design and Build. For chapter 17's month of 1,000 summaries, inference costs USD 1.29 on Nova 2 Lite, USD 0.19 on Nova Lite and USD 0.11 on Nova Micro.

Some things could not be confirmed: whether Bedrock has a free tier, and how much of a call that is aborted partway is billed. Neither could be confirmed from a primary source, so both are stated as unknown.

Destroying the stack stops this chapter's charges.

## Where things go wrong

| If this happens | Look here |
| --- | --- |
| `dev:nova` stops with `Invalid environment` | Check that `examples/56-nova/.env` exists. `NOVA_BACKEND` has no default. If a `DESCRIBE_MODEL_ID` line is shown, that ID is not in the list or has ended |
| The synth stops on `describeModel` | The ID you passed is not a route from Tokyo that can describe an image. Choose one from the last list `vp run nova:catalog` prints |
| PUT answers 404 with `attachment_missing` | There is no upload under your own prefix. With the value `GET /me` returns, check that the key is `u/<owner>/<note>/<attachment>` |
| PUT answers 422 with `unsupported_image` | The format is none of PNG, JPEG, GIF and WebP, or the object is over 5 MB. Check the `Content-Type` stored in S3 |
| PUT keeps answering 202 | An earlier run may have stopped and left its claim. Once the 60-second lease has passed, the next PUT takes over |
| PUT answers 500 with `misconfigured` | The role cannot call that model, or the model ID was not found. Check with `vp run nova:models` that the route still exists. Which error a call to a retired model returns has not been confirmed |
| PUT answers 502 with `bad_output` | The answer was cut off or empty. `billed` in the log shows how far it got. If it keeps happening, review `MAX_OUTPUT_TOKENS` |
| PUT answers 429 with `throttled` | The account's quota was exceeded. Wait a little and send the same PUT |
| The function URL answers 403 | The request is unsigned, or the caller lacks `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` |

Which error Bedrock returns when the model cannot read the image in S3 has not been confirmed. Removing `s3:GetObject` from the role and trying would show it, but this chapter did not go that far.

## For production

- Make the owner the user's ID from chapter 06's sign-in. This chapter's function URL can be called only by an AWS principal that can sign. To use it from a browser, put it behind the same authorizer as chapter 07's API, and use chapter 07's bucket
- Build a limit per user. The only limit now is the output limit of a single call
- Delete the description when the upload is deleted. Chapter 08's housekeeping clears uploads that no record points at. Have it look at `g/` in the same place
- Follow the end of models. Chapter 20 has a workflow that checks drift on a schedule. Add `vp run nova:models` to it, and a route that disappears from the list shows up as a failure. Nova Canvas and Nova Reel had six months from notice to end
- Decide what happens to old descriptions when you change the model or the prompt. The stored record has `modelId` and `promptVersion`, so you can select what to regenerate. Regenerating costs as much as that many images
- Decide how output is checked before people see it. The Nova guide recommends evaluating output before showing it to end users. This chapter looks only at its length
- Decide where data may go. The `jp.` profile is processed inside Japan, `apac.` in six Regions, and `global.` anywhere in the world. An attached image can show something more personal than the text of a note
- Change the bucket's removal policy to `RETAIN`. With the `DESTROY` used for practice, destroying the stack deletes the descriptions
- Make the AWS CDK CLI and CloudFormation the path for changes, as chapter 02 explained

## Cleanup

<!-- section: 56.cleanup -->

The pinned cdkd does not delete a bucket that has anything in it. Empty the bucket first.

```bash
vp run nova:empty
vp run nova:empty --yes
vp run nova:infra:destroy
```

The first line only counts the objects and deletes nothing. The second deletes every upload, description and claim. The third deletes the bucket, the function, the function URL, the role and the log group.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. On the Bedrock side, this chapter created no resource.

::: details Verification notes for this chapter

**Checked locally.** The unit tests (98 tests: the list, the cost arithmetic, building the request and its limits, how runs of the describing job overlap, the app, the shape of the requests sent to S3, the stack), the type check, and the synth (with the esbuild bundle; 7 resources) were run. `dev:nova` was started with `NOVA_BACKEND=scripted` and driven as the `curl` commands in the text show, and the 202, the 200, the `reused` answer and the log were confirmed. The output of `nova:catalog` in the text is from a real run. Two things were confirmed in the npm distributions. The pinned `@aws-sdk/client-bedrock-runtime` (3.1149.0) declares `format` and `source` on an image block, `bytes` and `s3Location`, and `bucketOwner`. The pinned cdkd (0.296.28) registers a dedicated implementation for all 7 resource types of this stack (`AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`).

**Not checked yet.** This chapter has never called real Bedrock, and nothing has been deployed to AWS. `nova:models`, `nova:hello`, `dev:nova` with `NOVA_BACKEND=bedrock`, `nova:infra:deploy`, `nova:smoke`, `nova:infra:drift`, `nova:empty` and `nova:infra:destroy` have not been run. These points in particular wait for a real environment.

- That `src/catalog.ts` matches what an account sees. It was written from the model cards and the lifecycle pages only. The ID for calling Nova Micro from Tokyo could not be confirmed, because the card's table and its list of IDs disagree
- Whether Nova 2.0 Pro, Nova 2.0 Omni and Nova 2.5 Sonic, which have rows only in the Price List, can be called
- That `jp.amazon.nova-2-lite-v1:0` can read an image passed by S3 URI. Whether an image in a Tokyo bucket can be read when inference is handled in Osaka could not be confirmed from the documentation either
- That a real `Converse` response has the shape of this chapter's fixtures, and that one image shows up as 230 tokens in `usage`
- What the model answers when it declines an image. Whether `stopReason` is `content_filtered` or something else could not be confirmed from the documentation
- That S3 conditional writes pass with this chapter's role, and that simultaneous requests create only one claim. This was tried against the in-memory stand-in only
- What `requestContext.authorizer.iam.userId` holds in the function URL's event for an assumed role
- The number of S3 requests Bedrock makes to fetch an image and who pays for them, the billing of a call aborted partway, and whether Bedrock has a free tier
- Nothing was run for Nova 2 Sonic. What is written comes from the model card, the guide, the API reference and the Price List
- The Workers AI model catalog was read through a summary of the page, not line by line

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The Nova family, The models that ended | `examples/56-nova/src/catalog.ts`, `test/catalog.test.ts` | `test:unit`, `nova:catalog` |
| The whole picture | `examples/56-nova/infra/lib/nova-stack.ts`, `src/app.ts` | |
| Keeping the list in code | `examples/56-nova/src/catalog.ts`, `scripts/catalog.ts`, `scripts/models.ts` | `nova:catalog`, `nova:models` |
| Passing an image to a model | `examples/56-nova/src/image.ts`, `scripts/hello.ts`, `test/image.test.ts` | `test:unit`, `nova:hello` |
| Generating once | `examples/56-nova/src/describe.ts`, `src/media.ts`, `src/s3-media.ts`, `test/describe.test.ts` | `test:unit` |
| What is stored | `examples/56-nova/src/describe.ts`, `src/model.ts`, `src/bedrock.ts` | `test:unit` |
| The owner's place | `examples/56-nova/src/identity.ts`, `src/app.ts`, `src/contract.ts`, `test/app.test.ts`, `test/adapters.test.ts` | `test:unit` |
| Switching to a cheaper model | `examples/56-nova/src/cost.ts`, `src/catalog.ts`, `test/cost.test.ts` | `test:unit`, `nova:catalog` |
| Running it locally | `examples/56-nova/src/dev.ts`, `src/scripted-model.ts`, `src/fixtures.ts`, `fixtures/converse/`, `src/env.ts`, `src/compose.ts`, `.env.example` | `dev:nova` |
| Tests | `examples/56-nova/test/`, `src/memory-media.ts`, `infra/test/nova-stack.test.ts` | `test:unit` |
| The stack | `examples/56-nova/infra/lib/nova-stack.ts`, `infra/bin/app.ts`, `src/lambda.ts`, `cdk.json` | `nova:infra:synth`, `test:unit` |
| Deploying and calling it | `examples/56-nova/scripts/smoke.ts`, `scripts/sign.ts`, `scripts/models.ts`, `tools/src/infra/` | `nova:infra:diff`, `nova:infra:deploy`, `nova:models`, `nova:smoke`, `nova:infra:drift` |
| Cleanup | `examples/56-nova/scripts/empty.ts`, `tools/src/infra/` | `nova:empty`, `nova:infra:destroy` |
| Costs | `data/pricing/`, `examples/56-nova/src/cost.ts` | `test:unit` |

**Primary sources** (all checked on 2026-10-13)

- [Models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html). Model cards: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html), [Nova Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html), [Nova Pro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html), [Nova Micro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html), [Nova 2 Sonic](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html), [Nova Multimodal Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-amazon-nova-multimodal-embeddings.html), [Nova Canvas](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-canvas.html), [Nova Reel](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-reel.html)
- [Model lifecycle](https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html), [Model lifecycle (Legacy)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.html). The table of models that have ended is on the second
- The Nova 2 guide: [What is Amazon Nova 2?](https://docs.aws.amazon.com/nova/latest/nova2-userguide/what-is-nova-2.html), [Multimodal understanding](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-multimodal-models.html), [Prompting multimodal inputs](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-multimodal.html), [Using Amazon Nova embeddings](https://docs.aws.amazon.com/nova/latest/nova2-userguide/embeddings.html), [Speech-to-Speech](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-conversational-speech.html), [Language support](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-language-support.html), [Release notes](https://docs.aws.amazon.com/nova/latest/nova2-userguide/release-notes.html), [Responsible use](https://docs.aws.amazon.com/nova/latest/nova2-userguide/responsible-use.html). The landing page, [Amazon Nova Documentation](https://docs.aws.amazon.com/nova/)
- The guide for the first version of Nova: [Image understanding](https://docs.aws.amazon.com/nova/latest/userguide/modalities-image.html), [Generating images with Amazon Nova Canvas](https://docs.aws.amazon.com/nova/latest/userguide/image-generation.html), [Video generation access and usage](https://docs.aws.amazon.com/nova/latest/userguide/video-gen-access.html). The last two are pages for retired models that are still published
- [Inference using Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html). The permission needed for an S3 URI and `bucketOwner` are here
- API reference: [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html), [ImageBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html), [S3Location](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_S3Location.html), [MessageStopEvent](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html), [StartAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_StartAsyncInvoke.html), [GetAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GetAsyncInvoke.html), [InvokeModelWithBidirectionalStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithBidirectionalStream.html)
- [Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html), [Supported Regions and models for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)
- [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- AWS Price List bulk API: [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json) (published 2026-10-10). It still has rows for the retired Nova Canvas and Nova Reel, and rows for models that have no model card
- Cloudflare: [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/). Vercel: [AI Gateway](https://vercel.com/docs/ai-gateway)
- [@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0), [@aws-sdk/client-bedrock 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock/v/3.1149.0), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the type definitions and source of the installed distributions were read)

:::
