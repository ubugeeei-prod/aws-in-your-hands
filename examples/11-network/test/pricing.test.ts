import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";
import { describe, expect, it } from "vite-plus/test";
import { parseNetworkConfig } from "../src/config.ts";
import { fixedMonthlyItems } from "../src/cost.ts";
import { planNetwork } from "../src/plan.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const fixedCost = (input: unknown): number =>
  calculate(
    {
      id: "test",
      chapter: "11",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: fixedMonthlyItems(planNetwork(parseNetworkConfig(input))),
    },
    prices.prices,
    allowances,
  ).listUsd;

// The chapter quotes these numbers. If a price or a layout changes, the prose must change with it.
describe("the monthly cost of each layout", () => {
  it.each([
    ["network-nat-single", { egress: "nat" }, 48.91, 49.53],
    ["network-nat-per-az", { egress: "nat-per-az" }, 97.82, 98.44],
    ["network-interface-endpoints", { interfaceEndpoints: "ecr.api,ecr.dkr,logs" }, 61.32, 61.42],
  ])("%s: the stack's hourly parts are the scenario's hourly lines", (id, input, fixed, total) => {
    const recorded = scenario(id);
    const hourly = recorded.items.filter((item) => item.priceId.endsWith(".hour"));
    const planned = fixedMonthlyItems(planNetwork(parseNetworkConfig(input)));

    expect(planned.map(({ priceId, quantity }) => ({ priceId, quantity }))).toEqual(
      hourly.map(({ priceId, quantity }) => ({ priceId, quantity })),
    );
    expect(fixedCost(input)).toBe(fixed);
    expect(calculate(recorded, prices.prices, allowances).listUsd).toBe(total);
  });

  it("is zero for the default layout because it has no billed part, not because a price is missing", () => {
    expect(fixedMonthlyItems(planNetwork(parseNetworkConfig({})))).toEqual([]);
    expect(fixedCost({})).toBe(0);
  });

  it("makes one interface endpoint in two zones cost 20.44, and a third zone 10.22 more", () => {
    expect(fixedCost({ interfaceEndpoints: "logs" })).toBe(20.44);
    expect(
      fixedCost({
        interfaceEndpoints: "logs",
        availabilityZones: "ap-northeast-1a,ap-northeast-1c,ap-northeast-1d",
      }),
    ).toBe(30.66);
  });

  it("puts the break-even between three endpoints and one NAT gateway near 240 GB a month", () => {
    const perGb = (id: string): number => Number(prices.prices.find((price) => price.id === id)?.tiers[0]?.usd);
    const fixedGap = fixedCost({ interfaceEndpoints: "ecr.api,ecr.dkr,logs" }) - fixedCost({ egress: "nat" });
    const perGbGap = perGb("nat.gateway.data") - perGb("vpc.endpoint.interface.data");

    expect(fixedGap).toBeCloseTo(12.41, 2);
    expect(perGbGap).toBeCloseTo(0.052, 5);
    expect(fixedGap / perGbGap).toBeCloseTo(238.65, 1);
  });

  it("makes three interface endpoints cost more than one NAT gateway before any traffic", () => {
    expect(fixedCost({ interfaceEndpoints: "ecr.api,ecr.dkr,logs" })).toBeGreaterThan(fixedCost({ egress: "nat" }));
    expect(fixedCost({ interfaceEndpoints: "ecr.api,ecr.dkr" })).toBeLessThan(fixedCost({ egress: "nat" }));
  });
});
