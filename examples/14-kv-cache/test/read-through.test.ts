import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { MemoryCacheStore } from "../src/memory-store.ts";
import { createReadThrough, jitteredTtl, type ReadThroughOptions } from "../src/read-through.ts";
import type { CacheStore } from "../src/stores.ts";

const TTL = 30_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets every promise that can settle without outside help do so. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 100; turn++) {
    await Promise.resolve();
  }
};

/** A source of truth that counts how often it is asked. */
function source(initial: string) {
  const state = { value: initial, loads: 0 };
  return {
    state,
    load: async () => {
      state.loads++;
      return state.value;
    },
  };
}

function setup(overrides: Partial<ReadThroughOptions<string>> = {}) {
  const clock = { now: 1_760_000_000_000 };
  const store = new MemoryCacheStore();
  const options: ReadThroughOptions<string> = {
    store,
    schema: v.string(),
    ttlMs: TTL,
    jitter: 0,
    random: () => 0,
    now: () => clock.now,
    ...overrides,
  };
  return { clock, store, options, cache: createReadThrough(options) };
}

describe("read-through cache", () => {
  it("asks the source once, then answers from the cache until the TTL passes", async () => {
    const { cache, clock } = setup();
    const origin = source("v1");
    expect(await cache.get("list", origin.load)).toEqual({
      value: "v1",
      source: "origin",
      loadedAt: clock.now,
    });
    clock.now += TTL - 1;
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v1", source: "cache" });
    expect(origin.state.loads).toBe(1);
    clock.now += 1;
    expect(await cache.get("list", origin.load)).toMatchObject({ source: "origin" });
    expect(origin.state.loads).toBe(2);
  });

  it("reports when a cached value left the source, not when it was served", async () => {
    const { cache, clock } = setup();
    const origin = source("v1");
    const loadedAt = clock.now;
    await cache.get("list", origin.load);
    clock.now += 12_000;
    expect((await cache.get("list", origin.load)).loadedAt).toBe(loadedAt);
  });
});

describe("stale reads", () => {
  // #region stale
  it("serves the old value after the source changed, for up to one TTL", async () => {
    const { cache, clock } = setup();
    const origin = source("v1");
    await cache.get("list", origin.load);

    origin.state.value = "v2";
    clock.now += TTL - 1;
    expect((await cache.get("list", origin.load)).value).toBe("v1");
    clock.now += 1;
    expect((await cache.get("list", origin.load)).value).toBe("v2");
  });

  it("serves the new value at once when the writer invalidates", async () => {
    const { cache } = setup();
    const origin = source("v1");
    await cache.get("list", origin.load);

    origin.state.value = "v2";
    await cache.invalidate("list");
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v2", source: "origin" });
  });

  it("can still cache the old value when a slow read straddles the write", async () => {
    const { cache, clock } = setup();
    const slowRead = deferred<string>();

    // 1. A reader misses and asks the source, which answers "v1" slowly.
    const reader = cache.get("list", () => slowRead.promise);
    await settle();
    // 2. The writer changes the source to "v2" and invalidates. There is nothing to delete yet.
    await cache.invalidate("list");
    // 3. The reader's answer arrives and goes into the cache.
    slowRead.resolve("v1");
    await reader;

    // The cache now says "v1" although the source says "v2", and no one will invalidate again.
    const origin = source("v2");
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v1", source: "cache" });
    // The TTL is what bounds it.
    clock.now += TTL;
    expect((await cache.get("list", origin.load)).value).toBe("v2");
  });
  // #endregion stale
});

describe("cache stampede", () => {
  const CALLERS = 10;

  it("sends every caller to the source when nothing coordinates them", async () => {
    // Ten execution environments: each has its own read-through, all share the store.
    const { store, options } = setup();
    const gate = deferred<string>();
    let loads = 0;
    const load = () => {
      loads++;
      return gate.promise;
    };
    const environments = Array.from({ length: CALLERS }, () =>
      createReadThrough({ ...options, store }),
    );

    const pending = environments.map((environment) => environment.get("list", load));
    await settle();
    expect(loads).toBe(CALLERS);
    gate.resolve("v1");
    await Promise.all(pending);
  });

  // #region single-flight-test
  it("shares one load between callers in the same process", async () => {
    const { cache } = setup();
    const gate = deferred<string>();
    let loads = 0;
    const load = () => {
      loads++;
      return gate.promise;
    };

    const pending = Array.from({ length: CALLERS }, () => cache.get("list", load));
    await settle();
    expect(loads).toBe(1);
    gate.resolve("v1");
    expect((await Promise.all(pending)).map((loaded) => loaded.value)).toEqual(
      Array(CALLERS).fill("v1"),
    );
  });
  // #endregion single-flight-test

  // #region lock-test
  it("lets one environment refill while the others wait for the cache", async () => {
    const { store, options } = setup();
    const gate = deferred<string>();
    const filled = deferred<void>();
    let loads = 0;
    let owners = 0;
    const load = () => {
      loads++;
      return gate.promise;
    };
    const environments = Array.from({ length: CALLERS }, () =>
      createReadThrough({
        ...options,
        store,
        // "Sleeping" ends when the test says the winner has filled the cache.
        lock: {
          ttlMs: 5_000,
          waitMs: 100,
          maxWaits: 3,
          newOwner: () => `owner-${owners++}`,
          sleep: () => filled.promise,
        },
      }),
    );

    const pending = environments.map((environment) => environment.get("list", load));
    await settle();
    expect(loads).toBe(1);

    gate.resolve("v1");
    const winner = await pending[0];
    filled.resolve();
    const results = await Promise.all(pending);

    expect(winner?.source).toBe("origin");
    expect(results.filter((loaded) => loaded.source === "cache")).toHaveLength(CALLERS - 1);
    expect(loads).toBe(1);
  });
  // #endregion lock-test

  it("does not wait forever for a lock holder that died", async () => {
    const { store, options, clock } = setup();
    // An environment took the lock and was then frozen or killed.
    await store.tryLock("list", "ghost", clock.now + 5_000, clock.now);
    const origin = source("v1");
    const cache = createReadThrough({
      ...options,
      lock: {
        ttlMs: 5_000,
        waitMs: 2_000,
        maxWaits: 5,
        newOwner: () => "survivor",
        sleep: async (ms) => {
          clock.now += ms;
        },
      },
    });

    // Three waits of 2 s pass the ghost's 5 s; the fourth attempt takes the lock.
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v1", source: "origin" });
    expect(origin.state.loads).toBe(1);
  });

  it("goes to the source after waiting as long as it was told to", async () => {
    const { store, options, clock } = setup();
    await store.tryLock("list", "ghost", clock.now + 60_000, clock.now);
    const origin = source("v1");
    const cache = createReadThrough({
      ...options,
      lock: {
        ttlMs: 5_000,
        waitMs: 100,
        maxWaits: 2,
        newOwner: () => "impatient",
        sleep: async () => {},
      },
    });
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v1", source: "origin" });
  });
});

describe("TTL jitter", () => {
  // #region jitter-test
  const KEYS = ["a", "b", "c", "d", "e"];

  async function missesJustAfterTtl(jitter: number): Promise<number> {
    const spread = [0, 0.25, 0.5, 0.75, 0.99];
    const { cache, clock } = setup({ jitter, random: () => spread.shift() ?? 0 });
    const origin = source("v1");
    // Five entries written in the same instant, as after a deploy or a cache restart.
    for (const key of KEYS) {
      await cache.get(key, origin.load);
    }
    clock.now += TTL;
    origin.state.loads = 0;
    for (const key of KEYS) {
      await cache.get(key, origin.load);
    }
    return origin.state.loads;
  }

  it("expires entries written together at the same instant without jitter", async () => {
    expect(await missesJustAfterTtl(0)).toBe(5);
  });

  it("spreads those expiries out with jitter", async () => {
    expect(await missesJustAfterTtl(0.2)).toBe(1);
  });
  // #endregion jitter-test

  it("only ever lengthens the TTL, by at most the given share", () => {
    expect(jitteredTtl(30_000, 0.2, () => 0)).toBe(30_000);
    expect(jitteredTtl(30_000, 0.2, () => 0.5)).toBe(33_000);
    expect(jitteredTtl(30_000, 0.2, () => 1)).toBe(36_000);
  });
});

describe("a cache that fails", () => {
  const broken = (failing: Partial<CacheStore>): CacheStore => {
    const store = new MemoryCacheStore();
    return {
      get: (key, now) => store.get(key, now),
      set: (key, entry) => store.set(key, entry),
      delete: (key) => store.delete(key),
      tryLock: (key, owner, expiresAt, now) => store.tryLock(key, owner, expiresAt, now),
      unlock: (key, owner) => store.unlock(key, owner),
      ...failing,
    };
  };
  const down = async (): Promise<never> => {
    throw new Error("connection refused");
  };

  it("answers from the source when the store cannot be read or written", async () => {
    const errors: unknown[] = [];
    const { cache } = setup({
      store: broken({ get: down, set: down }),
      onStoreError: (error) => errors.push(error),
    });
    const origin = source("v1");
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v1", source: "origin" });
    expect(await cache.get("list", origin.load)).toMatchObject({ value: "v1", source: "origin" });
    expect(errors).toHaveLength(4);
  });

  it("loads without a lock when the lock cannot be taken", async () => {
    const { cache } = setup({
      store: broken({ tryLock: down }),
      lock: { ttlMs: 5_000, waitMs: 100, maxWaits: 3, newOwner: () => "a", sleep: async () => {} },
    });
    expect(await cache.get("list", source("v1").load)).toMatchObject({
      value: "v1",
      source: "origin",
    });
  });

  it("treats a value it cannot read as a miss", async () => {
    const { cache, store, clock } = setup();
    await store.set("list", {
      value: JSON.stringify({ loadedAt: "yesterday", value: 42 }),
      expiresAt: clock.now + TTL,
    });
    expect(await cache.get("list", source("v1").load)).toMatchObject({
      value: "v1",
      source: "origin",
    });
    await store.set("list", { value: "not json", expiresAt: clock.now + TTL });
    expect(await cache.get("list", source("v1").load)).toMatchObject({
      value: "v1",
      source: "origin",
    });
  });

  it("tells the writer when an invalidation did not happen", async () => {
    const { cache } = setup({ store: broken({ delete: down }) });
    await expect(cache.invalidate("list")).rejects.toThrow("connection refused");
  });

  it("does not hide a failing source behind the cache", async () => {
    const { cache } = setup();
    await expect(cache.get("list", () => Promise.reject(new Error("source down")))).rejects.toThrow(
      "source down",
    );
    // And the failure is not remembered.
    expect(await cache.get("list", source("v1").load)).toMatchObject({ value: "v1" });
  });
});
