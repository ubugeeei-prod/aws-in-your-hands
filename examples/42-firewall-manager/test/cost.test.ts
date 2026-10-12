import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { monthlyItems, NOT_IN_THE_SUM, SMALL_ORGANIZATION } from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();
const month = (items: ReturnType<typeof monthlyItems>) =>
  calculate(
    {
      id: "test",
      chapter: "42",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items,
    },
    prices.prices,
    allowances,
  );
const line = (result: ReturnType<typeof month>, priceId: string) =>
  result.lines.find((candidate) => candidate.priceId === priceId)?.listUsd;

describe("what the two policies cost a small organization in a month", () => {
  const result = month(monthlyItems(SMALL_ORGANIZATION));

  it("is mostly the two policy fees", () => {
    expect(line(result, "fms.policy.global.wafv2")).toBe(100);
    expect(line(result, "fms.policy.apne1.sg-content-audit")).toBe(100);
    expect(result.listUsd).toBe(226.04);
  });

  it("charges the web ACLs to every account that has a distribution", () => {
    expect(line(result, "waf.global.webacl")).toBe(15);
    expect(line(result, "waf.global.rule")).toBe(6);
    expect(line(result, "waf.global.request")).toBeCloseTo(1.8, 10);
  });

  it("charges AWS Config in both Regions, the administrator account included", () => {
    expect(line(result, "config.use1.item.continuous")).toBeCloseTo(0.24, 10);
    expect(line(result, "config.item.continuous")).toBeCloseTo(2.4, 10);
    expect(line(result, "config.use1.rule.evaluation")).toBeCloseTo(0.3, 10);
    expect(line(result, "config.rule.evaluation")).toBeCloseTo(0.3, 10);
  });

  it("is the scenario the book prints", () => {
    const printed = scenarios.scenarios.find((scenario) => scenario.id === "fwm-small-org");
    expect(printed?.items).toEqual(monthlyItems(SMALL_ORGANIZATION));
  });

  it("grows with the accounts, and the policy fees do not", () => {
    const larger = month(
      monthlyItems({
        ...SMALL_ORGANIZATION,
        accountsInScope: 30,
        accountsRecorded: 31,
        accountsWithWebAcl: 30,
      }),
    );
    expect(line(larger, "fms.policy.global.wafv2")).toBe(100);
    expect(line(larger, "waf.global.webacl")).toBe(150);
    expect(larger.listUsd).toBe(454.46);
  });

  it("names what it left out instead of counting it as nothing", () => {
    expect(NOT_IN_THE_SUM.length).toBeGreaterThan(0);
    expect(NOT_IN_THE_SUM.join(" ")).toMatch(/Security Hub/);
  });

  it("refuses a price that data/pricing does not have", () => {
    expect(() => month([{ priceId: "fms.policy.nowhere", quantity: 1, basis: "" }])).toThrow(
      /unknown price/,
    );
  });
});
