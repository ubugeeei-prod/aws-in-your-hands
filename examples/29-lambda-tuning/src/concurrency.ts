// A model of how Lambda hands requests to execution environments. It follows the rules in
// the Lambda documentation and nothing else: no scaling rate, no idle environments reclaimed.

// #region formula
/** Environments busy at the same time, on average. */
export function requiredConcurrency(requestsPerSecond: number, durationSeconds: number): number {
  return requestsPerSecond * durationSeconds;
}

/** Lambda also limits requests per second, to ten times the concurrency. */
export function requestRateLimit(concurrency: number): number {
  return concurrency * 10;
}

// What Lambda always keeps for functions without a reservation.
export const UNRESERVED_MINIMUM = 100;

/** How much concurrency can still be reserved or provisioned in an account. */
export function reservable(account: { limit: number; alreadyReserved: number }): number {
  return Math.max(0, account.limit - account.alreadyReserved - UNRESERVED_MINIMUM);
}
// #endregion formula

// #region simulate
export type Outcome = {
  atMs: number;
  /** `throttled`: no environment was free and no new one was allowed. */
  result: "warm" | "cold" | "throttled";
  /** Time until the handler returned. Initialization is in it on a cold start. */
  latencyMs: number | undefined;
};

export type Simulation = {
  outcomes: Outcome[];
  warm: number;
  cold: number;
  throttled: number;
  /** Environments that exist at the end, provisioned ones included. */
  environments: number;
};

export function simulate(input: {
  /** When each request arrives, in ascending order. */
  arrivalsMs: readonly number[];
  durationMs: number;
  initMs: number;
  /** Reserved concurrency: the most environments this function may have. */
  reserved?: number;
  /** Provisioned concurrency: environments initialized before the first request. */
  provisioned?: number;
}): Simulation {
  const limit = input.reserved ?? Number.POSITIVE_INFINITY;
  // For each environment, the time it becomes free again.
  const freeAt: number[] = Array.from({ length: input.provisioned ?? 0 }, () => 0);

  const outcomes = input.arrivalsMs.map((atMs): Outcome => {
    // An environment handles one request at a time.
    const idle = freeAt.findIndex((time) => time <= atMs);
    if (idle !== -1) {
      freeAt[idle] = atMs + input.durationMs;
      return { atMs, result: "warm", latencyMs: input.durationMs };
    }
    if (freeAt.length >= limit) {
      return { atMs, result: "throttled", latencyMs: undefined };
    }
    const latencyMs = input.initMs + input.durationMs;
    freeAt.push(atMs + latencyMs);
    return { atMs, result: "cold", latencyMs };
  });

  const count = (result: Outcome["result"]) =>
    outcomes.filter((outcome) => outcome.result === result).length;
  return {
    outcomes,
    warm: count("warm"),
    cold: count("cold"),
    throttled: count("throttled"),
    environments: freeAt.length,
  };
}
// #endregion simulate
