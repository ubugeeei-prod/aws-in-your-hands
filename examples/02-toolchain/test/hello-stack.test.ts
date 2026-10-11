import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { parseHelloConfig } from "../lib/config.ts";
import { HelloStack } from "../lib/hello-stack.ts";

const synth = (context: Record<string, unknown> = {}): Template =>
  Template.fromStack(
    new HelloStack(new App(), "AihHello", { env: { region: "ap-northeast-1" }, config: parseHelloConfig(context) }),
  );

describe("HelloStack", () => {
  it("one private, versioned bucket, nothing else", () => {
    const template = synth();
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    // enforceSSL adds the bucket policy.
    expect(
      Object.values(resources)
        .map((resource) => resource.Type)
        .toSorted(),
    ).toEqual(["AWS::S3::Bucket", "AWS::S3::BucketPolicy"]);
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("practice bucket goes with the stack", () => {
    synth().hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
  });

  it("prod bucket survives delete and replace", () => {
    synth({ stage: "prod" }).hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("retention reaches the lifecycle rule", () => {
    synth({ noncurrentVersionDays: 30 }).hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: { Rules: [{ NoncurrentVersionExpiration: { NoncurrentDays: 30 }, Status: "Enabled" }] },
    });
  });
});
