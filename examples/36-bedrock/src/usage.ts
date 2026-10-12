import * as v from "valibot";

import type { ModelProfile } from "./models.ts";

const count = v.pipe(v.number(), v.integer(), v.minValue(0));

// #region usage
// With prompt caching, `inputTokens` counts only what was neither read from the cache nor
// written to it. The three fields together are what was sent.
export const usageSchema = v.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadInputTokens: count,
  cacheWriteInputTokens: count,
});
export type Usage = v.InferOutput<typeof usageSchema>;

export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
  };
}

export const totalTokens = (usage: Usage): number =>
  usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheWriteInputTokens;
// #endregion usage

// #region cost
/**
 * What the usage costs at the list prices in models.ts, in millionths of a dollar, rounded up.
 * An estimate for budgets and logs. The bill is the authority.
 */
export function costMicroUsd(usage: Usage, prices: ModelProfile["usdPerMillionTokens"]): number {
  return Math.ceil(
    usage.inputTokens * prices.input +
      usage.outputTokens * prices.output +
      usage.cacheReadInputTokens * prices.cacheRead +
      usage.cacheWriteInputTokens * prices.cacheWrite,
  );
}

/**
 * More than any mix of `tokens` tokens can cost: all of them at the dearest rate the model has.
 * This is what a request sets aside before it runs.
 */
export function ceilingMicroUsd(
  tokens: number,
  prices: ModelProfile["usdPerMillionTokens"],
): number {
  return Math.ceil(tokens * Math.max(prices.input, prices.output, prices.cacheWrite));
}
// #endregion cost

// #region cache-math
export type CachePlan = {
  /** Tokens in the prefix that stays the same from call to call. */
  prefixTokens: number;
  /** Calls that send the prefix, the first one included, each within the cache's lifetime of the last. */
  calls: number;
};

/**
 * Dollars (in millionths) for the prefix alone, without a cache point and with one.
 * With one, the first call writes the prefix and every later call reads it.
 */
export function prefixCostMicroUsd(
  plan: CachePlan,
  prices: ModelProfile["usdPerMillionTokens"],
): { uncached: number; cached: number } {
  return {
    uncached: plan.prefixTokens * plan.calls * prices.input,
    cached: plan.prefixTokens * (prices.cacheWrite + (plan.calls - 1) * prices.cacheRead),
  };
}

/** The smallest number of calls at which a cache point costs no more than none. Null if it never does. */
export function breakEvenCalls(prices: ModelProfile["usdPerMillionTokens"]): number | null {
  if (prices.cacheRead >= prices.input) {
    return null;
  }
  // write + (n - 1) * read <= n * input
  return Math.max(
    1,
    Math.ceil((prices.cacheWrite - prices.cacheRead) / (prices.input - prices.cacheRead)),
  );
}
// #endregion cache-math
