import { type BackoffPolicy, backoffDelayMs } from "./backoff.ts";
import { seeded } from "./random.ts";
import { createRetryBudget, type RetryBudgetPolicy } from "./retry-budget.ts";
import { type BucketPolicy, fullBucket, take } from "./token-bucket.ts";

// #region scenario
export type Scenario = {
  /** Time moves in steps of this many milliseconds. */
  tickMs: number;
  ticks: number;
  /** Calls that begin in this tick. Each wants one success. */
  arrivals: (tick: number) => number;
  /** What the service lets through. Everything else is refused at once, as a 429 is. */
  service: BucketPolicy;
  /** Ticks, from the first up to but not including the second, in which it refuses everything. */
  outage?: readonly [number, number];
  maxAttempts: number;
  backoff: BackoffPolicy;
  /** One budget for all callers, as if they were calls of a single client object. */
  budget?: RetryBudgetPolicy;
  seed: number;
};

export type Tick = { fresh: number; retries: number; succeeded: number };

export type Outcome = {
  timeline: Tick[];
  calls: number;
  /** Requests the service had to look at: first attempts and retries. */
  sent: number;
  succeeded: number;
  /** Calls that ended in failure: out of attempts, or refused a retry by the budget. */
  gaveUp: number;
  /** Retries the budget did not let out. */
  heldBack: number;
  /** Calls still waiting for a retry when the simulation stopped. */
  unfinished: number;
};
// #endregion scenario

// #region run
/** A model, not a measurement: no network, no latency, and a refusal costs the service nothing. */
export function simulate(scenario: Scenario): Outcome {
  const random = seeded(scenario.seed);
  const budget = scenario.budget === undefined ? undefined : createRetryBudget(scenario.budget);
  // due[tick] holds one entry per waiting call: how many retries it has already made.
  const due: number[][] = Array.from({ length: scenario.ticks }, () => []);
  const timeline: Tick[] = [];
  let bucket = fullBucket(scenario.service, 0);
  let calls = 0;
  let gaveUp = 0;
  let heldBack = 0;
  let unfinished = 0;

  for (let tick = 0; tick < scenario.ticks; tick++) {
    const now = tick * scenario.tickMs;
    const fresh = scenario.arrivals(tick);
    calls += fresh;
    const waiting = due[tick] ?? [];
    // The service cannot tell a retry from a first attempt. Retries were queued earlier, so they go first.
    const queue = [...waiting, ...Array<number>(fresh).fill(0)];
    const down =
      scenario.outage !== undefined && tick >= scenario.outage[0] && tick < scenario.outage[1];
    let succeeded = 0;

    for (const retriesSoFar of queue) {
      let allowed = false;
      if (!down) {
        const taken = take(bucket, scenario.service, now);
        bucket = taken.state;
        allowed = taken.allowed;
      }
      if (allowed) {
        succeeded += 1;
        budget?.succeeded(retriesSoFar > 0);
        continue;
      }
      if (retriesSoFar + 1 >= scenario.maxAttempts) {
        gaveUp += 1;
        continue;
      }
      if (budget !== undefined && !budget.spend()) {
        gaveUp += 1;
        heldBack += 1;
        continue;
      }
      const delay = backoffDelayMs(scenario.backoff, retriesSoFar, random);
      const at = tick + Math.max(1, Math.ceil(delay / scenario.tickMs));
      const slot = due[at];
      if (slot === undefined) {
        unfinished += 1;
      } else {
        slot.push(retriesSoFar + 1);
      }
    }
    timeline.push({ fresh, retries: waiting.length, succeeded });
  }

  const count = (pick: (tick: Tick) => number) =>
    timeline.reduce((total, tick) => total + pick(tick), 0);
  return {
    timeline,
    calls,
    sent: count((tick) => tick.fresh + tick.retries),
    succeeded: count((tick) => tick.succeeded),
    gaveUp,
    heldBack,
    unfinished,
  };
}
// #endregion run

// #region read
/** The largest number of retries that landed in a single tick. */
export const peakRetries = (outcome: Outcome): number =>
  Math.max(...outcome.timeline.map((tick) => tick.retries));

/** Requests sent in ticks [from, to), first attempts and retries together. */
export const sentBetween = (outcome: Outcome, from: number, to: number): number =>
  outcome.timeline.slice(from, to).reduce((total, tick) => total + tick.fresh + tick.retries, 0);
// #endregion read

// #region scenarios
const common = { tickMs: 10, seed: 32 } as const;

/** A thousand callers start in the same instant, as they do when a service comes back. */
export function reconnect(jitter: BackoffPolicy["jitter"]): Scenario {
  return {
    ...common,
    ticks: 3000,
    arrivals: (tick) => (tick === 0 ? 1000 : 0),
    service: { ratePerSecond: 200, burst: 100 },
    maxAttempts: 8,
    backoff: { baseMs: 100, capMs: 5000, jitter },
  };
}

/** Steady traffic the service handles easily, and three seconds in which it refuses everything. */
export function outage(budget: RetryBudgetPolicy | undefined): Scenario {
  return {
    ...common,
    ticks: 1000,
    arrivals: () => 5,
    service: { ratePerSecond: 1000, burst: 100 },
    outage: [200, 500],
    maxAttempts: 3,
    backoff: { baseMs: 100, capMs: 5000, jitter: "full" },
    ...(budget === undefined ? {} : { budget }),
  };
}
// #endregion scenarios
