import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { checkLambdaTimeouts } from "../../src/lease.ts";
import { SqsStack, type SqsStackProps } from "../lib/sqs-stack.ts";

type Resource = {
  Type: string;
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
};
type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
  Principal?: unknown;
};

function synth(props: Partial<SqsStackProps> = {}) {
  const template = Template.fromStack(
    new SqsStack(new App(), "AihSqs", { env: { region: "ap-northeast-1" }, ...props }),
  );
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
  return { template, resources, ofType, one };
}

// Synthesized once: each synth bundles the worker.
const stack = synth();
const commands = stack.one("AWS::SQS::Queue", "Commands");
const deadLetters = stack.one("AWS::SQS::Queue", "DeadLetters");
const arnOf = (id: string) => ({ "Fn::GetAtt": [id, "Arn"] });

describe("SqsStack: the queues", () => {
  it("makes both FIFO, the source with explicit deduplication IDs and its dead-letter queue", () => {
    expect(commands.Properties).toMatchObject({
      QueueName: "aih-sqs-commands.fifo",
      FifoQueue: true,
      ContentBasedDeduplication: false,
      VisibilityTimeout: 60,
      MessageRetentionPeriod: 4 * 24 * 60 * 60,
      ReceiveMessageWaitTimeSeconds: 20,
      RedrivePolicy: { deadLetterTargetArn: arnOf(deadLetters.id), maxReceiveCount: 5 },
    });
    expect(deadLetters.Properties).toMatchObject({
      QueueName: "aih-sqs-dead-letters.fifo",
      FifoQueue: true,
    });
    expect(deadLetters.Properties["RedrivePolicy"]).toBeUndefined();
  });

  it("keeps a dead letter longer than the source queue keeps a message", () => {
    expect(deadLetters.Properties["MessageRetentionPeriod"]).toBe(14 * 24 * 60 * 60);
  });

  it("encrypts both with the key SQS manages, and deletes them with the stack", () => {
    for (const queue of [commands, deadLetters]) {
      expect(queue.Properties["SqsManagedSseEnabled"]).toBe(true);
      expect(queue.Properties["KmsMasterKeyId"]).toBeUndefined();
      expect(queue.DeletionPolicy).toBe("Delete");
    }
  });

  it("lends a message for at least what Lambda asks, given the worker's timeout", () => {
    const worker = stack.one("AWS::Lambda::Function", "Worker");
    expect(
      checkLambdaTimeouts({
        visibilityTimeoutSeconds: commands.Properties["VisibilityTimeout"] as number,
        functionTimeoutSeconds: worker.Properties["Timeout"] as number,
      }),
    ).toEqual([]);
  });
});

describe("SqsStack: who may use the queues", () => {
  const statementsOf = (queueId: string, from = stack) =>
    from
      .ofType("AWS::SQS::QueuePolicy")
      .filter(([, policy]) => JSON.stringify(policy.Properties["Queues"]).includes(queueId))
      .flatMap(
        ([, policy]) =>
          (policy.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement,
      );

  it("by default allows nobody in the queue policies, and refuses requests without TLS", () => {
    for (const queue of [commands, deadLetters]) {
      expect(statementsOf(queue.id)).toEqual([
        {
          Effect: "Deny",
          Principal: { AWS: "*" },
          Action: "sqs:*",
          Resource: arnOf(queue.id),
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ]);
    }
  });

  it("lets another account send to the source queue only, and only when asked", () => {
    const shared = synth({ senderAccountId: "111122223333" });
    const source = shared.one("AWS::SQS::Queue", "Commands");
    const allowed = statementsOf(source.id, shared).filter(
      (statement) => statement.Effect === "Allow",
    );
    expect(allowed).toEqual([
      {
        Effect: "Allow",
        Principal: {
          AWS: { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ":iam::111122223333:root"]] },
        },
        Action: "sqs:SendMessage",
        Resource: arnOf(source.id),
      },
    ]);
    const dead = shared.one("AWS::SQS::Queue", "DeadLetters");
    expect(statementsOf(dead.id, shared).every((statement) => statement.Effect === "Deny")).toBe(
      true,
    );
  });
});

describe("SqsStack: the worker", () => {
  const statements = stack
    .ofType("AWS::IAM::Policy")
    .flatMap(
      ([, policy]) => (policy.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement,
    );
  const edits = stack.one("AWS::DynamoDB::Table", "Edits");
  const logGroup = stack.one("AWS::Logs::LogGroup", "WorkerLogs");

  it("has exactly the permissions the code uses, each on one resource", () => {
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: arnOf(logGroup.id),
      },
      {
        Effect: "Allow",
        Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        Resource: arnOf(commands.id),
      },
      { Effect: "Allow", Action: "sqs:SendMessage", Resource: arnOf(deadLetters.id) },
      {
        Effect: "Allow",
        Action: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
        Resource: arnOf(edits.id),
      },
    ]);
    expect(JSON.stringify(statements)).not.toContain('"*"');
  });

  it("can be assumed by Lambda only, and carries no managed policy", () => {
    const role = stack.one("AWS::IAM::Role", "WorkerRole");
    expect(stack.ofType("AWS::IAM::Role")).toHaveLength(1);
    expect(role.Properties["ManagedPolicyArns"]).toBeUndefined();
    expect(role.Properties["AssumeRolePolicyDocument"]).toMatchObject({
      Statement: [
        {
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    });
  });

  it("reads the queue ten at a time, at most two batches at once, reporting failures one by one", () => {
    const mapping = stack.one("AWS::Lambda::EventSourceMapping", "WorkerSource");
    expect(mapping.Properties).toMatchObject({
      EventSourceArn: arnOf(commands.id),
      BatchSize: 10,
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
    // Not available for a FIFO queue.
    expect(mapping.Properties["MaximumBatchingWindowInSeconds"]).toBeUndefined();
  });

  it("is told where the table and the dead-letter queue are", () => {
    const worker = stack.one("AWS::Lambda::Function", "Worker");
    expect(worker.Properties).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Timeout: 10,
      Environment: {
        Variables: {
          TABLE_NAME: { Ref: edits.id },
          DEAD_LETTER_QUEUE_URL: { Ref: deadLetters.id },
        },
      },
    });
  });

  it("keeps its log for a week, and its table within a ceiling", () => {
    expect(logGroup.Properties["RetentionInDays"]).toBe(7);
    expect(logGroup.DeletionPolicy).toBe("Delete");
    expect(edits.Properties).toMatchObject({
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 10, MaxWriteRequestUnits: 100 },
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
    expect(edits.DeletionPolicy).toBe("Delete");
  });
});

describe("SqsStack: alarms", () => {
  const queueName = (id: string) => ({ "Fn::GetAtt": [id, "QueueName"] });

  it("rings when anything is in the dead-letter queue", () => {
    expect(stack.one("AWS::CloudWatch::Alarm", "DeadLettersNotEmpty").Properties).toMatchObject({
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Dimensions: [{ Name: "QueueName", Value: queueName(deadLetters.id) }],
      Statistic: "Maximum",
      Period: 60,
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: 1,
      TreatMissingData: "notBreaching",
    });
  });

  it("rings when the oldest command has waited two minutes, two minutes running", () => {
    expect(stack.one("AWS::CloudWatch::Alarm", "CommandsWaiting").Properties).toMatchObject({
      MetricName: "ApproximateAgeOfOldestMessage",
      Dimensions: [{ Name: "QueueName", Value: queueName(commands.id) }],
      Statistic: "Maximum",
      Threshold: 120,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      EvaluationPeriods: 2,
    });
  });

  it("notifies nobody unless a topic is given", () => {
    for (const [, alarm] of stack.ofType("AWS::CloudWatch::Alarm")) {
      expect(alarm.Properties["AlarmActions"]).toBeUndefined();
    }
    const topic = "arn:aws:sns:ap-northeast-1:111122223333:alarms";
    const notified = synth({ alarmTopicArn: topic });
    for (const [, alarm] of notified.ofType("AWS::CloudWatch::Alarm")) {
      expect(alarm.Properties["AlarmActions"]).toEqual([topic]);
    }
    // The topic is referred to, not created.
    expect(notified.ofType("AWS::SNS::Topic")).toEqual([]);
  });
});

describe("SqsStack: resources", () => {
  it("uses only resource types the pinned cdkd has a provider for", () => {
    // cdkd 0.296.28 registers a dedicated provider for each of these eight.
    expect(
      [...new Set(Object.values(stack.resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::CloudWatch::Alarm",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::EventSourceMapping",
      "AWS::Lambda::Function",
      "AWS::Logs::LogGroup",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
    ]);
  });
});
