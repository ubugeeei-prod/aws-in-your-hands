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
