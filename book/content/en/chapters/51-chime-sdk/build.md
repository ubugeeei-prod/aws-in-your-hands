---
title: "51 Chime SDK: Design and Build"
---

# 51 Chime SDK: Design and Build

The [previous page](/en/chapters/51-chime-sdk.md) said that the server's whole job is to hand out seats. This page builds the API that does it, in this order: rooms and members, giving a seat, taking a seat away, the table's conditions, the part that calls Chime, the stack, and the page in the browser.

## Rooms and members

<!-- section: 51.rooms -->

The Chime SDK has no idea of "this person may come in". Call `CreateAttendee`, and an attendee exists, whoever it is for. The list of who may enter is yours to keep.

<<< @/examples/51-chime-sdk/api/src/room-store.ts{room}

A room holds that list, the ID of the meeting it is using now, and which user holds which attendee. This chapter calls that last pairing a seat. A user has at most one seat in a room.

There are seven routes, all added to chapter 06's API.

<<< @/examples/51-chime-sdk/api/src/app.ts{routes}

Chapter 06's `createApp` takes extra routes and puts them behind its sign-in check. A call without a token gets a 401 before it reaches a route, so everything written here runs knowing that `context.identity.sub` is the caller. Neither the path nor the body gets to say whose seat is being created.

To someone who is not a member, the answer is the same as if the room did not exist.

<<< @/examples/51-chime-sdk/api/src/rooms.ts{membership}

404 and 403 are chosen by what the caller already knows. A 403 to someone guessing room IDs would confirm that the ID is in use. A member knows the room exists, so an action reserved for the owner answers 403.

There are two response shapes.

<<< @/examples/51-chime-sdk/api/src/contract.ts{room}

A member sees the list and who holds a seat, and no more. Neither attendee IDs nor join tokens are in it.

<<< @/examples/51-chime-sdk/api/src/contract.ts{seat}

A seat keeps the shape the Chime API returns, because the browser library is written to take the `CreateMeeting` and `CreateAttendee` responses as they are. Only the fields that the pinned version of the library actually reads are required.

`subSchema`, which checks a `sub`, has a reason as well. Chime's `ExternalUserId` is 2 to 64 characters from a fixed set and may not begin with `aws:`. A Cognito `sub` is a UUID and fits. A value that does not fit, once accepted as a member, would be refused by Chime every time that person asked for a seat. So it is refused when the member is added.

## Giving a seat

<!-- section: 51.join -->

State lives in two places. The table knows who sits in which seat, and Chime knows which join tokens work. Nothing can change both in one transaction. So the order is chosen such that stopping halfway never breaks the invariant.

```figure
caption: The join token is returned only after the table has recorded the seat
type: sequence
actor browser: Browser
actor api: API
actor table: DynamoDB
actor chime: Chime SDK
step browser -> api: POST .../join
step api -> table: 1. read room
step api -> chime: 2. GetMeeting
step api -> chime: 3. DeleteAttendee
step api -> chime: 4. CreateAttendee
step api -> table: 5. record seat
step api --> browser: 6. join token
```

<<< @/examples/51-chime-sdk/api/src/rooms.ts{join}

Here is the reason for each step.

Step 2 asks `GetMeeting` even when the table holds a meeting ID. Chime ends a meeting after five minutes with nobody connected, so the table's record goes stale. If there is no meeting, the function creates one and writes its ID to the table. That write is conditional on the ID still being the one that was read. When two people become the first participant at the same moment, both call `CreateMeeting`, but only one of them can write to the table. The other deletes the meeting it made and starts over.

The `token` passed to `CreateMeeting` is the API's `ClientRequestToken`. The reference says to "use a different token for different meetings", which reads as a way to resend the same request safely, but it does not say what a second call with the same token returns. So this chapter passes a fresh value on every call and leaves the defence against a doubled meeting to the conditional write.

Step 3 is for someone who joins again. The old seat is deleted before the new one is created, so by the time the new join token is returned, the old one is dead. If you think a join token has been copied somewhere, joining again invalidates it.

Step 5 is the most important line on this page. The attendee has existed inside Chime since step 4, but the join token is returned only after the write to the table succeeds. That write carries four conditions: the room is not closed, this person is still a member, the meeting is the one from step 2, and this person's seat is what it was when step 1 read it. If any of them no longer holds, the attendee that was just created is deleted and the function starts over.

After losing three times in a row, it gives up with a 409. The attendees it created have been deleted in that case too.

### Fixing the order in tests

In the tests, "another request cuts in halfway" happens at a chosen point. The test helper runs something just before the next call of a given method, or makes that call fail.

Take the case where Alice, the owner, removes Bob from the room after Bob's attendee exists in Chime and before it is recorded in the table. The record fails on the membership condition, and Bob gets a 404. No response sent to Bob contains a join token, and the only attendee left in Chime is Alice's.

The same technique reproduces two people becoming the first participant at once, one person joining from two tabs at once, and a meeting ending between `GetMeeting` and `CreateAttendee`. The tests are in `api/test/seats.test.ts`.

## Taking a seat away

<!-- section: 51.revoke -->

Leaving is giving a seat in reverse.

<<< @/examples/51-chime-sdk/api/src/rooms.ts{leave}

The attendee in Chime is deleted first, and the seat in the table after it. The other way round, a failed `DeleteAttendee` would leave a table that has forgotten the seat and a join token that still works. In this order a failure leaves the seat in the table, and leaving again can delete it. Between the failure and the retry, though, the join token still works. A test checks exactly that fact.

Removing a member and closing a room follow one order.

<<< @/examples/51-chime-sdk/api/src/rooms.ts{revoke}

Take the right away first, then end what the right had produced, and delete the record last. To remove a member, the function takes them off the list first. After that, a join in progress fails to record its seat on the membership condition. To close a room, the function sets `closed` first. After that, neither a new meeting nor a new seat can be recorded.

There is one more reason the room's record goes last. The meeting ID exists nowhere else. The newer API namespace has no call that lists meetings, so forgetting the ID first would leave a running meeting with no way to stop it. If `DeleteMeeting` fails, the room stays closed, and the owner closing it again picks up where it stopped.

### When a browser just disappears

Everything above assumes the browser calls `POST /rooms/{id}/leave`. When a tab is closed or a device loses power, nobody calls the API. The attendee stays, and its join token stays valid.

This chapter's API does not detect that. A meeting ends after five minutes with nobody connected, and every attendee in it goes at that moment. Until then, anyone who knows the remaining join token can come back in. Only that user's browser should know it, so this chapter stops here. What production adds is on the [costs, pitfalls, and cleanup page](/en/chapters/51-chime-sdk/wrap.md).

## The table's conditions

<!-- section: 51.store -->

Giving a seat relies on conditional writes to the table. The interface makes each condition a method.

<<< @/examples/51-chime-sdk/api/src/room-store.ts{store}

Every method is a single write that returns `false` when its condition does not hold. Nothing reads first and writes afterwards.

A room goes into chapter 05's notes table, under keys of its own.

<<< @/examples/51-chime-sdk/api/src/dynamodb-room-store.ts{keys}

The conditions are written as DynamoDB condition expressions.

<<< @/examples/51-chime-sdk/api/src/dynamodb-room-store.ts{conditions}

The expression for taking a seat joins four conditions with `AND`: `meetingId = :meeting`, the seat being as it was read, `closed = :open`, and `contains(members, :sub)`. Giving up a seat leaves out the last two, or a removed member's seat could never be cleared.

These expressions have not been run against DynamoDB. The Nix shell has no Docker daemon, so DynamoDB Local cannot be started. What the tests establish is that the in-memory implementation obeys the same conditions, and that the DynamoDB implementation sends the expressions shown on this page. Whether DynamoDB accepts them and they behave as written has to be confirmed by deploying.

## The part that calls Chime

<!-- section: 51.gateway -->

The room code does not call the Chime SDK directly. It goes through an interface that states the five calls it needs in the application's own terms.

<<< @/examples/51-chime-sdk/api/src/meetings.ts{gateway}

A meeting that has ended and one that never existed are not told apart here. Chime answers `NotFoundException` to both, and to this application both are ordinary answers. A delete succeeds when its target is already gone, because that is what a retry looks like.

The implementation that calls AWS is short.

<<< @/examples/51-chime-sdk/api/src/chime-meetings.ts{chime}

Responses are checked with Valibot before they go to the browser. If a field the browser library needs is missing, you find out from the server's log, not from the screen of a user trying to start a call. Every failure other than `NotFoundException` becomes a `MeetingsError`, and the API answers 503. Throttling (HTTP 429) is one of them.

Locally and in tests, another implementation of the same interface is used.

<<< @/examples/51-chime-sdk/api/src/fake-meetings.ts{fake}

This implementation is not Chime. It is a model that copies two statements from the API reference: a join token is valid until its attendee is deleted or its meeting ends, and deleting a meeting deletes its attendees. `admit` answers "whom would this join token let in", and the tests use it to check the invariant. How the real media service decides is not confirmed in this chapter.

An environment variable chooses between them.

<<< @/examples/51-chime-sdk/api/src/env.ts{env}

The development server starts only with `MEETINGS=fake`, and the Lambda handler only with `MEETINGS=chime`.

<<< @/examples/51-chime-sdk/api/src/lambda.ts{handler}

## The stack

<!-- section: 51.stack -->

The stack is chapter 06's without the SPA hosting, plus the permission to call Chime and the routes. The user pool, the table, the function and the HTTP API are written as in chapter 06, so only the differences are covered here.

A Chime SDK meeting is not a CloudFormation resource. The template reference's list has no Chime SDK entry, and the pinned aws-cdk-lib has no module for it. All that can be declared is the permission to create meetings.

<<< @/examples/51-chime-sdk/infra/lib/calls-stack.ts{chime-permissions}

The `*` on `chime:CreateMeeting` is not a shortcut. In IAM's service authorization reference this action has no resource type, since a meeting that does not exist yet has no ARN to name. The other four act on a meeting, and are limited to this account's meetings in the Region where the API is called. The tests pin that `*` appears once, for `chime:CreateMeeting`, and that these five are the only Chime actions.

With this permission the function can also touch meetings that another application in the same account created. That can be narrowed. `CreateMeeting` supports the condition key `aws:RequestTag` and the rest support `aws:ResourceTag`, so meetings can be tagged and only tagged ones allowed. This chapter has not tried it, so the stack does not include it.

Five lines of routes were added for rooms.

<<< @/examples/51-chime-sdk/infra/lib/calls-stack.ts{routes}

Every route has the JWT authorizer. Together with the sign-in check inside the application that makes two layers, and a request turned away by API Gateway never reaches the function.

Everything in the stack is billed by use: an API Gateway HTTP API, Lambda, an on-demand DynamoDB table, and a Cognito user pool. Nothing is billed by the hour.

## The page in the browser

<!-- section: 51.web -->

The page is a small Vue application that uses chapter 06's sign-in as it is. It is built with Vize. What differs from chapter 06's screen is four actions: create a room, let someone in, join, and leave.

The configuration is chapter 06's `/config.json` with one more key.

<<< @/examples/51-chime-sdk/web/src/config.ts{config}

With `media` set to `"none"`, the page goes as far as taking a seat and stops there. The local API hands out made-up places to connect to, and trying them would only fail.

With `"chime"`, the page hands the seat to the client library.

<<< @/examples/51-chime-sdk/web/src/session.ts{start}

The two objects passed to `MeetingSessionConfiguration` are the ones in the API's response. From here on the browser talks to Chime's media service directly. The browser asks for the microphone at `startAudioInput`, and the camera is not used until the user presses a button. Everyone else's voices arrive mixed into one stream, so one `<audio>` element is enough. Video arrives as one tile per participant, and a tile's `boundExternalUserId` is the `sub` the server put in when it created the attendee.

This module is loaded only when someone joins. Built, it is a chunk of about 1.3 MB (295 kB gzipped), and it is not sent to someone who merely opens the page.

A session ends for many reasons. What to show and what to do for each is an ordinary function that does not load the library.

<<< @/examples/51-chime-sdk/web/src/call.ts{signal}

`AudioJoinedFromAnotherDevice` arrives when the same join token is used to connect from somewhere else. If you moved to another device yourself, nothing is wrong. If you did not, the join token has leaked. The page says that joining again cuts the other connection off, because on a new join the server deletes the old attendee before it creates a new one.

<<< @/examples/51-chime-sdk/web/src/call.ts{release}

Whether to tell the API about leaving, once the session is over, depends on the reason too. If the seat has merely moved to another device, reporting a leave would delete the attendee and end the call on the device it moved to.

The parts of this page that deal with media have only passed the type check and the build. The microphone, the camera, audio playback and the video tiles have never been run.

Next: [Run It Locally](/en/chapters/51-chime-sdk/local.md).
