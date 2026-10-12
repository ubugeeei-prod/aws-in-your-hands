import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as backup from "aws-cdk-lib/aws-backup";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export type RecoveryStackProps = StackProps & {
  /** After a restore: the name of the table the function should read. The stack's own table stays as it is. */
  activeTableName?: string | undefined;
  /** Keep the table and the bucket when the stack is deleted, and refuse to delete the table at all. */
  protect: boolean;
  /** Daily AWS Backup snapshots of the table, kept for a week. Billed per GB stored. */
  backup: boolean;
  /** A second bucket that receives every new object version. Billed as a second copy. */
  replica: boolean;
};

// How long an overwritten or deleted image can still be brought back.
export const NONCURRENT_DAYS = 30;

export class RecoveryStack extends Stack {
  constructor(scope: Construct, id: string, props: RecoveryStackProps) {
    super(scope, id, props);
    const removalPolicy = props.protect ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // #region table
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Continuous backups: any second of the last 35 days can become a new table.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Stops DeleteTable. It does nothing for a deleted item: that is what the line above is for.
      deletionProtection: props.protect,
      removalPolicy,
    });
    // #endregion table

    // #region bucket
    const uploads = new s3.Bucket(this, "Uploads", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // A delete becomes a marker on top, and an overwrite a new version. The old bytes stay.
      versioned: true,
      lifecycleRules: [
        {
          id: "expire-noncurrent-versions",
          // Without this, every byte ever uploaded is stored, and billed, forever.
          noncurrentVersionExpiration: Duration.days(NONCURRENT_DAYS),
          // A marker with no version left under it protects nothing.
          expiredObjectDeleteMarker: true,
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy,
      ...(props.replica
        ? { replicationRules: [{ destination: replicaBucket(this, removalPolicy), priority: 1 }] }
        : {}),
    });
    // #endregion bucket

    // #region cutover
    // The function, its permissions, and the output all follow this one
    // variable. Pointing it at a restored table moves all three together.
    const active: dynamodb.ITable =
      props.activeTableName === undefined
        ? table
        : dynamodb.Table.fromTableName(this, "ActiveNotes", props.activeTableName);
    // #endregion cutover

    const logGroup = new logs.LogGroup(this, "AuditLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new iam.Role(this, "AuditRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);
    // Reads everything, changes nothing. Repairs run from a laptop, under a person's credentials.
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["dynamodb:Scan"], resources: [active.tableArn] }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [uploads.bucketArn] }),
    );
    // #endregion role

    const auditFunction = new nodejs.NodejsFunction(this, "Audit", {
      entry: fileURLToPath(new URL("../../src/audit-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.minutes(1),
      role,
      logGroup,
      environment: { TABLE_NAME: active.tableName, UPLOADS_BUCKET: uploads.bucketName },
      // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });

    // #region backup
    if (props.backup) {
      // A second kind of copy: one snapshot a day, in a vault with its own access rules.
      const vault = new backup.BackupVault(this, "Vault", { removalPolicy });
      const plan = new backup.BackupPlan(this, "Plan", {
        backupVault: vault,
        backupPlanRules: [
          new backup.BackupPlanRule({
            ruleName: "daily",
            scheduleExpression: events.Schedule.cron({ hour: "18", minute: "0" }),
            deleteAfter: Duration.days(7),
          }),
        ],
      });
      plan.addSelection("Notes", { resources: [backup.BackupResource.fromDynamoDbTable(table)] });
      new CfnOutput(this, "BackupVaultName", { value: vault.backupVaultName });
    }
    // #endregion backup

    new CfnOutput(this, "TableName", { value: active.tableName });
    new CfnOutput(this, "OwnedTableName", { value: table.tableName });
    new CfnOutput(this, "UploadsBucketName", { value: uploads.bucketName });
    new CfnOutput(this, "AuditFunctionName", { value: auditFunction.functionName });
    new CfnOutput(this, "AuditLogGroupName", { value: logGroup.logGroupName });
  }
}

// #region replica
function replicaBucket(scope: Construct, removalPolicy: RemovalPolicy): s3.Bucket {
  // Replication needs versioning on both sides. Every new version is copied
  // here, the damaged ones included.
  return new s3.Bucket(scope, "UploadsReplica", {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    versioned: true,
    lifecycleRules: [
      {
        id: "expire-noncurrent-versions",
        noncurrentVersionExpiration: Duration.days(NONCURRENT_DAYS),
      },
    ],
    removalPolicy,
  });
}
// #endregion replica
