---
title: "15 Email: Costs, Pitfalls, and Cleanup"
---

# 15 Email: Costs, Pitfalls, and Cleanup

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
