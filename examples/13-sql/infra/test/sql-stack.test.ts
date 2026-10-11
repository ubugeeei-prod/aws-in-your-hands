import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { SqlStack } from "../lib/sql-stack.ts";

// Synthesis bundles the handler with esbuild, so it runs once for the file.
const template = Template.fromStack(
  new SqlStack(new App(), "AihSql", {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "https://d111.cloudfront.net",
  }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

describe("SqlStack", () => {
  it("lets the function connect as a custom database role to its own cluster, and nothing more", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    const actions = statements.flatMap((statement) => statement.Action).toSorted();

    // dsql:DbConnectAdmin would let the function log in as `admin` and change the schema.
    expect(actions).toEqual(["dsql:DbConnect", "logs:CreateLogStream", "logs:PutLogEvents"]);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
    const connect = statements.find((statement) => statement.Action === "dsql:DbConnect");
    expect(JSON.stringify(connect?.Resource)).toContain(':cluster/",{"Ref":"Notes"}');
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("deletes the practice cluster and the logs with the stack", () => {
    template.hasResource("AWS::DSQL::Cluster", {
      Properties: { DeletionProtectionEnabled: false },
      DeletionPolicy: "Delete",
    });
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("attaches no resource-based policy to the cluster", () => {
    // Access is then decided by identity-based IAM policies of this account alone.
    template.hasResourceProperties("AWS::DSQL::Cluster", { PolicyDocument: Match.absent() });
  });

  it("keeps the function out of a VPC and points it at the cluster it created", () => {
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(1);
    const properties = functions[0]?.["Properties"];
    expect(properties.VpcConfig).toBeUndefined();
    expect(properties.Timeout).toBeLessThan(30);
    expect(properties).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
    expect(properties.Environment.Variables).toMatchObject({
      NOTES_DB: "dsql",
      DSQL_USER: "notes_api",
      DSQL_ENDPOINT: { "Fn::Join": ["", [{ Ref: "Notes" }, ".dsql.ap-northeast-1.on.aws"]] },
    });
  });

  it("exposes exactly the routes the application implements", () => {
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => route["Properties"].RouteKey as string)
      .toSorted();
    expect(routes).toEqual([
      "DELETE /notes/{id}",
      "GET /health",
      "GET /notes",
      "GET /notes/{id}",
      "POST /notes",
      "PUT /notes/{id}",
    ]);
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      // No dedicated provider in cdkd 0.296.28: goes through Cloud Control API.
      "AWS::DSQL::Cluster",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });
});
