---
title: "51 Chime SDK: Costs, Pitfalls, and Cleanup"
---

# 51 Chime SDK: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It works out what calls cost, covers recording and transcription as options, where people get stuck, and what to add for production, and then removes what you built.

## Cost

<!-- section: 51.cost -->

Amounts are in USD, on demand, before tax. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

A Chime SDK meeting is billed for the time attendees are connected. The unit price in the Tokyo Region is 0.0017 per attendee per minute (AWS Price List, checked 2026-10-13). According to the pricing page the rate is the same for audio only and for video, and it is counted in 6-second increments with a 6-second minimum. A high definition session, which raises video to 1080p, has a rate of its own and is not used in this chapter.

**When not in use.** Neither a meeting nor an attendee is billed for existing. Connections are. Nothing else in the stack is billed by the hour. What remains is the few kilobytes of rooms in the table and the storage of logs that expire after 7 days. As for a free allowance, the pricing page lists none for WebRTC media, so none is deducted.

**When in use.** Two sets of assumptions were calculated.

| Assumption | Attendee minutes | Per month |
| --- | ---: | ---: |
| Two people for an hour, eight times a month | 960 | 1.63 |
| Five people for 30 minutes, twenty times a month | 3,000 | 5.10 |

Both assume that everyone is connected from start to finish. API Gateway, Lambda, DynamoDB and Cognito are not included.

**When a tab is left open.** A meeting does not end while anyone is connected. If one tab stays open after a call, that tab stays connected, and the 1,440 minutes until the meeting reaches its 24-hour limit are billed. That is 2.45. It is small next to a forgotten stream in chapter 18's IVS, but it can happen once per room. Closing a room (`DELETE /rooms/{id}`) calls `DeleteMeeting`, which disconnects everyone and stops the billing.

**After deletion.** Once the stack is deleted, nothing is left that could lead to a Chime SDK charge. A meeting that started before the deletion, however, is not deleted with the stack. The cleanup section covers that.

## Recording and transcription

<!-- section: 51.options -->

This chapter does not use what can be added to a meeting, but here is what exists. All of it is from reading the documentation. None of it was run.

**Recording** goes through a separate API called media pipelines. A media capture pipeline saves a meeting's audio and video to an S3 bucket as 5-second segments. Joining the segments into one file is another pipeline, concatenation. Both are billed per minute on top of the attendee minutes. The documentation says plainly that recording may fall under laws on recording communications, and that notifying the participants and obtaining their consent is the builder's responsibility.

**Transcription** starts with `StartMeetingTranscription`. The Chime SDK sends the audio of the two people who are talking most to Amazon Transcribe, and the results reach the participants as data messages. Amazon Transcribe's usual prices apply. There is one more thing to know. By default, Amazon Transcribe may use the audio it processes to improve AWS AI services. Turning that off takes an opt-out policy in AWS Organizations. In an application whose call audio must not go anywhere else, check this before adding transcription.

Beyond these, the Chime SDK has messaging for chat and PSTN audio for connecting to the telephone network, each with its own API and its own prices.

## Where people get stuck

<!-- section: 51.failures -->

**`POST /rooms/{id}/join` answers 503 `media_unavailable`.** A call to Chime failed for a reason other than not found. The function's log has one line naming the exception behind it. If it is `ThrottlingException`, you have hit the account's limit of 10 requests a second. No join token was handed out, and no seat was recorded.

**It answers 409 `join_in_progress`.** The same user tried to join from several places at once and lost three times in a row. Pressing the button again works.

**"The call has ended." appears right after joining.** The library reported `MeetingEnded`. The meeting ended between receiving the seat and connecting: either the room's owner closed it, or everyone left and five minutes passed. Joining again makes the API create a new meeting.

**"This seat was taken over somewhere else" appears.** Something connected from elsewhere with the same join token. Unless you opened another tab yourself, the join token has leaked. Joining again invalidates the old one.

**The browser never asks for the microphone.** The page is not in a secure context. `getUserMedia` works only over HTTPS or on `localhost`. Opening the page from another device on the same network, as `http://192.168.x.x:4173`, does not work.

**Sign-in works, and every API call fails.** The page is not open at `http://localhost:4173`. The stack's CORS setting and the user pool's callback URL allow that origin only.

**It stays at "Connecting…".** The user's network may be blocking traffic to Chime's media service. According to the documentation the destination is `*.chime.aws`, on TCP port 443 and UDP port 3478. It says media falls back to TLS when UDP is blocked, which this chapter has not confirmed.

## For production

<!-- section: 51.production -->

**Clean up after participants who vanish.** This chapter's API does not notice when a browser fails to report that it left. The Chime SDK can send meeting events to EventBridge, SNS or SQS. A lost connection produces `chime:AttendeeDropped` and an ordinary exit produces `chime:AttendeeLeft`, so a function can take those and delete the attendee. The documentation explains that the service treats 10 to 15 seconds without packets as a drop, and that a change of network produces a drop followed by a join. Deleting at the moment of the drop would lock out someone who was about to come back, so the design waits a little before it deletes.

**Narrow the meetings the function can touch.** As the [Design and Build page](/en/chapters/51-chime-sdk/build.md) says, tags and condition keys can limit the permission to meetings this application created.

**Serve the page over HTTPS.** This chapter's page works on `localhost` only. For other people to use it, host it on S3 and CloudFront as chapters 03 and 06 do, and add that origin to the stack's CORS setting and callback URLs.

**Plan for the limits.** Ten requests a second is reached when people gather at the time a call starts. Whether to ask for an increase or to spread the join requests out is a decision for [chapter 32](/en/chapters/32-limits.md)'s way of thinking.

**Choose the media Region.** If the participants are far from Tokyo, `-c mediaRegion=us-west-2` puts the media alone in a Region near them. If it differs per call, the browser of whoever creates the room can look up the nearest Region and pass it along.

**Before adding recording or transcription, decide how consent is obtained.** That is a question of what you tell the participants, and it comes before any technical one.

**Mind the lifetime of access tokens.** API Gateway accepts a revoked access token until it expires (chapter 06). Removing someone from a room takes effect at once, because the table is read on every call. To stop a user altogether, taking them off the list is the more dependable way.

## Cleanup

<!-- section: 51.cleanup -->

End the running meetings before you delete the stack. A meeting is not a resource of the stack, and its ID exists only in the table, so deleting the table first leaves no way to stop it.

```bash
vp run calls:end
vp run calls:end --yes
```

The first line only lists the rooms that have a meeting ID on record. With `--yes`, it calls `DeleteMeeting` for each. A meeting on record may already have ended by itself. The delete counts as a success in that case too.

Then delete the users and the stack.

```bash
vp run calls:user:delete alice@example.com
vp run calls:user:delete bob@example.com
vp run calls:infra:destroy
```

The user pool, the table, the function, the API and the log group are deleted. The users go with the user pool, so `calls:user:delete` can be skipped.

If you delete the stack without `calls:end`, a meeting still ends five minutes after everyone has disconnected. If someone stays connected, it lasts until the 24-hour limit. Once the table is gone there is no way to learn the meeting's ID. Closing the browsers that are connected is the one way left.

What remains is the storage that cdkd's bootstrap created (chapter 02), and `web/dist/config.json` on your machine.

::: details Verification notes for this chapter

**Checked locally.** 69 unit tests (who gets a join token, the order of seat operations and reproduced failures, the in-memory table's conditions, the shape of the calls to DynamoDB and Chime, the page's decisions, and stack assertions). The seat code was also broken in six ways, and the tests failed for each (returning a join token although the record failed, not calling `DeleteAttendee` on leave, not deleting the old seat on a new join, not marking a room before closing it, not deleting the meeting that lost a race, not deleting the attendee that lost one). Type checks (the whole example, and the page with Vize). The template lint. `calls:infra:synth` (including the esbuild bundle, without contacting AWS), and loading the resulting bundle in Node.js. The page build. Starting the development API and running the curl sequence on the [Run It Locally page](/en/chapters/51-chime-sdk/local.md). Opening the development page in a browser and seeing sign-in, creating a room, joining, leaving and closing the room reflected on screen, and seeing the module that contains `amazon-chime-sdk-js` load in the browser. Port 5173 was in use for something else, so the page ran on 5193.

**Not checked yet.** No real call has been made. `calls:infra:diff`, `deploy`, `drift`, `destroy`, `calls:user:create`, `calls:config` and `calls:end` have not been run against AWS. In particular, these are unconfirmed. The real shapes of the Chime API's responses (the responses in the tests were written by hand from the API reference's syntax). That `GetMeeting` and `CreateAttendee` answer `NotFoundException` for a meeting that has ended. That the IAM policy lets the five calls through, and in particular which Region appears in a meeting's ARN when the media Region is not Tokyo. That DynamoDB accepts the condition expressions and that they behave as written. The microphone and camera in a browser, audio playback, video tiles, and reconnection. Which status code the library reports for a second connection with the same join token, for a disconnect after `DeleteAttendee`, and for one after `DeleteMeeting` (the page's wording follows the comments in the library's type definitions). When billing for an attendee stops after a tab is closed. The cost table is the Price List's unit price multiplied by the assumptions.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Rooms and members | `examples/51-chime-sdk/api/src/room-store.ts`, `rooms.ts`, `app.ts`, `contract.ts`, `api/test/authorization.test.ts` | `test:unit` |
| Giving a seat, taking a seat away | `examples/51-chime-sdk/api/src/rooms.ts`, `api/test/seats.test.ts`, `api/test/harness.ts` | `test:unit` |
| The table's conditions | `examples/51-chime-sdk/api/src/dynamodb-room-store.ts`, `api/test/dynamodb-room-store.test.ts`, `api/test/room-store.test.ts` | `test:unit` |
| The part that calls Chime | `examples/51-chime-sdk/api/src/meetings.ts`, `chime-meetings.ts`, `fake-meetings.ts`, `api/test/chime-meetings.test.ts` | `test:unit` |
| The stack | `examples/51-chime-sdk/infra/lib/calls-stack.ts`, `infra/bin/app.ts`, `infra/test/calls-stack.test.ts`, `api/src/lambda.ts` | `test:unit`, `calls:infra:synth` |
| The page in the browser | `examples/51-chime-sdk/web/src/session.ts`, `call.ts`, `config.ts`, `App.vue`, `call.test.ts` | `dev:calls:web`, `build:calls:web`, `typecheck:calls:web`, `lint:calls:web` |
| What can be checked locally | `examples/51-chime-sdk/api/src/dev.ts`, `.env.example` | `dev:calls:api`, `dev:calls:web` |
| Deploy and make a call | `examples/51-chime-sdk/scripts/write-config.ts`, `scripts/user.ts` | `calls:infra:deploy`, `calls:user:create`, `calls:config`, `preview:calls:web` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.ts` | `test:unit` |
| Cleanup | `examples/51-chime-sdk/scripts/end-meetings.ts` | `calls:end`, `calls:infra:destroy` |

**How cdkd handles this stack's resources.** Read from the npm tarball of the pinned version (0.296.28), in the part that corresponds to `src/provisioning/register-providers.ts`. `AWS::ApiGatewayV2::Api`, `Authorizer`, `Integration`, `Route`, `Stage`, `AWS::Cognito::UserPool`, `AWS::DynamoDB::Table`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission` and `AWS::Logs::LogGroup` have dedicated implementations. `AWS::Cognito::UserPoolClient` and `AWS::Cognito::UserPoolDomain` do not, and go through Cloud Control API (as in chapter 06). No type beginning with `AWS::Chime` is registered, and this stack uses none.

**Primary sources** (all checked 2026-10-13)

- The end of Amazon Chime: [Update on Support for Amazon Chime](https://aws.amazon.com/blogs/messaging-and-targeting/update-on-support-for-amazon-chime/), [What is Amazon Chime?](https://docs.aws.amazon.com/chime/latest/ag/what-is-chime.html) (the notice in the administration guide; read on 2026-10-13, after the end date, it was still worded in the future tense)
- [What is the Amazon Chime SDK?](https://docs.aws.amazon.com/chime-sdk/latest/dg/what-is-chime-sdk.html), [Using the Amazon Chime SDK](https://docs.aws.amazon.com/chime-sdk/latest/dg/meetings-sdk.html), [Creating meetings](https://docs.aws.amazon.com/chime-sdk/latest/dg/create-mtgs.html), [How meetings use WebRTC media](https://docs.aws.amazon.com/chime-sdk/latest/dg/webrtc-media.html), [client libraries](https://docs.aws.amazon.com/chime-sdk/latest/dg/mtgs-sdk-client-lib.html)
- Regions and limits: [Using meeting Regions](https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-meetings-regions.html), [Available AWS Regions](https://docs.aws.amazon.com/chime-sdk/latest/dg/sdk-available-regions.html), [Amazon Chime SDK endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html)
- API: [CreateMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html), [GetMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_GetMeeting.html), [DeleteMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_DeleteMeeting.html), [CreateAttendee](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateAttendee.html), [Attendee](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_Attendee.html), [DeleteAttendee](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_DeleteAttendee.html), [the namespace migration](https://docs.aws.amazon.com/chime-sdk/latest/dg/meeting-namespace-migration.html) (that `ListMeetings` does not exist)
- [meeting lifecycle events](https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html), [Configuring your network](https://docs.aws.amazon.com/chime-sdk/latest/dg/network-config.html), [media pipelines](https://docs.aws.amazon.com/chime-sdk/latest/dg/media-pipelines.html), [live transcription](https://docs.aws.amazon.com/chime-sdk/latest/dg/meeting-transcription.html)
- IAM: [the Service Authorization Reference's JSON (Amazon Chime)](https://servicereference.us-east-1.amazonaws.com/v1/chime/chime.json). The HTML page did not render without JavaScript, so the JSON it is built from was read instead
- CloudFormation: [resource and property types reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-template-resource-type-ref.html) (that the Chime SDK is absent)
- Prices: [Amazon Chime SDK Pricing](https://aws.amazon.com/chime/chime-sdk/pricing/), AWS Price List bulk API: [Amazon Chime, Tokyo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonChime/current/ap-northeast-1/index.json), [IVS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonIVS/current/index.json), [Amazon IVS Pricing](https://aws.amazon.com/ivs/pricing/)
- IVS: [What is Amazon IVS Real-Time Streaming?](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html), [Amazon IVS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ivs.html)
- Packages: [amazon-chime-sdk-js 3.32.0](https://www.npmjs.com/package/amazon-chime-sdk-js/v/3.32.0) (README, type definitions, `MeetingSessionConfiguration.js`), [@aws-sdk/client-chime-sdk-meetings 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-chime-sdk-meetings/v/3.1149.0), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare: [Realtime overview](https://developers.cloudflare.com/realtime/), [Realtime SFU pricing](https://developers.cloudflare.com/realtime/sfu/pricing/)
- Vercel: [Publish and subscribe to realtime data on Vercel](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel)
- MDN: [Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

These points could not be confirmed from a primary source. The reference does not say what `CreateMeeting` returns when the same `ClientRequestToken` is sent twice. `ExternalUserId` is also described as "an idempotency token", but what a second `CreateAttendee` with the same value does could not be read from the page, so this chapter's code relies on neither. Whether a join token has a time limit was not found anywhere beyond the statement that it expires when the meeting ends or on `DeleteAttendee`. That a meeting ends after five minutes with no attendee connected is on the page about creating meetings, while the client library's README says "no audio connections are present in the meeting for more than five minutes", which is worded a little differently. That Vercel has no WebRTC media service is confirmed only as far as nothing in its documentation index and its guide mentions one. Cloudflare RealtimeKit's prices are not quoted because the fetched page did not contain the table as text. `protobufjs`, which `amazon-chime-sdk-js` depends on, has an install script, and pnpm did not run it. The build and the module load passed, but the effect on a real call was not checked.

:::
