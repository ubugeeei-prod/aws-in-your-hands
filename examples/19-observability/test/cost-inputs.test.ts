import { describe, expect, it } from "vite-plus/test";

import {
  logGbPerMonth,
  sampledPerSecond,
  storedGbMonths,
  tracesPerMonth,
} from "../src/cost-inputs.ts";

// The quantities in data/fragments/19.json come from these calls.

describe("log volume", () => {
  it("turns bytes per request into GB per month", () => {
    expect(logGbPerMonth({ requests: 1_000_000, bytesPerRequest: 1024 })).toBeCloseTo(0.953674, 6);
    // One more 100-byte field on every request line.
    expect(logGbPerMonth({ requests: 1_000_000, bytesPerRequest: 100 })).toBeCloseTo(0.093132, 6);
  });

  it("scales the stored volume with the retention period", () => {
    const ingestedGbPerMonth = logGbPerMonth({ requests: 1_000_000, bytesPerRequest: 1024 });
    expect(storedGbMonths({ ingestedGbPerMonth, retentionDays: 7 })).toBeCloseTo(0.222524, 6);
    expect(storedGbMonths({ ingestedGbPerMonth, retentionDays: 30 })).toBeCloseTo(0.953674, 6);
    expect(storedGbMonths({ ingestedGbPerMonth, retentionDays: 365 })).toBeCloseTo(11.603038, 6);
  });
});

describe("traces recorded by Lambda's default sampling", () => {
  it("records every request below one per second", () => {
    expect(sampledPerSecond(0.38)).toBeCloseTo(0.38);
    // 1,000,000 requests a month is 0.38 per second: all of them are traced.
    expect(tracesPerMonth(1_000_000)).toBe(1_000_000);
  });

  it("records one per second plus 5% of the rest above that", () => {
    expect(sampledPerSecond(1)).toBe(1);
    expect(sampledPerSecond(101)).toBe(6);
    // 100,000,000 requests a month is about 38 per second.
    expect(tracesPerMonth(100_000_000)).toBe(7_496_600);
  });
});
