import { App } from "aws-cdk-lib";

import { EKS_STACK, parseEksConfig, REGION } from "../../src/config.ts";
import { EksStack } from "../lib/eks-stack.ts";

const app = new App();

// #region context
// Without `-c deployRoleArn=...` only whoever creates the cluster can use kubectl.
const config = parseEksConfig({
  deployRoleArn: app.node.tryGetContext("deployRoleArn"),
});
// #endregion context

new EksStack(app, EKS_STACK, {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 34: an EKS Auto Mode cluster for the notes API",
  config,
});
