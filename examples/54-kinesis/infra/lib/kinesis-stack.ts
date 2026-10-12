import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { CONSUMER, ITERATOR_AGE_ALARM_MS, STREAM } from "../../src/settings.ts";

export type KinesisStackProps = StackProps & {
  /** Subscribed to the topic this stack creates. Ignored when a topic is given. */
  alarmEmail?: string | undefined;
  /** An existing topic in this account, such as chapter 19's AlarmTopicArn. Without it, the stack makes one. */
  alarmTopicArn?: string | undefined;
};

const CONSUMER_TIMEOUT_SECONDS = 30;
// Request units per second the consumer may spend on the table. One shard brings at most 1,000 records a second.
const HISTORY_LIMIT = { read: 20, write: 100 } as const;
const fiveMinutes = Duration.minutes(5);

export class KinesisStack extends Stack {
  constructor(scope: Construct, id: string, props: KinesisStackProps) {
    super(scope, id, props);

    // #region stream
    // Billed for every hour it exists, per shard, whether or not anything is written.
    const stream = new kinesis.Stream(this, "Revisions", {
      streamMode: kinesis.StreamMode.PROVISIONED,
      shardCount: STREAM.shards,
      // The shortest there is, and the only length without a charge of its own.
      retentionPeriod: Duration.hours(STREAM.retentionHours),
      // The key Kinesis keeps for the account. No key to pay for, and no IAM statement to add.
      encryption: kinesis.StreamEncryption.MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion stream

    // #region history
    const history = new dynamodb.Table(this, "History", {
      partitionKey: { name: "noteId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: HISTORY_LIMIT.read,
      maxWriteRequestUnits: HISTORY_LIMIT.write,
      // Derived data: a consumer that reads the stream from its start builds it again.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion history

    // #region failures
    // Lambda writes here where the batch it gave up on is. The records
    // themselves stay in the stream, and only for as long as it keeps them.
    const failures = new sqs.Queue(this, "Failures", {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion failures

    // #region consumer
    const logGroup = new logs.LogGroup(this, "ConsumerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "ConsumerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);
    // The six actions the Lambda documentation lists for a Kinesis event source, on this stream only.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "kinesis:DescribeStream",
          "kinesis:DescribeStreamSummary",
          "kinesis:GetRecords",
          "kinesis:GetShardIterator",
          "kinesis:ListShards",
          "kinesis:SubscribeToShard",
        ],
        resources: [stream.streamArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["dynamodb:UpdateItem"], resources: [history.tableArn] }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [failures.queueArn] }),
    );

    const consumer = new nodejs.NodejsFunction(this, "Consumer", {
      entry: fileURLToPath(new URL("../../src/consumer-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(CONSUMER_TIMEOUT_SECONDS),
      role,
      logGroup,
      environment: { HISTORY_TABLE: history.tableName, LOG_LEVEL: "info" },
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
    // #endregion consumer

    // #region mapping
    const mapping = new lambda.EventSourceMapping(this, "ConsumerSource", {
      target: consumer,
      eventSourceArn: stream.streamArn,
      // From the oldest record. LATEST can skip what is written while the mapping is being created.
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: CONSUMER.batchSize,
      maxBatchingWindow: Duration.seconds(CONSUMER.maximumBatchingWindowSeconds),
      parallelizationFactor: CONSUMER.parallelizationFactor,
      // The function names the record it failed on. Without this line Lambda does not read the answer.
      reportBatchItemFailures: CONSUMER.reportBatchItemFailures,
      // A failing batch is cut in two until the record at fault is alone.
      bisectBatchOnError: CONSUMER.bisectBatchOnFunctionError,
      // The defaults retry until the record leaves the stream, with its shard waiting behind it.
      retryAttempts: CONSUMER.maximumRetryAttempts,
      maxRecordAge: Duration.seconds(CONSUMER.maximumRecordAgeSeconds),
      onFailure: { bind: () => ({ destination: failures.queueArn }) },
    });
    // Lambda checks what the role may do when the mapping is created.
    mapping.node.addDependency(role);
    // #endregion mapping

    // #region topic
    let topic: sns.ITopic;
    if (props.alarmTopicArn === undefined) {
      const own = new sns.Topic(this, "Alarms", {
        displayName: "AWS in Your Hands: Kinesis",
        enforceSSL: true,
      });
      // Any topic policy replaces the default one, so the alarms' right to publish is spelled out.
      own.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "AlarmsOfThisAccount",
          actions: ["sns:Publish"],
          principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
          resources: [own.topicArn],
          conditions: { StringEquals: { "aws:SourceAccount": this.account } },
        }),
      );
      if (props.alarmEmail !== undefined) {
        own.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
      }
      topic = own;
    } else {
      topic = sns.Topic.fromTopicArn(this, "Alarms", props.alarmTopicArn);
    }
    // #endregion topic

    // #region alarms
    const alarms = [
      // The consumer is behind: the newest record it was handed is this old.
      new cloudwatch.Alarm(this, "ConsumerBehind", {
        alarmDescription: `The consumer is more than ${ITERATOR_AGE_ALARM_MS / 60_000} minutes behind the stream. Records are lost ${STREAM.retentionHours} hours after they are written.`,
        metric: consumer.metric("IteratorAge", { statistic: "Maximum", period: fiveMinutes }),
        threshold: ITERATOR_AGE_ALARM_MS,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        // No invocation, no data point: an empty stream is not a consumer that fell behind.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      // The mapping gave up on a batch, and a person has until retention ends to read it back.
      new cloudwatch.Alarm(this, "RecordsGivenUp", {
        alarmDescription:
          "Lambda gave up on a batch of the stream. The failure queue says which records.",
        metric: failures.metricApproximateNumberOfMessagesVisible({
          statistic: "Maximum",
          period: fiveMinutes,
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      // A producer was refused for a quarter of an hour: a shard is over its limit.
      new cloudwatch.Alarm(this, "WritesRefused", {
        alarmDescription:
          "Writes to the stream have been throttled for 15 minutes. A shard is past 1,000 records or 1 MB a second.",
        metric: stream.metricWriteProvisionedThroughputExceeded({
          statistic: "Sum",
          period: fiveMinutes,
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    for (const alarm of alarms) {
      alarm.addAlarmAction(new cwActions.SnsAction(topic));
    }
    // #endregion alarms

    new CfnOutput(this, "StreamArn", { value: stream.streamArn });
    new CfnOutput(this, "StreamName", { value: stream.streamName });
    new CfnOutput(this, "HistoryTableName", { value: history.tableName });
    new CfnOutput(this, "FailureQueueUrl", { value: failures.queueUrl });
    new CfnOutput(this, "ConsumerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "AlarmTopicArn", { value: topic.topicArn });
  }
}
