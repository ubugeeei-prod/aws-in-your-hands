import { describe, expect, it } from "vite-plus/test";

import { DPU_PER_WORKER, dpuHours, MINIMUM_BILLED_SECONDS } from "../src/cost.ts";

const job = { dpus: 2 * DPU_PER_WORKER["G.1X"], minimumSeconds: MINIMUM_BILLED_SECONDS.job };

describe("what a run is billed", () => {
  it("is never less than a minute of every worker", () => {
    expect(dpuHours({ ...job, seconds: 0 })).toBe(dpuHours({ ...job, seconds: 60 }));
    expect(dpuHours({ ...job, seconds: 12 })).toBeCloseTo(2 / 60, 6);
  });

  it("is by the second after that", () => {
    expect(dpuHours({ ...job, seconds: 90 })).toBeCloseTo((2 * 90) / 3600, 6);
    expect(dpuHours({ ...job, seconds: 90.2 })).toBeCloseTo((2 * 91) / 3600, 6);
  });

  // The quantities in data/fragments/43.json, so that a change here is seen there.
  it("gives the quantities the pricing scenarios use", () => {
    expect(dpuHours({ ...job, seconds: 60, runs: 30 })).toBe(1);
    expect(dpuHours({ ...job, seconds: 180, runs: 30 })).toBe(3);
    expect(dpuHours({ ...job, seconds: 600, runs: 30 })).toBe(10);
    // The default timeout of AWS Glue 5.0 and later, for one run that never ends by itself.
    expect(dpuHours({ ...job, seconds: 480 * 60 })).toBe(16);
  });
});

describe("what a crawl is billed", () => {
  it("is never less than ten minutes", () => {
    const crawl = { dpus: 2, minimumSeconds: MINIMUM_BILLED_SECONDS.crawler };
    expect(dpuHours({ ...crawl, seconds: 45 })).toBeCloseTo(2 / 6, 6);
    expect(dpuHours({ ...crawl, seconds: 45, runs: 30 })).toBe(10);
  });
});
