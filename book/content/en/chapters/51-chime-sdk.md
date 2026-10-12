---
title: "51 Chime SDK: Real-Time Audio and Video in Your Own App"
sourceRevision: 1
---

# 51 Chime SDK: Real-Time Audio and Video in Your Own App

In a calling feature, the server decides one thing: who gets into the call. The audio and video travel directly between the browser and the Amazon Chime SDK's media service. This chapter adds rooms to the notes app, and builds the API that hands a seat in a call only to people who are allowed into the room.

The name needs sorting out first. Support for the meeting application called Amazon Chime ended on February 20, 2026. The Amazon Chime SDK, which this chapter uses, is a different service and was not part of that. The next section has the details.

The price follows the number of people connected and for how long. In the Tokyo Region, one attendee connected for one minute costs USD 0.0017 (AWS Price List, checked 2026-10-13). While nobody is connected, the Chime SDK charges nothing. A tab left open, however, keeps being billed until the meeting reaches its 24-hour limit. The amounts and the cleanup are on the [costs page](/en/chapters/51-chime-sdk/wrap.md).

The chapter reuses the sign-in and the API of [chapter 06](/en/chapters/06-auth.md), and compares itself with [chapter 18](/en/chapters/18-live.md), which covered one-way live streaming. The code is in `examples/51-chime-sdk/`.

## The whole picture

<!-- section: 51.overview -->

```figure
caption: The API only hands out a seat; audio and video flow between the browser and the media service
node browser: Browser | Vue page, amazon-chime-sdk-js
node api: API Gateway + Lambda | behind chapter 06's JWT authorizer
node table: DynamoDB | rooms, members, seats
node control: Chime SDK API | ap-northeast-1, meetings and attendees
node media: Chime SDK media service | media Region
edge browser -> api: POST /rooms/{id}/join
edge api -> table: a member? whose seat?
edge api -> control: CreateMeeting, CreateAttendee
edge api --> browser: where to connect, join token
edge browser -> media: connects with the join token
group aws: AWS = api, table, control, media
mark api
```

Read the figure from the top. A signed-in user's browser calls `POST /rooms/{id}/join`, and the API looks in the DynamoDB table to see whether that user is a member of the room. If so, it creates a meeting and an attendee through the Chime SDK API and returns the URLs to connect to and a **join token**. The browser uses them to connect to the media service, and from then on the audio and video do not pass through the API.

A join token is a secret string, and whoever holds it can be that attendee. Everything this chapter protects comes down to that.

> Invariant: a join token is created only for a signed-in user who is a member of the room, and it reaches only that user. Once the user leaves, the token no longer works.

The API, marked in the figure, is where this invariant is kept. The Chime SDK knows nothing about rooms or members. Whose attendee gets created is decided entirely by your code.

## Amazon Chime and the Amazon Chime SDK

<!-- section: 51.status -->

They share a name and are different things.

**Amazon Chime** was an application, and the service behind it, for meetings, calls and chat. AWS announced its end on February 19, 2025, stopped accepting new customers that day, and ended support on February 20, 2026. The notice in the administration guide says that after that date neither the Amazon Chime console nor the application's resources can be accessed. If you see a setting or a billing line named "Amazon Chime" in an existing account, it belongs to this ended service. You cannot start using it.

The **Amazon Chime SDK** is a set of components for putting audio, video, screen sharing and messaging into your own application. The end-of-support notice says it "does not impact the availability of the Amazon Chime SDK service", and the documentation describes the SDK as working independently of any Amazon Chime administrator account. On 2026-10-13, when this chapter was written, the Chime SDK was on the price list and in the API reference.

The old name survives in a few places. IAM actions begin with `chime:`, as in `chime:CreateMeeting`, and resource ARNs contain `chime`. The API has an older namespace (`Chime`, `us-east-1` only) and a newer one (`ChimeSDKMeetings`, several Regions), and the documentation tells anyone starting now to use the newer one. This chapter uses only that.

## Meetings, attendees, and join tokens

<!-- section: 51.model -->

A Chime SDK meeting has three things in it.

A **meeting** is an ephemeral resource that stands for one call. `CreateMeeting` makes it and `DeleteMeeting` ends it. Left alone, Chime ends it when it has lasted more than 24 hours, or when nobody has been connected for five minutes in a row. So when your table remembers "this room's meeting is X", X may no longer exist.

An **attendee** is one person's seat in a meeting. You create it with `CreateAttendee` and an `ExternalUserId`, the value that ties the attendee to a user of your application. This chapter puts the token's `sub` there.

A **join token** comes in the response that creates the attendee. The browser presents it to the media service to connect as that attendee. According to the API reference, a join token stops working when the meeting ends or when `DeleteAttendee` is called. Nothing says it expires with time. When a second device connects with the same join token, the call is handed over to the new device and the first one is disconnected.

### What the server does, and what the browser does

The server application creates meetings and attendees, and transfers the two securely to the client that is authorized to have them. It uses the AWS SDK package `@aws-sdk/client-chime-sdk-meetings`. It does not need the Chime SDK client library.

The browser hands the two objects to the client library, chooses a microphone and a camera, and connects. The library is `amazon-chime-sdk-js` on npm; the current version when checked was 3.32.0 (Apache-2.0). There are libraries for iOS, Android and Windows as well.

Inside the media service, audio and video are treated differently. The service mixes everyone's audio and sends each listener one stream, without that listener's own voice. Video is not mixed: the service forwards what it receives to whoever needs it (an SFU). A meeting carries at most 25 videos at once.

### You choose two Regions

A meeting has a control Region and a media Region. The control Region is where the API is called. The media Region is where audio and video are relayed. One control Region can create a meeting in any media Region of the same partition.

Tokyo (`ap-northeast-1`) is both. This chapter's stack keeps the API and the media in Tokyo. If the participants are somewhere else, the media alone can go to a Region near them. Calling `https://nearest-media-region.l.chime.aws` from a browser returns the nearest media Region.

A meeting can be updated only from the control Region that created it. The meeting's events arrive in that Region too.

### Limits

These are the defaults as read on 2026-10-13. Limits change, so check [Amazon Chime SDK endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html) and the Service Quotas console before relying on them.

- At most 250 attendees in a meeting (not adjustable)
- At most 250 meetings at the same time (adjustable)
- `CreateMeeting`, `CreateAttendee`, `DeleteAttendee`, `DeleteMeeting` and `GetMeeting`: 10 requests a second each (adjustable)

Quotas are counted per API endpoint, that is, per control Region. Ten a second is soon reached by an application whose users all arrive when a call is due to start. This chapter's API throttles its whole stage at 10 requests a second ([Design and Build](/en/chapters/51-chime-sdk/build.md)).

## IVS, IVS Real-Time, and the Chime SDK

<!-- section: 51.choice -->

AWS has three services that deliver video. What separates them is whether there is a conversation.

| | IVS low-latency (chapter 18) | IVS Real-Time | Chime SDK meetings |
| --- | --- | --- | --- |
| Shape | One sends, many watch | A few on stage, many watch | Everyone talks |
| Latency (as documented) | Under 5 seconds | Can be under 300 milliseconds | Real-time audio and video |
| Senders, by default | One stream per channel | 12 per stage | 25 videos, 250 participants |
| Viewers, by default | 15,000 at once per Region | 10,000 per stage | Among the 250 |
| Billed by | Hours of input and hours watched | Hours per participant | Minutes per attendee |

Chapter 18's IVS is a one-way broadcast. A few seconds of delay do no harm there, and in exchange it reaches a large audience. IVS Real-Time is a separate product that exists today: it keeps the shape of a few performers and a large audience, and brings the delay down to where a conversation works. Chime SDK meetings are for meetings and calls among equals. The limit on people is small, and the service mixes the audio for you.

The unit prices are worth a look too. The Chime SDK charges USD 0.0017 a minute, which is USD 0.102 per person per hour. IVS Real-Time charges USD 0.092 per participant hour in its first tier for the area that includes Japan (both from the Price List, checked 2026-10-13). They are close, so the reason to choose one is its shape, not its price. If everyone talks, use the Chime SDK. If some talk and others watch, use IVS Real-Time. If no conversation is needed, use IVS.

### Cloudflare and Vercel

Cloudflare has something close (from its documentation as of 2026-10-13). Cloudflare Realtime is two products. RealtimeKit comes with meeting UI and SDKs: your backend creates meetings and adds participants through a REST API, and passes a participant's auth token to the client. That is the same division of work as in this chapter. Realtime SFU is a lower-level part, where signaling and permissions are your application's job. SFU and TURN cost USD 0.05 per GB sent out from Cloudflare, with the first 1,000 GB a month free. RealtimeKit's prices are in a separate table and are not quoted here.

If your application runs on Workers, Cloudflare Realtime means fewer moving parts. The reasons to choose the Chime SDK are that your users' sign-in and data already live in AWS, that you want recordings in S3, or that you need to connect to the telephone network.

Vercel does not appear to have a service that relays WebRTC audio and video. Its documentation index and its guide on realtime data cover WebSockets, SSE, Redis and Queues, and the guide points to outside providers where they fit better. To put calls in an application on Vercel, you would leave the media to an outside service such as the Chime SDK or Cloudflare Realtime, and write only the API that hands out seats as a Vercel function.

### When not to use it

For a call between two people whose networks you need not worry about, WebRTC directly between the browsers is enough, and no service has to relay the media. If the meeting itself is the goal and it need not live inside your own application, a ready-made meeting service is quicker. If you want to reach more than a few hundred listeners, IVS fits better than the Chime SDK's limit of 250.

The [next page](/en/chapters/51-chime-sdk/build.md) builds the API for rooms and seats.
