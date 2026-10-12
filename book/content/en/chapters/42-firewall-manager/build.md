---
title: "42 Firewall Manager: Design and Build"
---

# 42 Firewall Manager: Design and Build

This page builds the two policies from the [opening page](/en/chapters/42-firewall-manager.md): their scope, what they enforce, how long they take to arrive, and how they report. Every piece of decision code on this page is a model that this book wrote from its reading of the Firewall Manager documentation. Local tests can confirm that a model behaves as it was read. They cannot confirm that the service gives the same answer.

## Scope: Which Resources a Policy Reaches

<!-- section: 42.scope -->

A policy's scope is three conditions together: the account is in scope, the resource type matches, and the tag condition is met.

Accounts can be named in three ways: every account of the organization, only the listed accounts and OUs (`IncludeMap`), or all but the listed accounts and OUs (`ExcludeMap`). Naming an OU brings in every account in that OU and in its child OUs, including accounts that join later.

<<< @/examples/42-firewall-manager/src/org.ts{ancestry}

<<< @/examples/42-firewall-manager/src/scope.ts{accounts}

You can write both `IncludeMap` and `ExcludeMap`, but they do not both take effect. The API reference says that when an `IncludeMap` exists, the `ExcludeMap` is not evaluated. A policy meant as "include the workloads OU and leave out one account in it" applies to that account as well. A test pins this behaviour, and the stack stops at synth when both are given.

The tag condition takes more care. You choose whether to include only the resources that have the policy's tags (`ExcludeResourceTags` is `false`) or to leave those resources out (`true`), and with several tags, whether a resource must have all of them (`AND`) or any one (`OR`). One policy cannot mix including and excluding.

<<< @/examples/42-firewall-manager/src/scope.ts{tags}

A tag matches only when both the key and the value are the same. To a policy whose condition is `fms-waf=exempt`, `fms-waf=Exempt` is an unrelated tag. A tag written without a value is saved with the empty string, and matches only an empty value.

<<< @/examples/42-firewall-manager/src/scope.ts{resource}

### Exceptions Are Tags

Both policies of this chapter use the scope "every resource of this type in the named OUs, except the ones that carry the exemption tag".

<<< @/examples/42-firewall-manager/src/policies.ts{exemptions}

The scope is not written the other way round, as "only resources tagged `public=true`". Written that way, a distribution somebody forgot to tag is out of scope and the policy says nothing about it. The question this chapter set out to answer was about the resource nobody remembered. If inclusion depends on a tag, the thing to remember has only changed from the web ACL to the tag.

With exclusion by tag, an exception is something a person went out of their way to add. Even so, a list of exceptions can quietly become the policy itself. Three decisions keep that from happening.

- Exceptions live in resource tags, not in the policy's definition. A policy that keeps gaining account and resource names turns into the list of exceptions
- Resources under an exception are listed regularly. A resource that left the scope does not appear in the compliance report either. It disappears quietly, so it has to be counted separately
- Few people may add the exemption tag. If a resource's owner can tag it, the owner can leave the policy. Restricting who may tag, with IAM and SCPs, is the organization's job and not Firewall Manager's. This chapter does not write that SCP

For the second point, the model returns why a resource was not in scope.

<<< @/examples/42-firewall-manager/src/scope.ts{coverage}

`keptOutByTags` holds the resources whose account and type match and that were kept out by tags alone. Building this list for a real organization means collecting the resources and tags of every account. This chapter does not implement that collection.

Quotas matter here too. By default one policy can use 8 tags in its scope and can name 20 OUs (read 2026-10-13). The model's schema refuses more.

<<< @/examples/42-firewall-manager/src/scope.ts{scope-schema}

The stack builds the properties of `AWS::FMS::Policy` from the same scope definition the model reads. That way the scope the tests examined and the scope that gets deployed are not written twice and cannot drift apart.

<<< @/examples/42-firewall-manager/infra/lib/scope-props.ts{scope-props}

One spelling differs between references. The key for OUs is `ORG_UNIT` in the API reference and `ORGUNIT` in the CloudFormation reference. The stack emits the CloudFormation spelling. The pinned cdkd creates this resource through Cloud Control API, so the CloudFormation schema should be the one in use, but that it is accepted was not confirmed.

## The AWS WAF Policy

<!-- section: 42.waf-policy -->

In chapter 21 you ordered the rules of one web ACL yourself, in one account. A Firewall Manager AWS WAF policy creates a web ACL for each account in scope and divides its rules into three sets.

```text
order  set                 who writes it                    what goes in it
1      first rule groups   the Firewall Manager policy      rule groups only
2      account's own       the owner of the member account  rules and rule groups
3      last rule groups    the Firewall Manager policy      rule groups only
```

The policy decides the first and the last set, and the account's owner can add rules of their own in between. A policy can put in rule groups only, not single rules. To distribute one rule, you create a rule group that contains it in the administrator account.

The reason for a first and a last set lies in how AWS WAF evaluates. Allow and Block are terminating actions: evaluation ends there. A request that the owner's rule allows never reaches the sets after it. The first set is evaluated before the account's rules, so nothing the owner writes lets a request past it. The last set sees only requests that the account's rules neither allowed nor blocked.

<<< @/examples/42-firewall-manager/src/policies.ts{edge-waf}

This chapter's policy puts the list of IP addresses with a bad reputation (`AWSManagedRulesAmazonIpReputationList`, 25 WCUs) in the first set. It should hold in every account without exception. The last set has the rule group that stops known malicious inputs (`AWSManagedRulesKnownBadInputsRuleSet`, 200 WCUs). It has no effect on a request that an account's own rule has already let through.

The core rule set, which chapter 21 started in `count`, is not included. Handing a rule group that can block legitimate requests to every account at once is the opposite of what chapter 21 did carefully in one account. If you add it, keep automatic remediation off, as described below, and watch one OU first.

### Settings Travel as a JSON String

The settings of each policy type go into one property, `SecurityServicePolicyData.ManagedServiceData`, as JSON turned into a string. To CloudFormation the contents are an unchecked string. A key misspelled by one letter still synthesizes.

<<< @/examples/42-firewall-manager/src/managed-service-data.ts{waf-data}

This schema covers only the fields this chapter uses, in the shape of the examples in the API reference. It refuses unknown keys, so a misspelling is found before a deploy. It is not Firewall Manager's validation, though. The service accepts fields that are not here, and it may refuse a value that passes here.

`overrideAction` is limited to `NONE` for the same reason. `NONE` was the only value in the API reference's WAFV2 examples. `COUNT` appears only in the AWS WAF Classic example, and whether a WAFV2 policy takes it was not confirmed, so the schema does not let it through.

<<< @/examples/42-firewall-manager/src/managed-service-data.ts{encode}

<<< @/examples/42-firewall-manager/infra/lib/edge-waf-policy-stack.ts{waf-policy}

### What You Get While Automatic Remediation Is Off

A policy with `RemediationEnabled` set to `false` changes nothing. It only lists, as non-compliant, the in-scope resources that do not have the policy's web ACL.

That list alone is something chapter 21's setup could not give you. For every account of the organization, you can see in one place how many distributions have no web ACL, and which ones. The documentation also recommends creating a policy with remediation off, looking at what would change, and enabling it afterwards. This chapter's stacks start with it off.

To turn it on, deploy again with `-c wafRemediation=on`. Firewall Manager creates a web ACL in the accounts in scope and associates it with the resources in scope. The web ACL is named `FMManagedWebACLV2-<policy name>-<timestamp>`. The name cannot be changed later, so renaming the policy does not rename the web ACL.

When a web ACL is created depends on `optimizeUnassociatedWebACL`. With `true`, one is created only when the account has at least one resource that will use it. With `false`, every account in scope gets one whether or not anything uses it. A web ACL has a monthly fee for existing, so this chapter sets `true`.

### A Resource That Already Has a Web ACL

When a distribution that comes into scope already has a web ACL its owner attached, as in chapter 21, what happens depends on the policy's settings.

By default Firewall Manager creates new web ACLs. When you enable automatic remediation, you can add the choice to remove existing web ACL associations that no other active Firewall Manager policy manages. In the API this is `overrideCustomerWebACLAssociation`. With it, Firewall Manager first associates the policy's web ACL and then removes the earlier association. In this chapter that is `-c replaceAccountWebAcls=on`.

Something is lost in the replacement. What gets associated is a different web ACL, so the rules the owner had written in the old one do not come along. Chapter 21's rate-based rule has to be written again by the owner, in the policy's web ACL, in the set for the account's own rules.

What happens to an owner's web ACL when this choice is not made could be read two ways in the documentation. The procedure for creating a policy presents replacement as a choice. The page on web ACL management, on the other hand, has a note saying that a customer-owned web ACL that a customer associates manually is still overridden by the policy's web ACL. Under which conditions each statement holds was not confirmed, so this chapter's model takes the conservative reading: without the choice, the original web ACL stays and the resource remains non-compliant. Check it in one account before enabling remediation in production.

There is one more way, which is to keep the existing web ACLs (setting `webACLSource` to `RETROFIT_EXISTING`). Firewall Manager inserts the policy's rule groups at the front and the end of the web ACL that is already attached. The conditions are that the web ACL belongs to the account and is associated only with resources in scope. This chapter's stack does not use this setting.

### A Resource That Leaves the Scope

When a resource leaves the scope, for example when the exemption tag is added, by default the web ACL stays on it. Protection continues, and the resource vanishes from the compliance report. With `ResourcesCleanUp` set to `true`, Firewall Manager removes the web ACL association from a resource that left the scope.

Which is right depends on what the exception means. If the exception says "this resource must not have the policy's web ACL", you want it removed. This chapter's stack sets `true`: the result of adding the exemption tag should be what the person adding it meant.

## The Security Group Audit Policy

<!-- section: 42.sg-audit -->

A content audit policy compares the rules of the security groups in scope with a reference. The reference can be written in two ways: by combining options Firewall Manager provides (managed policy rules), or by naming one security group to compare against (custom policy rules). This chapter uses the second. How to write the first through the API is shown in the reference only by a partial example, and could not be confirmed.

The security group used as the reference is called the audit security group. It is created in the administrator account and attached to nothing. Firewall Manager only reads it for comparison.

The direction of the audit is `ALLOW` or `DENY`. With `ALLOW`, every rule of a security group in scope has to be within the allowed range of the audit security group's rules. With `DENY` it is the reverse: no rule may match one of the audit rules.

<<< @/examples/42-firewall-manager/src/policies.ts{sg-audit}

This chapter's reference says that only HTTPS may be open to the whole internet. The audit security group has TCP port 443 from anywhere, and all traffic from the three private address blocks. An inbound rule of a security group in scope has to fit inside one of them.

That is a little stricter than "nothing but 443 open to 0.0.0.0/0". A rule that opens port 22 to a single office IP address fits inside none of the ranges, so it counts as non-compliant. If you need it, add the exemption tag or add that address to the audit security group. Adding it allows that address in every account.

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{audit-group}

A security group can exist only inside a VPC, so the stack creates one VPC with nothing in it. It has no subnet and no gateway, and nothing billed by the hour.

<<< @/examples/42-firewall-manager/src/managed-service-data.ts{audit-data}

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{audit-policy}

The ID of the audit security group is not known until the deploy. Inside CDK it is a token, so the schema lets a token through. A stack test checks that the synthesized template has an `Fn::GetAtt` where the ID belongs.

### The Same Rule, Applied Locally

A function applies the same reference to inbound rules locally.

<<< @/examples/42-firewall-manager/src/security-group-audit.ts{audit-rule}

The documentation goes as far as saying a rule must be "within the allowed range". This function reads that as follows: a rule is within a range when its source CIDR is contained in the allowed CIDR, the protocol is the same, and its port range is contained in the allowed port range. When the allowed side is all protocols, ports are not considered. Whether this reading matches Firewall Manager's decision was not confirmed.

There are three answers: compliant, non-compliant, and not evaluated. How Firewall Manager treats a rule whose source is another security group or a prefix list was not stated in the documentation that was read. Not putting an unknown into "compliant" is the same idea as chapter 21's `sec:posture` reporting an item it could not read as `unknown` instead of `off`.

<<< @/examples/42-firewall-manager/src/security-group-audit.ts{audit-group}

Outbound rules are not examined. How inbound and outbound rules are compared when an audit security group is used could not be read from the documentation either.

The function also works on synthesized templates. It reads rules written inline in a security group and rules written separately as `AWS::EC2::SecurityGroupIngress`.

<<< @/examples/42-firewall-manager/src/security-group-audit.ts{from-template}

### What Automatic Remediation Does to a Running Service

An audit policy cannot have automatic remediation enabled when it is created. It is always created with remediation off and changed afterwards. In this chapter that is a second deploy with `-c sgRemediation=on`.

Once enabled, Firewall Manager updates or removes the non-compliant rules. A service whose load balancer security group opens port 80 to the internet has that rule updated or removed. If it is removed, requests that arrived on port 80 stop arriving. Which rule would change, and how, can be seen before enabling, in the violation details of the compliance report. They show the violating rule, the audit rule it was compared with, the reason, and a suggested remediation.

Security groups managed with CDK run into one more problem. After Firewall Manager removes a rule, the stack's template still contains it. [Chapter 02](/en/chapters/02-toolchain.md)'s drift detection reports the difference, and the next deploy may put the rule back. If it does, Firewall Manager removes it again. The documentation warns about exactly this: when Firewall Manager and another tool manage the same security group, their remediations undo each other in a cycle. If you enable automatic remediation, the place to fix things is the code. Read the compliance report, fix the template, and keep automatic remediation as the last resort for what never went through the code.

Detection time varies as well. According to the documentation, a change to a security group on an EC2 network interface is usually detected within several hours, and can take as long as six. Some things are not covered at all. Network interfaces created by Amazon RDS are not supported, and Firewall Manager cannot update the security groups of network interfaces that belong to Fargate tasks or are managed by an AWS service.

## Until the Policy Arrives

<!-- section: 42.reconcile -->

The distributed-systems problem of this chapter is that the policy and the resources are in different places. There is one policy, in the administrator account, and there are resources in many accounts. The two are brought into agreement after the fact.

```figure
caption: From the creation of a distribution to a report that says compliant
type: sequence
actor owner: Account owner
actor resource: Distribution
actor config: AWS Config
actor manager: Firewall Manager
step owner -> resource: creates
note resource: no web ACL
step resource --> config: configuration recorded
step config --> manager: configuration change
note manager: report: NON_COMPLIANT
step manager -> resource: associates a web ACL
step resource --> config: configuration recorded
step config --> manager: configuration change
note manager: report: COMPLIANT
```

Whether a resource is protected right now is known in the member account the resource is in. What the administrator account has is a report built from the last configuration that reached it, a picture from a little while ago. From the moment a distribution is created until its configuration reaches Firewall Manager, the owner of the member account sees a distribution with no web ACL, and the administrator sees nothing.

This relationship became a small model.

<<< @/examples/42-firewall-manager/src/reconcile.ts{world}

<<< @/examples/42-firewall-manager/src/reconcile.ts{enforces}

The report is built only from the configurations that reached the administrator (`observed`). A resource that has not arrived is called neither compliant nor non-compliant.

<<< @/examples/42-firewall-manager/src/reconcile.ts{report}

The remediation plan is made from the observed configurations too.

<<< @/examples/42-firewall-manager/src/reconcile.ts{plan}

<<< @/examples/42-firewall-manager/src/reconcile.ts{apply}

The invariant the tests try to break is "no in-scope resource is reported compliant without the policy's rules in force".

In the model that sentence does not hold as written. Right after an owner swaps the web ACL, and until that change arrives, the report still says compliant. A test reproduces exactly that sequence and shows that there is a time when the report is off. The tests then check the invariant in the form in which it does hold.

- A resource the report calls compliant has the policy's first and last rule groups in force in the configuration the report was built from
- A resource whose configuration never arrived is not in the report
- The report and reality disagree only when the resource changed after its configuration arrived

To check the third, a test walks 2,000 steps from a fixed random seed. It mixes creating a resource, swapping a web ACL, adding and removing the exemption tag, delivering a configuration, and remediating, in a fixed order, and examines every row of the report after each step. The test decides "in force" on its own, without using the model's code. Loosening the model's decision on purpose made this test fail, which was checked too.

How long the gap lasts in the real service is something the documentation gives few numbers for. It says that creating a policy can take several minutes, and that after a change to a policy or to resources the compliance status may take several minutes to update. For security groups there is the six hours mentioned above. How long it takes for a new distribution to get its web ACL is not stated, and this book did not measure it.

The documentation adds one more caution. Firewall Manager learns of changes from AWS Config, so changing the state of a protection repeatedly at short intervals can make AWS Config miss some changes, and compliance or remediation state can be lost. If a status looks wrong, make sure no process keeps changing things, and then re-evaluate the AWS Config rule.

## Compliance Reports and Notifications

<!-- section: 42.compliance -->

Compliance is shown in the Firewall Manager console, per policy. First by account: the accounts in scope are divided into compliant and non-compliant. Choosing an account lists the ID, the type, and the reason for each non-compliant resource. For a content audit policy, choosing a resource shows the violation details.

For news to arrive without somebody going to look, you have to pick a path. As far as the documentation confirmed:

- There are no CloudWatch metrics. The documentation says Firewall Manager records no metrics, so no CloudWatch alarm can be made for it
- SNS receives messages once a notification channel is set. You name one SNS topic and one IAM role to publish with. No description of what the messages contain was found
- Security Hub CSPM receives findings for non-compliant resources automatically. With Security Hub enabled, nothing else has to be set up
- No statement was found that Firewall Manager itself sends events to EventBridge. Security Hub sends each finding it imports to EventBridge, and that is what this chapter uses

This chapter's stack prepares both the second and the third. The path through Security Hub is the one whose shape is documented, so it is the only one whose content is read and arranged.

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{channel}

The topic policy follows the example in the Firewall Manager documentation: it allows the administrator account's service-linked role to `sns:Publish`. According to the Organizations documentation, that role is created in the accounts of the organization when trusted access between Firewall Manager and Organizations is enabled. What happens when this stack is deployed to an account that does not have the role yet was not confirmed.

<<< @/examples/42-firewall-manager/src/finding.ts{event-pattern}

The rule picks up the "Security Hub Findings - Imported" events whose product name is Firewall Manager. That product name is the value the Firewall Manager documentation gives for filtering in Security Hub. It is case sensitive.

<<< @/examples/42-firewall-manager/src/finding.ts{event-schema}

The schema looks only at the fields the handler reads. The finding format (the AWS Security Finding Format) requires the account, the title, the description, the severity, the resources, and a few more. The compliance status and the product name are optional. A finding without the optional fields is announced with its status "not stated". It is pushed toward neither compliant nor non-compliant.

The test fixtures were written by this book from the documented format, not taken from a real account. What a Firewall Manager finding actually puts in the optional fields was not observed.

<<< @/examples/42-firewall-manager/src/finding.ts{summarize}

<<< @/examples/42-firewall-manager/src/notify.ts{notify}

An event that could not be read is not dropped. It is announced as unreadable. If the format changed and stopped matching the schema, silence would make missing notifications look like full compliance. A retry does not fix a shape, so the function does not fail.

<<< @/examples/42-firewall-manager/src/lambda.ts{handler}

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{notifier}

Two things about findings need attention. One is which account's Security Hub they arrive in. According to the Security Hub documentation, EventBridge in a Security Hub administrator account also carries the events for its member accounts' findings, and when an aggregation Region is set, findings from other Regions flow there too. In which account and Region a Firewall Manager finding originates was not confirmed. This stack's rule sees only events in the account it is deployed to, in the Tokyo Region. To pick up findings for the policy in us-east-1, place the same rule in us-east-1 as well, or configure aggregation in Security Hub.

The other is that a finding may never close. Firewall Manager does not update findings for deleted policies, deleted resources, or resources that left the scope. The finding for a resource that was taken out of scope with the exemption tag stays in Security Hub as non-compliant.
