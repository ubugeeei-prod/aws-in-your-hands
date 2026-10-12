import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { CacheStore, CounterStore } from "../src/stores.ts";

// What every store has to do, whatever it is made of. The memory stores run
// this on every `vp run test:unit`; Valkey and DynamoDB Local run it through
// `vp run kv:test:local`.

export function describeCounterContract(
  name: string,
  setup: () => Promise<{ store: CounterStore; subject: string }>,
): void {
  describe(`CounterStore contract: ${name}`, () => {
    let store: CounterStore;
    let subject: string;
    const window = (windowStart = 60_000) => ({
      subject,
      windowStart,
      expiresAt: Date.now() + 120_000,
    });

    beforeEach(async () => {
      ({ store, subject } = await setup());
    });

    it("counts from one and reads zero where nothing was counted", async () => {
      expect(await store.read(window())).toBe(0);
      expect(await store.incrementBelow(window(), 3)).toEqual({ accepted: true, count: 1 });
      expect(await store.incrementBelow(window(), 3)).toEqual({ accepted: true, count: 2 });
      expect(await store.read(window())).toBe(2);
    });

    it("refuses at the cap and leaves the counter where it was", async () => {
      await store.incrementBelow(window(), 2);
      await store.incrementBelow(window(), 2);
      expect(await store.incrementBelow(window(), 2)).toEqual({ accepted: false });
      expect(await store.read(window())).toBe(2);
    });

    it("takes the cap per call, as the sliding window needs", async () => {
      await store.incrementBelow(window(), 5);
      expect(await store.incrementBelow(window(), 1)).toEqual({ accepted: false });
      expect(await store.incrementBelow(window(), 5)).toEqual({ accepted: true, count: 2 });
    });

    it("keeps windows and subjects apart", async () => {
      await store.incrementBelow(window(60_000), 1);
      expect(await store.incrementBelow(window(120_000), 1)).toEqual({ accepted: true, count: 1 });
      expect(await store.read({ subject: `${subject}-other`, windowStart: 60_000 })).toBe(0);
    });

    it("loses no increment and admits none too many when 50 arrive at once", async () => {
      const results = await Promise.all(
        Array.from({ length: 50 }, () => store.incrementBelow(window(), 20)),
      );
      const counts = results.flatMap((result) => (result.accepted ? [result.count] : []));
      expect(counts.toSorted((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      expect(await store.read(window())).toBe(20);
    });
  });
}

export type ContractClock = { now: () => number; advance: (ms: number) => Promise<void> };

export function describeCacheContract(
  name: string,
  setup: () => Promise<{ store: CacheStore; prefix: string; clock: ContractClock }>,
): void {
  describe(`CacheStore contract: ${name}`, () => {
    let store: CacheStore;
    let clock: ContractClock;
    let key: string;
    const TTL = 300;

    beforeEach(async () => {
      let prefix: string;
      ({ store, prefix, clock } = await setup());
      key = `${prefix}:list`;
    });

    it("returns what was set, replaces it, and forgets it on delete", async () => {
      expect(await store.get(key, clock.now())).toBeUndefined();
      await store.set(key, { value: "v1", expiresAt: clock.now() + 60_000 });
      await store.set(key, { value: "v2", expiresAt: clock.now() + 60_000 });
      expect(await store.get(key, clock.now())).toBe("v2");
      await store.delete(key);
      expect(await store.get(key, clock.now())).toBeUndefined();
    });

    it("never returns an entry after its expiry", async () => {
      await store.set(key, { value: "v1", expiresAt: clock.now() + TTL });
      expect(await store.get(key, clock.now())).toBe("v1");
      await clock.advance(TTL + 200);
      expect(await store.get(key, clock.now())).toBeUndefined();
    });

    it("gives the lock to one owner at a time", async () => {
      expect(await store.tryLock(key, "a", clock.now() + 60_000, clock.now())).toBe(true);
      expect(await store.tryLock(key, "b", clock.now() + 60_000, clock.now())).toBe(false);
      await store.unlock(key, "a");
      expect(await store.tryLock(key, "b", clock.now() + 60_000, clock.now())).toBe(true);
    });

    it("ignores an unlock from someone who does not hold the lock", async () => {
      await store.tryLock(key, "a", clock.now() + 60_000, clock.now());
      await store.unlock(key, "b");
      expect(await store.tryLock(key, "b", clock.now() + 60_000, clock.now())).toBe(false);
    });

    it("frees a lock whose holder never came back", async () => {
      await store.tryLock(key, "a", clock.now() + TTL, clock.now());
      await clock.advance(TTL + 200);
      expect(await store.tryLock(key, "b", clock.now() + 60_000, clock.now())).toBe(true);
    });

    it("keeps the lock apart from the cached value", async () => {
      await store.set(key, { value: "v1", expiresAt: clock.now() + 60_000 });
      await store.tryLock(key, "a", clock.now() + 60_000, clock.now());
      await store.unlock(key, "a");
      expect(await store.get(key, clock.now())).toBe("v1");
    });
  });
}

export function fakeClock(start = 1_760_000_000_000): ContractClock {
  let now = start;
  return {
    now: () => now,
    advance: async (ms) => {
      now += ms;
    },
  };
}
