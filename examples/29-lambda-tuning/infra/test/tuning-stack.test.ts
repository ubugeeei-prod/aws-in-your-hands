import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { overBudget } from "../../src/bundle/budget.ts";
import { buildVariant } from "../../src/bundle/build.ts";
import { DEPLOYED } from "../../src/bundle/variants.ts";
import { reservable } from "../../src/concurrency.ts";
import {
  ANSWER_MARGIN_MS,
  checkHttpChain,
  HTTP_API_INTEGRATION_SECONDS,
  SDK,
} from "../../src/timeouts.ts";
import { TABLE_CAP, THROTTLE, TuningStack, type TuningStackProps } from "../lib/tuning-stack.ts";

function synth(props: Partial<TuningStackProps> = {}) {
  const app = new App();
  const stack = new TuningStack(app, "AihLambdaTuning", {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "https://d111.cloudfront.net",
    memorySize: 256,
    ...props,
  });
  return { template: Template.fromStack(stack), directory: app.synth().directory };
}

// Synthesized once each: every synth bundles the function with esbuild.
const plain = synth();
const braked = synth({ memorySize: 512, reservedConcurrency: 5 });
const kept = synth({ reservedConcurrency: 5, provisionedConcurrency: 2 });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const types = (template: Template) => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};
const functionProperties = (template: Template) => {
  const [found] = Object.values(template.findResources("AWS::Lambda::Function"));
  return found?.["Properties"] as Record<string, unknown>;
};

describe("the bundle CDK would upload", () => {
  const assets = readdirSync(plain.directory)
    .map((name) => join(plain.directory, name, "index.mjs"))
    .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true);
  const code = readFileSync(assets[0] ?? "");

  it("is within the budget", () => {
    expect(assets).toHaveLength(1);
    expect(overBudget({ bytes: code.byteLength, gzipBytes: gzipSync(code).byteLength })).toEqual(
      [],
    );
  });

  it("is the variant that `vp run tune:bundle` measures as deployed", async () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    expect(code.byteLength).toBe((await buildVariant(DEPLOYED, root)).bytes);
  });
});

describe("the function's settings", () => {
  it("default to chapter 04's memory and take another on request", () => {
    expect(functionProperties(plain.template)).toMatchObject({
      MemorySize: 256,
      Architectures: ["arm64"],
      Runtime: "nodejs24.x",
    });
    expect(functionProperties(braked.template)).toMatchObject({ MemorySize: 512 });
  });

  it("report each invocation as JSON into a log group that expires", () => {
    plain.template.hasResourceProperties("AWS::Lambda::Function", {
      LoggingConfig: {
        LogFormat: "JSON",
        LogGroup: { Ref: Match.stringLikeRegexp("^HandlerLogs") },
      },
    });
    plain.template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("keep the timeouts in order from API Gateway down to the SDK", () => {
    const { Timeout } = functionProperties(plain.template) as { Timeout: number };
    expect(Timeout).toBeLessThan(HTTP_API_INTEGRATION_SECONDS);
    expect(
      checkHttpChain({
        callerSeconds: HTTP_API_INTEGRATION_SECONDS,
        functionSeconds: Timeout,
        answerMarginMs: ANSWER_MARGIN_MS,
        sdk: SDK,
      }),
    ).toEqual([]);
  });
});

describe("concurrency", () => {
  it("is left to the account by default: nothing reserved, nothing provisioned", () => {
    expect(functionProperties(plain.template)).not.toHaveProperty("ReservedConcurrentExecutions");
    plain.template.resourceCountIs("AWS::Lambda::Version", 0);
    plain.template.resourceCountIs("AWS::Lambda::Alias", 0);
  });

  it("is capped when a reservation is asked for", () => {
    expect(functionProperties(braked.template)).toMatchObject({ ReservedConcurrentExecutions: 5 });
    // Possible in an account at the default limit, refused in one whose limit is still 100 or less.
    expect(reservable({ limit: 1000, alreadyReserved: 0 })).toBeGreaterThanOrEqual(5);
    expect(reservable({ limit: 100, alreadyReserved: 0 })).toBe(0);
  });

  it("is provisioned on an alias, and the API calls that alias", () => {
    kept.template.resourceCountIs("AWS::Lambda::Version", 1);
    kept.template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
      ProvisionedConcurrencyConfig: { ProvisionedConcurrentExecutions: 2 },
    });
    const alias = { Ref: Match.stringLikeRegexp("^Live") };
    kept.template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      IntegrationUri: alias,
    });
    // Permission to invoke goes to the alias too. $LATEST would start cold.
    kept.template.allResourcesProperties("AWS::Lambda::Permission", { FunctionName: alias });
    plain.template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      IntegrationUri: { "Fn::GetAtt": [Match.stringLikeRegexp("^Handler"), "Arn"] },
    });
  });
});

describe("permissions and bounds", () => {
  for (const [name, subject] of [
    ["by default", plain.template],
    ["with provisioned concurrency", kept.template],
  ] as const) {
    it(`allow the table's five operations and the log group, with no wildcard, ${name}`, () => {
      const statements = Object.values(subject.findResources("AWS::IAM::Policy")).flatMap(
        (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
      );
      expect(statements.flatMap((statement) => [statement.Action].flat()).toSorted()).toEqual([
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]);
      for (const statement of statements) {
        expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
        expect(JSON.stringify(statement.Action)).not.toContain("*");
      }
      subject.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
    });
  }

  it("throttle the stage and cap the table, as chapters 05 and 19 do", () => {
    plain.template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: {
        ThrottlingRateLimit: THROTTLE.rate,
        ThrottlingBurstLimit: THROTTLE.burst,
      },
    });
    plain.template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: {
        MaxReadRequestUnits: TABLE_CAP.read,
        MaxWriteRequestUnits: TABLE_CAP.write,
      },
    });
  });

  it("delete the practice table with the stack", () => {
    plain.template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });
});

describe("the stack as a whole", () => {
  it("uses only resource types that were checked against the pinned cdkd", () => {
    const base = [
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
    expect(types(plain.template)).toEqual(base);
    expect(types(braked.template)).toEqual(base);
    expect(types(kept.template)).toEqual(
      // Cloud Control API in cdkd 0.296.28
      [...base, "AWS::Lambda::Alias", "AWS::Lambda::Version"].toSorted(),
    );
  });
});
