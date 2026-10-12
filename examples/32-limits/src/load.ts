// #region target
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The load generator sends traffic to this machine only. Anything else is refused before a byte leaves. */
export function localTarget(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    throw new Error(`refusing to send load to ${url.host}: only http://localhost is allowed`);
  }
  return url;
}
// #endregion target

// #region schedule
/**
 * When each request starts, in milliseconds from the beginning. Fixed in advance: a slow
 * answer does not delay the next request, as it would if each waited for the one before.
 */
export function schedule(requestsPerSecond: number, seconds: number): number[] {
  const total = Math.round(requestsPerSecond * seconds);
  return Array.from({ length: total }, (_, index) => (index * 1000) / requestsPerSecond);
}
// #endregion schedule

// #region summary
/** `status` 0 stands for no answer at all. */
export type Sample = { status: number; latencyMs: number; retryAfter?: boolean };

export type Summary = {
  requests: number;
  /** Keyed by status. A refusal that said when to come back is counted apart, as "429 retry-after". */
  byAnswer: Record<string, number>;
  /** Of the answers that were not refused. `undefined` when there were none. */
  p50Ms: number | undefined;
  p95Ms: number | undefined;
  maxMs: number | undefined;
};

/** Nearest rank: the smallest value with at least `p` percent of the values at or below it. */
export function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(samples: Sample[]): Summary {
  const byAnswer: Record<string, number> = {};
  for (const sample of samples) {
    // Which limit refused is the first thing to know, and the header is how to tell them apart.
    const answer = sample.retryAfter === true ? `${sample.status} retry-after` : `${sample.status}`;
    byAnswer[answer] = (byAnswer[answer] ?? 0) + 1;
  }
  // A refusal comes back fast. Mixed in, it would make a struggling service look quick.
  const served = samples
    .filter((sample) => sample.status < 400)
    .map((sample) => sample.latencyMs)
    .toSorted((a, b) => a - b);
  return {
    requests: samples.length,
    byAnswer,
    p50Ms: percentile(served, 50),
    p95Ms: percentile(served, 95),
    maxMs: served.at(-1),
  };
}
// #endregion summary

// #region first-limit
export type Step = { requestsPerSecond: number; summary: Summary };

/** The lowest rate at which more than `tolerance` of the requests were refused or failed. */
export function firstLimit(steps: Step[], tolerance = 0.01): Step | undefined {
  return steps
    .toSorted((a, b) => a.requestsPerSecond - b.requestsPerSecond)
    .find(({ summary }) => {
      const bad = Object.entries(summary.byAnswer)
        .map(([answer, count]) => [Number.parseInt(answer, 10), count] as const)
        .filter(([status]) => status >= 400 || status === 0)
        .reduce((total, [, count]) => total + count, 0);
      return summary.requests > 0 && bad / summary.requests > tolerance;
    });
}
// #endregion first-limit
