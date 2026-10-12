import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as datasync from "aws-cdk-lib/aws-datasync";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import { type ArchiveTask, taskProblems } from "../../src/task.ts";
import { allowWritingTo, CROSS_ACCOUNT_ACTIONS, dataSyncPrincipal } from "./datasync-access.ts";

export type ArchiveStackProps = StackProps & {
  /** The source location's ARN, an output of the source stack. Without it there is a bucket and no copy. */
  sourceLocationArn?: string | undefined;
  task: ArchiveTask;
  /** A DataSync role in another account that may write here. Adds one statement to the bucket policy. */
  crossAccountWriterArn?: string | undefined;
};

// How long an overwritten or deleted copy can still be brought back.
export const NONCURRENT_DAYS = 30;

export class ArchiveStack extends Stack {
  constructor(scope: Construct, id: string, props: ArchiveStackProps) {
    super(scope, id, props);
    const problems = taskProblems(props.task);
    if (problems.length > 0 || props.task.mode !== "BASIC") {
      throw new Error(`This stack builds a Basic mode task. ${problems.join("; ")}`.trim());
    }

    // #region archive-bucket
    const archive = new s3.Bucket(this, "Archive", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // The copy overwrites in place. Versioning is what keeps a bad overwrite from being the only copy.
      versioned: true,
      lifecycleRules: [
        {
          id: "expire-noncurrent-versions",
          noncurrentVersionExpiration: Duration.days(NONCURRENT_DAYS),
          expiredObjectDeleteMarker: true,
          // DataSync writes large objects in parts. An execution that dies leaves its parts behind.
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion archive-bucket

    // #region cross-account
    if (props.crossAccountWriterArn !== undefined) {
      archive.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "DataSyncCreateS3LocationAndTaskAccess",
          principals: [new iam.ArnPrincipal(props.crossAccountWriterArn)],
          actions: CROSS_ACCOUNT_ACTIONS,
          resources: [archive.bucketArn, archive.arnForObjects("*")],
        }),
      );
    }
    // #endregion cross-account

    // #region destination-location
    const role = new iam.Role(this, "DestinationRole", {
      assumedBy: dataSyncPrincipal(this.region),
    });
    allowWritingTo(role, archive);

    const location = new datasync.CfnLocationS3(this, "ArchiveLocation", {
      s3BucketArn: archive.bucketArn,
      s3Config: { bucketAccessRoleArn: role.roleArn },
      // New objects land in this class.
      s3StorageClass: "STANDARD",
    });
    location.node.addDependency(role);
    // #endregion destination-location

    new CfnOutput(this, "ArchiveBucketName", { value: archive.bucketName });
    new CfnOutput(this, "ArchiveLocationArn", { value: location.attrLocationArn });

    if (props.sourceLocationArn === undefined) {
      return;
    }

    // #region copy-logs
    const copyLogs = new logs.LogGroup(this, "CopyLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // A Basic mode task writes to a log group through a resource policy, not through a role.
    const logsPolicy = new logs.ResourcePolicy(this, "CopyLogsPolicy", {
      policyStatements: [
        new iam.PolicyStatement({
          principals: [new iam.ServicePrincipal("datasync.amazonaws.com")],
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [copyLogs.logGroupArn],
          conditions: {
            StringEquals: { "aws:SourceAccount": this.account },
            ArnLike: {
              "aws:SourceArn": `arn:${this.partition}:datasync:${this.region}:${this.account}:task/*`,
            },
          },
        }),
      ],
    });
    // #endregion copy-logs

    // #region task
    const { task } = props;
    const copy = new datasync.CfnTask(this, "ArchiveCopy", {
      name: "aih-attachments-archive",
      sourceLocationArn: props.sourceLocationArn,
      destinationLocationArn: location.attrLocationArn,
      taskMode: task.mode,
      // The option names are DataSync's own, so the object the planner reads goes in as it is.
      options: task.options,
      ...(task.includes === undefined
        ? {}
        : { includes: [{ filterType: "SIMPLE_PATTERN", value: task.includes }] }),
      ...(task.excludes === undefined
        ? {}
        : { excludes: [{ filterType: "SIMPLE_PATTERN", value: task.excludes }] }),
      // DataSync starts the executions itself. Nothing else in this stack runs on a timer.
      schedule: { scheduleExpression: task.schedule, status: "ENABLED" },
      cloudWatchLogGroupArn: copyLogs.logGroupArn,
    });
    copy.node.addDependency(logsPolicy);
    // #endregion task

    // #region alert
    const alerts = new sns.Topic(this, "Alerts", { enforceSSL: true });

    const alertLogs = new logs.LogGroup(this, "AlertLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const alertRole = new iam.Role(this, "AlertRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    alertLogs.grants.write(alertRole);
    alertRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["sns:Publish"], resources: [alerts.topicArn] }),
    );

    const alertFunction = new nodejs.NodejsFunction(this, "Alert", {
      entry: fileURLToPath(new URL("../../src/alert-lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role: alertRole,
      logGroup: alertLogs,
      environment: { TASK_ARN: copy.attrTaskArn, ALERT_TOPIC_ARN: alerts.topicArn },
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

    new events.Rule(this, "ExecutionEnded", {
      eventPattern: {
        source: ["aws.datasync"],
        detailType: ["DataSync Task Execution State Change"],
        // An execution's ARN starts with its task's. Other tasks in the account do not match.
        resources: events.Match.prefix(`${copy.attrTaskArn}/execution/`),
        detail: { State: ["SUCCESS", "ERROR"] },
      },
      targets: [new targets.LambdaFunction(alertFunction)],
    });
    // #endregion alert

    new CfnOutput(this, "TaskArn", { value: copy.attrTaskArn });
    new CfnOutput(this, "CopyLogGroupName", { value: copyLogs.logGroupName });
    new CfnOutput(this, "AlertTopicArn", { value: alerts.topicArn });
    new CfnOutput(this, "AlertFunctionName", { value: alertFunction.functionName });
  }
}
