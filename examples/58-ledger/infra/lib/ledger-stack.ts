import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import * as v from "valibot";

// #region lock
// Governance for one day: the shortest lock there is, and one that an
// administrator with s3:BypassGovernanceRetention can still lift.
export const PRACTICE_LOCK = { mode: "governance", days: 1 } as const;

const lockSchema = v.object({
  mode: v.optional(v.picklist(["governance", "compliance"]), PRACTICE_LOCK.mode),
  // Context values arrive as strings.
  days: v.optional(
    v.pipe(
      v.union([v.string(), v.number()]),
      v.transform(Number),
      v.number(),
      v.safeInteger(),
      v.minValue(1),
      v.maxValue(36500),
    ),
    PRACTICE_LOCK.days,
  ),
});
export type Lock = v.InferOutput<typeof lockSchema>;

export const parseLock = (context: { mode?: unknown; days?: unknown }): Lock =>
  v.parse(lockSchema, context);
// #endregion lock

export const LEDGER = "notes";
export const DIGEST_PREFIX = `digests/${LEDGER}/`;

export type LedgerStackProps = StackProps & { lock: Lock };

export class LedgerStack extends Stack {
  constructor(scope: Construct, id: string, props: LedgerStackProps) {
    super(scope, id, props);

    // #region table
    const table = new dynamodb.Table(this, "Journal", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Exercise data: deleted with the stack. A real ledger wants RETAIN and deletionProtection.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    // #region bucket
    const digests = new s3.Bucket(this, "Digests", {
      // Object Lock needs versioning. Once enabled, neither can be turned off again.
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention:
        props.lock.mode === "compliance"
          ? s3.ObjectLockRetention.compliance(Duration.days(props.lock.days))
          : s3.ObjectLockRetention.governance(Duration.days(props.lock.days)),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // A stack cannot delete locked versions, so it does not try: the bucket stays behind.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // #endregion bucket

    const tableRead = new iam.PolicyStatement({
      actions: ["dynamodb:Query"],
      resources: [table.tableArn],
    });
    const digestRead = [
      new iam.PolicyStatement({
        actions: ["s3:ListBucketVersions"],
        resources: [digests.bucketArn],
        conditions: { StringLike: { "s3:prefix": `${DIGEST_PREFIX}*` } },
      }),
      new iam.PolicyStatement({
        actions: ["s3:GetObjectVersion"],
        resources: [digests.arnForObjects(`${DIGEST_PREFIX}*`)],
      }),
    ];

    // #region writer
    // For the role of whichever function serves the notes API. It can add an
    // entry and read the tail. PutItem, UpdateItem, and DeleteItem are absent:
    // with PutItem the role could replace an entry by leaving the condition out.
    const appendAccess = new iam.ManagedPolicy(this, "AppendAccess", {
      description: "Append to the chapter 58 ledger: PartiQL INSERT and Query, nothing else",
      statements: [
        new iam.PolicyStatement({
          actions: ["dynamodb:PartiQLInsert"],
          resources: [table.tableArn],
        }),
        tableRead,
      ],
    });
    // #endregion writer

    const digestLogs = new logs.LogGroup(this, "DigestLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region digester
    // Reads the table, writes digests. It cannot write the table, and it has no
    // permission to delete an object version or to bypass a governance lock.
    const digestRole = new iam.Role(this, "DigestRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    digestLogs.grants.write(digestRole);
    digestRole.addToPolicy(tableRead);
    for (const statement of digestRead) {
      digestRole.addToPolicy(statement);
    }
    digestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [digests.arnForObjects(`${DIGEST_PREFIX}*`)],
      }),
    );
    // #endregion digester

    const digestFunction = new nodejs.NodejsFunction(this, "DigestFunction", {
      entry: fileURLToPath(new URL("../../src/digest-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.minutes(1),
      role: digestRole,
      logGroup: digestLogs,
      environment: {
        TABLE_NAME: table.tableName,
        DIGEST_BUCKET: digests.bucketName,
        LEDGER,
      },
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

    // #region schedule
    // Everything appended since the last digest has nothing locked behind it.
    // This interval is how long that window can stay open.
    new events.Rule(this, "DigestSchedule", {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(digestFunction, { retryAttempts: 2 })],
    });
    // #endregion schedule

    // #region auditor
    // Whoever checks the ledger reads both sides and can change neither.
    const auditor = new iam.Role(this, "AuditorRole", {
      assumedBy: new iam.AccountRootPrincipal(),
      description: "Read the chapter 58 ledger and every version of its digests",
    });
    auditor.addToPolicy(tableRead);
    for (const statement of digestRead) {
      auditor.addToPolicy(statement);
    }
    auditor.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObjectRetention"],
        resources: [digests.arnForObjects(`${DIGEST_PREFIX}*`)],
      }),
    );
    // #endregion auditor

    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "DigestBucketName", { value: digests.bucketName });
    new CfnOutput(this, "AppendAccessPolicyArn", { value: appendAccess.managedPolicyArn });
    new CfnOutput(this, "AuditorRoleArn", { value: auditor.roleArn });
    new CfnOutput(this, "DigestLogGroupName", { value: digestLogs.logGroupName });
  }
}
