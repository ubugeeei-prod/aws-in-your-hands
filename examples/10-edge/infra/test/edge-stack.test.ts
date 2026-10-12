import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { EdgeStack } from "../lib/edge-stack.ts";

const VERSION_ARN = "arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:3";

const synth = (bodyDigestVersionArn?: string): Template =>
  Template.fromStack(
    new EdgeStack(new App(), "AihEdge", {
      env: { region: "ap-northeast-1" },
      bodyDigestVersionArn,
    }),
  );

const types = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

describe("EdgeStack", () => {
  it("keeps the bucket private and readable by this distribution only", () => {
    const template = synth();
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      WebsiteConfiguration: Match.absent(),
    });
    const statements = Object.values(template.findResources("AWS::S3::BucketPolicy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Record<string, unknown>[],
    );
    const allows = statements.filter((statement) => statement["Effect"] === "Allow");
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

  it("runs the router on runtime 2.0 with exactly one store", () => {
    synth().hasResourceProperties("AWS::CloudFront::Function", {
      AutoPublish: true,
      FunctionConfig: {
        Runtime: "cloudfront-js-2.0",
        KeyValueStoreAssociations: [{ KeyValueStoreARN: Match.anyValue() }],
      },
    });
  });

  it("creates the store empty and removes it with the stack", () => {
    const template = synth();
    // An import source would tie the pairs to the stack: changing them would replace the store.
    template.hasResourceProperties("AWS::CloudFront::KeyValueStore", {
      ImportSource: Match.absent(),
    });
    template.hasResource("AWS::CloudFront::KeyValueStore", { DeletionPolicy: "Delete" });
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
  });

  it("attaches the router to every request, over HTTPS only", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
          AllowedMethods: ["GET", "HEAD"],
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
          LambdaFunctionAssociations: Match.absent(),
        },
        CacheBehaviors: Match.absent(),
      },
    });
  });

  it("uses only resource types checked against cdkd", () => {
    expect(types(synth())).toEqual([
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::Function",
      "AWS::CloudFront::KeyValueStore",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });
});

describe("EdgeStack with the Lambda@Edge version", () => {
  it("adds one behavior that passes the body to that exact version", () => {
    const template = synth(VERSION_ARN);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: "/digest",
            ViewerProtocolPolicy: "https-only",
            // Still behind the router: the maintenance switch, and its refusal of anything but POST.
            FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
            LambdaFunctionAssociations: [
              { EventType: "origin-request", IncludeBody: true, LambdaFunctionARN: VERSION_ARN },
            ],
          }),
        ],
        DefaultCacheBehavior: { LambdaFunctionAssociations: Match.absent() },
      },
    });
    // The function lives in the other stack. This one only names it.
    expect(types(template)).not.toContain("AWS::Lambda::Function");
  });

  it.each([
    ["$LATEST", "arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest"],
    ["an alias", "arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:live"],
    [
      "another Region",
      "arn:aws:lambda:ap-northeast-1:123456789012:function:aih-edge-body-digest:3",
    ],
  ])("refuses %s before anything is synthesized", (_label, arn) => {
    expect(() => synth(arn)).toThrow(/numbered function version in us-east-1/);
  });
});
