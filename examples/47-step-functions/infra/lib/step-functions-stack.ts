import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";

import { noteDigestWorkflow } from "../../src/digest.ts";
import { importNoteWorkflow } from "../../src/saga.ts";

export class StepFunctionsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // #region data
    // Chapter 05's table layout. This stack's own table, so the practice does not touch real notes.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const files = new s3.Bucket(this, "Files", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // An upload nobody imported is gone the next day.
      lifecycleRules: [{ prefix: "inbox/", expiration: Duration.days(1) }],
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Where WaitForScan leaves its request. A request nobody answers outlives its task by a day at most.
    const scanRequests = new sqs.Queue(this, "ScanRequests", {
      retentionPeriod: Duration.days(1),
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const imports = new sns.Topic(this, "Imports", { enforceSSL: true });
    imports.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion data

    // #region trust
    // Step Functions may assume a role only for a state machine of this account and Region.
    const assumedByStateMachines = () =>
      new iam.ServicePrincipal("states.amazonaws.com").withConditions({
        StringEquals: { "aws:SourceAccount": this.account },
        ArnLike: {
          "aws:SourceArn": this.formatArn({
            service: "states",
            resource: "stateMachine",
            resourceName: "*",
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        },
      });
    // #endregion trust

    // #region saga
    // One statement per state, more or less: the role can do what the definition does, and no more.
    const importRole = new iam.Role(this, "ImportRole", { assumedBy: assumedByStateMachines() });
    importRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
        resources: [table.tableArn],
      }),
    );
    importRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [files.arnForObjects("inbox/*")],
      }),
    );
    importRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:DeleteObject"],
        resources: [files.arnForObjects("attachments/*")],
      }),
    );
    importRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [scanRequests.queueArn] }),
    );
    importRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["sns:Publish"], resources: [imports.topicArn] }),
    );
    const importNote = new sfn.CfnStateMachine(this, "ImportNote", {
      // Standard: every step is recorded, a task can wait for its token, a failed run can be redriven.
      stateMachineType: "STANDARD",
      roleArn: importRole.roleArn,
      // The definition the tests walk, with this stack's names in place of the local ones.
      definitionString: this.toJsonString(
        importNoteWorkflow({
          tableName: table.tableName,
          bucketName: files.bucketName,
          queueUrl: scanRequests.queueUrl,
          topicArn: imports.topicArn,
        }),
      ),
    });
    // Step Functions checks the role when the state machine is created.
    importNote.node.addDependency(importRole);
    importNote.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion saga

    // #region express
    // An Express workflow keeps no history of its own. Without this log group a failure leaves no trace.
    const digestLogs = new logs.LogGroup(this, "DigestLogs", {
      // The prefix keeps the account's log resource policy from growing with each state machine.
      logGroupName: `/aws/vendedlogs/states/${this.stackName}-NoteDigest`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const digestRole = new iam.Role(this, "DigestRole", { assumedBy: assumedByStateMachines() });
    digestRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["dynamodb:GetItem"], resources: [table.tableArn] }),
    );
    // The list and the "*" are the documentation's: these actions accept no resource.
    digestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:CreateLogStream",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutLogEvents",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      }),
    );
    const noteDigest = new sfn.CfnStateMachine(this, "NoteDigest", {
      // Express: at most five minutes, billed by request and duration, and it may run twice.
      stateMachineType: "EXPRESS",
      roleArn: digestRole.roleArn,
      definitionString: this.toJsonString(noteDigestWorkflow({ tableName: table.tableName })),
      loggingConfiguration: {
        // Failures only, and without the notes' titles.
        level: "ERROR",
        includeExecutionData: false,
        destinations: [{ cloudWatchLogsLogGroup: { logGroupArn: digestLogs.logGroupArn } }],
      },
    });
    noteDigest.node.addDependency(digestRole);
    noteDigest.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion express

    new CfnOutput(this, "NotesTableName", { value: table.tableName });
    new CfnOutput(this, "FilesBucketName", { value: files.bucketName });
    new CfnOutput(this, "ScanRequestsQueueUrl", { value: scanRequests.queueUrl });
    new CfnOutput(this, "ImportsTopicArn", { value: imports.topicArn });
    new CfnOutput(this, "ImportNoteArn", { value: importNote.attrArn });
    new CfnOutput(this, "NoteDigestArn", { value: noteDigest.attrArn });
    new CfnOutput(this, "DigestLogGroupName", { value: digestLogs.logGroupName });
  }
}
