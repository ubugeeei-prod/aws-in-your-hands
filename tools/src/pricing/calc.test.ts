import { describe, expect, it } from "vite-plus/test";
import { loadPricing } from "../data/load.ts";
import { calculate } from "./calc.ts";
import type { Allowances, Scenario, UnitPrice } from "./schema.ts";

const price = (id: string, tiers: [number, number | null, string][]): UnitPrice => ({
  id,
  offerCode: "Test",
  region: "ap-northeast-1",
  sku: "SKU",
  usageType: "T",
  plan: "on-demand",
  currency: "USD",
  unit: "unit",
  tiers: tiers.map(([from, to, usd]) => ({ from, to, usd, description: "" })),
  sourceUrl: "https://example.com/",
  offerPublicationDate: "2026-10-01T00:00:00Z",
  checkedAt: "2026-10-11",
});
const scenario = (items: Scenario["items"]): Scenario => ({
  id: "t",
  chapter: "00",
  title: { ja: "", en: "" },
  assumptions: { ja: [], en: [] },
  items,
});
const none: Allowances = { allowances: [], unknown: [] };

describe("pricing calculator", () => {
  it("multiplies a per-request price without floating-point drift", () => {
    const result = calculate(
      scenario([{ priceId: "req", quantity: 3_000_000, basis: "" }]),
      [price("req", [[0, null, "0.0000002000"]])],
      none,
    );
    expect(result.lines[0]?.listUsd).toBe(0.6);
  });

  it("splits a quantity across price tiers", () => {
    const tiers = price("gb", [
      [0, 10, "0.10"],
      [10, null, "0.05"],
    ]);
    const result = calculate(scenario([{ priceId: "gb", quantity: 25, basis: "" }]), [tiers], none);
    expect(result.listUsd).toBe(1.75);
  });

  it("reports the list price and the price after the free allowance separately", () => {
    const allowances: Allowances = {
      allowances: [
        { priceId: "req", quantity: 1_000_000, period: "month", kind: "always-free", sourceId: "s", note: "" },
      ],
      unknown: [],
    };
    const result = calculate(
      scenario([{ priceId: "req", quantity: 1_500_000, basis: "" }]),
      [price("req", [[0, null, "0.000001"]])],
      allowances,
    );
    expect(result.listUsd).toBe(1.5);
    expect(result.afterAllowanceUsd).toBe(0.5);
  });

  it("refuses a price it does not have instead of counting it as zero", () => {
    expect(() => calculate(scenario([{ priceId: "nat.hour", quantity: 730, basis: "" }]), [], none)).toThrow(
      /unknown price/,
    );
  });

  it("flags an allowance that could not be confirmed and deducts nothing for it", () => {
    const allowances: Allowances = { allowances: [], unknown: [{ priceId: "req", reason: "not confirmed" }] };
    const result = calculate(
      scenario([{ priceId: "req", quantity: 10, basis: "" }]),
      [price("req", [[0, null, "1"]])],
      allowances,
    );
    expect(result.unknownAllowances).toEqual(["req"]);
    expect(result.afterAllowanceUsd).toBe(result.listUsd);
  });
});

describe("the book's pricing data", () => {
  const { prices, allowances, scenarios } = loadPricing();

  it("calculates every scenario from recorded prices", () => {
    for (const item of scenarios.scenarios) {
      expect(() => calculate(item, prices.prices, allowances)).not.toThrow();
    }
  });

  it("matches the worked example in chapter 04", () => {
    const api = scenarios.scenarios.find((item) => item.id === "http-api-small");
    if (api === undefined) {
      throw new Error("scenario http-api-small is missing");
    }
    const result = calculate(api, prices.prices, allowances);
    // 1.29 (API Gateway) + 0.20 (Lambda requests) + 0.17 (Lambda duration) + 0.36 (log ingest) + 0.00 (log storage)
    expect(result.listUsd).toBe(2.02);
    // Lambda and CloudWatch Logs fall inside their monthly allowances; API Gateway has none applied.
    expect(result.afterAllowanceUsd).toBe(1.29);
  });

  it("applies allowances only to prices that exist", () => {
    const ids = new Set(prices.prices.map((item) => item.id));
    for (const entry of [...allowances.allowances, ...allowances.unknown]) {
      expect(ids.has(entry.priceId), entry.priceId).toBe(true);
    }
  });
});
