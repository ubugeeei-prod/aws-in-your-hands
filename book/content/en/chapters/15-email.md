---
title: "15 Send Email: SES"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 15 Send Email: SES

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/15-email` does not exist yet.

## Outcome

You send a share-notification email and stop sending when a bounce or complaint arrives.

## Prerequisites

- [08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)


## Planned architecture

Queue → Lambda → SES. Bounces and complaints flow through an event destination → SQS → suppression record.

Services: SES

## Topics

- The sandbox and the production-access request (a manual procedure)
- SPF/DKIM/DMARC with Route 53
- Idempotency against duplicate sends

## The distributed-systems angle

A successful send call is not delivery, and a retry after a lost response can duplicate the email.

## Source required for completion

- Send adapter and fixtures
- CDK for the identity and configuration set
- A test that the same notification is not sent twice

## Primary sources to start from

- [Request SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) (not re-read while writing)
