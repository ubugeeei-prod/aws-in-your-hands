import { detectionSeconds, type HealthCheckConfig } from "./failover.ts";

// #region targets
// The numbers this chapter commits to, for a Region that stops answering.
// They are choices, not measurements: nothing here was run against AWS.
export const TARGETS = {
  /** From the last good answer in Tokyo to the first good answer from Osaka. */
  rtoSeconds: 300,
  /** How much acknowledged work may be missing in Osaka: notes. */
  rpoTableSeconds: 60,
  /** The same for attachments. S3 states a time only with Replication Time Control (-c rtc=on). */
  rpoBucketSeconds: 900,
} as const;

export const HEALTH_CHECK: HealthCheckConfig = { requestIntervalSeconds: 30, failureThreshold: 3 };
// #endregion targets

// #region budget
export type FailoverAssumptions = {
  healthCheck: HealthCheckConfig;
  /** How long resolvers may keep the old answer. Route 53 sets this for an alias record. */
  dnsTtlSeconds: number;
  /** What a client adds: its own cache, a connection it keeps open, one retry. */
  clientSeconds: number;
};

export type FailoverBudget = {
  detectSeconds: number;
  dnsSeconds: number;
  clientSeconds: number;
  totalSeconds: number;
  withinTarget: boolean;
};

/** The parts of an automatic failover that can be added up before one is ever run. */
export function failoverBudget(
  assumptions: FailoverAssumptions,
  rtoSeconds: number = TARGETS.rtoSeconds,
): FailoverBudget {
  const detectSeconds = detectionSeconds(assumptions.healthCheck);
  const totalSeconds = detectSeconds + assumptions.dnsTtlSeconds + assumptions.clientSeconds;
  return {
    detectSeconds,
    dnsSeconds: assumptions.dnsTtlSeconds,
    clientSeconds: assumptions.clientSeconds,
    totalSeconds,
    withinTarget: totalSeconds <= rtoSeconds,
  };
}
// #endregion budget

// #region rpo
export type ObservedLag = {
  /** The largest `ReplicationLatency` seen for the table, in milliseconds. */
  tableMaxLagMs: number;
  /** Seconds the oldest object has waited in `PENDING`, or undefined when none is waiting. */
  bucketOldestPendingSeconds: number | undefined;
};

export type RpoVerdict = { table: "ok" | "over"; bucket: "ok" | "over" };

/** Lag is what a failover right now would lose. Compare it with what was promised. */
export function judgeRpo(observed: ObservedLag, targets: typeof TARGETS = TARGETS): RpoVerdict {
  return {
    table: observed.tableMaxLagMs / 1000 <= targets.rpoTableSeconds ? "ok" : "over",
    bucket: (observed.bucketOldestPendingSeconds ?? 0) <= targets.rpoBucketSeconds ? "ok" : "over",
  };
}
// #endregion rpo
