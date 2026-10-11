import { App } from "aws-cdk-lib";
import { CiStack } from "../lib/ci-stack.ts";
import { apiStackName, parseShipConfig } from "../lib/config.ts";
import { ShipApiStack } from "../lib/ship-api-stack.ts";

// #region app
// No AWS::CDK::Metadata resource: CloudFormation cannot check it for drift,
// and every unchecked resource is one the drift report has to explain.
const app = new App({ analyticsReporting: false });
const config = parseShipConfig((key) => app.node.tryGetContext(key));
const env = { region: "ap-northeast-1" };

// `-c stage=prod` or `-c stage=pr-123` selects a different stack, not a different mode of the same one.
new ShipApiStack(app, apiStackName(config.stage), {
  env,
  description: `AWS in Your Hands chapter 20: notes API delivered through CloudFormation (${config.stage})`,
  stage: config.stage,
  allowedOrigin: config.allowedOrigin,
});

new CiStack(app, "AihShipCi", {
  env,
  description: "AWS in Your Hands chapter 20: GitHub OIDC provider and the roles workflows assume",
  ci: config.ci,
});
// #endregion app
