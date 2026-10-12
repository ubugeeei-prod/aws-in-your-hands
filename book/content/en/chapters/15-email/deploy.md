---
title: "15 Email: Deploy"
---

# 15 Email: Deploy

## Getting it ready for AWS

<!-- section: 15.infra -->

From here you put the API you [ran locally](/en/chapters/15-email/local.md) onto AWS. This page first goes through the CDK stack part by part, and then covers verifying the SES sender, sending, setting up your own domain, and the request you need for production sending.

### Where records live

<<< @/examples/15-email/infra/lib/email-stack.ts{table}

One table holds both the notification records and the suppression list, and the start of the key (`NOTIFICATION#`, `SUPPRESSION#`) tells them apart. Both are only ever read one item at a time by key, so there is no need for two tables.

### The configuration set, and where events go

<<< @/examples/15-email/infra/lib/email-stack.ts{configuration-set}

A configuration set is a group of settings that you select by name when sending. The event destination belongs to the configuration set, so if you forget to name it when sending, not a single event arrives.

`addEventDestination` also adds a policy to the topic that lets SES publish, and only for this configuration set's events. A test checks that SES is the only principal allowed to publish to the topic.

### The sender

<<< @/examples/15-email/infra/lib/email-stack.ts{identity}

An identity is a sender that SES has verified as yours, either one email address or a whole domain.

**The stack only starts the verification.** For an address, a verification email arrives at that address and you open the link in it. For a domain, you put records in DNS. A person does both, and even after a successful deploy you cannot send until verification is complete.

### What the sending function may do

<<< @/examples/15-email/infra/lib/email-stack.ts{send-role}

Allowing `ses:SendEmail` and nothing more would let the function send from any identity in the account, so three conditions narrow it. The function may use only this identity, and it may send only through this configuration set. It may also send only as `fromAddress`. Verifying a domain makes every address in that domain usable as a sender, which is why this last condition is needed.

Whether `SendEmail` actually passes under this policy has not been confirmed yet. If a permission is missing, the first send fails with `AccessDenied`. If that happens, look at the resource ARN the error names.

### What the event function may do

<<< @/examples/15-email/infra/lib/email-stack.ts{events-role}

The function that records events cannot send mail and cannot read the table. Writing is all it can do. It processes data that arrives from outside, so it is given as few permissions as possible.

### The entrance

<<< @/examples/15-email/infra/lib/email-stack.ts{api}

On a route with `HttpIamAuthorizer`, API Gateway rejects a request that is not signed, and the function is never invoked. A test checks that all three routes are `AWS_IAM`.

The same block throttles the stage. `defaultRouteSettings` applies to every route of the default stage, and it is set to 10 requests a second with a burst of 20. A test checks that the template carries these values too. In the source of the pinned cdkd, the stage implementation passes this setting straight to the AWS API. That source was read and nothing more, so whether the throttle takes effect is unknown until someone deploys and checks.

### cdkd and this stack

This stack uses three SES resource types (`AWS::SES::EmailIdentity`, `AWS::SES::ConfigurationSet`, `AWS::SES::ConfigurationSetEventDestination`). According to the source of the pinned cdkd (0.296.28), none of the three has a dedicated implementation. Resource types without one are created through Cloud Control API, a general-purpose AWS API. SNS, DynamoDB, Lambda, IAM, API Gateway, and logs do have dedicated implementations.

The Cloud Control API path has not been run even once in this book yet.

```bash
vp run mail:infra:synth
```

Synth runs entirely on your machine and makes no call to AWS.

## The sandbox and identities

<!-- section: 15.identity -->

Before you deploy, you need to know about the SES sandbox.

SES in a new account starts out in a state called the sandbox. The sandbox is per Region, so after you leave it in Tokyo you are still in it in every other Region. While you are in the sandbox, these limits apply.

- You can send only to verified addresses and domains, and to the SES mailbox simulator
- At most 200 messages per 24 hours
- At most 1 message per second

The limit that matters most is the one on recipients, because it means you cannot mail strangers. You can still mail yourself without a domain of your own, as long as you verify your own address. That is enough for trying this chapter.

There are two ways to verify a sender.

| | Verify an email address | Verify a domain |
| --- | --- | --- |
| What you need | An address that can receive mail | A domain whose DNS you can edit |
| How it's verified | Follow the link in the email you receive (valid for 24 hours) | Publish three DKIM CNAME records (detection can take up to 72 hours) |
| What you can send as | That address only | Every address in the domain |
| Good for | Trying this chapter | Production |

Do not use a free-mail address as your sender outside the sandbox. The DNS of a free-mail domain is not yours, so you cannot set up the SPF, DKIM, and DMARC that the section on sending from your own domain covers.

### Deploy, then verify

To try it with your own address, run these.

```bash
vp run mail:infra:diff -c fromAddress=you@your-domain.example
vp run mail:infra:deploy -c fromAddress=you@your-domain.example
```

Without `fromAddress`, the stack is created with `notes@example.com`, an address that belongs to nobody. That default exists so that synth works, so always pass your own address when deploying.

When the deploy finishes, a verification email arrives from `no-reply-aws@amazon.com`. Open the link in it. These commands show whether verification is done.

```bash
aws sesv2 get-email-identity --email-identity you@your-domain.example --region ap-northeast-1
aws sesv2 get-account --region ap-northeast-1
```

If `VerifiedForSendingStatus` in the first command's output is `true`, the address is verified. Addresses are case-sensitive, so use the exact spelling you verified.

If `ProductionAccessEnabled` in the second command's output is `false`, you are in the sandbox. `SendQuota` shows the 24-hour limit and how many messages you have sent in the last 24 hours.

## Send through the deployed API

<!-- section: 15.deploy -->

Once verification is done, send an email. The task below sends a real email, and it is billed (USD 0.0001 per message).

```bash
vp run mail:send --to you@your-domain.example
```

The task makes the request twice with the same `notificationId` and checks that the second is a `duplicate`. One email should land in your inbox.

A plain `fetch` cannot call an API that requires IAM authorization, so the task signs the request with your credentials.

<<< @/examples/15-email/scripts/signed-fetch.ts{signed-fetch}

These commands show what became of the notification.

```bash
vp run mail:status --id <notificationId>
vp run mail:logs --events --follow
```

After a while, `sent` should turn into `delivered`.

### Cause a bounce and a complaint

You cannot produce a bounce or a complaint with your own address. SES provides recipient addresses for that purpose, called the mailbox simulator, and they work inside the sandbox too.

```bash
vp run mail:send --to success@simulator.amazonses.com
vp run mail:send --to bounce@simulator.amazonses.com
vp run mail:send --to complaint@simulator.amazonses.com
```

`bounce@` returns a permanent bounce and `complaint@` a complaint. When the event arrives, this chapter's function puts that address in the table, so a second `mail:send` to the same address is `suppressed`. To try again, use an address with a label after a `+`, such as `bounce+1@simulator.amazonses.com`.

Mail to the simulator counts toward neither your daily sending quota nor your bounce and complaint rates. It is billed the same as any other mail.

Drift checking is the same as in the other chapters.

```bash
vp run mail:infra:drift
```

The commands in this section and the previous one have not been run against real AWS even once. Whether events arrive in the same shape as the fixtures, and how long `sent` takes to become `delivered`, will be added here once known.

## Sending from your own domain: SPF, DKIM, DMARC

<!-- section: 15.dns -->

To mail people you do not know, you need a domain. The receiving mail server tries to establish whether the mail really was sent by the owner of the domain, and it files mail that fails that check as spam or refuses it.

Three mechanisms do the checking, and all of them work through records in DNS.

SPF is a list of the servers allowed to send in a domain's name. It is not checked against the From address that recipients see, but against the domain of the envelope sender (MAIL FROM). With nothing configured, SES uses a subdomain of `amazonses.com` as MAIL FROM. SPF passes in that case too, but what it confirmed is `amazonses.com`, which says nothing about your domain.

DKIM puts a digital signature on the mail, and the public key for verifying it goes in DNS. With SES's Easy DKIM, SES makes the key and signs the mail. All you publish is three CNAME records that point to where the key is. SES also treats finding those three records as the verification of your domain.

DMARC ties SPF and DKIM to the From domain. It requires that the From domain be confirmed by either SPF or DKIM, and it lets the domain's owner declare what should happen to mail that fails both.

When you send through SES, DKIM is the least work. Once Easy DKIM is set up on your From domain, DMARC passes on the DKIM side. To pass on the SPF side as well, make MAIL FROM a subdomain of your own domain (for example `bounce.your-domain.example`).

To create the stack with a domain, run this.

```bash
vp run mail:infra:deploy -c fromAddress=notes@your-domain.example -c senderIdentity=your-domain.example
```

To put MAIL FROM on your own domain as well, add `-c mailFromDomain=bounce.your-domain.example`.

The following task prints the records you need to publish.

```bash
vp run mail:dns --report dmarc@your-domain.example
```

This function assembles the records.

<<< @/examples/15-email/src/dns.ts{dns}

The task only prints. Creating the records in DNS is not automated. Whether you use Route 53 or another DNS service, enter the names and values exactly as printed, in its console or CLI. The table below lists everything you publish.

| What for | Type | Name | Value |
| --- | --- | --- | --- |
| DKIM (also verifies the domain) | CNAME × 3 | The `<token>._domainkey.<domain>` that SES issued | The value SES issued |
| MAIL FROM (optional) | MX × 1 | `bounce.<domain>` | `10 feedback-smtp.ap-northeast-1.amazonses.com` |
| SPF (if MAIL FROM is set) | TXT | `bounce.<domain>` | `"v=spf1 include:amazonses.com ~all"` |
| DMARC | TXT | `_dmarc.<domain>` | `"v=DMARC1; p=none; rua=mailto:<where reports go>"` |

Watch for three things when you publish the records.

- The DKIM record names contain `_domainkey`, a part that starts with an underscore. Some DNS services append the domain name for you, so compare the result with the printed name to make sure the domain is not there twice
- The MAIL FROM domain gets exactly one MX record. Choose a subdomain that you use neither to send nor to receive mail
- Start DMARC at `p=none` (do nothing, and receive reports). Read the reports, confirm that legitimate mail is passing, and then tighten to `quarantine` and after that to `reject`. If you start at `reject` and your setup has a mistake, all of your own mail is refused

If the domain already has a DMARC record, do not overwrite it. Check the current policy first.

```bash
dig TXT _dmarc.your-domain.example
aws sesv2 get-email-identity --email-identity your-domain.example --region ap-northeast-1
```

Once `DkimAttributes.Status` in the second command's output is `SUCCESS`, DKIM verification is done. DNS changes can take up to 72 hours to be picked up.

If you use Route 53, the SES console has a feature that creates the DKIM records for you. This chapter's stack does not use it, so that you see the records with your own eyes once.

## Leaving the sandbox

<!-- section: 15.production -->

To send to anyone other than verified recipients, you request production access. People at AWS Support review the request, so a stack cannot submit it, and submitting it does not guarantee approval.

In the console, choose "Request production access" from the SES Account dashboard. You fill in five items.

- Mail type: Transactional (sent one at a time, triggered by something a user did) or Marketing (promotional, sent to many). A share notification is Transactional
- Website URL: it helps the reviewers understand what you will send
- Additional contacts: addresses that receive communications about your account. Up to four
- Preferred contact language: English or Japanese
- Acknowledgement: that you send only to people who explicitly asked for it, and that you have a process for handling bounces and complaints

The process that the last item asks about is what you built in this chapter.

The same request can be made from the CLI.

```bash
aws sesv2 put-account-details --region ap-northeast-1 \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://your-domain.example \
  --additional-contact-email-addresses you@your-domain.example \
  --contact-language JA
```

According to the official documentation, the first response comes within 24 hours. If AWS asks for more information, it takes longer. While the review is open, you cannot edit the request.

The documentation recommends verifying a domain before you apply. You see the result with the same command you used to check whether you were in the sandbox.

```bash
aws sesv2 get-account --region ap-northeast-1
```

Once `ProductionAccessEnabled` is `true`, you are out of the sandbox. Sender identities still have to be verified after you leave it. Your daily and per-second limits are in `SendQuota`.

### Cognito's email leads here too

Chapter 06 said that Cognito's default email sending is for small volumes. The official documentation also says the default configuration's daily limit is below what a typical production environment needs. When you have more users, you change the user pool's settings so that it sends from an SES identity in your account.

That change needs the two things this chapter set up, a verified identity and an account that is out of the sandbox. While you are inside the sandbox, Cognito cannot email your users.
