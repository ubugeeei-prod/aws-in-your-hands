import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { AsyncStack } from "../lib/async-stack.ts";

// Synthesized once: each synth bundles three functions.
const template = Template.fromStack(
  new AsyncStack(new App(), "AihAsync", { env: { region: "ap-northeast-1" } }),
);
const resources = template.toJSON()["Resources"] as Record<
  string,
  {
    Type: string;
    Properties: Record<string, unknown>;
    DependsOn?: string[];
    DeletionPolicy?: string;
  }
>;
const ofType = (type: string) =>
  Object.entries(resources).filter(([, resource]) => resource.Type === type);
const one = (type: string, idPrefix: string) => {
  const found = ofType(type).filter(([id]) => id.startsWith(idPrefix));
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`expected one ${type} starting with ${idPrefix}, found ${found.length}`);
  }
  return { id: found[0][0], ...found[0][1] };
};

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
  Principal?: unknown;
};
/** The statements of the inline policy attached to one role. */
const roleStatements = (rolePrefix: string): Statement[] =>
  ofType("AWS::IAM::Policy")
    .filter(([, policy]) => JSON.stringify(policy.Properties["Roles"]).includes(`"${rolePrefix}`))
    .flatMap(
      ([, policy]) => (policy.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement,
    );
const actionsOf = (statements: Statement[]) =>
  statements.flatMap((statement) => [statement.Action].flat()).toSorted();

const bucketName = { "Fn::Join": ["", ["aih-async-uploads-", { Ref: "AWS::AccountId" }]] };
const bucketArn = {
  "Fn::Join": [
    "",
    ["arn:", { Ref: "AWS::Partition" }, ":s3:::aih-async-uploads-", { Ref: "AWS::AccountId" }],
  ],
};
const events = one("AWS::SQS::Queue", "UploadEvents");
const deadLetters = one("AWS::SQS::Queue", "DeadLetters");
const uploads = one("AWS::S3::Bucket", "Uploads");

describe("AsyncStack: who may put messages on the queue", () => {
  const policy = one("AWS::SQS::QueuePolicy", "UploadEvents");
  const statements = (policy.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement;

  it("lets S3 send, for this bucket in this account, and lets nobody else do anything", () => {
    expect(statements.filter((statement) => statement.Effect === "Allow")).toEqual([
      {
        Effect: "Allow",
        Principal: { Service: "s3.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: { "Fn::GetAtt": [events.id, "Arn"] },
        Condition: {
          ArnEquals: { "aws:SourceArn": bucketArn },
          StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
        },
      },
    ]);
    // The other statement is the TLS-only deny that `enforceSSL` adds.
    expect(
      statements
        .filter((statement) => statement.Effect !== "Allow")
        .map((statement) => statement.Effect),
    ).toEqual(["Deny"]);
    expect(policy.Properties["Queues"]).toEqual([{ Ref: events.id }]);
  });

  it("gives the dead-letter queue no Allow at all", () => {
    const dlqPolicy = one("AWS::SQS::QueuePolicy", "DeadLetters");
    const effects = (
      dlqPolicy.Properties["PolicyDocument"] as { Statement: Statement[] }
    ).Statement.map((statement) => statement.Effect);
    expect(effects).toEqual(["Deny"]);
  });
});

describe("AsyncStack: the bucket's notification", () => {
  it("sends creates and deletes under u/ to the queue, without a custom resource", () => {
    const rule = (event: string) => ({
      Event: event,
      Queue: { "Fn::GetAtt": [events.id, "Arn"] },
      Filter: { S3Key: { Rules: [{ Name: "prefix", Value: "u/" }] } },
    });
    expect(uploads.Properties["NotificationConfiguration"]).toEqual({
      QueueConfigurations: [
        rule("s3:ObjectCreated:*"),
        rule("s3:ObjectRemoved:Delete"),
        rule("s3:LifecycleExpiration:Delete"),
      ],
    });
    expect(
      Object.values(resources).filter((resource) => resource.Type.startsWith("Custom::")),
    ).toEqual([]);
  });

  it("is created after the queue policy, which names the bucket without referring to it", () => {
    expect(uploads.Properties["BucketName"]).toEqual(bucketName);
    expect(uploads.DependsOn).toEqual([one("AWS::SQS::QueuePolicy", "UploadEvents").id]);
    // A reference from the policy back to the bucket would be a cycle the deployment cannot order.
    expect(JSON.stringify(one("AWS::SQS::QueuePolicy", "UploadEvents").Properties)).not.toContain(
      uploads.id,
    );
  });

  it("keeps chapter 07's settings on the bucket", () => {
    expect(uploads.Properties["PublicAccessBlockConfiguration"]).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(uploads.Properties["LifecycleConfiguration"]).toMatchObject({
      Rules: [{ Id: "expire-unfinished-uploads" }, { Id: "abort-incomplete-multipart-uploads" }],
    });
  });
});

describe("AsyncStack: queues", () => {
  it("hides a received message for six times the worker's timeout", () => {
    const worker = one("AWS::Lambda::Function", "Worker");
    expect(worker.Properties["Timeout"]).toBe(30);
    expect(events.Properties["VisibilityTimeout"]).toBe(180);
  });

  it("sets a message aside after five receives, and keeps it longer there than in the source queue", () => {
    expect(events.Properties["RedrivePolicy"]).toEqual({
      deadLetterTargetArn: { "Fn::GetAtt": [deadLetters.id, "Arn"] },
      maxReceiveCount: 5,
    });
    expect(events.Properties["MessageRetentionPeriod"]).toBe(4 * 24 * 60 * 60);
    expect(deadLetters.Properties["MessageRetentionPeriod"]).toBe(14 * 24 * 60 * 60);
  });

  it("encrypts both queues and deletes them with the stack", () => {
    for (const queue of [events, deadLetters]) {
      expect(queue.Properties["SqsManagedSseEnabled"]).toBe(true);
      expect(queue.DeletionPolicy).toBe("Delete");
    }
  });
});

describe("AsyncStack: how the worker is fed", () => {
  const mapping = one("AWS::Lambda::EventSourceMapping", "WorkerSource");

  it("takes ten messages at a time, at most two batches at once, and reports failures per message", () => {
    expect(mapping.Properties).toEqual({
      EventSourceArn: { "Fn::GetAtt": [events.id, "Arn"] },
      FunctionName: { Ref: one("AWS::Lambda::Function", "Worker").id },
      BatchSize: 10,
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("is created after the role's permissions exist", () => {
    expect(mapping.DependsOn).toEqual(
      expect.arrayContaining([one("AWS::IAM::Policy", "WorkerRole").id]),
    );
  });
});

describe("AsyncStack: what each function may do", () => {
  it("worker: read the queue, read and untag uploads, read and write records", () => {
    const statements = roleStatements("WorkerRole");
    expect(actionsOf(statements)).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3:DeleteObjectTagging",
      "s3:GetObject",
      "s3:ListBucket",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ]);
    const objects = statements.find((statement) =>
      [statement.Action].flat().includes("s3:GetObject"),
    );
    expect(objects?.Resource).toEqual({
      "Fn::Join": ["", [{ "Fn::GetAtt": [uploads.id, "Arn"] }, "/u/*"]],
    });
    const queue = statements.find((statement) =>
      [statement.Action].flat().includes("sqs:ReceiveMessage"),
    );
    // The source queue only. Reading the dead-letter queue is a person's job.
    expect(queue?.Resource).toEqual({ "Fn::GetAtt": [events.id, "Arn"] });
  });

  it("housekeeping: list and delete uploads, read and delete records, and no queue", () => {
    const statements = roleStatements("HousekeepingRole");
    expect(actionsOf(statements)).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3:DeleteObject",
      "s3:DeleteObjectTagging",
      "s3:ListBucket",
    ]);
    const list = statements.find((statement) => statement.Action === "s3:ListBucket");
    expect(list?.Condition).toEqual({ StringLike: { "s3:prefix": "u/*" } });
  });

  it("no statement in the stack uses a wildcard action or resource, and no role a managed policy", () => {
    for (const [, policy] of ofType("AWS::IAM::Policy")) {
      for (const statement of (policy.Properties["PolicyDocument"] as { Statement: Statement[] })
        .Statement) {
        expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
        for (const action of [statement.Action].flat()) {
          expect(action).not.toContain("*");
        }
      }
    }
    for (const [, role] of ofType("AWS::IAM::Role")) {
      expect(role.Properties["ManagedPolicyArns"]).toBeUndefined();
    }
  });

  it("gives each function a log group of its own, kept a week", () => {
    for (const prefix of ["WorkerLogs", "HousekeepingLogs"]) {
      const group = one("AWS::Logs::LogGroup", prefix);
      expect(group.Properties["RetentionInDays"]).toBe(7);
      expect(group.DeletionPolicy).toBe("Delete");
    }
  });
});

describe("AsyncStack: the schedule", () => {
  const schedule = one("AWS::Scheduler::Schedule", "HousekeepingSchedule");
  const housekeeping = one("AWS::Lambda::Function", "Housekeeping");
  const role = one("AWS::IAM::Role", "ScheduleRole");

  it("starts housekeeping once an hour and gives up on a late delivery", () => {
    expect(schedule.Properties).toEqual({
      Name: "aih-async-housekeeping",
      Description: expect.any(String),
      ScheduleExpression: "rate(1 hour)",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: { "Fn::GetAtt": [housekeeping.id, "Arn"] },
        RoleArn: { "Fn::GetAtt": [role.id, "Arn"] },
        RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 900 },
      },
    });
  });

  it("uses a role only Scheduler can assume, only for this account's default group", () => {
    expect(role.Properties["AssumeRolePolicyDocument"]).toMatchObject({
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "scheduler.amazonaws.com" },
          Action: "sts:AssumeRole",
          Condition: {
            StringEquals: {
              "aws:SourceAccount": { Ref: "AWS::AccountId" },
              "aws:SourceArn": {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    { Ref: "AWS::Partition" },
                    ":scheduler:ap-northeast-1:",
                    { Ref: "AWS::AccountId" },
                    ":schedule-group/default",
                  ],
                ],
              },
            },
          },
        },
      ],
    });
    expect(roleStatements("ScheduleRole")).toEqual([
      {
        Effect: "Allow",
        Action: "lambda:InvokeFunction",
        Resource: { "Fn::GetAtt": [housekeeping.id, "Arn"] },
      },
    ]);
  });

  it("does not let Lambda run a failed housekeeping again on its own", () => {
    template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
      FunctionName: { Ref: housekeeping.id },
      MaximumRetryAttempts: 0,
      MaximumEventAgeInSeconds: 3600,
    });
  });
});

describe("AsyncStack: next to chapter 07's stack", () => {
  it("uses a sign-in domain of its own, and reports that one", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: { "Fn::Join": ["", ["aih-async-", { Ref: "AWS::AccountId" }]] },
    });
    template.hasOutput("AuthDomain", {
      Value: {
        "Fn::Join": [
          "",
          [
            "https://aih-async-",
            { Ref: "AWS::AccountId" },
            ".auth.ap-northeast-1.amazoncognito.com",
          ],
        ],
      },
    });
  });

  it("tells both new functions which table and bucket to use", () => {
    for (const prefix of ["Worker", "Housekeeping"]) {
      expect(one("AWS::Lambda::Function", prefix).Properties["Environment"]).toEqual({
        Variables: {
          TABLE_NAME: { Ref: expect.stringMatching(/^Notes/) },
          UPLOADS_BUCKET: { Ref: uploads.id },
          LOG_LEVEL: "info",
        },
      });
    }
  });
});

describe("AsyncStack: resources", () => {
  it("uses only resource types looked up in the pinned cdkd", () => {
    // Chapter 07's nineteen types and five new ones. cdkd 0.296.28 registers a
    // dedicated provider for each of the five; the three without one are
    // chapter 06's (CloudFront::Function, Cognito::UserPoolClient, Cognito::UserPoolDomain).
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Authorizer",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::Function",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::Cognito::UserPool",
      "AWS::Cognito::UserPoolClient",
      "AWS::Cognito::UserPoolDomain",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::EventInvokeConfig",
      "AWS::Lambda::EventSourceMapping",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
      "AWS::Scheduler::Schedule",
    ]);
  });
});
