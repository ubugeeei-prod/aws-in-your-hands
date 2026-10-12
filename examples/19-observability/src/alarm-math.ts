// #region rules
// The numbers the alarms use. The stack reads them, and so do the functions
// below, so a test of the function is a test of the deployed condition.
export const errorRateRule = {
  /** Percent of requests answered with a 5xx. */
  threshold: 5,
  /** Below this many requests in a minute, the rate counts as 0. */
  minRequests: 20,
  periodSeconds: 60,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  treatMissingData: "notBreaching",
} as const;

export const latencyRule = {
  /** Milliseconds, for the 95th percentile of the API's Latency metric. */
  threshold: 1000,
  statistic: "p95",
  periodSeconds: 60,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  treatMissingData: "notBreaching",
} as const;

/** CloudWatch metric math. `errors` and `requests` are the two metrics; `errorRate` is the first expression. */
export const errorRateExpressions = {
  errorRate: "100 * errors / requests",
  guarded: `IF(requests >= ${errorRateRule.minRequests}, errorRate, 0)`,
} as const;
// #endregion rules

// #region point
export type MinuteCounts = { requests: number | null; errors: number | null };

/** What the guarded expression yields for one minute. `null` is "no data point". */
export function errorRatePoint(
  counts: MinuteCounts,
  minRequests: number = errorRateRule.minRequests,
): number | null {
  if (counts.requests === null) {
    // No requests, no data point: nothing was measured, good or bad.
    return null;
  }
  if (counts.requests < minRequests) {
    return 0;
  }
  // A minute without a single 5xx has no `errors` data point; IF then yields 0.
  return counts.errors === null ? 0 : (100 * counts.errors) / counts.requests;
}
// #endregion point

// #region state
export type AlarmRule = {
  threshold: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: "notBreaching" | "breaching";
};

/**
 * "M out of N" over the last N one-minute points, missing ones filled in as
 * the rule says. A model for reasoning about the rule: CloudWatch itself looks
 * further back than N when points are missing.
 */
export function alarmState(points: readonly (number | null)[], rule: AlarmRule): "OK" | "ALARM" {
  const window = points.slice(-rule.evaluationPeriods);
  const breaching = window.filter((point) =>
    point === null ? rule.treatMissingData === "breaching" : point > rule.threshold,
  ).length;
  return breaching >= rule.datapointsToAlarm ? "ALARM" : "OK";
}
// #endregion state
