import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { DEFAULT_RUNNING, fixedMonthlyItems, type Running } from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const total = (id: string): number => calculate(scenario(id), prices.prices, allowances).listUsd;
const fixedCost = (running: Partial<Running> = {}, hours?: number): number =>
  calculate(
    {
      id: "test",
      chapter: "34",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: fixedMonthlyItems({ ...DEFAULT_RUNNING, ...running }, hours),
    },
    prices.prices,
    allowances,
  ).listUsd;
const usd = (id: string): number =>
  Number(prices.prices.find((price) => price.id === id)?.tiers[0]?.usd);

// The chapter quotes these numbers. If a price or the layout changes, the prose must change with it.
describe("what the chapter says the cluster costs", () => {
  it("is 73.00 a month for the control plane alone, before any node exists", () => {
    expect(fixedCost({ workload: false })).toBe(73);
    expect(total("eks-control-plane-only")).toBe(73);
  });

  it.each([
    ["eks-idle", {}],
    ["eks-private-nodes", { nodeSubnets: "private" as const }],
    ["eks-extended-support", { extendedSupport: true }],
  ])("%s: the scenario's lines for this stack are what the code counts", (id, running) => {
    const mine = new Set(
      fixedMonthlyItems()
        .map((item) => item.priceId)
        .concat("eks.cluster.extended-support.hour"),
    );
    const recorded = scenario(id).items.filter((item) => mine.has(item.priceId));
    const planned = fixedMonthlyItems({ ...DEFAULT_RUNNING, ...running });
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
  });

  it("is 179.81 a month with the app running in the default layout, 5.91 a day", () => {
    expect(fixedCost()).toBe(179.81);
    expect(total("eks-idle")).toBe(179.81);
    expect(fixedCost({}, 24)).toBe(5.91);
    expect(total("eks-one-day")).toBe(5.91);
  });

  it("is 0.246 an hour, of which the control plane is 0.10", () => {
    expect(fixedCost({}, 1)).toBe(0.25);
    expect(fixedCost() / 730).toBeCloseTo(0.2463, 4);
    expect(usd("eks.cluster.hour")).toBe(0.1);
  });

  it("costs 221.55 with the nodes in private subnets behind chapter 11's NAT gateway", () => {
    expect(fixedCost({ nodeSubnets: "private" })).toBe(172.51);
    expect(total("eks-private-nodes")).toBe(221.55);
  });

  it("adds 365.00 a month once the version is in extended support: six times the control plane", () => {
    expect(fixedCost({ extendedSupport: true }) - fixedCost()).toBeCloseTo(365, 2);
    expect(total("eks-extended-support")).toBe(544.81);
    expect(
      (usd("eks.cluster.hour") + usd("eks.cluster.extended-support.hour")) /
        usd("eks.cluster.hour"),
    ).toBeCloseTo(6, 9);
  });

  it("puts each further node at 40.89 a month, and the node pool's ceiling at 261.59", () => {
    expect(fixedCost({ nodes: 3 }) - fixedCost()).toBeCloseTo(40.89, 2);
    expect(fixedCost({ nodes: 4 })).toBe(261.59);
  });

  it("charges about 12% on top of the instance for Auto Mode", () => {
    expect(usd("eks.auto.t4g-medium.hour") / usd("ec2.t4g-medium.linux.hour")).toBeCloseTo(0.12, 2);
  });

  it("is about three and a half times chapter 12's Fargate service", () => {
    expect(total("containers-idle")).toBe(50.34);
    expect(fixedCost() / 50.33).toBeCloseTo(3.57, 2);
  });
});
