import { App } from "aws-cdk-lib";

import { parseSecurityConfig, WAF_REGION } from "../lib/config.ts";
import { SecurityStack } from "../lib/security-stack.ts";
import { WafStack } from "../lib/waf-stack.ts";

const app = new App();
const config = parseSecurityConfig((key) => app.node.tryGetContext(key));

// #region stacks
// The default deploy: CloudFront, a function, one secret, and no bound on requests.
// `-c cmk=on` and `-c webAclArn=...` add the monthly fees; `-c reservedConcurrency=N` is free.
new SecurityStack(app, "AihSecurity", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 21: a token API that reads its signing key from Secrets Manager",
  webAclArn: config.webAclArn,
  customerManagedKey: config.cmk === "on",
  reservedConcurrency: config.reservedConcurrency,
});

// Deployed only when asked for by name. CloudFront's web ACLs are created in us-east-1.
new WafStack(app, "AihSecurityWaf", {
  env: { region: WAF_REGION },
  description: "AWS in Your Hands chapter 21: a web ACL for the CloudFront distribution",
  commonRules: config.wafCommonRules,
});
// #endregion stacks
