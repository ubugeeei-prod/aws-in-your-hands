// How a Route 53 health check turns answers from an endpoint into "healthy" or
// "unhealthy", and which record a failover or a latency policy then returns.
// Pure functions: the real thing has checkers around the world and DNS caches
// nobody controls. The rules come from the Route 53 Developer Guide.

// #region health-check
export type HealthCheckConfig = {
  /** Seconds between two requests from one checker: 30, or 10 for a higher price. */
  requestIntervalSeconds: 10 | 30;
  /** Consecutive results needed to change a checker's mind, in either direction. */
  failureThreshold: number;
};

/** One checker's opinion after a series of results, oldest first. `true` is a 2xx or 3xx in time. */
export function checkerOpinion(
  results: readonly boolean[],
  failureThreshold: number,
  initial = true,
): boolean {
  let opinion = initial;
  let run = 0;
  for (const result of results) {
    run = result === opinion ? 0 : run + 1;
    if (run >= failureThreshold) {
      opinion = result;
      run = 0;
    }
  }
  return opinion;
}

// Route 53 says "more than 18%" and that the number may change.
export const HEALTHY_SHARE = 0.18;

/** The health check as a whole: healthy while more than 18% of the checkers say so. */
export function isHealthy(opinions: readonly boolean[]): boolean {
  const healthy = opinions.filter(Boolean).length;
  return opinions.length > 0 && healthy / opinions.length > HEALTHY_SHARE;
}

/** The shortest time in which every checker can have changed its mind. */
export function detectionSeconds(config: HealthCheckConfig): number {
  return config.requestIntervalSeconds * config.failureThreshold;
}
// #endregion health-check

// #region answer
export type RecordHealth = { primary: boolean; secondary: boolean };

/** Failover routing: the primary while it is healthy, otherwise the secondary. */
export function failoverAnswer(health: RecordHealth): "primary" | "secondary" {
  if (health.primary) {
    return "primary";
  }
  // With every record unhealthy, Route 53 treats them all as healthy again,
  // so the primary is the answer: a guess is better than no answer at all.
  return health.secondary ? "secondary" : "primary";
}

export type LatencyRecord = { region: string; healthy: boolean; latencyMs: number };

/** Latency routing: the nearest healthy Region. With none healthy, the nearest of all. */
export function latencyAnswer(records: readonly LatencyRecord[]): string {
  const healthy = records.filter((record) => record.healthy);
  const candidates = healthy.length > 0 ? healthy : records;
  const nearest = candidates.toSorted((a, b) => a.latencyMs - b.latencyMs)[0];
  if (nearest === undefined) {
    throw new Error("No latency records.");
  }
  return nearest.region;
}
// #endregion answer

// #region resolver
/** A resolver, or a client, that asks again only when what it holds has expired. */
export class CachingResolver<Answer> {
  readonly #ttlSeconds: number;
  #held: { answer: Answer; until: number } | undefined;

  constructor(ttlSeconds: number) {
    this.#ttlSeconds = ttlSeconds;
  }

  resolve(nowSeconds: number, ask: () => Answer): Answer {
    if (this.#held === undefined || nowSeconds >= this.#held.until) {
      this.#held = { answer: ask(), until: nowSeconds + this.#ttlSeconds };
    }
    return this.#held.answer;
  }
}
// #endregion resolver
