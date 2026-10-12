import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { parseClusterConfig } from "../src/config.ts";
import {
  artifactItem,
  dsqlItems,
  fixedItems,
  type Item,
  replicationTransferGb,
  transferItem,
} from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const recorded = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const usd = (items: Item[]): number =>
  calculate(
    {
      id: "test",
      chapter: "66",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items,
    },
    prices.prices,
    allowances,
  ).listUsd;

const three = parseClusterConfig({ nodes: 3 });
// The load every comparison in the chapter uses.
const load = { writesPerSecond: 10, readsPerSecond: 90, bytesPerWrite: 2000, storedGb: 10 };

// The chapter quotes these numbers. If a price or the stack changes, the prose must change with it.
describe("what the cluster costs", () => {
  it.each<[string, Item[], number]>([
    ["distsql-foundation", [artifactItem()], 0.01],
    ["distsql-cluster-idle", [...fixedItems(three, "running", 3), artifactItem()], 194.66],
    [
      "distsql-cluster-load",
      [...fixedItems(three, "running", 3), artifactItem(), transferItem(load)],
      196.77,
    ],
    ["distsql-retained-after-destroy", fixedItems(three, "destroyed", 0), 5.76],
    ["distsql-dsql-same-load", dsqlItems(load), 68.65],
  ])(
    "%s: the lines are the scenario's, and the month comes to the amount in the text",
    (id, items, monthly) => {
      const scenario = recorded(id);
      expect(items.map(({ priceId, quantity }) => ({ priceId, quantity }))).toEqual(
        scenario.items.map(({ priceId, quantity }) => ({ priceId, quantity })),
      );
      expect(calculate(scenario, prices.prices, allowances).listUsd).toBe(monthly);
      expect(usd(items)).toBe(monthly);
    },
  );

  it("has a floor for Aurora Serverless v2 that the text quotes", () => {
    expect(calculate(recorded("distsql-aurora-floor"), prices.prices, allowances).listUsd).toBe(
      55.95,
    );
  });

  it("bills nothing by the hour for the default stack, which has no node", () => {
    expect(fixedItems(parseClusterConfig({}), "running", 3)).toEqual([]);
  });

  it("spends nearly half of an idle month on the Systems Manager endpoints", () => {
    const withEndpoints = usd(fixedItems(three, "running", 3));
    const without = usd(fixedItems(three, "running", 0));
    expect(without).toBe(102.67);
    expect(Math.round((withEndpoints - without) * 100) / 100).toBe(91.98);
  });

  it("costs this much for one day of practice", () => {
    expect(Math.round((usd(fixedItems(three, "running", 3)) / 730) * 24 * 100) / 100).toBe(6.4);
  });

  it("meters each replicated byte four times: two followers, and both ends of each transfer", () => {
    expect(replicationTransferGb({ writesPerSecond: 10, bytesPerWrite: 2000 })).toBe(210.24);
    expect(usd([transferItem(load)])).toBe(2.1);
    // At a hundred times the writes the transfer is no longer a rounding error.
    expect(usd([transferItem({ ...load, writesPerSecond: 1000 })])).toBe(210.24);
  });

  it("is overtaken by Aurora DSQL's estimate at four times the load, on paper", () => {
    const fourfold = { ...load, writesPerSecond: 40, readsPerSecond: 360 };
    expect(usd(dsqlItems(fourfold))).toBe(262.6);
    expect(usd([...fixedItems(three, "running", 3), artifactItem(), transferItem(fourfold)])).toBe(
      203.07,
    );
  });

  it("with the recommended instance type costs more than twice as much to keep running", () => {
    const larger = parseClusterConfig({ nodes: 3, instanceType: "m7g.large" });
    expect(usd(fixedItems(larger, "running", 0))).toBe(238.89);
  });
});
