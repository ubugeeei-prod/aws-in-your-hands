import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { CallsStack } from "../lib/calls-stack.ts";

const synth = (mediaRegion: "ap-northeast-1" | "us-west-2" = "ap-northeast-1") =>
  Template.fromStack(
    new CallsStack(new App(), "AihCalls", { env: { region: "ap-northeast-1" }, mediaRegion }),
  );

const template = synth();
const json = JSON.stringify(template.toJSON());

type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
  (policy) =>
    (policy["Properties"] as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument
      .Statement,
);
const actions = (statement: Statement) => [statement.Action].flat().toSorted();

describe("CallsStack: what the function may do in Chime", () => {
  it("uses * for CreateMeeting alone, the one action that takes no resource", () => {
    const wildcards = statements.filter((statement) => statement.Resource === "*");
    expect(wildcards.map(actions)).toEqual([["chime:CreateMeeting"]]);
    expect(json).not.toMatch(/"chime:\*"|"Action":"\*"/);
  });

  it("limits the other four calls to meetings of this account, in the Region of the API", () => {
    const onMeetings = statements.filter((statement) =>
      actions(statement).includes("chime:CreateAttendee"),
    );
    expect(onMeetings.map(actions)).toEqual([
      ["chime:CreateAttendee", "chime:DeleteAttendee", "chime:DeleteMeeting", "chime:GetMeeting"],
    ]);
    expect(onMeetings[0]?.Resource).toEqual({
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          ":chime:ap-northeast-1:",
          { Ref: "AWS::AccountId" },
          ":meeting/*",
        ],
      ],
    });
  });

  it("grants no other Chime action: no listing, no transcription, no media pipeline", () => {
    const chime = statements.flatMap(actions).filter((action) => action.startsWith("chime:"));
    expect(chime.toSorted()).toEqual([
      "chime:CreateAttendee",
      "chime:CreateMeeting",
      "chime:DeleteAttendee",
      "chime:DeleteMeeting",
      "chime:GetMeeting",
    ]);
  });

  it("gives the function its own table, its own log group, and no managed policy", () => {
    const rest = statements.filter((statement) => !actions(statement)[0]?.startsWith("chime:"));
    expect(rest.map(actions)).toEqual([
      ["logs:CreateLogStream", "logs:PutLogEvents"],
      [
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
      ],
    ]);
    expect(JSON.stringify(rest[0]?.Resource)).toMatch(/^\{"Fn::GetAtt":\["HandlerLogs/);
    expect(JSON.stringify(rest[1]?.Resource)).toMatch(/^\{"Fn::GetAtt":\["Notes/);
    expect(json).not.toContain("AWSLambdaBasicExecutionRole");
    expect(json).not.toContain("AmazonChimeSDK");
  });

  it("tells the function where the media goes, separately from where the API is called", () => {
    const elsewhere = synth("us-west-2");
    elsewhere.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ MEETINGS: "chime", MEDIA_REGION: "us-west-2" }),
      },
    });
    // The permission follows the API's Region, not the media's.
    expect(JSON.stringify(elsewhere.toJSON())).toContain(":chime:ap-northeast-1:");
  });
});

const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
  (route) =>
    route["Properties"] as {
      RouteKey: string;
      AuthorizationType?: string;
      AuthorizationScopes?: string[];
    },
);

describe("CallsStack: who can ask for a seat", () => {
  it("puts every room route behind the JWT authorizer, with a scope", () => {
    const rooms = routes.filter((route) => route.RouteKey.includes("/rooms"));
    expect(rooms.map((route) => route.RouteKey).toSorted()).toEqual([
      "DELETE /rooms/{id}",
      "DELETE /rooms/{id}/members/{sub}",
      "GET /rooms/{id}",
      "POST /rooms",
      "POST /rooms/{id}/join",
      "POST /rooms/{id}/leave",
      "PUT /rooms/{id}/members/{sub}",
    ]);
    for (const route of rooms) {
      expect(route.AuthorizationType, route.RouteKey).toBe("JWT");
      expect(route.AuthorizationScopes, route.RouteKey).toEqual(["openid"]);
    }
  });

  it("leaves only /health open, and has no catch-all route", () => {
    expect(
      routes.filter((route) => route.AuthorizationType !== "JWT").map((route) => route.RouteKey),
    ).toEqual(["GET /health"]);
    expect(routes.map((route) => route.RouteKey)).not.toContain("$default");
  });

  it("accepts tokens of this user pool and this client only", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
      JwtConfiguration: {
        Audience: [{ Ref: Match.stringLikeRegexp("^UsersSpa") }],
        Issuer: {
          "Fn::Join": [
            "",
            [
              "https://cognito-idp.ap-northeast-1.amazonaws.com/",
              { Ref: Match.stringLikeRegexp("^Users") },
            ],
          ],
        },
      },
    });
  });

  it("allows one browser origin and one callback, both on this machine", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({ AllowOrigins: ["http://localhost:4173"] }),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      CallbackURLs: ["http://localhost:4173/callback"],
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
    });
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it("throttles every route on the stage", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
      RouteSettings: Match.absent(),
    });
  });
});

describe("CallsStack: resources", () => {
  it("declares nothing of Chime: a meeting exists only as an API call", () => {
    expect(json).not.toMatch(/"Type":"AWS::Chime/);
  });

  it("holds nothing that is billed by the hour", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST" });
    for (const type of ["AWS::EC2::NatGateway", "AWS::ElasticLoadBalancingV2::LoadBalancer"]) {
      template.resourceCountIs(type, 0);
    }
    // No provisioned concurrency either.
    template.resourceCountIs("AWS::Lambda::Alias", 0);
  });

  it("is deleted with the stack: users, table and logs", () => {
    for (const type of ["AWS::Cognito::UserPool", "AWS::DynamoDB::Table", "AWS::Logs::LogGroup"]) {
      for (const resource of Object.values(template.findResources(type))) {
        expect(resource["DeletionPolicy"], type).toBe("Delete");
      }
    }
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("uses only resource types looked up in the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Authorizer",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::Cognito::UserPool",
      // No dedicated cdkd provider (Cloud Control API): UserPoolClient, UserPoolDomain.
      "AWS::Cognito::UserPoolClient",
      "AWS::Cognito::UserPoolDomain",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });
});
