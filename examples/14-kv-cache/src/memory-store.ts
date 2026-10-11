import type { CacheEntry, CacheStore, CounterStore, IncrementResult, WindowRef } from "./stores.ts";

// One instance is one process: on Lambda, one execution environment. Nothing
// here is shared between two of them, and all of it goes when the process does.

// #region memory
export class MemoryCounterStore implements CounterStore {
  readonly #counters = new Map<string, { count: number; expiresAt: number }>();

  async incrementBelow(window: WindowRef, cap: number): Promise<IncrementResult> {
    const id = `${window.subject}\n${window.windowStart}`;
    const count = this.#counters.get(id)?.count ?? 0;
    // No `await` between the read and the write, so nothing can run in between.
    if (count >= cap) {
      return { accepted: false };
    }
    this.#counters.set(id, { count: count + 1, expiresAt: window.expiresAt });
    return { accepted: true, count: count + 1 };
  }

  async read(window: Pick<WindowRef, "subject" | "windowStart">): Promise<number> {
    return this.#counters.get(`${window.subject}\n${window.windowStart}`)?.count ?? 0;
  }

  /** Nothing else removes old windows; call it now and then. */
  sweep(now: number): void {
    for (const [id, counter] of this.#counters) {
      if (counter.expiresAt <= now) {
        this.#counters.delete(id);
      }
    }
  }
}

export class MemoryCacheStore implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #locks = new Map<string, { owner: string; expiresAt: number }>();

  async get(key: string, now: number): Promise<string | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.expiresAt <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.#entries.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async tryLock(key: string, owner: string, expiresAt: number, now: number): Promise<boolean> {
    const held = this.#locks.get(key);
    if (held !== undefined && held.expiresAt > now) {
      return false;
    }
    this.#locks.set(key, { owner, expiresAt });
    return true;
  }

  async unlock(key: string, owner: string): Promise<void> {
    if (this.#locks.get(key)?.owner === owner) {
      this.#locks.delete(key);
    }
  }
}
// #endregion memory
