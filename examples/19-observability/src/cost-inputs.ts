// Quantities for the pricing scenarios in data/fragments/19.json. Prices are
// not here: they come from the AWS Price List through tools/src/pricing.

const GIB = 1024 ** 3;
const MONTH_SECONDS = 730 * 3600;

// #region logs
/** GB of log data sent to CloudWatch Logs in a month. */
export function logGbPerMonth(input: { requests: number; bytesPerRequest: number }): number {
  return (input.requests * input.bytesPerRequest) / GIB;
}

/** Average GB kept, once a log group has been filling for longer than its retention. */
export function storedGbMonths(input: { ingestedGbPerMonth: number; retentionDays: number }): number {
  return (input.ingestedGbPerMonth * input.retentionDays) / 30;
}
// #endregion logs

// #region traces
/**
 * Lambda's active tracing records the first request of each second and 5% of
 * the rest. For requests arriving at a steady rate, that is this many traces
 * per second.
 */
export function sampledPerSecond(requestsPerSecond: number): number {
  return Math.min(requestsPerSecond, 1) + 0.05 * Math.max(0, requestsPerSecond - 1);
}

/** Traces recorded in a 730-hour month at a steady request rate. */
export function tracesPerMonth(requestsPerMonth: number): number {
  return Math.round(sampledPerSecond(requestsPerMonth / MONTH_SECONDS) * MONTH_SECONDS);
}
// #endregion traces
