import { readFileSync } from "node:fs";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  checkTemplate,
  fromIamExceptions,
  passes,
  type Waiver,
  waiverSchema,
} from "../src/check.ts";
import { render, verdict } from "../src/report.ts";
import { RULE_IDS } from "../src/rules/rule.ts";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.template.json`, import.meta.url), "utf8"));
const ready = fixture("ready");
const unready = fixture("unready");

const REASON = "Looked at on 2026-10-12 and kept on purpose.";

describe("the two fixtures", () => {
  it("finds nothing in the ready template", () => {
    const result = checkTemplate(ready);
    expect(result.findings).toEqual([]);
    expect(passes(result)).toBe(true);
  });

  it("finds something for every rule in the unready template", () => {
    const rules = new Set(checkTemplate(unready).findings.map((finding) => finding.rule));
    expect([...rules].toSorted()).toEqual([...RULE_IDS].toSorted());
  });

  it("has every kind of resource the rules read in the ready template too", () => {
    // Otherwise "nothing found" could mean "nothing to look at".
    const types = (template: unknown) =>
      new Set(
        Object.values((template as { Resources: Record<string, { Type: string }> }).Resources).map(
          (resource) => resource.Type,
        ),
      );
    expect([...types(unready)].filter((type) => !types(ready).has(type))).toEqual([]);
  });
});

describe("waivers", () => {
  const pitr: Waiver = { rule: "table-pitr", resource: "Notes", reason: REASON };

  it("moves a finding to the waived list, with its reason", () => {
    const result = checkTemplate(unready, [pitr]);
    expect(result.findings.some((finding) => finding.rule === "table-pitr")).toBe(false);
    expect(result.waived).toEqual([
      {
        finding: {
          rule: "table-pitr",
          resource: "Notes",
          detail: "point-in-time recovery is not enabled",
        },
        reason: REASON,
      },
    ]);
  });

  it("waives only the resource it names", () => {
    const result = checkTemplate(unready, [
      { rule: "stateful-delete", resource: "HandlerLogs", reason: REASON },
    ]);
    expect(
      result.findings
        .filter((finding) => finding.rule === "stateful-delete")
        .map((f) => f.resource),
    ).toEqual(["Uploads", "Notes"]);
  });

  it("waives only the detail it names", () => {
    const result = checkTemplate(unready, [
      {
        rule: "bucket-public",
        resource: "Uploads",
        detail: "PublicAccessBlockConfiguration.BlockPublicPolicy is not true",
        reason: REASON,
      },
    ]);
    expect(
      result.findings.filter((finding) => finding.rule === "bucket-public").map((f) => f.detail),
    ).toEqual([
      "PublicAccessBlockConfiguration.RestrictPublicBuckets is not true",
      "allows s3:GetObject to everyone, with no condition",
    ]);
  });

  it("fails a stack over a waiver that matches nothing", () => {
    const result = checkTemplate(ready, [pitr]);
    expect(result.findings).toEqual([]);
    expect(result.unusedWaivers).toEqual([pitr]);
    expect(passes(result)).toBe(false);
  });

  it.each([
    ["no reason", { rule: "table-pitr", resource: "Notes" }],
    ["a reason too short to be one", { rule: "table-pitr", resource: "Notes", reason: "practice" }],
    ["a reason of spaces", { rule: "table-pitr", resource: "Notes", reason: " ".repeat(40) }],
    ["neither a resource nor a detail", { rule: "table-pitr", reason: REASON }],
    ["a wildcard for the resource", { rule: "table-pitr", resource: "*", reason: REASON }],
    ["a rule that does not exist", { rule: "everything", resource: "Notes", reason: REASON }],
    [
      "a key it does not know",
      { rule: "table-pitr", resource: "Notes", reason: REASON, until: "2027" },
    ],
  ])("refuses a waiver with %s", (_name, waiver) => {
    expect(v.safeParse(waiverSchema, waiver).success).toBe(false);
    expect(() => checkTemplate(ready, [waiver as Waiver])).toThrow();
  });

  it('takes chapter 21\'s exceptions as waivers for exactly that action on "*"', () => {
    const template = {
      Resources: {
        Role: {
          Type: "AWS::IAM::Role",
          Properties: {
            AssumeRolePolicyDocument: {
              Statement: [
                {
                  Effect: "Allow",
                  Principal: { Service: "lambda.amazonaws.com" },
                  Action: "sts:AssumeRole",
                },
              ],
            },
            Policies: [
              {
                PolicyName: "p",
                PolicyDocument: {
                  Statement: [
                    {
                      Effect: "Allow",
                      Action: ["xray:PutTraceSegments", "s3:GetObject", "xray:*"],
                      Resource: "*",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    const waivers = fromIamExceptions([
      {
        action: "xray:PutTraceSegments",
        reason: "The AWS service reference lists no resource type for it.",
      },
    ]);
    const result = checkTemplate(template, waivers);
    expect(result.waived).toHaveLength(1);
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      "wildcard-action: xray:*",
      'wildcard-resource: s3:GetObject on Resource "*"',
      'wildcard-resource: xray:* on Resource "*"',
    ]);
  });
});

describe("the verdict", () => {
  const stacks = [
    { stack: "Ready", gated: true, result: checkTemplate(ready) },
    { stack: "Practice", gated: false, result: checkTemplate(unready) },
  ];

  it("lets a reported stack have findings without failing the run", () => {
    const summary = verdict(stacks, ["Ready"]);
    expect(summary.failedGates).toEqual([]);
    expect(summary.findings).toBe(17);
    expect(summary.byRule["stateful-delete"]).toBe(3);
  });

  it("fails a gated stack that has a finding", () => {
    const gated = stacks.map((entry) => ({ ...entry, gated: true }));
    expect(verdict(gated, ["Ready", "Practice"]).failedGates).toEqual(["Practice"]);
  });

  it("fails a gate whose template was never read", () => {
    expect(verdict(stacks, ["Ready", "Production"]).failedGates).toEqual(["Production"]);
    expect(render(stacks, ["Ready", "Production"]).at(-1)).toBe(
      "FAIL gate Production: no such template was read",
    );
  });

  it("fails a gated stack over an unused waiver, and says which", () => {
    const stale = [
      {
        stack: "Ready",
        gated: true,
        result: checkTemplate(ready, [
          { rule: "table-pitr", resource: "Notes", reason: "Looked at and kept on purpose." },
        ]),
      },
    ];
    expect(verdict(stale, ["Ready"]).failedGates).toEqual(["Ready"]);
    expect(render(stale, ["Ready"])).toContain(
      "       waiver for table-pitr Notes matches nothing; delete it",
    );
  });

  it("marks each stack by what its findings mean for the run", () => {
    const lines = render(stacks, ["Ready"]);
    expect(lines[0]).toBe("ok   Ready [gate]");
    expect(lines[1]).toBe("note Practice");
    expect(lines).toContain("2 templates, 17 findings, 0 waived");
  });
});
