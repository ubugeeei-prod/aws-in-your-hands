import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { RATE_RULE } from "../../src/defences.ts";
import { parseShieldConfig } from "../lib/config.ts";
import { EdgeStack, type EdgeStackProps } from "../lib/edge-stack.ts";

const DISTRIBUTION = "arn:aws:cloudfront::111122223333:distribution/E2EXAMPLE46";
const TOPIC = "arn:aws:sns:us-east-1:111122223333:AihShieldAlarms";

const synth = (props: EdgeStackProps = {}) =>
  Template.fromStack(
    new EdgeStack(new App(), "AihShieldEdge", { env: { region: "us-east-1" }, ...props }),
  );

const template = synth();
const advanced = synth({ protectedDistributionArn: DISTRIBUTION, alarmTopicArn: TOPIC });

const types = (subject: Template) => {
  const resources = subject.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

describe("the web ACL", () => {
  it("is for CloudFront, and lets through what its one rule does not stop", () => {
    template.resourceCountIs("AWS::WAFv2::WebACL", 1);
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Scope: "CLOUDFRONT",
      DefaultAction: { Allow: {} },
    });
  });

  it("blocks, not counts, an address over the limit the simulation uses", () => {
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: [
        {
          Name: "RateLimitPerIp",
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: {
              Limit: RATE_RULE.limit,
              EvaluationWindowSec: RATE_RULE.windowSeconds,
              AggregateKeyType: "IP",
            },
          },
        },
      ],
    });
    // The window is one of the four values AWS WAF accepts, and the limit is not below its minimum.
    expect([60, 120, 300, 600]).toContain(RATE_RULE.windowSeconds);
    expect(RATE_RULE.limit).toBeGreaterThanOrEqual(10);
  });

  it("refuses to be created anywhere but us-east-1", () => {
    expect(
      () => new EdgeStack(new App(), "Elsewhere", { env: { region: "ap-northeast-1" } }),
    ).toThrow(/us-east-1/);
  });
});

describe("the alarm on the rule", () => {
  it("watches the rule's own blocked requests, two minutes of three", () => {
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/WAFV2",
      MetricName: "BlockedRequests",
      Dimensions: Match.arrayWith([
        { Name: "Rule", Value: "RateLimitPerIp" },
        { Name: "WebACL", Value: "AihShieldWebAcl" },
      ]),
      Statistic: "Sum",
      Period: 60,
      Threshold: 0,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 2,
      TreatMissingData: "notBreaching",
    });
  });

  it("tells a topic only when one is given, and creates none", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmActions: Match.absent() });
    advanced.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "BlockedRequests",
      AlarmActions: [TOPIC],
    });
    advanced.resourceCountIs("AWS::SNS::Topic", 0);
  });
});

describe("Shield Advanced", () => {
  const context = (values: Record<string, unknown>) => (key: string) => values[key];

  it("is absent from the default stack", () => {
    template.resourceCountIs("AWS::Shield::Protection", 0);
    expect(types(template)).toEqual(["AWS::CloudWatch::Alarm", "AWS::WAFv2::WebACL"]);
    expect(parseShieldConfig(context({})).shieldAdvanced).toBe("off");
  });

  it("is not turned on by an ARN alone, nor without one", () => {
    expect(parseShieldConfig(context({ distributionArn: DISTRIBUTION })).shieldAdvanced).toBe(
      "off",
    );
    expect(() => parseShieldConfig(context({ shieldAdvanced: "on" }))).toThrow(/distributionArn/);
    expect(() =>
      parseShieldConfig(context({ shieldAdvanced: "on", distributionArn: "E2EXAMPLE46" })),
    ).toThrow(/distribution ARN/);
  });

  it("protects the one distribution, and alarms on the event metric for it", () => {
    advanced.resourceCountIs("AWS::Shield::Protection", 1);
    advanced.hasResourceProperties("AWS::Shield::Protection", {
      ResourceArn: DISTRIBUTION,
      // The legacy automatic mitigation is not asked for: new subscribers do not get it.
      ApplicationLayerAutomaticResponseConfiguration: Match.absent(),
    });
    advanced.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/DDoSProtection",
      MetricName: "DDoSDetected",
      Dimensions: [{ Name: "ResourceArn", Value: DISTRIBUTION }],
      TreatMissingData: "notBreaching",
      AlarmActions: [TOPIC],
    });
    expect(types(advanced)).toEqual([
      "AWS::CloudWatch::Alarm",
      "AWS::Shield::Protection",
      "AWS::WAFv2::WebACL",
    ]);
  });
});
