---
title: "18 Live Streaming: IVS"
sourceRevision: 2
---

# 18 Live Streaming: IVS

This chapter is a recipe that stands on its own. You send video from streaming software and watch it on a web page a few seconds later, and you build that with the smallest setup that works.

The service is Amazon IVS (Interactive Video Service). IVS handles the heavy parts, which are receiving the video, converting it, and delivering it around the world. What you write is a channel definition, a viewing page, and a script that checks whether a stream is running.

Know one thing about the bill before you start. IVS **charges for as long as video is being sent to it, even with zero viewers.** If you go to bed without closing your streaming software, you are billed until morning. The [deploy page](/en/chapters/18-live/deploy.md) shows how to confirm that a stream has stopped, in the section "Confirm it has stopped." After you try things out, go all the way to that step.

The chapter assumes you have read [chapter 04](/en/chapters/04-http-api.md), because it uses Lambda and logs. The code is in `examples/18-live/`.

## The big picture

<!-- section: 18.overview -->

```figure
caption: The channel takes one broadcast, delivers it to viewers, and reports changes of state as events
node encoder: Encoder | OBS, FFmpeg, presents the stream key
node terminal: Your terminal | stream:status
node viewer: Viewer's browser | viewing page (Vue + IVS player SDK)
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

The highlighted box is the **channel**, the unit that takes one broadcast and delivers it to viewers. A channel has two addresses. Streaming software sends video to the ingest endpoint, and viewers watch from the playback URL.

The sender presents a secret string called the **stream key**. Anyone who has the stream key can broadcast to this channel, so treat it as a password.

You create the channel as a resource in the Tokyo Region, but video is received and delivered worldwide. The documentation describes the control plane, which is the API and the resources, as regional, and the data plane, which is streaming and viewing, as global. A channel created in Tokyo accepts video from anywhere and can be watched from anywhere.

The path that runs down from the channel through the EventBridge rule, Lambda, and CloudWatch Logs is how you learn that a stream started or ended. The [deploy page](/en/chapters/18-live/deploy.md) covers it in detail, but the events on that path are only "usually delivered." To find out whether the channel is live right now, you ask IVS with `GetStream`, the arrow from your terminal to the channel.

## There are two IVS products

<!-- section: 18.products -->

The name IVS covers two separate products. Decide which one you are using before you build.

| | Low-latency streaming | Real-time streaming |
| --- | --- | --- |
| Resource | channel | stage |
| Latency (as documented) | under 5 seconds | can be under 300 milliseconds |
| How you send | RTMPS, RTMP, SRT. OBS works as is | IVS broadcast SDKs, among others |
| Default scale | 15,000 concurrent views (per Region, adjustable) | 12 publishers and 10,000 subscribers per stage (adjustable) |
| Billed by | input hours and viewing hours | hours per participant |
| Tokyo Region | has an endpoint | has an endpoint |

This chapter builds the left column, low-latency streaming. One person broadcasts from OBS and many people watch on a web page a few seconds behind, which is the plainest form of live streaming.

Choose real-time streaming, the right column, **when a conversation has to work**. When viewers join the broadcast to talk, or bidders call out in an auction, a delay of a few seconds breaks the exchange. In return, the sender becomes an app with an SDK built in, so there is more to build.

Lower latency alone is not a reason to choose the right column. In a one-way broadcast, a 3-second delay hurts nobody.

## Decide on the channel

<!-- section: 18.channel -->

The channel takes only three settings.

<<< @/examples/18-live/src/channel.ts{settings}

`type` affects price and quality more than anything else. There are four types, and IVS does something different for each.

| type | Input, per hour (USD) | What IVS does | Input limit |
| --- | --- | --- | --- |
| `BASIC` | 0.20 | Delivers the video as sent, in one version | 1.5 Mbps at 480p or less, 3.5 Mbps above that |
| `STANDARD` (default) | 2.00 | Converts into several qualities, up to 1080p | 8.5 Mbps |
| `ADVANCED_SD` | 0.50 | Converts into several qualities, up to 480p | 8.5 Mbps |
| `ADVANCED_HD` | 0.85 | Converts into several qualities, up to 720p | 8.5 Mbps |

Each of the "several qualities" in the table is called a **rendition**. When you send 1080p to a `STANDARD` channel, IVS also produces 720p, 480p, 360p and 160p, and the player switches between them to suit each viewer's connection.

This chapter uses `BASIC` because it is cheap. If you leave `type` out you get `STANDARD`, at ten times the input rate. For an hour of practice the difference is USD 1.80, but it grows large when you forget to stop. The [costs page](/en/chapters/18-live/wrap.md) works out the amounts.

The price of that choice is that `BASIC` has a single rendition. A viewer on a slow connection has no lower quality to switch to, so playback stalls for anyone who cannot keep up with the bitrate you sent. For a production broadcast to viewers on all kinds of connections, that is the reason to choose `STANDARD` or `ADVANCED`.

`latencyMode` is `LOW`, which the console calls Ultra-low. Nothing in this chapter gives a reason to choose `NORMAL`.

### Go over the limit and you are cut off

Going over the input limit does not lower the quality. The documentation says the stream "probably will disconnect immediately." And the bitrate that OBS's setup wizard picks can be higher than the `BASIC` limit.

So the example has a function that checks whether your settings fit the limit before you send.

<<< @/examples/18-live/src/channel.ts{limits}

The function also checks the keyframe (IDR) interval. IVS recommends 2 seconds. The interval affects both how long a stream takes to become watchable after you start and the latency itself. The documentation says to avoid values above 5 seconds.

### Writing it in CDK

<<< @/examples/18-live/infra/lib/live-stack.ts{channel}

The pinned aws-cdk-lib has no higher-level construct for IVS, so the stack uses `CfnChannel`, which maps directly onto the CloudFormation resource. It has few properties, so this is no hardship.

`authorized: false` means that anyone who knows the playback URL can watch. The broadcast in this chapter is public, and the broadcaster pays for the time watched. The [costs page](/en/chapters/18-live/wrap.md) works out what that comes to under "When the URL gets around," and lists ways to restrict who can watch under "If this were production."

`insecureIngest: false` refuses unencrypted RTMP. Over RTMP, the stream key would cross the network in plain text.

## The stream key is the key

<!-- section: 18.stream-key -->

Whoever holds the stream key can put any video they like on your channel, on your bill. Treat it the way you treat an API key.

<<< @/examples/18-live/infra/lib/live-stack.ts{stream-key}

Two things are easy to get wrong when you create a stream key with CloudFormation.

The first is that creating a channel does not give you a stream key. When you create a channel through the IVS API, from the console or with `aws ivs create-channel`, a stream key is created with it. CloudFormation's `AWS::IVS::Channel` does not create one, so unless you also write an `AWS::IVS::StreamKey`, you end up with a channel nobody can broadcast to.

The second is that a channel has at most one stream key, and that limit cannot be raised.

### Never print the value

The `attrValue` attribute of `CfnStreamKey` is the key itself. If you pass `attrValue` to a `CfnOutput`, the key appears in the deploy log and in the stack's outputs. If you pass it to a Lambda environment variable, everyone who can view the function's configuration sees it.

For that reason this stack never uses `attrValue`, and the only output is the ARN. A test also confirms that nothing in the template refers to `Value`.

You need the value of the key only when you paste it into streaming software, so that is when you fetch it.

```bash
vp run stream:key
vp run stream:key --show
```

The first command prints the server URL and the bitrate limit to enter in the streaming software, and it does not print the key. Only with `--show` does the script fetch the value with `GetStreamKey` and print it once, to that terminal. It writes the value to no file.

There may be one more copy of the key, though. cdkd creates IVS resources through Cloud Control API. As far as I can tell from the source of the pinned version, cdkd records what comes back for the resource as attributes in its state, which is an S3 bucket. And what comes back for an `AWS::IVS::StreamKey` includes `Value`. So **anyone who can read cdkd's state may be able to read the stream key**. I have not confirmed this against a real deployment, which is why it says "may," but treat the state bucket as a place that holds secrets.

### If it leaks, make a new one

A stream key has no operation that changes only its value. You delete it and create another. Because a channel holds only one, you delete first and create second.

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:infra:deploy
```

The first deploy removes the stream key from the template, and cdkd deletes the real one. The second deploy creates a new key. Both the ARN and the value change, so you have to set up the streaming software again.

You can also stop after the first deploy. Nobody can broadcast to a channel that has no key, so this locks a channel you will not use for a while.

You could re-create the key in the console or with the CLI, but then a key exists that the stack does not know about, and the state no longer matches what is deployed. `vp run stream:infra:drift` should find it, but re-creating the key through the stack from the start is less confusing.

## The viewing page

<!-- section: 18.player -->

Next is the viewing side. An IVS playback URL is an HLS playlist (`.m3u8`), but watching it a few seconds behind takes the IVS player SDK. The documentation states flatly that the IVS player is required to achieve low latency.

You can get the SDK from a CDN with a `<script>` tag or from npm as `amazon-ivs-player`. This chapter uses npm, because the package comes with TypeScript types and the lockfile pins its version. The current version when I checked was 1.57.0.

Mind the license. This package is not open source. It is "AWS Content," provided under the AWS Customer Agreement.

<<< @/examples/18-live/web/src/player.ts{start}

The `wasmWorker` and `wasmBinary` arguments to `create` are needed when you use the npm package. The player's core is WebAssembly and runs inside a web worker, so you have to tell the player the URLs of those two files. Importing them with `?url` at the top of the file makes Vite include both in the build and return their URLs.

Playback starts muted, because browsers may block autoplay of video with sound.

### "Not broadcasting" is not a failure

People open the viewing page before the stream begins. At that point the player reports an error whose type is `ErrorNotAvailable` and whose code is 404.

Showing that error as "playback failed" would be wrong, because the stream simply has not started.

<<< @/examples/18-live/web/src/viewer.ts{view}

`viewFor` reads 404 as "offline," 429 as "the viewer limit was reached," and any other error as a failure. The decision lives in a plain function, separate from the player. The function does not load the SDK, so you can test it without a browser.

While the channel is offline, the page waits and then asks again.

<<< @/examples/18-live/web/src/viewer.ts{retry}

The wait starts at 5 seconds, doubles each time, and stops growing at a minute. Every open tab sends this request. With 1,000 people waiting from an hour before the broadcast, a fixed 1-second interval is not acceptable.

### The playback URL is not built in

The playback URL is not known until you deploy, so the page reads it from `/config.json` when it starts, as in [chapter 06](/en/chapters/06-auth.md).

<<< @/examples/18-live/web/src/config.ts{config}

The playback URL is handed to every viewer's browser, so it is not a secret. It does contain your AWS account ID, though, and every viewer can see that.

I noticed one more thing when running the page. The player sends playback statistics to `player.stats.live-video.net`. If you embed the player in a site that has a Content Security Policy, you need to allow that host along with the domain of the playback URL.
