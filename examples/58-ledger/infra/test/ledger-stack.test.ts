import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { LedgerStack, PRACTICE_LOCK, parseLock } from "../lib/ledger-stack.ts";

const synth = (lock = parseLock({})) =>
  Template.fromStack(
    new LedgerStack(new App(), "AihLedger", { env: { region: "ap-northeast-1" }, lock }),
  );
const template = synth();

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};
type Policy = { Properties: { PolicyDocument: { Statement: Statement[] }; Roles?: unknown[] } };
const policies = (type: string) => Object.values(template.findResources(type)) as Policy[];
const actions = (statements: Statement[]): string[] =>
  statements.flatMap((statement) => [statement.Action].flat()).toSorted();
const attachedTo = (role: string): Statement[] =>
  policies("AWS::IAM::Policy")
    .filter((policy) => JSON.stringify(policy.Properties.Roles).includes(`"${role}`))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
const everyStatement = (): Statement[] =>
  [...policies("AWS::IAM::Policy"), ...policies("AWS::IAM::ManagedPolicy")].flatMap(
    (policy) => policy.Properties.PolicyDocument.Statement,
  );

describe("LedgerStack", () => {
  it("lets the writer insert and read the tail, and nothing that could replace an entry", () => {
    const [policy] = policies("AWS::IAM::ManagedPolicy");
    const statements = policy?.Properties.PolicyDocument.Statement ?? [];
    expect(actions(statements)).toEqual(["dynamodb:PartiQLInsert", "dynamodb:Query"]);
    for (const statement of statements) {
      expect(statement.Resource).toEqual({
        "Fn::GetAtt": [expect.stringMatching(/^Journal/), "Arn"],
      });
    }
  });

  it("gives no role or policy a way to change or delete an item", () => {
    const forbidden = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:PartiQLUpdate",
      "dynamodb:PartiQLDelete",
    ];
    expect(actions(everyStatement()).filter((action) => forbidden.includes(action))).toEqual([]);
  });

  it("gives no role a way to delete a digest, shorten its lock, or bypass governance", () => {
    const s3Actions = actions(everyStatement()).filter((action) => action.startsWith("s3:"));
    expect([...new Set(s3Actions)]).toEqual([
      "s3:GetObjectRetention",
      "s3:GetObjectVersion",
      "s3:ListBucketVersions",
      "s3:PutObject",
    ]);
  });

  it("lets the digest function read the table and write digests under one prefix", () => {
    const statements = attachedTo("DigestRole");
    expect(actions(statements)).toEqual([
      "dynamodb:Query",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3:GetObjectVersion",
      "s3:ListBucketVersions",
      "s3:PutObject",
    ]);
    const put = statements.find((statement) => statement.Action === "s3:PutObject");
    expect(JSON.stringify(put?.Resource)).toContain("/digests/notes/*");
    const list = statements.find((statement) => statement.Action === "s3:ListBucketVersions");
    expect(list?.Condition).toEqual({ StringLike: { "s3:prefix": "digests/notes/*" } });
  });

  it("lets the auditor read both sides and write neither", () => {
    expect(actions(attachedTo("AuditorRole"))).toEqual([
      "dynamodb:Query",
      "s3:GetObjectRetention",
      "s3:GetObjectVersion",
      "s3:ListBucketVersions",
    ]);
  });

  it("uses no wildcard action, and no wildcard resource", () => {
    for (const statement of everyStatement()) {
      expect(actions([statement]).every((action) => !action.includes("*"))).toBe(true);
      expect(statement.Resource).not.toBe("*");
      expect(statement.Effect).toBe("Allow");
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  // #region lock-test
  it("locks every digest by default: governance, one day, on a versioned bucket", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      ObjectLockEnabled: true,
      ObjectLockConfiguration: {
        ObjectLockEnabled: "Enabled",
        Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: PRACTICE_LOCK.days } },
      },
    });
  });

  it("locks in compliance mode only when asked", () => {
    synth(parseLock({ mode: "compliance", days: "2557" })).hasResourceProperties(
      "AWS::S3::Bucket",
      {
        ObjectLockConfiguration: {
          Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 2557 } },
        },
      },
    );
  });

  it("keeps the bucket when the stack is destroyed, and deletes the practice table", () => {
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
    for (const type of ["AWS::DynamoDB::Table", "AWS::Logs::LogGroup"]) {
      template.hasResource(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
  });
  // #endregion lock-test

  it("refuses a lock that is not a whole number of days, or a mode S3 does not have", () => {
    expect(() => parseLock({ days: "0" })).toThrow();
    expect(() => parseLock({ days: "1.5" })).toThrow();
    expect(() => parseLock({ days: "soon" })).toThrow();
    expect(() => parseLock({ mode: "legal" })).toThrow();
  });

  it("keeps the bucket private, encrypted, and closed to plain HTTP", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("runs the digest function every hour, as the only thing that invokes it", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 hour)",
      Targets: [Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 2 } })],
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Principal: "events.amazonaws.com",
      SourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^DigestSchedule"), "Arn"] },
    });
    template.resourceCountIs("AWS::Lambda::Permission", 1);
  });

  it("tells the function which table, bucket, and ledger", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Environment: {
        Variables: {
          TABLE_NAME: { Ref: Match.stringLikeRegexp("^Journal") },
          DIGEST_BUCKET: { Ref: Match.stringLikeRegexp("^Digests") },
          LEDGER: "notes",
        },
      },
    });
  });

  it("has no public endpoint", () => {
    const types = Object.values(
      template.toJSON()["Resources"] as Record<string, { Type: string }>,
    ).map((resource) => resource.Type);
    expect(
      types.filter((type) => /ApiGateway|Lambda::Url|CloudFront|ElasticLoadBalancing/.test(type)),
    ).toEqual([]);
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::DynamoDB::Table",
      "AWS::Events::Rule",
      "AWS::IAM::ManagedPolicy",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });
});
