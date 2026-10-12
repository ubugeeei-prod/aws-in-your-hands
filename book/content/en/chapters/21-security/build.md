---
title: "21 Security: Design and Build"
---

# 21 Security: Design and Build

This page implements parts of the setup shown on the [first page](/en/chapters/21-security.md): a test that watches how wide the permissions are, then reading the secret, caching it, rotating it, and the key that encrypts it.

## An assertion that finds wildcards

<!-- section: 21.iam-lint -->

"Don't use `*`" is an easy rule to state and a hard one to keep, because when something refuses to work, `Resource: "*"` makes it work.

So a test keeps watch. The following function reads a synthesized template and reports every Allow that is too wide.

<<< @/examples/21-security/src/iam-lint.ts{lint}

It reports six things.

- A wildcard in an action (`s3:*`, `s3:Get*`, `*`)
- A resource that is exactly `"*"`
- `Allow` combined with `NotAction` (which allows everything except the listed actions)
- `Allow` combined with `NotResource`
- Broad AWS managed policies (`AdministratorAccess`, `PowerUserAccess`, `...FullAccess`)
- A trust policy that lets anyone assume the role, with no condition

In addition, a policy it could not read does not pass. It is reported as `unreadable`, so that a policy in an unknown shape is never judged to be fine.

`Deny` statements are not checked, because a `*` in a `Deny` is usually intended.

### Exceptions, with reasons

Some actions can't avoid `Resource: "*"`. `logs:DescribeLogGroups` on chapter 20's DriftRole is one example. An operation that lists things has no ARN to narrow it to.

Turning the lint off for that reason would leave nothing watching again. Exceptions are written to a file instead, each with its reason.

<<< @/examples/21-security/src/iam-lint.ts{exception}

An exception is one line saying that an action may have `Resource: "*"`, and the reason is required. A reason shorter than 20 characters is rejected. The action can't contain a wildcard, so an entry like `logs:Describe*` can't let a whole family of actions through.

An exception that nothing uses is also an error. If a policy is fixed and no longer needs `*` but its exception stays behind, that exception silently passes the next `*` someone adds.

A CDK test calls the lint like this.

<<< @/examples/21-security/src/iam-lint.ts{assert}

### The result for every chapter in the book

The lint is also a task. Give it `cdk.out` directories and it reads every template inside them.

```bash
vp run infra:synth
vp run sec:iam:lint examples/20-shipping/cdk.out examples/19-observability/cdk.out
```

The task runs entirely on your machine and never touches AWS.

Given the `cdk.out` of every chapter in this book, 19 of the 21 templates passed with no exceptions (run locally on 2026-10-12). The other two needed exceptions.

- `AihShipCi` (chapter 20's CI roles): five. These are the actions chapter 20 described as having no way to narrow the resource by ARN
- `AihObservability` (chapter 19): two, `xray:PutTraceSegments` and `xray:PutTelemetryRecords`, which CDK adds for `lambda.Tracing.ACTIVE`

Each of these went into the exceptions file only after checking, in the service reference AWS publishes, that the action defines no resource type at all.

<<< @/examples/21-security/policies/iam-lint-exceptions.json

Chapters 19 and 20 each pinned "`*` only for these actions" inside their own tests. The exceptions file does the same thing, except that the reason is now data you can review and not a comment in a test.

The lint also leaves some things unchecked. It passes a partly narrowed pattern such as `arn:aws:logs:...:log-group:AihShipApi*`, and whether that pattern is narrow enough is for a person to read and decide. It does not check resource-side policies such as S3 bucket policies or KMS key policies. A pass means that no Allow that is too wide was found in what the lint checked.

## Keeping secrets out of environment variables

<!-- section: 21.secret -->

As chapter 04 said, anyone who can see a function's configuration can read its Lambda environment variables, so the function fetches secret values at run time. The Lambda documentation also recommends Secrets Manager over environment variables for credentials and API keys.

The first step is to create the secret.

<<< @/examples/21-security/infra/lib/security-stack.ts{secret}

The value is not written anywhere. `generateSecretString` is an instruction to generate a 64-character value and store it under `key` in a JSON object, and only that instruction goes into the template.

cdkd behaves differently from CloudFormation here. CloudFormation generates the value on the AWS side. The pinned cdkd (0.296.28), according to its source, generates the value inside the cdkd process and passes it to `CreateSecret`. The value therefore passes briefly through the memory of the machine that runs the deploy. cdkd is built not to log it, but you can't say the value never existed anywhere else. If that concerns you, rotate the secret once after deploying. The steps are under "The rotation procedure" on this page.

The function receives only the secret's ARN.

<<< @/examples/21-security/src/env.ts{env}

CloudFormation also has a way to put the value itself into an environment variable, a dynamic reference written `{{resolve:secretsmanager:...}}`. If you use it, the resolved value ends up in the function's configuration, which is the situation chapter 04 avoided. A test checks that this string does not appear in the template.

### The reading side

The application does not know about Secrets Manager directly. It knows only this interface.

<<< @/examples/21-security/src/secret-source.ts{source}

The argument to `read` is a staging label. Secrets Manager keeps a secret's values as versions and labels three of them: `AWSCURRENT` is the current value, `AWSPREVIOUS` is the one before it, and `AWSPENDING` is a value in the middle of a rotation. A read that names no label returns `AWSCURRENT`.

This is the adapter that connects to Secrets Manager.

<<< @/examples/21-security/src/secrets-manager-source.ts{adapter}

The adapter takes care over three points.

First, the response goes through a Zod schema, because the SDK's type says only `SecretString?: string` and guarantees neither that the content is JSON nor that it has a `key`.

<<< @/examples/21-security/src/secret-source.ts{payload}

The error messages leave the value out. A message like "value is not JSON: `<value>`" would put the value in your logs. The tests feed in malformed values and check that the error text does not contain them.

Second, a secret that has never been rotated has no `AWSPREVIOUS`, and in that case the adapter returns `null`. The error name it expects, `ResourceNotFoundException`, comes from the API reference and the SDK's types and has not been checked against the real service. If the expectation is wrong, the exception propagates and loading the keys fails. The adapter does not carry on silently.

Third, a missing permission becomes its own error, because "Secrets Manager is down" and "not allowed to read" call for different responses. [Build, Continued](/en/chapters/21-security/more.md) uses this error when it waits for an IAM change to propagate.

### Running it locally

```bash
vp run dev:sec
```

The local server generates a key each time it starts and keeps it in memory. It does not call AWS, and there is no secret to put in `.env`.

<<< @/examples/21-security/src/compose.ts{compose}

The example deliberately provides no setting for reading the real Secrets Manager from your machine. It is safer to have no path that brings a production key down to a developer's laptop.

## Between the cache and a rotation

<!-- section: 21.keyring -->

Calling Secrets Manager on every request is slow and costs money (USD 0.05 per 10,000 API calls). AWS also recommends caching the value on the calling side.

The official caching components are for Java, Python, .NET, Go, and Rust, and none is listed for JavaScript. For Lambda there are the Parameters and Secrets Lambda Extension and Powertools for AWS Lambda. This chapter writes a small cache of its own, because the aim is to see what happens when you cache. That is not a recommendation to write your own in production.

<<< @/examples/21-security/src/keyring.ts{keyring}

A cache introduces a distributed-systems problem. Each Lambda execution environment holds its own cache, and each loaded it at a different time. The next figure shows what happens when the secret is replaced in that state.

```figure
caption: After a rotation, two execution environments that loaded their caches at different times sign with different keys for a while
type: sequence
actor sm: Secrets Manager
actor a: Environment A
actor b: Environment B
note sm: t0: v1 = AWSCURRENT
note a: caches v1
note b: caches v1
step sm -> sm: t1: rotate, v2 = AWSCURRENT
note sm: v1 = AWSPREVIOUS
note a: still signs with v1
note b: still signs with v1
step a -> sm: t2: cache expires, reloads
note a: signs with v2
step a -> b: t3: token signed with v2
step b -> sm: v2 not in cache, reloads
note b: accepts
step b -> a: t4: token signed with v1
note a: v1 = AWSPREVIOUS, accepts
step b -> sm: t5: cache expires, reloads
note b: signs with v2
```

Between t1 and t5, two keys are in use at once. A token signed with either key has to verify in either environment. The invariant to keep is this one sentence.

**An unexpired token verifies in every execution environment, whether it was issued before the rotation or after it.**

The code does three things to keep it.

First, the token records which version of the key signed it.

<<< @/examples/21-security/src/token.ts{sign}

Second, the verifying side holds both `AWSCURRENT` and `AWSPREVIOUS`. That is why A can accept a token signed with the old key at t4 in the figure.

Third, an environment that sees a version id it doesn't know reloads, as B does at t3. This carries a risk. The version id is part of the token, so anyone can send any string. If every made-up id caused a call to Secrets Manager, an attacker could run up your bill at will. Reloads therefore have a minimum interval of 30 seconds.

<<< @/examples/21-security/src/app.ts{check}

"Unknown version" and "wrong signature" get the same response, so that nobody outside can probe which versions exist.

The tests share one clock and one secret among several execution environments. t3 and t4 in the figure are tests as they stand. The tests also reproduce these cases.

- A thousand made-up version ids cause no extra reads from Secrets Manager. After 30 seconds, exactly one reload happens
- Fifty requests arriving together cause one load
- When Secrets Manager stops answering, verification continues with the keys already held, and the failed load is not retried on every request
- An environment that has never read a key raises an error, and the API answers 503

One test breaks the invariant on purpose. After two rotations in a row, the first key is no longer even `AWSPREVIOUS`, so tokens signed with it stop verifying before they expire. The cache can't prevent that, so the next section prevents it in the rotation procedure.

## The rotation procedure

<!-- section: 21.rotation -->

This secret is a key that the service both chooses and uses, so unlike a database password, nothing has to change on another system. Rotating it only takes writing a new value.

Called without staging labels, `PutSecretValue` puts `AWSCURRENT` on the new version and moves `AWSPREVIOUS` to the version that was `AWSCURRENT` until then. One API call produces t1 in the figure of the two environments.

<<< @/examples/21-security/src/secrets-manager-source.ts{rotation-adapter}

The important part is `ClientRequestToken`. According to the API reference, this value becomes the new version's id, and a second call with the same token and the same value succeeds without doing anything. With a different value, it fails.

That property makes it possible to write a procedure you can simply run again if it stops halfway.

<<< @/examples/21-security/src/rotation.ts{rotate}

Here is what the code does, in order.

It starts by reading the current labels. If `AWSCURRENT` is already this run's version id, the previous run succeeded and only its response was lost, so there is nothing to do. Writing without this check would start a second rotation under a new id and create the "two in a row" breakage from the previous section.

Next it looks at the time since the last rotation. It refuses another rotation until 10 minutes have passed, which is the token lifetime (5 minutes) plus the cache period (5 minutes). A leaked key can't wait, so `--force` skips the refusal. In that case some unexpired tokens stop verifying.

After writing, it reads the labels once more. What it confirms is not that the call returned success but that the labels are where they should be, because the labels are what the verifying side sees.

```bash
vp run sec:secret:versions
vp run sec:secret:rotate
```

`rotate` starts by printing this run's version id. If it fails because the response was lost, run it again with `--version-id <the id it printed>`. The script generates the new key and sends it straight to Secrets Manager. It never prints the key or writes it to a file.

The tests reproduce a lost response in a fixed order. They let the write succeed and then throw, run again with the same version id, and check that there was one write and that there are still two versions.

There is also a limit on how often you can rotate. The API reference says not to call `PutSecretValue` at a sustained rate of more than once every 10 minutes. Secrets Manager keeps the 100 most recent versions but does not remove versions created in the last 24 hours, so calling too fast reaches the version quota.

### Automatic rotation

Secrets Manager can also rotate a secret automatically at a set interval. A Lambda function runs four steps: create a new version, set it in the other service, test it, and move the labels. For a database password, that is the standard approach.

This chapter does not implement it. There is no other service to update, so two of the four steps would be empty. The rotation function would also hold permission to write the secret, which makes it one more thing to protect.

## Who owns the key

<!-- section: 21.kms -->

Secrets Manager stores a secret encrypted with an AWS KMS key, and you can choose which key.

With nothing specified, it uses the AWS managed key `aws/secretsmanager`. AWS creates and manages this key inside your account, and it has no monthly fee. The KMS documentation says that unless you are required to control the key yourself, an AWS managed key is a good choice.

With `-c cmk=on`, the secret uses a key you create, called a customer managed key.

<<< @/examples/21-security/infra/lib/security-stack.ts{key}

A customer managed key lets you decide how the key is handled. You decide in the key policy who may use it. If you disable the key, even people with permission to read the secret can no longer read it. You can also let another account use it.

In return it costs USD 1 a month, prorated by the hour, until you delete the key. With automatic rotation enabled, the first and second rotations each add USD 1 a month, and the fee stops at USD 3 a month from the third year.

The function also needs one more permission, because reading a secret encrypted with a customer managed key requires permission to decrypt with that key. In the role code under ["Narrowing permissions" on the first page](/en/chapters/21-security.md), `kms:Decrypt` has a `kms:ViaService` condition. The condition means the key can be used only through Secrets Manager, so the function can't call the key directly to decrypt something else.

Customer managed keys also have a side effect that is easy to miss. According to the Inspector documentation, Inspector does not scan Lambda functions encrypted with customer managed keys. This chapter's function names no key for encrypting its environment variables, so it is not affected, but a policy of holding every key yourself can remove another protection.

Deletion differs from other resources too. A KMS key is not deleted at once. There is a waiting period of 7 to 30 days, during which the key can't be used and the deletion can be cancelled. The waiting period exists because data encrypted with the key can never be read again once the key is gone. The pinned cdkd schedules the deletion with the number of days given in the template (7 in this chapter).

For a personal account, the AWS managed key is enough. A customer managed key is for when you want to manage who may decrypt separately from the secret's permissions, when an audit requires key management, or when you share across accounts.
