import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { INDEX, INDEX_PK, INDEX_PROJECTION, INDEX_SK, TTL_ATTRIBUTE } from "../../src/keys.ts";

// #region limits
// Request units a second. Past them DynamoDB throttles instead of billing.
// The largest write is a full note with eight tags and a slug in one transaction: about 82 units.
export const TABLE_LIMIT = { read: 150, write: 200 } as const;
// Index entries hold no body, so they are small. Too low a write limit here
// would throttle writes to the table itself.
export const INDEX_LIMIT = { read: 50, write: 100 } as const;

// How often Lambda retries a batch before the records go to the dead-letter queue.
export const STREAM_RETRIES = 5;
// #endregion limits

export type ModelingStackProps = StackProps & { insights: boolean };

export class ModelingStack extends Stack {
  constructor(scope: Construct, id: string, props: ModelingStackProps) {
    super(scope, id, props);

    // #region table
    const table = new dynamodb.Table(this, "Notebook", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: TABLE_LIMIT.read,
      maxWriteRequestUnits: TABLE_LIMIT.write,
      // The consumer needs to know which item changed, not what it holds.
      stream: dynamodb.StreamViewType.KEYS_ONLY,
      timeToLiveAttribute: TTL_ATTRIBUTE,
      ...(props.insights
        ? {
            contributorInsightsSpecification: {
              enabled: true,
              // Events are counted only when a request is throttled.
              mode: dynamodb.ContributorInsightsMode.THROTTLED_KEYS,
            },
          }
        : {}),
      // Exercise data: everything is deleted with the stack. Real data wants RETAIN.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    // #region index
    table.addGlobalSecondaryIndex({
      indexName: INDEX,
      // Generic names again: only notes carry them, so only notes are in the index.
      partitionKey: { name: INDEX_PK, type: dynamodb.AttributeType.STRING },
      sortKey: { name: INDEX_SK, type: dynamodb.AttributeType.STRING },
      // The attributes a list shows. ALL would copy every body into the index.
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: INDEX_PROJECTION,
      maxReadRequestUnits: INDEX_LIMIT.read,
      maxWriteRequestUnits: INDEX_LIMIT.write,
    });
    const indexArn = `${table.tableArn}/index/${INDEX}`;
    // #endregion index

    // #region app-policy
    // What src/notebook.ts calls, for the role of whichever function serves the API.
    // No Scan and no batch operations. A transaction needs the permission of each action inside it.
    const notebookAccess = new iam.ManagedPolicy(this, "NotebookAccess", {
      description: "The item operations the chapter 30 notebook uses, on its table and index",
      statements: [
        new iam.PolicyStatement({
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:ConditionCheckItem",
            "dynamodb:Query",
          ],
          resources: [table.tableArn],
        }),
        // An index is a resource of its own: access to the table does not include it.
        new iam.PolicyStatement({ actions: ["dynamodb:Query"], resources: [indexArn] }),
      ],
    });
    // #endregion app-policy

    // #region dead-letters
    // Where Lambda reports a batch it gave up on. The message names the shard
    // and the sequence numbers, not the records: they stay in the stream for 24 hours.
    const deadLetters = new sqs.Queue(this, "StreamDeadLetters", {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion dead-letters

    const projectorLogs = new logs.LogGroup(this, "ProjectorLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region projector-role
    const streamArn = table.tableStreamArn;
    if (streamArn === undefined) {
      throw new Error("The table has no stream.");
    }
    const projectorRole = new iam.Role(this, "ProjectorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    projectorLogs.grants.write(projectorRole);
    projectorRole.addToPolicy(
      // Its transaction is one Put and one Update. It never reads or deletes.
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [table.tableArn],
      }),
    );
    projectorRole.addToPolicy(
      // Lambda polls the stream with the function's own role.
      new iam.PolicyStatement({
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [streamArn],
      }),
    );
    projectorRole.addToPolicy(
      // ListStreams takes no resource: IAM has nothing narrower than "*" for it.
      new iam.PolicyStatement({ actions: ["dynamodb:ListStreams"], resources: ["*"] }),
    );
    projectorRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [deadLetters.queueArn] }),
    );
    // #endregion projector-role

    const projector = new nodejs.NodejsFunction(this, "Projector", {
      entry: fileURLToPath(new URL("../../src/stream-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      role: projectorRole,
      logGroup: projectorLogs,
      environment: { TABLE_NAME: table.tableName },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        // The SDK version in pnpm-lock.yaml, as in chapter 05.
        externalModules: [],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });

    // #region mapping
    const mapping = new lambda.EventSourceMapping(this, "ProjectorSource", {
      target: projector,
      eventSourceArn: streamArn,
      // From the oldest record still in the stream. LATEST can miss changes made while the mapping starts.
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 100,
      // Only tag items. Without this the function would be invoked for its own writes too.
      filters: [
        lambda.FilterCriteria.filter({
          dynamodb: { Keys: { sk: { S: lambda.FilterRule.beginsWith("TAG#") } } },
        }),
      ],
      // The handler names the first record it could not apply; Lambda retries from there.
      reportBatchItemFailures: true,
      // A batch that keeps failing is halved, so one bad record cannot hold the others back.
      bisectBatchOnError: true,
      // The default is to retry until the record expires, 24 hours later.
      retryAttempts: STREAM_RETRIES,
      onFailure: { bind: () => ({ destination: deadLetters.queueArn }) },
    });
    // Lambda checks the role's permissions on the stream when the mapping is created.
    mapping.node.addDependency(projectorRole);
    // #endregion mapping

    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "NotebookAccessPolicyArn", { value: notebookAccess.managedPolicyArn });
    new CfnOutput(this, "ProjectorLogGroupName", { value: projectorLogs.logGroupName });
    new CfnOutput(this, "StreamDeadLetterQueueUrl", { value: deadLetters.queueUrl });
  }
}
