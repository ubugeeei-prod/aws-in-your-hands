import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { ALARM, CONSUMER, QUEUE } from "../../src/settings.ts";

export type SqsStackProps = StackProps & {
  /** An existing topic in this account and Region, such as chapter 19's. Without it the alarms notify nobody. */
  alarmTopicArn?: string | undefined;
  /** Another account whose principals may send commands. */
  senderAccountId?: string | undefined;
};

// Request units per second the worker may spend. A command costs four write units.
const TABLE_LIMIT = { read: 10, write: 100 } as const;

export class SqsStack extends Stack {
  constructor(scope: Construct, id: string, props: SqsStackProps) {
    super(scope, id, props);

    // #region queues
    // A FIFO queue's dead-letter queue is a FIFO queue too.
    const deadLetters = new sqs.Queue(this, "DeadLetters", {
      queueName: QUEUE.deadLetterName,
      fifo: true,
      retentionPeriod: Duration.days(QUEUE.deadLetterRetentionDays),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const commands = new sqs.Queue(this, "Commands", {
      queueName: QUEUE.name,
      fifo: true,
      // Off: every send must name its command. Two commands with the same
      // body are two commands.
      contentBasedDeduplication: false,
      // Six times the worker's timeout, as Lambda's documentation asks.
      visibilityTimeout: Duration.seconds(QUEUE.visibilityTimeoutSeconds),
      retentionPeriod: Duration.days(QUEUE.retentionDays),
      // For any consumer that does not say how long it will wait: long polling.
      receiveMessageWaitTime: Duration.seconds(QUEUE.receiveWaitSeconds),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: QUEUE.maxReceiveCount },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion queues

    // #region queue-policy
    // Principals of this account send with their own IAM policies. Anyone
    // else needs a statement here, and gets SendMessage and nothing more.
    if (props.senderAccountId !== undefined) {
      commands.addToResourcePolicy(
        new iam.PolicyStatement({
          principals: [new iam.AccountPrincipal(props.senderAccountId)],
          actions: ["sqs:SendMessage"],
          resources: [commands.queueArn],
        }),
      );
    }
    // #endregion queue-policy

    // #region table
    const edits = new dynamodb.Table(this, "Edits", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: TABLE_LIMIT.read,
      maxWriteRequestUnits: TABLE_LIMIT.write,
      // The markers of applied commands expire; the notes carry no such attribute.
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    // #region worker
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const workerRole = new iam.Role(this, "WorkerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    workerLogs.grants.write(workerRole);
    workerRole.addToPolicy(
      // Lambda polls the queue with the function's own role.
      new iam.PolicyStatement({
        actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        resources: [commands.queueArn],
      }),
    );
    workerRole.addToPolicy(
      // To park a message it cannot read. It never reads the dead-letter queue.
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [deadLetters.queueArn],
      }),
    );
    workerRole.addToPolicy(
      // A transaction is authorized as the writes it is made of.
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [edits.tableArn],
      }),
    );
    const worker = new nodejs.NodejsFunction(this, "Worker", {
      entry: fileURLToPath(new URL("../../src/worker-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(CONSUMER.timeoutSeconds),
      role: workerRole,
      logGroup: workerLogs,
      environment: {
        TABLE_NAME: edits.tableName,
        DEAD_LETTER_QUEUE_URL: deadLetters.queueUrl,
        LOG_LEVEL: "info",
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion worker

    // #region mapping
    const mapping = new lambda.EventSourceMapping(this, "WorkerSource", {
      target: worker,
      eventSourceArn: commands.queueArn,
      // Ten is the most a FIFO queue allows, and a batch window is not available.
      batchSize: CONSUMER.batchSize,
      // The ceiling. The number of notes with waiting commands is the other
      // one: a message group is never given to two invocations at once.
      maxConcurrency: CONSUMER.maxConcurrency,
      reportBatchItemFailures: true,
    });
    // Lambda checks the role's permissions on the queue when the mapping is created.
    mapping.node.addDependency(workerRole);
    // #endregion mapping

    // #region alarms
    const alarms = [
      // Anything here is waiting for a person.
      new cloudwatch.Alarm(this, "DeadLettersNotEmpty", {
        metric: deadLetters.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(1),
          statistic: cloudwatch.Stats.MAXIMUM,
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      // A FIFO queue does not move a failing message out of the way, so one
      // stuck note shows here, minutes before it shows in the dead-letter queue.
      new cloudwatch.Alarm(this, "CommandsWaiting", {
        metric: commands.metricApproximateAgeOfOldestMessage({
          period: Duration.minutes(1),
          statistic: cloudwatch.Stats.MAXIMUM,
        }),
        threshold: ALARM.oldestMessageSeconds,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    if (props.alarmTopicArn !== undefined) {
      const topic = sns.Topic.fromTopicArn(this, "AlarmTopic", props.alarmTopicArn);
      for (const alarm of alarms) {
        alarm.addAlarmAction(new cwActions.SnsAction(topic));
      }
    }
    // #endregion alarms

    new CfnOutput(this, "CommandsQueueUrl", { value: commands.queueUrl });
    new CfnOutput(this, "CommandsQueueArn", { value: commands.queueArn });
    new CfnOutput(this, "DeadLetterQueueUrl", { value: deadLetters.queueUrl });
    new CfnOutput(this, "DeadLetterQueueArn", { value: deadLetters.queueArn });
    new CfnOutput(this, "EditsTableName", { value: edits.tableName });
    new CfnOutput(this, "WorkerLogGroupName", { value: workerLogs.logGroupName });
  }
}
