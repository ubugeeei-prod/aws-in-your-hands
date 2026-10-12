import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { compareArchitectures } from "../src/arch.ts";
import { type InstanceType, parseNitroConfig } from "../src/config.ts";
import { fixedItems, type InstanceState } from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const usdOf = (priceId: string): string => {
  const usd = prices.prices.find((price) => price.id === priceId)?.tiers[0]?.usd;
  if (usd === undefined) {
    throw new Error(`price ${priceId} is missing from data/pricing/unit-prices.json`);
  }
  return usd;
};
const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const cost = (instanceType: InstanceType, state: InstanceState, hours = 730): number =>
  calculate(
    {
      id: "test",
      chapter: "68",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: fixedItems(parseNitroConfig({ instanceType }), state, hours),
    },
    prices.prices,
    allowances,
  ).listUsd;

// The chapter quotes these numbers. If a price changes, the prose must change with it.
describe("arm64 against x86, by unit price", () => {
  it("is about a fifth cheaper for every unit the book uses", () => {
    expect(
      compareArchitectures(usdOf).map((row) => [row.arm64Usd, row.x86Usd, row.savingPercent]),
    ).toEqual([
      ["0.0108000000", "0.0136000000", 20.6],
      ["0.0856000000", "0.1070000000", 20],
      ["0.0404500000", "0.0505600000", 20],
      ["0.0044200000", "0.0055300000", 20.1],
      ["0.0000133334", "0.0000166667", 20],
    ]);
  });

  it("costs half as much for the smallest enclave parent, because x86 needs four vCPUs", () => {
    // No x86 .large is on the Nitro Enclaves list; c6i.xlarge is the smallest C6i that is.
    expect(usdOf("ec2.c6i-xlarge.linux.hour")).toBe("0.2140000000");
    expect(
      Number(usdOf("ec2.c6g-large.linux.hour")) / Number(usdOf("ec2.c6i-xlarge.linux.hour")),
    ).toBeCloseTo(0.4, 10);
  });
});

describe("what the stack costs before one enclave runs", () => {
  it.each<[string, InstanceState, number]>([
    ["nitro-idle-running", "running", 67.91],
    ["nitro-idle-stopped", "stopped", 1.77],
  ])("%s: the stack's billed parts are the scenario's lines", (id, state, monthly) => {
    const recorded = scenario(id);
    expect(
      fixedItems(parseNitroConfig({}), state).map(({ priceId, quantity }) => ({
        priceId,
        quantity,
      })),
    ).toEqual(recorded.items.map(({ priceId, quantity }) => ({ priceId, quantity })));
    expect(calculate(recorded, prices.prices, allowances).listUsd).toBe(monthly);
    expect(cost("c6g.large", state)).toBe(monthly);
  });

  it("costs this much for one day, and with the larger type", () => {
    expect(cost("c6g.large", "running", 24)).toBe(2.23);
    expect(cost("c6g.large", "stopped", 24)).toBe(0.06);
    expect(cost("m6g.large", "running", 24)).toBe(2.55);
    expect(cost("m6g.large", "running")).toBe(77.69);
  });

  it("keeps billing for the volume and the key while the instance is stopped", () => {
    expect(fixedItems(parseNitroConfig({}), "stopped").map((item) => item.priceId)).toEqual([
      "ebs.gp3.storage",
      "kms.key",
    ]);
  });

  it("has no line for the enclave", () => {
    const ids = fixedItems(parseNitroConfig({}), "running").map((item) => item.priceId);
    expect(ids).toEqual([
      "ec2.c6g-large.linux.hour",
      "vpc.public-ipv4.in-use.hour",
      "ebs.gp3.storage",
      "kms.key",
    ]);
  });
});
