import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { SHARED_CACHE } from "../../src/defences.ts";
import { checkOrigins } from "../../src/origins.ts";
import { parseShieldConfig } from "../lib/config.ts";
import { ShieldStack, type ShieldStackProps } from "../lib/shield-stack.ts";

const WEB_ACL =
  "arn:aws:wafv2:us-east-1:111122223333:global/webacl/AihShieldEdge-WebAcl/0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9";

const synth = (props: Partial<ShieldStackProps> = {}) =>
  Template.fromStack(
    new ShieldStack(new App(), "AihShield", {
      env: { region: "ap-northeast-1" },
      allowedOrigin: "https://d111.cloudfront.net",
      ...props,
    }),
  );

// Synthesized once each: every synth bundles the function with esbuild.
const template = synth();
const full = synth({ webAclArn: WEB_ACL, reservedConcurrency: 20 });

// CloudFront's managed policies, by the IDs its documentation gives.
const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";

describe("the origin", () => {
  it("is closed, by this chapter's own check", () => {
    for (const subject of [template, full]) {
      const findings = checkOrigins(subject.toJSON());
      expect(findings.map((finding) => finding.exposure)).toEqual(["closed"]);
    }
  });

  it("takes only signed requests", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
  });

  it("lets CloudFront in for this distribution only, and nobody else", () => {
    const permissions = Object.values(template.findResources("AWS::Lambda::Permission"));
    expect(permissions.length).toBeGreaterThan(0);
    for (const permission of permissions) {
      expect(permission["Properties"].Principal).toBe("cloudfront.amazonaws.com");
      expect(JSON.stringify(permission["Properties"].SourceArn)).toContain(":distribution/");
    }
  });

  it("is signed for by an origin access control that always signs", () => {
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: {
        OriginAccessControlOriginType: "lambda",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    });
  });
});

describe("the distribution", () => {
  it("keeps nothing by default, and takes no request with a body", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          CachePolicyId: CACHING_DISABLED,
          AllowedMethods: ["GET", "HEAD"],
          ViewerProtocolPolicy: "https-only",
        },
      },
    });
  });

  it("caches the shared route under a key that ignores the query string", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CacheBehaviors: [
          {
            PathPattern: SHARED_CACHE.path,
            CachePolicyId: CACHING_OPTIMIZED,
            OriginRequestPolicyId: Match.absent(),
            AllowedMethods: ["GET", "HEAD"],
          },
        ],
      },
    });
    // The managed policy is used as it is: a policy of this stack could put the query string back.
    template.resourceCountIs("AWS::CloudFront::CachePolicy", 0);
  });

  it("has a web ACL only when one is given", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: { WebACLId: Match.absent() },
    });
    full.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: { WebACLId: WEB_ACL },
    });
  });
});

describe("the brake", () => {
  it("is off unless asked for, so a new account can still deploy", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: Match.absent(),
    });
    full.hasResourceProperties("AWS::Lambda::Function", { ReservedConcurrentExecutions: 20 });
  });

  it("cannot be set to zero from the command line", () => {
    const context = (values: Record<string, unknown>) => (key: string) => values[key];
    expect(() => parseShieldConfig(context({ reservedConcurrency: "0" }))).toThrow(/1 or more/);
    expect(() => parseShieldConfig(context({ reservedConcurrency: "twenty" }))).toThrow();
    expect(parseShieldConfig(context({ reservedConcurrency: "20" })).reservedConcurrency).toBe(20);
  });
});

describe("permissions", () => {
  type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

  it("lets the function write its own log group and nothing else", () => {
    const statements = Object.values(full.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    expect(statements).toHaveLength(1);
    for (const statement of statements) {
      expect([statement.Action].flat().toSorted()).toEqual([
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]);
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
    full.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });
});

describe("the stack as a whole", () => {
  it("deletes the practice logs with the stack", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("asks no account or lookup of AWS at synth", () => {
    // An account number would show up between the colons of an ARN.
    expect(JSON.stringify(template.toJSON())).not.toMatch(/:\d{12}:/);
  });

  it("uses only resource types the pinned cdkd has its own provider for", () => {
    const types = (subject: Template) => {
      const resources = subject.toJSON()["Resources"] as Record<string, { Type: string }>;
      return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
    };
    const expected = [
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
    ];
    expect(types(template)).toEqual(expected);
    expect(types(full)).toEqual(expected);
  });
});
