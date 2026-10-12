import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { ModelingStack } from "../lib/modeling-stack.ts";

const synth = (insights = false) =>
  Template.fromStack(
    new ModelingStack(new App(), "AihModeling", { env: { region: "ap-northeast-1" }, insights }),
  );
const template = synth();

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (type: string): Statement[] =>
  Object.values(template.findResources(type)).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const actions = (statement: Statement): string[] => [statement.Action].flat();

describe("ModelingStack", () => {
  it("declares only key attributes: the table's two and the index's two", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: "gsi1pk", AttributeType: "S" },
        { AttributeName: "gsi1sk", AttributeType: "S" },
      ]),
    });
    const [table] = Object.values(template.findResources("AWS::DynamoDB::Table"));
    expect(table?.["Properties"].AttributeDefinitions).toHaveLength(4);
  });

  it("projects what a list shows into the index, and never the body", () => {
    const [table] = Object.values(template.findResources("AWS::DynamoDB::Table"));
    const indexes = (table?.["Properties"].GlobalSecondaryIndexes ?? []) as Record<
      string,
      unknown
    >[];
    const [index] = indexes;
    expect(index).toMatchObject({
      IndexName: "gsi1",
      KeySchema: [
        { AttributeName: "gsi1pk", KeyType: "HASH" },
        { AttributeName: "gsi1sk", KeyType: "RANGE" },
      ],
      Projection: {
        ProjectionType: "INCLUDE",
        NonKeyAttributes: ["id", "title", "version", "createdAt", "updatedAt", "tags"],
      },
    });
  });

  it("caps what the table and the index accept each second", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      OnDemandThroughput: { MaxReadRequestUnits: 150, MaxWriteRequestUnits: 200 },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          OnDemandThroughput: { MaxReadRequestUnits: 50, MaxWriteRequestUnits: 100 },
        }),
      ],
    });
  });

  it("streams keys only, and expires items by expiresAt", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      StreamSpecification: { StreamViewType: "KEYS_ONLY" },
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
  });

  it("deletes the practice table and queue with the stack", () => {
    // The first thing to change once the table holds data worth keeping.
    for (const type of ["AWS::DynamoDB::Table", "AWS::SQS::Queue", "AWS::Logs::LogGroup"]) {
      template.hasResource(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
  });

  it("leaves Contributor Insights off unless asked, and then watches throttled keys only", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      ContributorInsightsSpecification: Match.absent(),
    });
    synth(true).hasResourceProperties("AWS::DynamoDB::Table", {
      ContributorInsightsSpecification: { Enabled: true, Mode: "THROTTLED_KEYS" },
    });
  });

  it("gives the app item operations on the table, Query on the index, and no Scan", () => {
    const statements = statementsOf("AWS::IAM::ManagedPolicy");
    expect(statements.map((statement) => actions(statement).toSorted())).toEqual([
      [
        "dynamodb:ConditionCheckItem",
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
      ],
      ["dynamodb:Query"],
    ]);
    expect(statements[0]?.Resource).toEqual({
      "Fn::GetAtt": [expect.stringMatching(/^Notebook/), "Arn"],
    });
    expect(JSON.stringify(statements[1]?.Resource)).toContain("/index/gsi1");
  });

  it("lets the stream consumer put and update, and read this table's stream", () => {
    const statements = statementsOf("AWS::IAM::Policy");
    const onTable = statements.filter(
      (statement) =>
        JSON.stringify(statement.Resource) ===
        JSON.stringify({
          "Fn::GetAtt": [Object.keys(template.findResources("AWS::DynamoDB::Table"))[0], "Arn"],
        }),
    );
    expect(onTable.flatMap(actions).toSorted()).toEqual([
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);

    const onStream = statements.filter((statement) =>
      JSON.stringify(statement.Resource).includes("StreamArn"),
    );
    expect(onStream.flatMap(actions).toSorted()).toEqual([
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
    ]);
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("uses `*` for ListStreams, which has no resource to name, and for nothing else", () => {
    const wide = [
      ...statementsOf("AWS::IAM::Policy"),
      ...statementsOf("AWS::IAM::ManagedPolicy"),
    ].filter((statement) => JSON.stringify(statement.Resource).includes('"*"'));
    expect(wide.map(actions)).toEqual([["dynamodb:ListStreams"]]);
    for (const statement of [
      ...statementsOf("AWS::IAM::Policy"),
      ...statementsOf("AWS::IAM::ManagedPolicy"),
    ]) {
      expect(actions(statement).every((action) => !action.includes("*"))).toBe(true);
    }
  });

  it("invokes the consumer for tag items only, from the oldest record", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "TRIM_HORIZON",
      BatchSize: 100,
      FilterCriteria: {
        Filters: [
          { Pattern: JSON.stringify({ dynamodb: { Keys: { sk: { S: [{ prefix: "TAG#" }] } } } }) },
        ],
      },
    });
  });

  it("bounds the retries and keeps what was given up on", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: 5,
      DestinationConfig: {
        OnFailure: {
          Destination: { "Fn::GetAtt": [Match.stringLikeRegexp("^StreamDeadLetters"), "Arn"] },
        },
      },
    });
    template.hasResourceProperties("AWS::SQS::Queue", { MessageRetentionPeriod: 1209600 });
  });

  it("refuses the dead-letter queue to anything not using TLS", () => {
    template.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("has no public endpoint", () => {
    const types = Object.values(
      template.toJSON()["Resources"] as Record<string, { Type: string }>,
    ).map((resource) => resource.Type);
    expect(
      types.filter((type) => /ApiGateway|Lambda::Url|CloudFront|ElasticLoadBalancing/.test(type)),
    ).toEqual([]);
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::DynamoDB::Table",
      "AWS::IAM::ManagedPolicy",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::EventSourceMapping",
      "AWS::Lambda::Function",
      "AWS::Logs::LogGroup",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
    ]);
  });
});
