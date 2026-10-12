import { type BackoffPolicy, backoffDelayMs } from "./backoff.ts";
import type { RetryBudget } from "./retry-budget.ts";

// #region retryable
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE"]);

/**
 * 429 was refused before any work was done, so it is safe to send again whatever the method.
 * 502, 503 and 504 may hide work that was done: only a method that can be repeated is sent again.
 */
export function isRetryable(method: string, status: number): boolean {
  if (status === 429) {
    return true;
  }
  return (status === 502 || status === 503 || status === 504) && IDEMPOTENT.has(method);
}
// #endregion retryable

// #region retry-after
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** The header is seconds or an HTTP date. Anything else is no hint at all. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) {
    return undefined;
  }
  if (/^\d+$/.test(header)) {
    return Number(header) * 1000;
  }
  // Date.parse alone is too willing: it reads "-1" as a year.
  const date = HTTP_DATE.test(header) ? Date.parse(header) : Number.NaN;
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
// #endregion retry-after

export type RetryPolicy = {
  /** The first attempt counts. 1 means no retry. */
  maxAttempts: number;
  backoff: BackoffPolicy;
  /** A server that asks for a longer wait than this gets no retry. */
  maxWaitMs: number;
};

export type RetryDeps = {
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Shared by every call of one client. Without it, retries are limited per call only. */
  budget?: RetryBudget | undefined;
};

export type Outcome = {
  response: Response;
  attempts: number;
  waitedMs: number;
  /** Why no further attempt was made. */
  stopped: "answered" | "attempts" | "budget" | "wait_too_long";
};

// #region send
/** `send` builds a new request each time: a body can be read only once. */
export async function sendWithRetry(
  method: string,
  send: () => Promise<Response>,
  policy: RetryPolicy,
  deps: RetryDeps,
): Promise<Outcome> {
  let waitedMs = 0;
  for (let attempt = 1; ; attempt++) {
    const response = await send();
    const done = (stopped: Outcome["stopped"]): Outcome => ({
      response,
      attempts: attempt,
      waitedMs,
      stopped,
    });
    if (!isRetryable(method, response.status)) {
      if (response.ok) {
        deps.budget?.succeeded(attempt > 1);
      }
      return done("answered");
    }
    if (attempt >= policy.maxAttempts) {
      return done("attempts");
    }
    // The server's hint is a floor: it knows when room comes back, the client only guesses.
    const hinted = retryAfterMs(response.headers.get("retry-after"), deps.now());
    const wait = Math.max(backoffDelayMs(policy.backoff, attempt - 1, deps.random), hinted ?? 0);
    if (wait > policy.maxWaitMs) {
      return done("wait_too_long");
    }
    if (deps.budget !== undefined && !deps.budget.spend()) {
      return done("budget");
    }
    // The refused answer is dropped unread; free its body before waiting.
    await response.body?.cancel();
    await deps.sleep(wait);
    waitedMs += wait;
  }
}
// #endregion send
