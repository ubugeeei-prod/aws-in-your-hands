// #region backoff
export type BackoffPolicy = {
  /** The ceiling of the first wait. */
  baseMs: number;
  /** No wait is longer than this, however many retries came before. */
  capMs: number;
  /** "none": everyone waits the ceiling. "full": anywhere from 0 up to it. */
  jitter: "none" | "full";
};

/** `retry` is 0 for the wait before the first retry. */
export const backoffCeilingMs = (policy: BackoffPolicy, retry: number): number =>
  Math.min(policy.capMs, policy.baseMs * 2 ** retry);

/** `random` returns a number in [0, 1), as Math.random does. */
export function backoffDelayMs(policy: BackoffPolicy, retry: number, random: () => number): number {
  const ceiling = backoffCeilingMs(policy, retry);
  return policy.jitter === "full" ? Math.floor(random() * ceiling) : ceiling;
}
// #endregion backoff

// #region worst-case
/** The longest a caller can spend waiting between attempts, before the last one is sent. */
export function worstCaseWaitMs(policy: BackoffPolicy, maxAttempts: number): number {
  let total = 0;
  for (let retry = 0; retry < maxAttempts - 1; retry++) {
    total += backoffCeilingMs(policy, retry);
  }
  return total;
}
// #endregion worst-case
