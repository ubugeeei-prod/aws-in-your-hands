import { App } from "aws-cdk-lib";

import { EFS_STACK, parseEfsConfig, REGION } from "../../src/config.ts";
import { EfsStack } from "../lib/efs-stack.ts";

const app = new App();

// #region context
// `-c dataOnDestroy=retain`, `-c backup=true`, `-c allowedOrigin=https://example.com`.
const config = parseEfsConfig({
  dataOnDestroy: app.node.tryGetContext("dataOnDestroy"),
  backup: app.node.tryGetContext("backup"),
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
});
// #endregion context

new EfsStack(app, EFS_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 53: an EFS file system with two mount targets, an access point, and a function that mounts it",
  config,
});
