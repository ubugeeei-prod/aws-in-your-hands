---
title: "15 Email: Run It Locally"
---

# 15 Email: Run It Locally

## Run it locally

<!-- section: 15.local -->

Copy `examples/15-email/.env.example` to `.env` in the same directory.

<<< @/examples/15-email/.env.example

```bash
vp run dev:mail
```

It comes up at <http://localhost:8787>. From another terminal, request one notification.

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-1","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

You get `"status":"accepted"` and a message ID. The status code is 202, chosen to say "accepted", not "arrived".

Run the same command again. This time it's `"status":"duplicate"`. Take a look at what was sent.

```bash
curl -s http://localhost:8787/dev/outbox
```

One email, and only one. You can try a title with a line break as well.

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-2","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan\r\nBcc: attacker@example.com"}'
```

That returns a 400 with `noteTitle` in `issues`.

Here's what the dev server is made of.

<<< @/examples/15-email/src/dev.ts{dev}

The two routes under `/dev/` exist only on the dev server. They stand in for what only AWS has: the inbox, and SES reporting back. The app that goes onto Lambda doesn't include them.

The server refuses to start with `MAIL_MODE=aws`. If it did start, a dev server on your machine would be sending real mail with your own credentials.

What isn't reproduced is the same as in chapter 04 (API Gateway, Lambda's limits, IAM), plus the following.

- SES: sender verification, the sandbox limits, rate limits, actual delivery
- Signature checking: the local API lets anyone call it
- DynamoDB: local records are a `Map` in memory, gone when you stop the server
- SNS: events are never duplicated or delayed. In the next section you'll cause that by hand

## Cleaning up after mail that didn't arrive

<!-- section: 15.events -->

SES reports what happened after sending, as events. This chapter receives three kinds.

- `Delivery`: the recipient's mail server took the message. It doesn't tell you whether it reached the inbox, or was read
- `Bounce`: it came back undelivered. Either permanently (`Permanent`), such as an address that doesn't exist, or temporarily (`Transient`), such as a full mailbox
- `Complaint`: the recipient reported it as spam

Keep mailing addresses that don't exist, or people who don't want your mail, and your reputation as a sender drops, until even good addresses become hard to reach. The production access request (coming up) also asks you to confirm that you have a process for handling bounces and complaints.

### Events are outside data

Events arrive as JSON. SES decides their shape, and your types have nothing to do with it. So they're validated at the door.

<<< @/examples/15-email/src/events.ts{schema}

The schema lists only the fields this code actually uses. SES sends many more and may add others. Unknown fields are ignored. A missing field that the code uses is a refusal.

Deciding "what to do" from an event is a pure function.

<<< @/examples/15-email/src/events.ts{plan}

Sending is stopped only by a permanent bounce and by a complaint. A temporary bounce doesn't stop it. The mailbox may have room tomorrow.

Which notification an event belongs to is traced through the tag attached when sending (`notification_id`), not through the SES message ID. When a response is lost, you never learn the message ID. The SES documentation, too, recommends tags for tying events back to your own logic.

This is the part that actually writes.

<<< @/examples/15-email/src/events.ts{handle}

Failures are handled in two ways. An event that can't be read is logged as an error and dropped. Retrying won't make it readable. A failed write to the table throws. SNS invokes the function asynchronously, and when the function returns an error, Lambda runs it again with the same event (up to two more times by default).

Dropping unreadable events also means that if the shape changes, bounces get missed. That error log is one to watch (for how to put an alarm together, see [chapter 19](/en/chapters/19-observability.md)).

### Delivered twice, out of order

Lambda's asynchronous invocation is "at least once". The same event can arrive twice even when the function returned no error. And the order of arrival isn't necessarily the order things happened in.

So the writes are made to give the same result however often they run. A suppression is an overwrite of the same key: write it twice and there's still one entry. For the state, the direction of travel is fixed.

<<< @/examples/15-email/src/store.ts{transitions}

The right-hand side is "which states a record may move from". Only `claimed` may become `sent`, for example.

Here's when that matters. The sending function hands the email to SES and is about to write `sent`. In that instant, the delivery event reaches the other function, which writes `delivered` first. The late `sent` write doesn't meet its condition and does nothing. `delivered` never rolls back to `sent`.

<<< @/examples/15-email/src/dynamodb-store.ts{advance}

You can try it locally. With the dev server still running, feed a delivery event for the `share-1` from earlier.

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/delivery.json
curl -s http://localhost:8787/share-notifications/share-1
```

The state becomes `delivered`. Now feed a bounce. The recipient in this fixture is `recipient@example.com`.

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/bounce.json
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-3","to":"recipient@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

The second response is `"status":"suppressed"`. That address won't be mailed again.

The fixtures were made from the examples in the SES documentation. They aren't events received in a real account.

### SES keeps a list too

SES has a suppression list of its own: the account-level suppression list. It adds addresses that produced a permanent bounce or a complaint by itself. In accounts that started using SES after November 25, 2019, it's on by default. This chapter's stack also turns it on explicitly, on the configuration set.

So why keep a table of your own as well? Three reasons.

- Mail to an address on the list is accepted by SES, and then not sent. The send API returns success. To the caller it looks `accepted`, and a bounce event (`OnAccountSuppressionList`) comes later. Check your own list first, and you can answer "not sending" on the spot
- While you're in the sandbox, SES's list can't be managed through the API. You can't add an address, or import a batch
- You get to hold the reason and the time as your own data. If you want to show a user "we couldn't reach this address", you need that

The two lists aren't linked. SES's list belongs to an account and a Region. Your table belongs to this stack. To restore an address that was suppressed by mistake, remove it from both.

```bash
aws sesv2 delete-suppressed-destination --email-address recipient@example.com --region ap-northeast-1
aws dynamodb delete-item --table-name <TableName> --region ap-northeast-1 \
  --key '{"pk":{"S":"SUPPRESSION#recipient@example.com"}}'
```

One more thing worth knowing. Gmail doesn't pass complaint data to SES. When a Gmail user presses "Spam", no event arrives and neither list gets the address. Zero complaints doesn't mean nobody minds.
