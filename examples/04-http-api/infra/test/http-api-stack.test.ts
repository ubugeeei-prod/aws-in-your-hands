import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { HttpApiStack } from "../lib/http-api-stack.ts";

// Synthesis bundles the handler with esbuild, so it runs once for the file.
const template = Template.fromStack(
  new HttpApiStack(new App(), "AihHttpApi", {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "https://d111.cloudfront.net",
  }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

describe("HttpApiStack", () => {
  it("gives the function no permission beyond writing its own log group", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    const actions = statements.flatMap((statement) => statement.Action).toSorted();

    expect(actions).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
    // No AWS-managed policy either: AWSLambdaBasicExecutionRole would allow
    // creating log groups anywhere in the account.
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("expires logs after a week and deletes the group with the stack", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("stops the function before API Gateway stops waiting for it", () => {
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(1);
    expect(functions[0]?.["Properties"].Timeout).toBeLessThan(30);
    expect(functions[0]?.["Properties"]).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
  });

  it("exposes exactly the routes the application implements", () => {
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => route["Properties"].RouteKey as string)
      .toSorted();
    expect(routes).toEqual(["DELETE /notes/{id}", "GET /health", "GET /notes", "GET /notes/{id}", "POST /notes"]);
  });

  it("allows browser calls from the configured origin only", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: { AllowOrigins: ["https://d111.cloudfront.net"] },
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });
});
