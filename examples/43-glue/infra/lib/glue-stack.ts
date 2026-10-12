import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import { projectionParameters } from "@aih/example-26-analytics/src/partition.ts";
import { COLUMNS } from "@aih/example-26-analytics/src/record.ts";

import { JOB } from "../../src/job.ts";
import { CURATED_ROOT, RAW_ROOT, RETENTION_DAYS } from "../../src/layout.ts";
import { CURATED_TABLE, DATABASE, JOB_NAME, RAW_TABLE } from "../../src/names.ts";

export type GlueStackProps = StackProps & {
  /** Whether the daily trigger starts the job. Off, nothing runs until someone starts a run. */
  schedule: boolean;
};

// #region schedule
// 01:00 UTC: an hour after the day ended, for the files that were still on their way.
export const SCHEDULE = "cron(0 1 * * ? *)";
// Every way a run can end without having written the day.
export const FAILED_STATES = ["FAILED", "TIMEOUT", "STOPPED"] as const;
export const LOG_GROUP_PREFIX = "/aih/glue/curate";
// #endregion schedule

// #region storage
// How a table of each format is read. The class names are Hive's.
const STORAGE = {
  json: {
    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
    serializationLibrary: "org.apache.hive.hcatalog.data.JsonSerDe",
  },
  parquet: {
    inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    outputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    serializationLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
  },
} as const;
// #endregion storage

export class GlueStack extends Stack {
  constructor(scope: Construct, id: string, props: GlueStackProps) {
    super(scope, id, props);

    // #region bucket
    const lake = new s3.Bucket(this, "Lake", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: "expire-raw",
          prefix: RAW_ROOT,
          expiration: Duration.days(RETENTION_DAYS.raw),
        },
        {
          id: "expire-curated",
          prefix: CURATED_ROOT,
          expiration: Duration.days(RETENTION_DAYS.curated),
        },
        {
          id: "abort-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // Exercise data: deleted with the stack, once emptied. Records you mean to keep want RETAIN.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion bucket

    // #region catalog
    const database = new glue.CfnDatabase(this, "Database", {
      catalogId: this.account,
      databaseInput: { name: DATABASE, description: "Request records, raw and curated" },
    });

    // Both tables list the same columns: the job changes the files, not the fields.
    const table = (id: string, name: string, format: keyof typeof STORAGE, root: string) => {
      const location = `s3://${lake.bucketName}/${root}`;
      const created = new glue.CfnTable(this, id, {
        catalogId: this.account,
        databaseName: DATABASE,
        tableInput: {
          name,
          // The files belong to the bucket. Dropping the table deletes no data.
          tableType: "EXTERNAL_TABLE",
          partitionKeys: [{ name: "dt", type: "string" }],
          parameters: { classification: format, ...projectionParameters(location) },
          storageDescriptor: {
            location,
            columns: COLUMNS.map((column) => ({ name: column.name, type: column.type })),
            inputFormat: STORAGE[format].inputFormat,
            outputFormat: STORAGE[format].outputFormat,
            serdeInfo: { serializationLibrary: STORAGE[format].serializationLibrary },
          },
        },
      });
      created.node.addDependency(database);
      return created;
    };
    table("Raw", RAW_TABLE, "json", RAW_ROOT);
    table("Curated", CURATED_TABLE, "parquet", CURATED_ROOT);
    // #endregion catalog

    // #region role
    const script = new s3assets.Asset(this, "Script", {
      path: fileURLToPath(new URL("../../glue/curate.py", import.meta.url)),
    });
    const logGroups = ["error", "output"].map(
      (kind) =>
        new logs.LogGroup(this, `Logs${kind === "error" ? "Error" : "Output"}`, {
          logGroupName: `${LOG_GROUP_PREFIX}/${kind}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
    );

    const role = new iam.Role(this, "JobRole", {
      assumedBy: new iam.ServicePrincipal("glue.amazonaws.com"),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation", "s3:ListBucket"],
        resources: [lake.bucketArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [
          lake.arnForObjects(`${RAW_ROOT}*`),
          // The one object that is the script, not the bucket every asset shares.
          `arn:${this.partition}:s3:::${script.s3BucketName}/${script.s3ObjectKey}`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        // Overwrite is a delete and a write. The raw files can be read, never changed.
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
        resources: [lake.arnForObjects(`${CURATED_ROOT}*`)],
      }),
    );
    for (const logGroup of logGroups) {
      logGroup.grants.write(role);
    }
    // #endregion role

    // #region job
    const job = new glue.CfnJob(this, "Curate", {
      name: JOB_NAME,
      description: "Raw request records to one Parquet folder per day",
      role: role.roleArn,
      command: { name: "glueetl", scriptLocation: script.s3ObjectUrl },
      glueVersion: JOB.glueVersion,
      workerType: JOB.workerType,
      numberOfWorkers: JOB.workers,
      timeout: JOB.timeoutMinutes,
      // A failed run is looked at by a person. Glue does not start it again by itself.
      maxRetries: 0,
      // Two runs of the same day would delete each other's files.
      executionProperty: { maxConcurrentRuns: 1 },
      defaultArguments: {
        "--source": `s3://${lake.bucketName}/${RAW_ROOT}`,
        "--target": `s3://${lake.bucketName}/${CURATED_ROOT}`,
        "--days": "auto",
        // Said out loud: every run reads the days it is asked for, whole.
        "--job-bookmark-option": "job-bookmark-disable",
        "--custom-logGroup-prefix": LOG_GROUP_PREFIX,
      },
    });
    job.node.addDependency(role, ...logGroups);
    // #endregion job

    // #region trigger
    const trigger = new glue.CfnTrigger(this, "Daily", {
      name: `${JOB_NAME}-daily`,
      type: "SCHEDULED",
      schedule: SCHEDULE,
      actions: [{ jobName: job.ref }],
      // false: the trigger exists and does nothing until `aws glue start-trigger`.
      startOnCreation: props.schedule,
    });
    // #endregion trigger

    // #region failure
    const failures = new sns.Topic(this, "Failures", { enforceSSL: true });
    const failed = new events.Rule(this, "RunFailed", {
      description: "A run of the curate job ended without writing its days",
      eventPattern: {
        source: ["aws.glue"],
        detailType: ["Glue Job State Change"],
        detail: { jobName: [job.ref], state: [...FAILED_STATES] },
      },
      // The event says which run, and why. Nobody is subscribed until you subscribe.
      targets: [new targets.SnsTopic(failures)],
    });
    new cloudwatch.Alarm(this, "RunFailedAlarm", {
      alarmDescription: "The curate job failed, timed out, or was stopped in the last day",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Events",
        metricName: "MatchedEvents",
        dimensionsMap: { RuleName: failed.ruleName },
        statistic: cloudwatch.Stats.SUM,
        // A day, so the alarm is still red when someone looks the next morning.
        period: Duration.days(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // No failed run means no data point, which is the good case.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // #endregion failure

    new CfnOutput(this, "LakeBucketName", { value: lake.bucketName });
    new CfnOutput(this, "JobName", { value: job.ref });
    new CfnOutput(this, "TriggerName", { value: trigger.ref });
    new CfnOutput(this, "DatabaseName", { value: DATABASE });
    new CfnOutput(this, "FailureTopicArn", { value: failures.topicArn });
  }
}
