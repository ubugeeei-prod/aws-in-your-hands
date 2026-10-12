import type { BackoffPolicy } from "./backoff.ts";
import type { RetryBudgetPolicy } from "./retry-budget.ts";

// #region sdk
// What @smithy/util-retry 4.6.2 does when a call is throttled, unless the process sets
// AWS_NEW_RETRIES_2026=true. A test compares these with the constants the package exports.
export const SDK_THROTTLING_BACKOFF = {
  baseMs: 500,
  capMs: 20_000,
  jitter: "full",
} as const satisfies BackoffPolicy;

export const SDK_RETRY_BUDGET = {
  capacity: 500,
  retryCost: 5,
  successRefund: 1,
} as const satisfies RetryBudgetPolicy;

// The same wait under the retry behaviour AWS announced for 2026, as its documentation states it.
export const SDK_2026_THROTTLING_BACKOFF = {
  baseMs: 1000,
  capMs: 20_000,
  jitter: "full",
} as const satisfies BackoffPolicy;
// #endregion sdk

// #region table-client
// Written out, not left to the default: the default number of attempts for DynamoDB becomes 4
// under the 2026 behaviour, and the function's timeout below is sized for 3.
export const TABLE_CLIENT_RETRY = { maxAttempts: 3, retryMode: "standard" } as const;
// #endregion table-client
