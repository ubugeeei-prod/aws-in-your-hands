import { App } from "aws-cdk-lib";

import { GLOBAL_REGION, parseFirewallConfig } from "../lib/config.ts";
import { EdgeWafPolicyStack } from "../lib/edge-waf-policy-stack.ts";
import { FirewallManagerStack } from "../lib/firewall-manager-stack.ts";

const app = new App({ analyticsReporting: false });
// Throws without -c adminAccountId and -c orgUnitIds. There is no account to fall back on.
const config = parseFirewallConfig((key) => app.node.tryGetContext(key));

// #region stacks
// Both are for the Firewall Manager administrator account, and each policy is billed by the month.
new FirewallManagerStack(app, "AihFirewallManager", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 42: a security group audit policy and its compliance notices",
  adminAccountId: config.adminAccountId,
  orgUnitIds: config.orgUnitIds,
  remediation: config.sgRemediation === "on",
  notifyEmail: config.notifyEmail,
});

// CloudFront is protected from one Region only, whatever Region the origins are in.
new EdgeWafPolicyStack(app, "AihFirewallManagerEdge", {
  env: { region: GLOBAL_REGION },
  description: "AWS in Your Hands chapter 42: an AWS WAF policy for CloudFront distributions",
  orgUnitIds: config.orgUnitIds,
  remediation: config.wafRemediation === "on",
  replaceAccountWebAcls: config.replaceAccountWebAcls === "on",
});
// #endregion stacks
