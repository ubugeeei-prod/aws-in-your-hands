---
title: "21 Security: Costs, Pitfalls, and Cleanup"
---

# 21 Security: Costs, Pitfalls, and Cleanup

## If you come from Workers

<!-- section: 21.workers -->

Coming from Cloudflare Workers, the length of this chapter may surprise you.

```text
                 Cloudflare Workers                           this chapter
secret           an encrypted binding on the Worker           a separate resource, read over the network at run time
who may read it  the Worker it is bound to                    whoever IAM allows, per secret
rotation         not examined in this chapter                 a new version; the previous one stays readable by label
web firewall     a free managed ruleset on all plans          a web ACL you create, attach, and pay for by the month;
                                                              only on some kinds of entry point
audit trail      not examined in this chapter                 CloudTrail event history, 90 days, always on
```

A Workers secret is a binding on the Worker. An encrypted value is tied to the Worker, and your code writes nothing to go and fetch it. So this chapter's cache, and the gap between the cache and a rotation, don't appear in the same form. What happens when you replace a secret on Workers was not looked into for this chapter.

The AWS way is long because the secret is a resource separate from the function. Being separate, it can have permissions per secret, be read from several functions and from things that aren't Lambda, and keep versions under labels. In exchange, you write the code that fetches it, the permission to fetch it, and what to do when the fetch fails.

WAF sits in a different position. On Cloudflare, a free managed ruleset is available on all plans. Rate limiting rules are available from the Free plan too, with differences in features. On AWS you create a web ACL, attach it to an entry point of a kind that accepts one, and pay by the month. AWS has no "already there, for free".

Cloudflare's audit logs and its mechanisms for governing across accounts were not looked into for this chapter.

## The money

<!-- section: 21.cost -->

Amounts are in USD, for the Tokyo Region (CloudFront and WAF are global), on demand, before tax. The working is in [Pricing calculations](/en/reference/pricing.md).

What costs money just by existing.

- The default stack: USD 0.40 a month, for the one secret. CloudFront, Lambda, and the IAM role are 0 unless called
- With `-c cmk=on`: USD 1.40 a month. The key is USD 1 a month, and more from its first automatic rotation a year later
- The web ACL (`AihSecurityWaf`): USD 8.00 a month, separately from the default stack, attached to a distribution or not

All of it is prorated by the hour. Try the default stack for an afternoon and delete it, and it doesn't reach one cent. On the other hand, a forgotten web ACL is USD 96 in a year.

When used. Assuming 100,000 tokens issued and 100,000 verified a month, the list-price subtotal was USD 0.86 a month, and USD 0.49 after free allowances. What remains after the allowances is the secret's monthly fee and the Secrets Manager API calls. One execution environment reloading its keys every five minutes makes 17,520 calls a month, USD 0.09. Drop the cache and read once per request, and 200,000 calls come to USD 1.00.

For GuardDuty, Inspector, and Config, the order of magnitude depends on usage, so here are the unit prices only.

- GuardDuty: USD 4.72 per million CloudTrail events analyzed. There are also charges for VPC flow log and DNS log volume, and for each protection plan you enable
- Inspector: Lambda standard scanning is USD 0.0005 per function per hour
- AWS Config: USD 0.003 per configuration item with continuous recording

One example to get a feel for the scale. For a small account, assuming 100,000 events, one function, and 500 configuration items, it comes to USD 2.34 a month together. Those counts are assumptions, not measurements. For your account's numbers, look at the estimate the console gives during the trial.

Organizations and SCPs, CloudTrail event history, and IAM carry no additional charge.

Some things could not be confirmed. Whether a KMS key is billed during its 7 days pending deletion. Which usage type a web ACL for CloudFront falls under on a bill. How CloudFront's flat-rate plans include WAF (this chapter looks only at pay-as-you-go).

## Where you might get stuck

These were not met by running things. They are the places the documentation and the code suggest you'll stumble.

| If this happens | Look here |
| --- | --- |
| `sec:waf:infra:deploy` fails with a scope or Region error | A web ACL for CloudFront can only be created in us-east-1. Did you change the stack's `env`? |
| The synth stops on `-c webAclArn=...` | Is it shaped like `arn:aws:wafv2:us-east-1:<account>:global/webacl/<name>/<id>`? A `regional` ARN can't be attached to CloudFront |
| `/token` keeps answering 503 | If the function's log shows `SecretAccessDenied`, it's the role's permissions. With `-c cmk=on` it needs `kms:Decrypt` too. Right after a deploy, wait a little and try again |
| Requests through CloudFront get 403 | Does the function URL's resource policy have both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` from this distribution (chapter 09)? |
| Sending the token in the `Authorization` header doesn't work | CloudFront uses that header for its signature. Send it in `x-aih-token` |
| Verification answers 401 after a rotation | Did you rotate twice in a row? With `vp run sec:secret:versions`, check that the token's `keyVersion` is `AWSCURRENT` or `AWSPREVIOUS` |
| `sec:trail:iam` doesn't show the change you just made | IAM events are recorded in us-east-1. Whether there is a delay before they are recorded was not checked for this book |
| `sec:iam:lint` says an exception "matches nothing" | The policy has been fixed and no longer needs the exception. Remove it from `iam-lint-exceptions.json` |
| You re-created a secret under the same name and the function can't read it | A secret's ARN ends in six random characters, so re-creating changes the ARN. This stack doesn't fix the name, so a redeploy follows along |

## If you take this to production

- **Enable GuardDuty.** Once you have something to protect, this is the first thing to add. Look at the trial's estimate and turn off the protection plans you don't need
- **Send findings where people look.** Detection that is merely enabled gets read by nobody. Connect it to chapter 19's notification path
- **Create a trail.** The need to look further back than 90 days tends to show up after 90 days. Access Analyzer's policy generation needs one as well
- **Log the web ACL.** Look at what `count` recorded, then decide whether to switch to block. This chapter's stack sets up no logging
- **Give secret deletion a grace period.** This chapter's secret disappears with the stack at once. In production use `RemovalPolicy.RETAIN`, and use Secrets Manager's recovery window (7 to 30 days) when you do delete
- **Watch who reads the secret.** `GetSecretValue` is recorded in CloudTrail. Is a role you didn't expect reading it?
- **Separate accounts and attach SCPs.** After trying them on a practice OU
- **Put this lint in every stack's tests.** Today it is applied only to this chapter's stacks and chapter 20's CI roles

## Cleaning up

<!-- section: 21.cleanup -->

If you attached the web ACL, detach it first.

```bash
vp run sec:infra:deploy
vp run sec:waf:infra:destroy
vp run sec:infra:destroy
```

The first line deploys without `-c webAclArn=...`, to take the web ACL off the distribution. If you never attached one, the third line alone will do.

The secret goes with the stack. The pinned cdkd deletes it with no recovery window (checked in its source). It should not remain even in Secrets Manager's list of secrets scheduled for deletion.

A key created with `-c cmk=on` does not go away at once. It stays pending deletion for 7 days, unusable, and then it is gone.

What this chapter's tasks did not create, they do not remove. GuardDuty or Inspector enabled in the console is disabled in the console. Until you do, they are billed once the trial is over. Use `vp run sec:posture` to see what is still on.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (token signing and verification, the key cache across a rotation, the rotation procedure, reading the secret through a substituted SDK client, the wildcard lint and its exceptions, the SCP JSON and the evaluation model, waiting for IAM propagation, the posture verdicts, assertions on both stacks). The type check. Synth with the pinned cdkd (also with `-c cmk=on`, `-c webAclArn=...`, and a malformed ARN). Loading the synthesized function bundle in Node.js outside the test runner and calling `/health`. `/health`, `/token`, and `/verify` against the local server started by `vp run dev:sec`. `vp run sec:iam:lint` over the `cdk.out` of every chapter in this book (21 templates). All on macOS (Apple silicon).

**Not checked yet.** Nothing that touches AWS has been run: `sec:infra:diff`, `sec:infra:deploy`, `sec:smoke`, `sec:infra:drift`, `sec:infra:destroy`, `sec:waf:infra:*`, `sec:secret:versions`, `sec:secret:rotate`, `sec:posture`, `sec:trail:iam`. These points in particular are waiting for a real environment.

- The whole path through CloudFront, the signed function URL, and Secrets Manager; that calling the function URL directly gets 403
- Whether there is a time right after a deploy when the function can't read the secret, and how long it can still read after the permission is removed
- How the staging labels move after `PutSecretValue`; the error name when reading a secret that has no `AWSPREVIOUS`
- Creating and associating the web ACL; how long the rate-based rule takes to start blocking; the usage type on a bill
- The customer managed key variant; billing during the 7 days pending deletion
- The actual response shapes of the six APIs `sec:posture` calls, and the error names when a permission is missing
- GuardDuty, Inspector, AWS Config, a trail, Organizations, and SCPs. None has been enabled. The SCP JSON has not been confirmed to be accepted by Organizations
- That cdkd leaves the generated secret value out of its state and logs. In the source that was read it does, but this was not confirmed by running it

**About cdkd.** Confirmed by reading the npm tarball of the pinned cdkd (0.296.28). Every resource type the two stacks use has a dedicated implementation registered: `AWS::CloudFront::Distribution`, `AWS::CloudFront::OriginAccessControl`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::SecretsManager::Secret`, `AWS::KMS::Key` (with `-c cmk=on`), and `AWS::WAFv2::WebACL`. Nothing is registered for `AWS::GuardDuty::Detector`. For a secret, cdkd generates the `GenerateSecretString` value itself and passes it to `CreateSecret`, and deletes with `ForceDeleteWithoutRecovery`. A KMS key is deleted with `ScheduleKeyDeletion`, using the template's `PendingWindowInDays` (7 when absent).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What to put in first | `examples/21-security/src/posture.ts`, `scripts/posture.ts`, `test/posture.test.ts` | `sec:posture`, `test:unit` |
| The big picture | `examples/21-security/infra/bin/app.ts`, `infra/lib/config.ts` | `sec:infra:synth` |
| Narrowing permissions | `examples/21-security/infra/lib/security-stack.ts`, `infra/test/security-stack.test.ts` | `test:unit` |
| An assertion that finds wildcards | `examples/21-security/src/iam-lint.ts`, `scripts/iam-lint.ts`, `policies/iam-lint-exceptions.json`, `test/iam-lint.test.ts` | `sec:iam:lint`, `test:unit` |
| Keeping secrets out of environment variables | `examples/21-security/src/secret-source.ts`, `src/secrets-manager-source.ts`, `src/env.ts`, `src/compose.ts`, `test/secrets-manager-source.test.ts` | `dev:sec`, `test:unit` |
| Between the cache and a rotation | `examples/21-security/src/keyring.ts`, `src/token.ts`, `src/app.ts`, `test/keyring.test.ts`, `test/token.test.ts`, `test/app.test.ts` | `test:unit` |
| The rotation procedure | `examples/21-security/src/rotation.ts`, `scripts/rotate.ts`, `test/rotation.test.ts` | `sec:secret:versions`, `sec:secret:rotate` |
| Whose key is it | `examples/21-security/infra/lib/security-stack.ts`, `infra/test/security-stack.test.ts` | `sec:infra:synth`, `test:unit` |
| Entry points that can carry WAF, and ones that can't | `examples/21-security/infra/lib/waf-stack.ts`, `infra/lib/security-stack.ts`, `infra/test/waf-stack.test.ts` | `sec:waf:infra:deploy`, `sec:waf:infra:destroy` |
| IAM changes don't arrive at once | `examples/21-security/src/propagation.ts`, `test/propagation.test.ts`, `scripts/smoke.ts`, `scripts/trail.ts` | `sec:smoke`, `sec:trail:iam` |
| The watchers each look at something different | `examples/21-security/scripts/posture.ts`, `scripts/trail.ts` | `sec:posture`, `sec:trail:iam` |
| Once you are an organization | `examples/21-security/policies/scp-guardrails.json`, `src/policy-model.ts`, `test/scp.test.ts` | `test:unit` |
| Deploy and check | `examples/21-security/scripts/smoke.ts` | `sec:infra:deploy`, `sec:smoke`, `sec:infra:drift` |
| The money | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |
| Cleaning up | `examples/21-security/infra/lib/security-stack.ts` | `sec:infra:destroy`, `sec:waf:infra:destroy` |

**Primary sources** (all checked 2026-10-12)

- IAM: [Troubleshoot IAM (eventual consistency)](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html), [Security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html), [Access Analyzer policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html), [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html), the AWS service reference ([secretsmanager](https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json) and others, for actions and resource types)
- AWS WAF: [protectable resources](https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html), [rate-based rules](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html), [their caveats](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html), [baseline rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html), [IP reputation rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html), [WCUs](https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html), [testing and tuning](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-testing.html), [AWS::WAFv2::WebACL](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html), [RateBasedStatement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html)
- CloudFront: [using AWS WAF](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-awswaf.html), [restricting access to a function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- Secrets Manager: [what's in a secret, and versions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html), [PutSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html), [GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html), [DeleteSecret](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html), [best practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html), [rotation by Lambda function](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html), [AWS::SecretsManager::Secret](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html), [pricing](https://aws.amazon.com/secrets-manager/pricing/)
- Lambda: [environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), [using Secrets Manager in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)
- AWS KMS: [KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html), [rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html), [deleting keys](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html), [pricing](https://aws.amazon.com/kms/pricing/)
- GuardDuty: [What is Amazon GuardDuty?](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html), [Getting started](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_settingup.html), [usage and cost estimates](https://docs.aws.amazon.com/guardduty/latest/ug/monitoring_costs.html)
- Inspector: [What is Amazon Inspector?](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html), [scanning Lambda functions](https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html), [Getting started](https://docs.aws.amazon.com/inspector/latest/user/getting_started_tutorial.html), [pricing](https://aws.amazon.com/inspector/pricing/)
- CloudTrail: [event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html), [concepts (global service events)](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html), [LookupEvents](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html), [pricing](https://aws.amazon.com/cloudtrail/pricing/)
- AWS Config: [What is AWS Config?](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html), [pricing](https://aws.amazon.com/config/pricing/)
- Organizations: [SCPs](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html), [SCP evaluation](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html), [SCP syntax](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html), [quotas](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html), [creating an organization](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_org_create.html), [FAQs](https://aws.amazon.com/organizations/faqs/), [the aws-samples SCP examples](https://github.com/aws-samples/service-control-policy-examples)
- AWS Price List: [Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json), [KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json), [WAF](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json), [GuardDuty](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/ap-northeast-1/index.json), [Inspector](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json), [Config](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the tarball's `dist/`: provider registration, and creating and deleting secrets and KMS keys)
- AWS SDK for JavaScript v3: [3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-secrets-manager/v/3.1149.0) (type definitions of seven clients)
- Cloudflare: [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [WAF managed rules](https://developers.cloudflare.com/waf/managed-rules/), [rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)

:::
