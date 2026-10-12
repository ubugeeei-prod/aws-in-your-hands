---
title: "51 Chime SDK: Deploy"
---

# 51 Chime SDK: Deploy

The steps on this page have not been run against AWS yet. The tasks and the steps are in place, and the results described are what the documentation and the code lead you to expect. A call cannot be checked by one person, so you create two users.

## Deploy and make a call

<!-- section: 51.deploy -->

Look at the price before you start. The stack by itself has nothing billed by the hour. Billing starts when someone connects to a meeting, at USD 0.0017 per person per minute. When you have finished trying it, do not stop at closing the browser tabs: go on to the [cleanup](/en/chapters/51-chime-sdk/wrap.md).

Look at the diff, then deploy.

```bash
vp run calls:infra:diff
vp run calls:infra:deploy
```

This creates the user pool, the table, the function and the HTTP API. It creates no Chime resource at all. The API creates a meeting when the first person joins.

Create two users. As in chapter 06, Cognito emails the temporary password.

```bash
vp run calls:user:create alice@example.com
vp run calls:user:create bob@example.com
```

Build the page, write the deployed API and user pool into its configuration, and serve it locally.

```bash
vp run calls:config
vp run preview:calls:web
```

`calls:config` writes `web/dist/config.json` from the stack's outputs and sets `media` to `"chime"`. Open the page at `http://localhost:4173`. It is not HTTPS, but browsers treat `localhost` as a secure context, so the microphone and the camera can be used. This origin is also the only one the stack allows to call the API and to return to after sign-in.

From here you need two browsers. Use a different browser or a private window.

1. In the first, sign in as Alice and press "Create a room". The room ID is shown
2. In the second, sign in as Bob. Bob's user ID (`sub`) is shown at the top of the page
3. On Alice's page, enter Bob's user ID and press "Add"
4. On Bob's page, enter the room ID and press "Open"
5. Press "Join" on both, and allow the microphone

The expected result is that both pages list two people with "has a seat and is connected", and that each hears the other. With two browsers in one room, each microphone picks up the other's speaker, so use earphones or mute one side.

There are three things to check. Each matches a part of this chapter's invariant.

- When Alice presses "Remove" for Bob, Bob's call drops, and Bob pressing "Join" again does not get in
- When Bob presses "Leave", Bob's "is connected" disappears from Alice's page
- When Alice opens the same room in another tab and presses "Join", the call in the first tab drops, because the server deletes the attendee of the old join token

The function's log lines have chapter 06's shape. A call that handed out a seat is a 200 for `POST /rooms/{id}/join`, with the `sub`. The join token is not logged.

Finally, check for drift.

```bash
vp run calls:infra:drift
```

A meeting is not a resource of the stack, so it does not show up in a drift check. Whether a meeting is running is what `calls:end` on the next page shows.

Next: [Costs, Pitfalls, and Cleanup](/en/chapters/51-chime-sdk/wrap.md).
