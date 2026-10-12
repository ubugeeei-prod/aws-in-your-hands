import { describe, expect, it } from "vite-plus/test";

import { requestRateLimit, requiredConcurrency, reservable, simulate } from "../src/concurrency.ts";

describe("concurrency is not requests per second", () => {
  it("is the rate times the duration", () => {
    // The three examples in the Lambda documentation.
    expect(requiredConcurrency(100, 1)).toBe(100);
    expect(requiredConcurrency(100, 0.5)).toBe(50);
    expect(requiredConcurrency(5000, 0.2)).toBe(1000);
  });

  it("is capped a second time by a request rate of ten per unit", () => {
    // 20,000 requests a second at 50 ms need 1,000 environments, yet 1,000 allow only 10,000 a second.
    expect(requiredConcurrency(20_000, 0.05)).toBe(1000);
    expect(requestRateLimit(1000)).toBe(10_000);
  });
});

describe("what an account can reserve", () => {
  it("leaves 100 for the functions without a reservation", () => {
    expect(reservable({ limit: 1000, alreadyReserved: 0 })).toBe(900);
    expect(reservable({ limit: 1000, alreadyReserved: 400 })).toBe(500);
  });

  it("is nothing while the account's limit is at or below 100", () => {
    expect(reservable({ limit: 10, alreadyReserved: 0 })).toBe(0);
    expect(reservable({ limit: 100, alreadyReserved: 0 })).toBe(0);
  });
});

describe("requests and environments", () => {
  // Ten requests that fall the way the documentation's walk-through does. The timings are ours.
  const arrivalsMs = [0, 100, 200, 300, 400, 510, 610, 710, 720, 810];

  it("starts a new environment only when every existing one is busy", () => {
    const run = simulate({ arrivalsMs, durationMs: 500, initMs: 0 });
    expect(run.outcomes.map((outcome) => outcome.result)).toEqual([
      "cold",
      "cold",
      "cold",
      "cold",
      "cold",
      "warm",
      "warm",
      "warm",
      "cold",
      "warm",
    ]);
    expect(run.environments).toBe(6);
  });

  it("needs more environments for the same requests when the handler is slower", () => {
    const fast = simulate({ arrivalsMs, durationMs: 90, initMs: 0 });
    const slow = simulate({ arrivalsMs, durationMs: 900, initMs: 0 });
    // Two arrive 10 ms apart, so even the fast handler needs a second environment.
    expect(fast.cold).toBe(2);
    expect(slow.cold).toBe(10);
  });

  it("keeps an environment busy through its own initialization", () => {
    // 50 ms handler, but the first request also waits 300 ms: the second one finds nothing free.
    const run = simulate({ arrivalsMs: [0, 100, 400], durationMs: 50, initMs: 300 });
    expect(run.outcomes).toEqual([
      { atMs: 0, result: "cold", latencyMs: 350 },
      { atMs: 100, result: "cold", latencyMs: 350 },
      { atMs: 400, result: "warm", latencyMs: 50 },
    ]);
  });

  it("refuses requests past the reserved concurrency instead of starting environments", () => {
    const burst = [0, 0, 0, 0, 0];
    const run = simulate({ arrivalsMs: burst, durationMs: 100, initMs: 0, reserved: 2 });
    expect(run).toMatchObject({ cold: 2, throttled: 3, environments: 2 });
    // The refused requests are not queued: when the burst is over they are gone.
    expect(run.outcomes.filter((outcome) => outcome.latencyMs === undefined)).toHaveLength(3);
  });

  it("serves a burst from provisioned environments and spills the rest into cold starts", () => {
    const burst = [0, 0, 0, 0, 0];
    const run = simulate({ arrivalsMs: burst, durationMs: 100, initMs: 300, provisioned: 2 });
    expect(run).toMatchObject({ warm: 2, cold: 3, throttled: 0, environments: 5 });
    expect(run.outcomes.map((outcome) => outcome.latencyMs)).toEqual([100, 100, 400, 400, 400]);
  });

  it("cannot be both provisioned and held below that by a reservation", () => {
    const run = simulate({
      arrivalsMs: [0, 0, 0],
      durationMs: 100,
      initMs: 300,
      provisioned: 2,
      reserved: 2,
    });
    expect(run).toMatchObject({ warm: 2, cold: 0, throttled: 1 });
  });
});
