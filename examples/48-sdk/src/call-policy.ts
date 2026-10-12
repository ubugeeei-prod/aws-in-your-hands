import { worstCaseWaitMs } from "@aih/example-32-limits/src/backoff.ts";
import {
  SDK_2026_THROTTLING_BACKOFF,
  SDK_THROTTLING_BACKOFF,
} from "@aih/example-32-limits/src/sdk-retry.ts";

// #region policy
export type CallPolicy = {
  /** All attempts, the first one included. */
  maxAttempts: number;
  /** How long a TCP connection may take to open. */
  connectionTimeoutMs: number;
  /** How long one attempt may take from the request to the end of the response headers. */
  requestTimeoutMs: number;
};

// For a table call inside a function that has 10 seconds (chapter 32's stack).
export const TABLE_CALL_POLICY = {
  maxAttempts: 3,
  connectionTimeoutMs: 1000,
  requestTimeoutMs: 2000,
} as const satisfies CallPolicy;
// #endregion policy

// #region config
/**
 * The policy as client configuration. Everything the SDK would otherwise decide by default is
 * written out, and `throwOnRequestTimeout` is what makes `requestTimeout` more than a warning.
 */
export function clientConfigFor(policy: CallPolicy) {
  return {
    maxAttempts: policy.maxAttempts,
    retryMode: "standard",
    requestHandler: {
      connectionTimeout: policy.connectionTimeoutMs,
      requestTimeout: policy.requestTimeoutMs,
      throwOnRequestTimeout: true,
    },
  } as const;
}
// #endregion config

// #region worst-case
/** The longest one `send` can take: every attempt runs into its timeout, and every wait is the longest. */
export function worstCaseCallMs(policy: CallPolicy, retries2026: boolean): number {
  const backoff = retries2026 ? SDK_2026_THROTTLING_BACKOFF : SDK_THROTTLING_BACKOFF;
  return (
    policy.maxAttempts * policy.requestTimeoutMs + worstCaseWaitMs(backoff, policy.maxAttempts)
  );
}
// #endregion worst-case
