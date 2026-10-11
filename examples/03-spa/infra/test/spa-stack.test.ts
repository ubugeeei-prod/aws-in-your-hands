import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { SpaStack } from "../lib/spa-stack.ts";

const synth = (): Template =>
  Template.fromStack(new SpaStack(new App(), "AihSpa", { env: { region: "ap-northeast-1" } }));

describe("SpaStack", () => {
  it("keeps the bucket private, with no website hosting", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      WebsiteConfiguration: Match.absent(),
    });
  });

  it("grants read and list to this distribution only", () => {
    const policies = synth().findResources("AWS::S3::BucketPolicy");
    const statements = Object.values(policies).flatMap(
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

  it("serves HTTPS only, with the fallback attached", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        },
        // An error-page rewrite would also turn missing assets into HTML.
        CustomErrorResponses: Match.absent(),
      },
    });
  });

  it("uses only resource types checked against cdkd", () => {
    const resources = synth().toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::Function",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });
});
