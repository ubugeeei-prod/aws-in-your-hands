import { App } from "aws-cdk-lib";

import { parseSandboxConfig, REGION, SANDBOX_STACK } from "../../src/config.ts";
import { AgentSandboxStack } from "../lib/agent-sandbox-stack.ts";

const app = new App();

// #region context
// Without `-c imageTag=...` the stack is the image repository and nothing else.
// Without `-c repositories=owner/name` the launcher refuses every request.
const config = parseSandboxConfig({
  imageTag: app.node.tryGetContext("imageTag"),
  repositories: app.node.tryGetContext("repositories"),
  model: app.node.tryGetContext("model"),
  githubAppSecretName: app.node.tryGetContext("githubAppSecretName"),
  modelEndpoint: app.node.tryGetContext("modelEndpoint"),
  exec: app.node.tryGetContext("exec"),
});
// #endregion context

new AgentSandboxStack(app, SANDBOX_STACK, {
  // The Region only. Which account this is deployed to is the reader's choice, and it must not be production.
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 63: one Fargate task per coding-agent job, a role that reaches the model only, a launcher and a reaper",
  config,
});
