---
title: "18 Live Streaming: Deploy"
---

# 18 Live Streaming: Deploy

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

These three lines aren't only for a forgotten stream. They're also the brake when viewers you can't account for are parked on the channel and the output charge is running. With no video coming in, there's nothing to deliver. The amounts are worked out under "When the URL gets around" in the Money section.

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

```figure
caption: The news arrives over chat for both viewers at once, and the video of the goal arrives with a different delay for each (the numbers are made up for illustration, not measured)
type: sequence
actor cam: camera
actor chat: chat | a separate path
actor a: viewer A | desktop
actor b: viewer B | browser on iOS
step cam -> cam: 12:00:00 a goal is scored
step chat -> a: 12:00:00 "GOAL!"
step chat -> b: 12:00:00 "GOAL!"
step cam -> a: 12:00:03 video of the goal
step cam -> b: 12:00:08 video of the goal
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
