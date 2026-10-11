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
  it("creates one private, versioned bucket and nothing else", () => {
    const template = synth();
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    // The SSL-only rule adds a bucket policy next to the bucket.
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

  it("throws the practice bucket away with the stack", () => {
    synth().hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
  });

  it("keeps the prod bucket when the stack is deleted or the bucket is replaced", () => {
    synth({ stage: "prod" }).hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("carries the configured retention into the lifecycle rule", () => {
    synth({ noncurrentVersionDays: 30 }).hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: { Rules: [{ NoncurrentVersionExpiration: { NoncurrentDays: 30 }, Status: "Enabled" }] },
    });
  });
});
