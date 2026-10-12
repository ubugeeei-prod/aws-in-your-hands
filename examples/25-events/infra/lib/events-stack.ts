import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, type StackProps } from "aws-cdk-lib";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as pipes from "aws-cdk-lib/aws-pipes";
import type * as s3 from "aws-cdk-lib/aws-s3";
import type * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { AsyncStack } from "@aih/example-08-async/infra/lib/async-stack.ts";

import { SOURCE } from "../../src/contract.ts";
import { ARCHIVE_PATTERN, ARCHIVE_RETENTION_DAYS, PIPE_FILTER, RULES } from "../../src/routes.ts";

export const BUS_NAME = "aih-events";
const SCHEDULE_NAME = "aih-events-housekeeping";
const CONSUMER_TIMEOUT_SECONDS = 10;
// Request units per second the projections accept. Two consumers, small items.
const PROJECTIONS_LIMIT = { read: 20, write: 20 } as const;

const source = (file: string): string =>
  fileURLToPath(new URL(`../../src/${file}`, import.meta.url));
// The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
const bundling = {
  format: nodejs.OutputFormat.ESM,
  target: "node24",
  minify: false,
  sourceMap: false,
  externalModules: [],
  banner:
    "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
};

// Chapter 08's stack, unchanged, with what turns its table's changes into
// events and hands them to three consumers. The regions mark what is new.
export class EventsStack extends AsyncStack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const notes = this.node.findChild("Notes") as dynamodb.Table;
    const notesResource = notes.node.defaultChild as dynamodb.CfnTable;
    this.#standApart();

    // #region stream
    // Every change to an item, with the item as it was and as it is. Nothing
    // in the API or the worker changes: they keep writing as before.
    notesResource.streamSpecification = { streamViewType: "NEW_AND_OLD_IMAGES" };
    const streamArn = notesResource.attrStreamArn;
    // #endregion stream

    // #region bus
    const bus = new events.CfnEventBus(this, "Bus", { name: BUS_NAME });
    new events.CfnArchive(this, "Archive", {
      sourceArn: bus.attrArn,
      eventPattern: ARCHIVE_PATTERN,
      // Without this an archive keeps everything, and bills for it, for ever.
      retentionDays: ARCHIVE_RETENTION_DAYS,
    });
    // #endregion bus

    // #region dead-letters
    // One place a person looks, for everything that could not be handed
    // over: by the pipe, by a rule, by Lambda, by the counter's queue.
    const deadLetters = new sqs.Queue(this, "EventDeadLetters", {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion dead-letters

    // #region projections
    const projections = new dynamodb.Table(this, "Projections", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: PROJECTIONS_LIMIT.read,
      maxWriteRequestUnits: PROJECTIONS_LIMIT.write,
      // The markers that say "already counted" carry this and are deleted after it.
      timeToLiveAttribute: "expiresAt",
      // Derived data: it can be rebuilt from the notes, so it goes with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion projections

    // #region shape
    const shape = this.#function("Shape", "shape-lambda.ts", {});
    // #endregion shape

    // #region pipe
    const pipeRole = new iam.Role(this, "PipeRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com"),
    });
    pipeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [streamArn],
      }),
    );
    // ListStreams takes no resource: IAM offers nothing narrower than "*" for it.
    pipeRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["dynamodb:ListStreams"], resources: ["*"] }),
    );
    pipeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [shape.fn.functionArn],
      }),
    );
    pipeRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["events:PutEvents"], resources: [bus.attrArn] }),
    );
    pipeRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [deadLetters.queueArn] }),
    );

    const pipe = new pipes.CfnPipe(this, "Changes", {
      description: "Notes table stream -> shape -> event bus (AWS in Your Hands chapter 25)",
      roleArn: pipeRole.roleArn,
      source: streamArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          // From the oldest record still in the stream, so nothing written
          // while the pipe was being created is skipped.
          startingPosition: "TRIM_HORIZON",
          // One record per execution: a record that fails holds back only itself.
          batchSize: 1,
          // The default is to retry until the record leaves the stream, a day
          // later, with every later change of that shard waiting behind it.
          maximumRetryAttempts: 3,
          // Shorter than the stream's 24 hours, so a record set aside is still readable.
          maximumRecordAgeInSeconds: 6 * 60 * 60,
          deadLetterConfig: { arn: deadLetters.queueArn },
        },
        filterCriteria: { filters: [{ pattern: JSON.stringify(PIPE_FILTER) }] },
      },
      enrichment: shape.fn.functionArn,
      target: bus.attrArn,
      targetParameters: {
        // What the enrichment returned becomes `detail`. Its `type` is read
        // from there for the field the rules match first.
        eventBridgeEventBusParameters: { source: SOURCE, detailType: "$.type" },
      },
    });
    // Pipes checks what the role may do when the pipe is created.
    pipe.node.addDependency(pipeRole);
    // #endregion pipe

    // #region timeline
    const timeline = this.#function("Timeline", "timeline-lambda.ts", {
      PROJECTIONS_TABLE: projections.tableName,
    });
    timeline.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem"],
        resources: [projections.tableArn],
      }),
    );
    // What Lambda does when the function throws: two more tries, then the
    // event and the error go to the dead-letter queue.
    timeline.role.addToPolicy(
      new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [deadLetters.queueArn] }),
    );
    const timelineAsync = new lambda.CfnEventInvokeConfig(this, "TimelineAsync", {
      functionName: timeline.fn.functionName,
      qualifier: "$LATEST",
      maximumRetryAttempts: 2,
      maximumEventAgeInSeconds: 3600,
      destinationConfig: { onFailure: { destination: deadLetters.queueArn } },
    });
    // Lambda checks that the role may send to the destination when this is set.
    timelineAsync.node.addDependency(timeline.role);

    const timelineRule = new events.CfnRule(this, "TimelineRule", {
      eventBusName: bus.ref,
      eventPattern: RULES.timeline,
      targets: [
        {
          id: "timeline",
          arn: timeline.fn.functionArn,
          // What EventBridge does when it cannot hand the event to Lambda at
          // all: an hour of tries at most, then the dead-letter queue.
          retryPolicy: { maximumRetryAttempts: 8, maximumEventAgeInSeconds: 3600 },
          deadLetterConfig: { arn: deadLetters.queueArn },
        },
      ],
    });
    new lambda.CfnPermission(this, "TimelineInvoke", {
      action: "lambda:InvokeFunction",
      functionName: timeline.fn.functionName,
      principal: "events.amazonaws.com",
      sourceArn: timelineRule.attrArn,
    });
    // #endregion timeline

    // #region counter
    const counterEvents = new sqs.Queue(this, "CounterEvents", {
      visibilityTimeout: Duration.seconds(6 * CONSUMER_TIMEOUT_SECONDS),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: 5 },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const counter = this.#function("Counter", "counter-lambda.ts", {
      PROJECTIONS_TABLE: projections.tableName,
    });
    counter.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        resources: [counterEvents.queueArn],
      }),
    );
    // A transaction is authorized as the writes inside it.
    counter.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [projections.tableArn],
      }),
    );
    const mapping = new lambda.EventSourceMapping(this, "CounterSource", {
      target: counter.fn,
      eventSourceArn: counterEvents.queueArn,
      batchSize: 10,
      maxConcurrency: 2,
      reportBatchItemFailures: true,
    });
    mapping.node.addDependency(counter.role);

    const counterRule = new events.CfnRule(this, "CounterRule", {
      eventBusName: bus.ref,
      eventPattern: RULES.counter,
      targets: [
        {
          id: "counter",
          arn: counterEvents.queueArn,
          retryPolicy: { maximumRetryAttempts: 8, maximumEventAgeInSeconds: 3600 },
          deadLetterConfig: { arn: deadLetters.queueArn },
        },
      ],
    });
    counterEvents.addToResourcePolicy(sendFrom(counterRule, counterEvents));
    // #endregion counter

    // #region rejections
    const rejections = new sns.Topic(this, "Rejections", { enforceSSL: true });
    // The form EventBridge's documentation gives for a topic: the service, with no condition.
    rejections.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("events.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [rejections.topicArn],
      }),
    );
    const rejectionsRule = new events.CfnRule(this, "RejectionsRule", {
      eventBusName: bus.ref,
      eventPattern: RULES.rejections,
      targets: [
        {
          id: "rejections",
          arn: rejections.topicArn,
          // The subscribers get a message of their own shape, not the event.
          inputTransformer: {
            inputPathsMap: {
              owner: "$.detail.owner",
              noteId: "$.detail.noteId",
              attachmentId: "$.detail.attachmentId",
              reason: "$.detail.reason",
              at: "$.detail.occurredAt",
            },
            inputTemplate:
              '{"kind":"attachment_rejected","owner":<owner>,"noteId":<noteId>,' +
              '"attachmentId":<attachmentId>,"reason":<reason>,"at":<at>}',
          },
          retryPolicy: { maximumRetryAttempts: 8, maximumEventAgeInSeconds: 3600 },
          deadLetterConfig: { arn: deadLetters.queueArn },
        },
      ],
    });

    // One subscriber to begin with. A second one is another subscription,
    // and neither the rule nor the topic's publisher changes.
    const inbox = new sqs.Queue(this, "RejectionInbox", {
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    inbox.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("sns.amazonaws.com")],
        actions: ["sqs:SendMessage"],
        resources: [inbox.queueArn],
        conditions: { ArnEquals: { "aws:SourceArn": rejections.topicArn } },
      }),
    );
    new sns.CfnSubscription(this, "RejectionInboxSubscription", {
      topicArn: rejections.topicArn,
      protocol: "sqs",
      endpoint: inbox.queueArn,
      // The queue holds what the rule built, without SNS's wrapping around it.
      rawMessageDelivery: true,
    });
    // #endregion rejections

    // #region dead-letter-policy
    // The rules may send to the dead-letter queue, each as itself. The pipe
    // and the timeline function send with their roles instead.
    for (const rule of [timelineRule, counterRule, rejectionsRule]) {
      deadLetters.addToResourcePolicy(sendFrom(rule, deadLetters));
    }
    // #endregion dead-letter-policy

    new CfnOutput(this, "EventBusName", { value: bus.ref });
    new CfnOutput(this, "ArchiveName", {
      value: (this.node.findChild("Archive") as events.CfnArchive).ref,
    });
    new CfnOutput(this, "PipeName", { value: pipe.ref });
    // A replay names the rules it is for by ARN.
    new CfnOutput(this, "TimelineRuleArn", { value: timelineRule.attrArn });
    new CfnOutput(this, "CounterRuleArn", { value: counterRule.attrArn });
    new CfnOutput(this, "RejectionsRuleArn", { value: rejectionsRule.attrArn });
    new CfnOutput(this, "ProjectionsTableName", { value: projections.tableName });
    new CfnOutput(this, "EventDeadLetterQueueUrl", { value: deadLetters.queueUrl });
    new CfnOutput(this, "CounterQueueUrl", { value: counterEvents.queueUrl });
    new CfnOutput(this, "RejectionInboxUrl", { value: inbox.queueUrl });
    new CfnOutput(this, "RejectionsTopicArn", { value: rejections.topicArn });
    for (const [name, group] of [
      ["Shape", shape.logGroup],
      ["Timeline", timeline.logGroup],
      ["Counter", counter.logGroup],
    ] as const) {
      new CfnOutput(this, `${name}LogGroupName`, { value: group.logGroupName });
    }
  }

  /** A function with a role and a log group of its own, and nothing granted but its logs. */
  #function(name: string, entry: string, environment: Record<string, string>) {
    const logGroup = new logs.LogGroup(this, `${name}Logs`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, `${name}Role`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);
    const fn = new nodejs.NodejsFunction(this, name, {
      entry: source(entry),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(CONSUMER_TIMEOUT_SECONDS),
      role,
      logGroup,
      environment: { ...environment, LOG_LEVEL: "info" },
      bundling,
    });
    return { fn, role, logGroup };
  }

  // #region stand-apart
  /** Chapter 08 fixed three names. New ones here, so both stacks can exist at once. */
  #standApart(): void {
    const domainPrefix = `aih-events-${this.account}`;
    (
      this.node.findChild("Users").node.findChild("Domain").node
        .defaultChild as cognito.CfnUserPoolDomain
    ).domain = domainPrefix;
    (this.node.findChild("AuthDomain") as CfnOutput).value =
      `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`;

    (this.node.findChild("HousekeepingSchedule") as scheduler.CfnSchedule).name = SCHEDULE_NAME;
    (this.node.findChild("HousekeepingScheduleName") as CfnOutput).value = SCHEDULE_NAME;

    const bucketName = `aih-events-uploads-${this.account}`;
    const uploads = this.node.findChild("Uploads") as s3.Bucket;
    (uploads.node.defaultChild as s3.CfnBucket).bucketName = bucketName;
    // Chapter 08's queue policy names the bucket it accepts messages for.
    const policy = this.node.findChild("UploadEvents").node.findChild("Policy").node
      .defaultChild as sqs.CfnQueuePolicy;
    policy.addPropertyOverride(
      "PolicyDocument.Statement.1.Condition.ArnEquals.aws:SourceArn",
      `arn:${this.partition}:s3:::${bucketName}`,
    );
  }
  // #endregion stand-apart
}

// #region send-from
/** Lets one rule, and nothing else in EventBridge, send to a queue. */
function sendFrom(rule: events.CfnRule, queue: sqs.Queue): iam.PolicyStatement {
  return new iam.PolicyStatement({
    principals: [new iam.ServicePrincipal("events.amazonaws.com")],
    actions: ["sqs:SendMessage"],
    resources: [queue.queueArn],
    conditions: { ArnEquals: { "aws:SourceArn": rule.attrArn } },
  });
}
// #endregion send-from
