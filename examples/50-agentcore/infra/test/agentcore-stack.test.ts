import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import {
  AgentCoreStack,
  EVENT_EXPIRY_DAYS,
  IDLE_SESSION_TIMEOUT,
  MAX_SESSION_LIFETIME,
} from "../lib/agentcore-stack.ts";

const PROFILE = "jp.amazon.nova-2-lite-v1:0";

const stack = new AgentCoreStack(new App(), "TestAgentCore", {
  env: { region: "ap-northeast-1" },
  profileId: PROFILE,
});
const template = Template.fromStack(stack);
const resources = template.toJSON()["Resources"] as Record<
  string,
  { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string }
>;

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: Record<string, unknown>;
};
const propertiesOf = (type: string): Record<string, unknown>[] =>
  Object.values(resources)
    .filter((resource) => resource.Type === type)
    .map((resource) => resource.Properties ?? {});

const statements = propertiesOf("AWS::IAM::Policy").flatMap(
  (properties) => (properties["PolicyDocument"] as { Statement: Statement[] }).Statement,
);
const actionsOf = (statement: Statement) => [statement.Action].flat();

describe("the runtime", () => {
  it("runs the bundled agent as code on Node.js 22, over the HTTP contract", () => {
    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      AgentRuntimeArtifact: {
        CodeConfiguration: {
          Runtime: "NODE_22",
          EntryPoint: ["app.js"],
          Code: { S3: { Bucket: Match.anyValue(), Prefix: Match.stringLikeRegexp("\\.zip$") } },
        },
      },
      ProtocolConfiguration: "HTTP",
      NetworkConfiguration: { NetworkMode: "PUBLIC" },
    });
  });

  it("lets nobody in without a token from this stack's user pool and client", () => {
    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      AuthorizerConfiguration: {
        CustomJWTAuthorizer: {
          DiscoveryUrl: {
            "Fn::Join": [
              "",
              [
                "https://cognito-idp.ap-northeast-1.amazonaws.com/",
                { Ref: Match.stringLikeRegexp("^Users") },
                "/.well-known/openid-configuration",
              ],
            ],
          },
          AllowedClients: [{ Ref: Match.stringLikeRegexp("^UsersCli") }],
        },
      },
      // Without this the agent gets no token to read, and answers 401 to everyone.
      RequestHeaderConfiguration: { RequestHeaderAllowlist: ["Authorization"] },
    });
  });

  it("ends an idle session after minutes, not the default quarter of an hour", () => {
    expect(IDLE_SESSION_TIMEOUT.toSeconds()).toBeGreaterThanOrEqual(60);
    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: IDLE_SESSION_TIMEOUT.toSeconds(),
        MaxLifetime: MAX_SESSION_LIFETIME.toSeconds(),
      },
    });
    expect(IDLE_SESSION_TIMEOUT.toSeconds()).toBeLessThan(900);
  });

  it("tells the code the same issuer and client the authorizer checks", () => {
    const [runtime = {}] = propertiesOf("AWS::BedrockAgentCore::Runtime");
    const env = runtime["EnvironmentVariables"] as Record<string, unknown>;
    const authorizer = (
      runtime["AuthorizerConfiguration"] as {
        CustomJWTAuthorizer: { DiscoveryUrl: unknown; AllowedClients: unknown[] };
      }
    ).CustomJWTAuthorizer;
    const parts = (value: unknown) => (value as { "Fn::Join": [string, unknown[]] })["Fn::Join"][1];
    expect(env["JWT_CLIENT_ID"]).toEqual(authorizer.AllowedClients[0]);
    // The discovery URL is the issuer plus the well-known path.
    expect(parts(authorizer.DiscoveryUrl).slice(0, -1)).toEqual(parts(env["JWT_ISSUER"]));
    expect(env).toMatchObject({ AI_BACKEND: "bedrock", BEDROCK_MODEL_ID: PROFILE });
    // V1 allows 4 KB of environment variables in all.
    expect(JSON.stringify(env).length).toBeLessThan(2_000);
  });
});

describe("the execution role", () => {
  it("can be assumed only by AgentCore, for a resource of this account and Region", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "sts:AssumeRole",
            Principal: { Service: "bedrock-agentcore.amazonaws.com" },
            Condition: {
              StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
              ArnLike: { "aws:SourceArn": Match.anyValue() },
            },
          },
        ],
      },
    });
    template.resourceCountIs("AWS::IAM::Role", 1);
  });

  it("names a resource everywhere a resource can be named", () => {
    const wide = statements.filter((statement) => statement.Resource === "*");
    // PutMetricData takes no resource. Its namespace condition is what limits it.
    expect(wide).toEqual([
      {
        Effect: "Allow",
        Action: "cloudwatch:PutMetricData",
        Resource: "*",
        Condition: { StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" } },
      },
    ]);
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      for (const action of actionsOf(statement)) {
        expect(action).not.toContain("*");
      }
    }
  });

  it("reads notes and never writes one, and touches memory only through two calls", () => {
    const all = statements.flatMap(actionsOf).toSorted();
    expect(all).toEqual([
      "bedrock-agentcore:CreateEvent",
      "bedrock-agentcore:ListEvents",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:InvokeModelWithResponseStream",
      "cloudwatch:PutMetricData",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
      "s3:GetObject",
    ]);
  });

  it("calls models only by way of the one inference profile", () => {
    const bedrock = statements.filter((statement) =>
      actionsOf(statement).includes("bedrock:InvokeModelWithResponseStream"),
    );
    expect(bedrock).toHaveLength(2);
    expect(JSON.stringify(bedrock[0]?.Resource)).toContain(`inference-profile/${PROFILE}`);
    expect(bedrock[1]?.Condition).toEqual({
      StringLike: { "bedrock:InferenceProfileArn": bedrock[0]?.Resource },
    });
  });
});

describe("AgentCoreStack, as a whole", () => {
  it("keeps exchanges for a bounded time, and extracts nothing from them", () => {
    template.hasResourceProperties("AWS::BedrockAgentCore::Memory", {
      EventExpiryDuration: EVENT_EXPIRY_DAYS,
      MemoryStrategies: Match.absent(),
    });
  });

  it("has no way to sign in except through the admin API", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
    template.resourceCountIs("AWS::Cognito::UserPoolDomain", 0);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      AllowedOAuthFlows: Match.absent(),
      CallbackURLs: Match.absent(),
      GenerateSecret: false,
    });
  });

  it("deletes the practice data with the stack", () => {
    for (const type of ["AWS::DynamoDB::Table", "AWS::Cognito::UserPool"]) {
      template.hasResource(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
  });

  // #region resource-types
  // cdkd 0.296.28 has a provider of its own for AWS::BedrockAgentCore::Runtime, but that
  // provider does not write RequestHeaderConfiguration, so cdkd routes this runtime through
  // Cloud Control API. AWS::BedrockAgentCore::Memory and AWS::Cognito::UserPoolClient have no
  // provider and go the same way. The other four types have providers of their own.
  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::BedrockAgentCore::Memory",
      "AWS::BedrockAgentCore::Runtime",
      "AWS::Cognito::UserPool",
      "AWS::Cognito::UserPoolClient",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
    ]);
  });
  // #endregion resource-types

  it("names no account, and asks AWS nothing during synthesis", () => {
    expect(JSON.stringify(resources)).not.toMatch(/\d{12}/);
    expect(Object.keys(template.toJSON()["Parameters"] as object)).toEqual(["BootstrapVersion"]);
  });
});
