import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { CLAIM_MS } from "../../src/speak.ts";
import { AUDIO_DAYS, HANDLER_TIMEOUT, PollyStack } from "../lib/polly-stack.ts";

// Synthesized once: every synth bundles the function with esbuild.
const stack = new PollyStack(new App(), "AihPolly", { env: { region: "ap-northeast-1" } });
const template = Template.fromStack(stack);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
  (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
);
const allowing = (action: string) =>
  statements.filter((statement) => [statement.Action].flat().includes(action));

describe("permissions", () => {
  it("lets the function synthesize speech, use its cache, write its log, and nothing else", () => {
    expect(statements.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "polly:SynthesizeSpeech",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]);
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("has one star, on the one action that has no resource to name", () => {
    const starred = statements.filter((statement) => statement.Resource === "*");
    expect(starred).toHaveLength(1);
    expect(starred[0]?.Action).toBe("polly:SynthesizeSpeech");
    // No lexicon, no asynchronous task, no listing of voices.
    expect(JSON.stringify(statements)).not.toMatch(/polly:(\*|[A-RT-Z]|Start)/);
  });

  it("reaches objects only under the two prefixes, and cannot delete any", () => {
    const [objects] = allowing("s3:PutObject");
    expect(JSON.stringify(objects?.Resource).match(/\/[a-z]+\/\*/g)).toEqual([
      "/speech/*",
      "/claims/*",
    ]);
    expect(JSON.stringify(statements)).not.toMatch(/s3:(Delete|\*)/);
    const [list] = allowing("s3:ListBucket");
    expect(JSON.stringify(list?.Resource)).toMatch(/^\{"Fn::GetAtt":\["Cache[0-9A-F]+","Arn"\]\}$/);
  });
});

describe("the cache bucket", () => {
  it("is private, encrypted, and refuses plain HTTP", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
    const policy = Object.values(template.findResources("AWS::S3::BucketPolicy")).flatMap(
      (resource) =>
        resource["Properties"].PolicyDocument.Statement as (Statement & { Condition: unknown })[],
    );
    expect(policy).toHaveLength(1);
    expect(policy[0]).toMatchObject({
      Effect: "Deny",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
  });

  it("forgets audio after 30 days and claims after one", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          {
            Id: "expire-audio",
            Prefix: "speech/",
            ExpirationInDays: AUDIO_DAYS,
            Status: "Enabled",
          },
          { Id: "expire-claims", Prefix: "claims/", ExpirationInDays: 1, Status: "Enabled" },
        ],
      },
      // Versioning would keep what a rule expired, and bill for it.
      VersioningConfiguration: Match.absent(),
    });
    expect(AUDIO_DAYS).toBe(30);
  });

  it("is deleted with the stack, like the log group", () => {
    for (const type of ["AWS::S3::Bucket", "AWS::Logs::LogGroup"]) {
      template.hasResource(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });
});

describe("the function", () => {
  it("is stopped before a claim it holds is old enough to be taken over", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: HANDLER_TIMEOUT.toSeconds(),
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
    });
    expect(HANDLER_TIMEOUT.toMilliseconds()).toBeLessThan(CLAIM_MS);
  });

  it("is reached only through a URL that checks a SigV4 signature", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
    // AuthType NONE would come with a permission for everyone.
    template.resourceCountIs("AWS::Lambda::Permission", 0);
  });

  it("is told to call Polly and where the cache is, and holds no secret", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          SPEECH_BACKEND: "polly",
          SPEECH_BUCKET: { Ref: Match.stringLikeRegexp("^Cache") },
          LOG_LEVEL: "info",
          STAGE: "dev",
        },
      },
    });
  });
});

describe("the stack as a whole", () => {
  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    // Every one has its own provider in cdkd 0.296.28's register-providers.ts.
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

  it("has nothing billed by the hour: no alarm, no key, no reserved capacity", () => {
    for (const type of ["AWS::CloudWatch::Alarm", "AWS::KMS::Key", "AWS::Lambda::Alias"]) {
      template.resourceCountIs(type, 0);
    }
  });

  it("pins the Region and nothing else", () => {
    expect(stack.region).toBe("ap-northeast-1");
    expect(JSON.stringify(template.toJSON())).not.toMatch(/(?<![0-9a-f])\d{12}(?![0-9a-f])/);
  });
});
