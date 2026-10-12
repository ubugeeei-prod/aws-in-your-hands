---
title: "18 Live Streaming: Deploy"
---

# 18 Live Streaming: Deploy

On this page you put the channel and the viewing page from the earlier pages on AWS, broadcast for real, and confirm that the stream has stopped. The second half covers receiving changes in a stream's state and the way latency differs from viewer to viewer.

## Broadcast something

<!-- section: 18.broadcast -->

From here on you need an AWS account, and charges begin.

```bash
vp run stream:infra:diff
vp run stream:infra:deploy
```

The deploy creates the channel, the stream key, and the Lambda function and rule that receive events. Nothing is flowing yet, so IVS charges nothing at this point.

### Setting up the streaming software

The steps use OBS Studio. The IVS documentation is written for version 30.2 or later.

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

If you would rather not use OBS, the IVS documentation also has an example of sending a video file with FFmpeg.

### Watch it

In another terminal, give the playback URL to the viewing page and then open the page.

```bash
vp run stream:config
vp run preview:stream:web
```

`stream:config` builds the viewing page and writes the playback URL, taken from the stack's outputs, into `web/dist/config.json`. `preview:stream:web` serves that build at <http://localhost:4183>.

A broadcast takes a little while to become watchable after you start it. According to the documentation, that is about 6 to 7 seconds with a 2-second keyframe interval. Until then the page shows "offline," waits, and reconnects on its own.

To show this page to other people, put `web/dist` on S3 and CloudFront the way [chapter 03](/en/chapters/03-spa.md) does. This chapter is about the channel, so its stack does not include that setup.

### When you're done, stop

Press Stop Streaming in OBS. Then confirm in the next section that the stream has stopped.

## Confirm it has stopped

<!-- section: 18.status -->

This is the most important section in the chapter.

IVS charges input for the time video is being sent. The pricing page says: "All streams sent to Amazon IVS incur video input costs, even if they are not viewed." After the viewers have left, billing continues for as long as OBS is running.

It is easy to minimize the OBS window when you meant to close it, or to go home and leave the streaming PC as it was. So you confirm with a command that the stream has stopped.

```bash
vp run stream:status --expect-offline
```

The command asks IVS whether the channel is live right now. If it is, the command prints how many minutes the stream has run and exits with code 1. If the stream has stopped, it exits with 0.

The script asks through the `GetStream` API, and the response needs careful reading.

<<< @/examples/18-live/src/stream.ts{status}

When you call `GetStream` on a channel that is not broadcasting, you do not get a response that says "offline." You get an **error** named `ChannelNotBroadcasting`. The API reference also says not to rely on the `OFFLINE` state, because the API may not return it.

What you must not do here is treat every error as "offline." Missing permissions, a dropped network connection, and throttling all produce errors, and none of them is evidence that the stream has stopped. A script that displays "unknown" as "stopped" is useless. So the code reads only `ChannelNotBroadcasting` as offline and throws on any other error. The tests check that distinction.

`viewerCount` also needs care. When IVS does not finish counting viewers in time, it returns `-1`, and the code turns that into `null` so that nothing ever says "-1 viewers."

### When it won't stop

If you cannot get to OBS, you can cut the stream through the API.

```bash
vp run stream:stop
```

Many streaming programs reconnect automatically when they are cut off, though, and the `StopStream` documentation carries that warning. To be sure the stream stops, delete the key first.

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:stop
vp run stream:status --expect-offline
```

With the key deleted before the cut, the streaming software's attempt to reconnect is refused.

These three commands are not only for a forgotten stream. They also stop the output charge when viewers you cannot account for keep watching, because with no video coming in IVS has nothing to deliver. The [costs page](/en/chapters/18-live/wrap.md) works out the amounts under "When the URL gets around."

IVS has two mechanisms of its own that keep a stream from running on. It disconnects when data from the streaming software stops for 30 seconds, and a single stream lasts 48 hours at most. But software that is set to reconnect starts a new stream after being cut off at 48 hours, so you cannot count on that limit.

## Receiving state changes

<!-- section: 18.events -->

When you want a notification as a stream starts, or want to do something when it ends, you do not need to call `GetStream` every second. You receive the events that IVS sends to EventBridge.

<<< @/examples/18-live/infra/lib/live-stack.ts{events}

Of the events from `aws.ivs`, the rule passes to Lambda only those that belong to this channel. The function's only permission is to write to its own log group. It has no IVS permissions, so it cannot read the stream key.

The handler first checks the shape of each event that arrives.

<<< @/examples/18-live/src/events.ts{schema}

`event_name` is deliberately a plain string and not an enum. IVS may add kinds of events without your noticing. When an event with an unknown name arrives, the code records it and moves on without failing.

The function does not fail on an event of the wrong shape either.

<<< @/examples/18-live/src/handler.ts{handle}

An event whose shape does not match will not match on any retry, so the function logs it and finishes normally.

### Events are "usually delivered"

The IVS documentation says that events are sent on a best-effort basis. In practice that allows the following.

- an event may not be delivered
- an event may arrive hours late
- events may arrive out of order, so that you could see Stream End before Stream Start

The documentation also says this is rare. Even so, an app whose "live" badge never goes away when it does happen is a broken app.

So the function that works out whether the channel is live from the events received **does not depend on their order**.

<<< @/examples/18-live/src/timeline.ts{belief}

For each stream, `believe` builds the set of event names it has seen. If the set contains an ending event, the stream has ended. Because it is a set, neither the order of arrival nor an event arriving twice changes the result.

An end can be treated as final because stream IDs are never reused. Each time a channel starts broadcasting, the stream gets a new `stream_id`. A start that arrives after an end is therefore an old start delivered late, and does not mean the broadcast resumed.

The tests feed four events in all 24 possible orders and confirm that the conclusion is the same every time.

The function still cannot do anything about an event that **never arrived**. If the end event is lost, it keeps saying "live." For that reason the script compares the conclusion drawn from events with the answer from `GetStream`.

<<< @/examples/18-live/src/timeline.ts{reconcile}

```bash
vp run stream:status --events
```

The command shows the `GetStream` answer next to the conclusion built from the logged events and, if they disagree, says which one to believe. The one to believe is `GetStream`.

The design rule to take from this section is to ask the owner of the state for the state. An event is only a signal that something seems to have changed. IVS owns the state, so you ask IVS for the current state. An app that builds state from events alone and treats it as the truth breaks on the day one event goes missing.

## Every viewer has a different "now"

<!-- section: 18.latency -->

Seen as a distributed system, live streaming has an interesting property. **Everyone watches the same video, and nobody watches the same moment.**

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

It is not unusual for viewer A and viewer B to have different delays. According to the documentation, latency varies with where the broadcaster and the viewers are, their networks, and the components in between. In addition, browsers on iOS do not support low-latency playback and get normal latency. If you open the same stream in the same room on a PC and an iPhone, you should hear the sound out of step.

The viewing page shows that viewer's own latency. The value comes from the player's `getLiveLatency()`, which is the latency from the server to the player. It does not include the latency from the camera to the server.

The difference in latency becomes a problem when you combine the video with something that arrives over **a separate path**, such as chat, poll results, a score display, or a "the stream has ended" notice. As the figure shows, the chat's "GOAL!" reaches everyone before the video does and gives the result away. How far ahead it arrives also differs per viewer, so a server-side rule to "wait 3 seconds before sending" does not fit everyone.

Written as an invariant: **which moment of the video something from a separate path appears alongside is not guaranteed.** Do not build screens that assume the two are in sync.

### Things that should arrive with the video

For things that really must line up with the video, such as showing everyone a quiz question at one scene, IVS offers **timed metadata**.

When you send a small piece of data, up to 1 KB, with `PutMetadata`, IVS embeds it in the video. A viewer receives it on playing that position of the video. Someone 3 seconds behind gets it 3 seconds later and someone 8 seconds behind gets it 8 seconds later, so each viewer receives it at "the same scene" as they see it.

The viewing page displays any timed metadata it receives as is. `player.ts` receives it through `TEXT_METADATA_CUE`. During a broadcast you can try it with the CLI command from the documentation.

```bash
aws ivs put-metadata --channel-arn <ChannelArn> --metadata '{"question":"..."}'
```

Timed metadata has limits. As the documentation says, there is no guarantee of how long embedding takes after you send, you can send at most 5 times a second per channel, and only while the channel is live. It does not replace chat, so use it only for what has to appear "at this scene of the video."

This command and its display on the page have not been checked on a real stream.
