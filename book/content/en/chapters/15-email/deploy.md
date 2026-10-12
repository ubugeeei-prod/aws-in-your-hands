---
title: "15 Email: Deploy"
---

# 15 Email: Deploy

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

The same block throttles the stage. `defaultRouteSettings` applies to every route of the default stage: 10 requests a second, with a burst of 20. A test checks that the template carries these values too. In the source of the pinned cdkd, the stage implementation passes this setting straight to the AWS API. Reading is all I did. Whether it takes effect is unknown until someone deploys and looks.

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
