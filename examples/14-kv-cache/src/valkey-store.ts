import { z } from "zod";

import type { CacheEntry, CacheStore, CounterStore, IncrementResult, WindowRef } from "./stores.ts";

// #region commands
/** The four commands the stores send. Both iovalkey's `Redis` and `Cluster` fit. */
export type ValkeyCommands = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, token: "PXAT", at: number): Promise<unknown>;
  set(key: string, value: string, token: "PXAT", at: number, nx: "NX"): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

/** Asked for before every command, so the connection behind it can be replaced. */
export type ValkeyProvider = () => Promise<ValkeyCommands>;
// #endregion commands

// #region scripts
// A script runs as one step on the server, like DynamoDB's condition and
// update. Each touches a single key, as cluster mode requires of a script.
export const INCREMENT_BELOW = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then
  return -1
end
count = redis.call('INCR', KEYS[1])
redis.call('PEXPIREAT', KEYS[1], ARGV[2])
return count
`;

export const UNLOCK_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
// #endregion scripts

const counterKey = (window: Pick<WindowRef, "subject" | "windowStart">): string =>
  `rate:${window.subject}:${window.windowStart}`;

export class ValkeyCounterStore implements CounterStore {
  readonly #valkey: ValkeyProvider;

  constructor(valkey: ValkeyProvider) {
    this.#valkey = valkey;
  }

  async incrementBelow(window: WindowRef, cap: number): Promise<IncrementResult> {
    const valkey = await this.#valkey();
    const reply = z
      .number()
      .parse(await valkey.eval(INCREMENT_BELOW, 1, counterKey(window), cap, window.expiresAt));
    return reply < 0 ? { accepted: false } : { accepted: true, count: reply };
  }

  async read(window: Pick<WindowRef, "subject" | "windowStart">): Promise<number> {
    const valkey = await this.#valkey();
    const reply = await valkey.get(counterKey(window));
    return reply === null ? 0 : z.coerce.number().int().parse(reply);
  }
}

// #region valkey-cache
export class ValkeyCacheStore implements CacheStore {
  readonly #valkey: ValkeyProvider;

  constructor(valkey: ValkeyProvider) {
    this.#valkey = valkey;
  }

  // `now` is not used: the server's clock decides, and an expired key is
  // never returned. That is the one place this store differs from DynamoDB.
  async get(key: string, _now: number): Promise<string | undefined> {
    const valkey = await this.#valkey();
    return (await valkey.get(`cache:${key}`)) ?? undefined;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const valkey = await this.#valkey();
    await valkey.set(`cache:${key}`, entry.value, "PXAT", entry.expiresAt);
  }

  async delete(key: string): Promise<void> {
    const valkey = await this.#valkey();
    await valkey.del(`cache:${key}`);
  }

  async tryLock(key: string, owner: string, expiresAt: number, _now: number): Promise<boolean> {
    const valkey = await this.#valkey();
    // NX: only if the key is absent. An expired lock is absent.
    return (await valkey.set(`lock:${key}`, owner, "PXAT", expiresAt, "NX")) === "OK";
  }

  async unlock(key: string, owner: string): Promise<void> {
    const valkey = await this.#valkey();
    await valkey.eval(UNLOCK_IF_OWNER, 1, `lock:${key}`, owner);
  }
}
// #endregion valkey-cache
