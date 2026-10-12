---
title: "18 Live Streaming: Costs, Pitfalls, and Cleanup"
---

# 18 Live Streaming: Costs, Pitfalls, and Cleanup

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

### When the URL gets around

There's one more worry, and it points the other way: the meter being run not by your streaming software but by whoever is watching.

This chapter's channel has `authorized: false`, so anyone who knows the playback URL can play it. And that URL sits in the player page's `config.json`, where anyone who opens the page can read it. It isn't a secret. From IVS's side, a person watching and a script that keeps pulling video are the same "time delivered."

Let's work out the worst case. The default limit on concurrent views is 15,000 across a Region. If all of them keep watching in HD, that's 15,000 viewing hours in one hour. At the first-tier rate of 0.092, that comes to **USD 1,380 an hour**. In SD it's 690, and if you're sending Full HD it's 2,760. The rate drops a little with volume (for HD, hours past 10,000 in a month are 0.084), but the order of magnitude doesn't change. A 2-hour broadcast comes to 2,600. That's for a broadcast that would have cost 9.20 with the 100 viewers you planned for.

What happens to viewer 15,001 once the limit is reached isn't something I've checked here. The limit is also adjustable, and it's the total across every channel in the Region. Read it as the size of the number, not as a guarantee that it stops there.

Two things work in your favor. First, this only applies while you're live. With no broadcast there's no video to deliver, so the URL can be hit tens of thousands of times and output stays at 0. Second, stopping the stream stops the meter. `stream:status` prints the number of concurrent views too, so if you see a number you can't account for, `stream:stop` and `streamKey=off` from the section "Has it stopped?" are the brake, as they are. The budget notification from chapter 01 only updates every 8 to 12 hours, so it won't arrive in time for this.

If you're going to gather a real audience, add a few things first: private channels, which restrict viewing with a signed token; playback restriction policies, which filter by country or origin; and something that watches the concurrent view count and tells you. They're listed under "If this were production." I haven't checked the procedure or the price of private channels for this book.

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

- **Restrict who can watch.** Right now anyone with the URL can, and every hour they watch is on your bill (the arithmetic is under "When the URL gets around"). IVS has private channels (`authorized: true`), which play only with a signed token, and playback restriction policies that filter by country or origin. This chapter doesn't cover them
- **Reconsider the type.** If viewers' connections vary, use `STANDARD` or `ADVANCED`, which produce several renditions. Weigh that against the input rate
- **Prevent forgotten streams and runaway audiences with a mechanism.** Notify when a channel is still live past its scheduled time, notify when concurrent views go past what you planned for, or issue a key per broadcast and delete it afterwards. "Being careful" is not a mechanism
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

**Not checked yet.** No real broadcast has been made or watched. `stream:infra:diff`, `deploy`, `drift`, `destroy`, `stream:key`, `stream:config`, `stream:status`, and `stream:stop` have not been run against AWS. Specifically: creating and deleting `AWS::IVS::Channel` and `AWS::IVS::StreamKey` through Cloud Control API, whether cdkd's state holds the stream key value, re-creating the key via `streamKey=off`, connecting from OBS, playback and the latency value in the player, displaying timed metadata, the real `GetStream` response and the name `ChannelNotBroadcasting`, the real shape of the EventBridge events, whether `stream:status --events` can read events back from Lambda's log lines, and that deleting a live channel fails. The OBS steps follow the IVS documentation and were not checked on screen. Neither checked: what happens once concurrent views reach the limit of 15,000, and how long output billing takes to stop after `StopStream`. The amounts under "When the URL gets around" are the default quota multiplied by the Price List rates. The latency seconds in the diagram are made up for illustration.

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
