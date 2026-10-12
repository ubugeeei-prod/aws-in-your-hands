import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { CONSUMER, ITERATOR_AGE_ALARM_MS, STREAM } from "../../src/settings.ts";
import { KinesisStack, type KinesisStackProps } from "../lib/kinesis-stack.ts";

const synth = (props: Partial<KinesisStackProps> = {}) =>
  Template.fromStack(
    new KinesisStack(new App(), "AihKinesis", { env: { region: "ap-northeast-1" }, ...props }),
  );
// Synthesized once: each synth bundles the function.
const template = synth();

type Resource = {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string[];
  DeletionPolicy?: string;
};
const resources = template.toJSON()["Resources"] as Record<string, Resource>;
const ofType = (type: string) =>
  Object.entries(resources).filter(([, resource]) => resource.Type === type);
const one = (type: string, idPrefix = "") => {
  const found = ofType(type).filter(([id]) => id.startsWith(idPrefix));
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`expected one ${type} starting with "${idPrefix}", found ${found.length}`);
  }
  return { id: found[0][0], ...found[0][1] };
};
type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statements = ofType("AWS::IAM::Policy").flatMap(
  ([, policy]) => (policy.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement,
);
const arn = (id: string) => ({ "Fn::GetAtt": [id, "Arn"] });

const stream = one("AWS::Kinesis::Stream");
const history = one("AWS::DynamoDB::Table");
const failures = one("AWS::SQS::Queue");
const consumer = one("AWS::Lambda::Function");
const mapping = one("AWS::Lambda::EventSourceMapping");

describe("KinesisStack: the stream", () => {
  it("is one provisioned shard, kept for 24 hours and encrypted with the account's Kinesis key", () => {
    expect(stream.Properties).toEqual({
      ShardCount: 1,
      RetentionPeriodHours: 24,
      StreamModeDetails: { StreamMode: "PROVISIONED" },
      StreamEncryption: { EncryptionType: "KMS", KeyId: "alias/aws/kinesis" },
    });
    expect(STREAM).toEqual({ shards: 1, retentionHours: 24 });
  });

  it("registers no enhanced fan-out consumer, which would be billed by the hour", () => {
    expect(ofType("AWS::Kinesis::StreamConsumer")).toEqual([]);
  });
});

describe("KinesisStack: how the function reads the stream", () => {
  it("deploys the settings the local model of the mapping is tested with", () => {
    expect(mapping.Properties).toEqual({
      EventSourceArn: arn(stream.id),
      FunctionName: { Ref: consumer.id },
      StartingPosition: "TRIM_HORIZON",
      BatchSize: CONSUMER.batchSize,
      MaximumBatchingWindowInSeconds: CONSUMER.maximumBatchingWindowSeconds,
      ParallelizationFactor: CONSUMER.parallelizationFactor,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: CONSUMER.maximumRetryAttempts,
      MaximumRecordAgeInSeconds: CONSUMER.maximumRecordAgeSeconds,
      DestinationConfig: { OnFailure: { Destination: arn(failures.id) } },
    });
  });

  it("listens to the failures the function reports: without it they would pass for successes", () => {
    expect(CONSUMER.reportBatchItemFailures).toBe(true);
    expect(mapping.Properties["FunctionResponseTypes"]).toEqual(["ReportBatchItemFailures"]);
  });

  it("gives up on a record while the stream still holds it", () => {
    expect(CONSUMER.maximumRetryAttempts).toBeGreaterThanOrEqual(0);
    expect(CONSUMER.maximumRecordAgeSeconds).toBeGreaterThan(0);
    expect(CONSUMER.maximumRecordAgeSeconds).toBeLessThan(STREAM.retentionHours * 3600);
  });

  it("keeps one batch of a shard in flight, so the shard's order is the function's order", () => {
    expect(mapping.Properties["ParallelizationFactor"]).toBe(1);
  });

  it("creates the mapping after the role's policy, which Lambda checks at creation", () => {
    expect(mapping.DependsOn).toEqual(
      expect.arrayContaining([one("AWS::IAM::Policy", "ConsumerRole").id]),
    );
  });
});

describe("KinesisStack: what the function may do", () => {
  it("reads this stream, updates this table, writes to this queue and its own log group", () => {
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: arn(one("AWS::Logs::LogGroup").id),
      },
      {
        Effect: "Allow",
        Action: [
          "kinesis:DescribeStream",
          "kinesis:DescribeStreamSummary",
          "kinesis:GetRecords",
          "kinesis:GetShardIterator",
          "kinesis:ListShards",
          "kinesis:SubscribeToShard",
        ],
        Resource: arn(stream.id),
      },
      { Effect: "Allow", Action: "dynamodb:UpdateItem", Resource: arn(history.id) },
      { Effect: "Allow", Action: "sqs:SendMessage", Resource: arn(failures.id) },
    ]);
  });

  it("cannot write to the stream it reads, and uses no managed policy", () => {
    expect(JSON.stringify(statements)).not.toContain("kinesis:Put");
    for (const [, role] of ofType("AWS::IAM::Role")) {
      expect(role.Properties["ManagedPolicyArns"]).toBeUndefined();
    }
    expect(one("AWS::IAM::Role").Properties["AssumeRolePolicyDocument"]).toMatchObject({
      Statement: [{ Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
    });
  });

  it("uses no wildcard in any action or resource", () => {
    for (const statement of statements) {
      expect(JSON.stringify(statement.Action)).not.toContain("*");
      expect(JSON.stringify(statement.Resource)).not.toContain("*");
    }
  });

  it("runs on arm64 with the table's name and nothing else in its environment", () => {
    expect(consumer.Properties).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      MemorySize: 256,
      Timeout: 30,
      Environment: { Variables: { HISTORY_TABLE: { Ref: history.id }, LOG_LEVEL: "info" } },
    });
  });
});

describe("KinesisStack: what is kept, and what goes with the stack", () => {
  it("keeps a failure record longer than the stream keeps the batch it points at", () => {
    expect(failures.Properties).toMatchObject({
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
      SqsManagedSseEnabled: true,
    });
    expect(JSON.stringify(one("AWS::SQS::QueuePolicy").Properties)).toContain(
      '"aws:SecureTransport":"false"',
    );
  });

  it("bounds what the history table can be charged for", () => {
    expect(history.Properties).toMatchObject({
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [{ AttributeName: "noteId", KeyType: "HASH" }],
      OnDemandThroughput: { MaxReadRequestUnits: 20, MaxWriteRequestUnits: 100 },
    });
  });

  it("deletes the stream, the table, the queue, and the logs with the stack", () => {
    for (const resource of [stream, history, failures]) {
      expect(resource.DeletionPolicy).toBe("Delete");
    }
    const logGroup = one("AWS::Logs::LogGroup");
    expect(logGroup.Properties["RetentionInDays"]).toBe(7);
    expect(logGroup.DeletionPolicy).toBe("Delete");
  });
});

describe("KinesisStack: alarms", () => {
  const alarm = (prefix: string) => one("AWS::CloudWatch::Alarm", prefix).Properties;
  const topic = { Ref: one("AWS::SNS::Topic").id };

  it("rings when the newest record handed to the function is half an hour old", () => {
    expect(alarm("ConsumerBehind")).toMatchObject({
      Namespace: "AWS/Lambda",
      MetricName: "IteratorAge",
      Dimensions: [{ Name: "FunctionName", Value: { Ref: consumer.id } }],
      Statistic: "Maximum",
      Period: 300,
      Threshold: ITERATOR_AGE_ALARM_MS,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: 1,
      TreatMissingData: "notBreaching",
      AlarmActions: [topic],
    });
    // Far inside the time after which the record is gone.
    expect(ITERATOR_AGE_ALARM_MS).toBeLessThan((STREAM.retentionHours * 3_600_000) / 2);
  });

  it("rings when the failure queue holds anything", () => {
    expect(alarm("RecordsGivenUp")).toMatchObject({
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Dimensions: [{ Name: "QueueName", Value: { "Fn::GetAtt": [failures.id, "QueueName"] } }],
      Statistic: "Maximum",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      AlarmActions: [topic],
    });
  });

  it("rings when writes have been refused for three periods in a row", () => {
    expect(alarm("WritesRefused")).toMatchObject({
      Namespace: "AWS/Kinesis",
      MetricName: "WriteProvisionedThroughputExceeded",
      Dimensions: [{ Name: "StreamName", Value: { Ref: stream.id } }],
      Statistic: "Sum",
      Period: 300,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 3,
      AlarmActions: [topic],
    });
  });

  it("lets this account's alarms, and nothing else, publish to the topic it creates", () => {
    const policy = one("AWS::SNS::TopicPolicy").Properties["PolicyDocument"] as {
      Statement: Record<string, unknown>[];
    };
    expect(policy.Statement.filter((statement) => statement["Effect"] === "Allow")).toEqual([
      {
        Sid: "AlarmsOfThisAccount",
        Effect: "Allow",
        Principal: { Service: "cloudwatch.amazonaws.com" },
        Action: "sns:Publish",
        Resource: topic,
        Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } },
      },
    ]);
    expect(JSON.stringify(policy)).toContain('"aws:SecureTransport":"false"');
  });

  it("subscribes an address only when one is given, and makes no topic when one is passed in", () => {
    expect(ofType("AWS::SNS::Subscription")).toEqual([]);
    synth({ alarmEmail: "oncall@example.com" }).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "oncall@example.com",
    });
    const given = synth({
      alarmTopicArn: "arn:aws:sns:ap-northeast-1:111122223333:AihObservability-Alarms",
    });
    given.resourceCountIs("AWS::SNS::Topic", 0);
    given.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: ["arn:aws:sns:ap-northeast-1:111122223333:AihObservability-Alarms"],
    });
  });
});

describe("KinesisStack: resources as a whole", () => {
  it("adds no custom resource", () => {
    expect(
      Object.values(resources).filter((resource) => resource.Type.startsWith("Custom::")),
    ).toEqual([]);
  });

  it("uses only resource types the pinned cdkd has a provider for", () => {
    // All twelve are registered in cdkd 0.296.28's provider registry. None goes through Cloud Control API.
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::CloudWatch::Alarm",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Kinesis::Stream",
      "AWS::Lambda::EventSourceMapping",
      "AWS::Lambda::Function",
      "AWS::Logs::LogGroup",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
    ]);
  });
});
