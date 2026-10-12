import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { ACKNOWLEDGED_UNCHECKED_TYPES, DRIFT_CHECKED_TYPES } from "../../src/drift-coverage.ts";
import { apiStackName, type Stage, stageSchema } from "../lib/config.ts";
import { ShipApiStack, THROTTLE } from "../lib/ship-api-stack.ts";

// Synthesis bundles the handler with esbuild, so each stage is synthesized once for the file.
const synth = (stage: Stage) => {
  const stack = new ShipApiStack(new App({ analyticsReporting: false }), apiStackName(stage), {
    env: { region: "ap-northeast-1" },
    stage,
    allowedOrigin: "https://d111.cloudfront.net",
  });
  return { stack, template: Template.fromStack(stack) };
};
const dev = synth("dev");
const prod = synth("prod");
const preview = synth("pr-7").template;

const resources = (template: Template) =>
  template.toJSON()["Resources"] as Record<string, { Type: string }>;
const typesOf = (template: Template) =>
  [...new Set(Object.values(resources(template)).map((r) => r.Type))].toSorted();
const idOf = (template: Template, type: string) => Object.keys(template.findResources(type))[0];

describe("stages", () => {
  it("gives every stage its own stack name", () => {
    expect(
      ["dev", "prod", "pr-7", "pr-123"].map((stage) => apiStackName(v.parse(stageSchema, stage))),
    ).toEqual(["AihShipApi", "AihShipApiProd", "AihShipApiPr7", "AihShipApiPr123"]);
  });

  it.each(["staging", "pr-", "pr-0", "pr-12a", "pr-1; rm -rf", "PROD", ""])(
    "refuses the stage %j",
    (stage) => {
      expect(v.safeParse(stageSchema, stage).success).toBe(false);
    },
  );

  it("protects production from deletion, and keeps its logs if the stack goes anyway", () => {
    expect(prod.stack.terminationProtection).toBe(true);
    prod.template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("lets practice and preview stacks disappear completely", () => {
    expect(dev.stack.terminationProtection).toBe(false);
    dev.template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it.each(["dev", "prod", "pr-7"] as const)("throttles the public API of %s", (stage) => {
    const template = stage === "dev" ? dev.template : stage === "prod" ? prod.template : preview;
    template.resourceCountIs("AWS::ApiGatewayV2::Stage", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
    expect(THROTTLE).toEqual({ rate: 10, burst: 20 });
  });

  it("tells the function which stage it is", () => {
    prod.template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ STAGE: "prod" }) },
    });
  });
});

describe("ShipApiStack", () => {
  it("routes through the live alias, never the unpublished code", () => {
    const { template } = dev;
    const alias = idOf(template, "AWS::Lambda::Alias");
    const version = idOf(template, "AWS::Lambda::Version");
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
      FunctionVersion: { "Fn::GetAtt": [version, "Version"] },
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      IntegrationUri: { Ref: alias },
    });
    const permissions = Object.values(template.findResources("AWS::Lambda::Permission"));
    expect(permissions.length).toBeGreaterThan(0);
    for (const permission of permissions) {
      expect(permission["Properties"].FunctionName).toEqual({ Ref: alias });
    }
  });

  it("keeps replaced versions, so the alias has somewhere to go back to", () => {
    dev.template.hasResource("AWS::Lambda::Version", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("gives the function no permission beyond writing its own log group", () => {
    const { template } = dev;
    const role = Object.values(template.findResources("AWS::IAM::Role"))[0]?.["Properties"] as {
      ManagedPolicyArns?: unknown;
      Policies: { PolicyDocument: { Statement: { Action: string[]; Resource: unknown }[] } }[];
    };
    const statements = role.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
    expect(statements.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    expect(statements[0]?.Resource).toEqual({
      "Fn::GetAtt": [idOf(template, "AWS::Logs::LogGroup"), "Arn"],
    });
    expect(role.ManagedPolicyArns).toBeUndefined();
  });

  it("exposes exactly the routes the application implements", () => {
    const routes = Object.values(dev.template.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => route["Properties"].RouteKey as string)
      .toSorted();
    expect(routes).toEqual([
      "DELETE /notes/{id}",
      "GET /health",
      "GET /notes",
      "GET /notes/{id}",
      "POST /notes",
    ]);
  });

  it("uses only resource types whose drift coverage has been decided", () => {
    expect(typesOf(dev.template)).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::IAM::Role",
      "AWS::Lambda::Alias",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Version",
      "AWS::Logs::LogGroup",
    ]);
    expect(typesOf(prod.template)).toEqual(typesOf(dev.template));
    // A new type has to be placed in one list or the other before this passes.
    expect([...DRIFT_CHECKED_TYPES, ...ACKNOWLEDGED_UNCHECKED_TYPES].toSorted()).toEqual(
      typesOf(dev.template),
    );
  });

  it("is deployable through the CDK bootstrap roles", () => {
    // The default synthesizer adds this parameter. cdk deploy reads it to check the bootstrap stack.
    expect(dev.template.toJSON()["Parameters"]).toHaveProperty("BootstrapVersion");
  });
});
