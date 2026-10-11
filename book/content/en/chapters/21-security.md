---
title: "21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations"
sourceRevision: 1
---

# 21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations

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

```text
viewer
  | HTTPS, GET and HEAD only
  v
CloudFront distribution  <---- web ACL (AihSecurityWaf, us-east-1)   only with -c webAclArn=...
  | origin access control signs each origin request (SigV4)
  v
Lambda function URL, AuthType AWS_IAM      unsigned requests get 403 before the function runs
  v
Lambda function (HandlerRole)
  | secretsmanager:GetSecretValue on one secret, about once per 5 minutes per execution environment
  v
Secrets Manager secret  <---- encrypted with aws/secretsmanager, or a customer managed key with -c cmk=on

CloudTrail event history records the management calls above (CreateRole, PutSecretValue, ...) for 90 days
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

## An assertion that finds wildcards

<!-- section: 21.iam-lint -->

"Don't use `*`" is a rule that is easy to say and hard to keep. When something won't work and you're stuck, `Resource: "*"` makes it work.

So let a test keep watch. This function reads a synthesized template and reports every Allow that is too wide.

<<< @/examples/21-security/src/iam-lint.ts{lint}

It looks at six things.

- A wildcard in an action (`s3:*`, `s3:Get*`, `*`)
- A resource that is exactly `"*"`
- `Allow` combined with `NotAction` ("allow everything but these")
- `Allow` combined with `NotResource`
- Broad AWS managed policies (`AdministratorAccess`, `PowerUserAccess`, `...FullAccess`)
- A trust policy that lets anyone assume the role, with no condition

And a seventh. A policy it could not read does not pass; it is reported as `unreadable`. A shape it doesn't know is not "no problem".

`Deny` statements are skipped. A `*` in a `Deny` is usually exactly what was meant.

### Exceptions, with reasons

Some actions can't avoid `Resource: "*"`, though. `logs:DescribeLogGroups` on chapter 20's DriftRole was one. An operation that lists things has no ARN to narrow it to in the first place.

If the reaction is "then turn the lint off", we're back where we started. So exceptions go in a file, together with their reasons.

<<< @/examples/21-security/src/iam-lint.ts{exception}

An exception is one line saying "this action may have `Resource: "*"`", and the reason is mandatory. A reason shorter than 20 characters doesn't pass. The action can't contain a wildcard, so `logs:Describe*` can't wave a whole family through.

There's one more device. An exception nothing uses is an error too. The policy got fixed and no longer needs `*`, but the exception stayed behind: that is a hole that silently passes the next `*` someone adds.

From a CDK test, you call it like this.

<<< @/examples/21-security/src/iam-lint.ts{assert}

### Running it over the whole book

The lint is also a task. Hand it `cdk.out` directories and it reads every template inside.

```bash
vp run infra:synth
vp run sec:iam:lint examples/20-shipping/cdk.out examples/19-observability/cdk.out
```

This stays on your machine. It never touches AWS.

Given the `cdk.out` of every chapter in this book, 19 of the 21 templates passed with no exceptions (run locally on 2026-10-12). The other two need exceptions.

- `AihShipCi` (chapter 20's CI roles): five. These are the actions chapter 20 described as having no way to narrow the resource by ARN
- `AihObservability` (chapter 19): two, `xray:PutTraceSegments` and `xray:PutTelemetryRecords`. CDK adds them for `Tracing.ACTIVE`

For both, the exceptions went into the file only after checking, in the service reference AWS publishes, that the action defines no resource type at all.

<<< @/examples/21-security/policies/iam-lint-exceptions.json

Chapters 19 and 20 each pinned "`*` only for these actions" inside their own tests. This does the same thing. The difference is that the reason is now reviewable data and not a comment in a test.

Here is what the lint does not see. A partly narrowed pattern such as `arn:aws:logs:...:log-group:AihShipApi*` passes; whether that is narrow enough is for a person to read and decide. It does not look at resource-side policies either, such as S3 bucket policies or KMS key policies. A pass means "no Allow that is too wide was found in what was looked at".

## Keeping secrets out of environment variables

<!-- section: 21.secret -->

Chapter 04 said this: anyone who can see a function's configuration can read its environment variables, so secrets are fetched at run time. The Lambda documentation agrees, recommending Secrets Manager over environment variables for credentials and API keys.

First, create the secret.

<<< @/examples/21-security/infra/lib/security-stack.ts{secret}

The value is written nowhere. `generateSecretString` is an instruction: make a 64-character value and put it under `key` in a JSON object. Only that instruction goes into the template.

One note about cdkd here. CloudFormation generates this value on the AWS side. The pinned cdkd (0.296.28), reading its source, generates the value inside the cdkd process and passes it to `CreateSecret`. So for a moment the value passes through the memory of the machine doing the deploy. cdkd is built not to log it, but you can't say it "never existed anywhere". If that bothers you, rotate once after deploying. The procedure is coming up.

What the function receives is the secret's ARN, and nothing more.

<<< @/examples/21-security/src/env.ts{env}

CloudFormation does have a way to put the value itself into an environment variable: a dynamic reference, `{{resolve:secretsmanager:...}}`. Do that and the resolved value lands in the function's configuration, which takes us straight back to chapter 04. A test checks that this string is nowhere in the template.

### The reading side

The application doesn't know Secrets Manager directly. All it knows is this one line.

<<< @/examples/21-security/src/secret-source.ts{source}

What you pass to `read` is a staging label. Secrets Manager keeps a secret's values as versions and puts name tags on three of them: `AWSCURRENT` (the value now), `AWSPREVIOUS` (the one before), and `AWSPENDING` (mid-rotation). Read without naming one and you get `AWSCURRENT`.

The adapter that connects to the real thing is this much.

<<< @/examples/21-security/src/secrets-manager-source.ts{adapter}

Three details.

First, the response goes through a Zod schema. The SDK's type only says `SecretString?: string`; it promises nothing about the content being JSON or having a `key`.

<<< @/examples/21-security/src/secret-source.ts{payload}

Notice that the error messages don't include the value. Write "value is not JSON: `<value>`" and that line stays in your logs. The tests feed in malformed values and check that the error text does not contain them.

Second, a secret that has never been rotated has no `AWSPREVIOUS`. In that case the adapter returns `null`. That the error is named `ResourceNotFoundException` is an expectation from the API reference and the SDK's types, not something checked against the real service. If it is wrong, the exception propagates and loading the keys fails. It does not carry on silently.

Third, a missing permission becomes its own error. "Secrets Manager is down" and "not allowed to read" call for different responses. This connects to the IAM discussion in the second half.

### On your machine

```bash
vp run dev:sec
```

The local server makes up a key at every start and keeps it in memory. It doesn't call AWS, and there is no secret to put in `.env`.

<<< @/examples/21-security/src/compose.ts{compose}

There is deliberately no setting for reading the real Secrets Manager from your machine. A path that brings a production key down to a developer's laptop is better left unbuilt.

## Between the cache and a rotation

<!-- section: 21.keyring -->

Calling Secrets Manager on every request is slow, and it costs money (USD 0.05 per 10,000 API calls). AWS itself recommends caching the value on the client.

The official caching components are for Java, Python, .NET, Go, and Rust, though; none is listed for JavaScript. For Lambda there are the Parameters and Secrets Lambda Extension and Powertools for AWS Lambda. This chapter writes a small cache itself, because we want to watch what happens. That is not a recommendation to roll your own in production.

<<< @/examples/21-security/src/keyring.ts{keyring}

Caching creates one distributed-systems problem. Each Lambda execution environment holds its own cache, loaded at its own time. Now replace the secret. What happens?

```text
time   Secrets Manager          environment A              environment B
t0     v1 = AWSCURRENT          caches v1                  caches v1
t1     rotate:
       v2 = AWSCURRENT
       v1 = AWSPREVIOUS         still signs with v1        still signs with v1
t2                              cache expires, reloads
                                signs with v2
t3                                                         gets a token signed with v2
                                                           v2 is not in its cache -> reload -> accepts
t4                              gets a token signed by B
                                with v1 = AWSPREVIOUS
                                -> accepts
t5                                                         cache expires, reloads, signs with v2
```

Between t1 and t5, two keys are in use at once. A token signed with either must verify in either environment. Here is what we want to hold, in one sentence.

**An unexpired token verifies in every execution environment, whether it was issued before the rotation or after.**

Three devices make that work.

First, the token carries which version of the key signed it.

<<< @/examples/21-security/src/token.ts{sign}

Next, the verifying side holds both `AWSCURRENT` and `AWSPREVIOUS`. That is why A at t4 can accept a token signed with the old key.

Last, on seeing a version id it doesn't know, it reloads. That's B at t3. This is the slightly scary part: the version id is part of the token, so anyone can send any string. Call Secrets Manager for every made-up id and you're letting an attacker write your bill. So reloads have a minimum gap (30 seconds).

<<< @/examples/21-security/src/app.ts{check}

"Unknown version" and "wrong signature" get the same response, so nobody outside can probe which versions exist.

The tests share one clock and one secret among several execution environments. t3 and t4 in the diagram are tests as they stand. These orders are replayed as well.

- A thousand made-up version ids cause no extra reads from Secrets Manager. After 30 seconds, exactly one reload happens
- Fifty requests arriving together cause one load
- When Secrets Manager stops answering, verification continues with the keys already held, and the failed load is not retried on every request
- An environment that has never managed to read a key raises an error. The API then answers 503

And one test breaks the invariant on purpose. Rotate twice in a row and the first key falls out of `AWSPREVIOUS` too, so tokens signed with it stop verifying before they expire. The cache can't prevent that. The rotation procedure in the next section does.

## The rotation procedure

<!-- section: 21.rotation -->

Unlike a database password, this secret doesn't need "the other side's configuration" changed as well. It is a key we choose ourselves and use ourselves. So rotating is just writing a new value.

Called without staging labels, `PutSecretValue` puts `AWSCURRENT` on the new version and moves `AWSPREVIOUS` onto the version that was current. t1 in the diagram happens in one API call.

<<< @/examples/21-security/src/secrets-manager-source.ts{rotation-adapter}

`ClientRequestToken` is the key piece. According to the API reference, this value becomes the new version's id, and calling again with the same token and the same value succeeds and does nothing. With a different value, it fails.

Using that, the procedure takes the shape of "if it stops halfway, just run it again".

<<< @/examples/21-security/src/rotation.ts{rotate}

Let's walk through it.

It starts by reading the current labels. If `AWSCURRENT` is already this run's version id, the previous run succeeded and only its response was lost. Nothing to do. Go ahead and write anyway, and a second rotation runs under a new id, stepping right into the "twice in a row breaks it" case above.

Then it looks at the time since the last rotation. Until 10 minutes have passed, the token lifetime (5 minutes) plus the cache period (5 minutes), it refuses to rotate again. When a key has leaked you can't wait, so `--force` overrides it, on the understanding that some unexpired tokens will stop verifying.

After writing, it reads the labels once more. It confirms not that the call returned success, but that the labels are where they should be. The labels are what the verifiers see.

```bash
vp run sec:secret:versions
vp run sec:secret:rotate
```

`rotate` begins by printing this run's version id. If it fails because the response was lost, run it again with `--version-id <the id it printed>`. The new key is made inside the script and sent straight to Secrets Manager. It is never shown on screen or written to a file.

The tests replay a lost response in a fixed order. Let the write succeed, then throw. Run again with the same version id. Check that there was one write and that there are still two versions.

There is also a ceiling on how often you rotate. The API reference says not to call `PutSecretValue` at a sustained rate of more than once every 10 minutes. Secrets Manager keeps the 100 most recent versions but doesn't remove any created in the last 24 hours, so calling too fast runs into the version quota.

### Automatic rotation

Secrets Manager can also rotate automatically on a schedule. A Lambda function runs four steps: create a new version, set it in the other service, test it, and move the labels. For a database password, that is the proper way.

This chapter doesn't implement it. With no other service to update, two of the four steps would be empty. And the rotation function itself, holding permission to write the secret, becomes one more thing to protect.

## Whose key is it

<!-- section: 21.kms -->

Secrets Manager stores a secret encrypted with an AWS KMS key. You get to choose which key.

With nothing specified, it's the AWS managed key `aws/secretsmanager`: a key AWS creates and manages inside your account. It has no monthly fee. The KMS documentation says that unless you are required to control the key yourself, an AWS managed key is a good choice.

Add `-c cmk=on` and it becomes a key you create (a customer managed key).

<<< @/examples/21-security/infra/lib/security-stack.ts{key}

What you gain is authority over the key. You decide in the key policy who may use it. Disable the key, and even people with permission to read the secret can't. You can let another account use it.

What you lose is USD 1 a month, prorated by the hour, until you delete the key. And with automatic rotation on, each of the first and second rotations adds USD 1 a month, stopping at USD 3 a month from the third year.

The function gains a permission too, since reading a secret encrypted with a customer managed key takes permission to decrypt with that key. Look back at the code in the role section. `kms:Decrypt` carries a `kms:ViaService` condition. It means "usable only through Secrets Manager": the function can't call the key directly to decrypt something else.

Customer managed keys have one more, less expected side effect. According to the Inspector documentation, Inspector does not scan Lambda functions encrypted with customer managed keys. This chapter's function names no key for encrypting its environment variables, so it isn't affected, but a policy of "we hold every key ourselves" can take another protection away.

Deleting is different from ordinary resources as well. A KMS key does not go away at once. There is a waiting period of 7 to 30 days in which it can't be used and deletion can be cancelled, because data encrypted with the key can never be read again once the key is gone. The pinned cdkd schedules deletion with the number of days in the template (7 in this chapter).

For a personal account, the AWS managed key is enough. A customer managed key is for when you want to manage "who may decrypt" apart from the secret's permissions, when an audit asks for key management, or when you share across accounts.

## Entry points that can carry WAF, and ones that can't

<!-- section: 21.waf -->

AWS WAF inspects requests before they reach your application, and stops some. Its unit of configuration is called a web ACL.

It can't be attached just anywhere. This is the list in the official documentation (checked 2026-10-12).

- CloudFront distributions
- API Gateway REST APIs
- Application Load Balancers
- AppSync GraphQL APIs, Cognito user pools, App Runner services, Bedrock AgentCore Gateway, Verified Access instances, and Amplify

Of the entry points this book has used, API Gateway HTTP APIs (chapter 04) and Lambda function URLs (chapters 09 and 17) are not on that list. If you want WAF there, you put CloudFront in front and attach it to CloudFront. That is why this chapter's setup starts at CloudFront.

Attaching it to CloudFront is not enough by itself, however. If a back entrance is open, people come in that way.

<<< @/examples/21-security/infra/lib/security-stack.ts{entry}

Set the function URL's `AuthType` to `AWS_IAM` and have CloudFront's origin access control sign the requests: the same shape as chapter 09. Lambda refuses unsigned requests before the function runs. With no way around CloudFront, there is no way around the web ACL.

Putting an HTTP API behind CloudFront is something this book has neither implemented nor verified. If you do it, decide how the back entrance gets closed first.

Signing brings constraints of its own. CloudFront puts its signature in the `Authorization` header, so this API takes its token in a separate header, `x-aih-token`. And as chapter 09 explained, for POST and PUT the caller has to put the SHA-256 of the body in a header. This API sticks to GET and HEAD.

### The web ACL

<<< @/examples/21-security/infra/lib/waf-stack.ts{web-acl}

A web ACL for CloudFront is created in us-east-1, wherever the distribution's origin is. This stack stops at synth if you name any other Region.

There are three rules.

The first is a rate-based rule. Above 300 requests in five minutes from one IP address, it blocks. The difference from the rate limit in [chapter 14](/en/chapters/14-kv-cache.md) is where it sits. That one is inside the application, for sharing fairly. This one is in front of the application, for keeping Lambda from being invoked at all.

Don't expect precision. According to the documentation, AWS WAF estimates the rate about every 10 seconds and limits "near" the limit you set, with no guarantee of an exact match. From crossing the limit to the block starting usually takes under 30 seconds, and can take several minutes. Requests in that interval get through.

The second and third are managed rule groups that AWS maintains: a list of IP addresses with a bad reputation, and the core rule set, a collection of common attack patterns.

The core rule set starts out as `count`. It doesn't stop anything; it only counts what it would have stopped. This rule group contains rules such as one that blocks bodies over 8 KB, and it can stop legitimate requests. AWS also recommends watching in count mode against production traffic before enabling. Switching to block is `-c wafCommonRules=block`.

### Attaching it

The stacks live in two Regions, so there are two steps.

```bash
vp run sec:waf:infra:deploy
vp run sec:infra:deploy -c webAclArn=<the WebAclArn output>
```

The web ACL's monthly fee begins the moment the first line runs, attached to a distribution or not.

The price is USD 5 a month per web ACL, USD 1 a month per rule (a managed rule group counts as one), and USD 0.60 per million requests inspected. For this chapter's setup that is USD 8.00 a month with no requests at all, and USD 8.60 with a million. Add-on rule groups such as Bot Control carry their own monthly and per-request fees, so they are not included. A test pins that they are absent.

Detaching goes in reverse. First `sec:infra:deploy` without `webAclArn` to take it off the distribution, then `sec:waf:infra:destroy`.

## IAM changes don't arrive at once

<!-- section: 21.iam-consistency -->

This chapter's distributed-systems story is IAM.

The IAM documentation has a passage like this. As a service accessed through computers in data centers around the world, IAM uses a distributed computing model called eventual consistency. A change takes time to become visible from all possible endpoints. There is caching too, so a change might not be visible until the old data times out.

In other words, a call right after adding a permission to a role can be denied. A call right after removing one can go through. The documentation gives no number for how long, and this book has not measured it.

AWS recommends two things. Don't put IAM changes in the middle of work that must not stop. And verify that a change has propagated before depending on it.

### After granting

A deploy creates a role and immediately runs a function as that role. That is "right after a change" exactly. So the smoke script does not treat a single refusal as failure.

<<< @/examples/21-security/src/propagation.ts{until-allowed}

Only refusals are retried. Other errors won't be fixed by waiting, so they are raised at once. And there is a cap on attempts. If it is still refused at the cap, that is no longer propagation delay; it's a mistake in the policy. Somewhere you have to draw the line between "waiting fixes it" and "waiting doesn't".

The function, for its part, answers 503 with `retry-after` when it lacks permission to read the secret.

<<< @/examples/21-security/src/app.ts{unavailable}

<<< @/examples/21-security/scripts/smoke.ts{wait-for-iam}

To be honest, whether a 503 actually comes back right after a deploy has not been checked. Maybe it doesn't. If it doesn't, this wait is never used, and does no harm.

### After revoking

The other direction is the dangerous one. When a key has leaked or a role has been taken over, people remove the permission, try once, see the refusal, and relax.

<<< @/examples/21-security/src/propagation.ts{until-denied}

One refusal means only that this one request reached an endpoint that knows about the change. This function doesn't say "stopped" until several refusals in a row. The test replays denied, allowed, denied, denied, denied, and checks that the first denial is not taken as confirmation.

Even so, it can't say more than "refused several times in a row". When it is really urgent, remove the permission and also change the thing being protected. In this chapter, that means rotating the secret (with `--force`). Once the leaked key is no longer the right key, how far IAM has propagated stops mattering.

No task in this chapter calls this function. The steps for trying it are in the resume notes of the verification records.

### CloudTrail knows when you changed it

```bash
vp run sec:trail:iam
```

It lists the changes made to IAM in the last 24 hours: who, when, and which operation. After a deploy you should see `CreateRole` and `PutRolePolicy` lined up.

One catch. IAM is a global service, and its events are recorded in us-east-1. Search the Tokyo Region's event history as long as you like and IAM changes won't appear. This task goes to us-east-1 from the start.

And the time shown is when the API was called. It is not when the change took effect at every endpoint.

## The watchers each look at something different

<!-- section: 21.detect -->

Four names that blur together, side by side.

```text
service      question it answers                          looks at                               result
Inspector    does my code have known vulnerabilities?     Lambda packages, ECR images, EC2       findings per CVE
GuardDuty    is someone acting like an attacker?          CloudTrail events, VPC flow, DNS logs  findings per suspicious activity
CloudTrail   who called which API, and when?              every management API call              events, 90 days free
AWS Config   what did this resource look like last week?  resource configurations over time      configuration items
```

"Inspector or GuardDuty, which one do I need?" is a common question, but they are different things.

**Inspector** is vulnerability scanning. It examines the packages inside your Lambda functions, the container images in ECR, and EC2 instances for known vulnerabilities (CVEs). It doesn't look at whether an attack is happening. It rescans when you deploy a function, and when a new CVE is published. For a setup like this book's, which bundles dependencies into Lambda, it is how you notice a vulnerability found after you deployed.

**GuardDuty** is threat detection. It analyzes CloudTrail events and records of VPC traffic to find suspicious behavior: leaked credentials being used from somewhere unfamiliar, traffic that looks like cryptocurrency mining. It doesn't look at whether your code has holes.

**CloudTrail** is the record. It makes no judgments. Event history is on from the start and holds 90 days of management events, per Region, for free. When you want to keep more than 90 days, search them in S3, or let Access Analyzer read them, you create a trail. Delivering the first copy of management events to S3 is free; what you pay is the S3 storage.

**AWS Config** is the history of resource configurations. It answers "when did this security group change, and how?". Drift detection in [chapter 02](/en/chapters/02-toolchain.md) asked "does it differ from the code right now?". Config asks "how has it changed over time?". It charges for every configuration item it records.

### Why they are not in the stack

GuardDuty and Inspector sit in the second tier. Once you have something to protect, they are worth enabling. But they are not in this chapter's CDK, for three reasons.

One. Both are a single setting per account and Region. They shouldn't be switched off just because a practice stack was deleted.

Two. Their defaults are broad. According to the GuardDuty documentation, enabling it for the first time turns on, by default, every protection plan available in that Region. Enabling Inspector from the console likewise starts every type of scan. You should decide while looking at the screen that shows what got enabled.

Three. You can't know the price until you use them. Both have a free trial (30 days for GuardDuty, 15 for Inspector), and during it the console estimates what a month would cost if you carried on. Deciding after seeing that number is the most reliable way.

So the procedure is: enable in the console, then confirm with `vp run sec:posture`. The same treatment as root MFA in chapter 01. It is also the case that the pinned cdkd has no dedicated implementation for a GuardDuty detector.

To be honest, this section comes from reading the documentation only. Neither service has been enabled. We haven't seen what a finding looks like, either.

## Once you are an organization

<!-- section: 21.organizations -->

While one person uses one account, what we have so far is enough. More people and more accounts bring a different problem: you can no longer rely on everyone configuring things correctly.

AWS Organizations groups several accounts into one organization, at no additional charge. The account that creates the organization becomes the management account. It consolidates the billing and can attach policies to the other accounts (member accounts).

Chapter 20 said that as long as dev and prod sit in one account, they are separated by name only. This is what lies beyond that.

### An SCP grants nothing

An SCP (service control policy) sets the upper bound on what the IAM users and roles of a member account can be allowed. It looks just like an IAM policy, but it works differently.

An SCP grants no permission. It only sets the limit.

<<< @/examples/21-security/src/policy-model.ts{decide}

This is a small model, for testing, of how IAM and SCPs combine. It is not IAM's real evaluation. But the point fits in three lines.

- An explicit `Deny` anywhere means denied
- The SCPs at every level, from the root through each OU to the account, must allow it
- And the principal's own IAM policy must allow it too; only then is it allowed

The second line is where people new to SCPs have their accident. When SCPs are turned on, Organizations attaches an "allow everything" SCP named `FullAWSAccess` at every level. Detach it and replace it with an SCP made only of `Deny`, and there is no SCP left that allows anything: nothing works in that account. The tests include that sequence.

One more caution. SCPs don't apply to the management account, nor to service-linked roles. That is why you don't do everyday work in the management account.

### First guardrails

<<< @/examples/21-security/policies/scp-guardrails.json

All four statements are `Deny`. They are layered on top of `FullAWSAccess`, which stays attached.

1. Nobody leaves the organization
2. Nobody stops the audit records: the CloudTrail trail, the GuardDuty detector, the Config recorder
3. Nothing happens in Regions this book doesn't use. It has the same shape as the example in the AWS documentation, excluding global services with `NotAction`. The exclusion list here is just the four from that example; the example policy AWS publishes lists about forty services. Add the ones you use
4. The root user of a member account does nothing

The first three work even on someone with administrator permissions. Still holding chapter 01's `AdministratorAccess`, you can no longer stop the trail. That is the other answer to "how do I narrow it".

The tests run this JSON through the model.

- Even an administrator is denied `cloudtrail:StopLogging` and `organizations:LeaveOrganization`
- Even an administrator is denied `ec2:RunInstances` in `eu-west-1`. In `ap-northeast-1` it goes through
- Someone with no IAM policy can do nothing, even when the SCPs allow everything
- A statement containing `Principal` fails to load (SCPs can't have one)
- Without whitespace, it is shorter than the SCP limit of 10,240 characters
- A policy with a condition the model doesn't know is refused. An unknown condition is never treated as true

### This is not built with CDK

Organizations and SCPs are not in this chapter's stack. There is no task for them.

Creating an organization, moving accounts, attaching SCPs: each one changes the structure of real accounts, and unlike a practice stack, deleting does not put things back. Attach a wrong SCP to the root and every account stops. AWS strongly recommends not attaching SCPs to the root right away, but creating a dedicated OU and moving accounts in one at a time to test.

So what this chapter hands you is the policy JSON and the tests to run before attaching it. The attaching is yours: your organization, the OU you choose, your hands.

The model has limits. It knows two conditions, `aws:RequestedRegion` and `aws:PrincipalArn`, and it doesn't match resources. "The tests passed" means "within this model, it is written as intended". It has not been attached to a real organization.

## Deploy and check

<!-- section: 21.deploy -->

For the default stack alone, the flow is the usual one.

```bash
vp run sec:infra:diff
vp run sec:infra:deploy
vp run sec:smoke
```

`sec:smoke` checks, against the CloudFront URL and in order, `/health`, issuing a token, verifying it, refusal of a token with an edited signature, and refusal of POST. Issuing a token reads Secrets Manager once (a billed API call).

Have a look, too, that the function URL can't be called directly. Find the function's URL in the Lambda console and call it with `curl`; you should get 403.

```bash
vp run sec:infra:drift
```

Every resource type in this stack is one the pinned cdkd has a dedicated implementation for. What drift can compare, and how far, is unknown because it hasn't been run. One thing in advance: a rotation is not drift. The secret's value is not in the template, so there is nothing to compare it to.

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
