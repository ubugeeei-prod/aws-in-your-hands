---
title: "21 Security: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations"
sourceRevision: 1
---

# 21 Security: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations

We've been saying "that's for chapter 21" for a while now. Narrowing chapter 01's `AdministratorAccess`. Chapter 03's WAF. Chapter 04's "secrets don't go in environment variables". This chapter takes all of them on.

It is not a chapter about switching on every AWS service with "security" in its name, though. The opposite. We'll separate what an account used by one person needs from what you need once people and accounts multiply, and build only the first group by hand. For the second, we'll pin down what each thing is for and what it costs.

Money first. With nothing specified, the only monthly fee in this chapter's stack is one secret (USD 0.40 a month, prorated by the hour). **A KMS key and a web ACL are billed every month just for existing, so they are created only when you explicitly ask.** GuardDuty, Inspector, and AWS Config are not in this chapter's stack at all. We'll get to why.

To be honest, none of the AWS-side steps in this chapter has been run for real yet. What was checked locally is the tests, the type check, the synth, and the local server. The breakdown is at the end.

The prerequisites are [chapter 06](/en/chapters/06-auth.md) and [chapter 20](/en/chapters/20-shipping.md). The CloudFront and function URL pairing first appeared in [chapter 09](/en/chapters/09-ssr.md). The code is in `examples/21-security/`.

## What to put in first

<!-- section: 21.tiers -->

Open "Security" in the AWS console and you get a long row of services. Enable them all and your bill grows, along with the notifications nobody reads. Do nothing and you won't notice a leaked key.

This book thinks about it in three tiers.

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

The first tier is what you do from the day you own the account. It costs next to nothing. The second is for once you hold data you'd hate to leak, or a service you'd hate to see down. The third is for once two or more people, or accounts, are involved.

This split is the book's judgment, not an official AWS classification. Move things earlier or later to fit your situation. What matters is being able to say that what you haven't enabled, you left out by choice and not by forgetting.

There's a task that shows where your account stands today.

```bash
vp run sec:posture
```

It only reads; nothing changes. It asks six services and lays the answers out in the three tiers.

<<< @/examples/21-security/src/posture.ts{assess}

Remember how drift detection in [chapter 02](/en/chapters/02-toolchain.md) kept "no difference found" apart from "everything compared and matched"? Same idea here. An item that couldn't be read for lack of permission is `unknown`, not `off`.

<<< @/examples/21-security/src/posture.ts{snapshot}

The task fails only when something in the first tier is not `on`.

<<< @/examples/21-security/src/posture.ts{gate}

GuardDuty being off does not fail the task. That is a choice. A root user without MFA is not a choice.

## The big picture

<!-- section: 21.architecture -->

The subject is a small token API. `/token` issues a signed token and `/verify` checks one. The key it signs with is this chapter's "secret".

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

From top to bottom, that is this chapter's table of contents. WAF at the entrance. The function's role. The secret and the key that encrypts it. And CloudTrail, recording what is done to all of them.

There are two stacks.

<<< @/examples/21-security/infra/bin/app.ts{stacks}

`AihSecurity` is the default stack. `AihSecurityWaf` is created only when you deploy it by name. The switches that add monthly fees are CDK context.

<<< @/examples/21-security/infra/lib/config.ts{context}

It's the same thinking as `-c store=valkey` in [chapter 14](/en/chapters/14-kv-cache.md). Nothing specified means the cheap variant. A slip such as `-c cmk=true` is not "treated as off"; it stops the synth. A switch that costs money should never quietly mean something else.

## Narrowing permissions

<!-- section: 21.least-privilege -->

When chapter 01 used `AdministratorAccess`, it said that narrowing it was for chapter 21. The answer depends on whose permissions you're narrowing.

**The permissions of running code** can be narrowed right now, and that is where to start. A function's role is what the code handling requests from the internet gets to use. These are all the permissions this chapter's function has.

<<< @/examples/21-security/infra/lib/security-stack.ts{role}

Write to its own log group. Read one secret. That's it. Not `secretsmanager:*`, and not every secret in the account. If this function's code has a hole, what an attacker gets is these three actions. This is what least privilege looks like in practice.

As in [chapter 20](/en/chapters/20-shipping.md), the permissions are written inline on the role. No AWS managed policy (such as `AWSLambdaBasicExecutionRole`) is attached. As chapter 04 showed, that one means "may write to any log group in the account".

**The permissions of people** are a harder story. This book's samples create IAM roles on every deploy. Someone who can create a role can give it anything, which makes them an administrator in effect. In a learning account, finely narrowing only the deployer's permissions buys little.

A realistic order goes like this.

1. Hold no long-term access keys. Chapter 01 did that
2. Sign in with read-only permissions for everyday looking around, and switch to strong permissions only to deploy
3. Move deploys from a person's hands to a CI role. Chapter 20 did that; that role can be used only from a fixed job of a fixed repository
4. If people still hold strong permissions, narrow them from what was actually used

There's a tool for step 4. IAM Access Analyzer's policy generation reads up to 90 days of CloudTrail records and produces a policy template listing only the actions that role or user really used. It needs a CloudTrail trail to read from, though, which is one of the reasons to create a trail that come up later. This book has not tried the feature.

There is one more brake that works even on people with strong permissions: an SCP in Organizations. That comes in the second half of the chapter.
