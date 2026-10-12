import { describe, expect, it } from "vite-plus/test";

import { MemoryCounterStore } from "../src/memory-store.ts";
import {
  createRateLimiter,
  slidingCap,
  slidingRetryAfterMs,
  windowStartOf,
} from "../src/rate-limit.ts";
import type { CounterStore, IncrementResult, WindowRef } from "../src/stores.ts";

const MINUTE = 60_000;
// Any multiple of a minute: the start of a window.
const T0 = 29_000_000 * MINUTE;

const fixed = (limit: number, store: CounterStore = new MemoryCounterStore()) =>
  createRateLimiter(store, { limit, windowMs: MINUTE, algorithm: "fixed" });
const sliding = (limit: number, store: CounterStore = new MemoryCounterStore()) =>
  createRateLimiter(store, { limit, windowMs: MINUTE, algorithm: "sliding" });

async function hits(
  limiter: ReturnType<typeof fixed>,
  count: number,
  at: number,
): Promise<boolean[]> {
  const allowed = [];
  for (let index = 0; index < count; index++) {
    allowed.push((await limiter.hit("client-1", at)).allowed);
  }
  return allowed;
}

describe("fixed window", () => {
  it("allows exactly `limit` requests, counting down what is left", async () => {
    const limiter = fixed(3);
    expect(await limiter.hit("client-1", T0)).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect((await limiter.hit("client-1", T0 + 1)).remaining).toBe(1);
    expect((await limiter.hit("client-1", T0 + 2)).remaining).toBe(0);
    expect(await limiter.hit("client-1", T0 + 3)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("refuses until the last millisecond of the window and allows again at the next one", async () => {
    const limiter = fixed(1);
    await limiter.hit("client-1", T0);
    expect(await limiter.hit("client-1", T0 + MINUTE - 1)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(await limiter.hit("client-1", T0 + MINUTE)).toMatchObject({ allowed: true });
  });

  it("says how long until the window ends", async () => {
    const limiter = fixed(1);
    await limiter.hit("client-1", T0);
    expect((await limiter.hit("client-1", T0 + 15_000)).retryAfterSeconds).toBe(45);
  });

  it("counts each client separately", async () => {
    const limiter = fixed(1);
    await limiter.hit("client-1", T0);
    expect((await limiter.hit("client-2", T0)).allowed).toBe(true);
  });

  it("lets 2 x limit through in two seconds around a boundary", async () => {
    const limiter = fixed(5);
    const before = await hits(limiter, 5, T0 + MINUTE - 1_000);
    const after = await hits(limiter, 5, T0 + MINUTE + 1_000);
    expect([...before, ...after].filter(Boolean)).toHaveLength(10);
  });
});

describe("sliding window", () => {
  it("still remembers the previous window just after a boundary", async () => {
    const limiter = sliding(5);
    await hits(limiter, 5, T0 + MINUTE - 1_000);
    // The same burst that the fixed window let through.
    expect((await hits(limiter, 5, T0 + MINUTE + 1_000)).filter(Boolean)).toHaveLength(0);
  });

  it("gives the budget back as the previous window slides out", async () => {
    const limiter = sliding(10);
    await hits(limiter, 10, T0);
    expect((await limiter.hit("client-1", T0 + MINUTE)).allowed).toBe(false);
    // Half a window later, half of the previous count has slid out.
    expect((await hits(limiter, 10, T0 + MINUTE + 30_000)).filter(Boolean)).toHaveLength(5);
  });

  it("is the fixed window when the previous window was empty", async () => {
    const limiter = sliding(3);
    expect((await hits(limiter, 4, T0 + 10_000)).filter(Boolean)).toHaveLength(3);
  });

  it("computes the cap from the share of the previous window still in view", () => {
    expect(slidingCap(10, 10, 0, MINUTE)).toBe(0);
    expect(slidingCap(10, 10, 30_000, MINUTE)).toBe(5);
    expect(slidingCap(10, 4, 15_000, MINUTE)).toBe(7);
    expect(slidingCap(10, 0, 0, MINUTE)).toBe(10);
  });

  it("hints at the earliest moment the budget grows by one", () => {
    // Previous 10, nothing left: one unit comes back every 6 seconds.
    expect(slidingRetryAfterMs(10, 10, 0, MINUTE)).toBe(6_000);
    // Previous empty and this window full: wait for the window, then for one unit of decay.
    expect(slidingRetryAfterMs(10, 0, 20_000, MINUTE)).toBe(40_000 + 6_000);
  });

  it("answers with that hint when it refuses", async () => {
    const limiter = sliding(10);
    await hits(limiter, 10, T0);
    expect((await limiter.hit("client-1", T0 + MINUTE)).retryAfterSeconds).toBe(6);
  });
});

describe("window alignment", () => {
  it("puts every caller in the same window, whenever it started", () => {
    expect(windowStartOf(T0, MINUTE)).toBe(T0);
    expect(windowStartOf(T0 + MINUTE - 1, MINUTE)).toBe(T0);
    expect(windowStartOf(T0 + MINUTE, MINUTE)).toBe(T0 + MINUTE);
  });
});

describe("concurrent requests", () => {
  it("admits exactly `limit` of 20 simultaneous requests", async () => {
    const limiter = fixed(5);
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => limiter.hit("client-1", T0)),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });

  // #region lost-update
  /** What not to build: reads the count, then writes count + 1 as a second step. */
  class ReadThenWriteStore implements CounterStore {
    readonly counts = new Map<number, number>();
    #waiting: (() => void)[] = [];

    async incrementBelow(window: WindowRef, cap: number): Promise<IncrementResult> {
      const count = this.counts.get(window.windowStart) ?? 0;
      // Both callers have read before either writes: the interleaving a real network produces now and then.
      await new Promise<void>((resolve) => {
        this.#waiting.push(resolve);
        if (this.#waiting.length === 2) {
          this.#waiting.splice(0).forEach((release) => release());
        }
      });
      if (count >= cap) {
        return { accepted: false };
      }
      this.counts.set(window.windowStart, count + 1);
      return { accepted: true, count: count + 1 };
    }

    async read(window: Pick<WindowRef, "windowStart">): Promise<number> {
      return this.counts.get(window.windowStart) ?? 0;
    }
  }

  it("is broken by a store that reads and then writes: two pass a limit of one", async () => {
    const store = new ReadThenWriteStore();
    const limiter = fixed(1, store);
    const [first, second] = await Promise.all([
      limiter.hit("client-1", T0),
      limiter.hit("client-1", T0),
    ]);
    expect([first.allowed, second.allowed]).toEqual([true, true]);
    // And one of the two increments is gone.
    expect(await store.read({ windowStart: T0 })).toBe(1);
  });
  // #endregion lost-update
});
