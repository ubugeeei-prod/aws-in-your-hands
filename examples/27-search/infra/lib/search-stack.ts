import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3vectors from "aws-cdk-lib/aws-s3vectors";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { modelArns, type VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";

import { EMBEDDING_DIMENSIONS, TITAN_EMBED_V2 } from "../../src/bedrock-embedder.ts";

export type SearchStackProps = StackProps & { profileId: VerifiedProfileId };

// A whole search reads every note of one owner: at most 100 notes of 10,000 characters.
// That is about 3 MB, or 375 eventually consistent read units, spread over a few pages.
export const TABLE_LIMIT = { read: 400, write: 40 } as const;

// Unique in the account and Region. cdkd 0.296.28 does not generate one.
export const VECTOR_BUCKET_NAME = "aih-search-notes";
export const VECTOR_INDEX_NAME = "notes";

/** The app gives up on the model after this long. The function must outlive it to say so. */
export const INFERENCE_TIMEOUT = Duration.seconds(30);
export const MAX_OUTPUT_TOKENS = 400;

const bundling = {
  format: nodejs.OutputFormat.ESM,
  target: "node24",
  minify: false,
  sourceMap: false,
  // Bundle the AWS SDK too, so the functions run the version in pnpm-lock.yaml.
  externalModules: [],
  // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
  banner:
    "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
};

export class SearchStack extends Stack {
  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);

    // #region table
    // Chapter 05's table with one addition: every change is also written to a stream.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: TABLE_LIMIT.read,
      maxWriteRequestUnits: TABLE_LIMIT.write,
      // Both images: the new one to index, the old one to know which passages to remove.
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    // #region vectors
    const bucket = new s3vectors.CfnVectorBucket(this, "Vectors", {
      vectorBucketName: VECTOR_BUCKET_NAME,
    });
    const index = new s3vectors.CfnIndex(this, "NotesIndex", {
      vectorBucketName: VECTOR_BUCKET_NAME,
      indexName: VECTOR_INDEX_NAME,
      // None of the next three can be changed later. Another embedding model means another index.
      dataType: "float32",
      dimension: EMBEDDING_DIMENSIONS,
      distanceMetric: "cosine",
    });
    index.addDependency(bucket);
    // Deleting the index deletes its vectors. They can be rebuilt from the table.
    index.applyRemovalPolicy(RemovalPolicy.DESTROY);
    bucket.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion vectors

    // Written out from the two names instead of read from the resource: the format is
    // documented, and the index goes through Cloud Control with the pinned cdkd.
    const indexArn = `arn:${this.partition}:s3vectors:${this.region}:${this.account}:bucket/${VECTOR_BUCKET_NAME}/index/${VECTOR_INDEX_NAME}`;
    const embeddingModelArn = `arn:${this.partition}:bedrock:${this.region}::foundation-model/${TITAN_EMBED_V2}`;

    // #region indexer
    // Changes the indexer could not apply after its retries. Nothing reads this queue: a person does.
    const deadLetters = new sqs.Queue(this, "IndexerDeadLetters", {
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const indexerLogs = new logs.LogGroup(this, "IndexerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const indexerRole = new iam.Role(this, "IndexerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    indexerLogs.grants.write(indexerRole);
    // Reads the stream, never the table.
    table.grantStreamRead(indexerRole);
    indexerRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [embeddingModelArn] }),
    );
    indexerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3vectors:PutVectors", "s3vectors:DeleteVectors"],
        resources: [indexArn],
      }),
    );

    const indexer = new nodejs.NodejsFunction(this, "Indexer", {
      entry: fileURLToPath(new URL("../../src/indexer-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // A batch of 10 notes of 15 passages each is 150 embedding calls.
      timeout: Duration.seconds(60),
      role: indexerRole,
      logGroup: indexerLogs,
      environment: { VECTOR_INDEX_ARN: indexArn, LOG_LEVEL: "info" },
      bundling,
    });

    const mapping = new lambda.EventSourceMapping(this, "NotesToIndexer", {
      target: indexer,
      eventSourceArn: table.tableStreamArn,
      // From the oldest record still in the stream, so nothing written during a deploy is skipped.
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      // The handler names the record it failed on, and Lambda resumes from there.
      reportBatchItemFailures: true,
      bisectBatchOnError: true,
      // The default is to retry until the record expires, a day later, with the shard stuck behind it.
      retryAttempts: 3,
      onFailure: new eventSources.SqsDlq(deadLetters),
      // Only notes. The table also holds chapter 05's counter item, which changes on every create.
      filters: [
        lambda.FilterCriteria.filter({
          dynamodb: { Keys: { sk: { S: lambda.FilterRule.beginsWith("NOTE#") } } },
        }),
      ],
    });
    // The mapping is checked against the role's permissions when it is created.
    mapping.node.addDependency(indexerRole);
    // #endregion indexer

    // #region search
    const searchLogs = new logs.LogGroup(this, "SearchLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const searchRole = new iam.Role(this, "SearchRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    searchLogs.grants.write(searchRole);
    // Query only: the search reads notes by partition key and writes nothing.
    searchRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["dynamodb:Query"], resources: [table.tableArn] }),
    );
    searchRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [embeddingModelArn] }),
    );
    // A query with a metadata filter needs GetVectors as well as QueryVectors.
    searchRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3vectors:QueryVectors", "s3vectors:GetVectors"],
        resources: [indexArn],
      }),
    );
    // The model that writes the answer, through the inference profile, as in chapter 17.
    const arns = modelArns(props.profileId, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    searchRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: [arns.profileArn],
      }),
    );
    searchRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: arns.modelArns,
        conditions: { StringLike: { "bedrock:InferenceProfileArn": arns.profileArn } },
      }),
    );

    const search = new nodejs.NodejsFunction(this, "Search", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: INFERENCE_TIMEOUT.plus(Duration.seconds(10)),
      role: searchRole,
      logGroup: searchLogs,
      environment: {
        SEARCH_BACKEND: "aws",
        TABLE_NAME: table.tableName,
        VECTOR_INDEX_ARN: indexArn,
        BEDROCK_MODEL_ID: props.profileId,
        MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
        INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      bundling,
    });

    const url = search.addFunctionUrl({
      // Signed requests only. The app believes the owner header because of this line.
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });
    // #endregion search

    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "VectorIndexArn", { value: indexArn });
    new CfnOutput(this, "DeadLetterQueueUrl", { value: deadLetters.queueUrl });
    new CfnOutput(this, "SearchLogGroupName", { value: searchLogs.logGroupName });
    new CfnOutput(this, "IndexerLogGroupName", { value: indexerLogs.logGroupName });
  }
}
