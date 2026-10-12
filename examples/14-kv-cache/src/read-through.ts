import { z } from "zod";

import type { CacheStore } from "./stores.ts";

export type Loaded<T> = {
  value: T;
  /** `origin`: this call asked the source of truth. */
  source: "cache" | "origin";
  /** When the value left the source of truth. It can only be older than that, never newer. */
  loadedAt: number;
};

export type ReadThroughOptions<T> = {
  store: CacheStore;
  /** What a cached value must look like. Anything else in the store is a miss. */
  schema: z.ZodType<T>;
  ttlMs: number;
  /** 0.2 stretches each TTL by up to 20 %, so entries written together do not expire together. */
  jitter: number;
  random: () => number;
  now: () => number;
  /** Lets one caller refill an entry while the others wait. Without it every caller that misses loads. */
  lock?: {
    ttlMs: number;
    waitMs: number;
    maxWaits: number;
    newOwner: () => string;
    sleep: (ms: number) => Promise<void>;
  };
  /** The cache failed. The request goes on without it. */
  onStoreError?: (error: unknown) => void;
};

export type ReadThrough<T> = {
  get(key: string, load: () => Promise<T>): Promise<Loaded<T>>;
  /** Call after changing the source. It narrows the stale window; it does not close it. */
  invalidate(key: string): Promise<void>;
};

// #region jitter
export function jitteredTtl(ttlMs: number, jitter: number, random: () => number): number {
  return Math.round(ttlMs * (1 + jitter * random()));
}
// #endregion jitter

export function createReadThrough<T>(options: ReadThroughOptions<T>): ReadThrough<T> {
  const { store, now } = options;
  const envelope = z.object({ loadedAt: z.number(), value: options.schema });
  const inFlight = new Map<string, Promise<Loaded<T>>>();
  const report = (error: unknown): void => options.onStoreError?.(error);

  // #region optional
  // Every store call is wrapped like this. A cache that is down, slow, or
  // holding something unreadable makes the request slower, never wrong.
  async function read(key: string): Promise<Loaded<T> | undefined> {
    try {
      const raw = await store.get(key, now());
      if (raw === undefined) {
        return undefined;
      }
      const parsed = envelope.safeParse(JSON.parse(raw));
      return parsed.success
        ? { value: parsed.data.value, source: "cache", loadedAt: parsed.data.loadedAt }
        : undefined;
    } catch (error) {
      report(error);
      return undefined;
    }
  }
  // #endregion optional

  async function loadAndStore(key: string, load: () => Promise<T>): Promise<Loaded<T>> {
    const loadedAt = now();
    const value = await load();
    try {
      await store.set(key, {
        value: JSON.stringify({ loadedAt, value }),
        expiresAt: now() + jitteredTtl(options.ttlMs, options.jitter, options.random),
      });
    } catch (error) {
      report(error);
    }
    return { value, source: "origin", loadedAt };
  }

  // #region lock
  async function refill(key: string, load: () => Promise<T>): Promise<Loaded<T>> {
    const lock = options.lock;
    if (lock === undefined) {
      return loadAndStore(key, load);
    }
    const owner = lock.newOwner();
    for (let attempt = 0; attempt <= lock.maxWaits; attempt++) {
      let held: boolean;
      try {
        held = await store.tryLock(key, owner, now() + lock.ttlMs, now());
      } catch (error) {
        report(error);
        // No store, no lock to wait for.
        return loadAndStore(key, load);
      }
      if (held) {
        try {
          // Someone may have filled it between our miss and our lock.
          return (await read(key)) ?? (await loadAndStore(key, load));
        } finally {
          await store.unlock(key, owner).catch(report);
        }
      }
      await lock.sleep(lock.waitMs);
      const filled = await read(key);
      if (filled !== undefined) {
        return filled;
      }
    }
    // Waited long enough. The source still has the answer; the lock was only there to spare it.
    return loadAndStore(key, load);
  }
  // #endregion lock

  return {
    // #region single-flight
    async get(key, load) {
      const cached = await read(key);
      if (cached !== undefined) {
        return cached;
      }
      // Callers in this process that miss the same key share one load.
      const running = inFlight.get(key);
      if (running !== undefined) {
        return running;
      }
      const started = refill(key, load).finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
    // #endregion single-flight
    async invalidate(key) {
      // Not swallowed: if this fails, the old value stays until its TTL, and the writer should know.
      await store.delete(key);
    },
  };
}
