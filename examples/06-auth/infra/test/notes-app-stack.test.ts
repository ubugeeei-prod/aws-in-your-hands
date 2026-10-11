import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { NotesAppStack } from "../lib/notes-app-stack.ts";

const template = Template.fromStack(new NotesAppStack(new App(), "AihNotesApp", { env: { region: "ap-northeast-1" } }));

const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
  (route) => route["Properties"] as { RouteKey: string; AuthorizationType?: string; AuthorizationScopes?: string[] },
);

describe("NotesAppStack: who can call the API", () => {
  it("puts the JWT authorizer in front of every route except the health check", () => {
    const open = routes.filter((route) => route.AuthorizationType !== "JWT").map((route) => route.RouteKey);
    expect(open).toEqual(["GET /health"]);
    expect(routes).toHaveLength(7);
  });

  it("requires a scope on every protected route, which an ID token does not carry", () => {
    for (const route of routes.filter((candidate) => candidate.AuthorizationType === "JWT")) {
      expect(route.AuthorizationScopes, route.RouteKey).toEqual(["openid"]);
    }
  });

  it("accepts tokens from this user pool, issued to this app client, and from nowhere else", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
      JwtConfiguration: {
        Audience: [{ Ref: Match.stringLikeRegexp("^UsersSpa") }],
        Issuer: {
          "Fn::Join": [
            "",
            ["https://cognito-idp.ap-northeast-1.amazonaws.com/", { Ref: Match.stringLikeRegexp("^Users") }],
          ],
        },
      },
    });
  });

  it("allows browser calls from the deployed SPA and the local dev server only", () => {
    const api = Object.values(template.findResources("AWS::ApiGatewayV2::Api"))[0]?.["Properties"] as {
      CorsConfiguration: { AllowOrigins: unknown[]; AllowHeaders: string[] };
    };
    expect(api.CorsConfiguration.AllowOrigins).toHaveLength(2);
    expect(api.CorsConfiguration.AllowOrigins).toContain("http://localhost:5173");
    expect(api.CorsConfiguration.AllowOrigins).not.toContain("*");
    expect(api.CorsConfiguration.AllowHeaders).toContain("authorization");
  });
});

describe("NotesAppStack: how users sign in", () => {
  it("does not let strangers register", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it("registers the SPA as a public client: no secret, authorization code only, no implicit grant", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid"],
      AllowedOAuthFlowsUserPoolClient: true,
    });
  });

  it("offers no direct password API, so the only way in is the redirect to managed login", () => {
    const client = Object.values(template.findResources("AWS::Cognito::UserPoolClient"))[0]?.["Properties"] as {
      ExplicitAuthFlows?: string[];
    };
    expect((client.ExplicitAuthFlows ?? []).filter((flow) => flow !== "ALLOW_REFRESH_TOKEN_AUTH")).toEqual([]);
  });

  it("redirects back only to the SPA's own callback paths", () => {
    const client = Object.values(template.findResources("AWS::Cognito::UserPoolClient"))[0]?.["Properties"] as {
      CallbackURLs: unknown[];
    };
    expect(client.CallbackURLs).toHaveLength(2);
    expect(client.CallbackURLs).toContain("http://localhost:5173/callback");
    expect(JSON.stringify(client.CallbackURLs)).toContain("/callback");
  });

  it("keeps access tokens short-lived", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AccessTokenValidity: 60,
      TokenValidityUnits: Match.objectLike({ AccessToken: "minutes" }),
      EnableTokenRevocation: true,
    });
  });
});

describe("NotesAppStack: resources", () => {
  it("tells the function which app client its callers must have used", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ USER_POOL_CLIENT_ID: { Ref: Match.stringLikeRegexp("^UsersSpa") } }),
      },
    });
  });

  it("uses only resource types that were looked up in the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Authorizer",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::Function",
      "AWS::CloudFront::OriginAccessControl",
      // Not a dedicated cdkd provider: these two go through Cloud Control API.
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
