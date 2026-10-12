---
title: "50 AgentCore: Deploy"
---

# 50 AgentCore: Deploy

None of the steps on this page were run. The tasks and scripts exist, and everything up to synth passes locally. What is written as an expected result is what the documentation leads one to expect.

## Deploy and Check

<!-- section: 50.deploy -->

First make sure the account can use Bedrock models (chapter 17). There is one stack, and its default model is the same inference profile as in chapter 17.

<<< @/examples/50-agentcore/infra/bin/app.ts

```bash
vp run agentcore:infra:synth
vp run agentcore:infra:diff
vp run agentcore:infra:deploy
```

Synth asks AWS nothing. It writes the template, and a ZIP holding `app.js`, to `examples/50-agentcore/cdk.out/`. According to the documentation, the IAM identity that deploys needs, besides permission to create the stack's resources, permission to create a service-linked role named `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity` (`iam:CreateServiceLinkedRole`).

Two things to know before deploying.

One is that cdkd creates this Runtime and this Memory through Cloud Control API. cdkd's own documentation presents cdkd as a tool for development and testing, and that cdkd can create these two types was not checked.

The other is the version of the metadata service. The security guide says that from June 30, 2026, a Runtime without MMDSv2 enabled cannot be invoked and answers `ValidationException`. The API has `metadataConfiguration.requireMMDSV2`, but `CfnRuntime` in the pinned `aws-cdk-lib` has no property for it. What a newly created Runtime defaults to was not confirmed either. If an invocation is refused with `ValidationException`, the setting is made with `aws bedrock-agentcore-control update-agent-runtime`, and that difference should then show up in `vp run agentcore:infra:drift`.

Create one user and get a token. Use the stack's outputs (`UserPoolId` and `UserPoolClientId`).

```bash
aws cognito-idp admin-create-user --user-pool-id "$USER_POOL_ID" \
  --username you@example.com --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id "$USER_POOL_ID" \
  --username you@example.com --password "$PASSWORD" --permanent
export AIH_ACCESS_TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" --client-id "$USER_POOL_CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=you@example.com,PASSWORD=$PASSWORD" \
  --query AuthenticationResult.AccessToken --output text)
```

The password needs 12 characters or more, with a digit and a lowercase letter. The token is valid for one hour.

Invoke. **This is billed:** the model calls for two questions, and one session of the Runtime.

```bash
vp run agentcore:invoke
```

The script reads the user from the token, writes chapter 36's three notes to the table as that user's, and asks two questions in one session.

<<< @/examples/50-agentcore/src/invoke-request.ts{invoke-request}

A Runtime that takes a JWT cannot be called with the AWS SDK's `InvokeAgentRuntime`. The SDK signs with SigV4 and has no input for a bearer token. The documentation's own example uses an HTTP client. The shape of the URL is the one in that example.

The expected results:

- An invocation with a nonsense token gets a 401 in front of the Runtime
- The first question streams an answer after the tool calls (`list_notes`, `read_note`)
- The second question ("いまの答えを一文にまとめて", summarize that answer in one sentence) is answered with a sentence that builds on the first answer. That is the evidence that Memory and the session's memory work
- In CloudWatch Logs, `/aws/bedrock-agentcore/runtimes/<the Runtime's ID>-DEFAULT` has two `invocation` lines, both with `remembered` set to `true`

There is more worth checking. Wait more than 5 minutes and call with the same session ID: if the answer builds on the earlier exchange, the state was rebuilt from Memory after the microVM was replaced. Create another user and call with that user's token and the first user's session ID: the agent answers 403. If the documentation holds, what reaches the client is 424.

After a deployment, drift shows whether anything was changed by hand.

```bash
vp run agentcore:infra:drift
```

When you are done, go on to [cleanup](/en/chapters/50-agentcore/wrap.md).
