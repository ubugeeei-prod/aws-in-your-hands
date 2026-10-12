import { App } from "aws-cdk-lib";

import { ECR_STACK, parseEcrConfig, REGION } from "../../src/config.ts";
import { EcrStack } from "../lib/ecr-stack.ts";

const app = new App();

// #region context
// With no context at all the stack is one repository: no role, no cache rule.
const config = parseEcrConfig({
  githubRepository: app.node.tryGetContext("githubRepository"),
  pushBranch: app.node.tryGetContext("pushBranch"),
  pullThroughCache: app.node.tryGetContext("pullThroughCache"),
});
// #endregion context

new EcrStack(app, ECR_STACK, {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 52: an ECR repository with its settings, and a push role",
  config,
});
