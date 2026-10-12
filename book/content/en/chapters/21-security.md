---
title: "21 Security: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations"
sourceRevision: 3
---

# 21 Security: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations

Earlier chapters put three things off until chapter 21: how to narrow chapter 01's `AdministratorAccess`, chapter 03's WAF, and chapter 04's rule that secrets don't go in environment variables. This chapter covers all three.

It does not switch on every AWS service with "security" in its name. It separates what an account used by one person needs from what you need once there are more people and more accounts, and it builds only the first group. For the second group it explains what each service is for and what it costs.

On cost: deployed with no options, this chapter's stack has one monthly fee, for a single secret (USD 0.40 a month, prorated by the hour). **A KMS key and a web ACL are billed every month just for existing, so they are created only when you ask for them explicitly.** GuardDuty, Inspector, and AWS Config are not in this chapter's stack. [Build, Continued](/en/chapters/21-security/more.md) explains why.

None of this chapter's AWS-side steps has been run against AWS yet. What was checked locally is the tests, the type check, the synth, and the local server, and the breakdown is in the [verification notes at the end of the chapter](/en/chapters/21-security/wrap.md).

The prerequisites are [chapter 06](/en/chapters/06-auth.md) and [chapter 20](/en/chapters/20-shipping.md). The pairing of CloudFront with a function URL was covered in [chapter 09](/en/chapters/09-ssr.md). The code is in `examples/21-security/`.

## What to enable, in order

<!-- section: 21.tiers -->

The "Security" category of the AWS console lists many services. If you enable all of them, your bill grows and so does the number of notifications nobody reads. If you enable none, a leaked key goes unnoticed.

This book sorts them into three tiers.

```text
tier            what                          what it costs                     how this chapter handles it
everyone        root MFA, no root access keys free                              sec:posture fails without them
                CloudTrail event history      free, always on, 90 days          sec:trail:iam reads it
                least-privilege roles         free                              wildcard lint in tests
                secrets out of env vars       per secret per month              default stack
with-data       GuardDuty (threat detection)  per event and GB, after a trial   console; sec:posture reports it
                Inspector (vulnerabilities)   per function, image, instance     console; sec:posture reports it
                AWS WAF on CloudFront         per web ACL and rule per month    opt-in stack AihSecurityWaf
                customer managed KMS key      per key per month                 opt-in: -c cmk=on
organization    CloudTrail trail              S3 storage                        explained, not created
                AWS Config                    per configuration item            explained, not created
                Organizations and SCPs        free                              policy JSON and tests only
```

The first tier (everyone) is what you do from the day you own the account, and it costs almost nothing. The second (with-data) is for when you hold data that must not leak or run a service that must not go down. The third (organization) is for when two or more people or accounts are involved.

These tiers are this book's judgment and not an official AWS classification, so move items earlier or later to suit your situation. What matters is that you can say you left a service out by choice and did not forget it.

This task shows where your account stands today.

```bash
vp run sec:posture
```

The task only reads and changes nothing. It queries six services and sorts the answers into the three tiers.

<<< @/examples/21-security/src/posture.ts{assess}

Drift detection in [chapter 02](/en/chapters/02-toolchain.md) treated "no difference found" and "everything compared and matched" as different states. This task follows the same idea: an item it could not read for lack of permission is `unknown`, not `off`.

<<< @/examples/21-security/src/posture.ts{snapshot}

The task fails only when a first-tier item is not `on`.

<<< @/examples/21-security/src/posture.ts{gate}

The task does not fail when GuardDuty is off. Leaving GuardDuty out can be a choice, but a root user without MFA is not one.

## The big picture

<!-- section: 21.architecture -->

The example is a small token API. `/token` issues a signed token and `/verify` checks it. The signing key is the secret this chapter protects.

```figure
caption: On the path from the viewer to the secret sit the WAF, the function's role, and the key that encrypts the secret, and CloudTrail records the management calls made on them
node viewer: Viewer | HTTPS, GET and HEAD only
node waf: Web ACL | AihSecurityWaf (us-east-1), only with -c webAclArn=...
node cf: CloudFront | distribution
node url: Lambda function URL | AuthType AWS_IAM, unsigned gets 403
node fn: Lambda function | HandlerRole
node secret: Secrets Manager secret
node key: KMS key | aws/secretsmanager, or customer managed with -c cmk=on
node trail: CloudTrail event history | CreateRole, PutSecretValue, ... for 90 days
edge viewer -> cf
edge waf -> cf
edge cf -> url: OAC signs with SigV4
edge url -> fn
edge fn -> secret: GetSecretValue, about every 5 min per environment
edge secret -> key: encrypted with
edge secret --> trail: management calls recorded
```

The parts of this figure are the topics of the chapter: the WAF at the entry point, the function's role, the secret and the key that encrypts it, and CloudTrail, which records what is done to them.

There are two stacks.

<<< @/examples/21-security/infra/bin/app.ts{stacks}

`AihSecurity` is the default stack, and `AihSecurityWaf` is created only when you deploy it by name. CDK context switches on the parts that carry a monthly fee.

<<< @/examples/21-security/infra/lib/config.ts{context}

As with `-c store=valkey` in [chapter 14](/en/chapters/14-kv-cache.md), passing nothing gives you the cheaper variant. A mistyped value such as `-c cmk=true` is not treated as off. It stops the synth, because a switch that costs money must not silently mean something else.

`reservedConcurrency` is the one switch that costs nothing. It is still off by default, because a new account can have a concurrency limit so low that reserving any concurrency gets the deploy refused. You can reserve up to the account's concurrency quota minus 100 ([chapter 32](/en/chapters/32-limits.md)). The [deploy page](/en/chapters/21-security/deploy.md) explains when to turn it on.

## Narrowing permissions

<!-- section: 21.least-privilege -->

When chapter 01 used `AdministratorAccess`, it said chapter 21 would cover how to narrow it. How you narrow permissions depends on whose they are.

**The permissions of running code** can be narrowed right now, and they are the first to narrow, because the function's role is what the code handling requests from the internet uses. The following code is every permission this chapter's function has.

<<< @/examples/21-security/infra/lib/security-stack.ts{role}

The function can write to its own log group and read one secret, and nothing else. It has neither `secretsmanager:*` nor access to every secret in the account. If the function's code has a hole, an attacker gets these three actions. This is what least privilege looks like in practice.

As in [chapter 20](/en/chapters/20-shipping.md), the permissions are written inline in the role. No AWS managed policy such as `AWSLambdaBasicExecutionRole` is attached, because, as chapter 04 showed, `AWSLambdaBasicExecutionRole` allows writing to any log group in the account.

**The permissions of people** are harder to narrow. This book's examples create IAM roles on every deploy. Anyone who can create a role can give that role any permission, so they are an administrator in effect. In a learning account, finely narrowing only the deployer's permissions gains you little.

A realistic order is this.

1. Hold no long-term access keys. Chapter 01 did this
2. Sign in with read-only permissions for everyday investigation, and switch to stronger permissions only to deploy
3. Move deploys from a person to a CI role. Chapter 20 did this, and the CI role can be used only from a fixed job in a fixed repository
4. If people still hold strong permissions, narrow them based on what they actually used

Step 4 has a dedicated feature. Policy generation in IAM Access Analyzer reads up to 90 days of CloudTrail records and produces a policy template that lists only the actions the role or user actually used. It needs a CloudTrail trail to read from, which is one reason to create a trail. Trails themselves are explained in [Build, Continued](/en/chapters/21-security/more.md). This book has not tried the feature.

One more safeguard works even on people with strong permissions: an SCP in Organizations, also covered in [Build, Continued](/en/chapters/21-security/more.md).
