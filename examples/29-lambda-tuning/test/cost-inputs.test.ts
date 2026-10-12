import { describe, expect, it } from "vite-plus/test";

import { loadPricing } from "@aih/tools/data/load.ts";

import {
  billedMs,
  breakEvenMs,
  durationCostRatio,
  gbSeconds,
  provisionedBreakEven,
  provisionedGbSeconds,
} from "../src/cost-inputs.ts";

// The quantities in data/fragments/29.json come from these calls.

describe("duration in the unit Lambda charges", () => {
  it("turns memory, time and count into GB-seconds", () => {
    expect(gbSeconds({ memoryMb: 256, billedMs: 50, invocations: 1_000_000 })).toBe(12_500);
    expect(gbSeconds({ memoryMb: 1024, billedMs: 50, invocations: 1_000_000 })).toBe(50_000);
  });

  it("adds initialization to the invocation that paid for it", () => {
    expect(billedMs(50)).toBe(50);
    expect(billedMs(50.2, 300.5)).toBe(351);
    // 1% of a million requests start cold, with an assumed 300 ms of initialization each.
    expect(gbSeconds({ memoryMb: 256, billedMs: 300, invocations: 10_000 })).toBe(750);
  });
});

describe("more memory", () => {
  const now = { memoryMb: 256, billedMs: 60 };

  it("costs the same when the duration falls as far as the memory rose", () => {
    expect(durationCostRatio(now, { memoryMb: 512, billedMs: 30 })).toBe(1);
    expect(breakEvenMs(now, 512)).toBe(30);
    expect(breakEvenMs(now, 1024)).toBe(15);
  });

  it("costs more when the handler was waiting on the network, not on the CPU", () => {
    expect(durationCostRatio(now, { memoryMb: 512, billedMs: 55 })).toBeCloseTo(1.833, 3);
    expect(durationCostRatio(now, { memoryMb: 1024, billedMs: 60 })).toBe(4);
  });

  it("costs less only when the duration falls further than that", () => {
    expect(durationCostRatio(now, { memoryMb: 512, billedMs: 24 })).toBe(0.8);
  });
});

describe("provisioned concurrency", () => {
  it("is billed for every second of the month", () => {
    expect(provisionedGbSeconds({ memoryMb: 256, concurrency: 1 })).toBe(657_000);
    expect(provisionedGbSeconds({ memoryMb: 1024, concurrency: 2 })).toBe(5_256_000);
  });

  it("never becomes cheaper than on-demand at the prices of ap-northeast-1", () => {
    const { prices } = loadPricing();
    const firstTier = (id: string) => {
      const usd = prices.prices.find((price) => price.id === id)?.tiers[0]?.usd;
      if (usd === undefined) {
        throw new Error(`no price ${id}`);
      }
      return Number(usd);
    };

    for (const arch of ["arm", "x86"]) {
      const share = provisionedBreakEven({
        onDemand: firstTier(`lambda.duration.${arch}`),
        provisionedIdle: firstTier(`lambda.provisioned.${arch}`),
        provisionedDuration: firstTier(`lambda.duration.provisioned.${arch}`),
      });
      // Busy for more than the whole month: there is no such month.
      expect(share).toBeGreaterThan(1);
      expect(share).toBeCloseTo(1.31, 2);
    }
  });

  it("would pay for itself at 60% use under prices where the idle part is cheaper", () => {
    // An illustration of the formula, not a published price.
    expect(provisionedBreakEven({ onDemand: 10, provisionedIdle: 3, provisionedDuration: 5 })).toBe(
      0.6,
    );
  });
});
