import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import type { Construct } from "constructs";

// Not part of the deployed app, and never synthesized by a task: a load balancer and two
// tasks are billed by the hour. It exists so that a test can read the template it makes.

// #region ecs
/** Chapter 12's kind of service, deployed by ECS itself as a canary: 10% for ten minutes, then the rest. */
export class EcsCanarySketchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 0 });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    taskDefinition.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(new ecr.Repository(this, "Repository"), "v2"),
      portMappings: [{ containerPort: 8080 }],
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
    });
    // Two target groups. ECS fills the second with the new tasks and moves the weights between them.
    const group = (name: string) =>
      new elbv2.ApplicationTargetGroup(this, name, {
        vpc,
        port: 8080,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: { path: "/health" },
      });
    const blue = group("Blue");
    const green = group("Green");
    const listener = loadBalancer.addListener("Http", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404),
    });
    const rule = new elbv2.ApplicationListenerRule(this, "Production", {
      listener,
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
      action: elbv2.ListenerAction.weightedForward([
        { targetGroup: blue, weight: 100 },
        { targetGroup: green, weight: 0 },
      ]),
    });

    const serverErrors = new cloudwatch.Alarm(this, "ServerErrors", {
      metric: loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
        period: Duration.minutes(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount: 2,
      deploymentStrategy: ecs.DeploymentStrategy.CANARY,
      canaryConfiguration: { stepPercent: 10, stepBakeTime: Duration.minutes(10) },
      // After 100%: how long the old tasks stay, so that going back needs no new tasks.
      bakeTime: Duration.minutes(5),
      deploymentAlarms: {
        alarmNames: [serverErrors.alarmName],
        behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
      },
    });
    const target = service.loadBalancerTarget({
      containerName: "api",
      containerPort: 8080,
      alternateTarget: new ecs.AlternateTarget("Green", {
        alternateTargetGroup: green,
        productionListener: ecs.ListenerRuleConfiguration.applicationListenerRule(rule),
      }),
    });
    target.attachToApplicationTargetGroup(blue);
  }
}
// #endregion ecs
