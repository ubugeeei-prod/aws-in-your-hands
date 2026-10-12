---
title: "57 Polly: Reading a Note Aloud"
sourceRevision: 1
---

# 57 Polly: Reading a Note Aloud

Amazon Polly turns text into speech. It charges by the character, and it charges again when you synthesize the same text again. Yet the audio of the same text in the same voice serves the same purpose however many times it is made. This chapter is about that one point: it adds a "listen" button to a note, and **synthesizes each text only once**.

The audio is kept in S3 under a key that is a hash of the text and the voice. The chapter holds to that even when two people open the same note and press the button at the same moment: Polly is called once. Along the way it splits a long note into pieces that fit in one request, and keeps the user's text from being read as instructions to the synthesizer.

It builds on [chapter 07](/en/chapters/07-uploads.md) (S3 and presigned URLs) and [chapter 17](/en/chapters/17-ai.md) (function URLs, and the shape of a function that calls an outside service). The code is in `examples/57-polly/`. Polly was never called. How the voices sound and how long a synthesis takes cannot be learned from this chapter.

## The whole picture

<!-- section: 57.overview -->

```figure
caption: When the audio is in S3, Polly is not called. The listener fetches it from S3 with a URL the function signed
node browser: Browser | "listen" button
node fn: Lambda | function URL
node s3: S3 bucket | speech/ and claims/
node polly: Polly | SynthesizeSpeech
edge browser -> fn: POST /speech
edge fn -> s3: HEAD, conditional PUT
edge fn -> polly: only when there is no audio
edge fn --> browser: presigned URLs, in order
edge browser -> s3: GET
mark s3
```

When the button is pressed, the browser sends the note's title and body in a `POST /speech`. The function splits the note into parts and, for each part, checks whether its audio is in S3. If it is, the function uses it. If not, it has Polly synthesize the part and stores the result. The response is a list of presigned URLs, one per part, in reading order, and the browser plays them one after another.

The function does not return the audio itself, so that a second listen passes through neither the function nor Polly. The presigned URLs work as in chapter 07: the bucket is not public, and only a URL signed by the function's role can read an object, for a limited time.

Nothing in this stack is billed for merely existing. A month in which nobody listens costs nothing, and a month in which people do is priced almost entirely by the characters Polly synthesizes. The amounts are on the [last page](/en/chapters/57-polly/wrap.md).

## What Polly offers

<!-- section: 57.polly -->

This section follows the Polly developer guide and pricing page as read on 2026-10-13.

**Engines and voices.** Polly has four ways of synthesizing speech, which it calls engines. Each voice supports some of them.

| Engine | Per 1 million characters | Japanese voices | Tokyo Region |
| --- | --- | --- | --- |
| standard | USD 4 | Mizuki, Takumi | available |
| neural | USD 16 | Takumi, Kazuha, Tomoko | available |
| long-form | USD 100 | none (English and Spanish only) | not available (us-east-1 only) |
| generative | USD 30 | none | available, but with no Japanese voice |

For Japanese the choice is between standard and neural. The guide describes standard as joining pieces of recorded speech, and neural as generating the waveform with a neural network. Neural costs four times as much. This chapter defaults to the neural voice Kazuha and also offers the standard voice Mizuki. For notes in English it includes Joanna (en-US, neural).

<<< @/examples/57-polly/src/voices.ts{voices}

The Price List for the Tokyo Region holds two prices only, for standard and for neural. The guide says generative voices are available in Tokyo, but their Tokyo price could not be confirmed from the Price List.

**Synthesis that answers at once, and synthesis that arrives later.** `SynthesizeSpeech` answers a request with the audio stream itself. One request takes up to 3,000 billed characters, 6,000 in all with tags, and the audio that comes back is cut off at 10 minutes. `StartSpeechSynthesisTask` is asynchronous: it takes up to 100,000 billed characters (200,000 in all) and writes the finished audio to an S3 bucket you name. An SNS topic can tell you when it is done.

<<< @/examples/57-polly/src/voices.ts{limits}

The generative engine also has `StartSpeechSynthesisStream`, which takes text piece by piece while audio comes back. Tokyo is not among the Regions that offer it.

**Output formats.** Audio comes as `mp3`, `ogg_vorbis`, `ogg_opus`, `pcm`, `mulaw`, or `alaw`. This chapter uses `mp3`. With `OutputFormat` set to `json`, Polly returns speech marks instead of audio. Speech marks say, one JSON object per line, at which millisecond of the audio each sentence or word begins, which is what you need to highlight the text as it is read. A request for speech marks is billed separately from the request for audio, for the same number of characters. The generative engine does not support them.

**SSML.** Text can be sent as plain text or as SSML. SSML is XML inside a `<speak>` element, with tags for pauses (`<break>`) and pronunciations (`<phoneme>`, `<sub>`). Tags do not count as billed characters. Which tags work depends on the engine: neural voices have no `<emphasis>` and no breathing sounds. The only tag this chapter uses is a `<break>` between the title and the body.

**Lexicons.** A lexicon is a pronunciation dictionary for particular words. It is written in the W3C PLS format, stored per Region, and named in the synthesis request. An account holds up to 100 and a request uses up to five. It is the tool for correcting how a company or product name is read. This chapter does not use one, and did not check whether CloudFormation has a resource for it.

**Quotas.** `SynthesizeSpeech` allows 8 requests a second with a neural voice (10 in a burst) and up to 18 at once. Standard voices allow 80 a second. A request beyond that is refused with `ThrottlingException`. Quotas that can be raised are raised through a request in the console. Quotas in general are the subject of [chapter 32](/en/chapters/32-limits.md).

## When you do not need this

<!-- section: 57.alternatives -->

**Let the browser read.** Browsers have `speechSynthesis` in the Web Speech API, which reads text with the voices on the device. It needs no server, costs nothing, and sends no text to AWS. Which voices exist and how good they are depends on the device and the browser, and some voices are synthesized by a service outside the device. Unless every listener must hear the same voice, start here.

**Leave it to the asynchronous task.** If one text is far beyond 3,000 characters and you want a single audio file, `StartSpeechSynthesisTask` is the plainer choice. Polly does the splitting and the joining, and the result arrives in S3. The price is that nobody hears anything right after pressing the button. A note here is about ten thousand characters at most, so this chapter calls the synchronous API part by part and starts playing from the first part.

**Do not cache.** When the text is different every time, a cache never hits. To read out chat replies, pipe the stream from `SynthesizeSpeech` straight through chapter 17's response streaming: the first sound comes sooner. Keeping audio in S3 pays when the same text is heard again.

**Use a standard voice.** It costs a quarter. The two were not compared by ear, so this chapter cannot say which is good enough. Listen to your own notes in both voices in the Polly console and decide.
