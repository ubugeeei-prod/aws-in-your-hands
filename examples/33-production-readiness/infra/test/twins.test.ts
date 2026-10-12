import { readFileSync } from "node:fs";

import { App, Aspects } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { ObservabilityStack } from "@aih/example-19-observability/infra/lib/observability-stack.ts";
import { jsonEntries } from "@aih/example-21-security/src/json-object.ts";

import { checkTemplate, passes, waiverSchema } from "../../src/check.ts";
import { LOG_RETENTION, ProductionSettings } from "../lib/production-settings.ts";

const waivers = new Map(
  v.parse(
    jsonEntries(v.array(waiverSchema)),
    JSON.parse(readFileSync(new URL("../../readiness/waivers.json", import.meta.url), "utf8")),
  ),
);

const stack = (id: string, alarmEmail?: string) =>
  new ObservabilityStack(new App(), id, {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "https://notes.example.com",
    alarmEmail,
  });

// Synthesized once each: every synth bundles the function with esbuild.
const practice = Template.fromStack(stack("AihReadyPractice"));
const hardened = stack("AihReadyProduction", "oncall@example.com");
Aspects.of(hardened).add(new ProductionSettings());
const production = Template.fromStack(hardened);

const types = (template: Template) =>
  Object.values(template.toJSON().Resources as Record<string, { Type: string }>)
    .map((resource) => resource.Type)
    .toSorted();

describe("the practice twin", () => {
  it("has exactly the findings chapter 19 left for production", () => {
    const { findings } = checkTemplate(practice.toJSON());
    expect(
      findings.map((finding) => `${finding.rule} ${finding.resource.replace(/[0-9A-F]{8}$/, "")}`),
    ).toEqual([
      "iam-wildcard HandlerRoleDefaultPolicy",
      "iam-wildcard HandlerRoleDefaultPolicy",
      "table-pitr Notes",
      "stateful-delete Notes",
      "stateful-delete HandlerLogs",
      "alarm-recipient MonitoringServerErrorRate",
      "alarm-recipient MonitoringSlowResponses",
    ]);
  });
});

describe("the production twin", () => {
  it("passes the check, with two waivers that are both in use", () => {
    const result = checkTemplate(production.toJSON(), waivers.get("AihReadyProduction"));
    expect(result.findings).toEqual([]);
    expect(result.unusedWaivers).toEqual([]);
    expect(result.waived.map((entry) => entry.finding.detail)).toEqual([
      'wildcard-resource: xray:PutTraceSegments on Resource "*"',
      'wildcard-resource: xray:PutTelemetryRecords on Resource "*"',
    ]);
    expect(passes(result)).toBe(true);
  });

  it("does not pass without them", () => {
    expect(passes(checkTemplate(production.toJSON()))).toBe(false);
  });

  it("keeps the table and its past", () => {
    production.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        DeletionProtectionEnabled: true,
      },
    });
  });

  it("keeps the logs, for a stated time", () => {
    production.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: { RetentionInDays: LOG_RETENTION },
    });
    expect(LOG_RETENTION).toBe(90);
  });

  it("adds nothing but the subscription: the settings change resources, they do not add any", () => {
    const added = [...types(production)];
    for (const type of types(practice)) {
      added.splice(added.indexOf(type), 1);
    }
    expect(added).toEqual(["AWS::SNS::Subscription"]);
  });

  it("names no account", () => {
    expect(JSON.stringify(production.toJSON())).not.toMatch(/\b\d{12}\b/);
  });
});

describe("the aspect", () => {
  it("reaches a table added to the stack after it was applied", () => {
    const late = stack("Late", "oncall@example.com");
    Aspects.of(late).add(new ProductionSettings());
    new dynamodb.Table(late, "Tags", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
    });
    const result = checkTemplate(Template.fromStack(late).toJSON());
    expect(result.findings.filter((finding) => finding.rule !== "iam-wildcard")).toEqual([]);
    Template.fromStack(late).resourcePropertiesCountIs(
      "AWS::DynamoDB::Table",
      { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } },
      2,
    );
  });
});
