import { describe, expect, it } from "vite-plus/test";

import { SDK_RETRY_BUDGET } from "../src/sdk-retry.ts";
import { outage, peakRetries, reconnect, sentBetween, simulate } from "../src/simulation.ts";

describe("a thousand callers that start at the same instant", () => {
  const none = simulate(reconnect("none"));
  const full = simulate(reconnect("full"));

  it("without jitter, come back together every time and are refused together", () => {
    // All 900 that the first burst refused return in the same 10 ms.
    expect(peakRetries(none)).toBe(900);
    expect(none).toMatchObject({ calls: 1000, succeeded: 640, gaveUp: 360, unfinished: 0 });
  });

  it("with full jitter, arrive spread out, and nearly all get through", () => {
    expect(peakRetries(full)).toBe(130);
    expect(full).toMatchObject({ calls: 1000, succeeded: 988, gaveUp: 12, unfinished: 0 });
  });

  it("with full jitter, the service also sees fewer requests", () => {
    expect(none.sent).toBe(6060);
    expect(full.sent).toBe(5635);
  });

  it("gives the same numbers on every run", () => {
    expect(simulate(reconnect("full"))).toEqual(full);
  });

  it("accounts for every call", () => {
    for (const outcome of [none, full]) {
      expect(outcome.succeeded + outcome.gaveUp + outcome.unfinished).toBe(outcome.calls);
    }
  });
});

describe("three seconds in which the service refuses everything", () => {
  const unlimited = simulate(outage(undefined));
  const budgeted = simulate(outage(SDK_RETRY_BUDGET));
  // 5 calls every 10 ms for 300 ticks.
  const firstAttempts = 1500;

  it("without a budget, nearly triples what the failing service has to refuse", () => {
    expect(sentBetween(unlimited, 200, 500)).toBe(4388);
    expect(sentBetween(unlimited, 200, 500) / firstAttempts).toBeGreaterThan(2.9);
  });

  it("with a budget, adds a hundred retries and then only first attempts", () => {
    expect(sentBetween(budgeted, 200, 500)).toBe(firstAttempts + 100);
    expect(budgeted.heldBack).toBe(1464);
  });

  it("costs the budget's callers the retries that would have landed after the recovery", () => {
    expect(unlimited.gaveUp).toBe(1420);
    expect(budgeted.gaveUp).toBe(1500);
  });

  it("lets retries out again once calls succeed", () => {
    const after = budgeted.timeline.slice(500);
    expect(after.every((tick) => tick.succeeded === tick.fresh + tick.retries)).toBe(true);
    // Nothing is refused after the recovery, so the last 500 ticks need no retry.
    expect(after.slice(100).every((tick) => tick.retries === 0)).toBe(true);
  });
});
