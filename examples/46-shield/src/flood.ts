import { seeded } from "@aih/example-32-limits/src/random.ts";
import { type BucketPolicy, fullBucket, take } from "@aih/example-32-limits/src/token-bucket.ts";

import { originBrake, RATE_RULE, SHARED_CACHE } from "./defences.ts";

// #region scenario
export type Label = "users" | "attack";

/** A crowd of addresses that all behave alike. */
export type Source = {
  label: Label;
  addresses: number;
  /** Requests a second from each address. */
  ratePerAddress: number;
  /** Active in seconds [from, to). */
  from: number;
  to: number;
  /** The share of its requests that ask for the route CloudFront may cache. */
  cachedShare: number;
};

export type RateRule = {
  limit: number;
  windowSeconds: number;
  /** How long an address stays over, or back under, the limit before AWS WAF acts on it. */
  noticeSeconds: number;
};

export type Defences = {
  rateRule?: RateRule;
  cacheSeconds?: number;
  brake?: BucketPolicy;
};

export type Scenario = {
  seconds: number;
  sources: Source[];
  defences: Defences;
  seed: number;
};

export type Count = {
  sent: number;
  /** Stopped by the rate-based rule at the edge. */
  blocked: number;
  /** Answered by CloudFront from its cache. */
  cached: number;
  /** Refused by the origin's brake: a 429 that CloudFront passes on. */
  throttled: number;
  /** Ran the function. */
  origin: number;
};

/** One second: how many requests ran the function, and how the users fared. */
export type Second = { origin: number; usersSent: number; usersServed: number };

export type Outcome = Record<Label, Count> & { timeline: Second[] };
// #endregion scenario

const emptyCount = (): Count => ({ sent: 0, blocked: 0, cached: 0, throttled: 0, origin: 0 });

/** Whole requests in second `tick` for a steady rate that need not be a whole number. */
const arrivals = (rate: number, sinceStart: number): number =>
  Math.floor((sinceStart + 1) * rate) - Math.floor(sinceStart * rate);

// #region run
/**
 * A model, not a measurement. One second at a time: the rate-based rule, then the
 * cache, then the brake. One edge location, no latency, and a refusal costs the origin nothing.
 */
export function simulate(scenario: Scenario): Outcome {
  const { rateRule, cacheSeconds, brake } = scenario.defences;
  const random = seeded(scenario.seed);
  const outcome: Outcome = { users: emptyCount(), attack: emptyCount(), timeline: [] };
  // Per source: what one of its addresses sent in each past second, and what the rule has decided.
  const history = scenario.sources.map(() => [] as number[]);
  const watch = scenario.sources.map(() => ({ over: false, since: 0, blocking: false }));
  let bucket = brake === undefined ? undefined : fullBucket(brake, 0);
  let cacheFreshUntil = -1;

  for (let tick = 0; tick < scenario.seconds; tick++) {
    const now = tick * 1000;
    const usersBefore = { ...outcome.users };
    // One entry per request on its way to the origin: the index of its source.
    const queue: number[] = [];
    const waitingForFill: number[] = [];

    scenario.sources.forEach((source, index) => {
      const active = tick >= source.from && tick < source.to;
      const sent = active
        ? arrivals(source.addresses * source.ratePerAddress, tick - source.from)
        : 0;
      const count = outcome[source.label];
      count.sent += sent;

      if (rateRule !== undefined) {
        // The rule counts what arrives, blocked or not: an address that keeps sending stays blocked.
        const past = history[index] as number[];
        past.push(sent / source.addresses);
        const inWindow = past.slice(-rateRule.windowSeconds).reduce((sum, value) => sum + value, 0);
        const state = watch[index] as (typeof watch)[number];
        const over = inWindow > rateRule.limit;
        if (over !== state.over) {
          state.over = over;
          state.since = tick;
        }
        if (tick - state.since >= rateRule.noticeSeconds) {
          state.blocking = state.over;
        }
        if (state.blocking) {
          count.blocked += sent;
          return;
        }
      }

      const forCache = cacheSeconds === undefined ? 0 : Math.round(sent * source.cachedShare);
      if (tick < cacheFreshUntil) {
        count.cached += forCache;
      } else {
        waitingForFill.push(...Array<number>(forCache).fill(index));
      }
      queue.push(...Array<number>(sent - forCache).fill(index));
    });

    // The origin cannot tell who is who, so the order within the second is drawn.
    for (let index = queue.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [queue[index], queue[other]] = [queue[other] as number, queue[index] as number];
    }
    const labelOf = (source: number) => (scenario.sources[source] as Source).label;
    const admit = (at: number): boolean => {
      if (brake === undefined || bucket === undefined) {
        return true;
      }
      const taken = take(bucket, brake, at);
      bucket = taken.state;
      return taken.allowed;
    };

    let reached = 0;
    // The first request for the stale route goes to the origin. The rest wait for its
    // answer and share it: CloudFront calls this request collapsing.
    const filler = waitingForFill.shift();
    let filled = false;
    if (filler !== undefined) {
      filled = admit(now);
      outcome[labelOf(filler)][filled ? "origin" : "throttled"] += 1;
      reached += filled ? 1 : 0;
    }
    for (const source of waitingForFill) {
      outcome[labelOf(source)][filled ? "cached" : "throttled"] += 1;
    }
    if (filled) {
      cacheFreshUntil = tick + (cacheSeconds ?? 0);
    }

    queue.forEach((source, index) => {
      const allowed = admit(now + Math.floor((index * 1000) / queue.length));
      outcome[labelOf(source)][allowed ? "origin" : "throttled"] += 1;
      reached += allowed ? 1 : 0;
    });
    outcome.timeline.push({
      origin: reached,
      usersSent: outcome.users.sent - usersBefore.sent,
      usersServed:
        outcome.users.cached + outcome.users.origin - usersBefore.cached - usersBefore.origin,
    });
  }
  return outcome;
}
// #endregion run

// #region read
/** The share of the users' requests, in seconds [from, to), answered by the cache or the function. */
export function served(outcome: Outcome, from = 0, to = outcome.timeline.length): number {
  const seconds = outcome.timeline.slice(from, to);
  const sent = seconds.reduce((sum, second) => sum + second.usersSent, 0);
  return sent === 0 ? 1 : seconds.reduce((sum, second) => sum + second.usersServed, 0) / sent;
}

export const total = (outcome: Outcome): Count => {
  const sum = emptyCount();
  for (const label of ["users", "attack"] as const) {
    for (const key of Object.keys(sum) as (keyof Count)[]) {
      sum[key] += outcome[label][key];
    }
  }
  return sum;
};
// #endregion read

// #region scenarios
/** One hour. The attack runs from minute 5 to minute 55. */
const HOUR = 3600;
export const ATTACK = { from: 300, to: 3300 } as const;

/** 200 addresses, one request every two seconds each, a fifth of them for the cached route. */
export const USERS: Source = {
  label: "users",
  addresses: 200,
  ratePerAddress: 0.5,
  from: 0,
  to: HOUR,
  cachedShare: 0.2,
};

/** 5,000 requests a second in each case. What differs is how many addresses share them, and the route. */
export const ATTACKS = {
  /** 20 addresses at 250 a second each, on a route that runs the function. */
  fewSources: { label: "attack", addresses: 20, ratePerAddress: 250, ...ATTACK, cachedShare: 0 },
  /** 20,000 addresses at one request every four seconds: each stays far under the rule's limit. */
  manySources: {
    label: "attack",
    addresses: 20_000,
    ratePerAddress: 0.25,
    ...ATTACK,
    cachedShare: 0,
  },
  /** The same 20,000 addresses, asking for the cached route. */
  cachedRoute: {
    label: "attack",
    addresses: 20_000,
    ratePerAddress: 0.25,
    ...ATTACK,
    cachedShare: 1,
  },
} as const satisfies Record<string, Source>;

/** The pieces the stacks deploy. 30 seconds is the delay AWS WAF's documentation calls usual. */
export const DEPLOYED = {
  rateRule: { ...RATE_RULE, noticeSeconds: 30 },
  cacheSeconds: SHARED_CACHE.maxAgeSeconds,
  /** `-c reservedConcurrency=20`: at most 200 requests a second reach the function. */
  brake: originBrake(20),
} as const satisfies Required<Defences>;

export const flood = (attack: keyof typeof ATTACKS, defences: Defences): Scenario => ({
  seconds: HOUR,
  sources: [USERS, ATTACKS[attack]],
  defences,
  seed: 46,
});
// #endregion scenarios
