import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { KvCacheStack } from "../lib/kv-cache-stack.ts";

// Synthesized once each: every synth bundles the function with esbuild.
const synth = (store: "dynamodb" | "valkey") =>
  Template.fromStack(
    new KvCacheStack(new App(), "AihKvCache", { env: { region: "ap-northeast-1" }, store }),
  );
const withDynamoDb = synth("dynamodb");
const withValkey = synth("valkey");

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const typesOf = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

// cdkd 0.296.28 registers a dedicated provider for each of these.
const BASE_TYPES = [
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
];

describe("KvCacheStack, default", () => {
  it("creates nothing that is billed by the hour", () => {
    expect(typesOf(withDynamoDb)).toEqual(BASE_TYPES);
    withDynamoDb.resourceCountIs("AWS::ElastiCache::ServerlessCache", 0);
    withDynamoDb.hasResourceProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST" });
  });

  it("caps what the on-demand table accepts per second, above what the throttle lets through", () => {
    withDynamoDb.hasResourceProperties("AWS::DynamoDB::Table", {
      OnDemandThroughput: { MaxWriteRequestUnits: 40, MaxReadRequestUnits: 60 },
    });
  });

  it("throttles the stage in front of every route", () => {
    withDynamoDb.resourceCountIs("AWS::ApiGatewayV2::Stage", 1);
    withDynamoDb.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
    // The Valkey variant is the same API in front of a different store.
    withValkey.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
  });

  it("turns on TTL for the attribute the stores write", () => {
    withDynamoDb.hasResourceProperties("AWS::DynamoDB::Table", {
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    });
  });

  it("deletes the table and the logs with the stack", () => {
    withDynamoDb.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    withDynamoDb.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
    withDynamoDb.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("grants four item operations on this table, logging, and nothing else", () => {
    const statements = statementsOf(withDynamoDb);
    const actions = statements.flatMap((statement) => [statement.Action].flat()).toSorted();
    expect(actions).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    const dynamodb = statements.find((statement) =>
      [statement.Action].flat().includes("dynamodb:GetItem"),
    );
    expect(dynamodb?.Resource).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^Store/), "Arn"] });
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
    }
    withDynamoDb.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("points the function at the table and keeps it out of a VPC", () => {
    withDynamoDb.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Timeout: 10,
      VpcConfig: Match.absent(),
      Environment: {
        Variables: {
          KV_STORE: "dynamodb",
          TABLE_NAME: { Ref: Match.stringLikeRegexp("^Store") },
          RATE_LIMIT: "5",
        },
      },
    });
  });

  it("exposes two GET routes and no catch-all", () => {
    const routes = Object.values(withDynamoDb.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => route["Properties"].RouteKey as string)
      .toSorted();
    expect(routes).toEqual(["GET /health", "GET /items"]);
  });
});

describe("KvCacheStack with -c store=valkey", () => {
  it("adds one serverless cache and no other kind of resource", () => {
    // No dedicated provider in cdkd 0.296.28: goes through Cloud Control API.
    expect(typesOf(withValkey)).toEqual(
      [...BASE_TYPES, "AWS::ElastiCache::ServerlessCache"].toSorted(),
    );
    withValkey.resourceCountIs("AWS::ElastiCache::ServerlessCache", 1);
  });

  it("opens the cache to the internet only behind IAM authentication", () => {
    withValkey.hasResourceProperties("AWS::ElastiCache::ServerlessCache", {
      Engine: "valkey",
      MajorEngineVersion: "9",
      ConnectionType: "public",
      // The system-managed group whose users all authenticate with IAM. A group
      // with a password user, or none at all, must never appear next to "public".
      UserGroupId: "default.iam-user-group",
      SubnetIds: Match.absent(),
      SecurityGroupIds: Match.absent(),
    });
  });

  it("caps what the cache can grow to", () => {
    withValkey.hasResourceProperties("AWS::ElastiCache::ServerlessCache", {
      CacheUsageLimits: {
        DataStorage: { Maximum: 1, Unit: "GB" },
        ECPUPerSecond: { Maximum: 1000 },
      },
    });
  });

  it("leaves no cache and no snapshot behind", () => {
    withValkey.hasResource("AWS::ElastiCache::ServerlessCache", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    withValkey.hasResourceProperties("AWS::ElastiCache::ServerlessCache", {
      FinalSnapshotName: Match.absent(),
      SnapshotRetentionLimit: Match.absent(),
    });
  });

  it("lets the function connect to this cache as the IAM user, and to nothing else in ElastiCache", () => {
    const statements = statementsOf(withValkey);
    const elasticache = statements.filter((statement) =>
      [statement.Action].flat().some((action) => action.startsWith("elasticache:")),
    );
    expect(elasticache).toHaveLength(1);
    expect(elasticache[0]?.Action).toBe("elasticache:Connect");
    expect(elasticache[0]?.Resource).toEqual([
      { "Fn::GetAtt": [expect.stringMatching(/^Valkey/), "ARN"] },
      {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            ":elasticache:ap-northeast-1:",
            { Ref: "AWS::AccountId" },
            ":user:default.iam-user",
          ],
        ],
      },
    ]);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
    }
  });

  it("tells the function where the cache is and who to be", () => {
    withValkey.hasResourceProperties("AWS::Lambda::Function", {
      VpcConfig: Match.absent(),
      Environment: {
        Variables: {
          KV_STORE: "elasticache",
          VALKEY_ENDPOINT: {
            "Fn::GetAtt": [Match.stringLikeRegexp("^Valkey"), "Endpoint.Address"],
          },
          VALKEY_PORT: { "Fn::GetAtt": [Match.stringLikeRegexp("^Valkey"), "Endpoint.Port"] },
          VALKEY_CACHE_NAME: "aih-kv-cache",
          VALKEY_USER: "default.iam-user",
        },
      },
    });
  });
});
