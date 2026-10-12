import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import {
  breakEvenMinutes,
  HOSTED_USD_PER_MINUTE,
  hostedUsd,
  idleItems,
  jobItems,
  type PriceItem,
} from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const total = (id: string) => calculate(scenario(id), prices.prices, allowances);
const cost = (items: PriceItem[]) =>
  calculate(
    {
      id: "test",
      chapter: "62",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items,
    },
    prices.prices,
    allowances,
  );
const exact = (items: PriceItem[]): number =>
  cost(items).lines.reduce((sum, line) => sum + line.listUsd, 0);

// The chapter quotes these numbers. If a price or an assumption changes, the prose must change with it.
describe("what the chapter says the runners cost", () => {
  it("is 0.81 a month with no job, 0.80 of it the two secrets", () => {
    const recorded = scenario("ci-runners-idle").items;
    expect(recorded.map((item) => [item.priceId, item.quantity])).toEqual(
      idleItems(730).map((item) => [item.priceId, item.quantity]),
    );
    expect(total("ci-runners-idle").listUsd).toBe(0.81);
    expect(total("ci-runners-idle").afterAllowanceUsd).toBe(0.8);
  });

  it("is about 0.0020 for a minute of a task", () => {
    expect(exact(jobItems(1, 1))).toBeCloseTo(0.002021, 6);
  });

  it("bills at least a minute, however short the task", () => {
    expect(exact(jobItems(1, 0.2))).toBe(exact(jobItems(1, 1)));
  });

  it("is 12.13 for 1,000 jobs of six task-minutes, against 25.00 and 30.00 on GitHub's runners", () => {
    const recorded = scenario("ci-runners-1000-jobs").items.slice(0, 3);
    expect(recorded.map((item) => [item.priceId, item.quantity])).toEqual(
      jobItems(1000, 6).map((item) => [item.priceId, item.quantity]),
    );
    expect(cost(jobItems(1000, 6)).listUsd).toBe(12.13);
    // With the receiver, the claims and the secret reads.
    expect(total("ci-runners-1000-jobs").listUsd).toBe(12.16);
    expect(total("ci-runners-1000-jobs").afterAllowanceUsd).toBe(12.15);
    expect(hostedUsd(1000, 5, HOSTED_USD_PER_MINUTE.linuxArm64)).toBe(25);
    expect(hostedUsd(1000, 5, HOSTED_USD_PER_MINUTE.linuxX64)).toBe(30);
  });

  it("is 25.50 for the same jobs on CodeBuild's smallest Arm type, 25.08 after its free minutes", () => {
    expect(total("ci-runners-codebuild-1000-jobs").listUsd).toBe(25.5);
    expect(total("ci-runners-codebuild-1000-jobs").afterAllowanceUsd).toBe(25.08);
  });

  it("is 242.52 for 20,000 jobs, against 500.00", () => {
    expect(cost(jobItems(20000, 6)).listUsd).toBe(242.52);
    expect(hostedUsd(20000, 5, HOSTED_USD_PER_MINUTE.linuxArm64)).toBe(500);
  });

  it("rounds a hosted job up to whole minutes", () => {
    expect(hostedUsd(1, 0.1, HOSTED_USD_PER_MINUTE.linuxArm64)).toBe(0.005);
  });

  it("pays off above 5,826 minutes a month on a plan that includes 3,000", () => {
    // Six task-minutes for five minutes of job.
    const own = exact(jobItems(1, 6)) / 5;
    expect(own).toBeCloseTo(0.002425, 6);
    expect(breakEvenMinutes(3000, HOSTED_USD_PER_MINUTE.linuxArm64, own)).toBe(5826);
    expect(breakEvenMinutes(0, HOSTED_USD_PER_MINUTE.linuxArm64, own)).toBe(0);
  });

  it("leaves a fifth of a cent a minute if the announced charge alone were added", () => {
    const own = exact(jobItems(1, 6)) / 5 + 0.002;
    expect(HOSTED_USD_PER_MINUTE.linuxArm64 - own).toBeCloseTo(0.000575, 6);
  });
});
