import { App } from "aws-cdk-lib";

import { ISOLATES_STACK, parseIsolatesConfig, REGION } from "../../src/config.ts";
import { IsolatesStack } from "../lib/isolates-stack.ts";

const app = new App();

// #region context
// Without `-c imageTag=...` the stack is the image repository and nothing else.
const config = parseIsolatesConfig({
  imageTag: app.node.tryGetContext("imageTag"),
  taskSubnets: app.node.tryGetContext("taskSubnets"),
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
});
// #endregion context

new IsolatesStack(app, ISOLATES_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 64: the notes API in workerd, as a container on ECS/Fargate behind an ALB",
  config,
});
