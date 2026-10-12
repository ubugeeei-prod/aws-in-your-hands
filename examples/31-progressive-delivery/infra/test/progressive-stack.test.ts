import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { APPCONFIG_EXTENSION_ARN, ProgressiveStack } from "../lib/progressive-stack.ts";

// Synthesis bundles the handler with esbuild, so it runs once for the file.
const template = Template.fromStack(
  new ProgressiveStack(new App(), "AihProgressive", {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "https://d111.cloudfront.net",
    faultPercent: 0,
  }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

const statements = (): Statement[] => [
  ...Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  ),
  ...Object.values(template.findResources("AWS::IAM::Role")).flatMap((role) =>
    (
      (role["Properties"].Policies ?? []) as { PolicyDocument: { Statement: Statement[] } }[]
    ).flatMap((policy) => policy.PolicyDocument.Statement),
  ),
];

describe("ProgressiveStack", () => {
  it("grants only log writes, reading one configuration, and reading two alarms", () => {
    expect(
      statements()
        .flatMap((statement) => statement.Action)
        .toSorted(),
    ).toEqual([
      "appconfig:GetLatestConfiguration",
      "appconfig:StartConfigurationSession",
      "cloudwatch:DescribeAlarms",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    for (const statement of statements()) {
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
      expect(JSON.stringify(statement.Resource)).not.toMatch(/\*"/);
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("lets the function read the flags of its own environment and no other", () => {
    const read = statements().find((statement) =>
      [statement.Action].flat().includes("appconfig:GetLatestConfiguration"),
    );
    const resource = JSON.stringify(read?.Resource);
    expect(resource).toContain(":application/");
    expect(resource).toContain("/environment/");
    expect(resource).toContain("/configuration/");
  });

  it("sends every request through the alias, never to $LATEST", () => {
    const alias = Object.keys(template.findResources("AWS::Lambda::Alias"));
    expect(alias).toHaveLength(1);
    for (const integration of Object.values(
      template.findResources("AWS::ApiGatewayV2::Integration"),
    )) {
      expect(integration["Properties"].IntegrationUri).toEqual({ Ref: alias[0] });
    }
    for (const permission of Object.values(template.findResources("AWS::Lambda::Permission"))) {
      expect(permission["Properties"].FunctionName).toEqual({ Ref: alias[0] });
    }
  });

  it("leaves the alias's weights out of the template, so a deploy never moves traffic", () => {
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
      RoutingConfig: Match.absent(),
    });
    // One fixed version resource: a changed bundle must not publish (and switch to) a new one.
    const versions = template.findResources("AWS::Lambda::Version");
    expect(Object.keys(versions)).toEqual(["FirstVersionBB6C5A65"]);
    expect(Object.values(versions)[0]?.["Properties"]).toEqual({
      FunctionName: { Ref: Object.keys(template.findResources("AWS::Lambda::Function"))[0] },
    });
  });

  it("watches crashes on the alias and 5xx answers on the API, one minute at a time", () => {
    const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm")).map(
      (alarm) => alarm["Properties"],
    );
    expect(alarms.map((alarm) => `${alarm.Namespace}/${alarm.MetricName}`).toSorted()).toEqual([
      "AWS/ApiGateway/5xx",
      "AWS/Lambda/Errors",
    ]);
    for (const alarm of alarms) {
      expect(alarm).toMatchObject({
        Period: 60,
        EvaluationPeriods: 1,
        Statistic: "Sum",
        Threshold: 1,
        TreatMissingData: "notBreaching",
      });
    }
    const errors = alarms.find((alarm) => alarm.MetricName === "Errors");
    expect(JSON.stringify(errors?.Dimensions)).toContain(":live");
  });

  it("gives AppConfig the same two alarms to roll a flag deployment back on", () => {
    const alarms = Object.keys(template.findResources("AWS::CloudWatch::Alarm"));
    const monitors = Object.values(template.findResources("AWS::AppConfig::Environment"))[0]?.[
      "Properties"
    ].Monitors as { AlarmArn: { "Fn::GetAtt": [string, string] } }[];
    expect(monitors.map((monitor) => monitor.AlarmArn["Fn::GetAtt"][0]).toSorted()).toEqual(
      alarms.toSorted(),
    );
  });

  it("creates a feature flag profile and no stored version or deployment of it", () => {
    template.hasResourceProperties("AWS::AppConfig::ConfigurationProfile", {
      Type: "AWS.AppConfig.FeatureFlags",
      LocationUri: "hosted",
    });
    template.resourceCountIs("AWS::AppConfig::HostedConfigurationVersion", 0);
    template.resourceCountIs("AWS::AppConfig::Deployment", 0);
    template.hasResourceProperties("AWS::AppConfig::DeploymentStrategy", {
      GrowthType: "LINEAR",
      GrowthFactor: 20,
      DeploymentDurationInMinutes: 5,
      FinalBakeTimeInMinutes: 5,
    });
  });

  it("runs the pinned AppConfig extension next to the function and tells it what to prefetch", () => {
    const [fn] = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(fn?.["Properties"].Layers).toEqual([APPCONFIG_EXTENSION_ARN]);
    expect(APPCONFIG_EXTENSION_ARN).toMatch(
      /^arn:aws:lambda:ap-northeast-1:\d{12}:layer:[\w-]+:\d+$/,
    );
    expect(fn?.["Properties"]).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
    expect(fn?.["Properties"].Timeout).toBeLessThan(30);
    const variables = fn?.["Properties"].Environment.Variables as Record<string, unknown>;
    expect(Object.keys(variables).toSorted()).toEqual([
      "ALLOWED_ORIGIN",
      "AWS_APPCONFIG_EXTENSION_PREFETCH_LIST",
      "FAULT_PERCENT",
      "FLAGS_APPLICATION",
      "FLAGS_ENVIRONMENT",
      "FLAGS_PROFILE",
      "LOG_LEVEL",
      "STAGE",
    ]);
    expect(variables["FAULT_PERCENT"]).toBe("0");
  });

  it("throttles the public API and exposes exactly the routes the application answers", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
      RouteSettings: Match.absent(),
    });
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => route["Properties"].RouteKey as string)
      .toSorted();
    expect(routes).toEqual([
      "DELETE /notes/{id}",
      "GET /health",
      "GET /notes",
      "GET /notes/{id}",
      "GET /stats",
      "POST /notes",
    ]);
  });

  it("deletes the logs with the stack and keeps them a week", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      // Through the Cloud Control API: the pinned cdkd has no provider of its own for AppConfig.
      "AWS::AppConfig::Application",
      "AWS::AppConfig::ConfigurationProfile",
      "AWS::AppConfig::DeploymentStrategy",
      "AWS::AppConfig::Environment",
      "AWS::CloudWatch::Alarm",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      // Also through the Cloud Control API.
      "AWS::Lambda::Alias",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Version",
      "AWS::Logs::LogGroup",
    ]);
  });

  it("has no update policy: nothing in the template asks anyone to shift traffic", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { UpdatePolicy?: unknown }>;
    expect(
      Object.values(resources).filter((resource) => resource.UpdatePolicy !== undefined),
    ).toEqual([]);
  });
});
