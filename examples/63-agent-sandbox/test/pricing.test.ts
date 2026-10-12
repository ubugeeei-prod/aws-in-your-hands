import { describe, expect, it } from "vite-plus/test";

import { profileOf } from "@aih/example-36-bedrock/src/models.ts";
import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { LIMITS, TASK } from "../src/config.ts";
import { estimateUsd } from "../src/limits.ts";

const { prices, allowances, scenarios } = loadPricing();
const total = (id: string) => {
  const scenario = scenarios.scenarios.find((item) => item.id === id);
  if (scenario === undefined) {
    throw new Error(`scenario ${id} is missing from data/pricing/scenarios.json`);
  }
  return calculate(scenario, prices.prices, allowances);
};
const usd = (id: string): number =>
  Number(prices.prices.find((price) => price.id === id)?.tiers[0]?.usd);
const MODEL = "jp.anthropic.claude-haiku-4-5-20251001-v1:0";

// The chapter quotes these numbers. If a price or an assumption changes, the prose must change with it.
describe("what the chapter says the sandbox costs", () => {
  it("costs nine cents a month while no task runs", () => {
    const idle = total("agent-sandbox-idle");
    expect(idle.listUsd).toBe(0.09);
    // Lambda's free allowance covers the reaper; the assumed half gigabyte of image is what is left.
    expect(idle.afterAllowanceUsd).toBe(0.05);
  });

  it("costs three cents of Fargate for a 30-minute task, and the model on top", () => {
    const job = total("agent-sandbox-job");
    expect(job.listUsd).toBe(1.43);
    const compute = job.lines
      .filter((line) => line.priceId.startsWith("fargate."))
      .reduce((sum, line) => sum + line.listUsd, 0);
    expect(compute).toBeCloseTo(0.029065, 6);
    expect(job.lines.find((line) => line.priceId === "fargate.arm.vcpu.hour")?.quantity).toBe(
      (TASK.cpuUnits / 1024) * 0.5,
    );
    expect(job.lines.find((line) => line.priceId === "fargate.arm.memory.gb-hour")?.quantity).toBe(
      (TASK.memoryMiB / 1024) * 0.5,
    );
  });

  it("bounds a task that runs to the wall-clock limit", () => {
    const hours = LIMITS.maxMinutes / 60;
    const worst =
      hours * usd("fargate.arm.vcpu.hour") + hours * 4 * usd("fargate.arm.memory.gb-hour");
    expect(worst).toBeCloseTo(0.0484, 4);
  });

  it("prices the ways out of the subnet as the page lists them", () => {
    expect(total("agent-sandbox-egress-model-endpoint").listUsd).toBe(20.44);
    expect(total("agent-sandbox-egress-endpoints").listUsd).toBe(81.76);
    expect(total("agent-sandbox-egress-nat").listUsd).toBe(48.91);
    expect(total("agent-sandbox-egress-proxy").listUsd).toBe(11.53);
    expect(total("agent-sandbox-egress-firewall").listUsd).toBe(292);
    expect(usd("network-firewall.endpoint.hour")).toBe(0.395);
    expect(usd("network-firewall.data.gb")).toBe(0.065);
  });
});

describe("the prices the reaper counts with", () => {
  it("are the Price List's, as chapter 36 recorded them", () => {
    const rates = profileOf(MODEL).usdPerMillionTokens;
    expect(rates.input).toBe(usd("bedrock.claude-haiku-4-5.input"));
    expect(rates.output).toBe(usd("bedrock.claude-haiku-4-5.output"));
    expect(rates.cacheRead).toBe(usd("bedrock.claude-haiku-4-5.cache-read"));
    expect(rates.cacheWrite).toBe(usd("bedrock.claude-haiku-4-5.cache-write"));
  });

  it("puts the scenario's assumed tokens at the scenario's model cost", () => {
    const tokens = { input: 400_000, output: 60_000, cacheRead: 2_000_000, cacheWrite: 300_000 };
    expect(estimateUsd(tokens, MODEL)).toBeCloseTo(1.4025, 6);
    // The daily ceiling is about fourteen such tasks.
    expect(Math.floor(LIMITS.dailyUsd / estimateUsd(tokens, MODEL))).toBe(14);
  });
});
