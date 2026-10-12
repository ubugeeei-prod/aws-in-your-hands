import { CfnOutput, Stack, type StackProps, Token } from "aws-cdk-lib";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

import { WAF_REGION } from "./config.ts";

export type WafStackProps = StackProps & { commonRules: "count" | "block" };

/** Requests one IP address may send in five minutes before it is blocked. */
export const RATE_LIMIT = 300;

/** A web ACL for CloudFront. Billed by the month from the moment it exists, attached or not. */
export class WafStack extends Stack {
  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);
    // Web ACLs for CloudFront exist in one Region only, wherever the distribution's origin is.
    if (Token.isUnresolved(this.region) || this.region !== WAF_REGION) {
      throw new Error(
        `A CLOUDFRONT-scope web ACL must be created in ${WAF_REGION}, not ${this.region}.`,
      );
    }

    const visibility = (metricName: string) => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName,
    });
    const awsManaged = (name: string) => ({
      managedRuleGroupStatement: { vendorName: "AWS", name },
    });

    // #region web-acl
    const webAcl = new CfnWebACL(this, "WebAcl", {
      scope: "CLOUDFRONT",
      description:
        "AWS in Your Hands chapter 21: rate limit and AWS managed rules for the token API",
      // Whatever no rule stops goes through. The rules below are the whole policy.
      defaultAction: { allow: {} },
      visibilityConfig: visibility("AihSecurityWebAcl"),
      rules: [
        {
          name: "RateLimitPerIp",
          priority: 0,
          // AWS WAF estimates the rate about every 10 seconds, so a burst gets through before the block starts.
          statement: {
            rateBasedStatement: {
              limit: RATE_LIMIT,
              evaluationWindowSec: 300,
              aggregateKeyType: "IP",
            },
          },
          action: { block: {} },
          visibilityConfig: visibility("RateLimitPerIp"),
        },
        {
          name: "AwsIpReputation",
          priority: 1,
          statement: awsManaged("AWSManagedRulesAmazonIpReputationList"),
          // `none`: let the rule group's own actions stand.
          overrideAction: { none: {} },
          visibilityConfig: visibility("AwsIpReputation"),
        },
        {
          name: "AwsCommonRules",
          priority: 2,
          statement: awsManaged("AWSManagedRulesCommonRuleSet"),
          // Count first. These rules block real traffic that happens to look odd, such as a large body.
          overrideAction: props.commonRules === "block" ? { none: {} } : { count: {} },
          visibilityConfig: visibility("AwsCommonRules"),
        },
      ],
    });
    // #endregion web-acl

    new CfnOutput(this, "WebAclArn", { value: webAcl.attrArn });
  }
}
