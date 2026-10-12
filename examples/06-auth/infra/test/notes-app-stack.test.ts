import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { NotesAppStack } from "../lib/notes-app-stack.ts";

const template = Template.fromStack(
  new NotesAppStack(new App(), "AihNotesApp", { env: { region: "ap-northeast-1" } }),
);

const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
  (route) =>
    route["Properties"] as {
      RouteKey: string;
      AuthorizationType?: string;
      AuthorizationScopes?: string[];
    },
);

describe("NotesAppStack: who can call the API", () => {
  it("protects every route except /health", () => {
    const open = routes
      .filter((route) => route.AuthorizationType !== "JWT")
      .map((route) => route.RouteKey);
    expect(open).toEqual(["GET /health"]);
    expect(routes).toHaveLength(7);
  });

  it("requires a scope on every protected route", () => {
    for (const route of routes.filter((candidate) => candidate.AuthorizationType === "JWT")) {
      expect(route.AuthorizationScopes, route.RouteKey).toEqual(["openid"]);
    }
  });

  it("accepts only this user pool and this client", () => {
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

  it("allows two CORS origins, never *", () => {
    const api = Object.values(template.findResources("AWS::ApiGatewayV2::Api"))[0]?.[
      "Properties"
    ] as {
      CorsConfiguration: { AllowOrigins: unknown[]; AllowHeaders: string[] };
    };
    expect(api.CorsConfiguration.AllowOrigins).toHaveLength(2);
    expect(api.CorsConfiguration.AllowOrigins).toContain("http://localhost:5173");
    expect(api.CorsConfiguration.AllowOrigins).not.toContain("*");
    expect(api.CorsConfiguration.AllowHeaders).toContain("authorization");
  });
});

describe("NotesAppStack: how users sign in", () => {
  it("has no self sign-up", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it("is a public client: no secret, authorization code only", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid"],
      AllowedOAuthFlowsUserPoolClient: true,
    });
  });

  it("offers no direct password flow", () => {
    const client = Object.values(template.findResources("AWS::Cognito::UserPoolClient"))[0]?.[
      "Properties"
    ] as {
      ExplicitAuthFlows?: string[];
    };
    expect(
      (client.ExplicitAuthFlows ?? []).filter((flow) => flow !== "ALLOW_REFRESH_TOKEN_AUTH"),
    ).toEqual([]);
  });

  it("has exactly two callback URLs", () => {
    const client = Object.values(template.findResources("AWS::Cognito::UserPoolClient"))[0]?.[
      "Properties"
    ] as {
      CallbackURLs: unknown[];
    };
    expect(client.CallbackURLs).toHaveLength(2);
    expect(client.CallbackURLs).toContain("http://localhost:5173/callback");
    expect(JSON.stringify(client.CallbackURLs)).toContain("/callback");
  });

  it("limits access tokens to one hour", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AccessTokenValidity: 60,
      TokenValidityUnits: Match.objectLike({ AccessToken: "minutes" }),
      EnableTokenRevocation: true,
    });
  });
});

describe("NotesAppStack: resources", () => {
  it("passes the client ID to the function", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          USER_POOL_CLIENT_ID: { Ref: Match.stringLikeRegexp("^UsersSpa") },
        }),
      },
    });
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
      "AWS::CloudFront::Distribution",
      // No dedicated cdkd provider (Cloud Control API): CloudFront::Function,
      // Cognito::UserPoolClient, Cognito::UserPoolDomain.
      "AWS::CloudFront::Function",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::Cognito::UserPool",
      "AWS::Cognito::UserPoolClient",
      "AWS::Cognito::UserPoolDomain",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
    ]);
  });
});
