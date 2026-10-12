---
title: "57 Polly: Costs, Pitfalls, and Cleanup"
---

# 57 Polly: Costs, Pitfalls, and Cleanup

The [previous pages](/en/chapters/57-polly/build.md) produced a read-aloud API that synthesizes each text only once, and its tests. This page covers the deploy steps, the cost, what is sent to AWS, how Cloudflare and Vercel differ, the pitfalls, and the cleanup.

## Deploy and check

<!-- section: 57.deploy -->

The steps in this section were not run against AWS.

```bash
vp run polly:infra:diff
vp run polly:infra:deploy
```

The deploy prints `FunctionUrl`, `CacheBucketName`, and `HandlerLogGroupName` as stack outputs. The documentation that was read mentions no sign-up or activation step before Polly can be used.

Check it with the next task. **It is billed.** It sends a short note of about 70 characters.

```bash
vp run polly:listen
```

The script first makes sure an unsigned request is refused with 403, then sends the same note twice, signed. The note carries the time of the run, so the first request is always new text. It has worked if `billedCharacters` is above 0 the first time and 0 the second, with `source` equal to `cache` for every part. If the second request was synthesized, the script ends in failure. Last, it fetches the audio URLs and prints each one's `Content-Type` and size. Open the URL it prints in a browser to hear the voice.

Add `--voice Mizuki` to try a standard voice. Compare the first `billedCharacters` with the length of the text that was sent: that is where you learn how Polly counts characters.

Requests that arrive together are hard to check by running the script in two terminals at the same instant, because the time in the text makes the two runs different texts. To check it, change the text in `scripts/listen.ts` to a fixed new one, run two at once, and look at the total of `synthesized` in the function's log.

The drift check is the same as in the other chapters.

```bash
vp run polly:infra:drift
```

## Cost

<!-- section: 57.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

**A month in which nobody listens costs 0.** The function, the function URL, an empty bucket, and Polly itself carry no charge for merely existing. A test on the stack checks that the template holds no resource type billed by the hour or the month.

Polly's unit prices in the Tokyo Region are 0.000016 per character for neural (16 per million) and 0.000004 per character for standard (4 per million), from the AWS Price List as read on 2026-10-13. Synthesizing the longest note (a title of 120 characters and a body of 10,000) once with a neural voice is 10,120 × 0.000016, about 0.16.

Here is a month in which people listen. Assume "listen" is pressed 1,000 times, a note averages 600 characters, and for 300 of the presses the text was already in the cache.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| Polly (neural) | 420,000 characters | 6.72 | 6.72 (no free tier subtracted) |
| Lambda requests | 1,000 | 0.0002 | 0 |
| Lambda duration | 547.5 GB-seconds | 0.01 | 0 |
| S3 PUT | 2,800 | 0.01 | 0.01 |
| S3 HEAD and GET | 4,000 | 0.00148 | 0.00148 |
| S3 storage | 0.21 GB-months | 0.01 | 0.01 |
| Transfer to the internet | 0.3 GB | 0.03 | 0.03 |
| Log ingestion | 0.00095 GB | 0.000722 | 0 |
| Subtotal | | **6.78** | **6.77** |

The subtotal, and the rows of 0.01 and above, are rounded to the cent. No free allowance for S3 or for transfer could be confirmed, so none is subtracted.

Nearly all of it is Polly, and the Polly row is the only one the cache touches. Without the cache, 1,000 listens of 600 characters would cost 9.60. With it, 6.72. The more often the same note is heard again, the wider the gap, and if nobody listens twice there is none. With a standard voice the Polly row is 420,000 × 0.000004, which is 1.68.

Not one assumption in this table was measured. The share of cache hits, the time a synthesis takes (3 seconds), and the size of the audio (0.3 MB a listen) are numbers that were put there. How Polly counts characters was not confirmed either, so one character of text is counted as one. If a Japanese character counts as more than one, the Polly row grows by that much.

No free tier is subtracted. The pricing page lists 5 million characters a month for standard voices and 1 million a month for neural voices (for the first 12 months), and the same page says accounts created since July 15, 2025 receive credits in place of a free tier. Which one your account has is shown in the billing console.

The pricing page states that synthesized speech can be stored and replayed at no additional cost. This chapter's cache is that use.

## What is sent to AWS, and what stays

<!-- section: 57.privacy -->

A note is something a person wrote for themselves. Pressing "listen" sends that text out of the app. This section says where it goes and where it stays.

**The text sent to Polly.** The title and the body go to Polly as they are. Polly's FAQ, as of 2026-10-13, says Polly may store the text it processes and use it to provide and maintain the service and also to improve Polly and other machine-learning technologies. The content is stored in the Region in use, and the FAQ adds that some of it may be stored in another Region for that improvement. To stop this use, set an AI services opt-out policy in AWS Organizations. Opting out also deletes what was stored for improvement. What an account outside an organization should do was not checked beyond the FAQ's mention of contacting AWS Support.

The data protection page of the developer guide recommends never putting sensitive information, such as a customer's account number, into free-form fields, because what is entered might be picked up for diagnostic logs. The app cannot choose what a note contains, so this caution has to be passed on to the user. A line next to the button saying that the text is sent to a speech service is the least to do.

**The audio that stays in S3.** The audio is the note's content kept in another form. When a note is deleted, its audio stays until 30 days after it was synthesized. The key is a hash, so there is no way from the note to its audio. If it must go at once, compute the same keys when the note is deleted and delete the objects, or shorten the cache's lifetime. The first has to happen before the note's body is gone, and it also removes the audio of any other user who holds the same text. This chapter does not build it.

**Presigned URLs.** Anyone who has a URL can hear that audio until it expires, one hour later. The URLs appear only in the response body. They are not logged.

**Logs.** The function logs the voice, the number of parts, how many were synthesized, the characters billed, and the time taken. The text of the note is not logged. For an unexpected error only its name is written, because a service's error message can quote part of what was sent. A test checks that no text from the note appears in the log or in an error response.

## Coming from Cloudflare or Vercel

<!-- section: 57.platforms -->

What follows is from the official documentation as of 2026-10-13.

Cloudflare's Workers AI lists four text-to-speech models: Deepgram's `aura-1`, `aura-2-en` and `aura-2-es`, and MyShell's `melotts`. `aura-2-en` is priced at USD 0.03 per 1,000 characters and comes in an English and a Spanish model. `melotts` is priced at USD 0.000205 per minute of audio and takes the language in `lang`. The default is `en`, and the model's page does not list the languages it supports. Whether it can read Japanese was not confirmed.

For Vercel, the page that was read is the AI SDK's. The AI SDK has `generateSpeech`, which calls a speech model of a provider such as OpenAI and returns the audio bytes. Whether Vercel offers a text-to-speech model of its own was not checked.

The reasons to choose Polly are that it has Japanese voices, that SSML and lexicons let you correct how things are read, and that asynchronous synthesis writes straight to S3. If all you need is English text read aloud and your app is already on Workers, stay there.

The design of this chapter is the same on any service. Speech synthesis is billed on every call, and the result for the same input can be reused. Keying by a hash of the input, placing a claim before synthesizing, and keeping the user's text from being read as instructions are needed just the same with R2 and Workers AI. R2's conditional writes were not looked into.

## Pitfalls

| Symptom | Where to look |
| --- | --- |
| `EngineNotSupportedException` | The voice and the engine do not go together. Kazuha and Tomoko are neural only, Mizuki is standard only. Compare `src/voices.ts` with the list of voices in the documentation |
| `TextLengthExceededException` | A part is over the limit. With this chapter's way of counting it should not happen. If it does, Polly counts more than `billedSize` assumes: lower `MAX_BILLED_CHARACTERS` |
| `InvalidSsmlException` | The SSML that was sent is not valid. Look for a place where text went in without passing through `escapeSsml` |
| A 403 for audio that should simply be absent | The role lacks `s3:ListBucket`. Without permission to list, S3 answers a missing key with 403 and not 404 |
| 503 (busy) again and again | A claim is there and the audio is not. After 90 seconds the next request takes over. If it goes on, look for an error in the function's log |
| 429 (throttled) | Polly's quota was reached. Neural allows 8 requests a second. Several people hearing long notes for the first time at once will reach it |
| An audio URL answers 403 | The presigned URL has expired (one hour). Call `POST /speech` again. The audio is cached, so it costs nothing |
| Billed again though the text was not changed | The audio was removed by the 30-day lifecycle rule. A change in spaces or line breaks alone also makes it a different text |

## For production

- Put it behind user sign-in. This chapter's function URL accepts only calls with an IAM signature. For a browser, place the function behind [chapter 06](/en/chapters/06-auth.md)'s authorizer, so that only a note's owner can have it read aloud
- Decide how much one person may use. A signed-in user who keeps sending a different 10,000 characters costs USD 0.16 each time. Apply [chapter 14](/en/chapters/14-kv-cache.md)'s rate limit per user, and set reserved concurrency on the function ([chapter 32](/en/chapters/32-limits.md))
- Put an alarm on characters. Polly publishes `RequestCharacters` in the `AWS/Polly` namespace. A threshold on the daily sum tells you early that the bill has started to grow. [Chapter 19](/en/chapters/19-observability.md) shows how to make an alarm
- Decide about the use of the text. If you use Organizations, decide whether to set an AI services opt-out policy
- Match the audio's lifetime to your policy on deleting notes. If users are promised that deleted means gone, 30 days is too long
- Keep the bucket and the log group. Both are set to go with the stack, for practice. A deleted cache bucket can be rebuilt, but right after it every text is billed once more
- Estimate what changing the voice costs. A new default voice changes every key, and the cache starts empty

## Cleanup

<!-- section: 57.cleanup -->

```bash
vp run polly:empty
vp run polly:empty --yes
vp run polly:infra:destroy
```

cdkd does not delete a bucket that is not empty, so `polly:empty` empties it first. Without `--yes` it only counts and deletes nothing.

The bucket, the function, the role, the function URL, and the log group are removed, and the cached audio and the logs with them. There is nothing to remove on Polly's side: no lexicon and no asynchronous task was created. If Polly stored text for improvement, that stays when the stack is gone. Removing it takes the opt-out described above.

What else remains is the storage that cdkd's bootstrap created (chapter 02).

## As a distributed system

- Owner of the state: the bucket owns the audio. The function remembers nothing. Emptying the bucket loses money only, and the next request rebuilds what it needs
- Invariant: one synthesis per distinct input (engine, voice, format, SSML), however many requests arrive together
- Tests that try to break it: two and ten at once, a failed synthesis, a stop with the claim in place, two simultaneous takeovers of an old claim, an unreadable claim, and a claim that vanishes while a request waits, each reproduced in a fixed order
- Not guaranteed: if the function stops between the end of a synthesis and the write of the audio, the same text is billed again. It is billed again, too, after the audio is removed at 30 days
- The arbiter: which of two requests synthesizes is decided by S3's conditional write, not by the function. The functions do not know of each other
- Clocks: whether a claim is old is judged by the clock of the function that reads it. The gap to the function's timeout, 30 seconds, is the room for clock difference
- Not checked: all of this rests on S3 arbitrating the conditions as documented. It was not tried against S3

::: details Verification notes for this chapter

**Checked locally.** 72 unit tests (SSML escaping and injected tags, chunking, cache keys, simultaneous requests, failures and takeovers reproduced, the route, no note text in the logs, playback order, the shape of the requests to S3 and Polly, stack assertions). The type check. `polly:infra:synth` produces the template without asking AWS anything, bundling with esbuild included. The development server started with `SPEECH_BACKEND=fake`, and `curl` sent the same note twice: the second answer was `cache`, and a URL returned a WAV file. `vp check --fix` on this chapter's own files, with no finding, awscdk-lint included.

**Not checked yet.** Nothing was run on AWS. Polly was never called. In particular, the following come from the documentation alone.

- How the voices sound, how long a synthesis takes, and how large the MP3 is. The 3 seconds and 0.3 MB in the cost table are assumptions
- How Polly counts characters. What a Japanese character, an escaped `&amp;`, and a line break each count as is not known. The splitting assumes the largest count
- What Polly does with characters XML cannot carry, and with English words given to a Japanese voice
- How S3's conditional writes behave in practice: that only one of several simultaneous `If-None-Match` or `If-Match` writes succeeds, the shape of the error the losers get, and whether the SDK retries a 409 by itself
- Whether `polly:SynthesizeSpeech` can be narrowed to a lexicon ARN. In case it cannot, the stack uses `*`
- Deploying with cdkd, the signature check on the function URL, and how long the lifecycle rules take to remove an object
- `src/player.ts` in a browser: that an `audio` element plays the presigned URLs, and how the joins between parts sound
- The local server with `SPEECH_BACKEND=polly`
- The cost assumptions: how often people listen, the share of cache hits, the volume of logs
- Whether Polly needs a sign-up or activation before first use
- Whether CloudFormation has a resource for lexicons

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What Polly offers | `examples/57-polly/src/voices.ts` | |
| The cache key | `examples/57-polly/src/cache-key.ts`, `src/audio-cache.ts`, `test/cache-key.test.ts` | `test:unit` |
| One synthesis per text | `examples/57-polly/src/speak.ts`, `src/s3-audio-cache.ts`, `test/naive.ts`, `test/speak.test.ts`, `test/adapters.test.ts` | `test:unit` |
| Splitting a long note | `examples/57-polly/src/chunk.ts`, `test/chunk.test.ts` | `test:unit` |
| Putting the user's text in SSML | `examples/57-polly/src/ssml.ts`, `test/ssml.test.ts` | `test:unit` |
| The route | `examples/57-polly/src/app.ts`, `src/contract.ts`, `src/polly.ts`, `src/player.ts`, `test/app.test.ts`, `test/player.test.ts` | `test:unit` |
| The stack | `examples/57-polly/infra/lib/polly-stack.ts`, `infra/bin/app.ts`, `src/lambda.ts`, `infra/test/polly-stack.test.ts` | `test:unit`, `polly:infra:synth` |
| Run it locally | `examples/57-polly/src/dev.ts`, `src/fake-synthesizer.ts`, `src/memory-audio-cache.ts` | `dev:polly` |
| Deploy and check | `examples/57-polly/scripts/listen.ts` | `polly:infra:diff`, `polly:infra:deploy`, `polly:listen`, `polly:infra:drift` |
| Cost | `data/pricing/` | |
| Cleanup | `examples/57-polly/scripts/empty.ts` | `polly:empty`, `polly:infra:destroy` |

**How cdkd (0.296.28) handles the stack.** A dedicated provider is registered, as found in the installed package's `dist`, for `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::Lambda::Function`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::IAM::Role`, and `AWS::IAM::Policy`. No type in this stack goes through the Cloud Control API.

**Primary sources** (all checked on 2026-10-13)

- Polly developer guide: [Quotas in Amazon Polly](https://docs.aws.amazon.com/polly/latest/dg/limits.html), [Available voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html), [Neural voices](https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html), [Generative voices](https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html), [Long-form voices](https://docs.aws.amazon.com/polly/latest/dg/long-form-voices.html), [Long audio files](https://docs.aws.amazon.com/polly/latest/dg/asynchronous.html), [Setting up the IAM policy for asynchronous synthesis](https://docs.aws.amazon.com/polly/latest/dg/asynchronous-iam.html), [Speech marks](https://docs.aws.amazon.com/polly/latest/dg/speechmarks.html), [Speech mark output](https://docs.aws.amazon.com/polly/latest/dg/output.html), [Managing lexicons](https://docs.aws.amazon.com/polly/latest/dg/managing-lexicons.html), [Integrating CloudWatch with Amazon Polly](https://docs.aws.amazon.com/polly/latest/dg/cloud-watch.html), [Data Protection in Amazon Polly](https://docs.aws.amazon.com/polly/latest/dg/data-protection.html)
- SSML: [Generating speech from SSML documents](https://docs.aws.amazon.com/polly/latest/dg/ssml.html), [Supported SSML tags](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html), [Reserved characters in SSML](https://docs.aws.amazon.com/polly/latest/dg/escapees.html), [Adding a pause](https://docs.aws.amazon.com/polly/latest/dg/break-tag.html)
- API: [SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html), [StartSpeechSynthesisTask](https://docs.aws.amazon.com/polly/latest/dg/API_StartSpeechSynthesisTask.html), [StartSpeechSynthesisStream](https://docs.aws.amazon.com/polly/latest/dg/API_StartSpeechSynthesisStream.html)
- IAM: [How Amazon Polly works with IAM](https://docs.aws.amazon.com/polly/latest/dg/security_iam_service-with-iam.html), [Polly's service reference (JSON)](https://servicereference.us-east-1.amazonaws.com/v1/polly/polly.json)
- Pricing and data handling: [Amazon Polly Pricing](https://aws.amazon.com/polly/pricing/), [Amazon Polly FAQs](https://aws.amazon.com/polly/faqs/), [AI services opt-out policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html), [AWS Price List: AmazonPolly (Tokyo)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPolly/current/ap-northeast-1/index.json) (the Lambda, S3, transfer, and log prices are the ones checked in chapters 04, 07, and 19)
- S3: [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- XML: [XML 1.0, section Characters](https://www.w3.org/TR/xml/#charsets)
- Packages: [@aws-sdk/client-polly 3.1149.0](https://registry.npmjs.org/@aws-sdk/client-polly/3.1149.0), [@go-to-k/cdkd 0.296.28](https://registry.npmjs.org/@go-to-k/cdkd/0.296.28) (the installed `dist` was read)
- Cloudflare: [Workers AI: Models](https://developers.cloudflare.com/workers-ai/models/), [melotts](https://developers.cloudflare.com/workers-ai/models/melotts/), [aura-2-en](https://developers.cloudflare.com/workers-ai/models/aura-2-en/)
- Vercel: [AI SDK: Speech](https://ai-sdk.dev/docs/ai-sdk-core/speech)
- Browsers: MDN's [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) and [SpeechSynthesisVoice.localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService) (the Markdown the pages are built from was read)

:::
