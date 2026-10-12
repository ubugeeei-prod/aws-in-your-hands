---
title: "15 Email: Costs, Pitfalls, and Cleanup"
---

# 15 Email: Costs, Pitfalls, and Cleanup

## If you're coming from Workers

<!-- section: 15.cloudflare -->

This page covers how the chapter compares with Cloudflare, what it costs, where people get stuck, what to change for production, and how to clean up.

Cloudflare has an Email Service, and a Worker can send mail through a binding. You put `send_email` in the configuration and call `env.EMAIL.send(...)`. According to the official documentation, the sending feature is in beta and requires the Workers Paid plan.

The AWS side has more parts, as you have seen. You put together an identity, a configuration set, a topic, functions, roles, and a table yourself. There is no binding, so you call through the SDK and narrow permissions with IAM.

The comparison can go no further than that. On the Cloudflare side only the overview page was read, and domain onboarding, DNS setup, how bounces are received, limits, and prices are unchecked.

What stays the same whichever you use is the center of this chapter, [the order of recording and sending](/en/chapters/15-email.md). Unless the sending API recognizes a repeated request, you have to keep the record that prevents duplicates yourself.

## Cost

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. The details of the calculation are in [Pricing Worksheets](/en/reference/pricing.md).

**A month in which you send nothing costs 0.** The SES identity and configuration set, the SNS topic, the functions, and the API cost nothing while they only exist. Storage for the records left in the table is 0 at 10 MB (the first 25 GB of DynamoDB storage is a USD 0 tier).

The table below shows a month in which you send. It assumes 10,000 messages a month, one recipient each, no attachments, 1,000 repeated requests, and one event arriving per message.

| Item | Quantity | List price | After monthly free allowances |
| --- | --- | --- | --- |
| SES sending | 10,000 messages | 1.00 | 1.00 (no allowance confirmed, none deducted) |
| API Gateway HTTP API requests | 11,000 | 0.01 | 0.01 (same) |
| Lambda (requests and duration) | 21,000 requests, 950 GB-seconds | 0.02 | 0 |
| SNS (publishes and deliveries to Lambda) | 10,000 each | 0 | 0 |
| DynamoDB (writes, reads, storage) | 31,000 WRU, 6,500 RRU | 0.02 | 0.02 |
| CloudWatch Logs | 0.01 GB | 0.01 | 0 |
| Subtotal | | **1.06** | **1.04** |

Nearly all of the cost is the SES sending charge. It is USD 0.0001 per message, which is USD 0.10 per 1,000. According to the pricing page, it is counted per recipient. Attachments add USD 0.12 per GB.

SNS is 0 because, in the price list, the first 1,000,000 requests are a USD 0 tier and deliveries to Lambda are free.

The SES free allowance is treated as unknown. The pricing page describes credits for people new to AWS (up to USD 200, to be used within 12 months of creating the account), and no statement of a number of free messages each month was found on it. Check the terms that apply to your account in the Billing console.

Data transfer out to the internet, dedicated IPs (USD 24.95 a month each), and Virtual Deliverability Manager are not in the table, because this chapter's setup uses none of them. The function durations (300 ms to send, 50 ms per event) are also assumptions, not measurements.

**If a script with the permission gets stuck in a loop.** Only a caller with `execute-api` permission can call this API, and API Gateway refuses every other request before it reaches the function. What you need to guard against is therefore less an attack from outside than a runaway script of your own. Three things stop one.

- The stage throttle holds requests to at most 10 a second, which is at most 25.92 million in 30 days
- One `notificationId` sends one mail. However often the same request is repeated, one mail is sent. This does not stop a loop that makes up a new ID every time
- SES has limits. Inside the sandbox they are 200 messages per 24 hours, one a second, and verified recipients only. That is at most 6,000 messages in 30 days, USD 0.60

Suppose that, inside the sandbox, requests that each carry a new ID arrive at 10 a second for 30 days. SES refuses most of them, but every request still runs API Gateway and the function reads the table once (`findSuppression`, the lookup in the suppression list, an eventually consistent read) and writes to it twice (the claim, and the record of the refusal). Under the same assumptions as the table above (300 ms for the function, 0.5 KB of logs), that comes to USD 33.44 for API Gateway, USD 31.10 for Lambda, USD 38.91 for DynamoDB (the two writes and the one read), USD 9.39 for logs, and USD 0.60 for SES, about USD 113 a month in all.

Outside the sandbox, the SES limit becomes the account's sending quota (`SendQuota`), and this book does not know its value. If the quota allows it, the full 25.92 million messages that the throttle lets through are sent, and they cost USD 2,592 for SES alone. You would lose your reputation as a sender before you lost that money. Do the first two items of "If you take this to production" before leaving the sandbox.

Deleting the stack stops this chapter's charges.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:mail` stops with `Invalid environment` | Check that `examples/15-email/.env` exists and that it has `MAIL_MODE=local` |
| `mail:send` fails with a response that isn't in this book's error shape (`error.code`) | API Gateway is rejecting it before the function is invoked. Use `vp run account:whoami` to check that your current credentials belong to the same account as the stack. Calling the API takes `execute-api` permission |
| `mail:send` fails with 429 | The stage throttle refused it. The API as a whole went past 10 requests a second. Check whether the caller is in a loop |
| You get `send_rejected` | SES refused. Look at `reason` with `vp run mail:logs`. Most often the identity is not verified, the recipient is unverified while you are in the sandbox, or you hit the rate limit |
| The `reason` in the log is a permission error (`AccessDenied` or similar) | The sending role's policy is missing something. Compare the resource ARN in the error with the policy in the stack |
| You get `send_unknown` | SES gave no answer. Nothing more will be sent for that `notificationId`. Check the state with `mail:status`, and if it doesn't move to `delivered`, decide whether to send again under a new `notificationId` |
| It was sent, but the state stays `sent` | Events are not arriving. Look at `vp run mail:logs --events`, and check that the configuration set is named when sending |
| The event function's log says `unreadable SES event dropped` | An SES event doesn't match the schema. Compare the field named in `problem` with `src/events.ts` |
| The verification email doesn't arrive | Check the spam folder. The link expires after 24 hours. If it has, resend from the SES console |
| The domain still isn't verified after 72 hours | Check with `dig CNAME <the printed name>` whether the domain appears twice in the CNAME name |
| The second mail to a simulator address is `suppressed` | The first bounce put the address in this chapter's table. Use an address with a `+` label, or delete the address from the table |

`send_rejected` and `send_unknown` both come with status 502. They differ in whether the mail is sent when you make the same request again, so tell them apart by `code`.

## If you take this to production

- Narrow who can call the API. IAM authorization narrows callers only as far as anyone with `execute-api` permission. Give that permission to the role of the code that sends notifications and to nothing else. Lower the throttle's 10 requests a second to what you actually need as well
- Put a queue in front of the API. It decouples callers from a slow SES, and it lets you wait and retry when you hit the rate limit ([chapter 08](/en/chapters/08-async.md))
- Prepare for missed events. Lambda discards an event that the function failed on all three times. Give the function a dead-letter queue or an on-failure destination so that such events are kept. [Chapter 08](/en/chapters/08-async.md) explains the thinking behind a dead-letter queue, and attaches one to an SQS queue
- Watch the number of bounces and complaints. When your reputation as a sender has a problem, SES puts the account under review (`PROBATION`) or pauses sending (`SHUTDOWN`). The current state is in `EnforcementStatus` from `aws sesv2 get-account`. Alarm on it, together with the log of unreadable events (for how to build an alarm, see [chapter 19](/en/chapters/19-observability.md))
- Pick up records stuck at `claimed`. You need a routine that lists the records that have not moved after some time and decides whether to send again
- Protect the table. Set `removalPolicy` to `RETAIN` and turn on point-in-time recovery. If you lose the suppression list, you will mail bounced addresses again
- Encrypt the topic. Events contain recipients' email addresses. This chapter's topic only enforces encryption in transit (HTTPS). What encryption at rest requires is unchecked
- Tighten DMARC. `p=none` is a starting point
- Provide a way to unsubscribe. If you send promotional mail, recipients need a way to stop it themselves. This chapter's notification is out of scope, but think about it before you start sending another kind of mail through the same machinery
- Route changes through the AWS CDK CLI and CloudFormation, for the reasons chapter 02 gave

## Cleaning up

<!-- section: 15.cleanup -->

```bash
vp run mail:infra:destroy
```

That deletes the identity, the configuration set, the topic, both functions and their roles, the API, the table, and the log groups. The records in the table and the suppression list are deleted with them.

Three things remain after the stack is gone.

- Addresses on SES's account-level suppression list belong to the account and the Region, so they stay regardless of the stack. `aws sesv2 list-suppressed-destinations --region ap-northeast-1` shows them
- Production access and your sending limits are a state of the account, and deleting the stack does not change them
- The records you put in DNS are yours to delete. Leaving the DKIM CNAMEs does no harm, but remove a MAIL FROM MX and SPF that you no longer use

The storage created by cdkd's bootstrap (chapter 02), and the deployment files placed in it, also remain.

::: details Verification notes for this chapter

**Checked locally.** The unit tests were run. They cover assembling the email and refusing header injection, record-first sending, fault injection at eight points, simultaneous requests, validation of SES events with duplicates and reordering, inspection of the requests sent to DynamoDB and SES, and infrastructure assertions. Type checking and synth (including the esbuild bundle, 25 resources) passed. `dev:mail` was started and the `curl` commands from the text were run. That the part which builds signed requests adds an `Authorization` header was checked with fake credentials and a local server.

**Not checked yet.** This chapter never called SES. `mail:infra:deploy`, `mail:send`, `mail:status`, `mail:dns`, `mail:logs`, `mail:infra:drift`, `mail:infra:destroy`, and the `aws sesv2` commands in the text have not been run against real AWS. In particular, the following are still waiting to be confirmed in a real environment.

- That `SendEmail` passes under the sending role's policy (the two resources, identity and configuration set, and the `ses:FromAddress` condition). There are reports that, in the sandbox, permission on the recipient's identity is needed as well, but that couldn't be confirmed from a primary source
- That, with only the domain verified, mail can be sent from an address in that domain while naming a configuration set. The official documentation has a passage that can be read as saying an address which inherits verification from its domain can't be "used with configuration sets". The stack also makes the configuration set the identity's default
- That real events have the same shape as the fixtures. Delivery from SNS to the function. How the configuration set's suppression behaves
- That DynamoDB's conditional write lets exactly one of several simultaneous requests through. Only the expression sent, and the in-memory implementation following the same rule, were checked
- That cdkd can create the three SES resource types through Cloud Control API, detect drift on them, and delete them
- What SES does with a subject or a recipient containing a line break
- That the stage throttle takes effect. Only two things were checked, that the template carries the values and that the source of cdkd 0.296.28 passes them to the AWS API. What a throttled 429 looks like, and whether it is billed, are unchecked as well
- The production access request screen, and how long the review takes. The items in the text are what the official documentation describes

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Build the email first | `examples/15-email/src/contract.ts`, `src/message.ts`, `test/message.test.ts` | `test:unit` |
| Make the sending part swappable | `examples/15-email/src/mailer.ts`, `src/ses-mailer.ts`, `src/compose.ts`, `test/ses-mailer.test.ts` | `test:unit` |
| Record first, or send first | `examples/15-email/src/notify.ts`, `src/store.ts`, `src/memory-store.ts`, `src/dynamodb-store.ts`, `test/dynamodb-store.test.ts` | `test:unit` |
| Break it to check it | `examples/15-email/test/notify.test.ts`, `test/setup.ts` | `test:unit` |
| Running it locally | `examples/15-email/src/dev.ts`, `src/app.ts`, `src/env.ts`, `test/app.test.ts`, `test/env.test.ts`, `.env.example` | `dev:mail`, `test:unit` |
| Cleaning up after mail that didn't arrive | `examples/15-email/src/events.ts`, `src/events-lambda.ts`, `test/events.test.ts`, `test/fixtures/` | `test:unit`, `dev:mail` |
| Getting ready for AWS | `examples/15-email/infra/lib/email-stack.ts`, `infra/bin/app.ts`, `infra/test/email-stack.test.ts`, `cdk.json` | `mail:infra:synth`, `test:unit` |
| The sandbox and identities | `examples/15-email/infra/lib/email-stack.ts`, `infra/bin/app.ts` | `mail:infra:diff`, `mail:infra:deploy` |
| Send through the deployed API | `examples/15-email/scripts/send.ts`, `scripts/status.ts`, `scripts/signed-fetch.ts`, `scripts/logs.ts`, `src/lambda.ts` | `mail:send`, `mail:status`, `mail:logs`, `mail:infra:drift` |
| Sending from your own domain | `examples/15-email/src/dns.ts`, `scripts/dns.ts`, `test/dns.test.ts` | `mail:dns`, `test:unit` |
| Cleaning up | `tools/src/infra/` | `mail:infra:destroy` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

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
