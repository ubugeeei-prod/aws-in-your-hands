import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { billItems, SHAPE } from "../src/bill.ts";
import { total } from "../src/flood.ts";
import { MONTH_OPEN, RUNS } from "../src/runs.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const listUsd = (id: string) => calculate(scenario(id), prices.prices, allowances).listUsd;

// The chapter quotes these numbers. If a price or the model changes, the prose must change with it.
describe("what the chapter says a flood costs", () => {
  it.each(RUNS.map((run) => [run.id, run] as const))(
    "%s: the recorded usage is what the simulation gives",
    (id, run) => {
      expect(scenario(id).items).toEqual(billItems(total(run.outcome()), run.webAcl));
    },
  );

  it("prices the hour as the page does", () => {
    expect(Object.fromEntries(RUNS.map((run) => [run.id, listUsd(run.id)]))).toEqual({
      "shield-flood-few-open": 25.73,
      "shield-flood-few-rule": 10.08,
      "shield-flood-many-rule": 34.95,
      "shield-flood-many-brake": 27.96,
      "shield-flood-cached-cache": 20.21,
    });
  });

  it("charges CloudFront for a request the brake refused, and not for one AWS WAF blocked", () => {
    const count = { sent: 1000, blocked: 600, cached: 100, throttled: 250, origin: 50 };
    const quantity = (priceId: string, webAcl: boolean) =>
      billItems(count, webAcl).find((item) => item.priceId === priceId)?.quantity;
    expect(quantity("cloudfront.jp.request.https", true)).toBe(400);
    expect(quantity("waf.global.request", true)).toBe(1000);
    expect(quantity("waf.global.request", false)).toBeUndefined();
    expect(quantity("lambda.request.arm", true)).toBe(50);
    // 50 runs of 50 ms at a quarter of a gigabyte.
    expect(quantity("lambda.duration.arm", true)).toBe(0.625);
    expect(SHAPE).toEqual({ responseBytes: 1024, functionMs: 50, memoryMb: 256 });
  });
});

const MONTH_LIST_USD = 21_660.02;

describe("what the chapter says a month of flood costs", () => {
  it("is the recorded usage, and most of it is CloudFront's requests", () => {
    expect(scenario("shield-flood-month-open").items).toEqual(billItems(MONTH_OPEN, false));
    const result = calculate(scenario("shield-flood-month-open"), prices.prices, allowances);
    expect(result.listUsd).toBe(MONTH_LIST_USD);
    const requests = result.lines.find((line) => line.priceId === "cloudfront.jp.request.https");
    expect(requests?.listUsd).toBe(15552);
  });
});

describe("what the chapter says the stacks cost", () => {
  it("is 6.10 a month for the web ACL, its rule and its alarm", () => {
    expect(listUsd("shield-edge-month")).toBe(6.1);
  });

  it("is 3,000.20 a month with Shield Advanced, twelve times over", () => {
    expect(listUsd("shield-advanced-month")).toBe(3000.2);
    expect(Math.round(listUsd("shield-advanced-month") * 12 * 100) / 100).toBe(36002.4);
  });
});
