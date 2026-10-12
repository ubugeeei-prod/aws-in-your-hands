import type { BucketPolicy } from "@aih/example-32-limits/src/token-bucket.ts";

// #region defences
// One definition for the stacks and for the simulation, so the flood in the tests
// meets the numbers that are deployed.

/** AWS WAF blocks an address that sent more than `limit` requests in the last `windowSeconds`. */
export const RATE_RULE = { limit: 300, windowSeconds: 60 } as const;

/** The route that answers everyone alike, and how long CloudFront may reuse its answer. */
export const SHARED_CACHE = { path: "/health", maxAgeSeconds: 5 } as const;

/** A function URL accepts ten requests a second for each unit of reserved concurrency. */
export const URL_RPS_PER_RESERVED_UNIT = 10;
// #endregion defences

// #region brake
/**
 * What reserved concurrency does to a function URL, as a token bucket. The rate is
 * Lambda's documented ceiling; the burst is this model's choice, one request per unit.
 */
export const originBrake = (reservedConcurrency: number): BucketPolicy => ({
  ratePerSecond: reservedConcurrency * URL_RPS_PER_RESERVED_UNIT,
  burst: reservedConcurrency,
});
// #endregion brake
