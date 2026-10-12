import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  breakdown,
  costAndUsageSchema,
  costByTagArgs,
  monthToDate,
  PROJECT_TAG_KEY,
  tagValueOf,
} from "../src/cost.ts";

// The shape of the sample response in the GetCostAndUsage reference, grouped by this chapter's tag.
const response = {
  GroupDefinitions: [
    { Type: "TAG", Key: "project" },
    { Type: "DIMENSION", Key: "SERVICE" },
  ],
  ResultsByTime: [
    {
      TimePeriod: { Start: "2026-10-01", End: "2026-10-13" },
      Estimated: true,
      Total: {},
      Groups: [
        {
          Keys: ["project$aih-notes", "Amazon DynamoDB"],
          Metrics: { UnblendedCost: { Amount: "0.7150000000", Unit: "USD" } },
        },
        {
          Keys: ["project$", "Tax"],
          Metrics: { UnblendedCost: { Amount: "0.31", Unit: "USD" } },
        },
        {
          Keys: ["project$aih-notes", "AWS Lambda"],
          Metrics: { UnblendedCost: { Amount: "2.0200000000", Unit: "USD" } },
        },
        {
          Keys: ["project$", "Amazon Simple Storage Service"],
          Metrics: { UnblendedCost: { Amount: "1.19", Unit: "USD" } },
        },
      ],
    },
  ],
};

describe("the period asked for", () => {
  it("is this month up to yesterday", () => {
    expect(monthToDate(new Date("2026-10-12T15:00:00Z"))).toEqual({
      Start: "2026-10-01",
      End: "2026-10-12",
    });
  });

  it("is last month on the 1st, when this month has nothing yet", () => {
    expect(monthToDate(new Date("2026-10-01T00:30:00Z"))).toEqual({
      Start: "2026-09-01",
      End: "2026-10-01",
    });
    expect(monthToDate(new Date("2027-01-01T00:30:00Z"))).toEqual({
      Start: "2026-12-01",
      End: "2027-01-01",
    });
  });
});

describe("the command", () => {
  it("groups by the tag and then by service", () => {
    const args = costByTagArgs({ Start: "2026-10-01", End: "2026-10-12" }, PROJECT_TAG_KEY);
    expect(args.join(" ")).toBe(
      "ce get-cost-and-usage --time-period Start=2026-10-01,End=2026-10-12 " +
        "--granularity MONTHLY --metrics UnblendedCost " +
        "--group-by Type=TAG,Key=project Type=DIMENSION,Key=SERVICE",
    );
  });
});

describe("the breakdown", () => {
  const parsed = v.parse(costAndUsageSchema, response);

  it("splits the bill into what carries the tag and what does not", () => {
    const result = breakdown(parsed, PROJECT_TAG_KEY);

    expect(result.taggedUsd).toBeCloseTo(2.735, 10);
    expect(result.untaggedUsd).toBeCloseTo(1.5, 10);
    expect(result.rows.map((row) => [row.tagValue, row.service])).toEqual([
      ["aih-notes", "AWS Lambda"],
      [undefined, "Amazon Simple Storage Service"],
      ["aih-notes", "Amazon DynamoDB"],
      [undefined, "Tax"],
    ]);
  });

  it("reads a group without a value as untagged, not as an empty project", () => {
    expect(tagValueOf("project$", "project")).toBeUndefined();
    expect(tagValueOf("project$aih-notes", "project")).toBe("aih-notes");
    // A value may itself contain the separator.
    expect(tagValueOf("project$a$b", "project")).toBe("a$b");
  });

  it("refuses a response grouped by something else", () => {
    expect(() => tagValueOf("Environment$Prod", "project")).toThrow(/not a group/);
  });

  it("refuses an amount that is not a number", () => {
    const broken = structuredClone(response);
    broken.ResultsByTime[0]!.Groups[0]!.Metrics.UnblendedCost.Amount = "n/a";
    expect(v.safeParse(costAndUsageSchema, broken).success).toBe(false);
  });

  it("is empty for a month with no groups at all", () => {
    const empty = v.parse(costAndUsageSchema, {
      ResultsByTime: [{ TimePeriod: { Start: "2026-10-01", End: "2026-10-02" } }],
    });
    expect(breakdown(empty, PROJECT_TAG_KEY)).toEqual({ rows: [], taggedUsd: 0, untaggedUsd: 0 });
  });
});
