---
title: "21 Security: Design and Build"
---

# 21 Security: Design and Build

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
- `AihObservability` (chapter 19): two, `xray:PutTraceSegments` and `xray:PutTelemetryRecords`. CDK adds them for `lambda.Tracing.ACTIVE`

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
