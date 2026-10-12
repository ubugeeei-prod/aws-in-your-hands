import { App } from "aws-cdk-lib";

import { MANAGED_INSTANCES_STACK, parseManagedConfig, REGION } from "../../src/config.ts";
import { ManagedInstancesStack } from "../lib/managed-instances-stack.ts";

const app = new App();

// #region context
// `-c allowedOrigin=https://dxxxx.cloudfront.net`, `-c instanceType=m7g.large`, `-c maxVCpuCount=16`,
// `-c minExecutionEnvironments=0 -c maxExecutionEnvironments=0` to switch the function off.
const config = parseManagedConfig({
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  instanceType: app.node.tryGetContext("instanceType"),
  minExecutionEnvironments: app.node.tryGetContext("minExecutionEnvironments"),
  maxExecutionEnvironments: app.node.tryGetContext("maxExecutionEnvironments"),
  maxVCpuCount: app.node.tryGetContext("maxVCpuCount"),
});
// #endregion context

new ManagedInstancesStack(app, MANAGED_INSTANCES_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 35: the notes API on Lambda Managed Instances (capacity provider in the chapter 11 VPC)",
  config,
});
