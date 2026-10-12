---
title: "42 Firewall Manager: Costs, Pitfalls, and Cleanup"
---

# 42 Firewall Manager: Costs, Pitfalls, and Cleanup

This last page of the chapter covers how the setup differs from Cloudflare and Vercel, what it costs, its limits, where you might get stuck, what to add for production, and how to clean up. What was verified and the primary sources are in the verification notes at the bottom of the page.

## If You Come from Cloudflare or Vercel

<!-- section: 42.other-platforms -->

If you have been using Cloudflare or Vercel, the problem of this chapter itself may look unfamiliar. On both, a firewall is at the platform's entrance from the start, and your settings go on top of it. Everything below was read on 2026-10-13.

```text
                    Cloudflare                                   Vercel                                       this chapter
rules for many      account-level WAF: rulesets deployed to      custom rules and managed rulesets are set    one Firewall Manager policy per policy type
sites at once       the zones of an account, Enterprise plan     per project; IP blocking also per account    and Region, over accounts and OUs
                                                                 on Enterprise
local additions     zone-level rulesets, which run after the     the project's own rules                      the account's own rules, between the
                    account-level ones                                                                        policy's first and last rule groups
several accounts    Organizations (Enterprise) groups accounts;  not examined                                 the whole point: AWS Organizations is required
                    whether WAF rules span them: not confirmed
```

On Cloudflare, the closest thing to this chapter is the account-level WAF configuration. You create rulesets in the account and apply them to several zones, with an expression that narrows the zones and the traffic. Account-level rulesets run before zone-level ones, which gives them the same position as Firewall Manager's first rule groups. The documentation also says that an exception written at the zone level does not prevent a match at the account level. The feature requires an Enterprise plan. On other plans, rules are written per zone.

Cloudflare also has Organizations, which group several accounts. It is a feature for Enterprise customers. Whether account-level WAF rules can apply across several accounts of an Organization was not confirmed.

On Vercel, the unit of firewall configuration is the project. Custom rules and managed rulesets are set per project, and managed rulesets are an Enterprise plan feature. IP blocking alone can be set per account as well as per project, on the Enterprise plan. DDoS mitigation works on every plan without configuration. No mechanism for handing the same custom rules to every project of a team was found in the documentation that was read.

The difference comes from what an account means. On Cloudflare or Vercel, all of your sites usually live in one account or team. There is seldom a reason to care which account something is in, so a problem that crosses accounts does not normally arise. On AWS, an account is the boundary for permissions and billing. When you separate environments into accounts (how to separate them is [chapter 33](/en/chapters/33-production-readiness.md)'s subject), every boundary you add calls for a mechanism that keeps things aligned across it. Firewall Manager is one of those.

If your sites fit in one account and the platform's firewall is enough, there is no reason to bring this chapter's machinery in.

## Costs

<!-- section: 42.cost -->

Amounts are in USD, on demand, before tax. The arithmetic is in [pricing calculations](/en/reference/pricing.md), and `vp run fwm:cost` prints the same numbers.

What is charged for simply existing is the policy fee. In the Price List, an AWS WAF policy and a security group content audit policy are each USD 100 a month. The pricing page describes this as a monthly fee per Region. **With the two stacks in place, the month is USD 200.00 even when no resource is in scope.** That is USD 2,400 a year.

The policy fee is the part of Firewall Manager's cost that is paid to Firewall Manager itself. According to the pricing page, the web ACLs and rules a policy creates, and the AWS Config rules, are charged at those services' prices, to the account the resources are in.

Take a small organization of five accounts. It has a management account, a Firewall Manager administrator account, and three workload accounts (dev, staging, prod), and the policies cover the OU the three workloads are in. Each of the three has distributions, and automatic remediation is on.

```text
what                                                    quantity                          USD a month
AWS WAF policy for CloudFront                           1                                 100.00
security group content audit policy, ap-northeast-1     1                                 100.00
managed web ACLs in member accounts                     3 accounts x 1                     15.00
rule groups in those web ACLs, counted as rules         3 web ACLs x 2                      6.00
requests inspected                                      3 web ACLs x 1,000,000              1.80
AWS Config configuration items, us-east-1               4 accounts x 20                     0.24
AWS Config configuration items, ap-northeast-1          4 accounts x 200                    2.40
AWS Config rule evaluations, us-east-1                  3 accounts x 100                    0.30
AWS Config rule evaluations, ap-northeast-1             3 accounts x 100                    0.30
total at list price                                                                       226.04
```

The total is USD 226.04 a month. Among the quantities, the configuration items and the rule evaluations are assumptions, not measurements. What AWS Config costs depends on how much changes in an account. In an account where every deploy changes many resources, it can be ten times this example.

Some things are not in this table. They are not zero. They are unknown.

- Security Hub CSPM. This chapter's notifications go through it, and its price was not looked up
- S3 storage for the records AWS Config delivers
- Whether the policy fee is prorated when a policy is created or deleted partway through a month. An AWS WAF web ACL is described as prorated hourly. A Firewall Manager policy is not described either way
- How many rules the rule groups that Firewall Manager places in a member account's web ACL count as on a bill. The table counts one rule group as one rule, as chapter 21 did
- Which Price List usage type an AWS WAF policy for CloudFront is billed under. The three candidates are all USD 100
- The notifier's Lambda, SNS, EventBridge, and CloudWatch Logs. They scale with the number of findings and are expected to be small at this size. They are not in the calculation

If the same three accounts each had a web ACL of their own, as in chapter 21 and with chapter 21's configuration (three rules, and the same one million requests inspected a month), that would be USD 8.60 each and USD 25.80 a month together. With Firewall Manager it is about nine times that. The difference of roughly USD 200 is the price of not having to remember and of seeing everything in one place. At 30 accounts the same assumptions give USD 454.46 a month, and the USD 200 for the policies has not moved. The more accounts there are, the thinner the premium per account.

For an organization that subscribes to Shield Advanced, the pricing page says the Firewall Manager policy fee is included. This book does not cover Shield Advanced.

## Limits, and the Cautions the Documentation Names

<!-- section: 42.limits -->

Quotas change, so they come with the date they were read. These were read on 2026-10-13 on the Firewall Manager quotas page. Check the same page and the Service Quotas console for current values.

```text
quota                                                          value                 adjustable
policies per organization, per Region                          50                    yes
OUs in scope per policy                                        20                    yes
tags that include or exclude resources per policy              8                     yes
accounts in scope, when accounts are named individually        200                   yes
accounts in scope, when they are not                           2,500                 yes
rule groups per AWS WAF policy                                 50                    yes
audit security groups per content audit policy                 1                     yes
administrators per organization                                10                    no
WCUs for the rule groups of one AWS WAF policy                 5,000                 no
```

Policies are counted per Region. Global and US East (N. Virginia) are the same Region and are counted together.

The number of tags usable in a scope is 8 on the quotas page, while the API reference gives 50 as the maximum length of the `ResourceTags` array. This chapter's model refuses at the smaller number, 8.

Of the cautions the documentation names, these concern this chapter's two policies.

- CloudFront flat-rate plans. Web ACLs that Firewall Manager creates cannot take part in CloudFront flat-rate pricing plans. If you try to manage a web ACL that is part of one, no compliance status is reported for that distribution and policy, and Firewall Manager cannot remediate it
- Overlap with a Shield Advanced policy. A resource on which a Shield Advanced policy placed a web ACL for automatic application layer mitigation cannot have the AWS WAF policy applied, and is marked non-compliant
- Logging configuration. If the logging configuration of a web ACL that Firewall Manager manages is changed from the AWS WAF side, Firewall Manager does not notice by itself
- Detection of security group changes. As said earlier, it can take up to six hours
- Conflict with other tools. When Firewall Manager and another tool both fix the same security group, the remediation repeats
- Closing or revoking the administrator account. The policies are deleted or deactivated, and protection stops

These are the things the owner of a member account can still do under a policy.

- Add rules and rule groups of their own to the web ACL Firewall Manager created. They are evaluated between the policy's first set and last set. The owner also decides the metrics and sampling settings of the rules they add
- Tag their own resources. With the exemption tag, a resource leaves the policy's scope
- Anything at all while automatic remediation is off. The policy only reports

Whether an owner can remove the policy's rule groups from a web ACL that Firewall Manager created was not confirmed. The documentation does say that when a customer associates a web ACL of their own by hand, it is overridden by the policy's web ACL.

The list of Regions where Firewall Manager is available was not checked. The Price List had prices for the Tokyo Region and for us-east-1.

## Where You Might Get Stuck

The table below does not come from running into these. It lists what the documentation and the code suggest could go wrong.

| If this happens | Look here |
| --- | --- |
| Synth stops with `adminAccountId: is required` | This chapter's tasks need `-c adminAccountId=...` and `-c orgUnitIds=...`. To check the shape only, use `fwm:infra:synth:example` |
| `fwm:edge:infra:deploy` stops with a Region error | A policy for CloudFront is created in us-east-1. Check that the stack's `env` was not changed |
| Creating `AWS::FMS::Policy` is refused | Check that the deploy target is the Firewall Manager administrator account and that AWS Config is enabled in the accounts in scope. The wording of the real error was not seen |
| A policy stays in Pending | Creation can take several minutes |
| The accounts of the OU do not appear in scope | Check the spelling of the OU ID and the administrative scope the administrator was given (accounts, Regions, policy types). A policy outside that scope becomes `OUT_OF_ADMIN_SCOPE` and does not protect new resources |
| The compliance status does not match reality | Check that AWS Config records continuously. If it does, re-evaluate the AWS Config rule of that policy |
| A finding says "Account does not have AWS Config enabled in the Region" | Enable AWS Config in that account and Region |
| No notification arrives | Check that Security Hub CSPM is enabled, that findings arrive in the Region the rule is in, and that the email subscription was confirmed |
| A resource with the exemption tag stays in scope | A tag has to match in both key and value. Check upper and lower case and spaces at either end |
| The audit reports a rule for the office IP address as a violation | This chapter's reference lists what is allowed. Add the exemption tag, or add that address to the audit security group |
| A rule removed by remediation comes back with the next deploy | The rule is still in the template. Fix the code |
| An Application Load Balancer in the Tokyo Region is not protected | This chapter's AWS WAF policy is for CloudFront. A regional resource needs a policy in its Region |

## For Production

- Enable automatic remediation one OU at a time, after reading the report. Do not start with the whole organization
- List the resources that carry an exemption tag regularly. A resource that left the scope shows up in no report
- Restrict who may add the exemption tag, with IAM and SCPs. An SCP that keeps the AWS Config recorder from being stopped is already among chapter 21's guardrails
- Send the findings somewhere people look. Connect this chapter's topic to the notification path of [chapter 19](/en/chapters/19-observability.md). With several Regions, configure aggregation in Security Hub
- Add a logging configuration to the AWS WAF policy. A policy can hold the setting that collects the logs of every web ACL in scope in one place. This chapter's stack does not set it
- If you split the administration, hand out narrowed scopes. Keep the default administrator as the only one that handles everything
- Decide how AWS Config gets enabled uniformly in every account and Region. Firewall Manager reports an account where it is off with a finding, and does not turn it on for you
- cdkd is a tool for development and testing. Manage production policies with the AWS CDK CLI or CloudFormation

## Cleanup

<!-- section: 42.cleanup -->

The monthly fee of a policy runs until the policy is deleted. When you are done trying, delete both.

```bash
vp run fwm:edge:infra:destroy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
vp run fwm:infra:destroy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
```

What stays in member accounts after a policy is deleted depends on `DeleteAllPolicyResources`. This chapter's stacks set it to `true`.

With `true`, according to the API reference, three things happen for an AWS WAF policy: the rule groups Firewall Manager created are removed, web ACLs are removed from the resources in scope, and web ACLs that contain no rules or rule groups are removed. After that, those resources are no longer protected by this policy's web ACL. The documentation says the changes might take a few minutes to reach all accounts.

If that description holds, a web ACL to which the owner added rules of their own is not empty, so it stays. A web ACL that stays keeps costing its monthly fee in that member account. Whether this is what really happens was not confirmed. After deleting, open the AWS WAF console in us-east-1 in the accounts that were in scope and look for web ACLs whose names start with `FMManagedWebACLV2-`.

With `false`, a web ACL that is associated with a resource stays as it is, and so do the protection and the charge. A web ACL that Firewall Manager created and that is associated with nothing is removed even with `false`.

The security group audit policy creates no resource in member accounts. Deleting it does not bring back rules that automatic remediation already updated or removed.

Whether the template's `DeleteAllPolicyResources` takes effect when cdkd deletes the policy through Cloud Control API was not confirmed. The CloudFormation reference describes the property as "used when deleting a policy".

What the stacks did not create is not deleted.

- AWS Config. The recorders enabled in each account keep running, and configuration items keep being charged
- Security Hub CSPM. If you enabled it, it is charged until you disable it. The findings stay too
- The designation of the Firewall Manager administrator account, and the service-linked roles in each account
- An email subscription, pending or confirmed. It should go away with the topic, but that was not confirmed

::: details Verification notes for this chapter

**Checked locally.** 94 unit tests (the scope decision, the security group audit rule and CIDR containment, reading rules from a template, the managed service data of both policies, the model of web ACL association with a 2,000-step walk from a fixed random seed, the finding event's shape and the notice, the cost arithmetic, and assertions on both stacks and the context). That the invariant tests fail when the model's decision is loosened on purpose. The type check. `vp check --fix` on this chapter's paths, awscdk-lint included. Synth with the pinned cdkd (`vp run fwm:infra:synth:example`), and that synth stops without context. Loading the synthesized bundle of the notifier function in Node.js outside the test runner. `vp run fwm:cost` and `vp run fwm:audit:templates` (the 46 templates that had a `cdk.out` at the time). All on 2026-10-13, on macOS (Apple silicon).

**Not checked yet.** Nothing that touches AWS was run. The book has no organization, so none of `fwm:infra:deploy`, `fwm:edge:infra:deploy`, `fwm:infra:diff`, `fwm:infra:drift`, `fwm:infra:destroy`, or `fwm:edge:infra:destroy` has been run. These points in particular wait for a real environment.

- Whether Firewall Manager's real decisions match this chapter's models: the scope, the precedence of `IncludeMap` over `ExcludeMap`, tag matching, what "within the allowed range" means, how rules whose source is a security group or a prefix list are treated, and how outbound rules are treated
- That cdkd 0.296.28 can create, update, and delete `AWS::FMS::Policy` and `AWS::FMS::NotificationChannel` through Cloud Control API. That the `ORGUNIT` key of `IncludeMap`, `ManagedServiceData` as a string, and `DeleteAllPolicyResources` are accepted and do what was intended
- That the service accepts this chapter's managed service data, and in particular that with `optimizeUnassociatedWebACL` and automatic remediation off no web ACL is created
- What happens to a web ACL an account attached itself when `overrideCustomerWebACLAssociation` is `false`, and which of the two statements in the documentation applies
- How long it takes from the creation of a distribution or a security group until it appears in the compliance report, and until a web ACL is attached
- Whether automatic remediation updates an inbound rule or removes it, and by what criterion
- What happens to the topic policy and the notification channel in an account that does not have the service-linked role yet. How many notification channels an account and Region can have. What the messages that arrive in SNS contain
- In which account and Region's Security Hub a Firewall Manager finding arrives, the real fields of a finding, and that the filter on the product name matches
- What stays in member accounts after a policy is deleted: web ACLs to which an owner added rules, and AWS Config rules
- Proration of the policy fee, the usage type of a policy for CloudFront, how rules in member accounts' web ACLs are counted, and the price of Security Hub CSPM
- The list of Regions where Firewall Manager is available
- Whether Cloudflare's account-level WAF spans several accounts of an Organization, and whether Vercel has custom rules for a whole team

**cdkd.** Checked by reading `dist/` of the installed package of the pinned cdkd (0.296.28). No implementation is registered for `AWS::FMS::Policy` or `AWS::FMS::NotificationChannel`, and they are routed to Cloud Control API. Both types are in Cloud Control API's list of supported resources. The other resource types (`AWS::EC2::VPC`, `AWS::EC2::SecurityGroup`, `AWS::SNS::Topic`, `AWS::SNS::TopicPolicy`, `AWS::SNS::Subscription`, `AWS::Events::Rule`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::IAM::Role`, `AWS::Logs::LogGroup`) have implementations registered.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The Question Firewall Manager Answers | `examples/42-firewall-manager/` | none |
| What You Need Before You Start | `examples/42-firewall-manager/infra/lib/config.ts`, `infra/bin/app.ts` | `fwm:infra:synth:example` |
| Policy Types | `examples/42-firewall-manager/src/policies.ts` | none |
| The Whole Picture | `examples/42-firewall-manager/infra/bin/app.ts`, `infra/lib/edge-waf-policy-stack.ts`, `infra/lib/firewall-manager-stack.ts` | `fwm:infra:synth:example` |
| When It Is the Wrong Tool | `examples/42-firewall-manager/scripts/audit-templates.ts` | `fwm:audit:templates` |
| Scope | `examples/42-firewall-manager/src/org.ts`, `src/scope.ts`, `src/policies.ts`, `infra/lib/scope-props.ts`, `test/scope.test.ts` | `test:unit` |
| The AWS WAF Policy | `examples/42-firewall-manager/src/policies.ts`, `src/managed-service-data.ts`, `infra/lib/edge-waf-policy-stack.ts`, `test/managed-service-data.test.ts`, `infra/test/stacks.test.ts` | `test:unit`, `fwm:infra:synth:example` |
| The Security Group Audit Policy | `examples/42-firewall-manager/src/security-group-audit.ts`, `src/cidr.ts`, `infra/lib/firewall-manager-stack.ts`, `test/security-group-audit.test.ts`, `scripts/audit-templates.ts` | `test:unit`, `fwm:audit:templates` |
| Until the Policy Arrives | `examples/42-firewall-manager/src/reconcile.ts`, `test/reconcile.test.ts` | `test:unit` |
| Compliance Reports and Notifications | `examples/42-firewall-manager/src/finding.ts`, `src/notify.ts`, `src/lambda.ts`, `infra/lib/firewall-manager-stack.ts`, `test/finding.test.ts`, `test/fixtures/finding-events.ts` | `test:unit` |
| Run It Locally | `examples/42-firewall-manager/test/`, `infra/test/stacks.test.ts`, `scripts/cost.ts`, `scripts/audit-templates.ts` | `test:unit`, `fwm:cost`, `fwm:audit:templates`, `fwm:infra:synth:example` |
| Deploy and Check | `examples/42-firewall-manager/infra/bin/app.ts`, `infra/lib/config.ts` | `fwm:infra:deploy`, `fwm:edge:infra:deploy`, `fwm:infra:drift` |
| Costs | `examples/42-firewall-manager/src/cost.ts`, `test/cost.test.ts`, `scripts/cost.ts`, `data/pricing/` | `fwm:cost`, `test:unit` |
| Limits, and the Cautions the Documentation Names | `examples/42-firewall-manager/src/scope.ts`, `src/managed-service-data.ts` | none |
| Cleanup | `examples/42-firewall-manager/infra/lib/edge-waf-policy-stack.ts`, `infra/lib/firewall-manager-stack.ts` | `fwm:edge:infra:destroy`, `fwm:infra:destroy` |

**Primary sources** (all read on 2026-10-13)

- Firewall Manager (AWS WAF, AWS Firewall Manager, and AWS Shield Advanced Developer Guide): [overview](https://docs.aws.amazon.com/waf/latest/developerguide/fms-chapter.html), [prerequisites](https://docs.aws.amazon.com/waf/latest/developerguide/fms-prereq.html), [joining Organizations](https://docs.aws.amazon.com/waf/latest/developerguide/join-aws-orgs.html), [default administrator](https://docs.aws.amazon.com/waf/latest/developerguide/enable-integration.html), [enabling AWS Config](https://docs.aws.amazon.com/waf/latest/developerguide/enable-config.html), [sharing with AWS RAM](https://docs.aws.amazon.com/waf/latest/developerguide/enable-ram.html), [administrators](https://docs.aws.amazon.com/waf/latest/developerguide/fms-administrators.html), [creating an administrator](https://docs.aws.amazon.com/waf/latest/developerguide/fms-creating-administrators.html), [changing the default administrator](https://docs.aws.amazon.com/waf/latest/developerguide/fms-change-administrator.html), [disqualifying changes](https://docs.aws.amazon.com/waf/latest/developerguide/disqualified-admin-account.html), [policy types](https://docs.aws.amazon.com/waf/latest/developerguide/working-with-policies.html), [creating a policy](https://docs.aws.amazon.com/waf/latest/developerguide/create-policy.html), [policy scope](https://docs.aws.amazon.com/waf/latest/developerguide/policy-scope.html), [deleting a policy](https://docs.aws.amazon.com/waf/latest/developerguide/policy-deleting.html), [AWS WAF policies](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policies.html), [rule group management](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policies-rule-groups.html), [web ACL management](https://docs.aws.amazon.com/waf/latest/developerguide/how-fms-manages-web-acls.html), [logging](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policies-logging-config.html), [setting up AWS WAF policies](https://docs.aws.amazon.com/waf/latest/developerguide/getting-started-fms.html), [security group policies](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies.html), [content audit](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies-audit.html), [common](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies-common.html), [usage audit](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies-usage.html), [Shield Advanced policies](https://docs.aws.amazon.com/waf/latest/developerguide/shield-policies.html), [network ACL policies](https://docs.aws.amazon.com/waf/latest/developerguide/network-acl-policies.html), [Network Firewall policies](https://docs.aws.amazon.com/waf/latest/developerguide/network-firewall-policies.html), [DNS Firewall policies](https://docs.aws.amazon.com/waf/latest/developerguide/dns-firewall-policies.html), [compliance](https://docs.aws.amazon.com/waf/latest/developerguide/fms-compliance.html), [integration with Security Hub CSPM](https://docs.aws.amazon.com/waf/latest/developerguide/fms-findings.html), [AWS WAF policy findings](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policy-findings.html), [content audit findings](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-content-audit-policy-findings.html), [AWS Config findings](https://docs.aws.amazon.com/waf/latest/developerguide/aws-config-firewall-manager-findings.html), [quotas](https://docs.aws.amazon.com/waf/latest/developerguide/fms-limits.html), [notifications](https://docs.aws.amazon.com/waf/latest/developerguide/set-fms-alarms.html), [service-linked roles](https://docs.aws.amazon.com/waf/latest/developerguide/fms-using-service-linked-roles.html), [how it works with IAM](https://docs.aws.amazon.com/waf/latest/developerguide/fms-security_iam_service-with-iam.html)
- Firewall Manager API reference: [Policy](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_Policy.html), [SecurityServicePolicyData](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_SecurityServicePolicyData.html), [ResourceTag](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_ResourceTag.html), [DeletePolicy](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_DeletePolicy.html), [PutNotificationChannel](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_PutNotificationChannel.html)
- CloudFormation: [AWS::FMS::Policy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fms-policy.html), [IEMap](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-fms-policy-iemap.html), [AWS::FMS::NotificationChannel](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fms-notificationchannel.html), [resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- AWS Organizations: [integration with Firewall Manager](https://docs.aws.amazon.com/organizations/latest/userguide/services-that-can-integrate-fms.html), [OrganizationalUnit](https://docs.aws.amazon.com/organizations/latest/APIReference/API_OrganizationalUnit.html), [SCPs](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- Security Hub CSPM: [AWS service integrations](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-internal-providers.html), [EventBridge event formats](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-cwe-event-formats.html), [event types](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-cwe-integration-types.html), [a rule for findings](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-cwe-all-findings.html), [required ASFF attributes](https://docs.aws.amazon.com/securityhub/latest/userguide/asff-required-attributes.html), [optional ASFF attributes](https://docs.aws.amazon.com/securityhub/latest/userguide/asff-top-level-attributes.html), [AwsSecurityFinding](https://docs.aws.amazon.com/securityhub/1.0/APIReference/API_AwsSecurityFinding.html)
- AWS WAF and SNS: [rule actions](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-action.html), [baseline rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html), [IP reputation rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html), [SNS Publish](https://docs.aws.amazon.com/sns/latest/api/API_Publish.html)
- Pricing: [Firewall Manager pricing](https://aws.amazon.com/firewall-manager/pricing/), AWS Price List for [AWSFMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSFMS/current/index.json), [AWSConfig (us-east-1)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/us-east-1/index.json), [AWSConfig (ap-northeast-1)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json), [AWSNetworkFirewall (ap-northeast-1)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSNetworkFirewall/current/ap-northeast-1/index.json). The AWS WAF unit prices are the ones chapter 21 confirmed on 2026-10-12
- Others: [RFC 1918](https://www.rfc-editor.org/rfc/rfc1918.txt) (the three private address blocks), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (`dist/` of the installed package), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (the type definitions of `aws-fms`)
- Cloudflare: [account-level WAF configuration](https://developers.cloudflare.com/waf/account/), [account-level managed rulesets](https://developers.cloudflare.com/waf/account/managed-rulesets/), [Organizations](https://developers.cloudflare.com/fundamentals/organizations/)
- Vercel: [Vercel Firewall](https://vercel.com/docs/vercel-firewall), [Vercel WAF](https://vercel.com/docs/vercel-firewall/vercel-waf), [IP blocking](https://vercel.com/docs/vercel-firewall/vercel-waf/ip-blocking)

:::
