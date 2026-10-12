import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { RUNNER, type RunnerConfig, TIMING } from "../../src/config.ts";

export type RunnerStackProps = StackProps & { config: RunnerConfig };

const source = (file: string): string =>
  fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

/** A webhook receiver that starts one Fargate task per queued job. Nothing runs between jobs. */
export class RunnerStack extends Stack {
  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vpc = importNetwork(this, "Network");
    const logGroup = (name: string) =>
      new logs.LogGroup(this, name, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    // #region secrets
    // Generated at deploy time. The same value goes into the GitHub App's webhook settings.
    const webhookSecret = new secretsmanager.Secret(this, "WebhookSecret", {
      description: "AWS in Your Hands chapter 62: the secret GitHub signs webhook deliveries with",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Created with a random value that is no key at all. The app's private key is put in by hand.
    const appKey = new secretsmanager.Secret(this, "AppPrivateKey", {
      description: "AWS in Your Hands chapter 62: the GitHub App's private key (PEM)",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion secrets

    // #region claims
    const claims = new dynamodb.Table(this, "Claims", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion claims

    // #region roles
    const tasks = new iam.ServicePrincipal("ecs-tasks.amazonaws.com");
    // Pulls nothing from ECR and reads no secret: all it does is write the runner's log.
    const executionRole = new iam.Role(this, "ExecutionRole", { assumedBy: tasks });
    // What a job can reach without asking anyone. It stays empty, and a test keeps it empty.
    const taskRole = new iam.Role(this, "TaskRole", { assumedBy: tasks });
    // #endregion roles

    // #region task
    const taskLogs = logGroup("RunnerLogs");
    const taskDefinition = new ecs.FargateTaskDefinition(this, "Runner", {
      cpu: RUNNER.cpuUnits,
      memoryLimitMiB: RUNNER.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      executionRole,
      taskRole,
    });
    taskDefinition.addContainer(RUNNER.containerName, {
      image: ecs.ContainerImage.fromRegistry(RUNNER.image),
      // The registration arrives as arguments at RunTask. Without them the runner exits at once.
      entryPoint: [RUNNER.entryPoint],
      logging: ecs.LogDrivers.awsLogs({ logGroup: taskLogs, streamPrefix: "runner" }),
    });
    // #endregion task

    // #region network
    const runnerGroup = new ec2.SecurityGroup(this, "RunnerGroup", {
      vpc,
      description: "CI runners: nothing in, HTTPS out",
      allowAllOutbound: false,
    });
    runnerGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS out");
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    // #endregion network

    // #region receiver-role
    const receiverLogs = logGroup("ReceiverLogs");
    const receiverRole = new iam.Role(this, "ReceiverRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        Receiver: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "ReadTheTwoSecrets",
              actions: ["secretsmanager:GetSecretValue"],
              resources: [webhookSecret.secretArn, appKey.secretArn],
            }),
            new iam.PolicyStatement({
              sid: "ClaimJobs",
              actions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
              resources: [claims.tableArn],
            }),
            // This revision of this task definition, in this cluster. Not ecs:RunTask on everything.
            new iam.PolicyStatement({
              sid: "StartRunners",
              actions: ["ecs:RunTask"],
              resources: [taskDefinition.taskDefinitionArn],
              conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
            }),
            // RunTask hands the task its roles. Only these two, and only to ECS.
            new iam.PolicyStatement({
              sid: "PassTheTaskRoles",
              actions: ["iam:PassRole"],
              resources: [executionRole.roleArn, taskRole.roleArn],
              conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
            }),
          ],
        }),
      },
    });
    receiverLogs.grants.write(receiverRole);
    // #endregion receiver-role

    const bundling = {
      format: nodejs.OutputFormat.ESM,
      target: "node24",
      minify: false,
      sourceMap: false,
      // Bundle the AWS SDK too, so the function runs the version in pnpm-lock.yaml.
      externalModules: [],
      banner:
        "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    };

    // #region receiver
    const receiver = new nodejs.NodejsFunction(this, "Receiver", {
      entry: source("lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // GitHub records a delivery as failed after ten seconds.
      timeout: Duration.seconds(TIMING.receiverTimeout),
      role: receiverRole,
      logGroup: receiverLogs,
      environment: {
        WEBHOOK_SECRET_ID: webhookSecret.secretArn,
        APP_KEY_SECRET_ID: appKey.secretArn,
        APP_CLIENT_ID: config.appClientId ?? "",
        RUNNER_GROUP_ID: String(config.runnerGroupId),
        REPOSITORIES: config.repositories.join(","),
        CLAIMS_TABLE: claims.tableName,
        CLUSTER: cluster.clusterArn,
        TASK_DEFINITION: taskDefinition.taskDefinitionArn,
        SUBNETS: vpc.publicSubnets.map((subnet) => subnet.subnetId).join(","),
        SECURITY_GROUP: runnerGroup.securityGroupId,
      },
      bundling,
    });
    // Open to the internet on purpose: GitHub cannot sign a request for IAM. The HMAC is the check.
    const url = receiver.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    // #endregion receiver

    // #region sweeper
    const sweeperLogs = logGroup("SweeperLogs");
    const sweeperRole = new iam.Role(this, "SweeperRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        Sweeper: new iam.PolicyDocument({
          statements: [
            // ListTasks takes no task to name, so the cluster is fixed by a condition instead.
            new iam.PolicyStatement({
              sid: "ListTheClustersTasks",
              actions: ["ecs:ListTasks"],
              resources: ["*"],
              conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
            }),
            new iam.PolicyStatement({
              sid: "StopOldRunners",
              actions: ["ecs:DescribeTasks", "ecs:StopTask"],
              resources: [
                `arn:${this.partition}:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`,
              ],
            }),
          ],
        }),
      },
    });
    sweeperLogs.grants.write(sweeperRole);
    const sweeper = new nodejs.NodejsFunction(this, "Sweeper", {
      entry: source("sweeper-lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(60),
      role: sweeperRole,
      logGroup: sweeperLogs,
      environment: { CLUSTER: cluster.clusterArn },
      bundling,
    });
    const scheduleRole = new iam.Role(this, "ScheduleRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com").withConditions({
        StringEquals: { "aws:SourceAccount": this.account },
      }),
      inlinePolicies: {
        Invoke: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["lambda:InvokeFunction"],
              resources: [sweeper.functionArn],
            }),
          ],
        }),
      },
    });
    const schedule = new scheduler.CfnSchedule(this, "SweepSchedule", {
      description: "Stops CI runner tasks that outlived their time limit",
      scheduleExpression: `rate(${RUNNER.sweepMinutes} minutes)`,
      flexibleTimeWindow: { mode: "OFF" },
      target: { arn: sweeper.functionArn, roleArn: scheduleRole.roleArn },
    });
    schedule.node.addDependency(scheduleRole);
    // #endregion sweeper

    new CfnOutput(this, "WebhookUrl", { value: `${url.url}webhook` });
    new CfnOutput(this, "WebhookSecretArn", { value: webhookSecret.secretArn });
    new CfnOutput(this, "AppPrivateKeySecretArn", { value: appKey.secretArn });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "RunnerLogGroupName", { value: taskLogs.logGroupName });
  }
}
