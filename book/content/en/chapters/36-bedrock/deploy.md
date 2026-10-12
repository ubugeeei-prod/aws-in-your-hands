---
title: "36 Bedrock: Deploy"
---

# 36 Bedrock: Deploy

Here you prepare to put the application you ran [locally](/en/chapters/36-bedrock/local.md) on AWS. The stack builds on chapter 17's and adds two tables and a guardrail. At the time of writing, this stack has not been deployed.

## Preparing for AWS

<!-- section: 36.infra -->

### Knowing who called

The entry point is the same as in chapter 17, a Lambda function URL. Its authentication is `AWS_IAM`, so Lambda checks the SigV4 signature before it runs the function.

In chapter 17 the signature only decided whether the caller may call. Here it has a second job. Having checked the signature, Lambda writes who signed into the event. That value becomes the owner of the notes the tools read.

<<< @/examples/36-bedrock/src/identity.ts{function-url}

The owner is not taken from a header or from the body of the request. A caller can write anything there. `requestContext.authorizer.iam` in the event is written by Lambda, and a caller cannot write to it.

Built this way, a user is "someone who can sign with AWS credentials", not a user of chapter 06's user pool. For users in a browser, replace the application's `authenticate` with an implementation that verifies chapter 06's access token. The application still has chapter 06's interface, where each entry point passes in its own implementation, so neither the tools nor the loop change. How to build that entry point is described in chapter 17's notes for production.

Chapter 17's adapter hands the application a `Request` and nothing else. This chapter needs the event too, so it wraps the adapter thinly.

<<< @/examples/36-bedrock/src/function-url.ts{adapter}

<<< @/examples/36-bedrock/src/lambda.ts{handler}

### The guardrail

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{guardrail}

A guardrail is made of two resources. `AWS::Bedrock::Guardrail` is the configuration, and `AWS::Bedrock::GuardrailVersion` is that configuration at one moment, given a number. The function receives the ID and the number as environment variables.

The default configuration has sensitive information filters only. With `-c promptAttackFilter=standard`, the prompt attack filter, the Standard tier, and the `apac.guardrail.v1:0` profile are added. As the [build page](/en/chapters/36-bedrock/more.md) said, with this setting text may leave Japan to be checked.

### Permissions

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{role}

The permissions for the model have the same form as in chapter 17: one profile, and the models it routes to, allowed only by way of that profile.

These are the permissions added since chapter 17.

`bedrock:ApplyGuardrail` is needed for a call with a guardrail attached, and its resource is this stack's one guardrail. With the Standard setting, the guardrail profile is listed too, for each destination Region. As with the model's profile, leaving one out makes calls fail only when they are routed to that Region.

On the notes table only `GetItem` and `Query` are allowed. The rule that tools only read is written in both the code and IAM. Even if someone changed the code and added a tool that writes, this role could not write.

On the usage table `GetItem` and `UpdateItem` are allowed.

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{usage-table}

A day's item is of no use once the day is over. `expiresAt` is the TTL attribute, so DynamoDB removes the item once 35 days have passed.

### The function

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{function}

The model ID, the guardrail's ID and number, the limits, and the budget are all passed as environment variables. The function's code does not know which model it calls. In a deploy that changes the model, what changes is the value of an environment variable and the ARNs in IAM.

### cdkd and the resource types

The stack has 9 resources of 8 types. How the pinned cdkd (0.296.28) handles them was checked by reading its distributed files. `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Lambda::Url`, `AWS::DynamoDB::Table`, and `AWS::Logs::LogGroup` have their own implementations. `AWS::Bedrock::Guardrail` and `AWS::Bedrock::GuardrailVersion` do not, and go through the Cloud Control API. Both are on the list of resource types the Cloud Control API supports. That a guardrail can actually be created by this path has not been checked, because nothing was deployed.

```bash
vp run bedrock:infra:synth
```

Synth does not ask AWS anything. It was run locally, and the template was produced.

## Deploying and checking

<!-- section: 36.deploy -->

The steps from here on have not been run. They are written as the results to expect.

```bash
vp run bedrock:infra:diff
vp run bedrock:infra:deploy
```

When the deploy finishes, the outputs show `FunctionUrl`, `NotesTableName`, `UsageTableName`, `GuardrailId`, and `GuardrailVersion`.

```bash
vp run bedrock:smoke
vp run bedrock:logs
```

`bedrock:smoke` is billed. It checks the following, in this order.

1. An unsigned call is refused with 403
2. A signed `GET /me` returns the ID under which the function sees the signer
3. The 3 fixture notes are written to the table with that ID as their owner. This write is made by the script with your permissions, not by the function
4. A signed question is sent, the tool events and the answer arrive, and `done` says the answer is complete

At the end it prints the number of rounds and the token counts for input, output, and cache reads and writes. If `cacheReadInputTokens` is not 0, prompt caching is hitting.

`bedrock:logs` shows the one line per question. `costMicroUsd` is the estimated amount for that question.

To change the model, pass `modelId`.

```bash
vp run bedrock:infra:deploy -c modelId=jp.anthropic.claude-haiku-4-5-20251001-v1:0
```

An Anthropic model first needs the steps described in chapter 17 (the use case form and the Marketplace subscription). After the change, set `BEDROCK_MODEL_ID` to the same value, run `vp run bedrock:eval:live`, and compare the result with the one from before.

The drift check is the same as in chapter 02.

```bash
vp run bedrock:infra:drift
```

A guardrail's draft can be edited in the console. Editing it does not change behaviour, because the function calls a numbered version. How the drift check reports that difference has not been checked.
