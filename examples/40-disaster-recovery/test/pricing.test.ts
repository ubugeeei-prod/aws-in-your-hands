import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import type { Placement } from "../src/config.ts";
import { drillItems, type FixedItem, protectionItems } from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const cost = (items: FixedItem[]): number =>
  calculate(
    {
      id: "test",
      chapter: "40",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items,
    },
    prices.prices,
    allowances,
  ).listUsd;
const lines = (items: { priceId: string; quantity: number }[]) =>
  items.map(({ priceId, quantity }) => ({ priceId, quantity }));

// The chapter quotes these numbers. If a price or the stack changes, the prose must change with it.
describe("what protecting one server costs before any drill", () => {
  it.each<[string, Placement, number]>([
    ["dr-private-idle", "private", 62.82],
    ["dr-public-idle", "public", 46.03],
  ])("%s: the billed parts are the scenario's lines", (id, placement, monthly) => {
    const recorded = scenario(id);
    expect(lines(protectionItems({ placement }))).toEqual(lines(recorded.items));
    expect(calculate(recorded, prices.prices, allowances).listUsd).toBe(monthly);
    expect(cost(protectionItems({ placement }))).toBe(monthly);
  });

  it("costs this much for one day", () => {
    expect(cost(protectionItems({ placement: "private" }, 24))).toBe(2.07);
    expect(cost(protectionItems({ placement: "public" }, 24))).toBe(1.51);
  });

  it("is mostly the service fee, the replication server, and the endpoints", () => {
    const fee = cost(protectionItems({ placement: "private" }).slice(0, 1));
    const server = cost(protectionItems({ placement: "private" }).slice(1, 2));
    expect([fee, server]).toEqual([20.44, 19.86]);
  });

  it("adds little for a two-hour drill, as long as the instance is terminated", () => {
    expect(lines(drillItems({ placement: "private" }, 2))).toEqual(
      lines(scenario("dr-drill-2h").items),
    );
    expect(cost(drillItems({ placement: "private" }, 2))).toBe(0.03);
    // The same instance forgotten for a month.
    expect(cost(drillItems({ placement: "private" }, 730))).toBe(9.42);
  });
});
