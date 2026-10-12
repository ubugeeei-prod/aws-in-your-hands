import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { parseFleetConfig } from "../src/config.ts";
import { allFixedItems, fleetItems, type FleetState, idleRequestsPerNode } from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const cost = (nodes: number, state: FleetState, hours = 730, endpoints = true): number =>
  calculate(
    {
      id: "test",
      chapter: "24",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: allFixedItems(parseFleetConfig({ nodes }), state, hours, endpoints),
    },
    prices.prices,
    allowances,
  ).listUsd;

// The chapter quotes these numbers. If a price or the stack changes, the prose must change with it.
describe("what the fleet costs before it serves one request", () => {
  it.each<[string, number, FleetState, boolean, number]>([
    ["celld-one-node-running", 1, "running", true, 82.56],
    ["celld-three-nodes-running", 3, "running", true, 125.03],
    ["celld-three-nodes-stopped", 3, "stopped", true, 65.93],
    ["celld-retained-after-destroy", 3, "destroyed", false, 2.3],
  ])(
    "%s: the stack's billed parts are the scenario's lines",
    (id, nodes, state, endpoints, monthly) => {
      const recorded = scenario(id);
      const items = allFixedItems(parseFleetConfig({ nodes }), state, 730, endpoints);
      expect(items.map(({ priceId, quantity }) => ({ priceId, quantity }))).toEqual(
        recorded.items.map(({ priceId, quantity }) => ({ priceId, quantity })),
      );
      expect(calculate(recorded, prices.prices, allowances).listUsd).toBe(monthly);
      expect(cost(nodes, state, 730, endpoints)).toBe(monthly);
    },
  );

  it("costs this much for one day", () => {
    expect(cost(1, "running", 24)).toBe(2.71);
    expect(cost(3, "running", 24)).toBe(4.11);
    expect(cost(3, "stopped", 24)).toBe(2.17);
  });

  it("bills nothing by the hour for the default stack, which has no node", () => {
    expect(fleetItems(parseFleetConfig({}), "running")).toEqual([]);
    expect(allFixedItems(parseFleetConfig({}), "running")).toEqual([]);
  });

  it("spends most of a one-node month, and about half of a three-node month, on the Systems Manager endpoints", () => {
    const endpoints = cost(3, "running") - cost(3, "running", 730, false);
    expect(endpoints).toBeCloseTo(61.32, 2);
    expect(endpoints / cost(1, "running")).toBeGreaterThan(0.7);
    expect(endpoints / cost(3, "running")).toBeGreaterThan(0.45);
    expect(cost(1, "running", 730, false)).toBe(21.24);
    expect(cost(3, "running", 730, false)).toBe(63.71);
  });

  it("keeps billing for retained data volumes after the stack is gone, and for nothing when they are not retained", () => {
    expect(fleetItems(parseFleetConfig({ nodes: 3 }), "destroyed")).toEqual([
      expect.objectContaining({ priceId: "ebs.gp3.storage", quantity: 24 }),
    ]);
    expect(
      fleetItems(parseFleetConfig({ nodes: 3, stateOnDestroy: "delete" }), "destroyed"),
    ).toEqual([]);
  });

  it("counts an idle node's bucket requests from the intervals celld documents", () => {
    // 3600 s / (10 s / 3) renewals, 3600 / 5 samples + 3600 / 30 pointer reads, per hour.
    expect(idleRequestsPerNode(1)).toEqual({ writes: 1080, reads: 840 });
    const stopped = fleetItems(parseFleetConfig({ nodes: 3 }), "stopped").map(
      (item) => item.priceId,
    );
    expect(stopped).toEqual(["ebs.gp3.storage"]);
  });
});
