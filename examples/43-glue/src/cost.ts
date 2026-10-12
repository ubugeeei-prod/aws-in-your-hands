// Quantities for the pricing scenarios in data/fragments/43.json. Prices are
// not here: they come from the AWS Price List through tools/src/pricing.

// #region dpu
/** DPUs one worker counts as. The chapter uses the smallest type a Spark job accepts. */
export const DPU_PER_WORKER = { "G.1X": 1, "G.2X": 2 } as const;

// A run is billed by the second, but never for less than this many seconds.
export const MINIMUM_BILLED_SECONDS = { job: 60, crawler: 600 } as const;

/** DPU-hours billed for `runs` runs of `seconds` each, to the six decimals the price data keeps. */
export function dpuHours(input: {
  dpus: number;
  seconds: number;
  minimumSeconds: number;
  runs?: number;
}): number {
  const billed = Math.max(Math.ceil(input.seconds), input.minimumSeconds);
  return Math.round(((input.dpus * billed * (input.runs ?? 1)) / 3600) * 1e6) / 1e6;
}
// #endregion dpu
