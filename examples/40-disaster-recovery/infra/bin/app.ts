import { App } from "aws-cdk-lib";

import { DR_STACK, parseDrConfig, REGION } from "../../src/config.ts";
import { DrStack } from "../lib/dr-stack.ts";

const app = new App();

// #region context
// `-c placement=public`, `-c pitRetentionDays=14`, `-c templates=declare`,
// `-c sourceRoleName=<role of the chapter 23 instance>`, `-c sourceSecurityGroupId=sg-...`.
const config = parseDrConfig({
  placement: app.node.tryGetContext("placement"),
  templates: app.node.tryGetContext("templates"),
  pitRetentionDays: app.node.tryGetContext("pitRetentionDays"),
  sourceRoleName: app.node.tryGetContext("sourceRoleName"),
  sourceSecurityGroupId: app.node.tryGetContext("sourceSecurityGroupId"),
});
// #endregion context

new DrStack(app, DR_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 40: what Elastic Disaster Recovery needs around the chapter 23 instance",
  config,
});
