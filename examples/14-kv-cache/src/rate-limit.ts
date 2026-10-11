import type { CounterStore } from "./stores.ts";

export type RateLimitPolicy = {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  algorithm: "fixed" | "sliding";
};

export type Decision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Earliest moment a retry could pass, if nobody else spends the budget first. 0 when allowed. */
  retryAfterSeconds: number;
};

export interface RateLimiter {
  hit(subject: string, now: number): Promise<Decision>;
}

// #region window
/** Windows are aligned to the epoch, so every caller with a sane clock names the same one. */
export const windowStartOf = (now: number, windowMs: number): number => now - (now % windowMs);

/**
 * What the current window may still hold under a sliding window. The previous
 * window counts in proportion to how much of it the last `windowMs` still covers.
 */
export function slidingCap(limit: number, previousCount: number, elapsedMs: number, windowMs: number): number {
  return Math.floor(limit - previousCount * (1 - elapsedMs / windowMs));
}
// #endregion window

/** A lower bound: the caller may be refused again if others used the budget meanwhile. */
export function slidingRetryAfterMs(limit: number, previousCount: number, elapsedMs: number, windowMs: number): number {
  const budget = limit - previousCount * (1 - elapsedMs / windowMs);
  // The current counter holds at least this much, or the request would have passed.
  const used = Math.max(Math.floor(budget), 0);
  if (previousCount > 0) {
    // The budget grows by previousCount / windowMs per millisecond until the window ends.
    const wait = ((used + 1 - budget) * windowMs) / previousCount;
    if (elapsedMs + wait < windowMs) {
      return Math.ceil(wait);
    }
  }
  // In the next window this one's count becomes the previous count and has to decay first.
  return windowMs - elapsedMs + (used >= limit ? Math.ceil(windowMs / limit) : 0);
}

// #region limiter
export function createRateLimiter(store: CounterStore, policy: RateLimitPolicy): RateLimiter {
  const { limit, windowMs } = policy;
  return {
    async hit(subject, now) {
      const windowStart = windowStartOf(now, windowMs);
      const elapsed = now - windowStart;
      // Kept for one more window: the sliding window reads it as "previous".
      const current = { subject, windowStart, expiresAt: windowStart + 2 * windowMs };

      let cap = limit;
      let retryAfterMs = windowMs - elapsed;
      if (policy.algorithm === "sliding") {
        const previous = await store.read({ subject, windowStart: windowStart - windowMs });
        cap = slidingCap(limit, previous, elapsed, windowMs);
        retryAfterMs = slidingRetryAfterMs(limit, previous, elapsed, windowMs);
      }

      // The store decides, not this process: two callers that both read "one
      // left" must not both be let through.
      const result = cap > 0 ? await store.incrementBelow(current, cap) : { accepted: false as const };
      return result.accepted
        ? { allowed: true, limit, remaining: cap - result.count, retryAfterSeconds: 0 }
        : { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    },
  };
}
// #endregion limiter
