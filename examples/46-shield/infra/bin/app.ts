import { App } from "aws-cdk-lib";

import { APP_REGION, EDGE_REGION, parseShieldConfig } from "../lib/config.ts";
import { EdgeStack } from "../lib/edge-stack.ts";
import { ShieldStack } from "../lib/shield-stack.ts";

const app = new App();
const config = parseShieldConfig((key) => app.node.tryGetContext(key));

// #region stacks
// The default deploy: CloudFront, a function nobody else can reach, one cached route. Nothing by the month.
new ShieldStack(app, "AihShield", {
  env: { region: APP_REGION },
  description: "AWS in Your Hands chapter 46: the notes API with CloudFront as its only way in",
  allowedOrigin: config.allowedOrigin,
  webAclArn: config.webAclArn,
  reservedConcurrency: config.reservedConcurrency,
});

// Deployed only when asked for by name: a web ACL is billed by the month from the moment it exists.
new EdgeStack(app, "AihShieldEdge", {
  env: { region: EDGE_REGION },
  description: "AWS in Your Hands chapter 46: a rate-based rule for CloudFront, and its alarms",
  alarmTopicArn: config.alarmTopicArn,
  // Only for an account that is already subscribed to Shield Advanced.
  protectedDistributionArn: config.shieldAdvanced === "on" ? config.distributionArn : undefined,
});
// #endregion stacks
