import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { AiStack, INFERENCE_TIMEOUT, MAX_OUTPUT_TOKENS } from "../lib/ai-stack.ts";
import { modelArns, type VerifiedProfileId, verifiedProfiles } from "../lib/models.ts";

// Synthesis bundles the handler with esbuild, so each stack is built once.
const synth = (profileId: VerifiedProfileId) =>
  Template.fromStack(new AiStack(new App(), "AihAi", { env: { region: "ap-northeast-1" }, profileId }));
const template = synth("jp.amazon.nova-2-lite-v1:0");

type Statement = { Effect: string; Action: string | string[]; Resource: unknown; Condition?: unknown };
const statementsOf = (stack: Template) =>
  Object.values(stack.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );

describe("AiStack", () => {
  it("lets the function write its own logs and stream from one model, nothing else", () => {
    const statements = statementsOf(template);
    expect([...new Set(statements.flatMap((statement) => statement.Action))].toSorted()).toEqual([
      "bedrock:InvokeModelWithResponseStream",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      expect(JSON.stringify(statement.Resource)).not.toMatch(/"\*"|:\*|\/\*/);
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("names the profile and the model in each destination Region, tied to that profile", () => {
    const bedrock = statementsOf(template).filter((statement) => JSON.stringify(statement.Action).includes("bedrock"));
    const text = JSON.stringify(bedrock);
    expect(bedrock).toHaveLength(2);
    expect(text).toContain(":inference-profile/jp.amazon.nova-2-lite-v1:0");
    expect(text).toContain(":bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0");
    expect(text).toContain(":bedrock:ap-northeast-3::foundation-model/amazon.nova-2-lite-v1:0");
    // The model statement applies only to calls that come through the profile.
    const onModels = bedrock.find((statement) => JSON.stringify(statement.Resource).includes("foundation-model"));
    expect(JSON.stringify(onModels?.Condition)).toContain("bedrock:InferenceProfileArn");
  });

  it("requires a signed request and grants the URL to nobody", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM", InvokeMode: "RESPONSE_STREAM" });
    // A public URL needs a resource-based policy. None is created.
    template.resourceCountIs("AWS::Lambda::Permission", 0);
  });

  it("stops the function soon after the app has given up on the model", () => {
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(1);
    const properties = functions[0]?.["Properties"];
    expect(properties).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
    expect(properties.Timeout).toBeGreaterThan(INFERENCE_TIMEOUT.toSeconds());
    expect(properties.Timeout).toBeLessThanOrEqual(60);
    expect(properties.Environment.Variables).toMatchObject({
      AI_BACKEND: "bedrock",
      BEDROCK_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
      MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
      INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
    });
  });

  it("expires logs after a week and deletes the group with the stack", () => {
    template.hasResource("AWS::Logs::LogGroup", { Properties: { RetentionInDays: 7 }, DeletionPolicy: "Delete" });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
    ]);
  });
});

describe("model ARNs", () => {
  const scope = { partition: "aws", region: "ap-northeast-1", account: "111122223333" };

  it("lists every destination Region of a geographic profile", () => {
    expect(modelArns("jp.anthropic.claude-haiku-4-5-20251001-v1:0", scope)).toEqual({
      profileArn:
        "arn:aws:bedrock:ap-northeast-1:111122223333:inference-profile/jp.anthropic.claude-haiku-4-5-20251001-v1:0",
      modelArns: [
        "arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
      ],
    });
  });

  it("uses the Region-less model ARN for a global profile", () => {
    expect(modelArns("global.amazon.nova-2-lite-v1:0", scope).modelArns).toEqual([
      "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0",
      "arn:aws:bedrock:::foundation-model/amazon.nova-2-lite-v1:0",
    ]);
  });

  it("keeps every geographic profile inside Japan", () => {
    for (const [id, profile] of Object.entries(verifiedProfiles)) {
      if (id.startsWith("jp.")) {
        expect(profile.destinations, id).toEqual(["ap-northeast-1", "ap-northeast-3"]);
      }
    }
  });
});
