import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { MemoryCacheStore, MemoryCounterStore } from "../src/memory-store.ts";
import { createRateLimiter } from "../src/rate-limit.ts";
import { describeCacheContract, describeCounterContract, fakeClock } from "./store-contracts.ts";

describeCounterContract("memory", async () => ({
  store: new MemoryCounterStore(),
  subject: randomUUID(),
}));
describeCacheContract("memory", async () => ({
  store: new MemoryCacheStore(),
  prefix: randomUUID(),
  clock: fakeClock(),
}));

// Not bugs: this is what "kept in the execution environment" means.
describe("memory stores, one per execution environment", () => {
  const policy = { limit: 3, windowMs: 60_000, algorithm: "fixed" as const };

  it("lets a client through `limit` times in each environment", async () => {
    const environmentA = createRateLimiter(new MemoryCounterStore(), policy);
    const environmentB = createRateLimiter(new MemoryCounterStore(), policy);
    const allowed = [];
    for (let request = 0; request < 4; request++) {
      allowed.push(
        (await environmentA.hit("client-1", 1_000)).allowed,
        (await environmentB.hit("client-1", 1_000)).allowed,
      );
    }
    // 3 per environment, so 6 in total against a limit of 3.
    expect(allowed.filter(Boolean)).toHaveLength(6);
  });

  it("does not show one environment what another one cached", async () => {
    const environmentA = new MemoryCacheStore();
    const environmentB = new MemoryCacheStore();
    await environmentA.set("list", { value: "v1", expiresAt: 2_000 });
    expect(await environmentB.get("list", 1_000)).toBeUndefined();
  });

  it("drops old windows only when asked to", async () => {
    const store = new MemoryCounterStore();
    await store.incrementBelow({ subject: "client-1", windowStart: 0, expiresAt: 120_000 }, 5);
    store.sweep(119_999);
    expect(await store.read({ subject: "client-1", windowStart: 0 })).toBe(1);
    store.sweep(120_000);
    expect(await store.read({ subject: "client-1", windowStart: 0 })).toBe(0);
  });
});
