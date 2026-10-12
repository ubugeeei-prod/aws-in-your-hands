---
title: "42 Firewall Manager: Deploy"
---

# 42 Firewall Manager: Deploy

## Deploy and Check

<!-- section: 42.deploy -->

From here on the steps are for readers who have an organization. Nothing on this page was run. The steps were put together from the documentation and from the templates that were [checked locally](/en/chapters/42-firewall-manager/local.md).

From the moment of the deploy, each policy costs USD 100 a month. With automatic remediation on, web ACLs are created in the member accounts in scope, and those accounts are charged too. If you try this, aim it at a practice OU with only one or two accounts in it.

### What to Do First

These four are not done by this chapter's tasks. Do them in the console.

1. Confirm in the Organizations console that all features are enabled for the organization
2. Sign in with the organization's management account and, under Settings in the Firewall Manager console, enter the ID of the account that will be the administrator account
3. Enable AWS Config in us-east-1 and ap-northeast-1 in every account of the OUs in scope and in the administrator account, with continuous recording
4. If you want to check notifications too, enable Security Hub CSPM

Step 3 takes effort. The Firewall Manager documentation points to a CloudFormation StackSets sample template that enables AWS Config. This book has not tried it.

Look up the IDs of the OUs to cover (strings that start with `ou-`) in the Organizations console.

### Deploy

Deploy the two stacks with credentials for the Firewall Manager administrator account. The account ID you pass has to be the account those credentials point at.

```bash
vp run fwm:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
vp run fwm:edge:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
```

The first line creates the audit policy, the audit security group, and the notification path in the Tokyo Region. The second creates the AWS WAF policy for CloudFront in us-east-1. Automatic remediation is off in both, and at this point nothing in a member account changes.

To receive notifications by email, add `-c notifyEmail=<address>` to the first line. SNS sends a confirmation email, and no notification arrives until the link in it has been opened.

The pinned cdkd creates `AWS::FMS::Policy` and `AWS::FMS::NotificationChannel` through Cloud Control API. A deploy along that route was not checked, so read any error from the first run closely. If it does not work, one way out is to create the same templates (`*.template.json` in `cdk.out/`) with CloudFormation. Do not manage the same stack with cdkd and CloudFormation in turns, though.

### Look at Compliance

Both policies appear under Security policies in the Firewall Manager console. According to the documentation, creation can take several minutes, and meanwhile the account columns show Pending. Once they show account counts, open a policy and look at the non-compliant accounts and resources.

These are the things to look at.

- Whether the accounts of the OUs you named are listed as accounts in scope
- Whether distributions without a web ACL appear as non-compliant resources
- For the audit policy, which rules of which security groups are reported as violations. This is also where you learn how rules whose source is a security group are treated, which the model on the [design and build page](/en/chapters/42-firewall-manager/build.md) did not evaluate

If the result differs from the local model, the service is the one that is right.

### Enable Automatic Remediation

Enable it after reading the compliance report and deciding the changes are acceptable.

```bash
vp run fwm:edge:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id> -c wafRemediation=on
vp run fwm:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id> -c sgRemediation=on
```

The first line associates the policy's web ACL with the distributions in scope. To also replace the web ACL on distributions that already have one of their own, add `-c replaceAccountWebAcls=on`. After a replacement, the rules written in the old web ACL no longer apply.

The second line updates or removes the inbound rules reported as violations. Traffic to a running service can stop, so go through the violation details one by one first. For security groups managed with CDK, fix the code first.

Pass all of the context every time. If you leave out `-c wafRemediation=on` on a later deploy, automatic remediation goes back to off.

### Check for Drift

```bash
vp run fwm:infra:drift
vp run fwm:edge:infra:drift
```

A drift check compares the recorded state with what exists and does not synthesize, so these tasks take no context. How far [chapter 02](/en/chapters/02-toolchain.md)'s drift detection can compare `AWS::FMS::Policy`, a resource that goes through Cloud Control API, was not confirmed. A resource that could not be compared should be reported as "not compared" and not as "no difference", as chapter 02 decided.

What these tasks look at is only the definition of the policies in the administrator account. Whether resources in member accounts match a policy is a question for the compliance report, not for drift.
