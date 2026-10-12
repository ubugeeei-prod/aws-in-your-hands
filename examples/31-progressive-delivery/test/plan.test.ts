import { describe, expect, it } from "vite-plus/test";

import {
  aliasAt,
  chanceOfNoSample,
  percentOf,
  planFor,
  requestsForSample,
} from "../src/shift/plan.ts";

const shares = (name: string) => planFor(name, 0).steps.map((step) => step.percent);
const holds = (name: string) => planFor(name, 0).steps.map((step) => step.holdSeconds);

describe("planFor", () => {
  // The nine predefined Lambda configurations of CodeDeploy, minus the "CodeDeployDefault.Lambda" prefix.
  it("reads the canary names as one small step and then everything", () => {
    for (const [name, wait] of [
      ["Canary10Percent5Minutes", 300],
      ["Canary10Percent10Minutes", 600],
      ["Canary10Percent15Minutes", 900],
      ["Canary10Percent30Minutes", 1800],
    ] as const) {
      expect(shares(name)).toEqual([10, 100]);
      expect(holds(name)).toEqual([wait, 0]);
    }
  });

  it("reads the linear names as equal steps that end at 100", () => {
    for (const [name, wait] of [
      ["Linear10PercentEvery1Minute", 60],
      ["Linear10PercentEvery2Minutes", 120],
      ["Linear10PercentEvery3Minutes", 180],
      ["Linear10PercentEvery10Minutes", 600],
    ] as const) {
      expect(shares(name)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
      expect(holds(name).slice(0, -1)).toEqual(Array.from({ length: 9 }, () => wait));
    }
    // An increment that does not divide 100 still ends at exactly 100.
    expect(shares("Linear30PercentEvery1Minute")).toEqual([30, 60, 90, 100]);
  });

  it("reads AllAtOnce as a single step", () => {
    expect(planFor("AllAtOnce", 120).steps).toEqual([{ percent: 100, holdSeconds: 120 }]);
  });

  it("watches the last step for the bake time", () => {
    expect(planFor("Canary10Percent5Minutes", 300).steps.at(-1)).toEqual({
      percent: 100,
      holdSeconds: 300,
    });
  });

  it("refuses a name it cannot read, a share of 0 or 100, and a wait of 0", () => {
    for (const name of [
      "Canary10Percent",
      "canary10percent5minutes",
      "Canary0Percent5Minutes",
      "Canary100Percent5Minutes",
      "Linear10PercentEvery0Minutes",
      "",
    ]) {
      expect(() => planFor(name, 0)).toThrow();
    }
    expect(() => planFor("AllAtOnce", -1)).toThrow();
    expect(() => planFor("AllAtOnce", 1.5)).toThrow();
  });
});

describe("the alias for a share", () => {
  it("keeps naming the old version until the new one has everything", () => {
    expect(aliasAt(0, "3", "4")).toEqual({ version: "3", weights: {} });
    expect(aliasAt(10, "3", "4")).toEqual({ version: "3", weights: { "4": 0.1 } });
    expect(aliasAt(100, "3", "4")).toEqual({ version: "4", weights: {} });
  });

  it("reads the share back from an alias", () => {
    for (const percent of [0, 10, 30, 90, 100]) {
      expect(percentOf(aliasAt(percent, "3", "4"), "3", "4")).toBe(percent);
    }
  });

  it("does not mistake someone else's shift for its own", () => {
    expect(percentOf({ version: "3", weights: { "5": 0.5 } }, "3", "4")).toBeUndefined();
    expect(percentOf({ version: "2", weights: {} }, "3", "4")).toBeUndefined();
  });
});

describe("how much a small share sees", () => {
  it("misses the new version entirely about one time in eight over 20 requests at 10%", () => {
    expect(chanceOfNoSample(10, 20)).toBeCloseTo(0.1216, 4);
    expect(chanceOfNoSample(10, 0)).toBe(1);
    expect(chanceOfNoSample(100, 1)).toBe(0);
  });

  it("needs 44 requests at 10% before a miss is rarer than one in a hundred", () => {
    expect(requestsForSample(10, 0.01)).toBe(44);
    expect(requestsForSample(1, 0.01)).toBe(459);
  });
});
