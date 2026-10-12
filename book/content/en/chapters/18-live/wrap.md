---
title: "18 Live Streaming: Costs, Pitfalls, and Cleanup"
---

# 18 Live Streaming: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It works out what broadcasting costs, covers recording, how IVS differs from other services, and what to add for production, and then removes what you built.

## Cost

<!-- section: 18.cost -->

Amounts are in USD, pay-as-you-go, before tax. The calculations are on the [pricing worksheets](/en/reference/pricing.md) page.

IVS charges for two things, input and output.

- Input is charged for the time video was being sent. The rate depends on the channel type, and is 0.20 an hour for `BASIC` and 2.00 for `STANDARD`. The time is rounded up to the minute
- Output is charged for the total time delivered to viewers. The rate depends on the resolution and on which area the video was served from. In the first tier for the area that includes Japan, an hour costs 0.046 in SD (480 or less), 0.092 in HD (720 or less), and 0.184 in Full HD (1080 or less). The time is rounded up to the second

Output time is the number of viewers multiplied by the time each one watched. A hundred people watching an hour each makes 100 hours.

**In a month with no broadcasts, IVS costs 0.** Neither the pricing page nor the Price List has a charge for a channel that merely exists. That is where IVS differs from MediaLive, which comes up near the end of this page.

### When you use it

Suppose you broadcast four times a month for 2 hours each, sending 720p to a `BASIC` channel, and that viewers watch half of each broadcast on average. The IVS documentation gives that proportion as a rule of thumb.

| | 100 viewers each time | 1,000 viewers each time |
| --- | --- | --- |
| Input: 8 hours | 1.60 | 1.60 |
| Output: 400 hours / 4,000 hours in HD | 36.80 | 368.00 |
| Subtotal | **38.40** | **369.60** |

Nearly all of the bill is output, and output is proportional to the number of viewers. The invoice depends on how many people watched for how many minutes, not on how many servers you run. It is no surprise that a popular broadcast costs more, but when you estimate, always write down the number of viewers and the viewing time you assumed.

The table does not subtract the free tier. The pricing page says new AWS accounts get 5 hours of `BASIC` input and 100 hours of SD output each month for their first 12 months, but the offer expires and does not apply to every account.

The table leaves out the charges for EventBridge, Lambda, and CloudWatch Logs. That means they are not counted, not that they are 0. The cost of serving the viewing page is left out in the same way.

### When you forget to stop

This is what it costs when the streaming software keeps running with zero viewers.

| | `BASIC` | `STANDARD` |
| --- | --- | --- |
| 48 hours (a weekend) | 9.60 | - |
| 730 hours (a month) | 146.00 | 1,460.00 |

This table is why the chapter chose `BASIC`. The same mistake costs an order of magnitude less.

The budget notification from chapter 01 helps here too. It only notifies, though, and does not stop the broadcast. `stream:stop` and `streamKey=off` are what stop it.

### When the URL gets around

The opposite of a forgotten stream can also happen, where the people watching drive the bill up and your streaming software does not.

This chapter's channel has `authorized: false`, so anyone who knows the playback URL can play it. That URL is in the viewing page's `config.json`, where anyone who opens the page can read it. It is not a secret. To IVS, a person watching and a script that keeps pulling video are the same "time delivered."

Take the worst case. The default limit on concurrent views is 15,000 across a Region. If all of them keep watching in HD, that is 15,000 viewing hours in one hour. At the first-tier rate of 0.092, that comes to **USD 1,380 an hour**. In SD it is 690, and if you are sending Full HD it is 2,760. The rate drops a little with volume, and for HD the hours past 10,000 in a month cost 0.084, but the order of magnitude does not change. A 2-hour broadcast comes to 2,600. With the 100 viewers you planned for, that broadcast would have cost 9.20.

I have not checked here what happens to viewer 15,001 once the limit is reached. The limit can also be raised, and it is the total across every channel in the Region. Read it as the size of the number, not as a guarantee that the bill stops there.

Two things limit the damage. One is that this charge applies only while you are broadcasting. With no broadcast there is no video to deliver, so output stays at 0 however many tens of thousands of times the URL is requested. The other is that stopping the broadcast stops the charge from growing. `stream:status` also prints the number of concurrent views, so if you see a number you cannot account for, `stream:stop` and `streamKey=off`, from "Confirm it has stopped" on the [deploy page](/en/chapters/18-live/deploy.md), stop it as they are. The budget notification from chapter 01 updates only every 8 to 12 hours, so it does not arrive in time for this.

If you plan to gather an audience, add a few things first. Private channels restrict viewing with a signed token, playback restriction policies filter by country or origin, and you also need something that watches the concurrent view count and tells you. They are listed under "If this were production." I have not checked the procedure or the price of private channels for this book.

### After you delete it

When you delete the stack, the channel and the stream key go with it, and IVS stops charging. The event logs are deleted too.

## Recording, once you need it

The channel in this chapter does not record. A test confirms that the template has no recording configuration and no S3 bucket.

When you need recordings, IVS can record to S3 automatically (auto-record to S3). Create an `AWS::IVS::RecordingConfiguration` and pass it to the channel's `RecordingConfigurationArn`, and every broadcast is written to a bucket.

Before you add it, know what it costs, what it leaves behind, and when a recording becomes usable.

- The recording feature itself has no IVS charge. You pay S3 for storage, for the write requests IVS makes on your behalf, and for delivery when you serve the recordings to someone
- Recordings stay as objects in your bucket. If you delete the channel, the bucket's contents should stay as they are (I found no statement that IVS removes them). Each broadcast adds HLS video, thumbnails, and JSON metadata under `ivs/v1/<account ID>/<channel ID>/<date and time>/...`. Without a lifecycle rule, the storage charge keeps growing
- The documentation recommends playing or processing a recording only after the `Recording End` event. That event is also only "usually delivered," as described under "Events are 'usually delivered'" on the [deploy page](/en/chapters/18-live/deploy.md)

Remember too how much it means to store video with people in it. Decide how recordings get deleted, and by when, at the time you add recording.

## If you're coming from Cloudflare Stream

If you have done live streaming on Cloudflare, Stream's Live is the nearest experience. The differences below are the ones I could confirm in Cloudflare's documentation.

- Sending is the same. Both accept RTMPS and SRT, so OBS works as is
- The viewing side differs. Stream says you can play in its own player or in any player that supports HLS or DASH. With IVS, the IVS player is required to get a delay of a few seconds
- The default for recording differs. Stream records every live stream automatically. IVS records nothing unless you ask
- The billing dimensions differ. Stream says it charges for "minutes recorded" and "minutes delivered," with no separate encoding charge. IVS charges for "input hours" and for "viewing hours" by resolution. Because Stream charges for minutes recorded, the two are alike in that leaving a stream running costs money

I have not compared latency, because that Cloudflare page gave no figures. Which is cheaper also depends on the number of viewers, the quality, and whether you need recordings, so I do not say here.

## Common problems

| If this happens | Look here |
| --- | --- |
| OBS says "Failed to connect to server" | An old OBS doesn't support RTMPS, so update it. If you re-created the key, check that the old one isn't still in the settings |
| It connects and is cut off right away | Bitrate or resolution is over the type's limit. `BASIC` takes up to 3.5 Mbps at 720p. If `stream:status --events` shows `Ingest Bitrate`, that is the cause |
| The page stays "offline" | Check with `stream:status` whether the channel is live. If it is, the playback URL in `web/dist/config.json` may belong to an old channel. A 404 can't tell "offline" from "wrong URL" |
| Video plays but tens of seconds behind | Check that the keyframe interval is 2 seconds. Browsers on iOS don't support low latency |
| The player doesn't work in the built page | Check that the `.wasm` file is served as `application/wasm`. That's a condition for hosting it yourself |
| `stream:key` can't find `StreamKeyArn` | The stack was deployed with `streamKey=off`. Deploy once more without `-c streamKey=off` |
| `stream:infra:destroy` fails | A live channel can't be deleted (409). Stop the broadcast and delete after `stream:status --expect-offline` passes |
| `stream:status --events` says "DISAGREE" | Events are late or were never delivered. As the output says, `GetStream` is the answer |

## If this were production

- Restrict who can watch. Right now anyone with the URL can, and every hour they watch is on your bill (the arithmetic is under "When the URL gets around"). IVS has private channels (`authorized: true`), which play only with a signed token, and playback restriction policies, which filter by country or origin. This chapter does not cover them
- Reconsider the type. If viewers' connections vary, use `STANDARD` or `ADVANCED`, which produce several renditions, and weigh that against the input rate
- Prevent forgotten streams and oversized audiences with a mechanism. You can notify when a channel is still live past its scheduled time, notify when concurrent views go past what you planned for, or issue a key per broadcast and delete it afterwards. Being careful is not a mechanism
- Decide where the stream key lives. Settle how it reaches the broadcaster, how it gets re-created, and who can read the state bucket
- Check the limits. The defaults are 15,000 concurrent views across a Region and 100 concurrent streams. Ask for an increase in Service Quotas before a big broadcast
- Put the viewing page on a CDN. Chapter 03's setup works. Don't forget the Content-Type for `.wasm`
- Deploy through the AWS CDK CLI and CloudFormation. As chapter 02 said, cdkd is meant for development and testing

### When you need MediaLive and MediaPackage

IVS is a service for delivering a fixed kind of broadcast in a fixed way. Input is H.264 and AAC, the quality ladder is set by the type, and you cannot design your own.

When you want to decide the output formats and the quality ladder yourself, or connect to other video services, you use AWS Elemental MediaLive. MediaLive converts live video into other formats and packages, and you design its outputs. MediaPackage packages that output for viewing and acts as the origin for delivery. In that case you combine MediaLive, MediaPackage, and a CDN yourself.

In return you get more parts and more pricing dimensions. A MediaLive channel is charged while it is running even if nothing arrives at its inputs. Even when it is stopped, some resources carry an idle charge. Unlike IVS, it does not cost 0 just because you are not streaming.

As long as sending from OBS and showing the video on the web a few seconds behind is enough, IVS as it is will do.

## Cleaning up

<!-- section: 18.cleanup -->

A live channel cannot be deleted, so confirm that the broadcast has stopped before you delete the stack.

```bash
vp run stream:status --expect-offline
vp run stream:infra:destroy
```

If the first command fails, which means the channel is live, stop OBS or run `vp run stream:stop`.

The channel, stream key, rule, function, role, and log group are deleted, and the logs with them.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. `web/dist/config.json` on your machine also still holds the playback URL of a channel that no longer exists. The stream key you pasted into your streaming software no longer works, but it is still in the settings, so remove it.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (channel settings, interpreting `GetStream`, validating and folding events, the viewing page's decisions, stack assertions). Type checks (the whole example, and the viewing page with Vize). Template lint. Synth (including the esbuild bundle, with no request to AWS). That the viewing page build contains the player's worker and `.wasm`. Started `dev:stream:web` and confirmed in a browser what is shown when no channel is configured. Also, with the playback URL of a channel that does not exist set temporarily, confirmed that the player loads the worker and WebAssembly, receives a 404 from the IVS playback domain, and that the page shows "offline" and schedules a retry (no credentials were used, and the config was restored afterwards).

**Not checked yet.** No real broadcast has been made or watched. `stream:infra:diff`, `deploy`, `drift`, `destroy`, `stream:key`, `stream:config`, `stream:status`, and `stream:stop` have not been run against AWS. Specifically: creating and deleting `AWS::IVS::Channel` and `AWS::IVS::StreamKey` through Cloud Control API, whether cdkd's state holds the stream key value, re-creating the key via `streamKey=off`, connecting from OBS, playback and the latency value in the player, displaying timed metadata, the real `GetStream` response and the name `ChannelNotBroadcasting`, the real shape of the EventBridge events, whether `stream:status --events` can read events back from Lambda's log lines, and that deleting a live channel fails. The OBS steps follow the IVS documentation and were not checked on screen. Neither checked: what happens once concurrent views reach the limit of 15,000, and how long output billing takes to stop after `StopStream`. The amounts under "When the URL gets around" are the default quota multiplied by the Price List rates. The latency seconds in the figure are made up for illustration.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Decide on the channel | `examples/18-live/src/channel.ts`, `infra/lib/live-stack.ts`, `test/channel.test.ts` | `test:unit`, `stream:infra:synth` |
| The stream key is the key | `examples/18-live/infra/lib/live-stack.ts`, `infra/bin/app.ts`, `infra/test/live-stack.test.ts`, `scripts/key.ts` | `test:unit`, `stream:key` |
| The viewing page | `examples/18-live/web/src/player.ts`, `viewer.ts`, `config.ts`, `App.vue`, `viewer.test.ts` | `dev:stream:web`, `build:stream:web`, `typecheck:stream:web`, `lint:stream:web` |
| Broadcast something | `examples/18-live/scripts/key.ts`, `scripts/write-config.ts` | `stream:infra:diff`, `stream:infra:deploy`, `stream:key`, `stream:config`, `preview:stream:web` |
| Confirm it has stopped | `examples/18-live/src/stream.ts`, `src/ivs.ts`, `scripts/status.ts`, `scripts/stop.ts`, `test/stream.test.ts` | `stream:status`, `stream:stop` |
| Receiving state changes | `examples/18-live/src/events.ts`, `handler.ts`, `timeline.ts`, `logged-events.ts`, `test/events.test.ts`, `test/timeline.test.ts` | `test:unit`, `stream:status` |
| Every viewer has a different "now" | `examples/18-live/web/src/player.ts`, `App.vue` | `preview:stream:web` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.ts` | `test:unit` |
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

Some points could not be settled from primary sources. That aws-cdk-lib has no higher-level IVS construct was confirmed by the pinned version (2.273.0) having only `Cfn*` classes in `aws-ivs`. I did not look into whether a separate package offers one. For private channels and playback restriction policies I only confirmed that they exist, from the CloudFormation property and the quota table, and did not read the procedures. That recordings remain after the channel is deleted follows from their being S3 objects, but I found no statement that says so. The description of MediaPackage follows the "Related Services" page of the MediaLive documentation.

:::
