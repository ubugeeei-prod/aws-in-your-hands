import * as v from "valibot";

import type { Failure } from "./contract.ts";

// #region classify
const throttled: Failure = { code: "throttled", retryable: true };
const unavailable: Failure = { code: "unavailable", retryable: true };
const misconfigured: Failure = { code: "misconfigured", retryable: false };
const rejected: Failure = { code: "rejected", retryable: false };

// Error names from the ConverseStream API reference.
const BY_NAME: Record<string, Failure> = {
  ThrottlingException: throttled,
  // Capacity, not your quota: the same request may pass a moment later.
  ServiceUnavailableException: unavailable,
  InternalServerException: unavailable,
  ModelNotReadyException: unavailable,
  ModelStreamErrorException: unavailable,
  ModelTimeoutException: { code: "timeout", retryable: true },
  // Sending these again changes nothing: the role, the model ID, or the request is wrong.
  AccessDeniedException: misconfigured,
  ResourceNotFoundException: misconfigured,
  ValidationException: rejected,
  ModelErrorException: rejected,
};

const namedSchema = v.looseObject({ name: v.string() });

export function failureByName(name: string): Failure | undefined {
  return BY_NAME[name];
}

/** What a thrown value means, or undefined when its name says nothing. */
export function classifyError(error: unknown): Failure | undefined {
  const named = v.safeParse(namedSchema, error);
  return named.success ? failureByName(named.output.name) : undefined;
}
// #endregion classify

// #region backoff
export type RetryPolicy = { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };

/** Exponential backoff with full jitter. `attempt` is the attempt that just failed, from 1. */
export function backoffMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

/** How long to wait before the next attempt, or null to give up. */
export function nextDelayMs(
  failure: Failure,
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
): number | null {
  if (!failure.retryable || attempt >= policy.maxAttempts) {
    return null;
  }
  return backoffMs(attempt, policy, random);
}
// #endregion backoff
