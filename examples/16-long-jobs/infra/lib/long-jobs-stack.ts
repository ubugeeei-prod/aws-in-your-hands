import { fileURLToPath } from "node:url";

import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";

import { EXPORT_PREFIX } from "../../src/job.ts";
import { EXPORT_PAGES_TIMEOUT_SECONDS, exportWorkflow } from "../../src/workflow.ts";

export type LongJobsStackProps = StackProps & {
  /** Also deploys the export as a Lambda durable function, to start by hand. Off by default. */
  durable: boolean;
};

const SCHEDULE_NAME = "aih-long-jobs-export";
const DURABLE_FUNCTION_NAME = "aih-long-jobs-durable-export";
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

export class LongJobsStack extends Stack {
  constructor(scope: Construct, id: string, props: LongJobsStackProps) {
    super(scope, id, props);

    // Chapter 05's table layout, so chapter 05's repository can fill it.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region bucket
    const exports = new s3.Bucket(this, "Exports", {
      // Every owner's notes end up here. Nothing about this bucket may be public.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Finished or abandoned, an export is gone a week later. This is also
      // what cleans up after a run that failed and was never resumed.
      lifecycleRules: [{ prefix: EXPORT_PREFIX, expiration: Duration.days(7) }],
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const exportObjects = exports.arnForObjects(`${EXPORT_PREFIX}*`);
    const listExports = new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [exports.bucketArn],
      conditions: { StringLike: { "s3:prefix": `${EXPORT_PREFIX}*` } },
    });
    // #endregion bucket

    const step = (
      name: string,
      entry: string,
      timeout: Duration,
      environment: Record<string, string>,
    ) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const role = new iam.Role(this, `${name}Role`, {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      });
      logGroup.grantWrite(role);
      const fn = new nodejs.NodejsFunction(this, name, {
        entry: source(entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout,
        role,
        logGroup,
        environment: { EXPORT_BUCKET: exports.bucketName, LOG_LEVEL: "info", ...environment },
        bundling,
      });
      new CfnOutput(this, `${name}LogGroupName`, { value: logGroup.logGroupName });
      return { fn, role };
    };

    // #region steps
    // Three functions, three roles. Only one of them can read the notes, and only one can delete.
    const pages = step(
      "ExportPages",
      "export-pages-lambda.ts",
      Duration.seconds(EXPORT_PAGES_TIMEOUT_SECONDS),
      {
        TABLE_NAME: table.tableName,
        PAGE_SIZE: "100",
        RESERVE_SECONDS: "60",
      },
    );
    pages.role.addToPolicy(
      new iam.PolicyStatement({ actions: ["dynamodb:Scan"], resources: [table.tableArn] }),
    );
    // PutObject covers the If-None-Match check. HeadObject is authorized as GetObject.
    pages.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject"],
        resources: [exportObjects],
      }),
    );

    const finish = step("Finish", "finish-lambda.ts", Duration.seconds(60), {});
    finish.role.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [exportObjects] }),
    );
    finish.role.addToPolicy(listExports);

    const discard = step("Discard", "discard-lambda.ts", Duration.seconds(300), {});
    discard.role.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:DeleteObject"], resources: [exportObjects] }),
    );
    discard.role.addToPolicy(listExports);
    // #endregion steps

    // #region state-machine
    // The role Step Functions assumes to call the three functions, and nothing else.
    const workflowRole = new iam.Role(this, "WorkflowRole", {
      assumedBy: new iam.ServicePrincipal("states.amazonaws.com").withConditions({
        StringEquals: { "aws:SourceAccount": this.account },
        ArnLike: {
          "aws:SourceArn": this.formatArn({
            service: "states",
            resource: "stateMachine",
            resourceName: "*",
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        },
      }),
    });
    workflowRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [pages.fn.functionArn, finish.fn.functionArn, discard.fn.functionArn],
      }),
    );
    const workflow = new sfn.CfnStateMachine(this, "ExportWorkflow", {
      // Standard: state is kept between steps, and a failed run can be resumed.
      stateMachineType: "STANDARD",
      roleArn: workflowRole.roleArn,
      // The same definition the local run uses, with the function ARNs filled in.
      definitionString: this.toJsonString(
        exportWorkflow({
          exportPages: pages.fn.functionArn,
          finish: finish.fn.functionArn,
          discard: discard.fn.functionArn,
        }),
      ),
    });
    // Step Functions checks the role's permissions when the state machine is created.
    workflow.node.addDependency(workflowRole);
    workflow.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion state-machine

    // #region schedule
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
        actions: ["states:StartExecution"],
        resources: [workflow.attrArn],
      }),
    );
    const schedule = new scheduler.CfnSchedule(this, "ExportSchedule", {
      name: SCHEDULE_NAME,
      description: "Starts the notes export of AWS in Your Hands chapter 16",
      scheduleExpression: "rate(1 day)",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: workflow.attrArn,
        roleArn: scheduleRole.roleArn,
        // Scheduler replaces the keyword with the time this run was due. A
        // second delivery of the same firing carries the same time.
        input: JSON.stringify({ exportId: "<aws.scheduler.scheduled-time>" }),
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 900 },
      },
    });
    schedule.node.addDependency(scheduleRole);
    // #endregion schedule

    // #region durable
    if (props.durable) {
      const durableLogs = new logs.LogGroup(this, "DurableExportLogs", {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const durableRole = new iam.Role(this, "DurableExportRole", {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      });
      durableLogs.grantWrite(durableRole);
      durableRole.addToPolicy(
        new iam.PolicyStatement({ actions: ["dynamodb:Scan"], resources: [table.tableArn] }),
      );
      // One function does all three steps, so one role holds all three sets of permissions.
      durableRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
          resources: [exportObjects],
        }),
      );
      durableRole.addToPolicy(listExports);
      durableRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState"],
          // Lambda authorizes these against the execution's ARN, which hangs off
          // a qualified function ARN. The name is fixed so the role need not refer to the function.
          resources: [
            this.formatArn({
              service: "lambda",
              resource: "function",
              resourceName: `${DURABLE_FUNCTION_NAME}:*`,
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
      );
      const durableExport = new nodejs.NodejsFunction(this, "DurableExport", {
        functionName: DURABLE_FUNCTION_NAME,
        entry: source("durable-lambda.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        // One invocation. The export as a whole may take as long as executionTimeout.
        timeout: Duration.seconds(EXPORT_PAGES_TIMEOUT_SECONDS),
        durableConfig: { executionTimeout: Duration.hours(6), retentionPeriod: Duration.days(1) },
        role: durableRole,
        logGroup: durableLogs,
        environment: {
          EXPORT_BUCKET: exports.bucketName,
          TABLE_NAME: table.tableName,
          PAGE_SIZE: "100",
          LOG_LEVEL: "info",
        },
        bundling,
        currentVersionOptions: { removalPolicy: RemovalPolicy.DESTROY },
      });
      // A run stays on the version that started it, so it is always invoked through a version or an alias.
      const live = new lambda.Alias(this, "DurableExportLive", {
        aliasName: "live",
        version: durableExport.currentVersion,
      });
      new CfnOutput(this, "DurableExportAliasArn", { value: live.functionArn });
      new CfnOutput(this, "DurableExportLogGroupName", { value: durableLogs.logGroupName });
    }
    // #endregion durable

    new CfnOutput(this, "ExportsBucketName", { value: exports.bucketName });
    new CfnOutput(this, "NotesTableName", { value: table.tableName });
    new CfnOutput(this, "ExportWorkflowArn", { value: workflow.attrArn });
    new CfnOutput(this, "ExportScheduleName", { value: SCHEDULE_NAME });
  }
}
