import { describe, expect, it } from "vite-plus/test";

import { TASK } from "@aih/example-12-containers/src/config.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { parseIsolatesConfig } from "../src/config.ts";
import {
  averageCpuShare,
  idleItems,
  lambdaItems,
  type Load,
  loadItems,
  workersStandardUsd,
} from "../src/cost.ts";

const { prices, allowances, scenarios } = loadPricing();

const scenario = (id: string) => {
  const found = scenarios.scenarios.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return found;
};
const result = (id: string) => calculate(scenario(id), prices.prices, allowances);
const lines = (id: string) =>
  scenario(id).items.map(({ priceId, quantity }) => ({ priceId, quantity }));
const bare = (items: { priceId: string; quantity: number }[]) =>
  items.map(({ priceId, quantity }) => ({ priceId, quantity }));

const deployed = parseIsolatesConfig({ imageTag: "v1" });
/** The first example on Cloudflare's pricing page. */
const load: Load = { requests: 15_000_000, cpuMsPerRequest: 7 };

// The chapter quotes these numbers. If a price or the stack changes, the prose must change with it.
describe("what the stack costs before it serves one request", () => {
  it("is nothing by the hour without an image tag", () => {
    expect(idleItems(parseIsolatesConfig({}))).toEqual([]);
  });

  it.each<[string, number, number]>([
    ["isolates-idle", 730, 37.68],
    ["isolates-one-day", 24, 1.24],
  ])("%s: the stack's billed parts are the scenario's lines", (id, hours, usd) => {
    expect(bare(idleItems(deployed, hours))).toEqual(lines(id));
    expect(result(id).listUsd).toBe(usd);
  });
});

describe("15 million requests a month at 7 ms of CPU each", () => {
  it("adds only load balancer capacity to the idle bill on Fargate", () => {
    expect(lines("isolates-load-fargate")).toEqual(
      bare([...idleItems(deployed), ...loadItems(load)]),
    );
    expect(result("isolates-load-fargate").listUsd).toBe(39.02);
    // On average. A burst is another matter, and nothing here measures one.
    expect(averageCpuShare(load, TASK.cpuUnits / 1024)).toBeCloseTo(0.16, 2);
  });

  it("costs this much on chapter 04's stack, at 50 ms and 256 MB a request", () => {
    expect(lines("isolates-load-lambda")).toEqual(bare(lambdaItems(load, 0.05, 0.25)));
    expect(result("isolates-load-lambda").listUsd).toBe(24.85);
    expect(result("isolates-load-lambda").afterAllowanceUsd).toBe(22.15);
  });

  it("costs on Workers what Cloudflare's own examples say", () => {
    expect(workersStandardUsd(load)).toBe(8);
    expect(workersStandardUsd({ requests: 100_000_000, cpuMsPerRequest: 7 })).toBe(45.4);
    expect(workersStandardUsd({ requests: 0, cpuMsPerRequest: 0 })).toBe(5);
  });
});
