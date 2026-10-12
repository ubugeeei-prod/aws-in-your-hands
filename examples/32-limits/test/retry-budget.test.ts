import { describe, expect, it } from "vite-plus/test";

import { createRetryBudget } from "../src/retry-budget.ts";
import { SDK_RETRY_BUDGET } from "../src/sdk-retry.ts";

describe("retry budget", () => {
  it("lets out a hundred retries when nothing succeeds, then none", () => {
    const budget = createRetryBudget(SDK_RETRY_BUDGET);
    const spent = Array.from({ length: 150 }, () => budget.spend());

    expect(spent.filter(Boolean)).toHaveLength(100);
    expect(spent.slice(100).some(Boolean)).toBe(false);
    expect(budget.available()).toBe(0);
  });

  it("earns one retry back for every five calls that succeed first time", () => {
    const budget = createRetryBudget(SDK_RETRY_BUDGET);
    while (budget.spend()) {
      // Drain it.
    }
    for (let index = 0; index < 4; index++) {
      budget.succeeded(false);
    }
    expect(budget.spend()).toBe(false);
    budget.succeeded(false);
    expect(budget.spend()).toBe(true);
  });

  it("gives a retry's whole cost back when that retry succeeds", () => {
    const budget = createRetryBudget(SDK_RETRY_BUDGET);
    budget.spend();
    budget.succeeded(true);
    expect(budget.available()).toBe(SDK_RETRY_BUDGET.capacity);
  });

  it("never holds more than its capacity", () => {
    const budget = createRetryBudget(SDK_RETRY_BUDGET);
    for (let index = 0; index < 1000; index++) {
      budget.succeeded(false);
    }
    expect(budget.available()).toBe(SDK_RETRY_BUDGET.capacity);
  });
});
