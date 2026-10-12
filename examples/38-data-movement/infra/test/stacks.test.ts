import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { ARCHIVE_TASK } from "../../src/task.ts";
import { ArchiveStack, type ArchiveStackProps } from "../lib/archive-stack.ts";
import { ARCHIVE_REGION, SOURCE_REGION } from "../lib/regions.ts";
import { SourceStack } from "../lib/source-stack.ts";

const SOURCE_LOCATION = `arn:aws:datasync:${SOURCE_REGION}:111122223333:location/loc-0b3017fc4ba4a2d8d`;

const source = Template.fromStack(
  new SourceStack(new App(), "AihDataMovement", { env: { region: SOURCE_REGION } }),
);
// Synthesized once each: every synth with the task bundles the function with esbuild.
const archiveStack = (options: Partial<ArchiveStackProps> = {}) =>
  Template.fromStack(
    new ArchiveStack(new App(), "AihDataMovementArchive", {
      env: { region: ARCHIVE_REGION },
      task: ARCHIVE_TASK,
      ...options,
    }),
  );
const bucketOnly = archiveStack();
const withCopy = archiveStack({ sourceLocationArn: SOURCE_LOCATION });

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
  Principal?: unknown;
};
const statementsOf = (template: Template, role: string): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy) => JSON.stringify(policy["Properties"].Roles).includes(role))
    .flatMap((policy) => policy["Properties"].PolicyDocument.Statement as Statement[]);
const actionsOf = (statements: Statement[]): string[] =>
  statements.flatMap((statement) => [statement.Action].flat()).toSorted();
const typesOf = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};
const noWildcardResource = (statements: Statement[]) => {
  for (const statement of statements) {
    expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
    expect(JSON.stringify(statement.Action)).not.toContain("*");
  }
};
const datasyncTrust = (region: string) => ({
  AssumeRolePolicyDocument: {
    Statement: [
      {
        Effect: "Allow",
        Action: "sts:AssumeRole",
        Principal: { Service: "datasync.amazonaws.com" },
        Condition: {
          StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
          ArnLike: {
            "aws:SourceArn": {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  { Ref: "AWS::Partition" },
                  `:datasync:${region}:`,
                  { Ref: "AWS::AccountId" },
                  ":*",
                ],
              ],
            },
          },
        },
      },
    ],
  },
});

describe("the source stack", () => {
  it("creates a bucket, a role and a location, and nothing that runs", () => {
    // IAM and S3 have dedicated providers in cdkd 0.296.28. The location goes through Cloud Control.
    expect(typesOf(source)).toEqual([
      "AWS::DataSync::LocationS3",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });

  it("lets DataSync read the bucket and change nothing in it", () => {
    const statements = statementsOf(source, "SourceRole");
    expect(actionsOf(statements)).toEqual([
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:GetObjectTagging",
      "s3:GetObjectVersion",
      "s3:GetObjectVersionTagging",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:ListMultipartUploadParts",
    ]);
    noWildcardResource(statements);
    source.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("lets only DataSync locations of this account and Region assume the role", () => {
    source.hasResourceProperties("AWS::IAM::Role", datasyncTrust(SOURCE_REGION));
  });

  it("creates the location after the role's policy", () => {
    const [location] = Object.values(source.findResources("AWS::DataSync::LocationS3"));
    expect(JSON.stringify(location?.["DependsOn"])).toMatch(/SourceRoleDefaultPolicy/);
  });

  it("keeps the bucket private, and removes it with the stack", () => {
    source.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: Match.absent(),
    });
    source.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
  });
});

describe("the archive stack without a source location", () => {
  it("is a bucket and a location: no task, no schedule, no function", () => {
    expect(typesOf(bucketOnly)).toEqual([
      "AWS::DataSync::LocationS3",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });

  it("keeps old versions of an archived object for 30 days, and aborts abandoned parts", () => {
    bucketOnly.hasResourceProperties("AWS::S3::Bucket", {
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
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
    });
  });

  it("lets DataSync write objects and add delete markers, and never remove a version", () => {
    const statements = statementsOf(bucketOnly, "DestinationRole");
    expect(actionsOf(statements)).toEqual([
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:GetObjectTagging",
      "s3:GetObjectVersion",
      "s3:GetObjectVersionTagging",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]);
    noWildcardResource(statements);
    for (const statement of statements) {
      expect(statement.Condition).toEqual({
        StringEquals: { "aws:ResourceAccount": { Ref: "AWS::AccountId" } },
      });
    }
    bucketOnly.hasResourceProperties("AWS::IAM::Role", datasyncTrust(ARCHIVE_REGION));
  });

  it("grants no other account anything", () => {
    const [policy] = Object.values(bucketOnly.findResources("AWS::S3::BucketPolicy"));
    const statements = policy?.["Properties"].PolicyDocument.Statement as Statement[];
    expect(statements.map((statement) => statement.Effect)).toEqual(["Deny"]);
  });
});

describe("the archive stack with -c sourceLocation=<arn>", () => {
  it("adds the task, its log group and policy, the rule, the function and the topic", () => {
    // Dedicated providers in cdkd 0.296.28: Events::Rule, IAM, Lambda, Logs::LogGroup, S3, SNS.
    // Through Cloud Control: the two DataSync types and Logs::ResourcePolicy.
    expect(typesOf(withCopy)).toEqual([
      "AWS::DataSync::LocationS3",
      "AWS::DataSync::Task",
      "AWS::Events::Rule",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::Logs::ResourcePolicy",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
    ]);
  });

  it("copies what changed once a day in Basic mode, keeps deletes out, and checks what it copied", () => {
    withCopy.hasResourceProperties("AWS::DataSync::Task", {
      SourceLocationArn: SOURCE_LOCATION,
      DestinationLocationArn: {
        "Fn::GetAtt": [Match.stringLikeRegexp("^ArchiveLocation"), "LocationArn"],
      },
      TaskMode: "BASIC",
      Options: {
        TransferMode: "CHANGED",
        OverwriteMode: "ALWAYS",
        PreserveDeletedFiles: "PRESERVE",
        VerifyMode: "ONLY_FILES_TRANSFERRED",
        ObjectTags: "PRESERVE",
        LogLevel: "BASIC",
      },
      Schedule: { ScheduleExpression: "cron(0 18 * * ? *)", Status: "ENABLED" },
      Includes: Match.absent(),
      Excludes: Match.absent(),
    });
  });

  it("lets DataSync tasks of this account write to the copy's log group and to no other", () => {
    const [policy] = Object.values(withCopy.findResources("AWS::Logs::ResourcePolicy"));
    const document = JSON.stringify(policy?.["Properties"].PolicyDocument);
    expect(document).toContain("logs:CreateLogStream");
    expect(document).toContain("logs:PutLogEvents");
    expect(document).toContain("datasync.amazonaws.com");
    expect(document).toContain("aws:SourceAccount");
    expect(document).toContain(":task/*");
    expect(document).toMatch(/CopyLogs/);
    withCopy.resourcePropertiesCountIs("AWS::Logs::LogGroup", { RetentionInDays: 7 }, 2);
  });

  it("sends the function only the endings of this task's executions", () => {
    withCopy.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws.datasync"],
        "detail-type": ["DataSync Task Execution State Change"],
        detail: { State: ["SUCCESS", "ERROR"] },
        resources: [
          {
            prefix: {
              "Fn::Join": [
                "",
                [
                  { "Fn::GetAtt": [Match.stringLikeRegexp("^ArchiveCopy"), "TaskArn"] },
                  "/execution/",
                ],
              ],
            },
          },
        ],
      },
      State: "ENABLED",
    });
  });

  it("lets the function publish to its topic and write its logs, and nothing else", () => {
    const statements = statementsOf(withCopy, "AlertRole");
    expect(actionsOf(statements)).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sns:Publish",
    ]);
    noWildcardResource(statements);
    withCopy.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Environment: {
        Variables: {
          TASK_ARN: { "Fn::GetAtt": [Match.stringLikeRegexp("^ArchiveCopy"), "TaskArn"] },
          ALERT_TOPIC_ARN: { Ref: Match.stringLikeRegexp("^Alerts") },
        },
      },
    });
  });

  it("creates nothing that is billed by the hour", () => {
    for (const type of typesOf(withCopy)) {
      expect(type).not.toMatch(/^AWS::(EC2|ECS|RDS|ElasticLoadBalancingV2|DataSync::Agent)/);
    }
  });
});

describe("options asked for by name", () => {
  it("-c deletes=remove turns the archive into a mirror", () => {
    const mirror = archiveStack({
      sourceLocationArn: SOURCE_LOCATION,
      task: {
        ...ARCHIVE_TASK,
        excludes: "/u/drill",
        options: { ...ARCHIVE_TASK.options, preserveDeletedFiles: "REMOVE" },
      },
    });
    mirror.hasResourceProperties("AWS::DataSync::Task", {
      Options: Match.objectLike({ PreserveDeletedFiles: "REMOVE" }),
      Excludes: [{ FilterType: "SIMPLE_PATTERN", Value: "/u/drill" }],
    });
  });

  it("refuses a combination DataSync rules out before anything is synthesized", () => {
    const impossible = {
      ...ARCHIVE_TASK,
      options: {
        ...ARCHIVE_TASK.options,
        transferMode: "ALL" as const,
        preserveDeletedFiles: "REMOVE" as const,
      },
    };
    expect(() => archiveStack({ task: impossible })).toThrow(/TransferMode ALL/);
  });

  it("-c writerRole=<arn> gives that one role the tutorial's actions on the archive", () => {
    const writer = "arn:aws:iam::444455556666:role/DataSync-archive-writer";
    const shared = archiveStack({ crossAccountWriterArn: writer });
    const [policy] = Object.values(shared.findResources("AWS::S3::BucketPolicy"));
    const statements = policy?.["Properties"].PolicyDocument.Statement as Statement[];
    const grant = statements.find((statement) => statement.Effect === "Allow");

    expect(grant?.Principal).toEqual({ AWS: writer });
    expect([grant?.Action].flat().toSorted()).toEqual([
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:GetObjectTagging",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]);
    expect(statements.filter((statement) => statement.Effect === "Allow")).toHaveLength(1);
  });
});
