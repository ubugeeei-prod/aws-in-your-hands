---
title: "21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/21-security` does not exist yet.

## Outcome

You configure what an individual needs and know what an organization adds.

## Prerequisites

- [06 Add Login: Cognito and Authorization](/en/chapters/06-auth.md)
- [20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift](/en/chapters/20-shipping.md)


## Planned architecture

CloudFront + WAF. Secrets in Secrets Manager. Audit through CloudTrail. Vulnerabilities via Inspector, threats via GuardDuty.

Services: WAF, Inspector, GuardDuty, Secrets Manager, KMS, CloudTrail, AWS Config, Organizations

## Topics

- Inspector (vulnerability scanning) and GuardDuty (threat detection) are different things
- Which entry points can and cannot carry WAF
- Per-secret and per-key monthly charges
- SCPs set limits; they grant nothing

## The distributed-systems angle

IAM changes are eventually consistent; do not rely on an immediate allow or deny.

## Source required for completion

- WAF rule CDK
- Secret-reading adapter and a rotation procedure
- Assertions that detect wildcard IAM policies

## Primary sources to start from

- [What is Amazon Inspector?](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html) (not re-read while writing)
- [What is Amazon GuardDuty?](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html) (not re-read while writing)
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) (not re-read while writing)
