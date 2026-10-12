import { describe, expect, it } from "vite-plus/test";

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { parseManagedConfig } from "../src/config.ts";
import { fleetItems, instanceCeiling, PRICE_IDS } from "../src/cost.ts";
import { NETWORK_SETTINGS } from "../src/network.ts";
import { firstTierUsd } from "../src/prices.ts";
import { allFixedItems } from "../src/report.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const listUsd = (id: string): number => calculate(scenario(id), prices.prices, allowances).listUsd;
const config = parseManagedConfig({});
const network = planNetwork(parseNetworkConfig(NETWORK_SETTINGS));
const fixed = (instances: number, hours: number) =>
  allFixedItems(config, network, instances, hours).map(({ priceId, quantity }) => ({
    priceId,
    quantity,
  }));
const lines = (id: string) =>
  scenario(id).items.map(({ priceId, quantity }) => ({ priceId, quantity }));

// The chapter quotes these numbers. If a price or the stack changes, the prose must change with it.
describe("what the fleet costs before it serves one request", () => {
  it.each<[string, number, number, number]>([
    ["lmi-idle", 3, 730, 269.77],
    ["lmi-one-day", 3, 24, 8.87],
    ["lmi-ceiling", instanceCeiling(config.maxVCpuCount), 730, 519.1],
  ])("%s: the stack's billed parts are the scenario's lines", (id, instances, hours, usd) => {
    expect(fixed(instances, hours)).toEqual(lines(id));
    expect(listUsd(id)).toBe(usd);
  });

  it("charges Lambda's fee at 15% of the On-Demand price of the instance", () => {
    for (const type of ["m6g.large", "m7g.large"] as const) {
      const instance = firstTierUsd(prices.prices, PRICE_IDS.instanceHour[type]);
      const fee = firstTierUsd(prices.prices, PRICE_IDS.managementHour[type]);
      expect(fee / instance).toBeCloseTo(0.15, 10);
    }
  });

  it("charges nothing for a fleet of zero, and still charges for the endpoint", () => {
    expect(fleetItems("m6g.large", 0)).toEqual([]);
    expect(fixed(0, 730)).toEqual([{ priceId: "vpc.endpoint.interface.hour", quantity: 1460 }]);
  });

  it("prices a request the same as standard Lambda does", () => {
    expect(firstTierUsd(prices.prices, PRICE_IDS.request)).toBe(
      firstTierUsd(prices.prices, "lambda.request.arm"),
    );
  });
});

describe("the same month elsewhere", () => {
  it("adds only the requests to the idle bill when the fleet serves 100 million of them", () => {
    expect(lines("lmi-steady").slice(1)).toEqual(lines("lmi-idle"));
    expect(listUsd("lmi-steady")).toBe(289.77);
  });

  it("costs this much on standard Lambda, by memory size", () => {
    expect(listUsd("lmi-compare-standard-256mb")).toBe(86.67);
    expect(listUsd("lmi-compare-standard-1gb")).toBe(286.67);
    expect(listUsd("lmi-compare-standard-2gb")).toBe(553.34);
  });

  it("costs this much for the same three machines without Lambda, and for the same shape on Fargate", () => {
    expect(listUsd("lmi-compare-ec2")).toBe(216.81);
    expect(listUsd("lmi-compare-fargate")).toBe(254.61);
    // Chapter 12's own stack: one small task behind a load balancer.
    expect(listUsd("containers-idle")).toBe(50.34);
    // What Lambda adds to three instances you could have rented yourself.
    expect(listUsd("lmi-idle") - listUsd("lmi-compare-ec2") - 20.44).toBeCloseTo(32.52, 2);
  });
});
