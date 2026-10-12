---
title: "57 Polly: Design and Build"
---

# 57 Polly: Design and Build

The [previous page](/en/chapters/57-polly.md) covered what Polly offers and the design that keeps audio in S3. This page reads the implementation in order: the cache key, requests that arrive together, splitting a long note, escaping for SSML, the route, the stack, and running it locally.

## The cache key

<!-- section: 57.cache -->

The cache key is made from everything that decides the audio Polly returns: the engine, the voice, the output format, and the SSML that is sent. If any one differs, the audio differs, so it is a different object.

<<< @/examples/57-polly/src/cache-key.ts{key}

A hash gives a key of fixed length whatever the length of the text, and keeps the note's text out of the key. It also matters that knowing a key lets you read nothing. The bucket is not public, so reading audio takes a URL signed by the function, and the only people who get one are those who sent the text itself in a `POST /speech`. Whoever can hear the audio already has the text. If two users each hold the same text, they hear the same object, and neither learns anything from the other.

That is why the key carries no note ID and no owner. With them, fixing one character of a note would synthesize all of it again, and the same text held twice would be paid for twice.

Raise `VERSION` when you change something that alters the sound without altering the SSML, such as starting to set a sample rate. Every text then gets a new key, and the lifecycle rule removes the old audio.

The function asks five things of S3.

<<< @/examples/57-polly/src/audio-cache.ts{port}

Why `create` and `replace` are conditional writes and not plain ones is the subject of the next section.

## One synthesis per text

<!-- section: 57.once -->

The invariant of this chapter is **one synthesis per distinct input**, where the input is the set of things that went into the cache key.

A first attempt at a cache usually looks like this.

<<< @/examples/57-polly/test/naive.ts{naive}

Used by one person at a time, it is correct. It breaks when two requests for the same text arrive almost together. Both are told "not there yet", and both call Polly. The test reproduces that order reliably by giving it a fake Polly that does not answer until the test says so.

<<< @/examples/57-polly/test/speak.test.ts{broken}

The final write is conditional, so one copy of the audio reaches the bucket. Polly has still been called twice and both calls are billed. The condition comes too late.

The fix is to leave a mark that says "about to synthesize this" before calling Polly, and to let only the one request that managed to leave it synthesize. The mark is a small object under `claims/`, and the code calls it a claim. Written with `If-None-Match: *`, it is stored only if no object has that key. When two writes compete, S3 decides which one goes through.

<<< @/examples/57-polly/src/s3-audio-cache.ts{create}

The loser gets a 412 (Precondition Failed). The documentation says a 409 (Conflict) is possible too for concurrent requests, so both are read as "this caller did not write".

<<< @/examples/57-polly/src/s3-audio-cache.ts{refused}

```figure
type: sequence
caption: Two requests for the same text. Only the one that placed the claim calls Polly
actor a: Request A
actor b: Request B
actor s3: S3
actor polly: Polly
step a -> s3: HEAD speech/h (absent)
step b -> s3: HEAD speech/h (absent)
step a -> s3: PUT claims/h, If-None-Match
step b -x s3: PUT claims/h, 412
step a -> polly: SynthesizeSpeech
step b -> s3: HEAD speech/h (not yet)
step a -> s3: PUT speech/h
step b -> s3: HEAD speech/h (present)
```

A request that could not place the claim waits for the audio to appear. It looks every half second, and if 20 seconds pass without it, answers "being prepared" and leaves it to the caller to try again.

<<< @/examples/57-polly/src/speak.ts{ensure}

The same test, written against this implementation, sees one call to Polly.

<<< @/examples/57-polly/test/speak.test.ts{concurrent}

### When the function holding the claim stops

A function can stop after it has placed the claim and before it has written the audio. It may have timed out, or Polly may have returned an error. If only the claim remained, nobody would ever synthesize that text.

There are two answers. One is to hand the claim back when a synthesis fails. A claim holds the time it was placed, and the function that failed rewrites it to 0: that is the `catch` in the code above. The other is to take over an old claim. For a function that stops without a word, a claim older than 90 seconds counts as having no holder.

<<< @/examples/57-polly/src/speak.ts{claim}

Taking over is a race as well. Two requests that find the same old claim both try to take it. So the rewrite carries `If-Match` and goes through only if the object still has the ETag that was read. Whoever rewrites first changes the ETag, and the other is refused with a 412.

<<< @/examples/57-polly/src/s3-audio-cache.ts{replace}

<<< @/examples/57-polly/test/speak.test.ts{takeover}

The 90 seconds are longer than the function's timeout of 60. A function holding a claim has always stopped before the claim counts as old, so a claim is never taken from a holder that is still running. A test on the stack checks that the two numbers stay in that order.

There is one case in which the invariant does not hold. If the function stops after the synthesis has finished, and Polly's charge is settled, but before the audio is written to S3, the next request synthesizes again and is billed again. Nothing makes Polly's synthesis and the write to S3 one operation, so this is accepted. What is guaranteed is two things: one synthesis however many requests arrive together, and no repeat of a synthesis that succeeded.

Times are compared on each function's own clock. If the clocks of two Lambda execution environments differ by less than the gap between 90 and 60 seconds, the outcome is the same. What bounds that difference was not looked up.

## Splitting a long note

<!-- section: 57.chunk -->

A note's body can be 10,000 characters, more than one `SynthesizeSpeech` request takes. So the note is split into parts that fit, and each part is synthesized.

The cuts fall at the ends of sentences. Cut in the middle of a sentence, the intonation breaks at the join. The code cuts after a Japanese full stop, an exclamation or question mark, or a line break, and takes an English period for the end of a sentence only when a space follows, so that a decimal such as `3.14` is not cut in two.

<<< @/examples/57-polly/src/chunk.ts{sentences}

Sentences are packed in order, and a part ends where the next sentence would take it over the limit. A sentence longer than the limit is cut after a comma or a space, and if that is not enough, between characters. Between characters means between code points, so that a surrogate pair such as an emoji is never cut in half.

<<< @/examples/57-polly/src/chunk.ts{pack}

How the size is counted needs care. The documentation states the limit as "3,000 characters" and does not say what counts as one. Is one Japanese character 1, or the 3 bytes of its UTF-8? Is an `&` written as `&amp;` 1, or 5? So the code counts the escaped text in UTF-8 bytes. No way of counting gives a larger number.

<<< @/examples/57-polly/src/ssml.ts{measure}

Counted this way, one request holds only 1,000 Japanese characters. If the real limit is 3,000 of them, the note is being split three times as finely as needed. The price follows the characters, so finer parts cost the same. What grows is the number of requests and of joins. Once you have called Polly and know how it counts, correct `billedSize`.

Splitting has a benefit beyond fitting the limit. Each part has its own cache key, so when the last paragraph of a long note is edited, only that part is synthesized again. The title is a part of its own, followed by a pause of 0.7 seconds.

<<< @/examples/57-polly/src/chunk.ts{segments}

Joining is left to the browser, which plays the parts in order. Whether MP3 files can simply be put end to end to make one could not be confirmed from Polly's documentation.

## Putting the user's text in SSML

<!-- section: 57.ssml -->

To pause after the title, the function sends SSML. That puts text written by a user inside XML. A note that contains `<break time="10s"/>` would, sent as it is, be synthesized as ten seconds of silence, and one that contains `</speak>` would break the document and fail the synthesis. It is the same problem as building SQL from values.

The answer is the same too: the user's text goes in only in a form that cannot be read as a tag. SSML has five characters with a special meaning, and the documentation lists them.

<<< @/examples/57-polly/src/ssml.ts{escape}

Besides escaping, the code removes characters XML cannot carry. XML 1.0 accepts neither control characters other than tab and line breaks nor half of a surrogate pair, even in escaped form. One such character in a note makes the whole document invalid. What Polly does with them was not checked, but with them removed before sending it does not matter.

Text that is already escaped, such as `&lt;break/&gt;`, is escaped again. What the user wrote is those 14 characters, not a tag.

SSML is assembled in one place only, and the tags that appear there are the `<speak>` and the `<break>` written in the code. The duration of the `<break>` is made from a number, and no user input reaches it.

<<< @/examples/57-polly/src/ssml.ts{document}

The tests feed in tags, comments, CDATA, entity declarations, and already-escaped strings, and check that not one `<` or `>` remains other than in the tags the function wrote. Sending plain text, with `TextType` set to `text`, avoids the problem altogether. If you need no pause, that is simpler.

## The route

<!-- section: 57.route -->

The request carries a note's title and body and the name of a voice. The length limits are those of a note in [chapter 04](/en/chapters/04-http-api.md). The voice is chosen from a list. The engine is not: the server fixes it per voice, and an `engine` in the request is ignored, so that a caller cannot ask for a dearer engine.

<<< @/examples/57-polly/src/contract.ts{request}

The route takes the result for each part and turns it into a list of presigned URLs. What it logs is sizes and outcomes. The text of the note is not logged.

<<< @/examples/57-polly/src/app.ts{route}

The parts are synthesized one after another. In parallel they would finish sooner, but one long note would be a burst against the neural quota of 8 requests a second. In sequence, a failure midway leaves the finished parts in the cache.

<<< @/examples/57-polly/src/speak.ts{speak}

This is the call to Polly. A throttle reaches this code only after the SDK has retried by itself. It becomes a 429, and the caller is left to try again.

<<< @/examples/57-polly/src/polly.ts{polly}

A word on IAM belongs here. The only resource type Polly has is the lexicon. No resource stands for a voice or an engine, and Polly has no condition keys of its own. So IAM cannot say "this role may use neural at most". What fixes the engine is the application's code, and what checks it is a test.

On the browser's side, the URLs are played in order: the next part starts when the one before it has ended, and none starts after a stop.

<<< @/examples/57-polly/src/player.ts{play}

This function was tested against a stand-in for the `audio` element and has not run in a browser. To put it into [chapter 06](/en/chapters/06-auth.md)'s web app, add a button to the note view and call `playInOrder(urls, (url) => new Audio(url))`.

## The stack

<!-- section: 57.stack -->

The stack makes the cache bucket, the function and its role, a log group, and a function URL.

<<< @/examples/57-polly/infra/lib/polly-stack.ts{bucket}

There are two lifecycle rules. Audio is removed after 30 days. It is a cache, so what is removed is made again on the next request. The 30 days were chosen less for the storage bill than as the time the app keeps a note's content in another form. Deleting a note does not delete its audio at once: the key is a hash, so the function does not know which audio belongs to which note. The [next page](/en/chapters/57-polly/wrap.md) comes back to this.

Claims are removed after one day. A claim matters for 90 seconds, but a lifecycle rule counts in days, so it is set to the shortest, one day. An old claim that is still there is simply taken over, so nothing depends on when the rule runs.

<<< @/examples/57-polly/infra/lib/polly-stack.ts{role}

Apart from writing its log, the role may call `polly:SynthesizeSpeech`, `s3:GetObject` and `s3:PutObject` under the two prefixes, and `s3:ListBucket` on the bucket. `s3:GetObject` is needed to read a claim, and also for the presigned URLs and the `If-Match` write. Without `s3:ListBucket`, S3 answers a HEAD for a missing key with 403 and not 404 (chapter 07). The role cannot delete anything. Only the lifecycle rules do.

The `Resource` of `polly:SynthesizeSpeech` is `*`, the only `*` in this stack. Polly has no resource other than the lexicon, and the documentation did not make clear which ARN a request that uses no lexicon is evaluated against.

<<< @/examples/57-polly/infra/lib/polly-stack.ts{function}

The function URL is protected with `AWS_IAM`, as in chapter 17. An unsigned request is refused before the function runs. With `NONE`, anyone who learned the URL could have audio made at this account's expense. For an app the browser calls directly, put the function behind chapter 06's API Gateway and authorizer and not behind a function URL.

The function's entry point uses chapter 04's kit as it is.

<<< @/examples/57-polly/src/lambda.ts{handler}

## Run it locally

<!-- section: 57.local -->

Locally, Polly is not called. In its place is a function that returns a WAV file with a 440 Hz tone whose length follows the length of the text.

<<< @/examples/57-polly/src/fake-synthesizer.ts{fake}

A tone is all you hear, but the cache, the splitting, and the list of URLs run the same code as the deployed function. A `Map` in memory stands in for the bucket.

```bash
cp examples/57-polly/.env.example examples/57-polly/.env
vp run dev:polly
```

From another terminal, send the same note twice.

```bash
curl -s -X POST http://localhost:8857/speech \
  -d '{"title":"買い物","body":"牛乳を買う。卵も買う。"}'
```

The first response has this shape. There are two `parts` because the title and the body are separate parts.

```text
{"voice":"Kazuha","engine":"neural","parts":[{"url":"http://localhost:8857/local/audio/speech/c94c63d6…?expires-in=3600","source":"synthesized"},{"url":"http://localhost:8857/local/audio/speech/0bc01537…?expires-in=3600","source":"synthesized"}],"billedCharacters":14,"expiresInSeconds":3600}
```

The second has the same URLs, `source` is `cache`, and `billedCharacters` is 0. The 14 in `billedCharacters` is the local stand-in's count of code points, not Polly's way of counting. Open a URL in a browser and the tone plays.

With `SPEECH_BACKEND` set to `polly` in `.env` and `SPEECH_BUCKET` set to the deployed bucket's name, the local server uses the real Polly and S3. Every new text is billed. This switch was not tried.

<<< @/examples/57-polly/src/dev.ts{dev}

Tests and the type check run as in the other chapters.

```bash
vp run test:unit
vp run typecheck
```

What is not reproduced locally: Polly's voices, how long a synthesis takes, how characters are counted, how S3 really arbitrates conditional writes, IAM, and the lifecycle rules. The tests for simultaneous requests run against a bucket in memory that imitates conditional writes with two rules only: create if absent, and replace if unchanged.
