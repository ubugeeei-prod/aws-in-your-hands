---
title: "42 Firewall Manager: One Policy for WAF, Security Groups, and Network Firewall across Accounts"
sourceRevision: 1
---

# 42 Firewall Manager: One Policy for WAF, Security Groups, and Network Firewall across Accounts

In [chapter 21](/en/chapters/21-security.md) you created one web ACL and attached it to one distribution. What it protects is the one distribution somebody remembered to attach it to. Once there are three accounts, or five, the thing you want to know changes. You want to know whether every public entry point in every account sits behind the same rules, including the one created yesterday.

AWS Firewall Manager answers that with a policy instead of with remembering. You write one policy, and it applies to the accounts and resources in its scope, including the ones added later.

The price comes first. **A Firewall Manager policy costs USD 100 a month, per policy and per Region.** The two stacks of this chapter create one policy each, so they cost USD 200 a month for simply existing. On top of that come the web ACLs the policy creates in member accounts and AWS Config, which is a prerequisite, once per account. For an example organization of five accounts the month came to USD 226.04. Chapter 21's setup, with a single web ACL, is USD 8.00 a month. To remove everything, run `vp run fwm:edge:infra:destroy` and `vp run fwm:infra:destroy`. The breakdown, and what stays behind after deletion, are on the [costs, pitfalls, and cleanup page](/en/chapters/42-firewall-manager/wrap.md).

If you have a single account, you cannot use Firewall Manager, because it requires an organization in AWS Organizations. Chapter 21 is all you need in that case, and this chapter is reading material about what changes when the accounts multiply.

None of the AWS steps in this chapter has been run. The book has no organization, so what could be run stops at local models, tests, and synth. The models are this book's reading of the documented behaviour, not the service. The details are in the [verification notes](/en/chapters/42-firewall-manager/wrap.md) at the end of the chapter.

The chapter builds on [chapter 21](/en/chapters/21-security.md), [chapter 11](/en/chapters/11-network.md), and [chapter 01](/en/chapters/01-account.md). How to divide accounts and environments in the first place is the subject of [chapter 33](/en/chapters/33-production-readiness.md). The code is in `examples/42-firewall-manager/`.

## The Question Firewall Manager Answers

<!-- section: 42.problem -->

In chapter 21, whether a web ACL is attached is decided by whoever writes the stack. Inside one team and one repository, a missing web ACL gets caught in review. A distribution that another team created in another account never comes into view at all.

Firewall Manager moves the decision. One account of the organization becomes the Firewall Manager administrator account, and the policy lives there. A policy states the protection and the scope it applies to. The scope is made of accounts, OUs (organizational units), resource types, and tags.

```figure
caption: One policy in the administrator account reaches the resources of every account in scope
node policy: Firewall Manager policy | administrator account
node config: AWS Config | every account, every Region
node dev: dev account | distributions
node prod: prod account | distributions
node sandbox: sandbox account | out of scope
edge config --> policy: configuration changes
edge policy -> dev: associates a web ACL
edge policy -> prod: associates a web ACL
group org: AWS Organizations organization = policy, config, dev, prod, sandbox
mark policy
```

AWS Config in each account records that a resource was created or changed. From those records Firewall Manager works out whether the resources in scope match the policy. Where they do not, it either reports them or fixes them itself, depending on a setting. The setting that makes it fix them is called automatic remediation.

A policy does not apply only to the resources that existed when it was created. The documentation says Firewall Manager applies it automatically to accounts and resources that come into scope later. That is the part that answers for the distribution created yesterday.

A resource is not protected the instant it is created, though. It takes time for the change to reach Firewall Manager and for the policy to be applied. What is visible in the meantime is examined with a model on the [design and build page](/en/chapters/42-firewall-manager/build.md).

## What You Need Before You Start

<!-- section: 42.prerequisites -->

The Firewall Manager documentation lists its prerequisites in order (read 2026-10-13).

The first is AWS Organizations. The account you use has to be in an organization, and the organization has to have all features enabled. Consolidated billing alone is not enough.

The second is a Firewall Manager administrator account. It is not the organization's management account from chapter 21, and the two names are easy to confuse. Only the management account can designate the first administrator account. That first account becomes the default administrator, which can handle every account, every Region, and every policy type. At that point Firewall Manager registers the account as an Organizations delegated administrator.

More administrators can be added later, up to 10 per organization, and that limit is fixed. An additional administrator can be given a narrower set of accounts or OUs, Regions, and policy types. Managing third-party firewalls is the one thing only the default administrator can do.

The third is AWS Config. It has to be enabled in every member account of the organization, the Firewall Manager administrator account included, in each Region that holds resources you want to protect, and the recording frequency has to be Continuous. If you do not record every resource type, each policy type has a set of types that must be recorded. For this chapter's two policies they are:

- AWS WAF policy: CloudFront distributions, Application Load Balancers, API Gateway, and WAF and WAFv2 web ACLs. CloudFront distributions can be recorded only in us-east-1
- Security group content audit: EC2 security groups, network interfaces, and instances

AWS Config is billed. As chapter 21 found, continuous recording costs USD 0.003 per configuration item. The AWS Config rule that Firewall Manager creates in each account for each policy is billed too, at USD 0.001 per evaluation for the first 100,000. If the recorder uses an IAM role of your own that lacks the permissions to record, Firewall Manager cannot see that.

Beyond these, Network Firewall and DNS Firewall policies need sharing within the organization enabled in AWS RAM, third-party firewalls need a subscription in AWS Marketplace, and Regions that are disabled by default need enabling. This chapter uses none of them.

Security Hub CSPM is not on the list. The path this chapter uses for notifications goes through it, however, so enable it if you want to see notifications work.

This chapter's stacks take the administrator account ID and the OUs to cover from CDK context.

<<< @/examples/42-firewall-manager/infra/lib/config.ts{context}

These two have no default. Unlike the switches in other chapters, there is no cheaper setting to fall back on when one is left out. Stopping at synth is better than creating a policy with somebody's example IDs in it.

The administrator account also matters when it goes away. When an administrator revokes its own account, every policy that account created is deleted. When the administrator account is closed, its policies are deactivated and their protection stops, and the policy data is kept for only 90 days.

## Policy Types

<!-- section: 42.policy-types -->

Policies are created per type. One policy handles one type, and you can have several of the same type. These are the types the documentation and the API reference list (read 2026-10-13).

```text
policy type                    API type                       what it enforces
AWS WAF                        WAFV2                          rule groups that run first and last in the web ACL of each in-scope resource
AWS WAF Classic                WAF                            one rule group in an AWS WAF Classic web ACL
Shield Advanced                SHIELD_ADVANCED                Shield Advanced protection on the chosen resource types
security group, common         SECURITY_GROUPS_COMMON         replicas of primary security groups, associated with in-scope resources
security group, content audit  SECURITY_GROUPS_CONTENT_AUDIT  which rules the security groups in scope may contain
security group, usage audit    SECURITY_GROUPS_USAGE_AUDIT    no unused and no redundant security groups
network ACL                    NETWORK_ACL_COMMON             first and last rules in the network ACLs of in-scope subnets
Network Firewall               NETWORK_FIREWALL               a Network Firewall firewall for the VPCs in scope
                               IMPORT_NETWORK_FIREWALL        existing firewalls, managed under one policy
DNS Firewall                   DNS_FIREWALL                   rule group associations on in-scope VPCs, before and after the account's own
third-party firewall           THIRD_PARTY_FIREWALL           Palo Alto Networks Cloud NGFW or Fortigate CNF, from AWS Marketplace
```

There are three kinds of security group policy, and they do different things. A common policy replicates primary security groups, created in the administrator account, into the VPCs of each account and associates them with resources. A content audit policy examines the rules of security groups that already exist and finds the ones whose content is not allowed. A usage audit policy finds the unused ones and the ones that duplicate each other.

This chapter creates an AWS WAF policy and a security group content audit policy. They are chapter 21's web ACL and [chapter 11](/en/chapters/11-network.md)'s security groups, each widened to several accounts.

It does not create a Network Firewall policy. A distributed policy creates a firewall for every VPC in scope and places endpoints. In the Tokyo Region an endpoint costs USD 0.395 an hour, which is USD 288.35 for a month. That is charged per endpoint, and the per-GB processing charge and the policy's monthly fee come on top. It is not an amount to leave running for practice.

## The Whole Picture

<!-- section: 42.architecture -->

There are two stacks, and both are deployed to the Firewall Manager administrator account. Nothing is deployed to a member account.

```figure
caption: Both stacks live in the administrator account, and the policies examine resources in member accounts
node edge: AihFirewallManagerEdge | us-east-1, AWS WAF policy
node regional: AihFirewallManager | ap-northeast-1, audit policy
node dist: CloudFront distributions | OUs in scope
node groups: Security groups | OUs in scope
node hub: Security Hub CSPM | findings
node rule: EventBridge rule
node notifier: Notifier | Lambda
node topic: SNS topic
edge edge -> dist: web ACL
edge regional -> groups: examines rules
edge dist --> hub: not compliant
edge groups --> hub: not compliant
edge hub -> rule: Findings - Imported
edge rule -> notifier
edge notifier -> topic: one message each
group admin: Administrator account = edge, regional, rule, notifier, topic
group members: Member accounts = dist, groups
```

<<< @/examples/42-firewall-manager/infra/bin/app.ts{stacks}

`AihFirewallManagerEdge` is a stack with a single resource, an AWS WAF policy for CloudFront distributions. In the console, a policy for CloudFront is created by choosing the Region called Global. The quotas page says Global and US East (N. Virginia) refer to the same Region, so the stack goes to us-east-1, for the same reason as chapter 21's web ACL stack. Protecting anything other than CloudFront, an Application Load Balancer for example, takes a separate policy in each Region.

`AihFirewallManager` goes to the Tokyo Region. It holds the security group audit policy, the audit security group that serves as its reference, and what carries a compliance change to a person: an SNS topic, an EventBridge rule, and a Lambda function.

The pinned cdkd (0.296.28) has no implementation of its own for `AWS::FMS::Policy` or `AWS::FMS::NotificationChannel`. Both are created through Cloud Control API. That Cloud Control API supports the two types was checked in its list of supported resources. It was not checked by deploying.

## When It Is the Wrong Tool

<!-- section: 42.when-not -->

With one account you cannot use Firewall Manager, and you would not need it if you could. Adding a web ACL to chapter 21's stack does the job.

With several accounts, if every resource is deployed from CDK code in one repository through [chapter 20](/en/chapters/20-shipping.md)'s pipeline, you can enforce the same thing before deployment. This repository lints its CDK code with awscdk-lint, stops IAM wildcards with chapter 21's lint, and reads synthesized templates in chapter 33's review. This chapter's audit rule fits into the same flow.

```bash
vp run fwm:audit:templates
```

The task reads the `cdk.out` of every chapter and applies the same audit rule as the policy to the inbound rules of the security groups. It answers before deployment and costs nothing.

Firewall Manager is needed when that premise does not hold. Some resources are created by hand in the console, each team has its own repository and pipeline, or accounts whose contents you do not know join the organization through an acquisition or a contractor. A check that reads templates cannot see what never went through the pipeline. Firewall Manager looks at what is in the account, however it got there.

Its role also differs from that of SCPs. As chapter 21 showed, an SCP (service control policy) sets the upper bound on what IAM users and roles in member accounts may be allowed. It is a preventive control: it refuses an API call before the action happens. Firewall Manager examines a resource's configuration after it was created or changed, and then reports or fixes it. It is detection and remediation.

Neither is enough alone. An SCP is a tool for writing "this action is not allowed", and it cannot state a required condition such as "every distribution has this rule group". Firewall Manager, for its part, cannot keep a non-matching state from existing until it is found.

One caution applies where the two meet. SCPs do not affect service-linked roles. In member accounts Firewall Manager uses the service-linked role `AWSServiceRoleForFMS`, so an SCP cannot stop a change made by automatic remediation. On the other hand, if the Firewall Manager administrator account is a member account, SCPs do apply to the people who work in it.

Last, the amount. USD 200 a month for two policies is too much for an organization with two or three entry points to protect. At that size it is cheaper to write the web ACL into each account's stack and confirm with a template check that they agree.
