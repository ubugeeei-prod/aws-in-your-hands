import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";
import { TASK } from "@aih/example-12-containers/src/config.ts";
import { timing } from "@aih/example-12-containers/src/timing.ts";

import { type IsolatesConfig, SERVICE } from "../../src/config.ts";

export type IsolatesStackProps = StackProps & { config: IsolatesConfig };

/** Chapter 12's stack with workerd in the container: the same repository, service, and load balancer. */
export class IsolatesStack extends Stack {
  constructor(scope: Construct, id: string, props: IsolatesStackProps) {
    super(scope, id, props);
    const { config } = props;

    const repository = new ecr.Repository(this, "Repository", {
      // A tag names one image, and so one workerd, one configuration, and one bundle, forever.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ description: "keep the 10 newest images", maxImageCount: 10 }],
      // For practice: destroy takes the images with it.
      emptyOnDelete: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });

    // No image yet, so nothing that could run one. And nothing billed by the hour.
    if (config.imageTag === undefined) {
      return;
    }

    const vpc = importNetwork(this, "Network");

    const logGroup = new logs.LogGroup(this, "TaskLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const tasks = new iam.ServicePrincipal("ecs-tasks.amazonaws.com");
    // Used by ECS before workerd runs: pull the image, open the log stream.
    const executionRole = new iam.Role(this, "ExecutionRole", { assumedBy: tasks });
    // What the workers could use. They call no AWS API, so the role stays empty.
    const taskRole = new iam.Role(this, "TaskRole", { assumedBy: tasks });

    // #region task
    const taskDefinition = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: TASK.cpuUnits,
      memoryLimitMiB: TASK.memoryMiB,
      // The image carries the arm64 binary of workerd.
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      executionRole,
      taskRole,
    });
    taskDefinition.addContainer("workerd", {
      image: ecs.ContainerImage.fromEcrRepository(repository, config.imageTag),
      portMappings: [{ containerPort: TASK.containerPort }],
      // config.capnp turns each of these into a binding of the same name.
      environment: {
        ALLOWED_ORIGIN: config.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      // workerd writes what the workers log to its standard output, one line each.
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "workerd" }),
      stopTimeout: Duration.seconds(timing.stopTimeout),
      // workerd reads its configuration and the bundle, and writes nothing.
      readonlyRootFilesystem: true,
    });
    // #endregion task

    const loadBalancerGroup = new ec2.SecurityGroup(this, "LoadBalancerGroup", {
      vpc,
      description: "HTTP from the internet to the load balancer",
      allowAllOutbound: false,
    });
    const taskGroup = new ec2.SecurityGroup(this, "TaskGroup", {
      vpc,
      description: "The workerd tasks",
      allowAllOutbound: false,
    });
    // ECR, S3, and CloudWatch Logs are all reached over HTTPS. So is anything a worker fetches.
    taskGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS out: image pull and logs",
    );

    // #region service
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const inPublic = config.taskSubnets === "public";
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount: SERVICE.desiredCount,
      vpcSubnets: { subnets: inPublic ? vpc.publicSubnets : vpc.isolatedSubnets },
      assignPublicIp: inPublic,
      securityGroups: [taskGroup],
      // A new version is a new task. The old one keeps answering until the new one is healthy.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(timing.healthCheckGrace),
    });
    // #endregion service

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
    listener.addTargets("Workerd", {
      port: TASK.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      // Answered by the worker, so it fails when the worker cannot be composed.
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(timing.healthCheckInterval),
        timeout: Duration.seconds(timing.healthCheckTimeout),
        healthyThresholdCount: timing.healthyThreshold,
        unhealthyThresholdCount: timing.unhealthyThreshold,
      },
      deregistrationDelay: Duration.seconds(timing.deregistrationDelay),
    });

    new CfnOutput(this, "ServiceUrl", { value: `http://${loadBalancer.loadBalancerDnsName}` });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "ServiceName", { value: service.serviceName });
    new CfnOutput(this, "TaskLogGroupName", { value: logGroup.logGroupName });
  }
}
