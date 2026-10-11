import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { assertNoWildcards, lintTemplate } from "../../src/iam-lint.ts";
import { parseSecurityConfig } from "../lib/config.ts";
import { SecurityStack, type SecurityStackProps } from "../lib/security-stack.ts";

const WEB_ACL =
  "arn:aws:wafv2:us-east-1:111111111111:global/webacl/AihSecurityWaf/0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9";

// Synthesized once each: every synth bundles the function with esbuild.
const synth = (props: Pick<SecurityStackProps, "webAclArn" | "customerManagedKey">) =>
  Template.fromStack(
    new SecurityStack(new App({ analyticsReporting: false }), "AihSecurity", {
      env: { region: "ap-northeast-1" },
      ...props,
    }),
  );
const plain = synth({ customerManagedKey: false });
const withKey = synth({ customerManagedKey: true });
const withWaf = synth({ customerManagedKey: false, webAclArn: WEB_ACL });

const typesOf = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

type Statement = { Sid: string; Effect: string; Action: string | string[]; Resource: unknown; Condition?: unknown };
const handlerStatements = (template: Template): Statement[] =>
  Object.entries(template.findResources("AWS::IAM::Role"))
    .filter(([logicalId]) => logicalId.startsWith("HandlerRole"))
    .flatMap(([, role]) => role["Properties"].Policies as { PolicyDocument: { Statement: Statement[] } }[])
    .flatMap((policy) => policy.PolicyDocument.Statement);

// cdkd 0.296.28 registers a dedicated provider for each of these.
const DEFAULT_TYPES = [
  "AWS::CloudFront::Distribution",
  "AWS::CloudFront::OriginAccessControl",
  "AWS::IAM::Role",
  "AWS::Lambda::Function",
  "AWS::Lambda::Permission",
  "AWS::Lambda::Url",
  "AWS::Logs::LogGroup",
  "AWS::SecretsManager::Secret",
];

describe("AihSecurity, default", () => {
  it("creates one secret and nothing else that is billed by the month", () => {
    expect(typesOf(plain)).toEqual(DEFAULT_TYPES);
    plain.resourceCountIs("AWS::SecretsManager::Secret", 1);
    plain.resourceCountIs("AWS::KMS::Key", 0);
    plain.resourceCountIs("AWS::WAFv2::WebACL", 0);
    plain.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: { WebACLId: Match.absent() },
    });
    // No KmsKeyId: Secrets Manager uses aws/secretsmanager, which has no monthly fee.
    plain.hasResourceProperties("AWS::SecretsManager::Secret", { KmsKeyId: Match.absent() });
  });

  it("keeps the secret's value out of the template and out of the function's configuration", () => {
    plain.hasResourceProperties("AWS::SecretsManager::Secret", {
      SecretString: Match.absent(),
      GenerateSecretString: { GenerateStringKey: "key", PasswordLength: 64, ExcludePunctuation: true },
    });
    const text = JSON.stringify(plain.toJSON());
    // A dynamic reference would be resolved into the function's configuration, where lambda:GetFunction shows it.
    expect(text).not.toContain("{{resolve:");
    plain.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: { SECRET_SOURCE: "secretsmanager", SECRET_ID: { Ref: Match.stringLikeRegexp("^SigningKey") } },
      },
    });
  });

  it("lets the function read this one secret, write its own logs, and nothing else", () => {
    const statements = handlerStatements(plain);
    expect(statements.map((statement) => statement.Sid)).toEqual(["WriteOwnLogs", "ReadSigningKey"]);
    expect(statements.flatMap((statement) => statement.Action)).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "secretsmanager:GetSecretValue",
    ]);
    expect(statements[1]?.Resource).toEqual({ Ref: expect.stringMatching(/^SigningKey/) });
    plain.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
    plain.resourceCountIs("AWS::IAM::Policy", 0);
  });

  it("passes the wildcard lint with no exceptions", () => {
    expect(lintTemplate(plain.toJSON())).toEqual({ findings: [], unusedExceptions: [] });
    expect(() => assertNoWildcards(withKey.toJSON())).not.toThrow();
  });

  it("refuses unsigned calls to the function URL and admits only this distribution", () => {
    plain.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
    const permissions = Object.values(plain.findResources("AWS::Lambda::Permission")).map(
      (permission) => permission["Properties"] as { Action: string; Principal: string; SourceArn?: unknown },
    );
    expect(permissions.map((permission) => permission.Action).toSorted()).toEqual([
      "lambda:InvokeFunction",
      "lambda:InvokeFunctionUrl",
    ]);
    for (const permission of permissions) {
      expect(permission.Principal).toBe("cloudfront.amazonaws.com");
      expect(JSON.stringify(permission.SourceArn)).toContain(":distribution/");
    }
  });

  it("serves GET and HEAD over HTTPS and caches nothing", () => {
    plain.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          AllowedMethods: ["GET", "HEAD"],
          ViewerProtocolPolicy: "https-only",
          // CachingDisabled, the AWS managed cache policy.
          CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
        },
      },
    });
  });

  it("leaves nothing behind when the stack is deleted", () => {
    plain.hasResource("AWS::SecretsManager::Secret", { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    plain.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
    plain.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });
});

describe("the bundle that would be deployed", () => {
  it("loads as an ES module and answers, with the AWS SDK bundled in", async () => {
    const app = new App({ analyticsReporting: false });
    new SecurityStack(app, "AihSecurity", { env: { region: "ap-northeast-1" }, customerManagedKey: false });
    const directory = app.synth().directory;
    const asset = readdirSync(directory).find((name) => existsSync(join(directory, name, "index.mjs")));
    expect(asset).toBeDefined();

    const event = {
      version: "2.0",
      routeKey: "$default",
      rawPath: "/health",
      rawQueryString: "",
      headers: {},
      requestContext: { http: { method: "GET", path: "/health" }, domainName: "example.lambda-url.on.aws" },
      isBase64Encoded: false,
    };
    // A plain Node process, as Lambda runs it. The test runner supplies a require() that Lambda does not.
    const script = `
      const { handler } = await import(${JSON.stringify(pathToFileURL(join(directory, asset ?? "", "index.mjs")).href)});
      const response = await handler(${JSON.stringify(event)}, {});
      console.log(JSON.stringify({ statusCode: response.statusCode, body: JSON.parse(response.body) }));
    `;
    const stdout = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      // What the stack sets. Importing builds the SDK client; /health calls nothing.
      env: {
        PATH: process.env["PATH"],
        AWS_REGION: "ap-northeast-1",
        SECRET_SOURCE: "secretsmanager",
        SECRET_ID: "arn:aws:secretsmanager:ap-northeast-1:111111111111:secret:SigningKey-AbCdEf",
        STAGE: "dev",
      },
    });
    expect(JSON.parse(stdout)).toEqual({ statusCode: 200, body: { status: "ok", stage: "dev" } });
  });
});

describe("AihSecurity with -c cmk=on", () => {
  it("adds one KMS key and no other kind of resource", () => {
    expect(typesOf(withKey)).toEqual([...DEFAULT_TYPES, "AWS::KMS::Key"].toSorted());
    withKey.resourceCountIs("AWS::KMS::Key", 1);
    withKey.hasResourceProperties("AWS::SecretsManager::Secret", {
      KmsKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("^SecretKey"), "Arn"] },
    });
  });

  it("rotates the key and schedules it for deletion with the stack", () => {
    withKey.hasResource("AWS::KMS::Key", {
      Properties: { EnableKeyRotation: true, PendingWindowInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("lets the function decrypt only through Secrets Manager", () => {
    const decrypt = handlerStatements(withKey).find((statement) => statement.Sid === "DecryptThroughSecretsManager");
    expect(decrypt?.Action).toBe("kms:Decrypt");
    expect(decrypt?.Resource).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^SecretKey/), "Arn"] });
    expect(decrypt?.Condition).toEqual({
      StringEquals: { "kms:ViaService": "secretsmanager.ap-northeast-1.amazonaws.com" },
    });
  });
});

describe("AihSecurity with -c webAclArn=...", () => {
  it("attaches the web ACL to the distribution and creates none itself", () => {
    expect(typesOf(withWaf)).toEqual(DEFAULT_TYPES);
    withWaf.hasResourceProperties("AWS::CloudFront::Distribution", { DistributionConfig: { WebACLId: WEB_ACL } });
  });
});

describe("CDK context", () => {
  const context = (values: Record<string, unknown>) => (key: string) => values[key];

  it("turns every monthly fee off unless asked", () => {
    expect(parseSecurityConfig(context({}))).toEqual({ cmk: "off", wafCommonRules: "count" });
  });

  it.each([
    [
      "a REGIONAL web ACL",
      "arn:aws:wafv2:ap-northeast-1:111111111111:regional/webacl/x/0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9",
    ],
    [
      "a web ACL outside us-east-1",
      "arn:aws:wafv2:ap-northeast-1:111111111111:global/webacl/x/0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9",
    ],
    ["a WAF Classic id", "0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9"],
  ])("refuses %s", (_, webAclArn) => {
    expect(() => parseSecurityConfig(context({ webAclArn }))).toThrow("webAclArn");
  });

  it("refuses a misspelled switch instead of treating it as off", () => {
    expect(() => parseSecurityConfig(context({ cmk: "true" }))).toThrow("cmk");
  });
});
