import { fileURLToPath } from "node:url";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { SHARED_SECONDS } from "../../core/cache-control.ts";
import { SsrStack } from "../lib/ssr-stack.ts";

const synth = (responseStreaming = false): Template =>
  Template.fromStack(
    new SsrStack(new App(), "AihSsr", {
      env: { region: "ap-northeast-1" },
      serverDir: fileURLToPath(new URL("./fixtures/server", import.meta.url)),
      responseStreaming,
    }),
  );
const template = synth();

type Behavior = {
  PathPattern?: string;
  TargetOriginId: string;
  CachePolicyId: unknown;
  OriginRequestPolicyId?: unknown;
  ResponseHeadersPolicyId: unknown;
  AllowedMethods: string[];
  ViewerProtocolPolicy: string;
};
const distributionConfig = Object.values(
  template.findResources("AWS::CloudFront::Distribution"),
)[0]?.["Properties"].DistributionConfig as {
  DefaultCacheBehavior: Behavior;
  CacheBehaviors: Behavior[];
};
const behaviors = [distributionConfig.DefaultCacheBehavior, ...distributionConfig.CacheBehaviors];
const behaviorFor = (pattern: string): Behavior => {
  const behavior = distributionConfig.CacheBehaviors.find(
    (candidate) => candidate.PathPattern === pattern,
  );
  if (behavior === undefined) {
    throw new Error(`no behavior for ${pattern}`);
  }
  return behavior;
};

// The IDs CDK 2.273.0 writes for CachePolicy.CACHING_DISABLED and OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.
const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ALL_VIEWER_EXCEPT_HOST_HEADER = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

describe("SsrStack: what may be cached", () => {
  it("keeps cookies and headers out of the public cache key, and so away from the origin", () => {
    template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: {
        ParametersInCacheKeyAndForwardedToOrigin: {
          CookiesConfig: { CookieBehavior: "none" },
          HeadersConfig: { HeaderBehavior: "none" },
        },
      },
    });
    // An origin request policy could forward cookies without putting them in the key.
    expect(distributionConfig.DefaultCacheBehavior.OriginRequestPolicyId).toBeUndefined();
    expect(distributionConfig.DefaultCacheBehavior.CachePolicyId).toHaveProperty("Ref");
  });

  it("lets the origin's no-store win, and caps what the origin may ask for", () => {
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: { MinTTL: 0, DefaultTTL: 0, MaxTTL: SHARED_SECONDS },
    });
  });

  it("strips Set-Cookie from responses on the public behavior", () => {
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: { RemoveHeadersConfig: { Items: [{ Header: "Set-Cookie" }] } },
    });
    expect(distributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId).toHaveProperty("Ref");
  });

  it("never caches /me, and forwards cookies there only", () => {
    for (const pattern of ["/me", "/me/*"]) {
      expect(behaviorFor(pattern)).toMatchObject({
        CachePolicyId: CACHING_DISABLED,
        OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_HEADER,
        TargetOriginId: distributionConfig.DefaultCacheBehavior.TargetOriginId,
      });
    }
    expect(
      distributionConfig.CacheBehaviors.map((behavior) => behavior.PathPattern).toSorted(),
    ).toEqual(["/_nuxt/*", "/me", "/me/*"]);
    expect(behaviorFor("/_nuxt/*").OriginRequestPolicyId).toBeUndefined();
  });

  it("accepts only GET and HEAD, over HTTPS", () => {
    for (const behavior of behaviors) {
      expect(behavior.AllowedMethods.toSorted()).toEqual(["GET", "HEAD"]);
      expect(behavior.ViewerProtocolPolicy).toBe("redirect-to-https");
    }
  });
});

describe("SsrStack: who may reach the function", () => {
  it("requires signed requests at the function URL", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "BUFFERED",
    });
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: {
        OriginAccessControlOriginType: "lambda",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    });
  });

  it("admits this distribution and nobody else", () => {
    const permissions = Object.values(template.findResources("AWS::Lambda::Permission")).map(
      (permission) => permission["Properties"] as Record<string, unknown>,
    );
    expect(permissions.map((permission) => permission["Action"]).toSorted()).toEqual([
      "lambda:InvokeFunction",
      "lambda:InvokeFunctionUrl",
    ]);
    for (const permission of permissions) {
      expect(permission["Principal"]).toBe("cloudfront.amazonaws.com");
      expect(JSON.stringify(permission["SourceArn"])).toContain(":distribution/");
    }
    // The form a public function URL would need.
    template.resourcePropertiesCountIs(
      "AWS::Lambda::Permission",
      { FunctionUrlAuthType: "NONE" },
      0,
    );
    template.resourcePropertiesCountIs("AWS::Lambda::Permission", { Principal: "*" }, 0);
  });

  it("switches the invoke mode together with the handler", () => {
    synth(true).hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "RESPONSE_STREAM",
    });
  });

  it("gives the function no permission beyond writing its own log group", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) =>
        policy["Properties"].PolicyDocument.Statement as {
          Action: string | string[];
          Resource: unknown;
        }[],
    );
    expect(statements.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("turns the practice sign-in off and stops before CloudFront gives up", () => {
    const fn = Object.values(template.findResources("AWS::Lambda::Function"))[0]?.["Properties"];
    expect(fn).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Handler: "index.handler",
      Environment: { Variables: { AIH_SSR_SIGN_IN: "off" } },
    });
    expect(fn.Timeout).toBeLessThan(30);
  });
});

describe("SsrStack: storage and cleanup", () => {
  it("keeps the asset bucket private and readable by this distribution only", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      WebsiteConfiguration: Match.absent(),
    });
    const allows = Object.values(template.findResources("AWS::S3::BucketPolicy"))
      .flatMap(
        (policy) => policy["Properties"].PolicyDocument.Statement as Record<string, unknown>[],
      )
      .filter((statement) => statement["Effect"] === "Allow");
    expect(
      allows
        .flatMap((statement) => statement["Action"])
        .map(String)
        .toSorted(),
    ).toEqual(["s3:GetObject", "s3:ListBucket"]);
    for (const statement of allows) {
      expect(statement).toMatchObject({
        Principal: { Service: "cloudfront.amazonaws.com" },
        Condition: { StringEquals: { "AWS:SourceArn": expect.anything() } },
      });
    }
  });

  it("deletes the bucket and the logs with the stack", () => {
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("uses only resource types checked against cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::CloudFront::CachePolicy",
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::CloudFront::ResponseHeadersPolicy",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });
});
