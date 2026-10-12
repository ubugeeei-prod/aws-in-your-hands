import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { EMBEDDING_DIMENSIONS } from "../../src/bedrock-embedder.ts";
import { INFERENCE_TIMEOUT, SearchStack, TABLE_LIMIT } from "../lib/search-stack.ts";

// Synthesis bundles both handlers with esbuild, so the stack is built once.
const template = Template.fromStack(
  new SearchStack(new App(), "AihSearch", {
    env: { region: "ap-northeast-1" },
    profileId: "jp.amazon.nova-2-lite-v1:0",
  }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type Policy = { Properties: { PolicyDocument: { Statement: Statement[] }; Roles: unknown } };

const policies = Object.values(template.findResources("AWS::IAM::Policy")) as Policy[];
const statementsFor = (role: string) =>
  policies
    .filter((policy) => JSON.stringify(policy.Properties.Roles).includes(role))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
const actionsOf = (statements: Statement[]) =>
  [...new Set(statements.flatMap((statement) => statement.Action))].toSorted();

describe("SearchStack", () => {
  it("lets the search read notes, query vectors and call two models, and write nothing", () => {
    const statements = statementsFor("SearchRole");
    expect(actionsOf(statements)).toEqual([
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "dynamodb:Query",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3vectors:GetVectors",
      "s3vectors:QueryVectors",
    ]);
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      expect(JSON.stringify(statement.Resource)).not.toMatch(/"\*"|:\*|\/\*/);
    }
  });

  it("lets the indexer read the stream and write vectors, but not read the table", () => {
    const statements = statementsFor("IndexerRole");
    expect(actionsOf(statements)).toEqual([
      "bedrock:InvokeModel",
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:ListStreams",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3vectors:DeleteVectors",
      "s3vectors:PutVectors",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:SendMessage",
    ]);
    // aws-cdk-lib grants ListStreams on every resource. Nothing else may be that wide.
    const wide = statements.filter((statement) =>
      /"\*"|:\*|\/\*/.test(JSON.stringify(statement.Resource)),
    );
    expect(wide.map((statement) => statement.Action)).toEqual(["dynamodb:ListStreams"]);
  });

  it("names one embedding model and one vector index in both roles", () => {
    const text = JSON.stringify(policies);
    expect(text).toContain("::foundation-model/amazon.titan-embed-text-v2:0");
    expect(text).toContain(":bucket/aih-search-notes/index/notes");
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("requires a signed request and grants the URL to nobody", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "RESPONSE_STREAM",
    });
    template.resourceCountIs("AWS::Lambda::Permission", 0);
  });

  it("streams both images of every change, and caps what the table accepts", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      Properties: {
        BillingMode: "PAY_PER_REQUEST",
        StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
        OnDemandThroughput: {
          MaxReadRequestUnits: TABLE_LIMIT.read,
          MaxWriteRequestUnits: TABLE_LIMIT.write,
        },
      },
      DeletionPolicy: "Delete",
    });
  });

  it("sizes the index for the embedding model and deletes it with the stack", () => {
    template.hasResource("AWS::S3Vectors::Index", {
      Properties: {
        VectorBucketName: "aih-search-notes",
        IndexName: "notes",
        DataType: "float32",
        Dimension: EMBEDDING_DIMENSIONS,
        DistanceMetric: "cosine",
      },
      DeletionPolicy: "Delete",
      DependsOn: Match.arrayWith([Match.stringLikeRegexp("Vectors")]),
    });
    template.hasResource("AWS::S3Vectors::VectorBucket", {
      Properties: { VectorBucketName: "aih-search-notes" },
      DeletionPolicy: "Delete",
    });
  });

  it("gives up on a change after three retries and keeps it in a queue", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "TRIM_HORIZON",
      BatchSize: 10,
      MaximumRetryAttempts: 3,
      BisectBatchOnFunctionError: true,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      FilterCriteria: {
        Filters: [
          { Pattern: JSON.stringify({ dynamodb: { Keys: { sk: { S: [{ prefix: "NOTE#" }] } } } }) },
        ],
      },
    });
    template.hasResource("AWS::SQS::Queue", {
      Properties: { MessageRetentionPeriod: 14 * 24 * 60 * 60 },
      DeletionPolicy: "Delete",
    });
  });

  it("stops the search function soon after the app has given up on the model", () => {
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(2);
    const search = functions.find(
      (resource) => resource["Properties"].Environment.Variables.SEARCH_BACKEND === "aws",
    );
    expect(search?.["Properties"]).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
    });
    expect(search?.["Properties"].Timeout).toBeGreaterThan(INFERENCE_TIMEOUT.toSeconds());
    expect(search?.["Properties"].Timeout).toBeLessThanOrEqual(60);
  });

  it("expires logs after a week and deletes the groups with the stack", () => {
    const groups = Object.values(template.findResources("AWS::Logs::LogGroup"));
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group["Properties"].RetentionInDays).toBe(7);
      expect(group["DeletionPolicy"]).toBe("Delete");
    }
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::EventSourceMapping",
      "AWS::Lambda::Function",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
      "AWS::S3Vectors::Index",
      "AWS::S3Vectors::VectorBucket",
      "AWS::SQS::Queue",
    ]);
  });
});
