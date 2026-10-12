import { App } from "aws-cdk-lib";

import { CONTAINERS_STACK, parseContainersConfig, REGION } from "../../src/config.ts";
import { ContainersStack } from "../lib/containers-stack.ts";

const app = new App();

// #region context
// Without `-c imageTag=...` or `-c imageDigest=...` the stack is the image repository and nothing else.
const config = parseContainersConfig({
  imageTag: app.node.tryGetContext("imageTag"),
  imageDigest: app.node.tryGetContext("imageDigest"),
  taskSubnets: app.node.tryGetContext("taskSubnets"),
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
});
// #endregion context

new ContainersStack(app, CONTAINERS_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 12: the notes API as a container on ECS/Fargate behind an ALB",
  config,
});
