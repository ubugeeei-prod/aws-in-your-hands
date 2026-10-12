import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";
import { modelArns } from "@aih/example-17-ai/infra/lib/models.ts";

import { CONTAINER, REAPER_SCHEDULE, type SandboxConfig, TASK } from "../../src/config.ts";

export type AgentSandboxStackProps = StackProps & { config: SandboxConfig };

const INVOKE = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"];
const source = (file: string): string =>
  fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

export class AgentSandboxStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentSandboxStackProps) {
    super(scope, id, props);
    const { config } = props;

    // #region repository
    // A tag names one image for good, so "the image the task started from" stays answerable.
    const repository = new ecr.Repository(this, "Repository", {
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ description: "keep the 10 newest images", maxImageCount: 10 }],
      emptyOnDelete: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });

    if (config.imageTag === undefined) {
      return;
    }
    // #endregion repository

    const vpc = importNetwork(this, "Network");
    const subnets = vpc.isolatedSubnets;

    // #region logs
    // The task's stdout: every tool call the agent made. Written by the execution role, not by the task.
    const taskLogs = new logs.LogGroup(this, "TaskLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion logs

    // #region task-role
    const tasks = new iam.ServicePrincipal("ecs-tasks.amazonaws.com");
    const executionRole = new iam.Role(this, "ExecutionRole", { assumedBy: tasks });
    // What the agent holds. Everything it can do in AWS is the two statements below.
    const taskRole = new iam.Role(this, "TaskRole", { assumedBy: tasks });
    const arns = modelArns(config.model, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    taskRole.addToPolicy(
      new iam.PolicyStatement({ actions: INVOKE, resources: [arns.profileArn] }),
    );
    // The models behind the profile, and only by way of that profile.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: INVOKE,
        resources: arns.modelArns,
        conditions: { StringLike: { "bedrock:InferenceProfileArn": arns.profileArn } },
      }),
    );
    // #endregion task-role

    // #region task
    const taskDefinition = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: TASK.cpuUnits,
      memoryLimitMiB: TASK.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      executionRole,
      taskRole,
      // Empty at the start of every task and gone at its end.
      volumes: [{ name: "workspace" }, { name: "home" }, { name: "tmp" }],
    });
    const container = taskDefinition.addContainer(CONTAINER, {
      image: ecs.ContainerImage.fromEcrRepository(repository, config.imageTag),
      environment: { MODEL: config.model, AWS_REGION: this.region },
      logging: ecs.LogDrivers.awsLogs({ logGroup: taskLogs, streamPrefix: "job" }),
      stopTimeout: Duration.seconds(30),
      // The image cannot be changed from inside, the agent's settings file included.
      // ECS Exec has to write its agent's files into the container, so the two cannot both be on.
      readonlyRootFilesystem: !config.exec,
      linuxParameters: config.exec
        ? new ecs.LinuxParameters(this, "AgentLinux", { initProcessEnabled: true })
        : undefined,
    });
    container.addMountPoints(
      { sourceVolume: "workspace", containerPath: "/workspace", readOnly: false },
      { sourceVolume: "home", containerPath: "/home/node", readOnly: false },
      { sourceVolume: "tmp", containerPath: "/tmp", readOnly: false },
    );
    // #endregion task

    // #region network
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const taskGroup = new ec2.SecurityGroup(this, "TaskGroup", {
      vpc,
      description: "Agent sandbox tasks: nothing in, HTTPS out",
      allowAllOutbound: false,
    });
    // A security group cannot name a domain. Which hosts answer on 443 is the route's business.
    taskGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS out");
    // #endregion network

    // #region model-endpoint
    if (config.modelEndpoint) {
      const endpointGroup = new ec2.SecurityGroup(this, "ModelEndpointGroup", {
        vpc,
        description: "The bedrock-runtime endpoint: HTTPS from the sandbox tasks",
        allowAllOutbound: false,
      });
      endpointGroup.addIngressRule(taskGroup, ec2.Port.tcp(443), "from the sandbox tasks");
      const endpoint = new ec2.InterfaceVpcEndpoint(this, "ModelEndpoint", {
        vpc,
        service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
        subnets: { subnets },
        securityGroups: [endpointGroup],
        privateDnsEnabled: true,
      });
      // A second lock on the same door: through this endpoint, only the task role, only these models.
      endpoint.addToPolicy(
        new iam.PolicyStatement({
          principals: [new iam.AnyPrincipal()],
          actions: INVOKE,
          resources: [arns.profileArn, ...arns.modelArns],
          conditions: { ArnEquals: { "aws:PrincipalArn": taskRole.roleArn } },
        }),
      );
    }
    // #endregion model-endpoint

    // #region exec
    if (config.exec) {
      // The four actions ECS Exec's agent needs. They take no resource to name, and the agent holds them too.
      taskRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "ssmmessages:CreateControlChannel",
            "ssmmessages:CreateDataChannel",
            "ssmmessages:OpenControlChannel",
            "ssmmessages:OpenDataChannel",
          ],
          resources: ["*"],
        }),
      );
    }
    // #endregion exec

    const tasksOfCluster = `arn:${this.partition}:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`;
    const inCluster = { ArnEquals: { "ecs:cluster": cluster.clusterArn } };
    const lambdaService = new iam.ServicePrincipal("lambda.amazonaws.com");
    const functionDefaults = {
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    };
    const sharedEnvironment = {
      CLUSTER_ARN: cluster.clusterArn,
      TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
      SUBNET_IDS: subnets.map((subnet) => subnet.subnetId).join(","),
      SECURITY_GROUP_ID: taskGroup.securityGroupId,
      MODEL: config.model,
    };
    // Both functions look at the tasks and at what the model has cost today.
    const watch = [
      new iam.PolicyStatement({
        actions: ["ecs:ListTasks"],
        resources: ["*"],
        conditions: inCluster,
      }),
      new iam.PolicyStatement({ actions: ["ecs:DescribeTasks"], resources: [tasksOfCluster] }),
      // CloudWatch has no narrower resource to offer for reading metrics.
      new iam.PolicyStatement({ actions: ["cloudwatch:GetMetricData"], resources: ["*"] }),
    ];

    // #region launcher
    const launcherLogs = new logs.LogGroup(this, "LauncherLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const launcherRole = new iam.Role(this, "LauncherRole", { assumedBy: lambdaService });
    launcherLogs.grants.write(launcherRole);
    for (const statement of watch) {
      launcherRole.addToPolicy(statement);
    }
    // This task definition, in this cluster, and nothing else can be started.
    launcherRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [taskDefinition.taskDefinitionArn],
        conditions: inCluster,
      }),
    );
    launcherRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [taskRole.roleArn, executionRole.roleArn],
        conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
      }),
    );
    // The GitHub App's key, by name. The stack does not create it and no task can read it.
    const secretArn = `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${config.githubAppSecretName}`;
    launcherRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        // Secrets Manager ends every ARN with a hyphen and six characters of its own.
        resources: [`${secretArn}-??????`],
      }),
    );
    const launcher = new nodejs.NodejsFunction(this, "Launcher", {
      ...functionDefaults,
      entry: source("launcher-lambda.ts"),
      timeout: Duration.seconds(30),
      role: launcherRole,
      logGroup: launcherLogs,
      environment: {
        ...sharedEnvironment,
        ALLOWED_REPOSITORIES: config.repositories.join(","),
        GITHUB_APP_SECRET_ARN: secretArn,
        EXEC: String(config.exec),
      },
    });
    // #endregion launcher

    // #region reaper
    const reaperLogs = new logs.LogGroup(this, "ReaperLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const reaperRole = new iam.Role(this, "ReaperRole", { assumedBy: lambdaService });
    reaperLogs.grants.write(reaperRole);
    for (const statement of watch) {
      reaperRole.addToPolicy(statement);
    }
    reaperRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:StopTask"],
        resources: [tasksOfCluster],
        conditions: inCluster,
      }),
    );
    const reaper = new nodejs.NodejsFunction(this, "Reaper", {
      ...functionDefaults,
      entry: source("reaper-lambda.ts"),
      timeout: Duration.seconds(30),
      role: reaperRole,
      logGroup: reaperLogs,
      environment: sharedEnvironment,
    });

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
        resources: [reaper.functionArn],
      }),
    );
    const schedule = new scheduler.CfnSchedule(this, "ReaperSchedule", {
      description: "Looks once a minute for agent tasks past their deadline or their budget",
      scheduleExpression: REAPER_SCHEDULE,
      flexibleTimeWindow: { mode: "OFF" },
      target: { arn: reaper.functionArn, roleArn: scheduleRole.roleArn },
    });
    schedule.node.addDependency(scheduleRole);
    // #endregion reaper

    new CfnOutput(this, "LauncherFunctionName", { value: launcher.functionName });
    new CfnOutput(this, "ReaperFunctionName", { value: reaper.functionName });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "TaskLogGroupName", { value: taskLogs.logGroupName });
    new CfnOutput(this, "TaskRoleArn", { value: taskRole.roleArn });
  }
}
