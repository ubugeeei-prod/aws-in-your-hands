import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { parseContainersConfig, SERVICE } from "../src/config.ts";
import { fixedMonthlyItems } from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const total = (id: string) => calculate(scenario(id), prices.prices, allowances);
const fixedCost = (input: unknown, tasks?: number, hours?: number): number =>
  calculate(
    {
      id: "test",
      chapter: "12",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: fixedMonthlyItems(parseContainersConfig(input), tasks, hours),
    },
    prices.prices,
    allowances,
  ).listUsd;

const running = { imageTag: "v1" };
const HOURLY = [
  "fargate.arm.vcpu.hour",
  "fargate.arm.memory.gb-hour",
  "alb.hour",
  "vpc.public-ipv4.in-use.hour",
];

// The chapter quotes these numbers. If a price or the layout changes, the prose must change with it.
describe("what the chapter says the stack costs", () => {
  it("is nothing by the hour until an image tag is given", () => {
    expect(fixedMonthlyItems(parseContainersConfig({}))).toEqual([]);
    expect(total("containers-repository-only").listUsd).toBe(0.01);
  });

  it.each([
    ["containers-idle", running, 50.33, 50.34],
    ["containers-private-nat", { ...running, taskSubnets: "private" }, 43.03, 92.07],
    ["containers-private-endpoints", { ...running, taskSubnets: "private" }, 43.03, 104.37],
  ])(
    "%s: the stack's hourly parts are the scenario's lines for this stack",
    (id, input, fixed, listed) => {
      const recorded = scenario(id).items.filter((item) => HOURLY.includes(item.priceId));
      const planned = fixedMonthlyItems(parseContainersConfig(input));

      // The NAT gateway's own address is chapter 11's, so it is taken out before comparing.
      const natAddresses = scenario(id).items.some((item) => item.priceId === "nat.gateway.hour")
        ? 730
        : 0;
      expect(planned.map(({ priceId, quantity }) => ({ priceId, quantity }))).toEqual(
        recorded.map(({ priceId, quantity }) => ({
          priceId,
          quantity: priceId === "vpc.public-ipv4.in-use.hour" ? quantity - natAddresses : quantity,
        })),
      );
      expect(fixedCost(input)).toBe(fixed);
      expect(total(id).listUsd).toBe(listed);
    },
  );

  it("is 1.65 for one day of the default layout", () => {
    expect(total("containers-one-day").listUsd).toBe(1.65);
    expect(fixedCost(running, SERVICE.desiredCount, 24)).toBe(1.65);
  });

  it("adds little for a million requests: the fixed part dominates", () => {
    const small = total("containers-small");
    expect(small.listUsd).toBe(50.63);
    expect(small.afterAllowanceUsd).toBe(50.48);
  });

  it("puts each extra task in a public subnet at 12.65 a month, and the scaling ceiling at 75.62", () => {
    expect(fixedCost(running, SERVICE.desiredCount + 1) - fixedCost(running)).toBeCloseTo(12.65, 2);
    expect(fixedCost(running, SERVICE.maxCount)).toBe(75.62);
  });

  it("makes arm64 one fifth cheaper than x86 for the same task size", () => {
    const usd = (id: string): number =>
      Number(prices.prices.find((price) => price.id === id)?.tiers[0]?.usd);
    const arm = 0.25 * usd("fargate.arm.vcpu.hour") + 0.5 * usd("fargate.arm.memory.gb-hour");
    const x86 = 0.25 * usd("fargate.x86.vcpu.hour") + 0.5 * usd("fargate.x86.memory.gb-hour");
    expect(arm * 730).toBeCloseTo(9.0, 2);
    expect(x86 * 730).toBeCloseTo(11.25, 2);
    expect(arm / x86).toBeCloseTo(0.8, 2);
  });
});
