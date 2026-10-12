---
title: "15 Email: Run It Locally"
---

# 15 Email: Run It Locally

## Running it locally

<!-- section: 15.local -->

On the [previous page](/en/chapters/15-email.md) you built the email and the record-first send. On this page you run that API on your machine and add the handling of what SES reports after a send. Nothing is created in AWS yet.

Copy `examples/15-email/.env.example` to `.env` in the same directory.

<<< @/examples/15-email/.env.example

```bash
vp run dev:mail
```

The dev server comes up at <http://localhost:8787>. From another terminal, request one notification.

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-1","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

You get `"status":"accepted"` and a message ID. The status code is 202 because the response means the mail was accepted, not that it arrived.

Run the same command again and you get `"status":"duplicate"`. This command shows what was sent.

```bash
curl -s http://localhost:8787/dev/outbox
```

It holds one email. You can try a title with a line break as well.

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-2","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan\r\nBcc: attacker@example.com"}'
```

That returns a 400 with `noteTitle` in `issues`.

This is the dev server's code.

<<< @/examples/15-email/src/dev.ts{dev}

The two routes under `/dev/` exist only on the dev server. They stand in for the two things only AWS has, the inbox and the reports from SES. The app that goes onto Lambda does not include them.

The dev server refuses to start with `MAIL_MODE=aws`. If it started, a server on your machine would send real mail with your own credentials.

The local setup does not reproduce what chapter 04 already listed (API Gateway, Lambda's limits, IAM), or these four things.

- SES: sender verification, the sandbox limits, rate limits, actual delivery
- Signature checking: the local API lets anyone call it
- DynamoDB: local records are a `Map` in memory, and they are gone when you stop the server
- SNS: events are never duplicated or delayed. In the next section you cause that by hand

## Cleaning up after mail that didn't arrive

<!-- section: 15.events -->

SES reports what happened after a send as events. This chapter receives three kinds.

- `Delivery`: the recipient's mail server took the message. It does not tell you whether the message reached the inbox or was read
- `Bounce`: the message came back undelivered, either permanently (`Permanent`), as with an address that does not exist, or temporarily (`Transient`), as with a full mailbox
- `Complaint`: the recipient reported the message as spam

If you keep mailing addresses that do not exist or people who do not want your mail, your reputation as a sender drops and mail to good addresses becomes harder to deliver. The production access request on the [deploy page](/en/chapters/15-email/deploy.md) also asks you to confirm that you have a process for handling bounces and complaints.

### Events are outside data

Events arrive as JSON. SES decides their shape and your types have no say in it, so the code validates them on the way in.

<<< @/examples/15-email/src/events.ts{schema}

The schema lists only the fields this code uses. SES sends many more and may add others, so unknown fields are ignored, and an event that lacks a field the code uses is refused.

A pure function decides what to do with an event.

<<< @/examples/15-email/src/events.ts{plan}

Only a permanent bounce and a complaint stop future sending. A temporary bounce does not, because a mailbox that is full today may have room tomorrow.

The code finds the notification an event belongs to through the tag it attached when sending (`notification_id`). It does not use the SES message ID, because when a response is lost you never learn the message ID. The SES documentation also recommends tags for tying events back to your own processing.

This function writes to the table.

<<< @/examples/15-email/src/events.ts{handle}

Failures are handled in two ways. An event that cannot be read is logged as an error and dropped, since retrying will not make it readable. A failed write to the table throws. SNS invokes the function asynchronously, so when the function returns an error, Lambda runs it again with the same event (up to two more times by default).

Because unreadable events are dropped, a change in the shape of SES's events means missed bounces. Watch that error log (for how to build an alarm, see [chapter 19](/en/chapters/19-observability.md)).

### Delivered twice, out of order

Lambda's asynchronous invocation is "at least once", so the same event can arrive twice even when the function returned no error. Events also do not necessarily arrive in the order they happened.

The writes are therefore made to give the same result however often they run. A suppression overwrites the same key, so writing it twice still leaves one entry. For the state, the code fixes which moves are allowed.

<<< @/examples/15-email/src/store.ts{transitions}

The array on the right lists the states a record may move from to reach the state on the left. Only `claimed` may become `sent`, for example.

The rule matters in a case like this one. The sending function hands the email to SES and is about to write `sent`. Before that write lands, the Delivery event reaches the other function, which writes `delivered`. The late `sent` write does not meet its condition and changes nothing, so `delivered` never rolls back to `sent`.

<<< @/examples/15-email/src/dynamodb-store.ts{advance}

You can try event handling locally. With the dev server still running, send it a Delivery event for the `share-1` you sent in the previous section.

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/delivery.json
curl -s http://localhost:8787/share-notifications/share-1
```

The state becomes `delivered`. Next, send a bounce event. The recipient in this fixture is `recipient@example.com`.

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/bounce.json
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-3","to":"recipient@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

The second response is `"status":"suppressed"`, and that address will not be mailed again.

The fixtures were made from the examples in the SES documentation. They are not events received in a real account.

### SES keeps a list too

SES has a suppression list of its own, called the account-level suppression list, and SES itself adds the addresses that produced a permanent bounce or a complaint. In accounts that started using SES after November 25, 2019, it is on by default. This chapter's stack also turns it on explicitly, on the configuration set.

There are three reasons to keep a list in your own table anyway.

- When you mail an address on SES's list, SES accepts the mail and then does not send it. The send API returns success, so the caller sees `accepted`, and a bounce event (`OnAccountSuppressionList`) comes later. If you check your own list first, you can answer "not sending" on the spot
- While you are in the sandbox, SES's list cannot be managed through the API. You cannot add an address or import a batch
- You hold the reason and the time as your own data. You need that data if you want to show a user that an address could not be reached

The two lists are not linked. SES's list belongs to an account and a Region, and your table belongs to this stack. To restore an address that was suppressed by mistake, remove it from both.

```bash
aws sesv2 delete-suppressed-destination --email-address recipient@example.com --region ap-northeast-1
aws dynamodb delete-item --table-name <TableName> --region ap-northeast-1 \
  --key '{"pk":{"S":"SUPPRESSION#recipient@example.com"}}'
```

Gmail does not pass complaint data to SES. When a Gmail user presses "Spam", no event arrives and the address goes onto neither list. Zero complaints does not mean that nobody minds your mail.
