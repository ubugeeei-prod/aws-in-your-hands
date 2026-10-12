import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, type StackProps } from "aws-cdk-lib";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { KEY_PREFIX } from "@aih/example-07-uploads/api/src/keys.ts";
import { UploadsStack } from "@aih/example-07-uploads/infra/lib/uploads-stack.ts";

const WORKER_TIMEOUT_SECONDS = 30;
const SCHEDULE_NAME = "aih-async-housekeeping";
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

// Chapter 07's stack, unchanged, with a queue, a dead-letter queue, two
// functions, and a schedule added. The regions below mark what is new.
export class AsyncStack extends UploadsStack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Chapter 07 keeps these to itself, so they are looked up by the IDs it gave them.
    const uploads = this.node.findChild("Uploads") as s3.Bucket;
    const table = this.node.findChild("Notes") as dynamodb.Table;
    const uploadsResource = uploads.node.defaultChild as s3.CfnBucket;

    // A sign-in domain of its own, so this stack and chapter 07's can exist at once.
    const domainPrefix = `aih-async-${this.account}`;
    (
      this.node.findChild("Users").node.findChild("Domain").node
        .defaultChild as cognito.CfnUserPoolDomain
    ).domain = domainPrefix;
    (this.node.findChild("AuthDomain") as CfnOutput).value =
      `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`;

    // #region bucket-name
    // S3 checks that it may send to the queue at the moment the notification
    // is configured, so the queue's policy must exist before the bucket. The
    // policy names the bucket. A name fixed here lets it do so without
    // referring to the bucket resource, which would be a cycle.
    const bucketName = `aih-async-uploads-${this.account}`;
    uploadsResource.bucketName = bucketName;
    const bucketArn = `arn:${this.partition}:s3:::${bucketName}`;
    // #endregion bucket-name

    // #region queues
    const deadLetters = new sqs.Queue(this, "DeadLetters", {
      // A message keeps the age it had in the source queue, so this must be the longer of the two.
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const events = new sqs.Queue(this, "UploadEvents", {
      // Six times the worker's timeout, as Lambda's documentation asks: room
      // for a batch to finish, and for Lambda to retry one that was throttled.
      visibilityTimeout: Duration.seconds(6 * WORKER_TIMEOUT_SECONDS),
      retentionPeriod: Duration.days(4),
      // Received five times and never deleted: set aside for a person to look at.
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: 5 },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion queues

    // #region queue-policy
    // The only thing allowed to put messages here: S3, on behalf of this one
    // bucket in this one account.
    events.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("s3.amazonaws.com")],
        actions: ["sqs:SendMessage"],
        resources: [events.queueArn],
        conditions: {
          ArnEquals: { "aws:SourceArn": bucketArn },
          StringEquals: { "aws:SourceAccount": this.account },
        },
      }),
    );
    // #endregion queue-policy

    // #region notification
    // Written on the bucket resource itself. `bucket.addEventNotification`
    // would add a custom resource backed by one more Lambda function.
    uploadsResource.notificationConfiguration = {
      queueConfigurations: [
        "s3:ObjectCreated:*",
        "s3:ObjectRemoved:Delete",
        "s3:LifecycleExpiration:Delete",
      ].map((event) => ({
        event,
        queue: events.queueArn,
        filter: { s3Key: { rules: [{ name: "prefix", value: KEY_PREFIX }] } },
      })),
    };
    uploadsResource.addDependency(
      events.node.findChild("Policy").node.defaultChild as sqs.CfnQueuePolicy,
    );
    // #endregion notification

    // #region worker
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const workerRole = new iam.Role(this, "WorkerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    workerLogs.grantWrite(workerRole);
    workerRole.addToPolicy(
      // Lambda polls the queue with the function's own role.
      new iam.PolicyStatement({
        actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        resources: [events.queueArn],
      }),
    );
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:DeleteObjectTagging"],
        resources: [uploads.arnForObjects(`${KEY_PREFIX}*`)],
      }),
    );
    // As in chapter 07: with this, a missing key is a 404 and not a 403.
    workerRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [uploads.bucketArn] }),
    );
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
        resources: [table.tableArn],
      }),
    );
    const worker = new nodejs.NodejsFunction(this, "Worker", {
      entry: source("worker-lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(WORKER_TIMEOUT_SECONDS),
      role: workerRole,
      logGroup: workerLogs,
      environment: {
        TABLE_NAME: table.tableName,
        UPLOADS_BUCKET: uploads.bucketName,
        LOG_LEVEL: "info",
      },
      bundling,
    });
    // #endregion worker

    // #region mapping
    const mapping = new lambda.EventSourceMapping(this, "WorkerSource", {
      target: worker,
      eventSourceArn: events.queueArn,
      batchSize: 10,
      // At most two copies of the worker run at once, however long the queue gets.
      maxConcurrency: 2,
      // Lets the handler name the messages that failed instead of failing the batch.
      reportBatchItemFailures: true,
    });
    // Lambda checks the role's permissions on the queue when the mapping is created.
    mapping.node.addDependency(workerRole);
    // #endregion mapping

    // #region housekeeping
    const housekeepingLogs = new logs.LogGroup(this, "HousekeepingLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const housekeepingRole = new iam.Role(this, "HousekeepingRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    housekeepingLogs.grantWrite(housekeepingRole);
    housekeepingRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:DeleteObject", "s3:DeleteObjectTagging"],
        resources: [uploads.arnForObjects(`${KEY_PREFIX}*`)],
      }),
    );
    housekeepingRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [uploads.bucketArn],
        conditions: { StringLike: { "s3:prefix": `${KEY_PREFIX}*` } },
      }),
    );
    housekeepingRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:DeleteItem"],
        resources: [table.tableArn],
      }),
    );
    const housekeeping = new nodejs.NodejsFunction(this, "Housekeeping", {
      entry: source("housekeeping-lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Lambda's maximum. One run walks the whole bucket, one object after another.
      timeout: Duration.minutes(15),
      role: housekeepingRole,
      logGroup: housekeepingLogs,
      environment: {
        TABLE_NAME: table.tableName,
        UPLOADS_BUCKET: uploads.bucketName,
        LOG_LEVEL: "info",
      },
      bundling,
    });
    // The schedule invokes asynchronously, and Lambda would run a failed
    // asynchronous invocation two more times. The next hour's run does that job.
    housekeeping.configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.hours(1) });
    // #endregion housekeeping

    // #region schedule
    // The role EventBridge Scheduler assumes to call Lambda. It can be assumed
    // only for schedules in this account's default group, and can invoke only this function.
    const scheduleRole = new iam.Role(this, "ScheduleRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com").withConditions({
        StringEquals: {
          "aws:SourceAccount": this.account,
          "aws:SourceArn": `arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule-group/default`,
        },
      }),
    });
    scheduleRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [housekeeping.functionArn],
      }),
    );
    const schedule = new scheduler.CfnSchedule(this, "HousekeepingSchedule", {
      name: SCHEDULE_NAME,
      description: "Starts the housekeeping function of AWS in Your Hands chapter 08",
      scheduleExpression: "rate(1 hour)",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: housekeeping.functionArn,
        roleArn: scheduleRole.roleArn,
        // If the invocation itself cannot be delivered: a few tries, then give
        // up. A run that is fifteen minutes late is better left to the next hour.
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 900 },
      },
    });
    schedule.node.addDependency(scheduleRole);
    // #endregion schedule

    new CfnOutput(this, "UploadEventsQueueUrl", { value: events.queueUrl });
    new CfnOutput(this, "DeadLetterQueueUrl", { value: deadLetters.queueUrl });
    new CfnOutput(this, "DeadLetterQueueArn", { value: deadLetters.queueArn });
    new CfnOutput(this, "WorkerLogGroupName", { value: workerLogs.logGroupName });
    new CfnOutput(this, "HousekeepingLogGroupName", { value: housekeepingLogs.logGroupName });
    new CfnOutput(this, "HousekeepingScheduleName", { value: SCHEDULE_NAME });
  }
}
