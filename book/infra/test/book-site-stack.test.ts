import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { BookSiteStack } from "../lib/book-site-stack.ts";

const synth = (): Template =>
  Template.fromStack(
    new BookSiteStack(new App(), "AihBookSite", { env: { region: "ap-northeast-1" } }),
  );

// Checked in the source of @go-to-k/cdkd 0.296.28. Check a new type there before adding it.
const typesCheckedAgainstCdkd = [
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
  "AWS::CloudFront::Distribution",
  "AWS::CloudFront::OriginAccessControl",
  "AWS::CloudFront::Function",
];

describe("BookSiteStack", () => {
  it("keeps the content bucket private", () => {
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
  });

  it("lets only this distribution read objects", () => {
    const template = synth();
    const policies = template.findResources("AWS::S3::BucketPolicy");
    const statements = Object.values(policies).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Record<string, unknown>[],
    );
    const allows = statements.filter((statement) => statement["Effect"] === "Allow");

    expect(allows).toHaveLength(1);
    expect(allows[0]).toMatchObject({
      Action: "s3:GetObject",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Condition: { StringEquals: { "AWS:SourceArn": expect.anything() } },
    });
  });

  it("signs origin requests, HTTPS only", () => {
    const template = synth();
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: {
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    });
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        },
      },
    });
  });

  it("answers a missing page with a real 404", () => {
    const template = synth();
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CustomErrorResponses: [403, 404].map((ErrorCode) =>
          Match.objectLike({ ErrorCode, ResponseCode: 404, ResponsePagePath: "/404.html" }),
        ),
      },
    });
  });

  it("deletes the bucket with the stack", () => {
    synth().hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("uses only resource types checked against cdkd", () => {
    const resources = synth().toJSON()["Resources"] as Record<string, { Type: string }>;
    const types = [...new Set(Object.values(resources).map((resource) => resource.Type))];
    expect(types.toSorted()).toEqual(typesCheckedAgainstCdkd.toSorted());
  });

  it("exposes the outputs the site tasks read", () => {
    const outputs = Object.keys(synth().toJSON()["Outputs"] as Record<string, unknown>);
    expect(outputs.toSorted()).toEqual([
      "ContentBucketName",
      "DistributionDomainName",
      "DistributionId",
    ]);
  });
});
