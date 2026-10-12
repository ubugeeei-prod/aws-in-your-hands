import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";
import { TASK } from "@aih/example-12-containers/src/config.ts";
import { timing } from "@aih/example-12-containers/src/timing.ts";

import { type FargateConfig, JOB, SCALING, STRATEGY } from "../../src/config.ts";

export type FargateStackProps = StackProps & { config: FargateConfig };

export class FargateStack extends Stack {
  constructor(scope: Construct, id: string, props: FargateStackProps) {
    super(scope, id, props);
    const { config } = props;

    // #region repository
    // This chapter's image holds two programs, so it gets a repository of its own.
    const repository = new ecr.Repository(this, "Repository", {
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ description: "keep the 10 newest images", maxImageCount: 10 }],
      emptyOnDelete: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });

    // As in chapter 12: no image, nothing that runs, nothing billed by the hour.
    if (config.imageTag === undefined) {
      return;
    }
    // #endregion repository

    const vpc = importNetwork(this, "Network");
    const image = ecs.ContainerImage.fromEcrRepository(repository, config.imageTag);
    const logGroup = new logs.LogGroup(this, "TaskLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const runtimePlatform = {
      cpuArchitecture: ecs.CpuArchitecture.ARM64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };

    // #region roles
    const tasks = new iam.ServicePrincipal("ecs-tasks.amazonaws.com");
    const executionRole = new iam.Role(this, "ExecutionRole", { assumedBy: tasks });
    // Empty unless ECS Exec is on: then the agent inside the container needs a channel to Systems Manager.
    const taskRole = new iam.Role(this, "TaskRole", { assumedBy: tasks });
    // The job gets a role of its own, so that switching Exec on for the service gives the job nothing.
    const jobRole = new iam.Role(this, "JobRole", { assumedBy: tasks });
    // #endregion roles

    // #region task
    const taskDefinition = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: TASK.cpuUnits,
      memoryLimitMiB: TASK.memoryMiB,
      runtimePlatform,
      executionRole,
      taskRole,
    });
    taskDefinition.addContainer("api", {
      image,
      portMappings: [{ containerPort: TASK.containerPort }],
      environment: {
        PORT: String(TASK.containerPort),
        ALLOWED_ORIGIN: config.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        APP_VERSION: config.imageTag,
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "api" }),
      // Also the limit of what a Spot interruption leaves: two minutes at most.
      stopTimeout: Duration.seconds(timing.stopTimeout),
      // ECS Exec has to write its agent's files into the container, so the two cannot both be on.
      readonlyRootFilesystem: !config.exec,
      // With Exec on, an init process reaps what a closed session leaves behind.
      linuxParameters: config.exec
        ? new ecs.LinuxParameters(this, "ApiLinux", { initProcessEnabled: true })
        : undefined,
    });
    // #endregion task

    // #region firewall
    const loadBalancerGroup = new ec2.SecurityGroup(this, "LoadBalancerGroup", {
      vpc,
      description: "HTTP from the internet to the load balancer",
      allowAllOutbound: false,
    });
    const taskGroup = new ec2.SecurityGroup(this, "TaskGroup", {
      vpc,
      description: "The notes API tasks and the nightly job",
      allowAllOutbound: false,
    });
    // ECR, S3, CloudWatch Logs, and (for ECS Exec) Systems Manager are all reached over HTTPS.
    taskGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS out");
    // #endregion firewall

    // #region cluster
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    // A strategy can only name capacity providers the cluster is associated with. Set on the
    // cluster itself, so that the service, which refers to the cluster, is created after them.
    const cfnCluster = cluster.node.defaultChild as ecs.CfnCluster;
    cfnCluster.capacityProviders = ["FARGATE", "FARGATE_SPOT"];
    // #endregion cluster

    // #region service
    const inPublic = config.taskSubnets === "public";
    const subnets = inPublic ? vpc.publicSubnets : vpc.isolatedSubnets;
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount: SCALING.minTasks,
      // Instead of a launch type: the first two tasks on Fargate, the rest one to three with Spot.
      capacityProviderStrategies: STRATEGY.map((item) => ({ ...item })),
      vpcSubnets: { subnets },
      assignPublicIp: inPublic,
      securityGroups: [taskGroup],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(timing.healthCheckGrace),
    });
    // #endregion service

    // #region exec
    if (config.exec) {
      // The four actions the agent needs to reach Session Manager. They take no resource to name.
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
      // Set on the resource: the construct's own switch would also let the task write to every log group.
      const cfnService = service.node.defaultChild as ecs.CfnService;
      cfnService.enableExecuteCommand = true;
      service.node.addDependency(taskRole);
    }
    // #endregion exec

    // #region load-balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnets: vpc.publicSubnets },
      securityGroup: loadBalancerGroup,
      idleTimeout: Duration.seconds(timing.albIdleTimeout),
      dropInvalidHeaderFields: true,
    });
    const listener = loadBalancer.addListener("Http", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: true,
    });
    const targetGroup = listener.addTargets("Api", {
      port: TASK.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(timing.healthCheckInterval),
        timeout: Duration.seconds(timing.healthCheckTimeout),
        healthyThresholdCount: timing.healthyThreshold,
        unhealthyThresholdCount: timing.unhealthyThreshold,
      },
      // What a task taken away by scale-in gets to finish its requests. Chapter 12's number, on purpose.
      deregistrationDelay: Duration.seconds(timing.deregistrationDelay),
    });
    // #endregion load-balancer

    // #region scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: SCALING.minTasks,
      maxCapacity: SCALING.maxTasks,
    });
    const cooldowns = {
      scaleOutCooldown: Duration.seconds(SCALING.scaleOutCooldown),
      scaleInCooldown: Duration.seconds(SCALING.scaleInCooldown),
    };
    // Two policies: either one may add tasks, and tasks go only when both agree.
    scaling.scaleOnCpuUtilization("Cpu", {
      targetUtilizationPercent: SCALING.targetCpuPercent,
      ...cooldowns,
    });
    scaling.scaleOnRequestCount("Requests", {
      requestsPerTarget: SCALING.targetRequestsPerTask,
      targetGroup,
      ...cooldowns,
    });
    // #endregion scaling

    // #region job
    const jobDefinition = new ecs.FargateTaskDefinition(this, "Job", {
      cpu: TASK.cpuUnits,
      memoryLimitMiB: TASK.memoryMiB,
      runtimePlatform,
      executionRole,
      taskRole: jobRole,
    });
    jobDefinition.addContainer("job", {
      image,
      // The same image as the service; only the program differs.
      command: ["node", "job.mjs"],
      environment: { JOB_ITEMS: String(JOB.items), APP_VERSION: config.imageTag },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "job" }),
      stopTimeout: Duration.seconds(timing.stopTimeout),
      readonlyRootFilesystem: true,
    });
    // #endregion job

    // #region schedule
    // The role EventBridge Scheduler assumes. It can start this one task definition and nothing else.
    const scheduleRole = new iam.Role(this, "ScheduleRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com").withConditions({
        StringEquals: {
          "aws:SourceAccount": this.account,
          "aws:SourceArn": `arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule-group/default`,
        },
      }),
    });
    // ecs:RunTask on the job's task definition, and iam:PassRole on the two roles the task runs with.
    jobDefinition.grantRun(scheduleRole);
    const schedule = new scheduler.CfnSchedule(this, "JobSchedule", {
      description: "Starts the nightly job of AWS in Your Hands chapter 41",
      scheduleExpression: JOB.schedule,
      scheduleExpressionTimezone: JOB.timezone,
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: cluster.clusterArn,
        roleArn: scheduleRole.roleArn,
        ecsParameters: {
          taskDefinitionArn: jobDefinition.taskDefinitionArn,
          taskCount: 1,
          // The job can be run again from where it stopped, so it is allowed to be interrupted.
          capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }],
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: subnets.map((subnet) => subnet.subnetId),
              securityGroups: [taskGroup.securityGroupId],
              assignPublicIp: inPublic ? "ENABLED" : "DISABLED",
            },
          },
        },
        // Covers only the RunTask call. Whether the job then succeeds is not Scheduler's business.
        retryPolicy: {
          maximumRetryAttempts: JOB.retryAttempts,
          maximumEventAgeInSeconds: JOB.maxEventAgeSeconds,
        },
      },
    });
    schedule.node.addDependency(scheduleRole);
    // #endregion schedule

    new CfnOutput(this, "ServiceUrl", { value: `http://${loadBalancer.loadBalancerDnsName}` });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "ServiceName", { value: service.serviceName });
    new CfnOutput(this, "JobTaskDefinitionArn", { value: jobDefinition.taskDefinitionArn });
    new CfnOutput(this, "TaskSubnetIds", {
      value: subnets.map((subnet) => subnet.subnetId).join(","),
    });
    new CfnOutput(this, "TaskSecurityGroupId", { value: taskGroup.securityGroupId });
    new CfnOutput(this, "TaskPublicIp", { value: inPublic ? "ENABLED" : "DISABLED" });
    new CfnOutput(this, "TaskLogGroupName", { value: logGroup.logGroupName });
  }
}
