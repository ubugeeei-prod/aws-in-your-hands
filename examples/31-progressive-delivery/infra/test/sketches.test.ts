import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import { shiftWithCodeDeploy } from "../lib/codedeploy-sketch.ts";
import { EcsCanarySketchStack } from "../lib/ecs-canary-sketch.ts";

describe("the CodeDeploy route, as a template only", () => {
  const stack = new Stack(new App(), "Sketch", { env: { region: "ap-northeast-1" } });
  const fn = new lambda.Function(stack, "Fn", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("export const handler = async () => ({ statusCode: 200 });"),
  });
  const alias = new lambda.Alias(stack, "Live", { aliasName: "live", version: fn.currentVersion });
  const alarm = new cloudwatch.Alarm(stack, "Errors", {
    metric: alias.metricErrors(),
    threshold: 1,
    evaluationPeriods: 1,
  });
  shiftWithCodeDeploy(stack, alias, [alarm]);
  const template = Template.fromStack(stack);

  it("asks for the shift with an UpdatePolicy on the alias, which only CloudFormation acts on", () => {
    const [resource] = Object.values(template.findResources("AWS::Lambda::Alias"));
    expect(Object.keys(resource?.["UpdatePolicy"] ?? {})).toEqual(["CodeDeployLambdaAliasUpdate"]);
  });

  it("names a predefined configuration and rolls back on the alarm", () => {
    template.hasResourceProperties("AWS::CodeDeploy::DeploymentGroup", {
      DeploymentConfigName: "CodeDeployDefault.LambdaCanary10Percent5Minutes",
      AutoRollbackConfiguration: {
        Enabled: true,
        Events: ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"],
      },
      AlarmConfiguration: { Enabled: true },
    });
  });
});

describe("the ECS canary, as a template only", () => {
  const template = Template.fromStack(
    new EcsCanarySketchStack(new App(), "EcsSketch", { env: { region: "ap-northeast-1" } }),
  );
  const [service] = Object.values(template.findResources("AWS::ECS::Service"));
  const properties = service?.["Properties"] as Record<string, unknown>;

  it("lets ECS shift 10% for ten minutes, then the rest, and keeps the old tasks five more", () => {
    expect(properties["DeploymentConfiguration"]).toMatchObject({
      Strategy: "CANARY",
      CanaryConfiguration: { CanaryPercent: 10, CanaryBakeTimeInMinutes: 10 },
      BakeTimeInMinutes: 5,
      Alarms: { Enable: true, Rollback: true },
    });
    // The controller is still ECS. CodeDeploy is not involved.
    const controller = properties["DeploymentController"] as { Type?: string } | undefined;
    expect(controller?.Type ?? "ECS").toBe("ECS");
  });

  it("names a second target group, a listener rule, and a role for ECS to move traffic with", () => {
    const [balancer] = properties["LoadBalancers"] as { AdvancedConfiguration: object }[];
    expect(Object.keys(balancer?.AdvancedConfiguration ?? {}).toSorted()).toEqual([
      "AlternateTargetGroupArn",
      "ProductionListenerRule",
      "RoleArn",
    ]);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 2);
  });
});
