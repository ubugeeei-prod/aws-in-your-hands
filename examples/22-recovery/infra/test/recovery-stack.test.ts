import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { RecoveryStack, type RecoveryStackProps } from "../lib/recovery-stack.ts";

// Synthesized once each: every synth bundles the function with esbuild.
const synth = (options: Partial<RecoveryStackProps> = {}) =>
  Template.fromStack(
    new RecoveryStack(new App(), "AihRecovery", {
      env: { region: "ap-northeast-1" },
      protect: false,
      backup: false,
      replica: false,
      ...options,
    }),
  );
const byDefault = synth();
const cutOver = synth({ activeTableName: "AihRecovery-Notes-restored-20261012T093015Z" });
const protectedStack = synth({ protect: true });
const withBackup = synth({ backup: true });
const withReplica = synth({ replica: true });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template, role: string): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy) => JSON.stringify(policy["Properties"].Roles).includes(role))
    .flatMap((policy) => policy["Properties"].PolicyDocument.Statement as Statement[]);
const typesOf = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

// cdkd 0.296.28 registers a dedicated provider for each of these.
const BASE_TYPES = [
  "AWS::DynamoDB::Table",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
  "AWS::Lambda::Function",
  "AWS::Logs::LogGroup",
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
];

describe("RecoveryStack, default", () => {
  it("creates no vault, no plan, no second bucket, and nothing billed by the hour", () => {
    expect(typesOf(byDefault)).toEqual(BASE_TYPES);
    byDefault.resourceCountIs("AWS::S3::Bucket", 1);
    byDefault.hasResourceProperties("AWS::S3::Bucket", { ReplicationConfiguration: Match.absent() });
    byDefault.hasResourceProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST" });
  });

  it("turns on point-in-time recovery for the table", () => {
    byDefault.hasResourceProperties("AWS::DynamoDB::Table", {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    });
  });

  it("keeps old versions of an image for 30 days, and no longer", () => {
    byDefault.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: "expire-noncurrent-versions",
            Status: "Enabled",
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            ExpiredObjectDeleteMarker: true,
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    });
  });

  it("keeps the bucket private and refuses plain HTTP", () => {
    byDefault.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
    });
    byDefault.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: [Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } })],
      },
    });
  });

  it("is an exercise: everything goes with the stack, and the table can be deleted", () => {
    byDefault.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    byDefault.hasResourceProperties("AWS::DynamoDB::Table", { DeletionProtectionEnabled: false });
    byDefault.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    byDefault.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
  });

  it("lets the audit function read, and only read", () => {
    const statements = statementsOf(byDefault, "AuditRole");
    expect(statements.flatMap((statement) => [statement.Action].flat()).toSorted()).toEqual([
      "dynamodb:Scan",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3:ListBucket",
    ]);
    const scan = statements.find((statement) => statement.Action === "dynamodb:Scan");
    expect(scan?.Resource).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^Notes/), "Arn"] });
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
    }
    byDefault.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("points the function at the stack's own table", () => {
    byDefault.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Environment: {
        Variables: {
          TABLE_NAME: { Ref: Match.stringLikeRegexp("^Notes") },
          UPLOADS_BUCKET: { Ref: Match.stringLikeRegexp("^Uploads") },
        },
      },
    });
    byDefault.hasOutput("TableName", { Value: { Ref: Match.stringLikeRegexp("^Notes") } });
  });
});

describe("RecoveryStack with -c table=<restored table>", () => {
  const restored = "AihRecovery-Notes-restored-20261012T093015Z";

  it("moves the function, its permission, and the output to the restored table together", () => {
    cutOver.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { TABLE_NAME: restored } },
    });
    const scan = statementsOf(cutOver, "AuditRole").find((statement) => statement.Action === "dynamodb:Scan");
    expect(JSON.stringify(scan?.Resource)).toContain(`:table/${restored}`);
    expect(JSON.stringify(scan?.Resource)).not.toContain("Fn::GetAtt");
    cutOver.hasOutput("TableName", { Value: restored });
  });

  it("neither adopts the restored table nor lets go of the original", () => {
    expect(typesOf(cutOver)).toEqual(BASE_TYPES);
    cutOver.resourceCountIs("AWS::DynamoDB::Table", 1);
    cutOver.hasOutput("OwnedTableName", { Value: { Ref: Match.stringLikeRegexp("^Notes") } });
    expect(cutOver.toJSON()["Resources"]).toEqual(
      expect.objectContaining({ ...byDefault.findResources("AWS::DynamoDB::Table") }),
    );
  });
});

describe("RecoveryStack with -c protect=on", () => {
  it("keeps the table and the bucket when the stack goes, and refuses DeleteTable", () => {
    protectedStack.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
    protectedStack.hasResourceProperties("AWS::DynamoDB::Table", {
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    protectedStack.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
    expect(typesOf(protectedStack)).toEqual(BASE_TYPES);
  });
});

describe("RecoveryStack with -c backup=on", () => {
  it("adds a vault, a plan, and a selection, and no other kind of resource", () => {
    // None of the three has a dedicated provider in cdkd 0.296.28: Cloud Control API.
    expect(typesOf(withBackup)).toEqual(
      [...BASE_TYPES, "AWS::Backup::BackupPlan", "AWS::Backup::BackupSelection", "AWS::Backup::BackupVault"].toSorted(),
    );
  });

  it("takes one snapshot a day of this table and deletes it after a week", () => {
    withBackup.hasResourceProperties("AWS::Backup::BackupPlan", {
      BackupPlan: {
        BackupPlanRule: [
          Match.objectLike({
            RuleName: "daily",
            ScheduleExpression: "cron(0 18 * * ? *)",
            Lifecycle: { DeleteAfterDays: 7 },
          }),
        ],
      },
    });
    withBackup.hasResourceProperties("AWS::Backup::BackupSelection", {
      BackupSelection: Match.objectLike({ Resources: [{ "Fn::GetAtt": [Match.stringLikeRegexp("^Notes"), "Arn"] }] }),
    });
  });

  it("gives the backup role AWS's managed policy for taking backups, and not the one for restoring", () => {
    const roles = Object.values(withBackup.findResources("AWS::IAM::Role"))
      .map((role) => JSON.stringify(role["Properties"].ManagedPolicyArns ?? []))
      .filter((arns) => arns !== "[]");
    expect(roles).toHaveLength(1);
    expect(roles[0]).toContain("service-role/AWSBackupServiceRolePolicyForBackup");
    expect(roles[0]).not.toContain("Restores");
  });
});

describe("RecoveryStack with -c replica=on", () => {
  it("adds a second private, versioned bucket and the role S3 replicates with", () => {
    expect(typesOf(withReplica)).toEqual(BASE_TYPES);
    withReplica.resourceCountIs("AWS::S3::Bucket", 2);
    withReplica.allResourcesProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }),
    });
  });

  it("does not replicate delete markers", () => {
    withReplica.hasResourceProperties("AWS::S3::Bucket", {
      ReplicationConfiguration: {
        Rules: [
          Match.objectLike({
            Status: "Enabled",
            DeleteMarkerReplication: { Status: "Disabled" },
            Destination: { Bucket: { "Fn::GetAtt": [Match.stringLikeRegexp("^UploadsReplica"), "Arn"] } },
          }),
        ],
      },
    });
  });

  it("scopes the replication role to these two buckets", () => {
    const statements = statementsOf(withReplica, "ReplicationRole");
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).toMatch(/Uploads/);
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
    }
  });
});
