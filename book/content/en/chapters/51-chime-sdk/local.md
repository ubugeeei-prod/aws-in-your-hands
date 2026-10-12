---
title: "51 Chime SDK: Run It Locally"
---

# 51 Chime SDK: Run It Locally

This page runs the API and the page from the [previous page](/en/chapters/51-chime-sdk/build.md) without touching AWS. What can be checked locally is who gets a seat. No audio or video flows locally.

## What can be checked locally

<!-- section: 51.local -->

The tests and the type checks need no credentials.

```bash
vp test run examples/51-chime-sdk
vp run typecheck
vp run typecheck:calls:web
vp run lint:calls:web
vp run calls:infra:synth
```

There are 69 tests: authorization (who gets a join token), the order of seat operations (with interruptions and failures at chosen points), the table's conditions, the shape of the calls to Chime, the page's decisions, and the stack assertions.

To run the API, copy the sample settings and start it.

```bash
cp examples/51-chime-sdk/.env.example examples/51-chime-sdk/.env
vp run dev:calls:api
```

Sign-in is chapter 06's development one: send a user name and get a token. The model from the previous page stands in for the meetings API. Not one call to Chime is made.

In another terminal, create a room as Alice, let Bob in, and have Bob take a seat. Put the room ID from the first response in place of `<id>`.

```bash
B=http://localhost:8787
token() { curl -s -X POST $B/local/token -H 'content-type: application/json' -d "{\"user\":\"$1\"}" | jq -r .accessToken; }
ALICE=$(token alice); BOB=$(token bob)

curl -s -X POST $B/rooms -H "authorization: Bearer $ALICE"
ID=<id>
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/rooms/$ID/join -H "authorization: Bearer $BOB"
curl -s -o /dev/null -w '%{http_code}\n' -X PUT $B/rooms/$ID/members/local-bob -H "authorization: Bearer $ALICE"
curl -s -i -X POST $B/rooms/$ID/join -H "authorization: Bearer $BOB"
```

This is the output from a run made while writing the chapter. The IDs differ on every run. The end of the join token is hidden, and the date and connection headers are left out.

```text
{"id":"94d35dcd-51dc-4413-9a53-6770c8716c50","owner":"local-alice","members":["local-alice"],"seated":[]}
404
204
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:5193
cache-control: no-store
content-type: application/json
vary: Origin
x-request-id: b4e81f23-16a0-4d53-851f-1acaf397b511

{"meeting":{"MeetingId":"d96c471f-234e-421f-bd1e-30719d6aad9f","MediaRegion":"local","MediaPlacement":{"AudioHostUrl":"fake-media.invalid:3478","SignalingUrl":"wss://fake-media.invalid/control/d96c471f-234e-421f-bd1e-30719d6aad9f","TurnControlUrl":"https://fake-media.invalid/turn"}},"attendee":{"AttendeeId":"c83ed2d1-8f85-4fcb-bd47-eeb610c93044","ExternalUserId":"local-bob","JoinToken":"fake-join-token-<redacted>"}}
```

Before he is a member Bob gets a 404, and once he is let in he gets a seat. `access-control-allow-origin` says 5193 because port 5173 was in use for something else at the time, so the page ran on 5193 and the API's `ALLOWED_ORIGIN` was set to match. With the sample settings it is 5173.

The page runs too.

```bash
vp run dev:calls:web
```

Open `http://localhost:5173`, sign in with a user name, create a room and press "Join". The page says that you hold a seat and that this API has nothing to connect to. "Leave" gives the seat back. To try two people, open two tabs and sign in under different user names. The sign-in state is kept in memory only, so each tab can be a different user.

### What cannot be checked locally

The media path is never exercised locally. Microphone and camera permission, audio playback, video tiles, reconnecting after a dropped connection, and whether the real media service accepts a join token all need a meeting in AWS. The model returns hosts under `.invalid`, and a browser that tried to connect would stop at name resolution.

The DynamoDB condition expressions are not run locally either. The local API keeps rooms in memory.

Next: [Deploy](/en/chapters/51-chime-sdk/deploy.md).
