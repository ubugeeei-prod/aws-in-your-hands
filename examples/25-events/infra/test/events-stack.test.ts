import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { compile } from "../../src/pattern.ts";
import {
  ARCHIVE_PATTERN,
  ARCHIVE_RETENTION_DAYS,
  COUNTED_MARKER_DAYS,
  PIPE_FILTER,
  RULES,
} from "../../src/routes.ts";
import { EventsStack } from "../lib/events-stack.ts";

// Synthesized once: each synth bundles six functions.
const template = Template.fromStack(
  new EventsStack(new App(), "AihEvents", { env: { region: "ap-northeast-1" } }),
);
type Resource = {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string[];
  DeletionPolicy?: string;
};
const resources = template.toJSON()["Resources"] as Record<string, Resource>;
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
const statementsOf = (resource: Resource): Statement[] =>
  (resource.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement;
const roleStatements = (rolePrefix: string): Statement[] =>
  ofType("AWS::IAM::Policy")
    .filter(([, policy]) => JSON.stringify(policy.Properties["Roles"]).includes(`"${rolePrefix}`))
    .flatMap(([, policy]) => statementsOf(policy));
const actionsOf = (statements: Statement[]) =>
  statements.flatMap((statement) => [statement.Action].flat()).toSorted();
const allows = (resource: Resource) =>
  statementsOf(resource).filter((statement) => statement.Effect === "Allow");
const arn = (id: string) => ({ "Fn::GetAtt": [id, "Arn"] });

const bus = one("AWS::Events::EventBus", "Bus");
const notes = one("AWS::DynamoDB::Table", "Notes");
const projections = one("AWS::DynamoDB::Table", "Projections");
const deadLetters = one("AWS::SQS::Queue", "EventDeadLetters");
const counterEvents = one("AWS::SQS::Queue", "CounterEvents");
const inbox = one("AWS::SQS::Queue", "RejectionInbox");
const topic = one("AWS::SNS::Topic", "Rejections");
const rule = (name: string) => one("AWS::Events::Rule", name);
const fn = (name: string) => one("AWS::Lambda::Function", name);
type Target = Record<string, unknown>;
const targetsOf = (name: string) => rule(name).Properties["Targets"] as Target[];

describe("EventsStack: where the events come from", () => {
  it("turns on the stream of chapter 05's table, with the item before and after", () => {
    expect(notes.Properties["StreamSpecification"]).toEqual({
      StreamViewType: "NEW_AND_OLD_IMAGES",
    });
  });

  it("gives the API and the worker no permission on the bus: they do not publish", () => {
    for (const role of ["HandlerRole", "WorkerRole", "HousekeepingRole"]) {
      expect(
        actionsOf(roleStatements(role)).filter((action) => action.startsWith("events:")),
      ).toEqual([]);
    }
  });

  it("reads the stream from its oldest record, one record at a time, and gives up after three retries", () => {
    const pipe = one("AWS::Pipes::Pipe", "Changes");
    expect(pipe.Properties).toMatchObject({
      Source: { "Fn::GetAtt": [notes.id, "StreamArn"] },
      Enrichment: arn(fn("Shape").id),
      Target: arn(bus.id),
      TargetParameters: {
        EventBridgeEventBusParameters: { Source: "aih.notes", DetailType: "$.type" },
      },
    });
    const source = pipe.Properties["SourceParameters"] as {
      DynamoDBStreamParameters: Record<string, unknown>;
      FilterCriteria: { Filters: { Pattern: string }[] };
    };
    expect(source.DynamoDBStreamParameters).toEqual({
      StartingPosition: "TRIM_HORIZON",
      BatchSize: 1,
      MaximumRetryAttempts: 3,
      // Under the stream's 24 hours.
      MaximumRecordAgeInSeconds: 21_600,
      DeadLetterConfig: { Arn: arn(deadLetters.id) },
    });
    // The very object the tests run through the local matcher.
    expect(source.FilterCriteria.Filters.map((filter) => JSON.parse(filter.Pattern))).toEqual([
      PIPE_FILTER,
    ]);
    expect(pipe.DependsOn).toEqual(
      expect.arrayContaining([one("AWS::IAM::Policy", "PipeRole").id]),
    );
  });

  it("lets the pipe read this stream, call this function, publish to this bus, and no more", () => {
    const statements = roleStatements("PipeRole");
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        Resource: { "Fn::GetAtt": [notes.id, "StreamArn"] },
      },
      // The one "*" in the stack: IAM defines no resource type for ListStreams.
      { Effect: "Allow", Action: "dynamodb:ListStreams", Resource: "*" },
      { Effect: "Allow", Action: "lambda:InvokeFunction", Resource: arn(fn("Shape").id) },
      { Effect: "Allow", Action: "events:PutEvents", Resource: arn(bus.id) },
      { Effect: "Allow", Action: "sqs:SendMessage", Resource: arn(deadLetters.id) },
    ]);
    expect(one("AWS::IAM::Role", "PipeRole").Properties["AssumeRolePolicyDocument"]).toMatchObject({
      Statement: [{ Principal: { Service: "pipes.amazonaws.com" }, Action: "sts:AssumeRole" }],
    });
  });

  it("gives the shaping function nothing but its log group", () => {
    expect(actionsOf(roleStatements("ShapeRole"))).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
  });
});

describe("EventsStack: the rules", () => {
  it("deploys the patterns the tests evaluate, and the local matcher can read every one", () => {
    expect(rule("TimelineRule").Properties["EventPattern"]).toEqual(RULES.timeline);
    expect(rule("CounterRule").Properties["EventPattern"]).toEqual(RULES.counter);
    expect(rule("RejectionsRule").Properties["EventPattern"]).toEqual(RULES.rejections);
    for (const [, resource] of ofType("AWS::Events::Rule")) {
      expect(resource.Properties["EventBusName"]).toEqual({ Ref: bus.id });
      expect(() => compile(resource.Properties["EventPattern"])).not.toThrow();
    }
  });

  it("gives every target a bounded retry and the dead-letter queue", () => {
    for (const name of ["TimelineRule", "CounterRule", "RejectionsRule"]) {
      const targets = targetsOf(name);
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({
        RetryPolicy: { MaximumRetryAttempts: 8, MaximumEventAgeInSeconds: 3600 },
        DeadLetterConfig: { Arn: arn(deadLetters.id) },
      });
    }
  });

  it("sends each rule to its own kind of target", () => {
    expect(targetsOf("TimelineRule")[0]?.["Arn"]).toEqual(arn(fn("Timeline").id));
    expect(targetsOf("CounterRule")[0]?.["Arn"]).toEqual(arn(counterEvents.id));
    expect(targetsOf("RejectionsRule")[0]?.["Arn"]).toEqual({ Ref: topic.id });
  });

  it("hands the topic a message of its own shape, built from five fields of the event", () => {
    const transformer = targetsOf("RejectionsRule")[0]?.["InputTransformer"] as {
      InputPathsMap: Record<string, string>;
      InputTemplate: string;
    };
    expect(transformer.InputPathsMap).toEqual({
      owner: "$.detail.owner",
      noteId: "$.detail.noteId",
      attachmentId: "$.detail.attachmentId",
      reason: "$.detail.reason",
      at: "$.detail.occurredAt",
    });
    // Filled in the way the documentation describes: a string variable is quoted for us.
    const filled = transformer.InputTemplate.replaceAll(/<(\w+)>/g, (_, name) =>
      JSON.stringify(`value-of-${name}`),
    );
    expect(JSON.parse(filled)).toEqual({
      kind: "attachment_rejected",
      owner: "value-of-owner",
      noteId: "value-of-noteId",
      attachmentId: "value-of-attachmentId",
      reason: "value-of-reason",
      at: "value-of-at",
    });
    // Neither of the other two targets rewrites the event.
    expect(targetsOf("TimelineRule")[0]).not.toHaveProperty("InputTransformer");
    expect(targetsOf("CounterRule")[0]).not.toHaveProperty("InputTransformer");
  });
});

describe("EventsStack: who may deliver where", () => {
  const from = (ruleId: string) => ({ ArnEquals: { "aws:SourceArn": arn(ruleId) } });
  const events = { Service: "events.amazonaws.com" };

  it("only the timeline's rule may invoke the timeline function", () => {
    const permissions = ofType("AWS::Lambda::Permission").filter(
      ([, permission]) => permission.Properties["Principal"] === "events.amazonaws.com",
    );
    expect(permissions.map(([, permission]) => permission.Properties)).toEqual([
      {
        Action: "lambda:InvokeFunction",
        FunctionName: { Ref: fn("Timeline").id },
        Principal: "events.amazonaws.com",
        SourceArn: arn("TimelineRule"),
      },
    ]);
  });

  it("only the counter's rule may send to the counter's queue", () => {
    expect(allows(one("AWS::SQS::QueuePolicy", "CounterEvents"))).toEqual([
      {
        Effect: "Allow",
        Principal: events,
        Action: "sqs:SendMessage",
        Resource: arn(counterEvents.id),
        Condition: from("CounterRule"),
      },
    ]);
  });

  it("only the three rules may send to the dead-letter queue by its policy", () => {
    expect(allows(one("AWS::SQS::QueuePolicy", "EventDeadLetters"))).toEqual(
      ["TimelineRule", "CounterRule", "RejectionsRule"].map((name) => ({
        Effect: "Allow",
        Principal: events,
        Action: "sqs:SendMessage",
        Resource: arn(deadLetters.id),
        Condition: from(name),
      })),
    );
  });

  it("EventBridge may publish to the topic, and only the topic may send to the inbox", () => {
    expect(allows(one("AWS::SNS::TopicPolicy", "Rejections"))).toMatchObject([
      { Principal: events, Action: "sns:Publish", Resource: { Ref: topic.id } },
    ]);
    expect(allows(one("AWS::SQS::QueuePolicy", "RejectionInbox"))).toEqual([
      {
        Effect: "Allow",
        Principal: { Service: "sns.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: arn(inbox.id),
        Condition: { ArnEquals: { "aws:SourceArn": { Ref: topic.id } } },
      },
    ]);
    expect(one("AWS::SNS::Subscription", "RejectionInbox").Properties).toEqual({
      TopicArn: { Ref: topic.id },
      Protocol: "sqs",
      Endpoint: arn(inbox.id),
      RawMessageDelivery: true,
    });
  });

  it("every queue and the topic refuse plain HTTP, and no queue is open to an account", () => {
    for (const [, policy] of [
      ...ofType("AWS::SQS::QueuePolicy"),
      ...ofType("AWS::SNS::TopicPolicy"),
    ]) {
      expect(JSON.stringify(statementsOf(policy))).toContain('"aws:SecureTransport":"false"');
      for (const statement of allows(policy)) {
        expect(statement.Principal).toHaveProperty("Service");
      }
    }
  });
});

describe("EventsStack: the consumers", () => {
  it("timeline: may put into the projections and send its failures aside", () => {
    expect(actionsOf(roleStatements("TimelineRole"))).toEqual([
      "dynamodb:PutItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sqs:SendMessage",
    ]);
  });

  it("timeline: Lambda retries a failed run twice, then records it in the dead-letter queue", () => {
    const config = one("AWS::Lambda::EventInvokeConfig", "TimelineAsync");
    expect(config.Properties).toEqual({
      FunctionName: { Ref: fn("Timeline").id },
      Qualifier: "$LATEST",
      MaximumRetryAttempts: 2,
      MaximumEventAgeInSeconds: 3600,
      DestinationConfig: { OnFailure: { Destination: arn(deadLetters.id) } },
    });
    expect(config.DependsOn).toEqual(
      expect.arrayContaining([one("AWS::IAM::Policy", "TimelineRole").id]),
    );
  });

  it("counter: reads its own queue and writes the two items of its transaction", () => {
    const statements = roleStatements("CounterRole");
    expect(actionsOf(statements)).toEqual([
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ]);
    expect(one("AWS::Lambda::EventSourceMapping", "CounterSource").Properties).toEqual({
      EventSourceArn: arn(counterEvents.id),
      FunctionName: { Ref: fn("Counter").id },
      BatchSize: 10,
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("counter: the queue hides a message for six times the function's timeout, then five receives", () => {
    expect(fn("Counter").Properties["Timeout"]).toBe(10);
    expect(counterEvents.Properties).toMatchObject({
      VisibilityTimeout: 60,
      RedrivePolicy: { deadLetterTargetArn: arn(deadLetters.id), maxReceiveCount: 5 },
    });
  });

  it("neither consumer can touch the notes, the uploads, or the bus", () => {
    for (const role of ["TimelineRole", "CounterRole", "ShapeRole"]) {
      const text = JSON.stringify(roleStatements(role));
      expect(text).not.toContain(notes.id);
      expect(text).not.toContain("Uploads");
      expect(text).not.toContain("events:");
    }
    for (const name of ["Timeline", "Counter"]) {
      expect(fn(name).Properties["Environment"]).toEqual({
        Variables: { PROJECTIONS_TABLE: { Ref: projections.id }, LOG_LEVEL: "info" },
      });
    }
  });
});

describe("EventsStack: what is kept, and for how long", () => {
  it("archives what this application publishes for a week, not for ever", () => {
    expect(one("AWS::Events::Archive", "Archive").Properties).toEqual({
      SourceArn: arn(bus.id),
      EventPattern: ARCHIVE_PATTERN,
      RetentionDays: ARCHIVE_RETENTION_DAYS,
    });
    expect(ARCHIVE_RETENTION_DAYS).toBe(7);
  });

  it("keeps the counter's markers longer than anything a replay can bring back", () => {
    expect(COUNTED_MARKER_DAYS).toBeGreaterThan(ARCHIVE_RETENTION_DAYS);
    expect(projections.Properties["TimeToLiveSpecification"]).toEqual({
      AttributeName: "expiresAt",
      Enabled: true,
    });
  });

  it("keeps a dead letter longer than the queue it came from", () => {
    expect(deadLetters.Properties["MessageRetentionPeriod"]).toBe(14 * 24 * 60 * 60);
    expect(counterEvents.Properties["MessageRetentionPeriod"]).toBe(4 * 24 * 60 * 60);
  });

  it("deletes the new queues, the projections, and the logs with the stack", () => {
    for (const resource of [deadLetters, counterEvents, inbox, projections]) {
      expect(resource.DeletionPolicy).toBe("Delete");
    }
    for (const prefix of ["ShapeLogs", "TimelineLogs", "CounterLogs"]) {
      const group = one("AWS::Logs::LogGroup", prefix);
      expect(group.Properties["RetentionInDays"]).toBe(7);
      expect(group.DeletionPolicy).toBe("Delete");
    }
  });

  it("bounds what the projections can be charged for, and encrypts the queues", () => {
    expect(projections.Properties["OnDemandThroughput"]).toEqual({
      MaxReadRequestUnits: 20,
      MaxWriteRequestUnits: 20,
    });
    for (const queue of [deadLetters, counterEvents, inbox]) {
      expect(queue.Properties["SqsManagedSseEnabled"]).toBe(true);
    }
  });
});

describe("EventsStack: next to chapter 08's stack", () => {
  const account = { Ref: "AWS::AccountId" };

  it("uses a bucket name, a schedule name, and a sign-in domain of its own", () => {
    expect(one("AWS::S3::Bucket", "Uploads").Properties["BucketName"]).toEqual({
      "Fn::Join": ["", ["aih-events-uploads-", account]],
    });
    expect(one("AWS::Scheduler::Schedule", "HousekeepingSchedule").Properties["Name"]).toBe(
      "aih-events-housekeeping",
    );
    template.hasOutput("HousekeepingScheduleName", { Value: "aih-events-housekeeping" });
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: { "Fn::Join": ["", ["aih-events-", account]] },
    });
  });

  it("lets S3 send to chapter 08's queue for the renamed bucket, and for no other", () => {
    expect(allows(one("AWS::SQS::QueuePolicy", "UploadEvents"))).toEqual([
      {
        Effect: "Allow",
        Principal: { Service: "s3.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: arn(one("AWS::SQS::Queue", "UploadEvents").id),
        Condition: {
          ArnEquals: {
            "aws:SourceArn": {
              "Fn::Join": [
                "",
                ["arn:", { Ref: "AWS::Partition" }, ":s3:::aih-events-uploads-", account],
              ],
            },
          },
          StringEquals: { "aws:SourceAccount": account },
        },
      },
    ]);
    expect(JSON.stringify(template.toJSON())).not.toContain("aih-async");
  });

  it("keeps chapter 08's worker and its limits as they were", () => {
    expect(one("AWS::Lambda::EventSourceMapping", "WorkerSource").Properties).toMatchObject({
      BatchSize: 10,
      ScalingConfig: { MaximumConcurrency: 2 },
    });
    expect(notes.Properties["OnDemandThroughput"]).toEqual({
      MaxReadRequestUnits: 150,
      MaxWriteRequestUnits: 40,
    });
  });
});

describe("EventsStack: permissions and resources as a whole", () => {
  it("no statement uses a wildcard action, and only ListStreams a wildcard resource", () => {
    const wide: (string | string[])[] = [];
    for (const [, policy] of ofType("AWS::IAM::Policy")) {
      for (const statement of statementsOf(policy)) {
        for (const action of [statement.Action].flat()) {
          expect(action).not.toContain("*");
        }
        if (JSON.stringify(statement.Resource) === '"*"') {
          wide.push(statement.Action);
        }
      }
    }
    expect(wide).toEqual(["dynamodb:ListStreams"]);
    for (const [, role] of ofType("AWS::IAM::Role")) {
      expect(role.Properties["ManagedPolicyArns"]).toBeUndefined();
    }
  });

  it("adds no custom resource", () => {
    expect(
      Object.values(resources).filter((resource) => resource.Type.startsWith("Custom::")),
    ).toEqual([]);
  });

  it("uses only resource types looked up in the pinned cdkd", () => {
    // Chapter 08's twenty-four types and seven new ones. cdkd 0.296.28 registers
    // a provider for six of the seven; AWS::Events::Archive has none and goes
    // through Cloud Control API.
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
      "AWS::Events::Archive",
      "AWS::Events::EventBus",
      "AWS::Events::Rule",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::EventInvokeConfig",
      "AWS::Lambda::EventSourceMapping",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::Pipes::Pipe",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
      "AWS::SNS::Subscription",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
      "AWS::Scheduler::Schedule",
    ]);
  });
});
