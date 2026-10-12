---
title: "15 Email: SES"
sourceRevision: 3
---

# 15 Email: SES

In this chapter you put a second API next to the one from chapter 04. It sends one notification email that says someone shared a note with you, and it sends it through Amazon SES.

Calling the send API does not finish the job with email. The address may not exist, the recipient may report the message as spam, and sometimes the sender cannot tell whether the message went out at all. This chapter builds the part that receives those outcomes and records them. To run it locally you need neither an AWS account nor a real email address.

Three things to know before you start.

- The prerequisite is [chapter 04](/en/chapters/04-http-api.md). Records are kept in DynamoDB, and this chapter explains what you need to know about it (the details are in [chapter 05](/en/chapters/05-dynamodb.md))
- The outline placed this chapter behind the queue of [chapter 08](/en/chapters/08-async.md), but it ended up as a recipe that works on its own. The text points out where a queue would connect
- Running it in AWS sends real mail. Verifying the sender, setting up DNS, and requesting that the sending limits be lifted are jobs a person does by hand. This chapter gives you the steps and the commands, and it does not do them for you

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

The figure shows two paths. The sending path runs from the caller through the API and the function to SES. The path the outcome takes runs from SES through SNS back to the table.

The caller gives each notification a name of its own (`notificationId`) and asks the API to send it. The function first records in DynamoDB that this notification is its to send, and then hands the mail to SES. SES takes the mail and tries to deliver it to the recipient's mail server.

SES tells you later whether the mail arrived, came back (a bounce), or was reported as spam (a complaint). That news travels through an SNS topic to a second function, which writes the list of addresses you will no longer mail (the suppression list) and the state of each notification to the table.

The table is the only place in this design that holds state. As you saw in chapter 04, nothing can live in a function's memory.

### Don't leave the door open

Anyone who knew the URL could call the API in chapter 04. An API that sends mail and is open in the same way becomes a relay that strangers use to mail any address they like.

Every route in this chapter therefore requires IAM authorization, which means the caller has to sign the request with AWS credentials (SigV4). The code that sends a notification is the code that shared the note, which is another backend, so nothing in a browser is meant to call this API and CORS is not configured.

Authorized callers have one brake on them as well. Throttling on the stage holds the whole API to 10 requests a second with a burst of up to 20. If a script that has the permission gets stuck in a loop, API Gateway refuses everything past that limit with 429, and neither the function nor SES is called.

`GET /share-notifications/{id}` returns the recipient's address along with the notification's state. The ID is a string the caller chose, so anyone who is allowed to call this API and who knows or can guess an ID can read whom that notification went to. The chapter does this on the assumption that the only caller is the backend that sent the notification. If you have more than one caller, change the route so that it does not return the recipient.

The JWT authorizer from [chapter 06](/en/chapters/06-auth.md) is another option. If you use it, have the server decide the recipient. As long as the caller names the recipient, anyone who is signed in can mail anyone.

### Other shapes this could take

- **Send from a queue, with no API.** The sharing code puts a message on a queue, and a function takes it off and sends. The caller no longer waits when SES is slow or fails. [Chapter 08](/en/chapters/08-async.md) shows how to build the queue and the worker. `sendShareNotification` in this chapter is written so that it can sit behind a queue as it is
- **Put a queue between SNS and the function.** Passing events through a queue, not straight from SNS to Lambda, lets you keep the events that failed to process. Chapter 08 covers this too
- You can also choose not to use SES. If you would rather not manage your sender reputation or request a limit increase yourself, an email SaaS is easier in some situations. SES is cheap and is managed with the same permissions as the rest of AWS, but it comes with the verification and request work on the [deploy page](/en/chapters/15-email/deploy.md)

## Build the email first

<!-- section: 15.message -->

Before any AWS, you build the email itself. A request to the API has this shape.

<<< @/examples/15-email/src/contract.ts{request}

A request names exactly one recipient. It carries the note's ID and no link URL, and the server builds the URL from its own configuration. If the caller could pass a URL, this API would be a tool for sending mail from your domain with a link to anywhere.

### Keep line breaks out of the headers

An email is text. Headers such as `Subject: ...` and `To: ...` come first, one per line, and the body follows. If a string that goes into the subject contains a line break, whatever comes after the break may be read as the next header.

Users write note titles. A title of `Trip plan\r\nBcc: attacker@example.com`, placed in the subject as it is, adds a `Bcc` header. This attack is called header injection.

<<< @/examples/15-email/src/contract.ts{header-safe}

A title or a name that contains a line break or a control character is refused. The schema does not strip the characters silently, because the caller should hear that such input arrived. The recipient passes only if it reads as one address. A comma-separated list does not pass, and neither does the `Name <address>` form.

A pure function assembles the email.

<<< @/examples/15-email/src/message.ts{build}

This function checks again the values that the schema checked on the way in. If someone later writes code that calls it without going through the schema, a line break still does not reach a header.

What SES does with such a line break has not been checked. With the way this chapter sends (the `Simple` format, described below), SES assembles the headers and this code writes none of them. Refusing the input on your own side first still means you do not depend on how SES behaves.

The HTML body has a hole of its own. A title that contains `<script>` or `<a href=...>` would be interpreted as HTML.

<<< @/examples/15-email/src/message.ts{escape}

Every string a user wrote goes through this function before it is placed in HTML. The tests pass in a title with a line break, a list of recipients, and a name containing `<script>`, one at a time.

## Make the sending part swappable

<!-- section: 15.adapters -->

Chapter 04 put note storage behind an interface, and this chapter does the same for sending mail.

<<< @/examples/15-email/src/mailer.ts{mailer}

A send has three possible outcomes.

- `accepted`: the provider took the message
- `rejected`: the provider said no. Nothing was sent
- an exception: nobody knows what happened

The design depends on never treating an exception as a `rejected`. The next section uses that difference to decide whether a resend is allowed.

Locally you use an implementation that sends nothing.

<<< @/examples/15-email/src/mailer.ts{outbox}

Mail that would have been sent collects in an array. The dev server and the tests use this implementation.

The implementation that calls SES looks like this.

<<< @/examples/15-email/src/ses-mailer.ts{ses}

It calls `SendEmail` from the SES API v2. With the `Simple` format you pass a subject and a body, and SES turns them into an email.

Errors are read in two ways. A 4xx answer means SES read the request and refused it, so the result is `rejected`. Anything else (a timeout, a dropped connection, a 5xx) leaves you unable to tell whether SES took the message, so the error is thrown on as an exception.

An environment variable decides which implementation is used.

<<< @/examples/15-email/src/compose.ts{adapters}

`maxAttempts: 1` is there for a reason. Unless you say otherwise, the AWS SDK retries on timeouts and 5xx errors (three attempts in total by default). That usually helps, but when sending mail, if the first attempt did reach SES, the SDK's retry sends a second email and your records show nothing about it. Whether to retry is decided by the mechanism in the next section.

## Record first, or send first

<!-- section: 15.order -->

This section is the center of the chapter.

SES's `SendEmail` has no mechanism for ignoring the second copy of the same request (an idempotency token). If you send the same content twice, two emails arrive.

The send API returning success is also a different event from the email arriving. Success means only that SES took the message. In the other direction, a missing response does not mean nothing was sent. The SES documentation itself says that, on rare occasions, a send request returns an error even though the email was accepted.

A caller that lost the response normally retries. What happens then depends on whether you record first or send first, and the next three figures compare the two.

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

If you send first, a failure can deliver two emails. If you record first, a failure can deliver none. You cannot rule out both, because recording and sending are separate calls to separate services and nobody can prevent the process from stopping between them.

This chapter **records first**. The invariant it protects is this one.

> No `notificationId` ever causes more than one email to be sent.

If a share notification does not arrive, the person who shared the note can simply tell the recipient. The same notification arriving two or three times is the bigger nuisance for the person receiving it. Repeated mail invites complaints, and complaints damage your reputation as a sender. For mail such as a password reset, where the user is stuck until it arrives, sending first can be the right choice. In that case you need something else, such as wording that lets the recipient recognize a duplicate.

<<< @/examples/15-email/src/notify.ts{notify}

Idempotency rests on `claim`, in step 1. The function takes the record that says this notification is its to send before it sends anything. If it cannot take the record, another request already holds it, and nothing is sent.

### Claim in a single operation

If you read whether a record exists and then write one when it does not, as two operations, two requests that arrive together both read "no" and both write.

DynamoDB lets you attach a condition to a write. It checks the condition and writes as one operation, so only one of the requests that arrive together gets through.

<<< @/examples/15-email/src/dynamodb-store.ts{claim}

The condition is that there is no record yet, or that the last attempt was refused and this is the same email. "The states of a notification", below, explains why the second part is needed.

### The states of a notification

Each record holds one state.

```figure
caption: A notification starts with a claim and moves on with what SES answers and the events that arrive later (the usual order; Delivery and Complaint also apply from other states)
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

The first figure draws the usual order. Events arrive late and out of order, so the code accepts other moves too. A Delivery moves a record to `delivered` from `claimed`, `rejected` or `sent`. A Complaint works like a Bounce: it moves a record to `complained` from `claimed`, `rejected`, `sent` or `delivered`.

Each of the three outcomes of `mailer` leads to a different state.

When SES took the message (`accepted`), the record becomes `sent` and stores the message ID that SES returned. If that write fails, the caller still gets a success. The email is already out, and reporting a failure at this point would tell the caller that it was not sent.

When SES refused (`rejected`), the record becomes `rejected`. Nothing went out, so making the same request again claims the notification again and sends it. The second part of the claim condition exists to let that retry through. Hitting the sending rate limit is a case of this.

When the outcome is unknown (an exception), the function does nothing. The record stays `claimed`, and that record is what blocks a resend. A function that dies partway, or that the Lambda timeout cuts off, leaves the same state.

A record stuck at `claimed` is the price of recording first. It stands for a notification that may or may not have been sent. The code in this chapter does not resend such a notification automatically. If a Delivery event arrives later, the record moves to `delivered` and you know the mail went out. If no event arrives, a person looks at the record and decides.

`rejected` has a small hole left in it as well. When SES returns an error but did accept the mail, the retry produces a second email. If the Delivery event arrives first, the record moves to `delivered` and the retry is stopped. A retry that comes before the event cannot be stopped. Closing this hole means treating every error as "unknown" and never retrying automatically.

### Same name, different email

A request with the same `notificationId` but a different recipient or title is a bug in the caller, not a retry. The record carries a hash of the email's content, and a request whose hash differs gets a 409. Answering "already sent" would claim that an email went out when it never did.

### How long records are kept

If claim records were never deleted, the table would only grow. Each record therefore carries an expiry time (30 days later by default), and DynamoDB's TTL deletes records that are past it. If the same `notificationId` arrives after the record is gone, it is sent as a new notification. Two requests count as the same notification for 30 days.

An expired record is not deleted right away. According to the official documentation, deletion typically happens within a few days, and until then the record can still be read. For this chapter's purpose, a record that stays longer does no harm.

## Break it to check it

<!-- section: 15.faults -->

Once the invariant is written down, it gets tests that try to break it.

```bash
vp run test:unit
```

Start by listing every place the flow can stop. There are four of them, which are checking the recipient, claiming, sending, and recording after the send. Each can fail in two ways, either before the call ran, or after it ran with only the response lost.

<<< @/examples/15-email/test/setup.ts{faults}

For each of those eight cases, the test makes the first request fail, makes the same request twice more, and then counts the emails that were sent.

<<< @/examples/15-email/test/notify.test.ts{fault-table}

Every row is 1 or less, and no row is 2.

Two rows are 0. In one, the claim was written but its response was lost. In the other, the send call failed before it reached SES. In both, only the record is left and no email went out. This is the price of recording first that the third sequence figure drew, now showing up as a number.

For comparison, there is a test of the opposite order too.

<<< @/examples/15-email/test/notify.test.ts{send-first}

When you send first, losing one response is enough to produce two emails. That test expects the 2.

Other tests check that five simultaneous copies of a request send once, that a refused send can be retried, and that a notification which was supposedly refused is not sent again once a Delivery event has arrived for it.

These tests run against the in-memory implementation, however. Whether DynamoDB's conditional write really lets only one of several simultaneous requests through has not been checked against the real service. What has been checked is that the request sent to DynamoDB carries the right condition, and no more than that.
