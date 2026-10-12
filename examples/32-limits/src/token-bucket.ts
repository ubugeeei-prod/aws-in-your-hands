// #region bucket
export type BucketPolicy = {
  /** Tokens added per second: the rate that can be kept up forever. */
  ratePerSecond: number;
  /** The most the bucket holds: how many requests may arrive at once after a quiet spell. */
  burst: number;
};

/**
 * Thousandths of a token, as of `at` (Unix milliseconds). One millisecond adds
 * `ratePerSecond` of them, so whole rates never leave a rounding error behind.
 */
export type BucketState = { milliTokens: number; at: number };

export const fullBucket = (policy: BucketPolicy, now: number): BucketState => ({
  milliTokens: policy.burst * 1000,
  at: now,
});

export type Taken = {
  allowed: boolean;
  state: BucketState;
  /** How long until one token is back. 0 when allowed. */
  retryAfterMs: number;
};

/** One request asks for one token. Nothing is stored here: the caller keeps the state. */
export function take(state: BucketState, policy: BucketPolicy, now: number): Taken {
  // A clock that steps back must not drain the bucket.
  const elapsedMs = Math.max(0, now - state.at);
  const milliTokens = Math.min(
    policy.burst * 1000,
    state.milliTokens + elapsedMs * policy.ratePerSecond,
  );
  if (milliTokens >= 1000) {
    return { allowed: true, state: { milliTokens: milliTokens - 1000, at: now }, retryAfterMs: 0 };
  }
  return {
    allowed: false,
    state: { milliTokens, at: now },
    retryAfterMs: Math.ceil((1000 - milliTokens) / policy.ratePerSecond),
  };
}
// #endregion bucket
