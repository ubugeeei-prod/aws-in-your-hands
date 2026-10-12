import { describe, expect, it } from "vite-plus/test";

import { parseNetworkConfig } from "@aih/example-11-network/src/config.ts";
import { planNetwork } from "@aih/example-11-network/src/plan.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { parseEc2Config, type Placement } from "../src/config.ts";
import { fixedItems, type InstanceState, networkSettingsFor } from "../src/cost.ts";
import { allFixedItems } from "../src/report.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const itemsFor = (placement: Placement, state: InstanceState, hours: number) =>
  allFixedItems(
    parseEc2Config({ placement }),
    planNetwork(parseNetworkConfig(networkSettingsFor(placement))),
    state,
    hours,
  );
const cost = (placement: Placement, state: InstanceState, hours = 730): number =>
  calculate(
    {
      id: "test",
      chapter: "23",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: itemsFor(placement, state, hours),
    },
    prices.prices,
    allowances,
  ).listUsd;

// The chapter quotes these numbers. If a price or the stack changes, the prose must change with it.
describe("what the instance costs before it serves one request", () => {
  it.each<[string, Placement, InstanceState, number]>([
    ["ec2-private-running", "private", "running", 70.74],
    ["ec2-private-stopped", "private", "stopped", 62.86],
    ["ec2-public-running", "public", "running", 13.07],
    ["ec2-public-stopped", "public", "stopped", 1.54],
  ])("%s: the stack's billed parts are the scenario's lines", (id, placement, state, monthly) => {
    const recorded = scenario(id);
    expect(
      itemsFor(placement, state, 730).map(({ priceId, quantity }) => ({ priceId, quantity })),
    ).toEqual(recorded.items.map(({ priceId, quantity }) => ({ priceId, quantity })));
    expect(calculate(recorded, prices.prices, allowances).listUsd).toBe(monthly);
    expect(cost(placement, state)).toBe(monthly);
  });

  it("costs this much for one day", () => {
    expect(cost("private", "running", 24)).toBe(2.33);
    expect(cost("public", "running", 24)).toBe(0.43);
    expect(cost("private", "stopped", 24)).toBe(2.07);
    expect(cost("public", "stopped", 24)).toBe(0.05);
  });

  it("keeps billing for the volumes, and for the endpoints, while the instance is stopped", () => {
    const stopped = fixedItems(parseEc2Config({}), "stopped").map((item) => item.priceId);
    expect(stopped).toEqual(["ebs.gp3.storage"]);
    // Stopping a private instance saves the instance price and nothing else.
    expect(cost("private", "running") - cost("private", "stopped")).toBeCloseTo(7.88, 2);
    expect(cost("private", "stopped")).toBeGreaterThan(cost("public", "running"));
  });

  it("stops billing for an auto-assigned public address when the instance stops", () => {
    const running = fixedItems(parseEc2Config({ placement: "public" }), "running").map(
      (item) => item.priceId,
    );
    const stopped = fixedItems(parseEc2Config({ placement: "public" }), "stopped").map(
      (item) => item.priceId,
    );
    expect(running).toContain("vpc.public-ipv4.in-use.hour");
    expect(stopped).not.toContain("vpc.public-ipv4.in-use.hour");
  });

  it("charges for both volumes by size, not by use", () => {
    const [volumes] = fixedItems(parseEc2Config({ dataVolumeGiB: 20 }), "stopped");
    expect(volumes).toMatchObject({ priceId: "ebs.gp3.storage", quantity: 28 });
  });
});
