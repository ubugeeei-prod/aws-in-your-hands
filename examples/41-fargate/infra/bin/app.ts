import { App } from "aws-cdk-lib";

import { FARGATE_STACK, parseFargateConfig, REGION } from "../../src/config.ts";
import { FargateStack } from "../lib/fargate-stack.ts";

const app = new App();

// #region context
// Without `-c imageTag=...` the stack is the image repository and nothing else.
// `-c exec=true` is the only way ECS Exec gets switched on.
const config = parseFargateConfig({
  imageTag: app.node.tryGetContext("imageTag"),
  taskSubnets: app.node.tryGetContext("taskSubnets"),
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  exec: app.node.tryGetContext("exec"),
});
// #endregion context

new FargateStack(app, FARGATE_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 41: chapter 12's service with Fargate Spot, auto scaling, a scheduled task, and optional ECS Exec",
  config,
});
