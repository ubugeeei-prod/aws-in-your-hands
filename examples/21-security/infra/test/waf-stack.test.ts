import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { RATE_LIMIT, WafStack } from "../lib/waf-stack.ts";

const build = (region: string, commonRules: "count" | "block" = "count") =>
  Template.fromStack(
    new WafStack(new App({ analyticsReporting: false }), "AihSecurityWaf", {
      env: { region },
      commonRules,
    }),
  );

type Rule = {
  Name: string;
  Priority: number;
  Statement: Record<string, Record<string, unknown>>;
  Action?: unknown;
  OverrideAction?: unknown;
};
const rulesOf = (template: Template): Rule[] =>
  Object.values(template.findResources("AWS::WAFv2::WebACL")).flatMap(
    (acl) => acl["Properties"].Rules as Rule[],
  );

const template = build("us-east-1");

describe("AihSecurityWaf", () => {
  it("can only be placed in us-east-1", () => {
    expect(() => build("ap-northeast-1")).toThrow(/us-east-1/);
  });

  it("is one web ACL for CloudFront and nothing else", () => {
    // cdkd 0.296.28 registers a dedicated provider for AWS::WAFv2::WebACL.
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(Object.values(resources).map((resource) => resource.Type)).toEqual([
      "AWS::WAFv2::WebACL",
    ]);
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Scope: "CLOUDFRONT",
      DefaultAction: { Allow: {} },
    });
  });

  it("has three rules, which is what the monthly fee is counted from", () => {
    const rules = rulesOf(template);
    expect(rules.map((rule) => rule.Name)).toEqual([
      "RateLimitPerIp",
      "AwsIpReputation",
      "AwsCommonRules",
    ]);
    expect(rules.map((rule) => rule.Priority)).toEqual([0, 1, 2]);
  });

  it("blocks an IP address above the rate limit", () => {
    const [rate] = rulesOf(template);
    expect(rate?.Statement).toEqual({
      RateBasedStatement: { Limit: RATE_LIMIT, EvaluationWindowSec: 300, AggregateKeyType: "IP" },
    });
    expect(rate?.Action).toEqual({ Block: {} });
  });

  it("uses only AWS managed rule groups with no extra subscription fee", () => {
    const managed = rulesOf(template)
      .map((rule) => rule.Statement["ManagedRuleGroupStatement"])
      .filter((statement) => statement !== undefined);
    expect(managed).toEqual([
      { VendorName: "AWS", Name: "AWSManagedRulesAmazonIpReputationList" },
      { VendorName: "AWS", Name: "AWSManagedRulesCommonRuleSet" },
    ]);
    // Bot Control, ATP and the like carry their own monthly and per-request fees.
    expect(JSON.stringify(rulesOf(template))).not.toMatch(
      /BotControl|ATPRuleSet|ACFPRuleSet|AntiDDoS/,
    );
  });

  it("only counts the core rule set until asked to block", () => {
    expect(rulesOf(template)[2]?.OverrideAction).toEqual({ Count: {} });
    expect(rulesOf(build("us-east-1", "block"))[2]?.OverrideAction).toEqual({ None: {} });
    // The reputation list blocks from the start.
    expect(rulesOf(template)[1]?.OverrideAction).toEqual({ None: {} });
  });
});
