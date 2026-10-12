---
title: "42 Firewall Manager: Run It Locally"
---

# 42 Firewall Manager: Run It Locally

## Run It Locally

<!-- section: 42.local -->

This page checks the models and the stacks from the [design and build page](/en/chapters/42-firewall-manager/build.md) without AWS. The chapter has no server to start locally. What runs is the tests, two scripts, and synth. No organization and no account is needed.

```bash
vp test run examples/42-firewall-manager
```

The tests are in seven files.

```text
file                                what it pins
test/scope.test.ts                  include and exclude maps, child OUs, AND and OR over tags, a resource created later, a resource that leaves by tag, quotas
test/security-group-audit.test.ts   CIDR containment, the audit rule, the three verdicts, rules read from a template
test/managed-service-data.test.ts   the JSON of both policies, unknown keys, WCU totals, the quota on rule groups
test/reconcile.test.ts              what the report says before and after an observation, the stale window, cleanup, a seeded walk of 2,000 steps
test/finding.test.ts                the finding event's shape, the notice it becomes, an unreadable event
test/cost.test.ts                   the month's arithmetic over data/pricing
infra/test/stacks.test.ts           both stacks: scope, resource types, the topic policy, the notifier's permissions, the context
```

Every fixture was written for this chapter. The account IDs in the organization fixture (`test/fixtures/organization.ts`) are repeated digits, and the OU IDs are strings that merely follow the pattern in the Organizations API reference. Nothing was taken from a real organization.

The cost arithmetic can be seen with the next task. It computes the monthly amount quoted on the [opening page](/en/chapters/42-firewall-manager.md) from the unit prices in `data/pricing/`.

```bash
vp run fwm:cost
```

```text
  100.00  fms.policy.global.wafv2  (1 AWS WAF policy for CloudFront (Global))
  100.00  fms.policy.apne1.sg-content-audit  (1 security group content audit policy in ap-northeast-1)
   15.00  waf.global.webacl  (3 accounts x 1 managed web ACL)
    6.00  waf.global.rule  (3 web ACLs x 2 rule groups)
    1.80  waf.global.request  (3 web ACLs x 1000000 requests inspected)
    0.24  config.use1.item.continuous  (4 accounts x 20 items in us-east-1)
    2.40  config.item.continuous  (4 accounts x 200 items in ap-northeast-1)
    0.30  config.use1.rule.evaluation  (3 accounts x 100 evaluations (AWS WAF policy))
    0.30  config.rule.evaluation  (3 accounts x 100 evaluations (audit policy))
  226.04  USD a month at list price

Not in the sum:
  - Security Hub CSPM, which the findings travel through
  - S3 storage for the configuration history AWS Config delivers
  - whether the policy fee is prorated for a policy that exists for part of a month
  - how the rule groups Firewall Manager places in a member web ACL are metered (counted here as one rule each)
  - the notifier's Lambda, SNS, EventBridge, and CloudWatch Logs usage
```

The items left out of the sum are printed by name, not as zero. What the numbers mean is explained on the [costs page](/en/chapters/42-firewall-manager/wrap.md).

The audit rule can also be applied to this book's own stacks.

```bash
vp run fwm:audit:templates
```

```text
compliant    AihEc2 InstanceSecurityGroup (examples/23-ec2/cdk.out)
incomplete   AihCelld NodeSecurityGroup (examples/24-celld/cdk.out)
             not-evaluated: the source is another security group
compliant    AihManagedInstances InstanceSecurityGroup896E10BF (examples/35-lambda-managed-instances/cdk.out)
compliant    AihDatabaseMigration ReplicationSecurityGroup (examples/39-database-migration/cdk.out)
incomplete   AihDatabaseMigration (group of SourceAllowsReplication) (examples/39-database-migration/cdk.out)
             not-evaluated: the source is another security group
incomplete   AihDatabaseMigration (group of TargetAllowsReplication) (examples/39-database-migration/cdk.out)
             not-evaluated: the source is another security group
compliant    AihFirewallManager AuditGroup (examples/42-firewall-manager/cdk.out)

46 templates, 4 groups compliant, 0 noncompliant, 3 with a rule this model does not evaluate.
```

This output is from a run on 2026-10-13, over the chapters that had a `cdk.out` at that moment. The task reads only the templates that each chapter's synth task wrote, and changes no file of another chapter. Chapters that have not been synthesized are not included, so the counts change from run to run.

`incomplete` marks a group with a rule whose source is another security group. The model does not evaluate such a rule, and that does not mean non-compliant. The task only reports and does not fail anything, because the practice stacks are not in an organization this policy would see.

Synthesizing the stacks needs an account ID and an OU ID. A task for checking the shape locally passes the example IDs that AWS's documentation uses.

```bash
vp run fwm:infra:synth:example
```

Running `vp run fwm:infra:synth` without arguments stops with an error about the missing context. That is intended.

### What Is Not Reproduced Locally

All that can be checked locally is that this chapter's code behaves as this chapter read the documentation. The following are not reproduced.

- Firewall Manager itself. The scope decision, the creation and association of web ACLs, the audit decision, and remediation are all models. Whether the service gives the same answers as the models is not known
- AWS Organizations. The OU hierarchy is what the fixture says
- AWS Config. The time a configuration change takes to arrive is one step, "deliver", in the tests. The real delay is not reproduced
- Security Hub CSPM and its findings. The events are fixtures
- Cloud Control API accepting `AWS::FMS::Policy`. The shape of the template was checked, but whether it is accepted is known only by deploying
