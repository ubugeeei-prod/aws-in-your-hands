// Quantities for the pricing scenarios in data/fragments/29.json and for the arithmetic in
// the chapter. Prices are not here: they come from the AWS Price List through tools/src/pricing.

const MONTH_SECONDS = 730 * 3600;

// #region billed
/**
 * What one invocation is charged for: handler time plus, on a cold start, initialization,
 * rounded up to a millisecond. Since 2025-08-01 this holds for every kind of function.
 */
export function billedMs(durationMs: number, initDurationMs = 0): number {
  return Math.ceil(durationMs + initDurationMs);
}

/** GB-seconds: the unit Lambda charges duration in. Memory is counted in units of 1,024 MB. */
export function gbSeconds(input: {
  memoryMb: number;
  billedMs: number;
  invocations: number;
}): number {
  return (input.memoryMb / 1024) * (input.billedMs / 1000) * input.invocations;
}
// #endregion billed

// #region memory
/**
 * How the duration charge changes when memory and duration both change. The request
 * charge is the same on both sides, so it is left out.
 */
export function durationCostRatio(
  before: { memoryMb: number; billedMs: number },
  after: { memoryMb: number; billedMs: number },
): number {
  return (after.memoryMb * after.billedMs) / (before.memoryMb * before.billedMs);
}

/** The duration at which a larger memory setting costs the same as the current one. */
export function breakEvenMs(
  current: { memoryMb: number; billedMs: number },
  memoryMb: number,
): number {
  return (current.memoryMb * current.billedMs) / memoryMb;
}
// #endregion memory

// #region provisioned
/** GB-seconds of provisioned concurrency kept for a whole 730-hour month, used or not. */
export function provisionedGbSeconds(input: { memoryMb: number; concurrency: number }): number {
  return (input.memoryMb / 1024) * input.concurrency * MONTH_SECONDS;
}

/**
 * The share of the month a provisioned environment must spend running requests before it
 * costs no more than on-demand. Above 1, it never does.
 */
export function provisionedBreakEven(usdPerGbSecond: {
  onDemand: number;
  provisionedIdle: number;
  provisionedDuration: number;
}): number {
  return (
    usdPerGbSecond.provisionedIdle / (usdPerGbSecond.onDemand - usdPerGbSecond.provisionedDuration)
  );
}
// #endregion provisioned
