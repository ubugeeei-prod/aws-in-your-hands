import { describe, expect, it } from "vite-plus/test";

import { backoffCeilingMs, backoffDelayMs, worstCaseWaitMs } from "../src/backoff.ts";
import { seeded } from "../src/random.ts";

const none = { baseMs: 100, capMs: 2000, jitter: "none" } as const;
const full = { ...none, jitter: "full" } as const;

describe("backoff", () => {
  it("doubles the wait with every retry, up to the cap", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((retry) => backoffCeilingMs(none, retry))).toEqual([
      100, 200, 400, 800, 1600, 2000, 2000,
    ]);
  });

  it("without jitter, gives every caller the same wait", () => {
    const waits = Array.from({ length: 100 }, () => backoffDelayMs(none, 2, seeded(7)));
    expect(new Set(waits)).toEqual(new Set([400]));
  });

  it("with full jitter, spreads callers over the whole window and never past it", () => {
    const random = seeded(7);
    const waits = Array.from({ length: 1000 }, () => backoffDelayMs(full, 2, random));
    expect(Math.max(...waits)).toBeLessThan(400);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(0);
    // Every tenth of the window gets its share: none is empty, none holds a crowd.
    const tenths = Array<number>(10).fill(0);
    for (const wait of waits) {
      tenths[Math.floor(wait / 40)]! += 1;
    }
    expect(Math.min(...tenths)).toBeGreaterThan(70);
    expect(Math.max(...tenths)).toBeLessThan(130);
  });

  it("adds up the longest wait a caller can meet", () => {
    expect(worstCaseWaitMs(none, 1)).toBe(0);
    expect(worstCaseWaitMs(none, 4)).toBe(100 + 200 + 400);
    expect(worstCaseWaitMs(none, 8)).toBe(100 + 200 + 400 + 800 + 1600 + 2000 + 2000);
  });
});

describe("seeded random numbers", () => {
  it("repeat exactly for the same seed and differ for another", () => {
    const first = Array.from({ length: 5 }, seeded(32));
    expect(Array.from({ length: 5 }, seeded(32))).toEqual(first);
    expect(Array.from({ length: 5 }, seeded(33))).not.toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
