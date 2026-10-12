import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { INFERENCE_TIMEOUT, LEASE, NovaStack } from "../lib/nova-stack.ts";

// Synthesis bundles the handler with esbuild, so each stack is built once.
const synth = (describeModel: string) =>
  Template.fromStack(
    new NovaStack(new App(), "AihNova", { env: { region: "ap-northeast-1" }, describeModel }),
  );
const template = synth("jp.amazon.nova-2-lite-v1:0");

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};
const statementsOf = (stack: Template) =>
  Object.values(stack.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const bedrockOf = (stack: Template) =>
  statementsOf(stack).filter((statement) => JSON.stringify(statement.Action).includes("bedrock"));

describe("NovaStack: the function's role", () => {
  it("allows these actions and no others", () => {
    const statements = statementsOf(template);
    expect([...new Set(statements.flatMap((statement) => statement.Action))].toSorted()).toEqual([
      "bedrock:InvokeModel",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]);
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      expect(statement.Resource).not.toBe("*");
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("can read uploads but not write them, and writes only under g/ and c/", () => {
    const prefixesOf = (statement: Statement) =>
      [...JSON.stringify(statement.Resource).matchAll(/"\/([a-z]\/\*)"/g)].map((match) => match[1]);
    const scopes = statementsOf(template)
      .filter((statement) => prefixesOf(statement).length > 0)
      .map((statement) => ({
        actions: [statement.Action].flat().toSorted(),
        prefixes: prefixesOf(statement),
      }));
    expect(scopes).toEqual([
      { actions: ["s3:GetObject"], prefixes: ["u/*"] },
      { actions: ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"], prefixes: ["g/*", "c/*"] },
    ]);
  });

  it("names the profile and the model in each destination Region, tied to that profile", () => {
    const bedrock = bedrockOf(template);
    const text = JSON.stringify(bedrock);
    expect(bedrock).toHaveLength(2);
    expect(text).toContain(":inference-profile/jp.amazon.nova-2-lite-v1:0");
    expect(text).toContain(":bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0");
    expect(text).toContain(":bedrock:ap-northeast-3::foundation-model/amazon.nova-2-lite-v1:0");
    expect(text).not.toMatch(/foundation-model\/\*|inference-profile\/\*/);
    const onModels = bedrock.find((statement) =>
      JSON.stringify(statement.Resource).includes("foundation-model"),
    );
    expect(JSON.stringify(onModels?.Condition)).toContain("bedrock:InferenceProfileArn");
  });

  it("names one model in one Region, and no profile, for an In-Region route", () => {
    const bedrock = bedrockOf(synth("amazon.nova-lite-v1:0"));
    expect(bedrock).toHaveLength(1);
    expect(bedrock[0]?.Condition).toBeUndefined();
    const text = JSON.stringify(bedrock[0]?.Resource);
    expect(text).toContain(":bedrock:ap-northeast-1::foundation-model/amazon.nova-lite-v1:0");
    expect(text).not.toContain("inference-profile");
  });

  it("names all six destination Regions for an apac. profile", () => {
    const text = JSON.stringify(bedrockOf(synth("apac.amazon.nova-pro-v1:0")));
    for (const region of [
      "ap-northeast-1",
      "ap-northeast-2",
      "ap-northeast-3",
      "ap-south-1",
      "ap-southeast-1",
      "ap-southeast-2",
    ]) {
      expect(text).toContain(`:bedrock:${region}::foundation-model/amazon.nova-pro-v1:0`);
    }
  });
});

describe("NovaStack: models that cannot be deployed", () => {
  it.each([
    ["amazon.nova-canvas-v1:0", /Nova Canvas .* reached end of life on 2026-09-30/],
    ["amazon.nova-reel-v1:0", /Nova Reel .* reached end of life on 2026-09-30/],
    ["amazon.nova-2-lite-v1:0", /called from ap-northeast-1 as jp\.amazon\.nova-2-lite-v1:0/],
    ["amazon.nova-2-sonic-v1:0", /Routes that describe an image: jp\.amazon\.nova-2-lite-v1:0/],
  ])("stops the synth for %s", (id, reason) => {
    expect(() => synth(id)).toThrow(reason);
  });
});

describe("NovaStack: the bucket, the URL, the function", () => {
  it("keeps every object private and refuses plain HTTP", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      BucketEncryption: Match.anyValue(),
    });
    const policies = Object.values(template.findResources("AWS::S3::BucketPolicy"));
    expect(policies).toHaveLength(1);
    const statements = policies[0]?.["Properties"].PolicyDocument.Statement as Statement[];
    // The only statement is the one that denies requests without TLS. Nothing is granted.
    expect(statements.map((statement) => statement.Effect)).toEqual(["Deny"]);
    expect(JSON.stringify(statements[0]?.Condition)).toContain("aws:SecureTransport");
  });

  it("expires abandoned claims after a day, and nothing else", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          { Id: "expire-abandoned-claims", Prefix: "c/", ExpirationInDays: 1, Status: "Enabled" },
          Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
        ],
      },
    });
  });

  it("deletes the bucket and the logs with the stack", () => {
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("requires a signed request and grants the URL to nobody", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
    // A public URL needs a resource-based policy. None is created.
    template.resourceCountIs("AWS::Lambda::Permission", 0);
  });

  it("outlives the model's deadline, and is outlived by the claim", () => {
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(1);
    const properties = functions[0]?.["Properties"];
    expect(properties).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
    expect(properties.Timeout).toBeGreaterThan(INFERENCE_TIMEOUT.toSeconds());
    // A function Lambda has killed cannot still be running when its claim is taken over.
    expect(properties.Timeout).toBeLessThan(LEASE.toSeconds());
    expect(properties.Environment.Variables).toMatchObject({
      NOVA_BACKEND: "bedrock",
      DESCRIBE_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
      INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
      LEASE_SECONDS: String(LEASE.toSeconds()),
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });
});
