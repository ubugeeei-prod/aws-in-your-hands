---
title: "18 A Live-Streaming Recipe: IVS"
sourceRevision: 1
---

# 18 A Live-Streaming Recipe: IVS

This chapter is a stand-alone recipe. You send video from streaming software and watch it on a web page a few seconds later. We'll build that with the smallest setup that works.

The service is Amazon IVS (Interactive Video Service). It takes care of the heavy parts: receiving the video, converting it, and delivering it around the world. What's left for you to write is a channel definition, a player page, and a script that checks the state.

One thing first. IVS **charges for as long as video is being sent to it, even with zero viewers.** Forget to close your streaming software before bed and you're billed until morning. How to confirm that a stream has stopped is in the section "Has it stopped?" in this chapter. After you try things out, please go all the way to that step.

The prerequisite is [chapter 04](/en/chapters/04-http-api.md), because Lambda and logs come up. The code is in `examples/18-live/`.

## The big picture

<!-- section: 18.overview -->

```text
Encoder (OBS, FFmpeg)                          Viewer's browser
  |  RTMPS :443, presents the stream key          |  player page (Vue + IVS player SDK)
  v                                               |  reads /config.json -> playbackUrl
IVS ingest endpoint (global)                      v
  |                                          IVS playback URL (HTTPS, delivered globally)
  v                                               ^
IVS channel "aih-live" (ap-northeast-1) ----------+
  |  type BASIC, latency mode LOW, at most one stream key
  |  emits events: stream state, stream health, limit breach (best effort)
  v
EventBridge rule (this channel only) -> Lambda (validate, log one line) -> CloudWatch Logs (7 days)

Your terminal: stream:status -> GetStream  (the answer to "is it live right now?")
```

In the middle sits the **channel**: the unit that takes one broadcast and delivers it to viewers. A channel has two addresses. The ingest endpoint is where streaming software sends to, and the playback URL is where viewers watch from.

The sender presents a secret string called the **stream key**. Anyone who has it can broadcast to this channel. Think of it as a password.

The interesting part is where things live. The channel is a resource you create in the Tokyo Region, but receiving and delivering video happens worldwide. In the documentation's words, the control plane (the API and the resources) is regional and the data plane (streaming and viewing) is global. A channel created in Tokyo can be sent to from anywhere and watched from anywhere.

The lower half is how you learn that a stream started or ended. More on it later, but the events that arrive there are only "usually delivered." The answer to whether the channel is live right now comes from `GetStream`, at the bottom right.

## There are two IVS products

<!-- section: 18.products -->

Under the name IVS there are two separate products. Before building, let's settle which one we're talking about.

| | Low-latency streaming | Real-time streaming |
| --- | --- | --- |
| Resource | channel | stage |
| Latency (as documented) | under 5 seconds | can be under 300 milliseconds |
| How you send | RTMPS, RTMP, SRT. OBS works as is | IVS broadcast SDKs, among others |
| Default scale | 15,000 concurrent views (per Region, adjustable) | 12 publishers and 10,000 subscribers per stage (adjustable) |
| Billed by | input hours and viewing hours | hours per participant |
| Tokyo Region | has an endpoint | has an endpoint |

This chapter is the left column, low-latency streaming. One person broadcasts and many watch a few seconds behind. OBS on the sending side, a web page on the viewing side. It's the most straightforward shape.

You pick the right column **when a conversation has to work**. Bringing viewers on stage to talk, or calling out bids in an auction: a few seconds of delay breaks those. In exchange, the sender becomes an app with an SDK in it, and there is more to build.

Here's the catch to avoid: choosing the right column because "less latency is better." For a one-way broadcast, nobody is hurt by a 3-second delay.

## Decide on the channel

<!-- section: 18.channel -->

A channel has just three settings here.

<<< @/examples/18-live/src/channel.ts{settings}

`type` affects price and quality the most. There are four, and they do different things.

| type | Input, per hour (USD) | What IVS does | Input limit |
| --- | --- | --- | --- |
| `BASIC` | 0.20 | Delivers the video as sent, in one version | 1.5 Mbps at 480p or less, 3.5 Mbps above that |
| `STANDARD` (default) | 2.00 | Converts into several qualities, up to 1080p | 8.5 Mbps |
| `ADVANCED_SD` | 0.50 | Converts into several qualities, up to 480p | 8.5 Mbps |
| `ADVANCED_HD` | 0.85 | Converts into several qualities, up to 720p | 8.5 Mbps |

Each of those "several qualities" is called a **rendition**. Send 1080p to a `STANDARD` channel and IVS also produces 720p, 480p, 360p and 160p, and the player switches between them to fit each viewer's connection.

This chapter uses `BASIC`. The reason is price. Specify nothing and you get `STANDARD`, at ten times the input rate. For an hour of practice the difference is USD 1.80, but it gets large when you forget to stop (we'll do the math later).

In exchange, `BASIC` has a single rendition. A viewer on a thin connection has no lower quality to fall back to. Anyone who can't keep up with the bitrate you sent stalls. For a real broadcast to viewers on all kinds of connections, that's a reason to choose `STANDARD` or `ADVANCED`.

`latencyMode` is `LOW` (the console calls it Ultra-low). For what this chapter does, there's no reason to pick `NORMAL`.

### Go over the limit and you're cut off

The input limit doesn't mean "quality drops." In the documentation's words, the stream "probably will disconnect immediately." The bitrate that OBS's setup wizard picks can be higher than the `BASIC` limit.

So the example lets you check before you send.

<<< @/examples/18-live/src/channel.ts{limits}

The keyframe (IDR) interval matters too. IVS recommends 2 seconds. It affects both how long a stream takes to become watchable after you start and the latency itself. The documentation says to avoid values above 5 seconds.

### Writing it in CDK

<<< @/examples/18-live/infra/lib/live-stack.ts{channel}

The pinned aws-cdk-lib has no higher-level construct for IVS. So this uses `CfnChannel`, which maps straight onto the CloudFormation resource. There are few properties, so it's no trouble.

`authorized: false` means "anyone who knows the playback URL can watch." The broadcast in this chapter is public. When you want to restrict who can watch, see "If this were production."

`insecureIngest: false` refuses unencrypted RTMP. Over RTMP, the stream key would cross the network in plain text.

## The stream key is the key

<!-- section: 18.stream-key -->

Whoever holds the stream key can put any video they like on your channel, on your bill. Treat it like an API key.

<<< @/examples/18-live/infra/lib/live-stack.ts{stream-key}

There are two small traps here.

First: create a channel through the IVS API (the console, or `aws ivs create-channel`) and a stream key is created with it. CloudFormation's `AWS::IVS::Channel` does not create one. Unless you also write an `AWS::IVS::StreamKey`, you end up with a channel nobody can broadcast to.

Second: a channel has at most one stream key. That limit can't be raised.

### Never print the value

`CfnStreamKey` has an attribute named `attrValue`, and that is the key itself. Pass it to a `CfnOutput` and the key shows up in the deploy log and in the stack's outputs. Pass it to a Lambda environment variable and everyone who can view the function's configuration sees it.

So this stack never touches `attrValue`. Only the ARN becomes an output. A test also watches that nothing in the template refers to `Value`.

The key is needed only when you paste it into streaming software. That's when you fetch it.

```bash
vp run stream:key
vp run stream:key --show
```

The first line prints the server URL and the bitrate limit to enter in the encoder. It doesn't print the key. Only with `--show` does it fetch the value with `GetStreamKey` and print it once, to that terminal. It writes it to no file.

To be honest about it, there may be one more copy of the key. cdkd creates IVS resources through Cloud Control API. As far as I can read in the pinned version's source, it records what comes back for the resource as attributes in its state (an S3 bucket). What comes back for an `AWS::IVS::StreamKey` includes `Value`. In other words, **anyone who can read cdkd's state may be able to read the stream key**. I haven't confirmed this against a real deployment, hence "may," but treat the state bucket as a place that holds secrets.

### If it leaks, make a new one

A stream key has no "change the value" operation. You delete it and create another. Since a channel holds only one, the order is delete, then create.

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:infra:deploy
```

The first deploy drops the stream key from the template, and cdkd deletes it. The second creates a new key. Both the ARN and the value change, so the encoder has to be set up again.

You can also stop after the first one. Nobody can broadcast to a channel with no key. It's like locking a channel you won't use for a while.

You could re-create the key in the console or with the CLI, but then there's a key the stack doesn't know about, and the state no longer matches. `vp run stream:infra:drift` should find it, but going through the stack from the start is less confusing.

## The player page

<!-- section: 18.player -->

Now the viewing side. An IVS playback URL is an HLS playlist (`.m3u8`), but watching it a few seconds behind takes the IVS player SDK. The documentation states flatly that the IVS player is required to achieve low latency.

There are two ways to get the SDK: a `<script>` tag from a CDN, or `amazon-ivs-player` from npm. This chapter uses npm, because it comes with TypeScript types and the version can be pinned in the lockfile. The current version when I checked was 1.57.0.

One note on licensing. This package is not open source. It is "AWS Content," provided under the AWS Customer Agreement.

<<< @/examples/18-live/web/src/player.ts{start}

The `wasmWorker` and `wasmBinary` passed to `create` are the part specific to the npm distribution. The player's core is WebAssembly and runs inside a web worker, and you have to tell it the URLs of those two files. That's what the `?url` imports at the top of the file are for: Vite includes the files in the build and gives back their URLs.

Playback starts muted, because browsers may block autoplay of video with sound.

### "Not broadcasting" is not a failure

The player page gets opened before the stream begins. What does the player report then? An error. Its type is `ErrorNotAvailable` and its code is 404.

Showing that as "playback failed" would be wrong. The stream just hasn't started.

<<< @/examples/18-live/web/src/viewer.ts{view}

404 is "offline," 429 is "the viewer limit was reached," and anything else is a failure. That decision is separated from the player into a plain function. It doesn't load the SDK, so it can be tested without a browser.

While offline, the page waits and then asks again.

<<< @/examples/18-live/web/src/viewer.ts{retry}

It starts at 5 seconds, doubles, and tops out at a minute. Every open tab sends this request, so picture 1,000 people waiting from an hour before the show: a fixed 1-second interval is not what you want.

### The playback URL is not built in

The playback URL isn't known until you deploy. So, as in [chapter 06](/en/chapters/06-auth.md), the page reads `/config.json` when it starts.

<<< @/examples/18-live/web/src/config.ts{config}

The playback URL is not a secret. It's handed to every viewer's browser. It does contain your AWS account ID, though. Every viewer can see it, so be aware of that.

One more thing I noticed when running it: the player sends playback statistics to `player.stats.live-video.net`. If you embed it in a site with a Content Security Policy, that host needs allowing along with the playback domain.

## What you can check locally

<!-- section: 18.local -->

Live streaming can't be completed on your machine alone, because the place that receives video exists only in AWS. Even so, a good part of it can be checked locally.

```bash
vp run test:unit
vp run stream:infra:synth
vp run dev:stream:web
```

`dev:stream:web` serves the player page at <http://localhost:5183>. There's no channel yet, so it only says "No channel is configured." That is the correct behavior.

Here's what the tests look at.

| Where | File | What it checks |
| --- | --- | --- |
| Channel settings | `test/channel.test.ts` | Whether bitrate and resolution fit the type's limits. That no key ends up in the server URL |
| Stream state | `test/stream.test.ts` | That "offline" and "unknown" are never mixed up. How input time is counted |
| Events | `test/events.test.ts`, `test/timeline.test.ts` | Event shapes. That reordering and duplicates don't change the conclusion |
| Player page | `web/src/viewer.test.ts` | That 404 is treated as offline. Retry intervals. Config validation |
| Infrastructure | `infra/test/live-stack.test.ts` | That the key's value never appears in the template. Permissions, no recording, deletion settings, resource types |

Let's also be clear about what isn't reproduced locally.

- **Actual broadcasting and viewing.** Whether video arrives, how many seconds behind it is, whether the player really plays it
- **The real responses of the IVS API.** The schemas for the `GetStream` response and the events are written from the documentation's examples
- **IAM.** The scripts run with your own permissions
- **OBS settings.** That's manual work

Honestly, this chapter has not yet broadcast a single stream on a real account. What was checked locally is summarized at the end of the chapter.

## Broadcast something

<!-- section: 18.broadcast -->

From here on you need an AWS account. And from here on, charges begin.

```bash
vp run stream:infra:diff
vp run stream:infra:deploy
```

This creates the channel, the stream key, and the Lambda function and rule that receive events. Nothing is flowing yet, so there are no IVS charges at this point.

### Setting up the streaming software

Let's use OBS Studio. The IVS documentation is written for version 30.2 or later.

```bash
vp run stream:key --show
```

1. Open Settings > Stream in OBS and choose "Amazon IVS" as the Service
2. Paste the value that was just printed, starting with `sk_`, into Stream Key
3. In Settings > Output, set Output Mode to Advanced, and on the Streaming tab set Keyframe Interval to 2
4. Set Video Bitrate below the limit that `stream:key` printed. For 720p that's under 3,500 kbps. Start around 2,500 to leave room
5. In Settings > Video, set Output (Scaled) Resolution to 1280x720
6. In the main window, choose Start Streaming

If Amazon IVS isn't in the Service list, choose "Custom" and enter the `rtmps://...:443/app/` that `stream:key` printed as the Server.

Without OBS, the IVS documentation also has an example of sending a video file with FFmpeg.

### Watch it

In another terminal, hand the playback URL to the page and open it.

```bash
vp run stream:config
vp run preview:stream:web
```

`stream:config` builds the page and writes the playback URL, taken from the stack's outputs, into `web/dist/config.json`. `preview:stream:web` serves that at <http://localhost:4183>.

It takes a moment from starting the broadcast until it can be watched. According to the documentation, about 6 to 7 seconds with a 2-second keyframe interval. The page waits as "offline" and reconnects on its own.

To show this page to other people, put `web/dist` on S3 and CloudFront the way [chapter 03](/en/chapters/03-spa.md) does. This chapter's stack doesn't include that. The recipe is about the channel.

### When you're done, stop

Press Stop Streaming in OBS. Then on to the next section.

## Has it stopped?

<!-- section: 18.status -->

This is the most important section in the chapter.

IVS charges input for the time video is being sent. To quote the pricing page directly: "All streams sent to Amazon IVS incur video input costs, even if they are not viewed." After the viewers have gone home, billing continues as long as OBS is running.

You meant to close the OBS window and only minimized it. You left the streaming PC as it was and went home. It happens.

So check.

```bash
vp run stream:status --expect-offline
```

It asks IVS "are you live right now?" If the channel is live, it prints how many minutes it has been and exits with code 1. If it has stopped, it exits with 0.

Behind that question is the `GetStream` API, and reading its answer has a quirk.

<<< @/examples/18-live/src/stream.ts{status}

Call `GetStream` on a channel that isn't broadcasting and you don't get a response saying "offline." You get an **error** named `ChannelNotBroadcasting`. The API reference says so too: do not rely on the `OFFLINE` state, as the API may not return it.

The dangerous move here is rounding every error to "offline." Missing permissions, a dropped network, throttling: all errors, and none of them is evidence that the stream has stopped. If "unknown" were displayed as "stopped," this script would be worthless. So only `ChannelNotBroadcasting` is read as offline, and everything else is an exception. The tests check exactly that.

`viewerCount` has a small quirk as well: when counting doesn't finish in time, it comes back as `-1`. The code turns that into `null` so that nothing ever says "-1 viewers."

### When it won't stop

If you can't reach OBS, you can cut the stream through the API.

```bash
vp run stream:stop
```

Many encoders reconnect automatically when cut off, though. The `StopStream` documentation carries that warning. To stop it for sure, take the key away.

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:stop
vp run stream:status --expect-offline
```

Delete the key, then cut the stream, and the reconnect is refused.

By the way, IVS has two backstops of its own. If data from the encoder stops for 30 seconds, IVS disconnects. And a single stream lasts 48 hours at most. But an encoder set to reconnect starts a new stream after being cut at 48 hours. You can't count on it.

## Receiving state changes

<!-- section: 18.events -->

When you want "notify me when the stream starts" or "do something when it ends," you don't call `GetStream` every second. You receive the events IVS sends to EventBridge.

<<< @/examples/18-live/infra/lib/live-stack.ts{events}

The rule passes to Lambda only the events from `aws.ivs` that belong to this channel. The function's only permission is writing to its own log group. It has no IVS permissions, so it cannot read the stream key.

An event that arrives is first checked for shape.

<<< @/examples/18-live/src/events.ts{schema}

Leaving `event_name` a plain string instead of an enum is deliberate. New kinds of events may appear without you noticing. When an unknown name arrives, the code should record it and move on, not reject it.

Even for an event of the wrong shape, the function doesn't fail.

<<< @/examples/18-live/src/handler.ts{handle}

A shape that doesn't match will not match on any retry. The function logs it and finishes normally.

### Events are "usually delivered"

Now for the real subject. The IVS documentation says this about events: they are sent on a best-effort basis. That means

- an event may not be delivered
- an event may arrive hours late
- events may arrive out of order: you could see Stream End before Stream Start

It also says this is rare. But an app whose "live" badge never goes away on the day it happens is a problem.

So the function that works out "is it live?" from the events received is written so that it **does not depend on order**.

<<< @/examples/18-live/src/timeline.ts{belief}

What it does is simple. For each stream, build the set of event names seen. If an ending event is in the set, that stream has ended. Because it's a set, neither the arrival order nor one event arriving twice affects the result.

An end can be treated as final because stream IDs are not reused. Each time a channel goes live it gets a new `stream_id`. So a start that arrives after an end is an old start that was delivered late, not a comeback.

The tests feed four events in all 24 possible orders and confirm that the conclusion never changes.

Even so, nothing can be done about an event that **never arrived**. If the end event is lost, this function keeps saying "live." That's where checking the answer comes in.

<<< @/examples/18-live/src/timeline.ts{reconcile}

```bash
vp run stream:status --events
```

It puts the `GetStream` answer next to the picture built from the logged events and, if they disagree, says which one to believe. The one to believe is `GetStream`.

Here's the design rule to take away. An event is a signal that "something seems to have changed." The owner of the state is IVS, and the current state is something you ask IVS for. An app that builds state from events alone and treats it as the truth breaks on the day one event goes missing.

## Every viewer has a different "now"

<!-- section: 18.latency -->

Live streaming has an interesting property as a distributed system. **Everyone watches the same video, and nobody watches the same moment.**

```text
wall clock  what happens                                   viewer A (desktop)   viewer B (browser on iOS)
12:00:00    a goal is scored in front of the camera
12:00:00    chat (a separate path) delivers "GOAL!"        reads "GOAL!"        reads "GOAL!"
12:00:03    video of the goal reaches viewer A             sees the goal
12:00:08    video of the goal reaches viewer B                                  sees the goal

The numbers are made up for illustration. They are not measurements.
```

A and B having different delays is nothing unusual. According to the documentation, latency varies with where the broadcaster and the viewers are, their networks, and the components in between. On top of that, browsers on iOS don't support low-latency playback and get normal latency. Open the same stream in the same room on a PC and an iPhone, and you should hear them out of step.

The player page shows that viewer's own latency. The value comes from the player's `getLiveLatency()`, which is the latency "from the server to the player." It doesn't include camera to server.

This matters when you combine the video with something that arrives over **a separate path**: chat, poll results, a score display, a "the stream has ended" notice. As in the diagram, the chat's "GOAL!" reaches everyone before the video does. That's a spoiler. And how far ahead it arrives differs per viewer, so deciding on the server to "wait 3 seconds before sending" won't fit everyone.

Written as an invariant: **which moment of the video something from a separate path appears alongside is not guaranteed.** Don't build screens on the assumption that they are in sync.

### Things that should arrive with the video

For things that really must line up with the video, like "show everyone the quiz question at that scene," IVS has a dedicated mechanism: **timed metadata**.

Send a small piece of data (up to 1 KB) with `PutMetadata` and IVS embeds it in the video. A viewer receives it on playing that position of the video. Someone 3 seconds behind gets it 3 seconds later, someone 8 seconds behind gets it 8 seconds later. Each gets it at "the same scene" as they see it.

The player page displays any timed metadata it receives as is (`TEXT_METADATA_CUE` in `player.ts`). During a broadcast you can try it with the CLI command from the documentation.

```bash
aws ivs put-metadata --channel-arn <ChannelArn> --metadata '{"question":"..."}'
```

It isn't a cure-all. As the documentation says, there's no guarantee how long embedding takes after you send, the limit is 5 calls a second per channel, and it works only while the channel is live. It doesn't replace chat. Use it only for the things you need to say "at this scene of the video."

This command and its display on the page have not been checked on a real stream.

## Money

<!-- section: 18.cost -->

Amounts are in USD, pay-as-you-go, before tax. The calculations are on the [pricing worksheets](/en/reference/pricing.md) page.

IVS pricing has two layers.

- **Input**: the time video was being sent. The rate depends on the channel type: `BASIC` is 0.20 an hour and `STANDARD` is 2.00. Rounded up to the minute
- **Output**: the total time delivered to viewers. The rate depends on resolution and on which area the video was served from. In the first tier for the area that includes Japan, per hour: SD (480 or less) 0.046, HD (720 or less) 0.092, Full HD (1080 or less) 0.184. Rounded up to the second

Output is "number of viewers times the time each watched." A hundred people watching an hour each is 100 hours.

**In a month with no broadcasts, IVS costs 0.** Neither the pricing page nor the Price List has a charge for a channel that merely exists. That's the difference from MediaLive, which we'll get to.

### When you use it

You broadcast four times a month, 2 hours each, sending 720p to a `BASIC` channel. Each time, viewers watch half the stream on average (the proportion the IVS documentation gives as a rule of thumb).

| | 100 viewers each time | 1,000 viewers each time |
| --- | --- | --- |
| Input: 8 hours | 1.60 | 1.60 |
| Output: 400 hours / 4,000 hours in HD | 36.80 | 368.00 |
| Subtotal | **38.40** | **369.60** |

As you can see, nearly all of the bill is output. And output is proportional to the audience. What determines the invoice is not how many servers you run but **how many people watched for how many minutes**. More popular means more expensive, which is obvious, but when you estimate, always write down the assumed number of viewers and viewing time.

About the free tier: the pricing page says new AWS accounts get 5 hours of `BASIC` input and 100 hours of SD output each month for their first 12 months. It expires and doesn't apply to every account, so the table above doesn't subtract it.

EventBridge, Lambda, and CloudWatch Logs charges are not in this table (not included, which is different from 0). Neither is hosting the player page.

### When you forget to stop

Zero viewers. Only the streaming software kept running.

| | `BASIC` | `STANDARD` |
| --- | --- | --- |
| 48 hours (a weekend) | 9.60 | - |
| 730 hours (a month) | 146.00 | 1,460.00 |

This is why the chapter chose `BASIC`. For the same mistake, the bill differs by an order of magnitude.

The budget notification from chapter 01 helps here too. But it notifies; it doesn't stop anything. What stops things is `stream:stop` and `streamKey=off`.

### After you delete it

Delete the stack and the channel and the stream key are gone, and IVS charges no longer occur. The event logs go with them.

## Recording, once you need it

The channel in this chapter doesn't record. A test checks that the template has no recording configuration and no S3 bucket.

When you need it, IVS has auto-record to S3. Create an `AWS::IVS::RecordingConfiguration`, pass it to the channel's `RecordingConfigurationArn`, and every broadcast is written out to a bucket.

Three things to know before adding it.

- **Cost.** The recording feature itself has no IVS charge. S3 does: storage, the write requests IVS makes on your behalf, and delivery when you serve the recordings to someone
- **What remains.** Recordings are objects in your bucket. Delete the channel and the bucket's contents should stay as they are (I found no statement that IVS removes them). Each broadcast adds HLS video, thumbnails, and JSON metadata under `ivs/v1/<account ID>/<channel ID>/<date and time>/...`. Without a lifecycle rule, the storage charge keeps growing
- **When it becomes usable.** The documentation recommends playing or processing a recording only after the `Recording End` event. And that event too is, as we just saw, only "usually delivered"

Don't forget the weight of storing video that has people in it. Decide how it gets deleted, and by when, at the same time you add recording.

## If you're coming from Cloudflare Stream

If you've done live streaming on Cloudflare, Stream's Live is the nearest experience. Here are the differences, as far as I could confirm them in Cloudflare's documentation.

- **Sending is the same.** Both accept RTMPS and SRT. OBS works as is
- **The viewing side.** Stream says you can play in its own player or in any player that supports HLS or DASH. With IVS, the IVS player is required to get a delay of a few seconds
- **Recording.** Stream records every live stream automatically. IVS records nothing unless asked
- **What you're billed on.** Stream names "minutes recorded" and "minutes delivered," with no separate encoding charge. IVS bills "input hours" and "viewing hours (by resolution)." Stream charges for minutes recorded, so the two are alike in that leaving a stream running costs money

That Cloudflare page gave no latency figures, so I haven't compared latency. Which is cheaper also depends on audience size, quality, and whether you need recordings, so I won't say here.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| OBS says "Failed to connect to server" | An old OBS doesn't support RTMPS. Update it. If you re-created the key, is the old one still in the settings? |
| It connects and is cut off right away | Bitrate or resolution is over the type's limit. `BASIC` takes up to 3.5 Mbps at 720p. If `stream:status --events` shows `Ingest Bitrate`, that's it |
| The page stays "offline" | Check with `stream:status` whether the channel is live. If it is, the playback URL in `web/dist/config.json` may belong to an old channel. A 404 can't tell "offline" from "wrong URL" |
| Video plays but tens of seconds behind | Is the keyframe interval 2 seconds? Browsers on iOS don't support low latency |
| The player doesn't work in the built page | Is the `.wasm` file served as `application/wasm`? That's a condition for hosting it yourself |
| `stream:key` can't find `StreamKeyArn` | The stack was deployed with `streamKey=off`. Deploy it normally once more |
| `stream:infra:destroy` fails | A live channel can't be deleted (409). Stop it and wait until `stream:status --expect-offline` passes |
| `stream:status --events` says "DISAGREE" | Events are late or lost. As it says, `GetStream` is the answer |

## If this were production

- **Restrict who can watch.** Right now anyone with the URL can. IVS has private channels (`authorized: true`), which play only with a signed token, and playback restriction policies that filter by country or origin. This chapter doesn't cover them
- **Reconsider the type.** If viewers' connections vary, use `STANDARD` or `ADVANCED`, which produce several renditions. Weigh that against the input rate
- **Prevent forgotten streams with a mechanism.** Notify when a channel is still live past its scheduled time, or issue a key per broadcast and delete it afterwards. "Being careful" is not a mechanism
- **Decide where the stream key lives.** How it reaches the broadcaster, how it gets re-created, and who can read the state bucket
- **Check the limits.** By default, 15,000 concurrent views across a Region and 100 concurrent streams. Raise them in Service Quotas before a big broadcast
- **Put the player page on a CDN.** With chapter 03's setup. Don't forget the Content-Type for `.wasm`
- **Deploy through the AWS CDK CLI and CloudFormation.** As chapter 02 said, cdkd is meant for development and testing

### When you need MediaLive and MediaPackage

IVS is a service for delivering a fixed kind of broadcast in a fixed way. Input is H.264 and AAC, the quality ladder is set by the type, and you can't design your own.

When you want to step outside that fixed shape, AWS Elemental MediaLive comes in. MediaLive transforms live video into other formats and packages, and you design the outputs yourself. MediaPackage packages that output for viewing and acts as the origin. You want to decide output formats and the quality ladder yourself, or connect to other video services: that's when you combine MediaLive, MediaPackage, and a CDN yourself.

In return you get more parts and more pricing dimensions. A MediaLive channel is charged while it's running even if nothing is arriving at its inputs. Even stopped, some resources carry an idle charge. It isn't "0 unless you're streaming," as IVS is.

A delay of a few seconds, sent from OBS, shown on the web: while that's enough, IVS as it is will do.

## Cleaning up

<!-- section: 18.cleanup -->

There's an order to this. A live channel can't be deleted, so stop it first.

```bash
vp run stream:status --expect-offline
vp run stream:infra:destroy
```

If the first line fails (the channel is live), stop OBS or run `vp run stream:stop`.

The channel, stream key, rule, function, role, and log group are deleted. So are the logs.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. Also, `web/dist/config.json` on your machine still holds the playback URL of a channel that no longer exists. The stream key pasted into your streaming software no longer works either, but it's still in the settings. Remove it.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (channel settings, interpreting `GetStream`, validating and folding events, the player page's decisions, stack assertions). Type checks (the whole example, and the player page with Vize). Template lint. Synth (including the esbuild bundle, with no request to AWS). That the player page build contains the player's worker and `.wasm`. Started `dev:stream:web` and confirmed in a browser what is shown when no channel is configured. Also, with the playback URL of a channel that does not exist set temporarily, confirmed that the player loads the worker and WebAssembly, receives a 404 from the IVS playback domain, and that the page shows "offline" and schedules a retry (no credentials were used, and the config was restored afterwards).

**Not checked yet.** No real broadcast has been made or watched. `stream:infra:diff`, `deploy`, `drift`, `destroy`, `stream:key`, `stream:config`, `stream:status`, and `stream:stop` have not been run against AWS. Specifically: creating and deleting `AWS::IVS::Channel` and `AWS::IVS::StreamKey` through Cloud Control API, whether cdkd's state holds the stream key value, re-creating the key via `streamKey=off`, connecting from OBS, playback and the latency value in the player, displaying timed metadata, the real `GetStream` response and the name `ChannelNotBroadcasting`, the real shape of the EventBridge events, whether `stream:status --events` can read events back from Lambda's log lines, and that deleting a live channel fails. The OBS steps follow the IVS documentation and were not checked on screen. The latency seconds in the diagram are made up for illustration.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Decide on the channel | `examples/18-live/src/channel.ts`, `infra/lib/live-stack.ts`, `test/channel.test.ts` | `test:unit`, `stream:infra:synth` |
| The stream key is the key | `examples/18-live/infra/lib/live-stack.ts`, `infra/bin/app.ts`, `infra/test/live-stack.test.ts`, `scripts/key.ts` | `test:unit`, `stream:key` |
| The player page | `examples/18-live/web/src/player.ts`, `viewer.ts`, `config.ts`, `App.vue`, `viewer.test.ts` | `dev:stream:web`, `build:stream:web`, `typecheck:stream:web`, `lint:stream:web` |
| Broadcast something | `examples/18-live/scripts/key.ts`, `scripts/write-config.ts` | `stream:infra:diff`, `stream:infra:deploy`, `stream:key`, `stream:config`, `preview:stream:web` |
| Has it stopped? | `examples/18-live/src/stream.ts`, `src/ivs.ts`, `scripts/status.ts`, `scripts/stop.ts`, `test/stream.test.ts` | `stream:status`, `stream:stop` |
| Receiving state changes | `examples/18-live/src/events.ts`, `handler.ts`, `timeline.ts`, `logged-events.ts`, `test/events.test.ts`, `test/timeline.test.ts` | `test:unit`, `stream:status` |
| Every viewer has a different "now" | `examples/18-live/web/src/player.ts`, `App.vue` | `preview:stream:web` |
| Money | `data/pricing/`, `tools/src/pricing/calc.ts` | `test:unit` |
| Cleaning up | `tools/src/infra/`, `examples/18-live/scripts/status.ts` | `stream:status`, `stream:infra:destroy` |

**How cdkd handles this stack's resources.** I read the part corresponding to `src/provisioning/register-providers.ts` in the npm tarball of the pinned version (0.296.28). `AWS::Events::Rule`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, and `AWS::Logs::LogGroup` have dedicated implementations. `AWS::IVS::Channel` and `AWS::IVS::StreamKey` do not, and go through Cloud Control API.

**Primary sources** (all checked on 2026-10-11)

- [What is Amazon IVS Low-Latency Streaming?](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html), [What is Amazon IVS Real-Time Streaming?](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html)
- [Amazon IVS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ivs.html)
- [Amazon IVS Streaming Configuration](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/streaming-config.html), [Set Up Streaming Software](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/getting-started-set-up-streaming.html)
- [Amazon IVS Pricing](https://aws.amazon.com/ivs/pricing/), [IVS Costs](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/costs.html), AWS Price List bulk API: [IVS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonIVS/current/index.json) (there is no per-Region file; usage types starting with `AP-` are "Japan, Hong Kong, SEA")
- CloudFormation: [AWS::IVS::Channel](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-channel.html), [AWS::IVS::StreamKey](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-streamkey.html)
- IVS API: [GetStream](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_GetStream.html), [Stream](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_Stream.html), [StopStream](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_StopStream.html), [DeleteChannel](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_DeleteChannel.html)
- [Using Amazon EventBridge with IVS](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html)
- [IVS Player SDK](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html), [Web Player SDK: Getting Started](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/web-getting-started.html), [amazon-ivs-player 1.57.0](https://www.npmjs.com/package/amazon-ivs-player/v/1.57.0) (type definitions and `package.json`)
- [Embedding Metadata within a Video Stream](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/metadata.html), [Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html)
- [What Is MediaLive?](https://docs.aws.amazon.com/medialive/latest/ug/what-is.html), [MediaLive: Related Services](https://docs.aws.amazon.com/medialive/latest/ug/related-services.html), [AWS Elemental MediaLive Pricing](https://aws.amazon.com/medialive/pricing/)
- [Cloudflare Stream: Stream live video](https://developers.cloudflare.com/stream/stream-live/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

Points I could not settle from primary sources: that aws-cdk-lib has no higher-level IVS construct was confirmed by the pinned version (2.273.0) having only `Cfn*` classes in `aws-ivs`. I did not look into whether a separate package offers one. For private channels and playback restriction policies I only confirmed that they exist, from the CloudFormation property and the quota table, and did not read the procedures. That recordings remain after the channel is deleted follows from their being S3 objects, but I found no statement that says so. The description of MediaPackage follows the "Related Services" page of the MediaLive documentation.

:::
