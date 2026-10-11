import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { NotesStack } from "../lib/notes-stack.ts";

const template = Template.fromStack(
  new NotesStack(new App(), "AihNotes", {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "https://d111.cloudfront.net",
  }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

describe("NotesStack", () => {
  it("creates an on-demand table keyed for owner and note", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    });
  });

  it("deletes the practice table with the stack", () => {
    // If this table ever holds data worth keeping, this assertion is the place
    // that has to change first.
    template.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
  });

  it("lets the function perform five item operations on this table and nothing else in DynamoDB", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    const dynamodb = statements.filter((statement) =>
      [statement.Action].flat().some((action) => action.startsWith("dynamodb:")),
    );

    expect(dynamodb).toHaveLength(1);
    expect([dynamodb[0]?.Action].flat().toSorted()).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]);
    // The table's ARN and only that: no "*", and no index ARNs.
    expect(dynamodb[0]?.Resource).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^Notes/), "Arn"] });
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("tells the function which table to use through its environment", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { NOTES_STORE: "dynamodb", TABLE_NAME: { Ref: Match.stringLikeRegexp("^Notes") } } },
    });
  });

  it("exposes the update route", () => {
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
      (route) => route["Properties"].RouteKey as string,
    );
    expect(routes.toSorted()).toEqual([
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
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });
});
