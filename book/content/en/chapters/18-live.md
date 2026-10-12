---
title: "18 Live Streaming: IVS"
sourceRevision: 2
---

# 18 Live Streaming: IVS

This chapter is a stand-alone recipe. You send video from streaming software and watch it on a web page a few seconds later. We'll build that with the smallest setup that works.

The service is Amazon IVS (Interactive Video Service). It takes care of the heavy parts: receiving the video, converting it, and delivering it around the world. What's left for you to write is a channel definition, a player page, and a script that checks the state.

One thing first. IVS **charges for as long as video is being sent to it, even with zero viewers.** Forget to close your streaming software before bed and you're billed until morning. How to confirm that a stream has stopped is in the section "Has it stopped?" in this chapter. After you try things out, please go all the way to that step.

The prerequisite is [chapter 04](/en/chapters/04-http-api.md), because Lambda and logs come up. The code is in `examples/18-live/`.

## The big picture

<!-- section: 18.overview -->

```figure
caption: The channel takes one broadcast, delivers it to viewers, and reports changes of state as events
node encoder: Encoder | OBS, FFmpeg, presents the stream key
node terminal: Your terminal | stream:status
node viewer: Viewer's browser | player page (Vue + IVS player SDK)
node ingest: IVS ingest endpoint | global
node channel: IVS channel "aih-live" | ap-northeast-1, type BASIC, latency mode LOW, at most one stream key
node rule: EventBridge rule | this channel only: stream state, stream health, limit breach
node playback: IVS playback URL | HTTPS, delivered globally
node fn: Lambda | validate, log one line
node logs: CloudWatch Logs | 7 days
edge encoder -> ingest: RTMPS :443
edge ingest -> channel
edge terminal -> channel: GetStream: "is it live right now?"
edge channel --> rule: emits events (best effort)
edge channel -> playback
edge viewer -> playback: reads /config.json -> playbackUrl
edge rule -> fn
edge fn -> logs
mark channel
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

`authorized: false` means "anyone who knows the playback URL can watch." The broadcast in this chapter is public. And the one who pays for the time watched is the broadcaster. What it comes to when the URL gets around is worked out in the Money section. When you want to restrict who can watch, see "If this were production."

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
