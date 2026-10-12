---
title: "15 Email: SES"
sourceRevision: 1
---

# 15 Email: SES

In chapter 04 you built an API. In this chapter you'll put another one next to it: an API that sends a single "someone shared a note with you" notification email. The sending is done by Amazon SES.

The awkward thing about email is that sending it isn't the end of the story. The address didn't exist. The recipient reported it as spam. You can't even tell whether it went out. This chapter takes care of all of that. And as long as you're only running it locally, you need neither an AWS account nor a real email address.

Three things before we start.

- The prerequisite is [chapter 04](/en/chapters/04-http-api.md). Records are kept in DynamoDB, but everything you need to know is explained here (the details are in [chapter 05](/en/chapters/05-dynamodb.md))
- The outline placed this chapter behind the queue of [chapter 08](/en/chapters/08-async.md). As it turned out, this is a recipe that works on its own. Where a queue would connect is pointed out along the way
- Run it in AWS and real mail goes out. Verifying the sender, setting up DNS, and requesting that the sending limits be lifted are things a person does by hand. This chapter gives you the steps and the commands. It doesn't do them for you

The code is in `examples/15-email/`.

## The big picture

<!-- section: 15.architecture -->

```figure
caption: The sending path runs down from the API to SES, and the outcome comes back through SNS to the same table
node caller: Caller | another backend, or vp run mail:send
node api: API Gateway HTTP API | ap-northeast-1, IAM authorization on every route
node fn: Lambda "ApiHandler"
node ses: SES | identity: your address or domain
node table: DynamoDB table "Mail" | NOTIFICATION#<id>, SUPPRESSION#<address>
node sns: SNS topic "MailEvents" | Delivery / Bounce / Complaint
node recipient: recipient's mail server
node events: Lambda "EventsHandler"
edge caller -> api: HTTPS, signed with SigV4
edge api -> fn: POST, GET /share-notifications; GET /health
edge fn -> ses: 2. SendEmail (one recipient, tag notification_id)
edge fn -> table: 1. claim (conditional write), 3. mark sent
edge ses -> recipient
edge ses --> sns: later, through the configuration set
edge sns -> events
edge events -> table: suppress, advance state
mark ses
```

The top half is the sending path. The bottom half is how the outcome comes back.

The caller gives each notification a name of its own (`notificationId`) and asks the API to send it. The function first records in DynamoDB that "this notification is mine to send", and only then hands the mail to SES. SES takes it from there and tries to deliver it to the recipient's mail server.

Whether it arrived, came back (a bounce), or was reported as spam (a complaint) is something SES tells you later. That news travels through an SNS topic to a second function, which writes two things to the table: the list of addresses you'll no longer mail (the suppression list), and the state of each notification.

The table is the owner of the state in this design. As you saw in chapter 04, nothing can live in a function's memory.

### Don't leave the door open

The API in chapter 04 could be called by anyone who knew the URL. Do that with an API that sends mail, and it becomes a relay: strangers get to send mail to whatever address they like.

So every route in this chapter has IAM authorization. To call one, you have to sign the request with AWS credentials (SigV4). Nothing in a browser is meant to call it, and there's no CORS configuration. The thing that sends a notification is the code that shared the note, which is another backend.

The JWT authorizer from [chapter 06](/en/chapters/06-auth.md) is another option. If you go that way, make sure the server decides the recipient. Otherwise you've built "anyone who is signed in can mail anyone".

### Other shapes this could take

- **No API: send from a queue.** The sharing code puts a message on a queue, and a function takes it off and sends. The caller no longer waits on SES being slow or failing. How to build the queue and the worker is in [chapter 08](/en/chapters/08-async.md). `sendShareNotification` in this chapter is written so that it can sit behind a queue as it is
- **A queue between SNS and the function.** It lets you keep the events that failed to process. Also a chapter 08 topic
- **Not SES.** If you'd rather not manage your sender reputation or request a limit increase yourself, an email SaaS is easier in some situations. SES is cheap and is managed with the same permissions as the rest of AWS. In exchange, it comes with the work in the second half of this chapter

## Build the email first

<!-- section: 15.message -->

Before any AWS, let's make the email itself. Here's the shape of a request.

<<< @/examples/15-email/src/contract.ts{request}

Exactly one recipient. No link URL: the request carries the note's ID, and the server builds the URL from its own configuration. If the caller could pass a URL, this API would be a tool for producing "mail from your domain with a link to anywhere".

### Keep line breaks out of the headers

An email is text: headers such as `Subject: ...` and `To: ...`, one per line, followed by the body. Which means that if a string destined for the subject contains a line break, whatever comes after it may be read as the next header.

What if a note's title were `Trip plan\r\nBcc: attacker@example.com`? Titles are written by users. This is header injection.

<<< @/examples/15-email/src/contract.ts{header-safe}

A title or a name that contains a line break or a control character is refused. Not silently cleaned: the fact that such input arrived is something the caller should hear about. The recipient passes only if it reads as one address. A comma-separated list doesn't, and neither does the `Name <address>` form.

Assembling the email is a pure function.

<<< @/examples/15-email/src/message.ts{build}

The values the schema checked at the door are checked here once more. If someone later writes code that calls this function without going through the schema, a line break still doesn't reach a header.

To be honest, what SES does with such a line break hasn't been checked. With the way this chapter sends (the `Simple` format, coming up), SES assembles the headers and the code writes none of them. Refusing on your own side first still means you don't depend on how SES behaves.

The HTML body has a hole of its own. A title containing `<script>` or `<a href=...>` would be interpreted as HTML.

<<< @/examples/15-email/src/message.ts{escape}

Every user-written string goes through this before it's placed in HTML. The tests throw in a title with a line break, a list of recipients, and a name containing `<script>`, one by one.

## Make the sending part swappable

<!-- section: 15.adapters -->

Chapter 04 put note storage behind an interface. Sending mail gets the same treatment.

<<< @/examples/15-email/src/mailer.ts{mailer}

The important part is that there are three outcomes.

- `accepted`: the provider took the message
- `rejected`: the provider said no. Nothing was sent
- an exception: nobody knows what happened

The third one is never folded into the other two. That distinction pays off later.

Locally, you use an implementation that sends nothing.

<<< @/examples/15-email/src/mailer.ts{outbox}

Mail that would have been sent just piles up in an array. The dev server and the tests use this.

Here's the one that calls SES.

<<< @/examples/15-email/src/ses-mailer.ts{ses}

It uses `SendEmail` from the SES API v2. With the `Simple` format you pass a subject and a body, and SES does the work of turning them into an email.

Look at how errors are read. A 4xx answer means SES read the request and refused it, so that's `rejected`. Anything else (a timeout, a dropped connection, a 5xx) leaves you unable to tell whether SES took the message. So it's thrown on as an exception.

Which implementation is used depends on an environment variable.

<<< @/examples/15-email/src/compose.ts{adapters}

Notice `maxAttempts: 1`. Left alone, the AWS SDK retries automatically on timeouts and 5xx errors (three attempts in total by default). Usually that's a help. For sending mail it's a problem: if the first attempt did get through, the SDK's retry sends a second email, and your records know nothing about it. Whether to retry is decided by the mechanism in the next section.

## Record first, or send first?

<!-- section: 15.order -->

This is the heart of the chapter.

SES's `SendEmail` has no way to say "if this is the same request, ignore the second one" (an idempotency token). Send the same content twice, and two emails arrive.

And the send API returning success is a different event from the email arriving. Success only means "SES took it". The reverse holds too: no response doesn't mean nothing was sent. The SES documentation itself says that, on rare occasions, a send request returns an error even though the email was accepted.

A caller that lost the response will normally retry. What happens then depends on which you do first: record, or send.

```figure
caption: Send first and record after, and a retry after a lost response delivers two mails
type: sequence
actor caller: Caller
actor fn: Lambda
actor table: DynamoDB | record
actor ses: SES
step caller -> fn: asks for share-1
step fn -> ses: t1 SendEmail
note ses: SES accepts
step ses --x fn: t2 response lost (timeout)
note table: t3 no record was written
step caller -> fn: t4 retries share-1
step fn -> ses: t5 no record: sends again
note ses: two mails arrive
```

```figure
caption: Record first and send after (this chapter), and the retry sends nothing, so one mail arrives
type: sequence
actor caller: Caller
actor fn: Lambda
actor table: DynamoDB | record
actor ses: SES
step caller -> fn: asks for share-1
step fn -> table: t1 claim share-1
note table: written
step fn -> ses: t2 SendEmail
note ses: SES accepts
step ses --x fn: t3 response lost (timeout)
step caller -> fn: t4 retries share-1
step fn -x table: t5 claim exists
note fn: nothing is sent
note ses: one mail arrives
```

```figure
caption: The price of recording first is that no mail arrives when the function dies before SendEmail
type: sequence
actor caller: Caller
actor fn: Lambda
actor table: DynamoDB | record
actor ses: SES
step caller -> fn: asks for share-1
step fn -> table: t1 claim share-1
note table: written
note fn: t2 dies before SendEmail
step caller -> fn: t3 retries share-1
step fn -x table: t4 claim exists
note fn: nothing is sent
note ses: no mail arrives
```

Send first, and a failure can deliver two emails. Record first, and a failure can deliver none. There's no way to rule out both. Recording and sending are separate calls to separate services, and nobody can prevent the process from stopping in between.

This chapter **records first**. Here's the invariant it protects.

> No `notificationId` ever causes more than one email to be sent.

If a share notification doesn't arrive, the person who shared can just ask "did you see it?". The same notification arriving twice, or three times, is the bigger nuisance for the recipient. Repeated mail invites complaints, and complaints damage your reputation as a sender. For mail like a password reset, where the user is stuck until it arrives, the opposite choice can be right. Then you need something else, such as wording that makes a duplicate recognizable.

<<< @/examples/15-email/src/notify.ts{notify}

`claim`, in step 1, is the idempotency key. The record saying "this notification is mine to send" is taken before sending. If it can't be taken, someone else already holds it, and nothing is sent.

### Claim in a single operation

Split "read whether a record exists, and write one if not" into two operations, and two requests arriving together will both read "no" and both write.

DynamoDB lets you attach a condition to a write. The check and the write happen as one operation, so even when requests arrive together, only one gets through.

<<< @/examples/15-email/src/dynamodb-store.ts{claim}

The condition is "there is no record yet", or "the last attempt was refused, and this is the same email". The second half is explained in a moment.

### The states of a notification

Each record holds one state.

```figure
caption: A notification starts with a claim and moves on with what SES answers and the events that arrive later
node none: (none)
node claimed: claimed | no answer: stays claimed (nobody retries automatically)
node sent: sent
node rejected: rejected
node delivered: delivered
node complained: complained
edge none -> claimed: claim
edge claimed -> sent: SES accepted
edge claimed -> rejected: SES refused
edge rejected -> claimed: same request again
edge sent -> delivered: Delivery
edge delivered -> complained: Complaint
```

```figure
caption: A Bounce moves a notification in any of four states to bounced
node claimed: claimed
node rejected: rejected
node sent: sent
node delivered: delivered
node bounced: bounced
edge claimed -> bounced: Bounce
edge rejected -> bounced
edge sent -> bounced
edge delivered -> bounced
```

This is where the three outcomes of `mailer` part ways.

When it's taken (`accepted`), the record becomes `sent`, with the message ID SES returned. If that write fails, the caller still gets a success. The email is already out, and reporting a failure here would tell the caller it wasn't sent.

When it's refused (`rejected`), the record becomes `rejected`. Nothing went out, so asking again with the same request claims it again and sends. This is what hitting the sending rate limit looks like.

When the outcome is unknown (an exception), nothing is done. The record stays `claimed`, and that is what blocks a resend. A function that dies partway, or is cut off by the Lambda timeout, ends up in the same place.

That last one is the price of recording first. A record stuck at `claimed` is a notification that "may have been sent, or may not". The code in this chapter doesn't resend it automatically. If a delivery event shows up later, the record moves to `delivered`, and you know it went out. If none does, a person looks and decides.

`rejected` has a small hole left in it, too. When the "returned an error but was accepted" case happens, the retry produces a second email. If the delivery event gets there first, the record moves to `delivered` and the retry is stopped. A retry that comes before the event can't be stopped. Closing this completely means treating every error as "unknown" and never retrying automatically.

### Same name, different email

A request with the same `notificationId` but a different recipient or title isn't a retry. It's a bug. The record carries a hash of the email's content, and a mismatch gets a 409. Quietly answering "already sent" would claim that an email went out which never did.

### How long records are kept

Keep claim records forever and the table only grows. Each record has an expiry written into it (30 days later by default), and DynamoDB's TTL feature deletes the ones that are past it. If the same `notificationId` shows up after that, it's sent as a new notification. In other words, "the same notification" means "within 30 days".

An expired record isn't deleted right away. According to the official documentation, deletion typically happens within a few days, and until then the record can still be read. For this chapter's purpose, a record staying longer does no harm.

## Break it to check it

<!-- section: 15.faults -->

Once the invariant is written down, go and try to break it.

```bash
vp run test:unit
```

List every place the flow can stop: checking the recipient, claiming, sending, recording after the send. For each there are two ways to fail: "it failed before it ran" and "it ran, and only the response was lost".

<<< @/examples/15-email/test/setup.ts{faults}

For each of those eight, the first request is made to fail, and the same request is made twice more. Then the sent emails are counted.

<<< @/examples/15-email/test/notify.test.ts{fault-table}

Every row is 1 or less. No row is 2.

Two rows are 0: the claim was written but its response was lost, and the send call failed before reaching SES. In both, only the record is left, and no email went out. The "price" from the diagram, showing up as a number.

For comparison, the opposite order is written out too.

<<< @/examples/15-email/test/notify.test.ts{send-first}

Send first, and losing one response is enough to make it two. That test expects the 2.

Other tests check that five simultaneous copies of a request send once, that a refused send can be retried, and that a notification which was supposedly refused isn't sent again once a delivery event has arrived for it.

One caveat. What these tests exercise is the in-memory implementation. Whether DynamoDB's conditional write really lets only one of several simultaneous requests through hasn't been checked against the real thing. What has been checked is that the request sent to DynamoDB carries the right condition, and no further.

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

## Getting it ready for AWS

<!-- section: 15.infra -->

Let's go through the CDK stack part by part.

### Where records live

<<< @/examples/15-email/infra/lib/email-stack.ts{table}

One table holds both the notification records and the suppression list, told apart by the start of the key (`NOTIFICATION#`, `SUPPRESSION#`). Both are only ever read one item at a time, by key, so that's enough.

### The configuration set, and where events go

<<< @/examples/15-email/infra/lib/email-stack.ts{configuration-set}

A configuration set is a named group of settings that you choose when sending. The event destination hangs off it. Forget to name the configuration set when sending, and not a single event arrives.

`addEventDestination` also adds a policy on the topic side: "SES may publish, for this configuration set's events only". A test checks that SES is the only one allowed to publish to the topic.

### The sender

<<< @/examples/15-email/infra/lib/email-stack.ts{identity}

An identity is a sender that SES has verified as yours: one email address, or a whole domain.

This is easy to misread, so, plainly: **the stack only starts the verification.** For an address, a verification email arrives at that address, and you follow the link in it. For a domain, you put records in DNS. Both are done by a person, and a successful deploy doesn't mean you can send. Not until verification is complete.

### What the sending function may do

<<< @/examples/15-email/infra/lib/email-stack.ts{send-role}

Allowing `ses:SendEmail` and nothing more would let the function send from any identity in the account. Three things narrow it here. The only identity it may use is this one. The only configuration set it may go through is this one. And the only address it may send as is `fromAddress`. Verify a domain and every address in that domain becomes usable, which is where the last condition earns its place.

To be honest, that `SendEmail` actually passes under this policy hasn't been confirmed yet. If a permission is missing, the first send fails with `AccessDenied`. If that happens, look at the resource ARN the error names.

### What the event function may do

<<< @/examples/15-email/infra/lib/email-stack.ts{events-role}

This function can't send mail. It can't read the table either. Writing is all it can do. It processes data that arrives from outside, so the less it's allowed, the better.

### The entrance

<<< @/examples/15-email/infra/lib/email-stack.ts{api}

On a route with `HttpIamAuthorizer`, API Gateway rejects a request that isn't signed, and the function is never invoked. A test checks that all three routes are `AWS_IAM`.

### cdkd and this stack

This stack uses three SES resource types (`AWS::SES::EmailIdentity`, `AWS::SES::ConfigurationSet`, `AWS::SES::ConfigurationSetEventDestination`). Reading the source of the pinned cdkd (0.296.28), none of the three has a dedicated implementation. Types without one are created through Cloud Control API, a general-purpose AWS API. SNS, DynamoDB, Lambda, IAM, API Gateway, and logs do have dedicated implementations.

The Cloud Control API path hasn't been run even once in this book yet.

```bash
vp run mail:infra:synth
```

Synth runs entirely on your machine. It makes no call to AWS.

## The sandbox and identities

<!-- section: 15.identity -->

Before deploying, meet SES's first hurdle.

SES in a new account starts out in a state called the sandbox. It's per Region: leave it in Tokyo and you're still in the sandbox everywhere else. While you're in it, these limits apply.

- You can send only to verified addresses and domains, and to the SES mailbox simulator
- At most 200 messages per 24 hours
- At most 1 message per second

"Only to verified recipients" is the big one. You can't mail strangers. Turned around: even without a domain of your own, verify your own address and you can mail yourself. For trying this chapter, that's enough.

There are two ways to verify a sender.

| | Verify an email address | Verify a domain |
| --- | --- | --- |
| What you need | An address that can receive mail | A domain whose DNS you can edit |
| How it's verified | Follow the link in the email you receive (valid for 24 hours) | Publish three DKIM CNAME records (detection can take up to 72 hours) |
| What you can send as | That address only | Every address in the domain |
| Good for | Trying this chapter | Production |

Don't use a free-mail address as your sender outside the sandbox. That domain's DNS isn't yours, so you can't set up the SPF, DKIM, and DMARC of the next section.

### Deploy, then verify

To try it with your own address:

```bash
vp run mail:infra:diff -c fromAddress=you@your-domain.example
vp run mail:infra:deploy -c fromAddress=you@your-domain.example
```

Without `fromAddress`, the stack is created with `notes@example.com`, an address that belongs to nobody. It's a default that exists so that synth works. Always pass your own when deploying.

When the deploy finishes, a verification email arrives from `no-reply-aws@amazon.com`. Follow the link. To see whether it's done:

```bash
aws sesv2 get-email-identity --email-identity you@your-domain.example --region ap-northeast-1
aws sesv2 get-account --region ap-northeast-1
```

In the first, `VerifiedForSendingStatus` being `true` means it's verified. Addresses are case-sensitive, so use the exact spelling you verified.

In the second, `ProductionAccessEnabled` being `false` means you're in the sandbox. `SendQuota` shows the 24-hour limit and how many you've sent in the last 24 hours.

## Send through the deployed API

<!-- section: 15.deploy -->

With verification done, send one. This task sends a real email, and it's billed (USD 0.0001 per message).

```bash
vp run mail:send --to you@your-domain.example
```

The task makes the request twice with the same `notificationId` and checks that the second is a `duplicate`. One email should land in your inbox.

Because the API has IAM authorization, a plain `fetch` can't call it. The task signs the request with your credentials.

<<< @/examples/15-email/scripts/signed-fetch.ts{signed-fetch}

To see what became of the notification:

```bash
vp run mail:status --id <notificationId>
vp run mail:logs --events --follow
```

After a while, `sent` should turn into `delivered`.

### Cause a bounce and a complaint

With your own address you can produce neither a bounce nor a complaint. SES provides recipients for exactly that: the mailbox simulator. It works inside the sandbox too.

```bash
vp run mail:send --to success@simulator.amazonses.com
vp run mail:send --to bounce@simulator.amazonses.com
vp run mail:send --to complaint@simulator.amazonses.com
```

`bounce@` returns a permanent bounce and `complaint@` a complaint. When the event arrives, this chapter's function puts that address in the table, so a second `mail:send` to the same address is `suppressed`. To try again, use an address with a label after a `+`, such as `bounce+1@simulator.amazonses.com`.

Mail to the simulator counts toward neither your daily sending quota nor your bounce and complaint rates. It's billed the same as any other mail.

Drift checking is the same as in the other chapters.

```bash
vp run mail:infra:drift
```

To be honest, the commands in this section and the previous one haven't been run against real AWS even once. Whether events arrive in the same shape as the fixtures, and how long `sent` takes to become `delivered`, will be added here once known.

## Sending from your own domain: SPF, DKIM, DMARC

<!-- section: 15.dns -->

To mail people you don't know, you need a domain. The receiving mail server tries to establish whether "this mail really was sent by the owner of this domain". Mail it can't establish that for is filed as spam, or refused.

There are three mechanisms for this, and all of them work through records in DNS.

**SPF** is a list of "the servers allowed to send in this domain's name". It isn't checked against the From that recipients see, though. It's checked against the domain of the envelope sender (MAIL FROM). With nothing configured, SES uses a subdomain of `amazonses.com` as MAIL FROM. SPF passes, but that's a statement about `amazonses.com`. It says nothing about your domain.

**DKIM** puts a digital signature on the mail, with the public key for verifying it in DNS. With SES's Easy DKIM, SES makes the key and SES does the signing. What you publish is three CNAME records that point to where the key is. SES also uses finding those three as the verification of your domain.

**DMARC** ties the two to the From domain. It requires that "the From domain is confirmed by either SPF or DKIM", and lets the domain's owner declare what should happen to mail that fails both.

When sending through SES, DKIM is the least work. Set up Easy DKIM on your From domain, and DMARC passes on the DKIM side. To pass on the SPF side as well, make MAIL FROM a subdomain of your own domain (say, `bounce.your-domain.example`).

To create the stack with a domain:

```bash
vp run mail:infra:deploy -c fromAddress=notes@your-domain.example -c senderIdentity=your-domain.example
```

To put MAIL FROM on your own domain as well, add `-c mailFromDomain=bounce.your-domain.example`.

This task prints the records you need to publish.

```bash
vp run mail:dns --report dmarc@your-domain.example
```

This function is what assembles them.

<<< @/examples/15-email/src/dns.ts{dns}

Printing is as far as the task goes. Creating the records in DNS isn't automated. Whether it's Route 53 or another DNS service, enter the names and values exactly as printed, in its console or CLI. All together, here's what gets published.

| What for | Type | Name | Value |
| --- | --- | --- | --- |
| DKIM (also verifies the domain) | CNAME × 3 | The `<token>._domainkey.<domain>` that SES issued | The value SES issued |
| MAIL FROM (optional) | MX × 1 | `bounce.<domain>` | `10 feedback-smtp.ap-northeast-1.amazonses.com` |
| SPF (if MAIL FROM is set) | TXT | `bounce.<domain>` | `"v=spf1 include:amazonses.com ~all"` |
| DMARC | TXT | `_dmarc.<domain>` | `"v=DMARC1; p=none; rua=mailto:<where reports go>"` |

Three cautions.

- The DKIM record names contain `_domainkey`, a part that starts with an underscore. Some DNS services append the domain name for you. Compare with the printed name so that it doesn't end up there twice
- The MAIL FROM domain gets exactly one MX record. And that subdomain must be one you use neither to send nor to receive mail
- Start DMARC at `p=none` (do nothing, just receive reports). Read the reports, confirm that legitimate mail is passing, and only then tighten to `quarantine`, then `reject`. Go straight to `reject` with a mistake in your setup, and all of your own mail gets refused

If the domain already has a DMARC record, don't overwrite it. Check the current policy first.

```bash
dig TXT _dmarc.your-domain.example
aws sesv2 get-email-identity --email-identity your-domain.example --region ap-northeast-1
```

In the second, once `DkimAttributes.Status` is `SUCCESS`, DKIM verification is done. DNS changes can take up to 72 hours to be picked up.

If you use Route 53, the SES console has a feature that creates the DKIM records for you. This chapter's stack doesn't use it. The point is for you to see the records with your own eyes once.

## Leaving the sandbox

<!-- section: 15.production -->

To send to anyone other than verified recipients, you request production access. The request is reviewed by people at AWS Support. A stack can't submit it, and submitting it doesn't guarantee approval.

In the console, choose "Request production access" from the SES Account dashboard. This is all you fill in.

- **Mail type**: Transactional (sent one at a time, triggered by something a user did) or Marketing (promotional, sent to many). A share notification is Transactional
- **Website URL**: to help them understand what you'll send
- **Additional contacts**: addresses that receive communications about your account. Up to four
- **Preferred contact language**: English or Japanese
- **Acknowledgement**: that you send only to people who explicitly asked for it, and that you have a process for handling bounces and complaints

That last item is what you built in this chapter.

The same request can be made from the CLI.

```bash
aws sesv2 put-account-details --region ap-northeast-1 \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://your-domain.example \
  --additional-contact-email-addresses you@your-domain.example \
  --contact-language JA
```

According to the official documentation, the first response comes within 24 hours. If they ask for more information, it takes longer. While the review is open, you can't edit the request.

The documentation recommends verifying a domain before you apply. You see the result with the same command as before.

```bash
aws sesv2 get-account --region ap-northeast-1
```

Once `ProductionAccessEnabled` is `true`, you're out of the sandbox. Sender identities still have to be verified out there. Your daily and per-second limits are in `SendQuota`.

### Cognito's email leads here too

Chapter 06 said that Cognito's default email sending is for small volumes. The official documentation, too, says the default configuration's daily limit is below what a typical production environment needs. When your users grow in number, you switch the user pool's settings so that it sends from an SES identity in your account.

What that takes is the two things from this chapter: a verified identity, and being out of the sandbox. Stay inside the sandbox, and Cognito can't email your users.

## If you're coming from Workers

<!-- section: 15.cloudflare -->

Cloudflare has an Email Service, and a Worker can send mail through a binding: put `send_email` in the configuration and call `env.EMAIL.send(...)`. According to the official documentation, the sending feature is in beta and requires the Workers Paid plan.

The AWS side, as you've seen, has more parts. An identity, a configuration set, a topic, functions, roles, a table. There's no binding: you call through the SDK and narrow permissions with IAM.

To be honest, that's as far as the comparison goes. On the Cloudflare side, only the overview page was read. Domain onboarding, DNS setup, how bounces are received, limits, and prices are unchecked.

One thing is the same whichever you use: the heart of this chapter, "record first, or send first?". Unless the sending API recognizes a repeated request for you, the record that prevents duplicates is yours to keep.

## The money part

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which you send nothing costs 0.** The SES identity and configuration set, the SNS topic, the functions, and the API cost nothing for merely being there. Storage for the records left in the table is 0 at 10 MB (the first 25 GB of DynamoDB storage is a USD 0 tier).

Once you send, it looks like this. The assumptions: 10,000 messages a month, one recipient each, no attachments, 1,000 repeated requests, and one event arriving per message.

| Item | Quantity | List price | After monthly free allowances |
| --- | --- | --- | --- |
| SES sending | 10,000 messages | 1.00 | 1.00 (no allowance confirmed, none deducted) |
| API Gateway HTTP API requests | 11,000 | 0.01 | 0.01 (same) |
| Lambda (requests and duration) | 21,000 requests, 950 GB-seconds | 0.02 | 0 |
| SNS (publishes and deliveries to Lambda) | 10,000 each | 0 | 0 |
| DynamoDB (writes, reads, storage) | 31,000 WRU, 6,500 RRU | 0.02 | 0.02 |
| CloudWatch Logs | 0.01 GB | 0.01 | 0 |
| Subtotal | | **1.06** | **1.04** |

Nearly all of it is the SES sending charge: USD 0.0001 per message, which is USD 0.10 per 1,000. According to the pricing page, it's counted per recipient. Attachments add USD 0.12 per GB.

SNS is 0 because, in the price list, the first 1,000,000 requests are a USD 0 tier and deliveries to Lambda are free.

The SES free allowance is treated as unknown. What the pricing page has is a description of credits for people new to AWS (up to USD 200, to be used within 12 months of creating the account). There was no statement of "this many messages free each month" to be found. Check the terms that apply to your account in the Billing console.

Some things aren't in this table: data transfer out to the internet, dedicated IPs (USD 24.95 a month each), and Virtual Deliverability Manager. None of them is used in this chapter's setup. The function durations (300 ms to send, 50 ms per event) are assumptions too, not measurements.

Delete the stack, and this chapter's charges stop.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:mail` stops with `Invalid environment` | Does `examples/15-email/.env` exist? Is it `MAIL_MODE=local`? |
| `mail:send` fails with a response that isn't in this book's error shape (`error.code`) | API Gateway is rejecting it before the function is invoked. Use `vp run account:whoami` to check that your current credentials belong to the same account as the stack. Calling the API takes `execute-api` permission |
| You get `send_rejected` | SES said no. Look at `reason` with `vp run mail:logs`. It's most often one of: the identity isn't verified, an unverified recipient while in the sandbox, or the rate limit |
| The `reason` in the log is a permission error (`AccessDenied` or similar) | The sending role's policy is missing something. Compare the resource ARN in the error with the policy in the stack |
| You get `send_unknown` | SES gave no answer. Nothing more will be sent for that `notificationId`. Check the state with `mail:status`, and if it doesn't move to `delivered`, decide whether to send again under a new `notificationId` |
| It was sent, but the state stays `sent` | Events aren't arriving. Check `vp run mail:logs --events`. Is the configuration set named when sending? |
| The event function's log says `unreadable SES event dropped` | An SES event doesn't match the schema. Compare the field named in `problem` with `src/events.ts` |
| The verification email doesn't arrive | Check the spam folder. The link expires after 24 hours. If it has, resend from the SES console |
| The domain still isn't verified after 72 hours | Is the domain doubled in the CNAME name? Check with `dig CNAME <the printed name>` |
| The second mail to a simulator address is `suppressed` | The first bounce put it in this chapter's table. Use an address with a `+` label, or delete it from the table |

`send_rejected` and `send_unknown` are both status 502. The difference is "if I make the same request again, will it be sent?". Tell them apart by `code`.

## If you take this to production

- **Narrow who can call it.** IAM authorization narrows callers only to "anyone with `execute-api` permission". Give that permission to the role of the code that sends notifications, and to nothing else
- **Put a queue in front of the API.** It decouples callers from SES being slow, and lets you wait and retry when you hit the rate limit ([chapter 08](/en/chapters/08-async.md))
- **Prepare for missed events.** An event the function fails on all three times is discarded by Lambda. Give the function a dead-letter queue or an on-failure destination so that it's kept (for the thinking behind a dead-letter queue, see [chapter 08](/en/chapters/08-async.md); there it is attached to an SQS queue)
- **Watch the number of bounces and complaints.** When there's a problem with your reputation as a sender, SES puts the account under review (`PROBATION`) or pauses sending (`SHUTDOWN`). The current state is in `EnforcementStatus` from `aws sesv2 get-account`. Alarm on it, together with the log of unreadable events (for how to put an alarm together, see [chapter 19](/en/chapters/19-observability.md))
- **Pick up records stuck at `claimed`.** You need a routine that lists the records that haven't moved after some time, and decides whether to send again
- **Protect the table.** Set `removalPolicy` to `RETAIN` and turn on point-in-time recovery. Lose the suppression list, and you'll be mailing bounced addresses again
- **Encrypt the topic.** Events contain recipients' email addresses. This chapter's topic only enforces encryption in transit (HTTPS). What encryption at rest requires is unchecked
- **Tighten DMARC.** `p=none` is a starting point
- **Provide a way to unsubscribe.** If you send promotional mail, recipients need a way to stop it themselves. This chapter's notification is out of scope, but think about it before you start sending another kind of mail through the same machinery
- **Route changes through the AWS CDK CLI and CloudFormation.** As discussed in chapter 02

## Cleaning up

<!-- section: 15.cleanup -->

```bash
vp run mail:infra:destroy
```

That deletes the identity, the configuration set, the topic, both functions and their roles, the API, the table, and the log groups. The records in the table and the suppression list go with them.

Three things remain.

- **Addresses on SES's account-level suppression list.** They belong to the account and the Region, and stay regardless of the stack. `aws sesv2 list-suppressed-destinations --region ap-northeast-1` shows them
- **Production access and your sending limits.** They're a state of the account, and deleting the stack doesn't change them
- **The records you put in DNS.** Delete those yourself. Leaving the DKIM CNAMEs does no harm, but do remove a MAIL FROM MX and SPF that you no longer use

The storage created by cdkd's bootstrap (chapter 02), and the deployment files placed in it, also remain.

::: details Verification notes for this chapter

**Checked locally.** The unit tests (assembling the email and refusing header injection, record-first sending, fault injection at eight points, simultaneous requests, validation of SES events with duplicates and reordering, inspection of the requests sent to DynamoDB and SES, and infrastructure assertions). Type checking. Synth (including the esbuild bundle; 25 resources). Starting `dev:mail` and running the `curl` commands from the text. That the part which builds signed requests adds an `Authorization` header, checked with fake credentials and a local server.

**Not checked yet.** This chapter never called SES. `mail:infra:deploy`, `mail:send`, `mail:status`, `mail:dns`, `mail:logs`, `mail:infra:drift`, `mail:infra:destroy`, and the `aws sesv2` commands in the text have not been run against real AWS. In particular, the following are still waiting to be confirmed in a real environment.

- That `SendEmail` passes under the sending role's policy (the two resources, identity and configuration set, and the `ses:FromAddress` condition). There are reports that, in the sandbox, permission on the recipient's identity is needed as well, but that couldn't be confirmed from a primary source
- That, with only the domain verified, mail can be sent from an address in that domain while naming a configuration set. The official documentation has a passage that can be read as saying an address which inherits verification from its domain can't be "used with configuration sets". The stack also makes the configuration set the identity's default
- That real events have the same shape as the fixtures. Delivery from SNS to the function. How the configuration set's suppression behaves
- That DynamoDB's conditional write lets exactly one of several simultaneous requests through. Only the expression sent, and the in-memory implementation following the same rule, were checked
- That cdkd can create the three SES resource types through Cloud Control API, detect drift on them, and delete them
- What SES does with a subject or a recipient containing a line break
- The production access request screen, and how long the review takes. The items in the text are what the official documentation describes

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Build the email first | `examples/15-email/src/contract.ts`, `src/message.ts`, `test/message.test.ts` | `test:unit` |
| Make the sending part swappable | `examples/15-email/src/mailer.ts`, `src/ses-mailer.ts`, `src/compose.ts`, `test/ses-mailer.test.ts` | `test:unit` |
| Record first, or send first? | `examples/15-email/src/notify.ts`, `src/store.ts`, `src/memory-store.ts`, `src/dynamodb-store.ts`, `test/dynamodb-store.test.ts` | `test:unit` |
| Break it to check it | `examples/15-email/test/notify.test.ts`, `test/setup.ts` | `test:unit` |
| Run it locally | `examples/15-email/src/dev.ts`, `src/app.ts`, `src/env.ts`, `test/app.test.ts`, `test/env.test.ts`, `.env.example` | `dev:mail`, `test:unit` |
| Cleaning up after mail that didn't arrive | `examples/15-email/src/events.ts`, `src/events-lambda.ts`, `test/events.test.ts`, `test/fixtures/` | `test:unit`, `dev:mail` |
| Getting it ready for AWS | `examples/15-email/infra/lib/email-stack.ts`, `infra/bin/app.ts`, `infra/test/email-stack.test.ts`, `cdk.json` | `mail:infra:synth`, `test:unit` |
| The sandbox and identities | `examples/15-email/infra/lib/email-stack.ts`, `infra/bin/app.ts` | `mail:infra:diff`, `mail:infra:deploy` |
| Send through the deployed API | `examples/15-email/scripts/send.ts`, `scripts/status.ts`, `scripts/signed-fetch.ts`, `scripts/logs.ts`, `src/lambda.ts` | `mail:send`, `mail:status`, `mail:logs`, `mail:infra:drift` |
| Sending from your own domain | `examples/15-email/src/dns.ts`, `scripts/dns.ts`, `test/dns.test.ts` | `mail:dns`, `test:unit` |
| Cleaning up | `tools/src/infra/` | `mail:infra:destroy` |
| The money part | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [Using the Amazon SES account-level suppression list](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html)
- [How email sending works in Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-process.html)
- SES API v2: [SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html), [MessageTag](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageTag.html), [GetAccount](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html), [GetEmailIdentity](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailIdentity.html)
- [Monitor email sending using Amazon SES event publishing](https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html), [event contents](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html), [event examples](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html), [SNS event destination](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html)
- [Creating and verifying identities](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [Easy DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html), [Using a custom MAIL FROM domain](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html), [DMARC](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html)
- [Mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html)
- [AWS Service Reference: SES](https://servicereference.us-east-1.amazonaws.com/v1/ses/ses.json)
- [Amazon SES pricing](https://aws.amazon.com/ses/pricing/)
- AWS Price List bulk API: [SES](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/ap-northeast-1/index.json), [SNS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json)
- [Invoking Lambda functions with Amazon SNS notifications](https://docs.aws.amazon.com/lambda/latest/dg/with-sns.html), [How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html), [Amazon SNS message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [AWS SDKs and Tools: Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)
- [IAM authorization for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)
- [Using time to live (TTL) in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [Email settings for Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) (overview page only)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
