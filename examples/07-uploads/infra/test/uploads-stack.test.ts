import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { UploadsStack } from "../lib/uploads-stack.ts";

const template = Template.fromStack(
  new UploadsStack(new App(), "AihUploads", { env: { region: "ap-northeast-1" } }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type Bucket = { Properties: Record<string, unknown>; DeletionPolicy: string };

const buckets = template.findResources("AWS::S3::Bucket") as Record<string, Bucket>;
const uploads = Object.entries(buckets).find(([id]) => id.startsWith("Uploads"))?.[1];
const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
  (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
);
const s3Statements = statements.filter((statement) =>
  [statement.Action].flat().some((action) => action.startsWith("s3:")),
);

describe("UploadsStack: the uploads bucket", () => {
  it("blocks every kind of public access, on both buckets", () => {
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties["PublicAccessBlockConfiguration"]).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties["OwnershipControls"]).toEqual({
        Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
      });
    }
  });

  it("has no bucket policy that lets anyone read uploads", () => {
    const policies = Object.values(template.findResources("AWS::S3::BucketPolicy")).filter(
      (policy) => JSON.stringify(policy["Properties"].Bucket).includes("Uploads"),
    );
    // One policy: the TLS-only deny that `enforceSSL` adds. No Allow at all.
    expect(policies).toHaveLength(1);
    const statements = (policies[0]?.["Properties"].PolicyDocument.Statement ?? []) as Statement[];
    const effects = statements.map((statement) => statement.Effect);
    expect(effects).toEqual(["Deny"]);
  });

  it("allows cross-origin POST from two origins, and nothing else", () => {
    expect(uploads?.Properties["CorsConfiguration"]).toEqual({
      CorsRules: [
        {
          AllowedMethods: ["POST"],
          AllowedOrigins: [expect.anything(), "http://localhost:5173"],
          MaxAge: 3600,
        },
      ],
    });
    expect(JSON.stringify(uploads?.Properties["CorsConfiguration"])).not.toContain('"*"');
  });

  it("expires uploads still tagged pending after a day, and aborts stale multipart uploads", () => {
    expect(uploads?.Properties["LifecycleConfiguration"]).toEqual({
      Rules: [
        {
          Id: "expire-unfinished-uploads",
          Status: "Enabled",
          ExpirationInDays: 1,
          TagFilters: [{ Key: "upload-state", Value: "pending" }],
        },
        {
          Id: "abort-incomplete-multipart-uploads",
          Status: "Enabled",
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        },
      ],
    });
  });

  it("is deleted with the stack", () => {
    // The first thing to change once the bucket holds images worth keeping.
    expect(uploads?.DeletionPolicy).toBe("Delete");
    template.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Delete" });
  });
});

describe("UploadsStack: what the function may do", () => {
  it("reads, writes, tags, and deletes objects under u/ only", () => {
    const objects = s3Statements.find((statement) =>
      [statement.Action].flat().includes("s3:PutObject"),
    );
    expect([objects?.Action].flat().toSorted()).toEqual([
      "s3:DeleteObject",
      "s3:DeleteObjectTagging",
      "s3:GetObject",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]);
    expect(objects?.Resource).toEqual({
      "Fn::Join": ["", [{ "Fn::GetAtt": [expect.stringMatching(/^Uploads/), "Arn"] }, "/u/*"]],
    });
  });

  it("may look up the uploads bucket, and has no other S3 permission", () => {
    expect(s3Statements).toHaveLength(2);
    const list = s3Statements.find((statement) => statement.Action === "s3:ListBucket");
    expect(list?.Resource).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^Uploads/), "Arn"] });
  });

  it("uses no wildcard action, no wildcard resource, and no managed policy", () => {
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
      for (const action of [statement.Action].flat()) {
        expect(action).not.toContain("*");
      }
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("is told which bucket to sign for", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          UPLOADS_STORE: "s3",
          UPLOADS_BUCKET: { Ref: Match.stringLikeRegexp("^Uploads") },
        }),
      },
    });
  });
});

describe("UploadsStack: routes", () => {
  const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
    (route) =>
      route["Properties"] as {
        RouteKey: string;
        AuthorizationType?: string;
        AuthorizationScopes?: string[];
      },
  );

  it("protects every route except /health, the new ones included", () => {
    expect(
      routes.filter((route) => route.AuthorizationType !== "JWT").map((route) => route.RouteKey),
    ).toEqual(["GET /health"]);
    expect(
      routes
        .map((route) => route.RouteKey)
        .filter((key) => key.includes("attachments"))
        .toSorted(),
    ).toEqual([
      "DELETE /notes/{id}/attachments/{attachmentId}",
      "GET /notes/{id}/attachments",
      "POST /notes/{id}/attachments",
      "PUT /notes/{id}/attachments/{attachmentId}",
    ]);
    for (const route of routes.filter((candidate) => candidate.AuthorizationType === "JWT")) {
      expect(route.AuthorizationScopes, route.RouteKey).toEqual(["openid"]);
    }
  });

  it("uses a sign-in domain of its own", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: { "Fn::Join": ["", ["aih-uploads-", { Ref: "AWS::AccountId" }]] },
    });
  });
});

describe("UploadsStack: resources", () => {
  it("uses only resource types looked up in the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    // The same nineteen types as chapter 06: the uploads bucket adds no new type.
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
