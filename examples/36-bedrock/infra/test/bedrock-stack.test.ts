import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import type { VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";

import { modelProfiles } from "../../src/models.ts";
import {
  BedrockStack,
  DAILY_BUDGET_MICRO_USD,
  INFERENCE_TIMEOUT,
  MAX_TOTAL_TOKENS,
  MAX_TURNS,
} from "../lib/bedrock-stack.ts";
import {
  APAC_GUARDRAIL_PROFILE,
  guardrailProfileArns,
  type PromptAttackFilter,
} from "../lib/guardrail.ts";

// Synthesis bundles the handler with esbuild, so each stack is built once.
const synth = (profileId: VerifiedProfileId, promptAttackFilter: PromptAttackFilter = "off") =>
  Template.fromStack(
    new BedrockStack(new App(), "AihBedrock", {
      env: { region: "ap-northeast-1" },
      profileId,
      promptAttackFilter,
    }),
  );
const template = synth("jp.amazon.nova-2-lite-v1:0");
const filtered = synth("jp.amazon.nova-2-lite-v1:0", "standard");

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};
const statementsOf = (stack: Template) =>
  Object.values(stack.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const actionsOf = (statements: Statement[]) =>
  [...new Set(statements.flatMap((statement) => statement.Action))].toSorted();
const about = (statements: Statement[], word: string) =>
  statements.filter((statement) => JSON.stringify(statement.Action).includes(word));

describe("BedrockStack: what the function may do", () => {
  it("allows exactly these actions, each on a named resource", () => {
    const statements = statementsOf(template);
    expect(actionsOf(statements)).toEqual([
      "bedrock:ApplyGuardrail",
      "bedrock:InvokeModelWithResponseStream",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      expect(JSON.stringify(statement.Resource)).not.toMatch(/"\*"|:\*|\/\*/);
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("reaches one inference profile, and its models only by way of that profile", () => {
    const invoke = about(statementsOf(template), "InvokeModel");
    const text = JSON.stringify(invoke);
    expect(invoke).toHaveLength(2);
    expect(text).toContain(":inference-profile/jp.amazon.nova-2-lite-v1:0");
    expect(text).toContain(":bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0");
    expect(text).toContain(":bedrock:ap-northeast-3::foundation-model/amazon.nova-2-lite-v1:0");
    const onModels = invoke.find((statement) =>
      JSON.stringify(statement.Resource).includes("foundation-model"),
    );
    expect(JSON.stringify(onModels?.Condition)).toContain("bedrock:InferenceProfileArn");
    // No Converse without a stream, no batch job, no other model.
    expect(text).not.toContain('"bedrock:InvokeModel"');
  });

  it("can read notes and cannot write one, whatever the model asks for", () => {
    const onNotes = statementsOf(template).filter((statement) =>
      JSON.stringify(statement.Resource).includes("Notes"),
    );
    expect(actionsOf(onNotes)).toEqual(["dynamodb:GetItem", "dynamodb:Query"]);
    const onUsage = statementsOf(template).filter((statement) =>
      JSON.stringify(statement.Resource).includes("Usage"),
    );
    expect(actionsOf(onUsage)).toEqual(["dynamodb:GetItem", "dynamodb:UpdateItem"]);
  });

  it("may apply its own guardrail and no other", () => {
    const apply = about(statementsOf(template), "ApplyGuardrail");
    expect(apply).toHaveLength(1);
    expect(apply[0]?.Resource).toEqual({ "Fn::GetAtt": ["Guardrail", "GuardrailArn"] });
  });
});

describe("BedrockStack: the guardrail", () => {
  it("blocks credentials in questions and answers, and by default sends text nowhere else", () => {
    template.hasResourceProperties("AWS::Bedrock::Guardrail", {
      SensitiveInformationPolicyConfig: {
        PiiEntitiesConfig: [
          { Type: "AWS_ACCESS_KEY", Action: "BLOCK" },
          { Type: "AWS_SECRET_KEY", Action: "BLOCK" },
        ],
      },
      ContentPolicyConfig: Match.absent(),
      CrossRegionConfig: Match.absent(),
    });
  });

  it("hands the function a numbered version, not the draft", () => {
    template.resourceCountIs("AWS::Bedrock::GuardrailVersion", 1);
    const variables = Object.values(template.findResources("AWS::Lambda::Function"))[0]?.[
      "Properties"
    ].Environment.Variables;
    expect(variables.GUARDRAIL_ID).toEqual({ "Fn::GetAtt": ["Guardrail", "GuardrailId"] });
    expect(variables.GUARDRAIL_VERSION).toEqual({
      "Fn::GetAtt": ["GuardrailRelease", "Version"],
    });
  });

  it("with the prompt attack filter on, uses the Standard tier, a cross-Region profile, and IAM for each Region of it", () => {
    filtered.hasResourceProperties("AWS::Bedrock::Guardrail", {
      ContentPolicyConfig: {
        FiltersConfig: [{ Type: "PROMPT_ATTACK", InputStrength: "HIGH", OutputStrength: "NONE" }],
        ContentFiltersTierConfig: { TierName: "STANDARD" },
      },
      CrossRegionConfig: { GuardrailProfileArn: Match.anyValue() },
    });
    const apply = JSON.stringify(about(statementsOf(filtered), "ApplyGuardrail"));
    for (const region of APAC_GUARDRAIL_PROFILE.destinations) {
      expect(apply, region).toContain(`:bedrock:${region}:`);
    }
    expect(apply.split("guardrail-profile/apac.guardrail.v1:0").length - 1).toBe(6);
  });

  it("knows that the Standard tier's profile leaves Japan, unlike the model's", () => {
    const outside = APAC_GUARDRAIL_PROFILE.destinations.filter(
      (region) => !["ap-northeast-1", "ap-northeast-3"].includes(region),
    );
    expect(outside).toEqual(["ap-south-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2"]);
    expect(guardrailProfileArns({ partition: "aws", account: "111122223333" })[0]).toBe(
      "arn:aws:bedrock:ap-south-1:111122223333:guardrail-profile/apac.guardrail.v1:0",
    );
  });
});

describe("BedrockStack: the function", () => {
  const properties = Object.values(template.findResources("AWS::Lambda::Function"))[0]?.[
    "Properties"
  ];

  it("requires a signed request and grants the URL to nobody", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "RESPONSE_STREAM",
    });
    template.resourceCountIs("AWS::Lambda::Permission", 0);
  });

  it("learns its model from the environment, and outlives the loop's deadline by a little", () => {
    expect(properties.Timeout).toBeGreaterThan(INFERENCE_TIMEOUT.toSeconds());
    expect(properties.Timeout).toBeLessThanOrEqual(INFERENCE_TIMEOUT.toSeconds() + 15);
    expect(properties.Environment.Variables).toMatchObject({
      AI_BACKEND: "bedrock",
      BEDROCK_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
      MAX_TURNS: String(MAX_TURNS),
      MAX_TOTAL_TOKENS: String(MAX_TOTAL_TOKENS),
      DAILY_BUDGET_MICRO_USD: String(DAILY_BUDGET_MICRO_USD),
    });
  });

  it("changes model by changing one value: the same code, another profile's ARNs", () => {
    const haiku = synth("jp.anthropic.claude-haiku-4-5-20251001-v1:0");
    const variables = Object.values(haiku.findResources("AWS::Lambda::Function"))[0]?.["Properties"]
      .Environment.Variables;
    expect(variables.BEDROCK_MODEL_ID).toBe("jp.anthropic.claude-haiku-4-5-20251001-v1:0");
    const text = JSON.stringify(about(statementsOf(haiku), "InvokeModel"));
    expect(text).toContain("foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(text).not.toContain("nova");
  });

  it("sets a daily budget that can take at least one request's worst case", () => {
    for (const profile of Object.values(modelProfiles)) {
      const { input, output, cacheWrite } = profile.usdPerMillionTokens;
      expect(MAX_TOTAL_TOKENS * Math.max(input, output, cacheWrite)).toBeLessThan(
        DAILY_BUDGET_MICRO_USD,
      );
    }
  });
});

describe("BedrockStack: what is kept and what goes", () => {
  it("removes both tables and the logs with the stack, and expires usage items", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 2);
    template.allResources("AWS::DynamoDB::Table", { DeletionPolicy: "Delete" });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "owner", KeyType: "HASH" },
        { AttributeName: "day", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      BillingMode: "PAY_PER_REQUEST",
    });
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::Bedrock::Guardrail",
      "AWS::Bedrock::GuardrailVersion",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Url",
      "AWS::Logs::LogGroup",
    ]);
  });
});
