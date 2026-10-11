import { App } from "aws-cdk-lib";
import { parseNetworkConfig, REGION } from "../../src/config.ts";
import { NETWORK_STACK } from "../../src/exports.ts";
import { planNetwork } from "../../src/plan.ts";
import { NetworkStack } from "../lib/network-stack.ts";

const app = new App();

// #region context
// `-c egress=nat`, `-c interfaceEndpoints=ecr.api,ecr.dkr,logs`. With none given, nothing is billed by the hour.
const config = parseNetworkConfig({
  cidr: app.node.tryGetContext("cidr"),
  availabilityZones: app.node.tryGetContext("availabilityZones"),
  subnetPrefix: app.node.tryGetContext("subnetPrefix"),
  egress: app.node.tryGetContext("egress"),
  interfaceEndpoints: app.node.tryGetContext("interfaceEndpoints"),
});
// #endregion context

new NetworkStack(app, NETWORK_STACK, {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 11: a two-zone VPC with public and private subnets",
  plan: planNetwork(config),
});
