// #region counter
/** One subject's counter for one window. Times are Unix milliseconds. */
export type WindowRef = {
  subject: string;
  windowStart: number;
  /** After this the store may drop the counter. Never used to decide a request. */
  expiresAt: number;
};

export type IncrementResult = { accepted: true; count: number } | { accepted: false };

export type CounterStore = {
  /** Adds 1 unless the counter already holds `cap` or more. Check and add are one step in the store. */
  incrementBelow(window: WindowRef, cap: number): Promise<IncrementResult>;
  /** 0 when nothing was counted in that window. */
  read(window: Pick<WindowRef, "subject" | "windowStart">): Promise<number>;
};
// #endregion counter

// #region cache
export type CacheEntry = { value: string; expiresAt: number };

export type CacheStore = {
  /** Never returns an entry whose time has passed, whether or not the store has deleted it yet. */
  get(key: string, now: number): Promise<string | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  /** True when `owner` now holds the lock. The lock expires by itself: it limits load, it protects nothing. */
  tryLock(key: string, owner: string, expiresAt: number, now: number): Promise<boolean>;
  /** Releases the lock only if `owner` still holds it. */
  unlock(key: string, owner: string): Promise<void>;
};
// #endregion cache
