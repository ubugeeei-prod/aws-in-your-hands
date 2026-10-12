import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { type ContainersConfig, imageOf, SERVICE, TASK } from "../../src/config.ts";
import { timing } from "../../src/timing.ts";

export type ContainersStackProps = StackProps & { config: ContainersConfig };

export class ContainersStack extends Stack {
  constructor(scope: Construct, id: string, props: ContainersStackProps) {
    super(scope, id, props);
    const { config } = props;

    // #region repository
    const repository = new ecr.Repository(this, "Repository", {
      // A tag names one image forever. "v2 is running" then means one thing.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ description: "keep the 10 newest images", maxImageCount: 10 }],
      // For practice: destroy takes the images with it.
      emptyOnDelete: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });

    // No image yet, so nothing that could run one. And nothing billed by the hour.
    const image = imageOf(config);
    if (image === undefined) {
      return;
    }
    // #endregion repository

    const vpc = importNetwork(this, "Network");

    // #region logs
    const logGroup = new logs.LogGroup(this, "TaskLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion logs

    // #region roles
    const tasks = new iam.ServicePrincipal("ecs-tasks.amazonaws.com");
    // Used by ECS before your code runs: pull the image, open the log stream.
    const executionRole = new iam.Role(this, "ExecutionRole", { assumedBy: tasks });
    // Used by your code. This app calls no AWS API, so the role stays empty.
    const taskRole = new iam.Role(this, "TaskRole", { assumedBy: tasks });
    // #endregion roles

    // #region task
    const taskDefinition = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: TASK.cpuUnits,
      memoryLimitMiB: TASK.memoryMiB,
      // The image is built for arm64, which is also the cheaper Fargate rate.
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      executionRole,
      taskRole,
    });
    taskDefinition.addContainer("api", {
      // Grants the execution role the pull on this repository, and no other.
      // A value that starts with "sha256:" is joined to the URI with "@", any other with ":".
      image: ecs.ContainerImage.fromEcrRepository(repository, image),
      portMappings: [{ containerPort: TASK.containerPort }],
      environment: {
        PORT: String(TASK.containerPort),
        ALLOWED_ORIGIN: config.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        APP_VERSION: image,
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "api" }),
      // The server gives up at timing.shutdownDeadline. SIGKILL has to come after that.
      stopTimeout: Duration.seconds(timing.stopTimeout),
      // The app writes nothing to disk. Now nothing else can either.
      readonlyRootFilesystem: true,
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
      description: "The notes API tasks",
      allowAllOutbound: false,
    });
    // ECR, S3, and CloudWatch Logs are all reached over HTTPS.
    taskGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS out: image pull and logs",
    );
    // #endregion firewall

    // #region service
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const inPublic = config.taskSubnets === "public";
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount: SERVICE.desiredCount,
      vpcSubnets: { subnets: inPublic ? vpc.publicSubnets : vpc.isolatedSubnets },
      // In a public subnet the task has no way to ECR without an address of its own.
      assignPublicIp: inPublic,
      securityGroups: [taskGroup],
      // Never fewer than desiredCount healthy tasks; up to twice as many while replacing.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      // If the new tasks keep failing, stop trying and go back to the last deployment that worked.
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(timing.healthCheckGrace),
    });
    // #endregion service

    // #region load-balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnets: vpc.publicSubnets },
      securityGroup: loadBalancerGroup,
      idleTimeout: Duration.seconds(timing.albIdleTimeout),
      dropInvalidHeaderFields: true,
    });
    // HTTP only: a certificate needs a domain name, and this chapter has none.
    const listener = loadBalancer.addListener("Http", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: true,
    });
    listener.addTargets("Api", {
      port: TASK.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      // Also opens the task group to the load balancer group on this port, and to nothing else.
      targets: [service],
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(timing.healthCheckInterval),
        timeout: Duration.seconds(timing.healthCheckTimeout),
        healthyThresholdCount: timing.healthyThreshold,
        unhealthyThresholdCount: timing.unhealthyThreshold,
      },
      // The default is 300 seconds, which is also how long every deployment would wait per task.
      deregistrationDelay: Duration.seconds(timing.deregistrationDelay),
    });
    // #endregion load-balancer

    // #region scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: SERVICE.desiredCount,
      maxCapacity: SERVICE.maxCount,
    });
    scaling.scaleOnCpuUtilization("Cpu", {
      targetUtilizationPercent: SERVICE.targetCpuPercent,
      scaleOutCooldown: Duration.seconds(60),
      scaleInCooldown: Duration.seconds(300),
    });
    // #endregion scaling

    new CfnOutput(this, "ServiceUrl", { value: `http://${loadBalancer.loadBalancerDnsName}` });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "ServiceName", { value: service.serviceName });
    new CfnOutput(this, "TaskLogGroupName", { value: logGroup.logGroupName });
  }
}
